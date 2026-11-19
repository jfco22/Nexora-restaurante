/*
  # Preparaciones con varios resultados (ej. una olla de birria da caldo Y carne)

  1. New table
  - nexora_preparation_outputs: resultados adicionales de una preparación (el principal sigue
    siendo nexora_preparations.output_item_id con yield_quantity).

  2. Function change
  - cook_nexora_preparation ahora también suma los resultados adicionales.
  - El costo de los ingredientes se reparte entre todos los resultados por cantidad,
    solo cuando todos están en la misma unidad; si no, el costo va al resultado principal.

  3. Security
  - RLS activa, personal autenticado puede leer y editar (igual que el resto de la preparación).
*/

CREATE TABLE IF NOT EXISTS public.nexora_preparation_outputs (
  preparation_id uuid NOT NULL REFERENCES public.nexora_preparations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.nexora_inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (preparation_id, item_id)
);

CREATE INDEX IF NOT EXISTS nexora_preparation_outputs_item_idx ON public.nexora_preparation_outputs (item_id);

ALTER TABLE public.nexora_preparation_outputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_preparation_outputs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nexora_preparation_outputs TO authenticated;

DROP POLICY IF EXISTS "Staff can read preparation outputs" ON public.nexora_preparation_outputs;
CREATE POLICY "Staff can read preparation outputs" ON public.nexora_preparation_outputs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Staff can add preparation outputs" ON public.nexora_preparation_outputs;
CREATE POLICY "Staff can add preparation outputs" ON public.nexora_preparation_outputs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Staff can edit preparation outputs" ON public.nexora_preparation_outputs;
CREATE POLICY "Staff can edit preparation outputs" ON public.nexora_preparation_outputs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Staff can remove preparation outputs" ON public.nexora_preparation_outputs;
CREATE POLICY "Staff can remove preparation outputs" ON public.nexora_preparation_outputs FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.cook_nexora_preparation(
  preparation_id_input uuid,
  batches_input numeric DEFAULT 1
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prep public.nexora_preparations%ROWTYPE;
  v_output_name text;
  v_output_unit text;
  v_output_active boolean;
  v_line record;
  v_extra record;
  v_needed numeric(12,3);
  v_produced numeric(12,3);
  v_cost numeric := 0;
  v_note text;
  v_new_stock numeric(12,3);
  v_line_count integer := 0;
  v_total_yield numeric := 0;
  v_same_unit boolean := true;
  v_unit_cost integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para cocinar';
  END IF;

  IF batches_input IS NULL OR batches_input <= 0 OR batches_input > 100 THEN
    RAISE EXCEPTION 'El número de tandas no es válido';
  END IF;

  SELECT p.* INTO v_prep
  FROM public.nexora_preparations p
  WHERE p.id = preparation_id_input AND p.is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La preparación no existe o está desactivada';
  END IF;

  SELECT i.name, i.unit, i.is_active INTO v_output_name, v_output_unit, v_output_active
  FROM public.nexora_inventory_items i
  WHERE i.id = v_prep.output_item_id
  FOR UPDATE;

  IF v_output_active IS NOT TRUE THEN
    RAISE EXCEPTION 'El insumo "%" está desactivado', v_output_name;
  END IF;

  v_total_yield := v_prep.yield_quantity;

  -- Resultados adicionales: deben existir, estar activos y no ser ingredientes de la misma preparación.
  FOR v_extra IN
    SELECT o.item_id, o.quantity, i.name, i.unit, i.is_active
    FROM public.nexora_preparation_outputs o
    JOIN public.nexora_inventory_items i ON i.id = o.item_id
    WHERE o.preparation_id = v_prep.id
    ORDER BY i.name
    FOR UPDATE OF i
  LOOP
    IF v_extra.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'El insumo "%" está desactivado', v_extra.name;
    END IF;
    IF v_extra.unit IS DISTINCT FROM v_output_unit THEN
      v_same_unit := false;
    END IF;
    v_total_yield := v_total_yield + v_extra.quantity;
  END LOOP;

  -- Bloquea los insumos crudos y revisa que alcancen antes de tocar nada.
  FOR v_line IN
    SELECT l.item_id, l.quantity, i.name, i.current_stock, i.unit_cost_cop, i.is_active
    FROM public.nexora_preparation_lines l
    JOIN public.nexora_inventory_items i ON i.id = l.item_id
    WHERE l.preparation_id = v_prep.id
    ORDER BY i.name
    FOR UPDATE OF i
  LOOP
    v_line_count := v_line_count + 1;
    IF v_line.item_id = v_prep.output_item_id
       OR EXISTS (SELECT 1 FROM public.nexora_preparation_outputs o WHERE o.preparation_id = v_prep.id AND o.item_id = v_line.item_id) THEN
      RAISE EXCEPTION 'La preparación no puede gastar su propio resultado';
    END IF;
    IF v_line.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'El insumo "%" está desactivado', v_line.name;
    END IF;
    v_needed := (v_line.quantity * batches_input)::numeric(12,3);
    IF v_line.current_stock < v_needed THEN
      RAISE EXCEPTION 'Falta "%": hay % y se necesitan %. Registra la compra o el conteo en Inventario.',
        v_line.name, v_line.current_stock, v_needed;
    END IF;
  END LOOP;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'La preparación no tiene insumos';
  END IF;

  v_note := 'Cocinar: ' || v_output_name || ' x' || rtrim(rtrim(to_char(batches_input, 'FM999990.00'), '0'), '.') || ' tanda(s)';

  FOR v_line IN
    SELECT l.item_id, l.quantity, i.unit_cost_cop
    FROM public.nexora_preparation_lines l
    JOIN public.nexora_inventory_items i ON i.id = l.item_id
    WHERE l.preparation_id = v_prep.id
  LOOP
    v_needed := (v_line.quantity * batches_input)::numeric(12,3);
    v_cost := v_cost + v_line.quantity * v_line.unit_cost_cop;

    UPDATE public.nexora_inventory_items i
    SET current_stock = i.current_stock - v_needed
    WHERE i.id = v_line.item_id;

    INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, note)
    VALUES (v_line.item_id, 'consumption', -v_needed, v_note);
  END LOOP;

  -- Costo por unidad: se reparte entre todos los resultados si comparten unidad; si no, va al principal.
  IF v_same_unit THEN
    v_unit_cost := round(v_cost / v_total_yield)::integer;
  ELSE
    v_unit_cost := round(v_cost / v_prep.yield_quantity)::integer;
  END IF;

  v_produced := (v_prep.yield_quantity * batches_input)::numeric(12,3);
  UPDATE public.nexora_inventory_items i
  SET current_stock = i.current_stock + v_produced,
      unit_cost_cop = CASE WHEN v_unit_cost > 0 THEN v_unit_cost ELSE i.unit_cost_cop END
  WHERE i.id = v_prep.output_item_id
  RETURNING i.current_stock INTO v_new_stock;

  INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, note)
  VALUES (v_prep.output_item_id, 'adjustment', v_produced, v_note);

  FOR v_extra IN
    SELECT o.item_id, o.quantity
    FROM public.nexora_preparation_outputs o
    WHERE o.preparation_id = v_prep.id
  LOOP
    v_produced := (v_extra.quantity * batches_input)::numeric(12,3);
    UPDATE public.nexora_inventory_items i
    SET current_stock = i.current_stock + v_produced,
        unit_cost_cop = CASE WHEN v_same_unit AND v_unit_cost > 0 THEN v_unit_cost ELSE i.unit_cost_cop END
    WHERE i.id = v_extra.item_id;

    INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, note)
    VALUES (v_extra.item_id, 'adjustment', v_produced, v_note);
  END LOOP;

  RETURN v_new_stock;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cook_nexora_preparation(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cook_nexora_preparation(uuid, numeric) TO authenticated;
