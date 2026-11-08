/**
 * WhatsApp · «Pedir envío (tienda)»: una tienda/restaurante pide un delivery (moto o carro)
 * por el bot de WhatsApp. Crea EXACTAMENTE el mismo viaje que el panel «Pedir envío»
 * (js/merchant-delivery-request.js buildMerchantDeliveryTrip): status 'verifying' +
 * merchantDirectDelivery → onMerchantDirectDeliveryCreated verifica el precio y lo pasa a 'pending'
 * (melodía a conductores, comisión en servidor). Recogida = ubicación guardada de la tienda,
 * así el conductor ve la ruta tienda → entrega igual que en el panel.
 *
 * Solo tiendas vinculadas al número que escribe: teléfono de la tienda (stores.phone) o el
 * teléfono del perfil del dueño (public/data/users/{ownerId}.phone). Nunca tiendas arbitrarias.
 * Todo con dependencias inyectadas: probado en scripts/test-wa-envio-tienda.cjs (sin Meta real).
 */
'use strict';

const DZ = require('./delivery-zones');

const VEHICLES = {
    moto: { id: 'moto', label: 'Moto', emoji: '🏍️', allowed: ['moto'], availService: 'delivery' },
    auto: { id: 'auto', label: 'Carro', emoji: '🚗', allowed: ['auto'], availService: 'auto' },
};
const ZR_STEPS = ['zr_branch', 'zr_pickup_loc', 'zr_phone'];
const STEPS = ['st_pick', 'st_vehicle', 'st_pickup_loc', 'st_dest', 'st_dest_confirm', 'st_recipient', 'st_notes', 'st_collect', 'st_confirm'];
const WINDOW_MS = 24 * 60 * 60 * 1000 - 5 * 60 * 1000;

