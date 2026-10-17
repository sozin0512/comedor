/**
 * Zonas de envío con tarifa fija (tiendas) — Comayagua primero.
 *
 * Una zona es un polígono (lat/lng) dibujado en Google Maps por staff. Si dos zonas se cruzan
 * gana la de menor «prioridad» y, si empatan, la de menor área (así «céntrica» queda dentro de
 * «fuera del centro»). La tarifa del envío la calcula SIEMPRE el servidor:
 *   - quoteStoreDeliveryFee (callable) para mostrarla antes de confirmar
 *   - onStoreOrderCreatedZoneFee (trigger) la escribe en el pedido (el cliente no puede)
 *   - onStoreOrderTripZoneFee (trigger) corrige el precio del viaje de entrega si no coincide
 * Cada tienda puede usar la tarifa base o la suya dentro del mínimo/máximo de la zona.
 *
 * Colecciones (solo escribe el servidor; ver firestore.rules):
 *   artifacts/{app}/public/data/delivery_zones/{zoneId}
 *   artifacts/{app}/public/data/delivery_zone_history/{autoId}
 *   artifacts/{app}/public/data/delivery_zone_settings/{cityId}   { outsideBehavior: 'distance'|'block' }
 *   artifacts/{app}/public/data/store_delivery_fees/{storeId}     { fees: { [zoneId]: { mode, fee } } }
 */
'use strict';

const MAX_FEE = 2000;
const MAX_POINTS = 80;
const OUTSIDE = new Set(['distance', 'block']);
const ZONE_SOURCES = new Set(['zone_base', 'store_custom']);

