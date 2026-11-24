/*
  # Compras y gastos, detalle de ventas y reportes

  1. Nueva tabla nexora_expenses: gastos del restaurante (servicios, arriendo, transporte, etc.).
     Se crean y anulan solo con funciones; nunca se borran (la anulación guarda quién y por qué).
  2. Funciones de lectura para propietario y gerente (nexora_is_manager):
     - list_nexora_sales: cada pago recibido, uno a uno, con los productos del pedido.
     - list_nexora_purchases: compras de insumos (movimientos de inventario tipo compra) con su costo.
     - list_nexora_expenses: gastos del rango, incluidos los anulados.
     - nexora_report_summary: resumen del rango (ventas, medios de pago, días, productos, compras, gastos,
       horas pagadas y resultado).
  3. Los rangos se dan como fechas del día en Colombia (America/Bogota).
*/

CREATE TABLE IF NOT EXISTS public.nexora_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spent_on date NOT NULL,
  category text NOT NULL CHECK (category IN ('servicios', 'arriendo', 'transporte', 'mantenimiento', 'impuestos', 'publicidad', 'insumos_varios', 'otros')),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 200),
  supplier text CHECK (supplier IS NULL OR char_length(supplier) <= 120),
  amount_cop integer NOT NULL CHECK (amount_cop > 0 AND amount_cop <= 1000000000),
  method text NOT NULL DEFAULT 'efectivo' CHECK (method IN ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text
);

CREATE INDEX IF NOT EXISTS nexora_expenses_spent_on_idx ON public.nexora_expenses (spent_on);

ALTER TABLE public.nexora_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_expenses FROM anon, authenticated;
GRANT SELECT ON public.nexora_expenses TO authenticated;

DROP POLICY IF EXISTS "Managers read expenses" ON public.nexora_expenses;
CREATE POLICY "Managers read expenses" ON public.nexora_expenses
FOR SELECT TO authenticated USING (public.nexora_is_manager());

