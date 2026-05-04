-- ============================================
-- MIGRAÇÃO: Sistema de Reserva Semanal
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

-- 1. Atualizar tabela profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_until DATE;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'admin', 'nutritionist'));

-- 2. Tabela de Reservas
CREATE TABLE IF NOT EXISTS public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'confirmed', 'cancelled', 'no_show')),
  qr_token TEXT,
  queue_number INTEGER,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, reservation_date)
);

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reservations_user_date ON public.reservations (user_id, reservation_date);
CREATE INDEX IF NOT EXISTS idx_reservations_date_status ON public.reservations (reservation_date, status);
CREATE INDEX IF NOT EXISTS idx_reservations_qr_token ON public.reservations (qr_token);

DO $$ BEGIN
  CREATE POLICY "Alunos podem ver suas reservas" ON public.reservations FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Alunos podem inserir reservas" ON public.reservations FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Alunos podem atualizar reservas" ON public.reservations FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admins podem ver todas reservas" ON public.reservations FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'nutritionist')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admins podem atualizar reservas" ON public.reservations FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Tabela de No-Show Records
CREATE TABLE IF NOT EXISTS public.no_show_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES public.reservations(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.no_show_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Admins podem ver no_shows" ON public.no_show_records FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'nutritionist')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Tabela de Push Subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Usuarios gerenciam sua subscription" ON public.push_subscriptions FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Habilitar realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;

-- ============================================
-- 5. RPCs DE RESERVA
-- ============================================

-- 5a. Obter reservas da semana
CREATE OR REPLACE FUNCTION public.get_week_reservations(p_week_start DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_reservations jsonb;
  v_blocked_until DATE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Não autenticado'); END IF;

  SELECT blocked_until INTO v_blocked_until FROM public.profiles WHERE id = v_user_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id, 'reservation_date', r.reservation_date, 'status', r.status,
      'queue_number', r.queue_number, 'created_at', r.created_at
    ) ORDER BY r.reservation_date ASC
  ), '[]'::jsonb) INTO v_reservations
  FROM public.reservations r
  WHERE r.user_id = v_user_id
    AND r.reservation_date >= p_week_start
    AND r.reservation_date < p_week_start + INTERVAL '7 days'
    AND r.status IN ('reserved', 'confirmed');

  RETURN jsonb_build_object('success', true, 'reservations', v_reservations, 'blocked_until', v_blocked_until);
END; $$;

