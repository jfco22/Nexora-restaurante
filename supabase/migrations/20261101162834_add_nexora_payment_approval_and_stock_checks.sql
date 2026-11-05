/*
# Guest and takeaway orders wait for cashier approval; stock is checked and deducted at approval

1. New order status
- pending_payment: an order created from the menu that is waiting for the cashier to approve payment.
  The kitchen does not see it and cannot advance it.

2. Changes to create_nexora_order
- New orders start as pending_payment instead of submitted.
- Ingredient stock is checked before the order is saved. If any ingredient is short, the order is rejected with the name of the missing ingredient.
- Stock is NOT deducted at creation anymore.

3. New approve_nexora_order_payment(order, method, reference)
- Requires an open cash shift.
- Re-checks ingredient stock, moves the order to submitted (kitchen), deducts the ingredients once,
  and records the payment for the full amount. The cashier's approval confirms the payment, including Bre-B.

4. New get_nexora_menu_availability()
- For each active product returns how many servings can be made with the current stock.
  NULL means the product has no recipe and is not limited by stock.

5. Kitchen tickets
- nexora_kitchen_tickets gains payment_status so the kitchen can show that the order is paid.

6. Security
- check_nexora_inventory_for_order is internal: only the order functions call it.
- approve_nexora_order_payment is for signed-in staff only.
- get_nexora_menu_availability is callable by guests and staff; it returns only product ids and numbers.
- Advancing a table order from draft still deducts stock as before.
*/

ALTER TABLE public.nexora_orders DROP CONSTRAINT IF EXISTS nexora_orders_status_check;
ALTER TABLE public.nexora_orders ADD CONSTRAINT nexora_orders_status_check
  CHECK (status IN ('draft', 'pending_payment', 'submitted', 'accepted', 'ready', 'completed', 'cancelled'));

CREATE OR REPLACE FUNCTION public.check_nexora_inventory_for_order(order_id_input uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  shortage record;
BEGIN
  SELECT i.name, need.required_quantity AS required_quantity, i.current_stock AS available_stock
  INTO shortage
  FROM (
    SELECT r.item_id, SUM(r.quantity * oi.quantity)::numeric(12,3) AS required_quantity
    FROM public.nexora_order_items oi
    JOIN public.nexora_product_recipes r ON r.product_id = oi.product_id AND r.is_active
    WHERE oi.order_id = order_id_input
    GROUP BY r.item_id
  ) need
  JOIN public.nexora_inventory_items i ON i.id = need.item_id
  WHERE i.current_stock < need.required_quantity
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Sin inventario suficiente de %. Quita cantidades o elige otro producto.', shortage.name;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_nexora_inventory_for_order(uuid) FROM PUBLIC, anon, authenticated;

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
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer)
    WHERE requested.product_id IS NULL OR requested.quantity IS NULL OR requested.quantity <= 0 OR requested.quantity > 100
  ) THEN
    RAISE EXCEPTION 'Las cantidades del pedido no son válidas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer)
    LEFT JOIN public.nexora_products product ON product.id = requested.product_id
    WHERE product.id IS NULL OR product.is_active IS NOT TRUE OR product.is_available IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Uno de los productos ya no está disponible';
  END IF;

  SELECT COALESCE(SUM(product.price_cop * requested.quantity), 0)::integer
  INTO calculated_total
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer)
  JOIN public.nexora_products product ON product.id = requested.product_id;

  INSERT INTO public.nexora_orders (order_type, status, payment_status, source, total_cop, guest_name, guest_phone)
  VALUES ('takeaway', 'pending_payment', 'unpaid', 'menu', calculated_total, clean_guest_name, clean_guest_phone)
  RETURNING id INTO new_order_id;

  INSERT INTO public.nexora_order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop)
  SELECT new_order_id, product.id, product.name, product.price_cop, requested.quantity, product.price_cop * requested.quantity
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer)
  JOIN public.nexora_products product ON product.id = requested.product_id;

  PERFORM public.check_nexora_inventory_for_order(new_order_id);

  RETURN QUERY
  SELECT order_record.id, order_record.order_number, order_record.total_cop
  FROM public.nexora_orders order_record
  WHERE order_record.id = new_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_nexora_order_payment(
  order_id_input uuid,
  method_input text,
  reference_input text DEFAULT NULL
)
RETURNS TABLE(payment_id uuid, payment_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_total integer;
  v_payment_id uuid;
BEGIN
  SELECT o.status, o.total_cop INTO v_status, v_total
  FROM public.nexora_orders o
  WHERE o.id = order_id_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no existe';
  END IF;

  IF v_status <> 'pending_payment' THEN
    RAISE EXCEPTION 'Este pedido ya fue aprobado o no está pendiente de pago';
  END IF;

  PERFORM public.check_nexora_inventory_for_order(order_id_input);

  UPDATE public.nexora_orders o
  SET status = 'submitted', updated_at = now()
  WHERE o.id = order_id_input;

  PERFORM public.consume_nexora_order_inventory(order_id_input);

  SELECT r.payment_id INTO v_payment_id
  FROM public.register_nexora_payment(order_id_input, method_input, v_total, reference_input) r;

  UPDATE public.nexora_payments p SET status = 'paid' WHERE p.id = v_payment_id;
  UPDATE public.nexora_orders o SET payment_status = 'paid', updated_at = now() WHERE o.id = order_id_input;

  RETURN QUERY SELECT v_payment_id, 'paid'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_nexora_menu_availability()
RETURNS TABLE(product_id uuid, servings_available integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         MIN(GREATEST(FLOOR(i.current_stock / r.quantity), 0))::integer
  FROM public.nexora_products p
  LEFT JOIN public.nexora_product_recipes r ON r.product_id = p.id AND r.is_active
  LEFT JOIN public.nexora_inventory_items i ON i.id = r.item_id
  WHERE p.is_active AND p.is_available
  GROUP BY p.id;
$$;

REVOKE EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer, text, text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_nexora_order_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_nexora_order_payment(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_nexora_menu_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nexora_menu_availability() TO anon, authenticated;

CREATE OR REPLACE VIEW public.nexora_kitchen_tickets
WITH (security_invoker = true)
AS
SELECT o.id,
    o.order_number,
    o.status,
    o.order_type,
    o.source,
    o.total_cop,
    o.created_at,
    o.ready_at,
    o.guest_name,
    t.name AS table_name,
    ( SELECT jsonb_agg(jsonb_build_object('product_name', oi.product_name, 'quantity', oi.quantity) ORDER BY oi.created_at) AS jsonb_agg
           FROM nexora_order_items oi
          WHERE oi.order_id = o.id) AS items,
    o.payment_status
FROM nexora_orders o
     LEFT JOIN nexora_tables t ON t.id = o.table_id
WHERE o.status = ANY (ARRAY['submitted'::text, 'accepted'::text, 'ready'::text])
ORDER BY (
        CASE o.status
            WHEN 'submitted'::text THEN 1
            WHEN 'accepted'::text THEN 2
            WHEN 'ready'::text THEN 3
            ELSE NULL::integer
        END), o.created_at;
