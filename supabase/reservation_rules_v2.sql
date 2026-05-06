-- ============================================
-- MIGRAÇÃO DEFINITIVA: Nova Regra de Reservas v2
-- 
-- Correções:
--   1. Timezone fixado em America/Recife em TODAS as funções
--      (Supabase usa UTC por padrão, sem isso o corte de 11:30 falharia)
--   2. Reserva abre com 2 dias de antecedência e permanece até 11:30 do dia
--   3. Número de fila gerado NO MOMENTO da reserva (FIFO)
--   4. Cota diária: 500 reservas
--   5. Re-reserva ganha novo queue_number no final
--   6. Relatório mensal agora inclui contagem de cancelamentos
--   7. Previsão inclui reserved + confirmed para precisão
--
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

-- 1. Atualizar cota diária para 500
UPDATE public.queue_state SET max_tickets = 500 WHERE id = 1;

-- ============================================
-- 2. toggle_reservation — Função principal de reserva/cancelamento
-- ============================================
CREATE OR REPLACE FUNCTION public.toggle_reservation(p_date DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_user_id UUID;
  v_existing RECORD;
  v_blocked_until DATE;
  v_total_reservations INTEGER;
  v_max_tickets INTEGER;
  v_next_queue_number INTEGER;
  v_current_queue_number INTEGER := 0;
  v_start_val INTEGER := 1;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'Não autenticado'); END IF;

  -- Verificar bloqueio por faltas
  SELECT blocked_until INTO v_blocked_until FROM public.profiles WHERE id = v_user_id;
  IF v_blocked_until IS NOT NULL AND v_blocked_until > CURRENT_DATE THEN
    RETURN jsonb_build_object('error', format('Conta bloqueada até %s por faltas', v_blocked_until));
  END IF;

  -- Apenas dias úteis (seg-sex)
  IF EXTRACT(ISODOW FROM p_date) > 5 THEN
    RETURN jsonb_build_object('error', 'Reservas apenas para dias úteis (seg-sex)');
  END IF;

  -- REGRA: Não permite datas passadas
  IF p_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('error', 'Não é possível reservar para datas passadas');
  END IF;

  -- REGRA: Se for hoje, só permite até 11:30 (horário de Recife)
  IF p_date = CURRENT_DATE AND LOCALTIME > '11:30:00'::TIME THEN
    RETURN jsonb_build_object('error', 'As reservas para hoje encerraram às 11:30');
  END IF;

  -- REGRA: Abertura com antecedência máxima de 2 dias
  IF p_date > CURRENT_DATE + INTERVAL '2 days' THEN
    RETURN jsonb_build_object('error', format(
      'A reserva para %s só abrirá em %s (2 dias antes)',
      to_char(p_date, 'DD/MM'),
      to_char(p_date - INTERVAL '2 days', 'DD/MM')
    ));
  END IF;

  -- LOCK ANTECIPADO: serializa TODA a lógica de cota + queue_number
  PERFORM 1 FROM public.queue_state WHERE id = 1 FOR UPDATE;

  -- Verificar limite de 500 reservas por dia
  SELECT max_tickets INTO v_max_tickets FROM public.queue_state WHERE id = 1;
  
  SELECT COUNT(*) INTO v_total_reservations
  FROM public.reservations
  WHERE reservation_date = p_date AND status IN ('reserved', 'confirmed');

  -- Buscar reserva existente do usuário para essa data
  SELECT * INTO v_existing FROM public.reservations
  WHERE user_id = v_user_id AND reservation_date = p_date;

  -- Calcular o número mínimo aceitável para não enviar o aluno para o passado (atrás de quem já comeu)
  IF p_date = CURRENT_DATE THEN
    SELECT COALESCE(current_number, 0) INTO v_current_queue_number FROM public.queue_state WHERE id = 1;
    v_start_val := v_current_queue_number + 1;
  END IF;

  IF FOUND THEN
    IF v_existing.status = 'reserved' THEN
      -- CANCELAR: Limpa o queue_number, devolvendo a numeração para a "piscina" de disponíveis
      UPDATE public.reservations SET status = 'cancelled', qr_token = NULL, queue_number = NULL
      WHERE id = v_existing.id;
      RETURN jsonb_build_object('success', true, 'action', 'cancelled',
        'message', format('Reserva cancelada para %s', to_char(p_date, 'DD/MM')));

    ELSIF v_existing.status = 'cancelled' THEN
      -- RE-RESERVAR:
      IF v_total_reservations >= v_max_tickets THEN
        RETURN jsonb_build_object('error', format('Cota diária atingida (%s reservas)', v_max_tickets));
      END IF;

      -- REGRA: Acha a menor ficha disponível (gap) a partir do v_start_val
      SELECT COALESCE(MIN(t1.queue_number + 1), v_start_val) INTO v_next_queue_number
      FROM (
        SELECT queue_number FROM public.reservations
        WHERE reservation_date = p_date AND status IN ('reserved', 'confirmed') AND queue_number >= v_start_val - 1
        UNION ALL
        SELECT v_start_val - 1
      ) t1
      LEFT JOIN (
        SELECT queue_number FROM public.reservations
        WHERE reservation_date = p_date AND status IN ('reserved', 'confirmed')
      ) t2 ON t1.queue_number + 1 = t2.queue_number
      WHERE t2.queue_number IS NULL;

      UPDATE public.reservations 
      SET status = 'reserved', created_at = now(), queue_number = v_next_queue_number
      WHERE id = v_existing.id;

      RETURN jsonb_build_object('success', true, 'action', 'reserved',
        'message', format('Reserva confirmada para %s (Fila #%s)', to_char(p_date, 'DD/MM'), v_next_queue_number),
        'queue_number', v_next_queue_number);

    ELSE
      RETURN jsonb_build_object('error', 'Esta reserva não pode ser alterada');
    END IF;
  ELSE
    -- NOVA RESERVA:
    IF v_total_reservations >= v_max_tickets THEN
      RETURN jsonb_build_object('error', format('Cota diária atingida (%s reservas)', v_max_tickets));
    END IF;

    -- REGRA: Acha a menor ficha disponível (gap) a partir do v_start_val
    SELECT COALESCE(MIN(t1.queue_number + 1), v_start_val) INTO v_next_queue_number
    FROM (
      SELECT queue_number FROM public.reservations
      WHERE reservation_date = p_date AND status IN ('reserved', 'confirmed') AND queue_number >= v_start_val - 1
      UNION ALL
      SELECT v_start_val - 1
    ) t1
    LEFT JOIN (
      SELECT queue_number FROM public.reservations
      WHERE reservation_date = p_date AND status IN ('reserved', 'confirmed')
    ) t2 ON t1.queue_number + 1 = t2.queue_number
    WHERE t2.queue_number IS NULL;

    INSERT INTO public.reservations (user_id, reservation_date, status, queue_number)
    VALUES (v_user_id, p_date, 'reserved', v_next_queue_number);

    RETURN jsonb_build_object('success', true, 'action', 'reserved',
      'message', format('Reserva confirmada para %s (Fila #%s)', to_char(p_date, 'DD/MM'), v_next_queue_number),
      'queue_number', v_next_queue_number);
  END IF;
