/*
  # Asesor de promociones

  Decide qué promociones deberían existir combinando dos señales:
  - 40 % lo que se va a vencer (alertas del asistente: límite de días, mermas aprendidas, rotación).
  - 60 % lo que más inventario hay (valor en pesos del stock de cada ingrediente, el más grande = 100 %).
  Cada producto con receta recibe un puntaje de 0 a 100; los de mayor puntaje se sugieren.
  - Solo se sugieren productos que se pueden preparar hoy (alcanza el stock) y activos.
  - El descuento sugerido sube con el puntaje (10 / 20 / 30 %) pero nunca baja el precio por debajo del costo
    de los ingredientes más 15 % de margen (si los costos están registrados).

  Tabla nexora_promotions: registra las promociones aceptadas o descartadas.
  - Aceptar crea la promoción (activa por N días) y deja de sugerirse mientras dure.
  - Descartar la oculta 3 días.
  Importante: la promoción queda registrada y visible, pero NO cambia el precio en caja; el descuento se aplica
  a mano al cobrar hasta que se conecte con la caja.

  Permisos: ver sugerencias, propietario, gerente y marketing; aceptar/terminar, solo propietario y gerente.
*/

-- Marketing también puede consultar al asistente (lo necesita el asesor de promociones).
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


-- La alerta de frescura también debe poder leerla marketing (la usa el asesor de promociones).
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

