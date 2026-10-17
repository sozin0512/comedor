/**
 * Panel de supervisor «Viajes» (propuesta de Jack, oct 2026).
 *
 * Todo lo que toca datos sensibles pasa por aquí (Admin SDK) y no por reglas de
 * Firestore: el rol del perfil público lo puede escribir el mismo usuario, así
 * que las reglas no sirven para decidir quién es staff (bug getRole/isStaff).
 *
 * - staffTripsAction: mover a papelera / restaurar / borrar para siempre (BORRAR) / marcar revisado
 * - staffResendTrip: reenviar una solicitud a más conductores (radio más grande)
 * - staffSendTestPush + ackPushReceived: prueba de avisos y confirmación del celular
 * - staffRevealTripPin: mostrar el PIN queda registrado
 * - staffSetTestAccount: marcar cuenta de prueba / empresa (sale de totales)
 * - adminSetTripsPanelConfig: comisión por servicio y segundos del reenvío automático
 * - purgeTrashedTrips: borra lo que lleva 30 días en papelera
 * - runAutoResend: reenvío automático si nadie ofertó en N segundos (10 por defecto)
 */
'use strict';

const SERVICE_KEYS = ['moto', 'auto', 'taxi', 'delivery', 'flete', 'grua', 'hourly'];
const DEFAULT_AUTO_RESEND_SECONDS = 10;
const MIN_AUTO_RESEND_SECONDS = 5;
const MAX_AUTO_RESEND_SECONDS = 100;
const TRASH_KEEP_DAYS = 30;
const TRASH_KEEP_MS = TRASH_KEEP_DAYS * 24 * 60 * 60 * 1000;
const MAX_BATCH_TRIPS = 100;
const ACK_TYPES = new Set(['trip_offer', 'ride_demand_alert', 'freight_trip_alert', 'trip_price_boost', 'push_test']);
const ACK_VIA = new Set(['foreground', 'background', 'tap', 'sw', 'android', 'web', 'queued']);

function clampAutoResendSeconds(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return DEFAULT_AUTO_RESEND_SECONDS;
    return Math.min(MAX_AUTO_RESEND_SECONDS, Math.max(MIN_AUTO_RESEND_SECONDS, n));
}

/** { moto: 10, hourly: 25, ... } — solo claves conocidas y 0..100; vacío/null = usa el % general. */
function sanitizeCommissionByService(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const key of SERVICE_KEYS) {
        const v = raw[key];
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) continue;
        out[key] = Math.round(n * 100) / 100;
    }
    return out;
}

function tripCreatedMs(trip) {
    const c = trip?.createdAt;
    if (c && typeof c.toMillis === 'function') return c.toMillis();
    if (c && typeof c.seconds === 'number') return c.seconds * 1000;
    if (typeof c === 'number') return c;
    if (typeof trip?.createdAtMs === 'number') return trip.createdAtMs;
    return 0;
}

