# Project memory

## Product intent & audience

- Reverse-engineer and rebuild the restaurant management app “Nexora” as an independent system for daily restaurant operations.
- Primary users are Spanish-speaking restaurant staff, including propietarios, gerentes, meseros, and potentially kitchen/cashier roles.
- Core areas: Inicio (dashboard), Salón (floor/tables), Carta y pedidos (menu/orders), and restricted Equipo (team management).

## Brand personality & voice

- Clean, professional, approachable, and operationally focused.
- Spanish-language UI optimized for quick use during service.
- Visuals should feel polished and production-ready rather than generic.

## Visual design & UX direction

- Minimalist interface based on the existing app/reference aesthetic.
- Persistent left navigation with site/branch selector, open-cash status, and user profile area.
- Dashboard emphasizes operational metrics such as ventas, margen, pagos, metas, pedidos abiertos, and inventory alerts.
- Floor view clearly differentiates libre, ocupada, and reservada table states.
- Menu/order flow supports category browsing, search, item photos/descriptions/prices, quantity changes, and a visible current-order panel.
- Equipo should reuse the established app colors, spacing, and components rather than introduce a separate visual system.
- Responsive behavior is required for smaller screens.
- Stack context: Vite + React/JSX, Tailwind CSS, lucide-react, and `@/` imports.

## Decisions, constraints & rationale

- Approved navigation areas are Inicio, Salón, and Carta y pedidos; Equipo is restricted to propietario and gerente.
- Team administration allows authorized admins to create users and modify other users’ roles/permissions.
- Mi perfil displays the assigned role and permits name editing, but not role changes.
- New profiles default to Mesero; users cannot change their own role, and the last propietario cannot be removed.
- Anonymous users must not be able to query team data; authorization is enforced in the database.
- A server function exists for user creation and is registered through `config.toml`, but the complete creation flow has not been verified.
- The target GitHub repository `jfco22/Nexora` was reported empty, and the current project has not yet been uploaded there.
- Future editing/publishing should use the project’s GitHub connection/synchronization workflow in Bolt; no successful repository synchronization has been confirmed.
- Existing security-advisor alerts related to guest carta/pedidos functions are pre-existing and remain unresolved.
- Do not store or expose passwords in project memory. Existing account/access details should be handled through secure authentication workflows.

## Open questions & assumptions

- User creation still needs an end-to-end test from Equipo or an equivalent administrative flow.
- The reported missing user was not found in the database; only the existing administrator account was confirmed at that time. Root cause of the failed creation is unknown.
- Repository connection and initial push to GitHub remain pending confirmation.
- Exact color palette, typography, spacing tokens, and component specifications are not fully documented.
- Backend schema, API contracts, and multi-site/multi-branch architecture remain under reconnaissance; Supabase is currently in use.
- Need establish a secure recovery/onboarding path for users who cannot log in without exchanging credentials in chat.