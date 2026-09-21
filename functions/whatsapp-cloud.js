/**
 * WhatsApp Cloud API (Meta) — webhook oficial.
 *
 * GET  → verificación de Meta (hub.mode / hub.verify_token / hub.challenge)
 * POST → eventos entrantes (mensajes, estados, etc.)
 *
 * Config (Firebase params / env al desplegar):
 *   WHATSAPP_VERIFY_TOKEN  — inventado por ti; el mismo en Meta y aquí
 *   WHATSAPP_APP_SECRET    — (opcional) App Secret de Meta para validar X-Hub-Signature-256
 *   WHATSAPP_ACCESS_TOKEN  — token permanente de la API (solo si usas sendWhatsAppCloudText)
 *   WHATSAPP_PHONE_NUMBER_ID — Phone number ID del número en Meta
 */

const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APP_ID = 'comayagua-vip-pro-v4';
const HN_CITIES = require('./hn-city-centers');
const ZONE_DEPARTMENT = require('./zone-departments');

/** Mismo valor que pegas en Meta → Token de verificación */
const waVerifyToken = defineString('WHATSAPP_VERIFY_TOKEN', {
    default: 'honduraite_verify_2026',
    description: 'Token de verificación del webhook de WhatsApp Cloud API (Meta)'
});

/** App Secret de Meta (opcional; si está vacío no se valida firma) */
const waAppSecret = defineString('WHATSAPP_APP_SECRET', {
    default: '',
    description: 'App Secret de Meta (valida X-Hub-Signature-256)'
});

const waAccessToken = defineString('WHATSAPP_ACCESS_TOKEN', {
    default: '',
    description: 'Token de acceso permanente de WhatsApp Cloud API'
});

const waPhoneNumberId = defineString('WHATSAPP_PHONE_NUMBER_ID', {
    default: '',
    description: 'Phone number ID del número de WhatsApp Business en Meta'
});

/** Copia de eventos del webhook hacia n8n (Meta solo permite 1 URL oficial). */
const waN8nWebhookUrl = defineString('WHATSAPP_N8N_WEBHOOK_URL', {
    default: '',
    description: 'URL de n8n para reenviar eventos WhatsApp (messages, statuses)'
});

/** Nombre exacto de la plantilla aprobada en Meta (minúsculas y guiones bajos) */
const waTemplateTripReceived = defineString('WHATSAPP_TEMPLATE_TRIP_RECEIVED', {
    default: 'tu_viaje_esta_confirmado',
    description: 'Plantilla existente: solicitud recibida. {{1}} nombre {{2}} ruta'
});

const waTemplateTripConfirmed = defineString('WHATSAPP_TEMPLATE_TRIP_CONFIRMED', {
    default: 'viaje_confirmado',
    description: 'Plantilla: conductor aceptó. {{1}} conductor {{2}} vehículo {{3}} placa {{4}} minutos'
});

const waTemplateDriverArrived = defineString('WHATSAPP_TEMPLATE_DRIVER_ARRIVED', {
    default: 'conductor_llego',
    description: 'Plantilla: conductor en el punto. {{1}} conductor {{2}} placa {{3}} teléfono'
});

/** Aviso a CONDUCTORES de viaje nuevo. {{1}} origen {{2}} destino {{3}} distancia */
const waTemplateDriverNewTrip = defineString('WHATSAPP_TEMPLATE_DRIVER_NEW_TRIP', {
    default: 'nuevo_viaje',
    description: 'Plantilla al conductor: {{1}} origen {{2}} destino {{3}} distancia'
});

const waTemplateLang = defineString('WHATSAPP_TEMPLATE_LANG', {
    default: 'es_HN',
    description: 'Idioma de plantillas WhatsApp (es_HN = Spanish HND)'
});

/** Chats sin ver en viaje activo. {{1}} nombre {{2}} preview */
const waTemplateChatUnread = defineString('WHATSAPP_TEMPLATE_CHAT_UNREAD', {
    default: 'chats_sin_ver',
    description: 'Plantilla: mensajes sin ver. {{1}} nombre {{2}} preview'
});

function db() {
    return getFirestore();
}

/** Normaliza a E.164 sin + (ej. 50498765432 o 13055551212) */
function normalizeWaPhone(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    // Honduras local 8 dígitos → 504
    if (d.length === 8) d = `504${d}`;
    // 9 dígitos empezando en 0 raro
    if (d.length === 9 && d.startsWith('0')) d = `504${d.slice(1)}`;
    // NANP 10 dígitos → +1
    if (d.length === 10 && d[0] >= '2' && d[0] <= '9') d = `1${d}`;
    if (d.length < 10 || d.length > 15) return null;
    return d;
}

function firstNameFrom(full) {
    const n = String(full || '').trim();
    if (!n) return 'Cliente';
    return n.split(/\s+/)[0].slice(0, 40);
}

function shortRouteLabel(trip) {
    const origin = String(trip?.originPlaceName || trip?.origin || 'tu punto de recogida')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 48);
    const dest = String(trip?.destinationPlaceName || trip?.destination || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 48);
    if (dest) return `${origin} → ${dest}`.slice(0, 90);
    return origin.slice(0, 90);
}

function originLabel(trip) {
    const origin = String(trip?.originPlaceName || trip?.origin || 'punto de recogida')
        .replace(/\s+/g, ' ')
        .trim();
    return (origin || 'punto de recogida').slice(0, 80);
}

function destLabel(trip) {
    const dest = String(trip?.destinationPlaceName || trip?.destination || 'tu destino')
        .replace(/\s+/g, ' ')
        .trim();
    return (dest || 'tu destino').slice(0, 80);
}

function distanceLabel(trip) {
    const km = Number(trip?.tripDistanceKm)
        || Number(trip?.routeDistanceMeters ? trip.routeDistanceMeters / 1000 : 0)
        || Number(trip?.distanceKm)
        || 0;
    if (Number.isFinite(km) && km > 0) return `${km.toFixed(1)} km`;
    return '1.0 km';
}

function vehicleLabel(trip) {
    const v = trip?.driverVehicle || {};
    const bits = [v.model, v.color, v.type].filter((s) => String(s || '').trim());
    const label = bits.join(' ').replace(/\s+/g, ' ').trim();
    return (label || 'Vehículo HonduRaite').slice(0, 60);
}

function plateLabel(trip) {
    const v = trip?.driverVehicle || {};
    const plate = String(v.plate || trip?.driverVehiclePlate || 'N/D').replace(/\s+/g, ' ').trim();
    return (plate || 'N/D').slice(0, 20);
}

function etaMinutesLabel(trip) {
    const ms = Number(trip?.pickupEtaMs) || 0;
    if (ms > 0) return String(Math.max(1, Math.round(ms / 60000)));
    const dur = Number(trip?.routeDurationMs) || Number(trip?.tripDurationMs) || 0;
    if (dur > 0 && dur < 90 * 60 * 1000) return String(Math.max(1, Math.round(dur / 60000)));
    return '10';
}

function tripPhone(trip) {
    return trip?.clientPhone || trip?.phone || null;
}

function canNotifyPassengerWa(trip) {
    if (!trip || trip.isDemandSimulation) return false;
    if (trip.staffCreatedBy && trip.staffCreatedClientClaimed !== true) return false;
    return !!tripPhone(trip);
}

async function graphSendMessage(payload) {
    const token = (waAccessToken.value() || '').trim();
    const phoneNumberId = (waPhoneNumberId.value() || '').trim();
    if (!token || !phoneNumberId) {
        return { ok: false, skipped: true, reason: 'missing_token_or_phone_id' };
    }
    const versions = payload?.interactive?.type === 'location_request_message'
        ? ['v22.0', 'v21.0']
        : ['v21.0'];
    let last = { ok: false };
    for (const ver of versions) {
        const url = `https://graph.facebook.com/${ver}/${phoneNumberId}/messages`;
        try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 8000);
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: ac.signal
            });
            clearTimeout(timer);
            const json = await resp.json().catch(() => ({}));
            if (resp.ok) return { ok: true, result: json, version: ver };
            last = { ok: false, status: resp.status, error: json, version: ver };
            console.error('[whatsapp graph]', ver, resp.status, json);
        } catch (e) {
            last = { ok: false, error: e?.message || e, version: ver };
            console.error('[whatsapp graph]', ver, e?.message || e);
        }
    }
    return last;
}

/**
 * Envía plantilla de texto con variables {{1}}, {{2}}, ...
 * @param {string} toPhone
 * @param {string} templateName
 * @param {string[]} bodyParams
 * @param {string} [lang]
 */
async function sendWhatsAppTemplate(toPhone, templateName, bodyParams = [], lang = null) {
    const to = normalizeWaPhone(toPhone);
    if (!to) return { ok: false, skipped: true, reason: 'bad_phone' };
    const language = (lang || waTemplateLang.value() || 'es').trim();
    const components = [];
    if (bodyParams.length) {
        components.push({
            type: 'body',
            parameters: bodyParams.map((text) => ({
                type: 'text',
                text: String(text || '—').slice(0, 100)
            }))
        });
    }
    const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
            name: templateName,
            language: { code: language },
            ...(components.length ? { components } : {})
        }
    };
    const res = await graphSendMessage(payload);
    try {
        await db().collection(`artifacts/${APP_ID}/public/data/whatsapp_cloud_outbox`).add({
            sentAt: FieldValue.serverTimestamp(),
            kind: 'template',
            template: templateName,
            language,
            to,
            bodyParams,
            ok: !!res.ok,
            skipped: !!res.skipped,
            reason: res.reason || null,
            metaResponse: res.result || res.error || null
        });
    } catch (_) {}
    return res;
}

async function markTripWa(tripId, fields) {
    if (!tripId) return;
    try {
        await db().doc(`artifacts/${APP_ID}/public/data/trips/${tripId}`).update(fields).catch(() => {});
    } catch (_) {}
}

/**
 * Plantilla que YA tenías: solicitud recibida / “tu viaje está confirmado”.
 * {{1}} nombre · {{2}} ruta (Origen → Destino). No se toca.
 */
async function notifyTripRequestReceivedWa(trip, tripId = null) {
    if (!canNotifyPassengerWa(trip)) {
        return { ok: false, skipped: true, reason: 'no_trip_or_phone' };
    }
    if (trip.waTripRequestReceivedOk) return { ok: true, skipped: true, reason: 'already' };
    const phone = tripPhone(trip);
    const template = (waTemplateTripReceived.value() || 'tu_viaje_esta_confirmado').trim();
    const result = await sendWhatsAppTemplate(phone, template, [
        firstNameFrom(trip.clientName),
        shortRouteLabel(trip)
    ]);
    if (result.ok) {
        await markTripWa(tripId, {
            waTripRequestReceivedAt: FieldValue.serverTimestamp(),
            waTripRequestReceivedOk: true
        });
    }
    return result;
}

/**
 * 2) viaje_confirmado — conductor aceptó.
 * {{1}} conductor {{2}} vehículo {{3}} placa {{4}} minutos
 */
async function notifyTripConfirmedWa(trip, tripId = null) {
    if (!canNotifyPassengerWa(trip)) {
        return { ok: false, skipped: true, reason: 'no_trip_or_phone' };
    }
    if (trip.waTripConfirmedOk) return { ok: true, skipped: true, reason: 'already' };
    const template = (waTemplateTripConfirmed.value() || 'viaje_confirmado').trim();
    const result = await sendWhatsAppTemplate(tripPhone(trip), template, [
        firstNameFrom(trip.driverName || 'Conductor'),
        vehicleLabel(trip),
        plateLabel(trip),
        etaMinutesLabel(trip)
    ]);
    if (result.ok) {
        await markTripWa(tripId, {
            waTripConfirmedAt: FieldValue.serverTimestamp(),
            waTripConfirmedOk: true
        });
        if (tripId) {
            await sendCloudText(
                tripPhone(trip),
                `Sigue a tu conductor en el mapa (app o web):\n${tripLiveChatLink(tripId)}`
            ).catch(() => {});
        }
    }
    return result;
}

/**
 * 3) conductor_llego
 * {{1}} conductor {{2}} placa {{3}} teléfono
 */
async function notifyDriverArrivedWa(trip, tripId = null) {
    if (!canNotifyPassengerWa(trip)) {
        return { ok: false, skipped: true, reason: 'no_trip_or_phone' };
    }
    if (trip.waDriverArrivedOk) return { ok: true, skipped: true, reason: 'already' };
    const template = (waTemplateDriverArrived.value() || 'conductor_llego').trim();
    const phoneTxt = String(trip.driverPhone || 'N/D').replace(/\s+/g, ' ').trim().slice(0, 20) || 'N/D';
    const result = await sendWhatsAppTemplate(tripPhone(trip), template, [
        firstNameFrom(trip.driverName || 'Conductor'),
        plateLabel(trip),
        phoneTxt
    ]);
    if (result.ok) {
        await markTripWa(tripId, {
            waDriverArrivedAt: FieldValue.serverTimestamp(),
            waDriverArrivedOk: true
        });
    }
    return result;
}

/**
 * Aviso al CONDUCTOR de un viaje nuevo (no al pasajero).
 * {{1}} origen · {{2}} destino · {{3}} distancia (ej. 3.8 km)
 */
