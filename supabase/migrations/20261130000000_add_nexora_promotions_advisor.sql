/*
  # Asesor de promociones (por insumo)

  Decide qué insumos del inventario hay que "mover" con una promoción, combinando:
  - 40 % lo que se va a vencer (alertas del asistente: límite de días, mermas aprendidas, rotación).
  - 60 % lo que más inventario hay (valor en pesos = stock x costo; el insumo con más plata parada = 100 %.
    Si un insumo no tiene costo, se compara su cantidad contra el mayor stock de su misma unidad).
  Puntaje de 0 a 100; se sugieren los de 35 o más. Cada sugerencia dice en qué platos se usa el insumo.

  Tabla nexora_promotions: promociones aceptadas o descartadas por insumo.
  - Activar: queda activa N días y deja de sugerirse mientras dure.
  - Ahora no: la oculta 3 días.

  Permisos: ver, propietario, gerente y marketing; activar/terminar, solo propietario y gerente.
*/

-- Marketing también puede consultar al asistente (lo necesita el asesor).
CREATE OR REPLACE FUNCTION public.nexora_assistant_allowed(only_managers boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nexora_profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (CASE WHEN only_managers THEN ARRAY['owner', 'manager'] ELSE ARRAY['owner', 'manager', 'inventory', 'kitchen', 'marketing'] END)
  );
$$;

-- La alerta de frescura también debe poder leerla marketing.
DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'nexora_stock_freshness';
  IF d IS NOT NULL AND d NOT LIKE '%''marketing''%' THEN
    EXECUTE replace(d, '''inventory'', ''kitchen'')', '''inventory'', ''kitchen'', ''marketing'')');
  END IF;
END
$do$;

DROP TABLE IF EXISTS public.nexora_promotions CASCADE;
CREATE TABLE public.nexora_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.nexora_inventory_items(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'ended', 'dismissed')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  score numeric,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
CREATE INDEX nexora_promotions_item_idx ON public.nexora_promotions (item_id, ends_on DESC);
ALTER TABLE public.nexora_promotions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_promotions FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.nexora_promotion_suggestions(integer, numeric);
DROP FUNCTION IF EXISTS public.accept_nexora_promotion(uuid, integer, integer, text, numeric);
DROP FUNCTION IF EXISTS public.list_nexora_promotions();
DROP FUNCTION IF EXISTS public.dismiss_nexora_promotion(uuid);
DROP FUNCTION IF EXISTS public.end_nexora_promotion(uuid);

