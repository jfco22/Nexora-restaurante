/*
# Table billing, payments and write lockdown

1. Security lockdown
- The anon role can no longer write or read orders, order items, tables or the kitchen view.
- Prototype policies that let anyone change orders and items are removed.
- Catalog writes (products and categories) are limited to signed-in staff. Anon keeps read access to the menu.
- Orders and items are read-only for staff; all changes go through privileged functions.

2. New table: nexora_payments
- Each payment belongs to one order. Methods: cash, card, bre_b.
- Cash and card payments are recorded as paid immediately.
- Bre-B payments are recorded as pending with the transfer reference, and only become paid after the reference is confirmed.
- Staff can read payments. Writes happen only through functions.

3. Functions
- add_nexora_table_order_items: adds validated products to an open draft account and recalculates the total.
- remove_nexora_order_item: removes a line from an open draft account and recalculates the total.
- advance_nexora_order_status: now refuses to send an empty account to the kitchen.
- register_nexora_payment: records a cash, card or Bre-B payment without exceeding the balance.
- confirm_nexora_bre_b_payment: marks a pending Bre-B payment as paid when the reference matches.
- close_nexora_table_order: closes a delivered account once it is fully paid and frees the table.
- cancel_nexora_table_order: cancels an open draft account with no payments and frees the table.

4. Notes
- No data is deleted except draft order lines removed by staff.
- All functions run as SECURITY DEFINER with a fixed search path and are executable only by authenticated users.
*/

-- 1. Lock down anon access to operational tables
REVOKE ALL ON public.nexora_orders FROM anon;
REVOKE ALL ON public.nexora_order_items FROM anon;
REVOKE ALL ON public.nexora_tables FROM anon;
REVOKE ALL ON public.nexora_kitchen_tickets FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.nexora_products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.nexora_categories FROM anon;

-- 2. Remove prototype write access on orders and items
DROP POLICY IF EXISTS "Shared prototype can insert orders" ON public.nexora_orders;
DROP POLICY IF EXISTS "Shared prototype can update orders" ON public.nexora_orders;
DROP POLICY IF EXISTS "Shared prototype can delete orders" ON public.nexora_orders;
DROP POLICY IF EXISTS "Shared prototype can insert order items" ON public.nexora_order_items;
DROP POLICY IF EXISTS "Shared prototype can update order items" ON public.nexora_order_items;
DROP POLICY IF EXISTS "Shared prototype can delete order items" ON public.nexora_order_items;

ALTER POLICY "Shared prototype can read orders" ON public.nexora_orders TO authenticated;
ALTER POLICY "Shared prototype can read orders" ON public.nexora_orders RENAME TO "Staff can read orders";
ALTER POLICY "Shared prototype can read order items" ON public.nexora_order_items TO authenticated;
ALTER POLICY "Shared prototype can read order items" ON public.nexora_order_items RENAME TO "Staff can read order items";

REVOKE INSERT, UPDATE, DELETE ON public.nexora_orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.nexora_order_items FROM authenticated;

-- 3. Catalog writes restricted to staff
ALTER POLICY "Public can insert products" ON public.nexora_products TO authenticated;
ALTER POLICY "Public can update products" ON public.nexora_products TO authenticated;
ALTER POLICY "Public can delete products" ON public.nexora_products TO authenticated;
ALTER POLICY "Public can insert categories" ON public.nexora_categories TO authenticated;
ALTER POLICY "Public can update categories" ON public.nexora_categories TO authenticated;
ALTER POLICY "Public can delete categories" ON public.nexora_categories TO authenticated;

-- 4. Payments table
CREATE TABLE IF NOT EXISTS public.nexora_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.nexora_orders(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('cash', 'card', 'bre_b')),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid')),
  amount_cop integer NOT NULL CHECK (amount_cop > 0),
  reference text,
  recorded_by uuid DEFAULT auth.uid(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nexora_payments_bre_b_reference_check CHECK (method <> 'bre_b' OR reference IS NOT NULL),
  CONSTRAINT nexora_payments_bre_b_status_check CHECK (method <> 'bre_b' OR status IN ('pending', 'paid'))
);

CREATE INDEX IF NOT EXISTS nexora_payments_order_id_idx ON public.nexora_payments (order_id);

ALTER TABLE public.nexora_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nexora_payments FROM anon;
GRANT SELECT ON public.nexora_payments TO authenticated;

DROP POLICY IF EXISTS "Staff can read payments" ON public.nexora_payments;
CREATE POLICY "Staff can read payments"
ON public.nexora_payments FOR SELECT
TO authenticated
USING (true);

