/*
# Create Nexora catalog and order foundation

1. Purpose
- Add the first persistent foundation for the visual menu and order flow.
- This version is intentionally single-tenant and shared because the current prototype has no sign-in screen.

2. New tables
- `nexora_categories`: public menu categories and their display order.
- `nexora_products`: products shown in the visual menu, including COP prices, descriptions, photos and availability.
- `nexora_orders`: orders created from the menu, including order status, payment status and total.
- `nexora_order_items`: immutable product snapshots attached to an order.

3. Security
- Enable RLS on every table.
- Grant only the CRUD operations currently required by the no-auth prototype.
- Allow anon and authenticated access because the current app has no sign-in flow and intentionally operates as a shared prototype.
- Product and category access is public for the menu; order access is shared for this prototype and must be tightened when authentication and staff roles are introduced.

4. Data integrity
- Prices and totals are stored as integer COP amounts.
- Order item names and prices are snapshots so later catalog edits do not rewrite order history.
- Quantities and statuses are constrained.
- Seed data uses stable UUIDs and conflict-safe inserts.

5. Important follow-up
- Before production, introduce organizations, locations, memberships and authenticated RLS policies. Do not treat the shared policies as the final multi-user security model.
*/

CREATE TABLE IF NOT EXISTS public.nexora_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  description text,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nexora_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.nexora_categories(id),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  price_cop integer NOT NULL CHECK (price_cop >= 0),
  image_url text,
  is_available boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nexora_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  order_type text NOT NULL DEFAULT 'salon' CHECK (order_type IN ('salon', 'takeaway', 'delivery')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'accepted', 'cancelled', 'completed')),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  source text NOT NULL DEFAULT 'menu' CHECK (source IN ('menu', 'waiter', 'cashier', 'manual')),
  total_cop integer NOT NULL DEFAULT 0 CHECK (total_cop >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nexora_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.nexora_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.nexora_products(id),
  product_name text NOT NULL,
  unit_price_cop integer NOT NULL CHECK (unit_price_cop >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total_cop integer NOT NULL CHECK (line_total_cop >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nexora_products_category_idx ON public.nexora_products(category_id);
CREATE INDEX IF NOT EXISTS nexora_products_available_idx ON public.nexora_products(is_active, is_available);
CREATE INDEX IF NOT EXISTS nexora_order_items_order_idx ON public.nexora_order_items(order_id);
CREATE INDEX IF NOT EXISTS nexora_orders_created_idx ON public.nexora_orders(created_at DESC);

ALTER TABLE public.nexora_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexora_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexora_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexora_order_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nexora_categories TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nexora_products TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nexora_orders TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nexora_order_items TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read categories" ON public.nexora_categories;
CREATE POLICY "Public can read categories" ON public.nexora_categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public can insert categories" ON public.nexora_categories;
CREATE POLICY "Public can insert categories" ON public.nexora_categories FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Public can update categories" ON public.nexora_categories;
CREATE POLICY "Public can update categories" ON public.nexora_categories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public can delete categories" ON public.nexora_categories;
CREATE POLICY "Public can delete categories" ON public.nexora_categories FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read products" ON public.nexora_products;
CREATE POLICY "Public can read products" ON public.nexora_products FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public can insert products" ON public.nexora_products;
CREATE POLICY "Public can insert products" ON public.nexora_products FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Public can update products" ON public.nexora_products;
CREATE POLICY "Public can update products" ON public.nexora_products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public can delete products" ON public.nexora_products;
CREATE POLICY "Public can delete products" ON public.nexora_products FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Shared prototype can read orders" ON public.nexora_orders;
CREATE POLICY "Shared prototype can read orders" ON public.nexora_orders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Shared prototype can insert orders" ON public.nexora_orders;
CREATE POLICY "Shared prototype can insert orders" ON public.nexora_orders FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Shared prototype can update orders" ON public.nexora_orders;
CREATE POLICY "Shared prototype can update orders" ON public.nexora_orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Shared prototype can delete orders" ON public.nexora_orders;
CREATE POLICY "Shared prototype can delete orders" ON public.nexora_orders FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Shared prototype can read order items" ON public.nexora_order_items;
CREATE POLICY "Shared prototype can read order items" ON public.nexora_order_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Shared prototype can insert order items" ON public.nexora_order_items;
CREATE POLICY "Shared prototype can insert order items" ON public.nexora_order_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Shared prototype can update order items" ON public.nexora_order_items;
CREATE POLICY "Shared prototype can update order items" ON public.nexora_order_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Shared prototype can delete order items" ON public.nexora_order_items;
CREATE POLICY "Shared prototype can delete order items" ON public.nexora_order_items FOR DELETE TO anon, authenticated USING (true);

INSERT INTO public.nexora_categories (id, name, description, sort_order)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'Favoritos', 'Los más pedidos de la casa.', 1),
  ('10000000-0000-0000-0000-000000000002', 'Entradas', 'Para empezar a compartir.', 2),
  ('10000000-0000-0000-0000-000000000003', 'Para compartir', 'Platos para disfrutar en la mesa.', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.nexora_products (id, category_id, name, description, price_cop, image_url)
VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Hamburguesa de la casa', 'Carne artesanal, queso, cebolla caramelizada y papas.', 28500, 'https://images.pexels.com/photos/23086/food-restaurant-kitchen-meat-23086.jpg?auto=compress&cs=tinysrgb&h=650&w=940'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Pasta cremosa', 'Pasta fresca, salsa de parmesano y albahaca.', 26000, 'https://images.pexels.com/photos/15704113/pexels-photo-15704113.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Ensalada de temporada', 'Hojas verdes, aguacate, tomates y vinagreta cítrica.', 19500, 'https://images.pexels.com/photos/10480246/pexels-photo-10480246.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'Tabla para compartir', 'Selección de bocados de la casa para compartir.', 42000, 'https://images.pexels.com/photos/36575097/pexels-photo-36575097.jpeg?auto=compress&cs=tinysrgb&h=650&w=940')
ON CONFLICT (id) DO NOTHING;
