/*
  # Alertas de frescura: avisar antes de que las cosas se "apichen"

  1. nexora_inventory_items.shelf_life_days (opcional): días máximos que el insumo puede llevar guardado
     antes de hacer promoción (ej. empanadas 3, hamburguesitas 3).
  2. nexora_stock_freshness(): para cada insumo con stock calcula, con el método "lo más viejo sale primero":
     - Cuántos días lleva guardado lo más viejo que aún queda (según compras, producciones y ajustes).
     - Cuántos días tarda normalmente en gastarse un lote (promedio de los últimos lotes ya gastados).
     - Un nivel: alert (actuar ya), watch (vigilar) u ok, y la razón en palabras.
     Regla 1: si el insumo tiene límite de días y lo supera -> alert; si le falta 1 día o menos -> watch.
     Regla 2: sin límite, con al menos 3 lotes de historial: si lo más viejo ya pasó 1,5 veces lo normal -> alert;
     si pasó lo normal -> watch.
  3. Solo propietario, gerente, inventario y cocina pueden consultarlo.
*/

ALTER TABLE public.nexora_inventory_items
  ADD COLUMN IF NOT EXISTS shelf_life_days integer CHECK (shelf_life_days IS NULL OR shelf_life_days BETWEEN 1 AND 365);

GRANT INSERT (shelf_life_days) ON public.nexora_inventory_items TO authenticated;
GRANT UPDATE (shelf_life_days) ON public.nexora_inventory_items TO authenticated;

