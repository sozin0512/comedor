/**
 * Eliminar cuenta desde la app (requisito de Google Play, "Account deletion").
 *
 * Callables:
 *   getAccountDeletionStatus()  → qué impide borrar ahora (viaje activo, pago pendiente, staff) y avisos (saldo).
 *   deleteMyAccount({ confirm: 'ELIMINAR', acknowledgeBalanceLoss })
 *
 * Qué hace deleteMyAccount (solo para la cuenta que llama):
 *   1. Borra el perfil público y privado, vehículos, verificación (selfie/cédula), reenvíos, bonos,
 *      ubicación de conductor, índice de teléfono, códigos de referido y los archivos en Storage
 *      (artifacts/<app>/users/<uid>/...).
 *   2. Anonimiza (no borra) los registros que hay que conservar por contabilidad, fraude y seguridad:
 *      viajes, pedidos de tienda, depósitos/pagos, tickets y reportes. Se quitan nombre, teléfono,
 *      correo, fotos y ubicación en vivo; quedan montos, fechas y rutas del viaje.
 *   3. Tiendas del usuario: se ocultan (closed + deletedOwner) y se borran sus productos.
 *   4. Borra el usuario de Firebase Auth.
 *   5. Deja una marca sin datos personales en artifacts/<app>/account_deletions/<uid> (auditoría).
 *
 * No borra si: hay un viaje/pedido activo, el conductor tiene pago o depósito pendiente,
 * o la cuenta es de staff (un admin la quita primero).
 */
'use strict';