// ───────────── lógica pura (se prueba sin Firebase) ─────────────
const money = (v) => Math.round(Number(v) * 100) / 100;
function feeOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_FEE) return NaN;
    return money(n);
}
function cleanPolygon(raw) {
    if (!Array.isArray(raw)) return null;
    const pts = raw.map((p) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
        .map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 }));
    if (pts.length !== raw.length || pts.length < 3 || pts.length > MAX_POINTS) return null;
    return pts;
}
/** Ray casting; el borde cuenta como dentro. */
function pointInPolygon(lat, lng, poly) {
    if (!Array.isArray(poly) || poly.length < 3 || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]; const b = poly[j];
        // sobre el borde
        const cross = (lng - a.lng) * (b.lat - a.lat) - (lat - a.lat) * (b.lng - a.lng);
        if (Math.abs(cross) < 1e-12 && lng >= Math.min(a.lng, b.lng) && lng <= Math.max(a.lng, b.lng)
            && lat >= Math.min(a.lat, b.lat) && lat <= Math.max(a.lat, b.lat)) return true;
        if ((a.lat > lat) !== (b.lat > lat)) {
            const x = ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng;
            if (lng < x) inside = !inside;
        }
    }
    return inside;
}
/** Área aproximada en km² (proyección local). */
function polygonAreaKm2(poly) {
    if (!Array.isArray(poly) || poly.length < 3) return 0;
    const lat0 = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
    const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180); const ky = 110.57;
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += (poly[j].lng * kx) * (poly[i].lat * ky) - (poly[i].lng * kx) * (poly[j].lat * ky);
    }
    return Math.round(Math.abs(a / 2) * 1000) / 1000;
}
/** Valida lo que manda el panel. Devuelve { ok, zone } o { ok:false, error }. */
function validateZoneInput(raw = {}) {
    const name = String(raw.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60) return { ok: false, error: 'El nombre debe tener entre 2 y 60 letras.' };
    const cityId = String(raw.cityId || '').trim();
    if (!/^[a-z0-9-]{2,60}$/.test(cityId)) return { ok: false, error: 'Falta la ciudad.' };
    const baseFee = feeOrNull(raw.baseFee);
    if (baseFee === null || Number.isNaN(baseFee)) return { ok: false, error: `La tarifa base debe ser entre L 0 y L ${MAX_FEE}.` };
    const minFee = feeOrNull(raw.minFee); const maxFee = feeOrNull(raw.maxFee);
    if (Number.isNaN(minFee) || Number.isNaN(maxFee)) return { ok: false, error: `Mínimo y máximo deben ser entre L 0 y L ${MAX_FEE}.` };
    if (minFee != null && minFee > baseFee) return { ok: false, error: 'El mínimo no puede ser mayor que la tarifa base.' };
    if (maxFee != null && maxFee < baseFee) return { ok: false, error: 'El máximo no puede ser menor que la tarifa base.' };
    const polygon = cleanPolygon(raw.polygon);
    if (!polygon) return { ok: false, error: `La zona necesita entre 3 y ${MAX_POINTS} puntos en el mapa.` };
    const pr = Math.round(Number(raw.priority ?? 5));
    const priority = Number.isFinite(pr) ? Math.min(99, Math.max(1, pr)) : 5;
    return {
        ok: true,
        zone: {
            name, cityId, cityName: String(raw.cityName || '').trim().slice(0, 60) || null,
            baseFee, minFee, maxFee, priority, polygon,
            areaKm2: polygonAreaKm2(polygon),
            note: String(raw.note || '').trim().slice(0, 160) || null,
            active: raw.active === true
        }
    };
}
/** La zona activa que contiene el punto (prioridad menor, luego área menor). */
function findZoneForPoint(zones, lat, lng, cityId = null) {
    const hits = (zones || []).filter((z) => z && z.active === true
        && (!cityId || !z.cityId || z.cityId === cityId)
        && pointInPolygon(lat, lng, z.polygon));
    hits.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || (a.areaKm2 || polygonAreaKm2(a.polygon)) - (b.areaKm2 || polygonAreaKm2(b.polygon)));
    return hits[0] || null;
}
/** Mensaje de error si la tarifa de la tienda no vale para la zona; null si vale. */
function validateStoreFee(zone, mode, fee) {
    if (mode === 'base') return null;
    if (mode !== 'custom') return 'Elige «Usar tarifa base» o «Mi tarifa».';
    const n = feeOrNull(fee);
    if (n === null || Number.isNaN(n)) return `Escribe un monto entre L 0 y L ${MAX_FEE}.`;
    const lo = zone?.minFee; const hi = zone?.maxFee;
    if (lo != null && hi != null && (n < lo || n > hi)) return `Debe estar entre L ${lo} y L ${hi}.`;
    if (lo != null && n < lo) return `No puede ser menos de L ${lo}.`;
    if (hi != null && n > hi) return `No puede ser más de L ${hi}.`;
    return null;
}
/** Tarifa final de una tienda en una zona. Una tarifa propia fuera del rango cae a la base. */
function resolveStoreFee(zone, entry) {
    if (!zone) return null;
    if (entry && entry.mode === 'custom' && !validateStoreFee(zone, 'custom', entry.fee)) {
        return { fee: money(entry.fee), source: 'store_custom' };
    }
    return { fee: money(zone.baseFee), source: 'zone_base' };
}
/** Cotización completa. */
function quoteDelivery({ zones, storeFees, lat, lng, cityId, outsideBehavior }) {
    const la = Number(lat); const ln = Number(lng);
    const behavior = OUTSIDE.has(outsideBehavior) ? outsideBehavior : 'distance';
    if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) {
        return { inZone: false, reason: 'no_location', behavior: 'distance', blocked: false };
    }
    const zone = findZoneForPoint(zones, la, ln, cityId);
    if (!zone) return { inZone: false, reason: 'outside', behavior, blocked: behavior === 'block' };
    const r = resolveStoreFee(zone, storeFees?.[zone.id]);
    return { inZone: true, zoneId: zone.id, zoneName: zone.name, fee: r.fee, source: r.source, baseFee: zone.baseFee };
}
const HISTORY_FIELDS = ['name', 'cityId', 'baseFee', 'minFee', 'maxFee', 'priority', 'active', 'note', 'polygon'];
function diffZone(before, after) {
    const out = [];
    for (const f of HISTORY_FIELDS) {
        const a = before ? before[f] : undefined; const b = after ? after[f] : undefined;
        const ja = JSON.stringify(a ?? null); const jb = JSON.stringify(b ?? null);
        if (ja === jb) continue;
        if (f === 'polygon') out.push({ field: 'polygon', before: Array.isArray(a) ? `${a.length} puntos` : null, after: Array.isArray(b) ? `${b.length} puntos` : null });
        else out.push({ field: f, before: a ?? null, after: b ?? null });
    }
    return out;
}

