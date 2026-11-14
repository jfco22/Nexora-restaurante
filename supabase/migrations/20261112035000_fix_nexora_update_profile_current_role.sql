/*
# Fix: "Mi perfil" cannot save changes

1. Problem
- update_nexora_profile declared a variable named `current_role`.
- `current_role` is also a reserved SQL function (it returns the database role, not a value from our table).
- When the function read that variable in an expression, PostgreSQL used the SQL function instead,
  so the comparison `role_input IS DISTINCT FROM current_role` compared the user's role
  (for example 'owner') against the database role and always failed.
- Result: every save from "Mi perfil" raised 'Tu rol lo asigna un administrador',
  and the app showed "No pudimos guardar los cambios".
- The final RETURN could also have returned the database role instead of the profile role.

2. Change
- Same function, same signature and same behavior, but the variable is renamed to `v_current_role`.
- Users can still only change their display name; their role is assigned by an administrator.

3. Security
- Still SECURITY DEFINER with a fixed search_path; the actor is derived from auth.uid().
- EXECUTE stays revoked from PUBLIC and anon, and granted to authenticated.

4. Notes
- No tables, columns or data change.
*/

CREATE OR REPLACE FUNCTION public.update_nexora_profile(display_name_input text, role_input text)
RETURNS TABLE(display_name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed_name text;
  v_current_role text;
BEGIN
  trimmed_name := btrim(display_name_input);

  IF char_length(trimmed_name) < 1 OR char_length(trimmed_name) > 80 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 1 y 80 caracteres';
  END IF;

  SELECT p.role INTO v_current_role
  FROM public.nexora_profiles p
  WHERE p.id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil';
  END IF;

  IF role_input IS DISTINCT FROM v_current_role THEN
    RAISE EXCEPTION 'Tu rol lo asigna un administrador';
  END IF;

  UPDATE public.nexora_profiles p
  SET display_name = trimmed_name, updated_at = now()
  WHERE p.id = auth.uid();

  RETURN QUERY SELECT trimmed_name, v_current_role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_nexora_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_nexora_profile(text, text) TO authenticated;
