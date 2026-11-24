/*
  # Cocina solo puede cocinar el Pico de gallo

  1. Changes
  - nexora_preparations.kitchen_can_cook: marca las preparaciones que el rol "cocina" puede ver y registrar.
    Solo "Pico de gallo" queda marcada (al crearla, o ya creada, se marca sola por su nombre).
  - El rol kitchen puede LEER únicamente las preparaciones marcadas (con sus insumos y resultados).
  - cook_nexora_preparation: propietario/gerente pueden cocinar cualquiera; cocina solo las marcadas.

  2. Security
  - Cocina no puede crear, editar ni borrar preparaciones, ni ver recetas de platos ni otras preparaciones.
  - Solo propietario/gerente cambian la marca (las políticas de escritura siguen siendo de gerencia).
*/

ALTER TABLE public.nexora_preparations ADD COLUMN IF NOT EXISTS kitchen_can_cook boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.nexora_is_kitchen()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.nexora_profiles p WHERE p.id = auth.uid() AND p.role = 'kitchen');
$$;

REVOKE EXECUTE ON FUNCTION public.nexora_is_kitchen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_is_kitchen() TO authenticated;

-- Marca automática por nombre del resultado: "Pico de gallo".
CREATE OR REPLACE FUNCTION public.nexora_mark_kitchen_preparation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.nexora_inventory_items i
    WHERE i.id = NEW.output_item_id AND lower(btrim(i.name)) = 'pico de gallo'
  ) THEN
    NEW.kitchen_can_cook := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nexora_mark_kitchen_preparation ON public.nexora_preparations;
CREATE TRIGGER nexora_mark_kitchen_preparation
BEFORE INSERT ON public.nexora_preparations
FOR EACH ROW EXECUTE FUNCTION public.nexora_mark_kitchen_preparation();

UPDATE public.nexora_preparations p
SET kitchen_can_cook = true
FROM public.nexora_inventory_items i
WHERE i.id = p.output_item_id AND lower(btrim(i.name)) = 'pico de gallo' AND NOT p.kitchen_can_cook;

-- Lectura para cocina: solo lo marcado.
DROP POLICY IF EXISTS "Kitchen reads cookable preparations" ON public.nexora_preparations;
CREATE POLICY "Kitchen reads cookable preparations" ON public.nexora_preparations
FOR SELECT TO authenticated
USING (kitchen_can_cook AND public.nexora_is_kitchen());

DROP POLICY IF EXISTS "Kitchen reads cookable preparation lines" ON public.nexora_preparation_lines;
CREATE POLICY "Kitchen reads cookable preparation lines" ON public.nexora_preparation_lines
FOR SELECT TO authenticated
USING (public.nexora_is_kitchen() AND EXISTS (
  SELECT 1 FROM public.nexora_preparations p WHERE p.id = preparation_id AND p.kitchen_can_cook));

DROP POLICY IF EXISTS "Kitchen reads cookable preparation outputs" ON public.nexora_preparation_outputs;
CREATE POLICY "Kitchen reads cookable preparation outputs" ON public.nexora_preparation_outputs
FOR SELECT TO authenticated
USING (public.nexora_is_kitchen() AND EXISTS (
  SELECT 1 FROM public.nexora_preparations p WHERE p.id = preparation_id AND p.kitchen_can_cook));

CREATE OR REPLACE FUNCTION public.cook_nexora_preparation(preparation_id_input uuid, batches_input numeric DEFAULT 1)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN
    IF NOT public.nexora_is_kitchen() THEN
      RAISE EXCEPTION 'Solo el propietario, el gerente o cocina puede registrar una tanda';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.nexora_preparations p WHERE p.id = preparation_id_input AND p.kitchen_can_cook) THEN
      RAISE EXCEPTION 'Cocina solo puede registrar el Pico de gallo';
    END IF;
  END IF;
  RETURN public.cook_nexora_preparation_internal(preparation_id_input, batches_input);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cook_nexora_preparation(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cook_nexora_preparation(uuid, numeric) TO authenticated;
