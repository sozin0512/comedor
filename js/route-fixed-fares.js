/**
 * Tarifas fijas y viaje mínimo — configurables desde admin (appSettings.fixedFares).
 *
 * Admin puede:
 * - Definir viaje mínimo (ej. L. 65)
 * - Marcar puntos caros (lat/lng + radio + precio + activar/desactivar)
 * - Definir rutas fijas entre dos puntos (ej. Golf ↔ Aeropuerto)
 */
import { haversineKm, findZoneForCoords, findNearestZone, getZoneById } from './zones.js?v=2026.08.10.4';
import {
    normalizeServiceType, isFreightService, isTowService,
    setServiceRateOverrides, getDefaultServiceRates,
} from './service-types.js?v=2026.08.10.4';

const HN_TZ = 'America/Tegucigalpa';

/** Defaults de fábrica (Comayagua). El admin puede cambiarlos y se guardan en Firestore. */
export const DEFAULT_FIXED_FARES_CONFIG = {
    minFare: 65,
    minFareEnabled: true,
    minFareHubLat: 14.4513,
    minFareHubLng: -87.6374,
    minFareHubRadiusKm: 40,
    /** Día = precio base configurado. Noche = base × (1 + nightPercent/100). */
    dayHourStart: 5,
    dayHourEnd: 18,
    nightSurchargeEnabled: true,
    nightPercent: 25,
    /** Base + L./km editables (auto, taxi, moto, delivery). */
    serviceRates: {
        auto: { base: 37, perKm: 12 },
        taxi: { base: 30, perKm: 10 },
        moto: { base: 20, perKm: 8 },
        delivery: { base: 15, perKm: 7 },
    },
    places: [
        {
            id: 'comayagua',
            name: 'Comayagua centro',
            lat: 14.4513,
            lng: -87.6374,
            radiusKm: 12,
            enabled: true,
            // Ancla de rutas (Golf/ciudad ↔ aeropuerto); no cobra solo por estar en ciudad
            fixedPrice: 0,
            onlyDaytime: false,
            keywords: 'comayagua',
            priority: 0,
        },
        {
            id: 'airport',
            name: 'Aeropuerto Palmerola',
            lat: 14.3825,
            lng: -87.6211,
            // Radio amplio: el pin del mapa a veces cae en la entrada / terminal
            radiusKm: 6,
            enabled: true,
            // Precio del sistema al involucrar aeropuerto (origen o destino)
            fixedPrice: 300,
            onlyDaytime: false,
            keywords: 'aeropuerto, palmerola, xpl, airport, aeropuerto internacional, comayagua airport, aero',
            priority: 85,
        },
        {
            id: 'golf',
            name: 'Comayagua Golf Club',
            lat: 14.4714,
            lng: -87.6159,
            radiusKm: 3.5,
            enabled: true,
            fixedPrice: 0,
            onlyDaytime: false,
            keywords: 'golf, comayagua golf, golf club, hotel golf',
            priority: 0,
        },
        {
            id: 'cipreses',
            name: 'Laberinto de Cipreses',
            lat: 14.2985,
            lng: -87.4520,
            radiusKm: 4.5,
            enabled: true,
            fixedPrice: 500,
            onlyDaytime: false,
            keywords: 'cipres, cipreses, laberinto, jardin del eden, jardín del edén',
            priority: 50,
        },
        {
            id: 'siguatepeque',
            name: 'Siguatepeque',
            lat: 14.6000,
            lng: -87.8333,
            radiusKm: 8,
            enabled: true,
            fixedPrice: 700,
            onlyDaytime: false,
            keywords: 'siguatepeque, sigua',
            priority: 40,
        },
        {
            id: 'la_paz',
            name: 'La Paz',
            lat: 14.3167,
            lng: -87.6833,
            radiusKm: 6,
            enabled: true,
            fixedPrice: 400,
            onlyDaytime: true,
            keywords: 'la paz, lapaz',
            priority: 30,
        },
        {
            id: 'villa',
            name: 'La Villa (Villa de San Antonio)',
            lat: 14.3160,
            lng: -87.5830,
            radiusKm: 6.5,
            enabled: true,
            fixedPrice: 400,
            onlyDaytime: true,
            keywords: 'villa de san antonio, la villa, villa san antonio',
            priority: 30,
        },
    ],
    /** Rutas fijas entre dos places (por id). */
    routes: [
        {
            id: 'golf_airport',
            name: 'Golf ↔ Aeropuerto',
            placeAId: 'golf',
            placeBId: 'airport',
            price: 400,
            enabled: true,
            onlyDaytime: false,
            priority: 100,
        },
        {
            id: 'comayagua_airport',
            name: 'Comayagua ↔ Aeropuerto',
            placeAId: 'comayagua',
            placeBId: 'airport',
            price: 300,
            enabled: true,
            onlyDaytime: false,
            priority: 90,
        },
    ],
};

