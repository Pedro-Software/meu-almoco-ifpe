-- ============================================
-- MIGRAÇÃO: Meu Almoço IFPE
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

-- 1. Novas colunas nos tickets
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS exited_at TIMESTAMPTZ;

-- 2. Novo campo de threshold de alerta
ALTER TABLE public.queue_state ADD COLUMN IF NOT EXISTS alert_threshold INTEGER NOT NULL DEFAULT 10;

-- 3. Atualizar constraint de status para incluir 'skipped'
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check CHECK (status IN ('waiting', 'used', 'skipped'));

-- 4. Política para inserção de tickets (necessário para requeue)
DO $$ BEGIN
  CREATE POLICY "Sistema pode inserir tickets"
    ON public.tickets FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 5. FUNÇÕES RPC (CREATE OR REPLACE = seguro re-executar)
-- ============================================

-- 5a. Reset diário da fila
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

-- 5b. Emitir ficha (atualizado: verifica status IN ('waiting','used'))
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
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não autenticado');
  END IF;

  PERFORM public.reset_daily_queue();

  v_current_time := LOCALTIME;
  IF v_current_time < '11:30:00'::TIME THEN
    RETURN jsonb_build_object('error', 'A emissão de fichas abre às 11:30');
  END IF;
  IF v_current_time > '13:00:00'::TIME THEN
    RETURN jsonb_build_object('error', 'A emissão de fichas encerrou às 13:00');
  END IF;

  SELECT max_tickets INTO v_max_tickets FROM public.queue_state WHERE id = 1;
  SELECT COUNT(*) INTO v_total_today
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE;

  IF v_total_today >= v_max_tickets THEN
    RETURN jsonb_build_object('error', 'Cota diária de almoço atingida');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tickets
    WHERE user_id = v_user_id
      AND created_at::date = CURRENT_DATE
      AND status IN ('waiting', 'used')
  ) THEN
    RETURN jsonb_build_object('error', 'Você já pegou sua ficha hoje');
  END IF;

  SELECT full_name INTO v_student_name
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_student_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Perfil não encontrado');
  END IF;

  PERFORM 1 FROM public.queue_state WHERE id = 1 FOR UPDATE;

  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_number
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE;

  v_ticket_id := gen_random_uuid();
  v_qr_token := encode(
    sha256(
      (v_user_id::text || CURRENT_DATE::text || v_ticket_id::text || random()::text)::bytea
    ),
    'hex'
  );

  INSERT INTO public.tickets (id, user_id, student_name, queue_number, status, qr_token)
  VALUES (v_ticket_id, v_user_id, v_student_name, v_queue_number, 'waiting', v_qr_token);

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

-- 5c. Validar ficha (atualizado: registra entered_at)
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
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Acesso negado');
  END IF;

  PERFORM public.reset_daily_queue();

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE qr_token = p_qr_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'type', 'error',
      'message', 'QR Code inválido ou não encontrado'
    );
  END IF;

  IF v_ticket.created_at::date != CURRENT_DATE THEN
    RETURN jsonb_build_object(
      'type', 'error',
      'message', 'Esta ficha é de outro dia',
      'ticket_date', v_ticket.created_at::date
    );
  END IF;

  IF v_ticket.status = 'used' THEN
    RETURN jsonb_build_object(
      'type', 'error',
      'message', 'Esta ficha já foi utilizada',
      'queue_number', v_ticket.queue_number,
      'student_name', v_ticket.student_name
    );
  END IF;

  SELECT current_number INTO v_current_number
  FROM public.queue_state WHERE id = 1;

  IF v_ticket.queue_number = v_current_number + 1 THEN
    v_result_type := 'success';
  ELSIF v_ticket.queue_number > v_current_number + 1 THEN
    v_result_type := 'skip_alert';
  ELSE
    v_result_type := 'success';
  END IF;

  UPDATE public.tickets
  SET status = 'used',
      qr_token = NULL,
      entered_at = now()
  WHERE id = v_ticket.id;

  UPDATE public.queue_state
  SET current_number = GREATEST(current_number, v_ticket.queue_number)
  WHERE id = 1;

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

-- 5d. Obter informações da fila (atualizado: inclui alert_threshold)
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

-- 5e. Obter ticket do usuário (atualizado: filtra por status ativo)
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

-- 5f. NOVO: Pular e reenviar ao final da fila
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
    AND created_at::date = CURRENT_DATE
    AND status = 'waiting';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Ficha não encontrada ou já utilizada');
  END IF;

  UPDATE public.tickets
  SET status = 'skipped',
      qr_token = NULL
  WHERE id = v_ticket.id;

  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_new_queue_number
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE;

  v_new_ticket_id := gen_random_uuid();
  v_new_qr_token := encode(
    sha256(
      (v_ticket.user_id::text || CURRENT_DATE::text || v_new_ticket_id::text || random()::text)::bytea
    ),
    'hex'
  );

  INSERT INTO public.tickets (id, user_id, student_name, queue_number, status, qr_token)
  VALUES (v_new_ticket_id, v_ticket.user_id, v_ticket.student_name, v_new_queue_number, 'waiting', v_new_qr_token);

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

-- 5g. NOVO: Registrar saída do refeitório
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

-- 5h. NOVO: Painel público (próximos 10, últimos atendidos)
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

-- 5i. NOVO: Estatísticas do admin
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin BOOLEAN;
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

  SELECT COALESCE(
    AVG(EXTRACT(EPOCH FROM (exited_at - entered_at)) / 60), 0
  ) INTO v_avg_duration
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE
    AND entered_at IS NOT NULL
    AND exited_at IS NOT NULL;

  SELECT COUNT(*) INTO v_currently_inside
  FROM public.tickets
  WHERE created_at::date = CURRENT_DATE
    AND status = 'used'
    AND entered_at IS NOT NULL
    AND exited_at IS NULL;

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

-- 5j. NOVO: Promover usuário a admin
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

-- 5k. NOVO: Listar fichas na fila (para admin gerenciar)
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

-- 6. Liberar painel público sem login
GRANT EXECUTE ON FUNCTION public.get_public_panel_info() TO anon;
