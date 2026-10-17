/**
 * Panel Viajes · pestaña «Avisos»: qué conductores tienen los avisos de viaje activos
 * y botón «Pedir que activen» (WhatsApp con enlace al flujo de activación).
 *
 * - staffDriverPushStatus: lista por conductor (sin tokens), calculada en el servidor.
 * - staffNudgeDriverPush: WhatsApp a 1 o varios conductores, 1 vez cada 24 h por conductor,
 *   con registro de quién lo mandó.
 *
 * Datos solo-servidor (las reglas los niegan por defecto, ninguna regla los abre):
 *   artifacts/{app}/push_health/{uid}      último FCM aceptado / token inválido / confirmación / último pedido
 *   artifacts/{app}/push_nudge_log/{id}    bitácora de pedidos (quién, a quién, resultado)
 */

const DAY = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 14 * DAY;
const NUDGE_COOLDOWN_MS = DAY;
const NUDGE_CLAIM_LEASE_MS = 2 * 60 * 1000;
const WA_WINDOW_MS = DAY;
const MAX_NUDGE_BATCH = 150;
const ACTIVATE_LINK = 'https://honduraite.com/?activarAvisos=1#driver';

function tsToMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v === 'string') { const n = Date.parse(v); return Number.isFinite(n) ? n : 0; }
    if (v instanceof Date) return v.getTime();
    return 0;
}

function deviceKind(platform) {
    const p = String(platform || '').toLowerCase();
    if (p === 'android') return 'android';
    if (p === 'ios-pwa' || p === 'ios') return 'ios-pwa';
    if (p === 'web') return 'web';
    return p ? 'web' : 'unknown';
}

function firstName(full) {
    const s = String(full || '').trim().split(/\s+/)[0] || '';
    return s.slice(0, 30);
}

function pickPhone(...docs) {
    for (const u of docs) {
        if (!u) continue;
        const p = u.phone || u.driverPhone || u.whatsapp || u.waPhone || u.whatsappPhone;
        if (p) return String(p);
    }
    return '';
}

/**
 * Clasifica un conductor. Pura (se prueba sin Firestore).
 * @returns {{status:'active'|'expired'|'never', reason:string, ...}}
 */
function classifyDriverPush({
    now = Date.now(), liveRecords = [], allEntries = [], tokenUpdatedAtMs = 0,
    health = {}, lastPushTest = null, lastTripAckMs = 0
}) {
    const live = [...liveRecords].sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    const all = [...allEntries].sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    const lastTokenAtMs = Math.max(
        0,
        ...all.map((e) => Number(e.updatedAt) || 0),
        Number(tokenUpdatedAtMs) || 0,
        Number(health.lastTokenAtMs) || 0
    );
    const lastConfirmedAtMs = Math.max(
        0,
        Number(health.lastAckAtMs) || 0,
        Number(lastPushTest?.confirmedAtMs) || 0,
        Number(lastTripAckMs) || 0
    );
    const lastFcmOkAtMs = Number(health.lastFcmOkAtMs) || 0;
    const lastInvalidAtMs = Number(health.lastInvalidAtMs) || 0;
    const newestLive = live[0] || null;
    const device = deviceKind((newestLive || all[0] || {}).platform);
    const base = {
        device,
        liveTokens: live.length,
        lastTokenAtMs: lastTokenAtMs || null,
        lastConfirmedAtMs: lastConfirmedAtMs || null,
        lastFcmOkAtMs: lastFcmOkAtMs || null
    };
    const recent = (ms) => ms > 0 && now - ms <= ACTIVE_WINDOW_MS;
    if (live.length) {
        if (recent(lastConfirmedAtMs)) return { ...base, status: 'active', reason: 'confirmado' };
        if (recent(lastFcmOkAtMs) && !(lastInvalidAtMs > lastFcmOkAtMs && live.length <= 1)) {
            return { ...base, status: 'active', reason: 'fcm_ok' };
        }
        if (recent(Number(newestLive.updatedAt) || 0)) return { ...base, status: 'active', reason: 'token_reciente' };
        return { ...base, status: 'expired', reason: 'sin_actividad' };
    }
    const everHad = all.length > 0 || lastTokenAtMs > 0 || lastFcmOkAtMs > 0 || lastInvalidAtMs > 0 || !!lastPushTest;
    if (everHad) {
        return { ...base, status: 'expired', reason: lastInvalidAtMs ? 'token_invalido' : 'token_vencido' };
    }
    return { ...base, status: 'never', reason: 'nunca' };
}

