/*
# Add Nexora profile update function

1. Purpose
- Allow authenticated users to update their own display_name and role.
- The role column is protected: the existing UPDATE grant only covers display_name.
- This SECURITY DEFINER function lets a user change their own role safely.

2. New function
- `update_nexora_profile(display_name_input text, role_input text)`
- Validates display_name length (1-80 chars) and role against the CHECK constraint values.
- Updates only the caller's own profile row (matched by auth.uid()).
- Returns the updated display_name and role.

3. Security
- SECURITY DEFINER, SET search_path = public.
- Revoke EXECUTE from anon/public; grant to authenticated only.
- The function derives the actor from auth.uid(), never from a parameter.
*/

CREATE OR REPLACE FUNCTION public.update_nexora_profile(display_name_input text, role_input text)
RETURNS TABLE(display_name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed_name text;
BEGIN
  trimmed_name := btrim(display_name_input);

  IF char_length(trimmed_name) < 1 OR char_length(trimmed_name) > 80 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 1 y 80 caracteres';
  END IF;

  IF role_input NOT IN ('owner', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory', 'marketing', 'auditor') THEN
    RAISE EXCEPTION 'Rol no válido';
  END IF;

  UPDATE public.nexora_profiles
  SET display_name = trimmed_name,
      role = role_input,
      updated_at = now()
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil';
  END IF;

  RETURN QUERY
  SELECT trimmed_name, role_input;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_nexora_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_nexora_profile(text, text) TO authenticated;