// Propuesta para Comayagua (forma aproximada; se ajusta en el mapa). Se crean INACTIVAS.
function ring(lat, lng, rLat, rLng, n = 10) {
    return Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n;
        return { lat: Math.round((lat + rLat * Math.sin(a)) * 1e6) / 1e6, lng: Math.round((lng + rLng * Math.cos(a)) * 1e6) / 1e6 };
    });
}
const COMAYAGUA_CENTER = { lat: 14.4598, lng: -87.6378 }; // Parque Central / Catedral (aprox.)
const SEED_ZONES = {
    comayagua: [
        { id: 'comayagua-centrica', name: 'Comayagua céntrica', cityId: 'comayagua', cityName: 'Comayagua', baseFee: 40, minFee: null, maxFee: null, priority: 1,
          note: 'Casco histórico y alrededor del Parque Central (forma aproximada)', polygon: ring(COMAYAGUA_CENTER.lat, COMAYAGUA_CENTER.lng, 0.0065, 0.0070, 8) },
        { id: 'comayagua-fuera-centro', name: 'Comayagua fuera del centro', cityId: 'comayagua', cityName: 'Comayagua', baseFee: 110, minFee: 100, maxFee: 120, priority: 2,
          note: 'Resto del casco urbano (forma aproximada)', polygon: ring(COMAYAGUA_CENTER.lat - 0.004, COMAYAGUA_CENTER.lng, 0.03, 0.028, 10) },
        { id: 'comayagua-periferia', name: 'Periferia (sugerida)', cityId: 'comayagua', cityName: 'Comayagua', baseFee: 150, minFee: 140, maxFee: 180, priority: 3,
          note: 'Aldeas y colonias de las afueras (sugerida, forma aproximada)', polygon: ring(COMAYAGUA_CENTER.lat - 0.006, COMAYAGUA_CENTER.lng, 0.055, 0.05, 12) }
    ]
};

