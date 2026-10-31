'use strict';

/**
 * Rotación justa de repartidores para envíos de tiendas (15 segundos por orden):
 *  - Alcance exclusivo: SOLO envíos/pedidos de tienda (`isStoreDeliveryTrip`).
 *  - Cola justa (`rankDriversForStoreDelivery`):
 *    1.º Menos envíos de tienda hoy (`storeDeliveriesToday`) y menos viajes hoy (`tripsCompletedToday`).
 *    2.º Mayor antigüedad desde su último envío asignado (`lastStoreDeliveryAssignedAtMs`, round-robin).
 *    3.º Desempate por cercanía al negocio (`distanceKm`) y mejor tasa de aceptación (`acceptanceRate`).
 *    Excluye a quienes ya rechazaron (`declinedDriverIds`) o ya tuvieron su turno de 15 s (`offeredHistoryIds`).
 *  - Ventana exclusiva de 15 s uno por uno (`TRIP_STORE_OFFER_STEP_SEC = 15`):
 *    Si el repartidor en turno no acepta en 15 s (o rechaza), avanza al siguiente de la fila por 15 s.
 *    Cuando todos los disponibles tuvieron su turno sin aceptar (o no quedan candidatos), cae a `offerPhase: 'city'`.
 */

const TRIP_STORE_OFFER_STEP_SEC = 15;
const TRIP_STORE_OFFER_STEP_MS = TRIP_STORE_OFFER_STEP_SEC * 1000;
const HONDURAS_UTC_OFFSET_MS = -6 * 3600 * 1000;

