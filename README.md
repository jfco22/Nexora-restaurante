# Nexora · El Taita

Sistema de gestión para el restaurante El Taita (Iza, Boyacá): salón y mesas, carta y pedidos, cocina, caja con turnos, inventario con recetas y equipo de trabajo.

- **App:** Vite + React + TypeScript + Tailwind.
- **Base de datos, usuarios y funciones:** Supabase.
- **Publicación:** Cloudflare Pages (conectado a este repositorio).

## Variables de entorno

La app necesita dos valores, que salen de Supabase en *Project Settings → API*:

| Variable | Qué es |
|---|---|
| `VITE_SUPABASE_URL` | La URL del proyecto, por ejemplo `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | La clave pública (`anon` o `publishable`) |

Ejemplo en `.env.example`. El archivo `.env` está ignorado por git y no debe subirse nunca.
**No uses ni publiques la `service_role` key ni la contraseña de la base de datos**: no hacen falta en la app.

Las variables `VITE_*` se incorporan al compilar. Si las cambias en el hosting, hay que volver a publicar.

## Trabajar en tu computador

Requiere Node 22.

```bash
npm install
npm run dev        # servidor local
npm run typecheck  # revisión de tipos
npm run build      # compilación para producción (carpeta dist)
```

## Base de datos (Supabase)

- Las migraciones están en `supabase/migrations`, ordenadas por nombre. En un proyecto **nuevo**, se ejecutan en ese orden desde *SQL Editor*. El proyecto actual ya las tiene aplicadas.
- Cada cambio nuevo de base de datos se agrega como una migración nueva y se ejecuta en *SQL Editor*.
- En un proyecto nuevo, todo usuario nace como **Mesero**. El primer usuario debe convertirse en propietario con:

```sql
update public.nexora_profiles
set role = 'owner'
where id = (select id from auth.users where email = 'CORREO-DEL-PROPIETARIO');
```

## Función para crear usuarios

El código está en `supabase/functions/create-staff-user/index.ts`. Se despliega en *Edge Functions* de Supabase con el nombre `create-staff-user` y con **Verify JWT desactivado** (la función valida la sesión por su cuenta). Subir cambios a GitHub **no** la despliega: hay que desplegarla en Supabase.

## Publicación en Cloudflare Pages

| Campo | Valor |
|---|---|
| Rama de producción | `main` |
| Comando de compilación | `npm run build` |
| Carpeta de salida | `dist` |
| Variables de entorno | `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` |

Después de publicar, en Supabase → *Authentication → URL Configuration*, pon la dirección de la app en **Site URL** y agrégala en **Redirect URLs**. Sin eso, el correo de recuperar contraseña apunta a otra dirección.

## Menú de El Taita

`docs/menu-el-taita.csv` y `docs/menu-el-taita.xlsx` traen la carta completa (50 productos). Para cargarla: entrar como propietario o gerente, abrir **Carta → Importar o gestionar menú** y subir el archivo. El importador actualiza por nombre, así que repetir la importación no duplica productos.