-- 5b. Toggle reserva (criar ou cancelar)
CREATE OR REPLACE FUNCTION public.toggle_reservation(p_date DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_existing RECORD;
  v_blocked_until DATE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Não autenticado'); END IF;

  SELECT blocked_until INTO v_blocked_until FROM public.profiles WHERE id = v_user_id;
  IF v_blocked_until IS NOT NULL AND v_blocked_until > CURRENT_DATE THEN
    RETURN jsonb_build_object('error', format('Conta bloqueada até %s por faltas', v_blocked_until));
  END IF;

  IF EXTRACT(ISODOW FROM p_date) > 5 THEN
    RETURN jsonb_build_object('error', 'Reservas apenas para dias úteis (seg-sex)');
  END IF;

  IF p_date <= CURRENT_DATE + INTERVAL '1 day' THEN
    RETURN jsonb_build_object('error', 'Reservas com no mínimo 2 dias de antecedência');
  END IF;

  SELECT * INTO v_existing FROM public.reservations
  WHERE user_id = v_user_id AND reservation_date = p_date;

  IF FOUND THEN
    IF v_existing.status = 'reserved' THEN
      UPDATE public.reservations SET status = 'cancelled', qr_token = NULL, queue_number = NULL
      WHERE id = v_existing.id;
      RETURN jsonb_build_object('success', true, 'action', 'cancelled',
        'message', format('Reserva cancelada para %s', to_char(p_date, 'DD/MM')));
    ELSIF v_existing.status = 'cancelled' THEN
      UPDATE public.reservations SET status = 'reserved', created_at = now()
      WHERE id = v_existing.id;
      RETURN jsonb_build_object('success', true, 'action', 'reserved',
        'message', format('Reserva confirmada para %s', to_char(p_date, 'DD/MM')));
    ELSE
      RETURN jsonb_build_object('error', 'Esta reserva não pode ser alterada');
    END IF;
  ELSE
    INSERT INTO public.reservations (user_id, reservation_date, status)
    VALUES (v_user_id, p_date, 'reserved');
    RETURN jsonb_build_object('success', true, 'action', 'reserved',
      'message', format('Reserva confirmada para %s', to_char(p_date, 'DD/MM')));
  END IF;
END; $$;

-- 5c. Obter reserva de hoje (com QR Code)
CREATE OR REPLACE FUNCTION public.get_today_reservation()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_reservation RECORD;
  v_queue_number INTEGER;
  v_qr_token TEXT;
  v_student_name TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('has_reservation', false); END IF;

  SELECT * INTO v_reservation FROM public.reservations
  WHERE user_id = v_user_id AND reservation_date = CURRENT_DATE AND status IN ('reserved', 'confirmed');

  IF NOT FOUND THEN RETURN jsonb_build_object('has_reservation', false); END IF;

  IF v_reservation.status = 'confirmed' THEN
    RETURN jsonb_build_object('has_reservation', true, 'status', 'confirmed',
      'queue_number', v_reservation.queue_number);
  END IF;

  -- Gerar QR token se não tem
  IF v_reservation.qr_token IS NULL THEN
    v_qr_token := encode(sha256(
      (v_user_id::text || CURRENT_DATE::text || v_reservation.id::text || random()::text)::bytea
    ), 'hex');

    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_number
    FROM public.reservations WHERE reservation_date = CURRENT_DATE AND queue_number IS NOT NULL;

    UPDATE public.reservations SET qr_token = v_qr_token, queue_number = v_queue_number
    WHERE id = v_reservation.id;

    v_reservation.qr_token := v_qr_token;
    v_reservation.queue_number := v_queue_number;
  END IF;

  SELECT full_name INTO v_student_name FROM public.profiles WHERE id = v_user_id;

  RETURN jsonb_build_object('has_reservation', true, 'status', 'reserved',
    'reservation', jsonb_build_object(
      'id', v_reservation.id, 'queue_number', v_reservation.queue_number,
      'qr_token', v_reservation.qr_token, 'student_name', v_student_name,
      'reservation_date', v_reservation.reservation_date
    ));
END; $$;

-- 5d. Validar reserva (admin escaneia QR)
CREATE OR REPLACE FUNCTION public.validate_reservation(p_qr_token TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reservation RECORD;
  v_is_admin BOOLEAN;
  v_current_number INTEGER;
  v_notify_user_id UUID;
  v_notify_subscription JSONB;
  v_notify_queue_number INTEGER;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  SELECT * INTO v_reservation FROM public.reservations WHERE qr_token = p_qr_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('type', 'error', 'message', 'QR Code inválido'); END IF;

  IF v_reservation.reservation_date != CURRENT_DATE THEN
    RETURN jsonb_build_object('type', 'error', 'message', 'Reserva de outro dia');
  END IF;

  IF v_reservation.status = 'confirmed' THEN
    RETURN jsonb_build_object('type', 'error', 'message', 'Reserva já confirmada');
  END IF;

  IF v_reservation.status != 'reserved' THEN
    RETURN jsonb_build_object('type', 'error', 'message', 'Reserva cancelada ou inválida');
  END IF;

  -- Confirmar
  UPDATE public.reservations SET status = 'confirmed', qr_token = NULL, checked_in_at = now()
  WHERE id = v_reservation.id;

  SELECT current_number INTO v_current_number FROM public.queue_state WHERE id = 1;

  UPDATE public.queue_state SET current_number = GREATEST(current_number, v_reservation.queue_number) WHERE id = 1;

  -- Buscar a 5ª pessoa que está atualmente esperando na fila (à prova de pulos/cancelamentos)
  SELECT r.user_id, r.queue_number INTO v_notify_user_id, v_notify_queue_number
  FROM public.reservations r
  WHERE r.reservation_date = CURRENT_DATE
    AND r.status = 'reserved'
    AND r.queue_number > v_reservation.queue_number
  ORDER BY r.queue_number ASC
  OFFSET 4 LIMIT 1;

  IF v_notify_user_id IS NOT NULL THEN
    SELECT ps.subscription INTO v_notify_subscription
    FROM public.push_subscriptions ps WHERE ps.user_id = v_notify_user_id;
  END IF;

  RETURN jsonb_build_object(
    'type', 'success', 'message', 'Reserva confirmada!',
    'queue_number', v_reservation.queue_number,
    'student_name', (SELECT full_name FROM public.profiles WHERE id = v_reservation.user_id),
    'notify', CASE WHEN v_notify_subscription IS NOT NULL THEN
      jsonb_build_object('subscription', v_notify_subscription, 'queue_number', v_notify_queue_number,
        'current_number', v_reservation.queue_number)
    ELSE NULL END
  );
END; $$;

-- 5e. Processar no-shows (admin)
CREATE OR REPLACE FUNCTION public.process_no_shows()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_count INTEGER;
  v_block_count INTEGER := 0;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  -- Marcar reservas de ontem não confirmadas como no_show
  WITH no_shows AS (
    UPDATE public.reservations SET status = 'no_show'
    WHERE reservation_date = CURRENT_DATE - INTERVAL '1 day' AND status = 'reserved'
    RETURNING id, user_id
  )
  INSERT INTO public.no_show_records (user_id, reservation_id)
  SELECT user_id, id FROM no_shows;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Bloquear usuários com 3+ no-shows no mês
  UPDATE public.profiles SET blocked_until = CURRENT_DATE + INTERVAL '7 days'
  WHERE id IN (
    SELECT user_id FROM public.no_show_records
    WHERE recorded_at >= date_trunc('month', CURRENT_DATE)
    GROUP BY user_id HAVING COUNT(*) >= 3
  ) AND (blocked_until IS NULL OR blocked_until <= CURRENT_DATE);

  GET DIAGNOSTICS v_block_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'no_shows', v_count, 'blocked', v_block_count);
END; $$;

-- 5f. Estatísticas para nutricionista
CREATE OR REPLACE FUNCTION public.get_reservation_stats(p_start DATE, p_end DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_stats jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutritionist') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', d.dt, 'weekday', to_char(d.dt, 'Dy'),
      'reserved', COALESCE(s.reserved, 0), 'confirmed', COALESCE(s.confirmed, 0),
      'no_show', COALESCE(s.no_show, 0), 'cancelled', COALESCE(s.cancelled, 0))
    ORDER BY d.dt ASC
  ), '[]'::jsonb) INTO v_stats
  FROM generate_series(p_start, p_end, '1 day'::interval) AS d(dt)
  LEFT JOIN (
    SELECT reservation_date,
      COUNT(*) FILTER (WHERE status = 'reserved') AS reserved,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'no_show') AS no_show,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
    FROM public.reservations GROUP BY reservation_date
  ) s ON s.reservation_date = d.dt::date
  WHERE EXTRACT(ISODOW FROM d.dt) <= 5;

  RETURN jsonb_build_object('success', true, 'stats', v_stats);
