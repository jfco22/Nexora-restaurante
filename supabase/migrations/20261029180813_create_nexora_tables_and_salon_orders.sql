/*
# Create Nexora salon tables and table-linked accounts

1. Purpose
- Persist the restaurant floor instead of showing hard-coded tables.
- Allow an authenticated staff member to open a draft account on a free table.

2. New table
- `nexora_tables`
- `name`: visible table label.
- `seats`: capacity.
- `zone`: floor area.
- `status`: `free`, `occupied`, `reserved`, or `out_of_service`.
- `is_active`: whether the table appears in the salon.

3. Modified table
- `nexora_orders`
- Add nullable `table_id` to associate salon orders with a table.

4. New function
- `open_nexora_table_order(uuid)` atomically checks a free table, creates a draft salon order and marks the table occupied.

5. Security
- Salon data is available only to authenticated staff accounts.
- RLS is enabled on the new table.
- The opening operation is an authenticated server-side function and does not trust a client-supplied status.
- Anonymous customers continue using the public guest menu and cannot access salon management.
*/

CREATE TABLE IF NOT EXISTS public.nexora_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 50),
  zone text NOT NULL DEFAULT 'Salón' CHECK (char_length(trim(zone)) BETWEEN 1 AND 60),
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'occupied', 'reserved', 'out_of_service')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nexora_orders
  ADD COLUMN IF NOT EXISTS table_id uuid REFERENCES public.nexora_tables(id);

CREATE INDEX IF NOT EXISTS nexora_tables_status_idx ON public.nexora_tables(status, is_active);
CREATE INDEX IF NOT EXISTS nexora_orders_table_idx ON public.nexora_orders(table_id);

ALTER TABLE public.nexora_tables ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nexora_tables TO authenticated;

DROP POLICY IF EXISTS "Staff can read salon tables" ON public.nexora_tables;
CREATE POLICY "Staff can read salon tables" ON public.nexora_tables FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Staff can insert salon tables" ON public.nexora_tables;
CREATE POLICY "Staff can insert salon tables" ON public.nexora_tables FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Staff can update salon tables" ON public.nexora_tables;
CREATE POLICY "Staff can update salon tables" ON public.nexora_tables FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Staff can delete salon tables" ON public.nexora_tables;
CREATE POLICY "Staff can delete salon tables" ON public.nexora_tables FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.open_nexora_table_order(table_id_input uuid)
RETURNS TABLE(order_id uuid, order_number bigint, table_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  opened_order_id uuid;
BEGIN
  UPDATE public.nexora_tables
  SET status = 'occupied', updated_at = now()
  WHERE id = table_id_input
    AND is_active = true
    AND status = 'free';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La mesa no está disponible';
  END IF;

  INSERT INTO public.nexora_orders (order_type, status, payment_status, source, total_cop, table_id)
  VALUES ('salon', 'draft', 'unpaid', 'waiter', 0, table_id_input)
  RETURNING id INTO opened_order_id;

  RETURN QUERY
  SELECT order_record.id, order_record.order_number, order_record.table_id
  FROM public.nexora_orders order_record
  WHERE order_record.id = opened_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.open_nexora_table_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_nexora_table_order(uuid) TO authenticated;

INSERT INTO public.nexora_tables (id, name, seats, status)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'Mesa 01', 2, 'occupied'),
  ('30000000-0000-0000-0000-000000000002', 'Mesa 02', 4, 'free'),
  ('30000000-0000-0000-0000-000000000003', 'Mesa 03', 4, 'reserved'),
  ('30000000-0000-0000-0000-000000000004', 'Mesa 04', 6, 'occupied'),
  ('30000000-0000-0000-0000-000000000005', 'Mesa 05', 2, 'free'),
  ('30000000-0000-0000-0000-000000000006', 'Mesa 06', 4, 'occupied'),
  ('30000000-0000-0000-0000-000000000007', 'Mesa 07', 8, 'free'),
  ('30000000-0000-0000-0000-000000000008', 'Mesa 08', 2, 'free')
ON CONFLICT (id) DO NOTHING;
