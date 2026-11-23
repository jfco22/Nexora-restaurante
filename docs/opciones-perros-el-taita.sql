-- Opciones de los perros con carne a escoger (El Taita).
-- CORRER DESPUÉS de: 1) la migración "product_option_choices", 2) importar el menú, 3) tener cargados los insumos
-- (Res mechada, Pollo desmechado, Champiñones, Hogao, Tomate, Cebolla blanca).
-- Se puede correr varias veces: reemplaza las opciones y las cantidades.
DO $$
DECLARE
  missing text[] := '{}';
  v_choice uuid;
  v_prod uuid;
  r record;
  l record;
  v_item uuid;
  v_pos int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Res mechada',          'Res mechada',      60::numeric),
    ('Carne con guiso',      'Res mechada',      60),
    ('Carne con guiso',      'Tomate',           50),
    ('Carne con guiso',      'Cebolla blanca',   0.25),
    ('Pollo con champiñones','Pollo desmechado', 30),
    ('Pollo con champiñones','Champiñones',      30),
    ('Chorizo con hogao',    'Hogao',60)
  ) AS t(choice_name, item_name, qty)
  LOOP
    SELECT id INTO v_item FROM public.nexora_inventory_items WHERE lower(btrim(name)) = lower(btrim(r.item_name));
    IF v_item IS NULL AND NOT (r.item_name = ANY(missing)) THEN missing := missing || r.item_name; END IF;
  END LOOP;

  FOR r IN SELECT unnest(ARRAY['Perro con una carne','Perro con dos carnes']) AS product_name LOOP
    IF NOT EXISTS (SELECT 1 FROM public.nexora_products WHERE lower(btrim(name)) = lower(r.product_name)) THEN
      missing := missing || ('producto: ' || r.product_name);
    END IF;
  END LOOP;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'Faltan estos insumos/productos: %. Créalos o impórtalos y vuelve a correr.', array_to_string(missing, ', ');
  END IF;

  FOR r IN SELECT DISTINCT choice_name FROM (VALUES ('Res mechada'),('Carne con guiso'),('Pollo con champiñones'),('Chorizo con hogao')) AS t(choice_name) LOOP
    INSERT INTO public.nexora_option_choices (name) VALUES (r.choice_name)
    ON CONFLICT (lower(name)) DO UPDATE SET is_active = true;
    SELECT id INTO v_choice FROM public.nexora_option_choices WHERE lower(name) = lower(r.choice_name);
    DELETE FROM public.nexora_option_choice_lines WHERE choice_id = v_choice;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('Res mechada',          'Res mechada',      60::numeric),
    ('Carne con guiso',      'Res mechada',      60),
    ('Carne con guiso',      'Tomate',           50),
    ('Carne con guiso',      'Cebolla blanca',   0.25),
    ('Pollo con champiñones','Pollo desmechado', 30),
    ('Pollo con champiñones','Champiñones',      30),
    ('Chorizo con hogao',    'Hogao',60)
  ) AS t(choice_name, item_name, qty)
  LOOP
    INSERT INTO public.nexora_option_choice_lines (choice_id, item_id, quantity)
    SELECT oc.id, i.id, r.qty
    FROM public.nexora_option_choices oc, public.nexora_inventory_items i
    WHERE lower(oc.name) = lower(r.choice_name) AND lower(btrim(i.name)) = lower(btrim(r.item_name));
  END LOOP;

  -- Perro con una carne = perro con hogao: lleva siempre 60 g de Hogao en su receta y NO se escoge carne.
  SELECT id INTO v_prod FROM public.nexora_products WHERE lower(btrim(name)) = 'perro con una carne' ORDER BY is_active DESC LIMIT 1;
  DELETE FROM public.nexora_product_option_choices WHERE product_id = v_prod;
  DELETE FROM public.nexora_product_options WHERE product_id = v_prod;

  -- Perro con dos carnes: escoge 2 (se puede repetir)
  FOR l IN SELECT * FROM (VALUES ('Perro con dos carnes', 2, ARRAY['Res mechada','Carne con guiso','Pollo con champiñones','Chorizo con hogao'])) AS t(pname, picks, choices)
  LOOP
    SELECT id INTO v_prod FROM public.nexora_products WHERE lower(btrim(name)) = lower(l.pname) ORDER BY is_active DESC LIMIT 1;
    INSERT INTO public.nexora_product_options (product_id, picks) VALUES (v_prod, l.picks)
    ON CONFLICT (product_id) DO UPDATE SET picks = EXCLUDED.picks;
    DELETE FROM public.nexora_product_option_choices WHERE product_id = v_prod;
    v_pos := 0;
    FOR r IN SELECT unnest(l.choices) AS cname LOOP
      v_pos := v_pos + 1;
      INSERT INTO public.nexora_product_option_choices (product_id, choice_id, sort_order)
      SELECT v_prod, oc.id, v_pos FROM public.nexora_option_choices oc WHERE lower(oc.name) = lower(r.cname);
    END LOOP;
  END LOOP;
END $$;