async function notifyDriverNewTripWa(trip, tripId, driver = {}) {
    if (!trip || trip.isDemandSimulation) {
        return { ok: false, skipped: true, reason: 'no_trip' };
    }
    if (trip.staffCreatedBy && trip.staffCreatedClientClaimed !== true) {
        return { ok: false, skipped: true, reason: 'staff_waiting_claim' };
    }
    const phone = driver.phone || driver.driverPhone || null;
    if (!phone) return { ok: false, skipped: true, reason: 'no_phone' };
    const template = (waTemplateDriverNewTrip.value() || 'nuevo_viaje').trim();
    return sendWhatsAppTemplate(phone, template, [
        originLabel(trip),
        destLabel(trip),
        distanceLabel(trip)
    ]);
}

function mapsPinUrl(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    return `https://maps.google.com/?q=${la},${ln}`;
}

function tripPointLatLng(trip, which) {
    if (which === 'origin') {
        const lat = trip?.originLat ?? trip?.origin?.lat ?? trip?.originLatLng?.lat;
        const lng = trip?.originLng ?? trip?.origin?.lng ?? trip?.originLatLng?.lng;
        if (lat == null || lng == null) return null;
        return { lat: Number(lat), lng: Number(lng) };
    }
    const lat = trip?.destinationLat ?? trip?.dest?.lat ?? trip?.destination?.lat ?? trip?.destinationLatLng?.lat;
    const lng = trip?.destinationLng ?? trip?.dest?.lng ?? trip?.destination?.lng ?? trip?.destinationLatLng?.lng;
    if (lat == null || lng == null) return null;
    return { lat: Number(lat), lng: Number(lng) };
}

function extraStopsFromTrip(trip) {
    const raw = Array.isArray(trip?.additionalStops) ? trip.additionalStops : [];
    return raw.map((s, i) => {
        const lat = Number(s?.lat ?? s?.latLng?.lat);
        const lng = Number(s?.lng ?? s?.latLng?.lng);
        const address = String(s?.address || s?.placeName || `Parada ${i + 1}`).slice(0, 80);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { address, lat: null, lng: null };
        return { address, lat, lng };
    }).filter((s) => s.address);
}