const ACTIVE_TRIP = new Set(['pending', 'accepted', 'in_progress', 'scheduled']);
const ACTIVE_ORDER = new Set(['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'on_the_way', 'in_progress']);
const RECENT_LOGIN_MS = 15 * 60 * 1000;
const DELETED_NAME_CLIENT = 'Usuario eliminado';
const DELETED_NAME_DRIVER = 'Conductor eliminado';

const CLIENT_PII_KEYS = [
    'clientPhone', 'clientEmail', 'clientPhoto', 'clientWa', 'clientRtn', 'clientLiveLat', 'clientLiveLng',
    'clientLiveHeading', 'clientLiveAccuracy', 'clientLiveUpdatedAt', 'riderInfo', 'passengerPhone',
    'passengerEmail', 'passengerPhoto', 'passengerCascoPhotos', 'passengerLiveLat', 'passengerLiveLng',
    'passengerLiveHeading', 'passengerLiveAccuracy', 'guestPhone', 'guestWaPhone', 'waPhone', 'clientIdentity'
];
const DRIVER_PII_KEYS = [
    'driverPhone', 'driverEmail', 'driverPhoto', 'driverWa', 'driverIdentity', 'driverDocumentsPhotos',
    'driverVehiclePhotos', 'driverLiveLat', 'driverLiveLng', 'driverLiveHeading', 'driverLiveAccuracy',
    'driverPhotoFromProfile', 'driverPos', 'driverCoords'
];
const ORDER_CLIENT_PII_KEYS = ['clientPhone', 'clientEmail', 'clientPhoto', 'clientWa', 'deliveryPhone', 'customerPhone', 'customerEmail'];

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Lógica pura: qué bloquea y qué hay que advertir. Se prueba sin Firebase. */
function evaluateDeletion({ uid, profile = {}, trips = [], orders = [], pendingDepositRequests = 0, staffRole = '' }) {
    const blockers = [];
    const warnings = [];
    const activeTrips = trips.filter((t) => ACTIVE_TRIP.has(String(t.status || '')));
    if (activeTrips.length) {
        blockers.push({
            code: 'active_trip',
            message: 'Tienes un viaje activo o programado. Termínalo o cancélalo antes de eliminar tu cuenta.',
            tripIds: activeTrips.map((t) => t.id).filter(Boolean).slice(0, 5)
        });
    }
    const activeOrders = orders.filter((o) => ACTIVE_ORDER.has(String(o.status || ''))
        && (o.clientId === uid || o.ownerId === uid));
    if (activeOrders.length) {
        blockers.push({
            code: 'active_order',
            message: 'Tienes un pedido de tienda en curso. Espera a que se entregue o cancélalo.',
        });
    }
    if (staffRole && ['admin', 'supervisor'].includes(String(staffRole))) {
        blockers.push({
            code: 'staff',
            message: 'Esta cuenta es de staff. Pide al administrador que te quite el rol antes de eliminarla.'
        });
    }
    const isDriver = profile.role === 'driver';
    const driverBalance = num(profile.driverBalance);
    const debt = num(profile.pendingDepositDebt);
    if (isDriver && driverBalance > 0.009) {
        blockers.push({
            code: 'pending_payout',
            message: `Tienes L. ${driverBalance.toFixed(2)} por cobrar. Pide tu pago a soporte antes de eliminar la cuenta para no perderlo.`
        });
    }
    if (isDriver && (debt > 0.009 || pendingDepositRequests > 0)) {
        blockers.push({
            code: 'pending_deposit',
            message: pendingDepositRequests > 0
                ? 'Tienes un depósito en revisión. Espera a que soporte lo valide.'
                : `Tienes L. ${debt.toFixed(2)} de comisión por depositar. Deposita o habla con soporte primero.`
        });
    }
    const passengerBalance = num(profile.balance);
    if (passengerBalance > 0.009) {
        warnings.push({
            code: 'balance_loss',
            amount: Math.round(passengerBalance * 100) / 100,
            message: `Tienes L. ${passengerBalance.toFixed(2)} de saldo. Si eliminas la cuenta, ese saldo se pierde.`
        });
    }
    return { canDelete: blockers.length === 0, blockers, warnings };
}

function anonymizeTripPatch(trip, uid, deleteValue) {
    const patch = {};
    if (trip.clientId === uid) {
        patch.clientName = DELETED_NAME_CLIENT;
        CLIENT_PII_KEYS.forEach((k) => { if (k in trip) patch[k] = deleteValue; });
        if (trip.passengerName != null) patch.passengerName = DELETED_NAME_CLIENT;
        patch.clientAccountDeleted = true;
    }
    if (trip.driverId === uid) {
        patch.driverName = DELETED_NAME_DRIVER;
        DRIVER_PII_KEYS.forEach((k) => { if (k in trip) patch[k] = deleteValue; });
        patch.driverAccountDeleted = true;
    }
    return patch;
}

function anonymizeOrderPatch(order, uid, deleteValue) {
    const patch = {};
    if (order.clientId === uid) {
        patch.clientName = DELETED_NAME_CLIENT;
        ORDER_CLIENT_PII_KEYS.forEach((k) => { if (k in order) patch[k] = deleteValue; });
        patch.clientAccountDeleted = true;
    }
    if (order.ownerId === uid) patch.ownerAccountDeleted = true;
    return patch;
}

module.exports = function createAccountDeletion(deps) {
    const { db, getAuth, getStorage, FieldValue, HttpsError, onCall, APP_ID, ADMIN_EMAIL, roles } = deps;
    const base = `artifacts/${APP_ID}`;
    const pub = `${base}/public/data`;

    async function staffRoleOf(auth) {
        const email = String(auth?.token?.email || '').toLowerCase();
        if (email && email === ADMIN_EMAIL) return 'admin';
        try {
            const r = await roles.helpers.resolveTrustedRole(auth);
            const role = typeof r === 'string' ? r : r?.role;
            return ['admin', 'supervisor'].includes(role) ? role : '';
        } catch (_) {
            return '';
        }
    }

    async function loadContext(auth) {
        const uid = auth.uid;
        const [pubSnap, privSnap, tripsC, tripsD, ordersC, ordersO, depReq, staffRole] = await Promise.all([
            db.doc(`${pub}/users/${uid}`).get(),
            db.doc(`${base}/users/${uid}/profile/data`).get(),
            db.collection(`${pub}/trips`).where('clientId', '==', uid).get(),
            db.collection(`${pub}/trips`).where('driverId', '==', uid).get(),
            db.collection(`${pub}/store_orders`).where('clientId', '==', uid).get(),
            db.collection(`${pub}/store_orders`).where('ownerId', '==', uid).get(),
            db.collection(`${pub}/driver_deposit_requests`).where('driverId', '==', uid).get(),
            staffRoleOf(auth)
        ]);
        const profile = { ...(privSnap.data() || {}), ...(pubSnap.data() || {}) };
        const tripMap = new Map();
        [...tripsC.docs, ...tripsD.docs].forEach((d) => tripMap.set(d.id, { id: d.id, ...d.data(), _ref: d.ref }));
        const orderMap = new Map();
        [...ordersC.docs, ...ordersO.docs].forEach((d) => orderMap.set(d.id, { id: d.id, ...d.data(), _ref: d.ref }));
        const pendingDepositRequests = depReq.docs.filter((d) => String(d.data()?.status || 'pending') === 'pending').length;
        return {
            uid, profile, staffRole, pendingDepositRequests,
            trips: [...tripMap.values()], orders: [...orderMap.values()],
            depositDocs: depReq.docs
        };
    }

    async function commitPatches(items) {
        let batch = db.batch();
        let n = 0;
        let total = 0;
        for (const { ref, patch, del } of items) {
            if (del) batch.delete(ref);
            else if (patch && Object.keys(patch).length) batch.set(ref, patch, { merge: true });
            else continue;
            n += 1; total += 1;
            if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
        }
        if (n) await batch.commit();
        return total;
    }

    async function deleteSubcollections(docPath, names) {
        const items = [];
        for (const name of names) {
            const snap = await db.collection(`${docPath}/${name}`).get();
            snap.docs.forEach((d) => items.push({ ref: d.ref, del: true }));
        }
        return commitPatches(items);
    }

    async function anonymizeByField(collection, field, uid, keys, nameKey, nameValue) {
        const snap = await db.collection(`${pub}/${collection}`).where(field, '==', uid).get();
        const items = snap.docs.map((d) => {
            const data = d.data() || {};
            const patch = { accountDeleted: true };
            keys.forEach((k) => { if (k in data) patch[k] = FieldValue.delete(); });
            if (nameKey && nameKey in data) patch[nameKey] = nameValue;
            return { ref: d.ref, patch };
        });
        return commitPatches(items);
    }

    const getAccountDeletionStatus = onCall(async (request) => {
        if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicia sesión primero.');
        const ctx = await loadContext(request.auth);
        const result = evaluateDeletion(ctx);
        return { ...result, role: ctx.profile.role || 'client' };
    });

    const deleteMyAccount = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
        const auth = request.auth;
        if (!auth?.uid) throw new HttpsError('unauthenticated', 'Inicia sesión primero.');
        if (String(request.data?.confirm || '').trim().toUpperCase() !== 'ELIMINAR') {
            throw new HttpsError('failed-precondition', 'Escribe ELIMINAR para confirmar.');
        }
        const authTimeMs = Number(auth.token?.auth_time || 0) * 1000;
        if (!authTimeMs || Date.now() - authTimeMs > RECENT_LOGIN_MS) {
            throw new HttpsError('failed-precondition', 'requires-recent-login');
        }
        const uid = auth.uid;
        const ctx = await loadContext(auth);
        const evaluation = evaluateDeletion(ctx);
        if (!evaluation.canDelete) {
            throw new HttpsError('failed-precondition', evaluation.blockers[0].message, { blockers: evaluation.blockers });
        }
        if (evaluation.warnings.some((w) => w.code === 'balance_loss') && request.data?.acknowledgeBalanceLoss !== true) {
            throw new HttpsError('failed-precondition', 'Confirma que entiendes que tu saldo se pierde.', { warnings: evaluation.warnings });
        }

        const del = FieldValue.delete();
        const counts = {};
        const markerRef = db.doc(`${base}/account_deletions/${uid}`);
        await markerRef.set({
            uid,
            role: ctx.profile.role || 'client',
            status: 'in_progress',
            requestedAtMs: Date.now(),
            source: String(request.data?.source || 'app').slice(0, 20)
        }, { merge: true });

        // 1) Anonimizar registros que se conservan
        counts.trips = await commitPatches(ctx.trips.map((t) => ({ ref: t._ref, patch: anonymizeTripPatch(t, uid, del) })));
        counts.storeOrders = await commitPatches(ctx.orders.map((o) => ({ ref: o._ref, patch: anonymizeOrderPatch(o, uid, del) })));
        counts.deposits = await commitPatches(ctx.depositDocs.map((d) => ({
            ref: d.ref,
            patch: { driverName: DELETED_NAME_DRIVER, driverPhone: del, driverEmail: del, accountDeleted: true }
        })));
        const piiKeys = ['userPhone', 'userEmail', 'driverPhone', 'driverEmail', 'phone', 'email', 'payoutAccount', 'payoutHolder', 'identity', 'identityPhoto', 'photo'];
        counts.tickets = await anonymizeByField('support_tickets', 'userId', uid, piiKeys, 'userName', DELETED_NAME_CLIENT);
        counts.reports = await anonymizeByField('reports', 'reportedByUid', uid, piiKeys, 'reportedByName', DELETED_NAME_CLIENT);
        counts.payouts = await anonymizeByField('driver_payout_records', 'driverId', uid, piiKeys, 'driverName', DELETED_NAME_DRIVER);
        counts.payoutBank = await anonymizeByField('driver_payout_bank_events', 'driverId', uid, piiKeys, 'driverName', DELETED_NAME_DRIVER);
        counts.verificationAlerts = await anonymizeByField('verification_alerts', 'uid', uid, piiKeys, 'name', DELETED_NAME_CLIENT);

        // 2) Tiendas: ocultar y borrar productos
        const stores = await db.collection(`${pub}/stores`).where('ownerId', '==', uid).get();
        const products = await db.collection(`${pub}/store_products`).where('ownerId', '==', uid).get();
        counts.stores = await commitPatches(stores.docs.map((d) => ({
            ref: d.ref,
            patch: { isOpen: false, active: false, approvalStatus: 'closed', ownerAccountDeleted: true, phone: del, whatsapp: del, ownerPhone: del, ownerEmail: del }
        })));
        counts.products = await commitPatches(products.docs.map((d) => ({ ref: d.ref, del: true })));

        // 3) Borrar datos personales
        const phoneIdx = await db.collection(`${pub}/auth_phone_index`).where('uid', '==', uid).get();
        const refCodes = await db.collection(`${pub}/referral_codes`).where('uid', '==', uid).get();
        const tokenOwners = await db.collection(`${base}/fcm_token_owners`).where('uid', '==', uid).get().catch(() => ({ docs: [] }));
        counts.subcollections = await deleteSubcollections(`${base}/users/${uid}`, ['vehicles', 'verification', 'resubmit', 'claimed_promos', 'profile']);
        counts.personal = await commitPatches([
            { ref: db.doc(`${pub}/users/${uid}`), del: true },
            { ref: db.doc(`${pub}/drivers_location/${uid}`), del: true },
            { ref: db.doc(`${pub}/wa_invite_contacted/${uid}`), del: true },
            ...phoneIdx.docs.map((d) => ({ ref: d.ref, del: true })),
            ...refCodes.docs.map((d) => ({ ref: d.ref, del: true })),
            ...tokenOwners.docs.map((d) => ({ ref: d.ref, del: true }))
        ]);

        // 4) Archivos (fotos de perfil, cédula, vehículo, comprobantes, logos)
        try {
            await getStorage().bucket().deleteFiles({ prefix: `${base}/users/${uid}/`, force: true });
            counts.storage = 'ok';
        } catch (e) {
            counts.storage = 'error';
            console.warn('deleteMyAccount storage', uid, e?.message || e);
        }

        // 5) Usuario de Auth
        await getAuth().deleteUser(uid).catch((e) => {
            if (e?.code !== 'auth/user-not-found') throw e;
        });

        await markerRef.set({ status: 'done', completedAtMs: Date.now(), counts }, { merge: true });
        return { ok: true };
    });

    return {
        exports: { getAccountDeletionStatus, deleteMyAccount },
        helpers: { evaluateDeletion, anonymizeTripPatch, anonymizeOrderPatch }
    };
};

module.exports.evaluateDeletion = evaluateDeletion;
module.exports.anonymizeTripPatch = anonymizeTripPatch;
module.exports.anonymizeOrderPatch = anonymizeOrderPatch;
