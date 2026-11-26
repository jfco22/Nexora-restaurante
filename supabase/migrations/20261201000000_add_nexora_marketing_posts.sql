/*
  # Módulo de marketing: publicaciones de promociones (posts y stories)

  A partir de las promociones activas (insumos que hay que mover) se proponen platos del menú que los llevan,
  con precio promocional calculado del precio real de la carta:
  - El descuento es de 1.000 a 3.000 pesos (más cuanto mayor es el puntaje de la promoción), redondeado a 500.
  - Nunca pasa del 35 % del precio del plato y nunca deja el precio por debajo del costo + 15 % (si hay costos).
  - Si un plato es tan barato que no cabe un descuento de 1.000 con esas reglas, no se propone.
  Cada pieza (post o story) nace como borrador y NO puede marcarse como publicada hasta que propietario o gerente
  la apruebe. Esta versión no publica sola en Facebook/Instagram: se descarga la pieza y se marca como publicada.

  Permisos: crear/editar borradores, propietario, gerente y marketing. Aprobar/rechazar, propietario y gerente.
*/

CREATE TABLE IF NOT EXISTS public.nexora_marketing_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('post', 'story')),
  promotion_id uuid REFERENCES public.nexora_promotions(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.nexora_products(id) ON DELETE CASCADE,
  headline text NOT NULL,
  caption text NOT NULL,
  price_original_cop integer NOT NULL CHECK (price_original_cop > 0),
  price_promo_cop integer NOT NULL CHECK (price_promo_cop > 0),
  valid_to date NOT NULL,
  channels text[] NOT NULL DEFAULT ARRAY['instagram', 'facebook'],
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'published')),
  rejection_reason text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  CONSTRAINT nexora_marketing_discount_range CHECK (price_original_cop - price_promo_cop BETWEEN 1000 AND 3000)
);
CREATE INDEX IF NOT EXISTS nexora_marketing_posts_status_idx ON public.nexora_marketing_posts (status, created_at DESC);
ALTER TABLE public.nexora_marketing_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_marketing_posts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.nexora_marketing_can(only_managers boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nexora_profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (CASE WHEN only_managers THEN ARRAY['owner', 'manager'] ELSE ARRAY['owner', 'manager', 'marketing'] END)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.nexora_marketing_can(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_marketing_can(boolean) TO authenticated;

-- Platos que se pueden promocionar hoy, con su precio promocional.
CREATE OR REPLACE FUNCTION public.nexora_marketing_candidates()
RETURNS TABLE(
  promotion_id uuid, item_name text, valid_to date, score numeric,
  product_id uuid, product_name text, price_cop integer, discount_cop integer, promo_price_cop integer,
  has_open_post boolean, note text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NOT public.nexora_marketing_can() THEN RAISE EXCEPTION 'No tienes permiso para ver el módulo de marketing'; END IF;
  RETURN QUERY
  WITH cand AS (
    SELECT pr.id AS pid, it.name AS iname, pr.ends_on, COALESCE(pr.score, 50) AS sc,
           p.id AS prod, p.name AS pname, p.price_cop AS price,
           (SELECT sum(r2.quantity * i2.unit_cost_cop) FROM public.nexora_product_recipes r2
              JOIN public.nexora_inventory_items i2 ON i2.id = r2.item_id WHERE r2.product_id = p.id) AS cost,
           (SELECT bool_and(i2.unit_cost_cop > 0) FROM public.nexora_product_recipes r2
              JOIN public.nexora_inventory_items i2 ON i2.id = r2.item_id WHERE r2.product_id = p.id) AS cost_known
    FROM public.nexora_promotions pr
    JOIN public.nexora_inventory_items it ON it.id = pr.item_id
    JOIN public.nexora_product_recipes r ON r.item_id = it.id
    JOIN public.nexora_products p ON p.id = r.product_id AND p.is_active AND p.is_available AND p.price_cop > 0
    WHERE pr.status = 'active' AND pr.ends_on >= v_today
  ),
  calc AS (
    SELECT c.*,
           least(3000, greatest(1000, round((1000 + (c.sc - 35) / 65.0 * 2000) / 500.0) * 500))::integer AS want,
           (floor(c.price * 0.35 / 500.0) * 500)::integer AS cap_pct,
           CASE WHEN c.cost_known AND c.cost IS NOT NULL THEN (floor((c.price - c.cost * 1.15) / 500.0) * 500)::integer ELSE 3000 END AS cap_margin
    FROM cand c
  )
  SELECT k.pid, k.iname, k.ends_on, k.sc, k.prod, k.pname, k.price,
         CASE WHEN least(k.want, k.cap_pct, k.cap_margin, 3000) >= 1000 THEN least(k.want, k.cap_pct, k.cap_margin, 3000) END,
         CASE WHEN least(k.want, k.cap_pct, k.cap_margin, 3000) >= 1000 THEN k.price - least(k.want, k.cap_pct, k.cap_margin, 3000) END,
         EXISTS (SELECT 1 FROM public.nexora_marketing_posts mp WHERE mp.promotion_id = k.pid AND mp.product_id = k.prod AND mp.status IN ('draft', 'approved')),
         CASE WHEN least(k.want, k.cap_pct, k.cap_margin, 3000) < 1000
              THEN CASE WHEN k.cap_pct < 1000 THEN 'El plato es muy barato para descontar mínimo $1.000.' ELSE 'El descuento de $1.000 dejaría el plato casi sin margen.' END END
  FROM calc k
  ORDER BY k.sc DESC, k.pname;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_nexora_marketing_post(
  kind_input text, promotion_id_input uuid, product_id_input uuid, headline_input text, caption_input text,
  price_promo_input integer, valid_to_input date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_price integer; v_id uuid;
BEGIN
  IF NOT public.nexora_marketing_can() THEN RAISE EXCEPTION 'No tienes permiso para crear publicaciones'; END IF;
  IF kind_input NOT IN ('post', 'story') THEN RAISE EXCEPTION 'El tipo debe ser post o story'; END IF;
  IF btrim(COALESCE(headline_input, '')) = '' OR btrim(COALESCE(caption_input, '')) = '' THEN RAISE EXCEPTION 'Falta el título o el texto'; END IF;
  SELECT price_cop INTO v_price FROM public.nexora_products WHERE id = product_id_input AND is_active;
  IF v_price IS NULL THEN RAISE EXCEPTION 'El plato no existe o no está activo'; END IF;
  IF v_price - price_promo_input < 1000 OR v_price - price_promo_input > 3000 THEN
    RAISE EXCEPTION 'El descuento debe ser de $1.000 a $3.000 sobre el precio de la carta (%)', v_price;
  END IF;
  INSERT INTO public.nexora_marketing_posts (kind, promotion_id, product_id, headline, caption, price_original_cop, price_promo_cop, valid_to)
  VALUES (kind_input, promotion_id_input, product_id_input, btrim(headline_input), btrim(caption_input), v_price, price_promo_input, valid_to_input)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_nexora_marketing_post(post_id_input uuid, headline_input text, caption_input text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_marketing_can() THEN RAISE EXCEPTION 'No tienes permiso para editar publicaciones'; END IF;
  IF btrim(COALESCE(headline_input, '')) = '' OR btrim(COALESCE(caption_input, '')) = '' THEN RAISE EXCEPTION 'Falta el título o el texto'; END IF;
  -- Editar una pieza aprobada o rechazada la devuelve a borrador: hay que aprobarla de nuevo.
  UPDATE public.nexora_marketing_posts
     SET headline = btrim(headline_input), caption = btrim(caption_input), status = 'draft',
         approved_by = NULL, approved_at = NULL, rejection_reason = NULL
   WHERE id = post_id_input AND status IN ('draft', 'approved', 'rejected');
  IF NOT FOUND THEN RAISE EXCEPTION 'La publicación no existe o ya fue publicada'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_nexora_marketing_post(post_id_input uuid, approve_input boolean, reason_input text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_marketing_can(true) THEN RAISE EXCEPTION 'Solo el propietario o el gerente puede aprobar publicaciones'; END IF;
  IF NOT approve_input AND btrim(COALESCE(reason_input, '')) = '' THEN RAISE EXCEPTION 'Escribe por qué se rechaza'; END IF;
  UPDATE public.nexora_marketing_posts
     SET status = CASE WHEN approve_input THEN 'approved' ELSE 'rejected' END,
         approved_by = CASE WHEN approve_input THEN auth.uid() END,
         approved_at = CASE WHEN approve_input THEN now() END,
         rejection_reason = CASE WHEN approve_input THEN NULL ELSE btrim(reason_input) END
   WHERE id = post_id_input AND status IN ('draft', 'approved', 'rejected');
  IF NOT FOUND THEN RAISE EXCEPTION 'La publicación no existe o ya fue publicada'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_nexora_marketing_post(post_id_input uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_marketing_can() THEN RAISE EXCEPTION 'No tienes permiso para publicar'; END IF;
  UPDATE public.nexora_marketing_posts SET status = 'published', published_at = now()
   WHERE id = post_id_input AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Solo se puede marcar como publicada una pieza aprobada'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_nexora_marketing_post(post_id_input uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_marketing_can() THEN RAISE EXCEPTION 'No tienes permiso'; END IF;
  DELETE FROM public.nexora_marketing_posts WHERE id = post_id_input AND status IN ('draft', 'rejected');
  IF NOT FOUND THEN RAISE EXCEPTION 'Solo se pueden borrar borradores o rechazadas'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_nexora_marketing_posts()
RETURNS TABLE(id uuid, kind text, product_id uuid, product_name text, headline text, caption text, price_original_cop integer,
              price_promo_cop integer, valid_to date, status text, rejection_reason text, created_at timestamptz,
              approved_at timestamptz, published_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_marketing_can() THEN RAISE EXCEPTION 'No tienes permiso para ver marketing'; END IF;
  RETURN QUERY
  SELECT m.id, m.kind, m.product_id, p.name, m.headline, m.caption, m.price_original_cop, m.price_promo_cop, m.valid_to,
         m.status, m.rejection_reason, m.created_at, m.approved_at, m.published_at
  FROM public.nexora_marketing_posts m JOIN public.nexora_products p ON p.id = m.product_id
  WHERE m.status <> 'published' OR m.published_at >= now() - interval '60 days'
  ORDER BY CASE m.status WHEN 'draft' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END, m.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.nexora_marketing_candidates() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_nexora_marketing_post(text, uuid, uuid, text, text, integer, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_nexora_marketing_post(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_nexora_marketing_post(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.publish_nexora_marketing_post(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_nexora_marketing_post(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_marketing_posts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_marketing_candidates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_nexora_marketing_post(text, uuid, uuid, text, text, integer, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_nexora_marketing_post(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_nexora_marketing_post(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_nexora_marketing_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_nexora_marketing_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_marketing_posts() TO authenticated;