function mapsDirUrlForTrip(trip) {
    const o = tripPointLatLng(trip, 'origin');
    const d = tripPointLatLng(trip, 'destination');
    if (!o || !d) return null;
    const stops = extraStopsFromTrip(trip).filter((s) => s.lat != null);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&travelmode=driving`;
    if (stops.length) {
        url += `&waypoints=${stops.map((s) => `${s.lat},${s.lng}`).join('%7C')}`;
    }
    return url;
}

function formatTripWhenHn(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('es-HN', {
            timeZone: 'America/Tegucigalpa',
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hourCycle: 'h12'
        });
    } catch (_) {
        return '';
    }
}

function driverAcceptedRouteBody(trip, phase = 'accepted') {
    const origin = originLabel(trip);
    const dest = destLabel(trip);
    const o = tripPointLatLng(trip, 'origin');
    const d = tripPointLatLng(trip, 'destination');
    const oPin = o ? mapsPinUrl(o.lat, o.lng) : null;
    const dPin = d ? mapsPinUrl(d.lat, d.lng) : null;
    const stops = extraStopsFromTrip(trip);
    const dir = mapsDirUrlForTrip(trip);
    const price = trip?.price || (Number(trip?.priceNum) > 0 ? `L. ${Number(trip.priceNum).toFixed(2)}` : '');
    const client = String(trip?.clientName || trip?.waProfileName || 'Cliente').slice(0, 40);
    const when = formatTripWhenHn(trip.scheduledFor);
    let title = 'HonduRaite · viaje aceptado';
    if (phase === 'reserved' && when) title = `HonduRaite · viaje programado (${when})`;
    if (phase === 'active') title = when
        ? `HonduRaite · es hora de recoger (${when})`
        : 'HonduRaite · es hora de recoger';
    let body = `${title}\n\n`;
    body += `📍 Recoger:\n${origin}`;
    if (oPin) body += `\n${oPin}`;
    if (stops.length) {
        stops.forEach((s, i) => {
            body += `\n\n${i + 2}. Parada:\n${s.address}`;
            if (s.lat != null) body += `\n${mapsPinUrl(s.lat, s.lng)}`;
        });
    }
    body += `\n\n➡️ Destino:\n${dest}`;
    if (dPin) body += `\n${dPin}`;
    if (dir) body += `\n\n🗺️ Ruta completa:\n${dir}`;
    body += `\n\nCliente: ${client}`;
    if (price) body += `\nTarifa: ${price}`;
    body += `\n\nAbre los links para ver los puntos en el mapa.`;
    return body.slice(0, 4000);
}

/**
 * Al aceptar un viaje del chatbot: el bot escribe al WhatsApp del conductor
 * con origen, destino (y paradas) + links de mapa.
 */
async function notifyDriverAcceptedRouteWa(trip, tripId = null, opts = {}) {
    if (!trip || trip.isDemandSimulation) {
        return { ok: false, skipped: true, reason: 'no_trip' };
    }
    const phase = opts.phase
        || (trip.scheduledFor && trip.status === 'scheduled' ? 'reserved' : 'accepted');
    const flag = phase === 'active' ? 'waDriverScheduledActiveRouteOk' : 'waDriverAcceptedRouteOk';
    if (trip[flag]) {
        return { ok: true, skipped: true, reason: 'already' };
    }
    const fromChatbot = trip.createdVia === 'whatsapp'
        || trip.staffCreatedBy === 'whatsapp-assistant'
        || trip.guestClient === true;
    if (!fromChatbot) {
        return { ok: false, skipped: true, reason: 'not_chatbot' };
    }
    const phone = await resolveDriverPhone(trip);
    if (!phone) return { ok: false, skipped: true, reason: 'no_phone' };
    const body = driverAcceptedRouteBody(trip, phase);
    const result = await sendCloudText(phone, body);
    if (result?.ok) {
        const patch = phase === 'active'
            ? { waDriverScheduledActiveRouteAt: FieldValue.serverTimestamp(), waDriverScheduledActiveRouteOk: true }
            : { waDriverAcceptedRouteAt: FieldValue.serverTimestamp(), waDriverAcceptedRouteOk: true };
        await markTripWa(tripId, patch);
        return result;
    }
    const template = (waTemplateDriverNewTrip.value() || 'nuevo_viaje').trim();
    const fallback = await sendWhatsAppTemplate(phone, template, [
        originLabel(trip),
        destLabel(trip),
        distanceLabel(trip)
    ]);
    if (fallback?.ok) {
        const patch = phase === 'active'
            ? {
                waDriverScheduledActiveRouteAt: FieldValue.serverTimestamp(),
                waDriverScheduledActiveRouteOk: true,
                waDriverScheduledActiveRouteVia: 'template'
            }
            : {
                waDriverAcceptedRouteAt: FieldValue.serverTimestamp(),
                waDriverAcceptedRouteOk: true,
                waDriverAcceptedRouteVia: 'template'
            };
        await markTripWa(tripId, patch);
    }
    return fallback;
}

function isActiveTripForChatWa(trip) {
    return ['accepted', 'in_progress', 'scheduled'].includes(String(trip?.status || ''));
}

function uidHasTripChatOpen(trip, uid, nowMs = Date.now()) {
    if (!uid) return false;
    const seen = trip?.chatSeenBy?.[uid];
    if (!seen || seen.open !== true) return false;
    const at = Number(seen.at) || 0;
    return at > nowMs - 45000;
}

function clientHasTripChatOpen(trip, nowMs = Date.now()) {
    return uidHasTripChatOpen(trip, trip?.clientId, nowMs);
}

function driverHasTripChatOpen(trip, nowMs = Date.now()) {
    return uidHasTripChatOpen(trip, trip?.driverId, nowMs);
}

function chatPreviewSnippet(preview) {
    return String(preview || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

async function sendUnreadChatWa(phone, name, preview, tripId = null) {
    const snippet = chatPreviewSnippet(preview);
    const link = tripLiveChatLink(tripId);
    const sessionBody = (
        `HonduRaite: tienes mensajes sin ver en tu viaje activo.\n` +
        `Responde aquí (app o web):\n${link}` +
        (snippet ? `\n\n“${snippet}”` : '')
    );
    let result = await sendCloudText(phone, sessionBody);
    if (!result?.ok) {
        const template = (waTemplateChatUnread.value() || 'chats_sin_ver').trim();
        result = await sendWhatsAppTemplate(phone, template, [
            firstNameFrom(name),
            link
        ]);
    }
    return result;
}

async function resolveDriverPhone(trip) {
    const direct = trip?.driverPhone || trip?.driver?.phone || null;
    if (direct) return direct;
    const uid = trip?.driverId;
    if (!uid) return null;
    try {
        const snap = await db().doc(`artifacts/${APP_ID}/public/data/users/${uid}`).get();
        if (!snap.exists) return null;
        const u = snap.data() || {};
        return u.phone || u.driverPhone || u.whatsapp || null;
    } catch (_) {
        return null;
    }
}

/**
 * Cliente no abrió el chat del viaje activo → WhatsApp “tienes mensajes sin ver”.
 */
async function notifyPassengerUnreadChatWa(trip, tripId = null, preview = '') {
    if (!canNotifyPassengerWa(trip)) {
        return { ok: false, skipped: true, reason: 'no_trip_or_phone' };
    }
    if (!isActiveTripForChatWa(trip)) {
        return { ok: false, skipped: true, reason: 'not_active' };
    }
    if (clientHasTripChatOpen(trip)) {
        return { ok: false, skipped: true, reason: 'chat_open' };
    }
    const lastMs = Number(trip.waChatUnreadAtMs) || 0;
    if (lastMs && Date.now() - lastMs < 3 * 60 * 1000) {
        return { ok: false, skipped: true, reason: 'throttled' };
    }
    const result = await sendUnreadChatWa(tripPhone(trip), trip.clientName, preview, tripId);
    if (result?.ok) {
        await markTripWa(tripId, {
            waChatUnreadAt: FieldValue.serverTimestamp(),
            waChatUnreadAtMs: Date.now(),
            unreadChatWaClientDueAt: FieldValue.delete()
        });
    }
    return result;
}

/**
 * Conductor no abrió el chat del viaje activo → WhatsApp “tienes mensajes sin ver”.
 */
async function notifyDriverUnreadChatWa(trip, tripId = null, preview = '') {
    if (!trip || trip.isDemandSimulation) {
        return { ok: false, skipped: true, reason: 'no_trip' };
    }
    if (!isActiveTripForChatWa(trip)) {
        return { ok: false, skipped: true, reason: 'not_active' };
    }
    if (!trip.driverId) {
        return { ok: false, skipped: true, reason: 'no_driver' };
    }
    if (driverHasTripChatOpen(trip)) {
        return { ok: false, skipped: true, reason: 'chat_open' };
    }
    const lastMs = Number(trip.waDriverChatUnreadAtMs) || 0;
    if (lastMs && Date.now() - lastMs < 3 * 60 * 1000) {
        return { ok: false, skipped: true, reason: 'throttled' };
    }
    const phone = await resolveDriverPhone(trip);
    if (!phone) return { ok: false, skipped: true, reason: 'no_phone' };
    const result = await sendUnreadChatWa(phone, trip.driverName || 'Conductor', preview, tripId);
    if (result?.ok) {
        await markTripWa(tripId, {
            waDriverChatUnreadAt: FieldValue.serverTimestamp(),
            waDriverChatUnreadAtMs: Date.now(),
            unreadChatWaDriverDueAt: FieldValue.delete()
        });
    }
    return result;
}

exports.sendWhatsAppTemplate = sendWhatsAppTemplate;
exports.notifyTripRequestReceivedWa = notifyTripRequestReceivedWa;
exports.notifyTripConfirmedWa = notifyTripConfirmedWa;
exports.notifyDriverArrivedWa = notifyDriverArrivedWa;
exports.notifyDriverNewTripWa = notifyDriverNewTripWa;
exports.notifyDriverAcceptedRouteWa = notifyDriverAcceptedRouteWa;
exports.notifyPassengerUnreadChatWa = notifyPassengerUnreadChatWa;
exports.notifyDriverUnreadChatWa = notifyDriverUnreadChatWa;
exports.clientHasTripChatOpen = clientHasTripChatOpen;
exports.driverHasTripChatOpen = driverHasTripChatOpen;
exports.uidHasTripChatOpen = uidHasTripChatOpen;
exports.isActiveTripForChatWa = isActiveTripForChatWa;

async function notifyWhatsAppGuestRegister(trip, tripId) {
    if (!trip || trip.waRegisterOffered) return { skipped: true };
    const guest = trip.createdVia === 'whatsapp'
        || trip.guestClient === true
        || String(trip.clientId || '').startsWith('guest_');
    if (!guest) return { skipped: true };
    const phone = normalizeWaPhone(trip.clientPhone || trip.pendingClientPhone);
    if (!phone) return { skipped: true };
    const name = trip.waProfileName || trip.pendingClientName || trip.clientName || '';
    const first = firstNameFrom(name);
    const qs = new URLSearchParams();
    qs.set('waPhone', phone);
    if (name && name !== 'Cliente WhatsApp') qs.set('waName', name);
    const link = `${APP_SITE}/?${qs.toString()}`;
    const hi = first && first !== 'Cliente' ? `, ${first}` : '';
    const res = await sendCloudText(
        phone,
        `Gracias por viajar con HonduRaite${hi}.\n\n` +
        `¿Quieres una cuenta? Así ves historial, promociones y pides más rápido.\n` +
        `Ya dejamos tu nombre de WhatsApp.\n\n${link}`
    );
    if (res?.ok && tripId) {
        await db().doc(`artifacts/${APP_ID}/public/data/trips/${tripId}`).update({
            waRegisterOffered: true,
            waRegisterOfferedAt: FieldValue.serverTimestamp()
        }).catch(() => {});
    }
    return res;
}
exports.notifyWhatsAppGuestRegister = notifyWhatsAppGuestRegister;
exports.normalizeWaPhone = normalizeWaPhone;

function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
    if (!appSecret) return true; // sin secret configurado: no bloquear
    if (!signatureHeader || !rawBody) return false;
    const expected = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');
    try {
        const a = Buffer.from(expected);
        const b = Buffer.from(String(signatureHeader));
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch (_) {
        return false;
    }
}

/**
 * Guarda eventos útiles en Firestore para depurar y futuro chatbot.
 * artifacts/{app}/public/data/whatsapp_cloud_events/{id}
 * artifacts/{app}/public/data/whatsapp_cloud_inbox/{id}
 */
async function persistWebhookPayload(body) {
    const firestore = db();
    const now = FieldValue.serverTimestamp();
    const writes = [];
    for (const entry of body?.entry || []) {
        for (const change of entry?.changes || []) {
            if (change?.field && change.field !== 'messages') continue;
            const value = change?.value || {};
            const contactName = value.contacts?.[0]?.profile?.name || null;
            for (const msg of value.messages || []) {
                writes.push(firestore.collection(`artifacts/${APP_ID}/public/data/whatsapp_cloud_inbox`).add({
                    receivedAt: now,
                    from: msg.from || null,
                    contactName,
                    type: msg.type || null,
                    messageId: msg.id || null,
                    timestamp: msg.timestamp || null,
                    text: msg.text?.body || null,
                    phoneNumberId: value.metadata?.phone_number_id || null
                }));
            }
        }
    }
    if (writes.length) await Promise.all(writes);
}

const SUPPORT_WA = '50495733866';
const APP_SITE = 'https://honduraite.com';
const MAPS_KEY = 'AIzaSyBCpZ209ORRrbbEDTx0wNUMei0kHXyCZYQ';
const BOOKING_TTL_MS = 25 * 60 * 1000;

function sessionRef(phone) {
    return db().doc(`artifacts/${APP_ID}/public/data/whatsapp_booking_sessions/${phone}`);
}

const sessionCache = new Map();

function cacheSession(phone, data) {
    const next = { ...data, phone, updatedAtMs: Date.now() };
    sessionCache.set(String(phone), { data: next, at: Date.now() });
    return next;
}

async function loadSession(phone) {
    const key = String(phone || '');
    const hit = sessionCache.get(key);
    if (hit && Date.now() - hit.at < BOOKING_TTL_MS) return hit.data;
    try {
        const snap = await sessionRef(phone).get();
        if (!snap.exists) return { step: 'idle' };
        const data = snap.data() || {};
        const at = data.updatedAtMs || 0;
        if (at && Date.now() - at > BOOKING_TTL_MS) return { step: 'idle' };
        cacheSession(phone, data);
        return data;
    } catch (_) {
        return { step: 'idle' };
    }
}

async function saveSession(phone, data) {
    const next = cacheSession(phone, data);
    await sessionRef(phone).set({
        ...next,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return next;
}

/** Guarda en memoria ya; Firestore no bloquea el pin de iPhone. */
function saveSessionBg(phone, data) {
    const next = cacheSession(phone, data);
    sessionRef(phone).set({
        ...next,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true }).catch((e) => console.warn('[wa] saveSessionBg', e?.message || e));
    return next;
}

async function clearSession(phone) {
    sessionCache.delete(String(phone));
    await sessionRef(phone).delete().catch(() => {});
}

function fold(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function sendCloudText(to, body) {
    const dest = normalizeWaPhone(to);
    if (!dest || !body) return { ok: false };
    return graphSendMessage({
        messaging_product: 'whatsapp',
        to: dest,
        type: 'text',
        text: { preview_url: true, body: String(body).slice(0, 4000) }
    });
}

async function sendCloudButtons(to, body, buttons) {
    const dest = normalizeWaPhone(to);
    if (!dest) return { ok: false };
    return graphSendMessage({
        messaging_product: 'whatsapp',
        to: dest,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: String(body).slice(0, 1024) },
            action: {
                buttons: buttons.slice(0, 3).map((b) => ({
                    type: 'reply',
                    reply: { id: b.id, title: String(b.title).slice(0, 20) }
                }))
            }
        }
    });
}

async function sendCloudMenu(to) {
    return sendCloudButtons(to, 'Hola, soy HonduRaite. ¿En qué te ayudo?', [
        { id: 'viaje', title: 'Pedir un viaje' },
        { id: 'conductor', title: 'Soy conductor' },
        { id: 'soporte', title: 'Soporte' }
    ]);
}

async function askWhen(from) {
    const buttons = await sendCloudButtons(from, '¿El viaje es para ahora o lo programamos?', [
        { id: 'when_now', title: 'Ahora' },
        { id: 'when_later', title: 'Programar' }
    ]);
    if (buttons?.ok) return buttons;
    return sendCloudText(from, 'Escribe *ahora* o *programar* (ej. *mañana 3pm*).');
}

async function sendCloudList(to, body, buttonLabel, rows, sectionTitle) {
    const dest = normalizeWaPhone(to);
    if (!dest || !rows?.length) return { ok: false };
    return graphSendMessage({
        messaging_product: 'whatsapp',
        to: dest,
        type: 'interactive',
        interactive: {
            type: 'list',
            body: { text: String(body).slice(0, 1024) },
            action: {
                button: String(buttonLabel || 'Ver opciones').slice(0, 20),
                sections: [{
                    title: String(sectionTitle || 'Opciones').slice(0, 24),
                    rows: rows.slice(0, 10).map((r) => {
                        const row = { id: r.id, title: String(r.title).slice(0, 24) };
                        if (r.description) row.description = String(r.description).slice(0, 72);
                        return row;
                    })
                }]
            }
        }
    });
}

const PASSENGER_SERVICE_ROWS = [
    { id: 'svc_auto', title: 'Taxi VIP', description: 'Viaje en automóvil' },
    { id: 'svc_moto', title: 'Moto', description: 'Viaje en motocicleta' },
    { id: 'svc_flete_paila', title: 'Flete paila', description: 'Mudanza o carga en pickup' },
    { id: 'svc_flete_camion', title: 'Flete camión', description: 'Carga pesada' },
    { id: 'svc_grua', title: 'Grúa', description: 'Auxilio vial / remolque' }
];

function serviceLabel(type) {
    const map = {
        auto: 'Taxi VIP',
        taxi: 'Taxi',
        moto: 'Moto',
        flete_paila: 'Flete paila',
        flete_camion: 'Flete camión',
        grua: 'Grúa',
        delivery: 'Envío'
    };
    return map[type] || 'Taxi VIP';
}

function parsePassengerService(id, t) {
    const key = String(id || '').toLowerCase();
    if (key === 'svc_auto' || key === 'viaje_auto') return 'auto';
    if (key === 'svc_moto') return 'moto';
    if (key === 'svc_flete_paila' || key === 'svc_paila') return 'flete_paila';
    if (key === 'svc_flete_camion' || key === 'svc_camion') return 'flete_camion';
    if (key === 'svc_grua') return 'grua';
    const s = String(t || '');
    if (/\b(flete\s*camion|camion|camión)\b/.test(s)) return 'flete_camion';
    if (/\b(flete|paila|pickup|mudanza)\b/.test(s)) return 'flete_paila';
    if (/\b(grua|grúa|auxilio|remolque)\b/.test(s)) return 'grua';
    if (/\b(moto|mototaxi|motocicleta)\b/.test(s) && !/\bconductor\b/.test(s)) return 'moto';
    if (/\b(taxi vip|vip|carro|automovil|automóvil)\b/.test(s)) return 'auto';
    return null;
}

async function askService(from) {
    const list = await sendCloudList(
        from,
        '¿Qué necesitas? Elige el servicio.',
        'Ver servicios',
        PASSENGER_SERVICE_ROWS,
        'Servicios'
    );
    if (list?.ok) return list;
    const btns = await sendCloudButtons(from, '¿Qué necesitas?', [
        { id: 'svc_auto', title: 'Taxi VIP' },
        { id: 'svc_moto', title: 'Moto' },
        { id: 'svc_flete_paila', title: 'Flete paila' }
    ]);
    if (btns?.ok) return btns;
    return sendCloudText(from, 'Escribe *viaje*, *moto*, *flete* o *grua*.');
}

const DRIVER_TYPE_ROWS = [
    { id: 'drv_auto', title: 'Automóvil', description: 'Viajes en carro. 3 interiores + 2 exteriores + placa' },
    { id: 'drv_taxi', title: 'Taxi', description: 'Placa oficial T-. Interior, exterior y placa' },
    { id: 'drv_moto', title: 'Motocicleta', description: 'Cascos Moto Segura + exterior + placa' },
    { id: 'drv_paila', title: 'Paila', description: 'Cabina, caja y capacidad de carga' },
    { id: 'drv_camion', title: 'Camión', description: 'Fletes pesados. Fotos de furgón' },
    { id: 'drv_grua', title: 'Grúa', description: 'Auxilio vial. Equipo y gancho' }
];

function driverGuideOverview() {
    return (
        '*Registro conductor HonduRaite*\n' +
        `Supervisor revisa fotos. Documentos 6 meses. App: ${APP_SITE}\n\n` +
        '*Lleva:* selfie (sin gorra/gafas), DNI, licencia frente y revés, revisión vehicular HN, antecedentes PEN + policiales, WhatsApp + emergencia, placa legible. Taxi: placa T-. Moto: 2 cascos.\n\n' +
        '*Pasos:* cuenta → Conductor → tipo → selfie → datos → fotos → documentos → Enviar. Cuando te aprueben, ponte en línea.\n\n' +
        'Elige tu vehículo para las fotos exactas:'
    );
}

function driverGuideForType(type) {
    const photos = {
        auto: (
            '*Fotos del automóvil (todas obligatorias)*\n' +
            '• Interior: asientos, tablero y maletero (3)\n' +
            '• Exterior: frente y atrás (2)\n' +
            '• Foto de la placa, bien legible'
        ),
        taxi: (
            '*Fotos del taxi (todas obligatorias)*\n' +
            '• Interior: asientos, tablero/taxímetro y maletero (3)\n' +
            '• Exterior: frente y atrás (2)\n' +
            '• Foto de la placa *T- oficial*, bien legible\n\n' +
            'Sin placa T- no te llegan viajes de taxi tradicional.'
        ),
        moto: (
            '*Fotos de la moto — campaña Moto Segura*\n' +
            '• Foto *tuya con el casco puesto*\n' +
            '• Casco del conductor: general, por dentro y verificación (3)\n' +
            '• Casco para pasajeros: afuera y por dentro (2)\n' +
            '• Exterior de la moto: frente y atrás (2)\n' +
            '• Foto de la placa, bien legible\n\n' +
            'Sin los cascos el registro de moto no pasa.'
        ),
        paila: (
            '*Fotos de la paila (todas obligatorias)*\n' +
            '• Cabina, caja/paila y carga vacía (3)\n' +
            '• Exterior: frente y atrás (2)\n' +
            '• Foto de la placa, bien legible\n' +
            '• Indica *capacidad de carga* (toneladas, varas…)'
        ),
        camion: (
            '*Fotos del camión (todas obligatorias)*\n' +
            '• Cabina, furgón/plataforma y lateral de carga (3)\n' +
            '• Exterior: frente y atrás (2)\n' +
            '• Foto de la placa, bien legible\n' +
            '• Indica *capacidad de carga* (toneladas)'
        ),
        grua: (
            '*Fotos de la grúa (todas obligatorias)*\n' +
            '• Cabina, equipo/pluma y remolque/gancho (3)\n' +
            '• Exterior: frente y atrás (2)\n' +
            '• Foto de la placa, bien legible\n' +
            '• Indica *capacidad de carga o remolque*'
        )
    };
    const face = (
        '\n\n*Selfie:* de frente, buena luz, sin gorra ni gafas de sol. El supervisor la compara con tu licencia.'
    );
    const docs = (
        '\n\n*Documentos (mesa, de frente, sin flash):*\n' +
        '• Licencia: frente y revés\n' +
        '• Foto de la revisión vehicular de Honduras\n' +
        '• Antecedentes penales (PEN): código + foto\n' +
        '• Antecedentes policiales: código + foto\n\n' +
        `Regístrate aquí: ${APP_SITE}\n` +
        'Elige *Conductor* → llena todo → *Enviar para aprobación*.'
    );
    const key = photos[type] ? type : 'auto';
    return photos[key] + face + docs;
}

async function sendDriverTypePicker(to, intro) {
    const list = await sendCloudList(
        to,
        intro || 'Elige qué vas a manejar y te digo las fotos exactas que pide el registro.',
        'Ver tipos',
        DRIVER_TYPE_ROWS,
        'Tipo de vehiculo'
    );
    if (list?.ok) return list;
    return sendCloudButtons(to, '¿Qué vas a manejar? Te digo las fotos exactas.', [
        { id: 'drv_auto', title: 'Auto / Taxi' },
        { id: 'drv_moto', title: 'Moto' },
        { id: 'drv_paila', title: 'Paila / Camión / Grúa' }
    ]);
}

async function sendDriverRegisterGuide(to) {
    saveSession(to, { step: 'drv_guide' }).catch(() => {});
    const picker = await sendDriverTypePicker(to, driverGuideOverview());
    if (picker?.ok) return picker;
    return sendCloudText(to, driverGuideOverview() + `\n\nEscribe *auto*, *moto*, *taxi*, *paila*, *camion* o *grua*.`);
}

async function sendDriverTypeGuide(to, type) {
    saveSession(to, { step: 'drv_guide', vehicleType: type }).catch(() => {});
    const body = driverGuideForType(type).slice(0, 1024);
    const btns = await sendCloudButtons(to, body, [
        { id: 'drv_types', title: 'Otro vehículo' },
        { id: 'conductor', title: 'Ver guía otra vez' },
        { id: 'menu', title: 'Menú' }
    ]);
    if (btns?.ok) return btns;
    return sendCloudText(to, body);
}

function driverTypeFromText(t) {
    if (/\b(grua|auxilio)\b/.test(t)) return 'grua';
    if (/\b(camion|camión|furgon)\b/.test(t)) return 'camion';
    if (/\b(paila|pickup|flete)\b/.test(t)) return 'paila';
    if (/\b(moto|motocicleta|casco)\b/.test(t)) return 'moto';
    if (/\btaxi\b/.test(t)) return 'taxi';
    if (/\b(auto|carro|vehiculo|automovil)\b/.test(t)) return 'auto';
    return null;
}

function wantsDriverGuide(id, t) {
    if (id === 'conductor' || id === 'drv_types' || String(id || '').startsWith('drv_')) return true;
    if (/\b(guia (de )?(registro|conductor)|como me registro|registrarme|soy conductor)\b/.test(t)) return true;
    if (/\bconductor\b/.test(t) && /\b(registro|registrar|papeles|documentos|fotos|licencia|antecedentes)\b/.test(t)) return true;
    if (/\b(manejar|recibir viajes|en linea)\b/.test(t) && !looksLikeQuestion(t)) return true;
    return false;
}

function hondurasWallTimeToIso(dateStr, timeStr) {
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const t = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m || !t) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const hh = Number(t[1]);
    const mm = Number(t[2]);
    if (!(y >= 2020) || mo < 1 || mo > 12 || day < 1 || day > 31 || hh > 23 || mm > 59) return null;
    return new Date(Date.UTC(y, mo - 1, day, hh + 6, mm, 0, 0)).toISOString();
}

function hnNowParts() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Tegucigalpa',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    let hour = get('hour') || '00';
    if (hour === '24') hour = '00';
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        time: `${String(hour).padStart(2, '0')}:${String(get('minute') || '00').padStart(2, '0')}`
    };
}

function addDaysYmd(ymd, days) {
    const [y, m, d] = ymd.split('-').map(Number);
    const utc = Date.UTC(y, m - 1, d + days);
    const dt = new Date(utc);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function formatHnScheduleLabel(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('es-HN', {
            timeZone: 'America/Tegucigalpa',
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hourCycle: 'h12'
        });
    } catch (_) {
        return String(iso);
    }
}

function parseHourMinute(raw) {
    const t = fold(raw);
    let m = t.match(/\b(?:a las?|las)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/);
    if (!m) return null;
    let hh = Number(m[1]);
    const mm = m[2] != null ? Number(m[2]) : 0;
    const ap = (m[3] || '').replace(/\./g, '');
    const evening = /\b(tarde|noche|pm|p\.m\.|de la tarde|de la noche)\b/.test(t);
    const morning = /\b(am|a\.m\.|de la manana|madrugada)\b/.test(t);
    if (ap.startsWith('p') && hh < 12) hh += 12;
    else if (ap.startsWith('a') && hh === 12) hh = 0;
    else if (!ap && evening && hh > 0 && hh < 12) hh += 12;
    else if (!ap && morning && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseScheduleText(raw) {
    const t = fold(raw);
    if (!t) return { kind: 'unknown' };
    if (/\b(ahora|ya|inmediato|ahorita|en este momento)\b/.test(t)) return { kind: 'now' };
    const hn = hnNowParts();
    let date = hn.date;
    if (/\bmanana\b/.test(t) && !/\bde la manana\b/.test(t)) date = addDaysYmd(hn.date, 1);
    const dmy = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (dmy) {
        const day = String(dmy[1]).padStart(2, '0');
        const mo = String(dmy[2]).padStart(2, '0');
        let year = dmy[3] ? Number(dmy[3]) : Number(hn.date.slice(0, 4));
        if (year < 100) year += 2000;
        date = `${year}-${mo}-${day}`;
    }
    const isoDay = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (isoDay) date = isoDay[1];
    let time = parseHourMinute(t);
    if (/\b(program|despues|luego|mas tarde|reserv)\b/.test(t) && !time) {
        return { kind: 'need_time' };
    }
    if (time) {
        let iso = hondurasWallTimeToIso(date, time);
        if (!iso) return { kind: 'unknown' };
        // "a las 6" a las 13:00: 6am ya pasó → se toma 6pm (hora Honduras)
        const hh = Number(String(time).slice(0, 2));
        const saidAmPm = /\b(am|pm|a\.m\.|p\.m\.|tarde|noche|madrugada|de la manana)\b/.test(t);
        if (
            !saidAmPm
            && hh > 0 && hh < 12
            && new Date(iso).getTime() < Date.now() + 8 * 60 * 1000
        ) {
            const pm = `${String(hh + 12).padStart(2, '0')}:${time.slice(3)}`;
            const isoPm = hondurasWallTimeToIso(date, pm);
            if (isoPm && new Date(isoPm).getTime() >= Date.now() + 8 * 60 * 1000) {
                time = pm;
                iso = isoPm;
            }
        }
        if (new Date(iso).getTime() < Date.now() + 8 * 60 * 1000) {
            return { kind: 'too_soon' };
        }
        return { kind: 'scheduled', iso, label: formatHnScheduleLabel(iso) };
    }
    return { kind: 'unknown' };
}

async function geocodeHn(address, bias = null) {
    const q0 = String(address || '').trim();
    if (q0.length < 3) return null;
    let q = q0;
    const cityHint = String(bias?.cityName || '').trim();
    if (cityHint && !fold(q).includes(fold(cityHint))) {
        q = `${q0}, ${cityHint}`;
    }
    let url = 'https://maps.googleapis.com/maps/api/geocode/json'
        + `?address=${encodeURIComponent(q)}`
        + '&components=country:HN'
        + '&region=hn'
        + '&language=es'
        + `&key=${MAPS_KEY}`;
    if (Number.isFinite(Number(bias?.lat)) && Number.isFinite(Number(bias?.lng))) {
        const d = 0.4;
        const lat = Number(bias.lat);
        const lng = Number(bias.lng);
        url += `&bounds=${lat - d},${lng - d}|${lat + d},${lng + d}`;
    }
    try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 1500);
        const r = await fetch(url, { signal: ac.signal });
        clearTimeout(t);
        const j = await r.json().catch(() => ({}));
        const hit = j.results?.[0];
        if (!hit?.geometry?.location) return null;
        return {
            address: hit.formatted_address || q0,
            lat: hit.geometry.location.lat,
            lng: hit.geometry.location.lng
        };
    } catch (e) {
        console.warn('[wa] geocode timeout/fail', e?.message || e);
        return null;
    }
}

function extractIncomingLocation(msg) {
    const loc = msg?.location;
    if (!loc) return null;
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const address = [loc.name, loc.address].filter(Boolean).join(' · ')
        || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return { address, lat, lng };
}

async function reverseGeocode(lat, lng) {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json'
        + `?latlng=${lat},${lng}`
        + '&language=es'
        + `&key=${MAPS_KEY}`;
    try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 1500);
        const r = await fetch(url, { signal: ac.signal });
        clearTimeout(t);
        const j = await r.json().catch(() => ({}));
        const hit = j.results?.[0];
        return hit?.formatted_address || null;
    } catch (e) {
        console.warn('[wa] reverse geocode fail', e?.message || e);
        return null;
    }
}

function addressLooksWeak(address) {
    const a = String(address || '').trim();
    if (a.length < 8) return true;
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(a);
}

async function resolvePlace(text, location, bias = null) {
    if (location?.lat != null && location?.lng != null) {
        const address = location.address
            || `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`;
        return {
            address,
            lat: location.lat,
            lng: location.lng
        };
    }
    if (String(text || '').trim().length >= 3) return geocodeHn(text, bias);
    return null;
}

function enrichPlaceAddressBg(phone, field, geo) {
    if (!geo || geo.lat == null || geo.lng == null) return;
    if (!addressLooksWeak(geo.address)) return;
    reverseGeocode(geo.lat, geo.lng).then((addr) => {
        if (!addr) return;
        const cur = sessionCache.get(String(phone))?.data;
        if (!cur) return;
        if (field === 'origin' && cur.origin) {
            cur.origin = { ...cur.origin, address: addr, formattedAddress: addr };
        } else if (field === 'dest' && cur.dest) {
            cur.dest = { ...cur.dest, address: addr, formattedAddress: addr };
        } else if (field === 'stop' && Array.isArray(cur.stops) && cur.stops.length) {
            const last = cur.stops[cur.stops.length - 1];
            if (last && Number(last.lat) === Number(geo.lat) && Number(last.lng) === Number(geo.lng)) {
                last.address = addr;
                last.placeName = addr;
                last.formattedAddress = addr;
            }
        }
        saveSessionBg(phone, cur);
    }).catch(() => {});
}

function parseDeA(raw) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (s.length < 5) return null;
    const m = s.match(/^(?:de\s+)?(.+?)\s+(?:a|al|hacia|para|->|→|hasta)\s+(.+)$/i);
    if (!m) return null;
    const a = m[1].trim();
    const b = m[2].trim();
    if (a.length < 3 || b.length < 3) return null;
    return { origin: a, dest: b };
}

/** iPhone: el botón nativo se retrasa o desaparece si el texto es largo o lleva markdown. */
function iosLocationBody(_prompt) {
    return 'Enviar ubicacion';
}

function locationKindFromPrompt(prompt, opts = {}) {
    if (opts && typeof opts === 'object') {
        if (opts.kind === 'dest' || opts.kind === 'origin' || opts.kind === 'stop') return opts.kind;
    }
    const raw = fold(prompt);
    if (/\b(parada|paso por|pasar por)\b/.test(raw)) return 'stop';
    if (/\b(destino|vas|a donde)\b/.test(raw)) return 'dest';
    return 'origin';
}

async function sendLocationRequest(to, prompt, opts = {}) {
    const dest = normalizeWaPhone(to);
    if (!dest) return { ok: false };
    const kind = locationKindFromPrompt(prompt, opts);
    // Aviso corto ANTES del botón. El body del pin se queda mínimo: si es largo, iPhone oculta Enviar ubicación.
    await sendCloudText(
        dest,
        'En iPhone el mapa tarda unos segundos. Espera el pin verde y luego Enviar.'
    );
    const bodyText = iosLocationBody(prompt);
    const res = await graphSendMessage({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: dest,
        type: 'interactive',
        interactive: {
            type: 'location_request_message',
            body: { text: bodyText },
            action: { name: 'send_location' }
        }
    });
    if (res?.ok) return res;
    console.warn('[wa] location_request failed', res?.error?.error?.message || res?.error || res);
    return sendCloudText(
        dest,
        kind === 'dest'
            ? 'Destino: clip 📎 → Ubicación → mueve el pin → Enviar.'
            : (kind === 'stop'
                ? 'Parada: clip 📎 → Ubicación → mueve el pin → Enviar.'
                : 'Origen: clip 📎 → Ubicación → mueve el pin → Enviar.')
    );
}

function wantsShareLocation(t) {
    return /\b(ubicacion|ubicame|estoy aqui|aqui estoy|mi gps|compartir ubic|mandar ubic|donde estoy|el pin|enviar ubic)\b/.test(t);
}

function haversineKm(a, b) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const CITY_COVERAGE_KM = {
    comayagua: 18,
    siguatepeque: 14,
    tegucigalpa: 22,
    comayaguela: 22,
    'san-pedro-sula': 22,
    choloma: 16,
    'la-ceiba': 18,
    'la-lima': 14,
    danli: 14,
    choluteca: 16,
    'santa-rosa-copan': 12,
    roatan: 12,
    utila: 10,
    talanga: 12,
    'valle-angeles': 10,
    'la-paz': 14
};

function getCityCoverageKm(zoneId) {
    if (zoneId && CITY_COVERAGE_KM[zoneId] != null) return CITY_COVERAGE_KM[zoneId];
    return 14;
}

function foldKey(s) {
    return fold(s).replace(/[^a-z0-9]+/g, '');
}

function findCityByName(raw) {
    const f = foldKey(raw);
    if (!f || f.length < 3) return null;
    const aliases = {
        distritocentral: 'tegucigalpa',
        tegus: 'tegucigalpa',
        capital: 'tegucigalpa',
        sps: 'san-pedro-sula',
        sanpedrosula: 'san-pedro-sula',
        sanpedro: 'san-pedro-sula',
        siguate: 'siguatepeque',
        ceiba: 'la-ceiba',
        laceiba: 'la-ceiba'
    };
    const aliasId = aliases[f];
    if (aliasId) return HN_CITIES.find((c) => c.id === aliasId) || null;
    const exact = HN_CITIES.find((c) => foldKey(c.id) === f || foldKey(c.name) === f);
    if (exact) return exact;
    const hits = HN_CITIES.filter((c) => {
        const n = foldKey(c.name);
        return n.length >= 5 && (f.includes(n) || n.includes(f));
    });
    if (hits.length === 1) return hits[0];
    return null;
}

function findNearestCity(lat, lng) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
    let best = null;
    let bestDist = Infinity;
    for (const c of HN_CITIES) {
        const d = haversineKm({ lat: Number(lat), lng: Number(lng) }, { lat: c.lat, lng: c.lng });
        if (d < bestDist) {
            best = c;
            bestDist = d;
        }
    }
    return best ? { ...best, distanceKm: bestDist } : null;
}

function resolveTripZone(origin, dest) {
    const point = (origin?.lat != null && origin?.lng != null) ? origin : dest;
    const hint = [origin?.address, dest?.address].filter(Boolean).join(' · ');
    if (point?.lat != null && point?.lng != null) {
        const nearest = findNearestCity(point.lat, point.lng);
        const named = findCityByName(hint);
        if (named && nearest) {
            const namedDist = haversineKm(
                { lat: Number(point.lat), lng: Number(point.lng) },
                { lat: named.lat, lng: named.lng }
            );
            if (namedDist <= 40) return named;
        }
        return nearest || named;
    }
    return findCityByName(hint);
}

function perKmOfService(serviceType) {
    if (serviceType === 'moto' || serviceType === 'delivery') return 18;
    if (serviceType === 'taxi') return 20;
    if (serviceType === 'flete_paila') return 28;
    if (serviceType === 'flete_camion') return 35;
    if (serviceType === 'grua') return 30;
    return 16;
}

function estimateFare(km, serviceType = 'auto', extraStops = 0) {
    const k = Math.max(0, Number(km) || 0);
    let n = 50;
    if (serviceType === 'moto') n = Math.max(35, 20 + k * 18);
    else if (serviceType === 'flete_paila') n = Math.max(180, 80 + k * 28);
    else if (serviceType === 'flete_camion') n = Math.max(280, 120 + k * 35);
    else if (serviceType === 'grua') n = Math.max(250, 100 + k * 30);
    else n = Math.max(50, 35 + k * 16);
    const extras = Math.max(0, Number(extraStops) || 0);
    if (extras > 0) n += extras * 15;
    return Math.round(n * 100) / 100;
}

const EXTRA_STOP_ON_ROUTE_FEE = 15;
const EXTRA_STOP_ON_ROUTE_MAX_KM = 1.8;

function extraStopsSurchargeWa(origin, dest, stops = [], perKm = 16) {
    const o = stopLatLng(origin);
    const d = stopLatLng(dest);
    const list = (Array.isArray(stops) ? stops : []).map(stopLatLng).filter(Boolean);
    if (!o || !d || !list.length) return { extra: 0, onRoute: 0, offRouteKm: 0 };
    const ab = haversineKm(o, d);
    const rate = Math.max(0, Number(perKm) || 16);
    let extra = 0;
    let onRoute = 0;
    let offRouteKm = 0;
    for (const s of list) {
        const detourRoad = Math.max(0, (haversineKm(o, s) + haversineKm(s, d) - ab) * 1.3);
        if (detourRoad <= EXTRA_STOP_ON_ROUTE_MAX_KM) {
            extra += EXTRA_STOP_ON_ROUTE_FEE;
            onRoute += 1;
        } else {
            offRouteKm += detourRoad;
            extra += Math.max(EXTRA_STOP_ON_ROUTE_FEE, Math.round(detourRoad * rate * 100) / 100);
        }
    }
    return {
        extra: Math.round(extra * 100) / 100,
        onRoute,
        offRouteKm: Math.round(offRouteKm * 10) / 10
    };
}

function normalizeServiceType(serviceType) {
    return ['auto', 'taxi', 'moto', 'flete_paila', 'flete_camion', 'grua', 'delivery'].includes(serviceType)
        ? serviceType
        : 'auto';
}

const MAX_WA_STOPS = 5;

function serviceAllowsExtraStops(serviceType) {
    const svc = normalizeServiceType(serviceType);
    return svc === 'auto' || svc === 'taxi' || svc === 'moto';
}

function stopLatLng(p) {
    if (!p) return null;
    const lat = Number(p.lat ?? p.latLng?.lat);
    const lng = Number(p.lng ?? p.latLng?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

function normalizeStops(session) {
    const raw = Array.isArray(session?.stops) ? session.stops : [];
    return raw.map((s, i) => {
        const ll = stopLatLng(s);
        if (!ll) return null;
        const address = String(s.address || s.placeName || `Parada ${i + 1}`).slice(0, 120);
        return {
            address,
            placeName: s.placeName || address,
            formattedAddress: s.formattedAddress || address,
            lat: ll.lat,
            lng: ll.lng,
            latLng: { lat: ll.lat, lng: ll.lng },
            routeSlot: 2
        };
    }).filter(Boolean).slice(0, MAX_WA_STOPS);
}

function toTripStop(geo) {
    const ll = stopLatLng(geo);
    if (!ll) return null;
    const address = String(geo.address || 'Parada').slice(0, 120);
    return {
        address,
        placeName: address,
        formattedAddress: address,
        lat: ll.lat,
        lng: ll.lng,
        latLng: { lat: ll.lat, lng: ll.lng },
        routeSlot: 2
    };
}

function formatRouteLine(session) {
    if (session?.clientChoosesRoute) return 'Ruta: la marcas con el pin en el link';
    const origin = session?.origin?.address || 'Origen';
    const dest = session?.dest?.address || 'Destino';
    const stops = normalizeStops(session);
    if (!stops.length) return `📍 ${origin}\n➡️ ${dest}`;
    const mid = stops.map((s, i) => `${i + 2}. ${s.address}`).join('\n');
    return `📍 ${origin}\n${mid}\n➡️ ${dest}`;
}

function tripDistanceKm(origin, dest, clientChoosesRoute, stops = []) {
    if (clientChoosesRoute === true) return 0;
    let pts = [origin, ...(Array.isArray(stops) ? stops : []), dest]
        .map((p) => stopLatLng(p))
        .filter(Boolean);
    if (pts.length < 2) {
        const o = stopLatLng(origin);
        const d = stopLatLng(dest);
        if (!o || !d) return 0;
        pts = [o, d];
    }
    let km = 0;
    for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1], pts[i]);
    return Math.round(km * 1.3 * 10) / 10;
}

function quoteTrip(session = {}) {
    const serviceType = normalizeServiceType(session.serviceType);
    const stops = normalizeStops(session);
    const directKm = tripDistanceKm(session.origin, session.dest, session.clientChoosesRoute, []);
    const chainKm = tripDistanceKm(session.origin, session.dest, session.clientChoosesRoute, stops);
    const surcharge = extraStopsSurchargeWa(session.origin, session.dest, stops, perKmOfService(serviceType));
    const km = chainKm > 0 ? chainKm : directKm;
    const priceNum = directKm > 0
        ? Math.round((estimateFare(directKm, serviceType, 0) + surcharge.extra) * 100) / 100
        : (km > 0 ? estimateFare(km, serviceType, 0) : 0);
    let priceLine;
    if (priceNum > 0) {
        if (surcharge.offRouteKm > 0) {
            priceLine = `Tarifa estimada: *L. ${priceNum.toFixed(2)}* (~${directKm} km + desvío ${surcharge.offRouteKm} km)`;
        } else if (surcharge.onRoute > 0) {
            priceLine = `Tarifa estimada: *L. ${priceNum.toFixed(2)}* (~${directKm} km + L. 15 parada)`;
        } else {
            priceLine = `Tarifa estimada: *L. ${priceNum.toFixed(2)}* (~${km} km)`;
        }
    } else if (session.clientChoosesRoute) {
        priceLine = 'Tarifa: te la muestro al marcar origen y destino en el mapa';
    } else {
        priceLine = 'Tarifa: se confirma en la app';
    }
    return { km, priceNum, priceLine, serviceType, directKm, surcharge };
}

function tripShareLink(tripId) {
    return `${APP_SITE}/?staffTrip=${encodeURIComponent(tripId)}`;
}

function tripLiveChatLink(tripId) {
    if (!tripId) return APP_SITE;
    return `${APP_SITE}/?trip=${encodeURIComponent(tripId)}&openChat=1`;
}

async function createWhatsAppTrip({ phone, name, origin, dest, scheduledFor, clientChoosesSchedule, clientChoosesRoute, serviceType, stops }) {
    const svc = normalizeServiceType(serviceType);
    const chooseRoute = clientChoosesRoute === true || !stopLatLng(dest) || !stopLatLng(origin);
    const additionalStops = (!chooseRoute && serviceAllowsExtraStops(svc))
        ? normalizeStops({ stops })
        : [];
    const hasRoute = !chooseRoute && origin?.lat != null && dest?.lat != null;
    const quote = quoteTrip({ origin, dest, clientChoosesRoute: chooseRoute, serviceType: svc, stops: additionalStops });
    const km = quote.km;
    const priceNum = quote.priceNum;
    const zone = resolveTripZone(origin, dest);
    const guestId = `guest_${phone}`;
    const payload = {
        status: 'pending',
        scheduledFor: scheduledFor || null,
        clientChoosesSchedule: clientChoosesSchedule === true || chooseRoute,
        clientChoosesRoute: chooseRoute,
        staffSetSchedule: !!(scheduledFor && !clientChoosesSchedule),
        serviceType: svc,
        bookingType: 'standard',
        additionalStops,
        multipleStops: additionalStops.length > 0,
        origin: origin?.address || 'Por definir',
        destination: dest?.address || 'Por definir',
        originLat: chooseRoute && !origin?.lat ? null : (origin?.lat ?? null),
        originLng: chooseRoute && !origin?.lng ? null : (origin?.lng ?? null),
        destinationLat: chooseRoute ? null : (dest?.lat ?? null),
        destinationLng: chooseRoute ? null : (dest?.lng ?? null),
        originFormattedAddress: origin?.address || 'Por definir',
        destinationFormattedAddress: dest?.address || 'Por definir',
        serviceZoneId: zone?.id || null,
        serviceZoneName: zone?.name || null,
        serviceDepartment: zone?.department || (zone?.id ? (ZONE_DEPARTMENT[zone.id] || null) : null),
        cityId: zone?.id || null,
        cityName: zone?.name || null,
        searchRadiusKm: Math.max(
            zone?.id ? getCityCoverageKm(zone.id) : 25,
            (svc === 'flete_paila' || svc === 'flete_camion' || svc === 'grua') ? 40 : 25
        ),
        price: priceNum > 0 ? `L. ${priceNum.toFixed(2)}` : 'Por confirmar',
        priceNum,
        staffManualPrice: false,
        routeFareNum: priceNum,
        paymentMethod: 'efectivo',
        clientId: guestId,
        clientName: name || 'Cliente WhatsApp',
        clientPhone: phone,
        clientPhoto: null,
        clientRating: '5.0',
        clientApprovalStatus: 'approved',
        clientVerified: false,
        clientIsFirstTrip: true,
        clientTotalTrips: 0,
        guestClient: true,
        guestInvitePending: !hasRoute,
        pendingClientPhone: phone,
        pendingClientName: name || 'Cliente WhatsApp',
        waProfileName: name || 'Cliente WhatsApp',
        waRegisterOffered: false,
        tripDistanceKm: km,
        tripDurationMs: km > 0 ? Math.round((km / 25) * 3600000) : 0,
        passengers: 1,
        passengerSurcharge: 0,
        extraPassengers: 0,
        clientChoosesPassengers: true,
        staffSetPassengers: false,
        freightDetails: null,
        createdAt: FieldValue.serverTimestamp(),
        chat: [],
        viewedBy: {},
        declinedDriverIds: [],
        offeredToDriverId: null,
        staffCreatedBy: 'whatsapp-assistant',
        staffCreatedByName: 'HonduRaite WhatsApp',
        staffCreatedAt: FieldValue.serverTimestamp(),
        staffAssistedClient: true,
        staffCreatedClientClaimed: hasRoute === true,
        createdVia: 'whatsapp',
        negotiationEnabled: false
    };
    const ref = await db().collection(`artifacts/${APP_ID}/public/data/trips`).add(payload);
    return { id: ref.id, priceNum, km, payload, zone };
}

const recentMsgIds = new Set();
async function alreadyReplied(messageId) {
    if (!messageId) return false;
    if (recentMsgIds.has(messageId)) return true;
    recentMsgIds.add(messageId);
    if (recentMsgIds.size > 400) {
        const first = recentMsgIds.values().next().value;
        recentMsgIds.delete(first);
    }
    const ref = db().doc(`artifacts/${APP_ID}/public/data/whatsapp_assistant_dedup/${messageId}`);
    try {
        await ref.create({ at: FieldValue.serverTimestamp() });
        return false;
    } catch (e) {
        if (e?.code === 6 || /already exists/i.test(String(e?.message || ''))) return true;
        return false;
    }
}

async function finishTripAndSendLink(to, session, contactName) {
    const created = await createWhatsAppTrip({
        phone: to,
        name: contactName,
        origin: session.origin || { address: 'Por definir', lat: null, lng: null },
        dest: session.dest || { address: 'Por definir', lat: null, lng: null },
        scheduledFor: session.scheduledFor || null,
        clientChoosesSchedule: session.clientChoosesSchedule === true,
        clientChoosesRoute: session.clientChoosesRoute === true,
        serviceType: session.serviceType || 'auto',
        stops: session.stops || []
    });
    await clearSession(to);
    const whenLine = session.scheduledFor
        ? `Programado: ${session.scheduleLabel || session.scheduledFor}`
        : (session.clientChoosesSchedule
            ? 'Hora: la eliges en el link'
            : 'Para ahora');
    const zone = created.zone || resolveTripZone(session.origin, session.dest);
    const svcLine = `Servicio: ${serviceLabel(session.serviceType || created.payload?.serviceType || 'auto')}`;
    const cityLine = zone?.name
        ? `Ciudad: ${zone.name}${zone.department ? ` (${zone.department})` : ''}`
        : '';
    const quote = quoteTrip(session);
    const priceLine = created.priceNum > 0
        ? `Tarifa estimada: *L. ${created.priceNum.toFixed(2)}*${created.km > 0 ? ` (~${created.km} km)` : ''}`
        : quote.priceLine;
    const link = session.clientChoosesRoute
        ? tripShareLink(created.id)
        : tripLiveChatLink(created.id);
    const routeLine = session.clientChoosesRoute
        ? 'En el link marcas origen, paradas y destino *con el pin del mapa* (por si el lugar no sale en el buscador).'
        : formatRouteLine(session);
    const body = session.clientChoosesRoute
        ? (
            `Pedido armado.\n\n` +
            `${svcLine}\n` +
            `${routeLine}\n` +
            `${whenLine}\n` +
            `${cityLine ? `${cityLine}\n` : ''}` +
            `${priceLine}\n\n` +
            `Aún *no* avisamos a los conductores.\n` +
            `Abre el link, marca el pin y toca *Quiero este viaje* para confirmar:\n${link}\n\n` +
            `Cuando confirmes, se alerta a los conductores de esa ciudad/departamento.`
        )
        : (
            `¡Viaje confirmado${session.waName ? `, ${firstNameFrom(session.waName)}` : ''}!\n\n` +
            `${svcLine}\n` +
            `${routeLine}\n` +
            `${whenLine}\n` +
            `${cityLine ? `${cityLine}\n` : ''}` +
            `${priceLine}\n\n` +
            `Ya avisamos a los conductores${zone?.name ? ` de ${zone.name}` : ''}${zone?.department ? ` (${zone.department})` : ''}. Te avisamos aquí cuando alguien tome el viaje.\n\n` +
            `Sigue el viaje y al conductor aquí (app o web):\n${link}\n\n` +
            `Entra con tu teléfono. Al final te invitamos a registrarte.`
        );
    return sendCloudText(to, body);
}

function hasPlace(p) {
    if (!p) return false;
    if (p.lat != null && p.lng != null) return true;
    const addr = String(p.address || '').trim();
    return addr.length >= 3 && addr !== 'Por definir';
}

async function askDest(from, origin, replyToId) {
    return sendLocationRequest(from, 'Enviar ubicacion', { kind: 'dest' });
}

async function askConfirm(from, session) {
    const whenLine = session.scheduledFor
        ? `Programado: ${session.scheduleLabel || session.scheduledFor}`
        : (session.clientChoosesSchedule ? 'Hora: la eliges en el link' : 'Para ahora');
    const zone = resolveTripZone(session.origin, session.dest);
    const cityLine = zone?.name
        ? `Ciudad: ${zone.name}${zone.department ? ` (${zone.department})` : ''}`
        : '';
    const routeLine = formatRouteLine(session);
    const warn = session.clientChoosesRoute
        ? 'Si confirmas te mando el link. Los conductores se enteran cuando marques el pin y confirmes ahí.'
        : 'Si confirmas, recién ahí avisamos a los conductores de esa ciudad.';
    const svcLine = `Servicio: ${serviceLabel(session.serviceType || 'auto')}`;
    const quote = quoteTrip(session);
    const body = `¿Confirmas el viaje?\n\n${svcLine}\n${routeLine}\n${whenLine}${cityLine ? `\n${cityLine}` : ''}\n${quote.priceLine}\n\n${warn}`;
    const btns = await sendCloudButtons(from, body, [
        { id: 'confirm_yes', title: 'Confirmar viaje' },
        { id: 'confirm_no', title: 'Cancelar' }
    ]);
    if (btns?.ok) return btns;
    return sendCloudText(from, `${body}\n\nEscribe *confirmar* o *cancelar*.`);
}

function isConfirmYes(id, t) {
    if (id === 'confirm_yes') return true;
    return /^(si|sí|sip|ok|okay|dale|va|listo|confirmar|confirmo|pedir|de una|hagalo|hazlo)(\b|$)/.test(t);
}

function isConfirmNo(id, t) {
    if (id === 'confirm_no') return true;
    return /^(no|nop|cancelar|mejor no|no gracias)$/.test(t);
}

function wantsAddStop(id, t) {
    if (id === 'stop_add') return true;
    return /\b(otra parada|agregar parada|mas parada|más parada|paso por|pasar por|otro punto|mas puntos|más puntos|varios puntos)\b/.test(t);
}

function wantsStopsDone(id, t) {
    if (id === 'stop_done') return true;
    return /^(no|nop|listo|seguir|continuar|confirmar|ya|asi esta|así está|sin parada|no gracias)(\b|$)/.test(t);
}

async function askStops(from, session) {
    const stops = normalizeStops(session);
    if (stops.length >= MAX_WA_STOPS) {
        return goToConfirm(from, session);
    }
    const routeLine = formatRouteLine(session);
    const body = stops.length
        ? `Ruta:\n${routeLine}\n\n¿Agregas otra parada antes del destino? (máx. ${MAX_WA_STOPS})`
        : `Ruta:\n${routeLine}\n\n¿Pasas por otro punto antes de llegar al destino?`;
    const btns = await sendCloudButtons(from, body, [
        { id: 'stop_add', title: 'Agregar parada' },
        { id: 'stop_done', title: stops.length ? 'Listo, confirmar' : 'No, confirmar' }
    ]);
    if (btns?.ok) return btns;
    return sendCloudText(from, `${body}\n\nEscribe *parada* o *confirmar*.`);
}

async function askStopPlace(from) {
    return sendLocationRequest(from, 'Parada: toca Enviar ubicacion', { kind: 'stop' });
}

async function goToConfirm(from, session, contactName) {
    if (!session.serviceType) {
        const next = { ...session, step: 'service', waName: contactName || session.waName };
        await saveSession(from, next);
        return askService(from);
    }
    const next = { ...session, step: 'confirm', waName: contactName || session.waName };
    await saveSession(from, next);
    return askConfirm(from, next);
}

async function goToStopsOrConfirm(from, session, contactName) {
    if (session.clientChoosesRoute || !serviceAllowsExtraStops(session.serviceType)) {
        return goToConfirm(from, session, contactName);
    }
    const next = {
        ...session,
        step: 'stops',
        waName: contactName || session.waName,
        stops: normalizeStops(session)
    };
    await saveSession(from, next);
    return askStops(from, next);
}

async function continueAfterService(from, session, contactName, replyToId) {
    if (!session.when && !session.scheduledFor && session.clientChoosesSchedule !== true) {
        await saveSession(from, { ...session, step: 'when' });
        return askWhen(from);
    }
    return continueAfterSchedule(from, session, contactName, replyToId);
}

async function continueAfterSchedule(from, session, contactName, replyToId) {
    if (hasPlace(session.origin) && (hasPlace(session.dest) || session.clientChoosesRoute)) {
        return goToStopsOrConfirm(from, session, contactName);
    }
    if (hasPlace(session.origin)) {
        saveSessionBg(from, { ...session, step: 'dest' });
        return askDest(from, session.origin, replyToId);
    }
    saveSessionBg(from, { ...session, step: 'origin' });
    return sendLocationRequest(from, 'Enviar ubicacion', { kind: 'origin' });
}

/**
 * Asistencia en Firebase: menú + pedir/programar viaje y mandar link.
 */
async function handleWhatsAppAssistant(body) {
    const entries = body?.entry || [];
    let replied = false;
    for (const entry of entries) {
        for (const change of entry?.changes || []) {
            if (change?.field && change.field !== 'messages') continue;
            const value = change?.value || {};
            const contactName = value.contacts?.[0]?.profile?.name || '';
            for (const msg of value.messages || []) {
                if (!msg?.from) continue;
                const [dup, preloaded] = await Promise.all([
                    alreadyReplied(msg.id),
                    loadSession(msg.from)
                ]);
                if (dup) continue;
                const buttonId = msg.interactive?.button_reply?.id
                    || msg.interactive?.list_reply?.id
                    || '';
                const text = msg.text?.body || msg.interactive?.button_reply?.title || '';
                const location = extractIncomingLocation(msg);
                const res = await routeAssistantMessage(
                    msg.from, text, buttonId, contactName, location, msg.id, preloaded
                );
                console.log('[whatsappWebhook] asistencia', {
                    to: msg.from,
                    ok: !!res?.ok,
                    buttonId: buttonId || null,
                    hasLocation: !!location,
                    text: String(text).slice(0, 40)
                });
                replied = replied || !!res?.ok;
            }
        }
    }
    return replied;
}

function looksLikeQuestion(t) {
    return (
        /\?/.test(t)
        || /^(si |y si |oye |hola,? )?(puedo|se puede|es posible|necesito saber|una pregunta)/.test(t)
        || /\b(sin cuenta|no tengo cuenta|no estoy registrado|no me he registrado|no tengo app|no he descargado)\b/.test(t)
        || /\b(como funciona|cuanto (cuesta|sale|cobran)|que ciudades|donde operan|efectivo|tarjeta)\b/.test(t)
    );
}

function faqAnswer(t) {
    if (/\b(sin cuenta|no tengo cuenta|no estoy registrado|no me he registrado|no tengo usuario|no tengo app|sin registrarme|sin la app)\b/.test(t)
        || (/\b(puedo|se puede)\b/.test(t) && /\b(pedir|solicitar|viaje|aqui|por aqui|whatsapp)\b/.test(t)
            && !/\b(parada|paradas|puntos|pasar por|paso por)\b/.test(t))) {
        return (
            'Sí. *No necesitas cuenta todavía.*\n\n' +
            'Sí. Pídelo aquí, sin cuenta. Mándame pin o escribe *origen a destino* (ej. *Comayagua centro a Siguatepeque*).\nAl terminar el viaje te invito a registrarte.'
        );
    }
    if (/\b(cuanto|precio|tarifa|cobra|sale|cuesta)\b/.test(t)) {
        return (
            'La tarifa depende de origen, destino y tipo de servicio (moto o taxi). *Antes de confirmar te digo cuánto sale* (estimado). El precio final se confirma en la app.\n\n' +
            'Pagas en *efectivo* al conductor. Escribe *viaje* para cotizar el tuyo.'
        );
    }
    if (/\b(ciudad|ciudades|donde (andan|operan|llegan)|comayagua|tegucigalpa|siguatepeque)\b/.test(t)) {
        return (
            'HonduRaite opera en Honduras (Comayagua, Siguatepeque, Tegucigalpa y más ciudades).\n' +
            'Dime de dónde sales y a dónde vas y te armo el viaje.\n\nEscribe *viaje*.'
        );
    }
    if (/\b(como funciona|que es honduraite|como pido|pasos)\b/.test(t)) {
        return (
            'Así funciona:\n' +
            '1. Eliges *Taxi VIP*, *moto*, *flete* o *grúa*\n' +
            '2. Me dices *ahora* o *programar*\n' +
            '3. Origen y destino con el pin de WhatsApp\n' +
            '4. Si quieres, agregas *paradas* (más puntos antes del destino)\n' +
            '5. Te digo la tarifa estimada, confirmas y avisamos a los conductores\n\nEscribe *viaje* para empezar.'
        );
    }
    if (/\b(parada|paradas|mas puntos|más puntos|varios puntos|pasar por|paso por|otra parada)\b/.test(t)) {
        return (
            'Sí. En un viaje *ahora* o *programado* (Taxi VIP, taxi o moto) puedes poner más puntos:\n' +
            'origen → paradas → destino.\n\n' +
            'Después del destino te pregunto si pasas por otro punto. Máximo 5 paradas.\n' +
            'Los envíos y fletes van directo, sin paradas extra.\n\nEscribe *viaje* para armarlo.'
        );
    }
    if (/\b(donde estoy|como saben donde|ubicacion|gps|de donde a donde|no sale|no aparece|el pin|marcar en el mapa)\b/.test(t)) {
        return (
            'Si el lugar *no sale* al escribirlo, márcalo con el pin:\n\n' +
            '1. En este chat toca el clip 📎 o *Enviar ubicación*\n' +
            '2. Elige *Ubicación* (no “ubicación actual” si vas a otro punto)\n' +
            '3. Mueve el mapa y deja el *pin* exacto\n' +
            '4. Toca enviar\n\n' +
            'También puedes decir *en el link* y lo marcas en el mapa de HonduRaite al abrir el viaje.\n\nEscribe *viaje* para empezar.'
        );
    }
    if (/\b(efectivo|tarjeta|saldo|pago)\b/.test(t)) {
        return 'Puedes pagar en *efectivo* al conductor. Si tienes saldo en la app, también ahí. Escribe *viaje* cuando quieras pedir.';
    }
    if (/\b(como me registro|registrarme|papeles|antecedentes|licencia|revision vehicular)\b/.test(t)
        && /\b(conductor|manejar|manejar para ustedes)\b/.test(t)) {
        return null;
    }
    if (/\b(moto|taxi|vip|flete|grua|grúa|tipo de (servicio|carro))\b/.test(t) && looksLikeQuestion(t) && !/\bconductor\b/.test(t)) {
        return 'Hay *Taxi VIP*, *moto*, *flete paila*, *flete camión* y *grúa*. Escribe *viaje* y elige el servicio.';
    }
    if (/\b(programar|reservar|para manana|para despues)\b/.test(t) && looksLikeQuestion(t)) {
        return 'Sí, puedes *programar* el viaje. Escribe *viaje* y elige Programar (ej. mañana 3pm). Te mando el link.';
    }
    return null;
}

function isFarewell(t) {
    const s = String(t || '').replace(/[.!,¿?¡]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 48) return false;
    if (/^(no|nop|nel|nope|nah|no gracias|no por ahora|ahora no|luego|despues|otro dia|mejor no|no quiero|no gracias por ahora)$/.test(s)) {
        return 'no';
    }
    if (/^(gracias|muchas gracias|mil gracias|ok gracias|listo gracias|esta bien gracias|va gracias|thanks|ty)$/.test(s)) {
        return 'gracias';
    }
    if (/^(adios|chao|bye|nos vemos|hasta luego|quedo atento)$/.test(s)) {
        return 'adios';
    }
    return null;
}

function farewellText(kind, contactName) {
    const n = firstNameFrom(contactName);
    const who = n && n !== 'Cliente' ? `, ${n}` : '';
    if (kind === 'no') {
        return `Sin problema${who}. Aquí quedo cuando lo necesites.\nEscribe *viaje* o *conductor*. ¡Buen camino!`;
    }
    return `Con gusto${who}. HonduRaite a la orden.\nCuando quieras, escribe *viaje*. ¡Buen camino!`;
}

async function routeAssistantMessage(from, text, buttonId, contactName, location, replyToId, preloadedSession) {
    const id = String(buttonId || '').toLowerCase();
    const t = fold(text);
    let session = preloadedSession || await loadSession(from);

    if (id === 'soporte' || (/\b(soporte|ayuda|humano|agente|queja|problema)\b/.test(t) && !looksLikeQuestion(t))) {
        await clearSession(from);
        return sendCloudText(
            from,
            `Soporte HonduRaite 24/7:\nWhatsApp: +${SUPPORT_WA}\nhttps://wa.me/${SUPPORT_WA}`
        );
    }
    const bye = !id && isFarewell(t);
    if (bye) {
        await clearSession(from);
        return sendCloudText(from, farewellText(bye, contactName));
    }
    if (id === 'drv_types') {
        await saveSession(from, { step: 'drv_guide' });
        return sendDriverTypePicker(from);
    }
    if (id === 'drv_auto' || id === 'drv_taxi' || id === 'drv_moto' || id === 'drv_paila' || id === 'drv_camion' || id === 'drv_grua') {
        const type = id.replace('drv_', '');
        return sendDriverTypeGuide(from, type);
    }
    if (wantsDriverGuide(id, t)) {
        const typed = driverTypeFromText(t);
        if (typed && id !== 'conductor') return sendDriverTypeGuide(from, typed);
        return sendDriverRegisterGuide(from);
    }
    if (session.step === 'drv_guide') {
        const typed = driverTypeFromText(t);
        if (typed) return sendDriverTypeGuide(from, typed);
        if (/\b(app|link|pagina|registro)\b/.test(t)) {
            return sendCloudText(from, `Regístrate aquí: ${APP_SITE}\nElige *Conductor* y sigue la guía. Escribe *auto*, *moto*, *taxi*… para ver las fotos de ese tipo.`);
        }
    }
    if (id === 'menu' || (/\b(menu|inicio|hola|buenas|hey)\b/.test(t) && (session.step === 'idle' || session.step === 'drv_guide') && !looksLikeQuestion(t) && t.length < 24)) {
        await clearSession(from);
        const menu = await sendCloudMenu(from);
        if (menu?.ok) return menu;
        return sendCloudText(
            from,
            'Hola, soy HonduRaite.\nEscribe *viaje* para pedir o programar (sí, aunque no tengas cuenta).\nEscribe *conductor* o *soporte*.'
        );
    }
    if (/\b(cancelar|salir|menu)\b/.test(t) && session.step !== 'idle') {
        const wasGuide = session.step === 'drv_guide';
        await clearSession(from);
        if (wasGuide) {
            return sendCloudText(from, 'Listo. Escribe *conductor* para ver la guía otra vez o *viaje* para pedir.');
        }
        return sendCloudText(from, 'Listo, cancelé el pedido. Escribe *viaje* cuando quieras armar otro.');
    }

    const faq = faqAnswer(t);
    if (faq && (session.step === 'idle' || looksLikeQuestion(t))) {
        if (session.step === 'service') {
            return sendCloudText(from, `${faq}\n\nSigamos: ¿Taxi VIP, moto, flete o grúa?`);
        }
        if (session.step === 'when' || session.step === 'when_time') {
            return sendCloudText(from, `${faq}\n\nSigamos: ¿ahora o lo programamos?`);
        }
        if (session.step === 'origin') {
            return sendCloudText(from, `${faq}\n\nSigamos: ¿de dónde te recojo?`);
        }
        if (session.step === 'dest') {
            return sendCloudText(from, `${faq}\n\nSigamos: ¿a dónde vas?`);
        }
        if (session.step === 'stops' || session.step === 'stop_place') {
            return sendCloudText(from, `${faq}\n\nSigamos: ¿agregas otra parada o confirmamos?`);
        }
        if (session.step === 'confirm') {
            if (/\b(cuanto|precio|tarifa|cobra|sale|cuesta)\b/.test(t)) {
                return askConfirm(from, session);
            }
            const quote = quoteTrip(session);
            return sendCloudText(from, `${faq}\n\n${quote.priceLine}\n\nSigamos: ¿confirmas el viaje?`);
        }
        return sendCloudText(from, faq);
    }

    const oneShot = (session.step === 'idle' || session.step === 'origin' || session.step === 'when')
        ? parseDeA(text)
        : null;
    if (oneShot && !looksLikeQuestion(t)) {
        const [o, d] = await Promise.all([geocodeHn(oneShot.origin), geocodeHn(oneShot.dest)]);
        if (o && d) {
            const sched = parseScheduleText(text);
            const base = {
                origin: o,
                dest: d,
                stops: [],
                waName: contactName || session.waName,
                clientChoosesSchedule: false,
                clientChoosesRoute: false
            };
            if (sched.kind === 'scheduled') {
                return goToStopsOrConfirm(from, {
                    ...base,
                    when: 'schedule',
                    scheduledFor: sched.iso,
                    scheduleLabel: sched.label,
                    stops: []
                }, contactName);
            } else if (sched.kind === 'now') {
                return goToStopsOrConfirm(from, {
                    ...base,
                    when: 'now',
                    scheduledFor: null,
                    stops: []
                }, contactName);
            } else {
                await saveSession(from, {
                    ...base,
                    step: 'when',
                    when: null,
                    scheduledFor: null,
                    scheduleLabel: null
                });
                return askWhen(from);
            }
        }
    }

    if (session.step === 'idle' && location) {
        const geo = await resolvePlace('', location);
        if (geo) {
            await saveSession(from, {
                step: 'when',
                origin: geo,
                dest: null,
                stops: [],
                when: null,
                waName: contactName,
                clientChoosesSchedule: false,
                scheduledFor: null
            });
            return askWhen(from);
        }
    }

    const startBooking = id === 'viaje' || id === 'viaje_ahora' || id === 'viaje_prog'
        || (id === 'when_now' && (session.step === 'idle' || session.step === 'drv_guide'))
        || (session.step === 'idle' && !looksLikeQuestion(t)
            && /\b(viaje|taxi|moto|pedir|solicitar|flete|grua|grúa|paila|camion|camión)\b/.test(t));

    if (startBooking && (session.step === 'idle' || session.step === 'drv_guide' || id === 'viaje')) {
        const parsedSched = parseScheduleText(text);
        const wantLater = id === 'viaje_prog'
            || parsedSched.kind === 'need_time'
            || (/\bprogram/.test(t) && parsedSched.kind !== 'scheduled' && parsedSched.kind !== 'now');
        const saidNow = id === 'viaje_ahora' || id === 'when_now' || parsedSched.kind === 'now';
        const pickedSvc = parsePassengerService(id, t);
        const fresh = {
            origin: null,
            dest: null,
            stops: [],
            waName: contactName,
            clientChoosesRoute: false,
            scheduleLabel: null,
            serviceType: pickedSvc || null
        };
        if (!pickedSvc) {
            saveSessionBg(from, { ...fresh, step: 'service' });
            return askService(from);
        }
        if (wantLater) {
            await saveSession(from, {
                ...fresh,
                step: 'when_time',
                when: 'schedule',
                clientChoosesSchedule: true,
                scheduledFor: null
            });
            return sendCloudText(from, '¿A qué hora? Ej: *mañana 3pm* o *hoy 18:30*.');
        }
        if (parsedSched.kind === 'scheduled') {
            saveSessionBg(from, {
                ...fresh,
                step: 'origin',
                when: 'schedule',
                clientChoosesSchedule: false,
                scheduledFor: parsedSched.iso,
                scheduleLabel: parsedSched.label
            });
            return sendLocationRequest(from, 'Enviar ubicacion', { kind: 'origin' });
        }
        if (saidNow) {
            saveSessionBg(from, {
                ...fresh,
                step: 'origin',
                when: 'now',
                clientChoosesSchedule: false,
                scheduledFor: null
            });
            return sendLocationRequest(from, 'Enviar ubicacion', { kind: 'origin' });
        }
        await saveSession(from, {
            ...fresh,
            step: 'when',
            when: null,
            clientChoosesSchedule: false,
            scheduledFor: null
        });
        return askWhen(from);
    }

    if (session.step === 'service' || String(id || '').startsWith('svc_')) {
        const svc = parsePassengerService(id, t);
        if (!svc) return askService(from);
        const next = {
            ...session,
            serviceType: svc,
            waName: contactName || session.waName
        };
        if (session.step === 'idle') {
            next.origin = null;
            next.dest = null;
        }
        return continueAfterService(from, next, contactName, replyToId);
    }

    if (session.step === 'when' || id === 'when_later') {
        if (id === 'when_now' || parseScheduleText(text).kind === 'now') {
            return continueAfterSchedule(from, {
                ...session,
                when: 'now',
                clientChoosesSchedule: false,
                scheduledFor: null
            }, contactName, replyToId);
        }
        if (id === 'when_later' || parseScheduleText(text).kind === 'need_time' || /\bprogram/.test(t)) {
            await saveSession(from, { ...session, step: 'when_time', when: 'schedule', clientChoosesSchedule: true });
            return sendCloudText(
                from,
                '¿A qué hora? Ejemplos:\n• mañana 3pm\n• hoy 18:30\n• 8/09 15:00\n\nO escribe *tú eliges* y lo pones en el link.'
            );
        }
        const parsed = parseScheduleText(text);
        if (parsed.kind === 'scheduled') {
            return continueAfterSchedule(from, {
                ...session,
                when: 'schedule',
                clientChoosesSchedule: false,
                scheduledFor: parsed.iso,
                scheduleLabel: parsed.label
            }, contactName, replyToId);
        }
        if (parsed.kind === 'too_soon') {
            return sendCloudText(from, 'Esa hora ya pasó o es muy pronto. Prueba otra (mínimo 10 min) o escribe *ahora*.');
        }
        return askWhen(from);
    }

    if (session.step === 'when_time') {
        if (/\b(tu eliges|tu decides|en el link|despues)\b/.test(t)) {
            return continueAfterSchedule(from, {
                ...session,
                clientChoosesSchedule: true,
                scheduledFor: null
            }, contactName, replyToId);
        }
        const parsed = parseScheduleText(text);
        if (parsed.kind === 'now') {
            return continueAfterSchedule(from, {
                ...session,
                when: 'now',
                clientChoosesSchedule: false,
                scheduledFor: null
            }, contactName, replyToId);
        }
        if (parsed.kind === 'scheduled') {
            return continueAfterSchedule(from, {
                ...session,
                when: 'schedule',
                clientChoosesSchedule: false,
                scheduledFor: parsed.iso,
                scheduleLabel: parsed.label
            }, contactName, replyToId);
        }
        if (parsed.kind === 'too_soon') {
            return sendCloudText(from, 'Esa hora es muy pronto. Dame otra, ej. *mañana 4pm*.');
        }
        return sendCloudText(from, 'No entendí la hora. Prueba: *mañana 3pm* o *hoy 18:00*.');
    }

    if (session.step === 'origin') {
        if (wantsShareLocation(t) && !location) {
            return sendLocationRequest(from, 'Enviar ubicacion', { kind: 'origin' });
        }
        const geo = await resolvePlace(text, location);
        if (!geo) {
            return sendLocationRequest(from, 'Enviar ubicacion', { kind: 'origin' });
        }
        saveSessionBg(from, { ...session, step: 'dest', origin: geo });
        enrichPlaceAddressBg(from, 'origin', geo);
        return askDest(from, geo, replyToId);
    }

    if (session.step === 'dest') {
        const originZone = session.origin ? resolveTripZone(session.origin) : null;
        const originBias = session.origin?.lat != null
            ? { lat: session.origin.lat, lng: session.origin.lng, cityName: originZone?.name }
            : null;
        if (id === 'dest_app' || /\b(en el link|en la app|marcar en (el )?mapa|con el pin de la app)\b/.test(t)) {
            session = {
                ...session,
                dest: { address: 'Por definir', lat: null, lng: null },
                clientChoosesRoute: true
            };
            if (!session.when && session.clientChoosesSchedule !== true && !session.scheduledFor) {
                await saveSession(from, { ...session, step: 'when' });
                return askWhen(from);
            }
            return goToConfirm(from, session, contactName);
        }
        if (id === 'dest_pin' || (wantsShareLocation(t) && !location)) {
            return sendLocationRequest(from, 'Enviar ubicacion', { kind: 'dest' });
        }
        const geo = await resolvePlace(text, location, originBias);
        if (!geo) {
            return sendLocationRequest(from, 'Enviar ubicacion', { kind: 'dest' });
        }
        session = { ...session, dest: geo, stops: normalizeStops(session) };
        enrichPlaceAddressBg(from, 'dest', geo);
        if (!session.when && session.clientChoosesSchedule !== true && !session.scheduledFor) {
            saveSessionBg(from, { ...session, step: 'when' });
            return askWhen(from);
        }
        return goToStopsOrConfirm(from, session, contactName);
    }

    if (session.step === 'stops' || id === 'stop_add' || id === 'stop_done') {
        if (wantsAddStop(id, t)) {
            if (normalizeStops(session).length >= MAX_WA_STOPS) {
                return goToConfirm(from, session, contactName);
            }
            saveSessionBg(from, { ...session, step: 'stop_place' });
            return askStopPlace(from);
        }
        if (wantsStopsDone(id, t) || isConfirmYes(id, t)) {
            return goToConfirm(from, session, contactName);
        }
        return askStops(from, session);
    }

    if (session.step === 'stop_place') {
        const originZone = session.origin ? resolveTripZone(session.origin) : null;
        const originBias = session.origin?.lat != null
            ? { lat: session.origin.lat, lng: session.origin.lng, cityName: originZone?.name }
            : null;
        if (wantsStopsDone(id, t)) {
            return goToConfirm(from, session, contactName);
        }
        if (wantsShareLocation(t) && !location) {
            return askStopPlace(from);
        }
        const geo = await resolvePlace(text, location, originBias);
        if (!geo) {
            return askStopPlace(from);
        }
        const stop = toTripStop(geo);
        if (!stop) {
            return askStopPlace(from);
        }
        const stops = [...normalizeStops(session), stop].slice(0, MAX_WA_STOPS);
        const next = { ...session, stops, step: 'stops' };
        saveSessionBg(from, next);
        enrichPlaceAddressBg(from, 'stop', geo);
        return askStops(from, next);
    }

    const inConfirm = session.step === 'confirm'
        || ((id === 'confirm_yes' || id === 'confirm_no')
            && (hasPlace(session.origin) || session.clientChoosesRoute));
    if (inConfirm) {
        if (wantsAddStop(id, t) && serviceAllowsExtraStops(session.serviceType) && !session.clientChoosesRoute) {
            if (normalizeStops(session).length >= MAX_WA_STOPS) {
                return askConfirm(from, session);
            }
            saveSessionBg(from, { ...session, step: 'stop_place' });
            return askStopPlace(from);
        }
        if (isConfirmNo(id, t)) {
            await clearSession(from);
            return sendCloudText(from, 'Listo, no pedí el viaje. Escribe *viaje* cuando quieras armar otro.');
        }
        if (isConfirmYes(id, t)) {
            try {
                return await finishTripAndSendLink(from, session, contactName);
            } catch (e) {
                console.error('[whatsappWebhook] crear viaje', e);
                return sendCloudText(from, 'No pude armar el viaje. Intenta de nuevo o escribe *soporte*.');
            }
        }
        return askConfirm(from, session);
    }

    const menu = await sendCloudMenu(from);
    if (menu?.ok) return menu;
    return sendCloudText(
        from,
        'Hola, soy HonduRaite.\nEscribe *viaje* para pedir o programar.\nEscribe *conductor* o *soporte*.'
    );
}

