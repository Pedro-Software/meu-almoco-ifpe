-- ============================================
-- MIGRAÇÃO: Permitir Nutricionista no Admin
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

-- 1. Atualizar check_admin_role para o Frontend
CREATE OR REPLACE FUNCTION public.check_admin_role()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  SELECT role, is_super_admin INTO v_profile
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_admin', false, 'is_super_admin', false);
  END IF;

  RETURN jsonb_build_object(
    'is_admin', v_profile.role IN ('admin', 'nutricionista'),
    'is_super_admin', v_profile.is_super_admin
  );
END;
$$;

-- 2. Atualizar get_waiting_reservations para permitir nutricionistas
CREATE OR REPLACE FUNCTION public.get_waiting_reservations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_tickets jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutricionista') THEN RETURN '[]'::jsonb; END IF;

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

-- 3. Atualizar get_admin_reservation_stats para permitir nutricionistas
CREATE OR REPLACE FUNCTION public.get_admin_reservation_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_avg_duration_minutes NUMERIC;
  v_currently_inside INTEGER;
  v_skipped_count INTEGER;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutricionista') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

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

-- 4. Atualizar manage_admin para usar 'nutricionista'
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

  IF p_role NOT IN ('admin', 'nutricionista') THEN
    RETURN jsonb_build_object('error', 'Cargo inválido. Use "admin" ou "nutricionista"');
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

-- 5. Atualizar list_admins para incluir nutricionistas corretamente
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
  WHERE p.role IN ('admin', 'nutricionista');

  RETURN jsonb_build_object('success', true, 'admins', v_admins);
END;
$$;
