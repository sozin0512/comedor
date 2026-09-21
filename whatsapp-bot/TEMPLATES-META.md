# Plantillas WhatsApp Cloud API · HonduRaite

Nombres e idioma deben coincidir con Functions (`.env`):

- `WHATSAPP_TEMPLATE_LANG=es_HN`
- Pie en Meta: `HonduRaite · Viaja seguro`

---

## 0) Pasajero — solicitud recibida (NO cambiar)

Sigue `tu_viaje_esta_confirmado`: `{{1}}` nombre · `{{2}}` ruta Origen → Destino.

---

## 1) Conductor — viaje nuevo

| Campo | Valor |
|--------|--------|
| **Nombre en código** | `nuevo_viaje` (`WHATSAPP_TEMPLATE_DRIVER_NEW_TRIP`) |
| **Variables** | `{{1}}` origen · `{{2}}` destino · `{{3}}` distancia · `{{4}}` link (`https://honduraite.com/?trip=ID#driver`) |

**Cuerpo en Meta (actualizar y enviar a revisión):**

```
Hay un viaje nuevo en HonduRaite.

Origen: {{1}}
Destino: {{2}}
Distancia: {{3}}

Entra a la plataforma y acéptalo aquí:
{{4}}
```

Botón opcional (CTA URL): `https://honduraite.com/?trip=` + sufijo dinámico.

Hasta que Meta apruebe las 4 variables, el código manda las 3 actuales y, si el conductor ya escribió al bot (ventana 24 h), un texto extra con el link.

Se envía a conductores de la ciudad (app cerrada / sin push) y al ofertado.

---

## 2) Viaje confirmado (pasajero)

| Campo | Valor |
|--------|--------|
| **Nombre** | `viaje_confirmado` |
| **Cuerpo (referencia)** | Conductor `{{1}}` · Vehículo `{{2}}` · Placa `{{3}}` · `{{4}}` minutos |

Se dispara cuando un conductor **acepta**.

---

## 3) Conductor llegó

| Campo | Valor |
|--------|--------|
| **Nombre** | `conductor_llego` |
| **Variables** | `{{1}}` conductor · `{{2}}` placa · `{{3}}` teléfono del conductor |

Se dispara al marcar **llegó**.

---

## 4) Cliente — chats sin ver (viaje activo)

| Campo | Valor |
|--------|--------|
| **Nombre** | `chats_sin_ver` (`WHATSAPP_TEMPLATE_CHAT_UNREAD`) |
| **Variables** | `{{1}}` nombre · `{{2}}` link del viaje (`https://honduraite.com/?trip=ID&openChat=1`) |
| **Cuerpo (referencia)** | `{{1}}, tienes mensajes sin ver en tu viaje HonduRaite. Responde aquí: {{2}}` |

Se dispara si hay mensajes sin abrir en ~25 s: al **cliente** (escribe el conductor) o al **conductor** (escribe el pasajero). Si ya hay ventana de 24 h con el bot, se manda texto de sesión; esta plantilla es respaldo.

---

Despliegue:

```bash
firebase deploy --only functions:onTripCreatedAssignOffer,functions:onTripUpdatePush,functions:nudgeUnseenTripChats,functions:testWhatsAppTripTemplate,functions:whatsappWebhook
```
