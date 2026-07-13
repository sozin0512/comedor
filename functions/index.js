const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const db = getFirestore();
const PUSH_ICON = `https://${process.env.GCLOUD_PROJECT || 'comedor-86278'}.web.app/icons/icon-192.png`;
const ADMIN_EMAIL = 'josuesoza0513@gmail.com';
const APP_ID = 'comayagua-vip-pro-v4';
const TRIP_OFFER_TIMEOUT_MS = 120 * 1000;
const TRIP_OFFER_NEGOTIATION_HOLD_MS = 180 * 1000;
const SCHEDULED_TRIP_PREP_MINUTES = 10;
const SCHEDULED_TRIP_PREP_MS = SCHEDULED_TRIP_PREP_MINUTES * 60 * 1000;

function formatScheduledTripWhen(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('es-HN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (_) {
        return '';
    }
}

function getScheduledTripMs(trip) {
    if (!trip?.scheduledFor) return 0;
    const ms = new Date(trip.scheduledFor).getTime();
    return Number.isFinite(ms) ? ms : 0;
}
const TRIP_OFFER_NEAR_RADIUS_KM = 8;
const TRIP_OFFER_POOL_SIZE = 1;
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
const ONLINE_STALE_MS = 90 * 1000;

function getCityCoverageKm(zoneId) {
    if (zoneId && CITY_COVERAGE_KM[zoneId] != null) return CITY_COVERAGE_KM[zoneId];
    return 14;
}

function getTripOfferNearRadiusKm(zoneId) {
    const coverage = getCityCoverageKm(zoneId);
    return Math.min(TRIP_OFFER_NEAR_RADIUS_KM, Math.max(5, Math.round(coverage * 0.5)));
}

function pickDriversByProximityTier(sortedCandidates, zoneId) {
    if (!sortedCandidates?.length) return { candidates: [], tier: null };
    const nearKm = getTripOfferNearRadiusKm(zoneId);
    const farKm = getCityCoverageKm(zoneId);
    let pool = sortedCandidates.filter((c) => c.distanceKm <= nearKm);
    let tier = 'near';
    if (!pool.length) {
        pool = sortedCandidates.filter((c) => c.distanceKm <= farKm);
        tier = 'far';
    }
    return { candidates: pool, tier };
}

function getTripOfferFarRadiusKm(zoneId) {
    return getCityCoverageKm(zoneId);
}

function getActiveTripByDriver(tripDocs) {
    const byDriver = new Map();
    tripDocs.forEach((d) => {
        const t = d.data();
        if (!t.driverId || !['accepted', 'in_progress'].includes(t.status)) return;
        const existing = byDriver.get(t.driverId);
        if (!existing || t.status === 'in_progress') {
            byDriver.set(t.driverId, { tripDocId: d.id, ...t });
        }
    });
    return byDriver;
}

function driverAlreadyReservedAnotherPassenger(tripDocs, driverId, excludeTripId = null) {
    return tripDocs.some((d) => {
        if (excludeTripId && d.id === excludeTripId) return false;
        const t = d.data();
        return t.driverId === driverId
            && t.status === 'accepted'
            && t.driverFinishingOtherTrip;
    });
}

/** Correos con permiso de moderación aunque el rol en BD quedó desfasado. */
const KNOWN_STAFF_EMAILS = new Set([
    ADMIN_EMAIL,
    'sozajob146@gmail.com',
]);

async function resolveCallerAdminEmail(auth) {
    if (!auth?.uid) return '';
    let email = String(auth.token?.email || '').trim().toLowerCase();
    if (email) return email;
    try {
        const rec = await getAuth().getUser(auth.uid);
        return String(rec.email || '').trim().toLowerCase();
    } catch (_) {
        return '';
    }
}

async function assertCallerIsSupremeAdmin(auth) {
    const email = await resolveCallerAdminEmail(auth);
    if (!auth?.uid || email !== ADMIN_EMAIL) {
        throw new HttpsError('permission-denied', 'Solo el administrador supremo puede hacer esto.');
    }
    return auth.uid;
}

function callerLooksLikeStaff(pub, priv, email) {
    return pub.role === 'supervisor' || priv.role === 'supervisor'
        || !!pub.staffGrantedBy || !!priv.staffGrantedBy
        || KNOWN_STAFF_EMAILS.has(email);
}

async function healStaffProfileIfNeeded(uid, email, pub, priv, pubRef, privRef) {
    if (email === ADMIN_EMAIL) return;
    const already = pub.role === 'supervisor' || priv.role === 'supervisor'
        || pub.staffGrantedBy || priv.staffGrantedBy;
    if (already) return;
    if (!KNOWN_STAFF_EMAILS.has(email)) return;

    let grantBy = pub.staffGrantedBy || priv.staffGrantedBy || null;
    if (!grantBy) {
        const settingsSnap = await db.doc(`artifacts/${APP_ID}/public/data/appSettings/main`).get();
        grantBy = settingsSnap.data()?.adminUid || uid;
    }
    const heal = {
        role: 'supervisor',
        staffGrantedBy: grantBy,
        staffGrantedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };
    await pubRef.set(heal, { merge: true });
    await privRef.set(heal, { merge: true });
}

/** Admin supremo o supervisor — para moderar perfiles sin depender de reglas del cliente. */
async function assertCallerCanModerate(auth) {
    if (!auth?.uid) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const email = await resolveCallerAdminEmail(auth);
    if (email === ADMIN_EMAIL) {
        return { uid: auth.uid, isAdmin: true };
    }

    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${auth.uid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${auth.uid}/profile/data`);
    const [pubSnap, privSnap] = await Promise.all([pubRef.get(), privRef.get()]);
    const pub = pubSnap.exists ? (pubSnap.data() || {}) : {};
    const priv = privSnap.exists ? (privSnap.data() || {}) : {};

    if (!callerLooksLikeStaff(pub, priv, email)) {
        throw new HttpsError(
            'permission-denied',
            'Tu cuenta no tiene permisos de supervisor en Firestore. Cierra sesión y vuelve a entrar.'
        );
    }

    await healStaffProfileIfNeeded(auth.uid, email, pub, priv, pubRef, privRef);
    return { uid: auth.uid, isAdmin: false };
}

const MODERATION_FORBIDDEN_FIELDS = new Set(['role', 'uid', 'email']);

function normalizeReferralCode(code) {
    return (code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function buildModerationPatch(rawFields) {
    const patch = { updatedAt: FieldValue.serverTimestamp() };
    if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
        return patch;
    }
    for (const [key, value] of Object.entries(rawFields)) {
        if (MODERATION_FORBIDDEN_FIELDS.has(key)) continue;
        if (value === '__SERVER_TIMESTAMP__') {
            patch[key] = FieldValue.serverTimestamp();
        } else if (value !== undefined) {
            patch[key] = value;
        }
    }
    return patch;
}

async function handleReferralCodeReassignment(targetUid, newCodeRaw, currentProfile = {}) {
    const newCode = normalizeReferralCode(newCodeRaw);
    if (!newCode || newCode.length < 3) {
        throw new HttpsError('invalid-argument', 'Código de referido inválido. Debe tener al menos 3 caracteres alfanuméricos.');
    }

    const currentCode = currentProfile.referralCode || null;
    if (currentCode === newCode) {
        return; // sin cambios
    }

    const codesCol = db.collection(`artifacts/${APP_ID}/public/data/referral_codes`);

    // Verificar unicidad
    const existingSnap = await codesCol.doc(newCode).get();
    if (existingSnap.exists && existingSnap.data()?.uid !== targetUid) {
        throw new HttpsError('already-exists', 'Ese código de referido ya está asignado a otro usuario.');
    }

    // Eliminar código anterior si pertenecía a este usuario
    if (currentCode && currentCode !== newCode) {
        const oldDoc = codesCol.doc(currentCode);
        try {
            const oldSnap = await oldDoc.get();
            if (oldSnap.exists && oldSnap.data()?.uid === targetUid) {
                await oldDoc.delete();
            }
        } catch (_) {}
    }

    // Crear/actualizar el nuevo mapping (usando Admin SDK)
    await codesCol.doc(newCode).set({
        uid: targetUid,
        name: currentProfile.name || 'Usuario',
        role: currentProfile.role || 'client',
        updatedAt: FieldValue.serverTimestamp(),
        reassignedByAdmin: true
    }, { merge: true });
}

async function stampAdminUidInSettings(adminUid) {
    await db.doc(`artifacts/${APP_ID}/public/data/appSettings/main`).set({
        adminUid,
        adminEmail: ADMIN_EMAIL,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}

/** Quita rol/email admin falso en perfiles que no son el admin supremo. */
async function scrubNonSupremeAdminProfile(uid) {
    if (!uid) return { ok: false, reason: 'no_uid' };

    let authEmail = '';
    try {
        const authRec = await getAuth().getUser(uid);
        authEmail = String(authRec.email || '').trim().toLowerCase();
        if (authRec.customClaims && Object.keys(authRec.customClaims).length > 0) {
            await getAuth().setCustomUserClaims(uid, null);
        }
    } catch (_) {
        return { ok: false, reason: 'auth_user_not_found' };
    }

    if (authEmail === ADMIN_EMAIL) {
        return { ok: true, skipped: true, reason: 'is_supreme_admin' };
    }

    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${uid}/profile/data`);
    const pubSnap = await pubRef.get();
    const privSnap = await privRef.get();
    const pub = pubSnap.exists ? (pubSnap.data() || {}) : {};
    const priv = privSnap.exists ? (privSnap.data() || {}) : {};

    const pubEmail = String(pub.email || '').trim().toLowerCase();
    const privEmail = String(priv.email || '').trim().toLowerCase();
    const fakeAdminEmail = pubEmail === ADMIN_EMAIL || privEmail === ADMIN_EMAIL;
    const fakeAdminRole = pub.role === 'admin' || priv.role === 'admin';
    const isSupervisor = pub.role === 'supervisor' || priv.role === 'supervisor'
        || pub.staffGrantedBy || priv.staffGrantedBy;

    if (!fakeAdminEmail && !fakeAdminRole) {
        return { ok: true, changed: false };
    }

    const fix = { updatedAt: FieldValue.serverTimestamp() };
    if (fakeAdminRole) {
        fix.role = isSupervisor ? 'supervisor' : 'client';
        if (fix.role !== 'supervisor') {
            fix.staffGrantedBy = null;
            fix.staffGrantedAt = null;
        }
    }
    if (fakeAdminEmail && authEmail) {
        fix.email = authEmail;
    }

    await pubRef.set(fix, { merge: true });
    await privRef.set(fix, { merge: true });

    return { ok: true, changed: true, uid, fix };
}

/** Admin supremo: repara perfil de un usuario (quita admin falso). */
exports.repairUserProfile = onCall(async (request) => {
    await assertCallerIsSupremeAdmin(request.auth);
    const targetUid = String(request.data?.targetUid || '').trim();
    const targetEmail = String(request.data?.targetEmail || '').trim().toLowerCase();
    let uid = targetUid;
    if (!uid && targetEmail) {
        const rec = await getAuth().getUserByEmail(targetEmail);
        uid = rec.uid;
    }
    if (!uid) {
        throw new HttpsError('invalid-argument', 'UID o targetEmail requerido.');
    }
    return scrubNonSupremeAdminProfile(uid);
});

/** Registra el UID del admin en appSettings (para reglas Firestore). */
exports.syncAdminUid = onCall(async (request) => {
    const adminUid = await assertCallerIsSupremeAdmin(request.auth);
    await stampAdminUidInSettings(adminUid);
    return { ok: true, adminUid };
});

/** Cambia rol de un usuario — Admin SDK, sin depender de reglas del cliente. */
/** Sincroniza perfil privado desde el público (arregla desfase supervisor/client). */
exports.syncMyProfileFromPublic = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    await scrubNonSupremeAdminProfile(uid);

    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${uid}/profile/data`);
    const pubSnap = await pubRef.get();
    if (!pubSnap.exists) {
        return { ok: false, reason: 'no_public_profile' };
    }

    const pub = pubSnap.data() || {};
    const role = pub.role || 'client';
    const patch = {
        role,
        name: pub.name || null,
        email: pub.email || null,
        phone: pub.phone || null,
        photo: pub.photo || null,
        staffGrantedBy: pub.staffGrantedBy || null,
        staffGrantedAt: pub.staffGrantedAt || null,
        updatedAt: FieldValue.serverTimestamp(),
    };

    await privRef.set(patch, { merge: true });
    return { ok: true, role };
});

const REGISTRATION_FORBIDDEN_FIELDS = new Set([
    'staffGrantedBy', 'staffGrantedAt', 'role', 'uid', 'email',
]);

const REGISTRATION_STAFF_ROLES = new Set(['admin', 'supervisor']);

function buildRegistrationPatch(rawProfile, uid, authEmail, existingRole) {
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
        throw new HttpsError('invalid-argument', 'Perfil inválido.');
    }

    const hasExplicitRole = rawProfile.role != null && String(rawProfile.role).trim() !== '';
    const role = hasExplicitRole
        ? String(rawProfile.role).trim()
        : String(existingRole || 'client').trim();

    if (hasExplicitRole && !['client', 'driver'].includes(role)) {
        throw new HttpsError('invalid-argument', 'Solo puedes registrarte como pasajero o conductor.');
    }

    const patch = { updatedAt: FieldValue.serverTimestamp() };
    const normalizedExisting = existingRole ? String(existingRole).trim() : null;

    if (!normalizedExisting) {
        patch.uid = uid;
        patch.email = authEmail || rawProfile.email || null;
        patch.role = (hasExplicitRole && ['client', 'driver'].includes(role))
            ? role
            : 'client';
    } else if (!REGISTRATION_STAFF_ROLES.has(normalizedExisting)) {
        if (hasExplicitRole && role !== normalizedExisting) {
            if (normalizedExisting === 'client' && role === 'driver') {
                patch.role = 'driver';
            } else {
                throw new HttpsError(
                    'failed-precondition',
                    'No puedes cambiar el rol de esta cuenta.'
                );
            }
        }
    }

    for (const [key, value] of Object.entries(rawProfile)) {
        if (REGISTRATION_FORBIDDEN_FIELDS.has(key)) continue;
        if (value === '__SERVER_TIMESTAMP__') {
            patch[key] = FieldValue.serverTimestamp();
        } else if (value !== undefined) {
            patch[key] = value;
        }
    }

    return patch;
}

/** Registro inicial o reenvío de perfil (pasajero/conductor) vía Admin SDK. */
exports.registerUserProfile = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const authEmail = await resolveCallerAdminEmail(request.auth);
    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${uid}/profile/data`);
    const [pubSnap, privSnap] = await Promise.all([pubRef.get(), privRef.get()]);
    const existingRole = pubSnap.exists
        ? pubSnap.data()?.role
        : (privSnap.exists ? privSnap.data()?.role : null);

    const rawProfile = request.data?.profile || {};
    const hasExplicitRole = rawProfile.role != null && String(rawProfile.role).trim() !== '';

    if (REGISTRATION_STAFF_ROLES.has(existingRole) && hasExplicitRole) {
        throw new HttpsError(
            'failed-precondition',
            'Esta cuenta ya tiene rol de personal. Cierra sesión y usa una cuenta nueva.'
        );
    }

    const patch = buildRegistrationPatch(rawProfile, uid, authEmail, existingRole);
    await pubRef.set(patch, { merge: true });
    await privRef.set(patch, { merge: true });

    return { ok: true, uid, role: patch.role || existingRole || 'client' };
});

