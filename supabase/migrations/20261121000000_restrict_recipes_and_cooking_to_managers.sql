/*
  # Recetas, preparaciones y "Cocinar" solo para propietario y gerente

  1. Changes
  - nexora_is_manager(): true si el usuario autenticado es propietario o gerente.
  - Las tablas de recetas, preparaciones y opciones de productos solo las puede leer y editar un propietario o gerente.
    (La disponibilidad de la carta y el descuento de inventario al vender siguen funcionando para todos:
    son funciones internas que no dependen del permiso de quien las llama.)
  - cook_nexora_preparation (registrar una tanda) solo puede ejecutarla un propietario o gerente.

  2. Security
  - El resto del personal sigue viendo y moviendo el inventario (compras, mermas, conteos).
*/

CREATE OR REPLACE FUNCTION public.nexora_is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nexora_profiles p
    WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.nexora_is_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_is_manager() TO authenticated;

DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'nexora_product_recipes', 'nexora_preparations', 'nexora_preparation_lines', 'nexora_preparation_outputs',
    'nexora_option_choices', 'nexora_option_choice_lines', 'nexora_product_options', 'nexora_product_option_choices'
  ] LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Managers manage %s" ON public.%I FOR ALL TO authenticated USING (public.nexora_is_manager()) WITH CHECK (public.nexora_is_manager())', t, t);
  END LOOP;
END $$;

-- Registrar una tanda: solo propietario o gerente. La función original pasa a ser interna.
DO $$
BEGIN
  IF to_regprocedure('public.cook_nexora_preparation_internal(uuid, numeric)') IS NULL THEN
    ALTER FUNCTION public.cook_nexora_preparation(uuid, numeric) RENAME TO cook_nexora_preparation_internal;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.cook_nexora_preparation_internal(uuid, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cook_nexora_preparation(preparation_id_input uuid, batches_input numeric DEFAULT 1)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o el gerente puede registrar una tanda';
  END IF;
  RETURN public.cook_nexora_preparation_internal(preparation_id_input, batches_input);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cook_nexora_preparation(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cook_nexora_preparation(uuid, numeric) TO authenticated;
