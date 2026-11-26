/*
  # Asistente predictivo (aprende de tus propios datos, sin servicios externos)

  1. nexora_learned_shelf_life(): cuántos días duran de verdad los insumos antes de perderse. Mira cada merma
     registrada y calcula cuántos días llevaba guardado lo que se botó (lo que entró primero sale primero).
  2. nexora_assistant_insights(): alertas automáticas por insumo. Usa el límite que tú pusiste o, si no hay,
     el aprendido de tus mermas. Además predice: con el ritmo al que se gasta (últimos 28 días), ¿alcanza a
     usarse antes del límite? Si no, avisa cuánto sobraría. Sin límite, compara con la rotación normal.
  3. record_nexora_assistant_feedback(): el equipo marca cada alerta como "ya la atendí" (se oculta 24 horas)
     o "falsa alarma" (si pasa varias veces en 30 días, el asistente se vuelve menos sensible con ese insumo).
  4. nexora_purchase_forecast(): cuánto se va a gastar cada insumo en los próximos días (promedio del mismo día
     de la semana en las últimas semanas), para cuántos días alcanza el stock y cuánto conviene comprar, sin
     pasarse de lo que dura.
  5. nexora_sales_forecast(): ventas esperadas por día (promedio del mismo día de la semana, en días que se abrió).
  Permisos: propietario, gerente, inventario y cocina; las ventas esperadas, solo propietario y gerente.
*/

