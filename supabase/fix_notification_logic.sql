-- ============================================
-- MIGRAÇÃO: Correção da lógica de notificação (À prova de pulos/cancelamentos)
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

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
  -- Verificar se o usuário é administrador
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  -- Buscar a reserva pelo QR token
  SELECT * INTO v_reservation FROM public.reservations WHERE qr_token = p_qr_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('type', 'error', 'message', 'QR Code inválido'); END IF;

  -- Validações básicas de data e status
  IF v_reservation.reservation_date != CURRENT_DATE THEN
    RETURN jsonb_build_object('type', 'error', 'message', 'Reserva de outro dia');
  END IF;

  IF v_reservation.status = 'confirmed' THEN
    RETURN jsonb_build_object('type', 'error', 'message', 'Reserva já confirmada');
  END IF;

  IF v_reservation.status != 'reserved' THEN
    RETURN jsonb_build_object('type', 'error', 'message', 'Reserva cancelada ou inválida');
  END IF;

  -- Confirmar a reserva, remover o token e definir data/hora do check-in
  UPDATE public.reservations SET status = 'confirmed', qr_token = NULL, checked_in_at = now()
  WHERE id = v_reservation.id;

  -- Buscar o número atual para fins de log, caso necessário
  SELECT current_number INTO v_current_number FROM public.queue_state WHERE id = 1;

  -- Atualizar o state da fila no painel geral para o maior número recém lido
  UPDATE public.queue_state SET current_number = GREATEST(current_number, v_reservation.queue_number) WHERE id = 1;

  -- =========================================================================
  -- LÓGICA DE NOTIFICAÇÃO (CORRIGIDA)
  -- Buscar a 5ª pessoa que está atualmente esperando na fila
  -- Ignora quem cancelou ou foi pulado, pois só procura quem tem status = 'reserved'
  -- =========================================================================
  SELECT r.user_id, r.queue_number INTO v_notify_user_id, v_notify_queue_number
  FROM public.reservations r
  WHERE r.reservation_date = CURRENT_DATE
    AND r.status = 'reserved'
    AND r.queue_number > v_reservation.queue_number
  ORDER BY r.queue_number ASC
  OFFSET 4 LIMIT 1;

  -- Se encontrou a 5ª pessoa na fila, tenta resgatar a Push Subscription dela
  IF v_notify_user_id IS NOT NULL THEN
    SELECT ps.subscription INTO v_notify_subscription
    FROM public.push_subscriptions ps WHERE ps.user_id = v_notify_user_id;
  END IF;

  -- Retornar os dados (se houver subscription, retorna o notify também)
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

-- =========================================================================
-- LÓGICA DO PAINEL PÚBLICO (CORREÇÃO DE CONTAGEM)
-- Apenas conta pessoas que realmente já têm um número de fila gerado
-- =========================================================================
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

  -- Correção: Só contar para a fila quem já tem queue_number
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
