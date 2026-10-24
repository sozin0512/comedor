export const CAR_MIN_DELIVERY_FEE = 75;
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
export function estimateMerchantDelivery({ km, vehicle, fareFn, carFactor = 1.25, carMinFee = CAR_MIN_DELIVERY_FEE, commissionPercent = null }) {
    const v = normalizeMerchantVehicle(vehicle);
    const dist = Math.max(0.5, Number(km) || 0);
    if (!v || typeof fareFn !== 'function') return null;
    let price = Number(fareFn('delivery', dist, null, 1)) || 0;
    if (v === 'auto') {
        price *= Number(carFactor) || 1;
        const minFloor = Number.isFinite(Number(carMinFee)) ? Number(carMinFee) : CAR_MIN_DELIVERY_FEE;
        price = Math.max(minFloor, price);
    }
    price = Math.round(price * 100) / 100;
    const pct = Number(commissionPercent);
    const commission = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(price * pct) / 100 : null;
    return { vehicle: v, km: Math.round(dist * 100) / 100, price, commissionPercent: commission == null ? null : pct, commission };
}


/**
 * Precio REAL del envío = misma regla que los pedidos de tienda hoy:
 *  1) Zona de envío del admin (delivery_zones, «Envíos»): quoteStoreDeliveryFee del servidor
 *     → tarifa base de la zona o la tarifa propia de la tienda; carro = zona × CAR_DELIVERY_FACTOR.
 *  2) Fuera de zona con «cobrar por distancia»: tarifa del servicio Envío (base + L./km del admin,
 *     calculateServiceFare('delivery')) × recargo de carro. Es lo mismo que createDeliveryTripForOrder.
 *  3) Fuera de zona con «bloquear»: no se puede pedir.
 * Las tarifas fijas/rutas (route-fixed-fares.js) NO aplican a Envío (isPassengerService excluye delivery),
 * igual que en la app del pasajero.
 */
export function resolveMerchantDeliveryPrice({ quote = null, km, vehicle, fareFn, carFactor = 1.25, carMinFee = CAR_MIN_DELIVERY_FEE, commissionPercent = null }) {
    const v = normalizeMerchantVehicle(vehicle);
    if (!v) return null;
    const dist = Math.round(Math.max(0.5, Number(km) || 0) * 100) / 100;
    const minFloor = Number.isFinite(Number(carMinFee)) ? Number(carMinFee) : CAR_MIN_DELIVERY_FEE;
    const pct = Number(commissionPercent);
    const withCommission = (o) => {
        const ok = Number.isFinite(pct) && pct >= 0 && pct <= 100 && commissionPercent != null;
        return { ...o, commissionPercent: ok ? pct : null, commission: ok ? Math.round(o.price * pct) / 100 : null };
    };
    if (quote && quote.inZone) {
        let fee = Number(v === 'auto' ? quote.feeCar : quote.feeMoto);
        if (v === 'auto' && Number.isFinite(fee)) fee = Math.max(minFloor, fee);
        if (Number.isFinite(fee) && fee >= 0) {
            const custom = quote.source === 'store_custom';
            return withCommission({
                vehicle: v, km: dist, price: Math.round(fee * 100) / 100, blocked: false,
                tariff: {
                    kind: 'zone', zoneId: quote.zoneId || null, zoneName: quote.zoneName || '', source: quote.source || 'zone_base',
                    label: `Tarifa: ${quote.zoneName || 'Zona'}${custom ? ' (tu tarifa)' : ''}${v === 'auto' ? ' · carro +25%' : ''}`,
                },
            });
        }
    }
    if (quote && quote.blocked) {
        return withCommission({ vehicle: v, km: dist, price: 0, blocked: true, tariff: { kind: 'blocked', zoneId: null, zoneName: '', source: 'blocked', label: 'Fuera de las zonas de envío de tu ciudad' } });
    }
    const est = estimateMerchantDelivery({ km: dist, vehicle: v, fareFn, carFactor, carMinFee: minFloor });
    if (!est) return null;
    const offline = !quote || quote.reason === 'error';
    return withCommission({
        vehicle: v, km: dist, price: est.price, blocked: false,
        tariff: {
            kind: 'distance', zoneId: null, zoneName: '', source: offline ? 'distance_no_quote' : 'distance',
            label: `Tarifa: por distancia (${offline ? 'sin zona' : 'fuera de zona'}) · ${dist} km${v === 'auto' ? ' · carro +25%' : ''}`,
        },
    });
}

/** La tienda tiene ubicación real guardada (no el centro aproximado de la ciudad). */
export function storeHasSavedLocation(store) {
    const la = Number(store?.lat); const ln = Number(store?.lng);
    return !!store && store.lat != null && store.lng != null && isInHonduras(la, ln) && store.locationApprox !== true;
}

