-- Ordenar insumos de El Taita (nombres distintos con el mismo significado).
-- Se puede correr varias veces. Pega TODO en el SQL Editor y ejecuta.
-- Resultado: una tabla final con el estado de cada insumo.
--
-- 1) Tomate  -> "Tomate de ensalada" (hamburguesas y sándwiches). Conserva el stock que tenías.
--    Se crea "Tomate de guiso" (g) para guisos, hogao, caldo y pico de gallo.
-- 2) "Queso doble crema" -> "Queso doble crema (tajada)" (hamburguesas, perros, sándwiches). Conserva el stock.
--    Se crea "Queso doble crema (rayado)" (g) para todo tipo de birria.
-- 3) Mini hamburguesa: se compra completa, es un insumo en unidades (sin carne ni pan aparte).
-- Después de correr esto: importa de nuevo recetas y preparaciones (con "reemplazar") para que usen los nombres nuevos.

DO $$
DECLARE
  v_old uuid; v_new uuid; v_ens uuid; v_gui uuid; v_taj uuid; v_ray uuid; v_mini uuid;
BEGIN
  -- Tomate
  SELECT id INTO v_ens FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'tomate de ensalada';
  SELECT id INTO v_old FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'tomate';
  IF v_ens IS NULL AND v_old IS NOT NULL THEN
    UPDATE public.nexora_inventory_items SET name = 'Tomate de ensalada', is_active = true WHERE id = v_old;
    v_ens := v_old;
  ELSIF v_ens IS NULL THEN
    INSERT INTO public.nexora_inventory_items (name, unit, storage_location) VALUES ('Tomate de ensalada', 'g', 'estanteria') RETURNING id INTO v_ens;
  END IF;
  INSERT INTO public.nexora_inventory_items (name, unit, storage_location)
  SELECT 'Tomate de guiso', 'g', 'estanteria'
  WHERE NOT EXISTS (SELECT 1 FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'tomate de guiso');
  SELECT id INTO v_gui FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'tomate de guiso';

  -- Preparaciones y opciones que son de guiso: usan el tomate de guiso.
  UPDATE public.nexora_preparation_lines pl SET item_id = v_gui
  WHERE pl.item_id = v_ens
    AND NOT EXISTS (SELECT 1 FROM public.nexora_preparation_lines x WHERE x.preparation_id = pl.preparation_id AND x.item_id = v_gui)
    AND pl.preparation_id IN (
      SELECT p.id FROM public.nexora_preparations p JOIN public.nexora_inventory_items o ON o.id = p.output_item_id
      WHERE lower(btrim(o.name)) IN ('caldo de birria', 'hogao', 'pico de gallo'));
  UPDATE public.nexora_option_choice_lines cl SET item_id = v_gui
  WHERE cl.item_id = v_ens
    AND NOT EXISTS (SELECT 1 FROM public.nexora_option_choice_lines x WHERE x.choice_id = cl.choice_id AND x.item_id = v_gui)
    AND cl.choice_id IN (SELECT id FROM public.nexora_option_choices WHERE lower(name) = 'carne con guiso');

  -- Queso doble crema
  SELECT id INTO v_taj FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'queso doble crema (tajada)';
  SELECT id INTO v_old FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'queso doble crema';
  IF v_taj IS NULL AND v_old IS NOT NULL THEN
    UPDATE public.nexora_inventory_items SET name = 'Queso doble crema (tajada)', is_active = true WHERE id = v_old;
    v_taj := v_old;
  ELSIF v_taj IS NULL THEN
    INSERT INTO public.nexora_inventory_items (name, unit, storage_location) VALUES ('Queso doble crema (tajada)', 'unidad', 'nevera') RETURNING id INTO v_taj;
  END IF;
  -- El queso rayado viejo (si existía) pasa a llamarse con el nombre nuevo; si no, se crea.
  SELECT id INTO v_ray FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'queso doble crema (rayado)';
  SELECT id INTO v_old FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'queso rayado';
  IF v_ray IS NULL AND v_old IS NOT NULL THEN
    UPDATE public.nexora_inventory_items SET name = 'Queso doble crema (rayado)', is_active = true WHERE id = v_old;
  ELSIF v_ray IS NULL THEN
    INSERT INTO public.nexora_inventory_items (name, unit, storage_location) VALUES ('Queso doble crema (rayado)', 'g', 'nevera');
  END IF;
  SELECT id INTO v_ray FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'queso doble crema (rayado)';

  -- Mini hamburguesa: insumo comprado completo.
  SELECT id INTO v_mini FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'mini hamburguesa';
  IF v_mini IS NULL THEN
    INSERT INTO public.nexora_inventory_items (name, unit, storage_location) VALUES ('Mini hamburguesa', 'unidad', 'nevera');
  END IF;
END $$;

-- Recetas de birria: el queso es el rayado (en gramos). Las recetas de birria se re-importan con el CSV;
-- aquí solo se mueve lo que ya exista para que no quede nada con el nombre viejo.
UPDATE public.nexora_product_recipes r
SET item_id = (SELECT id FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'queso doble crema (rayado)')
WHERE r.item_id = (SELECT id FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'queso doble crema (tajada)')
  AND r.product_id IN (SELECT id FROM public.nexora_products WHERE lower(name) LIKE 'birria%')
  AND NOT EXISTS (
    SELECT 1 FROM public.nexora_product_recipes x
    WHERE x.product_id = r.product_id
      AND x.item_id = (SELECT id FROM public.nexora_inventory_items WHERE lower(btrim(name)) = 'queso doble crema (rayado)'));

-- Revisión: estos son tus insumos de tomate, queso y mini hamburguesa.
SELECT name AS insumo, unit AS unidad, current_stock AS stock, is_active AS activo
FROM public.nexora_inventory_items
WHERE lower(name) LIKE 'tomate%' OR lower(name) LIKE 'queso%' OR lower(name) LIKE 'mini hamburguesa%' OR lower(name) = 'pico de gallo'
ORDER BY name;
