/*
# Align kitchen workflow with Nexora order statuses

1. Purpose
- The previous kitchen migration added statuses ('sent', 'preparing', 'delivered') that the
  existing status check constraint on nexora_orders rejects, so the kitchen could not advance orders.
- This migration makes the kitchen use the same status vocabulary as the rest of the system.

2. Modified constraint
- `nexora_orders_status_check` now allows: draft, submitted, accepted, ready, completed, cancelled.
- No rows are changed or removed. No orders exist with the removed names.

3. Modified function
- `advance_nexora_order_status(uuid)` moves orders:
  draft -> submitted -> accepted -> ready -> completed.
- Sets ready_at when the order becomes ready and delivered_at when it is completed.

4. Modified view
- `nexora_kitchen_tickets` lists orders in submitted, accepted and ready.

5. Security
- Function stays SECURITY DEFINER, executable by authenticated only.
- View stays readable by authenticated only.
*/

ALTER TABLE public.nexora_orders DROP CONSTRAINT IF EXISTS nexora_orders_status_check;
ALTER TABLE public.nexora_orders
  ADD CONSTRAINT nexora_orders_status_check
  CHECK (status IN ('draft', 'submitted', 'accepted', 'ready', 'completed', 'cancelled'));

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

  UPDATE public.nexora_orders o
  SET status = next_status,
      ready_at = CASE WHEN next_status = 'ready' THEN now_ts ELSE o.ready_at END,
      delivered_at = CASE WHEN next_status = 'completed' THEN now_ts ELSE o.delivered_at END,
      updated_at = now_ts
  WHERE o.id = order_id_input;

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
WHERE o.status IN ('submitted', 'accepted', 'ready')
ORDER BY
  CASE o.status
    WHEN 'submitted' THEN 1
    WHEN 'accepted' THEN 2
    WHEN 'ready' THEN 3
  END,
  o.created_at ASC;

GRANT SELECT ON public.nexora_kitchen_tickets TO authenticated;
