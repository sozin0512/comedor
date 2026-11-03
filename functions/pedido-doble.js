'use strict';
/* ===== REGLAS (copia de js/pedido-doble-rules.js, no editar aquí) ===== */
/**
 * v.42 «Pedido doble»: reglas puras (sin Firebase). Copia exacta en functions/pedido-doble.js (prueba de paridad).
 * Un repartidor puede llevar 2 pedidos de negocio/restaurante a la vez si:
 *  - ambos son pedidos de negocio (nunca viajes de pasajero), máximo 2;
 *  - el 1º aún NO se recogió (status accepted) y no está ya en un pedido doble;
 *  - mismo negocio, o el 2º se recoge a ≤ 300 m del 1º;
 *  - ENTREGA: el 2º cliente queda en el mismo lugar o cerca (≤ 1.5 km del 1º cliente)
 *    o de paso (desvío extra ≤ 3 km en línea recta);
 *  - «Sin destino» (cobro por zona): solo si AMBOS son por zona y del MISMO negocio (no hay destino que comparar).
 * Prioridad: si el repartidor está EN el negocio (marcó «Llegué al negocio» o a ≤ 150 m) y entra un pedido
 * del mismo negocio, se le ofrece primero a él solo por 25 s.
 */
const PD_MAX = 2;
const PD_NEAR_PICKUP_M = 300;
const PD_DEST_NEAR_KM = 1.5;
const PD_DETOUR_MAX_KM = 3;
const PD_AT_STORE_M = 150;
const PD_PRIORITY_SEC = 25;

function pdKm(aLat, aLng, bLat, bLng) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const num = (v) => (v == null || v === '' ? NaN : Number(v));
const pt = (lat, lng) => (Number.isFinite(num(lat)) && Number.isFinite(num(lng)) ? { lat: num(lat), lng: num(lng) } : null);
function pdPickup(t) { return pt(t?.originLat, t?.originLng); }
function pdDest(t) { return pt(t?.destinationLat ?? t?.destLat, t?.destinationLng ?? t?.destLng); }
function pdIsZone(t) { return !!t && (t.zoneBilling === true || t.deliveryDetails?.zoneBilling === true); }
function pdIsStoreOrder(t) {
    if (!t || typeof t !== 'object') return false;
    const d = t.deliveryDetails || {};
    return !!(t.storeOrderId || d.storeOrderId || t.storeDelivery === true || t.merchantDirectDelivery || t.createdByMerchant === true
        || t.createdVia === 'whatsapp_store' || (t.storeId && (t.serviceType === 'delivery' || pdIsZone(t))));
}
function pdStoreKey(t) { return String(t?.storeId || t?.deliveryDetails?.storeId || '') || null; }

/** ¿Se puede sumar `cand` (pendiente) como 2º pedido del viaje `active` del repartidor? */
function pdCanPair(active, cand) {
    const no = (reason) => ({ ok: false, reason });
    if (!active || !cand) return no('sin_datos');
    if (!pdIsStoreOrder(active) || !pdIsStoreOrder(cand)) return no('no_es_pedido_de_negocio');
    if (active.batchId || cand.batchId) return no('ya_es_pedido_doble');
    if (active.status !== 'accepted' || active.storePickedUpAt) return no('primer_pedido_ya_recogido');
    if (cand.status !== 'pending' || cand.driverId) return no('segundo_no_disponible');
    if (cand.scheduledFor || active.scheduledFor) return no('programado');
    const sameStore = !!pdStoreKey(active) && pdStoreKey(active) === pdStoreKey(cand);
    const pA = pdPickup(active), pB = pdPickup(cand);
    const pickupKm = pA && pB ? pdKm(pA.lat, pA.lng, pB.lat, pB.lng) : null;
    if (!sameStore && !(pickupKm != null && pickupKm * 1000 <= PD_NEAR_PICKUP_M)) return no('recogida_lejos');
    const zA = pdIsZone(active), zB = pdIsZone(cand);
    if (zA || zB) {
        if (zA && zB && sameStore) return { ok: true, reason: 'zona_mismo_negocio', sameStore, pickupKm, destKm: null, detourKm: null };
        return no(zA && zB ? 'zona_otro_negocio' : 'zona_mezclada');
    }
    const dA = pdDest(active), dB = pdDest(cand);
    if (!dA || !dB || !pA) return no('sin_destino');
    const destKm = pdKm(dA.lat, dA.lng, dB.lat, dB.lng);
    const pB2 = pB || pA;
    const base = pdKm(pA.lat, pA.lng, dA.lat, dA.lng);
    const viaAB = base + destKm;
    const viaBA = pdKm(pB2.lat, pB2.lng, dB.lat, dB.lng) + destKm;
    const detourKm = Math.max(0, Math.min(viaAB, viaBA) - base);
    if (destKm <= PD_DEST_NEAR_KM) return { ok: true, reason: 'entrega_cerca', sameStore, pickupKm, destKm, detourKm };
    if (detourKm <= PD_DETOUR_MAX_KM) return { ok: true, reason: 'entrega_de_paso', sameStore, pickupKm, destKm, detourKm };
    return no('entrega_lejos');
}