/** ¿Se puede pedir de nuevo? (1 vez cada 24 h por conductor) */
function nudgeCooldown(health = {}, now = Date.now()) {
    const last = Number(health.lastNudgeAttemptAtMs) || 0;
    if (last && now - last < NUDGE_COOLDOWN_MS) {
        return { blocked: true, nextAllowedAtMs: last + NUDGE_COOLDOWN_MS };
    }
    const claim = Number(health.nudgeClaimAtMs) || 0;
    if (claim && now - claim < NUDGE_CLAIM_LEASE_MS) return { blocked: true, nextAllowedAtMs: claim + NUDGE_CLAIM_LEASE_MS, inFlight: true };
    return { blocked: false, nextAllowedAtMs: null };
}

function nudgeText(name) {
    const n = firstName(name);
    return [
        `Hola${n ? ` ${n}` : ''} 👋, te escribimos de HonduRaite.`,
        'Los avisos de viaje no están activos en tu celular: por eso no te suenan los viajes nuevos cuando la app está cerrada.',
        `Actívalos aquí (1 minuto): ${ACTIVATE_LINK}`,
        'Si usas la app de Android: ábrela y toca la campana 🔔 «Activar avisos». En Samsung, quita HonduRaite de «Aplicaciones en suspensión» (Ajustes → Batería).',
        'Gracias 🙌'
    ].join('\n\n');
}

/** Error de Meta en el webhook → texto para el panel. */
function describeWaFailure(errors = []) {
    const codes = errors.map((e) => Number(e?.code) || 0);
    if (codes.includes(131047)) return { code: 'outside_window', text: 'No se pudo: fuera de la ventana de 24 h' };
    if (codes.includes(131026)) return { code: 'not_on_whatsapp', text: 'No se pudo: ese número no tiene WhatsApp' };
    if (codes.length) return { code: 'failed', text: `No se pudo (Meta ${codes.filter(Boolean).join(', ') || 'error'})` };
    return { code: 'failed', text: 'No se pudo enviar' };
}

