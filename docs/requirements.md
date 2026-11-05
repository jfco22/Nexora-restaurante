# Nexora Restaurant OS

## Documento maestro de requisitos, arquitectura, integración y ejecución

**Versión:** 1.1  
**Estado:** Especificación funcional y técnica inicial  
**Nombre de trabajo:** Nexora  
**Mercado inicial:** Colombia  
**Idioma:** Español colombiano  
**Moneda:** COP  
**Zona horaria:** America/Bogota  
**Tipo de solución:** Aplicación web responsive, multiusuario, multirol y preparada para múltiples sedes

> Nexora es el nombre temporal de trabajo. No representa todavía una marca registrada ni una disponibilidad confirmada de dominio o redes sociales.

## 1. Objetivo

Construir desde cero un sistema integral para restaurantes con marca, código, datos, arquitectura e integraciones propias. Nexora debe conectar operación, carta, inventario, caja, pagos, clientes, marketing e informes mediante datos persistentes y reglas de negocio reales.

El flujo integrado esperado es:

**Cliente → menú digital → carrito → pedido → pago validado o autorización operativa → cocina → preparación → entrega → venta → inventario → informes.**

MesaIA/MesaIA se utilizará únicamente como referencia funcional autorizada. Sus URL, pantallas y comportamiento observado no serán una dependencia técnica, no se copiarán sus datos y no se reutilizarán sus credenciales, código o servicios.

## 2. Reglas obligatorias

1. No simular persistencia únicamente con memoria del navegador, `localStorage` o `sessionStorage`.
2. Utilizar base de datos PostgreSQL persistente mediante Supabase.
3. Validar las operaciones críticas en el servidor y registrar sus eventos importantes.
4. No marcar un pago como aprobado por una redirección, una captura de pantalla o un valor enviado por el navegador.
5. No descontar inventario dos veces por la misma orden.
6. Aislar los datos por organización y sede.
7. No exponer secretos, claves privadas ni permisos administrativos en el frontend.
8. No declarar implementada una integración que solo sea una maqueta.
9. Usar migraciones versionadas, RLS y políticas de acceso apropiadas.
10. Mantener documentación actualizada sobre tablas, estados, permisos e integraciones.
11. No afirmar que una función de MesaIA fue verificada si únicamente aparece en una captura o descripción.
12. No ejecutar cobros reales, eliminaciones irreversibles ni acciones sobre terceros durante las pruebas.

## 3. Módulos funcionales

### Operación

- Salón.
- Cocina.
- Mesas, zonas y códigos QR.
- Pedidos en mesa, barra y mostrador.
- Pedidos para llevar.
- Domicilios.
- Reservas.
- Plazoletas o zonas de servicio.
- Promociones operativas.

### La carta

- Productos.
- Categorías.
- Qué se vende: productos, combos y servicios.
- Fotografías.
- Precios y disponibilidad.
- Recetas.
- Ingredientes y materias primas.
- Modificadores, variantes y complementos.
- Inventario.

La carta debe ser visual. Cada producto debe mostrar fotografía, nombre, descripción, precio, categoría, disponibilidad, variantes y complementos. El cliente debe poder agregar, disminuir, editar o retirar productos del pedido.

### Dinero

- Caja y turnos.
- Ventas.
- Cierres y conciliación.
- Informes financieros gerenciales.
- Clientes para fiar y cuentas por cobrar.
- Gastos.
- Capital y aportes.
- Compras y recepción de mercancía.
- Pagos y reembolsos.

### Comunicación y marketing

- Clientes y segmentos.
- Promociones.
- Campañas.
- WhatsApp mediante proveedor oficial.
- Facebook e Instagram mediante APIs oficiales cuando la cuenta sea elegible.
- Historial de comunicaciones.
- Consentimientos y preferencias.

### Inteligencia de negocios

- Tablero ejecutivo.
- Ventas y ticket promedio.
- Productos de mayor y menor rotación.
- Inventario crítico.
- Rentabilidad y margen de contribución.
- Presupuesto frente a ejecución.
- Alertas.
- Pronósticos simples.
- Recomendaciones explicables.

## 4. Arquitectura tecnológica

- Frontend: React, TypeScript y Vite.
- Estilos: Tailwind CSS y componentes accesibles.
- Backend y persistencia: Supabase con PostgreSQL.
- Identidad: Supabase Auth cuando se implemente autenticación.
- Autorización: organización, sede, rol y permiso.
- Tiempo real: Supabase Realtime para cocina, salón y pedidos.
- Imágenes y documentos: almacenamiento privado con controles de acceso.
- Integraciones: adaptadores independientes para pagos, comunicación y delivery.
- Pruebas: pruebas unitarias, integración y flujos críticos de interfaz.

