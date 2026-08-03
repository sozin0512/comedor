# Plantillas WhatsApp Cloud API · HonduRaite

Crea estas plantillas en **Meta Business Suite → WhatsApp Manager → Plantillas de mensaje**  
(o Developers → tu app → WhatsApp → Message templates).

---

## 1) Solicitud de viaje recibida (USAR ESTA)

Pégala tal cual en Meta. Es la que envía la app cuando un cliente pide un viaje.

| Campo | Valor |
|--------|--------|
| **Nombre de la plantilla** | `trip_request_received` |
| **Idioma** | `Spanish` / `es` (si te deja `es_HN`, también sirve si configuras el mismo en Functions) |
| **Categoría** | **Utility** (Utilidad) — no Marketing |
| **Tipo** | Plantilla personalizada / texto |

### Encabezado
- **Ninguno** (o Texto: `HonduRaite` si Meta lo pide)

### Cuerpo (Body) — copia exacta (recomendado HonduRaite)

```text
Hola {{1}},

✅ Viaje confirmado en HonduRaite.

Estamos esperando que un conductor acepte tu solicitud. Por lo general no tarda mucho, sobre todo si tu cuenta está verificada.

Ruta: {{2}}

Gracias por viajar con nosotros.
```

### Variables de ejemplo (Meta te las pide para previsualizar)

| Variable | Ejemplo |
|----------|---------|
| `{{1}}` | `María` |
| `{{2}}` | `Centro → Mercado` |

### Pie (Footer) — opcional

```text
HonduRaite · Empresa SOZIN
```

### Botones
- **Ninguno** (por ahora)

---

## Cómo se ve el mensaje al cliente

> Hola María,  
>  
> ✅ Viaje confirmado en HonduRaite.  
>  
> Estamos esperando que un conductor acepte tu solicitud. Por lo general no tarda mucho, sobre todo si tu cuenta está verificada.  
>  
> Ruta: Centro → Mercado  
>  
> Gracias por viajar con nosotros.  
>  
> HonduRaite · Empresa SOZIN

---

## Después de que Meta la apruebe

1. Estado de la plantilla: **Active / Aprobada**
2. En el servidor el nombre por defecto es: `trip_request_received`
3. Configura secretos / variables en Firebase Functions:

```env
WHATSAPP_ACCESS_TOKEN=tu_token_permanente
WHATSAPP_PHONE_NUMBER_ID=tu_phone_number_id
WHATSAPP_TEMPLATE_TRIP_RECEIVED=trip_request_received
WHATSAPP_TEMPLATE_LANG=es
WHATSAPP_VERIFY_TOKEN=honduraite_wa_verify_2026_secure
WHATSAPP_APP_SECRET=tu_app_secret_opcional
```

4. Despliega (si aún no lo has hecho):

```bash
firebase deploy --only functions:onTripCreatedAssignOffer,functions:whatsappWebhook,functions:sendWhatsAppCloudText,functions:testWhatsAppTripTemplate
```

Cada viaje `pending` nuevo (pedido por el cliente) dispara la plantilla al `clientPhone` del viaje.

---

## Texto alternativo (si Meta rechaza el de arriba)

**Nombre:** `trip_request_received`  
**Categoría:** Utility  

```text
Hola {{1}}. Viaje confirmado. Esperamos que un conductor acepte tu solicitud; normalmente no tarda mucho si estás verificado. Ruta: {{2}}.
```

Ejemplos: `{{1}}` = Carlos · `{{2}}` = Hospital Regional

---

## Notas de aprobación Meta

- Categoría **Utility** = avisos de un servicio que el usuario ya pidió (viaje).
- No pongas precios ni promociones en esta plantilla (eso es Marketing y tarda más / se rechaza más).
- El nombre de la plantilla debe ser **exactamente** `trip_request_received` (minúsculas, guiones bajos).
- Si el idioma en Meta es `es_MX` o `es_HN`, pon el mismo código en `WHATSAPP_TEMPLATE_LANG`.