function toMs(val) {
    if (!val) return 0;
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val?.toMillis === 'function') return val.toMillis();
    if (typeof val?.seconds === 'number') return val.seconds * 1000;
    if (typeof val === 'string') {
        const parsed = Date.parse(val);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const aLat = Number(lat1);
    const aLng = Number(lng1);
    const bLat = Number(lat2);
    const bLng = Number(lng2);
    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return null;
    const R = 6371;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLng = ((bLng - aLng) * Math.PI) / 180;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const a = s1 * s1 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isStoreDeliveryTrip(t) {
    if (!t || typeof t !== 'object') return false;
    return Boolean(
        t.storeOrderId
        || t.storeOrder === true
        || t.storeDelivery === true
        || t.createdByMerchant === true
        || t.merchantDirectDelivery === true
        || t.tripKind === 'store_order'
        || t.tripKind === 'merchant_delivery'
        || t.deliveryDetails?.storeOrderId
        || t.deliveryDetails?.storeDelivery === true
        || t.deliveryDetails?.merchantDirectDelivery === true
        || t.requestSource === 'whatsapp_store_delivery'
        || t.createdVia === 'whatsapp_store'
        || t.waStoreId
    );
}

/** Ventana exclusiva con tiempo: envíos de tienda (rotación) o viaje VIP (1 turno al más cercano y luego ciudad). */
function usesTimedExclusiveOffer(t) {
    return isStoreDeliveryTrip(t) || t?.vipExclusiveOffer === true;
}

function getStoreOfferWindowSec(trip) {
    const sec = Number(trip?.offerWindowSec);
    return Number.isFinite(sec) && sec > 0 ? sec : TRIP_STORE_OFFER_STEP_SEC;
}

function getStoreOfferWindowMs(trip) {
    return getStoreOfferWindowSec(trip) * 1000;
}

function getOfferSentMs(trip) {
    const direct = toMs(trip?.offerSentAt) || toMs(trip?.offerSentAtMs);
    if (direct > 0) return direct;
    const exp = Number(trip?.offerExpiresAtMs);
    if (Number.isFinite(exp) && exp > 0) {
        return Math.max(0, exp - getStoreOfferWindowMs(trip));
    }
    return 0;
}

function getStoreOfferExpiresAtMs(trip) {
    const exp = Number(trip?.offerExpiresAtMs);
    if (Number.isFinite(exp) && exp > 0) return exp;
    const sentMs = getOfferSentMs(trip);
    if (sentMs > 0) return sentMs + getStoreOfferWindowMs(trip);
    return 0;
}

function isStoreOfferExclusiveActive(trip, nowMs = Date.now()) {
    if (!usesTimedExclusiveOffer(trip)) return false;
    if (trip.status && trip.status !== 'pending') return false;
    if (trip.driverId || trip.trashedAtMs || trip.isDemandSimulation) return false;
    if (trip.offerPhase === 'city') return false;
    if (trip.offerPhase !== 'exclusive' || !trip.offeredToDriverId) return false;
    const expMs = getStoreOfferExpiresAtMs(trip);
    if (expMs > 0) return nowMs < expMs;
    return true;
}

function isStoreOfferWindowExpired(trip, nowMs = Date.now()) {
    if (!usesTimedExclusiveOffer(trip)) return true;
    if (trip.offerPhase === 'city') return true;
    if (trip.offerPhase !== 'exclusive' || !trip.offeredToDriverId) return true;
    const expMs = getStoreOfferExpiresAtMs(trip);
    return expMs > 0 && nowMs >= expMs;
}

function getStoreOfferRemainingSec(trip, nowMs = Date.now()) {
    if (!isStoreOfferExclusiveActive(trip, nowMs)) return 0;
    const winSec = getStoreOfferWindowSec(trip);
    const expMs = getStoreOfferExpiresAtMs(trip);
    if (!expMs) return winSec;
    return Math.max(0, Math.min(winSec, Math.ceil((expMs - nowMs) / 1000)));
}

function getHondurasDayStartMs(nowMs = Date.now()) {
    return Math.floor((nowMs + HONDURAS_UTC_OFFSET_MS) / 86400000) * 86400000 - HONDURAS_UTC_OFFSET_MS;
}

function computeDriverStoreDeliveryStatsToday(tripDocs = [], nowMs = Date.now()) {
    const dayStartMs = getHondurasDayStartMs(nowMs);
    const map = new Map();

    const ensure = (driverId) => {
        let entry = map.get(driverId);
        if (!entry) {
            entry = {
                storeDeliveriesToday: 0,
                tripsCompletedToday: 0,
                lastStoreDeliveryAssignedAtMs: 0,
            };
            map.set(driverId, entry);
        }
        return entry;
    };

    for (const raw of tripDocs || []) {
        if (!raw) continue;
        const t = typeof raw.data === 'function' ? raw.data() : raw;
        if (!t || typeof t !== 'object') continue;
        const driverId = String(t.driverId || '').trim();
        if (!driverId) continue;

        const isStore = isStoreDeliveryTrip(t);
        const completedMs = toMs(t.completedAt) || toMs(t.completedAtMs) || toMs(t.updatedAt) || toMs(t.acceptedAt) || toMs(t.createdAt);
        const assignedMs = toMs(t.acceptedAt) || toMs(t.acceptedAtMs) || completedMs || toMs(t.createdAt);

        if (t.status === 'completed' && completedMs >= dayStartMs) {
            const entry = ensure(driverId);
            entry.tripsCompletedToday += 1;
            if (isStore) {
                entry.storeDeliveriesToday += 1;
            }
        } else if (isStore && (t.status === 'accepted' || t.status === 'in_progress') && assignedMs >= dayStartMs) {
            const entry = ensure(driverId);
            entry.storeDeliveriesToday += 1;
        }

        if (isStore && ['accepted', 'in_progress', 'completed'].includes(String(t.status || '')) && assignedMs > 0) {
            const entry = ensure(driverId);
            if (assignedMs > entry.lastStoreDeliveryAssignedAtMs) {
                entry.lastStoreDeliveryAssignedAtMs = assignedMs;
            }
        }
    }

    return map;
}

function rankDriversForStoreDelivery(candidates = [], trip = {}, { tripDocs = [], nowMs = Date.now() } = {}) {
    const excluded = new Set([
        ...(Array.isArray(trip?.declinedDriverIds) ? trip.declinedDriverIds : []),
        ...(Array.isArray(trip?.offeredHistoryIds) ? trip.offeredHistoryIds : []),
        ...(Array.isArray(trip?.expiredOfferDriverIds) ? trip.expiredOfferDriverIds : []),
    ].map((id) => String(id || '').trim()).filter(Boolean));

    const statsByDriver = computeDriverStoreDeliveryStatsToday(tripDocs, nowMs);
    const originLat = trip?.originLat;
    const originLng = trip?.originLng;

    const enriched = [];
    const seenIds = new Set();

    for (const c of candidates || []) {
        if (!c || typeof c !== 'object') continue;
        const driverId = String(c.driverId || c.id || c.uid || '').trim();
        if (!driverId || seenIds.has(driverId) || excluded.has(driverId)) continue;
        seenIds.add(driverId);

        const stats = statsByDriver.get(driverId);
        const storeDeliveriesToday = Number.isFinite(Number(c.storeDeliveriesToday))
            ? Number(c.storeDeliveriesToday)
            : (Number.isFinite(Number(c.ordersToday))
                ? Number(c.ordersToday)
                : (stats ? stats.storeDeliveriesToday : 0));

        const tripsCompletedToday = Number.isFinite(Number(c.tripsCompletedToday))
            ? Number(c.tripsCompletedToday)
            : (Number.isFinite(Number(c.completedToday))
                ? Number(c.completedToday)
                : (stats ? Math.max(stats.tripsCompletedToday, storeDeliveriesToday) : storeDeliveriesToday));

        const lastStoreDeliveryAssignedAtMs = Number.isFinite(Number(c.lastStoreDeliveryAssignedAtMs))
            ? Number(c.lastStoreDeliveryAssignedAtMs)
            : (stats ? stats.lastStoreDeliveryAssignedAtMs : 0);

        let distanceKm = Number.isFinite(Number(c.distanceKm))
            ? Number(c.distanceKm)
            : (Number.isFinite(Number(c.distKm)) ? Number(c.distKm) : null);

        if (distanceKm == null && originLat != null && originLng != null && c.lat != null && c.lng != null) {
            const d = haversineKm(originLat, originLng, c.lat, c.lng);
            if (d != null) distanceKm = Math.round(d * 100) / 100;
        }
        if (distanceKm == null) distanceKm = 999;

        const acceptanceRate = Number.isFinite(Number(c.acceptanceRate))
            ? Number(c.acceptanceRate)
            : 100;

        enriched.push({
            ...c,
            driverId,
            name: c.name || c.driverName || 'Repartidor',
            distanceKm,
            storeDeliveriesToday,
            tripsCompletedToday,
            lastStoreDeliveryAssignedAtMs,
            acceptanceRate,
            busy: Boolean(c.busy),
        });
    }

    enriched.sort((a, b) => {
        if (a.busy !== b.busy) return a.busy ? 1 : -1;
        if (a.storeDeliveriesToday !== b.storeDeliveriesToday) {
            return a.storeDeliveriesToday - b.storeDeliveriesToday;
        }
        if (a.tripsCompletedToday !== b.tripsCompletedToday) {
            return a.tripsCompletedToday - b.tripsCompletedToday;
        }
        if (a.lastStoreDeliveryAssignedAtMs !== b.lastStoreDeliveryAssignedAtMs) {
            return a.lastStoreDeliveryAssignedAtMs - b.lastStoreDeliveryAssignedAtMs;
        }
        if (Math.abs(a.distanceKm - b.distanceKm) > 0.01) {
            return a.distanceKm - b.distanceKm;
        }
        if (a.acceptanceRate !== b.acceptanceRate) {
            return b.acceptanceRate - a.acceptanceRate;
        }
        return a.driverId.localeCompare(b.driverId);
    });

    return enriched.map((item, idx) => ({
        ...item,
        queuePosition: idx + 1,
    }));
}

function planNextStoreDeliveryOffer(trip = {}, candidates = [], {
    tripDocs = [],
    nowMs = Date.now(),
    stepSec = TRIP_STORE_OFFER_STEP_SEC,
    includeCurrentInHistory = true,
} = {}) {
    const baseHistory = [
        ...(Array.isArray(trip?.offeredHistoryIds) ? trip.offeredHistoryIds : []),
        ...(Array.isArray(trip?.expiredOfferDriverIds) ? trip.expiredOfferDriverIds : []),
    ];
    if (includeCurrentInHistory && trip?.offeredToDriverId) {
        baseHistory.push(trip.offeredToDriverId);
    }
    const alreadyOffered = Array.from(new Set(baseHistory.map((id) => String(id || '').trim()).filter(Boolean)));

    const ranked = rankDriversForStoreDelivery(
        candidates,
        { ...trip, offeredHistoryIds: alreadyOffered },
        { tripDocs, nowMs }
    );

    if (ranked.length > 0) {
        const next = ranked[0];
        const nextHistory = Array.from(new Set([...alreadyOffered, next.driverId]));
        const fullQueue = Array.from(new Set([
            ...(Array.isArray(trip?.offerQueueDriverIds) ? trip.offerQueueDriverIds : []),
            ...alreadyOffered,
            ...ranked.map((c) => c.driverId),
        ].map((id) => String(id || '').trim()).filter(Boolean)));
        const stepIndex = nextHistory.length;
        const winSec = Number.isFinite(Number(stepSec)) && Number(stepSec) > 0 ? Number(stepSec) : TRIP_STORE_OFFER_STEP_SEC;

        return {
            phase: 'exclusive',
            nextDriver: next,
            ranked,
            stepIndex,
            totalQueueCount: fullQueue.length,
            offerWindowSec: winSec,
            offerSentAtMs: nowMs,
            offerExpiresAtMs: nowMs + winSec * 1000,
            offeredHistoryIds: nextHistory,
            offerQueueDriverIds: fullQueue,
        };
    }

    const finalQueue = Array.from(new Set([
        ...(Array.isArray(trip?.offerQueueDriverIds) ? trip.offerQueueDriverIds : []),
        ...alreadyOffered,
    ].map((id) => String(id || '').trim()).filter(Boolean)));

    return {
        phase: 'city',
        nextDriver: null,
        ranked: [],
        stepIndex: alreadyOffered.length,
        totalQueueCount: finalQueue.length,
        offerWindowSec: stepSec,
        offerSentAtMs: null,
        offerExpiresAtMs: null,
        offeredHistoryIds: alreadyOffered,
        offerQueueDriverIds: finalQueue,
    };
}

module.exports = {
    usesTimedExclusiveOffer,
    TRIP_STORE_OFFER_STEP_SEC,
    TRIP_STORE_OFFER_STEP_MS,
    isStoreDeliveryTrip,
    getStoreOfferWindowSec,
    getStoreOfferWindowMs,
    getOfferSentMs,
    getStoreOfferExpiresAtMs,
    isStoreOfferExclusiveActive,
    isStoreOfferWindowExpired,
    getStoreOfferRemainingSec,
    getHondurasDayStartMs,
    computeDriverStoreDeliveryStatsToday,
    rankDriversForStoreDelivery,
    planNextStoreDeliveryOffer,
};
