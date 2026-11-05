/**
 * Pedir SIN CUENTA desde la app/web: nombre + WhatsApp.
 * - guestCreateRequest: crea el viaje (mismo armado que el bot de WhatsApp: createWhatsAppTrip,
 *   tarifa del SERVIDOR) o el pedido de tienda (mismo documento que buildWaCustomerOrder, solo efectivo).
 *   clientId = guest_<504xxxxxxxx>, guestClient = true. Límites: 3 activos y 10 por día por teléfono y por equipo.
 * - guestTrackRequest: el invitado ve el estado de su pedido de tienda con el token que le dimos.
 * - guestClaimRequests: al crear cuenta / entrar, pasa sus viajes y pedidos guest_ a su uid (con token).
 * Probado en scripts/test-guest-checkout.cjs (emulador).
 */
'use strict';
const crypto = require('crypto');

const MAX_ACTIVE = 3;
const MAX_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIP_SERVICES = ['auto', 'taxi', 'moto', 'flete_paila', 'flete_camion', 'grua', 'delivery'];

/** +504 / 504 / 8 dígitos → «504XXXXXXXX» (celular hondureño: empieza en 3, 7, 8 o 9). */
function normalizeGuestPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('504')) d = d.slice(3);
    if (!/^[3789]\d{7}$/.test(d)) return null;
    return `504${d}`;
}
function cleanName(raw) {
    const n = String(raw || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return n.length >= 2 ? n : null;
}
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const str = (v, n = 200) => String(v ?? '').slice(0, n);
const okLat = (v) => v != null && v >= 12 && v <= 17.5;
const okLng = (v) => v != null && v >= -89.6 && v <= -83;
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const safeKey = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

/** Solo lo que el invitado puede elegir. El precio y los datos del cliente los pone el servidor. */
function sanitizeTripInput(p = {}) {
    const serviceType = TRIP_SERVICES.includes(p.serviceType) ? p.serviceType : null;
    const origin = { address: str(p.origin, 200), lat: num(p.originLat), lng: num(p.originLng) };
    const dest = { address: str(p.destination, 200), lat: num(p.destinationLat), lng: num(p.destinationLng) };
    if (!serviceType) return { error: 'Servicio no válido.' };
    if (!origin.address || !okLat(origin.lat) || !okLng(origin.lng)) return { error: 'Marca el punto de recogida en el mapa.' };
    if (!dest.address || !okLat(dest.lat) || !okLng(dest.lng)) return { error: 'Marca el destino en el mapa.' };
    const stops = (Array.isArray(p.additionalStops) ? p.additionalStops : []).slice(0, 5)
        .map((s) => ({ address: str(s?.address || s?.placeName, 120), lat: num(s?.lat ?? s?.latLng?.lat), lng: num(s?.lng ?? s?.latLng?.lng) }))
        .filter((s) => okLat(s.lat) && okLng(s.lng));
    let scheduledFor = null;
    const sf = num(p.scheduledForMs);
    if (sf && sf > Date.now() && sf < Date.now() + 30 * DAY_MS) scheduledFor = new Date(sf).toISOString();
    const pick = (o, keys) => (o && typeof o === 'object' ? Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, typeof o[k] === 'number' ? o[k] : str(o[k], 300)])) : null);
    const deliveryDetails = serviceType === 'delivery' ? pick(p.deliveryDetails, ['description', 'packageType', 'size', 'recipientName', 'recipientPhone', 'notes', 'itemValue']) : null;
    const freightDetails = /^flete_/.test(serviceType) ? pick(p.freightDetails, ['cargoDescription', 'description', 'weightKg', 'helpers', 'contactPhone', 'notes', 'floors', 'vehicleSize']) : null;
    const passengers = Math.min(6, Math.max(1, Math.floor(num(p.passengers) || 1)));
    return { serviceType, origin, dest, stops, scheduledFor, deliveryDetails, freightDetails, passengers,
        originPlaceName: str(p.originPlaceName, 120) || null, destinationPlaceName: str(p.destinationPlaceName, 120) || null };
}