/**
 * Webhook público para Meta.
 * URL (tras deploy us-central1):
 *   https://us-central1-PROJECT_ID.cloudfunctions.net/whatsappWebhook
 */
exports.whatsappWebhook = onRequest(
    {
        region: 'us-central1',
        invoker: 'public',
        cors: false,
        minInstances: 1,
        timeoutSeconds: 60,
        memory: '512MiB',
        concurrency: 20,
    },
    async (req, res) => {
        const verifyToken = waVerifyToken.value();
        const appSecret = (waAppSecret.value() || '').trim();

        // —— Verificación (Meta → "Verificar y guardar") ——
        if (req.method === 'GET') {
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];

            if (mode === 'subscribe' && token && token === verifyToken && challenge != null) {
                console.log('[whatsappWebhook] Verificación OK');
                res.status(200).send(String(challenge));
                return;
            }
            console.warn('[whatsappWebhook] Verificación fallida', { mode, tokenMatch: token === verifyToken });
            res.status(403).send('Forbidden');
            return;
        }

        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        // —— Eventos entrantes ——
        const signature = req.get('x-hub-signature-256') || req.get('X-Hub-Signature-256');
        const rawBody = req.rawBody
            || (typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body || {})));

        if (appSecret && !verifyMetaSignature(rawBody, signature, appSecret)) {
            console.warn('[whatsappWebhook] Firma inválida');
            res.status(401).send('Invalid signature');
            return;
        }

        // Contestar al usuario ANTES de responder 200. Si se envía 200 primero,
        // Cloud Run corta la CPU y el bot se siente lento o no responde.
        try {
            const body = typeof req.body === 'object' && req.body
                ? req.body
                : JSON.parse(String(rawBody));
            const change = body?.entry?.[0]?.changes?.[0];
            const field = change?.field || '';
            const msgs = change?.value?.messages || [];
            const from = msgs[0]?.from || '';
            const text = msgs[0]?.text?.body || msgs[0]?.type || '';
            const t0 = Date.now();
            console.log('[whatsappWebhook] POST recibido', {
                field,
                messages: msgs.length,
                from,
                text: String(text).slice(0, 80)
            });
            persistWebhookPayload(body).catch((e) => console.warn('[whatsappWebhook] persist', e?.message || e));
            const replied = msgs.length ? await handleWhatsAppAssistant(body) : false;
            console.log('[whatsappWebhook] listo', Date.now() - t0, 'ms', { replied, from });
            if (!replied && msgs.length) {
                forwardWebhookToN8n(body, signature).catch((e) => console.warn('[whatsappWebhook] n8n', e?.message || e));
            }
            res.status(200).send('EVENT_RECEIVED');
        } catch (e) {
            console.error('[whatsappWebhook] persist error', e);
            if (!res.headersSent) res.status(200).send('EVENT_RECEIVED');
        }
    }
);

