-- ============================================
-- SCHEMA: Meu Almoço IFPE
-- Sistema de Fila do Refeitório
-- ============================================

-- 1. Tabela de Perfis
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin', 'nutricionista')),
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Políticas de perfil
CREATE POLICY "Usuários podem ver seu próprio perfil"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Usuários podem atualizar seu próprio perfil"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Inserção de perfil via trigger"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- A política "Admins podem ver todos os perfis" foi removida pois causava recursão infinita.
-- A política "Super admins podem ver perfis" também causa recursão — usamos RPCs com SECURITY DEFINER.

-- 2. Tabela de Tickets (Fichas)
CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  queue_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'used', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  qr_token TEXT,
  entered_at TIMESTAMPTZ,
  exited_at TIMESTAMPTZ
);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_tickets_user_date ON public.tickets (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON public.tickets (qr_token);
CREATE INDEX IF NOT EXISTS idx_tickets_date_status ON public.tickets (created_at, status);
CREATE INDEX IF NOT EXISTS idx_tickets_queue_number ON public.tickets (created_at, queue_number);

-- Políticas de tickets
CREATE POLICY "Alunos podem ver seus próprios tickets"
  ON public.tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins podem ver todos os tickets"
  ON public.tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins podem atualizar tickets"
  ON public.tickets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Política para permitir inserção de tickets (necessário para requeue)
CREATE POLICY "Sistema pode inserir tickets"
  ON public.tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 3. Tabela de Estado da Fila
CREATE TABLE IF NOT EXISTS public.queue_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_number INTEGER NOT NULL DEFAULT 0,
  last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
  avg_service_time_seconds INTEGER NOT NULL DEFAULT 45,
  max_tickets INTEGER NOT NULL DEFAULT 200,
  alert_threshold INTEGER NOT NULL DEFAULT 10
);

ALTER TABLE public.queue_state ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode ler o estado da fila
CREATE POLICY "Autenticados podem ver estado da fila"
  ON public.queue_state FOR SELECT
  USING (auth.role() = 'authenticated');

-- Apenas admins podem atualizar o estado da fila
CREATE POLICY "Admins podem atualizar estado da fila"
  ON public.queue_state FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Inserir estado inicial da fila
INSERT INTO public.queue_state (id, current_number, last_reset_date, avg_service_time_seconds, max_tickets, alert_threshold)
VALUES (1, 0, CURRENT_DATE, 45, 200, 10)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 4. FUNÇÕES RPC
-- ============================================

-- 4a. Reset diário da fila (chamado automaticamente)
CREATE OR REPLACE FUNCTION public.reset_daily_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.queue_state
  SET current_number = 0,
      last_reset_date = CURRENT_DATE
  WHERE id = 1
    AND last_reset_date < CURRENT_DATE;
END;
$$;

-- 4b. Emitir ficha (RPC principal do aluno)
CREATE OR REPLACE FUNCTION public.issue_ticket()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_student_name TEXT;
  v_queue_number INTEGER;
  v_qr_token TEXT;
  v_ticket_id UUID;
  v_current_time TIME;
  v_max_tickets INTEGER;
  v_total_today INTEGER;