La aplicación se separará en presentación, aplicación, dominio, persistencia e integración. La interfaz no decidirá si un pago está aprobado, si un usuario puede modificar inventario, si existe saldo suficiente o si una cuenta puede cerrarse.

## 5. Organizaciones, sedes y permisos

Entidades iniciales:

- Organización.
- Sede.
- Perfil de usuario.
- Membresía.
- Rol.
- Permiso.
- Asignación por sede.
- Registro de auditoría.

Roles sugeridos:

- Propietario.
- Administrador.
- Gerente de sede.
- Cajero.
- Mesero.
- Cocinero.
- Encargado de inventario.
- Contador.
- Marketing.
- Auditor de solo lectura.

El backend debe comprobar la organización y sede en cada operación. Un usuario puede tener permisos diferentes en distintas sedes. Las tablas nuevas deben tener RLS habilitado, políticas separadas por operación y permisos mínimos para cada rol.

## 6. Menú digital

Cada producto tendrá:

- Nombre, descripción y fotografía.
- Categoría y orden de presentación.
- Precio en COP almacenado sin cálculos monetarios de punto flotante.
- Estado activo/inactivo.
- Disponibilidad temporal y por sede.
- Receta asociada, si corresponde.
- Control de inventario opcional.
- Tiempo estimado de preparación.
- Modificadores, variantes y complementos.
- Información de alérgenos cuando haya sido registrada.

El carrito debe permitir cambiar cantidades, retirar productos, editar opciones, añadir observaciones, calcular subtotales, descuentos, impuestos y total, seleccionar tipo de servicio, asociar mesa o cliente y seleccionar medio de pago. El backend recalculará precios y validará productos antes de aceptar el pedido.

Los precios y descripciones aplicados se conservarán como instantánea en la línea de la venta para que los cambios futuros del catálogo no alteren el historial.

## 7. Pedidos, cuentas y cocina

Los pedidos pueden originarse en menú QR, menú web, mesero, cajero, administrador, integración externa o registro manual. Deben conservar canal, sede, tipo de servicio y actor de creación.

Tipos de servicio:

- Salón.
- Barra.
- Para llevar.
- Domicilio propio.
- Domicilio de plataforma.
- Otro canal configurable.

Estados independientes:

- Pedido: `draft`, `submitted`, `accepted`, `cancelled`, `completed`.
- Pago: `unpaid`, `pending`, `authorized`, `paid`, `failed`, `partially_refunded`, `refunded`.
- Cocina: `queued`, `accepted`, `preparing`, `ready`, `delivered`, `cancelled`.
- Delivery: `not_applicable`, `awaiting_assignment`, `assigned`, `picked_up`, `in_transit`, `delivered`, `delivery_failed`, `cancelled`.

Una mesa puede tener una o varias cuentas según la configuración. Se debe permitir abrir mesa, agregar productos, transferir con autorización, dividir por productos o valores, registrar pagos parciales, cerrar cuenta y consultar historial. Una cuenta no se cierra con saldo pendiente salvo autorización explícita para cuenta por cobrar.

La cocina debe recibir comandas sin recarga manual y mostrar orden, mesa o canal, hora, tiempo transcurrido, productos, cantidades, variantes, observaciones, prioridad y estado. Una orden puede generar comandas para varias estaciones.

## 8. Inventario y recetas

Los ingredientes deben tener unidad base, unidad de compra, conversiones explícitas, existencia, mínimos, costo, proveedor, lote, vencimiento, sede y almacén.

Las recetas deben conservar versiones y registrar producto, porciones, ingredientes, cantidades, unidades, mermas, rendimiento, sustituciones, costo y vigencia.

Movimientos permitidos:

- Compra recibida.
- Consumo por venta.
- Preparación de lote.
- Devolución.
- Merma.
- Ajuste positivo o negativo.
- Transferencia.
- Corrección autorizada.
- Reversión.

Cada movimiento tendrá ingrediente, cantidad, unidad, sede, almacén, tipo, documento relacionado, usuario, motivo e identificador de idempotencia cuando corresponda.

El control de inventario podrá activarse por producto. Para el MVP se propone reservar o descontar la demanda teórica al aceptar la orden, con reversión controlada antes de comenzar la preparación. Si la cocina ya consumió ingredientes, la corrección se hará con un ajuste real y auditable, no mediante una reposición automática ficticia.

Las compras aumentarán existencias únicamente al recibir y confirmar la mercancía. Los conteos físicos producirán diferencias y ajustes auditables.