/** @type {typeof DEFAULT_FIXED_FARES_CONFIG} */
let runtimeConfig = cloneConfig(DEFAULT_FIXED_FARES_CONFIG);

function cloneConfig(src) {
    return JSON.parse(JSON.stringify(src || DEFAULT_FIXED_FARES_CONFIG));
}

function truthy(v) {
    return v === true || v === 1 || v === '1' || v === 'true';
}

function toNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function slugId(name) {
    return String(name || 'punto')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40) || `p_${Date.now().toString(36)}`;
}

function parseKeywords(raw) {
    if (Array.isArray(raw)) return raw.map((k) => String(k || '').trim()).filter(Boolean);
    return String(raw || '')
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

export function normalizePlace(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = toNum(raw.lat, NaN);
    const lng = toNum(raw.lng, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const id = String(raw.id || slugId(raw.name)).trim() || slugId(raw.name);
    const radiusKm = Math.max(0.3, toNum(raw.radiusKm, 3));
    const fixedPrice = Math.max(0, toNum(raw.fixedPrice, 0));
    return {
        id,
        name: String(raw.name || id).trim() || id,
        lat,
        lng,
        radiusKm,
        enabled: raw.enabled === false ? false : true,
        fixedPrice,
        onlyDaytime: truthy(raw.onlyDaytime),
        keywords: parseKeywords(raw.keywords).join(', '),
        priority: toNum(raw.priority, fixedPrice > 0 ? 20 : 0),
    };
}

export function normalizeRoute(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const placeAId = String(raw.placeAId || raw.fromId || '').trim();
    const placeBId = String(raw.placeBId || raw.toId || '').trim();
    if (!placeAId || !placeBId || placeAId === placeBId) return null;
    const price = Math.max(0, toNum(raw.price, 0));
    if (!(price > 0)) return null;
    const id = String(raw.id || `${placeAId}_${placeBId}`).trim();
    return {
        id,
        name: String(raw.name || `${placeAId} ↔ ${placeBId}`).trim(),
        placeAId,
        placeBId,
        price,
        enabled: raw.enabled === false ? false : true,
        onlyDaytime: truthy(raw.onlyDaytime),
        priority: toNum(raw.priority, 50),
    };
}

export function normalizeFixedFaresConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const base = cloneConfig(DEFAULT_FIXED_FARES_CONFIG);
    const placesIn = Array.isArray(src.places) ? src.places : base.places;
    const routesIn = Array.isArray(src.routes) ? src.routes : base.routes;
    let places = placesIn.map(normalizePlace).filter(Boolean);

    // Migración: si el aeropuerto quedó en 0 (versión vieja), poner 300 del sistema
    places = places.map((p) => {
        const isAirport = p.id === 'airport'
            || /palmerola|aeropuerto/i.test(p.name || '')
            || /palmerola|aeropuerto|xpl/i.test(p.keywords || '');
        if (isAirport && !(p.fixedPrice > 0)) {
            return {
                ...p,
                fixedPrice: 300,
                radiusKm: Math.max(p.radiusKm || 0, 6),
                priority: Math.max(p.priority || 0, 85),
                keywords: p.keywords && p.keywords.length > 3
                    ? p.keywords
                    : 'aeropuerto, palmerola, xpl, airport, aero',
            };
        }
        return p;
    });

    // Si no hay aeropuerto en la lista guardada, inyectar el default
    const hasAirport = places.some((p) =>
        p.id === 'airport' || /palmerola|aeropuerto/i.test(p.name || '')
    );
    if (!hasAirport) {
        const defAir = base.places.find((p) => p.id === 'airport');
        if (defAir) places.push(normalizePlace(defAir));
    }

    const defRates = base.serviceRates || getDefaultServiceRates();
    const srcRates = (src.serviceRates && typeof src.serviceRates === 'object')
        ? src.serviceRates
        : {};
    const serviceRates = {};
    ['auto', 'taxi', 'moto', 'delivery'].forEach((id) => {
        const d = defRates[id] || { base: 0, perKm: 0 };
        const o = srcRates[id] || {};
        serviceRates[id] = {
            base: Math.max(0, toNum(o.base, d.base)),
            perKm: Math.max(0, toNum(o.perKm, d.perKm)),
        };
    });

    return {
        minFare: Math.max(0, toNum(src.minFare, base.minFare)),
        minFareEnabled: src.minFareEnabled === false ? false : true,
        minFareHubLat: toNum(src.minFareHubLat, base.minFareHubLat),
        minFareHubLng: toNum(src.minFareHubLng, base.minFareHubLng),
        minFareHubRadiusKm: Math.max(1, toNum(src.minFareHubRadiusKm, base.minFareHubRadiusKm)),
        dayHourStart: Math.min(23, Math.max(0, toNum(src.dayHourStart, base.dayHourStart))),
        dayHourEnd: Math.min(24, Math.max(1, toNum(src.dayHourEnd, base.dayHourEnd))),
        nightSurchargeEnabled: src.nightSurchargeEnabled === false ? false : true,
        nightPercent: Math.max(0, Math.min(100, toNum(src.nightPercent, base.nightPercent ?? 25))),
        serviceRates,
        places,
        routes: routesIn.map(normalizeRoute).filter(Boolean),
    };
}

export function setFixedFaresConfig(raw) {
    runtimeConfig = normalizeFixedFaresConfig(raw);
    try {
        setServiceRateOverrides(runtimeConfig.serviceRates || {});
    } catch (_) {}
    try {
        window.__HR_FIXED_FARES = runtimeConfig;
    } catch (_) {}
    return runtimeConfig;
}

export function getFixedFaresConfig() {
    return cloneConfig(runtimeConfig);
}

/** Compat: mínimo actual (para UI). */
export function getComayaguaMinFare() {
    return runtimeConfig.minFareEnabled ? runtimeConfig.minFare : 0;
}

export const COMAYAGUA_MIN_FARE = 65; // default legacy export

function normText(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function textMatchesPlace(text, place) {
    const t = normText(text);
    if (!t || t.length < 2) return false;
    if (parseKeywords(place.keywords).some((kw) => {
        const k = normText(kw);
        return k && t.includes(k);
    })) return true;
    // Nombre del punto (sin acentos)
    const nm = normText(place.name || '');
    if (nm.length >= 4 && t.includes(nm)) return true;
    // Aeropuerto: Google a veces devuelve "Palmerola International…" / "XPL" / "aeropuerto"
    if (place.id === 'airport' || /aeropuerto|palmerola/i.test(place.name || '')) {
        if (/\baero|\bpalmerola|\bxpl\b|\bairport\b|\binternacional\b/.test(t)) return true;
    }
    return false;
}

function pointNearPlace(lat, lng, place) {
    if (lat == null || lng == null || !place) return false;
    const d = haversineKm(Number(lat), Number(lng), place.lat, place.lng);
    return Number.isFinite(d) && d <= (place.radiusKm || 3);
}

function matchesPlace(lat, lng, text, place) {
    if (!place || place.enabled === false) return false;
    return pointNearPlace(lat, lng, place) || textMatchesPlace(text, place);
}

function isPassengerService(type) {
    const t = normalizeServiceType(type);
    if (isFreightService(t) || isTowService(t)) return false;
    if (t === 'delivery') return false;
    return t === 'auto' || t === 'taxi' || t === 'moto';
}

function hondurasHour(date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: HN_TZ,
            hour: 'numeric',
            hour12: false,
        }).formatToParts(date);
        return parseInt(parts.find((p) => p.type === 'hour')?.value || '12', 10);
    } catch (_) {
        return date.getHours();
    }
}

