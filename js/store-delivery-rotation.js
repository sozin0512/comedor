/**
 * Rotación justa de repartidores para envíos de tiendas (15 segundos por orden):
 *  - Alcance exclusivo: SOLO envíos/pedidos de tienda (`isStoreDeliveryTrip`).
 *    Los viajes normales de pasajeros siguen en ciudad abierta inmediata (`offerPhase: 'city'`).
 *  - Cola justa (`rankDriversForStoreDelivery`):
 *    1.º Menos envíos de tienda completados hoy (`storeDeliveriesToday`) y menos viajes hoy (`tripsCompletedToday`).
 *    2.º Mayor antigüedad desde su último envío asignado (`lastStoreDeliveryAssignedAtMs`, round-robin).
 *    3.º Desempate por cercanía al negocio (`distanceKm`) y mejor tasa de aceptación (`acceptanceRate`).
 *    Excluye a quienes ya rechazaron (`declinedDriverIds`) o ya tuvieron su turno de 15 s (`offeredHistoryIds`).
 *  - Ventana exclusiva de 15 s uno por uno (`TRIP_STORE_OFFER_STEP_SEC = 15`):
 *    Si el repartidor en turno no acepta en 15 s (o toca «Pasar»), avanza al siguiente de la fila por 15 s.
 *    Cuando todos los disponibles tuvieron su turno sin aceptar (o no quedan candidatos), cae a `offerPhase: 'city'`
 *    para mostrarse a todos los repartidores en línea.
 */

export const TRIP_STORE_OFFER_STEP_SEC = 15;
export const TRIP_STORE_OFFER_STEP_MS = TRIP_STORE_OFFER_STEP_SEC * 1000;

const HONDURAS_UTC_OFFSET_MS = -6 * 3600 * 1000;

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

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

/**
 * Determina si un documento de viaje corresponde a un envío/pedido de tienda.
 * Los viajes normales de pasajeros devuelven `false`.
 */
