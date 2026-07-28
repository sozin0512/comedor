# HonduRaite · WhatsApp Cloud API (Meta oficial)

Guía para configurar en **Meta for Developers** la **URL de devolución de llamada** y el **Token de verificación**.

---

## Valores para pegar en Meta (ya listos en el código)

| Campo en Meta | Valor |
|---------------|--------|
| **Token de verificación** | `honduraite_wa_verify_2026_secure` |
| **URL de devolución de llamada** | `https://us-central1-comedor-86278.cloudfunctions.net/whatsappWebhook` |

> Si tu proyecto de Firebase **no** es `comedor-86278`, cambia solo el ID del proyecto en la URL.  
> Tras el deploy, confirma la URL con:  
> `firebase functions:list`

---

## Paso a paso en Meta

1. Entra a [developers.facebook.com](https://developers.facebook.com) → tu app → **WhatsApp** → **Configuración** (o **API Setup** / **Webhooks**).
2. En **Webhooks** / **Configurar webhooks**:
   - **URL de devolución de llamada**: pega la URL de arriba.
   - **Token de verificación**: pega `honduraite_wa_verify_2026_secure` (exacto, sin espacios).
3. Pulsa **Verificar y guardar**.
4. Suscríbete al campo **`messages`** (y si quieres: `message_template_status_update`).

Si la verificación falla, casi siempre es porque:
- la función **aún no está desplegada**, o
- el token no coincide, o
- la URL está mal (typo / proyecto incorrecto).

---

## 1) Desplegar el webhook (obligatorio antes de verificar)

En la raíz del repo:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions:whatsappWebhook
```

Opcional (envío de texto desde staff):

```bash
firebase deploy --only functions:whatsappWebhook,functions:sendWhatsAppCloudText
```

### Cambiar el token de verificación (recomendado en producción)

```bash
firebase functions:config:set   # (legacy; prefer params abajo)
```

Con **params** (Functions v2), al desplegar puedes pasar:

```bash
firebase deploy --only functions:whatsappWebhook --set-env-vars WHATSAPP_VERIFY_TOKEN=tu_token_secreto_aqui
```

Si cambias el token en Firebase, **debes usar el mismo** en Meta.

---

## 2) Tokens de Meta (para enviar mensajes)

En Meta → WhatsApp → **API Setup**:

| Dato | Dónde se usa |
|------|----------------|
| **Phone number ID** | `WHATSAPP_PHONE_NUMBER_ID` |
| **Temporary / Permanent access token** | `WHATSAPP_ACCESS_TOKEN` |
| **App Secret** (App → Configuración → Básica) | `WHATSAPP_APP_SECRET` (valida firmas del webhook) |

Ejemplo al desplegar envío:

```bash
firebase functions:config:export   # si usas secrets, mejor Secrets Manager

# Con variables de entorno en el deploy (ajusta según tu CLI):
firebase deploy --only functions:sendWhatsAppCloudText
```

Recomendado: guardar secretos con:

```bash
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN
# o documentar en consola de Google Cloud → Cloud Functions → variables
```

En el código actual se leen con `defineString` (`WHATSAPP_*`).  
Puedes fijarlos en Google Cloud Console → Cloud Functions → `whatsappWebhook` / `sendWhatsAppCloudText` → **Variables y secretos**.

---

## 3) Qué hace el webhook

| Método | Uso |
|--------|-----|
| `GET` | Meta verifica el token y el servidor devuelve el `hub.challenge` |
| `POST` | Meta envía mensajes/estados; se guardan en Firestore |

Colecciones (app `comayagua-vip-pro-v4`):

- `artifacts/.../whatsapp_cloud_events` — eventos crudos / estados
- `artifacts/.../whatsapp_cloud_inbox` — mensajes entrantes
- `artifacts/.../whatsapp_cloud_outbox` — envíos hechos con `sendWhatsAppCloudText`

---

## 4) Probar la verificación a mano

```bash
curl "https://us-central1-comedor-86278.cloudfunctions.net/whatsappWebhook?hub.mode=subscribe&hub.verify_token=honduraite_wa_verify_2026_secure&hub.challenge=12345"
```

Debe responder exactamente:

```text
12345
```

---

## 5) Plantillas (campañas oficiales)

Con Cloud API **solo puedes iniciar** conversaciones con **plantillas aprobadas** por Meta (fuera de la ventana de 24 h de respuesta del usuario).

1. Meta Business Suite → **Plantillas de mensaje**
2. Crea plantillas (utilidad / marketing) y espera aprobación
3. Luego se envían con el endpoint de templates (se puede ampliar después)

El bot Baileys de `whatsapp-bot/` es temporal y **no oficial**. Cuando Cloud API esté lista, apaga Baileys.

---

## Checklist rápido

- [ ] `firebase deploy --only functions:whatsappWebhook`
- [ ] URL en Meta = `https://us-central1-comedor-86278.cloudfunctions.net/whatsappWebhook`
- [ ] Token en Meta = `honduraite_wa_verify_2026_secure`
- [ ] **Verificar y guardar** OK
- [ ] Suscripción a `messages`
- [ ] (Opcional) `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` para enviar
- [ ] Número de negocio verificado en Meta

---

## Problemas frecuentes

| Error | Solución |
|-------|----------|
| “No se pudo validar la URL de devolución de llamada” | Despliega la función; prueba el `curl` de arriba |
| 403 en verificación | Token distinto en Meta vs `WHATSAPP_VERIFY_TOKEN` |
| 401 en POST | App Secret mal puesto; déjalo vacío hasta que lo configures |
| No llegan mensajes | Suscríbete a `messages` y usa un número de prueba de Meta |
