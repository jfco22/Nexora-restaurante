/*
# Fix orphaned tables (occupied without active orders)

1. Summary
- Resets tables that are marked as 'occupied' but have no active order (draft, submitted, accepted, ready, or completed/unpaid) back to 'free'.
- This happens when orders are deleted or cancelled outside the normal flow, leaving the table stuck.
- Also adds a function `release_nexora_orphaned_table(table_id_input uuid)` that lets a manager release a stuck table.

2. Security
- SECURITY DEFINER with SET search_path = public.
- EXECUTE revoked from PUBLIC and anon; granted to authenticated.
- Only owner or manager roles can call it.
*/

-- Fix currently orphaned tables
UPDATE public.nexora_tables t
SET status = 'free', updated_at = now()
WHERE t.status = 'occupied'
AND NOT EXISTS (
  SELECT 1 FROM public.nexora_orders o
  WHERE o.table_id = t.id
  AND o.status IN ('draft', 'submitted', 'accepted', 'ready', 'completed')
  AND o.payment_status <> 'paid'
);

CREATE OR REPLACE FUNCTION public.release_nexora_orphaned_table(table_id_input uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_has_active_order boolean;
BEGIN
  SELECT p.role INTO v_caller_role FROM public.nexora_profiles p WHERE p.id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'No tienes permiso para liberar mesas';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.nexora_orders o
    WHERE o.table_id = table_id_input
    AND o.status IN ('draft', 'submitted', 'accepted', 'ready', 'completed')
    AND o.payment_status <> 'paid'
  ) INTO v_has_active_order;

  IF v_has_active_order THEN
    RAISE EXCEPTION 'La mesa tiene una cuenta activa y no se puede liberar';
  END IF;

  UPDATE public.nexora_tables
  SET status = 'free', updated_at = now()
  WHERE id = table_id_input AND status = 'occupied';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_nexora_orphaned_table(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_nexora_orphaned_table(uuid) TO authenticated;
