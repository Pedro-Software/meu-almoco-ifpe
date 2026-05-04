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