module.exports = function guestCheckoutModule({ db, FieldValue, HttpsError, onCall, APP_ID, createTrip, checkAvailability, orderHelpers, now = () => Date.now() }) {
    const base = `artifacts/${APP_ID}/public/data`;
    const limitsCol = () => db.collection(`${base}/guest_limits`);
    const reqCol = () => db.collection(`${base}/guest_requests`);

    /** Reserva un cupo (transacción). Cuenta pedidos del día y activos por teléfono y por equipo. */
    async function reserveSlot(keys) {
        const t = now();
        await db.runTransaction(async (tx) => {
            const refs = keys.map((k) => limitsCol().doc(k));
            const snaps = await Promise.all(refs.map((r) => tx.get(r)));
            snaps.forEach((s) => {
                const d = s.exists ? s.data() : {};
                const day = (d.dayStartMs && t - d.dayStartMs < DAY_MS) ? (d.dayCount || 0) : 0;
                const active = (d.active || []).filter((a) => t - (a.atMs || 0) < DAY_MS);
                if (day >= MAX_PER_DAY) throw new HttpsError('resource-exhausted', 'Llegaste al límite de pedidos sin cuenta por hoy. Crea tu cuenta para seguir pidiendo.');
                if (active.length >= MAX_ACTIVE) throw new HttpsError('resource-exhausted', 'Ya tienes 3 pedidos activos sin cuenta. Espera que terminen o crea tu cuenta.');
            });
            snaps.forEach((s, i) => {
                const d = s.exists ? s.data() : {};
                const fresh = !(d.dayStartMs && t - d.dayStartMs < DAY_MS);
                tx.set(refs[i], { dayStartMs: fresh ? t : d.dayStartMs, dayCount: (fresh ? 0 : (d.dayCount || 0)) + 1, updatedAtMs: t }, { merge: true });
            });
        });
    }
    async function markActive(keys, kind, id) {
        await Promise.all(keys.map((k) => limitsCol().doc(k).set({ active: FieldValue.arrayUnion({ kind, id, atMs: now() }) }, { merge: true })));
    }
    /** Quita de «activos» lo que ya terminó (para no bloquear al cliente que vuelve a pedir). */
    async function pruneActive(keys) {
        for (const k of keys) {
            const s = await limitsCol().doc(k).get();
            const list = s.exists ? (s.get('active') || []) : [];
            if (!list.length) continue;
            const keep = [];
            for (const a of list) {
                if (now() - (a.atMs || 0) >= DAY_MS) continue;
                const col = a.kind === 'trip' ? 'trips' : 'store_orders';
                const d = await db.doc(`${base}/${col}/${a.id}`).get().catch(() => null);
                const st = d?.exists ? d.get('status') : 'gone';
                if (!['completed', 'cancelled', 'delivered', 'rejected', 'gone'].includes(st)) keep.push(a);
            }
            if (keep.length !== list.length) await limitsCol().doc(k).set({ active: keep }, { merge: true });
        }
    }

    async function createTripFor(guest, p, meta) {
        const t = sanitizeTripInput(p);
        if (t.error) throw new HttpsError('invalid-argument', t.error);
        if (checkAvailability) {
            const a = await checkAvailability({ serviceType: t.serviceType, origin: t.origin, dest: t.dest, scheduled: !!t.scheduledFor }).catch(() => null);
            if (a && a.available === false) throw new HttpsError('failed-precondition', a.message || 'Servicio no disponible ahora en tu ciudad.');
        }
        const created = await createTrip({
            phone: guest.phone, name: guest.name, origin: t.origin, dest: t.dest, scheduledFor: t.scheduledFor,
            clientChoosesSchedule: false, clientChoosesRoute: false, serviceType: t.serviceType, stops: t.stops,
            extra: {
                createdVia: 'app_guest', guestCheckout: true, guestInvitePending: false,
                staffCreatedBy: null, staffCreatedByName: null, staffAssistedClient: false, staffCreatedClientClaimed: false,
                passengers: t.serviceType === 'moto' ? 1 : t.passengers, clientChoosesPassengers: false,
                deliveryDetails: t.deliveryDetails, freightDetails: t.freightDetails,
                originPlaceName: t.originPlaceName, destinationPlaceName: t.destinationPlaceName,
                guestDeviceId: meta.deviceId || null,
            },
        });
        return { id: created.id, priceNum: created.priceNum, price: created.payload?.price || null };
    }

    async function createOrderFor(guest, p, meta) {
        const storeId = safeKey(p.storeId);
        const sd = storeId ? await db.doc(`${base}/stores/${storeId}`).get() : null;
        const store = sd?.exists ? { id: sd.id, ...sd.data() } : null;
        if (!store || !orderHelpers.storeApproved(store)) throw new HttpsError('failed-precondition', 'Esta tienda no recibe pedidos sin cuenta.');
        if (!orderHelpers.isOpenNow(store, now())) throw new HttpsError('failed-precondition', 'La tienda está cerrada ahora.');
        const lat = num(p.deliveryLat); const lng = num(p.deliveryLng);
        if (!str(p.deliveryAddress) || !okLat(lat) || !okLng(lng)) throw new HttpsError('invalid-argument', 'Marca la dirección de entrega en el mapa.');
        const want = (Array.isArray(p.items) ? p.items : []).slice(0, 40);
        if (!want.length) throw new HttpsError('invalid-argument', 'Carrito vacío.');
        const cart = [];
        for (const it of want) {
            const pid = safeKey(it?.productId);
            const qty = Math.min(50, Math.max(1, Math.floor(num(it?.qty) || 1)));
            const pd = pid ? await db.doc(`${base}/store_products/${pid}`).get() : null;
            const prod = pd?.exists ? pd.data() : null;
            const price = Number(prod?.price ?? prod?.basePrice);
            if (!prod || prod.storeId !== store.id || prod.available === false || !(price > 0)) throw new HttpsError('failed-precondition', `«${str(it?.name, 40) || 'Producto'}» ya no está disponible.`);
            const left = orderHelpers.stockLeft(prod, store);
            if (left != null && left < qty) throw new HttpsError('failed-precondition', `Solo quedan ${left} de «${prod.name}».`);
            cart.push({ productId: pid, name: prod.name || 'Producto', price, qty, photoUrl: prod.photoUrl || null });
        }
        const recipientPhone = normalizeGuestPhone(p.recipientPhone) || guest.phone;
        const order = orderHelpers.buildWaCustomerOrder({
            store, cart, dest: { address: str(p.deliveryAddress), lat, lng }, vehicle: p.deliveryVehicle === 'auto' ? 'auto' : 'moto',
            phone: guest.phone, name: guest.name, nowMs: now(), serverTs: FieldValue.serverTimestamp(), notes: str(p.notes, 300),
            recipient: { name: cleanName(p.recipientName) || guest.name, phone: recipientPhone }, pay: null,
        });
        Object.assign(order, { createdVia: 'app_guest', guestCheckout: true, guestDeviceId: meta.deviceId || null, waCustomerPhone: guest.phone,
            cityId: str(p.cityId, 60) || order.cityId, cityName: str(p.cityName, 60) || order.cityName });
        const ref = db.collection(`${base}/store_orders`).doc();
        await ref.set(order);
        return { id: ref.id, itemsTotal: order.itemsTotal };
    }

    const guestCreateRequest = onCall({ cors: true }, async (req) => {
        const d = req.data || {};
        const kind = d.kind === 'store_order' ? 'store_order' : (d.kind === 'trip' ? 'trip' : null);
        if (!kind) throw new HttpsError('invalid-argument', 'Tipo de pedido no válido.');
        const name = cleanName(d.name);
        const phone = normalizeGuestPhone(d.phone);
        if (!name) throw new HttpsError('invalid-argument', 'Escribe tu nombre.');
        if (!phone) throw new HttpsError('invalid-argument', 'Escribe un WhatsApp de Honduras (8 dígitos).');
        const blocked = await db.doc(`${base}/guest_blocklist/${phone}`).get().catch(() => null);
        if (blocked?.exists) throw new HttpsError('permission-denied', 'Este número no puede pedir sin cuenta. Escríbenos por WhatsApp.');
        const deviceId = safeKey(d.deviceId);
        const ip = safeKey(String(req.rawRequest?.ip || '').replace(/[.:]/g, '_'));
        const keys = [`p_${phone}`, ...(deviceId ? [`d_${deviceId}`] : []), ...(ip ? [`ip_${ip}`] : [])];
        await pruneActive(keys.slice(0, 2)).catch(() => {});
        // Por IP solo el límite diario (muchas personas comparten IP del operador): reservar sin «activos».
        await reserveSlot(keys.slice(0, 2));
        if (ip) {
            const s = await limitsCol().doc(`ip_${ip}`).get();
            const dd = s.exists ? s.data() : {};
            const t = now();
            const fresh = !(dd.dayStartMs && t - dd.dayStartMs < DAY_MS);
            const count = (fresh ? 0 : (dd.dayCount || 0)) + 1;
            if (count > MAX_PER_DAY * 5) throw new HttpsError('resource-exhausted', 'Demasiados pedidos sin cuenta desde esta red. Intenta más tarde o crea tu cuenta.');
            await limitsCol().doc(`ip_${ip}`).set({ dayStartMs: fresh ? t : dd.dayStartMs, dayCount: count, updatedAtMs: t }, { merge: true });
        }
        const guest = { name, phone };
        const meta = { deviceId };
        const out = kind === 'trip' ? await createTripFor(guest, d.payload || {}, meta) : await createOrderFor(guest, d.payload || {}, meta);
        await markActive(keys.slice(0, 2), kind, out.id);
        const token = crypto.randomBytes(18).toString('base64url');
        await reqCol().doc(out.id).set({ kind, phone, tokenHash: hashToken(token), deviceId: deviceId || null, createdAtMs: now(), claimedBy: null });
        return { ok: true, kind, id: out.id, token, clientId: `guest_${phone}`, ...out };
    });

    async function checkToken(kind, id, token) {
        const key = safeKey(id);
        if (!key || !token) return null;
        const r = await reqCol().doc(key).get();
        if (!r.exists || r.get('kind') !== kind || r.get('tokenHash') !== hashToken(token)) return null;
        return { key, data: r.data() };
    }

    const guestTrackRequest = onCall({ cors: true }, async (req) => {
        const d = req.data || {};
        const kind = d.kind === 'trip' ? 'trip' : 'store_order';
        const ok = await checkToken(kind, d.id, d.token);
        if (!ok) throw new HttpsError('permission-denied', 'No encontramos ese pedido.');
        const doc = await db.doc(`${base}/${kind === 'trip' ? 'trips' : 'store_orders'}/${ok.key}`).get();
        if (!doc.exists) throw new HttpsError('not-found', 'No encontramos ese pedido.');
        const o = doc.data();
        return {
            id: doc.id, kind, status: o.status || null, storeName: o.storeName || null, storePhone: o.storePhone || null,
            itemsTotal: o.itemsTotal ?? null, deliveryFee: o.deliveryFee ?? null, tripId: o.tripId || null,
            driverName: o.driverName || null, items: (o.items || []).map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
            price: o.price || null, origin: o.origin || null, destination: o.destination || null, claimedBy: ok.data.claimedBy || null,
        };
    });

    const guestClaimRequests = onCall({ cors: true }, async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión.');
        const list = (Array.isArray(req.data?.items) ? req.data.items : []).slice(0, 20);
        let claimed = 0;
        const prof = await db.doc(`${base}/users/${uid}`).get().catch(() => null);
        const pname = prof?.exists ? (prof.get('name') || null) : null;
        for (const it of list) {
            const kind = it?.kind === 'trip' ? 'trip' : 'store_order';
            const ok = await checkToken(kind, it?.id, it?.token);
            if (!ok || (ok.data.claimedBy && ok.data.claimedBy !== uid)) continue;
            const ref = db.doc(`${base}/${kind === 'trip' ? 'trips' : 'store_orders'}/${ok.key}`);
            const s = await ref.get();
            if (!s.exists || !String(s.get('clientId') || '').startsWith('guest_')) { await reqCol().doc(ok.key).set({ claimedBy: uid }, { merge: true }); continue; }
            const patch = { clientId: uid, guestClient: false, guestClaimedAtMs: now(), guestClaimedFrom: s.get('clientId') };
            if (pname) patch.clientName = pname;
            if (kind === 'trip') Object.assign(patch, { guestInvitePending: false, staffCreatedClientClaimed: true });
            await ref.set(patch, { merge: true });
            await reqCol().doc(ok.key).set({ claimedBy: uid, claimedAtMs: now() }, { merge: true });
            claimed++;
        }
        return { ok: true, claimed };
    });

    return { exports: { guestCreateRequest, guestTrackRequest, guestClaimRequests } };
};
module.exports.normalizeGuestPhone = normalizeGuestPhone;
module.exports.sanitizeTripInput = sanitizeTripInput;
module.exports.LIMITS = { MAX_ACTIVE, MAX_PER_DAY };