/** Errores del formulario (vacío = válido). */
export function validateMerchantDeliveryForm(f = {}) {
    const e = {};
    if (!normalizeMerchantVehicle(f.vehicle)) e.vehicle = 'Elige moto o carro';
    if (!isInHonduras(f.pickupLat, f.pickupLng)) e.pickup = 'Guarda primero la ubicación de tu tienda';
    if (!isInHonduras(f.dropoffLat, f.dropoffLng)) e.dropoff = String(f.dropoffAddress || '').trim() ? 'Elige la dirección de la lista o ponla en el mapa' : 'Busca la dirección o ponla en el mapa';
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
    const fee = Math.round(Number(estimate.price) * 100) / 100;
    return {
        // El servidor (onMerchantDirectDeliveryCreated) recalcula la tarifa y lo pasa a «pending».
        status: 'verifying',
        serviceType: 'delivery',
        customerPaysDelivery: true,
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
            productsPaymentMethod: collect > 0 ? 'efectivo' : 'ninguno',
            productsPaid: false,
            itemsTotal: collect,
            customerPaysDelivery: true,
            customerTotal: Math.round((fee + collect) * 100) / 100,
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
        deliveryZoneId: estimate.tariff?.zoneId || null,
        deliveryZoneName: estimate.tariff?.zoneName || null,
        deliveryFeeSource: estimate.tariff?.source || 'distance',
        fareLabel: estimate.tariff?.label || null,
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
    if (s === 'verifying') return { key: 'verifying', label: 'Verificando precio', tone: 'amber', canCancel: true };
    if (s === 'cancelled' && t.cancelReason === 'outside_delivery_zones') return { key: 'cancelled', label: 'Sin envío a esa zona', tone: 'gray', canCancel: false };
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

/** «El conductor cobra al cliente: Envío L. 35.00 + productos L. 250.00 = L. 285.00». */
export function customerChargeText(fee, collect) {
    const m = (n) => `L. ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const f = Number(fee) || 0; const c = Number(collect) || 0;
    return c > 0 ? `El conductor cobra al cliente: Envío ${m(f)} + productos ${m(c)} = ${m(f + c)}` : `El conductor cobra al cliente: Envío ${m(f)}`;
}

/**
 * Determina si un documento de trips corresponde a un envío de tienda/negocio que NO debe
 * secuestrar la pantalla principal del dueño en modo pasajero («trip-active» / «is-searching»).
 */
export function isMerchantOwnedDeliveryTrip(t = {}, uid = null, { hasStore = false, detachedIds = null } = {}) {
    if (!t || typeof t !== 'object') return false;
    if (t.merchantDirectDelivery === true) return true;
    if (t.deliveryDetails && t.deliveryDetails.merchantDirectDelivery === true) return true;
    if (t.createdVia === 'whatsapp_store') return true;
    if (t.createdByMerchant === true && (!uid || !t.merchantId || t.merchantId === uid || t.clientId === uid)) return true;
    if (t.storeDelivery === true && (!uid || !t.merchantId || t.merchantId === uid)) return true;
    if (t.id && detachedIds) {
        const hasId = Array.isArray(detachedIds)
            ? detachedIds.includes(t.id)
            : (typeof detachedIds.has === 'function' ? detachedIds.has(t.id) : false);
        if (hasId) return true;
    }
    if (hasStore === true && t.serviceType === 'delivery' && (!uid || !t.clientId || t.clientId === uid)) {
        return true;
    }
    return false;
}

/**
 * Si el negocio pega un link de Google Maps o coordenadas directas (ej. «14.4598, -87.6378» o
 * «https://maps.google.com/?q=14.4598,-87.6378»), extrae lat/lng dentro de Honduras.
 */
export function parseHondurasCoordsInput(raw = '') {
    const s = String(raw || '').trim();
    if (!s) return null;
    const patterns = [
        /[?&](?:q|query|ll)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i,
        /@(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i,
        /^\s*(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})\s*$/,
    ];
    for (const re of patterns) {
        const m = s.match(re);
        if (m) {
            const lat = Number(m[1]);
            const lng = Number(m[2]);
            if (isInHonduras(lat, lng)) {
                return {
                    lat,
                    lng,
                    label: `Ubicación GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
                };
            }
        }
    }
    return null;
}

/** Link público de seguimiento en vivo del envío para compartir al cliente. */
export function buildDeliveryTrackingUrl(tripId, baseOrigin = 'https://honduraite.com') {
    const cleanId = String(tripId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId) return '';
    const base = String(baseOrigin || 'https://honduraite.com').trim().replace(/\/+$/, '') || 'https://honduraite.com';
    return `${base}/?followTrip=${encodeURIComponent(cleanId)}`;
}

