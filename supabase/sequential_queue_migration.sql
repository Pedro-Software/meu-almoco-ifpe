-- ============================================
-- MIGRAÇÃO: Fila Sequencial (Número "morre" ao cancelar)
--
-- Antes: Ao cancelar, o queue_number era setado NULL e
--        podia ser reutilizado por outro aluno (gap-filling).
-- Agora: O queue_number é preservado no registro cancelado.
--        Novos alunos sempre recebem MAX(queue_number) + 1,
--        garantindo FIFO justo (quem reservou primeiro tem
--        prioridade real na fila).
--
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

CREATE OR REPLACE FUNCTION public.toggle_reservation(p_date DATE, p_justification TEXT DEFAULT NULL)
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
  v_cancel_count INTEGER;
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
      -- === CANCELAMENTO ===

      -- Verificar limite de 2 cancelamentos por aluno por data
      SELECT COUNT(*) INTO v_cancel_count
      FROM public.cancellation_log
      WHERE user_id = v_user_id AND reservation_date = p_date;

      IF v_cancel_count >= 2 THEN
        RETURN jsonb_build_object('error', 'Você já atingiu o limite de 2 cancelamentos para esta data. Não é possível cancelar novamente.');
      END IF;

      -- Justificativa obrigatória
      IF p_justification IS NULL OR TRIM(p_justification) = '' THEN
        RETURN jsonb_build_object('error', 'É necessário informar uma justificativa para cancelar a reserva.');
      END IF;

      -- Cancelar a reserva (queue_number é preservado para que o número "morra" e não seja reutilizado)
      UPDATE public.reservations SET status = 'cancelled', qr_token = NULL
      WHERE id = v_existing.id;

      -- Registrar no histórico de cancelamentos
      INSERT INTO public.cancellation_log (user_id, reservation_date, justification)
      VALUES (v_user_id, p_date, TRIM(p_justification));

      RETURN jsonb_build_object('success', true, 'action', 'cancelled',
        'message', format('Reserva cancelada para %s', to_char(p_date, 'DD/MM')),
        'cancellations_used', v_cancel_count + 1);

    ELSIF v_existing.status = 'cancelled' THEN
      -- RE-RESERVAR (justificativa NÃO é necessária para re-reservar)
      IF v_total_reservations >= v_max_tickets THEN
        RETURN jsonb_build_object('error', format('Cota diária atingida (%s reservas)', v_max_tickets));
      END IF;

      -- REGRA: Número sequencial (MAX+1). Números cancelados "morrem" e não são reutilizados.
      SELECT GREATEST(COALESCE(MAX(queue_number), 0) + 1, v_start_val) INTO v_next_queue_number
      FROM public.reservations
      WHERE reservation_date = p_date;

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
    -- NOVA RESERVA (justificativa NÃO é necessária)
    IF v_total_reservations >= v_max_tickets THEN
      RETURN jsonb_build_object('error', format('Cota diária atingida (%s reservas)', v_max_tickets));
    END IF;

    -- REGRA: Número sequencial (MAX+1). Números cancelados "morrem" e não são reutilizados.
    SELECT GREATEST(COALESCE(MAX(queue_number), 0) + 1, v_start_val) INTO v_next_queue_number
    FROM public.reservations
    WHERE reservation_date = p_date;

    INSERT INTO public.reservations (user_id, reservation_date, status, queue_number)
    VALUES (v_user_id, p_date, 'reserved', v_next_queue_number);

    RETURN jsonb_build_object('success', true, 'action', 'reserved',
      'message', format('Reserva confirmada para %s (Fila #%s)', to_char(p_date, 'DD/MM'), v_next_queue_number),
      'queue_number', v_next_queue_number);
  END IF;
END; $$;
