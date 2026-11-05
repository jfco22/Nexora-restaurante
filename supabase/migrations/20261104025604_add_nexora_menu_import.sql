/*
# Import menu (products + categories) from spreadsheet

1. Summary
- New function import_nexora_menu(payload jsonb) that lets an owner or manager import the menu from a spreadsheet.
- The payload has two arrays: categories and products.
- Categories are matched by name (case-insensitive); if they exist, their description and sort_order are updated; if not, they are created.
- Products are matched by name (case-insensitive) within their category; if they exist, their price, description, image, and availability are updated; if not, they are created.
- Returns a summary: counts of categories and products created, updated, and skipped with reasons.

2. Security
- SECURITY DEFINER with SET search_path = public.
- EXECUTE revoked from PUBLIC and anon; granted to authenticated.
- Only owner or manager roles can call it.

3. Notes
- No data is deleted. Products not in the file keep their current state.
- Category names in the product rows must match an existing or newly-created category.
- Price must be a positive integer (Colombian pesos).
*/

CREATE OR REPLACE FUNCTION public.import_nexora_menu(payload jsonb)
RETURNS TABLE(categories_created integer, categories_updated integer, products_created integer, products_updated integer, products_skipped integer, details jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_categories jsonb;
  v_products jsonb;
  v_cat_row jsonb;
  v_prod_row jsonb;
  v_cat_name text;
  v_cat_desc text;
  v_cat_sort integer;
  v_cat_id uuid;
  v_prod_name text;
  v_prod_cat_name text;
  v_prod_desc text;
  v_prod_price integer;
  v_prod_image text;
  v_prod_available boolean;
  v_existing_cat_id uuid;
  v_existing_prod_id uuid;
  v_cats_created integer := 0;
  v_cats_updated integer := 0;
  v_prods_created integer := 0;
  v_prods_updated integer := 0;
  v_prods_skipped integer := 0;
  v_details jsonb := '[]'::jsonb;
  v_skip_reason text;
BEGIN
  SELECT p.role INTO v_caller_role FROM public.nexora_profiles p WHERE p.id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'No tienes permiso para importar el menú';
  END IF;

  v_categories := payload->'categories';
  v_products := payload->'products';

  -- Process categories
  IF v_categories IS NOT NULL AND jsonb_array_length(v_categories) > 0 THEN
    FOR v_cat_row IN SELECT jsonb_array_elements(v_categories)
    LOOP
      v_cat_name := btrim(v_cat_row->>'name');
      v_cat_desc := v_cat_row->>'description';
      v_cat_sort := COALESCE((v_cat_row->>'sort_order')::integer, 0);

      IF v_cat_name IS NULL OR v_cat_name = '' THEN
        CONTINUE;
      END IF;

      SELECT id INTO v_existing_cat_id FROM public.nexora_categories WHERE lower(name) = lower(v_cat_name) LIMIT 1;

      IF v_existing_cat_id IS NULL THEN
        INSERT INTO public.nexora_categories (name, description, sort_order, is_active)
        VALUES (v_cat_name, COALESCE(v_cat_desc, ''), v_cat_sort, true)
        RETURNING id INTO v_cat_id;
        v_cats_created := v_cats_created + 1;
      ELSE
        UPDATE public.nexora_categories
        SET name = v_cat_name,
            description = COALESCE(v_cat_desc, description),
            sort_order = v_cat_sort,
            is_active = true,
            updated_at = now()
        WHERE id = v_existing_cat_id;
        v_cat_id := v_existing_cat_id;
        v_cats_updated := v_cats_updated + 1;
      END IF;
    END LOOP;
  END IF;

  -- Process products
  IF v_products IS NULL OR jsonb_array_length(v_products) = 0 THEN
    RETURN QUERY SELECT v_cats_created, v_cats_updated, v_prods_created, v_prods_updated, v_prods_skipped, v_details;
  END IF;

  FOR v_prod_row IN SELECT jsonb_array_elements(v_products)
  LOOP
    v_prod_name := btrim(v_prod_row->>'name');
    v_prod_cat_name := btrim(v_prod_row->>'category');
    v_prod_desc := v_prod_row->>'description';
    v_prod_price := NULLIF(v_prod_row->>'price_cop', '')::integer;
    v_prod_image := v_prod_row->>'image_url';
    v_prod_available := COALESCE((v_prod_row->>'is_available')::boolean, true);
    v_skip_reason := NULL;

    IF v_prod_name IS NULL OR v_prod_name = '' THEN
      v_skip_reason := 'Falta el nombre del producto';
    ELSIF v_prod_cat_name IS NULL OR v_prod_cat_name = '' THEN
      v_skip_reason := 'Falta la categoría';
    ELSIF v_prod_price IS NULL OR v_prod_price <= 0 THEN
      v_skip_reason := 'Precio no válido (debe ser mayor a 0)';
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_prods_skipped := v_prods_skipped + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('name', v_prod_name, 'reason', v_skip_reason));
      CONTINUE;
    END IF;

    SELECT id INTO v_cat_id FROM public.nexora_categories WHERE lower(name) = lower(v_prod_cat_name) LIMIT 1;
    IF v_cat_id IS NULL THEN
      v_prods_skipped := v_prods_skipped + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('name', v_prod_name, 'reason', 'Categoría no encontrada: ' || v_prod_cat_name));
      CONTINUE;
    END IF;

    SELECT id INTO v_existing_prod_id FROM public.nexora_products WHERE lower(name) = lower(v_prod_name) LIMIT 1;

    IF v_existing_prod_id IS NULL THEN
      INSERT INTO public.nexora_products (category_id, name, description, price_cop, image_url, is_available, is_active)
      VALUES (v_cat_id, v_prod_name, COALESCE(v_prod_desc, ''), v_prod_price, NULLIF(v_prod_image, ''), v_prod_available, true);
      v_prods_created := v_prods_created + 1;
    ELSE
      UPDATE public.nexora_products
      SET category_id = v_cat_id,
          name = v_prod_name,
          description = COALESCE(v_prod_desc, description),
          price_cop = v_prod_price,
          image_url = COALESCE(NULLIF(v_prod_image, ''), image_url),
          is_available = v_prod_available,
          is_active = true,
          updated_at = now()
      WHERE id = v_existing_prod_id;
      v_prods_updated := v_prods_updated + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_cats_created, v_cats_updated, v_prods_created, v_prods_updated, v_prods_skipped, v_details;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_nexora_menu(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_nexora_menu(jsonb) TO authenticated;
