/*
  # Conexión con Meta (Facebook e Instagram)

  - nexora_meta_connection: una sola fila con la página de Facebook, el Instagram vinculado y el permiso (token) de la página.
    Nadie puede leerla desde la app (ni siquiera el propietario): solo la función meta-publish con la llave de servicio.
  - nexora_marketing_posts: columnas para el resultado de cada canal y el error de la última publicación.
  - Bucket público marketing-pieces: Meta necesita una dirección pública de la imagen para poder publicarla.
*/

CREATE TABLE IF NOT EXISTS public.nexora_meta_connection (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  page_id text NOT NULL,
  page_name text,
  ig_user_id text,
  ig_username text,
  page_token text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  connected_by uuid
);
ALTER TABLE public.nexora_meta_connection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_meta_connection FROM anon, authenticated;

ALTER TABLE public.nexora_marketing_posts
  ADD COLUMN IF NOT EXISTS publish_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS publish_error text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS publishing_since timestamptz;

DO $do$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('marketing-pieces', 'marketing-pieces', true)
    ON CONFLICT (id) DO UPDATE SET public = true;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.list_nexora_marketing_posts();
CREATE FUNCTION public.list_nexora_marketing_posts()
RETURNS TABLE(id uuid, kind text, product_id uuid, product_name text, headline text, caption text, price_original_cop integer,
              price_promo_cop integer, valid_to date, status text, rejection_reason text, created_at timestamptz,
              approved_at timestamptz, published_at timestamptz, publish_results jsonb, publish_error text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_marketing_can() THEN RAISE EXCEPTION 'No tienes permiso para ver marketing'; END IF;
  RETURN QUERY
  SELECT m.id, m.kind, m.product_id, p.name, m.headline, m.caption, m.price_original_cop, m.price_promo_cop, m.valid_to,
         m.status, m.rejection_reason, m.created_at, m.approved_at, m.published_at, m.publish_results, m.publish_error
  FROM public.nexora_marketing_posts m JOIN public.nexora_products p ON p.id = m.product_id
  WHERE m.status <> 'published' OR m.published_at >= now() - interval '60 days'
  ORDER BY CASE m.status WHEN 'draft' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END, m.created_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.list_nexora_marketing_posts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_nexora_marketing_posts() TO authenticated;

-- Si se edita una pieza aprobada, se borran los resultados de publicación para empezar de cero.
CREATE OR REPLACE FUNCTION public.update_nexora_marketing_post(post_id_input uuid, headline_input text, caption_input text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_marketing_can() THEN RAISE EXCEPTION 'No tienes permiso para editar publicaciones'; END IF;
  IF btrim(COALESCE(headline_input, '')) = '' OR btrim(COALESCE(caption_input, '')) = '' THEN RAISE EXCEPTION 'Falta el título o el texto'; END IF;
  UPDATE public.nexora_marketing_posts
     SET headline = btrim(headline_input), caption = btrim(caption_input), status = 'draft',
         approved_by = NULL, approved_at = NULL, rejection_reason = NULL, publish_results = '{}'::jsonb, publish_error = NULL
   WHERE id = post_id_input AND status IN ('draft', 'approved', 'rejected');
  IF NOT FOUND THEN RAISE EXCEPTION 'La publicación no existe o ya fue publicada'; END IF;
END;
$$;
