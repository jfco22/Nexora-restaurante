/*
# Add guest details to Nexora orders

1. Purpose
- Allow customers to place a menu order without creating a staff account.
- Capture only the minimum contact details needed for the restaurant to identify the guest.

2. Modified table
- `nexora_orders`
- Add nullable `guest_name` and `guest_phone` fields.
- Existing staff and historical orders remain unchanged.

3. Modified function
- Extend `create_nexora_order` with optional guest name and phone arguments.
- Require a guest name when the order is created anonymously.
- Keep server-side price calculation and atomic order creation.

4. Security
- Guest access is limited to the public ordering flow.
- Staff profiles and roles remain protected behind authentication.
- Contact fields are validated at the database boundary.
*/

ALTER TABLE public.nexora_orders
  ADD COLUMN IF NOT EXISTS guest_name text CHECK (guest_name IS NULL OR char_length(trim(guest_name)) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS guest_phone text CHECK (guest_phone IS NULL OR char_length(trim(guest_phone)) BETWEEN 7 AND 30);

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

  RETURN QUERY
  SELECT order_record.id, order_record.order_number, order_record.total_cop
  FROM public.nexora_orders order_record
  WHERE order_record.id = new_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_nexora_order(jsonb, integer, text, text) TO anon, authenticated;