function hasBids(trip) {
    return !!(trip?.driverBids && typeof trip.driverBids === 'object' && Object.keys(trip.driverBids).length);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

module.exports = function createViajesPanel(deps) {
    const {
        db, FieldValue, HttpsError, onCall, onSchedule, APP_ID,
        sendPushToUser, assertCallerCanModerate, assertCallerIsSupremeAdmin,
        notifyEligibleDriversNewTrip, describeTokenDevice, getUserPushMeta
    } = deps;

    const configRef = (appId) => db.doc(`artifacts/${appId}/public/data/platformConfig/main`);
    const tripRef = (appId, id) => db.doc(`artifacts/${appId}/public/data/trips/${id}`);
    const pubUserRef = (appId, uid) => db.doc(`artifacts/${appId}/public/data/users/${uid}`);
    const privUserRef = (appId, uid) => db.doc(`artifacts/${appId}/users/${uid}/profile/data`);

    async function getTripsPanelConfig(appId = APP_ID) {
        let d = {};
        try {
            const snap = await configRef(appId).get();
            d = snap.exists ? (snap.data() || {}) : {};
        } catch (_) {}
        const global = Number(d.commissionPercentage);
        return {
            autoResendSeconds: d.autoResendSeconds == null
                ? DEFAULT_AUTO_RESEND_SECONDS
                : clampAutoResendSeconds(d.autoResendSeconds),
            commissionByService: sanitizeCommissionByService(d.commissionByService),
            commissionPercentage: Number.isFinite(global) ? global : null
        };
    }

    async function callerName(appId, uid) {
        try {
            const s = await pubUserRef(appId, uid).get();
            const n = s.exists ? (s.data()?.name || '') : '';
            return String(n || 'Staff').slice(0, 60);
        } catch (_) {
            return 'Staff';
        }
    }

    function cleanTripIds(raw) {
        const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const ids = [...new Set(list.map((x) => String(x || '').trim()).filter((x) => x && x.length <= 128 && !x.includes('/')))];
        if (!ids.length) throw new HttpsError('invalid-argument', 'Falta el viaje.');
        if (ids.length > MAX_BATCH_TRIPS) throw new HttpsError('invalid-argument', `Máximo ${MAX_BATCH_TRIPS} viajes a la vez.`);
        return ids;
    }

    // ───────────────────── Papelera / revisado ─────────────────────
    const staffTripsAction = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const action = String(request.data?.action || '');
        if (!['trash', 'restore', 'purge', 'review', 'unreview'].includes(action)) {
            throw new HttpsError('invalid-argument', 'Acción no válida.');
        }
        const ids = cleanTripIds(request.data?.tripIds || request.data?.tripId);
        if (action === 'purge' && String(request.data?.confirm || '') !== 'BORRAR') {
            throw new HttpsError('failed-precondition', 'Para borrar para siempre escribe BORRAR.');
        }
        const name = await callerName(APP_ID, caller.uid);
        const now = Date.now();
        const results = [];
        for (const id of ids) {
            const ref = tripRef(APP_ID, id);
            const snap = await ref.get();
            if (!snap.exists) {
                results.push({ id, ok: false, reason: 'not-found' });
                continue;
            }
            const t = snap.data() || {};
            if (action === 'trash') {
                if (t.trashedAtMs) { results.push({ id, ok: true, already: true }); continue; }
                await ref.update({
                    trashedAtMs: now,
                    trashedBy: caller.uid,
                    trashedByName: name,
                    trashPurgeAfterMs: now + TRASH_KEEP_MS,
                    trashStatusAtMove: t.status || null
                });
            } else if (action === 'restore') {
                await ref.update({
                    trashedAtMs: FieldValue.delete(),
                    trashedBy: FieldValue.delete(),
                    trashedByName: FieldValue.delete(),
                    trashPurgeAfterMs: FieldValue.delete(),
                    trashStatusAtMove: FieldValue.delete(),
                    restoredAtMs: now,
                    restoredBy: caller.uid,
                    restoredByName: name
                });
            } else if (action === 'purge') {
                // Solo desde la papelera: un toque nunca borra un viaje vivo.
                if (!t.trashedAtMs) { results.push({ id, ok: false, reason: 'not-in-trash' }); continue; }
                await db.collection(`artifacts/${APP_ID}/public/data/trip_purge_log`).add({
                    tripId: id,
                    status: t.status || null,
                    createdAtMs: tripCreatedMs(t) || null,
                    trashedAtMs: t.trashedAtMs,
                    purgedAtMs: now,
                    purgedBy: caller.uid,
                    purgedByName: name,
                    auto: false
                }).catch(() => {});
                await ref.delete();
            } else if (action === 'review') {
                await ref.update({ staffReviewedAtMs: now, staffReviewedBy: caller.uid, staffReviewedByName: name });
            } else if (action === 'unreview') {
                await ref.update({
                    staffReviewedAtMs: FieldValue.delete(),
                    staffReviewedBy: FieldValue.delete(),
                    staffReviewedByName: FieldValue.delete()
                });
            }
            results.push({ id, ok: true });
        }
        return { ok: true, action, done: results.filter((r) => r.ok).length, results };
    });

    // ───────────────────── Reenviar a más conductores ─────────────────────
    async function resendTrip(appId, tripId, { reason = 'staff', byUid = null, byName = null } = {}) {
        const ref = tripRef(appId, tripId);
        const snap = await ref.get();
        if (!snap.exists) return { ok: false, reason: 'not-found' };
        const trip = snap.data() || {};
        if (trip.status !== 'pending' || trip.driverId) return { ok: false, reason: 'not-pending' };
        if (trip.isDemandSimulation) return { ok: false, reason: 'simulation' };
        if (trip.staffCreatedBy && trip.staffCreatedClientClaimed !== true) return { ok: false, reason: 'waiting-client' };
        const stats = await notifyEligibleDriversNewTrip(appId, tripId, trip, { resend: true, resendReason: reason });
        const patch = {
            resendCount: FieldValue.increment(1),
            lastResendAtMs: Date.now(),
            lastResendReason: reason
        };
        if (byUid) { patch.lastResendBy = byUid; patch.lastResendByName = byName || 'Staff'; }
        if (reason === 'auto') patch.autoResendAtMs = Date.now();
        await ref.update(patch).catch(() => {});
        return { ok: true, ...(stats || {}) };
    }

    const staffResendTrip = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const [tripId] = cleanTripIds(request.data?.tripId);
        const name = await callerName(APP_ID, caller.uid);
        const r = await resendTrip(APP_ID, tripId, { reason: 'staff', byUid: caller.uid, byName: name });
        if (!r.ok && r.reason === 'not-pending') {
            throw new HttpsError('failed-precondition', 'El viaje ya no está buscando conductor.');
        }
        if (!r.ok && r.reason === 'not-found') throw new HttpsError('not-found', 'El viaje ya no existe.');
        if (!r.ok) throw new HttpsError('failed-precondition', 'No se puede reenviar este viaje.');
        return r;
    });

    /** Llamado desde onTripCreatedAssignOffer: espera N s y, si nadie ofertó, reenvía más amplio. */
    async function runAutoResend(appId, tripId, trip) {
        const cfg = await getTripsPanelConfig(appId);
        const sec = cfg.autoResendSeconds;
        const created = tripCreatedMs(trip) || Date.now();
        const waitMs = Math.min(MAX_AUTO_RESEND_SECONDS * 1000, Math.max(0, created + sec * 1000 - Date.now()));
        if (waitMs) await sleep(waitMs);
        const ref = tripRef(appId, tripId);
        const claimed = await db.runTransaction(async (tx) => {
            const s = await tx.get(ref);
            if (!s.exists) return false;
            const t = s.data() || {};
            if (t.status !== 'pending' || t.driverId || hasBids(t) || t.autoResendAtMs || t.trashedAtMs) return false;
            // Programado para más tarde: no hay apuro, no reenviar.
            const sch = t.scheduledFor;
            const schMs = sch && typeof sch.toMillis === 'function' ? sch.toMillis() : (typeof sch === 'number' ? sch : (sch ? Date.parse(sch) : 0));
            if (schMs && schMs > Date.now() + 15 * 60 * 1000) return false;
            tx.update(ref, { autoResendAtMs: Date.now(), autoResendAfterSeconds: sec });
            return true;
        }).catch(() => false);
        if (!claimed) return { ok: false };
        return resendTrip(appId, tripId, { reason: 'auto' });
    }

    // ───────────────────── Prueba de avisos ─────────────────────
    const staffSendTestPush = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const driverUid = String(request.data?.driverUid || '').trim();
        if (!driverUid || driverUid.includes('/')) throw new HttpsError('invalid-argument', 'Elige un conductor.');
        const token = String(request.data?.token || '').trim().slice(0, 4096);
        const name = await callerName(APP_ID, caller.uid);
        const testId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        const meta = await getUserPushMeta(APP_ID, driverUid).catch(() => ({ records: [] }));
        const result = await sendPushToUser(APP_ID, driverUid, {
            title: 'HonduRaite · Prueba de soporte',
            body: 'Soporte está probando tus avisos. Si ves esto, te llegan los viajes.',
            data: {
                type: 'push_test',
                testId,
                tag: `push-test-${testId}`,
                openDriver: 'true',
                wake: '1'
            },
            highPriority: true,
            targetToken: token
        });
        const devices = (meta.records || [])
            .filter((r) => !token || r.token === token)
            .slice(0, 6)
            .map((r) => describeTokenDevice(r));
        const lastPushTest = {
            testId,
            sentAtMs: Date.now(),
            byUid: caller.uid,
            byName: name,
            sent: result.sent || 0,
            tokens: result.tokens || 0,
            codes: result.codes || {},
            invalid: result.invalid || 0,
            devices,
            confirmedAtMs: null,
            confirmedVia: null
        };
        await pubUserRef(APP_ID, driverUid).set({ lastPushTest }, { merge: true });
        return { ok: true, testId, sent: lastPushTest.sent, tokens: lastPushTest.tokens, codes: lastPushTest.codes, devices };
    });

    /** El celular del conductor confirma que el aviso llegó (llegó ≠ FCM aceptado). */
    const ackPushReceived = onCall(async (request) => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión.');
        const type = String(request.data?.type || '');
        if (type && !ACK_TYPES.has(type)) return { ok: false, reason: 'type' };
        const viaRaw = String(request.data?.via || 'foreground');
        const via = ACK_VIA.has(viaRaw) ? viaRaw : 'foreground';
        const now = Date.now();
        let atMs = Number(request.data?.atMs) || now;
        // Hora del celular: no aceptar futuro ni más de 15 min atrás.
        if (atMs > now || atMs < now - 15 * 60 * 1000) atMs = now;
        const out = { ok: true, trip: false, test: false };

        const testId = String(request.data?.testId || '').trim().slice(0, 40);
        if (testId) {
            const ref = pubUserRef(APP_ID, uid);
            await db.runTransaction(async (tx) => {
                const s = await tx.get(ref);
                const lt = s.exists ? (s.data()?.lastPushTest || null) : null;
                if (!lt || lt.testId !== testId || lt.confirmedAtMs) return;
                tx.update(ref, { 'lastPushTest.confirmedAtMs': atMs, 'lastPushTest.confirmedVia': via });
                out.test = true;
            }).catch(() => {});
        }

        const tripId = String(request.data?.tripId || '').trim();
        if (tripId && tripId.length <= 128 && !tripId.includes('/')) {
            const ref = tripRef(APP_ID, tripId);
            // El aviso puede llegar antes de que se guarde la lista de notificados:
            // en ese caso se acepta solo si quien confirma es conductor.
            let callerIsDriver = null;
            const isDriver = async () => {
                if (callerIsDriver === null) {
                    const u = await pubUserRef(APP_ID, uid).get().catch(() => null);
                    callerIsDriver = !!(u && u.exists && String(u.data()?.role || '') === 'driver');
                }
                return callerIsDriver;
            };
            await db.runTransaction(async (tx) => {
                const s = await tx.get(ref);
                if (!s.exists) return;
                const t = s.data() || {};
                if (t.deliveredTo && t.deliveredTo[uid]) return;
                const created = tripCreatedMs(t);
                if (created && now - created > 24 * 60 * 60 * 1000) return;
                const notified = (Array.isArray(t.alertNotifiedDriverIds) && t.alertNotifiedDriverIds.includes(uid))
                    || t.offeredToDriverId === uid
                    || (Array.isArray(t.candidateDriverIds) && t.candidateDriverIds.includes(uid));
                if (!notified && !(t.status === 'pending' && await isDriver())) return;
                tx.update(ref, { [`deliveredTo.${uid}`]: { atMs, via } });
                out.trip = true;
            }).catch(() => {});
        }
        return out;
    });

    // ───────────────────── PIN con registro ─────────────────────
    const staffRevealTripPin = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const [tripId] = cleanTripIds(request.data?.tripId);
        const ref = tripRef(APP_ID, tripId);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError('not-found', 'El viaje ya no existe.');
        const name = await callerName(APP_ID, caller.uid);
        await ref.update({
            pinRevealLog: FieldValue.arrayUnion({ byUid: caller.uid, byName: name, atMs: Date.now() })
        });
        return { ok: true, pin: snap.data()?.pin ? String(snap.data().pin) : null };
    });

    // ───────────────────── Cuentas de prueba / empresa ─────────────────────
    const staffSetTestAccount = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const uid = String(request.data?.uid || '').trim();
        if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'Falta la cuenta.');
        const on = request.data?.isTestAccount === true;
        const kindRaw = String(request.data?.kind || 'test');
        const kind = kindRaw === 'company' ? 'company' : 'test';
        const patch = {
            isTestAccount: on,
            testAccountKind: on ? kind : FieldValue.delete(),
            testAccountSetBy: caller.uid,
            testAccountSetAtMs: Date.now()
        };
        await Promise.all([
            pubUserRef(APP_ID, uid).set(patch, { merge: true }),
            privUserRef(APP_ID, uid).set(patch, { merge: true })
        ]);
        return { ok: true, uid, isTestAccount: on, kind: on ? kind : null };
    });

    // ───────────────────── Ajustes del panel (solo admin) ─────────────────────
    const adminSetTripsPanelConfig = onCall(async (request) => {
        const uid = await assertCallerIsSupremeAdmin(request.auth);
        const map = sanitizeCommissionByService(request.data?.commissionByService);
        const sec = clampAutoResendSeconds(request.data?.autoResendSeconds ?? DEFAULT_AUTO_RESEND_SECONDS);
        // mergeFields: reemplaza el mapa completo (quitar un servicio = vuelve al % general).
        const patch = {
            commissionByService: map,
            autoResendSeconds: sec,
            tripsPanelConfigUpdatedAtMs: Date.now(),
            tripsPanelConfigUpdatedBy: uid
        };
        const fields = ['commissionByService', 'autoResendSeconds', 'tripsPanelConfigUpdatedAtMs', 'tripsPanelConfigUpdatedBy'];
        // % general opcional (el mismo campo que ya usa la app: commissionPercentage)
        const rawGeneral = request.data?.commissionPercentage;
        if (rawGeneral != null && rawGeneral !== '') {
            const g = Number(rawGeneral);
            if (!Number.isFinite(g) || g < 0 || g > 100) {
                throw new HttpsError('invalid-argument', 'El % general debe estar entre 0 y 100.');
            }
            patch.commissionPercentage = Math.round(g * 100) / 100;
            fields.push('commissionPercentage');
        }
        await configRef(APP_ID).set(patch, { mergeFields: fields });
        return { ok: true, commissionByService: map, autoResendSeconds: sec, commissionPercentage: patch.commissionPercentage ?? null };
    });

    // ───────────────────── Purga automática (30 días) ─────────────────────
    async function purgeExpiredTrash(appId = APP_ID, nowMs = Date.now()) {
        const snap = await db.collection(`artifacts/${appId}/public/data/trips`)
            .where('trashPurgeAfterMs', '<=', nowMs)
            .limit(300)
            .get();
        let purged = 0;
        for (const d of snap.docs) {
            const t = d.data() || {};
            if (!t.trashedAtMs) continue;
            await db.collection(`artifacts/${appId}/public/data/trip_purge_log`).add({
                tripId: d.id,
                status: t.status || null,
                createdAtMs: tripCreatedMs(t) || null,
                trashedAtMs: t.trashedAtMs,
                purgedAtMs: nowMs,
                purgedBy: 'auto-30d',
                auto: true
            }).catch(() => {});
            await d.ref.delete().catch(() => {});
            purged += 1;
        }
        return { scanned: snap.size, purged };
    }

    const purgeTrashedTrips = onSchedule(
        { schedule: '40 3 * * *', timeZone: 'America/Tegucigalpa', timeoutSeconds: 300 },
        async () => {
            const r = await purgeExpiredTrash(APP_ID);
            console.log(`[purgeTrashedTrips] scanned=${r.scanned} purged=${r.purged}`);
            return r;
        }
    );

    return {
        exports: {
            staffTripsAction,
            staffResendTrip,
            staffSendTestPush,
            ackPushReceived,
            staffRevealTripPin,
            staffSetTestAccount,
            adminSetTripsPanelConfig,
            purgeTrashedTrips
        },
        helpers: { getTripsPanelConfig, runAutoResend, resendTrip, purgeExpiredTrash, sanitizeCommissionByService, clampAutoResendSeconds }
    };
};
module.exports.SERVICE_KEYS = SERVICE_KEYS;
module.exports.DEFAULT_AUTO_RESEND_SECONDS = DEFAULT_AUTO_RESEND_SECONDS;
