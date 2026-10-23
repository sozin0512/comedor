/**
 * «Pedir envío» desde la tienda (sin pedido de cliente): la tienda/restaurante pide
 * un delivery directo en moto o carro. Funciones puras (sin Firebase ni DOM):
 * probadas en scripts/test-pedir-envio-tienda.mjs. La UI vive en merchant-stores.js.
 *
 * - Moto  → solo conductores moto       (allowedDriverVehicles ['moto'], Disponibilidad «delivery»)
 * - Carro → solo conductores Taxi VIP   (allowedDriverVehicles ['auto'], Disponibilidad «auto»)
 *   (igual que los pedidos de tienda de hoy: js/service-types.js driverCanServeTrip; taxi tradicional no entrega)
 * El viaje lleva storeDelivery + createdByMerchant + merchantDirectDelivery → insignia «Pedido de tienda»,
 * «Pidió hace X min» y la melodía en bucle a los conductores (js/store-order-alert.js).
 */
export const MERCHANT_DELIVERY_VEHICLES = {
    moto: { id: 'moto', label: 'Moto', icon: 'fa-motorcycle', allowed: ['moto'], availService: 'delivery' },
    auto: { id: 'auto', label: 'Carro', icon: 'fa-car', allowed: ['auto'], availService: 'auto' },
};

export function normalizeMerchantVehicle(v) {
    const t = String(v || '').toLowerCase();
    if (t === 'auto' || t === 'carro' || t === 'car' || t === 'vip' || t === 'taxi_vip') return 'auto';
    if (t === 'moto') return 'moto';
    return null;
}

