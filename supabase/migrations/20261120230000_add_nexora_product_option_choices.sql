/*
  # Productos con opciones a elegir al pedir (ej. "Perro con dos carnes")

  1. New tables
  - nexora_option_choices: una opción que se puede escoger (ej. "Res mechada", "Carne con guiso").
  - nexora_option_choice_lines: los insumos que gasta UNA vez esa opción.
  - nexora_product_options: marca un producto como "con opciones" y cuántas debe escoger (picks).
  - nexora_product_option_choices: cuáles opciones puede escoger cada producto. Se puede repetir la misma.

  2. Changes
  - nexora_order_items.choices: opciones escogidas en esa línea (uuid[]). El nombre de la línea
    guarda las opciones, así la cocina ve "Perro con dos carnes (Res mechada + Chorizo con hogao)".
  - create_nexora_order y add_nexora_table_order_items aceptan "choices" por línea y validan que
    el número y las opciones sean las permitidas.
  - La receta del producto se descuenta como siempre; además se descuentan los insumos de cada opción
    escogida (consume_nexora_order_inventory y check_nexora_inventory_for_order usan nexora_order_requirements).
  - get_nexora_product_options(): lectura pública (clientes del QR) de los productos con opciones.

  3. Security
  - RLS activa en las tablas nuevas; el personal autenticado las lee y edita; anon no accede directo.
  - Las funciones internas no son ejecutables por anon/authenticated.
*/

CREATE TABLE IF NOT EXISTS public.nexora_option_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS nexora_option_choices_name_key ON public.nexora_option_choices (lower(name));