END; $$;

-- ============================================
-- 3. get_today_reservation — QR Code do dia
-- ============================================
CREATE OR REPLACE FUNCTION public.get_today_reservation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_user_id UUID;
  v_reservation RECORD;
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

  -- Gerar QR token se não tem (queue_number já existe desde a reserva)
  IF v_reservation.qr_token IS NULL THEN
    v_qr_token := encode(sha256(
      (v_user_id::text || CURRENT_DATE::text || v_reservation.id::text || random()::text)::bytea
    ), 'hex');

    UPDATE public.reservations SET qr_token = v_qr_token
    WHERE id = v_reservation.id;

    v_reservation.qr_token := v_qr_token;
  END IF;

  SELECT full_name INTO v_student_name FROM public.profiles WHERE id = v_user_id;

  RETURN jsonb_build_object('has_reservation', true, 'status', 'reserved',
    'reservation', jsonb_build_object(
      'id', v_reservation.id, 'queue_number', v_reservation.queue_number,
      'qr_token', v_reservation.qr_token, 'student_name', v_student_name,
      'reservation_date', v_reservation.reservation_date
    ));
END; $$;

-- ============================================
-- 4. get_week_reservations — Reservas da semana
-- ============================================
CREATE OR REPLACE FUNCTION public.get_week_reservations(p_week_start DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
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

-- ============================================
-- 5. validate_reservation — Admin valida QR Code
-- ============================================
CREATE OR REPLACE FUNCTION public.validate_reservation(p_qr_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_reservation RECORD;
  v_is_admin BOOLEAN;
  v_current_number INTEGER;
  v_next_expected INTEGER;
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

  -- VALIDAÇÃO DE ORDEM: só permite confirmar o próximo da fila
  SELECT current_number INTO v_current_number FROM public.queue_state WHERE id = 1;

  SELECT MIN(queue_number) INTO v_next_expected
  FROM public.reservations
  WHERE reservation_date = CURRENT_DATE AND status = 'reserved';

  IF v_reservation.queue_number != v_next_expected THEN
    RETURN jsonb_build_object('type', 'error', 'message',
      format('Fora de ordem. O próximo da fila é #%s. Esta reserva é #%s.',
        LPAD(v_next_expected::text, 3, '0'),
        LPAD(v_reservation.queue_number::text, 3, '0')));
  END IF;

  -- Confirmar
  UPDATE public.reservations SET status = 'confirmed', qr_token = NULL, checked_in_at = now()
  WHERE id = v_reservation.id;

  UPDATE public.queue_state SET current_number = GREATEST(current_number, v_reservation.queue_number) WHERE id = 1;

  -- Buscar a 5ª pessoa que está atualmente esperando na fila
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

-- ============================================
-- 6. process_no_shows — Processar faltas
-- ============================================
CREATE OR REPLACE FUNCTION public.process_no_shows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
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

-- ============================================
-- 7. skip_and_requeue_reservation — Pular na fila
-- ============================================
CREATE OR REPLACE FUNCTION public.skip_and_requeue_reservation(p_reservation_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_role TEXT;
  v_reservation RECORD;
  v_max_number INTEGER;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role != 'admin' THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  SELECT * INTO v_reservation FROM public.reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Reserva não encontrada'); END IF;

  -- Lock para evitar race condition
  PERFORM 1 FROM public.queue_state WHERE id = 1 FOR UPDATE;

  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_max_number
  FROM public.reservations WHERE reservation_date = CURRENT_DATE;

  UPDATE public.reservations SET queue_number = v_max_number WHERE id = p_reservation_id;

  RETURN jsonb_build_object('success', true, 'message', format('Aluno enviado para o final da fila (novo número: #%s)', v_max_number));
END; $$;

-- ============================================
-- 8. get_monthly_report — COM cancelamentos
-- ============================================
CREATE OR REPLACE FUNCTION public.get_monthly_report(p_month INT, p_year INT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_role TEXT;
  v_start DATE;
  v_end DATE;
  v_total_reserved INT;
  v_total_confirmed INT;
  v_total_no_show INT;
  v_total_cancelled INT;
  v_daily jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutricionista') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;

  SELECT COUNT(*) FILTER (WHERE status IN ('reserved','confirmed')),
         COUNT(*) FILTER (WHERE status = 'confirmed'),
         COUNT(*) FILTER (WHERE status = 'no_show'),
         COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO v_total_reserved, v_total_confirmed, v_total_no_show, v_total_cancelled
  FROM public.reservations WHERE reservation_date BETWEEN v_start AND v_end;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', d.dt, 'weekday', to_char(d.dt, 'Dy'),
      'total', COALESCE(s.total, 0), 'confirmed', COALESCE(s.confirmed, 0),
      'no_show', COALESCE(s.no_show, 0), 'cancelled', COALESCE(s.cancelled, 0))
    ORDER BY d.dt
  ), '[]'::jsonb) INTO v_daily
  FROM generate_series(v_start, v_end, '1 day'::interval) AS d(dt)
  LEFT JOIN (
    SELECT reservation_date,
      COUNT(*) FILTER (WHERE status IN ('reserved', 'confirmed')) AS total,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'no_show') AS no_show,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
    FROM public.reservations WHERE reservation_date BETWEEN v_start AND v_end
    GROUP BY reservation_date
  ) s ON s.reservation_date = d.dt::date
  WHERE EXTRACT(ISODOW FROM d.dt) <= 5;

  RETURN jsonb_build_object('success', true,
    'month', p_month, 'year', p_year,
    'total_reserved', v_total_reserved, 'total_confirmed', v_total_confirmed,
    'total_no_show', v_total_no_show, 'total_cancelled', v_total_cancelled,
    'attendance_rate', CASE WHEN v_total_reserved > 0 THEN ROUND((v_total_confirmed::numeric / v_total_reserved) * 100, 1) ELSE 0 END,
    'daily', v_daily);