export function haversineKm(aLat, aLng, bLat, bLng) {
    const R = 6371; const r = (d) => (d * Math.PI) / 180;
    const dLat = r(bLat - aLat); const dLng = r(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/** Dentro de Honduras (caja aproximada): evita coordenadas de otro país. */
export function isInHonduras(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 12.9 && lat <= 16.6 && lng >= -89.4 && lng <= -83.1;
}

/**
 * Precio estimado con las tarifas del servicio Envío (calculateServiceFare, editables por admin)
 * y el recargo de carro que ya usan los pedidos de tienda (CAR_DELIVERY_FACTOR).
 * commissionPercent = comisión del servicio que configuró el admin (informativo: la paga el conductor).
 */
export function estimateMerchantDelivery({ km, vehicle, fareFn, carFactor = 1, commissionPercent = null }) {
    const v = normalizeMerchantVehicle(vehicle);
    const dist = Math.max(0.5, Number(km) || 0);
    if (!v || typeof fareFn !== 'function') return null;
    let price = Number(fareFn('delivery', dist, null, 1)) || 0;
    if (v === 'auto') price *= Number(carFactor) || 1;
    price = Math.round(price * 100) / 100;
    const pct = Number(commissionPercent);
    const commission = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(price * pct) / 100 : null;
    return { vehicle: v, km: Math.round(dist * 100) / 100, price, commissionPercent: commission == null ? null : pct, commission };
}

/** Errores del formulario (vacío = válido). */
export function validateMerchantDeliveryForm(f = {}) {
    const e = {};
    if (!normalizeMerchantVehicle(f.vehicle)) e.vehicle = 'Elige moto o carro';
    if (!isInHonduras(f.pickupLat, f.pickupLng)) e.pickup = 'Falta el punto de recogida (ubicación de la tienda)';
    if (!String(f.dropoffAddress || '').trim()) e.dropoff = 'Escribe la dirección de entrega';
    else if (!isInHonduras(f.dropoffLat, f.dropoffLng)) e.dropoff = 'Elige la dirección de la lista (en Honduras)';
    if (f.customerPhone && String(f.customerPhone).replace(/\D/g, '').length < 8) e.customerPhone = 'Teléfono incompleto';
    const c = f.collectAmount;
    if (c !== '' && c != null && !(Number(c) >= 0 && Number(c) <= 100000)) e.collectAmount = 'Monto inválido';
    return e;
}

/** Viaje que se crea en trips (las reglas exigen dueño de la tienda = merchantId = clientId). */
export function buildMerchantDeliveryTrip({ store, uid, form, estimate, zone = null, nowMs = Date.now(), serverTs = null }) {
    const v = normalizeMerchantVehicle(form.vehicle);
    const meta = MERCHANT_DELIVERY_VEHICLES[v];
    const collect = form.collectAmount === '' || form.collectAmount == null ? 0 : Math.round(Number(form.collectAmount) * 100) / 100;
    const name = String(store?.name || 'Tienda').slice(0, 80);
    const notes = String(form.notes || '').slice(0, 300);
    return {
        status: 'pending',
        serviceType: 'delivery',
        bookingType: 'standard',
        passengers: 1, passengerSurcharge: 0, extraPassengers: 0,
        tripDistanceKm: estimate.km, tripDurationMs: 0,
        storeDelivery: true,
        createdByMerchant: true,
        merchantDirectDelivery: true,
        storeId: store.id,
        merchantId: uid,
        deliveryVehicle: v,
        allowedDriverVehicles: meta.allowed.slice(),
        deliveryDetails: {
            category: store?.category || 'comida',
            restaurant: name, storeName: name, storePhone: store?.phone || '',
            recipientName: String(form.customerName || '').slice(0, 80),
            recipientPhone: String(form.customerPhone || '').replace(/[^\d+]/g, '').slice(0, 20),
            packageDescription: (`Envío de ${name}` + (notes ? `: ${notes}` : '')).slice(0, 400),
            deliveryNotes: notes,
            storeDelivery: true,
            merchantDirectDelivery: true,
            deliveryVehicle: v,
            collectAmount: collect,
            productsPaymentMethod: collect > 0 ? 'efectivo' : 'pagado',
            productsPaid: !(collect > 0),
            itemsTotal: collect,
            orderCreatedAtMs: nowMs,
        },
        storeOrderCreatedAtMs: nowMs,
        deliverySlaMinutes: 30,
        freightDetails: null,
        origin: String(form.pickupAddress || store?.address || name).slice(0, 200),
        destination: String(form.dropoffAddress).slice(0, 200),
        originPlaceName: name, destinationPlaceName: null,
        originFormattedAddress: form.pickupAddress || store?.address || null,
        destinationFormattedAddress: form.dropoffAddress,
        originSource: 'store',
        originLat: Number(form.pickupLat), originLng: Number(form.pickupLng),
        destinationLat: Number(form.dropoffLat), destinationLng: Number(form.dropoffLng),
        serviceZoneId: zone?.id || store?.cityId || null,
        serviceZoneName: zone?.name || store?.cityName || null,
        searchRadiusKm: 25,
        price: `L. ${estimate.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        priceNum: estimate.price,
        paymentMethod: 'efectivo',
        clientId: uid,
        clientName: name,
        clientPhone: store?.phone || '',
        clientPhoto: null, clientRating: '5.0', clientApprovalStatus: 'approved', clientVerified: true,
        clientIsFirstTrip: false, clientTotalTrips: 0,
        createdAt: serverTs,
        chat: [], viewedBy: {}, declinedDriverIds: [],
        offeredToDriverId: null, preferredDriverId: null,
        negotiationEnabled: false,
        merchantName: name,
    };
}

/** Estado para la tienda: buscando conductor · aceptado · en camino · entregado · cancelado. */
export function merchantDeliveryStatus(t = {}) {
    const s = String(t.status || '');
    if (s === 'cancelled') return { key: 'cancelled', label: 'Cancelado', tone: 'gray', canCancel: false };
    if (s === 'completed') return { key: 'delivered', label: 'Entregado', tone: 'green', canCancel: false };
    if (s === 'in_progress') return { key: 'on_the_way', label: 'En camino', tone: 'blue', canCancel: false };
    if (s === 'accepted') return { key: 'accepted', label: t.driverArrived ? 'Conductor en la tienda' : 'Aceptado', tone: 'violet', canCancel: false };
    if (s === 'pending' && !t.driverId) return { key: 'searching', label: 'Buscando conductor', tone: 'amber', canCancel: true };
    return { key: s || 'unknown', label: s || '—', tone: 'gray', canCancel: false };
}

/** Disponibilidad (admin → Disponibilidad): resolver = window.__hrServiceAvailability(svc, zoneId). */
export function merchantVehicleAvailability(vehicle, zoneId, resolver) {
    const meta = MERCHANT_DELIVERY_VEHICLES[normalizeMerchantVehicle(vehicle)];
    if (!meta) return { available: false, message: 'No disponible' };
    let r = null;
    try { r = typeof resolver === 'function' ? resolver(meta.availService, zoneId) : null; } catch (_) {}
    if (!r || r.available !== false) return { available: true, message: '' };
    return { available: false, message: r.message || 'No disponible' };
}

/** Patch de cancelación permitido por las reglas (solo antes de que acepten). */
export function merchantCancelPatch(nowMs = Date.now()) {
    return { status: 'cancelled', cancelledBy: 'merchant', cancelReason: 'merchant_cancelled', cancelledAtMs: nowMs };
}