CREATE TABLE IF NOT EXISTS public.nexora_option_choice_lines (
  choice_id uuid NOT NULL REFERENCES public.nexora_option_choices(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.nexora_inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (choice_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.nexora_product_options (
  product_id uuid PRIMARY KEY REFERENCES public.nexora_products(id) ON DELETE CASCADE,
  picks smallint NOT NULL CHECK (picks BETWEEN 1 AND 4)
);

CREATE TABLE IF NOT EXISTS public.nexora_product_option_choices (
  product_id uuid NOT NULL REFERENCES public.nexora_product_options(product_id) ON DELETE CASCADE,
  choice_id uuid NOT NULL REFERENCES public.nexora_option_choices(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, choice_id)
);

ALTER TABLE public.nexora_order_items ADD COLUMN IF NOT EXISTS choices uuid[] NOT NULL DEFAULT '{}';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nexora_option_choices','nexora_option_choice_lines','nexora_product_options','nexora_product_option_choices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "Staff can manage %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Staff can manage %s" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- Valida las opciones pedidas para un producto y devuelve sus ids en el orden pedido.
CREATE OR REPLACE FUNCTION public.nexora_resolve_choices(product_id_input uuid, choices_input jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_picks smallint;
  v_ids uuid[];
BEGIN
  SELECT po.picks INTO v_picks FROM public.nexora_product_options po WHERE po.product_id = product_id_input;

  IF choices_input IS NULL OR jsonb_typeof(choices_input) <> 'array' THEN
    v_ids := '{}';
  ELSE
    SELECT COALESCE(array_agg(value::uuid ORDER BY ord), '{}') INTO v_ids
    FROM jsonb_array_elements_text(choices_input) WITH ORDINALITY AS t(value, ord);
  END IF;

  IF v_picks IS NULL THEN
    IF cardinality(v_ids) > 0 THEN
      RAISE EXCEPTION 'Este producto no tiene opciones para escoger';
    END IF;
    RETURN '{}';
  END IF;

  IF cardinality(v_ids) <> v_picks THEN
    RAISE EXCEPTION 'Escoge % opción(es) para este producto', v_picks;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) AS c(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.nexora_product_option_choices pc
      JOIN public.nexora_option_choices oc ON oc.id = pc.choice_id AND oc.is_active
      WHERE pc.product_id = product_id_input AND pc.choice_id = c.id
    )
  ) THEN
    RAISE EXCEPTION 'Una de las opciones escogidas no está disponible';
  END IF;

  RETURN v_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_choice_label(choice_ids uuid[])
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN cardinality(choice_ids) = 0 THEN ''
    ELSE ' (' || (SELECT string_agg(oc.name, ' + ' ORDER BY t.ord)
                  FROM unnest(choice_ids) WITH ORDINALITY AS t(id, ord)
                  JOIN public.nexora_option_choices oc ON oc.id = t.id) || ')' END;
$$;

-- Insumos que necesita un pedido: receta de cada producto + insumos de cada opción escogida.
CREATE OR REPLACE FUNCTION public.nexora_order_requirements(order_id_input uuid)
RETURNS TABLE(item_id uuid, required_quantity numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.item_id, SUM(x.qty)::numeric(12,3)
  FROM (
    SELECT r.item_id, r.quantity * oi.quantity AS qty
    FROM public.nexora_order_items oi
    JOIN public.nexora_product_recipes r ON r.product_id = oi.product_id AND r.is_active
    WHERE oi.order_id = order_id_input
    UNION ALL
    SELECT cl.item_id, cl.quantity * oi.quantity AS qty
    FROM public.nexora_order_items oi
    CROSS JOIN LATERAL unnest(oi.choices) AS c(choice_id)
    JOIN public.nexora_option_choice_lines cl ON cl.choice_id = c.choice_id
    WHERE oi.order_id = order_id_input
  ) x
  GROUP BY x.item_id;
$$;

CREATE OR REPLACE FUNCTION public.check_nexora_inventory_for_order(order_id_input uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  shortage record;
BEGIN
  SELECT i.name, need.required_quantity, i.current_stock AS available_stock
  INTO shortage
  FROM public.nexora_order_requirements(order_id_input) need
  JOIN public.nexora_inventory_items i ON i.id = need.item_id
  WHERE i.current_stock < need.required_quantity
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Sin inventario suficiente de %. Quita cantidades o elige otro producto.', shortage.name;
  END IF;
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
    SELECT q.item_id, q.required_quantity::numeric(12,3) AS used_quantity
    FROM public.nexora_order_requirements(order_id_input) q
  LOOP
    UPDATE public.nexora_inventory_items i
    SET current_stock = i.current_stock - consumed.used_quantity
    WHERE i.id = consumed.item_id;

    INSERT INTO public.nexora_inventory_movements (item_id, kind, quantity, order_id)
    VALUES (consumed.item_id, 'consumption', -consumed.used_quantity, order_id_input);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.nexora_resolve_choices(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nexora_choice_label(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nexora_order_requirements(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_nexora_inventory_for_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_nexora_order_inventory(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_nexora_order(
  items jsonb,
  requested_total_cop integer DEFAULT 0,
  guest_name_input text DEFAULT NULL,
  guest_phone_input text DEFAULT NULL
)
RETURNS TABLE(order_id uuid, order_number bigint, total_cop integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_order_id uuid;
  calculated_total integer;
  clean_guest_name text;
  clean_guest_phone text;
BEGIN
  clean_guest_name := NULLIF(trim(guest_name_input), '');
  clean_guest_phone := NULLIF(trim(guest_phone_input), '');

  IF auth.uid() IS NULL AND clean_guest_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio';
  END IF;

  IF items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un producto';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
    WHERE requested.product_id IS NULL OR requested.quantity IS NULL OR requested.quantity <= 0 OR requested.quantity > 100
  ) THEN
    RAISE EXCEPTION 'Las cantidades del pedido no son válidas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
    LEFT JOIN public.nexora_products product ON product.id = requested.product_id
    WHERE product.id IS NULL OR product.is_active IS NOT TRUE OR product.is_available IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Uno de los productos ya no está disponible';
  END IF;

  SELECT COALESCE(SUM(product.price_cop * requested.quantity), 0)::integer
  INTO calculated_total
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
  JOIN public.nexora_products product ON product.id = requested.product_id;

  INSERT INTO public.nexora_orders (order_type, status, payment_status, source, total_cop, guest_name, guest_phone)
  VALUES ('takeaway', 'pending_payment', 'unpaid', 'menu', calculated_total, clean_guest_name, clean_guest_phone)
  RETURNING id INTO new_order_id;

  INSERT INTO public.nexora_order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop, choices)
  SELECT new_order_id, product.id, product.name || public.nexora_choice_label(ch.ids), product.price_cop,
         requested.quantity, product.price_cop * requested.quantity, ch.ids
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
  JOIN public.nexora_products product ON product.id = requested.product_id
  CROSS JOIN LATERAL (SELECT public.nexora_resolve_choices(product.id, requested.choices) AS ids) ch;

  PERFORM public.check_nexora_inventory_for_order(new_order_id);

  RETURN QUERY
  SELECT order_record.id, order_record.order_number, order_record.total_cop
  FROM public.nexora_orders order_record
  WHERE order_record.id = new_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_nexora_table_order_items(order_id_input uuid, items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT o.status INTO v_status
  FROM public.nexora_orders o
  WHERE o.id = order_id_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'La cuenta ya fue enviada a cocina';
  END IF;

  IF items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
    WHERE requested.product_id IS NULL OR requested.quantity IS NULL OR requested.quantity <= 0 OR requested.quantity > 100
  ) THEN
    RAISE EXCEPTION 'Las cantidades del pedido no son válidas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
    LEFT JOIN public.nexora_products product ON product.id = requested.product_id
    WHERE product.id IS NULL OR product.is_active IS NOT TRUE OR product.is_available IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Uno de los productos ya no está disponible';
  END IF;

  INSERT INTO public.nexora_order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop, choices)
  SELECT order_id_input, product.id, product.name || public.nexora_choice_label(ch.ids), product.price_cop,
         requested.quantity, product.price_cop * requested.quantity, ch.ids
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
  JOIN public.nexora_products product ON product.id = requested.product_id
  CROSS JOIN LATERAL (SELECT public.nexora_resolve_choices(product.id, requested.choices) AS ids) ch;

  UPDATE public.nexora_orders o
  SET total_cop = (SELECT COALESCE(SUM(oi.line_total_cop), 0) FROM public.nexora_order_items oi WHERE oi.order_id = order_id_input),
      updated_at = now()
  WHERE o.id = order_id_input;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer, text, text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_nexora_table_order_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_nexora_table_order_items(uuid, jsonb) TO authenticated;

-- Lectura pública (clientes del QR y personal): productos con opciones y sus opciones activas.
CREATE OR REPLACE FUNCTION public.get_nexora_product_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', po.product_id,
    'picks', po.picks,
    'choices', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oc.id, 'name', oc.name) ORDER BY pc.sort_order, oc.name), '[]'::jsonb)
      FROM public.nexora_product_option_choices pc
      JOIN public.nexora_option_choices oc ON oc.id = pc.choice_id AND oc.is_active
      WHERE pc.product_id = po.product_id
    )
  )), '[]'::jsonb)
  FROM public.nexora_product_options po;
$$;

REVOKE EXECUTE ON FUNCTION public.get_nexora_product_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nexora_product_options() TO anon, authenticated;
