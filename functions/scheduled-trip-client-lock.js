/**
 * Misma regla que js/scheduled-trip-client-lock.js (pasajero con viaje programado en espera).
 * Copia CJS para Cloud Functions. Staff: roles de confianza, correo admin y staffGrantedBy.
 */
'use strict';

const WAITING_LOCK_TOAST = 'Tenés un viaje en espera. No podés pedir otro servicio hasta que se complete o lo cancelés.';
const TERMINAL = new Set(['completed', 'cancelled', 'canceled']);

function scheduledForMs(trip) {
    const raw = trip && typeof trip === 'object' ? trip.scheduledFor : trip;
    if (raw == null || raw === '') return 0;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    if (typeof raw.toMillis === 'function') {
        const n = raw.toMillis();
        return Number.isFinite(n) ? n : 0;
    }
    if (typeof raw.seconds === 'number') return raw.seconds * 1000;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function hasScheduledFor(trip) {
    if (!trip) return false;
    const raw = trip.scheduledFor;
    if (raw == null || raw === '') return false;
    return scheduledForMs(trip) > 0 || String(raw).trim().length > 0;
}

function isWaitingScheduledTrip(trip) {
    if (!trip || typeof trip !== 'object') return false;
    if (trip.isDemandSimulation === true) return false;
    const status = String(trip.status || '');
    if (TERMINAL.has(status)) return false;
    if (status === 'scheduled') return true;
    if (status === 'pending' && hasScheduledFor(trip)) return true;
    return false;
}

function staffExemptFromWaitingLock(staff) {
    if (!staff || typeof staff !== 'object') return false;
    if (staff.isAdmin === true || staff.isSupervisor === true || staff.isStaff === true) return true;
    if (staff.helpersChecked === true) return false;
    if (staff.staffGrantedBy) return true;
    const role = String(staff.role || '').toLowerCase();
    return role === 'admin' || role === 'supervisor';
}

function requestSkipsWaitingLock(trip) {
    if (!trip || typeof trip !== 'object') return false;
    if (trip.isDemandSimulation === true) return true;
    if (trip.createdByMerchant === true || trip.merchantDirectDelivery === true) return true;
    const by = String(trip.staffCreatedBy || '');
    if (trip.staffAssistedClient === true && by && by !== 'whatsapp-assistant') return true;
    return false;
}

function pickWaitingScheduledTrip(trips, { ignoreId = null } = {}) {
    const list = (Array.isArray(trips) ? trips : [])
        .filter((t) => t && t.id !== ignoreId && isWaitingScheduledTrip(t));
    if (!list.length) return null;
    list.sort((a, b) => {
        const sa = a.status === 'scheduled' ? 0 : 1;
        const sb = b.status === 'scheduled' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        const ma = scheduledForMs(a) || Number.MAX_SAFE_INTEGER;
        const mb = scheduledForMs(b) || Number.MAX_SAFE_INTEGER;
        return ma - mb;
    });
    return list[0];
}

function waitingLockDecision({ trips, staff, ignoreId = null } = {}) {
    if (staffExemptFromWaitingLock(staff)) return { locked: false, trip: null, reason: 'staff' };
    const trip = pickWaitingScheduledTrip(trips, { ignoreId });
    if (!trip) return { locked: false, trip: null, reason: 'clear' };
    return { locked: true, trip, reason: trip.status === 'scheduled' ? 'scheduled' : 'pending-scheduled' };
}

function tripsCol(db, appId) {
    return db.collection(`artifacts/${appId}/public/data/trips`);
}

async function loadWaitingScheduledTrip(db, appId, clientId, { ignoreId = null } = {}) {
    const id = String(clientId || '').trim();
    if (!id) return null;
    const col = tripsCol(db, appId);
    let docs = [];
    try {
        const snap = await col.where('clientId', '==', id).where('status', 'in', ['scheduled', 'pending']).limit(20).get();
        docs = snap.docs;
    } catch (_) {
        const snap = await col.where('clientId', '==', id).limit(40).get();
        docs = snap.docs;
    }
    const trips = docs.map((d) => ({ id: d.id, ...d.data() }));
    return pickWaitingScheduledTrip(trips, { ignoreId });
}

/**
 * Admin / supervisor como ya los resuelve el servidor (roles.js) y el respaldo
 * staffGrantedBy / role del perfil que usa isSupervisorUser cuando aún no hay claim.
 */
async function clientAccountIsStaff(db, getAuth, appId, clientId, { adminEmail = '', knownEmails = null } = {}) {
    const id = String(clientId || '').trim();
    if (!id || id.startsWith('guest_')) return false;
    let email = '';
    let claim = '';
    if (typeof getAuth === 'function') {
        try {
            const rec = await getAuth().getUser(id);
            email = String(rec.email || '').trim().toLowerCase();
            claim = String(rec.customClaims?.role || '');
        } catch (_) {}
    }
    if (adminEmail && email === String(adminEmail).trim().toLowerCase()) return true;
    try {
        const roleSnap = await db.doc(`artifacts/${appId}/roles/${id}`).get();
        if (roleSnap.exists) {
            const role = String(roleSnap.data()?.role || '');
            return role === 'admin' || role === 'supervisor';
        }
    } catch (_) {}
    if (claim === 'admin' || claim === 'supervisor') return true;
    if (knownEmails && typeof knownEmails.has === 'function' && knownEmails.has(email)) return true;
    // Sin doc de roles ni claim: mismo respaldo que isSupervisorUser (staffGrantedBy / role).
    try {
        const pub = await db.doc(`artifacts/${appId}/public/data/users/${id}`).get();
        const p = pub.exists ? (pub.data() || {}) : {};
        if (p.staffGrantedBy) return true;
        const profileRole = String(p.role || '');
        if (profileRole === 'admin' || profileRole === 'supervisor') return true;
    } catch (_) {}
    return false;
}

async function callerIsStaff(db, rolesHelper, auth, appId) {
    if (!auth?.uid) return false;
    if (rolesHelper && typeof rolesHelper.isTrustedStaff === 'function') {
        const trusted = await rolesHelper.isTrustedStaff(auth, appId);
        return !!(trusted && (trusted.role === 'admin' || trusted.role === 'supervisor'));
    }
    return false;
}

async function rejectTripIfClientWaiting(deps) {
    const { db, FieldValue, appId, tripId, trip, getAuth, adminEmail, knownEmails } = deps;
    if (!trip || requestSkipsWaitingLock(trip)) return false;
    const clientId = String(trip.clientId || '');
    if (!clientId) return false;
    if (await clientAccountIsStaff(db, getAuth, appId, clientId, { adminEmail, knownEmails })) return false;
    const waiting = await loadWaitingScheduledTrip(db, appId, clientId, { ignoreId: tripId });
    if (!waiting) return false;
    await db.doc(`artifacts/${appId}/public/data/trips/${tripId}`).set({
        status: 'cancelled',
        cancelledBy: 'system',
        cancelReason: 'waiting_scheduled_lock',
        cancelMessage: WAITING_LOCK_TOAST,
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
}

async function rejectStoreOrderIfClientWaiting(deps) {
    const { db, FieldValue, appId, orderId, order, getAuth, adminEmail, knownEmails } = deps;
    if (!order || order.status && order.status !== 'pending') return false;
    const clientId = String(order.clientId || '');
    if (!clientId) return false;
    if (await clientAccountIsStaff(db, getAuth, appId, clientId, { adminEmail, knownEmails })) return false;
    const waiting = await loadWaitingScheduledTrip(db, appId, clientId);
    if (!waiting) return false;
    await db.doc(`artifacts/${appId}/public/data/store_orders/${orderId}`).set({
        status: 'cancelled',
        cancelledBy: 'system',
        cancelReason: 'waiting_scheduled_lock',
        cancelMessage: WAITING_LOCK_TOAST,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
}

module.exports = {
    WAITING_LOCK_TOAST,
    scheduledForMs,
    hasScheduledFor,
    isWaitingScheduledTrip,
    staffExemptFromWaitingLock,
    requestSkipsWaitingLock,
    pickWaitingScheduledTrip,
    waitingLockDecision,
    loadWaitingScheduledTrip,
    clientAccountIsStaff,
    callerIsStaff,
    rejectTripIfClientWaiting,
    rejectStoreOrderIfClientWaiting
};