## 9. Pagos e integración financiera

### Métodos mínimos confirmados

- Tarjeta débito.
- Tarjeta crédito.
- Efectivo.
- Bre-B.

Nequi, PSE, otras billeteras y demás medios quedarán como integraciones opcionales, sujetas a la disponibilidad del proveedor contratado.

### Arquitectura

Nexora utilizará una interfaz interna de pagos con estas operaciones:

- Crear intento.
- Consultar estado.
- Procesar notificación.
- Confirmar transacción.
- Registrar rechazo.
- Gestionar reembolso.
- Conciliar.

Cada proveedor será un adaptador separado. No se guardarán números completos de tarjeta, CVV ni credenciales bancarias. La confirmación se basará en webhook autenticado o consulta segura al proveedor.

### Bre-B con llaves estáticas

Para la primera versión, Bre-B se define como un flujo de **llave estática de comercio**, no como una llave dinámica por pedido.

La llave estática será una llave Bre-B registrada a nombre del restaurante o comercio, administrada por una entidad financiera, nodo SPBVI, adquirente o proveedor autorizado. Nexora la mostrará junto con un QR estático o una instrucción de pago, pero no la considerará por sí sola evidencia de que una orden fue pagada.

Flujo previsto:

1. Nexora crea la orden con estado de pago `pending`.
2. La pantalla muestra el valor, la referencia de pedido y la llave estática o QR estático del comercio.
3. El cliente realiza la transferencia desde su entidad financiera.
4. El cliente puede informar la referencia de la orden, cuando el canal lo permita.
5. Nexora recibe confirmación automática del proveedor, conciliación bancaria o revisión autorizada del pago.
6. El sistema compara referencia, valor, fecha, comercio y estado.
7. Solo una coincidencia válida cambia el pago a `paid`.
8. Un pago no conciliado permanece `pending` y no debe activar automáticamente la comanda.

La llave estática permite recibir pagos, pero no identifica de forma inherente qué pedido pagó cada cliente. Por eso, para pedidos digitales no se debe prometer confirmación instantánea sin un proveedor que entregue conciliación, API, webhook, extracto estructurado o mecanismo equivalente.

En pagos presenciales, el cajero puede confirmar manualmente una transferencia únicamente si tiene permiso y sigue un procedimiento de conciliación definido. Una captura de pantalla del cliente no es suficiente para aprobar el pago.

### Bre-B y proveedores

Bre-B es la infraestructura interoperable de pagos inmediatos de Colombia, no una API única de recaudo para Nexora. La integración debe contratarse con una entidad o proveedor que ofrezca específicamente pagos entrantes, QR o llave de comercio y confirmación verificable.

Redeban es una alternativa a evaluar porque publica servicios de conexión con Bre-B, llaves, códigos QR, recaudos, integraciones de comercio electrónico y links de pago. La guía localizada de Wompi corresponde a dispersiones a llaves Bre-B; no se asumirá que permite recaudo de clientes hasta confirmar un producto de pay-in, sus webhooks y condiciones comerciales.

La selección definitiva requiere confirmar:

- Si soporta recaudo entrante.
- Si ofrece llave y QR estáticos.
- Si ofrece QR dinámico como evolución futura.
- Si entrega webhook o consulta server-to-server.
- Si permite referencia por transacción.
- Si tiene sandbox.
- Tarifas, límites y tiempos de conciliación.
- Requisitos contractuales y de certificación.

### Caja

Registrar apertura, fondo inicial, ventas por medio, entradas y salidas autorizadas, gastos, retiros, devoluciones, cierre, efectivo contado, diferencias, responsable y aprobador. Pagos electrónicos no incrementan el efectivo físico esperado.

## 10. Mesas, QR, reservas y domicilios

Las mesas tendrán código, zona, capacidad, estado, sede, QR, configuración de pedidos e historial. El QR público no incluirá credenciales ni permisos administrativos y el servidor validará que la mesa y sede sigan activas.

Las reservas manejarán fecha, hora, personas, datos mínimos del cliente, observaciones, confirmación, cancelación, reprogramación, mesa, capacidad y lista de espera.

Los domicilios registrarán cliente, teléfono cuando sea necesario, dirección, indicaciones, zona, costo, responsable, estado y horas relevantes. Las plataformas externas se conectarán solo mediante APIs autorizadas; mientras tanto se permitirá registro manual.

## 11. Clientes, marketing e inteligencia

El registro de cliente será opcional para consultar la carta y deberá separar los datos necesarios para ejecutar un pedido del consentimiento para marketing. Se registrarán fecha, canal, finalidad y retiro del consentimiento cuando corresponda.

