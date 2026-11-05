/*
# Keep inventory history: recipe lines are deactivated, never deleted

1. Changes to nexora_product_recipes
- New column is_active (default true). Removing an ingredient from a dish now marks its line as inactive instead of deleting it.
- The DELETE permission and the delete policy are removed for staff.

2. Changes to consume_nexora_order_inventory
- Only active recipe lines are used when subtracting stock for an order.
- Orders already consumed keep their movement records; nothing is recalculated.

3. Existing data
- All existing recipe lines become active. No rows are removed.

4. Security
- Staff can still read, insert and update recipe lines. Deleting them is no longer possible.
- Inventory items are never deleted: they are deactivated through the is_active flag, which staff already can update.
*/

ALTER TABLE public.nexora_product_recipes
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

REVOKE DELETE ON public.nexora_product_recipes FROM authenticated;

DROP POLICY IF EXISTS "Staff can remove recipe lines" ON public.nexora_product_recipes;

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
    JOIN public.nexora_product_recipes r ON r.product_id = oi.product_id AND r.is_active
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

REVOKE EXECUTE ON FUNCTION public.consume_nexora_order_inventory(uuid) FROM PUBLIC, anon, authenticated;
