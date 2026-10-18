/**
 * Disponibilidad de servicios por ciudad (Panel Viajes › Disponibilidad) y bloqueo en WhatsApp.
 * La lógica pura vive en service-availability-core.js (generado desde js/service-availability.js).
 *
 * - staffSetServiceAvailability: supervisor/admin cambia el modo de un servicio en una ciudad
 *   (auto · siempre abierto · cerrado) y el mensaje opcional. Se guarda en appSettings/main.
 * - helpers.checkServiceAvailable: ¿se puede pedir ahora? (lo usa el bot de WhatsApp antes de crear el viaje).
 */
'use strict';

const core = require('./service-availability-core');
const HN_CITIES = require('./hn-city-centers');

function cityCenter(zoneId) {
    const c = HN_CITIES.find((x) => x.id === zoneId);
    return c ? { lat: c.lat, lng: c.lng, name: c.name } : null;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} appId
 * @param {{ serviceType: string, zoneId?: string|null, zoneName?: string, center?: {lat:number,lng:number}|null, scheduled?: boolean }} q
 */
async function checkServiceAvailable(db, appId, { serviceType, zoneId = null, zoneName = '', center = null, scheduled = false } = {}) {
    const svc = core.availServiceKey(serviceType);
    if (!svc) return { available: true, reason: null };
    const s = await db.doc(`artifacts/${appId}/public/data/appSettings/main`).get().catch(() => null);
    const data = s && s.exists ? (s.data() || {}) : {};
    const config = core.normalizeAvailabilityConfig(data.serviceAvailability || {});
    const legacyByCity = data.disabledServicesByCity || null;
    const mode = core.getServiceMode(config, zoneId, svc, legacyByCity);
    let counts = null;
    if (mode === 'auto' && !scheduled) {
        const locSnap = await db.collection(`artifacts/${appId}/public/data/drivers_location`).get().catch(() => null);
        if (locSnap) {
            counts = core.countOnlineByVehicle(locSnap.docs.map((x) => x.data() || {}), {
                zoneId, center: center || (zoneId ? cityCenter(zoneId) : null), now: Date.now(),
            });
        }
    }
    const r = core.resolveServiceAvailability({ config, legacyByCity, zoneId, svc, counts, scheduled });
    const name = zoneName || (zoneId ? (cityCenter(zoneId)?.name || '') : '');
    return {
        ...r,
        message: r.available ? '' : core.unavailableMessage(svc, name, r.reason, core.getServiceCustomMessage(config, zoneId, svc)),
    };
}


module.exports = function createServiceAvailability(deps) {
    const { db, FieldValue, HttpsError, onCall, APP_ID, assertCallerCanModerate } = deps;
    const settingsRef = (appId) => db.doc(`artifacts/${appId}/public/data/appSettings/main`);

    const staffSetServiceAvailability = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const d = request.data || {};
        const zoneId = String(d.zoneId || '').trim();
        const svc = core.availServiceKey(d.service);
        const mode = core.AVAIL_MODES.includes(d.mode) ? d.mode : null;
        if (!zoneId || (zoneId !== '_all' && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(zoneId))) {
            throw new HttpsError('invalid-argument', 'Ciudad inválida.');
        }
        if (!svc) throw new HttpsError('invalid-argument', 'Servicio inválido.');
        if (!mode) throw new HttpsError('invalid-argument', 'Modo inválido (auto, on u off).');
        const message = String(d.message == null ? '' : d.message).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
            .slice(0, core.AVAIL_MESSAGE_MAX);

        const ref = settingsRef(APP_ID);
        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? (snap.data() || {}) : {};
            const cfg = core.normalizeAvailabilityConfig(data.serviceAvailability || {});
            const zone = { ...(cfg[zoneId] || {}) };
            zone[svc] = message ? { mode, message } : { mode };
            cfg[zoneId] = zone;
            const patch = {
                serviceAvailability: cfg,
                serviceAvailabilityUpdatedAtMs: Date.now(),
                serviceAvailabilityUpdatedBy: caller.uid,
            };
            // El apagado viejo (admin, por categoría) ganaría sobre «abierto»: si se abre, se limpia aquí.
            const legacy = data.disabledServicesByCity && typeof data.disabledServicesByCity === 'object'
                ? JSON.parse(JSON.stringify(data.disabledServicesByCity)) : null;
            if (legacy && zoneId !== '_all' && legacy[zoneId] && mode !== 'off') {
                const cat = svc === 'flete_paila' || svc === 'flete_camion' ? 'fletes' : svc;
                if (legacy[zoneId][cat]) {
                    delete legacy[zoneId][cat];
                    if (cat === 'fletes') {
                        // el otro flete queda cerrado a mano para no abrirlo sin querer
                        const other = svc === 'flete_paila' ? 'flete_camion' : 'flete_paila';
                        if (!zone[other]) zone[other] = { mode: 'off' };
                    }
                    if (!Object.keys(legacy[zoneId]).length) delete legacy[zoneId];
                    patch.disabledServicesByCity = legacy;
                }
            }
            tx.set(ref, patch, { merge: true });
            return { cfg };
        });
        await db.collection(`artifacts/${APP_ID}/public/data/service_availability_history`).add({
            zoneId, service: svc, mode, message: message || null,
            byUid: caller.uid, atMs: Date.now(), at: FieldValue.serverTimestamp(),
        }).catch(() => {});
        return { ok: true, zoneId, service: svc, mode, message: message || null, config: result.cfg };
    });

    return {
        exports: { staffSetServiceAvailability },
        helpers: { checkServiceAvailable: (appId, q) => checkServiceAvailable(db, appId, q), cityCenter },
    };
};

module.exports.checkServiceAvailable = checkServiceAvailable;
module.exports.cityCenter = cityCenter;
