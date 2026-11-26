/*
  # Anular pedidos que quedaron sin cobrar

  Permite al propietario o gerente anular un pedido que sigue en "pendiente de pago" (o una cuenta sin enviar) cuando
  no tiene ningún pago. En esos estados todavía no se ha descontado inventario, así que anular no deja stock descuadrado.
  Si el pedido era de una mesa, la mesa queda libre.
*/
CREATE OR REPLACE FUNCTION public.cancel_nexora_stuck_order(order_id_input uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_status text; v_table_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nexora_profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager')) THEN
    RAISE EXCEPTION 'Solo el propietario o el gerente puede anular pedidos';
  END IF;
  SELECT o.status, o.table_id INTO v_status, v_table_id FROM public.nexora_orders o WHERE o.id = order_id_input FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido no existe'; END IF;
  IF v_status NOT IN ('pending_payment', 'draft') THEN
    RAISE EXCEPTION 'Solo se pueden anular pedidos pendientes de pago o cuentas sin enviar a cocina';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nexora_payments p WHERE p.order_id = order_id_input AND p.status IN ('paid', 'pending')) THEN
    RAISE EXCEPTION 'El pedido ya tiene pagos registrados';
  END IF;
  UPDATE public.nexora_orders SET status = 'cancelled', updated_at = now() WHERE id = order_id_input;
  IF v_table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.nexora_orders o WHERE o.table_id = v_table_id AND o.id <> order_id_input
      AND o.status NOT IN ('cancelled', 'completed') AND o.payment_status <> 'paid') THEN
    UPDATE public.nexora_tables SET status = 'free', updated_at = now() WHERE id = v_table_id AND status = 'occupied';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_nexora_stuck_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_nexora_stuck_order(uuid) TO authenticated;
