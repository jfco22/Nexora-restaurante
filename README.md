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

`docs/menu-el-taita.csv` y `docs/menu-el-taita.xlsx` traen la carta completa (57 productos). Para cargarla: entrar como propietario o gerente, abrir **Carta → Importar o gestionar menú** y subir el archivo. El importador actualiza por nombre, así que repetir la importación no duplica productos.

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

## Quién ve las recetas y cocina

Solo propietario y gerente ven las pestañas **Recetas** y **Cocinar**, importan recetas y registran tandas. Esto también
se aplica en la base de datos (migración `20261121000000_restrict_recipes_and_cooking_to_managers.sql`), no solo en pantalla.
El resto del personal sigue viendo Insumos y Por comprar y registrando compras, mermas y conteos.

## Regla de formularios: nunca un botón apagado sin explicación

Cada formulario que desactiva su botón por una validación debe mostrar **por qué** y **cómo corregirlo**:
- `src/lib/formProblems.ts`: funciones de validación que devuelven el mensaje (o `null` si está bien).
- `src/components/FormProblem.tsx`: cuadro amarillo con el mensaje. Para botones de acción simples se usa la nota corta `form-problem-inline`.
- Los errores que vienen de Supabase pasan por `userFacingError` (`src/lib/tableAccount.ts`), que traduce los códigos
  (permiso, duplicado, en uso, fuera de rango, falta una migración, sesión vencida, sin conexión) y muestra el código técnico
  cuando no lo reconoce. Los mensajes `RAISE EXCEPTION` de las funciones SQL (código P0001) se muestran tal cual.

## Campos numéricos con formato colombiano

Todos los campos numéricos usan `src/components/NumberInput.tsx`: miles con punto (1.234.567) y decimales con coma (1.234,5).
El formulario guarda el valor sin formato y con punto decimal; las reglas están en `src/lib/numberFormat.ts`.
Para un campo numérico nuevo, usa `<NumberInput value={raw} onChange={setRaw} />` (agrega `decimals` o `negative` si hace falta).

## Compra por kilos y valor (costo por gramo)

En Inventario → insumo → Registrar → Compra, los insumos en g/kg/ml/l tienen la casilla "Calcular desde kilos y valor pagado":
escribes los kilos comprados y el valor total (o el valor por kilo) y el sistema calcula la cantidad en gramos y el costo por gramo.
El costo por unidad admite decimales (migración `20261122000000_allow_decimal_unit_costs.sql`).

## Sin internet (instalar la app y vender sin señal)

**Instalar:** abre la app en Chrome o Edge y usa "Instalar" en la barra de direcciones (en el celular: menú → "Añadir a pantalla de inicio"). Se instala como una app, con su icono, y **abre aunque no haya internet** (el service worker `public/sw.js` guarda la app y las fotos de la carta).

**Vender sin internet:** cuando se cae la señal aparece un aviso rojo "Sin internet". En **Carta**, el botón del pedido cambia a *Cobrar en efectivo* / *Cobrar con tarjeta*. La venta se guarda en este equipo y **sube sola** al volver el internet (se reintenta cada 30 s); al subir se borra del equipo. La caja debe estar abierta.

- La función `sync_nexora_offline_sale` (migración `20261123000000_add_nexora_offline_sales.sql`) es **idempotente**: si la señal se corta a mitad de la subida y se reintenta, la venta no se duplica.
- Ya vendida es ya vendida: nunca se rechaza por falta de stock; el inventario se descuenta aunque quede en negativo (se corrige con un ajuste).
- El pago queda con la hora real de la venta y en el turno de caja abierto en ese momento. Se usan los precios vigentes al subir.
- Bre-B necesita internet (hay que confirmar la referencia con el banco). Salón, Cocina, Inventario e Inicio también necesitan internet.
- Cada equipo guarda sus propias ventas: los equipos **no se hablan entre sí** sin internet, así que la cocina no verá el pedido hasta que suba.
- Si una venta es rechazada, queda en rojo con el motivo y se puede descartar; las demás siguen subiendo.
- Se guarda una copia de la última carta, opciones, caja y perfil para poder trabajar sin señal. Para que exista, el equipo debe haber abierto la app con internet al menos una vez ese día.

