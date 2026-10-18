# Tasa de aceptación por categoría + "No disponible" + pedidos de tienda

Rama: `feature/tasa-aceptacion-disponibilidad` (desde `main` 1c5b694). **Sin deploy.** Mockups: `/workspace/mockups-tasa-disponibilidad/*.png` (en el box).

Pedido de Josue: *"crea una tasa de aceptación para todas las categorías, me gustaría que si un servicio como grúa o fletes no está disponible diga que no está disponible para evitar que alguien pida y el servicio no esté"*, y después *"arregla todo por favor"*.

## 1. Categorías

| Categoría (tasa) | Viene de | Vehículo |
|---|---|---|
| Taxi VIP | `serviceType: auto` | auto |
| Taxi tradicional | `taxi` | taxi (placa T-) |
| Moto pasajeros | `moto` | moto |
| Envío / Comida | `delivery` sin `storeOrderId` | moto |
| Pedido de tienda | `delivery` con `storeOrderId` / `storeDelivery` / `createdByMerchant` | moto **o Taxi VIP** |
| Flete (Paila + Camión) | `flete_paila`, `flete_camion` | paila / camion |
| Grúa | `grua` | grua |
| Por hora | `bookingType: hourly` | — |

## 2. Tasa de aceptación

**Tasa = aceptadas ÷ (aceptadas + sin conductor + cliente canceló antes de que alguien aceptara).**

- *Aceptada*: el viaje tuvo `driverId`/`acceptedAt`, aunque después se cancelara.
- *Sin conductor*: se venció (`expired`) o se canceló sin conductor y sin que la cancelara el cliente.
- *Cliente canceló antes*: `cancelledBy` es el cliente y no había conductor.
- Los que siguen **buscando** se muestran aparte y no cuentan.
- No se cuentan: papelera, simulaciones de demanda y programados que todavía no tienen conductor.
- Además se muestra la *espera promedio hasta aceptar*.
- La tabla por conductor muestra **ofertas** (vio ∪ pasó ∪ tomó) contra **aceptó**.
- Colores: ≥80 % verde, 55–79 % amarillo, <55 % rojo. La "más baja" solo aparece si la categoría tiene al menos 3 solicitudes.

Dónde se ve: **Viajes → pestaña "Tasa de aceptación"**. Respeta los filtros de periodo, ciudad, servicio y prueba. Se calcula en el navegador con los viajes que el panel ya tiene cargados, así que no hace lecturas nuevas.

Código: `js/service-availability.js` (`classifyRequest`, `computeAcceptanceStats`) y `js/ops-viajes-panel.js` (`renderRate`).

## 3. Disponibilidad ("No disponible")

Cada servicio tiene un modo por ciudad, con un valor general en "Todas las ciudades" que la ciudad puede sobrescribir:

- **Automático**: está disponible solo si hay al menos 1 conductor aprobado, en línea (actualizado hace menos de 45 min), de ese vehículo y en esa ciudad (por `serviceZoneId` o dentro de 15 km; para paila, camión y grúa dentro de 40 km).
- **Siempre abierto**
- **Cerrado** (con mensaje opcional, máx. 160 caracteres)

Valores por defecto: **grúa, flete paila y flete camión = Automático**; el resto = Siempre abierto, que es como funciona hoy. El apagado viejo de admin (`disabledServicesByCity`) sigue contando como Cerrado.

- **Staff**: Viajes → pestaña **"Disponibilidad"** (supervisor/admin). Usa el callable `staffSetServiceAvailability`, que guarda en `appSettings/main.serviceAvailability` y registra cada cambio en `service_availability_history`.
- **App pasajero**:
  - El servicio ya **no se esconde**: se ve gris con la etiqueta "No disponible".
  - Al tocarlo sale una hoja con el mensaje y los botones Entendido / WhatsApp. No se crea ninguna solicitud.
  - Al pedir se vuelve a revisar.
  - El conteo usa el listener de `drivers_location` que el pasajero ya tenía abierto, así que no hay lecturas extra.
  - Si no hay datos, no bloquea.
  - Los viajes programados solo se bloquean si el servicio está Cerrado.
- **Bot WhatsApp**: antes de crear el viaje, `checkServiceAvailable` responde "no disponible" y ofrece otro servicio. Si el chequeo falla, el viaje se crea igual.
- **Límite**: no hay bloqueo en el servidor para viajes creados desde la app. Una app vieja en caché podría crear uno.

## 4. Pedidos de tienda (5 arreglos)

1. **Push a moto y Taxi VIP.** `requiredVehicleTypesForTrip` devuelve `['moto','auto']` para un pedido de tienda. Se aplica en la notificación de viaje nuevo, en la de "sin cobertura" y en la de offline. Título: "🛍️ Pedido de tienda".
2. **Pantalla del conductor después de aceptar** (`#driver-store-order-panel`): checklist de productos, total de la tienda, destinatario con botones de llamar y WhatsApp, y notas.
3. **Oferta**: insignia "Pedido de tienda" + zona, y una caja **"Cobrar al cliente en efectivo"** con productos + envío. Si se pagó con puntos o saldo, solo se cobra el envío.
4. **Entregado automático.** El trigger `onStoreTripStatusSync` mueve el pedido así:
   - viaje completado → *delivered*
   - viaje aceptado → *out_for_delivery* con el conductor
   - conductor cancela y el viaje se reofrece → *ready / driver_requeued*
   - viaje cancelado o vencido → *ready* sin `tripId`, y la tienda recibe "⚠️ Entrega sin conductor"
5. **Push al cliente**: al pedir la moto el pedido queda *ready + searching_driver* y llega "Buscando conductor…". "Pedido en camino" solo se manda cuando un conductor acepta. La tienda conserva "Marcar entregado a mano".

## 5. Pruebas

- `node scripts/test-tasa-disponibilidad.mjs`: 64/64.
- Suites que ya existían, sin regresiones: `test-viajes-panel`, `test-delivery-zones`, `test-driver-push-status`, `test-push-*`, `test-roles-*`, `test-avisos-tab`, `test-papelera-conductores`, `test-tiendas-zonas-ui`, `test-viaje-atascado-papelera`, `test-driver-online-*`, `test-rules-delivery-zones`.
- `test-rules-tiendas-18` tiene 2 fallos que ya existían. Las reglas no se tocaron.
- `node scripts/sync-service-availability.js --check`: la copia del servidor (`functions/service-availability-core.js`) se genera desde `js/service-availability.js`. Hay que correrlo sin `--check` cada vez que se edite ese archivo.

## 6. Deploy (solo con aprobación de Josue)

- Functions: nuevos `staffSetServiceAvailability` y `onStoreTripStatusSync`, más cambios en push y bot.
- Hosting y push a `comedor`.
- No hacen falta cambios de reglas ni índices.