export function isStoreDeliveryTrip(t) {
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

export function getStoreOfferWindowSec(trip) {
    const sec = Number(trip?.offerWindowSec);
    return Number.isFinite(sec) && sec > 0 ? sec : TRIP_STORE_OFFER_STEP_SEC;
}

export function getStoreOfferWindowMs(trip) {
    return getStoreOfferWindowSec(trip) * 1000;
}

export function getOfferSentMs(trip) {
    const direct = toMs(trip?.offerSentAt) || toMs(trip?.offerSentAtMs);
    if (direct > 0) return direct;
    const exp = Number(trip?.offerExpiresAtMs);
    if (Number.isFinite(exp) && exp > 0) {
        return Math.max(0, exp - getStoreOfferWindowMs(trip));
    }
    return 0;
}

export function getStoreOfferExpiresAtMs(trip) {
    const exp = Number(trip?.offerExpiresAtMs);
    if (Number.isFinite(exp) && exp > 0) return exp;
    const sentMs = getOfferSentMs(trip);
    if (sentMs > 0) return sentMs + getStoreOfferWindowMs(trip);
    return 0;
}

/**
 * ¿Sigue activa la ventana exclusiva de 15 s para este envío de tienda?
 * Solo aplica a `isStoreDeliveryTrip(trip)` con `offerPhase === 'exclusive'` y `offeredToDriverId`.
 * Los viajes normales de pasajeros devuelven siempre `false` (ciudad abierta).
 */
export function isStoreOfferExclusiveActive(trip, nowMs = Date.now()) {
    if (!isStoreDeliveryTrip(trip)) return false;
    if (trip.status && trip.status !== 'pending') return false;
    if (trip.driverId || trip.trashedAtMs || trip.isDemandSimulation) return false;
    if (trip.offerPhase === 'city') return false;
    if (trip.offerPhase !== 'exclusive' || !trip.offeredToDriverId) return false;
    const expMs = getStoreOfferExpiresAtMs(trip);
    if (expMs > 0) return nowMs < expMs;
    return true;
}

/**
 * ¿Ya venció el turno exclusivo de 15 s del repartidor actual?
 */
export function isStoreOfferWindowExpired(trip, nowMs = Date.now()) {
    if (!isStoreDeliveryTrip(trip)) return true;
    if (trip.offerPhase === 'city') return true;
    if (trip.offerPhase !== 'exclusive' || !trip.offeredToDriverId) return true;
    const expMs = getStoreOfferExpiresAtMs(trip);
    return expMs > 0 && nowMs >= expMs;
}

/**
 * Segundos restantes (0..15) del turno exclusivo actual.
 */
export function getStoreOfferRemainingSec(trip, nowMs = Date.now()) {
    if (!isStoreOfferExclusiveActive(trip, nowMs)) return 0;
    const winSec = getStoreOfferWindowSec(trip);
    const expMs = getStoreOfferExpiresAtMs(trip);
    if (!expMs) return winSec;
    return Math.max(0, Math.min(winSec, Math.ceil((expMs - nowMs) / 1000)));
}

/**
 * Inicio del día actual en hora de Honduras (America/Tegucigalpa, UTC-6).
 */
export function getHondurasDayStartMs(nowMs = Date.now()) {
    return Math.floor((nowMs + HONDURAS_UTC_OFFSET_MS) / 86400000) * 86400000 - HONDURAS_UTC_OFFSET_MS;
}

/**
 * Calcula cuántos envíos de tienda y viajes totales lleva cada conductor hoy,
 * además de la última vez que se le asignó un envío de tienda (`lastStoreDeliveryAssignedAtMs`).
 */
export function computeDriverStoreDeliveryStatsToday(tripDocs = [], nowMs = Date.now()) {
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

/**
 * Ordena los repartidores elegibles para un envío de tienda con rotación justa:
 *  1.º Libres antes que ocupados (`busy`).
 *  2.º Menos envíos de tienda hoy (`storeDeliveriesToday`).
 *  3.º Menos viajes totales completados hoy (`tripsCompletedToday`).
 *  4.º Más tiempo sin recibir envío de tienda (`lastStoreDeliveryAssignedAtMs` menor primero).
 *  5.º Más cercano al negocio (`distanceKm`).
 *  6.º Mayor tasa de aceptación (`acceptanceRate`).
 * Excluye repartidores en `declinedDriverIds`, `offeredHistoryIds` y `expiredOfferDriverIds`.
 */
export function rankDriversForStoreDelivery(candidates = [], trip = {}, { tripDocs = [], nowMs = Date.now() } = {}) {
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

/**
 * Calcula el siguiente paso de la rotación justa de 15 s para un envío de tienda:
 * - Si hay un siguiente repartidor en la fila que aún no ha tenido turno ni ha rechazado,
 *   devuelve `phase: 'exclusive'` con los datos del turno de 15 s.
 * - Si ya pasaron todos los repartidores en línea (o no hay ninguno), devuelve `phase: 'city'`
 *   para abrir el envío a todos los disponibles.
 */
export function planNextStoreDeliveryOffer(trip = {}, candidates = [], {
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

/**
 * HTML del distintivo visible de rotación justa (contador de 15 s en turno exclusivo
 * o insignia de abierto a todos tras completar la ronda).
 */
export function storeExclusiveTurnBadgeHtml(trip, { nowMs = Date.now() } = {}) {
    if (!isStoreDeliveryTrip(trip)) return '';
    const tripId = esc(trip?.id || '');
    if (isStoreOfferExclusiveActive(trip, nowMs)) {
        const rem = getStoreOfferRemainingSec(trip, nowMs);
        const step = Number(trip?.offerStepIndex)
            || (Array.isArray(trip?.offeredHistoryIds) ? trip.offeredHistoryIds.length : 1)
            || 1;
        const queueLen = Array.isArray(trip?.offerQueueDriverIds) ? trip.offerQueueDriverIds.length : 0;
        const stepTxt = queueLen >= step && queueLen > 0 ? `Turno ${step}/${queueLen}` : `Turno #${step}`;
        const todayCount = Number.isFinite(Number(trip?.offerStoreDeliveriesToday))
            ? ` · ${Number(trip.offerStoreDeliveriesToday)} envíos hoy`
            : '';
        return `<div class="hr-store-exclusive-banner" data-store-exclusive-badge data-store-offer-trip="${tripId}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:linear-gradient(135deg,#065F46,#047857);color:#ECFDF5;border:1.5px solid #34D399;padding:7px 11px;border-radius:10px;margin:6px 0;font-size:12px;font-weight:800;box-shadow:0 4px 12px rgba(4,120,87,0.28);">
            <span style="display:inline-flex;align-items:center;gap:6px;">
                <i class="fas fa-stopwatch" style="color:#FBBF24;"></i>
                <span>⏱️ Turno exclusivo: <b class="hr-store-exclusive-sec" data-store-exclusive-sec="${tripId}" style="color:#FDE68A;font-size:13.5px;">${rem}s</b> · Rotación justa de tienda</span>
            </span>
            <span style="background:rgba(16,185,129,0.28);color:#A7F3D0;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:900;white-space:nowrap;">${esc(stepTxt + todayCount)}</span>
        </div>`;
    }
    if (trip?.offerPhase === 'city' && Array.isArray(trip?.offeredHistoryIds) && trip.offeredHistoryIds.length > 0) {
        return `<div class="hr-store-open-city-banner" data-store-open-city-badge style="display:flex;align-items:center;gap:6px;background:#EFF6FF;color:#1E40AF;border:1px solid #93C5FD;padding:5px 10px;border-radius:8px;margin:5px 0;font-size:11.5px;font-weight:800;">
            <i class="fas fa-users"></i>
            <span>Disponible para todos los repartidores en línea (tras rotación de ${trip.offeredHistoryIds.length} ${trip.offeredHistoryIds.length === 1 ? 'turno' : 'turnos'})</span>
        </div>`;
    }
    return '';
}