END; $$;

-- 5g. Relatório mensal
CREATE OR REPLACE FUNCTION public.get_monthly_report(p_month INT, p_year INT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_start DATE;
  v_end DATE;
  v_total_reserved INT; v_total_confirmed INT; v_total_no_show INT;
  v_daily jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutritionist') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;

  SELECT COUNT(*) FILTER (WHERE status IN ('reserved','confirmed')),
         COUNT(*) FILTER (WHERE status = 'confirmed'),
         COUNT(*) FILTER (WHERE status = 'no_show')
  INTO v_total_reserved, v_total_confirmed, v_total_no_show
  FROM public.reservations WHERE reservation_date BETWEEN v_start AND v_end;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', d.dt, 'weekday', to_char(d.dt, 'Dy'),
      'total', COALESCE(s.total, 0), 'confirmed', COALESCE(s.confirmed, 0),
      'no_show', COALESCE(s.no_show, 0))
    ORDER BY d.dt
  ), '[]'::jsonb) INTO v_daily
  FROM generate_series(v_start, v_end, '1 day'::interval) AS d(dt)
  LEFT JOIN (
    SELECT reservation_date,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'no_show') AS no_show
    FROM public.reservations WHERE reservation_date BETWEEN v_start AND v_end
    GROUP BY reservation_date
  ) s ON s.reservation_date = d.dt::date
  WHERE EXTRACT(ISODOW FROM d.dt) <= 5;

  RETURN jsonb_build_object('success', true,
    'month', p_month, 'year', p_year,
    'total_reserved', v_total_reserved, 'total_confirmed', v_total_confirmed,
    'total_no_show', v_total_no_show,
    'attendance_rate', CASE WHEN v_total_reserved > 0 THEN ROUND((v_total_confirmed::numeric / v_total_reserved) * 100, 1) ELSE 0 END,
    'daily', v_daily);
END; $$;