async function forwardWebhookToN8n(body, signature) {
    const url = (waN8nWebhookUrl.value() || '').trim();
    if (!url) {
        console.warn('[whatsappWebhook] n8n URL vacía, no se reenvía');
        return;
    }
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (signature) headers['X-Hub-Signature-256'] = signature;
        const resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body || {})
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            console.warn('[whatsappWebhook] Error reenviando a n8n', resp.status, txt.slice(0, 200));
            return;
        }
        console.log('[whatsappWebhook] Reenviado a n8n, status:', resp.status);
    } catch (e) {
        console.warn('[whatsappWebhook] Error reenviando a n8n', e?.message || e);
    }
}

/**
 * Envío de texto con Cloud API (staff / admin vía callable).
 * Requiere WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID configurados.
 */
exports.sendWhatsAppCloudText = onCall(
    {
        region: 'us-central1'
    },
    async (request) => {
        if (!request.auth?.uid) {
            throw new HttpsError('unauthenticated', 'Inicia sesión.');
        }

        const firestore = db();
        const uid = request.auth.uid;
        const userSnap = await firestore.doc(`artifacts/${APP_ID}/public/data/users/${uid}`).get();
        const role = userSnap.exists ? (userSnap.data()?.role || '') : '';
        const email = (request.auth.token?.email || '').toLowerCase();
        const isStaff = role === 'admin' || role === 'supervisor' || email === 'josuesoza0513@gmail.com';
        if (!isStaff) {
            throw new HttpsError('permission-denied', 'Solo staff puede enviar por Cloud API.');
        }

        const token = (waAccessToken.value() || '').trim();
        const phoneNumberId = (waPhoneNumberId.value() || '').trim();
        if (!token || !phoneNumberId) {
            throw new HttpsError(
                'failed-precondition',
                'Falta configurar WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID en Functions.'
            );
        }

        const toRaw = String(request.data?.to || '').replace(/\D/g, '');
        const text = String(request.data?.text || '').trim();
        if (!toRaw || toRaw.length < 8) {
            throw new HttpsError('invalid-argument', 'Número destino inválido (usa código país, ej. 504XXXXXXXX).');
        }
        if (!text) {
            throw new HttpsError('invalid-argument', 'Mensaje vacío.');
        }

        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: toRaw,
                type: 'text',
                text: { preview_url: false, body: text.slice(0, 4000) }
            })
        });

        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            console.error('[sendWhatsAppCloudText]', resp.status, json);
            throw new HttpsError(
                'internal',
                json?.error?.message || `Error Meta HTTP ${resp.status}`
            );
        }

        await firestore.collection(`artifacts/${APP_ID}/public/data/whatsapp_cloud_outbox`).add({
            sentAt: FieldValue.serverTimestamp(),
            to: toRaw,
            text: text.slice(0, 500),
            by: uid,
            metaResponse: json
        });

        return { ok: true, result: json };
    }
);

