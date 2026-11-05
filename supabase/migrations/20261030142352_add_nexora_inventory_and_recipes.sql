/*
# Inventory items, stock movements and product recipes

1. New tables
- nexora_inventory_items: raw materials and supplies (insumos). Each has a name, unit (g, kg, ml, l, unidad),
  storage location (nevera, estanteria, bodega), minimum stock, current stock, last unit cost and an active flag.
- nexora_inventory_movements: an append-only log of every change in stock. Kinds: purchase (compra),
  consumption (consumo por pedido), waste (merma) and adjustment (ajuste por conteo). Quantities are signed.
- nexora_product_recipes: which insumos and how much of each one a menu product uses.

2. Stock rules
- current_stock is never written directly by the app. It changes only through register_nexora_inventory_movement
  (purchases, waste, counting adjustments) and consume_nexora_order_inventory (orders).
- Stock may go negative when a sale happens without enough recorded stock, so the gap stays visible.

3. Functions
- register_nexora_inventory_movement: records a purchase, waste or adjustment and updates stock atomically.
- consume_nexora_order_inventory: for an order, subtracts each recipe ingredient multiplied by the ordered quantity.
  Not callable by clients; it is invoked by the order functions.

4. Security
- RLS enabled on all three tables. Staff (authenticated) can read them.
- Items: staff can insert and update only name, unit, storage location, minimum stock and active flag.
  Stock and cost columns are not client-writable.
- Recipes: staff can read, insert, update and delete their lines.
- Movements: read only; writes happen through functions.
- anon has no access. Client-callable functions are granted to authenticated only.
*/

CREATE TABLE IF NOT EXISTS public.nexora_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  unit text NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'unidad')),
  storage_location text NOT NULL CHECK (storage_location IN ('nevera', 'estanteria', 'bodega')),
  min_stock numeric(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  current_stock numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost_cop integer NOT NULL DEFAULT 0 CHECK (unit_cost_cop >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nexora_inventory_items_name_key
ON public.nexora_inventory_items (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.nexora_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.nexora_inventory_items(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('purchase', 'consumption', 'waste', 'adjustment')),
  quantity numeric(12,3) NOT NULL CHECK (quantity <> 0),
  unit_cost_cop integer CHECK (unit_cost_cop IS NULL OR unit_cost_cop >= 0),
  order_id uuid REFERENCES public.nexora_orders(id) ON DELETE RESTRICT,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'purchase' AND quantity > 0)
    OR (kind IN ('consumption', 'waste') AND quantity < 0)
    OR kind = 'adjustment'
  )
);

CREATE INDEX IF NOT EXISTS nexora_inventory_movements_item_idx
ON public.nexora_inventory_movements (item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS nexora_inventory_movements_kind_idx
ON public.nexora_inventory_movements (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS public.nexora_product_recipes (
  product_id uuid NOT NULL REFERENCES public.nexora_products(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.nexora_inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (product_id, item_id)
);

CREATE INDEX IF NOT EXISTS nexora_product_recipes_item_idx ON public.nexora_product_recipes (item_id);

ALTER TABLE public.nexora_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexora_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexora_product_recipes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nexora_inventory_items FROM anon;
REVOKE ALL ON public.nexora_inventory_movements FROM anon;
REVOKE ALL ON public.nexora_product_recipes FROM anon;

GRANT SELECT ON public.nexora_inventory_items TO authenticated;
GRANT INSERT (name, unit, storage_location, min_stock, is_active) ON public.nexora_inventory_items TO authenticated;
GRANT UPDATE (name, unit, storage_location, min_stock, is_active) ON public.nexora_inventory_items TO authenticated;

GRANT SELECT ON public.nexora_inventory_movements TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nexora_product_recipes TO authenticated;

DROP POLICY IF EXISTS "Staff can read inventory items" ON public.nexora_inventory_items;
CREATE POLICY "Staff can read inventory items"
ON public.nexora_inventory_items FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Staff can add inventory items" ON public.nexora_inventory_items;
CREATE POLICY "Staff can add inventory items"
ON public.nexora_inventory_items FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can edit inventory items" ON public.nexora_inventory_items;
CREATE POLICY "Staff can edit inventory items"
ON public.nexora_inventory_items FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can read inventory movements" ON public.nexora_inventory_movements;
CREATE POLICY "Staff can read inventory movements"
ON public.nexora_inventory_movements FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Staff can read recipes" ON public.nexora_product_recipes;
CREATE POLICY "Staff can read recipes"
ON public.nexora_product_recipes FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Staff can add recipe lines" ON public.nexora_product_recipes;
CREATE POLICY "Staff can add recipe lines"
ON public.nexora_product_recipes FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can edit recipe lines" ON public.nexora_product_recipes;
CREATE POLICY "Staff can edit recipe lines"
ON public.nexora_product_recipes FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can remove recipe lines" ON public.nexora_product_recipes;
CREATE POLICY "Staff can remove recipe lines"
ON public.nexora_product_recipes FOR DELETE
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.register_nexora_inventory_movement(
  item_id_input uuid,
  kind_input text,
  quantity_input numeric,
  unit_cost_input integer DEFAULT NULL,
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

  IF kind_input = 'purchase' AND (unit_cost_input IS NULL OR unit_cost_input < 0) THEN
    RAISE EXCEPTION 'Indica el costo unitario de la compra';
  END IF;

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
      unit_cost_cop = CASE WHEN kind_input = 'purchase' THEN unit_cost_input ELSE i.unit_cost_cop END
  WHERE i.id = item_id_input
  RETURNING i.current_stock INTO v_new_stock;

  INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, unit_cost_cop, note)
  VALUES (
    item_id_input,
    kind_input,
    v_delta,
    CASE WHEN kind_input = 'purchase' THEN unit_cost_input ELSE NULL END,
    v_note
  );

  RETURN v_new_stock;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_nexora_order_inventory(order_id_input uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  consumed record;
BEGIN
  FOR consumed IN
    SELECT r.item_id, SUM(r.quantity * oi.quantity)::numeric(12,3) AS used_quantity
    FROM public.nexora_order_items oi
    JOIN public.nexora_product_recipes r ON r.product_id = oi.product_id
    WHERE oi.order_id = order_id_input
    GROUP BY r.item_id
  LOOP
    UPDATE public.nexora_inventory_items i
    SET current_stock = i.current_stock - consumed.used_quantity
    WHERE i.id = consumed.item_id;

    INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, order_id)
    VALUES (consumed.item_id, 'consumption', -consumed.used_quantity, order_id_input);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_nexora_inventory_movement(uuid, text, numeric, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_nexora_inventory_movement(uuid, text, numeric, integer, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.consume_nexora_order_inventory(uuid) FROM PUBLIC, anon, authenticated;
