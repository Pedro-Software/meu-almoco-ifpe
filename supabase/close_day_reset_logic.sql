-- ============================================
-- ATUALIZAÇÃO: Funcionalidade de Encerrar/Limpar Dia
-- Exclusivo para superadmins. Limpa a fila do dia atual
-- e atualiza reservas 'reserved' para 'cancelled'.
-- Preserva histórico e reservas já 'confirmed'.
-- ============================================

-- 1. Criar tabela de auditoria para ações de admin se não existir
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

-- 2. Função de limpeza operacional do dia
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