module.exports = function createDriverPushStatus(deps) {
    const {
        db, HttpsError, onCall, APP_ID, assertCallerCanModerate,
        fcmTokenMapFromDoc, liveFcmTokenRecordsFromMaps, fcmTokenMapEntries, zoneName, wa
    } = deps;
    const healthRef = (appId, uid) => db.doc(`artifacts/${appId}/push_health/${uid}`);
    const logCol = (appId) => db.collection(`artifacts/${appId}/push_nudge_log`);
    const pubUsers = (appId) => db.collection(`artifacts/${appId}/public/data/users`);
    const privRef = (appId, uid) => db.doc(`artifacts/${appId}/users/${uid}/profile/data`);

    function getWa() {
        return typeof wa === 'function' ? wa() : wa;
    }

    async function callerName(appId, uid) {
        try {
            const s = await pubUsers(appId).doc(uid).get();
            return String((s.exists && s.data()?.name) || 'Staff').slice(0, 60);
        } catch (_) { return 'Staff'; }
    }

    /** Escritura liviana desde sendPushToUser / ackPushReceived (nunca rompe el envío). */
    async function recordPushHealth(appId, uid, patch) {
        if (!uid || !patch) return;
        try { await healthRef(appId, uid).set(patch, { merge: true }); } catch (_) {}
    }

    async function getAllDocs(refs) {
        const out = [];
        for (let i = 0; i < refs.length; i += 200) {
            const part = refs.slice(i, i + 200);
            if (!part.length) continue;
            const snaps = await db.getAll(...part);
            out.push(...snaps);
        }
        return out;
    }

    /** Última confirmación por conductor en viajes de los últimos 30 días (deliveredTo). */
    async function tripAcksByDriver(appId, now) {
        const since = now - 30 * DAY;
        const col = db.collection(`artifacts/${appId}/public/data/trips`);
        const best = new Map();
        const eat = (snap) => snap.forEach((d) => {
            const dt = d.data()?.deliveredTo;
            if (!dt || typeof dt !== 'object') return;
            for (const [uid, v] of Object.entries(dt)) {
                const at = Number(v?.atMs) || 0;
                if (at > (best.get(uid) || 0)) best.set(uid, at);
            }
        });
        await Promise.all([
            col.where('createdAt', '>=', new Date(since)).get().then(eat).catch(() => {}),
            col.where('createdAt', '>=', since).get().then(eat).catch(() => {})
        ]);
        return best;
    }

    async function computeStatus(appId, now = Date.now()) {
        const [usersSnap, locSnap, acks] = await Promise.all([
            pubUsers(appId).where('role', '==', 'driver').get(),
            db.collection(`artifacts/${appId}/public/data/drivers_location`).get().catch(() => ({ docs: [] })),
            tripAcksByDriver(appId, now)
        ]);
        const locs = new Map((locSnap.docs || []).map((d) => [d.id, d.data() || {}]));
        const docs = usersSnap.docs;
        const uids = docs.map((d) => d.id);
        const [privSnaps, healthSnaps] = await Promise.all([
            getAllDocs(uids.map((u) => privRef(appId, u))),
            getAllDocs(uids.map((u) => healthRef(appId, u)))
        ]);
        const privBy = new Map(privSnaps.map((s) => [s.id, s.exists ? (s.data() || {}) : {}]));
        const healthBy = new Map(healthSnaps.map((s) => [s.id, s.exists ? (s.data() || {}) : {}]));
        const pendingMsgIds = [];
        const drivers = docs.map((d) => {
            const pub = d.data() || {};
            const uid = d.id;
            const priv = privBy.get(uid) || {};
            const health = healthBy.get(uid) || {};
            const loc = locs.get(uid) || {};
            const pubMap = fcmTokenMapFromDoc(pub);
            const privMap = fcmTokenMapFromDoc(priv);
            const live = liveFcmTokenRecordsFromMaps([pubMap, privMap, pub.fcmToken, priv.fcmToken]);
            const all = [...fcmTokenMapEntries(pubMap), ...fcmTokenMapEntries(privMap)];
            const c = classifyDriverPush({
                now,
                liveRecords: live,
                allEntries: all,
                tokenUpdatedAtMs: Math.max(tsToMs(pub.fcmTokenUpdatedAt), tsToMs(priv.fcmTokenUpdatedAt)),
                health,
                lastPushTest: pub.lastPushTest || null,
                lastTripAckMs: acks.get(uid) || 0
            });
            const zone = pub.serviceZoneId || pub.cityId || loc.serviceZoneId || loc.cityId || '';
            const city = pub.cityName || pub.serviceZoneName || (zone ? (zoneName(zone) || zone) : '');
            const cd = nudgeCooldown(health, now);
            const ln = health.lastNudge || null;
            if (ln?.messageId && now - (Number(ln.atMs) || 0) < 3 * DAY) pendingMsgIds.push(ln.messageId);
            return {
                uid,
                name: String(pub.name || priv.name || 'Conductor').slice(0, 80),
                phone: pickPhone(pub, priv),
                city: String(city || '').slice(0, 60),
                isTest: pub.isTestAccount === true || pub.isTestDriver === true,
                approval: String(pub.approvalStatus || ''),
                ...c,
                lastNudge: ln ? {
                    atMs: Number(ln.atMs) || null,
                    byName: ln.byName || '',
                    result: ln.result || '',
                    via: ln.via || '',
                    text: ln.text || '',
                    messageId: ln.messageId || null
                } : null,
                nextNudgeAtMs: cd.blocked ? cd.nextAllowedAtMs : null
            };
        });
        // Fallos de entrega que Meta avisó después (webhook): p. ej. fuera de la ventana de 24 h.
        const w = getWa();
        if (pendingMsgIds.length && w?.deliveryStatusesFor) {
            const st = await w.deliveryStatusesFor(pendingMsgIds).catch(() => new Map());
            drivers.forEach((dr) => {
                const id = dr.lastNudge?.messageId;
                const list = id ? st.get(id) : null;
                if (!list?.length) return;
                const failed = list.find((x) => x.status === 'failed' || (x.errors || []).length);
                if (failed) {
                    const f = describeWaFailure(failed.errors);
                    dr.lastNudge.result = f.code;
                    dr.lastNudge.text = f.text;
                } else if (list.some((x) => x.status === 'read')) {
                    dr.lastNudge.delivery = 'read';
                } else if (list.some((x) => x.status === 'delivered')) {
                    dr.lastNudge.delivery = 'delivered';
                }
            });
        }
        drivers.forEach((dr) => { if (dr.lastNudge) delete dr.lastNudge.messageId; });
        const counts = { total: drivers.length, active: 0, expired: 0, never: 0 };
        drivers.forEach((dr) => { counts[dr.status] += 1; });
        return {
            generatedAtMs: now,
            counts,
            drivers,
            activeWindowDays: ACTIVE_WINDOW_MS / DAY,
            template: { name: getWa()?.driverPushActivateTemplateName?.() || '' },
            link: ACTIVATE_LINK
        };
    }

    const staffDriverPushStatus = onCall(async (request) => {
        await assertCallerCanModerate(request.auth);
        return computeStatus(APP_ID);
    });

    /** Reclama el envío (cooldown 24 h + candado de 2 min) en una transacción. */
    async function claimNudge(appId, uid, now) {
        const ref = healthRef(appId, uid);
        return db.runTransaction(async (tx) => {
            const s = await tx.get(ref);
            const h = s.exists ? (s.data() || {}) : {};
            const cd = nudgeCooldown(h, now);
            if (cd.blocked) return { ok: false, ...cd };
            tx.set(ref, { nudgeClaimAtMs: now }, { merge: true });
            return { ok: true };
        });
    }

    async function nudgeOne(appId, uid, caller, now) {
        const pubSnap = await pubUsers(appId).doc(uid).get();
        if (!pubSnap.exists) return { uid, ok: false, result: 'not_found', text: 'No existe' };
        const pub = pubSnap.data() || {};
        if (String(pub.role || '').toLowerCase() !== 'driver') return { uid, ok: false, result: 'not_driver', text: 'No es conductor' };
        const privSnap = await privRef(appId, uid).get().catch(() => null);
        const priv = privSnap?.exists ? (privSnap.data() || {}) : {};
        const phone = pickPhone(pub, priv);
        if (!phone) return { uid, ok: false, result: 'no_phone', text: 'Sin teléfono' };
        const claim = await claimNudge(appId, uid, now);
        if (!claim.ok) {
            return { uid, ok: false, result: 'cooldown', text: claim.inFlight ? 'Ya se está enviando' : 'Ya se pidió en las últimas 24 h', nextAllowedAtMs: claim.nextAllowedAtMs };
        }
        const w = getWa();
        const template = w.driverPushActivateTemplateName?.() || '';
        let res;
        let via = 'text';
        let attempted = true;
        if (template) {
            via = 'template';
            res = await w.sendWhatsAppTemplate(phone, template, [firstName(pub.name) || 'conductor', ACTIVATE_LINK]);
            if (!res?.ok && w.templateParamMismatch?.(res)) {
                res = await w.sendWhatsAppTemplate(phone, template, [firstName(pub.name) || 'conductor']);
            }
        } else {
            const lastIn = await w.lastInboundAtMs(phone).catch(() => 0);
            if (!lastIn || now - lastIn > WA_WINDOW_MS) {
                attempted = false;
                res = { ok: false, reason: 'outside_window' };
            } else {
                res = await w.sendCloudTextLogged(phone, nudgeText(pub.name), { purpose: 'push_activate', byUid: caller.uid });
            }
        }
        let result = res?.ok ? 'sent' : (res?.reason === 'outside_window' ? 'outside_window' : (res?.skipped ? 'not_configured' : 'failed'));
        if (res?.reason === 'bad_phone') result = 'bad_phone';
        const text = {
            sent: via === 'template' ? 'Enviado (plantilla)' : 'Enviado',
            outside_window: 'No se pudo: fuera de la ventana de 24 h',
            not_configured: 'WhatsApp no está configurado',
            bad_phone: 'Teléfono inválido',
            failed: 'No se pudo enviar'
        }[result] || 'No se pudo enviar';
        const messageId = res?.messageId || res?.result?.messages?.[0]?.id || null;
        const lastNudge = { atMs: now, byUid: caller.uid, byName: caller.name, result, via, text, messageId };
        if (res?.skipped) attempted = false;
        // Solo cuenta para el límite de 24 h si de verdad se intentó mandar.
        await healthRef(appId, uid).set({
            lastNudge,
            nudgeClaimAtMs: 0,
            ...(attempted ? { lastNudgeAttemptAtMs: now } : {})
        }, { merge: true });
        await logCol(appId).add({
            atMs: now, driverUid: uid, byUid: caller.uid, byName: caller.name,
            result, via, messageId, template: template || null, bulk: !!caller.bulk
        }).catch(() => {});
        return { uid, ok: result === 'sent', result, text, via, nextAllowedAtMs: attempted ? now + NUDGE_COOLDOWN_MS : null };
    }

    const staffNudgeDriverPush = onCall({ timeoutSeconds: 300 }, async (request) => {
        const auth = await assertCallerCanModerate(request.auth);
        const raw = Array.isArray(request.data?.driverUids) ? request.data.driverUids : [request.data?.driverUid];
        const uids = [...new Set(raw.map((x) => String(x || '').trim()).filter((x) => x && x.length <= 128 && !x.includes('/')))];
        if (!uids.length) throw new HttpsError('invalid-argument', 'Elige al menos un conductor.');
        if (uids.length > MAX_NUDGE_BATCH) throw new HttpsError('invalid-argument', `Máximo ${MAX_NUDGE_BATCH} a la vez.`);
        const bulk = uids.length > 1 || request.data?.bulk === true;
        if (bulk && Number(request.data?.confirmCount) !== uids.length) {
            throw new HttpsError('failed-precondition', 'Confirma la cantidad de conductores antes de enviar.');
        }
        const w = getWa();
        if (!w) throw new HttpsError('failed-precondition', 'WhatsApp no disponible.');
        const caller = { uid: auth.uid, name: await callerName(APP_ID, auth.uid), bulk };
        const now = Date.now();
        const results = [];
        for (const uid of uids) {
            try {
                results.push(await nudgeOne(APP_ID, uid, caller, now));
            } catch (e) {
                await healthRef(APP_ID, uid).set({ nudgeClaimAtMs: 0 }, { merge: true }).catch(() => {});
                results.push({ uid, ok: false, result: 'failed', text: 'No se pudo enviar' });
                console.warn(`[nudge] uid=${uid} ${e?.message || e}`);
            }
        }
        const sum = {};
        results.forEach((r) => { sum[r.result] = (sum[r.result] || 0) + 1; });
        console.log(`[nudge] by=${auth.uid} n=${uids.length} ${JSON.stringify(sum)}`);
        return { ok: true, results, summary: sum, template: w.driverPushActivateTemplateName?.() || '' };
    });

    return {
        exports: { staffDriverPushStatus, staffNudgeDriverPush },
        helpers: { computeStatus, recordPushHealth, claimNudge, nudgeOne }
    };
};
module.exports.classifyDriverPush = classifyDriverPush;
module.exports.nudgeCooldown = nudgeCooldown;
module.exports.nudgeText = nudgeText;
module.exports.describeWaFailure = describeWaFailure;
module.exports.ACTIVATE_LINK = ACTIVATE_LINK;
module.exports.NUDGE_COOLDOWN_MS = NUDGE_COOLDOWN_MS;