CREATE OR REPLACE FUNCTION public.nexora_promotion_suggestions(max_results integer DEFAULT 8, expiry_weight numeric DEFAULT 0.4)
RETURNS TABLE(
  item_id uuid, name text, unit text, current_stock numeric, stock_value_cop numeric, cost_known boolean,
  expiry_score numeric, inventory_score numeric, score numeric, at_risk_qty numeric, reason text, used_in text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nexora_profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager', 'marketing')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver las promociones sugeridas';
  END IF;
  IF expiry_weight IS NULL OR expiry_weight < 0 OR expiry_weight > 1 THEN RAISE EXCEPTION 'El peso debe estar entre 0 y 1'; END IF;

  RETURN QUERY
  WITH ins AS (SELECT * FROM public.nexora_assistant_insights()),
  base AS (
    SELECT it.id, it.name, it.unit::text AS unit, it.current_stock, it.unit_cost_cop,
           it.current_stock * it.unit_cost_cop AS value,
           CASE i.level WHEN 'alert' THEN 1.0 WHEN 'watch' THEN 0.6
                ELSE CASE WHEN i.limit_days IS NOT NULL AND i.limit_days > 0 AND i.oldest_age_days IS NOT NULL
                          THEN least(i.oldest_age_days / i.limit_days, 1.0) * 0.4 ELSE 0 END END AS u,
           i.reason AS why, COALESCE(i.at_risk_qty, 0) AS at_risk, COALESCE(i.used_in, ARRAY[]::text[]) AS used_in
    FROM public.nexora_inventory_items it
    LEFT JOIN ins i ON i.item_id = it.id
    WHERE it.is_active AND it.current_stock > 0
      AND NOT EXISTS (SELECT 1 FROM public.nexora_promotions pr
                      WHERE pr.item_id = it.id AND pr.ends_on >= v_today AND pr.status IN ('active', 'dismissed'))
  ),
  mx AS (
    SELECT max(b.value) AS mv FROM base b
  ),
  mu AS (
    SELECT b.unit, max(b.current_stock) AS ms FROM base b GROUP BY b.unit
  ),
  sc AS (
    SELECT b.*, COALESCE(b.u, 0) AS ex,
           CASE WHEN b.unit_cost_cop > 0 AND mx.mv > 0 THEN b.value / mx.mv
                ELSE b.current_stock / NULLIF(mu.ms, 0) END AS inv
    FROM base b CROSS JOIN mx LEFT JOIN mu ON mu.unit = b.unit
  )
  SELECT s.id, s.name, s.unit, s.current_stock, round(s.value, 0), s.unit_cost_cop > 0,
         round(s.ex::numeric * 100, 0), round(COALESCE(s.inv, 0)::numeric * 100, 0),
         round((expiry_weight * s.ex + (1 - expiry_weight) * COALESCE(s.inv, 0))::numeric * 100, 0),
         s.at_risk,
         trim(concat_ws(' ',
           CASE WHEN s.ex >= 0.6 THEN format('Se va a vencer: %s', s.why) END,
           CASE WHEN COALESCE(s.inv, 0) >= 0.3 THEN
             CASE WHEN s.unit_cost_cop > 0 THEN format('Es de lo que más inventario tienes (%s en stock).', '$' || to_char(round(s.value), 'FM999G999G999'))
                  ELSE 'Es de lo que más cantidad tienes.' END END,
           CASE WHEN s.unit_cost_cop = 0 THEN 'No tiene costo registrado: la comparación es por cantidad.' END)),
         s.used_in
  FROM sc s
  WHERE (expiry_weight * s.ex + (1 - expiry_weight) * COALESCE(s.inv, 0)) >= 0.35
  ORDER BY (expiry_weight * s.ex + (1 - expiry_weight) * COALESCE(s.inv, 0)) DESC, s.name
  LIMIT greatest(max_results, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_nexora_promotion(item_id_input uuid, days_input integer, reason_input text DEFAULT NULL, score_input numeric DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT public.nexora_assistant_allowed(true) THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede crear promociones'; END IF;
  IF days_input IS NULL OR days_input < 1 OR days_input > 60 THEN RAISE EXCEPTION 'La promoción debe durar entre 1 y 60 días'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nexora_inventory_items WHERE id = item_id_input) THEN RAISE EXCEPTION 'El insumo no existe'; END IF;
  IF EXISTS (SELECT 1 FROM public.nexora_promotions WHERE item_id = item_id_input AND status = 'active' AND ends_on >= v_today) THEN
    RAISE EXCEPTION 'Ese insumo ya tiene una promoción activa';
  END IF;
  INSERT INTO public.nexora_promotions (item_id, status, starts_on, ends_on, score, reason)
  VALUES (item_id_input, 'active', v_today, v_today + (days_input - 1), score_input, NULLIF(btrim(reason_input), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_nexora_promotion(item_id_input uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT public.nexora_assistant_allowed(true) THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede descartar sugerencias'; END IF;
  INSERT INTO public.nexora_promotions (item_id, status, starts_on, ends_on) VALUES (item_id_input, 'dismissed', v_today, v_today + 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.end_nexora_promotion(promotion_id_input uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_assistant_allowed(true) THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede terminar promociones'; END IF;
  UPDATE public.nexora_promotions SET status = 'ended', ends_on = least(ends_on, (now() AT TIME ZONE 'America/Bogota')::date - 1)
  WHERE id = promotion_id_input AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'La promoción no existe o ya terminó'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_nexora_promotions()
RETURNS TABLE(id uuid, item_id uuid, name text, unit text, current_stock numeric, starts_on date, ends_on date, status text,
              reason text, is_current boolean, used_in text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nexora_profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager', 'marketing')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver las promociones';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.item_id, it.name, it.unit::text, it.current_stock, pr.starts_on, pr.ends_on, pr.status, pr.reason,
         (pr.status = 'active' AND pr.ends_on >= v_today),
         COALESCE((SELECT array_agg(DISTINCT pd.name ORDER BY pd.name) FROM public.nexora_product_recipes r
                   JOIN public.nexora_products pd ON pd.id = r.product_id WHERE r.item_id = it.id AND pd.is_active), ARRAY[]::text[])
  FROM public.nexora_promotions pr JOIN public.nexora_inventory_items it ON it.id = pr.item_id
  WHERE pr.status IN ('active', 'ended') AND pr.ends_on >= v_today - 30
  ORDER BY (pr.status = 'active' AND pr.ends_on >= v_today) DESC, pr.ends_on DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.nexora_promotion_suggestions(integer, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_nexora_promotion(uuid, integer, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dismiss_nexora_promotion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_nexora_promotion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_promotions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_promotion_suggestions(integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_nexora_promotion(uuid, integer, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_nexora_promotion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_nexora_promotion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_promotions() TO authenticated;
