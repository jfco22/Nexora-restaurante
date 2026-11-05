/*
# Deduct inventory when orders are sent to the kitchen

1. Changes to existing order functions
- advance_nexora_order_status: when a table order moves from draft to submitted, the ingredients for its products are deducted from stock.
- create_nexora_order (guest and takeaway version): the ingredients are deducted when the order is created.
- The older create_nexora_order overload (items and total only) is removed. The app did not use it, and it would create orders without deducting stock.

2. Behavior
- Each order deducts stock exactly once, at the moment it is sent to the kitchen.
- Products without a recipe deduct nothing.
- Stock can go negative, so missing ingredients remain visible instead of blocking a sale.

3. Security
- The deduction runs inside the order functions. Clients cannot call it directly.
- Existing grants are unchanged: the guest order function stays callable by anon, and the status function by authenticated.
*/

CREATE OR REPLACE FUNCTION public.advance_nexora_order_status(order_id_input uuid)
RETURNS TABLE(new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_status text;
  next_status text;
  now_ts timestamptz;
BEGIN
  now_ts := now();

  SELECT o.status INTO current_status
  FROM public.nexora_orders o
  WHERE o.id = order_id_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no existe';
  END IF;

  next_status := CASE current_status
    WHEN 'draft' THEN 'submitted'
    WHEN 'submitted' THEN 'accepted'
    WHEN 'accepted' THEN 'ready'
    WHEN 'ready' THEN 'completed'
    ELSE NULL
  END;

  IF next_status IS NULL THEN
    RAISE EXCEPTION 'No se puede avanzar el pedido desde el estado %', current_status;
  END IF;

  IF current_status = 'draft' AND NOT EXISTS (
    SELECT 1 FROM public.nexora_order_items oi WHERE oi.order_id = order_id_input
  ) THEN
    RAISE EXCEPTION 'Agrega productos antes de enviar la cuenta a cocina';
  END IF;

  UPDATE public.nexora_orders o
  SET status = next_status,
      ready_at = CASE WHEN next_status = 'ready' THEN now_ts ELSE o.ready_at END,
      delivered_at = CASE WHEN next_status = 'completed' THEN now_ts ELSE o.delivered_at END,
      updated_at = now_ts
  WHERE o.id = order_id_input;

  IF current_status = 'draft' THEN
    PERFORM public.consume_nexora_order_inventory(order_id_input);
  END IF;

  RETURN QUERY SELECT next_status;
END;
$$;

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
  VALUES ('takeaway', 'submitted', 'unpaid', 'menu', calculated_total, clean_guest_name, clean_guest_phone)
  RETURNING id INTO new_order_id;

  INSERT INTO public.nexora_order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop)
  SELECT new_order_id, product.id, product.name, product.price_cop, requested.quantity, product.price_cop * requested.quantity
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer)
  JOIN public.nexora_products product ON product.id = requested.product_id;

  PERFORM public.consume_nexora_order_inventory(new_order_id);

  RETURN QUERY
  SELECT order_record.id, order_record.order_number, order_record.total_cop
  FROM public.nexora_orders order_record
  WHERE order_record.id = new_order_id;
END;
$$;

DROP FUNCTION IF EXISTS public.create_nexora_order(jsonb, integer);
