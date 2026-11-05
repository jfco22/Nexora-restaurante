/*
# Cash shifts (turnos de caja)

1. New table: nexora_cash_shifts
- One row per cash shift: opened_by, opened_at, opening_cash_cop (fondo inicial), status (open or closed),
  closed_by, closed_at, counted_cash_cop (efectivo contado), expected_cash_cop (efectivo esperado),
  difference_cop (diferencia = contado - esperado).
- A partial unique index guarantees only one open shift at a time.

2. Modified table: nexora_payments
- New column shift_id links each payment to the shift in which it was recorded.

3. Expected cash rule
- Expected cash = opening cash + cash payments recorded in the shift.
- Card and Bre-B payments never count toward expected cash.

4. Functions
- open_nexora_cash_shift(opening_cash_input): opens a shift when none is open.
- close_nexora_cash_shift(counted_cash_input): closes the open shift and stores the difference.
- get_nexora_open_shift_summary(): returns the open shift with its sales by method.
- register_nexora_payment: now requires an open shift and stores its id on the payment.

5. Security
- RLS enabled on the new table. Staff can read shifts; writes happen only through functions.
- Functions are SECURITY DEFINER, with fixed search path, executable by authenticated only.
*/

CREATE TABLE IF NOT EXISTS public.nexora_cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by uuid DEFAULT auth.uid(),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cash_cop integer NOT NULL CHECK (opening_cash_cop >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by uuid,
  closed_at timestamptz,
  counted_cash_cop integer,
  expected_cash_cop integer,
  difference_cop integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nexora_one_open_cash_shift
ON public.nexora_cash_shifts ((status))
WHERE status = 'open';

ALTER TABLE public.nexora_cash_shifts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nexora_cash_shifts FROM anon;
GRANT SELECT ON public.nexora_cash_shifts TO authenticated;

DROP POLICY IF EXISTS "Staff can read cash shifts" ON public.nexora_cash_shifts;
CREATE POLICY "Staff can read cash shifts"
ON public.nexora_cash_shifts FOR SELECT
TO authenticated
USING (true);

ALTER TABLE public.nexora_payments ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.nexora_cash_shifts(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS nexora_payments_shift_id_idx ON public.nexora_payments (shift_id);

CREATE OR REPLACE FUNCTION public.open_nexora_cash_shift(opening_cash_input integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_shift_id uuid;
BEGIN
  IF opening_cash_input IS NULL OR opening_cash_input < 0 THEN
    RAISE EXCEPTION 'El fondo inicial no es válido';
  END IF;

  IF EXISTS (SELECT 1 FROM public.nexora_cash_shifts s WHERE s.status = 'open') THEN
    RAISE EXCEPTION 'La caja ya está abierta';
  END IF;

  INSERT INTO public.nexora_cash_shifts (opened_by, opening_cash_cop, status)
  VALUES (auth.uid(), opening_cash_input, 'open')
  RETURNING id INTO new_shift_id;

  RETURN new_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_nexora_cash_shift(counted_cash_input integer)
RETURNS TABLE(expected_cash_cop integer, difference_cop integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_opening integer;
  v_cash_sales integer;
  v_expected integer;
BEGIN
  IF counted_cash_input IS NULL OR counted_cash_input < 0 THEN
    RAISE EXCEPTION 'El efectivo contado no es válido';
  END IF;

  SELECT s.id, s.opening_cash_cop INTO v_shift_id, v_opening
  FROM public.nexora_cash_shifts s
  WHERE s.status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una caja abierta';
  END IF;

  SELECT COALESCE(SUM(p.amount_cop), 0) INTO v_cash_sales
  FROM public.nexora_payments p
  WHERE p.shift_id = v_shift_id AND p.method = 'cash' AND p.status = 'paid';

  v_expected := v_opening + v_cash_sales;

  UPDATE public.nexora_cash_shifts s
  SET status = 'closed',
      closed_by = auth.uid(),
      closed_at = now(),
      counted_cash_cop = counted_cash_input,
      expected_cash_cop = v_expected,
      difference_cop = counted_cash_input - v_expected
  WHERE s.id = v_shift_id;

  RETURN QUERY SELECT v_expected, counted_cash_input - v_expected;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_nexora_open_shift_summary()
RETURNS TABLE(
  shift_id uuid,
  opened_at timestamptz,
  opening_cash_cop integer,
  cash_sales_cop integer,
  card_sales_cop integer,
  bre_b_paid_cop integer,
  bre_b_pending_cop integer,
  expected_cash_cop integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    s.id,
    s.opened_at,
    s.opening_cash_cop,
    COALESCE(SUM(p.amount_cop) FILTER (WHERE p.method = 'cash' AND p.status = 'paid'), 0)::integer,
    COALESCE(SUM(p.amount_cop) FILTER (WHERE p.method = 'card' AND p.status = 'paid'), 0)::integer,
    COALESCE(SUM(p.amount_cop) FILTER (WHERE p.method = 'bre_b' AND p.status = 'paid'), 0)::integer,
    COALESCE(SUM(p.amount_cop) FILTER (WHERE p.method = 'bre_b' AND p.status = 'pending'), 0)::integer,
    (s.opening_cash_cop + COALESCE(SUM(p.amount_cop) FILTER (WHERE p.method = 'cash' AND p.status = 'paid'), 0))::integer
  FROM public.nexora_cash_shifts s
  LEFT JOIN public.nexora_payments p ON p.shift_id = s.id
  WHERE s.status = 'open'
  GROUP BY s.id, s.opened_at, s.opening_cash_cop;
$$;

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
  v_shift_id uuid;
BEGIN
  SELECT s.id INTO v_shift_id
  FROM public.nexora_cash_shifts s
  WHERE s.status = 'open';

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Abre la caja antes de registrar cobros';
  END IF;

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

  INSERT INTO public.nexora_payments (order_id, method, status, amount_cop, reference, shift_id)
  VALUES (order_id_input, method_input, v_state, amount_input, v_reference, v_shift_id)
  RETURNING id INTO v_payment_id;

  RETURN QUERY SELECT v_payment_id, v_state;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.open_nexora_cash_shift(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_nexora_cash_shift(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_nexora_open_shift_summary() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_nexora_payment(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_nexora_cash_shift(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_nexora_cash_shift(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_nexora_open_shift_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_nexora_payment(uuid, text, integer, text) TO authenticated;
