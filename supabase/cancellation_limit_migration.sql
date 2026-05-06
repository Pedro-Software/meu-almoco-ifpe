-- ============================================
-- MIGRAÇÃO: Limite de Cancelamentos (2x por dia) + Justificativa
--
-- Regras:
--   1. Máximo 2 cancelamentos por aluno por data
--   2. Justificativa obrigatória em todo cancelamento
--   3. Histórico salvo em cancellation_log
--   4. Validação no backend (SQL), não apenas frontend
--   5. Aluno pode re-reservar mesmo após 2 cancelamentos,
--      mas não pode mais cancelar para aquele dia
--
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

-- 1. Tabela de histórico de cancelamentos
CREATE TABLE IF NOT EXISTS public.cancellation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  justification TEXT NOT NULL,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cancellation_log ENABLE ROW LEVEL SECURITY;

-- Aluno pode ver seus próprios cancelamentos
DO $$ BEGIN
  CREATE POLICY "Alunos podem ver seus cancelamentos"
    ON public.cancellation_log FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admins podem ver todos
DO $$ BEGIN
  CREATE POLICY "Admins podem ver todos cancelamentos"
    ON public.cancellation_log FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Índice para consulta rápida de contagem
CREATE INDEX IF NOT EXISTS idx_cancellation_log_user_date
  ON public.cancellation_log (user_id, reservation_date);

-- ============================================
-- 2. Nova assinatura de toggle_reservation
--    Aceita p_justification (TEXT, opcional)
--    - Obrigatório quando a ação for cancelamento
--    - Ignorado quando a ação for reserva/re-reserva
-- ============================================

-- IMPORTANTE: Dropar a assinatura antiga (1 argumento) para evitar ambiguidade
-- do PostgreSQL entre toggle_reservation(date) e toggle_reservation(date, text)
DROP FUNCTION IF EXISTS public.toggle_reservation(DATE);

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

      -- Cancelar a reserva
      UPDATE public.reservations SET status = 'cancelled', qr_token = NULL, queue_number = NULL
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
    -- NOVA RESERVA (justificativa NÃO é necessária)
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
-- 3. Atualizar get_week_reservations para incluir contagem de cancelamentos
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
  v_cancellation_counts jsonb;
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

  -- Contagem de cancelamentos por data na semana
  SELECT COALESCE(jsonb_object_agg(
    cl.reservation_date::text, cl.cnt
  ), '{}'::jsonb) INTO v_cancellation_counts
  FROM (
    SELECT reservation_date, COUNT(*) AS cnt
    FROM public.cancellation_log
    WHERE user_id = v_user_id
      AND reservation_date >= p_week_start
      AND reservation_date < p_week_start + INTERVAL '7 days'
    GROUP BY reservation_date
  ) cl;

  RETURN jsonb_build_object(
    'success', true,
    'reservations', v_reservations,
    'blocked_until', v_blocked_until,
    'cancellation_counts', v_cancellation_counts
  );
END; $$;