CREATE OR REPLACE FUNCTION public.create_nexora_expense(
  spent_on_input date, category_input text, description_input text, amount_input integer,
  method_input text DEFAULT 'efectivo', supplier_input text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.nexora_is_manager() THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede registrar gastos'; END IF;
  IF spent_on_input IS NULL THEN RAISE EXCEPTION 'Elige la fecha del gasto'; END IF;
  IF spent_on_input > (now() AT TIME ZONE 'America/Bogota')::date THEN RAISE EXCEPTION 'La fecha del gasto no puede ser futura'; END IF;
  IF amount_input IS NULL OR amount_input <= 0 THEN RAISE EXCEPTION 'El valor del gasto debe ser mayor a cero'; END IF;
  INSERT INTO public.nexora_expenses (spent_on, category, description, supplier, amount_cop, method)
  VALUES (spent_on_input, category_input, btrim(description_input), NULLIF(btrim(supplier_input), ''), amount_input, COALESCE(method_input, 'efectivo'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_nexora_expense(expense_id_input uuid, reason_input text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede anular gastos'; END IF;
  IF NULLIF(btrim(reason_input), '') IS NULL THEN RAISE EXCEPTION 'Escribe el motivo de la anulación'; END IF;
  UPDATE public.nexora_expenses SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(reason_input)
  WHERE id = expense_id_input AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'El gasto no existe o ya estaba anulado'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_nexora_expenses(range_from date, range_to date)
RETURNS TABLE(id uuid, spent_on date, category text, description text, supplier text, amount_cop integer, method text,
              created_at timestamptz, created_by_name text, voided_at timestamptz, void_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede ver los gastos'; END IF;
  RETURN QUERY
  SELECT e.id, e.spent_on, e.category, e.description, e.supplier, e.amount_cop, e.method, e.created_at,
         COALESCE(p.display_name, '—'), e.voided_at, e.void_reason
  FROM public.nexora_expenses e
  LEFT JOIN public.nexora_profiles p ON p.id = e.created_by
  WHERE e.spent_on BETWEEN range_from AND range_to
  ORDER BY e.spent_on DESC, e.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_nexora_purchases(range_from date, range_to date)
RETURNS TABLE(id uuid, created_at timestamptz, item_name text, unit text, quantity numeric, unit_cost_cop numeric,
              total_cop numeric, note text, created_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede ver las compras'; END IF;
  RETURN QUERY
  SELECT m.id, m.created_at, i.name, i.unit, m.quantity, m.unit_cost_cop,
         round(m.quantity * COALESCE(m.unit_cost_cop, 0)), m.note, COALESCE(p.display_name, '—')
  FROM public.nexora_inventory_movements m
  JOIN public.nexora_inventory_items i ON i.id = m.item_id
  LEFT JOIN public.nexora_profiles p ON p.id = m.created_by
  WHERE m.kind = 'purchase' AND (m.created_at AT TIME ZONE 'America/Bogota')::date BETWEEN range_from AND range_to
  ORDER BY m.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_nexora_sales(range_from date, range_to date)
RETURNS TABLE(payment_id uuid, paid_at timestamptz, order_id uuid, order_number bigint, order_type text, table_name text,
              guest_name text, method text, amount_cop integer, reference text, cashier_name text, was_offline boolean, items jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede ver el detalle de ventas'; END IF;
  RETURN QUERY
  SELECT pay.id, pay.created_at, o.id, o.order_number, o.order_type, t.name, o.guest_name, pay.method, pay.amount_cop, pay.reference,
         COALESCE(pr.display_name, '—'),
         EXISTS (SELECT 1 FROM public.nexora_offline_sales s WHERE s.order_id = o.id),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('name', oi.product_name, 'quantity', oi.quantity,
                                                       'unit_price_cop', oi.unit_price_cop, 'line_total_cop', oi.line_total_cop)
                                    ORDER BY oi.created_at, oi.product_name)
                   FROM public.nexora_order_items oi WHERE oi.order_id = o.id), '[]'::jsonb)
  FROM public.nexora_payments pay
  JOIN public.nexora_orders o ON o.id = pay.order_id
  LEFT JOIN public.nexora_tables t ON t.id = o.table_id
  LEFT JOIN public.nexora_profiles pr ON pr.id = pay.recorded_by
  WHERE pay.status = 'paid' AND (pay.created_at AT TIME ZONE 'America/Bogota')::date BETWEEN range_from AND range_to
  ORDER BY pay.created_at DESC
  LIMIT 5000;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_report_summary(range_from date, range_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_purchases numeric; v_expenses integer; v_work integer; v_exp_cat jsonb; v_sales jsonb;
BEGIN
  IF NOT public.nexora_is_manager() THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede ver los reportes'; END IF;

  WITH pay AS (
    SELECT p.order_id, p.method, p.amount_cop AS amount, (p.created_at AT TIME ZONE 'America/Bogota')::date AS day
    FROM public.nexora_payments p
    WHERE p.status = 'paid' AND (p.created_at AT TIME ZONE 'America/Bogota')::date BETWEEN range_from AND range_to
  )
  SELECT jsonb_build_object(
    'sales_total', COALESCE((SELECT sum(amount) FROM pay), 0),
    'payments_count', (SELECT count(*) FROM pay),
    'orders_count', (SELECT count(DISTINCT order_id) FROM pay),
    'by_method', COALESCE((SELECT jsonb_agg(jsonb_build_object('method', method, 'total', total, 'count', n) ORDER BY total DESC)
                           FROM (SELECT method, sum(amount) AS total, count(*) AS n FROM pay GROUP BY method) x), '[]'::jsonb),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'total', total, 'count', n) ORDER BY day)
                        FROM (SELECT day, sum(amount) AS total, count(*) AS n FROM pay GROUP BY day) x), '[]'::jsonb),
    'top_products', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'quantity', qty, 'total', total) ORDER BY qty DESC, name)
                              FROM (SELECT oi.product_name AS name, sum(oi.quantity) AS qty, sum(oi.line_total_cop) AS total
                                    FROM public.nexora_order_items oi
                                    WHERE oi.order_id IN (SELECT order_id FROM pay)
                                    GROUP BY oi.product_name ORDER BY sum(oi.quantity) DESC LIMIT 15) x), '[]'::jsonb)
  ) INTO v_sales;

  SELECT COALESCE(sum(round(m.quantity * COALESCE(m.unit_cost_cop, 0))), 0) INTO v_purchases
  FROM public.nexora_inventory_movements m
  WHERE m.kind = 'purchase' AND (m.created_at AT TIME ZONE 'America/Bogota')::date BETWEEN range_from AND range_to;

  SELECT COALESCE(sum(amount_cop), 0) INTO v_expenses FROM public.nexora_expenses
  WHERE voided_at IS NULL AND spent_on BETWEEN range_from AND range_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'total', total) ORDER BY total DESC), '[]'::jsonb)
  INTO v_exp_cat FROM (SELECT category, sum(amount_cop) AS total FROM public.nexora_expenses
                       WHERE voided_at IS NULL AND spent_on BETWEEN range_from AND range_to GROUP BY category) x;

  SELECT COALESCE(sum(amount_cop), 0) INTO v_work FROM public.nexora_work_payments
  WHERE voided_at IS NULL AND (paid_at AT TIME ZONE 'America/Bogota')::date BETWEEN range_from AND range_to;

  RETURN v_sales || jsonb_build_object(
    'purchases_total', v_purchases, 'expenses_total', v_expenses, 'expenses_by_category', v_exp_cat,
    'work_paid_total', v_work,
    'result', (v_sales->>'sales_total')::numeric - v_purchases - v_expenses - v_work
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_nexora_expense(date, text, text, integer, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.void_nexora_expense(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_expenses(date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_purchases(date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_sales(date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nexora_report_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_nexora_expense(date, text, text, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_nexora_expense(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_expenses(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_purchases(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_sales(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_report_summary(date, date) TO authenticated;