CREATE OR REPLACE FUNCTION public.nexora_stock_freshness()
RETURNS TABLE(
  item_id uuid, name text, unit text, storage_location text, current_stock numeric,
  shelf_life_days integer, oldest_age_days numeric, oldest_since timestamptz,
  avg_rotation_days numeric, batches_measured integer,
  level text, reason text, used_in text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nexora_profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager', 'inventory', 'kitchen')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver las alertas de frescura';
  END IF;

  RETURN QUERY
  WITH active AS (
    SELECT i.id, i.name, i.unit, i.storage_location, i.current_stock, i.shelf_life_days, i.created_at
    FROM public.nexora_inventory_items i
    WHERE i.is_active AND i.current_stock > 0
  ),
  moved AS (
    SELECT m.item_id, sum(m.quantity) AS net FROM public.nexora_inventory_movements m GROUP BY m.item_id
  ),
  layers_raw AS (
    -- Entradas con fecha: compras, producciones y ajustes que suman.
    SELECT m.item_id, m.created_at AS at, m.quantity AS qty
    FROM public.nexora_inventory_movements m WHERE m.quantity > 0 AND m.item_id IN (SELECT id FROM active)
    UNION ALL
    -- Stock que ya estaba sin movimiento registrado (conteo inicial / importación): se fecha al crear el insumo.
    SELECT a.id, a.created_at, a.current_stock - COALESCE(mv.net, 0)
    FROM active a LEFT JOIN moved mv ON mv.item_id = a.id
    WHERE a.current_stock - COALESCE(mv.net, 0) > 0
  ),
  layers AS (
    SELECT l.item_id, l.at, l.qty,
           sum(l.qty) OVER (PARTITION BY l.item_id ORDER BY l.at, l.qty DESC ROWS UNBOUNDED PRECEDING) AS layer_end
    FROM layers_raw l
  ),
  outflows AS (
    SELECT m.item_id, m.created_at AS at,
           sum(-m.quantity) OVER (PARTITION BY m.item_id ORDER BY m.created_at, m.id ROWS UNBOUNDED PRECEDING) AS cum_out
    FROM public.nexora_inventory_movements m WHERE m.quantity < 0 AND m.item_id IN (SELECT id FROM active)
  ),
  total_out AS (
    SELECT o.item_id, max(o.cum_out) AS total FROM outflows o GROUP BY o.item_id
  ),
  oldest AS (
    -- Primer lote que todavía no se ha gastado por completo.
    SELECT DISTINCT ON (l.item_id) l.item_id, l.at AS since
    FROM layers l LEFT JOIN total_out t ON t.item_id = l.item_id
    WHERE l.layer_end > COALESCE(t.total, 0)
    ORDER BY l.item_id, l.at, l.qty DESC
  ),
  finished AS (
    -- Lotes ya gastados por completo y cuántos días tardaron en gastarse.
    SELECT l.item_id, l.at,
           extract(epoch FROM (
             (SELECT min(o.at) FROM outflows o WHERE o.item_id = l.item_id AND o.cum_out >= l.layer_end) - l.at
           )) / 86400.0 AS days
    FROM layers l JOIN total_out t ON t.item_id = l.item_id
    WHERE l.layer_end <= t.total
  ),
  recent AS (
    SELECT f.item_id, f.days, row_number() OVER (PARTITION BY f.item_id ORDER BY f.at DESC) AS rn
    FROM finished f WHERE f.days IS NOT NULL AND f.days >= 0
  ),
  rotation AS (
    SELECT r.item_id, avg(r.days) AS avg_days, count(*)::integer AS n FROM recent r WHERE r.rn <= 8 GROUP BY r.item_id
  ),
  used AS (
    SELECT pr.item_id, (array_agg(DISTINCT p.name ORDER BY p.name))[1:3] AS products
    FROM public.nexora_product_recipes pr JOIN public.nexora_products p ON p.id = pr.product_id
    GROUP BY pr.item_id
  ),
  calc AS (
    SELECT a.id, a.name, a.unit, a.storage_location, a.current_stock, a.shelf_life_days,
           round((extract(epoch FROM (now() - o.since)) / 86400.0)::numeric, 1) AS age,
           o.since, round(r.avg_days::numeric, 1) AS avg_days, COALESCE(r.n, 0) AS n, u.products
    FROM active a
    LEFT JOIN oldest o ON o.item_id = a.id
    LEFT JOIN rotation r ON r.item_id = a.id
    LEFT JOIN used u ON u.item_id = a.id
  )
  SELECT c.id, c.name, c.unit, c.storage_location, c.current_stock, c.shelf_life_days, c.age, c.since, c.avg_days, c.n,
    CASE
      WHEN c.age IS NULL THEN 'ok'
      WHEN c.shelf_life_days IS NOT NULL AND c.age > c.shelf_life_days THEN 'alert'
      WHEN c.shelf_life_days IS NOT NULL AND c.age >= c.shelf_life_days - 1 THEN 'watch'
      WHEN c.shelf_life_days IS NULL AND c.n >= 3 AND c.avg_days > 0 AND c.age >= 2 AND c.age > c.avg_days * 1.5 THEN 'alert'
      WHEN c.shelf_life_days IS NULL AND c.n >= 3 AND c.avg_days > 0 AND c.age >= 2 AND c.age > c.avg_days THEN 'watch'
      ELSE 'ok'
    END,
    CASE
      WHEN c.age IS NULL THEN NULL
      WHEN c.shelf_life_days IS NOT NULL AND c.age > c.shelf_life_days
        THEN format('Lleva %s días guardado y el límite es %s: haz promoción o úsalo ya.', trim_scale(c.age), c.shelf_life_days)
      WHEN c.shelf_life_days IS NOT NULL AND c.age >= c.shelf_life_days - 1
        THEN format('Lleva %s días guardado; el límite es %s. Piensa en una promoción.', trim_scale(c.age), c.shelf_life_days)
      WHEN c.shelf_life_days IS NULL AND c.n >= 3 AND c.avg_days > 0 AND c.age >= 2 AND c.age > c.avg_days * 1.5
        THEN format('Lo más viejo lleva %s días y normalmente se gasta en %s: se está estancando.', trim_scale(c.age), trim_scale(c.avg_days))
      WHEN c.shelf_life_days IS NULL AND c.n >= 3 AND c.avg_days > 0 AND c.age >= 2 AND c.age > c.avg_days
        THEN format('Lo más viejo lleva %s días y normalmente se gasta en %s: vigílalo.', trim_scale(c.age), trim_scale(c.avg_days))
      ELSE NULL
    END,
    COALESCE(c.products, ARRAY[]::text[])
  FROM calc c
  ORDER BY
    CASE WHEN c.shelf_life_days IS NOT NULL AND c.age > c.shelf_life_days THEN 0 ELSE 1 END,
    c.age DESC NULLS LAST, c.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.nexora_stock_freshness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_stock_freshness() TO authenticated;