BEGIN
  -- Obter ID do usuário autenticado
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não autenticado');
  END IF;

  -- Resetar fila se for um novo dia
  PERFORM public.reset_daily_queue();

  -- Verificar horário: só permite entre 11:30 e 13:00
  v_current_time := LOCALTIME;
  IF v_current_time < '11:30:00'::TIME THEN
    RETURN jsonb_build_object('error', 'A emissão de fichas abre às 11:30');
  END IF;
  IF v_current_time > '13:00:00'::TIME THEN
    RETURN jsonb_build_object('error', 'A emissão de fichas encerrou às 13:00');
  END IF;

  -- Verificar limite de fichas do dia
  SELECT max_tickets INTO v_max_tickets FROM public.queue_state WHERE id = 1;
  SELECT COUNT(*) INTO v_total_today
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE;

  IF v_total_today >= v_max_tickets THEN
    RETURN jsonb_build_object('error', 'Cota diária de almoço atingida');
  END IF;

  -- Verificar se o usuário já tem ficha ativa hoje (waiting ou used)
  IF EXISTS (
    SELECT 1 FROM public.tickets
    WHERE user_id = v_user_id
      AND created_at::date = CURRENT_DATE
      AND status IN ('waiting', 'used')
  ) THEN
    RETURN jsonb_build_object('error', 'Você já pegou sua ficha hoje');
  END IF;

  -- Obter nome do estudante
  SELECT full_name INTO v_student_name
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_student_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Perfil não encontrado');
  END IF;

  -- Bloquear o estado da fila para evitar condições de corrida (em vez de bloquear a agregação)
  PERFORM 1 FROM public.queue_state WHERE id = 1 FOR UPDATE;

  -- Gerar número sequencial
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_number
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE;

  -- Gerar token QR único
  v_ticket_id := gen_random_uuid();
  v_qr_token := encode(
    sha256(
      (v_user_id::text || CURRENT_DATE::text || v_ticket_id::text || random()::text)::bytea
    ),
    'hex'
  );

  -- Inserir ficha
  INSERT INTO public.tickets (id, user_id, student_name, queue_number, status, qr_token)
  VALUES (v_ticket_id, v_user_id, v_student_name, v_queue_number, 'waiting', v_qr_token);

  -- Retornar dados da ficha
  RETURN jsonb_build_object(
    'success', true,
    'ticket', jsonb_build_object(
      'id', v_ticket_id,
      'queue_number', v_queue_number,
      'student_name', v_student_name,
      'qr_token', v_qr_token,
      'status', 'waiting',
      'created_at', now()
    )
  );
END;
$$;

-- 4c. Validar ficha (RPC do admin) - Agora com entered_at
CREATE OR REPLACE FUNCTION public.validate_ticket(p_qr_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_current_number INTEGER;
  v_is_admin BOOLEAN;
  v_result_type TEXT;
BEGIN
  -- Verificar se é admin
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Acesso negado');
  END IF;

  -- Resetar fila se for novo dia
  PERFORM public.reset_daily_queue();

  -- Buscar ticket pelo token
  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE qr_token = p_qr_token;

  -- Token não encontrado
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'type', 'error',
      'message', 'QR Code inválido ou não encontrado'
    );
  END IF;

  -- Verificar se é do dia atual
  IF v_ticket.created_at::date != CURRENT_DATE THEN
    RETURN jsonb_build_object(
      'type', 'error',
      'message', 'Esta ficha é de outro dia',
      'ticket_date', v_ticket.created_at::date
    );
  END IF;

  -- Verificar se já foi usado
  IF v_ticket.status = 'used' THEN
    RETURN jsonb_build_object(
      'type', 'error',
      'message', 'Esta ficha já foi utilizada',
      'queue_number', v_ticket.queue_number,
      'student_name', v_ticket.student_name
    );
  END IF;

  -- Obter número atual da fila
  SELECT current_number INTO v_current_number
  FROM public.queue_state WHERE id = 1;

  -- Verificar sequência
  IF v_ticket.queue_number = v_current_number + 1 THEN
    v_result_type := 'success';
  ELSIF v_ticket.queue_number > v_current_number + 1 THEN
    v_result_type := 'skip_alert';
  ELSE
    v_result_type := 'success';
  END IF;

  -- Marcar como usado, registrar entered_at e INVALIDAR o qr_token (anti-replay)
  UPDATE public.tickets
  SET status = 'used',
      qr_token = NULL,
      entered_at = now()
  WHERE id = v_ticket.id;

  -- Atualizar número atual da fila
  UPDATE public.queue_state
  SET current_number = GREATEST(current_number, v_ticket.queue_number)
  WHERE id = 1;

  -- Verificar se há fichas puladas
  IF v_result_type = 'skip_alert' THEN
    RETURN jsonb_build_object(
      'type', 'skip_alert',
      'message', format('Atenção: O número %s ainda não passou!', v_current_number + 1),
      'queue_number', v_ticket.queue_number,
      'student_name', v_ticket.student_name,
      'expected_number', v_current_number + 1
    );
  END IF;

  RETURN jsonb_build_object(
    'type', 'success',
    'message', 'Ficha validada com sucesso!',
    'queue_number', v_ticket.queue_number,
    'student_name', v_ticket.student_name
  );
END;
$$;

