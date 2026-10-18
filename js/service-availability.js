/**
 * Disponibilidad de servicios por ciudad + tasa de aceptación por categoría.
 *
 * Fuente única de la lógica (sin imports, sin DOM). El servidor usa una copia CommonJS
 * generada con `node scripts/sync-service-availability.js` → functions/service-availability-core.js.
 * No edites la copia: edita este archivo y vuelve a generar (la prueba revisa que estén iguales).
 *
 * Config en appSettings/main.serviceAvailability:
 *   { [zoneId | '_all']: { [servicio]: { mode: 'auto' | 'on' | 'off', message?: string } } }
 *   - auto: «No disponible» solo cuando no hay ningún conductor de ese tipo en línea en la ciudad.
 *   - on:   siempre se puede pedir (como antes).
 *   - off:  cerrado: nadie lo puede pedir en esa ciudad.
 * El viejo appSettings/main.disabledServicesByCity (admin) sigue valiendo como «off».
 */

export const AVAIL_SERVICES = ['auto', 'taxi', 'moto', 'delivery', 'flete_paila', 'flete_camion', 'grua'];
export const AVAIL_MODES = ['auto', 'on', 'off'];
/** Por defecto solo grúa y fletes se apagan solos; los viajes siguen como hoy. */
export const DEFAULT_SERVICE_MODES = {
    auto: 'on', taxi: 'on', moto: 'on', delivery: 'on',
    flete_paila: 'auto', flete_camion: 'auto', grua: 'auto',
};
export const AVAIL_SERVICE_LABELS = {
    auto: 'Taxi VIP', taxi: 'Taxi tradicional', moto: 'Moto (pasajeros)', delivery: 'Envío / mensajería',
    flete_paila: 'Flete · Paila', flete_camion: 'Flete · Camión', grua: 'Grúa / remolque',
};
const AVAIL_WHAT = {
    auto: 'Taxi VIP', taxi: 'taxis tradicionales', moto: 'motos para viajes', delivery: 'motos para envíos',
    flete_paila: 'pailas para fletes', flete_camion: 'camiones para fletes', grua: 'grúas',
};
/** Legacy disabledServicesByCity (categoría) → servicios. */
const LEGACY_CATEGORY_SERVICES = {
    auto: ['auto'], taxi: ['taxi'], moto: ['moto'], fletes: ['flete_paila', 'flete_camion'], grua: ['grua'],
};
export const AVAIL_ONLINE_STALE_MS = 45 * 60 * 1000;
export const AVAIL_MESSAGE_MAX = 160;

export function availServiceKey(type) {
    const t = String(type || '').toLowerCase();
    if (t === 'vip' || t === 'taxi_vip') return 'auto';
    return AVAIL_SERVICES.includes(t) ? t : null;
}

/** Tipo de vehículo del conductor que atiende el servicio. */
export function availVehicleForService(svc) {
    switch (availServiceKey(svc)) {
        case 'auto': return 'auto';
        case 'taxi': return 'taxi';
        case 'moto': case 'delivery': return 'moto';
        case 'flete_paila': return 'paila';
        case 'flete_camion': return 'camion';
        case 'grua': return 'grua';
        default: return null;
    }
}

function normVehicle(v) {
    const t = String(v || '').toLowerCase().trim();
    if (t === 'vip' || t === 'taxi_vip' || t === 'carro' || t === 'automovil') return 'auto';
    if (t === 'pickup' || t === 'flete_paila') return 'paila';
    if (t === 'flete_camion' || t === 'truck') return 'camion';
    return t;
}

function cleanMessage(m) {
    const s = String(m == null ? '' : m).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
    return s.slice(0, AVAIL_MESSAGE_MAX);
}

function cleanZoneKey(z) {
    const s = String(z == null ? '' : z).trim();
    if (s === '_all') return s;
    return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(s) ? s : '';
}

