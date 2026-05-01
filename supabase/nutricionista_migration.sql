-- ============================================
-- MIGRAÇÃO: Adicionar Cargo de Nutricionista
-- Cole TUDO isso no SQL Editor do Supabase e clique "Run"
-- ============================================

-- 1. Remover a restrição (check constraint) existente na coluna role
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 2. Adicionar a nova restrição permitindo 'nutricionista'
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('student', 'admin', 'nutricionista'));

-- 3. (Opcional) Função helper para promover a nutricionista
CREATE OR REPLACE FUNCTION public.promote_to_nutricionista(p_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Buscar usuário pelo email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = p_email;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado. O email precisa estar cadastrado no sistema.');
  END IF;

  -- Promover a nutricionista
  UPDATE public.profiles
  SET role = 'nutricionista'
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', format('%s foi promovido a nutricionista', p_email)
  );
END;
$$;