-- 4d. Obter informações da fila em tempo real
CREATE OR REPLACE FUNCTION public.get_queue_info()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_number INTEGER;
  v_total_waiting INTEGER;
  v_total_today INTEGER;
  v_avg_time INTEGER;
  v_max_tickets INTEGER;
  v_alert_threshold INTEGER;
BEGIN
  -- Resetar se novo dia
  PERFORM public.reset_daily_queue();

  SELECT current_number, avg_service_time_seconds, max_tickets, alert_threshold
  INTO v_current_number, v_avg_time, v_max_tickets, v_alert_threshold
  FROM public.queue_state WHERE id = 1;

  SELECT COUNT(*) INTO v_total_waiting
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE AND status = 'waiting';

  SELECT COUNT(*) INTO v_total_today
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE;

  RETURN jsonb_build_object(
    'current_number', v_current_number,
    'total_waiting', v_total_waiting,
    'total_today', v_total_today,
    'avg_service_time_seconds', v_avg_time,
    'max_tickets', v_max_tickets,
    'alert_threshold', v_alert_threshold
  );
END;
$$;

-- 4e. Obter ticket do usuário atual (para o dia)
CREATE OR REPLACE FUNCTION public.get_my_ticket()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
BEGIN
  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE user_id = auth.uid()
    AND created_at::date = CURRENT_DATE
    AND status IN ('waiting', 'used')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('has_ticket', false);
  END IF;

  RETURN jsonb_build_object(
    'has_ticket', true,
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'queue_number', v_ticket.queue_number,
      'student_name', v_ticket.student_name,
      'status', v_ticket.status,
      'qr_token', v_ticket.qr_token,
      'created_at', v_ticket.created_at
    )
  );
END;
$$;

-- 4f. Pular e reenviar ao final da fila (admin)
CREATE OR REPLACE FUNCTION public.skip_and_requeue(p_ticket_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_is_admin BOOLEAN;
  v_new_queue_number INTEGER;
  v_new_ticket_id UUID;
  v_new_qr_token TEXT;
BEGIN
  -- Verificar se é admin
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Acesso negado');
  END IF;

  -- Buscar ticket
  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
    AND created_at::date = CURRENT_DATE
    AND status = 'waiting';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Ficha não encontrada ou já utilizada');
  END IF;

  -- Marcar como pulado
  UPDATE public.tickets
  SET status = 'skipped',
      qr_token = NULL
  WHERE id = v_ticket.id;

  -- Gerar novo número (final da fila)
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_new_queue_number
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE;

  -- Gerar novo token QR
  v_new_ticket_id := gen_random_uuid();
  v_new_qr_token := encode(
    sha256(
      (v_ticket.user_id::text || CURRENT_DATE::text || v_new_ticket_id::text || random()::text)::bytea
    ),
    'hex'
  );

  -- Criar novo ticket no final da fila
  INSERT INTO public.tickets (id, user_id, student_name, queue_number, status, qr_token)
  VALUES (v_new_ticket_id, v_ticket.user_id, v_ticket.student_name, v_new_queue_number, 'waiting', v_new_qr_token);

  -- Avançar o número atual se necessário
  UPDATE public.queue_state
  SET current_number = GREATEST(current_number, v_ticket.queue_number)
  WHERE id = 1;

  RETURN jsonb_build_object(
    'success', true,
    'message', format('%s foi movido para o final da fila (nova senha #%s)', v_ticket.student_name, v_new_queue_number),
    'old_number', v_ticket.queue_number,
    'new_number', v_new_queue_number,
    'student_name', v_ticket.student_name
  );
END;
$$;

-- 4g. Registrar saída do refeitório
CREATE OR REPLACE FUNCTION public.mark_exit(p_ticket_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_is_admin BOOLEAN;
  v_duration INTERVAL;
BEGIN
  -- Verificar se é admin
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Acesso negado');
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
    AND status = 'used'
    AND entered_at IS NOT NULL
    AND exited_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Ticket não encontrado ou saída já registrada');
  END IF;

  UPDATE public.tickets
  SET exited_at = now()
  WHERE id = p_ticket_id;

  v_duration := now() - v_ticket.entered_at;

  RETURN jsonb_build_object(
    'success', true,
    'student_name', v_ticket.student_name,
    'queue_number', v_ticket.queue_number,
    'duration_minutes', EXTRACT(EPOCH FROM v_duration) / 60
  );
END;
$$;

-- 4h. Obter informações do painel público (sem auth)
CREATE OR REPLACE FUNCTION public.get_public_panel_info()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_number INTEGER;
  v_total_served INTEGER;
  v_total_waiting INTEGER;
  v_total_today INTEGER;
  v_next_in_line jsonb;
  v_recently_served jsonb;
BEGIN
  PERFORM public.reset_daily_queue();

  SELECT current_number INTO v_current_number
  FROM public.queue_state WHERE id = 1;

  SELECT COUNT(*) INTO v_total_served
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE AND status = 'used';

  SELECT COUNT(*) INTO v_total_waiting
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE AND status = 'waiting';

  SELECT COUNT(*) INTO v_total_today
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE;

  -- Próximos 10 na fila
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'queue_number', t.queue_number,
      'student_name', t.student_name
    ) ORDER BY t.queue_number ASC
  ), '[]'::jsonb) INTO v_next_in_line
  FROM (
    SELECT queue_number, student_name
    FROM public.tickets
    WHERE created_at::date = CURRENT_DATE
      AND status = 'waiting'
      AND queue_number > v_current_number
    ORDER BY queue_number ASC
    LIMIT 10
  ) t;

  -- Últimos 5 atendidos
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'queue_number', t.queue_number,
      'student_name', t.student_name,
      'entered_at', t.entered_at
    ) ORDER BY t.entered_at DESC
  ), '[]'::jsonb) INTO v_recently_served
  FROM (
    SELECT queue_number, student_name, entered_at
    FROM public.tickets
    WHERE created_at::date = CURRENT_DATE
      AND status = 'used'
    ORDER BY entered_at DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'current_number', v_current_number,
    'total_served', v_total_served,
    'total_waiting', v_total_waiting,
    'total_today', v_total_today,
    'next_in_line', v_next_in_line,
    'recently_served', v_recently_served
  );