-- 5h. Contagem dos próximos dias (nutricionista)
CREATE OR REPLACE FUNCTION public.get_upcoming_counts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_counts jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutritionist') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', d.dt, 'weekday', to_char(d.dt, 'TMDy'),
      'weekday_full', to_char(d.dt, 'TMDay'), 'count', COALESCE(s.cnt, 0))
    ORDER BY d.dt
  ), '[]'::jsonb) INTO v_counts
  FROM generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', '1 day'::interval) AS d(dt)
  LEFT JOIN (
    SELECT reservation_date, COUNT(*) AS cnt FROM public.reservations
    WHERE status = 'reserved' AND reservation_date >= CURRENT_DATE
    GROUP BY reservation_date
  ) s ON s.reservation_date = d.dt::date
  WHERE EXTRACT(ISODOW FROM d.dt) <= 5;

  RETURN jsonb_build_object('success', true, 'upcoming', v_counts);
END; $$;

-- 5i. Atualizar painel público para reservas
CREATE OR REPLACE FUNCTION public.get_public_panel_reservations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_number INTEGER;
  v_total_confirmed INTEGER;
  v_total_reserved INTEGER;
  v_total_today INTEGER;
  v_next_in_line jsonb;
  v_recently_served jsonb;
BEGIN
  PERFORM public.reset_daily_queue();
  SELECT current_number INTO v_current_number FROM public.queue_state WHERE id = 1;

  SELECT COUNT(*) FILTER (WHERE status = 'confirmed'),
         COUNT(*) FILTER (WHERE status = 'reserved'),
         COUNT(*)
  INTO v_total_confirmed, v_total_reserved, v_total_today
  FROM public.reservations WHERE reservation_date = CURRENT_DATE AND status IN ('reserved', 'confirmed');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'queue_number', r.queue_number, 'student_name', p.full_name
  ) ORDER BY r.queue_number ASC), '[]'::jsonb) INTO v_next_in_line
  FROM (SELECT * FROM public.reservations
    WHERE reservation_date = CURRENT_DATE AND status = 'reserved' AND queue_number IS NOT NULL
      AND queue_number > v_current_number ORDER BY queue_number LIMIT 10) r
  JOIN public.profiles p ON p.id = r.user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'queue_number', r.queue_number, 'student_name', p.full_name, 'entered_at', r.checked_in_at
  ) ORDER BY r.checked_in_at DESC), '[]'::jsonb) INTO v_recently_served
  FROM (SELECT * FROM public.reservations
    WHERE reservation_date = CURRENT_DATE AND status = 'confirmed'
    ORDER BY checked_in_at DESC LIMIT 5) r
  JOIN public.profiles p ON p.id = r.user_id;

  RETURN jsonb_build_object(
    'current_number', v_current_number, 'total_served', v_total_confirmed,
    'total_waiting', v_total_reserved, 'total_today', v_total_today,
    'next_in_line', v_next_in_line, 'recently_served', v_recently_served);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_public_panel_reservations() TO anon;

-- 5j. Salvar push subscription
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_subscription JSONB)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.push_subscriptions (user_id, subscription)
  VALUES (auth.uid(), p_subscription)
  ON CONFLICT (user_id) DO UPDATE SET subscription = p_subscription, created_at = now();
  RETURN jsonb_build_object('success', true);
END; $$;

-- 5k. Gerenciar admins e nutricionistas (apenas super admin)
CREATE OR REPLACE FUNCTION public.manage_admin(p_email TEXT, p_action TEXT, p_role TEXT DEFAULT 'admin')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_target_user_id UUID;
  v_target_profile RECORD;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_super_admin = true
  ) INTO v_is_super;

  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'Apenas super admins podem gerenciar cargos');
  END IF;

  IF p_action NOT IN ('add', 'remove') THEN
    RETURN jsonb_build_object('error', 'Ação inválida. Use "add" ou "remove"');
  END IF;

  IF p_role NOT IN ('admin', 'nutritionist') THEN
    RETURN jsonb_build_object('error', 'Cargo inválido. Use "admin" ou "nutritionist"');
  END IF;

  IF NOT (p_email LIKE '%@discente.ifpe.edu.br' OR p_email LIKE '%@ifpe.edu.br') THEN
    RETURN jsonb_build_object('error', 'Apenas emails institucionais IFPE são aceitos');
  END IF;

  SELECT id INTO v_target_user_id FROM auth.users WHERE email = p_email;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado.');
  END IF;

  IF v_target_user_id = auth.uid() THEN
    RETURN jsonb_build_object('error', 'Você não pode alterar seu próprio papel');
  END IF;

  SELECT * INTO v_target_profile FROM public.profiles WHERE id = v_target_user_id;

  IF p_action = 'add' THEN
    IF v_target_profile.role = p_role THEN
      RETURN jsonb_build_object('error', format('%s já é %s', p_email, p_role));
    END IF;

    UPDATE public.profiles SET role = p_role WHERE id = v_target_user_id;
    RETURN jsonb_build_object('success', true, 'message', format('%s foi promovido a %s', p_email, p_role));
  END IF;

  IF p_action = 'remove' THEN
    IF v_target_profile.is_super_admin THEN
      RETURN jsonb_build_object('error', 'Não é possível remover um super administrador');
    END IF;

    UPDATE public.profiles SET role = 'student' WHERE id = v_target_user_id;
    RETURN jsonb_build_object('success', true, 'message', format('%s foi removido', p_email));
  END IF;

  RETURN jsonb_build_object('error', 'Ação não processada');
