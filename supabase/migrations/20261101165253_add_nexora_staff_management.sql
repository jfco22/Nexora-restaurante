/*
# Staff management: list team, change roles only as admin, safe default role

1. Summary of changes
- New default role for new profiles is 'waiter' (least privilege). It was 'owner', which made every new sign-up an owner.
- New function list_nexora_staff(): lists team members with their email. Only owners and managers can call it.
- New function set_nexora_staff_role(target_user_id, role_input): changes another member's role.
  - Owners and managers can use it. Only owners can assign or change the owner role.
  - Nobody can change their own role.
  - The last owner cannot be demoted.
- update_nexora_profile keeps its signature, but users can only change their display name.
  Their role must be assigned by an administrator.

2. Security
- Both new functions are SECURITY DEFINER with a fixed search_path and check auth.uid() against the caller's role.
- EXECUTE is revoked from PUBLIC and anon; only authenticated users can call them, and they still have to pass the role check.
- No table privileges or policies change.

3. Notes
- Existing profiles keep their roles. No data is deleted.
- Creating new login accounts is done by the create-staff-user edge function (it needs the server key).
*/

ALTER TABLE public.nexora_profiles ALTER COLUMN role SET DEFAULT 'waiter';

CREATE OR REPLACE FUNCTION public.list_nexora_staff()
RETURNS TABLE(user_id uuid, display_name text, role text, email text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT p.role INTO v_caller_role FROM public.nexora_profiles p WHERE p.id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'No tienes permiso para ver el equipo';
  END IF;

  RETURN QUERY
  SELECT p.id, p.display_name, p.role, u.email::text, p.created_at
  FROM public.nexora_profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_nexora_staff_role(target_user_id uuid, role_input text)
RETURNS TABLE(user_id uuid, new_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
  v_owner_count integer;
BEGIN
  SELECT p.role INTO v_caller_role FROM public.nexora_profiles p WHERE p.id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar roles';
  END IF;

  IF role_input NOT IN ('owner', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory', 'marketing', 'auditor') THEN
    RAISE EXCEPTION 'Rol no válido';
  END IF;

  IF target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol';
  END IF;

  SELECT p.role INTO v_target_role FROM public.nexora_profiles p WHERE p.id = target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el usuario';
  END IF;

  IF v_caller_role <> 'owner' AND (v_target_role = 'owner' OR role_input = 'owner') THEN
    RAISE EXCEPTION 'Solo un propietario puede asignar o cambiar el rol de propietario';
  END IF;

  IF v_target_role = 'owner' AND role_input <> 'owner' THEN
    SELECT count(*) INTO v_owner_count FROM public.nexora_profiles p WHERE p.role = 'owner';
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Debe quedar al menos un propietario';
    END IF;
  END IF;

  UPDATE public.nexora_profiles p
  SET role = role_input, updated_at = now()
  WHERE p.id = target_user_id;

  RETURN QUERY SELECT target_user_id, role_input;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_nexora_profile(display_name_input text, role_input text)
RETURNS TABLE(display_name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed_name text;
  current_role text;
BEGIN
  trimmed_name := btrim(display_name_input);

  IF char_length(trimmed_name) < 1 OR char_length(trimmed_name) > 80 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 1 y 80 caracteres';
  END IF;

  SELECT p.role INTO current_role
  FROM public.nexora_profiles p
  WHERE p.id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil';
  END IF;

  IF role_input IS DISTINCT FROM current_role THEN
    RAISE EXCEPTION 'Tu rol lo asigna un administrador';
  END IF;

  UPDATE public.nexora_profiles p
  SET display_name = trimmed_name, updated_at = now()
  WHERE p.id = auth.uid();

  RETURN QUERY SELECT trimmed_name, current_role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_nexora_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_nexora_staff() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_nexora_staff_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_nexora_staff_role(uuid, text) TO authenticated;
