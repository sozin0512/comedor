# Plantillas WhatsApp Cloud API · HonduRaite

Todas van en categoría **UTILITY** (`es_HN`). Las de marketing viejas se borraron; no hay fallback.

---

## 0) Pasajero — solicitud recibida

| Campo | Valor |
|--------|--------|
| **Nombre** | `solicitud_viaje_recibida` (`WHATSAPP_TEMPLATE_TRIP_RECEIVED`) |
| **Variables** | `{{1}}` nombre · `{{2}}` ruta |

---

## 1) Conductor — viaje nuevo

| Campo | Valor |
|--------|--------|
| **Nombre** | `viaje_pendiente_chofer` (`WHATSAPP_TEMPLATE_DRIVER_NEW_TRIP`) |
| **Variables** | `{{1}}` origen · `{{2}}` destino · `{{3}}` distancia |
| **Botón** | Abrir HonduRaite → `https://honduraite.com/?openDriver=1` |

---

## 2) Viaje confirmado (pasajero)

| Campo | Valor |
|--------|--------|
| **Nombre** | `conductor_acepto_viaje` (`WHATSAPP_TEMPLATE_TRIP_CONFIRMED`) |
| **Variables** | `{{1}}` conductor · `{{2}}` vehículo · `{{3}}` placa · `{{4}}` minutos |

---

## 3) Conductor llegó

| Campo | Valor |
|--------|--------|
| **Nombre** | `conductor_en_recogida` (`WHATSAPP_TEMPLATE_DRIVER_ARRIVED`) |
| **Variables** | `{{1}}` conductor · `{{2}}` placa · `{{3}}` teléfono |

---

## 4) Chats sin ver (viaje activo)

| Campo | Valor |
|--------|--------|
| **Nombre** | `mensajes_viaje_pendientes` (`WHATSAPP_TEMPLATE_CHAT_UNREAD`) |
| **Variables** | `{{1}}` nombre · `{{2}}` enlace `https://honduraite.com/?trip=ID&openChat=1` |

Primero intenta texto de sesión (24 h); esta plantilla es respaldo.

---

Despliegue:

```bash
firebase deploy --only functions:onTripCreatedAssignOffer,functions:onTripUpdatePush,functions:nudgeUnseenTripChats,functions:testWhatsAppTripTemplate,functions:whatsappWebhook --force
```