export function isDaytimeHonduras(date = new Date(), cfg = runtimeConfig) {
    const h = hondurasHour(date);
    const start = cfg.dayHourStart ?? 5;
    const end = cfg.dayHourEnd ?? 18;
    return h >= start && h < end;
}

export function isNighttimeHonduras(date = new Date(), cfg = runtimeConfig) {
    return !isDaytimeHonduras(date, cfg);
}

/**
 * Precio de día → de noche (si aplica recargo).
 * @returns {{ price: number, isNight: boolean, nightPercent: number, dayPrice: number }}
 */
export function applyNightToFixedPrice(dayPrice, date = new Date(), cfg = runtimeConfig) {
    const base = Math.max(0, Number(dayPrice) || 0);
    const pct = Math.max(0, Number(cfg.nightPercent) || 0);
    const nightOn = cfg.nightSurchargeEnabled !== false && pct > 0 && isNighttimeHonduras(date, cfg);
    if (!nightOn) {
        return { price: Math.round(base * 100) / 100, isNight: false, nightPercent: 0, dayPrice: base };
    }
    const nightPrice = Math.round(base * (1 + pct / 100) * 100) / 100;
    return { price: nightPrice, isNight: true, nightPercent: pct, dayPrice: base };
}

function placeById(id, cfg = runtimeConfig) {
    return (cfg.places || []).find((p) => p.id === id) || null;
}

