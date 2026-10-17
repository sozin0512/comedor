# WIP — Zonas de envío fijas + Pedidos de tiendas (staff)

Estado: **en pausa, esperando que Josue apruebe las maquetas**
(/workspace/mockups-pedidos-zonas/). Todavía no hay código de la función: solo este plan.

## Zonas de envío (propuesta)
- Cómo se define una zona: un **polígono dibujado en Google Maps** (es el mapa que ya usa la app).
  Se dibuja con `google.maps.Polygon` editable; no se usa la Drawing Library porque Google la retiró.
  Si dos zonas se cruzan, gana la de prioridad más baja; si empatan, la de menor área.
  Así «Comayagua céntrica» queda dentro de «Fuera del centro».
- Colecciones (las escribe solo el servidor, por callables con Admin SDK):
  - `artifacts/{app}/public/data/delivery_zones/{zoneId}`: name, cityId, polygon[], baseFee, minFee?, maxFee?, priority, active.
  - `artifacts/{app}/public/data/delivery_zone_history/{autoId}`: zoneId, action, byUid, byName, atMs, before, after.
  - `artifacts/{app}/public/data/store_delivery_fees/{storeId}`: { [zoneId]: { mode: 'base'|'custom', fee } }.
- Callables:
  - `staffUpsertDeliveryZone` / `staffSetDeliveryZoneActive`: solo staff, valida con assertCallerCanModerate (claims/roles).
  - `merchantSetStoreZoneFee`: solo el dueño de la tienda; el monto debe quedar dentro del min/max de la zona.
  - `quoteStoreDeliveryFee`: el cliente lo ve antes de confirmar.
- Servidor: el trigger de store_orders creado recalcula deliveryZoneId, deliveryZoneName, deliveryFee y deliveryFeeSource.
  Las reglas no dejan que el cliente escriba esos campos. El viaje de entrega usa ese monto.
- Fuera de toda zona: por defecto se mantiene lo de hoy (precio por km al marcar «listo»). Josue decide si se bloquea.
- Semillas (inactivas): Comayagua céntrica L.40 · Fuera del centro L.110 (rango 100–120) · Periferia (sugerida) L.150 (rango 140–180).

## Pedidos de tiendas (staff)
Estados que ve el panel, sin cambiar los estados que ya usa la tienda:
- recibido = pending/accepted
- en cocina = preparing/ready
- en camino = out_for_delivery
- entregado = delivered
- cancelado = cancelled

Funciones:
- En vivo: sonido con interruptor «Activar sonido» (por el autoplay del navegador) y marca de «atascado» por estado.
- Filtros: tienda, zona y estado.
- Historial con búsqueda y CSV.
- Contadores por día y por tienda.
