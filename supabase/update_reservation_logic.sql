-- ============================================
-- ATUALIZAÇÃO: Lógica de Reserva e Fila
-- ============================================

-- 1. Permitir reserva até as 11:30 do mesmo dia
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

  -- REGRA: Bloqueia se for antes de hoje ou se for hoje após 11:30
  IF p_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('error', 'Não é possível reservar para datas passadas');
  END IF;

  IF p_date = CURRENT_DATE AND LOCALTIME > '11:30:00'::TIME THEN
    RETURN jsonb_build_object('error', 'As reservas para hoje encerraram às 11:30');
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
      -- Se re-reservar, ganha uma nova data de criação (vai para o final da fila)
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

-- 2. Atribuir número de fila baseado na ordem de reserva (created_at)
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

  -- Atribuir número e token se ainda não tiver
  IF v_reservation.queue_number IS NULL THEN
    v_qr_token := encode(sha256(
      (v_user_id::text || CURRENT_DATE::text || v_reservation.id::text || random()::text)::bytea
    ), 'hex');

    -- CALCULA A POSIÇÃO: Conta quantos reservaram para hoje ANTES deste aluno (baseado no created_at)
    SELECT rank INTO v_queue_number
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rank
      FROM public.reservations
      WHERE reservation_date = CURRENT_DATE AND status IN ('reserved', 'confirmed')
    ) t
    WHERE t.id = v_reservation.id;

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
