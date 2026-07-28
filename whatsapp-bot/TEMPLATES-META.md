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

### Cuerpo (Body) — copia exacta

```text
Hola {{1}},

Ya recibimos tu solicitud de viaje en HonduRaite. En un momento un conductor tomará tu viaje.

Ruta: {{2}}
```

### Variables de ejemplo (Meta te las pide para previsualizar)

| Variable | Ejemplo |
|----------|---------|
| `{{1}}` | `María` |
| `{{2}}` | `Centro → Mercado` |

### Pie (Footer) — opcional

```text
HonduRaite · no respondas a este mensaje automático
```

### Botones
- **Ninguno** (por ahora)

---

## Cómo se ve el mensaje al cliente

> Hola María,  
>  
> Ya recibimos tu solicitud de viaje en HonduRaite. En un momento un conductor tomará tu viaje.  
>  
> Ruta: Centro → Mercado  
>  
> HonduRaite · no respondas a este mensaje automático

---

## Después de que Meta la apruebe

1. Estado de la plantilla: **Active / Aprobada**
2. En el servidor ya está el nombre por defecto: `trip_request_received`
3. Configura en `functions/.env` (y redespliega):

```env
WHATSAPP_ACCESS_TOKEN=tu_token_permanente
WHATSAPP_PHONE_NUMBER_ID=tu_phone_number_id
WHATSAPP_TEMPLATE_TRIP_RECEIVED=trip_request_received
WHATSAPP_TEMPLATE_LANG=es
```

4. Despliega:

```bash
firebase deploy --only functions:onTripCreatedAssignOffer,functions:whatsappWebhook,functions:sendWhatsAppCloudText
```

Cada viaje `pending` nuevo (pedido por el cliente) dispara la plantilla al `clientPhone`.

---

## Texto alternativo (si Meta rechaza el de arriba)

**Nombre:** `trip_request_received`  
**Categoría:** Utility  

```text
Hola {{1}}. Recibimos tu solicitud de viaje. Un conductor la atenderá en breve. Destino: {{2}}.
```

Ejemplos: `{{1}}` = Carlos · `{{2}}` = Hospital Regional

---

## Notas de aprobación Meta

- Categoría **Utility** = avisos de un servicio que el usuario ya pidió (viaje).
- No pongas precios ni promociones en esta plantilla (eso es Marketing y tarda más / se rechaza más).
- El nombre de la plantilla debe ser **exactamente** `trip_request_received` (minúsculas, guiones bajos).
- Si el idioma en Meta es `es_MX` o `es_HN`, pon el mismo código en `WHATSAPP_TEMPLATE_LANG`.
