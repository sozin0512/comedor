# HonduRaite · WhatsApp bot temporal

Bot **no oficial** (Baileys) para mandar mensajes a números ya registrados, **mientras** Meta aprueba la WhatsApp Cloud API.

## Reglas de seguridad (léelas)

1. **Número SECUNDARIO** — nunca el de soporte `+504 9573-3866`.
2. El script **bloquea** el login si escaneas el QR con el número de soporte.
3. Empieza con `--limit=10` y `dryRun`.
4. Pausas largas por defecto (~30–55 s entre mensajes; pausa de lote ~7 min cada 25).
5. Cuando te den la API oficial: **apaga este bot** y migra a plantillas.
6. Riesgo de ban de Meta: es temporal y a tu criterio.

---

## Requisitos

- Node.js 20+
- `firebase login` (para exportar teléfonos de Firestore)
- Un chip / WhatsApp **secundario** con la app en el celular

---

## Instalación

```bash
cd whatsapp-bot
npm install
```

Copia la config y el mensaje:

```bash
copy config.example.json config.local.json
copy message.example.txt message.txt
```

Edita `message.txt` (usa `{name}` para el primer nombre).

---

## 1) Exportar teléfonos

```bash
npm run export:drivers
# o
npm run export:clients
# o todos
npm run export -- --role=all --out=out/phones-all.csv
```

Genera CSV en `out/` con columnas: `phone,name,role,uid`.

---

## 2) Vincular el número secundario

### Opción A — Código de 8 dígitos (RECOMENDADO si el QR falla)

```bash
node login.js --phone=504XXXXXXXX
```

En el celular (chip **secundario**):

1. WhatsApp → **⋮** → **Dispositivos vinculados**
2. **Vincular un dispositivo**
3. **Vincular con número de teléfono**
4. Escribe el código de 8 dígitos que sale en la terminal

### Opción B — QR en imagen PNG

```bash
node login.js
```

Se abre `out\whatsapp-qr.png` automáticamente. Escanéalo con la cámara de WhatsApp  
(**Dispositivos vinculados → Vincular dispositivo**).

Si dice “no se puede vincular”: borra sesión y usa el código:

```bash
node login.js --phone=504XXXXXXXX
```

La sesión queda en `auth_session/` (no la subas a git).

---

## 3) Probar sin enviar

```bash
npm run send:dry
```

---

## 4) Envío real (poco a poco)

```bash
# primeros 10
npm run send -- --dry-run=false --limit=10

# continuar donde quedó (omite ya enviados)
npm run send -- --dry-run=false --resume --limit=30
```

### Flags útiles

| Flag | Descripción |
|------|-------------|
| `--dry-run=false` | Envía de verdad |
| `--limit=N` | Máximo N destinatarios |
| `--resume` | Salta los ya enviados en `progress-last.json` |
| `--csv=out/phones-driver.csv` | Otro CSV |
| `--delay-min=30000` | Pausa mínima (ms) |
| `--delay-max=55000` | Pausa máxima (ms) |
| `--batch-size=25` | Mensajes por lote |
| `--batch-pause=420000` | Pausa entre lotes (ms) |

---

## Mensaje sugerido

```text
Hola {name} 👋

Te escribimos de *HonduRaite*.

Ya está disponible la nueva versión de la app. Actualiza para mejores avisos y mapa de flota.

Si no deseas más mensajes por este canal, responde STOP.
```

---

## Control desde el Admin web

1. Vincula WhatsApp: `node login.js` (o con `--phone=504...`)
2. Deja corriendo el puente:
   ```bash
   npm run worker
   ```
3. En la app: **Admin → Notificar → sección WhatsApp masivo**
4. Escribes el mensaje, eliges conductores/pasajeros, límite, y **Encolar campaña**
5. El worker detecta la campaña (`status: queued`) y la envía

El panel muestra si el puente está **online/offline** (heartbeat cada ~20 s).

---

## Cuando llegue la API oficial

1. Deja de usar este bot.
2. Borra o archiva `auth_session/`.
3. Integra WhatsApp Cloud API en Cloud Functions con **plantillas** aprobadas.
4. Usa el mismo CSV / `users.phone` como fuente de destinos.

---

## Problemas comunes

| Problema | Qué hacer |
|----------|-----------|
| `No hay sesión de Firebase` | `firebase login` |
| QR no aparece / se cae | Borra `auth_session/` y `npm run login` otra vez |
| `Número de soporte bloqueado` | Usa otro chip |
| Muchos FAIL / ban | Para todo; baja volumen; espera días |
| CSV vacío | Usuarios sin `phone` en Firestore |

---

## Estructura

```
whatsapp-bot/
  export-phones.js    # Firestore → CSV
  send-campaign.js    # Baileys + rate limit
  message.txt         # tu texto (local)
  config.local.json   # overrides (local)
  out/*.csv           # exports (gitignored)
  auth_session/       # sesión WA (gitignored)
```