-- 5. Account line functions
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

  INSERT INTO public.nexora_order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop)
  SELECT order_id_input, product.id, product.name, product.price_cop, requested.quantity, product.price_cop * requested.quantity
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer)
  JOIN public.nexora_products product ON product.id = requested.product_id;

  UPDATE public.nexora_orders o
  SET total_cop = (SELECT COALESCE(SUM(oi.line_total_cop), 0) FROM public.nexora_order_items oi WHERE oi.order_id = order_id_input),
      updated_at = now()
  WHERE o.id = order_id_input;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_nexora_order_item(item_id_input uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_status text;
BEGIN
  SELECT oi.order_id INTO v_order_id
  FROM public.nexora_order_items oi
  WHERE oi.id = item_id_input;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto ya no está en la cuenta';
  END IF;

  SELECT o.status INTO v_status
  FROM public.nexora_orders o
  WHERE o.id = v_order_id
  FOR UPDATE;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'La cuenta ya fue enviada a cocina';
  END IF;

  DELETE FROM public.nexora_order_items WHERE id = item_id_input;

  UPDATE public.nexora_orders o
  SET total_cop = (SELECT COALESCE(SUM(oi.line_total_cop), 0) FROM public.nexora_order_items oi WHERE oi.order_id = v_order_id),
      updated_at = now()
  WHERE o.id = v_order_id;
END;
$$;

-- 6. Kitchen advance refuses empty accounts
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

  RETURN QUERY SELECT next_status;
END;
$$;

-- 7. Payment functions
CREATE OR REPLACE FUNCTION public.register_nexora_payment(
  order_id_input uuid,
  method_input text,
  amount_input integer,
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
  v_registered integer;
  v_remaining integer;
  v_reference text;
  v_state text;
  v_payment_id uuid;
BEGIN
  SELECT o.status, o.total_cop INTO v_status, v_total
  FROM public.nexora_orders o
  WHERE o.id = order_id_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  IF v_status NOT IN ('submitted', 'accepted', 'ready', 'completed') OR v_total <= 0 THEN
    RAISE EXCEPTION 'La cuenta todavía no se puede cobrar';
  END IF;

  IF method_input NOT IN ('cash', 'card', 'bre_b') THEN
    RAISE EXCEPTION 'Método de pago no válido';
  END IF;

  v_reference := NULLIF(trim(reference_input), '');

  IF method_input = 'bre_b' AND v_reference IS NULL THEN
    RAISE EXCEPTION 'Escribe la referencia de la transferencia Bre-B';
  END IF;

  IF amount_input IS NULL OR amount_input <= 0 THEN
    RAISE EXCEPTION 'El valor del pago no es válido';
  END IF;

  SELECT COALESCE(SUM(p.amount_cop), 0) INTO v_registered
  FROM public.nexora_payments p
  WHERE p.order_id = order_id_input;

  v_remaining := v_total - v_registered;

  IF amount_input > v_remaining THEN
    RAISE EXCEPTION 'El pago supera el saldo pendiente de la cuenta';
  END IF;

  v_state := CASE WHEN method_input = 'bre_b' THEN 'pending' ELSE 'paid' END;

  INSERT INTO public.nexora_payments (order_id, method, status, amount_cop, reference)
  VALUES (order_id_input, method_input, v_state, amount_input, v_reference)
  RETURNING id INTO v_payment_id;

  RETURN QUERY SELECT v_payment_id, v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_nexora_bre_b_payment(payment_id_input uuid, reference_input text)
RETURNS TABLE(payment_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method text;
  v_status text;
  v_reference text;
BEGIN
  SELECT p.method, p.status, p.reference INTO v_method, v_status, v_reference
  FROM public.nexora_payments p
  WHERE p.id = payment_id_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no existe';
  END IF;

  IF v_method <> 'bre_b' THEN
    RAISE EXCEPTION 'Solo los pagos Bre-B requieren confirmación';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'El pago ya fue confirmado';
  END IF;

  IF upper(NULLIF(trim(reference_input), '')) IS DISTINCT FROM upper(v_reference) THEN
    RAISE EXCEPTION 'La referencia no coincide con el pago Bre-B registrado';
  END IF;

  UPDATE public.nexora_payments p
  SET status = 'paid', confirmed_by = auth.uid(), confirmed_at = now()
  WHERE p.id = payment_id_input;

  RETURN QUERY SELECT 'paid'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_nexora_table_order(order_id_input uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_total integer;
  v_table_id uuid;
  v_paid integer;
  v_pending integer;
BEGIN
  SELECT o.status, o.total_cop, o.table_id INTO v_status, v_total, v_table_id
  FROM public.nexora_orders o
  WHERE o.id = order_id_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'La cuenta debe estar entregada antes de cerrarla';
  END IF;

  SELECT
    COALESCE(SUM(p.amount_cop) FILTER (WHERE p.status = 'paid'), 0),
    COALESCE(SUM(p.amount_cop) FILTER (WHERE p.status = 'pending'), 0)
  INTO v_paid, v_pending
  FROM public.nexora_payments p
  WHERE p.order_id = order_id_input;

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Hay pagos Bre-B pendientes de confirmar';
  END IF;

  IF v_paid < v_total THEN
    RAISE EXCEPTION 'Aún queda saldo por cobrar';
  END IF;

  UPDATE public.nexora_orders o
  SET payment_status = 'paid', updated_at = now()
  WHERE o.id = order_id_input;

  IF v_table_id IS NOT NULL THEN
    UPDATE public.nexora_tables t
    SET status = 'free', updated_at = now()
    WHERE t.id = v_table_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_nexora_table_order(order_id_input uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_table_id uuid;
BEGIN
  SELECT o.status, o.table_id INTO v_status, v_table_id
  FROM public.nexora_orders o
  WHERE o.id = order_id_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se puede cancelar una cuenta que no se ha enviado a cocina';
  END IF;

  IF EXISTS (SELECT 1 FROM public.nexora_payments p WHERE p.order_id = order_id_input) THEN
    RAISE EXCEPTION 'La cuenta ya tiene pagos registrados';
  END IF;

  UPDATE public.nexora_orders o
  SET status = 'cancelled', updated_at = now()
  WHERE o.id = order_id_input;

  IF v_table_id IS NOT NULL THEN
    UPDATE public.nexora_tables t
    SET status = 'free', updated_at = now()
    WHERE t.id = v_table_id;
  END IF;
END;
$$;

-- 8. Privileges for functions
REVOKE EXECUTE ON FUNCTION public.add_nexora_table_order_items(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_nexora_order_item(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.advance_nexora_order_status(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_nexora_payment(uuid, text, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_nexora_bre_b_payment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_nexora_table_order(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_nexora_table_order(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.add_nexora_table_order_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_nexora_order_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_nexora_order_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_nexora_payment(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_nexora_bre_b_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_nexora_table_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_nexora_table_order(uuid) TO authenticated;
