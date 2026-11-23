/*
# Ventas hechas sin internet

Cuando no hay señal, la caja guarda la venta en el equipo y la sube después.
Esta función recibe esa venta ya entregada y cobrada y la registra completa:

- Es idempotente: cada venta trae un client_id único. Si la señal se corta a la mitad del envío y la app
  reintenta, la venta NO se duplica; se devuelve el pedido ya creado (already_synced = true).
- La venta ya ocurrió, así que nunca se rechaza por falta de stock. Se descuenta el inventario aunque
  quede en negativo; esa diferencia se ve en Inventario y se corrige con un ajuste.
- Solo efectivo y tarjeta: Bre-B necesita confirmar la referencia con el banco, eso exige internet.
- El pedido y el pago quedan con la hora real en que se vendió (occurred_at), y el pago se asigna al turno
  de caja que estaba abierto en ese momento.
- Los precios son los vigentes en la base de datos al sincronizar.

Tabla nexora_offline_sales: lleva el control de qué ventas ya subieron. Solo se escribe con la función.
*/

CREATE TABLE IF NOT EXISTS public.nexora_offline_sales (
  client_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.nexora_orders(id) ON DELETE RESTRICT,
  created_by uuid DEFAULT auth.uid(),
  occurred_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nexora_offline_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_offline_sales FROM anon;
GRANT SELECT ON public.nexora_offline_sales TO authenticated;

DROP POLICY IF EXISTS "Staff can read offline sales" ON public.nexora_offline_sales;
CREATE POLICY "Staff can read offline sales"
ON public.nexora_offline_sales FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.sync_nexora_offline_sale(
  client_id_input uuid,
  items jsonb,
  method_input text,
  occurred_at_input timestamptz,
  guest_name_input text DEFAULT NULL
)
RETURNS TABLE(order_id uuid, order_number bigint, total_cop integer, already_synced boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_order_id uuid;
  v_total integer;
  v_when timestamptz;
  v_shift uuid;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para sincronizar las ventas';
  END IF;

  IF client_id_input IS NULL THEN
    RAISE EXCEPTION 'La venta no tiene identificador';
  END IF;

  -- Serializa reintentos simultáneos de la misma venta.
  PERFORM pg_advisory_xact_lock(hashtextextended(client_id_input::text, 0));

  SELECT s.order_id INTO v_existing FROM public.nexora_offline_sales s WHERE s.client_id = client_id_input;
  IF FOUND THEN
    RETURN QUERY
    SELECT o.id, o.order_number, o.total_cop, true
    FROM public.nexora_orders o WHERE o.id = v_existing;
    RETURN;
  END IF;

  IF method_input NOT IN ('cash', 'card') THEN
    RAISE EXCEPTION 'Sin internet solo se puede registrar efectivo o tarjeta';
  END IF;

  IF items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'La venta no tiene productos';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
    WHERE requested.product_id IS NULL OR requested.quantity IS NULL OR requested.quantity <= 0 OR requested.quantity > 100
  ) THEN
    RAISE EXCEPTION 'Las cantidades de la venta no son válidas';
  END IF;

  -- El producto debe existir, aunque hoy esté desactivado: la venta ya ocurrió.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
    LEFT JOIN public.nexora_products product ON product.id = requested.product_id
    WHERE product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Uno de los productos de la venta ya no existe en la carta';
  END IF;

  v_when := LEAST(COALESCE(occurred_at_input, now()), now());
  v_name := NULLIF(trim(guest_name_input), '');

  SELECT COALESCE(SUM(product.price_cop * requested.quantity), 0)::integer
  INTO v_total
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
  JOIN public.nexora_products product ON product.id = requested.product_id;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El total de la venta debe ser mayor a cero';
  END IF;

  INSERT INTO public.nexora_orders (order_type, status, payment_status, source, total_cop, guest_name, created_at, updated_at)
  VALUES ('takeaway', 'completed', 'paid', 'cashier', v_total, v_name, v_when, v_when)
  RETURNING id INTO v_order_id;

  INSERT INTO public.nexora_order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop, choices)
  SELECT v_order_id, product.id, product.name || public.nexora_choice_label(ch.ids), product.price_cop,
         requested.quantity, product.price_cop * requested.quantity, ch.ids
  FROM jsonb_to_recordset(items) AS requested(product_id uuid, quantity integer, choices jsonb)
  JOIN public.nexora_products product ON product.id = requested.product_id
  CROSS JOIN LATERAL (SELECT public.nexora_resolve_choices(product.id, requested.choices) AS ids) ch;

  -- Turno de caja que estaba abierto cuando se vendió; si no hay, el turno abierto ahora.
  SELECT s.id INTO v_shift
  FROM public.nexora_cash_shifts s
  WHERE s.opened_at <= v_when AND (s.closed_at IS NULL OR s.closed_at >= v_when)
  ORDER BY s.opened_at DESC
  LIMIT 1;

  IF v_shift IS NULL THEN
    SELECT s.id INTO v_shift FROM public.nexora_cash_shifts s WHERE s.status = 'open' LIMIT 1;
  END IF;

  INSERT INTO public.nexora_payments (order_id, method, status, amount_cop, shift_id, created_at)
  VALUES (v_order_id, method_input, 'paid', v_total, v_shift, v_when);

  -- Descuenta el inventario sin validar stock: la venta ya se hizo.
  PERFORM public.consume_nexora_order_inventory(v_order_id);

  INSERT INTO public.nexora_offline_sales (client_id, order_id, occurred_at)
  VALUES (client_id_input, v_order_id, v_when);

  RETURN QUERY
  SELECT o.id, o.order_number, o.total_cop, false
  FROM public.nexora_orders o WHERE o.id = v_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_nexora_offline_sale(uuid, jsonb, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_nexora_offline_sale(uuid, jsonb, text, timestamptz, text) TO authenticated;
