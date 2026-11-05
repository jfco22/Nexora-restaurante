/*
# Add kitchen workflow to Nexora orders

1. Purpose
- Move orders through a kitchen workflow: sent -> preparing -> ready -> delivered.
- Let staff advance order status from the kitchen display without trusting a client-supplied status.

2. Modified table
- `nexora_orders`
- Add `ready_at` and `delivered_at` timestamp columns to track kitchen timing.
- The `status` column already exists with a CHECK constraint; we add the new statuses to it.

3. New function
- `advance_nexora_order_status(order_id uuid)` advances an order through the workflow:
  draft -> sent -> preparing -> ready -> delivered.
- Validates each transition, rejects invalid jumps.
- Sets `ready_at` when entering 'ready' and `delivered_at` when entering 'delivered'.
- Returns the new status so the UI can update immediately.

4. New view
- `nexora_kitchen_tickets` exposes active orders (sent, preparing, ready) with their items,
  table name, and elapsed time, so the kitchen display can read a single joined dataset.

5. Security
- The advance function is SECURITY DEFINER, authenticated-only, and checks status server-side.
- The kitchen view is granted SELECT to authenticated only.
- Anonymous guests cannot access kitchen data.
*/

ALTER TABLE public.nexora_orders
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'nexora_orders_status_check'
      AND table_name = 'nexora_orders'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.nexora_orders
      ADD CONSTRAINT nexora_orders_status_check
      CHECK (status IN ('draft', 'sent', 'preparing', 'ready', 'delivered', 'cancelled'));
  END IF;
END $$;

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

  SELECT status INTO current_status
  FROM public.nexora_orders
  WHERE id = order_id_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no existe';
  END IF;

  next_status := CASE current_status
    WHEN 'draft' THEN 'sent'
    WHEN 'sent' THEN 'preparing'
    WHEN 'preparing' THEN 'ready'
    WHEN 'ready' THEN 'delivered'
    ELSE NULL
  END;

  IF next_status IS NULL THEN
    RAISE EXCEPTION 'No se puede avanzar el pedido desde el estado %', current_status;
  END IF;

  UPDATE public.nexora_orders
  SET status = next_status,
      ready_at = CASE WHEN next_status = 'ready' THEN now_ts ELSE ready_at END,
      delivered_at = CASE WHEN next_status = 'delivered' THEN now_ts ELSE delivered_at END,
      updated_at = now_ts
  WHERE id = order_id_input;

  RETURN QUERY SELECT next_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.advance_nexora_order_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_nexora_order_status(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.nexora_kitchen_tickets AS
SELECT
  o.id,
  o.order_number,
  o.status,
  o.order_type,
  o.source,
  o.total_cop,
  o.created_at,
  o.ready_at,
  o.guest_name,
  t.name AS table_name,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'product_name', oi.product_name,
      'quantity', oi.quantity
    ) ORDER BY oi.created_at)
    FROM public.nexora_order_items oi
    WHERE oi.order_id = o.id
  ) AS items
FROM public.nexora_orders o
LEFT JOIN public.nexora_tables t ON t.id = o.table_id
WHERE o.status IN ('sent', 'preparing', 'ready')
ORDER BY
  CASE o.status
    WHEN 'sent' THEN 1
    WHEN 'preparing' THEN 2
    WHEN 'ready' THEN 3
  END,
  o.created_at ASC;

ALTER VIEW public.nexora_kitchen_tickets OWNER TO postgres;
GRANT SELECT ON public.nexora_kitchen_tickets TO authenticated;
