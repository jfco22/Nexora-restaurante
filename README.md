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

`docs/menu-el-taita.csv` y `docs/menu-el-taita.xlsx` traen la carta completa (51 productos). Para cargarla: entrar como propietario o gerente, abrir **Carta → Importar o gestionar menú** y subir el archivo. El importador actualiza por nombre, así que repetir la importación no duplica productos.

## Fotos del menú

Las fotos están en `public/menu` y se llaman igual que el producto (`Hamburguesa La Jornalera.jpg`; si el nombre trae `/`, se escribe `-`). Al importar el menú, si la columna **Imagen URL** está vacía, se usa la foto con el nombre del producto. Más detalles en `public/menu/LEEME.txt`. Para agregar una foto: copiarla a esa carpeta, subir el cambio y volver a importar el menú (el importador actualiza por nombre).

## Recetas por CSV

En **Inventario → Importar recetas** se sube un CSV o Excel con las columnas `Producto; Insumo; Cantidad; Unidad; Ubicación` (nevera, estanteria o bodega; solo para insumos nuevos) (una fila por insumo de cada plato). Los productos se buscan por nombre y los insumos también; si el insumo no existe y la fila trae `Unidad`, se crea en la bodega con stock 0. `docs/recetas-el-taita-borrador.csv` trae los insumos de cada plato según la carta, con las cantidades por completar.

## Cocinar por tandas (preparaciones)

Para lo que se cocina en olla y se vende por porción (birria, carne de hamburguesa): en **Inventario → Cocinar** se importa un archivo con `Preparación; Rinde; Unidad rinde; Insumo; Cantidad; Unidad; Ubicación` (ver `docs/preparaciones-el-taita.csv`). La preparación crea un insumo con su nombre ("Caldo de birria"); una fila con `Tipo = resultado` agrega otro producto de la misma tanda ("Carne de birria"). Al pulsar **Cocinar** se descuentan los insumos crudos y se suma lo cocinado; las recetas de los platos usan ese insumo (`docs/recetas-birriamen-con-tanda.csv`), así que la carta se agota cuando se acaba lo cocinado. Requiere la migración `20261118230000_add_nexora_preparations.sql` (ejecutarla en SQL Editor) y, para varios resultados, `20261119230000_add_nexora_preparation_extra_outputs.sql`.


## Productos con opciones a escoger (perros con carne)

Algunos productos piden escoger al pedir (ej. "Perro con dos carnes": 2 carnes, se puede repetir). El selector aparece
en el menú QR, en la carta del personal y al agregar a una cuenta de mesa. Cada opción descuenta sus propios insumos
(además de la receta base del producto) y la cocina ve las carnes escogidas en el nombre de la línea.

1. Aplicar la migración `20261120230000_add_nexora_product_option_choices.sql` en Supabase (SQL Editor).
2. Tener cargados el menú y los insumos, y correr `docs/opciones-perros-el-taita.sql` (se puede repetir sin problema).
