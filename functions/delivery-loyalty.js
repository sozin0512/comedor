/**
 * «Promo Navidad» (código HAM): fidelidad de envío en pedidos de tienda.
 *
 * - Solo quienes canjean el código (máx. N personas, por defecto 147) entran.
 * - Un canje por cuenta, por teléfono y por dispositivo (candados en promotions_loyalty/{id}/locks).
 * - Ciclo de 5 pedidos ENTREGADOS: del 1 al 4 el envío cuesta L. 5 menos; el 5.º es gratis; luego reinicia.
 * - El conductor SIEMPRE gana la tarifa completa: HonduRaite le abona la diferencia en su saldo al entregar.
 * Todo se calcula y cuenta en el servidor; el cliente no puede escribir estos campos (firestore.rules).
 */
const crypto = require('crypto');

const LOYALTY_KEYS = ['loyaltyPromoId', 'loyaltyStep', 'loyaltyCycle', 'loyaltyDiscount', 'clientDeliveryFee',
    'loyaltyCountedAtMs', 'loyaltyRiderCredit', 'loyaltyRiderCreditedTo', 'loyaltyRiderCreditedAtMs'];

const DEFAULTS = Object.freeze({
    enabled: false,
    name: 'Promo Navidad',
    code: 'HAM',
    maxMembers: 147,
    discountL: 5,
    cycle: 5,
    lastFree: true,
    requireVerifiedPhone: false,
    storeIds: [],
    storeLabel: '',
    startsAtMs: 0
});

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const normCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

function normalizeSettings(raw = {}) {
    const s = { ...DEFAULTS, ...(raw || {}) };
    s.enabled = s.enabled === true;
    s.name = String(s.name || DEFAULTS.name).slice(0, 60);
    s.code = normCode(s.code) || DEFAULTS.code;
    s.maxMembers = Math.max(0, parseInt(s.maxMembers, 10) || 0);
    s.discountL = Math.max(0, money(s.discountL));
    s.cycle = Math.max(1, parseInt(s.cycle, 10) || DEFAULTS.cycle);
    s.lastFree = s.lastFree !== false;
    s.requireVerifiedPhone = s.requireVerifiedPhone === true;
    s.storeIds = Array.isArray(s.storeIds) ? [...new Set(s.storeIds.map((x) => String(x || '').trim()).filter((x) => /^[A-Za-z0-9_-]{3,80}$/.test(x)))].slice(0, 20) : [];
    s.storeLabel = String(s.storeLabel || '').slice(0, 80);
    s.startsAtMs = Math.max(0, Number(s.startsAtMs) || 0);
    s.memberCount = Math.max(0, parseInt(raw?.memberCount, 10) || 0);
    return s;
}

/** ¿Aplica a esta tienda y ya empezó? (storeIds vacío = todas) */
function appliesTo(settings, storeId, now = Date.now()) {
    const s = normalizeSettings(settings);
    if (!s.enabled || now < s.startsAtMs) return false;
    return !s.storeIds.length || s.storeIds.includes(String(storeId || ''));
}

/** Paso del ciclo para el próximo pedido (1..cycle) y descuento sobre la tarifa (nunca < 0). */
function computeLoyalty(settings, deliveredCount, fee) {
    const s = normalizeSettings(settings);
    const f = money(fee);
    if (!(f >= 0)) return null;
    const step = (Math.max(0, parseInt(deliveredCount, 10) || 0) % s.cycle) + 1;
    const isLast = step === s.cycle;
    const discount = money(Math.min(f, isLast && s.lastFree ? f : s.discountL));
    return { step, cycle: s.cycle, discount, clientDeliveryFee: money(f - discount), isFree: discount >= f && f > 0 };
}

/** Teléfono a solo dígitos con 504 (Honduras) si viene local de 8. */
function normalizePhoneKey(p) {
    let d = String(p || '').replace(/\D+/g, '');
    if (d.length === 8) d = `504${d}`;
    return /^[0-9]{8,15}$/.test(d) ? d : '';
}
const hashKey = (type, v) => `${type}_${crypto.createHash('sha256').update(`${type}:${v}`).digest('hex').slice(0, 40)}`;

function validDeviceId(v) {
    const s = String(v || '').trim();
    return /^[A-Za-z0-9:_-]{8,128}$/.test(s) ? s : '';
}