END;
$$;

-- 5l. Listar admins e nutricionistas
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
    RETURN jsonb_build_object('error', 'Apenas super admins podem listar a equipe');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'email', u.email,
      'full_name', p.full_name,
      'role', p.role,
      'is_super_admin', p.is_super_admin,
      'created_at', p.created_at
    ) ORDER BY p.is_super_admin DESC, p.role ASC, p.full_name ASC
  ), '[]'::jsonb) INTO v_admins
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role IN ('admin', 'nutritionist');

  RETURN jsonb_build_object('success', true, 'admins', v_admins);
END;
$$;

-- 5m. Listar fila de espera (admin)
CREATE OR REPLACE FUNCTION public.get_waiting_reservations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_tickets jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role != 'admin' THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'queue_number', r.queue_number,
      'student_name', p.full_name,
      'status', r.status,
      'created_at', r.created_at
    ) ORDER BY r.queue_number ASC
  ), '[]'::jsonb) INTO v_tickets
  FROM public.reservations r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.reservation_date = CURRENT_DATE AND r.status = 'reserved' AND r.queue_number IS NOT NULL;

  RETURN v_tickets;
END; $$;

-- 5n. Estatísticas do Admin
CREATE OR REPLACE FUNCTION public.get_admin_reservation_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_avg_duration_minutes NUMERIC;
  v_currently_inside INTEGER;
  v_skipped_count INTEGER;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role != 'admin' THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  -- Tempo médio na fila (considerando os confirmados de hoje)
  SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (checked_in_at - created_at))/60)::numeric, 1), 0)
  INTO v_avg_duration_minutes
  FROM public.reservations
  WHERE reservation_date = CURRENT_DATE AND status = 'confirmed' AND checked_in_at IS NOT NULL;

  -- "No refeitório" (simplificação: pessoas que entraram nos últimos 30 mins)
  SELECT COUNT(*) INTO v_currently_inside
  FROM public.reservations
  WHERE reservation_date = CURRENT_DATE AND status = 'confirmed'
    AND checked_in_at >= now() - interval '30 minutes';

  -- Faltosos de hoje (simplificação: fila pulou e o aluno ficou pra trás)
  SELECT COUNT(*) INTO v_skipped_count
  FROM public.reservations
  WHERE reservation_date = CURRENT_DATE AND status = 'no_show';

  RETURN jsonb_build_object(
    'avg_duration_minutes', v_avg_duration_minutes,
    'currently_inside', v_currently_inside,
    'skipped_count', v_skipped_count
  );
END; $$;

-- 5o. Pular e re-enfileirar
CREATE OR REPLACE FUNCTION public.skip_and_requeue_reservation(p_reservation_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_reservation RECORD;
  v_max_number INTEGER;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role != 'admin' THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  SELECT * INTO v_reservation FROM public.reservations WHERE id = p_reservation_id;
  if NOT FOUND THEN RETURN jsonb_build_object('error', 'Reserva não encontrada'); END IF;

  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_max_number
  FROM public.reservations WHERE reservation_date = CURRENT_DATE AND queue_number IS NOT NULL;

  UPDATE public.reservations SET queue_number = v_max_number WHERE id = p_reservation_id;

  RETURN jsonb_build_object('success', true, 'message', format('Aluno enviado para o final da fila (novo número: #%s)', v_max_number));
END; $$;