Las promociones podrán ser porcentuales, de valor fijo, combos, producto adicional, horario, sede o segmento. El backend validará límites, condiciones y acumulación.

WhatsApp, Facebook e Instagram se integrarán únicamente por APIs oficiales o proveedores autorizados. Si una acción no está soportada, Nexora podrá generar el contenido para publicación manual sin afirmar que fue enviado.

Los informes mostrarán ventas, pedidos, ticket promedio, métodos de pago, gastos, cuentas por cobrar, compras, costos, margen de contribución, inventario y flujo de caja gerencial. Los pronósticos y recomendaciones mostrarán su periodo, datos y supuestos; no se presentarán estimaciones como hechos.

## 12. Modelo de datos inicial

### Seguridad y organizaciones

`organizations`, `locations`, `user_profiles`, `memberships`, `roles`, `permissions`, `role_permissions`, `location_memberships`, `audit_logs`.

### Carta e inventario

`categories`, `products`, `product_location_settings`, `product_images`, `modifier_groups`, `modifier_options`, `product_modifier_groups`, `product_price_history`, `ingredients`, `unit_conversions`, `suppliers`, `recipes`, `recipe_versions`, `recipe_items`, `inventory_locations`, `inventory_balances`, `inventory_movements`, `purchase_orders`, `goods_receipts`, `inventory_counts`.

### Pedidos y operación

`dining_zones`, `tables`, `table_qr_tokens`, `orders`, `order_items`, `order_item_modifiers`, `order_status_history`, `kitchen_stations`, `kitchen_tickets`, `kitchen_ticket_items`, `reservations`, `delivery_jobs`, `delivery_status_history`.

### Pagos y finanzas

`payment_attempts`, `payments`, `payment_events`, `refunds`, `cash_registers`, `cash_shifts`, `cash_movements`, `sales`, `expenses`, `accounts_receivable`, `receivable_payments`, `capital_movements`, `reconciliation_records`.

### Clientes y marketing

`customers`, `customer_consents`, `customer_segments`, `customer_segment_members`, `promotions`, `campaigns`, `campaign_recipients`, `communication_events`, `social_publications`, `integration_connections`.

### Analítica

`budgets`, `budget_lines`, `business_alerts`, `forecast_runs`, `analytics_snapshots`.

Usar claves foráneas, restricciones de estados y cantidades, índices, timestamps, borrado lógico donde sea necesario y transacciones para operaciones que modifiquen varias entidades. No eliminar silenciosamente movimientos financieros, de inventario o de auditoría.

## 13. Operaciones transaccionales críticas

El servidor debe procesar como unidades coherentes:

- Confirmación de orden: validar sede, productos, precios, opciones, disponibilidad, inventario y eventos.
- Confirmación de pago: validar fuente, referencia, valor, moneda, estado, firma e idempotencia.
- Consumo de inventario: identificar receta, comprobar consumos previos y registrar movimientos.
- Cancelación: considerar preparación, pago, reembolso, inventario, caja y comisiones.
- Cierre de caja: calcular esperado, contar efectivo, conciliar medios electrónicos y registrar diferencias.

Para eventos críticos se recomienda una outbox transaccional y consumidores idempotentes.

## 14. Seguridad y privacidad

Implementar autenticación, autorización por rol y sede, RLS, validación en servidor, almacenamiento seguro de secretos, auditoría, protección de webhooks, límites contra abuso, control de imágenes y documentos, copias de seguridad, restauración comprobable, revocación de sesiones y gestión de consentimiento.

No usar una clave administrativa de base de datos en el navegador. No permitir que el frontend decida roles, sede activa, aprobación de pagos, costos, inventario o cierre de caja.

## 15. Auditoría de referencia MesaIA

Las referencias funcionales son:

- https://www.mesaia.com.co/dashboard/salon
- https://www.mesaia.com.co/funciones
- https://www.mesaia.com.co/funciones/menu-qr-restaurantes

Estas URL sirven únicamente para observar conceptos, pantallas y flujos cuando exista acceso legítimo. Cada función se clasificará como:

- **VERIFICADO:** observada y probada mediante interacción.
- **OBSERVADO:** visible, pero no probada.
- **INFERIDO:** deducida de información indirecta.
- **BLOQUEADO:** requiere acceso o información adicional.
- **NO IMPLEMENTADO:** confirmado que no existe en Nexora.

No se declarará completa la auditoría sin documentar flujos críticos o bloqueos explícitos.

## 16. Fases de construcción

### Fase 0 — Descubrimiento

