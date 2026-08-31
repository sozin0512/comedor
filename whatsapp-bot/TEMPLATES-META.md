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
| **Variables** | `{{1}}` origen · `{{2}}` destino · `{{3}}` distancia (`3.8 km`) |

Se envía al conductor ofertado (y candidatos del pool), no al pasajero.

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

## 4) Viaje finalizado

| Campo | Valor |
|--------|--------|
| **Nombre** | `viaje_finalizado` |
| **Variables** | `{{1}}` monto (`185.00`, el cuerpo de Meta ya pone `L.`) · `{{2}}` destino |

Se dispara al **completar**.

---

Despliegue:

```bash
firebase deploy --only functions:onTripCreatedAssignOffer,functions:onTripUpdatePush,functions:testWhatsAppTripTemplate,functions:whatsappWebhook
```