END; $$;

-- ============================================
-- 9. get_upcoming_counts — Previsão (reserved + confirmed)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_upcoming_counts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_role TEXT;
  v_counts jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutricionista') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', d.dt, 'weekday', to_char(d.dt, 'TMDy'),
      'weekday_full', to_char(d.dt, 'TMDay'), 'count', COALESCE(s.cnt, 0))
    ORDER BY d.dt
  ), '[]'::jsonb) INTO v_counts
  FROM generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', '1 day'::interval) AS d(dt)
  LEFT JOIN (
    SELECT reservation_date, COUNT(*) AS cnt FROM public.reservations
    WHERE status IN ('reserved', 'confirmed') AND reservation_date >= CURRENT_DATE
    GROUP BY reservation_date
  ) s ON s.reservation_date = d.dt::date
  WHERE EXTRACT(ISODOW FROM d.dt) <= 5;

  RETURN jsonb_build_object('success', true, 'upcoming', v_counts);
END; $$;

-- ============================================
-- 10. get_reservation_stats — Stats nutricionista
-- ============================================
CREATE OR REPLACE FUNCTION public.get_reservation_stats(p_start DATE, p_end DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_role TEXT;
  v_stats jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutricionista') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

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

-- ============================================
-- 11. Painel público
-- ============================================
CREATE OR REPLACE FUNCTION public.get_public_panel_reservations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
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
         COUNT(*) FILTER (WHERE status = 'reserved' AND queue_number IS NOT NULL),
         COUNT(*) FILTER (WHERE queue_number IS NOT NULL)
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

-- ============================================
-- 12. Funções admin com timezone
-- ============================================
CREATE OR REPLACE FUNCTION public.get_waiting_reservations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
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

CREATE OR REPLACE FUNCTION public.get_admin_reservation_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_role TEXT;
  v_avg_duration_minutes NUMERIC;
  v_currently_inside INTEGER;
  v_skipped_count INTEGER;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role != 'admin' THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (checked_in_at - created_at))/60)::numeric, 1), 0)
  INTO v_avg_duration_minutes
  FROM public.reservations
  WHERE reservation_date = CURRENT_DATE AND status = 'confirmed' AND checked_in_at IS NOT NULL;

  SELECT COUNT(*) INTO v_currently_inside
  FROM public.reservations
  WHERE reservation_date = CURRENT_DATE AND status = 'confirmed'
    AND checked_in_at >= now() - interval '30 minutes';

  SELECT COUNT(*) INTO v_skipped_count
  FROM public.reservations
  WHERE reservation_date = CURRENT_DATE AND status = 'no_show';

  RETURN jsonb_build_object(
    'avg_duration_minutes', v_avg_duration_minutes,
    'currently_inside', v_currently_inside,
    'skipped_count', v_skipped_count
  );