/** Aceptar términos y condiciones — siempre vía Admin SDK (sin depender de reglas cliente). */
exports.acceptTermsProfile = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const acceptedAt = String(request.data?.termsAcceptedAt || new Date().toISOString());
    const patch = {
        termsAccepted: true,
        termsAcceptedAt: acceptedAt,
        updatedAt: FieldValue.serverTimestamp(),
    };

    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${uid}/profile/data`);

    await pubRef.set(patch, { merge: true });
    await privRef.set(patch, { merge: true });

    return { ok: true, uid, termsAcceptedAt: acceptedAt };
});

function serializePayoutRecord(doc) {
    const data = doc.data() || {};
    return {
        id: doc.id,
        driverId: data.driverId || '',
        driverName: data.driverName || '',
        driverPhone: data.driverPhone || '',
        driverEmail: data.driverEmail || '',
        payoutBank: data.payoutBank || '',
        payoutAccount: data.payoutAccount || '',
        payoutHolder: data.payoutHolder || '',
        amount: parseFloat(data.amount) || 0,
        previousBalance: data.previousBalance != null ? parseFloat(data.previousBalance) : null,
        newBalance: data.newBalance != null ? parseFloat(data.newBalance) : null,
        receiptPhoto: data.receiptPhoto || '',
        paidBy: data.paidBy || '',
        paidByName: data.paidByName || '',
        createdAtMs: data.createdAt?.toMillis?.() || 0,
    };
}

/** Historial de pagos del conductor (evita permission-denied en list con reglas OR). */
exports.getMyDriverPayoutRecords = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const snap = await db.collection(`artifacts/${APP_ID}/public/data/driver_payout_records`)
        .where('driverId', '==', uid)
        .limit(200)
        .get();

    const records = snap.docs
        .map(serializePayoutRecord)
        .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

    return { ok: true, records };
});

const ACCEPT_TRIP_FIELDS = new Set([
    'status', 'driverId', 'driverName', 'driverPhone', 'driverPhoto', 'driverVehicle', 'driverVehiclePhotos',
    'driverDocumentsPhotos', 'driverVehicleType', 'serviceType', 'driverIdentity', 'driverRating',
    'pin', 'driverArrived', 'acceptedAt', 'offeredToDriverId', 'offeredToDriverName', 'offerSentAt',
    'offerDistanceKm', 'driverFinishingOtherTrip', 'driverBusyOnTripId',
    'saldoCharged', 'saldoChargedAmount', 'saldoChargedAt',
]);

function sanitizeTripAcceptFields(raw) {
    const patch = {};
    for (const [key, value] of Object.entries(raw || {})) {
        if (!ACCEPT_TRIP_FIELDS.has(key) || value === undefined) continue;
        patch[key] = value === '__SERVER_TIMESTAMP__' ? FieldValue.serverTimestamp() : value;
    }
    return patch;
}

async function deductPassengerSaldoAdmin(clientId, amount) {
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (!clientId || amt <= 0) return null;

    const clientPubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${clientId}`);
    const clientPrivRef = db.doc(`artifacts/${APP_ID}/users/${clientId}/profile/data`);

    const newBal = await db.runTransaction(async (tx) => {
        const snap = await tx.get(clientPubRef);
        const bal = snap.exists ? (parseFloat(snap.data()?.balance) || 0) : 0;
        if (bal < amt) {
            throw new HttpsError('failed-precondition', 'El pasajero no tiene saldo suficiente.');
        }
        const next = Math.round((bal - amt) * 100) / 100;
        tx.update(clientPubRef, { balance: next });
        return next;
    });

    await clientPrivRef.set({ balance: newBal }, { merge: true });
    return newBal;
}

async function creditPassengerSaldoAdmin(clientId, amount) {
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (!clientId || amt <= 0) return null;

    const clientPubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${clientId}`);
    const clientPrivRef = db.doc(`artifacts/${APP_ID}/users/${clientId}/profile/data`);

    const newBal = await db.runTransaction(async (tx) => {
        const snap = await tx.get(clientPubRef);
        const bal = snap.exists ? (parseFloat(snap.data()?.balance) || 0) : 0;
        const next = Math.round((bal + amt) * 100) / 100;
        tx.update(clientPubRef, { balance: next });
        return next;
    });

    await clientPrivRef.set({ balance: newBal }, { merge: true });
    return newBal;
}

async function assertCallerIsApprovedDriver(uid) {
    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${uid}/profile/data`);
    const [pubSnap, privSnap] = await Promise.all([pubRef.get(), privRef.get()]);
    const role = pubSnap.data()?.role || privSnap.data()?.role || '';
    if (role !== 'driver') {
        throw new HttpsError('permission-denied', 'Solo conductores aprobados pueden aceptar viajes.');
    }
    const pub = pubSnap.data() || {};
    const priv = privSnap.data() || {};
    const approvalStatus = pub.approvalStatus ?? priv.approvalStatus;

    const isExplicitlyBad = ['pending', 'rejected', 'suspended'].includes(approvalStatus);

    // Extra safety: if the top-level status is weird but they have at least one approved vehicle, let them operate
    const hasApprovedVehicle = (pub.vehicles || priv.vehicles || []).some(v => v.approvalStatus === 'approved')
        || (pub.approvalStatus === 'approved') || (priv.approvalStatus === 'approved');

    if (isExplicitlyBad && !hasApprovedVehicle) {
        throw new HttpsError('failed-precondition', 'Tu cuenta aún no está aprobada.');
    }
    return { pubRef, privRef, profile: { ...(privSnap.data() || {}), ...(pubSnap.data() || {}) } };
}

/** Aceptar viaje como conductor — Admin SDK (sin depender de reglas cliente). */
exports.acceptDriverTrip = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const tripId = String(request.data?.tripId || '').trim();
    if (!tripId) {
        throw new HttpsError('invalid-argument', 'ID de viaje requerido.');
    }

    const { pubRef, privRef } = await assertCallerIsApprovedDriver(uid);

    const tripRef = db.doc(`artifacts/${APP_ID}/public/data/trips/${tripId}`);
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) {
        throw new HttpsError('not-found', 'Este viaje ya no existe.');
    }

    const trip = tripSnap.data() || {};
    if (trip.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Otro conductor ya tomó este viaje.');
    }
    if (trip.driverId && trip.driverId !== uid) {
        throw new HttpsError('failed-precondition', 'Otro conductor ya tomó este viaje.');
    }
    const marketplaceBids = trip.driverBids && typeof trip.driverBids === 'object'
        ? Object.keys(trip.driverBids)
        : [];
    const hasMyBid = marketplaceBids.includes(uid);
    const isPassengerCounterTarget = trip.passengerCounterTargetDriverId === uid
        || (trip.negotiatedBy === 'passenger' && trip.driverBids?.[uid]?.passengerCounterPrice != null);
    if (!hasMyBid && !isPassengerCounterTarget && marketplaceBids.length === 0
        && trip.offeredToDriverId && trip.offeredToDriverId !== uid) {
        throw new HttpsError('failed-precondition', 'Esta oferta ya fue para otro conductor.');
    }

    const patch = sanitizeTripAcceptFields(request.data?.acceptFields);
    patch.status = 'accepted';
    patch.driverId = uid;
    patch.offeredToDriverId = null;
    patch.offeredToDriverName = null;
    patch.candidateDriverIds = [];

    const isBirthdayGift = trip.birthdayFree || trip.paymentMethod === 'birthday_gift';
    if (trip.paymentMethod === 'saldo' && !isBirthdayGift && !patch.saldoCharged) {
        const chargeAmount = parseFloat(trip.passengerPaysAmount)
            ?? parseFloat(trip.priceNum)
            ?? parseFloat(trip.price)
            ?? 0;
        if (chargeAmount > 0 && trip.clientId) {
            await deductPassengerSaldoAdmin(trip.clientId, chargeAmount);
            patch.saldoCharged = true;
            patch.saldoChargedAmount = chargeAmount;
            patch.saldoChargedAt = FieldValue.serverTimestamp();
        }
    }

    await tripRef.update(patch);

    const driverSync = request.data?.driverSync;
    if (driverSync && typeof driverSync === 'object' && !Array.isArray(driverSync)) {
        const syncPatch = { ...driverSync, role: 'driver', uid, updatedAt: FieldValue.serverTimestamp() };
        delete syncPatch.staffGrantedBy;
        delete syncPatch.staffGrantedAt;
        await pubRef.set(syncPatch, { merge: true });
        await privRef.set(syncPatch, { merge: true });
    }

    const queuedTripId = request.data?.queuedTripId;
    if (queuedTripId) {
        await pubRef.set({ queuedTripId: String(queuedTripId) }, { merge: true });
        await privRef.set({ queuedTripId: String(queuedTripId) }, { merge: true });
    }

    return { ok: true, tripId, driverBusy: !!patch.driverFinishingOtherTrip };
});

async function refundTripSaldoIfNeeded(tripRef, trip) {
    if (trip.paymentMethod !== 'saldo' || !trip.saldoCharged || trip.saldoRefunded) {
        return { skipped: true, reason: 'no_refund_needed' };
    }
    const amount = trip.saldoChargedAmount || parseFloat(trip.priceNum) || parseFloat(trip.price) || 0;
    if (amount <= 0 || !trip.clientId) {
        return { skipped: true, reason: 'invalid_amount' };
    }
    await creditPassengerSaldoAdmin(trip.clientId, amount);
    await tripRef.update({
        saldoRefunded: true,
        saldoRefundedAt: FieldValue.serverTimestamp(),
        needsSaldoRefund: false
    });
    return { refunded: amount, clientId: trip.clientId };
}

/**
 * Cancelar viaje — pasajero o conductor (Admin SDK, sin depender de reglas cliente).
 */
exports.cancelTrip = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const tripId = String(request.data?.tripId || '').trim();
    if (!tripId) {
        throw new HttpsError('invalid-argument', 'ID de viaje requerido.');
    }

    const tripRef = db.doc(`artifacts/${APP_ID}/public/data/trips/${tripId}`);
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) {
        throw new HttpsError('not-found', 'El viaje no existe o ya fue eliminado.');
    }

    const trip = tripSnap.data() || {};
    const isClient = trip.clientId === uid;
    const isDriver = trip.driverId === uid;
    const cancellableStatuses = ['pending', 'accepted', 'in_progress', 'scheduled'];

    if (!cancellableStatuses.includes(trip.status)) {
        throw new HttpsError('failed-precondition', 'Este viaje ya no se puede cancelar.');
    }

    if (trip.status === 'pending' || trip.status === 'scheduled') {
        if (!isClient) {
            throw new HttpsError('permission-denied', 'Solo el pasajero puede cancelar esta solicitud.');
        }
    } else if (!isClient && !isDriver) {
        throw new HttpsError('permission-denied', 'No participas en este viaje.');
    }

    const previousStatus = trip.status;
    await tripRef.update({
        status: 'cancelled',
        cancelledBy: uid,
        cancelledFromStatus: previousStatus,
        cancelledAt: FieldValue.serverTimestamp(),
        offeredToDriverId: null,
        offeredToDriverName: null,
        candidateDriverIds: [],
        offerSentAt: null,
        offerDistanceKm: null,
        offerToBusyDriver: false,
        offerSearchTier: null
    });

    let refund = { skipped: true };
    try {
        refund = await refundTripSaldoIfNeeded(tripRef, trip);
    } catch (e) {
        console.error('cancelTrip refund error:', e);
    }

    return {
        ok: true,
        tripId,
        cancelledFromStatus: previousStatus,
        cancelledBy: uid,
        ...refund
    };
});

/**
 * Refund de saldo al pasajero cuando se cancela un viaje (Admin SDK).
 * Llamable por cliente o conductor del viaje (verifica participación).
 */
