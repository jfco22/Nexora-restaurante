/*
# Pago de horas trabajadas

Correr DESPUÉS de 20261124000000_add_nexora_work_time.sql.

- nexora_work_rates: valor de la hora de cada persona (lo define el propietario/gerente).
- nexora_work_payments: cada pago generado: persona, rango de fechas, minutos, valor por hora, monto, forma de pago, nota, quién y cuándo.
  Un pago anulado (voided_at) libera sus horas para volver a pagarlas; no se borra, queda como historial.
- nexora_work_sessions.payment_id: marca qué turnos ya fueron pagados y en qué pago. Así se ve día por día, y semana por semana, qué está pagado y qué no.

Reglas:
- Solo propietario y gerente pagan, ven pagos, definen valores por hora y corrigen turnos.
- Se pagan solo turnos cerrados y sin pagar dentro del rango (por fecha de entrada, hora de Colombia). Los turnos en curso quedan pendientes.
- Un turno ya pagado no se puede corregir: primero se anula el pago.
- El monto es minutos × valor por hora ÷ 60, redondeado al peso.
*/

CREATE TABLE IF NOT EXISTS public.nexora_work_rates (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hourly_rate_cop integer NOT NULL CHECK (hourly_rate_cop >= 0 AND hourly_rate_cop <= 10000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

CREATE TABLE IF NOT EXISTS public.nexora_work_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  hourly_rate_cop integer NOT NULL CHECK (hourly_rate_cop > 0),
  amount_cop integer NOT NULL CHECK (amount_cop >= 0),
  method text NOT NULL DEFAULT 'efectivo' CHECK (method IN ('efectivo', 'transferencia', 'otro')),
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  paid_by uuid DEFAULT auth.uid(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  CONSTRAINT work_payment_dates CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS nexora_work_payments_user_idx ON public.nexora_work_payments (user_id, paid_at DESC);

ALTER TABLE public.nexora_work_sessions
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.nexora_work_payments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS nexora_work_sessions_payment_idx ON public.nexora_work_sessions (payment_id);

ALTER TABLE public.nexora_work_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexora_work_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_work_rates FROM anon, authenticated;
REVOKE ALL ON public.nexora_work_payments FROM anon, authenticated;
GRANT SELECT ON public.nexora_work_rates TO authenticated;
GRANT SELECT ON public.nexora_work_payments TO authenticated;

DROP POLICY IF EXISTS "Managers read work rates" ON public.nexora_work_rates;
CREATE POLICY "Managers read work rates" ON public.nexora_work_rates
  FOR SELECT TO authenticated USING (public.nexora_is_manager());

DROP POLICY IF EXISTS "Managers read work payments" ON public.nexora_work_payments;
CREATE POLICY "Managers read work payments" ON public.nexora_work_payments
  FOR SELECT TO authenticated USING (public.nexora_is_manager());

CREATE OR REPLACE FUNCTION public.set_nexora_work_rate(user_id_input uuid, rate_input integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede definir el valor de la hora';
  END IF;
  IF rate_input IS NULL OR rate_input < 0 OR rate_input > 10000000 THEN
    RAISE EXCEPTION 'El valor de la hora debe ser un número entre 0 y 10.000.000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nexora_profiles WHERE id = user_id_input) THEN
    RAISE EXCEPTION 'Esa persona no existe';
  END IF;
  INSERT INTO public.nexora_work_rates (user_id, hourly_rate_cop, updated_at, updated_by)
  VALUES (user_id_input, rate_input, now(), auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET hourly_rate_cop = EXCLUDED.hourly_rate_cop, updated_at = now(), updated_by = auth.uid();
END;
$$;

-- Todo el equipo con su valor por hora (0 si no se ha definido).
CREATE OR REPLACE FUNCTION public.list_nexora_work_rates()
RETURNS TABLE(user_id uuid, display_name text, role text, hourly_rate_cop integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede ver los valores por hora';
  END IF;
  RETURN QUERY
  SELECT p.id, p.display_name, p.role, COALESCE(r.hourly_rate_cop, 0)
  FROM public.nexora_profiles p
  LEFT JOIN public.nexora_work_rates r ON r.user_id = p.id
  ORDER BY p.display_name;
END;
$$;

-- El reporte ahora indica qué turnos están pagados y el valor por hora actual.
DROP FUNCTION IF EXISTS public.get_nexora_work_report(date, date, uuid);
CREATE FUNCTION public.get_nexora_work_report(from_date date, to_date date, user_filter uuid DEFAULT NULL)
RETURNS TABLE(
  session_id uuid, user_id uuid, display_name text, role text, device_name text,
  started_at timestamptz, ended_at timestamptz, minutes integer, is_live boolean,
  adjusted boolean, adjust_note text, paid boolean, payment_id uuid, hourly_rate_cop integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager boolean := public.nexora_is_manager();
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión para ver las horas'; END IF;
  IF from_date IS NULL OR to_date IS NULL OR to_date < from_date THEN
    RAISE EXCEPTION 'El rango de fechas no es válido: la fecha final no puede ser anterior a la inicial';
  END IF;
  IF to_date - from_date > 366 THEN
    RAISE EXCEPTION 'Elige un rango de máximo un año';
  END IF;
  v_from := from_date::timestamp AT TIME ZONE 'America/Bogota';
  v_to := (to_date + 1)::timestamp AT TIME ZONE 'America/Bogota';

  RETURN QUERY
  SELECT s.id, s.user_id, COALESCE(p.display_name, 'Usuario'), COALESCE(p.role, ''), d.name,
         s.started_at, s.ended_at,
         GREATEST(0, round(extract(epoch FROM (COALESCE(s.ended_at, s.last_seen_at) - s.started_at)) / 60.0))::integer,
         (s.ended_at IS NULL AND s.last_seen_at > now() - interval '5 minutes'),
         (s.adjusted_by IS NOT NULL), s.adjust_note,
         (s.payment_id IS NOT NULL), s.payment_id,
         CASE WHEN v_manager THEN COALESCE(r.hourly_rate_cop, 0) ELSE 0 END
  FROM public.nexora_work_sessions s
  LEFT JOIN public.nexora_profiles p ON p.id = s.user_id
  LEFT JOIN public.nexora_work_devices d ON d.id = s.device_id
  LEFT JOIN public.nexora_work_rates r ON r.user_id = s.user_id
  WHERE s.started_at >= v_from AND s.started_at < v_to
    AND (CASE WHEN v_manager THEN (user_filter IS NULL OR s.user_id = user_filter) ELSE s.user_id = auth.uid() END)
  ORDER BY s.started_at DESC;
END;
$$;

-- Un turno pagado no se corrige sin anular antes el pago.
CREATE OR REPLACE FUNCTION public.adjust_nexora_work_session(session_id_input uuid, started_at_input timestamptz, ended_at_input timestamptz, note_input text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_payment uuid;
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede corregir horas';
  END IF;
  IF char_length(btrim(coalesce(note_input, ''))) < 3 THEN
    RAISE EXCEPTION 'Escribe el motivo de la corrección (mínimo 3 letras)';
  END IF;
  IF started_at_input IS NULL OR ended_at_input IS NULL OR ended_at_input <= started_at_input THEN
    RAISE EXCEPTION 'La salida debe ser posterior a la entrada';
  END IF;
  IF ended_at_input > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'La salida no puede estar en el futuro';
  END IF;
  SELECT s.user_id, s.payment_id INTO v_user, v_payment FROM public.nexora_work_sessions s WHERE s.id = session_id_input;
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ese turno no existe'; END IF;
  IF v_payment IS NOT NULL THEN
    RAISE EXCEPTION 'Ese turno ya fue pagado. Anula primero el pago (en Pagos realizados) y luego corrígelo';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.nexora_work_sessions o
    WHERE o.user_id = v_user AND o.id <> session_id_input
      AND o.started_at < ended_at_input AND COALESCE(o.ended_at, o.last_seen_at) > started_at_input
  ) THEN
    RAISE EXCEPTION 'Ese horario se cruza con otro turno de la misma persona';
  END IF;
  UPDATE public.nexora_work_sessions
  SET started_at = started_at_input, ended_at = ended_at_input, last_seen_at = GREATEST(last_seen_at, ended_at_input),
      end_reason = 'corregido', adjusted_by = auth.uid(), adjusted_at = now(), adjust_note = btrim(note_input)
  WHERE id = session_id_input;
END;
$$;

-- Genera el pago de las horas SIN PAGAR de una persona entre dos fechas (inclusive).
-- Para pagar una semana, se envía lunes a domingo.
CREATE OR REPLACE FUNCTION public.pay_nexora_work_hours(
  user_id_input uuid, from_date_input date, to_date_input date,
  method_input text DEFAULT 'efectivo', note_input text DEFAULT NULL, rate_input integer DEFAULT NULL
)
RETURNS TABLE(payment_id uuid, minutes integer, amount_cop integer, sessions integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_minutes integer;
  v_count integer;
  v_rate integer;
  v_amount integer;
  v_payment uuid;
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede pagar horas';
  END IF;
  IF user_id_input IS NULL OR NOT EXISTS (SELECT 1 FROM public.nexora_profiles WHERE id = user_id_input) THEN
    RAISE EXCEPTION 'Elige a la persona que vas a pagar';
  END IF;
  IF from_date_input IS NULL OR to_date_input IS NULL OR to_date_input < from_date_input THEN
    RAISE EXCEPTION 'El rango de fechas no es válido: la fecha final no puede ser anterior a la inicial';
  END IF;
  IF to_date_input - from_date_input > 366 THEN
    RAISE EXCEPTION 'Elige un rango de máximo un año';
  END IF;
  IF method_input NOT IN ('efectivo', 'transferencia', 'otro') THEN
    RAISE EXCEPTION 'La forma de pago debe ser efectivo, transferencia u otro';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(user_id_input::text, 2));

  v_from := from_date_input::timestamp AT TIME ZONE 'America/Bogota';
  v_to := (to_date_input + 1)::timestamp AT TIME ZONE 'America/Bogota';

  -- Turnos que quedaron abiertos y sin señal: se cierran en su última señal para poder pagarlos.
  UPDATE public.nexora_work_sessions
  SET ended_at = last_seen_at, end_reason = 'sin señal'
  WHERE user_id = user_id_input AND ended_at IS NULL AND last_seen_at <= now() - interval '5 minutes';

  SELECT COALESCE(SUM(GREATEST(0, round(extract(epoch FROM (s.ended_at - s.started_at)) / 60.0))), 0)::integer, count(*)::integer
  INTO v_minutes, v_count
  FROM public.nexora_work_sessions s
  WHERE s.user_id = user_id_input AND s.payment_id IS NULL AND s.ended_at IS NOT NULL
    AND s.started_at >= v_from AND s.started_at < v_to;

  IF v_count = 0 OR v_minutes <= 0 THEN
    RAISE EXCEPTION 'No hay horas sin pagar de esa persona en ese rango (los turnos en curso se pagan cuando terminen)';
  END IF;

  v_rate := COALESCE(rate_input, (SELECT r.hourly_rate_cop FROM public.nexora_work_rates r WHERE r.user_id = user_id_input), 0);
  IF v_rate <= 0 THEN
    RAISE EXCEPTION 'Define primero el valor por hora de esta persona';
  END IF;
  IF v_rate > 10000000 THEN
    RAISE EXCEPTION 'El valor de la hora es demasiado alto';
  END IF;

  v_amount := round(v_minutes * v_rate / 60.0)::integer;

  INSERT INTO public.nexora_work_payments (user_id, from_date, to_date, minutes, hourly_rate_cop, amount_cop, method, note)
  VALUES (user_id_input, from_date_input, to_date_input, v_minutes, v_rate, v_amount, method_input, NULLIF(btrim(note_input), ''))
  RETURNING id INTO v_payment;

  UPDATE public.nexora_work_sessions s
  SET payment_id = v_payment
  WHERE s.user_id = user_id_input AND s.payment_id IS NULL AND s.ended_at IS NOT NULL
    AND s.started_at >= v_from AND s.started_at < v_to;

  RETURN QUERY SELECT v_payment, v_minutes, v_amount, v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_nexora_work_payments(range_from date, range_to date, user_filter uuid DEFAULT NULL)
RETURNS TABLE(
  payment_id uuid, user_id uuid, display_name text, from_date date, to_date date, minutes integer,
  hourly_rate_cop integer, amount_cop integer, method text, note text, paid_at timestamptz,
  paid_by_name text, voided_at timestamptz, void_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede ver los pagos';
  END IF;
  IF range_from IS NULL OR range_to IS NULL OR range_to < range_from THEN
    RAISE EXCEPTION 'El rango de fechas no es válido: la fecha final no puede ser anterior a la inicial';
  END IF;
  -- Pagos cuyo periodo se cruza con el rango pedido.
  RETURN QUERY
  SELECT w.id, w.user_id, COALESCE(p.display_name, 'Usuario'), w.from_date, w.to_date, w.minutes,
         w.hourly_rate_cop, w.amount_cop, w.method, w.note, w.paid_at,
         COALESCE(b.display_name, 'Administrador'), w.voided_at, w.void_reason
  FROM public.nexora_work_payments w
  LEFT JOIN public.nexora_profiles p ON p.id = w.user_id
  LEFT JOIN public.nexora_profiles b ON b.id = w.paid_by
  WHERE w.from_date <= range_to AND w.to_date >= range_from
    AND (user_filter IS NULL OR w.user_id = user_filter)
  ORDER BY w.paid_at DESC;
END;
$$;

-- Anula un pago: las horas vuelven a quedar sin pagar. El pago queda en el historial.
CREATE OR REPLACE FUNCTION public.void_nexora_work_payment(payment_id_input uuid, reason_input text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voided timestamptz;
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede anular pagos';
  END IF;
  IF char_length(btrim(coalesce(reason_input, ''))) < 3 THEN
    RAISE EXCEPTION 'Escribe el motivo de la anulación (mínimo 3 letras)';
  END IF;
  SELECT voided_at INTO v_voided FROM public.nexora_work_payments WHERE id = payment_id_input;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese pago no existe'; END IF;
  IF v_voided IS NOT NULL THEN RAISE EXCEPTION 'Ese pago ya estaba anulado'; END IF;
  UPDATE public.nexora_work_sessions SET payment_id = NULL WHERE payment_id = payment_id_input;
  UPDATE public.nexora_work_payments
  SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(reason_input)
  WHERE id = payment_id_input;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_nexora_work_rate(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_work_rates() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_nexora_work_report(date, date, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_nexora_work_session(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pay_nexora_work_hours(uuid, date, date, text, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_work_payments(date, date, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.void_nexora_work_payment(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_nexora_work_rate(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_work_rates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_nexora_work_report(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_nexora_work_session(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_nexora_work_hours(uuid, date, date, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_work_payments(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_nexora_work_payment(uuid, text) TO authenticated;