/** ¿El repartidor está «en el negocio» de su pedido activo? (llegó y no ha recogido, o a ≤ 150 m) */
function pdAtStore(active, driverPos) {
    if (!active || active.status !== 'accepted' || active.storePickedUpAt) return false;
    if (active.driverArrived) return true;
    const p = pdPickup(active);
    if (!p || !driverPos || !Number.isFinite(num(driverPos.lat))) return false;
    return pdKm(p.lat, p.lng, num(driverPos.lat), num(driverPos.lng)) * 1000 <= PD_AT_STORE_M;
}

/** Prioridad: mismo negocio + repartidor en el negocio + emparejable. */
function pdPriority(active, cand, driverPos) {
    const pair = pdCanPair(active, cand);
    if (!pair.ok || !pair.sameStore) return false;
    return pdAtStore(active, driverPos);
}

/** Orden sugerido de entrega: el destino más cercano a la recogida primero. */
function pdDeliveryOrder(a, b) {
    const p = pdPickup(a) || pdPickup(b);
    const da = pdDest(a), db = pdDest(b);
    if (!p || !da || !db) return [a, b];
    return pdKm(p.lat, p.lng, da.lat, da.lng) <= pdKm(p.lat, p.lng, db.lat, db.lng) ? [a, b] : [b, a];
}

/* ===== FIN REGLAS ===== */

/**
 * Servidor: aceptar el 2º pedido (transacción), prioridad «en el negocio», y cancelaciones.
 * Campos nuevos en el viaje (solo los escribe el servidor): batchId, batchTripIds, batchIndex, pedidoDoble,
 * batchPartnerCancelledAtMs, pdPriorityDriverId, pdPriorityOfferedIds, offerPedidoDoble, offerBatchWithTripId.
 */
const PD_TRIPS = (appId) => `artifacts/${appId}/public/data/trips`;

async function acceptBatchedTrip({ db, FieldValue, appId, uid, tripId, batchWithTripId, patch }) {
    const candRef = db.doc(`${PD_TRIPS(appId)}/${tripId}`);
    const actRef = db.doc(`${PD_TRIPS(appId)}/${batchWithTripId}`);
    return db.runTransaction(async (tx) => {
        const [cs, as] = await Promise.all([tx.get(candRef), tx.get(actRef)]);
        if (!cs.exists || !as.exists) return { ok: false, code: 'not-found', msg: 'Uno de los pedidos ya no existe.' };
        const cand = { id: cs.id, ...cs.data() };
        const act = { id: as.id, ...as.data() };
        if (act.driverId !== uid) return { ok: false, code: 'failed-precondition', msg: 'Ese no es tu pedido activo.' };
        if (cand.trashedAtMs) return { ok: false, code: 'failed-precondition', msg: 'Este pedido ya no está disponible.' };
        if (cand.status !== 'pending' || (cand.driverId && cand.driverId !== uid)) return { ok: false, code: 'failed-precondition', msg: 'Otro repartidor ya tomó este pedido.' };
        const declined = Array.isArray(cand.declinedDriverIds) ? cand.declinedDriverIds : [];
        if (declined.includes(uid)) return { ok: false, code: 'failed-precondition', msg: 'Ya rechazaste este pedido.' };
        const pair = pdCanPair(act, cand);
        if (!pair.ok) return { ok: false, code: 'failed-precondition', msg: `No se puede llevar como pedido doble (${pair.reason}).`, reason: pair.reason };
        const batchId = `pd_${act.id}_${cand.id}`;
        const nowMs = Date.now();
        const common = { batchId, batchTripIds: [act.id, cand.id], pedidoDoble: true, batchCreatedAtMs: nowMs, batchReason: pair.reason };
        tx.update(candRef, {
            ...patch, ...common, batchIndex: 2,
            status: 'accepted', driverId: uid,
            offeredToDriverId: null, offeredToDriverName: null, candidateDriverIds: [],
            driverFinishingOtherTrip: false, driverBusyOnTripId: null,
            offerPedidoDoble: FieldValue.delete(), offerBatchWithTripId: FieldValue.delete(),
            // mismo avance que el 1º (si ya llegó al negocio, el 2º también)
            driverArrived: !!act.driverArrived,
        });
        tx.update(actRef, { ...common, batchIndex: 1, updatedAt: FieldValue.serverTimestamp() });
        return { ok: true, batchId, reason: pair.reason };
    });
}