module.exports = function createDeliveryLoyalty({ db, FieldValue, HttpsError, onCall, onDocumentUpdated, APP_ID, assertCallerCanModerate }) {
    const PROMO_ID = 'promo_navidad';
    const base = (app) => `artifacts/${app}/public/data`;
    const settingsRef = (app) => db.doc(`${base(app)}/appSettings/deliveryLoyalty`);
    const memberRef = (app, uid) => db.doc(`${base(app)}/delivery_loyalty_members/${uid}`);
    const lockRef = (app, key) => db.doc(`${base(app)}/promotions_loyalty/${PROMO_ID}/locks/${key}`);

    /** El cliente canjea el código. Transacción: cupo + candados uid/teléfono/dispositivo. */
    const claimDeliveryLoyaltyCode = onCall({ region: 'us-central1', cors: true }, async (request) => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para canjear el código.');
        const code = normCode(request.data?.code);
        const deviceId = validDeviceId(request.data?.deviceId);
        if (!code) throw new HttpsError('invalid-argument', 'Escribe el código.');
        if (!deviceId) throw new HttpsError('invalid-argument', 'No se pudo identificar este dispositivo. Actualiza la app.');
        const userSnap = await db.doc(`${base(APP_ID)}/users/${uid}`).get();
        const tokenPhone = normalizePhoneKey(request.auth.token?.phone_number);
        const profilePhone = normalizePhoneKey(userSnap.get('phone'));
        const phoneKey = tokenPhone || profilePhone;
        // Solo cuenta como verificado el teléfono de Firebase Auth (token.phone_number): el perfil lo edita el propio usuario.
        const verified = !!tokenPhone;

        return db.runTransaction(async (tx) => {
            const sSnap = await tx.get(settingsRef(APP_ID));
            const s = normalizeSettings(sSnap.exists ? sSnap.data() : {});
            if (!s.enabled || code !== s.code) throw new HttpsError('not-found', 'Código no válido o promo no activa.');
            if (Date.now() < s.startsAtMs) {
                const t = new Date(s.startsAtMs).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
                throw new HttpsError('failed-precondition', `${s.name} empieza el ${t}.`);
            }
            const mRef = memberRef(APP_ID, uid);
            const keys = [hashKey('uid', uid), phoneKey && hashKey('phone', phoneKey), hashKey('device', deviceId)].filter(Boolean);
            const [mSnap, ...locks] = await Promise.all([tx.get(mRef), ...keys.map((k) => tx.get(lockRef(APP_ID, k)))]);
            if (mSnap.exists) return { ok: true, already: true, name: s.name, deliveredCount: mSnap.get('deliveredCount') || 0, cycle: s.cycle };
            if (!phoneKey) throw new HttpsError('failed-precondition', 'Agrega tu teléfono a tu cuenta para canjear esta promo.');
            if (s.requireVerifiedPhone && !verified) throw new HttpsError('failed-precondition', 'Necesitas un teléfono verificado en tu cuenta para canjear esta promo.');
            if (locks.some((l) => l.exists)) throw new HttpsError('already-exists', 'Esta promo ya se canjeó en esta cuenta o dispositivo.');
            if (s.memberCount >= s.maxMembers) throw new HttpsError('resource-exhausted', `¡${s.name} ya se llenó! Los ${s.maxMembers} cupos están ocupados.`);
            const now = Date.now();
            tx.set(mRef, { uid, promoId: PROMO_ID, code: s.code, phoneKey, deliveredCount: 0, joinedAtMs: now, joinedAt: FieldValue.serverTimestamp() });
            keys.forEach((k) => tx.set(lockRef(APP_ID, k), { uid, type: k.split('_')[0], atMs: now }));
            tx.set(settingsRef(APP_ID), { memberCount: s.memberCount + 1, updatedAtMs: now }, { merge: true });
            return { ok: true, already: false, name: s.name, deliveredCount: 0, cycle: s.cycle, remaining: s.maxMembers - s.memberCount - 1 };
        });
    });

    /** Staff: nombre, código, cupo, montos, encendido. memberCount solo lo cambia el canje. */
    const staffSetDeliveryLoyalty = onCall({ region: 'us-central1', cors: true }, async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const d = request.data || {};
        const patch = normalizeSettings(d);
        delete patch.memberCount;
        if (patch.code.length < 3) throw new HttpsError('invalid-argument', 'Código: mínimo 3 caracteres.');
        if (patch.discountL > 500) throw new HttpsError('invalid-argument', 'Descuento demasiado alto.');
        if (patch.maxMembers > 100000) throw new HttpsError('invalid-argument', 'Cupo demasiado alto.');
        await settingsRef(APP_ID).set({ ...patch, updatedAtMs: Date.now(), updatedBy: caller.uid || request.auth.uid }, { merge: true });
        return { ok: true };
    });

    /** Al crear el pedido (tras fijar la tarifa): paso del ciclo y lo que paga el cliente. */
    async function loyaltyPatchForNewOrder(app, order, fee) {
        if (!order?.clientId || !Number.isFinite(Number(fee))) return null;
        const [sSnap, mSnap] = await Promise.all([settingsRef(app).get(), memberRef(app, order.clientId).get()]);
        const s = normalizeSettings(sSnap.exists ? sSnap.data() : {});
        if (!appliesTo(s, order.storeId) || !mSnap.exists) return null;
        const r = computeLoyalty(s, mSnap.get('deliveredCount') || 0, fee);
        if (!r) return null;
        return { loyaltyPromoId: PROMO_ID, loyaltyStep: r.step, loyaltyCycle: r.cycle, loyaltyDiscount: r.discount, clientDeliveryFee: r.clientDeliveryFee };
    }

    /** Entregado: cuenta +1 y abona al conductor la diferencia. Idempotente (loyaltyCountedAtMs). */
    const onStoreOrderLoyaltyDelivered = onDocumentUpdated('artifacts/{appId}/public/data/store_orders/{orderId}', async (event) => {
        const before = event.data.before.data() || {};
        const after = event.data.after.data() || {};
        if (after.status !== 'delivered' || before.status === 'delivered') return;
        if (!after.loyaltyPromoId || after.loyaltyCountedAtMs) return;
        const { appId, orderId } = event.params;
        const orderRef = db.doc(`${base(appId)}/store_orders/${orderId}`);
        let credited = null;
        await db.runTransaction(async (tx) => {
            const o = await tx.get(orderRef);
            const od = o.data() || {};
            if (od.status !== 'delivered' || od.loyaltyCountedAtMs || !od.loyaltyPromoId) return;
            const mRef = memberRef(appId, od.clientId);
            const driverId = od.driverId || od.lastDriverId || null;
            const amt = money(od.loyaltyDiscount);
            const dRef = driverId && amt > 0 ? db.doc(`${base(appId)}/users/${driverId}`) : null;
            const [m, dSnap] = await Promise.all([tx.get(mRef), dRef ? tx.get(dRef) : Promise.resolve(null)]);
            const now = Date.now();
            if (m.exists) tx.update(mRef, { deliveredCount: (parseInt(m.get('deliveredCount'), 10) || 0) + 1, lastDeliveredAtMs: now, lastOrderId: orderId });
            const patch = { loyaltyCountedAtMs: now };
            if (dRef) {
                const next = money((parseFloat(dSnap?.exists ? dSnap.get('driverBalance') : 0) || 0) + amt);
                if (dSnap?.exists) tx.update(dRef, { driverBalance: next }); else tx.set(dRef, { driverBalance: next }, { merge: true });
                tx.set(db.collection(`${base(appId)}/delivery_loyalty_credits`).doc(orderId), { orderId, driverId, amount: amt, clientId: od.clientId, step: od.loyaltyStep || null, atMs: now });
                Object.assign(patch, { loyaltyRiderCredit: amt, loyaltyRiderCreditedTo: driverId, loyaltyRiderCreditedAtMs: now });
                credited = { driverId, next };
            }
            tx.update(orderRef, patch);
        });
        if (credited) {
            await db.doc(`artifacts/${appId}/users/${credited.driverId}/profile/data`).set({ driverBalance: credited.next }, { merge: true }).catch(() => {});
        }
    });

    return { loyaltyPatchForNewOrder, exports: { claimDeliveryLoyaltyCode, staffSetDeliveryLoyalty, onStoreOrderLoyaltyDelivered } };
};
Object.assign(module.exports, { appliesTo, computeLoyalty, normalizeSettings, normalizePhoneKey, hashKey, validDeviceId, normCode, LOYALTY_KEYS, DEFAULTS });
