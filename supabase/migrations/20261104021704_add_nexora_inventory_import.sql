/*
# Import inventory from spreadsheet

1. Summary
- New function import_nexora_inventory(payload jsonb) that lets an owner or manager import inventory items from a spreadsheet.
- Each row can create a new insumo or update an existing one (matched by name, case-insensitive).
- For each row the function updates the insumo's unit, storage location, minimum stock, and unit cost, and sets the current stock to the value in the file (conteo físico).
- Records an 'adjustment' movement for the difference between the previous stock and the new stock, and a 'purchase' movement if a purchase quantity is included.
- Returns a summary: how many items were created, updated, and skipped with reasons.

2. Security
- SECURITY DEFINER with SET search_path = public.
- EXECUTE revoked from PUBLIC and anon; granted to authenticated.
- Only owner or manager roles can call it.

3. Notes
- No data is deleted. Insumos not in the file keep their current stock.
- Stock can go negative (existing behavior).
- Unit must be one of: g, kg, ml, l, unidad.
- Storage location must be one of: nevera, estanteria, bodega.
*/

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
  v_unit_cost integer;
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
    v_unit_cost := COALESCE((v_row->>'unit_cost_cop')::integer, 0);
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
