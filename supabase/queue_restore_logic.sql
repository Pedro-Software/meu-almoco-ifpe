-- ============================================
-- ATUALIZAÇÃO: Restauração de Posição na Fila
-- Regra: Se o aluno cancelar e reservar novamente para o mesmo dia,
-- o sistema tentará restaurar o número antigo dele se a fila ainda
-- não tiver passado daquele número. Caso contrário, vai pro fim.
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
  v_current_queue_number INTEGER;
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
  -- Deve vir ANTES da contagem para evitar race condition na cota de 500
  PERFORM 1 FROM public.queue_state WHERE id = 1 FOR UPDATE;

  -- Verificar limite de 500 reservas por dia (agora sob lock)
  SELECT max_tickets INTO v_max_tickets FROM public.queue_state WHERE id = 1;
  
  SELECT COUNT(*) INTO v_total_reservations
  FROM public.reservations
  WHERE reservation_date = p_date AND status IN ('reserved', 'confirmed');

  -- Buscar reserva existente do usuário para essa data
  SELECT * INTO v_existing FROM public.reservations
  WHERE user_id = v_user_id AND reservation_date = p_date;

  IF FOUND THEN
    IF v_existing.status = 'reserved' THEN
      -- CANCELAR: preserva queue_number para histórico (evita reaproveitamento)
      UPDATE public.reservations SET status = 'cancelled', qr_token = NULL
      WHERE id = v_existing.id;
      RETURN jsonb_build_object('success', true, 'action', 'cancelled',
        'message', format('Reserva cancelada para %s', to_char(p_date, 'DD/MM')));

    ELSIF v_existing.status = 'cancelled' THEN
      -- RE-RESERVAR: verifica cota
      IF v_total_reservations >= v_max_tickets THEN
        RETURN jsonb_build_object('error', format('Cota diária atingida (%s reservas)', v_max_tickets));
      END IF;

      -- REGRA: Restaura o número se a fila não tiver passado dele
      IF v_existing.queue_number IS NOT NULL THEN
        IF p_date > CURRENT_DATE THEN
          -- Reserva para dia futuro: a fila do dia ainda não começou
          v_next_queue_number := v_existing.queue_number;
        ELSE
          -- Reserva para hoje: verificar onde a fila está
          SELECT current_number INTO v_current_queue_number FROM public.queue_state WHERE id = 1;
          IF v_existing.queue_number > COALESCE(v_current_queue_number, 0) THEN
            -- A fila ainda não chegou no número dele, pode restaurar
            v_next_queue_number := v_existing.queue_number;
          ELSE
            -- A fila já passou dele, vai para o final
            SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next_queue_number
            FROM public.reservations
            WHERE reservation_date = p_date;
          END IF;
        END IF;
      ELSE
        -- Se por algum motivo o número antigo for nulo, vai para o final
        SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next_queue_number
        FROM public.reservations
        WHERE reservation_date = p_date;
      END IF;

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
    -- NOVA RESERVA: verifica cota e gera queue_number
    IF v_total_reservations >= v_max_tickets THEN
      RETURN jsonb_build_object('error', format('Cota diária atingida (%s reservas)', v_max_tickets));
    END IF;

    -- MAX inclui queue_numbers de cancelados (preservados), garantindo unicidade
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next_queue_number
    FROM public.reservations
    WHERE reservation_date = p_date;

    INSERT INTO public.reservations (user_id, reservation_date, status, queue_number)
    VALUES (v_user_id, p_date, 'reserved', v_next_queue_number);

    RETURN jsonb_build_object('success', true, 'action', 'reserved',
      'message', format('Reserva confirmada para %s (Fila #%s)', to_char(p_date, 'DD/MM'), v_next_queue_number),
      'queue_number', v_next_queue_number);
  END IF;
END; $$;