/** Deja solo zonas/servicios/modos conocidos. */
export function normalizeAvailabilityConfig(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((zk) => {
        const zone = cleanZoneKey(zk);
        const src = raw[zk];
        if (!zone || !src || typeof src !== 'object') return;
        const entry = {};
        AVAIL_SERVICES.forEach((svc) => {
            const v = src[svc];
            if (!v || typeof v !== 'object') return;
            const mode = AVAIL_MODES.includes(v.mode) ? v.mode : null;
            const message = cleanMessage(v.message);
            if (!mode && !message) return;
            entry[svc] = {};
            if (mode) entry[svc].mode = mode;
            if (message) entry[svc].message = message;
        });
        if (Object.keys(entry).length) out[zone] = entry;
    });
    return out;
}

function legacyOff(legacyByCity, zoneId, svc) {
    if (!legacyByCity || !zoneId) return false;
    const flags = legacyByCity[zoneId];
    if (!flags || typeof flags !== 'object') return false;
    return Object.keys(LEGACY_CATEGORY_SERVICES).some((cat) => flags[cat] === true && LEGACY_CATEGORY_SERVICES[cat].includes(svc));
}

/** Modo efectivo: ciudad → «todas» → por defecto. El apagado viejo por ciudad gana. */
export function getServiceMode(config, zoneId, svc, legacyByCity = null) {
    const key = availServiceKey(svc);
    if (!key) return 'on';
    if (legacyOff(legacyByCity, zoneId, key)) return 'off';
    const z = config && zoneId ? config[zoneId] : null;
    if (z && z[key] && z[key].mode) return z[key].mode;
    const all = config ? config._all : null;
    if (all && all[key] && all[key].mode) return all[key].mode;
    return DEFAULT_SERVICE_MODES[key] || 'on';
}

export function getServiceCustomMessage(config, zoneId, svc) {
    const key = availServiceKey(svc);
    if (!key || !config) return '';
    return (zoneId && config[zoneId] && config[zoneId][key] && config[zoneId][key].message)
        || (config._all && config._all[key] && config._all[key].message) || '';
}

function tsToMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
}

/** Misma regla que el servidor (isDriverOnline): online != false y señal en los últimos 45 min. */
export function isLocOnline(loc, now = Date.now()) {
    if (!loc || loc.online === false) return false;
    const at = tsToMs(loc.updatedAt);
    return !!at && now - at <= AVAIL_ONLINE_STALE_MS;
}

