/*
# Restrict owner role assignment

1. Problem
- update_nexora_profile let any signed-in user set their own role to owner.

2. Change
- Assigning the owner role now requires the caller to already be an owner.
- Other roles can still be chosen freely, as before.

3. Security
- Function remains SECURITY DEFINER with a fixed search path, executable by authenticated only.
*/

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

  IF role_input NOT IN ('owner', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory', 'marketing', 'auditor') THEN
    RAISE EXCEPTION 'Rol no válido';
  END IF;

  SELECT p.role INTO current_role
  FROM public.nexora_profiles p
  WHERE p.id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil';
  END IF;

  IF role_input = 'owner' AND current_role <> 'owner' THEN
    RAISE EXCEPTION 'Solo un propietario puede asignar el rol de propietario';
  END IF;

  UPDATE public.nexora_profiles
  SET display_name = trimmed_name,
      role = role_input,
      updated_at = now()
  WHERE id = auth.uid();

  RETURN QUERY SELECT trimmed_name, role_input;
END;
$$;