END;
$$;

-- 4i. Estatísticas para o admin
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_today_stats jsonb;
  v_avg_duration NUMERIC;
  v_currently_inside INTEGER;
  v_skipped_count INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Acesso negado');
  END IF;

  -- Tempo médio de permanência (em minutos)
  SELECT COALESCE(
    AVG(EXTRACT(EPOCH FROM (exited_at - entered_at)) / 60), 0
  ) INTO v_avg_duration
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE
    AND entered_at IS NOT NULL
    AND exited_at IS NOT NULL;

  -- Pessoas atualmente no refeitório
  SELECT COUNT(*) INTO v_currently_inside
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE
    AND status = 'used'
    AND entered_at IS NOT NULL
    AND exited_at IS NULL;

  -- Fichas puladas hoje
  SELECT COUNT(*) INTO v_skipped_count
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE
    AND status = 'skipped';

  RETURN jsonb_build_object(
    'avg_duration_minutes', ROUND(v_avg_duration, 1),
    'currently_inside', v_currently_inside,
    'skipped_count', v_skipped_count
  );
END;
$$;

-- 4j. Promover usuário a admin (LEGACY - usar manage_admin em vez disso)
CREATE OR REPLACE FUNCTION public.promote_to_admin(p_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = p_email;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado');
  END IF;

  UPDATE public.profiles
  SET role = 'admin'
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Usuário %s promovido a administrador', p_email)
  );
END;
$$;

-- 4l. Listar admins (apenas super admin pode chamar)
CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_admins jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_super_admin = true
  ) INTO v_is_super;

  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'Apenas super admins podem listar administradores');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'email', u.email,
      'full_name', p.full_name,
      'is_super_admin', p.is_super_admin,
      'created_at', p.created_at
    ) ORDER BY p.is_super_admin DESC, p.full_name ASC
  ), '[]'::jsonb) INTO v_admins
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'admin';

  RETURN jsonb_build_object(
    'success', true,
    'admins', v_admins
  );
END;
$$;

