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

/** Mismo valor que pegas en Meta → Token de verificación */
const waVerifyToken = defineString('WHATSAPP_VERIFY_TOKEN', {
    default: 'honduraite_wa_verify_2026_secure',
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

const waTemplateTripCompleted = defineString('WHATSAPP_TEMPLATE_TRIP_COMPLETED', {
    default: 'viaje_finalizado',
    description: 'Plantilla: viaje cobrado. {{1}} monto {{2}} destino'
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

function amountLabel(trip) {
    if (trip?.birthdayFree || trip?.paymentMethod === 'birthday_gift') return '0.00';
    const n = Number(trip?.priceNum);
    if (Number.isFinite(n)) return n.toFixed(2);
    const raw = String(trip?.price || '').replace(/[^\d.,]/g, '').replace(',', '.');
    const p = Number(raw);
    return Number.isFinite(p) ? p.toFixed(2) : '0.00';
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
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        console.error('[whatsapp graph]', resp.status, json);
        return { ok: false, status: resp.status, error: json };
    }
    return { ok: true, result: json };
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
 * 4) viaje_finalizado — {{1}} monto {{2}} destino
 * El cuerpo de Meta ya incluye “L. {{1}}”.
 */
async function notifyTripCompletedWa(trip, tripId = null) {
    if (!canNotifyPassengerWa(trip)) {
        return { ok: false, skipped: true, reason: 'no_trip_or_phone' };
    }
    if (trip.waTripCompletedOk) return { ok: true, skipped: true, reason: 'already' };
    const template = (waTemplateTripCompleted.value() || 'viaje_finalizado').trim();
    const result = await sendWhatsAppTemplate(tripPhone(trip), template, [
        amountLabel(trip),
        destLabel(trip)
    ]);
    if (result.ok) {
        await markTripWa(tripId, {
            waTripCompletedAt: FieldValue.serverTimestamp(),
            waTripCompletedOk: true
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

exports.sendWhatsAppTemplate = sendWhatsAppTemplate;
exports.notifyTripRequestReceivedWa = notifyTripRequestReceivedWa;
exports.notifyTripConfirmedWa = notifyTripConfirmedWa;
exports.notifyDriverArrivedWa = notifyDriverArrivedWa;
exports.notifyTripCompletedWa = notifyTripCompletedWa;
exports.notifyDriverNewTripWa = notifyDriverNewTripWa;
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
    const base = `artifacts/${APP_ID}/public/data`;
    const now = FieldValue.serverTimestamp();

    await firestore.collection(`${base}/whatsapp_cloud_events`).add({
        receivedAt: now,
        object: body?.object || null,
        raw: body || null
    });

    const entries = body?.entry || [];
    for (const entry of entries) {
        const changes = entry?.changes || [];
        for (const change of changes) {
            const value = change?.value || {};
            const messages = value.messages || [];
            const contacts = value.contacts || [];
            const contactByWaId = new Map(
                contacts.map((c) => [c.wa_id, c.profile?.name || null])
            );

            for (const msg of messages) {
                const from = msg.from || null;
                await firestore.collection(`${base}/whatsapp_cloud_inbox`).add({
                    receivedAt: now,
                    from,
                    contactName: from ? (contactByWaId.get(from) || null) : null,
                    type: msg.type || null,
                    messageId: msg.id || null,
                    timestamp: msg.timestamp || null,
                    text: msg.text?.body || null,
                    payload: msg,
                    phoneNumberId: value.metadata?.phone_number_id || null,
                    displayPhone: value.metadata?.display_phone_number || null,
                    handled: false
                });
            }

            const statuses = value.statuses || [];
            for (const st of statuses) {
                await firestore.collection(`${base}/whatsapp_cloud_events`).add({
                    receivedAt: now,
                    kind: 'status',
                    status: st.status || null,
                    messageId: st.id || null,
                    recipientId: st.recipient_id || null,
                    timestamp: st.timestamp || null,
                    payload: st
                });
            }
        }
    }
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
        // rawBody necesario para validar firma HMAC
        // (Firebase ya expone req.rawBody en Functions)
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

        // Responder YA a Meta (timeout corto); procesar en background
        res.status(200).send('EVENT_RECEIVED');

        try {
            const body = typeof req.body === 'object' && req.body
                ? req.body
                : JSON.parse(String(rawBody));
            await persistWebhookPayload(body);
        } catch (e) {
            console.error('[whatsappWebhook] persist error', e);
        }
    }
);

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
        const amount = String(request.data?.amount || '185.00').trim().slice(0, 16);
        const driverPhone = String(request.data?.driverPhone || '50495733866').trim().slice(0, 20);

        let template = String(request.data?.template || '').trim();
        let params = [];
        if (kind === 'confirmed' || template === 'viaje_confirmado') {
            template = template || (waTemplateTripConfirmed.value() || 'viaje_confirmado');
            params = [driver, vehicle, plate, mins];
        } else if (kind === 'arrived' || template === 'conductor_llego') {
            template = template || (waTemplateDriverArrived.value() || 'conductor_llego');
            params = [driver, plate, driverPhone];
        } else if (kind === 'completed' || template === 'viaje_finalizado') {
            template = template || (waTemplateTripCompleted.value() || 'viaje_finalizado');
            params = [amount, dest];
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
