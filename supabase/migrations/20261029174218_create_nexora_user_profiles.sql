/*
# Create Nexora user profiles and session-safe roles

1. Purpose
- Add a profile linked to Supabase Auth for each registered user.
- Provide a safe foundation for role-aware restaurant access.

2. New table
- `nexora_profiles`
- `id`: the authenticated user's id.
- `display_name`: editable name shown in the interface.
- `role`: server-controlled role, defaulting to `owner` for the first prototype user.
- `created_at` and `updated_at`: audit timestamps.

3. Security
- Enable RLS.
- Authenticated users can read only their own profile.
- Authenticated users can update only their display name.
- Role, ownership and audit fields are not client-writable.
- Anonymous users cannot read or write profiles.

4. Auth integration
- Add a security-definer trigger function that creates a profile when a new Auth user is registered.
- The trigger copies a safe display name from signup metadata and never trusts metadata for authorization.
*/

CREATE TABLE IF NOT EXISTS public.nexora_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Usuario Nexora' CHECK (char_length(trim(display_name)) BETWEEN 1 AND 80),
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory', 'marketing', 'auditor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nexora_profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nexora_profiles TO authenticated;
REVOKE INSERT, DELETE ON public.nexora_profiles FROM anon, authenticated;
REVOKE UPDATE ON public.nexora_profiles FROM authenticated;
GRANT UPDATE (display_name) ON public.nexora_profiles TO authenticated;

DROP POLICY IF EXISTS "Users can read their profile" ON public.nexora_profiles;
CREATE POLICY "Users can read their profile"
ON public.nexora_profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update their display name" ON public.nexora_profiles;
CREATE POLICY "Users can update their display name"
ON public.nexora_profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_nexora_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.nexora_profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'display_name'), ''), split_part(NEW.email, '@', 1), 'Usuario Nexora')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_nexora_auth_user_created ON auth.users;
CREATE TRIGGER on_nexora_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_nexora_new_user();

REVOKE EXECUTE ON FUNCTION public.handle_nexora_new_user() FROM PUBLIC, anon, authenticated;