exports.refundCancelledTrip = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const tripId = String(request.data?.tripId || '').trim();
    if (!tripId) {
        throw new HttpsError('invalid-argument', 'ID de viaje requerido.');
    }

    const tripRef = db.doc(`artifacts/${APP_ID}/public/data/trips/${tripId}`);
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) {
        throw new HttpsError('not-found', 'El viaje no existe.');
    }

    const trip = tripSnap.data() || {};

    const isParticipant = (trip.clientId === uid) || (trip.driverId === uid);
    if (!isParticipant) {
        throw new HttpsError('permission-denied', 'No participas en este viaje.');
    }

    // Solo reembolsamos si aplica
    if (trip.paymentMethod !== 'saldo' || !trip.saldoCharged || trip.saldoRefunded) {
        return { ok: true, skipped: true, reason: 'no_refund_needed' };
    }

    const amount = trip.saldoChargedAmount || parseFloat(trip.priceNum) || parseFloat(trip.price) || 0;
    if (amount <= 0 || !trip.clientId) {
        return { ok: true, skipped: true, reason: 'invalid_amount' };
    }

    try {
        const refund = await refundTripSaldoIfNeeded(tripRef, trip);
        return { ok: true, ...refund };
    } catch (e) {
        console.error('refundCancelledTrip error:', e);
        throw new HttpsError('internal', 'No se pudo procesar el reembolso.');
    }
});

/** Escribe campos de moderación (bloquear, aprobar, sancionar) vía Admin SDK. */
exports.moderateUserProfile = onCall(async (request) => {
    const caller = await assertCallerCanModerate(request.auth);
    const targetUid = String(request.data?.targetUid || '').trim();
    if (!targetUid) {
        throw new HttpsError('invalid-argument', 'UID de usuario requerido.');
    }
    if (targetUid === caller.uid) {
        throw new HttpsError('invalid-argument', 'No puedes moderarte a ti mismo.');
    }

    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${targetUid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${targetUid}/profile/data`);
    const targetSnap = await pubRef.get();
    if (targetSnap.exists && targetSnap.data()?.role === 'admin') {
        throw new HttpsError('permission-denied', 'No se puede moderar una cuenta admin.');
    }

    // Referral code change: SOLO admin supremo
    const fields = request.data?.fields || {};
    if (typeof fields.referralCode !== 'undefined') {
        if (!caller.isAdmin) {
            throw new HttpsError('permission-denied', 'Solo el administrador puede cambiar códigos de referido.');
        }
        await handleReferralCodeReassignment(targetUid, fields.referralCode, targetSnap.exists ? (targetSnap.data() || {}) : {});
    }

    const patchInput = (typeof fields.referralCode !== 'undefined')
        ? { ...fields, referralCode: normalizeReferralCode(fields.referralCode) }
        : fields;
    const patch = buildModerationPatch(patchInput);
    await pubRef.set(patch, { merge: true });
    await privRef.set({ uid: targetUid, ...patch }, { merge: true });

    return { ok: true, targetUid };
});

exports.setUserRole = onCall(async (request) => {
    const adminUid = await assertCallerIsSupremeAdmin(request.auth);
    const targetUid = String(request.data?.targetUid || '').trim();
    const newRole = String(request.data?.newRole || '').trim();

    if (!targetUid) {
        throw new HttpsError('invalid-argument', 'UID de usuario requerido.');
    }
    if (!['client', 'driver', 'supervisor'].includes(newRole)) {
        throw new HttpsError('invalid-argument', 'Rol no válido.');
    }

    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${targetUid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${targetUid}/profile/data`);
    const pubSnap = await pubRef.get();
    const currentRole = pubSnap.exists ? pubSnap.data().role : null;

    if (currentRole === 'admin' && newRole !== 'client') {
        throw new HttpsError('failed-precondition', 'Rol admin en BD solo se degrada a pasajero.');
    }

    const patch = {
        role: newRole,
        updatedAt: FieldValue.serverTimestamp(),
    };
    if (newRole === 'supervisor') {
        patch.staffGrantedBy = adminUid;
        patch.staffGrantedAt = FieldValue.serverTimestamp();
    } else if (currentRole === 'supervisor') {
        patch.staffGrantedBy = null;
        patch.staffGrantedAt = null;
    }

    await pubRef.set(patch, { merge: true });
    await privRef.set(patch, { merge: true });
    await stampAdminUidInSettings(adminUid);

    return { ok: true, targetUid, newRole };
});

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function driverCanServeTrip(driverVehicleType, tripServiceType) {
    const driverRaw = (driverVehicleType || 'auto').toLowerCase();
    const trip = tripServiceType || 'auto';
    const isVipTrip = (trip === 'auto' || trip === 'vip' || trip === 'taxi_vip');
    const isVipDriver = (driverRaw === 'auto' || driverRaw === 'vip' || driverRaw === 'taxi_vip');
    if (trip === 'taxi') return driverRaw === 'taxi';
    if (isVipTrip) return isVipDriver;
    if (trip === 'flete_paila') return driverRaw === 'paila';
    if (trip === 'flete_camion') return driverRaw === 'camion';
    if (trip === 'moto' || trip === 'delivery') return driverRaw === 'moto';
    return false;
}

function isDriverOnline(loc) {
    if (!loc || loc.online === false) return false;
    const updated = loc.updatedAt || 0;
    return Date.now() - updated <= ONLINE_STALE_MS;
}

function isFreightService(type) {
    return type === 'flete_paila' || type === 'flete_camion';
}

function requiredFreightVehicleType(tripServiceType) {
    if (tripServiceType === 'flete_paila') return 'paila';
    if (tripServiceType === 'flete_camion') return 'camion';
    return null;
}

function normalizeVehicleTypeForMatching(t) {
    const d = (t || 'auto').toLowerCase().trim();
    if (['vip', 'taxi_vip', 'auto'].includes(d)) return 'auto';
    return d;
}

function driverHasApprovedVehicleType(userData, vehicleType) {
    if (!userData || !vehicleType) return false;
    const required = normalizeVehicleTypeForMatching(vehicleType);
    const vehicles = Array.isArray(userData.vehicles) ? userData.vehicles : [];
    if (vehicles.some((v) => v.approvalStatus === 'approved' && normalizeVehicleTypeForMatching(v.type) === required)) return true;
    return userData.approvalStatus === 'approved' && normalizeVehicleTypeForMatching(userData.vehicleType) === required;
}

function requiredRideVehicleType(tripServiceType) {
    const trip = String(tripServiceType || 'auto').toLowerCase();
    if (trip === 'taxi') return 'taxi';
    if (trip === 'auto' || trip === 'vip' || trip === 'taxi_vip') return 'auto';
    if (trip === 'moto' || trip === 'delivery') return 'moto';
    return null;
}

function tripOfferPushTitle(serviceType) {
    const trip = String(serviceType || 'auto').toLowerCase();
    if (trip === 'auto' || trip === 'vip' || trip === 'taxi_vip') {
        return 'HonduRaite · 🚗 ¡Taxi VIP para ti!';
    }
    if (trip === 'taxi') return 'HonduRaite · 🚕 ¡Taxi para ti!';
    if (trip === 'delivery') return 'HonduRaite · 📦 ¡Envío para ti!';
    if (trip === 'moto') return 'HonduRaite · 🏍️ ¡Moto para ti!';
    return 'HonduRaite · ¡Nuevo viaje para ti!';
}

function staffTripNotificationLabel(serviceType) {
    const trip = String(serviceType || 'auto').toLowerCase();
    if (trip === 'auto' || trip === 'vip' || trip === 'taxi_vip') return 'Taxi VIP';
    if (trip === 'taxi') return 'Taxi tradicional';
    if (trip === 'moto') return 'Viaje en moto';
    if (trip === 'delivery') return 'Envío/Comida';
    if (trip === 'flete_paila') return 'Flete paila';
    if (trip === 'flete_camion') return 'Flete camión';
    return 'Viaje';
}

function isRideService(type) {
    return !isFreightService(type) && requiredRideVehicleType(type) !== null;
}

function rideDemandTitle(serviceType) {
    const trip = String(serviceType || 'auto').toLowerCase();
    if (trip === 'auto' || trip === 'vip' || trip === 'taxi_vip') {
        return 'HonduRaite · 🚗 ¡Cliente pide Taxi VIP!';
    }
    if (trip === 'taxi') return 'HonduRaite · 🚕 ¡Cliente pide taxi!';
    if (trip === 'delivery') return 'HonduRaite · 📦 ¡Cliente pide envío!';
    return 'HonduRaite · 🏍️ ¡Cliente pide moto!';
}

/** Canal Android de alta prioridad (v2: fuerza sonido+vibración en clientes viejos). */
// v3: alineado con app — preferimos tono propio en primer plano; canales sin default del SO
// Debe coincidir con js/fcm-push.js (canales v4 + res/raw/hondu_ride|hondu_alert)
const RIDE_ALERT_CHANNEL_ID = 'hondu_ride_alerts_v4';
const DEFAULT_ALERT_CHANNEL_ID = 'hondu_default_v4';
/** Patrón de vibración fuerte (ms) — distintivo HonduRaite. */
const HONDU_SUPER_VIBRATE_MS = [0, 450, 100, 450, 100, 550, 120, 750, 100, 950];
const HONDU_DEFAULT_VIBRATE_MS = [0, 250, 100, 250, 80, 350];

function isHonduRideAlertType(type) {
    return type === 'ride_demand_alert'
        || type === 'trip_offer'
        || type === 'freight_trip_alert'
        || type === 'new_trip_staff';
}

function offlineDriverNearTrip(loc, trip, radiusKm) {
    if (!loc?.lat || !loc?.lng || trip.originLat == null || trip.originLng == null) {
        return true;
    }
    return haversineKm(trip.originLat, trip.originLng, loc.lat, loc.lng) <= radiusKm;
}

/**
 * Avisa a conductores OFFLINE / fuera de sesión (VIP, taxi, moto, envío)
 * cuando un cliente pide viaje — aunque no tengan la app abierta —
 * para que se pongan en línea. Una vez por viaje.
 */
async function notifyOfflineRideDriversWhenNoCoverage(appId, tripId, trip) {
    const serviceType = trip.serviceType || 'auto';
    if (!isRideService(serviceType)) return;
    if (trip.rideOfflineAlertSent || trip.isDemandSimulation) return;
    if (trip.status !== 'pending') return;
    if (trip.originLat == null || trip.originLng == null) return;

    const requiredType = requiredRideVehicleType(serviceType);
    if (!requiredType) return;

    // Si ya hay libres online cerca, priorizamos la oferta a ellos;
    // igual avisamos a offline de la zona para que se activen (más flota).
    // Si no hay nadie online, el mensaje es más urgente.
    const tripDocs = await fetchTripDocsForOffer(appId);
    const onlineNear = await findDriversForTripOffer(appId, trip, tripDocs);
    const hasOnlineCoverage = (onlineNear.candidates?.length || 0) > 0;

    const tripZone = trip.serviceZoneId || null;
    const radius = trip.searchRadiusKm || 25;
    const price = trip.price || 'Nuevo viaje';
    const originShort = (trip.origin || '').slice(0, 48);
    const bodyCore = [String(price), originShort].filter(Boolean).join(' · ');
    const body = hasOnlineCoverage
        ? `${bodyCore} — Hay demanda en tu zona. ¡Entrá en línea!`
        : `${bodyCore} — ¡Nadie en línea cerca! Ponéte en línea YA.`;

    const [driversLocSnap, usersSnap] = await Promise.all([
        db.collection(`artifacts/${appId}/public/data/drivers_location`).get(),
        db.collection(`artifacts/${appId}/public/data/users`).where('role', '==', 'driver').get()
    ]);

    const locByDriver = new Map();
    driversLocSnap.docs.forEach((d) => {
        locByDriver.set(d.id, d.data());
    });

    const notified = new Set();
    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const loc = locByDriver.get(uid);
        // Solo fuera de sesión / offline (no molestar a quien ya está en línea)
        if (loc && isDriverOnline(loc)) continue;

        const u = userDoc.data() || {};
        if (u.approvalStatus && u.approvalStatus !== 'approved') continue;
        if (!driverHasApprovedVehicleType(u, requiredType)) continue;

        const driverZone = u.serviceZoneId || loc?.serviceZoneId || null;
        if (tripZone && driverZone && tripZone !== driverZone) continue;
        if (!offlineDriverNearTrip(loc, trip, radius)) continue;

        notified.add(uid);
        await sendPushToUser(appId, uid, {
            title: rideDemandTitle(serviceType),
            body,
            data: {
                type: 'ride_demand_alert',
                tripId,
                serviceType,
                rideMode: requiredType,
                tag: `ride-demand-${tripId}`,
                openDriver: 'true',
                superVibrate: 'true'
            },
            highPriority: true
        });
    }

    if (notified.size) {
        await db.doc(`artifacts/${appId}/public/data/trips/${tripId}`).update({
            rideOfflineAlertSent: true,
            rideOfflineAlertCount: notified.size,
            rideOfflineAlertAt: FieldValue.serverTimestamp(),
            rideOfflineAlertHadCoverage: hasOnlineCoverage
        }).catch(() => {});
    }
}

async function notifyOfflineFreightDrivers(appId, tripId, trip) {
    const serviceType = trip.serviceType || 'auto';
    if (!isFreightService(serviceType)) return;
    if (trip.freightOfflineAlertSent) return;

    const requiredType = requiredFreightVehicleType(serviceType);
    if (!requiredType) return;

    const tripZone = trip.serviceZoneId || null;
    const modeLabel = serviceType === 'flete_paila' ? 'Paila' : 'Camión';
    const price = trip.price || 'Nuevo flete';
    const originShort = (trip.origin || '').slice(0, 48);
    const cargo = (trip.freightDetails?.cargoDescription || trip.cargoDescription || '').slice(0, 40);
    const bodyParts = [String(price)];
    if (cargo) bodyParts.push(cargo);
    if (originShort) bodyParts.push(originShort);
    const body = bodyParts.join(' · ');

    const [driversLocSnap, usersSnap] = await Promise.all([
        db.collection(`artifacts/${appId}/public/data/drivers_location`).get(),
        db.collection(`artifacts/${appId}/public/data/users`).where('role', '==', 'driver').get()
    ]);

    const onlineDriverIds = new Set();
    driversLocSnap.docs.forEach((d) => {
        if (isDriverOnline(d.data())) onlineDriverIds.add(d.id);
    });

    const notified = new Set();
    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        if (onlineDriverIds.has(uid) || notified.has(uid)) continue;

        const u = userDoc.data() || {};
        if (u.approvalStatus && u.approvalStatus !== 'approved') continue;
        if (!driverHasApprovedVehicleType(u, requiredType)) continue;

        const driverZone = u.serviceZoneId || null;
        if (tripZone && driverZone && tripZone !== driverZone) continue;

        notified.add(uid);
        await sendPushToUser(appId, uid, {
            title: `🚛 ¡Flete ${modeLabel} disponible!`,
            body: `${body} — Actívate para aceptarlo.`,
            data: {
                type: 'freight_trip_alert',
                tripId,
                serviceType,
                freightMode: requiredType,
                tag: `freight-alert-${tripId}`,
                openDriver: 'true',
                superVibrate: 'true'
            },
            highPriority: true
        });
    }

    if (notified.size) {
        await db.doc(`artifacts/${appId}/public/data/trips/${tripId}`).update({
            freightOfflineAlertSent: true,
            freightOfflineAlertCount: notified.size,
            freightOfflineAlertAt: FieldValue.serverTimestamp()
        }).catch(() => {});
    }
}