END; $$;

-- ============================================
-- 13. Tabela de Auditoria e Limpeza Operacional do Dia
-- ============================================
CREATE TABLE IF NOT EXISTS public.admin_actions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_date DATE NOT NULL,
  affected_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_actions_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Super admins podem ver logs" ON public.admin_actions_log FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_super_admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.close_day_reset()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'America/Recife'
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_count INTEGER;
  v_log_id UUID;
BEGIN
  -- Verificar se é superadmin
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin' AND is_super_admin = true
  ) INTO v_is_super;

  IF NOT v_is_super THEN 
    RETURN jsonb_build_object('error', 'Apenas super administradores podem encerrar o dia operacional.'); 
  END IF;

  -- Lock preventivo na tabela de fila
  PERFORM 1 FROM public.queue_state WHERE id = 1 FOR UPDATE;

  -- Mudar apenas 'reserved' para 'cancelled' na data de HOJE
  -- (Reservas 'confirmed', 'no_show', e futuras continuam intactas)
  UPDATE public.reservations 
  SET status = 'cancelled', qr_token = NULL, queue_number = NULL
  WHERE reservation_date = CURRENT_DATE AND status = 'reserved';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Resetar estado visual da fila (painel de TV volta a aguardar chamadas)
  UPDATE public.queue_state SET current_number = 0 WHERE id = 1;

  -- Registrar a ação no histórico de auditoria
  INSERT INTO public.admin_actions_log (admin_id, action, target_date, affected_count)
  VALUES (auth.uid(), 'close_day', CURRENT_DATE, v_count)
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true, 
    'message', format('Operação encerrada. %s reservas pendentes foram canceladas e a fila foi reiniciada.', v_count),
    'affected_count', v_count
  );
END; $$;