Arquitectura, mapa de pantallas, modelo inicial, permisos, flujos, integraciones, riesgos y criterios de aceptación.

### Fase 1 — Fundación técnica

Supabase, autenticación, organización, sedes, roles, permisos, migraciones, RLS, auditoría, errores y entorno de pruebas.

**Salida:** usuarios de sedes diferentes no pueden leer ni modificar datos ajenos.

### Fase 2 — Catálogo y menú

Categorías, productos, imágenes, precios, variantes, complementos, disponibilidad, menú visual, carrito y persistencia.

### Fase 3 — Salón, caja y cocina

Mesas, QR, cuentas, toma de pedidos, comandas, estados de cocina, notificaciones y entrega.

### Fase 4 — Recetas e inventario

Ingredientes, conversiones, recetas, rendimientos, compras, mermas, conteos y movimientos integrados con pedidos.

### Fase 5 — Pagos

Efectivo, tarjeta y adaptador Bre-B con llave estática, estados pendientes, conciliación manual o automática según proveedor, webhooks disponibles e idempotencia.

### Fase 6 — Finanzas

Ventas, caja, gastos, cuentas por cobrar, capital e informes gerenciales.

### Fase 7 — Reservas y delivery

Capacidad, estados de entrega, operación manual y conectores disponibles.

### Fase 8 — Marketing

Segmentos, consentimientos, promociones, campañas y conectores oficiales.

### Fase 9 — Analítica

Tableros, rentabilidad, presupuestos, alertas, pronósticos y recomendaciones explicables.

No se deben construir todas las pantallas a la vez dejando botones sin lógica. Cada fase debe entregar un flujo completo y verificable.

## 17. Pruebas de aceptación

Probar como mínimo:

- Un pedido válido persiste y llega a cocina.
- Un precio manipulado se recalcula o rechaza.
- Un producto inactivo no se puede comprar.
- Una comanda no se duplica.
- Una orden no descuenta inventario dos veces.
- Una merma queda auditada.
- Una sede no accede a otra.
- Un pago rechazado no queda como pagado.
- Un evento duplicado no produce un segundo cobro.
- Una firma inválida se rechaza.
- Una orden Bre-B con llave estática permanece pendiente hasta conciliación válida.
- Una captura de pantalla no aprueba automáticamente un pago.
- El efectivo esperado excluye pagos electrónicos.
- Las ventas históricas conservan precio y descripción originales.
- Los datos sobreviven a una recarga y a un cierre de sesión.
- Una transacción fallida no deja registros críticos incompletos.

## 18. Decisiones pendientes antes de producción

1. Seleccionar proveedor para recaudo Bre-B con llave estática y, posteriormente, QR dinámico si se requiere.
2. Confirmar si la primera versión usará conciliación manual, extractos estructurados o webhook.
3. Definir cuándo se reserva y cuándo se descuenta inventario.
4. Confirmar número inicial de sedes, cajas y usuarios.
5. Definir autorizaciones para descuentos, devoluciones, fiados y ajustes.
6. Decidir si la primera versión tendrá solo informes gerenciales o contabilidad formal.
7. Confirmar proveedores oficiales para WhatsApp y Meta.
8. Validar disponibilidad de marca, dominio y redes para Nexora.

## 19. Siguiente tarea autorizada

Antes de implementar módulos funcionales, entregar:

1. Arquitectura propuesta.
2. Diagrama de componentes.
3. Flujo de pedidos y pagos.
4. Modelo de datos inicial.
5. Matriz de roles y permisos.
6. Matriz de integraciones, incluyendo Bre-B estático.
7. Lista de decisiones pendientes.
8. Riesgos técnicos y comerciales.
9. Plan de implementación por fases.
10. Criterios de aceptación de la Fase 1.
11. Confirmación de capacidades reales del entorno para Supabase, almacenamiento y funciones servidor.

La implementación comenzará únicamente después de validar esta arquitectura y cerrar las decisiones imprescindibles.

## Fuentes de referencia sobre Bre-B

- Banco de la República: https://www.banrep.gov.co/es/bre-b/que-es
- Preguntas frecuentes de Bre-B: https://www.banrep.gov.co/es/bre-b/preguntas-frecuentes
- Redeban y Bre-B: https://www.redeban.com/bre-b
- Guía de Wompi sobre Bre-B: https://docs.wompi.co/docs/colombia/guia-integracion-breb

Estas fuentes sirven para orientar la arquitectura. La disponibilidad real de recaudo, llaves, QR, webhooks, sandbox, tarifas y condiciones debe confirmarse directamente con el proveedor elegido antes de presentar Bre-B como una integración operativa.