function getDriversWithActiveOffers(tripDocs, excludeTripId = null) {
    const set = new Set();
    tripDocs.forEach((d) => {
        if (excludeTripId && d.id === excludeTripId) return;
        const t = d.data();
        if (t.status === 'pending') {
            if (t.offeredToDriverId) set.add(t.offeredToDriverId);
            if (Array.isArray(t.candidateDriverIds)) t.candidateDriverIds.forEach(id => set.add(id));
        }
    });
    return set;
}

function isOfferExpired(trip) {
    if (!trip?.offeredToDriverId || !trip?.offerSentAt) return false;
    if (trip.negotiatedBy === 'driver' && trip.negotiatedPrice != null) {
        const negAt = trip.lastNegotiationAt?.toMillis ? trip.lastNegotiationAt.toMillis() : 0;
        if (negAt && Date.now() - negAt < TRIP_OFFER_NEGOTIATION_HOLD_MS) return false;
    }
    const declinedAt = trip.passengerDeclinedNegotiationAt?.toMillis
        ? trip.passengerDeclinedNegotiationAt.toMillis()
        : 0;
    if (declinedAt && Date.now() - declinedAt < TRIP_OFFER_NEGOTIATION_HOLD_MS) return false;
    const sentMs = trip.offerSentAt.toMillis ? trip.offerSentAt.toMillis() : 0;
    return sentMs > 0 && Date.now() - sentMs > TRIP_OFFER_TIMEOUT_MS;
}

async function fetchPendingTripDocs(appId) {
    const snap = await db.collection(`artifacts/${appId}/public/data/trips`)
        .where('status', '==', 'pending')
        .get();
    return snap.docs;
}

async function fetchTripDocsForOffer(appId) {
    const snap = await db.collection(`artifacts/${appId}/public/data/trips`)
        .where('status', 'in', ['pending', 'accepted', 'in_progress'])
        .get();
    return snap.docs;
}

async function collectDriversForTripOffer(appId, trip, tripDocs, { busyOnly = false } = {}) {
    const declined = trip.declinedDriverIds || [];
    const originLat = trip.originLat;
    const originLng = trip.originLng;
    if (originLat == null || originLng == null) return [];

    const tripZone = trip.serviceZoneId || null;
    const driversWithOffers = getDriversWithActiveOffers(tripDocs, trip.id);
    const activeByDriver = getActiveTripByDriver(tripDocs);

    const driversSnap = await db.collection(`artifacts/${appId}/public/data/drivers_location`).get();
    const candidates = [];

    for (const d of driversSnap.docs) {
        const driverId = d.id;
        const isBusy = activeByDriver.has(driverId);
        if (busyOnly && !isBusy) continue;
        if (!busyOnly && isBusy) continue;
        if (declined.includes(driverId)) continue;
        if (driversWithOffers.has(driverId)) continue;
        if (busyOnly && driverAlreadyReservedAnotherPassenger(tripDocs, driverId, trip.id)) continue;

        const loc = d.data();
        if (!loc.lat || !loc.lng || !isDriverOnline(loc)) continue;

        const driverVehicleType = loc.vehicleType || 'auto';
        if (!driverCanServeTrip(driverVehicleType, trip.serviceType || 'auto')) continue;

        const dZone = loc.serviceZoneId;
        if (!tripZone || !dZone || tripZone !== dZone) continue;

        const dist = haversineKm(originLat, originLng, loc.lat, loc.lng);
        candidates.push({
            driverId,
            name: loc.name || 'Conductor',
            distanceKm: Math.round(dist * 10) / 10,
            busy: busyOnly
        });
    }

    candidates.sort((a, b) => a.distanceKm - b.distanceKm);
    const preferredId = trip.preferredDriverId;
    if (preferredId && candidates.some((c) => c.driverId === preferredId)) {
        const pref = candidates.find((c) => c.driverId === preferredId);
        return [pref, ...candidates.filter((c) => c.driverId !== preferredId)];
    }
    return candidates;
}

async function findDriversForTripOffer(appId, trip, tripDocs) {
    const tripZone = trip.serviceZoneId || null;
    const sorted = await collectDriversForTripOffer(appId, trip, tripDocs, { busyOnly: false });
    const { candidates, tier } = pickDriversByProximityTier(sorted, tripZone);
    return { candidates: candidates.slice(0, TRIP_OFFER_POOL_SIZE), tier, busy: false };
}

async function findBusyDriversForTripOffer(appId, trip, tripDocs) {
    const tripZone = trip.serviceZoneId || null;
    const sorted = await collectDriversForTripOffer(appId, trip, tripDocs, { busyOnly: true });
    const { candidates, tier } = pickDriversByProximityTier(sorted, tripZone);
    const busyTier = tier === 'near' ? 'busy_near' : (tier === 'far' ? 'busy_far' : null);
    return { candidates: candidates.slice(0, TRIP_OFFER_POOL_SIZE), tier: busyTier, busy: true };
}

async function assignNextTripOfferServer(appId, tripId) {
    const tripRef = db.doc(`artifacts/${appId}/public/data/trips/${tripId}`);
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) return;

    const trip = { id: tripSnap.id, ...tripSnap.data() };
    if (trip.isDemandSimulation) return;
    if (trip.status !== 'pending' || trip.driverId) return;
    const bidCount = trip.driverBids && typeof trip.driverBids === 'object'
        ? Object.keys(trip.driverBids).length
        : 0;
    if (bidCount > 0) return;
    if (trip.offeredToDriverId && !isOfferExpired(trip)) return;

    const tripDocs = await fetchTripDocsForOffer(appId);

    let offerResult = await findDriversForTripOffer(appId, trip, tripDocs);
    let candidates = offerResult.candidates;
    let offerTier = offerResult.tier;
    let offerToBusyDriver = false;

    if (!candidates.length) {
        offerResult = await findBusyDriversForTripOffer(appId, trip, tripDocs);
        candidates = offerResult.candidates;
        offerTier = offerResult.tier;
        offerToBusyDriver = offerResult.busy && candidates.length > 0;
    }

    if (!candidates.length) {
        console.warn(`[assignNextTripOfferServer] No candidates for trip ${tripId}. zone ${trip.serviceZoneId || 'N/A'}`);
        return;
    }

    const topN = candidates.slice(0, TRIP_OFFER_POOL_SIZE);
    const next = topN[0];

    await db.runTransaction(async (tx) => {
        const fresh = await tx.get(tripRef);
        if (!fresh.exists) return;
        const d = fresh.data();
        if (d.status !== 'pending' || d.driverId) return;
        const liveBidCount = d.driverBids && typeof d.driverBids === 'object'
            ? Object.keys(d.driverBids).length
            : 0;
        if (liveBidCount > 0) return;
        if (d.offeredToDriverId && d.offerSentAt) {
            const sentMs = d.offerSentAt.toMillis ? d.offerSentAt.toMillis() : 0;
            if (sentMs && Date.now() - sentMs <= TRIP_OFFER_TIMEOUT_MS) return;
        }
        tx.update(tripRef, {
            offeredToDriverId: next.driverId,
            offeredToDriverName: next.name,
            offerSentAt: FieldValue.serverTimestamp(),
            offerDistanceKm: next.distanceKm,
            offerToBusyDriver: offerToBusyDriver || !!next.busy,
            offerSearchTier: offerTier || null,
            declinedDriverIds: d.declinedDriverIds || [],
            candidateDriverIds: topN.map((c) => c.driverId)
        });
    });
}

async function getUserTokens(appId, uid) {
    if (!uid) return [];
    const snap = await db.doc(`artifacts/${appId}/public/data/users/${uid}`).get();
    if (!snap.exists) return [];
    const raw = snap.data().fcmTokens || {};
    return Object.values(raw)
        .map((entry) => (typeof entry === 'string' ? entry : entry?.token))
        .filter(Boolean);
}

async function sendPushToUser(appId, uid, { title, body, data = {}, highPriority = false }) {
    const tokens = await getUserTokens(appId, uid);
    if (!tokens.length) return;

    const type = String(data.type || '');
    const rideAlert = data.superVibrate === 'true' || isHonduRideAlertType(type);
    const useHigh = highPriority || rideAlert;

    // Click del push: viajes → conductor; resto → centro de notificaciones
    const openNotifications = data.openNotifications === 'true'
        || (
            data.openChat !== 'true'
            && data.openDriver !== 'true'
            && data.openAdmin !== 'true'
            && data.openReports !== 'true'
            && !isHonduRideAlertType(type)
            && type !== 'chat'
        );

    let link = '/';
    if (data.openReports === 'true') link = '/#admin-reports';
    else if (type === 'trip_offer' || type === 'ride_demand_alert' || data.openDriver === 'true') {
        link = '/#driver';
    } else if (openNotifications || type === 'admin_notify' || type === 'app_update' || type === 'recurring_notify' || type === 'promo_new') {
        link = '/#notifications';
    }

    const dataPayload = {
        ...data,
        title,
        body,
        openNotifications: openNotifications ? 'true' : String(data.openNotifications || 'false')
    };

    // Siempre enviar bloque android con canal+sonido+vibración.
    // Sin channelId, Android 8+ usa un canal silencioso / genérico y "no suena ni vibra".
    const androidChannelId = rideAlert ? RIDE_ALERT_CHANNEL_ID : DEFAULT_ALERT_CHANNEL_ID;
    const androidVibrate = rideAlert ? HONDU_SUPER_VIBRATE_MS : HONDU_DEFAULT_VIBRATE_MS;

    const payload = {
        tokens,
        notification: { title, body },
        data: Object.fromEntries(
            Object.entries(dataPayload).map(([k, v]) => [k, String(v ?? '')])
        ),
        webpush: {
            headers: useHigh ? { Urgency: 'high' } : undefined,
            notification: {
                icon: PUSH_ICON,
                requireInteraction: useHigh || undefined,
                renotify: rideAlert || undefined,
                tag: data.tag || undefined,
                vibrate: rideAlert ? HONDU_SUPER_VIBRATE_MS : HONDU_DEFAULT_VIBRATE_MS
            },
            fcmOptions: { link }
        },
        android: {
            priority: useHigh ? 'high' : 'normal',
            ttl: useHigh ? 120 * 1000 : 3600 * 1000,
            notification: {
                channelId: androidChannelId,
                // Archivos en android/.../res/raw/ (sin extensión). Tonos HonduRaite, no el del sistema.
                sound: rideAlert ? 'hondu_ride' : 'hondu_alert',
                defaultSound: false,
                priority: useHigh ? 'high' : 'default',
                visibility: 'public',
                defaultVibrateTimings: false,
                vibrateTimingsMillis: androidVibrate,
                notificationCount: 1,
                // Mantener en pantalla hasta que el conductor actúe (ofertas)
                sticky: rideAlert || undefined
            }
        },
        apns: {
            headers: {
                'apns-priority': useHigh ? '10' : '5',
                'apns-push-type': 'alert'
            },
            payload: {
                aps: {
                    sound: 'default',
                    'interruption-level': useHigh ? 'time-sensitive' : 'active'
                }
            }
        }
    };

    const res = await getMessaging().sendEachForMulticast(payload);
    const invalid = [];
    res.responses.forEach((r, i) => {
        if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
            invalid.push(tokens[i]);
        }
    });

    if (invalid.length) {
        const updates = {};
        invalid.forEach((token) => {
            updates[`fcmTokens.${token.replace(/\./g, '_')}`] = FieldValue.delete();
        });
        await db.doc(`artifacts/${appId}/public/data/users/${uid}`).update(updates).catch(() => {});
    }
}

async function notifyModerators(appId, { title, body, data = {} }) {
    const snap = await db.collection(`artifacts/${appId}/public/data/users`).get();
    const sent = new Set();

    for (const doc of snap.docs) {
        const u = doc.data() || {};
        const isMod = u.role === 'supervisor' || u.email === ADMIN_EMAIL;
        if (!isMod || sent.has(doc.id)) continue;
        sent.add(doc.id);
        await sendPushToUser(appId, doc.id, {
            title,
            body,
            data: { ...data, openReports: 'true', type: data.type || 'moderation_alert' }
        });
    }
}

async function notifyStaffNewTrip(appId, tripId, trip) {
    const price = trip.price || 'Nuevo';
    const originShort = (trip.origin || '').slice(0, 42);
    const svcLabel = staffTripNotificationLabel(trip.serviceType);
    const title = `🆕 ${svcLabel} pendiente`;
    const body = `${price} · ${originShort || 'Ubicación'}`;

    const snap = await db.collection(`artifacts/${appId}/public/data/users`).get();
    const sent = new Set();

    for (const doc of snap.docs) {
        const u = doc.data() || {};
        const isStaff = u.role === 'supervisor' || u.email === ADMIN_EMAIL || u.role === 'admin';
        if (!isStaff || sent.has(doc.id)) continue;
        sent.add(doc.id);
        await sendPushToUser(appId, doc.id, {
            title,
            body,
            data: {
                type: 'new_trip_staff',
                tripId,
                serviceType: trip.serviceType || '',
                tag: `staff-trip-${tripId}`,
                openAdmin: 'true',
                superVibrate: 'true'
            },
            highPriority: true
        });
    }
}

