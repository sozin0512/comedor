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
export const PD_MAX = 2;
export const PD_NEAR_PICKUP_M = 300;
export const PD_DEST_NEAR_KM = 1.5;
export const PD_DETOUR_MAX_KM = 3;
export const PD_AT_STORE_M = 150;
export const PD_PRIORITY_SEC = 25;

export function pdKm(aLat, aLng, bLat, bLng) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const num = (v) => (v == null || v === '' ? NaN : Number(v));
const pt = (lat, lng) => (Number.isFinite(num(lat)) && Number.isFinite(num(lng)) ? { lat: num(lat), lng: num(lng) } : null);
export function pdPickup(t) { return pt(t?.originLat, t?.originLng); }
export function pdDest(t) { return pt(t?.destinationLat ?? t?.destLat, t?.destinationLng ?? t?.destLng); }
export function pdIsZone(t) { return !!t && (t.zoneBilling === true || t.deliveryDetails?.zoneBilling === true); }
export function pdIsStoreOrder(t) {
    if (!t || typeof t !== 'object') return false;
    const d = t.deliveryDetails || {};
    return !!(t.storeOrderId || d.storeOrderId || t.storeDelivery === true || t.merchantDirectDelivery || t.createdByMerchant === true
        || t.createdVia === 'whatsapp_store' || (t.storeId && (t.serviceType === 'delivery' || pdIsZone(t))));
}
export function pdStoreKey(t) { return String(t?.storeId || t?.deliveryDetails?.storeId || '') || null; }

/** ¿Se puede sumar `cand` (pendiente) como 2º pedido del viaje `active` del repartidor? */
export function pdCanPair(active, cand) {
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
export function pdAtStore(active, driverPos) {
    if (!active || active.status !== 'accepted' || active.storePickedUpAt) return false;
    if (active.driverArrived) return true;
    const p = pdPickup(active);
    if (!p || !driverPos || !Number.isFinite(num(driverPos.lat))) return false;
    return pdKm(p.lat, p.lng, num(driverPos.lat), num(driverPos.lng)) * 1000 <= PD_AT_STORE_M;
}

/** Prioridad: mismo negocio + repartidor en el negocio + emparejable. */
export function pdPriority(active, cand, driverPos) {
    const pair = pdCanPair(active, cand);
    if (!pair.ok || !pair.sameStore) return false;
    return pdAtStore(active, driverPos);
}

/** Orden sugerido de entrega: el destino más cercano a la recogida primero. */
export function pdDeliveryOrder(a, b) {
    const p = pdPickup(a) || pdPickup(b);
    const da = pdDest(a), db = pdDest(b);
    if (!p || !da || !db) return [a, b];
    return pdKm(p.lat, p.lng, da.lat, da.lng) <= pdKm(p.lat, p.lng, db.lat, db.lng) ? [a, b] : [b, a];
}