/**
 * ¿El viaje cae en el hub del mínimo (Comayagua u otro configurado)?
 */
export function isMinFareMarketTrip(ctx = {}, cfg = runtimeConfig) {
    if (!cfg.minFareEnabled) return false;
    const hub = {
        lat: cfg.minFareHubLat,
        lng: cfg.minFareHubLng,
        radiusKm: cfg.minFareHubRadiusKm,
        enabled: true,
        keywords: '',
    };
    if (pointNearPlace(ctx.originLat, ctx.originLng, hub)
        || pointNearPlace(ctx.destLat, ctx.destLng, hub)) {
        return true;
    }
    // Si toca cualquier punto caro activo, también aplica mínimo de mercado
    return (cfg.places || []).some((p) => p.enabled && (
        matchesPlace(ctx.originLat, ctx.originLng, ctx.originText, p)
        || matchesPlace(ctx.destLat, ctx.destLng, ctx.destText, p)
    ));
}


/**
 * Normaliza nombre de departamento para comparar.
 */
function normDepartment(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Ciudad/zona para un GPS (dentro de cobertura o la mas cercana).
 */
export function resolveZoneForFarePoint(lat, lng) {
    if (lat == null || lng == null) return null;
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    const inside = findZoneForCoords(la, ln);
    if (inside) return inside;
    const nearest = findNearestZone(la, ln);
    return nearest?.zone || null;
}

/**
 * Departamento de un punto (por zona de servicio).
 * @returns {string|null} departamento normalizado
 */
export function departmentForCoords(lat, lng) {
    const zone = resolveZoneForFarePoint(lat, lng);
    return zone?.department ? normDepartment(zone.department) : null;
}

/**
 * Las tarifas fijas de "zona cara" SOLO aplican si origen y destino
 * estan en el MISMO departamento. Si cruzan departamentos → por km.
 *
 * @returns {{ same: boolean, originDept: string|null, destDept: string|null, reason?: string }}
 */
export function sameDepartmentFareCheck({
    originLat = null,
    originLng = null,
    destLat = null,
    destLng = null,
    serviceZoneId = null,
} = {}) {
    let originDept = departmentForCoords(originLat, originLng);
    let destDept = departmentForCoords(destLat, destLng);

    // Si falta un extremo, intentar con la ciudad activa del pasajero
    if ((!originDept || !destDept) && serviceZoneId) {
        const z = getZoneById(serviceZoneId);
        const d = z?.department ? normDepartment(z.department) : null;
        if (d) {
            if (!originDept) originDept = d;
            // no rellenar destino con serviceZone (puede ser solo ciudad de origen)
        }
    }

    if (!originDept || !destDept) {
        return {
            same: false,
            originDept,
            destDept,
            reason: 'missing_department',
        };
    }
    if (originDept !== destDept) {
        return {
            same: false,
            originDept,
            destDept,
            reason: 'cross_department',
        };
    }
    return { same: true, originDept, destDept, reason: 'same_department' };
}
/**
 * Resuelve tarifa fija o mínimo según config admin.
 */
export function resolveFixedRouteFare({
    serviceType = 'auto',
    price = 0,
    originLat = null,
    originLng = null,
    destLat = null,
    destLng = null,
    originText = '',
    destText = '',
    serviceZoneId = null,
    date = new Date(),
} = {}) {
    const cfg = runtimeConfig;
    const basePrice = Math.max(0, Number(price) || 0);
    const out = {
        price: Math.round(basePrice * 100) / 100,
        fixed: false,
        ruleId: null,
        label: null,
        minApplied: false,
        isNight: false,
        nightPercent: 0,
        dayPrice: null,
    };

    if (!isPassengerService(serviceType)) return out;

    const oTxt = originText || '';
    const dTxt = destText || '';

    // Zonas caras / rutas fijas: solo mismo departamento. Cruce de depto = por km.
    const deptCheck = sameDepartmentFareCheck({
        originLat, originLng, destLat, destLng, serviceZoneId,
    });
    const allowFixedExpensive = deptCheck.same === true;

    const originHit = (place) => matchesPlace(originLat, originLng, oTxt, place);
    const destHit = (place) => matchesPlace(destLat, destLng, dTxt, place);

    const finishFixed = (dayPrice, ruleId, label) => {
        const night = applyNightToFixedPrice(dayPrice, date, cfg);
        return {
            price: night.price,
            fixed: true,
            ruleId,
            label,
            minApplied: false,
            isNight: night.isNight,
            nightPercent: night.nightPercent,
            dayPrice: night.dayPrice,
        };
    };

    /**
     * Candidatos de tarifa fija (día).
     * Si el viaje toca varias zonas caras (ej. aeropuerto + laberinto),
     * o hay ruta fija + punto, se elige SIEMPRE la más cara.
     * @type {{ dayPrice: number, ruleId: string, label: string }[]}
     */
    const candidates = [];
    // Sin mismo departamento: no aplicar precios fijos de zona/ruta cara (se mide por km).
    if (allowFixedExpensive) {

    // 1) Rutas fijas (pares origen↔destino)
    const routes = [...(cfg.routes || [])]
        .filter((r) => r.enabled && r.price > 0);

    for (const route of routes) {
        const a = placeById(route.placeAId, cfg);
        const b = placeById(route.placeBId, cfg);
        if (!a?.enabled || !b?.enabled) continue;
        const linked =
            (originHit(a) && destHit(b))
            || (originHit(b) && destHit(a));
        if (linked) {
            candidates.push({
                dayPrice: Number(route.price) || 0,
                ruleId: `route:${route.id}`,
                label: route.name || `Tarifa ${route.price}`,
            });
        }
    }

    // 2) Puntos con fixedPrice > 0 (tocar origen y/o destino)
    //    Ambos extremos pueden ser caros: se agregan y al final gana el mayor.
    const touchPlaces = [...(cfg.places || [])]
        .filter((p) => p.enabled && (p.fixedPrice || 0) > 0);

    for (const place of touchPlaces) {
        if (!(originHit(place) || destHit(place))) continue;
        candidates.push({
            dayPrice: Number(place.fixedPrice) || 0,
            ruleId: `place:${place.id}`,
            label: place.name || `Tarifa L. ${place.fixedPrice}`,
        });
    }

    // 2b) Fallback aeropuerto por texto (si aún no entró por lat/lng)
    const blob = `${oTxt} ${dTxt}`;
    const airportPlace = (cfg.places || []).find((p) =>
        p.enabled
        && (p.fixedPrice || 0) > 0
        && (p.id === 'airport' || /palmerola|aeropuerto/i.test(p.name || ''))
    );
    if (airportPlace && textMatchesPlace(blob, airportPlace)) {
        const already = candidates.some((c) => c.ruleId === `place:${airportPlace.id}` || c.ruleId === `place:${airportPlace.id}:text`);
        if (!already) {
            candidates.push({
                dayPrice: Number(airportPlace.fixedPrice) || 0,
                ruleId: `place:${airportPlace.id}:text`,
                label: airportPlace.name || 'Aeropuerto',
            });
        }
    }

    } // end allowFixedExpensive

    // Elegir la tarifa fija más cara entre todos los matches
    const valid = candidates.filter((c) => (c.dayPrice || 0) > 0);
    if (valid.length > 0) {
        valid.sort((a, b) => (b.dayPrice - a.dayPrice) || String(a.ruleId).localeCompare(String(b.ruleId)));
        const best = valid[0];
        return finishFixed(best.dayPrice, best.ruleId, best.label);
    }
    // 3) Viaje mínimo (también puede subir de noche si hay recargo activo)
    if (cfg.minFareEnabled && cfg.minFare > 0) {
        const inMarket = isMinFareMarketTrip({
            originLat, originLng, destLat, destLng,
            originText: oTxt, destText: dTxt, serviceZoneId,
        }, cfg);
        if (inMarket) {
            const nightMin = applyNightToFixedPrice(cfg.minFare, date, cfg);
            const floor = nightMin.price;
            if (basePrice < floor) {
                return {
                    price: floor,
                    fixed: false,
                    ruleId: 'min_fare',
                    label: `Viaje mínimo L. ${cfg.minFare}`,
                    minApplied: true,
                    isNight: nightMin.isNight,
                    nightPercent: nightMin.nightPercent,
                    dayPrice: nightMin.dayPrice,
                };
            }
        }
    }

    return out;
}

export function applyFixedRouteFareToPrice(priceNum, ctx = {}) {
    return resolveFixedRouteFare({ ...ctx, price: priceNum });
}

/** Helpers admin */
export function makePlaceId(name) {
    return slugId(name) + '_' + Date.now().toString(36).slice(-4);
}

export function makeRouteId(a, b) {
    return `${slugId(a)}_${slugId(b)}_${Date.now().toString(36).slice(-3)}`;
}