exports.onTripCreatedAssignOffer = onDocumentCreated(
    'artifacts/{appId}/public/data/trips/{tripId}',
    async (event) => {
        const trip = event.data.data() || {};
        const { appId, tripId } = event.params;
        if (trip.status !== 'pending' || trip.isDemandSimulation || trip.scheduledFor) return;
        await assignNextTripOfferServer(appId, tripId);
        await notifyOfflineFreightDrivers(appId, tripId, trip).catch(() => {});
        await notifyOfflineRideDriversWhenNoCoverage(appId, tripId, trip).catch(() => {});
        await notifyStaffNewTrip(appId, tripId, trip).catch(() => {});
    }
);

exports.expireTripOffers = onSchedule('every 1 minutes', async () => {
    const tripDocs = await fetchPendingTripDocs(APP_ID);
    for (const d of tripDocs) {
        const t = d.data();
        if (!t.offeredToDriverId || !isOfferExpired(t)) continue;
        try {
            await db.doc(`artifacts/${APP_ID}/public/data/trips/${d.id}`).update({
                offeredToDriverId: null,
                offeredToDriverName: null,
                candidateDriverIds: [],
                offerSentAt: null,
                offerDistanceKm: null,
                offerToBusyDriver: false,
                offerSearchTier: null
            });
            await assignNextTripOfferServer(APP_ID, d.id);
        } catch (_) {}
    }

    for (const d of tripDocs) {
        const t = d.data();
        if (t.offeredToDriverId || t.driverId || t.isDemandSimulation) continue;
        const bidCount = t.driverBids && typeof t.driverBids === 'object'
            ? Object.keys(t.driverBids).length
            : 0;
        if (bidCount > 0) continue;
        await assignNextTripOfferServer(APP_ID, d.id).catch(() => {});
    }
});

exports.onTripUpdatePush = onDocumentUpdated(
    'artifacts/{appId}/public/data/trips/{tripId}',
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();
        const { appId, tripId } = event.params;

        const beforeChat = before.chat || [];
        const afterChat = after.chat || [];
        if (afterChat.length > beforeChat.length) {
            const msg = afterChat[afterChat.length - 1];
            const recipientId = msg.sender === after.clientId ? after.driverId : after.clientId;
            if (recipientId && msg.sender !== recipientId) {
                await sendPushToUser(appId, recipientId, {
                    title: msg.senderName || 'Nuevo mensaje',
                    body: (msg.text || '').slice(0, 180),
                    data: {
                        type: 'chat',
                        tripId,
                        openChat: 'true',
                        tag: `chat-${tripId}`
                    }
                });
            }
        }

        const afterBidCount = after.driverBids && typeof after.driverBids === 'object'
            ? Object.keys(after.driverBids).length
            : 0;
        if (
            after.status === 'pending'
            && after.offeredToDriverId
            && after.offeredToDriverId !== before.offeredToDriverId
            && afterBidCount === 0
        ) {
            const isFreight = isFreightService(after.serviceType);
            const dist = after.offerDistanceKm != null ? ` · ${after.offerDistanceKm} km` : '';
            const payLabel = after.paymentMethod === 'saldo' ? ' · Saldo' : '';
            const originShort = (after.origin || '').slice(0, 48);
            const cargo = isFreight
                ? (after.freightDetails?.cargoDescription || '').slice(0, 36)
                : '';
            const busyHint = after.offerToBusyDriver
                ? ' Puedes aceptarlo al terminar tu viaje actual.'
                : '';
            const bodyCore = `${after.price || 'Nueva solicitud'}${dist}${payLabel}`;
            const bodyExtra = cargo || originShort;
            const scheduledMs = getScheduledTripMs(after);
            const minsUntilPickup = scheduledMs > Date.now()
                ? Math.ceil((scheduledMs - Date.now()) / 60000)
                : 0;
            const scheduledHint = minsUntilPickup > 0
                ? ` Recogida programada en ${minsUntilPickup} min (${formatScheduledTripWhen(after.scheduledFor)}).`
                : '';
            const offerTitle = minsUntilPickup > 0
                ? '📅 Viaje programado'
                : (isFreight ? '🚛 ¡Flete disponible!' : tripOfferPushTitle(after.serviceType));
            await sendPushToUser(appId, after.offeredToDriverId, {
                title: offerTitle,
                body: `${bodyCore}${bodyExtra ? ` · ${bodyExtra}` : ''}${scheduledHint}${busyHint}`,
                data: {
                    type: 'trip_offer',
                    tripId,
                    serviceType: after.serviceType || '',
                    scheduledFor: after.scheduledFor || '',
                    tag: `trip-offer-${tripId}`,
                    openDriver: 'true',
                    superVibrate: 'true'
                },
                highPriority: true
            });
        }

        if (before.status === 'pending' && after.status === 'accepted' && after.clientId) {
            const busyBody = after.driverFinishingOtherTrip
                ? `${after.driverName || 'Tu conductor'} ya te reservó. Termina su viaje actual y va hacia ti.`
                : `${after.driverName || 'Un conductor'} aceptó tu viaje y va en camino.`;
            await sendPushToUser(appId, after.clientId, {
                title: after.driverFinishingOtherTrip ? '¡Conductor reservado!' : '¡Conductor asignado!',
                body: busyBody,
                data: { type: 'trip_accepted', tripId, tag: `trip-accepted-${tripId}` }
            });
        }

        if (!before.driverArrived && after.driverArrived && after.clientId) {
            await sendPushToUser(appId, after.clientId, {
                title: 'Tu conductor llegó',
                body: 'Ya está en el punto de encuentro.',
                data: { type: 'trip_arrived', tripId, tag: `trip-arrived-${tripId}` }
            });
        }

        if (before.status !== 'in_progress' && after.status === 'in_progress' && after.driverId) {
            await sendPushToUser(appId, after.driverId, {
                title: 'Viaje iniciado',
                body: 'El pasajero confirmó el PIN. Ve al destino.',
                data: { type: 'trip_started', tripId, tag: `trip-started-${tripId}` }
            });
        }

        if (
            after.status === 'pending'
            && !after.isDemandSimulation
            && !after.rideOfflineAlertSent
            && isRideService(after.serviceType)
            && after.originLat != null
            && after.originLng != null
        ) {
            await notifyOfflineRideDriversWhenNoCoverage(appId, tripId, after).catch(() => {});
        }

        const driverFreed = after.driverId
            && ['accepted', 'in_progress'].includes(before.status)
            && after.status === 'completed';
        if (driverFreed) {
            const pendingDocs = await fetchPendingTripDocs(appId);
            for (const d of pendingDocs) {
                const t = d.data();
                if (t.driverId || t.isDemandSimulation) continue;
                const samePassenger = t.preferredDriverId === after.driverId
                    || (t.clientId && t.clientId === after.clientId);
                const offerFresh = t.offeredToDriverId
                    && t.offerSentAt
                    && !isOfferExpired(t);
                if (samePassenger && t.offeredToDriverId && t.offeredToDriverId !== after.driverId) {
                    await db.doc(`artifacts/${appId}/public/data/trips/${d.id}`).update({
                        offeredToDriverId: null,
                        offeredToDriverName: null,
                        offerSentAt: null,
                        offerDistanceKm: null,
                        candidateDriverIds: [],
                        offerToBusyDriver: false,
                    }).catch(() => {});
                }
                if (samePassenger || !offerFresh || t.offeredToDriverId === after.driverId) {
                    await assignNextTripOfferServer(appId, d.id).catch(() => {});
                }
            }
        }
    }
);

exports.onAppFeedbackPush = onDocumentCreated(
    'artifacts/{appId}/public/data/app_feedback/{feedbackId}',
    async (event) => {
        const d = event.data.data() || {};
        const { appId, feedbackId } = event.params;
        const type = d.type || 'bug_report';

        const titles = {
            crash: '💥 Crash en la app',
            error: '⚠️ Error en la app',
            suggestion: '💡 Nueva sugerencia',
            bug_report: '🐛 Reporte de problema'
        };

        const body = (d.message || d.details || 'Sin detalle').slice(0, 180);
        const who = d.userName ? `${d.userName} (${d.userRole || 'usuario'})` : 'Usuario';

        await notifyModerators(appId, {
            title: titles[type] || '📋 Nuevo reporte',
            body: `${who}: ${body}`,
            data: {
                type: `app_feedback_${type}`,
                tag: `feedback-${feedbackId}`,
                openReports: 'true'
            }
        });
    }
);

exports.onFraudReportPush = onDocumentCreated(
    'artifacts/{appId}/public/data/reports/{reportId}',
    async (event) => {
        const data = event.data.data() || {};
        const { appId } = event.params;
        const isFraud = data.type === 'cancellation_fraud' || (data.text || '').includes('[FRAUDE]');
        const isSafety = data.type === 'cancellation_safety' || (data.text || '').includes('[SEGURIDAD]');
        if (!isFraud && !isSafety) return;

        await notifyModerators(appId, {
            title: isFraud ? '⚠️ Alerta de fraude' : '⚠️ Alerta de seguridad',
            body: (data.text || 'Nuevo reporte').slice(0, 180),
            data: { type: isFraud ? 'fraud_report' : 'safety_report', tag: `report-${event.params.reportId}` }
        });
    }
);

exports.onFraudSurveyPush = onDocumentCreated(
    'artifacts/{appId}/public/data/cancellation_surveys/{surveyId}',
    async (event) => {
        const data = event.data.data() || {};
        const { appId } = event.params;
        if (!data.fraudFlag && !data.safetySerious) return;

        await notifyModerators(appId, {
            title: data.fraudFlag ? '⚠️ Encuesta de fraude' : '⚠️ Alerta de seguridad',
            body: `${data.respondentName || 'Usuario'}: ${data.reasonLabel || data.reason || 'Nueva encuesta'}`,
            data: {
                type: data.fraudFlag ? 'fraud_survey' : 'safety_survey',
                tag: `survey-${event.params.surveyId}`
            }
        });
    }
);

exports.onUserVerifiedPush = onDocumentUpdated(
    'artifacts/{appId}/public/data/users/{userId}',
    async (event) => {
        const before = event.data.before.data() || {};
        const after = event.data.after.data() || {};
        const { appId, userId } = event.params;

        if (before.approvalStatus === after.approvalStatus) return;
        if (before.approvalStatus !== 'pending' || after.approvalStatus !== 'approved') return;

        const roleLabel = after.role === 'driver' ? 'conductor' : 'pasajero';
        await sendPushToUser(appId, userId, {
            title: '¡Cuenta verificada!',
            body: `Tu verificación como ${roleLabel} fue aprobada. Ya puedes usar HonduRaite.`,
            data: { type: 'verification_approved', tag: `verified-${userId}` }
        });
    }
);

exports.onSupportTicketPush = onDocumentCreated(
    'artifacts/{appId}/public/data/support_tickets/{ticketId}',
    async (event) => {
        const d = event.data.data() || {};
        const { appId } = event.params;
        await notifyModerators(appId, {
            title: d.priority === 'high' ? '🚨 Ticket de soporte urgente' : '💬 Nuevo ticket de soporte',
            body: `${d.userName || 'Usuario'}: ${(d.subject || d.message || '').slice(0, 160)}`,
            data: { type: 'support_ticket', tag: `ticket-${event.params.ticketId}`, openReports: 'true' }
        });
    }
);

exports.activateScheduledTrips = onSchedule('every 1 minutes', async () => {
    const appId = APP_ID;
    const now = Date.now();
    const snap = await db.collection(`artifacts/${appId}/public/data/trips`)
        .where('status', '==', 'scheduled')
        .get();

    for (const docSnap of snap.docs) {
        const trip = docSnap.data();
        const scheduledMs = getScheduledTripMs(trip);
        if (!scheduledMs) continue;

        // Activar 10 minutos antes para que conductores reciban oferta y notificación push
        const activateAt = scheduledMs - SCHEDULED_TRIP_PREP_MS;
        if (now < activateAt) continue;

        const isEarly = now < scheduledMs;
        const whenLabel = formatScheduledTripWhen(trip.scheduledFor);

        await docSnap.ref.update({
            status: 'pending',
            activatedAt: FieldValue.serverTimestamp(),
            scheduledEarlyActivated: isEarly,
        });

        await assignNextTripOfferServer(appId, docSnap.id).catch(() => {});
        const activatedTrip = { ...trip, status: 'pending' };
        await notifyOfflineFreightDrivers(appId, docSnap.id, activatedTrip).catch(() => {});
        await notifyOfflineRideDriversWhenNoCoverage(appId, docSnap.id, activatedTrip).catch(() => {});

        if (trip.clientId) {
            await sendPushToUser(appId, trip.clientId, {
                title: isEarly ? 'Buscando conductor para tu viaje programado' : 'Tu viaje programado ya está activo',
                body: isEarly
                    ? `Recogida a las ${whenLabel}. Ya contactamos conductores cercanos.`
                    : 'Estamos buscando conductor para tu viaje.',
                data: { type: 'scheduled_trip_active', tripId: docSnap.id, tag: `scheduled-${docSnap.id}` }
            });
        }
    }
});

exports.onVerificationAlertPush = onDocumentCreated(
    'artifacts/{appId}/public/data/verification_alerts/{alertId}',
    async (event) => {
        const d = event.data.data() || {};
        const { appId } = event.params;
        const roleLabel = d.role === 'driver' ? 'conductor' : 'pasajero';
        const agePart = d.age != null ? ` · ${d.age} años` : '';

        await notifyModerators(appId, {
            title: d.role === 'driver' ? '🪪 Nuevo conductor por verificar' : '🪪 Nuevo pasajero por verificar',
            body: `${d.name || 'Usuario'} (${roleLabel})${agePart} — revisa foto e identidad.`,
            data: {
                type: 'verification_pending',
                tag: `verify-${event.params.alertId}`,
                openReports: 'true'
            }
        });
    }
);

