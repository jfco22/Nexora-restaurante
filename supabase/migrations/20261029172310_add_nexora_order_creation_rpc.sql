/*
# Add atomic Nexora order creation

1. Purpose
- Provide one server-side operation for creating an order and its item snapshots.
- Recalculate product prices from the database instead of trusting browser totals.

2. New function
- `create_nexora_order(jsonb, integer)` creates a submitted menu order and its items.
- The JSON input contains product identifiers and positive quantities.
- The function returns the created order identifier, order number and recalculated total.

3. Security
- The function runs with a fixed search path.
- It is executable by the current no-auth prototype roles only.
- Input is validated and unavailable or inactive products are rejected.

4. Integrity
- Order and order items are written within one database function call.
- Prices and line totals come from persisted products.
- Empty carts and malformed quantities are rejected.
*/

CREATE OR REPLACE FUNCTION public.create_nexora_order(items jsonb, requested_total_cop integer DEFAULT 0)
RETURNS TABLE(order_id uuid, order_number bigint, total_cop integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_order_id uuid;
  calculated_total integer;
BEGIN
  IF items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un producto';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer)
    WHERE requested.product_id IS NULL OR requested.quantity IS NULL OR requested.quantity <= 0
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

  INSERT INTO public.nexora_orders (order_type, status, payment_status, source, total_cop)
  VALUES ('salon', 'submitted', 'unpaid', 'menu', calculated_total)
  RETURNING id INTO new_order_id;

  INSERT INTO public.nexora_order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop)
  SELECT new_order_id, product.id, product.name, product.price_cop, requested.quantity, product.price_cop * requested.quantity
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer)
  JOIN public.nexora_products product ON product.id = requested.product_id;

  RETURN QUERY
  SELECT order_record.id, order_record.order_number, order_record.total_cop
  FROM public.nexora_orders order_record
  WHERE order_record.id = new_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer) TO anon, authenticated;
