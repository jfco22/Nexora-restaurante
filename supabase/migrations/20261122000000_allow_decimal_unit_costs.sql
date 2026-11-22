/*
  # Costos por unidad con decimales (precio por gramo)

  El costo por unidad se guardaba en pesos enteros: para insumos en gramos (ej. $26,8 por gramo) se perdía precisión.

  1. Changes
  - nexora_inventory_items.unit_cost_cop y nexora_inventory_movements.unit_cost_cop pasan a numeric(14,4).
  - register_nexora_inventory_movement, import_nexora_inventory y cook_nexora_preparation_internal reciben/calculan el costo con decimales.
  - Los valores existentes no cambian (los enteros siguen siendo los mismos números).
*/

ALTER TABLE public.nexora_inventory_items ALTER COLUMN unit_cost_cop TYPE numeric(14,4);
ALTER TABLE public.nexora_inventory_movements ALTER COLUMN unit_cost_cop TYPE numeric(14,4);

DROP FUNCTION IF EXISTS public.register_nexora_inventory_movement(uuid, text, numeric, integer, text);

CREATE OR REPLACE FUNCTION public.register_nexora_inventory_movement(
  item_id_input uuid,
  kind_input text,
  quantity_input numeric,
  unit_cost_input numeric DEFAULT NULL,
  note_input text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active boolean;
  v_delta numeric(12,3);
  v_new_stock numeric(12,3);
  v_note text;
  v_cost numeric(14,4);
BEGIN
  IF kind_input NOT IN ('purchase', 'waste', 'adjustment') THEN
    RAISE EXCEPTION 'Tipo de movimiento no válido';
  END IF;

  IF quantity_input IS NULL OR quantity_input = 0 OR abs(quantity_input) > 1000000 THEN
    RAISE EXCEPTION 'La cantidad no es válida';
  END IF;

  IF kind_input IN ('purchase', 'waste') AND quantity_input < 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;

  IF kind_input = 'purchase' AND (unit_cost_input IS NULL OR unit_cost_input < 0 OR unit_cost_input > 100000000) THEN
    RAISE EXCEPTION 'Indica el costo unitario de la compra';
  END IF;

  v_cost := round(unit_cost_input, 4);
  v_note := NULLIF(btrim(note_input), '');

  SELECT i.is_active INTO v_active
  FROM public.nexora_inventory_items i
  WHERE i.id = item_id_input
  FOR UPDATE;

  IF NOT FOUND OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'El insumo no existe o está desactivado';
  END IF;

  v_delta := CASE kind_input
    WHEN 'waste' THEN -quantity_input
    ELSE quantity_input
  END;

  UPDATE public.nexora_inventory_items i
  SET current_stock = i.current_stock + v_delta,
      unit_cost_cop = CASE WHEN kind_input = 'purchase' THEN v_cost ELSE i.unit_cost_cop END
  WHERE i.id = item_id_input
  RETURNING i.current_stock INTO v_new_stock;

  INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, unit_cost_cop, note)
  VALUES (
    item_id_input,
    kind_input,
    v_delta,
    CASE WHEN kind_input = 'purchase' THEN v_cost ELSE NULL END,
    v_note
  );

  RETURN v_new_stock;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_nexora_inventory_movement(uuid, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_nexora_inventory_movement(uuid, text, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_nexora_inventory(payload jsonb)
RETURNS TABLE(created integer, updated integer, skipped integer, details jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_rows jsonb;
  v_row jsonb;
  v_name text;
  v_unit text;
  v_storage text;
  v_min_stock numeric;
  v_current_stock numeric;
  v_unit_cost numeric;
  v_purchase_qty numeric;
  v_existing_id uuid;
  v_existing_stock numeric;
  v_diff numeric;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_details jsonb := '[]'::jsonb;
  v_skip_reason text;
BEGIN
  SELECT p.role INTO v_caller_role FROM public.nexora_profiles p WHERE p.id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'No tienes permiso para importar inventario';
  END IF;

  v_rows := payload->'items';
  IF v_rows IS NULL OR jsonb_array_length(v_rows) = 0 THEN
    RAISE EXCEPTION 'El archivo no tiene filas para importar';
  END IF;

  FOR v_row IN SELECT jsonb_array_elements(v_rows)
  LOOP
    v_name := btrim(v_row->>'name');
    v_unit := lower(btrim(v_row->>'unit'));
    v_storage := lower(btrim(v_row->>'storage_location'));
    v_skip_reason := NULL;

    IF v_name IS NULL OR v_name = '' THEN
      v_skip_reason := 'Falta el nombre del insumo';
    ELSIF v_unit NOT IN ('g', 'kg', 'ml', 'l', 'unidad') THEN
      v_skip_reason := 'Unidad no válida (debe ser g, kg, ml, l o unidad)';
    ELSIF v_storage NOT IN ('nevera', 'estanteria', 'bodega') THEN
      v_skip_reason := 'Ubicación no válida (debe ser nevera, estanteria o bodega)';
    END IF;

    v_min_stock := COALESCE((v_row->>'min_stock')::numeric, 0);
    v_current_stock := COALESCE((v_row->>'current_stock')::numeric, 0);
    v_unit_cost := COALESCE((v_row->>'unit_cost_cop')::numeric, 0);
    v_purchase_qty := NULLIF(v_row->>'purchase_quantity', '')::numeric;

    IF v_current_stock < 0 THEN
      v_skip_reason := 'El stock no puede ser negativo';
    END IF;
    IF v_min_stock < 0 THEN
      v_skip_reason := 'El stock mínimo no puede ser negativo';
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('name', v_name, 'reason', v_skip_reason));
      CONTINUE;
    END IF;

    SELECT id, current_stock INTO v_existing_id, v_existing_stock
    FROM public.nexora_inventory_items
    WHERE lower(name) = lower(v_name)
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.nexora_inventory_items (name, unit, storage_location, min_stock, current_stock, unit_cost_cop, is_active)
      VALUES (v_name, v_unit, v_storage, v_min_stock, v_current_stock, v_unit_cost, true)
      RETURNING id INTO v_existing_id;

      v_diff := v_current_stock;
      v_created := v_created + 1;
    ELSE
      v_diff := v_current_stock - v_existing_stock;
      UPDATE public.nexora_inventory_items
      SET name = v_name,
          unit = v_unit,
          storage_location = v_storage,
          min_stock = v_min_stock,
          current_stock = v_current_stock,
          unit_cost_cop = v_unit_cost,
          is_active = true,
          updated_at = now()
      WHERE id = v_existing_id;

      v_updated := v_updated + 1;
    END IF;

    IF v_diff <> 0 THEN
      INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, note, created_by)
      VALUES (v_existing_id, 'adjustment', v_diff, 'Importación desde Excel', auth.uid());
    END IF;

    IF v_purchase_qty IS NOT NULL AND v_purchase_qty > 0 THEN
      INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, unit_cost_cop, note, created_by)
      VALUES (v_existing_id, 'purchase', v_purchase_qty, v_unit_cost, 'Compra registrada en importación', auth.uid());
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_created, v_updated, v_skipped, v_details;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_nexora_inventory(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_nexora_inventory(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cook_nexora_preparation_internal(
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
  v_unit_cost numeric;
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
    v_unit_cost := round(v_cost / v_total_yield, 4);
  ELSE
    v_unit_cost := round(v_cost / v_prep.yield_quantity, 4);
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

REVOKE EXECUTE ON FUNCTION public.cook_nexora_preparation_internal(uuid, numeric) FROM PUBLIC, anon, authenticated;
