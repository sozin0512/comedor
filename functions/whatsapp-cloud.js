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
    default: 'trip_request_received',
    description: 'Plantilla: solicitud de viaje recibida'
});

const waTemplateLang = defineString('WHATSAPP_TEMPLATE_LANG', {
    default: 'es',
    description: 'Idioma de plantillas WhatsApp (es o es_HN)'
});

function db() {
    return getFirestore();
}

/** Normaliza a E.164 sin + (ej. 50498765432) */
function normalizeWaPhone(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return null;
    // Honduras local 8 dígitos → 504
    if (d.length === 8) d = `504${d}`;
    // 9 dígitos empezando en 0 raro
    if (d.length === 9 && d.startsWith('0')) d = `504${d.slice(1)}`;
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

/**
 * Aviso al pasajero: “ya recibimos tu solicitud, un conductor la tomará en un momento”.
 * Plantilla Meta: trip_request_received (ver whatsapp-bot/TEMPLATES-META.md)
 */
async function notifyTripRequestReceivedWa(trip, tripId = null) {
    if (!trip || trip.isDemandSimulation) return { ok: false, skipped: true, reason: 'no_trip' };
    // Solo cuando el cliente ya “pidió” de verdad (no staff esperando claim)
    if (trip.staffCreatedBy && trip.staffCreatedClientClaimed !== true) {
        return { ok: false, skipped: true, reason: 'staff_waiting_claim' };
    }
    const phone = trip.clientPhone || trip.phone || null;
    if (!phone) return { ok: false, skipped: true, reason: 'no_phone' };

    const name = firstNameFrom(trip.clientName);
    const route = shortRouteLabel(trip);
    const template = (waTemplateTripReceived.value() || 'trip_request_received').trim();

    const result = await sendWhatsAppTemplate(phone, template, [name, route]);
    if (result.ok && tripId) {
        try {
            await db().doc(`artifacts/${APP_ID}/public/data/trips/${tripId}`).update({
                waTripRequestReceivedAt: FieldValue.serverTimestamp(),
                waTripRequestReceivedOk: true
            }).catch(() => {});
        } catch (_) {}
    }
    return result;
}

exports.sendWhatsAppTemplate = sendWhatsAppTemplate;
exports.notifyTripRequestReceivedWa = notifyTripRequestReceivedWa;
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
        const name = String(request.data?.name || 'Cliente').trim().slice(0, 40);
        const route = String(request.data?.route || 'Origen → Destino').trim().slice(0, 90);
        const template = String(
            request.data?.template
            || waTemplateTripReceived.value()
            || 'trip_request_received'
        ).trim();

        const result = await sendWhatsAppTemplate(to, template, [name, route]);
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