function fold(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function lmoney(n) { return `L. ${money(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function isInHonduras(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 12.9 && lat <= 16.6 && lng >= -89.4 && lng <= -83.1;
}

/** Formas en que se guarda un teléfono hondureño (504XXXXXXXX, +504…, 8 dígitos, con espacio/guion). */
function phoneVariants(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    const out = new Set();
    if (!d) return [];
    out.add(d); out.add(`+${d}`);
    if (d.startsWith('504') && d.length === 11) {
        const l = d.slice(3);
        [l, `+504${l}`, `+504 ${l}`, `504 ${l}`, `${l.slice(0, 4)}-${l.slice(4)}`, `+504 ${l.slice(0, 4)}-${l.slice(4)}`, `504${l.slice(0, 4)}-${l.slice(4)}`].forEach((x) => out.add(x));
    }
    return [...out].slice(0, 30);
}
function samePhone(a, b) {
    const n = (x) => { let d = String(x || '').replace(/\D/g, ''); if (d.length === 8) d = `504${d}`; return d; };
    return !!n(a) && n(a) === n(b);
}

/** Flujo CON destino (el de antes): botón del menú o «envío con destino». */
function isEntry(id, t) {
    return id === 'tienda_envio' || /^(pedir )?envio (con destino|tienda|de tienda|para mi tienda)$/.test(t);
}

/**
 * Flujo simple SIN destino (cobro por zona): «necesito un envío», «envío», «rider», «ryder», «raider»,
 * «repartidor», «motorista»… tolerante a tildes y errores comunes. Solo aplica a números de tienda.
 */
const ZR_WORDS = ['envio', 'envios', 'rider', 'ryder', 'raider', 'raidr', 'rayder', 'repartidor', 'repartidora', 'repartido', 'repatidor', 'reparidor', 'motorista', 'motoritsa', 'motorsita', 'motoriste', 'delivery', 'delivey'];
function lev1(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
    let i = 0; let j = 0; let d = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i += 1; j += 1; continue; }
        d += 1; if (d > 1) return false;
        if (a.length > b.length) i += 1; else if (b.length > a.length) j += 1; else { i += 1; j += 1; }
    }
    return d + (a.length - i) + (b.length - j) <= 1;
}
function isZoneTrigger(id, t) {
    if (id === 'zr_start') return true;
    const s = String(t || '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 60) return false;
    if (/\b(con destino|cancelar|mis envios)\b/.test(s)) return false;
    return s.split(' ').some((w) => ZR_WORDS.some((k) => lev1(w, k)));
}
function isGreeting(t) {
    return /^(hola+|buenas?( tardes| noches| dias)?|buenos dias|hey|ola|saludos|que tal|hi)\b/.test(String(t || '').trim());
}

/** Teléfono hondureño del cliente + nota opcional en el mismo mensaje. null si no hay número válido. */
function parseCustomerPhoneAndNote(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/(\+?\s*504[\s-]*)?([2389]\d{3})[\s.-]?(\d{4})(?!\d)/);
    if (!m) return null;
    const local = `${m[2]}${m[3]}`;
    const note = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/^[\s,.;:·-]+|[\s,.;:·-]+$/g, '').replace(/\s+/g, ' ').slice(0, 300);
    return { phone: local, display: `${m[2]}-${m[3]}`, note };
}

/** Viaje «sin destino» (igual que buildZoneBillingTrip del panel) + marcas de WhatsApp. */
function buildWaZoneTrip({ store, storeId, vehicle = 'moto', customerPhone, notes, phone, nowMs, serverTs }) {
    const base = buildWaStoreTrip({ store, storeId, vehicle, dest: { address: 'Por definir · se cobra por zona al entregar', lat: null, lng: null }, recipientName: '', recipientPhone: customerPhone, notes, collect: 0, quote: null, fee: 0, km: 0, phone, nowMs, serverTs });
    const name = String(store?.name || 'Tienda').slice(0, 80);
    return {
        ...base,
        zoneBilling: true,
        destinationLat: null, destinationLng: null, destinationFormattedAddress: null,
        price: 'Por zona', priceNum: 0, deliveryFeeSource: 'zone_on_delivery', fareLabel: 'Se cobra por zona al entregar',
        deliveryZoneId: null, deliveryZoneName: null,
        deliveryDetails: { ...base.deliveryDetails, zoneBilling: true, customerTotal: 0, packageDescription: (`Envío de ${name} (sin destino)` + (notes ? `: ${notes}` : '')).slice(0, 400) },
    };
}

/** Mismo viaje que el panel (buildMerchantDeliveryTrip) + marcas de WhatsApp. */
function buildWaStoreTrip({ store, storeId, vehicle, dest, recipientName, recipientPhone, notes, collect, quote, fee, km, phone, nowMs, serverTs }) {
    const v = VEHICLES[vehicle] ? vehicle : 'moto';
    const name = String(store?.name || 'Tienda').slice(0, 80);
    const n = String(notes || '').slice(0, 300);
    const c = money(Math.max(0, Number(collect) || 0));
    const f = money(fee);
    return {
        status: 'verifying',
        serviceType: 'delivery',
        customerPaysDelivery: true,
        bookingType: 'standard',
        passengers: 1, passengerSurcharge: 0, extraPassengers: 0,
        tripDistanceKm: km, tripDurationMs: 0,
        storeDelivery: true,
        createdByMerchant: true,
        merchantDirectDelivery: true,
        storeId,
        merchantId: store.ownerId,
        deliveryVehicle: v,
        allowedDriverVehicles: VEHICLES[v].allowed.slice(),
        // Mismas claves que el viaje del panel (buildMerchantDeliveryTrip). Por WhatsApp no hay
        // lista de productos (la tienda escribe texto libre → deliveryNotes): quedan vacías.
        itemsSummary: null,
        deliveryDetails: {
            storeId,
            category: store?.category || 'comida',
            restaurant: name, storeName: name, storePhone: store?.phone || '',
            recipientName: String(recipientName || '').slice(0, 80),
            recipientPhone: String(recipientPhone || '').replace(/[^\d+]/g, '').slice(0, 20),
            packageDescription: (`Envío de ${name}` + (n ? `: ${n}` : '')).slice(0, 400),
            deliveryNotes: n,
            items: [],
            itemsSummary: '',
            itemsSubtotal: 0,
            storeDelivery: true,
            merchantDirectDelivery: true,
            deliveryVehicle: v,
            collectAmount: c,
            productCharge: c,
            productsPaymentMethod: c > 0 ? 'efectivo' : 'ninguno',
            productsPaid: false,
            itemsTotal: c,
            customerPaysDelivery: true,
            customerTotal: money(f + c),
            orderCreatedAtMs: nowMs,
        },
        storeOrderCreatedAtMs: nowMs,
        deliverySlaMinutes: 30,
        freightDetails: null,
        origin: String(store?.address || name).slice(0, 200),
        destination: String(dest.address).slice(0, 200),
        originPlaceName: name, destinationPlaceName: null,
        originFormattedAddress: store?.address || null,
        destinationFormattedAddress: dest.address,
        originSource: 'store',
        originLat: Number(store.lat), originLng: Number(store.lng),
        destinationLat: Number(dest.lat), destinationLng: Number(dest.lng),
        deliveryZoneId: quote?.inZone ? (quote.zoneId || null) : null,
        deliveryZoneName: quote?.inZone ? (quote.zoneName || null) : null,
        deliveryFeeSource: quote?.inZone ? (quote.source || 'zone_base') : 'distance',
        fareLabel: null,
        serviceZoneId: store?.cityId || null,
        serviceZoneName: store?.cityName || null,
        searchRadiusKm: 25,
        price: lmoney(f),
        priceNum: f,
        paymentMethod: 'efectivo',
        clientId: store.ownerId,
        clientName: name,
        clientPhone: store?.phone || '',
        clientPhoto: null, clientRating: '5.0', clientApprovalStatus: 'approved', clientVerified: true,
        clientIsFirstTrip: false, clientTotalTrips: 0,
        createdAt: serverTs,
        chat: [], viewedBy: {}, declinedDriverIds: [],
        offeredToDriverId: null, preferredDriverId: null,
        negotiationEnabled: false,
        merchantName: name,
        // WhatsApp: avisos de estado propios a este número (canNotifyPassengerWa salta createdVia 'whatsapp_store').
        // OJO: sin staffCreatedBy — eso bloquearía a los conductores («esperando al cliente»).
        createdVia: 'whatsapp_store',
        waStorePhone: phone,
    };
}

/** Estado para avisar a la tienda (null = no avisar). */
function storeStatusKey(t = {}) {
    const s = t.status;
    // Sin destino: «entregado» cuando el servidor ya puso zona y precio
    if (s === 'completed' && (t.zoneBilling === true || t.deliveryDetails?.zoneBilling === true)) return t.zoneFeeAtMs != null ? 'delivered' : null;
    if (s === 'pending' && !t.driverId) return 'searching';
    if (s === 'accepted') return 'accepted';
    if (s === 'in_progress') return 'on_the_way';
    if (s === 'completed') return 'delivered';
    if (s === 'cancelled') return 'cancelled';
    return null;
}
function storeStatusText(key, t = {}, tripId = '') {
    const store = t.deliveryDetails?.storeName || t.merchantName || 'tu tienda';
    const plate = String(t.driverVehicle?.plate || t.driverVehiclePlate || '').trim();
    const tid = String(tripId || t.id || '').trim();
    const linkSuffix = tid ? `\n📍 Link para compartir al cliente: https://honduraite.com/?followTrip=${encodeURIComponent(tid)}` : '';
    if (t.zoneBilling === true || t.deliveryDetails?.zoneBilling === true) {
        const drvPhone = String(t.driverPhone || '').replace(/[^\d+]/g, '');
        switch (key) {
            case 'searching': return `🔎 Buscando repartidor para *${store}* · se cobra por zona al entregar.`;
            case 'accepted': return `✅ *${t.driverName || 'Un repartidor'}* aceptó el envío${plate ? ` · placa *${plate}*` : ''}${drvPhone ? ` · 📞 ${drvPhone}` : ''}. Va hacia *${store}* a recoger.${linkSuffix}`;
            case 'on_the_way': return `🛵 El repartidor ya recogió el pedido y va con el cliente.${linkSuffix}`;
            case 'delivered': return `📦 Entregado en ${t.deliveryZoneName ? `*${t.deliveryZoneName}*` : '*fuera de zona* (por km)'} · *${lmoney(t.priceNum)}* (lo pagó el cliente en efectivo al repartidor).`;
            case 'cancelled': return '❌ El envío se canceló. Escribe *repartidor* para pedir otro.';
            default: return '';
        }
    }
    switch (key) {
        case 'searching': return `🔎 Buscando conductor para el envío de *${store}* (${t.price || ''}).${linkSuffix}`;
        case 'accepted': return `✅ *${t.driverName || 'Un conductor'}* aceptó el envío${plate ? ` · placa *${plate}*` : ''}. Va hacia *${store}* a recoger.${linkSuffix}`;
        case 'on_the_way': return `🛵 El envío de *${store}* va en camino a la entrega.${linkSuffix}`;
        case 'delivered': return `📦 Envío entregado. ¡Gracias por usar HonduRaite!`;
        case 'cancelled': return t.cancelReason === 'outside_delivery_zones'
            ? '❌ El envío se canceló: la dirección está fuera de las zonas de envío.'
            : '❌ El envío se canceló. Escribe *envío* para pedir otro.';
        default: return '';
    }
}

module.exports = function createWaStoreDelivery(deps) {
    const { db, FieldValue, APP_ID, send, geocode, checkAvailable, getQuoteFor, normalizePhone,
        lastInboundAtMs, sendTemplate, templateName = () => '', now = () => Date.now() } = deps;
    const base = `artifacts/${APP_ID}/public/data`;
    const linkCache = new Map();

    async function findLinkedStores(phone, { fresh = false } = {}) {
        const key = String(phone || '');
        const hit = linkCache.get(key);
        if (!fresh && hit && now() - hit.at < 5 * 60 * 1000) return hit.stores;
        const vars = phoneVariants(phone);
        const found = new Map();
        if (vars.length) {
            let canon = String(phone || '').replace(/\D/g, ''); if (canon.startsWith('00')) canon = canon.slice(2); if (canon.length === 8) canon = `504${canon}`;
            const [byStore, byUser, byStaff] = await Promise.all([
                db.collection(`${base}/stores`).where('phone', 'in', vars).limit(20).get().catch(() => null),
                db.collection(`${base}/users`).where('phone', 'in', vars).limit(10).get().catch(() => null),
                // Empleados: «Números autorizados para pedir por WhatsApp» del panel de la tienda (solo dueño/staff los escriben).
                canon ? db.collection(`${base}/stores`).where('waAuthorizedPhones', 'array-contains', canon).limit(20).get().catch(() => null) : null,
            ]);
            byStore?.docs.forEach((d) => found.set(d.id, d.data() || {}));
            byStaff?.docs.forEach((d) => found.set(d.id, d.data() || {}));
            const uids = (byUser?.docs || []).map((d) => d.id).slice(0, 10);
            if (uids.length) {
                const own = await db.collection(`${base}/stores`).where('ownerId', 'in', uids).limit(20).get().catch(() => null);
                own?.docs.forEach((d) => found.set(d.id, d.data() || {}));
            }
        }
        const stores = [...found.entries()]
            .filter(([, s]) => s.ownerId && s.deleted !== true && s.approvalStatus !== 'rejected')
            .map(([id, s]) => ({ id, ...s }))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .slice(0, 10);
        linkCache.set(key, { at: now(), stores });
        return stores;
    }

    async function hasLinkedStores(phone) {
        return (await findLinkedStores(phone)).length > 0;
    }

    /** Re-lee la tienda y confirma que sigue vinculada a este número (nunca confiar en el id que llega). */
    async function loadLinkedStore(phone, storeId) {
        const list = await findLinkedStores(phone, { fresh: true });
        return list.find((s) => s.id === storeId) || null;
    }

    async function vehicleAvailability(store) {
        const out = {};
        for (const v of Object.keys(VEHICLES)) {
            let r = null;
            try {
                r = await checkAvailable({ serviceType: VEHICLES[v].availService, zoneId: store.cityId || null, zoneName: store.cityName || '', center: Number.isFinite(Number(store.lat)) ? { lat: Number(store.lat), lng: Number(store.lng) } : null, scheduled: false });
            } catch (_) { r = null; }
            out[v] = !r || r.available !== false ? { available: true, message: '' } : { available: false, message: r.message || 'No disponible' };
        }
        return out;
    }

    async function quote(store, sess) {
        const q = await getQuoteFor()(APP_ID, { storeId: sess.stStoreId, lat: sess.stDest.lat, lng: sess.stDest.lng, cityId: store.cityId || null, vehicle: sess.stVehicle });
        const settings = await db.doc(`${base}/appSettings/main`).get().catch(() => null);
        const rate = DZ.deliveryRateFrom(settings && settings.exists ? settings.get('fixedFares') : null);
        const draft = { merchantId: store.ownerId, destinationLat: sess.stDest.lat, destinationLng: sess.stDest.lng, deliveryVehicle: sess.stVehicle, deliveryDetails: { collectAmount: sess.stCollect || 0 } };
        const r = DZ.verifyMerchantDirectDelivery({ trip: draft, store, quote: q, rate, nowMs: now() });
        return { ...r, q, km: r.patch?.tripDistanceKm };
    }

    async function askStore(from, stores) {
        if (stores.length === 1) {
            return send.buttons(from, `¿Pedir envío para *${stores[0].name || 'tu tienda'}*?`, [
                { id: `st_store:${stores[0].id}`, title: 'Sí, esa tienda' },
                { id: 'st_abort', title: 'No' },
            ]);
        }
        return send.list(from, '¿Cuál es tu tienda?', 'Ver tiendas',
            stores.map((s) => ({ id: `st_store:${s.id}`, title: (s.branchName ? `${s.name || 'Tienda'} · ${s.branchName}` : (s.name || 'Tienda')).slice(0, 24), description: String([s.branchName, s.address || s.cityName || ''].filter(Boolean).join(' · ')).slice(0, 72) })),
            'Tus tiendas');
    }

    async function askVehicle(from, store, save, sess) {
        const a = await vehicleAvailability(store);
        const ok = Object.keys(VEHICLES).filter((v) => a[v].available);
        const lines = Object.keys(VEHICLES).map((v) => `${VEHICLES[v].emoji} ${VEHICLES[v].label}${a[v].available ? '' : ` — No disponible${a[v].message && a[v].message !== 'No disponible' ? ` (${a[v].message})` : ''}`}`);
        if (!ok.length) {
            await save({ step: 'idle' });
            return send.text(from, `Ahora no hay envíos disponibles para *${store.name}*:\n${lines.join('\n')}\nIntenta más tarde 🙏`);
        }
        await save({ ...sess, step: 'st_vehicle' });
        return send.buttons(from, `*${store.name}* · ¿En qué lo mandamos?\n${lines.join('\n')}`,
            ok.map((v) => ({ id: `st_veh_${v}`, title: `${VEHICLES[v].label}` })).concat([{ id: 'st_abort', title: 'Cancelar' }]));
    }

    async function askDest(from) {
        await send.locationRequest(from, '📍 *¿A dónde va el envío?*\nComparte la *ubicación de entrega* (📎 → Ubicación) o escribe la dirección (barrio, colonia, referencia).', 'Entrega: enviar pin');
    }

    function summary(store, sess, fee) {
        const c = money(sess.stCollect || 0);
        const v = VEHICLES[sess.stVehicle];
        return [
            `*Envío desde ${store.name}* ${v.emoji} ${v.label}`,
            `Recoge: ${store.address || 'ubicación de la tienda'}`,
            `Entrega: ${sess.stDest.address}`,
            sess.stRecipientName || sess.stRecipientPhone ? `Recibe: ${[sess.stRecipientName, sess.stRecipientPhone].filter(Boolean).join(' · ')}` : null,
            sess.stNotes ? `Notas: ${sess.stNotes}` : null,
            '',
            c > 0
                ? `El cliente paga: Envío ${lmoney(fee)} + productos ${lmoney(c)} = *${lmoney(fee + c)}*`
                : `El cliente paga: Envío *${lmoney(fee)}*`,
        ].filter((x) => x !== null).join('\n');
    }

    async function cancelActiveTrip(from) {
        const snap = await db.collection(`${base}/trips`).where('waStorePhone', '==', from).limit(30).get().catch(() => null);
        const docs = (snap?.docs || []).filter((d) => ['verifying', 'pending', 'accepted', 'in_progress'].includes(d.get('status')));
        if (!docs.length) return null;
        docs.sort((a, b) => (Number(b.get('storeOrderCreatedAtMs')) || 0) - (Number(a.get('storeOrderCreatedAtMs')) || 0));
        const ref = docs[0].ref;
        return db.runTransaction(async (tx) => {
            const cur = await tx.get(ref);
            const t = cur.data() || {};
            if (!['verifying', 'pending'].includes(t.status) || t.driverId) return { ok: false, trip: t };
            tx.update(ref, { status: 'cancelled', cancelledBy: 'merchant', cancelReason: 'merchant_cancel_whatsapp', cancelledAtMs: now() });
            return { ok: true, trip: t };
        });
    }


    async function storePref(phone) {
        try { const d = await db.doc(`${base}/wa_store_prefs/${phone}`).get(); return d.exists ? (d.get('storeId') || null) : null; } catch (_) { return null; }
    }
    async function setStorePref(phone, storeId) {
        await db.doc(`${base}/wa_store_prefs/${phone}`).set({ storeId, updatedAtMs: now() }, { merge: true }).catch(() => {});
    }
    async function askCustomerPhone(from, store, save, sess) {
        await save({ ...sess, step: 'zr_phone', zrStoreId: store.id });
        return send.text(from, `🛵 *Pedir repartidor · ${store.name || 'tu tienda'}*\n📞 Escribe el *teléfono del cliente*. Si querés, agregá una nota en el mismo mensaje.\nEj.: *9876-5432 pedido de Juan, 2 bolsas*\n\nEl repartidor llama al cliente para saber a dónde va y el envío se cobra por zona al entregar.`);
    }
    async function zoneStart(from, stores, save) {
        if (stores.length === 1) return askCustomerPhone(from, stores[0], save, {});
        const pref = await storePref(from);
        const st = pref && stores.find((s) => s.id === pref);
        if (st) return askCustomerPhone(from, st, save, {});
        await save({ step: 'zr_branch', stStoreIds: stores.map((s) => s.id) });
        return send.list(from, '¿Para cuál sucursal es el repartidor? (lo recuerdo para la próxima)', 'Ver sucursales',
            stores.map((s) => ({ id: `zr_store:${s.id}`, title: (s.branchName ? `${s.name || 'Tienda'} · ${s.branchName}` : (s.name || 'Tienda')).slice(0, 24), description: String([s.branchName, s.address || s.cityName || ''].filter(Boolean).join(' · ')).slice(0, 72) })),
            'Tus tiendas');
    }
    async function listMine(from) {
        const snap = await db.collection(`${base}/trips`).where('waStorePhone', '==', from).limit(30).get().catch(() => null);
        const docs = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (Number(b.storeOrderCreatedAtMs) || 0) - (Number(a.storeOrderCreatedAtMs) || 0)).slice(0, 5);
        if (!docs.length) return send.buttons(from, 'Todavía no pediste envíos por aquí.', [{ id: 'zr_start', title: 'Pedir repartidor' }]);
        const label = { verifying: '🔎 Buscando', pending: '🔎 Buscando', accepted: '✅ Aceptado', in_progress: '🛵 En camino', completed: '📦 Entregado', cancelled: '❌ Cancelado' };
        const lines = docs.map((d) => {
            const zone = d.zoneBilling ? (d.zoneFeeAtMs != null ? `${d.deliveryZoneName || 'Fuera de zona'} · ${lmoney(d.priceNum)}` : 'Por zona') : (d.price || '');
            return `${label[d.status] || d.status} · ${d.deliveryDetails?.recipientPhone || d.destination || ''} · ${zone}${d.driverName ? ` · ${d.driverName}` : ''}`;
        });
        return send.buttons(from, `*Tus últimos envíos*\n${lines.join('\n')}`, [{ id: 'zr_start', title: 'Pedir repartidor' }, { id: 'menu', title: 'Menú' }]);
    }
    async function cancelById(from, tripId) {
        if (!/^[A-Za-z0-9_-]{5,80}$/.test(tripId)) return null;
        const ref = db.doc(`${base}/trips/${tripId}`);
        return db.runTransaction(async (tx) => {
            const cur = await tx.get(ref);
            const tt = cur.data() || {};
            if (!cur.exists || tt.waStorePhone !== from) return null;
            if (!['verifying', 'pending'].includes(tt.status) || tt.driverId) return { ok: false, trip: tt };
            tx.update(ref, { status: 'cancelled', cancelledBy: 'merchant', cancelReason: 'merchant_cancel_whatsapp', cancelledAtMs: now() });
            return { ok: true, trip: tt };
        });
    }

    async function handleZone({ from, text, id, idl, t, location, sess, save, clearSession }) {
        const zrFlow = ZR_STEPS.includes(sess.step);
        if (idl.startsWith('zr_cancel:')) {
            const r = await cancelById(from, id.slice('zr_cancel:'.length));
            if (!r) return false;
            await send.text(from, r.ok ? 'Listo, cancelé el envío ✅. Escribe *repartidor* para pedir otro.' : 'El repartidor ya aceptó este envío, ya no se puede cancelar por aquí. Escribe *soporte* si necesitas ayuda.');
            return true;
        }
        const inOld = STEPS.includes(sess.step);
        if (!zrFlow) {
            if (inOld) return false;
            const trig = isZoneTrigger(idl, t) && !isEntry(idl, t);
            const greet = !idl && isGreeting(t);
            const mine = idl === 'zr_list' || /^mis envios$/.test(t);
            if (!trig && !greet && !mine) return false;
            const stores = await findLinkedStores(from, { fresh: trig || mine });
            if (!stores.length) return false; // clientes y números sin tienda: flujo normal
            if (mine) { await listMine(from); return true; }
            if (greet) {
                await send.buttons(from, `¡Hola! 👋 ¿Qué necesita *${stores.length === 1 ? (stores[0].name || 'tu tienda') : 'tu tienda'}*?`, [
                    { id: 'zr_start', title: 'Pedir repartidor' }, { id: 'zr_list', title: 'Mis envíos' }, { id: 'menu', title: 'Menú' },
                ]);
                return true;
            }
            await zoneStart(from, stores, save);
            return true;
        }
        if (idl === 'st_abort' || /^(cancelar|salir)$/.test(t)) {
            await clearSession(from);
            await send.text(from, 'Listo, no pedí el repartidor. Escribe *repartidor* cuando quieras.');
            return true;
        }
        if (idl === 'menu' || /^(menu|inicio)$/.test(t)) { await clearSession(from); return false; }
        if (sess.step === 'zr_branch') {
            const sid = idl.startsWith('zr_store:') ? id.slice('zr_store:'.length) : '';
            const store = sid && (sess.stStoreIds || []).includes(sid) ? await loadLinkedStore(from, sid) : null;
            if (!store) {
                const stores = await findLinkedStores(from, { fresh: true });
                if (!stores.length) { await clearSession(from); return false; }
                await save({ step: 'zr_branch', stStoreIds: stores.map((s) => s.id) });
                await send.list(from, 'Elegí la sucursal de la lista 👇', 'Ver sucursales', stores.map((s) => ({ id: `zr_store:${s.id}`, title: (s.branchName ? `${s.name || 'Tienda'} · ${s.branchName}` : (s.name || 'Tienda')).slice(0, 24) })), 'Tus tiendas');
                return true;
            }
            await setStorePref(from, store.id);
            await askCustomerPhone(from, store, save, {});
            return true;
        }
        const store = await loadLinkedStore(from, sess.zrStoreId);
        if (!store) { await clearSession(from); await send.text(from, 'Esa tienda ya no está vinculada a este número.'); return true; }
        if (sess.step === 'zr_pickup_loc') {
            if (!location || !isInHonduras(location.lat, location.lng)) { await send.text(from, 'Necesito la *ubicación* de la tienda en Honduras: 📎 → Ubicación → Enviar.'); return true; }
            await db.doc(`${base}/stores/${store.id}`).update({ lat: Number(location.lat), lng: Number(location.lng), locationUpdatedVia: 'whatsapp', locationUpdatedAtMs: now() });
            store.lat = Number(location.lat); store.lng = Number(location.lng);
            await send.text(from, '✅ Guardé la ubicación de la tienda.');
            if (!sess.zrPhone) { await askCustomerPhone(from, store, save, {}); return true; }
            return createZoneTrip(from, store, sess, clearSession);
        }
        if (sess.step === 'zr_phone') {
            const p = parseCustomerPhoneAndNote(text);
            if (!p) { await send.text(from, 'Ese número no parece hondureño 🤔. Escribe los 8 dígitos del cliente (ej. *9876-5432*), y si querés una nota después.'); return true; }
            const next = { ...sess, zrPhone: p.phone, zrNote: p.note };
            if (![Number(store.lat), Number(store.lng)].every(Number.isFinite) || !isInHonduras(store.lat, store.lng)) {
                await save({ ...next, step: 'zr_pickup_loc' });
                await send.locationRequest(from, `📍 *${store.name}* no tiene ubicación guardada. Compártela una vez (📎 → Ubicación) y la guardo.`, 'Tienda: enviar pin');
                return true;
            }
            return createZoneTrip(from, store, next, clearSession);
        }
        return false;
    }

    async function createZoneTrip(from, store, sess, clearSession) {
        const a = await vehicleAvailability(store);
        if (!a.moto.available) { await clearSession(from); await send.text(from, `Moto: ${a.moto.message || 'No disponible'} 🙏. Intenta más tarde.`); return true; }
        const trip = buildWaZoneTrip({ store, storeId: store.id, vehicle: 'moto', customerPhone: sess.zrPhone, notes: sess.zrNote || '', phone: from, nowMs: now(), serverTs: FieldValue.serverTimestamp() });
        const ref = await db.collection(`${base}/trips`).add(trip);
        await clearSession(from);
        await send.buttons(from, `✅ *Repartidor pedido* para *${store.name}*\n📞 Cliente: ${sess.zrPhone.slice(0, 4)}-${sess.zrPhone.slice(4)}${sess.zrNote ? `\n📝 ${sess.zrNote}` : ''}\n💵 Se cobra por zona al entregar (el cliente le paga al repartidor en efectivo).\nTe aviso aquí cuando un repartidor acepte.`, [{ id: `zr_cancel:${ref.id}`, title: 'Cancelar envío' }]);
        return { handled: true, tripId: ref.id };
    }

    /**
     * @returns {Promise<boolean>} true si este módulo atendió el mensaje.
     */
    async function handle({ from, text, buttonId, location, session, saveSession, clearSession }) {
        const id = String(buttonId || '').trim();
        const idl = id.toLowerCase();
        const t = fold(text);
        const sess = session || { step: 'idle' };
        const inFlow = STEPS.includes(sess.step);
        const save = (data) => saveSession(from, data);

        // ── Flujo simple «Pedir repartidor» (sin destino, cobro por zona) ──
        const zr = await handleZone({ from, text, id, idl, t, location, sess, save, clearSession });
        if (zr) return zr;

        if (!inFlow && !isEntry(idl, t)) {
            if (/^cancelar( envio)?$/.test(t) && (sess.step === 'idle' || !sess.step)) {
                const r = await cancelActiveTrip(from);
                if (!r) return false;
                if (r.ok) await send.text(from, 'Listo, cancelé el envío ✅. Escribe *envío* para pedir otro.');
                else await send.text(from, 'El conductor ya aceptó este envío, ya no se puede cancelar por aquí. Escribe *soporte* si necesitas ayuda.');
                return true;
            }
            return false;
        }
        if (idl === 'st_abort' || (inFlow && /^(cancelar|salir)$/.test(t))) {
            await clearSession(from);
            await send.text(from, 'Listo, no pedí el envío. Escribe *envío* cuando quieras.');
            return true;
        }
        if (idl === 'menu' || (inFlow && /^(menu|inicio)$/.test(t))) return false;

        // Inicio: solo tiendas vinculadas a este número.
        if (!inFlow || (sess.step === 'st_pick' && !idl.startsWith('st_store:'))) {
            const stores = await findLinkedStores(from, { fresh: true });
            if (!stores.length) {
                await clearSession(from);
                await send.text(from, 'Este número no está vinculado a ninguna tienda en HonduRaite, así que no puedo pedir envíos de tienda. Te muestro las opciones normales 👇');
                await send.menu(from);
                return true;
            }
            await save({ step: 'st_pick', stStoreIds: stores.map((s) => s.id) });
            await askStore(from, stores);
            return true;
        }

        let store = null;
        if (sess.step === 'st_pick') {
            const storeId = id.slice('st_store:'.length);
            if (!(sess.stStoreIds || []).includes(storeId)) store = null;
            else store = await loadLinkedStore(from, storeId);
            if (!store) {
                await send.text(from, 'Esa tienda no está vinculada a este número.');
                const stores = await findLinkedStores(from, { fresh: true });
                if (stores.length) await askStore(from, stores);
                return true;
            }
            const next = { step: 'st_vehicle', stStoreIds: sess.stStoreIds, stStoreId: store.id };
            await askVehicle(from, store, save, next);
            return true;
        }

        store = await loadLinkedStore(from, sess.stStoreId);
        if (!store) {
            await clearSession(from);
            await send.text(from, 'Esa tienda ya no está vinculada a este número. Escribe *envío* para empezar otra vez.');
            return true;
        }

        if (sess.step === 'st_vehicle') {
            const v = idl === 'st_veh_moto' || t === 'moto' ? 'moto' : (idl === 'st_veh_auto' || /^(carro|auto)$/.test(t) ? 'auto' : null);
            if (!v) { await askVehicle(from, store, save, sess); return true; }
            const a = await vehicleAvailability(store);
            if (!a[v].available) {
                await send.text(from, `${VEHICLES[v].label}: ${a[v].message || 'No disponible'}.`);
                await askVehicle(from, store, save, sess);
                return true;
            }
            const next = { ...sess, stVehicle: v };
            if (![Number(store.lat), Number(store.lng)].every(Number.isFinite) || !isInHonduras(store.lat, store.lng)) {
                await save({ ...next, step: 'st_pickup_loc' });
                await send.locationRequest(from, `📍 *${store.name}* no tiene ubicación guardada. Compártela una vez (📎 → Ubicación) y la guardo para los próximos envíos.`, 'Tienda: enviar pin');
                return true;
            }
            await save({ ...next, step: 'st_dest' });
            await askDest(from);
            return true;
        }

        if (sess.step === 'st_pickup_loc') {
            if (!location || !isInHonduras(location.lat, location.lng)) {
                await send.text(from, 'Necesito la *ubicación* de la tienda en Honduras: 📎 → Ubicación → Enviar.');
                return true;
            }
            await db.doc(`${base}/stores/${store.id}`).update({
                lat: Number(location.lat), lng: Number(location.lng),
                ...(store.address ? {} : { address: String(location.address || '').slice(0, 200) }),
                locationUpdatedVia: 'whatsapp', locationUpdatedAtMs: now(),
            });
            await save({ ...sess, step: 'st_dest' });
            await send.text(from, '✅ Guardé la ubicación de la tienda.');
            await askDest(from);
            return true;
        }

        if (sess.step === 'st_dest') {
            let place = null;
            if (location) place = { address: location.address, lat: Number(location.lat), lng: Number(location.lng) };
            else if (String(text || '').trim().length >= 3) place = await geocode(String(text).trim(), { lat: store.lat, lng: store.lng, cityName: store.cityName || '' });
            if (!place || !isInHonduras(place.lat, place.lng)) {
                await send.text(from, 'No encontré esa dirección en Honduras 🤔. Comparte el pin (📎 → Ubicación) o escríbela con barrio/colonia y ciudad.');
                return true;
            }
            await save({ ...sess, step: 'st_dest_confirm', stDest: { address: String(place.address || '').slice(0, 200), lat: place.lat, lng: place.lng } });
            await send.buttons(from, `Entrega en:\n*${place.address}*\n¿Es correcto?`, [
                { id: 'st_dest_ok', title: 'Sí, correcto' },
                { id: 'st_dest_retry', title: 'Cambiar' },
            ]);
            return true;
        }

        if (sess.step === 'st_dest_confirm') {
            if (idl === 'st_dest_retry' || /^(no|cambiar)$/.test(t)) { await save({ ...sess, step: 'st_dest', stDest: null }); await askDest(from); return true; }
            if (idl !== 'st_dest_ok' && !/^(si|correcto|ok)$/.test(t)) {
                await send.buttons(from, `¿La entrega es en *${sess.stDest?.address}*?`, [{ id: 'st_dest_ok', title: 'Sí, correcto' }, { id: 'st_dest_retry', title: 'Cambiar' }]);
                return true;
            }
            await save({ ...sess, step: 'st_recipient' });
            await send.buttons(from, '¿Quién recibe? Escribe nombre y teléfono (ej. *María 9876-5432*).', [{ id: 'st_skip', title: 'Omitir' }]);
            return true;
        }

        const skip = idl === 'st_skip' || /^(omitir|no|ninguno|ninguna|-)$/.test(t);
        if (sess.step === 'st_recipient') {
            let name = ''; let ph = '';
            if (!skip) {
                const raw = String(text || '').trim();
                const m = raw.match(/(\+?\d[\d\s-]{7,}\d)/);
                if (m) { ph = m[1].replace(/[^\d+]/g, ''); name = raw.replace(m[1], '').replace(/[,·-]+\s*$/, '').trim(); } else name = raw;
            }
            await save({ ...sess, step: 'st_notes', stRecipientName: name.slice(0, 80), stRecipientPhone: ph.slice(0, 20) });
            await send.buttons(from, '¿Notas para el conductor? (qué lleva, referencia, etc.)', [{ id: 'st_skip', title: 'Omitir' }]);
            return true;
        }
        if (sess.step === 'st_notes') {
            await save({ ...sess, step: 'st_collect', stNotes: skip ? '' : String(text || '').trim().slice(0, 300) });
            await send.buttons(from, '¿Cuánto cobra el conductor por los *productos*? Escribe el monto (ej. *350*). Si ya están pagados, toca *Nada*.', [{ id: 'st_collect_0', title: 'Nada' }]);
            return true;
        }
        if (sess.step === 'st_collect') {
            let c = 0;
            if (idl !== 'st_collect_0' && !skip) {
                const m = String(text || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
                if (!m || Number(m[0]) > 50000) { await send.text(from, 'Escribe solo el monto en lempiras (ej. *350*) o toca *Nada*.'); return true; }
                c = money(m[0]);
            }
            const next = { ...sess, stCollect: c };
            const r = await quote(store, next);
            if (!r.ok) {
                await clearSession(from);
                await send.text(from, r.reason === 'outside_delivery_zones'
                    ? `❌ Esa dirección está fuera de las zonas de envío de *${store.name}*. Escribe *envío* para probar otra.`
                    : 'No pude calcular el envío. Escribe *envío* para intentar de nuevo.');
                return true;
            }
            await save({ ...next, step: 'st_confirm', stFee: r.fee });
            await send.buttons(from, summary(store, next, r.fee), [{ id: 'st_confirm', title: 'Confirmar' }, { id: 'st_abort', title: 'Cancelar' }]);
            return true;
        }
        if (sess.step === 'st_confirm') {
            if (idl !== 'st_confirm' && !/^(si|confirmar|confirmo|ok)$/.test(t)) {
                await send.buttons(from, '¿Confirmo el envío?', [{ id: 'st_confirm', title: 'Confirmar' }, { id: 'st_abort', title: 'Cancelar' }]);
                return true;
            }
            const a = await vehicleAvailability(store);
            if (!a[sess.stVehicle]?.available) {
                await clearSession(from);
                await send.text(from, `${VEHICLES[sess.stVehicle].label}: ${a[sess.stVehicle]?.message || 'No disponible'} 🙏`);
                return true;
            }
            const r = await quote(store, sess);
            if (!r.ok) { await clearSession(from); await send.text(from, '❌ Ya no se puede enviar a esa dirección. Escribe *envío* para probar otra.'); return true; }
            const trip = buildWaStoreTrip({
                store, storeId: store.id, vehicle: sess.stVehicle, dest: sess.stDest,
                recipientName: sess.stRecipientName, recipientPhone: sess.stRecipientPhone, notes: sess.stNotes,
                collect: sess.stCollect, quote: r.q, fee: r.fee, km: r.km, phone: from, nowMs: now(),
                serverTs: FieldValue.serverTimestamp(),
            });
            const ref = await db.collection(`${base}/trips`).add(trip);
            await clearSession(from);
            const changed = Math.abs(r.fee - (Number(sess.stFee) || 0)) >= 0.01;
            const followUrl = `https://honduraite.com/?followTrip=${encodeURIComponent(ref.id)}`;
            await send.text(from, `✅ Envío pedido${changed ? ` (tarifa actualizada: ${lmoney(r.fee)})` : ''}. Te aviso aquí cuando un conductor acepte.\n📍 Link de seguimiento para tu cliente: ${followUrl}\nEscribe *cancelar* para anularlo antes de que lo acepten.`);
            return { handled: true, tripId: ref.id };
        }
        return false;
    }

    /** onDocumentUpdated(trips): avisos de estado a la tienda por WhatsApp. */
    async function onTripStatusChange(before, after, tripId, ref) {
        if (!after || after.createdVia !== 'whatsapp_store' || !after.waStorePhone) return { skipped: 'not_wa_store' };
        const k0 = storeStatusKey(before || {}); const k1 = storeStatusKey(after);
        if (!k1 || k0 === k1) return { skipped: 'same' };
        if (k1 === 'cancelled' && after.cancelReason === 'merchant_cancel_whatsapp') return { skipped: 'own_cancel' };
        if ((after.waStoreStatusSent || {})[k1]) return { skipped: 'already' };
        const body = storeStatusText(k1, after, tripId);
        const phone = normalizePhone(after.waStorePhone);
        const last = await lastInboundAtMs(phone);
        let res;
        if (last && now() - last < WINDOW_MS) {
            res = await send.textLogged(phone, body, { purpose: `store_delivery_${k1}` });
            res = { ...res, via: 'text' };
        } else if (templateName()) {
            res = await sendTemplate(phone, templateName(), [String(after.deliveryDetails?.storeName || 'tu tienda').slice(0, 60), body.replace(/[*\n]/g, ' ').slice(0, 300)]);
            res = { ...res, via: 'template' };
        } else {
            res = { ok: false, skipped: true, reason: 'outside_24h_no_template', via: 'none' };
        }
        if (res.ok && ref) await ref.update({ [`waStoreStatusSent.${k1}`]: true }).catch(() => {});
        return res;
    }

    return { handle, findLinkedStores, hasLinkedStores, onTripStatusChange, vehicleAvailability };
};
Object.assign(module.exports, { isZoneTrigger, isGreeting, parseCustomerPhoneAndNote, buildWaZoneTrip, ZR_STEPS, phoneVariants, samePhone, buildWaStoreTrip, storeStatusKey, storeStatusText, isEntry, VEHICLES, STEPS, isInHondurasPublic: isInHonduras });