Código: `src/lib/offline/` (almacén, sincronización, conectividad) y `src/components/OfflineStatusBar.tsx`.

**Campos numéricos:** al entrar a un campo que tiene el 0 por defecto, el 0 se quita solo. Si se sale del campo sin escribir nada, aparece el aviso "Este campo no puede quedar vacío" (escribe 0 si no aplica). Está en `src/components/NumberInput.tsx`, así que vale para todos los formularios.

## Control de horas trabajadas

Cuenta las horas y minutos de cada persona **solo cuando entra desde un equipo asignado al restaurante** (la tablet o el PC de la caja). Menú **Horas**.

**Puesta en marcha (una sola vez):**
1. En Supabase, SQL Editor: correr, en este orden, `supabase/migrations/20261124000000_add_nexora_work_time.sql` y `supabase/migrations/20261125000000_add_nexora_work_payments.sql`.
2. En la tablet/PC del restaurante, entrar como **propietario o gerente** → **Horas** → *Asignar este equipo* (ponerle nombre, ej. "Caja principal"). Se guarda un código secreto en ese navegador; en la base solo queda su huella.
3. Repetir en cada equipo (cocina, otra caja…). Para que funcione como app, instalarla (ver "Sin internet").

**Cómo funciona:**
- Cajero, mesero, cocina e inventario **solo pueden usar la app desde un equipo asignado**; desde cualquier otro sitio ven "Este equipo no está autorizado". Propietario, gerente, marketing y auditor pueden entrar desde cualquier lugar (sus horas solo cuentan en equipos asignados). Roles en `DEVICE_REQUIRED_ROLES` (`src/lib/workTime.ts`).
- El turno **empieza solo** al entrar desde un equipo asignado y la app manda una señal cada minuto. Termina al **cerrar sesión** (Mi perfil). Si la señal se pierde más de 5 minutos, el turno se cierra a la hora de la última señal; si solo se cayó el internet con la app abierta, el turno continúa (máximo 6 h).
- Solo un turno abierto por persona: si entra desde otro equipo, el anterior se cierra.
- El personal **no ve ni maneja turnos**: las horas corren solas desde el login. El menú **Horas** es solo del propietario y gerentes, con filtros hoy / semana / mes / entre dos fechas.
- Propietario y gerente pueden **corregir** o **agregar** un turno (motivo obligatorio; queda registrado quién y por qué). Un equipo perdido se **desactiva** en Horas y deja de funcionar al instante.
- Las horas y días se calculan en hora de Colombia.

**Límite honesto:** el bloqueo de equipos no autorizados lo aplica la app; la base de datos solo cuenta horas desde equipos asignados. No es una barrera contra alguien técnico que hable directo con la API; para eso se necesitaría exigir el código del equipo en cada consulta (se puede agregar después).

### Pago de horas
- En **Horas**, cada persona tiene su **valor por hora** (botón junto a su nombre). Cada semana (lunes a domingo) aparece como **Pagada**, **Pago parcial** o **Sin pagar**, y cada día y turno muestra si ya se pagó.
- **Pagar semana** o **Pagar entre fechas…** genera un pago: horas × valor por hora, con forma de pago (efectivo, transferencia, otro) y nota. Se pagan solo los turnos **terminados y sin pagar** del rango; los turnos en curso quedan pendientes. Nada se paga dos veces.
- El valor por hora usado queda guardado en cada pago: cambiarlo después no altera los pagos ya hechos.
- **Pagos realizados** muestra el historial con quién pagó y cuándo. Un pago equivocado se **anula** (con motivo): las horas vuelven a quedar sin pagar y el pago queda como anulado, no se borra.
- Un turno ya pagado no se puede corregir: primero se anula el pago.
- Hoy el pago queda registrado en el sistema; no se descuenta automáticamente de la caja ni de los gastos.
