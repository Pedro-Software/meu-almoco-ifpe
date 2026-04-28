-- ============================================
-- MIGRAÇÃO: Sistema de Super Admin
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

-- 1. Adicionar coluna is_super_admin na tabela profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Remover política RLS problemática (causa recursão infinita!)
DROP POLICY IF EXISTS "Super admins podem ver perfis de admins" ON public.profiles;

-- 3. Setar phbs8@discente.ifpe.edu.br como super admin
UPDATE public.profiles
SET role = 'admin', is_super_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'phbs8@discente.ifpe.edu.br');

-- 4. RPC: Verificar se o usuário logado é admin (bypassa RLS)
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
    'is_admin', v_profile.role = 'admin',
    'is_super_admin', v_profile.is_super_admin
  );
END;
$$;

-- 5. RPC: Listar admins (apenas super admin pode chamar)
CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_admins jsonb;
BEGIN
  -- Verificar se é super admin
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_super_admin = true
  ) INTO v_is_super;

  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'Apenas super admins podem listar administradores');
  END IF;

  -- Buscar todos os admins com seus emails
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'email', u.email,
      'full_name', p.full_name,
      'is_super_admin', p.is_super_admin,
      'created_at', p.created_at
    ) ORDER BY p.is_super_admin DESC, p.full_name ASC
  ), '[]'::jsonb) INTO v_admins
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'admin';

  RETURN jsonb_build_object(
    'success', true,
    'admins', v_admins
  );
END;
$$;

-- 6. RPC: Gerenciar admins (adicionar/remover) — apenas super admin
CREATE OR REPLACE FUNCTION public.manage_admin(p_email TEXT, p_action TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_target_user_id UUID;
  v_target_profile RECORD;
  v_total_admins INTEGER;
BEGIN
  -- Verificar se é super admin
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_super_admin = true
  ) INTO v_is_super;

  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'Apenas super admins podem gerenciar administradores');
  END IF;

  -- Validar ação
  IF p_action NOT IN ('add', 'remove') THEN
    RETURN jsonb_build_object('error', 'Ação inválida. Use "add" ou "remove"');
  END IF;

  -- Validar email institucional
  IF NOT (p_email LIKE '%@discente.ifpe.edu.br' OR p_email LIKE '%@ifpe.edu.br') THEN
    RETURN jsonb_build_object('error', 'Apenas emails institucionais IFPE são aceitos (@discente.ifpe.edu.br ou @ifpe.edu.br)');
  END IF;

  -- Buscar usuário pelo email
  SELECT id INTO v_target_user_id
  FROM auth.users
  WHERE email = p_email;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado. O email precisa estar cadastrado no sistema.');
  END IF;

  -- Não permitir ações em si mesmo
  IF v_target_user_id = auth.uid() THEN
    RETURN jsonb_build_object('error', 'Você não pode alterar seu próprio papel');
  END IF;

  -- Buscar perfil do alvo
  SELECT * INTO v_target_profile
  FROM public.profiles
  WHERE id = v_target_user_id;

  IF v_target_profile IS NULL THEN
    RETURN jsonb_build_object('error', 'Perfil do usuário não encontrado');
  END IF;

  -- === ADICIONAR ADMIN ===
  IF p_action = 'add' THEN
    -- Verificar se já é admin
    IF v_target_profile.role = 'admin' THEN
      RETURN jsonb_build_object('error', format('%s já é administrador', p_email));
    END IF;

    -- Verificar limite de 50 admins
    SELECT COUNT(*) INTO v_total_admins
    FROM public.profiles
    WHERE role = 'admin';

    IF v_total_admins >= 50 THEN
      RETURN jsonb_build_object('error', 'Limite máximo de 50 administradores atingido');
    END IF;

    -- Promover a admin
    UPDATE public.profiles
    SET role = 'admin'
    WHERE id = v_target_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', format('%s foi promovido a administrador', p_email)
    );
  END IF;

  -- === REMOVER ADMIN ===
  IF p_action = 'remove' THEN
    -- Verificar se é admin
    IF v_target_profile.role != 'admin' THEN
      RETURN jsonb_build_object('error', format('%s não é administrador', p_email));
    END IF;

    -- Não permitir remover super admins
    IF v_target_profile.is_super_admin THEN
      RETURN jsonb_build_object('error', 'Não é possível remover um super administrador');
    END IF;

    -- Rebaixar para estudante
    UPDATE public.profiles
    SET role = 'student'
    WHERE id = v_target_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', format('%s foi removido dos administradores', p_email)
    );
  END IF;

  RETURN jsonb_build_object('error', 'Ação não processada');
END;
$$;