exports.onDriverDepositRequestPush = onDocumentCreated(
    'artifacts/{appId}/public/data/driver_deposit_requests/{requestId}',
    async (event) => {
        const data = event.data.data() || {};
        const { appId } = event.params;
        const amount = parseFloat(data.amount) || 0;

        await notifyModerators(appId, {
            title: 'Nuevo depósito de conductor',
            body: `${data.driverName || 'Conductor'} envió comprobante por L. ${amount.toFixed(2)}`,
            data: { type: 'driver_deposit_pending', tag: `deposit-req-${event.params.requestId}` }
        });
    }
);

exports.onDriverDepositValidatedPush = onDocumentUpdated(
    'artifacts/{appId}/public/data/driver_deposit_requests/{requestId}',
    async (event) => {
        const before = event.data.before.data() || {};
        const after = event.data.after.data() || {};
        const { appId, requestId } = event.params;

        if (before.status === after.status || !after.driverId) return;

        const amount = parseFloat(after.amount) || 0;

        if (after.status === 'approved') {
            await sendPushToUser(appId, after.driverId, {
                title: 'Depósito validado',
                body: `Tu depósito de L. ${amount.toFixed(2)} fue confirmado por un supervisor.`,
                data: { type: 'driver_deposit_approved', tag: `deposit-${requestId}`, amount: String(amount) }
            });
        } else if (after.status === 'rejected') {
            await sendPushToUser(appId, after.driverId, {
                title: 'Depósito rechazado',
                body: 'Tu comprobante no fue aceptado. Envía uno nuevo desde Depósito del Día.',
                data: { type: 'driver_deposit_rejected', tag: `deposit-rejected-${requestId}` }
            });
        }
    }
);

exports.onDriverPayoutBankPush = onDocumentCreated(
    'artifacts/{appId}/public/data/driver_payout_bank_events/{eventId}',
    async (event) => {
        const d = event.data.data() || {};
        const { appId } = event.params;
        await notifyModerators(appId, {
            title: 'Cuenta bancaria de conductor',
            body: `${d.driverName || 'Conductor'} registró ${d.payoutBank || 'banco'} · ${d.payoutAccount || ''}. Saldo a pagar: L. ${(parseFloat(d.driverBalance) || 0).toFixed(2)}`,
            data: { type: 'driver_bank_registered', tag: `bank-${event.params.eventId}` }
        });
        await sendPushToUser(appId, d.driverId, {
            title: 'Cuenta guardada',
            body: `Tu cuenta ${d.payoutBank || ''} fue registrada. Pagos de viajes con saldo: fines de semana.`,
            data: { type: 'driver_bank_saved', tag: `bank-saved-${d.driverId}` }
        });
    }
);

exports.onDriverSessionEventPush = onDocumentCreated(
    'artifacts/{appId}/public/data/driver_session_events/{eventId}',
    async (event) => {
        const d = event.data.data() || {};
        const { appId } = event.params;
        const deposit = parseFloat(d.depositOwed) || 0;
        const saldo = parseFloat(d.saldoPayoutOwed) || 0;
        const contact = `Tel: ${d.phone || 'N/D'} · Email: ${d.email || 'N/D'}`;
        const bank = d.payoutAccount ? `${d.payoutBank || ''} ${d.payoutAccount}` : 'Sin cuenta';

        if (d.type === 'deposit') {
            await notifyModerators(appId, {
                title: 'Conductor cerró turno (depósito)',
                body: `${d.driverName}: depositar L. ${deposit.toFixed(2)}. Le debemos L. ${saldo.toFixed(2)}. ${contact}. Cuenta: ${bank}`,
                data: { type: 'driver_logout_deposit', tag: `sess-${event.params.eventId}` }
            });
        } else {
            await notifyModerators(appId, {
                title: 'Conductor en descanso',
                body: `${d.driverName} tomó descanso. Depósito pendiente: L. ${deposit.toFixed(2)}. ${contact}. Cuenta: ${bank}`,
                data: { type: 'driver_logout_break', tag: `sess-${event.params.eventId}` }
            });
        }
    }
);

exports.onDriverPayoutPaidPush = onDocumentCreated(
    'artifacts/{appId}/public/data/driver_payout_records/{recordId}',
    async (event) => {
        const d = event.data.data() || {};
        const { appId, recordId } = event.params;
        const amount = parseFloat(d.amount) || 0;

        if (!d.driverId) return;

        await sendPushToUser(appId, d.driverId, {
            title: 'Pago recibido',
            body: `Te depositamos L. ${amount.toFixed(2)} por viajes con saldo. Revisa tu cuenta ${d.payoutBank || ''}.`,
            data: { type: 'driver_payout_paid', tag: `payout-${recordId}`, amount: String(amount) }
        });
    }
);