-- 4m. Gerenciar admins - adicionar/remover (apenas super admin)
CREATE OR REPLACE FUNCTION public.manage_admin(p_email TEXT, p_action TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_target_user_id UUID;
  v_target_profile RECORD;
  v_total_admins INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_super_admin = true
  ) INTO v_is_super;

  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'Apenas super admins podem gerenciar administradores');
  END IF;

  IF p_action NOT IN ('add', 'remove') THEN
    RETURN jsonb_build_object('error', 'Ação inválida. Use "add" ou "remove"');
  END IF;

  IF NOT (p_email LIKE '%@discente.ifpe.edu.br' OR p_email LIKE '%@ifpe.edu.br') THEN
    RETURN jsonb_build_object('error', 'Apenas emails institucionais IFPE são aceitos (@discente.ifpe.edu.br ou @ifpe.edu.br)');
  END IF;

  SELECT id INTO v_target_user_id
  FROM auth.users
  WHERE email = p_email;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado. O email precisa estar cadastrado no sistema.');
  END IF;

  IF v_target_user_id = auth.uid() THEN
    RETURN jsonb_build_object('error', 'Você não pode alterar seu próprio papel');
  END IF;

  SELECT * INTO v_target_profile
  FROM public.profiles
  WHERE id = v_target_user_id;

  IF v_target_profile IS NULL THEN
    RETURN jsonb_build_object('error', 'Perfil do usuário não encontrado');
  END IF;

  IF p_action = 'add' THEN
    IF v_target_profile.role = 'admin' THEN
      RETURN jsonb_build_object('error', format('%s já é administrador', p_email));
    END IF;

    SELECT COUNT(*) INTO v_total_admins
    FROM public.profiles
    WHERE role = 'admin';

    IF v_total_admins >= 50 THEN
      RETURN jsonb_build_object('error', 'Limite máximo de 50 administradores atingido');
    END IF;

    UPDATE public.profiles
    SET role = 'admin'
    WHERE id = v_target_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', format('%s foi promovido a administrador', p_email)
    );
  END IF;

  IF p_action = 'remove' THEN
    IF v_target_profile.role != 'admin' THEN
      RETURN jsonb_build_object('error', format('%s não é administrador', p_email));
    END IF;

    IF v_target_profile.is_super_admin THEN
      RETURN jsonb_build_object('error', 'Não é possível remover um super administrador');
    END IF;

    UPDATE public.profiles
    SET role = 'student'
    WHERE id = v_target_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', format('%s foi removido dos administradores', p_email)
    );
  END IF;

  RETURN jsonb_build_object('error', 'Ação não processada');
END;
$$;

-- 4k. Obter lista de fichas na fila (para admin gerenciar)
CREATE OR REPLACE FUNCTION public.get_waiting_tickets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_tickets jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Acesso negado');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'queue_number', t.queue_number,
      'student_name', t.student_name,
      'status', t.status,
      'created_at', t.created_at
    ) ORDER BY t.queue_number ASC
  ), '[]'::jsonb) INTO v_tickets
  FROM public.tickets t
  WHERE t.created_at::date = CURRENT_DATE
    AND t.status = 'waiting';

  RETURN v_tickets;
END;
$$;

-- ============================================
-- 5. TRIGGER: Criar perfil ao registrar
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Estudante'),
    'student'
  );
  RETURN NEW;
END;
$$;

-- Trigger que dispara ao criar novo usuário
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 6. HABILITAR REALTIME
-- ============================================
-- Execute no Supabase Dashboard: Database > Replication
-- Habilitar realtime para as tabelas: tickets, queue_state

ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_state;

-- ============================================
-- 7. GRANT para funções públicas (painel sem auth)
-- ============================================
-- A função get_public_panel_info usa SECURITY DEFINER,
-- então funciona com a service_role key.
-- Para acesso anon, execute no SQL Editor do Supabase:
-- GRANT EXECUTE ON FUNCTION public.get_public_panel_info() TO anon;

-- ============================================
-- 8. MIGRAÇÕES (executar se o banco já existe)
-- ============================================
-- ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ;
-- ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS exited_at TIMESTAMPTZ;
-- ALTER TABLE public.queue_state ADD COLUMN IF NOT EXISTS alert_threshold INTEGER NOT NULL DEFAULT 10;
-- ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
-- ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check CHECK (status IN ('waiting', 'used', 'skipped'));