/** Repartidor «en el negocio» con un pedido del mismo negocio que pueda llevar este. */
async function findAtStorePriorityDriver({ db, appId, trip, tripDocs }) {
    if (!pdIsStoreOrder(trip) || trip.status !== 'pending' || trip.driverId) return null;
    const store = pdStoreKey(trip);
    if (!store) return null;
    const tried = new Set([...(trip.pdPriorityOfferedIds || []), ...(trip.declinedDriverIds || [])]);
    const actives = (tripDocs || []).map((d) => ({ id: d.id, ...(d.data ? d.data() : d) }))
        .filter((t) => t.id !== trip.id && t.status === 'accepted' && t.driverId && pdStoreKey(t) === store && !tried.has(t.driverId));
    for (const act of actives) {
        if (!pdCanPair(act, trip).ok) continue;
        let pos = null;
        if (!act.driverArrived) {
            try { const s = await db.doc(`artifacts/${appId}/public/data/drivers_location/${act.driverId}`).get(); pos = s.exists ? s.data() : null; } catch (_) {}
        }
        if (pdAtStore(act, pos)) return { driverId: act.driverId, driverName: act.driverName || 'Repartidor', activeTripId: act.id };
    }
    return null;
}

/** Ofrece en exclusiva (25 s) al repartidor que está en el negocio. true = se ofreció. */
async function offerAtStorePriority({ db, FieldValue, appId, trip, tripDocs }) {
    const p = await findAtStorePriorityDriver({ db, appId, trip, tripDocs });
    if (!p) return false;
    const ref = db.doc(`${PD_TRIPS(appId)}/${trip.id}`);
    return db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const d = s.data() || {};
        if (d.status !== 'pending' || d.driverId || (d.pdPriorityOfferedIds || []).includes(p.driverId)) return false;
        const now = Date.now();
        tx.update(ref, {
            offerPhase: 'exclusive', offerWindowSec: PD_PRIORITY_SEC, offerExpiresAtMs: now + PD_PRIORITY_SEC * 1000,
            offeredToDriverId: p.driverId, offeredToDriverName: p.driverName, offerSentAt: FieldValue.serverTimestamp(),
            candidateDriverIds: [p.driverId], offerToBusyDriver: true, offerSearchTier: 'pedido_doble_en_negocio',
            offerPedidoDoble: true, offerBatchWithTripId: p.activeTripId,
            pdPriorityDriverId: p.driverId, pdPriorityOfferedIds: FieldValue.arrayUnion(p.driverId),
        });
        return true;
    });
}

/** Si se cancela un pedido de un pedido doble, avisar en el otro (el repartidor sigue con ese como pedido normal). */
function makeBatchCancelTrigger({ db, FieldValue, onDocumentUpdated }) {
    return onDocumentUpdated('artifacts/{appId}/public/data/trips/{tripId}', async (event) => {
        const before = event.data?.before?.data() || {};
        const after = event.data?.after?.data() || {};
        if (!after.batchId || before.status === 'cancelled' || after.status !== 'cancelled') return;
        const { appId, tripId } = event.params;
        const otherId = (after.batchTripIds || []).find((id) => id !== tripId);
        if (!otherId) return;
        const pickedUp = !!(before.storePickedUpAt || before.status === 'in_progress');
        await db.doc(`${PD_TRIPS(appId)}/${otherId}`).set({
            batchPartnerCancelledAtMs: Date.now(), batchPartnerCancelledTripId: tripId,
            batchPartnerReturnToStore: pickedUp, updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }).catch((e) => console.warn('[pedido-doble] aviso cancelación', otherId, e?.message || e));
    });
}

module.exports = { PD_MAX, PD_NEAR_PICKUP_M, PD_DEST_NEAR_KM, PD_DETOUR_MAX_KM, PD_AT_STORE_M, PD_PRIORITY_SEC, pdKm, pdPickup, pdDest, pdIsZone, pdIsStoreOrder, pdStoreKey, pdCanPair, pdAtStore, pdPriority, pdDeliveryOrder, acceptBatchedTrip, findAtStorePriorityDriver, offerAtStorePriority, makeBatchCancelTrigger };