// ───────────── Firebase ─────────────
module.exports = function createDeliveryZones(deps) {
    const { db, FieldValue, HttpsError, onCall, onDocumentCreated, onDocumentUpdated, APP_ID, assertCallerCanModerate } = deps;
    const col = (app, name) => db.collection(`artifacts/${app}/public/data/${name}`);
    const zoneDoc = (app, id) => db.doc(`artifacts/${app}/public/data/delivery_zones/${id}`);

    async function callerName(uid) {
        try {
            const s = await db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`).get();
            return String(s.get('name') || s.get('displayName') || '').slice(0, 60) || 'Staff';
        } catch (_) { return 'Staff'; }
    }
    async function loadZones(app, cityId) {
        let q = col(app, 'delivery_zones').where('active', '==', true);
        if (cityId) q = q.where('cityId', '==', cityId);
        const snap = await q.get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    async function outsideBehaviorFor(app, cityId) {
        if (!cityId) return 'distance';
        const s = await db.doc(`artifacts/${app}/public/data/delivery_zone_settings/${cityId}`).get();
        return OUTSIDE.has(s.get('outsideBehavior')) ? s.get('outsideBehavior') : 'distance';
    }
    async function storeFeesFor(app, storeId) {
        if (!storeId) return {};
        const s = await db.doc(`artifacts/${app}/public/data/store_delivery_fees/${storeId}`).get();
        return (s.exists && s.get('fees')) || {};
    }
    async function quoteFor(app, { storeId, lat, lng, cityId }) {
        let city = cityId || null;
        if (storeId && !city) {
            const st = await db.doc(`artifacts/${app}/public/data/stores/${storeId}`).get();
            city = st.get('cityId') || null;
        }
        const [zones, storeFees, outsideBehavior] = await Promise.all([loadZones(app, city), storeFeesFor(app, storeId), outsideBehaviorFor(app, city)]);
        return { ...quoteDelivery({ zones, storeFees, lat, lng, cityId: city, outsideBehavior }), cityId: city };
    }
    function history(tx, entry) {
        tx.set(col(APP_ID, 'delivery_zone_history').doc(), { ...entry, atMs: Date.now(), at: FieldValue.serverTimestamp() });
    }

    const staffUpsertDeliveryZone = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const v = validateZoneInput(request.data || {});
        if (!v.ok) throw new HttpsError('invalid-argument', v.error);
        const reqId = String(request.data?.zoneId || '').trim();
        if (reqId && !/^[A-Za-z0-9_-]{3,80}$/.test(reqId)) throw new HttpsError('invalid-argument', 'Zona no válida.');
        const byName = await callerName(caller.uid);
        const ref = reqId ? zoneDoc(APP_ID, reqId) : col(APP_ID, 'delivery_zones').doc();
        const now = Date.now();
        const out = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const before = snap.exists ? snap.data() : null;
            if (reqId && !before && !request.data?.create) throw new HttpsError('not-found', 'La zona ya no existe.');
            const after = { ...v.zone, updatedAtMs: now, updatedBy: caller.uid, updatedByName: byName, ...(before ? {} : { createdAtMs: now, createdBy: caller.uid, createdByName: byName }) };
            const changes = diffZone(before, after);
            if (before && !changes.length) return { changed: false };
            tx.set(ref, after, { merge: true });
            history(tx, { type: 'zone', action: before ? 'update' : 'create', zoneId: ref.id, zoneName: after.name, cityId: after.cityId, byUid: caller.uid, byName, byRole: caller.isAdmin ? 'admin' : 'supervisor', changes });
            return { changed: true };
        });
        return { ok: true, zoneId: ref.id, ...out };
    });

    const staffSetDeliveryZoneActive = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const id = String(request.data?.zoneId || '');
        if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) throw new HttpsError('invalid-argument', 'Zona no válida.');
        const active = request.data?.active === true;
        const byName = await callerName(caller.uid);
        await db.runTransaction(async (tx) => {
            const ref = zoneDoc(APP_ID, id);
            const snap = await tx.get(ref);
            if (!snap.exists) throw new HttpsError('not-found', 'La zona ya no existe.');
            if (snap.get('active') === active) return;
            tx.update(ref, { active, updatedAtMs: Date.now(), updatedBy: caller.uid, updatedByName: byName });
            history(tx, { type: 'zone', action: active ? 'activate' : 'deactivate', zoneId: id, zoneName: snap.get('name'), cityId: snap.get('cityId'), byUid: caller.uid, byName, byRole: caller.isAdmin ? 'admin' : 'supervisor', changes: [{ field: 'active', before: snap.get('active') === true, after: active }] });
        });
        return { ok: true, zoneId: id, active };
    });

    const staffSetDeliveryOutsideBehavior = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const cityId = String(request.data?.cityId || '');
        const behavior = String(request.data?.behavior || '');
        if (!/^[a-z0-9-]{2,60}$/.test(cityId) || !OUTSIDE.has(behavior)) throw new HttpsError('invalid-argument', 'Opción no válida.');
        const byName = await callerName(caller.uid);
        await db.runTransaction(async (tx) => {
            const ref = db.doc(`artifacts/${APP_ID}/public/data/delivery_zone_settings/${cityId}`);
            const snap = await tx.get(ref);
            const before = snap.exists ? (snap.get('outsideBehavior') || 'distance') : 'distance';
            if (before === behavior && snap.exists) return;
            tx.set(ref, { cityId, outsideBehavior: behavior, updatedAtMs: Date.now(), updatedBy: caller.uid, updatedByName: byName }, { merge: true });
            history(tx, { type: 'settings', action: 'outside_behavior', cityId, byUid: caller.uid, byName, byRole: caller.isAdmin ? 'admin' : 'supervisor', changes: [{ field: 'outsideBehavior', before, after: behavior }] });
        });
        return { ok: true };
    });

    const staffSeedDeliveryZones = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const cityId = String(request.data?.cityId || 'comayagua');
        const seeds = SEED_ZONES[cityId];
        if (!seeds) throw new HttpsError('invalid-argument', 'No hay propuesta para esa ciudad.');
        const byName = await callerName(caller.uid);
        let created = 0;
        for (const z of seeds) {
            const v = validateZoneInput({ ...z, active: false });
            await db.runTransaction(async (tx) => {
                const ref = zoneDoc(APP_ID, z.id);
                const snap = await tx.get(ref);
                if (snap.exists) return;
                const now = Date.now();
                tx.set(ref, { ...v.zone, active: false, seed: true, createdAtMs: now, createdBy: caller.uid, createdByName: byName, updatedAtMs: now, updatedBy: caller.uid, updatedByName: byName });
                history(tx, { type: 'zone', action: 'seed', zoneId: z.id, zoneName: z.name, cityId, byUid: caller.uid, byName, byRole: caller.isAdmin ? 'admin' : 'supervisor', changes: diffZone(null, v.zone) });
                created += 1;
            });
        }
        return { ok: true, created };
    });

    const merchantSetStoreZoneFees = onCall(async (request) => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
        const storeId = String(request.data?.storeId || '');
        if (!/^[A-Za-z0-9_-]{3,80}$/.test(storeId)) throw new HttpsError('invalid-argument', 'Tienda no válida.');
        const st = await db.doc(`artifacts/${APP_ID}/public/data/stores/${storeId}`).get();
        if (!st.exists) throw new HttpsError('not-found', 'La tienda no existe.');
        let byRole = 'owner';
        if (st.get('ownerId') !== uid) {
            await assertCallerCanModerate(request.auth); // staff puede corregir
            byRole = 'staff';
        }
        const raw = request.data?.fees && typeof request.data.fees === 'object' ? request.data.fees : {};
        const ids = Object.keys(raw).slice(0, 30);
        const zones = new Map();
        for (const id of ids) {
            if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) throw new HttpsError('invalid-argument', 'Zona no válida.');
            const z = await zoneDoc(APP_ID, id).get();
            if (!z.exists) throw new HttpsError('not-found', 'Una de las zonas ya no existe.');
            if (st.get('cityId') && z.get('cityId') !== st.get('cityId')) throw new HttpsError('invalid-argument', 'Esa zona es de otra ciudad.');
            zones.set(id, { id, ...z.data() });
        }
        const clean = {};
        for (const id of ids) {
            const mode = raw[id]?.mode === 'custom' ? 'custom' : 'base';
            const err = validateStoreFee(zones.get(id), mode, raw[id]?.fee);
            if (err) throw new HttpsError('invalid-argument', `${zones.get(id).name}: ${err}`);
            clean[id] = mode === 'custom' ? { mode, fee: money(raw[id].fee) } : { mode: 'base', fee: null };
        }
        const byName = await callerName(uid);
        const ref = db.doc(`artifacts/${APP_ID}/public/data/store_delivery_fees/${storeId}`);
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const before = (snap.exists && snap.get('fees')) || {};
            const changes = ids.filter((id) => JSON.stringify(before[id] || { mode: 'base', fee: null }) !== JSON.stringify(clean[id]))
                .map((id) => ({ field: `fee:${zones.get(id).name}`, before: before[id]?.mode === 'custom' ? before[id].fee : 'base', after: clean[id].mode === 'custom' ? clean[id].fee : 'base' }));
            if (!changes.length && snap.exists) return;
            tx.set(ref, { storeId, ownerId: st.get('ownerId') || null, cityId: st.get('cityId') || null, fees: { ...before, ...clean }, updatedAtMs: Date.now(), updatedBy: uid, updatedByName: byName }, { merge: true });
            history(tx, { type: 'store_fee', action: 'update', storeId, storeName: st.get('name') || '', cityId: st.get('cityId') || null, byUid: uid, byName, byRole, changes });
        });
        return { ok: true, fees: clean };
    });

    const quoteStoreDeliveryFee = onCall(async (request) => {
        if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
        const storeId = String(request.data?.storeId || '');
        if (!/^[A-Za-z0-9_-]{3,80}$/.test(storeId)) throw new HttpsError('invalid-argument', 'Tienda no válida.');
        const q = await quoteFor(APP_ID, { storeId, lat: request.data?.lat, lng: request.data?.lng });
        return { ok: true, ...q };
    });

    /** El servidor fija la tarifa del pedido: zona + tarifa de la tienda. */
    const onStoreOrderCreatedZoneFee = onDocumentCreated('artifacts/{appId}/public/data/store_orders/{orderId}', async (event) => {
        const d = event.data?.data() || {};
        if (d.status && d.status !== 'pending') return;
        const { appId } = event.params;
        const q = await quoteFor(appId, { storeId: d.storeId, lat: d.deliveryLat, lng: d.deliveryLng, cityId: d.cityId || null }).catch((e) => {
            console.warn('onStoreOrderCreatedZoneFee', e?.message || e); return null;
        });
        if (!q) return;
        const patch = { deliveryFeeQuotedAtMs: Date.now() };
        if (q.inZone) {
            Object.assign(patch, { deliveryZoneId: q.zoneId, deliveryZoneName: q.zoneName, deliveryFee: q.fee, deliveryFeeSource: q.source });
        } else {
            Object.assign(patch, { deliveryZoneId: null, deliveryZoneName: null, deliveryFeeSource: q.reason === 'no_location' ? 'distance_no_location' : 'distance' });
            if (q.blocked) {
                Object.assign(patch, { status: 'cancelled', cancelledBy: 'system', cancelReason: 'outside_delivery_zones', cancelledAtMs: Date.now() });
            }
        }
        await event.data.ref.update(patch);
    });

    /** Si el viaje de entrega salió con otro precio, se corrige a la tarifa de zona. */
    const onStoreOrderTripZoneFee = onDocumentUpdated('artifacts/{appId}/public/data/store_orders/{orderId}', async (event) => {
        const before = event.data.before.data() || {};
        const after = event.data.after.data() || {};
        if (!after.tripId || before.tripId === after.tripId && before.deliveryFee === after.deliveryFee && before.deliveryFeeSource === after.deliveryFeeSource) return;
        if (!ZONE_SOURCES.has(after.deliveryFeeSource)) return;
        const fee = money(after.deliveryFee);
        if (!Number.isFinite(fee)) return;
        const { appId } = event.params;
        const tripRef = db.doc(`artifacts/${appId}/public/data/trips/${after.tripId}`);
        const t = await tripRef.get();
        if (!t.exists || t.get('storeOrderId') !== event.params.orderId) return;
        if (Number(t.get('priceNum')) === fee) return;
        if (!['pending', 'scheduled'].includes(t.get('status'))) return;
        await tripRef.update({ priceNum: fee, price: `L. ${fee.toFixed(2)}`, deliveryZoneId: after.deliveryZoneId || null, deliveryZoneName: after.deliveryZoneName || null, deliveryFeeSource: after.deliveryFeeSource });
    });

    return {
        exports: { staffUpsertDeliveryZone, staffSetDeliveryZoneActive, staffSetDeliveryOutsideBehavior, staffSeedDeliveryZones, merchantSetStoreZoneFees, quoteStoreDeliveryFee, onStoreOrderCreatedZoneFee, onStoreOrderTripZoneFee },
        helpers: { quoteFor }
    };
};
Object.assign(module.exports, { pointInPolygon, polygonAreaKm2, validateZoneInput, findZoneForPoint, validateStoreFee, resolveStoreFee, quoteDelivery, diffZone, cleanPolygon, SEED_ZONES, ZONE_SOURCES, MAX_FEE });
