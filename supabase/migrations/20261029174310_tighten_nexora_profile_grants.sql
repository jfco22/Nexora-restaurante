/*
# Tighten Nexora profile grants

1. Purpose
- Remove inherited table privileges from anonymous visitors.

2. Security changes
- Anonymous users receive no direct privileges on `nexora_profiles`.
- Authenticated users retain only profile reading and display-name updates.
- RLS policies continue to restrict access to the signed-in user's own row.
*/

REVOKE ALL ON TABLE public.nexora_profiles FROM anon;
REVOKE ALL ON TABLE public.nexora_profiles FROM PUBLIC;
GRANT SELECT ON TABLE public.nexora_profiles TO authenticated;
REVOKE INSERT, DELETE ON TABLE public.nexora_profiles FROM authenticated;
REVOKE UPDATE ON TABLE public.nexora_profiles FROM authenticated;
GRANT UPDATE (display_name) ON TABLE public.nexora_profiles TO authenticated;
