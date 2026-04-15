-- ============================================
-- SCHEMA: Meu Almoço IFPE
-- Sistema de Fila do Refeitório
-- ============================================

-- 1. Tabela de Perfis
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
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

-- Admins podem ver todos os perfis
CREATE POLICY "Admins podem ver todos os perfis"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 2. Tabela de Tickets (Fichas)
CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  queue_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'used')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  qr_token TEXT
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

-- 3. Tabela de Estado da Fila
CREATE TABLE IF NOT EXISTS public.queue_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_number INTEGER NOT NULL DEFAULT 0,
  last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
  avg_service_time_seconds INTEGER NOT NULL DEFAULT 45,
  max_tickets INTEGER NOT NULL DEFAULT 200
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
INSERT INTO public.queue_state (id, current_number, last_reset_date, avg_service_time_seconds, max_tickets)
VALUES (1, 0, CURRENT_DATE, 45, 200)
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

  -- Verificar se o usuário já tem ficha hoje
  IF EXISTS (
    SELECT 1 FROM public.tickets
    WHERE user_id = v_user_id
      AND created_at::date = CURRENT_DATE
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

  -- Gerar número sequencial (atômico com lock)
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_number
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE
  FOR UPDATE;

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

-- 4c. Validar ficha (RPC do admin)
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
    -- Próximo na sequência: SUCESSO
    v_result_type := 'success';
  ELSIF v_ticket.queue_number > v_current_number + 1 THEN
    -- Pulo na sequência: ALERTA
    v_result_type := 'skip_alert';
  ELSE
    -- Número já passou: pode ser válido mas fora de ordem
    v_result_type := 'success';
  END IF;

  -- Marcar como usado e INVALIDAR o qr_token (anti-replay)
  UPDATE public.tickets
  SET status = 'used',
      qr_token = NULL
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
BEGIN
  -- Resetar se novo dia
  PERFORM public.reset_daily_queue();

  SELECT current_number, avg_service_time_seconds, max_tickets
  INTO v_current_number, v_avg_time, v_max_tickets
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
    'max_tickets', v_max_tickets
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
    AND created_at::date = CURRENT_DATE;

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