CREATE TABLE IF NOT EXISTS public.nexora_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.nexora_products(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'ended', 'dismissed')),
  discount_pct integer CHECK (discount_pct IS NULL OR discount_pct BETWEEN 5 AND 60),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  score numeric,
  reason text,
  source text NOT NULL DEFAULT 'assistant' CHECK (source IN ('assistant', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS nexora_promotions_product_idx ON public.nexora_promotions (product_id, ends_on DESC);
ALTER TABLE public.nexora_promotions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_promotions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.nexora_promotion_suggestions(max_results integer DEFAULT 8, expiry_weight numeric DEFAULT 0.4)
RETURNS TABLE(
  product_id uuid, product_name text, price_cop integer, cost_cop numeric, portions_possible integer,
  expiry_score numeric, inventory_score numeric, score numeric,
  suggested_discount_pct integer, promo_price_cop integer, cost_known boolean,
  expiry_item text, inventory_item text, reason text
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
  urg AS (
    SELECT i.item_id,
           CASE i.level WHEN 'alert' THEN 1.0 WHEN 'watch' THEN 0.6
                ELSE CASE WHEN i.limit_days IS NOT NULL AND i.limit_days > 0 AND i.oldest_age_days IS NOT NULL
                          THEN least(i.oldest_age_days / i.limit_days, 1.0) * 0.4 ELSE 0 END END AS u,
           i.reason AS why
    FROM ins i
  ),
  val AS (
    SELECT it.id, it.current_stock * it.unit_cost_cop AS value
    FROM public.nexora_inventory_items it WHERE it.is_active AND it.current_stock > 0
  ),
  maxv AS (SELECT max(v.value) AS m FROM val v),
  lines AS (
    SELECT r.product_id AS pid, it.name AS iname, r.quantity, it.current_stock, it.unit_cost_cop,
           COALESCE(u.u, 0) AS u, u.why,
           COALESCE(v.value / NULLIF(m.m, 0), 0) AS abund, COALESCE(v.value, 0) AS value
    FROM public.nexora_product_recipes r
    JOIN public.nexora_inventory_items it ON it.id = r.item_id AND it.is_active
    LEFT JOIN urg u ON u.item_id = it.id
    LEFT JOIN val v ON v.id = it.id
    CROSS JOIN maxv m
    WHERE r.quantity > 0
  ),
  prod AS (
    SELECT p.id, p.name, p.price_cop,
           min(floor(l.current_stock / l.quantity))::integer AS portions,
           sum(l.quantity * l.unit_cost_cop) AS cost,
           bool_and(l.unit_cost_cop > 0) AS cost_known,
           max(l.u) AS exp_score, max(l.abund) AS inv_score,
           (array_agg(l.iname ORDER BY l.u DESC, l.iname))[1] AS exp_item,
           (array_agg(l.why ORDER BY l.u DESC, l.iname))[1] AS exp_why,
           (array_agg(l.iname ORDER BY l.abund DESC, l.iname))[1] AS inv_item,
           (array_agg(l.value ORDER BY l.abund DESC, l.iname))[1] AS inv_value
    FROM public.nexora_products p JOIN lines l ON l.pid = p.id
    WHERE p.is_active AND p.is_available
      AND NOT EXISTS (SELECT 1 FROM public.nexora_promotions pr
                      WHERE pr.product_id = p.id AND pr.ends_on >= v_today AND pr.status IN ('active', 'dismissed'))
    GROUP BY p.id, p.name, p.price_cop
  ),
  scored AS (
    SELECT pr.*, expiry_weight * pr.exp_score + (1 - expiry_weight) * pr.inv_score AS total FROM prod pr WHERE pr.portions >= 1
  ),
  priced AS (
    SELECT s.*,
      CASE WHEN s.total >= 0.75 THEN 30 WHEN s.total >= 0.55 THEN 20 WHEN s.total >= 0.35 THEN 10 ELSE 0 END AS want,
      CASE WHEN s.cost_known AND s.price_cop > 0
           THEN greatest(floor((1 - (s.cost * 1.15) / s.price_cop) * 100 / 5) * 5, 0)
           ELSE 60 END AS cap
    FROM scored s
  )
  SELECT p.id, p.name, p.price_cop, round(p.cost, 0), p.portions,
         round(p.exp_score::numeric * 100, 0), round(p.inv_score::numeric * 100, 0), round(p.total::numeric * 100, 0),
         least(p.want, p.cap::integer)::integer,
         (round(p.price_cop * (1 - least(p.want, p.cap) / 100.0) / 50.0) * 50)::integer,
         p.cost_known,
         CASE WHEN p.exp_score >= 0.4 THEN p.exp_item END,
         CASE WHEN p.inv_score >= 0.3 THEN p.inv_item END,
         trim(concat_ws(' ',
           CASE WHEN p.exp_score >= 0.6 THEN format('Se va a vencer: %s.', COALESCE(p.exp_why, p.exp_item)) END,
           CASE WHEN p.inv_score >= 0.3 THEN format('Es de lo que más inventario tienes: %s (%s en stock).', p.inv_item, '$' || to_char(round(p.inv_value), 'FM999G999G999')) END,
           CASE WHEN p.exp_score < 0.6 AND p.inv_score < 0.3 THEN 'Se mueve lento comparado con el resto.' END,
           CASE WHEN NOT p.cost_known THEN 'Faltan costos de ingredientes: revisa que el descuento no deje pérdida.' END))
  FROM priced p
  WHERE p.want >= 10 AND least(p.want, p.cap) >= 5
  ORDER BY p.total DESC, p.name
  LIMIT greatest(max_results, 1);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nexora_promotion_suggestions(integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_promotion_suggestions(integer, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_nexora_promotion(product_id_input uuid, discount_input integer, days_input integer, reason_input text DEFAULT NULL, score_input numeric DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT public.nexora_assistant_allowed(true) THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede crear promociones'; END IF;
  IF discount_input IS NULL OR discount_input < 5 OR discount_input > 60 THEN RAISE EXCEPTION 'El descuento debe estar entre 5 y 60 %%'; END IF;
  IF days_input IS NULL OR days_input < 1 OR days_input > 60 THEN RAISE EXCEPTION 'La promoción debe durar entre 1 y 60 días'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nexora_products WHERE id = product_id_input) THEN RAISE EXCEPTION 'El producto no existe'; END IF;
  IF EXISTS (SELECT 1 FROM public.nexora_promotions WHERE product_id = product_id_input AND status = 'active' AND ends_on >= v_today) THEN
    RAISE EXCEPTION 'Ese producto ya tiene una promoción activa';
  END IF;
  INSERT INTO public.nexora_promotions (product_id, status, discount_pct, starts_on, ends_on, score, reason)
  VALUES (product_id_input, 'active', discount_input, v_today, v_today + (days_input - 1), score_input, NULLIF(btrim(reason_input), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_nexora_promotion(product_id_input uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT public.nexora_assistant_allowed(true) THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede descartar sugerencias'; END IF;
  INSERT INTO public.nexora_promotions (product_id, status, starts_on, ends_on) VALUES (product_id_input, 'dismissed', v_today, v_today + 2);
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
RETURNS TABLE(id uuid, product_id uuid, product_name text, price_cop integer, discount_pct integer, promo_price_cop integer,
              starts_on date, ends_on date, status text, reason text, is_current boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nexora_profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager', 'marketing')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver las promociones';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.product_id, p.name, p.price_cop, pr.discount_pct,
         (round(p.price_cop * (1 - pr.discount_pct / 100.0) / 50.0) * 50)::integer,
         pr.starts_on, pr.ends_on, pr.status, pr.reason, (pr.status = 'active' AND pr.ends_on >= v_today)
  FROM public.nexora_promotions pr JOIN public.nexora_products p ON p.id = pr.product_id
  WHERE pr.status IN ('active', 'ended') AND pr.ends_on >= v_today - 30
  ORDER BY (pr.status = 'active' AND pr.ends_on >= v_today) DESC, pr.ends_on DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_nexora_promotion(uuid, integer, integer, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dismiss_nexora_promotion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_nexora_promotion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_promotions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_nexora_promotion(uuid, integer, integer, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_nexora_promotion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_nexora_promotion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_promotions() TO authenticated;