async function expireDriverObjectivesForApp(appId) {
    const now = Timestamp.now();
    const col = db.collection(`artifacts/${appId}/public/data/driver_objectives`);
    const snap = await col.where('status', '==', 'active').where('expiresAt', '<=', now).limit(40).get();
    if (snap.empty) return 0;

    let processed = 0;
    for (const objDoc of snap.docs) {
        const data = objDoc.data() || {};
        const title = data.title || 'Objetivo';
        const reward = data.reward || '';

        const responsesSnap = await objDoc.ref.collection('responses').get();
        const hasUnpaidCompleted = responsesSnap.docs.some((d) => {
            const r = d.data() || {};
            return r.status === 'completed' && !r.rewardPaid;
        });

        const notifyDriverIds = [];
        responsesSnap.docs.forEach((d) => {
            const r = d.data() || {};
            if (r.status === 'completed') return;
            notifyDriverIds.push(d.id);
        });

        if (hasUnpaidCompleted) {
            await objDoc.ref.update({
                status: 'expired',
                expiredAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            const batch = db.batch();
            responsesSnap.docs.forEach((d) => {
                const r = d.data() || {};
                if (r.status === 'completed' || r.status === 'expired') return;
                batch.update(d.ref, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
            });
            await batch.commit();
        } else {
            const batch = db.batch();
            responsesSnap.docs.forEach((d) => batch.delete(d.ref));
            batch.delete(objDoc.ref);
            await batch.commit();
        }

        const notifCol = db.collection(`artifacts/${appId}/public/data/notifications`);
        await Promise.all(notifyDriverIds.slice(0, 80).map(async (driverId) => {
            const driverName = (responsesSnap.docs.find((d) => d.id === driverId)?.data() || {}).driverName || 'Conductor';
            await notifCol.add({
                targetRole: 'driver',
                targetUserId: String(driverId),
                targetUserName: driverName,
                personal: true,
                message: `⏱️ El objetivo «${title}» venció sin completarse a tiempo. Recompensa: ${reward}`,
                sentBy: 'system',
                sentByName: 'Sistema',
                createdAt: FieldValue.serverTimestamp(),
                createdAtMs: Date.now(),
                objectiveExpiredAlert: true
            });
        }));

        processed += 1;
    }
    return processed;
}

exports.expireDriverObjectives = onSchedule('every 15 minutes', async () => {
    try {
        await expireDriverObjectivesForApp(APP_ID);
    } catch (e) {
        console.error('expireDriverObjectives:', e);
    }
});

exports.driverDepositReminder9pm = onSchedule(
    {
        schedule: '0 21 * * *',
        timeZone: 'America/Tegucigalpa'
    },
    async () => {
        const snap = await db.collection(`artifacts/${APP_ID}/public/data/users`).get();

        for (const doc of snap.docs) {
            const u = doc.data() || {};
            if (u.role !== 'driver' || !u.driverOnBreak) continue;

            const owed = parseFloat(u.driverLastDepositOwed) || 0;
            if (owed <= 0) continue;

            await sendPushToUser(APP_ID, doc.id, {
                title: 'Recordatorio: depósito de comisión',
                body: `Son las 9:00 p.m. Debes depositar L. ${owed.toFixed(2)}. Los supervisores ya están notificados.`,
                data: { type: 'deposit_reminder_9pm', tag: `9pm-${doc.id}` }
            });

            await notifyModerators(APP_ID, {
                title: 'Recordatorio 9 p.m. — depósito pendiente',
                body: `${u.name || 'Conductor'} aún debe depositar L. ${owed.toFixed(2)}. Tel: ${u.phone || 'N/D'} · ${u.payoutEmail || ''}`,
                data: { type: 'deposit_reminder_mod', tag: `9pm-mod-${doc.id}` }
            });
        }
    }
);

/** Honduras sin DST: mediodía local = 18:00 UTC. */
function getDepositDeadlineMsFromWorkStartAdmin(workStartMs) {
    const start = Number(workStartMs);
    if (!Number.isFinite(start) || start <= 0) return 0;
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Tegucigalpa',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });
    const parts = fmt.formatToParts(new Date(start));
    const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    return Date.UTC(year, month - 1, day + 1, 18, 0, 0);
}

function toMsAdmin(raw) {
    if (raw == null) return 0;
    try {
        if (typeof raw.toDate === 'function') return raw.toDate().getTime();
        if (raw.seconds != null) return raw.seconds * 1000;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        const t = new Date(raw).getTime();
        return Number.isFinite(t) ? t : 0;
    } catch (_) {
        return 0;
    }
}

function isStaffGraceActiveAdmin(u, nowMs) {
    const until = toMsAdmin(u?.depositGraceUntil);
    return until > nowMs;
}

/**
 * Plazo de depósito: 12:00 p.m. del día siguiente al inicio de trabajo.
 * - La comisión de viajes del día NO es deuda hasta consolidar (cierre de turno / cliente / vencer plazo).
 * - 2 h antes: push "tienes 2 horas para depositar"
 * - Al vencer con monto a depositar: force offline + driverOnBreak + depositAutoBlocked
 *   (usa pendingDepositDebt y/o driverLastDepositOwed ya consolidado en cliente al cerrar turno)
 */
exports.enforceDriverDepositDeadlines = onSchedule(
    {
        schedule: 'every 15 minutes',
        timeZone: 'America/Tegucigalpa'
    },
    async () => {
        const snap = await db.collection(`artifacts/${APP_ID}/public/data/users`).get();
        const now = Date.now();
        const twoH = 2 * 60 * 60 * 1000;
        let warned = 0;
        let blocked = 0;

        for (const userDoc of snap.docs) {
            const u = userDoc.data() || {};
            if (u.role !== 'driver') continue;
            if (u.approvalStatus === 'suspended') continue;
            if (isStaffGraceActiveAdmin(u, now)) continue;

            // Solo montos ya consolidados a deuda (o último cierre de turno).
            // La comisión "pendiente de hoy" se consolida en el cliente al vencer / cerrar turno.
            const debt = Math.max(
                0,
                parseFloat(u.pendingDepositDebt) || 0,
                parseFloat(u.driverLastDepositOwed) || 0
            );
            if (debt <= 0.009) continue;

            let workStart = toMsAdmin(u.depositWorkStartedAt) || Number(u.depositWorkStartedAtMs) || 0;
            let deadline = toMsAdmin(u.depositDeadlineAt) || Number(u.depositDeadlineAtMs) || 0;
            if (!workStart && !deadline) {
                // Sin ancla: no inventamos bloqueo aquí; el cliente fija al ir online
                continue;
            }
            if (!deadline && workStart) {
                deadline = getDepositDeadlineMsFromWorkStartAdmin(workStart);
            }
            if (!deadline) continue;

            const uid = userDoc.id;
            const userRef = db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`);
            const privRef = db.doc(`artifacts/${APP_ID}/users/${uid}/profile/data`);
            const msLeft = deadline - now;

            // Aviso 2 horas antes (aún es plazo de depósito del ciclo, no necesariamente "vencida")
            if (msLeft > 0 && msLeft <= twoH && !u.depositWarning2hSent) {
                const body = `Tienes 2 horas para el depósito (L. ${debt.toFixed(2)}). Si no, tu cuenta será inhabilitada por incumplir con el pago.`;
                await userRef.set({
                    depositWarning2hSent: true,
                    depositWarning2hSentAt: FieldValue.serverTimestamp(),
                    depositDeadlineAtMs: deadline,
                    depositDeadlineAt: Timestamp.fromMillis(deadline)
                }, { merge: true });
                try {
                    await privRef.set({
                        depositWarning2hSent: true,
                        depositWarning2hSentAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                } catch (_) {}

                await sendPushToUser(APP_ID, uid, {
                    title: 'Aviso: depósito del día por vencer',
                    body,
                    data: { type: 'deposit_deadline_warning', tag: `dep-warn-${uid}` },
                    highPriority: true
                });
                await db.collection(`artifacts/${APP_ID}/public/data/notifications`).add({
                    targetUserId: uid,
                    targetRole: 'driver',
                    personal: true,
                    type: 'deposit_deadline_warning',
                    title: 'Aviso: depósito del día por vencer',
                    message: body,
                    sentBy: 'system',
                    sentByName: 'Sistema',
                    createdAt: FieldValue.serverTimestamp(),
                    createdAtMs: now
                });
                warned += 1;
            }

            // Plazo vencido → inhabilitar (deuda vencida, no "pendiente del día")
            if (msLeft <= 0 && !u.depositAutoBlocked) {
                const body = `Tu cuenta fue inhabilitada: no depositaste L. ${debt.toFixed(2)} a tiempo (plazo 12:00 p.m. del día siguiente). Eso ya es deuda vencida. Envía el comprobante para reactivarte.`;
                await userRef.set({
                    driverOnBreak: true,
                    depositAutoBlocked: true,
                    depositAutoBlockedAt: FieldValue.serverTimestamp(),
                    depositAutoBlockedReason: 'deposit_deadline_missed',
                    driverLastDepositOwed: debt,
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
                try {
                    await privRef.set({
                        driverOnBreak: true,
                        depositAutoBlocked: true,
                        depositAutoBlockedAt: FieldValue.serverTimestamp(),
                        depositAutoBlockedReason: 'deposit_deadline_missed',
                        driverLastDepositOwed: debt
                    }, { merge: true });
                } catch (_) {}

                try {
                    await db.doc(`artifacts/${APP_ID}/public/data/drivers_location/${uid}`).set({
                        online: false,
                        updatedAt: now
                    }, { merge: true });
                } catch (_) {}

                await sendPushToUser(APP_ID, uid, {
                    title: 'Cuenta inhabilitada — deuda vencida',
                    body,
                    data: { type: 'deposit_auto_blocked', tag: `dep-block-${uid}` },
                    highPriority: true
                });
                await notifyModerators(APP_ID, {
                    title: 'Conductor inhabilitado por deuda vencida',
                    body: `${u.name || 'Conductor'} no depositó L. ${debt.toFixed(2)} a tiempo. Tel: ${u.phone || 'N/D'}`,
                    data: { type: 'deposit_auto_blocked_mod', tag: `dep-block-mod-${uid}` }
                });
                await db.collection(`artifacts/${APP_ID}/public/data/notifications`).add({
                    targetUserId: uid,
                    targetRole: 'driver',
                    personal: true,
                    type: 'deposit_auto_blocked',
                    title: 'Cuenta inhabilitada — deuda vencida',
                    message: body,
                    sentBy: 'system',
                    sentByName: 'Sistema',
                    createdAt: FieldValue.serverTimestamp(),
                    createdAtMs: now
                });
                blocked += 1;
            }
        }

        if (warned || blocked) {
            console.log(`enforceDriverDepositDeadlines: warned=${warned} blocked=${blocked}`);
        }
    }
);

// ============================================================
// PROMOCIONES
// ============================================================

function normalizePromoCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function calcPromoApplication(originalPrice, discountAmount, minSpendPercent = 80) {
    const price = Math.round(parseFloat(originalPrice) * 100) / 100;
    const discount = Math.round(parseFloat(discountAmount) * 100) / 100;
    const pct = Math.min(100, Math.max(1, parseFloat(minSpendPercent) || 80));
    const minFare = Math.round(discount * (pct / 100) * 100) / 100;
    if (!price || !discount || price < minFare) {
        return { eligible: false, minFare, discountApplied: 0, passengerPays: price, subsidyOwed: 0 };
    }
    const discountApplied = Math.min(discount, price);
    const passengerPays = Math.round((price - discountApplied) * 100) / 100;
    return {
        eligible: true,
        minFare,
        discountApplied,
        passengerPays,
        subsidyOwed: discountApplied,
        originalPrice: price
    };
}

function promoTimeMs(val) {
    if (!val) return 0;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds) return val.seconds * 1000;
    if (typeof val === 'number') return val;
    const parsed = new Date(val).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function isPromoCurrentlyActive(promo, now = Date.now()) {
    if (!promo || promo.status !== 'active') return false;
    const fromMs = promo.validFromMs || promoTimeMs(promo.validFrom);
    const untilMs = promo.validUntilMs || promoTimeMs(promo.validUntil);
    if (fromMs && now < fromMs) return false;
    if (untilMs && now > untilMs) return false;
    if (promo.maxUsers && (promo.claimedCount || 0) >= promo.maxUsers) return false;
    return true;
}

async function findPromoByCode(code) {
    const normalized = normalizePromoCode(code);
    if (!normalized) return null;
    const snap = await db.collection(`artifacts/${APP_ID}/public/data/promotions`)
        .where('code', '==', normalized)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ref: doc.ref, data: doc.data() || {} };
}

async function notifyAllPassengersNewPromo(promo, senderName) {
    const usersSnap = await db.collection(`artifacts/${APP_ID}/public/data/users`).get();
    const notifCol = db.collection(`artifacts/${APP_ID}/public/data/notifications`);
    const amt = parseFloat(promo.discountAmount) || 0;
    const title = `🎁 Nueva promo: L. ${amt.toFixed(0)} OFF`;
    const body = `${promo.title || promo.code}: código ${promo.code}. Reclámala en el mapa.`;
    const now = Date.now();

    let batch = db.batch();
    let count = 0;

    for (const userDoc of usersSnap.docs) {
        const u = userDoc.data() || {};
        const role = u.role || 'client';
        if (role !== 'client') continue;

        const notifRef = notifCol.doc();
        batch.set(notifRef, {
            targetRole: 'client',
            targetUserId: userDoc.id,
            targetUserName: u.name || 'Pasajero',
            personal: true,
            message: `${title} — ${body}`,
            promoAlert: true,
            promoId: promo.id || null,
            promoCode: promo.code || '',
            sentBy: 'system',
            sentByName: senderName || 'HonduRaite',
            createdAt: FieldValue.serverTimestamp(),
            createdAtMs: now
        });

        await sendPushToUser(APP_ID, userDoc.id, {
            title,
            body,
            data: { type: 'promo_new', promoCode: promo.code || '', promoId: promo.id || '' }
        });

        count += 1;
        if (count % 400 === 0) {
            await batch.commit();
            batch = db.batch();
        }
    }
    if (count % 400 !== 0) await batch.commit();
    return count;
}

const PROMO_CALLABLE_OPTS = { cors: true, region: 'us-central1' };

exports.publishPromotion = onCall(PROMO_CALLABLE_OPTS, async (request) => {
    const caller = await assertCallerCanModerate(request.auth);
    const data = request.data || {};

    const code = normalizePromoCode(data.code);
    const discountAmount = parseFloat(data.discountAmount);
    const title = String(data.title || '').trim();
    const description = String(data.description || '').trim();
    const minSpendPercent = Math.min(100, Math.max(1, parseFloat(data.minSpendPercent) || 80));
    const maxUsers = parseInt(data.maxUsers, 10) || null;
    const maxBudget = parseFloat(data.maxBudget) || null;
    const maxUsesPerUser = Math.max(1, parseInt(data.maxUsesPerUser, 10) || 1);
    const notifyOnPublish = data.notifyOnPublish !== false;
    const showOnMap = data.showOnMap !== false;

    if (!code || code.length < 3) {
        throw new HttpsError('invalid-argument', 'Código inválido (mín. 3 caracteres).');
    }
    if (!discountAmount || discountAmount <= 0) {
        throw new HttpsError('invalid-argument', 'Valor del bono inválido.');
    }
    if (!title) {
        throw new HttpsError('invalid-argument', 'Título requerido.');
    }

    const existing = await findPromoByCode(code);
    if (existing) {
        throw new HttpsError('already-exists', 'Ya existe una promo con ese código.');
    }

    const validFromMs = data.validFrom ? new Date(data.validFrom).getTime() : Date.now();
    const validUntilMs = data.validUntil ? new Date(data.validUntil).getTime() : null;

    const promoRef = db.collection(`artifacts/${APP_ID}/public/data/promotions`).doc();
    const promoDoc = {
        code,
        title,
        description,
        discountAmount,
        minSpendPercent,
        maxUsers,
        maxBudget,
        maxUsesPerUser,
        claimedCount: 0,
        usedBudget: 0,
        redemptionCount: 0,
        status: 'active',
        notifyOnPublish,
        showOnMap,
        validFrom: validFromMs ? Timestamp.fromMillis(validFromMs) : FieldValue.serverTimestamp(),
        validFromMs: validFromMs || Date.now(),
        validUntil: validUntilMs ? Timestamp.fromMillis(validUntilMs) : null,
        validUntilMs: validUntilMs || null,
        createdBy: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: Date.now()
    };

    await promoRef.set(promoDoc);

    let notified = 0;
    if (notifyOnPublish) {
        const callerSnap = await db.doc(`artifacts/${APP_ID}/public/data/users/${caller.uid}`).get();
        const senderName = callerSnap.exists ? (callerSnap.data().name || 'Supervisor') : 'Supervisor';
        notified = await notifyAllPassengersNewPromo({ ...promoDoc, id: promoRef.id }, senderName);
    }

    return { ok: true, promoId: promoRef.id, notified };
});

exports.managePromotion = onCall(PROMO_CALLABLE_OPTS, async (request) => {
    await assertCallerCanModerate(request.auth);
    const promoId = String(request.data?.promoId || '').trim();
    const action = String(request.data?.action || '').trim();

    if (!promoId) throw new HttpsError('invalid-argument', 'ID de promo requerido.');

    const promoRef = db.doc(`artifacts/${APP_ID}/public/data/promotions/${promoId}`);
    const snap = await promoRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Promoción no encontrada.');

    if (action === 'delete') {
        await promoRef.set({
            status: 'deleted',
            deletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return { ok: true, action };
    }
    if (action === 'pause') {
        await promoRef.set({ status: 'paused', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { ok: true, action };
    }
    if (action === 'activate') {
        await promoRef.set({ status: 'active', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { ok: true, action };
    }
    throw new HttpsError('invalid-argument', 'Acción no válida.');
});

exports.claimPromoCode = onCall(PROMO_CALLABLE_OPTS, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const code = normalizePromoCode(request.data?.code);
    const promoIdHint = String(request.data?.promoId || '').trim();

    if (!code) throw new HttpsError('invalid-argument', 'Código requerido.');

    let promoEntry = null;
    if (promoIdHint) {
        const ref = db.doc(`artifacts/${APP_ID}/public/data/promotions/${promoIdHint}`);
        const snap = await ref.get();
        if (snap.exists && normalizePromoCode(snap.data()?.code) === code) {
            promoEntry = { id: snap.id, ref, data: snap.data() || {} };
        }
    }
    if (!promoEntry) promoEntry = await findPromoByCode(code);
    if (!promoEntry) throw new HttpsError('not-found', 'Código de promo no encontrado.');

    const promo = promoEntry.data;
    if (!isPromoCurrentlyActive(promo)) {
        throw new HttpsError('failed-precondition', 'Esta promoción ya no está disponible.');
    }

    const claimRef = db.doc(`artifacts/${APP_ID}/users/${uid}/claimed_promos/${promoEntry.id}`);
    const existingClaim = await claimRef.get();
    const maxPerUser = promo.maxUsesPerUser || 1;
    const userUses = existingClaim.exists ? (existingClaim.data().useCount || (existingClaim.data().used ? 1 : 0)) : 0;

    if (userUses >= maxPerUser) {
        throw new HttpsError('failed-precondition', 'Ya reclamaste esta promoción.');
    }

    await db.runTransaction(async (tx) => {
        const promoSnap = await tx.get(promoEntry.ref);
        if (!promoSnap.exists) throw new HttpsError('not-found', 'Promo no encontrada.');
        const fresh = promoSnap.data() || {};
        if (!isPromoCurrentlyActive(fresh)) {
            throw new HttpsError('failed-precondition', 'Promo agotada o expirada.');
        }
        if (fresh.maxUsers && (fresh.claimedCount || 0) >= fresh.maxUsers) {
            throw new HttpsError('resource-exhausted', 'Se alcanzó el límite de usuarios.');
        }

        const claimSnap = await tx.get(claimRef);
        if (claimSnap.exists && (claimSnap.data().useCount || 0) >= maxPerUser) {
            throw new HttpsError('failed-precondition', 'Ya reclamaste esta promoción.');
        }

        tx.set(claimRef, {
            promoId: promoEntry.id,
            code: fresh.code,
            title: fresh.title || fresh.code,
            discountAmount: fresh.discountAmount,
            minSpendPercent: fresh.minSpendPercent ?? 80,
            claimedAt: FieldValue.serverTimestamp(),
            claimedAtMs: Date.now(),
            used: false,
            useCount: 0,
            usedOnTripId: null
        }, { merge: true });

        if (!claimSnap.exists) {
            tx.update(promoEntry.ref, {
                claimedCount: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp()
            });
        }
    });

    const amt = parseFloat(promo.discountAmount) || 0;
    return {
        ok: true,
        promoId: promoEntry.id,
        message: `¡Bono de L. ${amt.toFixed(2)} guardado! Se aplica al pagar con saldo.`
    };
});

exports.redeemPromoOnTripComplete = onCall(PROMO_CALLABLE_OPTS, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const tripId = String(request.data?.tripId || '').trim();
    const promoId = String(request.data?.promoId || '').trim();
    const subsidyOwed = parseFloat(request.data?.subsidyOwed) || 0;

    if (!tripId || !promoId || subsidyOwed <= 0) {
        return { skipped: true };
    }

    const promoRef = db.doc(`artifacts/${APP_ID}/public/data/promotions/${promoId}`);
    const claimRef = db.doc(`artifacts/${APP_ID}/users/${uid}/claimed_promos/${promoId}`);

    await db.runTransaction(async (tx) => {
        const promoSnap = await tx.get(promoRef);
        const claimSnap = await tx.get(claimRef);
        if (!promoSnap.exists || !claimSnap.exists) return;

        const promo = promoSnap.data() || {};
        const maxBudget = parseFloat(promo.maxBudget) || 0;
        const usedBudget = parseFloat(promo.usedBudget) || 0;
        if (maxBudget > 0 && usedBudget + subsidyOwed > maxBudget) {
            throw new HttpsError('resource-exhausted', 'Presupuesto de promo agotado.');
        }

        tx.update(promoRef, {
            usedBudget: FieldValue.increment(subsidyOwed),
            redemptionCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
        });
        tx.set(claimRef, {
            used: true,
            useCount: FieldValue.increment(1),
            usedOnTripId: tripId,
            usedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });

    return { ok: true };
});
// ============================================================
// BROADCAST PUSH — llega con app abierta o cerrada (FCM)
// ============================================================

/**
 * Usuarios con al menos 1 viaje real (no pending/cancelado).
 * Pasajero = clientId · Conductor = driverId
 */
async function loadTripExperienceSets(appId) {
    const clientsWithTrips = new Set();
    const driversWithTrips = new Set();
    let snap;
    try {
        snap = await db.collection(`artifacts/${appId}/public/data/trips`).select('clientId', 'driverId', 'status').get();
    } catch (_) {
        snap = await db.collection(`artifacts/${appId}/public/data/trips`).get();
    }
    snap.docs.forEach((d) => {
        const t = d.data() || {};
        const st = String(t.status || '');
        if (!st || st === 'cancelled' || st === 'canceled' || st === 'pending' || st === 'scheduled') return;
        // accepted | in_progress | completed (y similares)
        if (t.clientId) clientsWithTrips.add(String(t.clientId));
        if (t.driverId) driversWithTrips.add(String(t.driverId));
    });
    return { clientsWithTrips, driversWithTrips };
}

function normalizeTripFilter(raw) {
    const f = String(raw || 'all').trim();
    if (f === 'has_trips' || f === 'no_trips' || f === 'all') return f;
    return 'all';
}

/** tripFilter: all | has_trips | no_trips */
function userMatchesTripFilter(uid, role, tripFilter, sets, userData = {}) {
    const f = normalizeTripFilter(tripFilter);
    if (f === 'all') return true;
    const profileTrips = Number(userData.totalTrips) || 0;
    let has = false;
    if (role === 'driver') {
        has = sets.driversWithTrips.has(String(uid)) || profileTrips >= 1;
    } else {
        has = sets.clientsWithTrips.has(String(uid)) || profileTrips >= 1;
    }
    if (f === 'has_trips') return has;
    if (f === 'no_trips') return !has;
    return true;
}

/**
 * Envía FCM a usuarios con token y deja un aviso en la campana (notificaciones).
 * targetRole: 'all' | 'client' | 'driver' | 'supervisor'
 * tripFilter: 'all' | 'has_trips' | 'no_trips'
 */
async function broadcastPushToUsers({
    title,
    body,
    targetRole = 'all',
    tripFilter = 'all',
    data = {},
    highPriority = true
}) {
    const filter = normalizeTripFilter(tripFilter);
    const usersSnap = await db.collection(`artifacts/${APP_ID}/public/data/users`).get();
    const notifCol = db.collection(`artifacts/${APP_ID}/public/data/notifications`);
    const now = Date.now();
    const tripSets = filter === 'all'
        ? { clientsWithTrips: new Set(), driversWithTrips: new Set() }
        : await loadTripExperienceSets(APP_ID);

    await notifCol.add({
        targetRole: targetRole === 'all' ? 'all' : targetRole,
        tripFilter: filter,
        message: `${title} — ${body}`,
        title,
        body,
        broadcast: true,
        broadcastPush: true,
        pushDispatched: true,
        sentBy: 'system',
        sentByName: 'HonduRaite',
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: now,
        type: data.type || 'app_update'
    });

    let pushed = 0;
    let considered = 0;
    let skippedNoToken = 0;
    let skippedTripFilter = 0;

    for (const userDoc of usersSnap.docs) {
        const u = userDoc.data() || {};
        const role = u.role || 'client';
        if (targetRole !== 'all' && role !== targetRole) continue;
        if (!userMatchesTripFilter(userDoc.id, role, filter, tripSets, u)) {
            skippedTripFilter += 1;
            continue;
        }
        considered += 1;

        const tokens = await getUserTokens(APP_ID, userDoc.id);
        if (!tokens.length) {
            skippedNoToken += 1;
            continue;
        }

        await sendPushToUser(APP_ID, userDoc.id, {
            title,
            body,
            data: {
                type: data.type || 'app_update',
                tag: data.tag || `app-update-${now}`,
                openDriver: role === 'driver' ? 'true' : 'false',
                tripFilter: filter,
                ...Object.fromEntries(
                    Object.entries(data || {}).map(([k, v]) => [k, String(v ?? '')])
                )
            },
            highPriority
        });
        pushed += 1;
    }

    return {
        pushed,
        considered,
        skippedNoToken,
        skippedTripFilter,
        tripFilter: filter,
        totalUsers: usersSnap.size
    };
}

/** Callable: admin envía mensaje push a todos (o por rol). */
exports.broadcastAppMessage = onCall(PROMO_CALLABLE_OPTS, async (request) => {
    const caller = await assertCallerCanModerate(request.auth);
    if (!caller.isAdmin) {
        throw new HttpsError('permission-denied', 'Solo el administrador puede enviar broadcast a todos.');
    }
    const title = String(request.data?.title || '').trim();
    const body = String(request.data?.body || '').trim();
    const targetRole = String(request.data?.targetRole || 'all').trim();
    if (!title || !body) {
        throw new HttpsError('invalid-argument', 'Título y mensaje son requeridos.');
    }
    if (!['all', 'client', 'driver', 'supervisor'].includes(targetRole)) {
        throw new HttpsError('invalid-argument', 'targetRole inválido.');
    }
    const tripFilter = normalizeTripFilter(request.data?.tripFilter);
    const result = await broadcastPushToUsers({
        title,
        body,
        targetRole,
        tripFilter,
        data: {
            type: String(request.data?.type || 'app_update'),
            tag: String(request.data?.tag || `broadcast-${Date.now()}`),
            version: String(request.data?.version || '')
        },
        highPriority: request.data?.highPriority !== false
    });
    return { ok: true, ...result };
});

/**
 * Si el admin crea una notificación con broadcastPush/sendPush = true,
 * reenvía FCM a los usuarios del rol (app cerrada o en segundo plano).
 */
exports.onNotificationBroadcastPush = onDocumentCreated(
    'artifacts/{appId}/public/data/notifications/{notifId}',
    async (event) => {
        const data = event.data?.data() || {};
        const { appId } = event.params;
        if (data.pushDispatched === true) return;
        if (data.broadcastPush !== true && data.sendPush !== true) return;
        if (data.type === 'reply') return;

        const title = String(data.title || 'HonduRaite').trim() || 'HonduRaite';
        const body = String(data.body || data.message || '').trim();
        if (!body) return;

        if (data.personal && data.targetUserId) {
            await sendPushToUser(appId, data.targetUserId, {
                title,
                body,
                data: {
                    type: String(data.type || 'admin_notify'),
                    tag: String(data.tag || `notif-${event.params.notifId}`),
                    personal: 'true'
                },
                highPriority: true
            });
            await event.data.ref.set({
                pushDispatched: true,
                pushDispatchedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            return;
        }

        const targetRole = data.targetRole || 'all';
        const tripFilter = normalizeTripFilter(data.tripFilter);
        const tripSets = tripFilter === 'all'
            ? { clientsWithTrips: new Set(), driversWithTrips: new Set() }
            : await loadTripExperienceSets(appId);
        const usersSnap = await db.collection(`artifacts/${appId}/public/data/users`).get();
        let pushed = 0;
        for (const userDoc of usersSnap.docs) {
            const u = userDoc.data() || {};
            const role = u.role || 'client';
            if (targetRole !== 'all' && role !== targetRole) continue;
            if (!userMatchesTripFilter(userDoc.id, role, tripFilter, tripSets, u)) continue;
            await sendPushToUser(appId, userDoc.id, {
                title,
                body,
                data: {
                    type: String(data.type || 'admin_notify'),
                    tag: String(data.tag || `notif-${event.params.notifId}`),
                    targetRole: String(targetRole),
                    tripFilter
                },
                highPriority: true
            });
            pushed += 1;
        }
        await event.data.ref.set({
            pushDispatched: true,
            pushDispatchedAt: FieldValue.serverTimestamp(),
            pushCount: pushed,
            tripFilter
        }, { merge: true });
    }
);

// ============================================================
// NOTIFICACIONES PROGRAMADAS Y RECURRENTES (pasajeros)
// ============================================================

const HN_TZ = 'America/Tegucigalpa';

function getZonedParts(date = new Date(), timeZone = HN_TZ) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        weekday: 'short'
    });
    const map = {};
    for (const p of dtf.formatToParts(date)) {
        if (p.type !== 'literal') map[p.type] = p.value;
    }
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        year: map.year,
        month: map.month,
        day: map.day,
        hour: parseInt(map.hour, 10) || 0,
        minute: parseInt(map.minute, 10) || 0,
        dayOfWeek: weekdayMap[map.weekday] ?? 0,
        dateKey: `${map.year}-${map.month}-${map.day}`
    };
}

function campaignIsDue(campaign, parts) {
    if (!campaign || campaign.active === false) return false;
    const hour = Number(campaign.hour);
    const minute = Number(campaign.minute) || 0;
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return false;
    const minsNow = parts.hour * 60 + parts.minute;
    const minsDue = hour * 60 + minute;
    // Ventana de 15 min (el scheduler corre cada 15 min)
    if (minsNow < minsDue || minsNow > minsDue + 14) return false;

    const freq = String(campaign.frequency || 'daily');
    if (freq === 'weekly') {
        const dow = Number(campaign.dayOfWeek);
        if (!Number.isFinite(dow) || dow !== parts.dayOfWeek) return false;
    } else if (freq !== 'daily') {
        return false;
    }

    const sendKey = freq === 'weekly'
        ? `w-${parts.dateKey}`
        : `d-${parts.dateKey}`;
    if (campaign.lastSentKey === sendKey) return false;
    return sendKey;
}

async function claimCampaignSend(ref, sendKey) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const d = snap.data() || {};
        if (d.active === false) return false;
        if (d.lastSentKey === sendKey) return false;
        tx.update(ref, {
            lastSentKey: sendKey,
            lastSentAt: FieldValue.serverTimestamp(),
            lastSentAtMs: Date.now(),
            sendCount: FieldValue.increment(1)
        });
        return true;
    });
}

async function processOneTimeScheduledNotifications() {
    const nowIso = new Date().toISOString();
    const col = db.collection(`artifacts/${APP_ID}/public/data/notifications`);
    // scheduledFor se guarda como ISO string
    let snap;
    try {
        snap = await col.where('scheduledFor', '<=', nowIso).limit(40).get();
    } catch (e) {
        console.warn('[processOneTimeScheduled] query failed', e.message || e);
        return 0;
    }

    let sent = 0;
    for (const docSnap of snap.docs) {
        const data = docSnap.data() || {};
        if (!data.scheduledFor) continue;
        if (data.pushDispatched === true || data.sentPush === true) continue;
        if (data.type === 'reply') continue;
        // Solo avisos globales/programados (no hilos personales sin intención de push)
        if (data.personal && !data.sendPush && !data.broadcastPush && !data.scheduledFor) continue;

        const title = String(data.title || 'HonduRaite').trim() || 'HonduRaite';
        const body = String(data.body || data.message || '').trim();
        if (!body) {
            await docSnap.ref.set({ pushDispatched: true, pushSkipped: 'empty' }, { merge: true });
            continue;
        }

        const targetRole = data.targetRole || 'all';
        const tripFilter = normalizeTripFilter(data.tripFilter);
        const tripSets = tripFilter === 'all'
            ? { clientsWithTrips: new Set(), driversWithTrips: new Set() }
            : await loadTripExperienceSets(APP_ID);
        const usersSnap = await db.collection(`artifacts/${APP_ID}/public/data/users`).get();
        let pushed = 0;
        for (const userDoc of usersSnap.docs) {
            const u = userDoc.data() || {};
            const role = u.role || 'client';
            if (targetRole !== 'all' && role !== targetRole) continue;
            if (data.personal && data.targetUserId && userDoc.id !== data.targetUserId) continue;
            if (!userMatchesTripFilter(userDoc.id, role, tripFilter, tripSets, u)) continue;
            await sendPushToUser(APP_ID, userDoc.id, {
                title,
                body,
                data: {
                    type: String(data.type || 'admin_notify'),
                    tag: String(data.tag || `scheduled-${docSnap.id}`),
                    targetRole: String(targetRole),
                    tripFilter
                },
                highPriority: true
            });
            pushed += 1;
        }

        await docSnap.ref.set({
            pushDispatched: true,
            sentPush: true,
            pushDispatchedAt: FieldValue.serverTimestamp(),
            pushCount: pushed,
            tripFilter
        }, { merge: true });
        sent += 1;
    }
    return sent;
}

async function processRecurringCampaigns() {
    const parts = getZonedParts();
    const col = db.collection(`artifacts/${APP_ID}/public/data/notification_campaigns`);
    let snap;
    try {
        snap = await col.where('active', '==', true).limit(50).get();
    } catch (e) {
        console.warn('[processRecurringCampaigns] query failed', e.message || e);
        return 0;
    }

    let fired = 0;
    for (const docSnap of snap.docs) {
        const campaign = docSnap.data() || {};
        const sendKey = campaignIsDue(campaign, parts);
        if (!sendKey) continue;

        const claimed = await claimCampaignSend(docSnap.ref, sendKey);
        if (!claimed) continue;

        const title = String(campaign.title || 'HonduRaite').trim() || 'HonduRaite';
        const body = String(campaign.body || campaign.message || '').trim();
        if (!body) continue;

        const targetRole = campaign.targetRole || 'client';
        const tripFilter = normalizeTripFilter(campaign.tripFilter);
        await broadcastPushToUsers({
            title,
            body,
            targetRole,
            tripFilter,
            data: {
                type: 'recurring_notify',
                tag: `campaign-${docSnap.id}-${sendKey}`,
                campaignId: docSnap.id,
                frequency: campaign.frequency || 'daily',
                tripFilter
            },
            highPriority: true
        });
        fired += 1;
    }
    return fired;
}

/** Cada 15 min: one-shot programados + campañas diarias/semanales. */
exports.processScheduledAndRecurringPushes = onSchedule(
    {
        schedule: 'every 15 minutes',
        timeZone: HN_TZ
    },
    async () => {
        const oneTime = await processOneTimeScheduledNotifications().catch((e) => {
            console.error('oneTime scheduled', e);
            return 0;
        });
        const recurring = await processRecurringCampaigns().catch((e) => {
            console.error('recurring campaigns', e);
            return 0;
        });
        console.log(`[scheduled-pushes] oneTime=${oneTime} recurring=${recurring}`);
        return null;
    }
);