function kmBetween(aLat, aLng, bLat, bLng) {
    const R = 6371;
    const toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(bLat - aLat);
    const dLng = toR(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/** Radio para contar conductores «de la ciudad» si su zona no coincide: fletes y grúa viajan más. */
export function availRadiusKm(vehicle) {
    return vehicle === 'paila' || vehicle === 'camion' || vehicle === 'grua' ? 40 : 15;
}

/**
 * Conductores en línea por tipo de vehículo para una ciudad.
 * @param {Iterable<object>} locs - docs de drivers_location
 * @param {{ zoneId?: string|null, center?: {lat:number,lng:number}|null, now?: number }} opts
 */
export function countOnlineByVehicle(locs, { zoneId = null, center = null, now = Date.now() } = {}) {
    const out = { auto: 0, taxi: 0, moto: 0, paila: 0, camion: 0, grua: 0 };
    if (!locs) return out;
    for (const loc of locs) {
        if (!loc || !isLocOnline(loc, now)) continue;
        if (loc.isSimulated || loc.simulated) continue;
        const st = String(loc.approvalStatus || '').toLowerCase();
        if (st && st !== 'approved') continue;
        const v = normVehicle(loc.vehicleType || 'auto');
        if (!(v in out)) continue;
        let inCity = !zoneId;
        if (!inCity && (loc.serviceZoneId === zoneId || loc.cityId === zoneId)) inCity = true;
        const lat = Number(loc.lat); const lng = Number(loc.lng);
        if (!inCity && center && Number.isFinite(lat) && Number.isFinite(lng)
            && Number.isFinite(Number(center.lat)) && Number.isFinite(Number(center.lng))) {
            inCity = kmBetween(lat, lng, Number(center.lat), Number(center.lng)) <= availRadiusKm(v);
        }
        if (inCity) out[v] += 1;
    }
    return out;
}

/**
 * ¿Se puede pedir el servicio ahora?
 * @returns {{ available: boolean, reason: null|'closed'|'no_drivers', mode: string, online: number|null }}
 * counts = null → no sabemos cuántos hay en línea: en «auto» se deja pedir (no bloquear por falta de datos).
 * scheduled = true → viaje programado: «sin conductores ahora» no bloquea (solo «cerrado»).
 */
export function resolveServiceAvailability({ config = null, legacyByCity = null, zoneId = null, svc, counts = null, scheduled = false } = {}) {
    const key = availServiceKey(svc);
    if (!key) return { available: true, reason: null, mode: 'on', online: null };
    const mode = getServiceMode(config, zoneId, key, legacyByCity);
    const vehicle = availVehicleForService(key);
    const online = counts && vehicle ? Number(counts[vehicle] || 0) : null;
    if (mode === 'off') return { available: false, reason: 'closed', mode, online };
    if (mode === 'auto' && online === 0 && !scheduled) return { available: false, reason: 'no_drivers', mode, online };
    return { available: true, reason: null, mode, online };
}

export function unavailableMessage(svc, zoneName = '', reason = 'no_drivers', custom = '') {
    if (custom) return custom;
    const key = availServiceKey(svc) || 'auto';
    const where = zoneName ? ` en ${zoneName}` : ' en tu ciudad';
    if (reason === 'closed') {
        return `${AVAIL_SERVICE_LABELS[key] || 'Este servicio'} no está disponible${where} por ahora.`;
    }
    return `Por ahora no hay ${AVAIL_WHAT[key] || 'conductores'} disponibles${where}. Intenta más tarde o escríbenos por WhatsApp.`;
}

// ───────────────────────── Tasa de aceptación ─────────────────────────

export const ACCEPT_CATEGORIES = ['auto', 'taxi', 'moto', 'delivery', 'tienda', 'flete', 'grua', 'hourly'];
export const ACCEPT_LABELS = {
    auto: 'Taxi VIP', taxi: 'Taxi tradicional', moto: 'Moto (pasajeros)', delivery: 'Envío / mensajería',
    tienda: 'Pedidos de tiendas', flete: 'Fletes (paila y camión)', grua: 'Grúa / remolque', hourly: 'Por hora',
};

export function isStoreDeliveryTripDoc(t) {
    if (!t || typeof t !== 'object') return false;
    return !!(t.storeOrderId || t.storeDelivery === true || t.createdByMerchant === true || (t.deliveryDetails && t.deliveryDetails.storeOrderId));
}

export function acceptCategoryOf(t) {
    if (!t) return 'auto';
    if (t.bookingType === 'hourly') return 'hourly';
    const s = String(t.serviceType || 'auto');
    if (s === 'delivery') return isStoreDeliveryTripDoc(t) ? 'tienda' : 'delivery';
    if (s === 'flete_paila' || s === 'flete_camion') return 'flete';
    if (s === 'grua' || s === 'taxi' || s === 'moto') return s;
    return 'auto';
}

function tripCreatedAt(t) {
    return tsToMs(t.createdAt) || Number(t.createdAtMs) || 0;
}
function isCancelledStatus(s) { return s === 'cancelled' || s === 'canceled' || s === 'expired'; }

/**
 * Clasifica una solicitud: 'accepted' | 'no_driver' | 'client_cancelled' | 'searching' | null (no cuenta).
 * Aceptada = algún conductor la tomó (driverId o acceptedAt), aunque luego se cancelara.
 */
export function classifyRequest(t) {
    if (!t || t.isDemandSimulation || t.trashedAtMs) return null;
    if (t.driverId || tsToMs(t.acceptedAt)) return 'accepted';
    const st = String(t.status || '');
    if (st === 'completed' || st === 'accepted' || st === 'in_progress') return 'accepted';
    if (st === 'scheduled') return null; // programado sin conductor: aún no se decide
    if (isCancelledStatus(st)) {
        const byClient = st !== 'expired' && t.cancelledBy && t.clientId && t.cancelledBy === t.clientId;
        return byClient ? 'client_cancelled' : 'no_driver';
    }
    if (st === 'pending') return 'searching';
    return null;
}

/**
 * Tasa por categoría. Tasa = aceptadas ÷ (aceptadas + sin conductor + cliente canceló).
 * Las que siguen buscando no entran en la tasa (se muestran aparte).
 * @param {object[]} trips
 * @param {{ from?: number, to?: number, filter?: (t:object)=>boolean }} opts
 */
export function computeAcceptanceStats(trips, { from = 0, to = Infinity, filter = null } = {}) {
    const blank = () => ({ requests: 0, accepted: 0, noDriver: 0, clientCancelled: 0, searching: 0, waitMsSum: 0, waitN: 0, rate: null, waitAvgMs: null });
    const byCat = {};
    ACCEPT_CATEGORIES.forEach((c) => { byCat[c] = blank(); });
    const total = blank();
    const drivers = new Map();
    for (const t of trips || []) {
        const created = tripCreatedAt(t);
        if (!created || created < from || created > to) continue;
        if (filter && !filter(t)) continue;
        const kind = classifyRequest(t);
        if (!kind) continue;
        const cat = acceptCategoryOf(t);
        const rows = [byCat[cat], total];
        for (const r of rows) {
            if (kind === 'searching') { r.searching += 1; continue; }
            r.requests += 1;
            if (kind === 'accepted') r.accepted += 1;
            else if (kind === 'no_driver') r.noDriver += 1;
            else r.clientCancelled += 1;
        }
        if (kind === 'accepted') {
            const acc = tsToMs(t.acceptedAt);
            const sched = tsToMs(t.scheduledFor);
            const wait = acc && !sched ? acc - created : NaN;
            if (Number.isFinite(wait) && wait >= 0 && wait < 6 * 3600 * 1000) {
                rows.forEach((r) => { r.waitMsSum += wait; r.waitN += 1; });
            }
        }
        // Por conductor: le llegó (la vio, la pasó o la tomó) vs. la aceptó
        const seen = new Set();
        if (t.viewedBy && typeof t.viewedBy === 'object') Object.keys(t.viewedBy).forEach((k) => seen.add(k));
        if (Array.isArray(t.declinedDriverIds)) t.declinedDriverIds.forEach((k) => k && seen.add(String(k)));
        if (t.driverId) seen.add(String(t.driverId));
        seen.forEach((uid) => {
            const d = drivers.get(uid) || { uid, name: '', offers: 0, accepted: 0, cats: {} };
            d.offers += 1;
            d.cats[cat] = (d.cats[cat] || 0) + 1;
            if (t.driverId && String(t.driverId) === uid) {
                d.accepted += 1;
                if (t.driverName && !d.name) d.name = String(t.driverName);
            }
            if (!d.name && t.viewedBy && t.viewedBy[uid] && t.viewedBy[uid].name) d.name = String(t.viewedBy[uid].name);
            drivers.set(uid, d);
        });
    }
    const finish = (r) => {
        r.rate = r.requests ? Math.round((r.accepted / r.requests) * 1000) / 10 : null;
        r.waitAvgMs = r.waitN ? Math.round(r.waitMsSum / r.waitN) : null;
        return r;
    };
    ACCEPT_CATEGORIES.forEach((c) => finish(byCat[c]));
    finish(total);
    const driverList = [...drivers.values()]
        .map((d) => ({ ...d, rate: d.offers ? Math.round((d.accepted / d.offers) * 1000) / 10 : null }))
        .sort((a, b) => b.offers - a.offers);
    let lowest = null;
    ACCEPT_CATEGORIES.forEach((c) => {
        const r = byCat[c];
        if (r.requests >= 3 && (lowest === null || r.rate < byCat[lowest].rate)) lowest = c;
    });
    return { byCat, total, drivers: driverList, lowest };
}

/** Color por tasa: ok ≥ 80, warn 55–79, bad < 55. */
export function acceptanceTone(rate) {
    if (rate == null) return 'none';
    if (rate >= 80) return 'ok';
    if (rate >= 55) return 'warn';
    return 'bad';
}