CREATE TABLE IF NOT EXISTS public.nexora_assistant_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.nexora_inventory_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('handled', 'false_alarm')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS nexora_assistant_notes_item_idx ON public.nexora_assistant_notes (item_id, created_at DESC);
ALTER TABLE public.nexora_assistant_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_assistant_notes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.nexora_assistant_allowed(only_managers boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nexora_profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (CASE WHEN only_managers THEN ARRAY['owner', 'manager'] ELSE ARRAY['owner', 'manager', 'inventory', 'kitchen'] END)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.nexora_assistant_allowed(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_assistant_allowed(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_nexora_assistant_feedback(item_id_input uuid, kind_input text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_assistant_allowed() THEN RAISE EXCEPTION 'No tienes permiso para responder alertas'; END IF;
  IF kind_input NOT IN ('handled', 'false_alarm') THEN RAISE EXCEPTION 'Respuesta no válida'; END IF;
  INSERT INTO public.nexora_assistant_notes (item_id, kind) VALUES (item_id_input, kind_input);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_nexora_assistant_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_nexora_assistant_feedback(uuid, text) TO authenticated;

-- Días que llevaba guardado lo que se botó (mermas), por insumo.
CREATE OR REPLACE FUNCTION public.nexora_learned_shelf_life()
RETURNS TABLE(item_id uuid, avg_waste_age_days numeric, waste_events integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_assistant_allowed() THEN RAISE EXCEPTION 'No tienes permiso para ver el asistente'; END IF;
  RETURN QUERY
  WITH active AS (
    SELECT i.id, i.current_stock, i.created_at FROM public.nexora_inventory_items i WHERE i.is_active
  ),
  moved AS (SELECT m.item_id, sum(m.quantity) AS net FROM public.nexora_inventory_movements m GROUP BY m.item_id),
  layers_raw AS (
    SELECT m.item_id, m.created_at AS at, m.quantity AS qty
    FROM public.nexora_inventory_movements m WHERE m.quantity > 0 AND m.item_id IN (SELECT a.id FROM active a)
    UNION ALL
    SELECT a.id, a.created_at, a.current_stock - COALESCE(mv.net, 0)
    FROM active a LEFT JOIN moved mv ON mv.item_id = a.id WHERE a.current_stock - COALESCE(mv.net, 0) > 0
  ),
  layers AS (
    SELECT l.item_id, l.at, l.qty,
           sum(l.qty) OVER (PARTITION BY l.item_id ORDER BY l.at, l.qty DESC ROWS UNBOUNDED PRECEDING) AS layer_end
    FROM layers_raw l
  ),
  outflows AS (
    SELECT m.item_id, m.created_at AS at, m.kind, -m.quantity AS qty,
           sum(-m.quantity) OVER (PARTITION BY m.item_id ORDER BY m.created_at, m.id ROWS UNBOUNDED PRECEDING) - (-m.quantity) AS cum_start
    FROM public.nexora_inventory_movements m WHERE m.quantity < 0 AND m.item_id IN (SELECT a.id FROM active a)
  ),
  waste_age AS (
    SELECT w.item_id, extract(epoch FROM (w.at - l.at)) / 86400.0 AS age
    FROM outflows w
    JOIN layers l ON l.item_id = w.item_id AND l.layer_end - l.qty <= w.cum_start AND l.layer_end > w.cum_start
    WHERE w.kind = 'waste' AND w.at >= now() - interval '180 days'
  )
  SELECT wa.item_id, round(avg(wa.age)::numeric, 1), count(*)::integer
  FROM waste_age wa WHERE wa.age >= 0 GROUP BY wa.item_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nexora_learned_shelf_life() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_learned_shelf_life() TO authenticated;

CREATE OR REPLACE FUNCTION public.nexora_assistant_insights()
RETURNS TABLE(
  item_id uuid, name text, unit text, current_stock numeric, oldest_age_days numeric,
  limit_days numeric, limit_source text, daily_use numeric, at_risk_qty numeric,
  level text, reason text, used_in text[], waste_events integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_assistant_allowed() THEN RAISE EXCEPTION 'No tienes permiso para ver el asistente'; END IF;
  RETURN QUERY
  WITH base AS (SELECT * FROM public.nexora_stock_freshness()),
  learned AS (SELECT * FROM public.nexora_learned_shelf_life()),
  usage AS (
    SELECT m.item_id,
           sum(-m.quantity) FILTER (WHERE m.kind = 'consumption' AND m.created_at >= now() - interval '28 days') AS used28,
           least(28, greatest(7, extract(epoch FROM (now() - min(m.created_at))) / 86400.0)) AS window_days
    FROM public.nexora_inventory_movements m GROUP BY m.item_id
  ),
  notes AS (
    SELECT n.item_id,
           count(*) FILTER (WHERE n.kind = 'false_alarm' AND n.created_at >= now() - interval '30 days') AS false_n,
           bool_or(n.kind = 'handled' AND n.created_at >= now() - interval '24 hours') AS snoozed
    FROM public.nexora_assistant_notes n GROUP BY n.item_id
  ),
  calc AS (
    SELECT b.item_id, b.name, b.unit, b.current_stock, b.oldest_age_days AS age, b.level AS base_level, b.reason AS base_reason,
           b.used_in, COALESCE(le.waste_events, 0) AS waste_events,
           CASE WHEN b.shelf_life_days IS NOT NULL THEN b.shelf_life_days::numeric
                WHEN le.waste_events >= 2 AND le.avg_waste_age_days > 0 THEN round(le.avg_waste_age_days * 0.85, 1) END AS lim_raw,
           CASE WHEN b.shelf_life_days IS NOT NULL THEN 'tu límite'
                WHEN le.waste_events >= 2 AND le.avg_waste_age_days > 0 THEN 'aprendido de tus mermas' END AS src,
           1 + 0.2 * least(COALESCE(nt.false_n, 0), 3) AS factor,
           COALESCE(nt.snoozed, false) AS snoozed,
           CASE WHEN us.used28 IS NOT NULL AND us.used28 > 0 THEN us.used28 / us.window_days ELSE 0 END AS rate
    FROM base b
    LEFT JOIN learned le ON le.item_id = b.item_id
    LEFT JOIN usage us ON us.item_id = b.item_id
    LEFT JOIN notes nt ON nt.item_id = b.item_id
  ),
  calc2 AS (
    SELECT c.*, c.lim_raw * c.factor AS lim,
           CASE WHEN c.lim_raw IS NOT NULL THEN c.lim_raw * c.factor - c.age END AS remaining
    FROM calc c
  ),
  calc3 AS (
    SELECT c.*,
           CASE WHEN c.lim IS NOT NULL THEN greatest(c.current_stock - c.rate * greatest(c.remaining, 0), 0) ELSE 0 END AS at_risk
    FROM calc2 c
  )
  SELECT c.item_id, c.name, c.unit, c.current_stock, c.age,
         round(c.lim, 1), c.src, round(c.rate, 2), round(c.at_risk, 1),
    CASE
      WHEN c.snoozed THEN 'ok'
      WHEN c.lim IS NOT NULL AND c.age > c.lim THEN 'alert'
      WHEN c.lim IS NOT NULL AND c.rate > 0 AND c.at_risk >= 0.5 * c.current_stock AND c.remaining <= 3 THEN 'alert'
      WHEN c.lim IS NOT NULL AND c.remaining <= 1 THEN 'watch'
      WHEN c.lim IS NOT NULL AND c.rate > 0 AND c.at_risk >= 0.25 * c.current_stock AND c.remaining <= 3 THEN 'watch'
      WHEN c.lim IS NOT NULL THEN 'ok'
      ELSE c.base_level
    END,
    CASE
      WHEN c.snoozed THEN NULL
      WHEN c.lim IS NOT NULL AND c.age > c.lim
        THEN format('Lleva %s días guardado y el límite es %s (%s): haz promoción o úsalo ya.', trim_scale(c.age), trim_scale(round(c.lim, 1)), c.src)
      WHEN c.lim IS NOT NULL AND c.rate > 0 AND c.at_risk >= 0.25 * c.current_stock AND c.remaining <= 3
        THEN format('Al ritmo que lo gastas (~%s por día) no alcanza a usarse antes de los %s días (%s): podrían sobrar ~%s.',
                    trim_scale(round(c.rate, CASE WHEN c.rate < 1 THEN 2 ELSE 1 END)), trim_scale(round(c.lim, 1)), c.src, trim_scale(round(c.at_risk, 0)))
      WHEN c.lim IS NOT NULL AND c.remaining <= 1
        THEN format('Lleva %s días; el límite es %s (%s). Piensa en una promoción.', trim_scale(c.age), trim_scale(round(c.lim, 1)), c.src)
      WHEN c.lim IS NOT NULL THEN NULL
      ELSE c.base_reason
    END,
    c.used_in, c.waste_events
  FROM calc3 c
  ORDER BY
    CASE WHEN c.snoozed THEN 3 ELSE 0 END,
    CASE WHEN c.lim IS NOT NULL AND c.age > c.lim THEN 0 ELSE 1 END,
    c.age DESC NULLS LAST, c.name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nexora_assistant_insights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_assistant_insights() TO authenticated;

CREATE OR REPLACE FUNCTION public.nexora_purchase_forecast(horizon_days integer DEFAULT 7)
RETURNS TABLE(
  item_id uuid, name text, unit text, current_stock numeric, need_qty numeric, days_of_cover numeric,
  suggest_buy numeric, horizon_used integer, history_days integer, confidence text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT public.nexora_assistant_allowed() THEN RAISE EXCEPTION 'No tienes permiso para ver el asistente'; END IF;
  IF horizon_days IS NULL OR horizon_days < 1 OR horizon_days > 30 THEN RAISE EXCEPTION 'El horizonte debe estar entre 1 y 30 días'; END IF;

  RETURN QUERY
  WITH daily AS (
    SELECT m.item_id, (m.created_at AT TIME ZONE 'America/Bogota')::date AS d, sum(-m.quantity) AS qty
    FROM public.nexora_inventory_movements m
    WHERE m.kind = 'consumption' AND m.created_at >= now() - interval '57 days'
    GROUP BY m.item_id, (m.created_at AT TIME ZONE 'America/Bogota')::date
  ),
  hist AS (
    SELECT dl.item_id, least(min(dl.d), v_today - 56) AS start_d, min(dl.d) AS first_d, sum(dl.qty) AS total
    FROM daily dl WHERE dl.d < v_today GROUP BY dl.item_id
  ),
  series AS (
    SELECT h.item_id, g::date AS d, extract(dow FROM g)::integer AS dow
    FROM hist h, LATERAL generate_series(greatest(h.first_d, v_today - 56), v_today - 1, interval '1 day') g
  ),
  by_dow AS (
    SELECT s.item_id, s.dow, avg(COALESCE(dl.qty, 0)) AS avg_qty
    FROM series s LEFT JOIN daily dl ON dl.item_id = s.item_id AND dl.d = s.d
    GROUP BY s.item_id, s.dow
  ),
  horizon AS (
    SELECT h.item_id, n.n, COALESCE(bd.avg_qty, 0) AS need
    FROM hist h CROSS JOIN LATERAL generate_series(1, horizon_days) AS n(n)
    LEFT JOIN by_dow bd ON bd.item_id = h.item_id AND bd.dow = extract(dow FROM (v_today + n.n))::integer
  ),
  limits AS (
    SELECT i.id AS item_id, i.shelf_life_days::numeric AS manual, le.avg_waste_age_days, le.waste_events
    FROM public.nexora_inventory_items i LEFT JOIN public.nexora_learned_shelf_life() le ON le.item_id = i.id
  ),
  lim AS (
    SELECT l.item_id,
           CASE WHEN l.manual IS NOT NULL THEN l.manual
                WHEN l.waste_events >= 2 AND l.avg_waste_age_days > 0 THEN round(l.avg_waste_age_days * 0.85, 1) END AS days
    FROM limits l
  ),
  per_item AS (
    SELECT i.id, i.name, i.unit, i.current_stock, h.first_d,
           least(horizon_days, COALESCE(ceil(lm.days)::integer, horizon_days)) AS hz,
           (SELECT COALESCE(sum(x.need), 0) FROM horizon x WHERE x.item_id = i.id AND x.n <= least(horizon_days, COALESCE(ceil(lm.days)::integer, horizon_days))) AS need_hz,
           (SELECT min(x.n) FROM (
              SELECT hz2.n, sum(hz2.need) OVER (ORDER BY hz2.n) AS cum FROM horizon hz2 WHERE hz2.item_id = i.id
            ) x WHERE x.cum > GREATEST(i.current_stock, 0)) AS first_short,
           (SELECT sum(hz3.need) FROM horizon hz3 WHERE hz3.item_id = i.id) AS need_all
    FROM public.nexora_inventory_items i
    JOIN hist h ON h.item_id = i.id
    LEFT JOIN lim lm ON lm.item_id = i.id
    WHERE i.is_active
  )
  SELECT p.id, p.name, p.unit, p.current_stock, round(p.need_all, 1),
    CASE WHEN p.first_short IS NULL THEN NULL
         ELSE round((p.first_short - 1) + (GREATEST(p.current_stock, 0) -
              (SELECT COALESCE(sum(y.need), 0) FROM horizon y WHERE y.item_id = p.id AND y.n < p.first_short)) /
              NULLIF((SELECT y2.need FROM horizon y2 WHERE y2.item_id = p.id AND y2.n = p.first_short), 0), 1) END,
    CASE
      WHEN p.unit = 'unidad' THEN ceil(GREATEST(p.need_hz - GREATEST(p.current_stock, 0), 0))
      WHEN p.unit IN ('g', 'ml') THEN ceil(GREATEST(p.need_hz - GREATEST(p.current_stock, 0), 0) / 10.0) * 10
      ELSE ceil(GREATEST(p.need_hz - GREATEST(p.current_stock, 0), 0) * 10) / 10.0
    END,
    p.hz,
    (v_today - p.first_d)::integer,
    CASE WHEN (v_today - p.first_d) < 14 THEN 'baja' WHEN (v_today - p.first_d) < 42 THEN 'media' ELSE 'alta' END
  FROM per_item p
  WHERE p.need_all > 0
  ORDER BY (p.first_short IS NULL), p.first_short, p.name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nexora_purchase_forecast(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_purchase_forecast(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.nexora_sales_forecast(days_ahead integer DEFAULT 7)
RETURNS TABLE(day date, expected_cop numeric, low_cop numeric, high_cop numeric, days_used integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT public.nexora_assistant_allowed(true) THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede ver las ventas esperadas'; END IF;
  IF days_ahead IS NULL OR days_ahead < 1 OR days_ahead > 14 THEN RAISE EXCEPTION 'Elige entre 1 y 14 días'; END IF;
  RETURN QUERY
  WITH sales AS (
    SELECT (p.created_at AT TIME ZONE 'America/Bogota')::date AS d, sum(p.amount_cop) AS total
    FROM public.nexora_payments p
    WHERE p.status = 'paid' AND p.created_at >= now() - interval '57 days'
      AND (p.created_at AT TIME ZONE 'America/Bogota')::date < v_today
    GROUP BY (p.created_at AT TIME ZONE 'America/Bogota')::date
  ),
  by_dow AS (
    SELECT extract(dow FROM s.d)::integer AS dow, avg(s.total) AS avg_total, min(s.total) AS lo, max(s.total) AS hi, count(*)::integer AS n
    FROM sales s GROUP BY extract(dow FROM s.d)
  )
  SELECT (v_today + g.n)::date, round(COALESCE(b.avg_total, 0)), COALESCE(b.lo, 0)::numeric, COALESCE(b.hi, 0)::numeric, COALESCE(b.n, 0)
  FROM generate_series(1, days_ahead) AS g(n)
  LEFT JOIN by_dow b ON b.dow = extract(dow FROM (v_today + g.n))::integer
  ORDER BY 1;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nexora_sales_forecast(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_sales_forecast(integer) TO authenticated;