/** Normaliza teléfono de Honduras o internacional para wa.me (sin «+»). */
export function normalizeHondurasWhatsAppPhone(rawPhone = '') {
    let digits = String(rawPhone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length === 8 && /^[23789]/.test(digits)) return '504' + digits;
    if (digits.length === 11 && digits.startsWith('504')) return digits;
    if (digits.length >= 10 && digits.length <= 15) return digits;
    return '';
}

/** Construye el mensaje de WhatsApp con los detalles del envío y el link de seguimiento en vivo. */
export function buildMerchantShareTripMessage({ trip = null, order = null, storeName = '', trackingUrl = '', baseOrigin = 'https://honduraite.com' } = {}) {
    const t = trip || {};
    const o = order || {};
    const dd = t.deliveryDetails || {};
    const tripId = String(t.id || o.tripId || '').trim();
    const url = String(trackingUrl || '').trim() || buildDeliveryTrackingUrl(tripId, baseOrigin);
    const store = String(storeName || dd.storeName || dd.restaurant || t.merchantName || o.storeName || 'Tu tienda').trim();
    const recipient = String(dd.recipientName || o.recipientName || o.clientName || '').trim();
    const destination = String(t.destination || o.deliveryAddress || '').trim();
    const driverName = String(t.driverName || o.driverName || '').trim();
    const plate = String(t.driverVehicle?.plate || o.driverPlate || '').trim();
    const vehModel = String(t.driverVehicle?.model || '').trim();
    const driverDesc = [driverName, vehModel, plate ? `placa ${plate}` : ''].filter(Boolean).join(' · ');

    const st = String(t.status || '');
    const ost = String(o.status || '');
    let statusLine = '🔎 *Estado:* Buscando repartidor para tu pedido';
    if (st === 'completed' || ost === 'delivered') {
        statusLine = '✅ *Estado:* Pedido entregado';
    } else if (st === 'in_progress' || ost === 'out_for_delivery') {
        statusLine = `🛵 *Estado:* ¡Tu pedido ya va en camino!${driverDesc ? ` (${driverDesc})` : ''}`;
    } else if (st === 'accepted') {
        statusLine = t.driverArrived
            ? `🏪 *Estado:* El repartidor ya está en *${store}* recogiendo tu pedido${driverDesc ? ` (${driverDesc})` : ''}`
            : `🛵 *Estado:* Repartidor asignado${driverDesc ? ` (${driverDesc})` : ''} · en camino a *${store}*`;
    } else if (driverDesc) {
        statusLine = `🛵 *Repartidor:* ${driverDesc}`;
    }

    const fmt = (n) => `L. ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fee = Number.isFinite(Number(t.priceNum)) ? Number(t.priceNum) : (Number(o.deliveryFee) || 0);
    const collect = Number.isFinite(Number(dd.collectAmount))
        ? Number(dd.collectAmount)
        : (o.paymentMethod === 'saldo' && o.paymentStatus === 'paid' ? 0 : (Number(o.itemsTotal) || 0));

    let payLine = '';
    if (collect > 0 && fee > 0) {
        payLine = `💵 *Total a pagar al recibir:* ${fmt(fee + collect)} (envío ${fmt(fee)} + pedido ${fmt(collect)})`;
    } else if (fee > 0) {
        payLine = `💵 *Envío a pagar al recibir:* ${fmt(fee)}`;
    } else if (collect > 0) {
        payLine = `💵 *Pedido a pagar al recibir:* ${fmt(collect)}`;
    }

    const lines = [
        `👋 ¡Hola${recipient ? ` *${recipient}*` : ''}! Te compartimos el seguimiento de tu envío de *${store}* en *HonduRaite*.`,
        statusLine,
    ];
    if (destination) lines.push(`📍 *Entrega en:* ${destination}`);
    if (payLine) lines.push(payLine);
    if (url) {
        lines.push(`\n🗺️ *Sigue tu envío en vivo en el mapa aquí:*\n${url}`);
    }
    return lines.join('\n');
}

/** Construye la URL de WhatsApp (wa.me/<tel>?text=... o api.whatsapp.com/send?text=...) para compartir el viaje al cliente. */
export function buildMerchantShareTripWhatsAppUrl({ trip = null, order = null, storeName = '', trackingUrl = '', phone = '', baseOrigin = 'https://honduraite.com' } = {}) {
    const t = trip || {};
    const o = order || {};
    const dd = t.deliveryDetails || {};
    const rawPhone = phone || dd.recipientPhone || o.recipientPhone || o.clientPhone || '';
    const cleanPhone = normalizeHondurasWhatsAppPhone(rawPhone);
    const msg = buildMerchantShareTripMessage({ trip: t, order: o, storeName, trackingUrl, baseOrigin });
    if (cleanPhone) {
        return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    }
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
}