/**
 * Prueba de plantilla (staff).
 * data: { to: '504XXXXXXXX', name?: 'María', route?: 'Centro → Mercado', template?: 'trip_request_received' }
 */
exports.testWhatsAppTripTemplate = onCall(
    {
        region: 'us-central1'
    },
    async (request) => {
        if (!request.auth?.uid) {
            throw new HttpsError('unauthenticated', 'Inicia sesión.');
        }
        const firestore = db();
        const uid = request.auth.uid;
        const userSnap = await firestore.doc(`artifacts/${APP_ID}/public/data/users/${uid}`).get();
        const role = userSnap.exists ? (userSnap.data()?.role || '') : '';
        const email = (request.auth.token?.email || '').toLowerCase();
        const isStaff = role === 'admin' || role === 'supervisor' || email === 'josuesoza0513@gmail.com';
        if (!isStaff) {
            throw new HttpsError('permission-denied', 'Solo staff puede probar plantillas.');
        }

        const token = (waAccessToken.value() || '').trim();
        const phoneNumberId = (waPhoneNumberId.value() || '').trim();
        if (!token || !phoneNumberId) {
            throw new HttpsError(
                'failed-precondition',
                'Configura WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID en functions/.env y redespliega.'
            );
        }

        const to = String(request.data?.to || '').trim();
        const kind = String(request.data?.kind || 'received').trim();
        const name = String(request.data?.name || 'Cliente').trim().slice(0, 40);
        const dest = String(request.data?.dest || request.data?.route || 'Centro').trim().slice(0, 80);
        const dist = String(request.data?.dist || '3.8 km').trim().slice(0, 20);
        const driver = String(request.data?.driver || 'Carlos').trim().slice(0, 40);
        const vehicle = String(request.data?.vehicle || 'Toyota Corolla blanco').trim().slice(0, 60);
        const plate = String(request.data?.plate || 'T-1234').trim().slice(0, 20);
        const mins = String(request.data?.mins || '8').trim().slice(0, 8);
        const driverPhone = String(request.data?.driverPhone || '50495733866').trim().slice(0, 20);

        let template = String(request.data?.template || '').trim();
        let params = [];
        if (kind === 'confirmed' || template === 'viaje_confirmado') {
            template = template || (waTemplateTripConfirmed.value() || 'viaje_confirmado');
            params = [driver, vehicle, plate, mins];
        } else if (kind === 'arrived' || template === 'conductor_llego') {
            template = template || (waTemplateDriverArrived.value() || 'conductor_llego');
            params = [driver, plate, driverPhone];
        } else if (kind === 'driver' || kind === 'nuevo_viaje' || template === 'nuevo_viaje') {
            template = template || (waTemplateDriverNewTrip.value() || 'nuevo_viaje');
            const origin = String(request.data?.origin || 'Centro').trim().slice(0, 80);
            params = [origin, dest, dist];
        } else {
            template = template || (waTemplateTripReceived.value() || 'tu_viaje_esta_confirmado');
            const route = String(request.data?.route || `Origen → ${dest}`).trim().slice(0, 90);
            params = [name, route];
        }

        const result = await sendWhatsAppTemplate(to, template, params);
        if (result.skipped) {
            throw new HttpsError('failed-precondition', result.reason || 'No se pudo enviar');
        }
        if (!result.ok) {
            const msg = result.error?.error?.message
                || result.error?.message
                || `Error Meta ${result.status || ''}`.trim();
            throw new HttpsError('internal', msg);
        }
        return { ok: true, template, to: normalizeWaPhone(to), result: result.result };
    }
);
