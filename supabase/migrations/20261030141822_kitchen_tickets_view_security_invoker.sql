/*
# Run kitchen tickets view with the caller's permissions

1. Problem
- The kitchen tickets view was created with owner rights, so it bypassed the row rules of the person reading it.

2. Change
- The view now runs with the permissions of the signed-in user (security_invoker).
- Staff already has read access to the orders and order items it reads, so kitchen screens keep working.

3. Security
- No new grants. The view stays readable only by authenticated users.
*/

ALTER VIEW public.nexora_kitchen_tickets SET (security_invoker = true);
