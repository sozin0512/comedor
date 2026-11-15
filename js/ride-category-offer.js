/**
 * Categorías de un Viaje (Moto, Económico, Confort, Familiar, VIP).
 * Económico lo puede tomar cualquier carro. Sin año/aire/asientos = solo Económico.
 * No cambia Envío, Flete ni Grúa.
 */
import { suggestRideCategory, normalizeCutoffs } from './vehicle-categories.js';

export const RIDE_CATEGORY_IDS = ['moto', 'economico', 'confort', 'familiar', 'vip'];

export const RIDE_CATEGORY_LABELS = {
    moto: 'Moto',
    economico: 'Raite Económico',
    confort: 'Raite Confort',
    familiar: 'Raite Familiar',
    vip: 'Premium'
};

/** Tarjetas del pasajero, en el orden de la lista. La clave vip no cambia. */
export const RIDE_CARD_IDS = ['moto', 'economico', 'taxi_vip', 'confort', 'familiar', 'vip'];

/** Igual a la tarifa actual de Taxi VIP / Moto, hasta que el admin las cambie. */
export const RIDE_CATEGORY_RATE_DEFAULTS = {
    moto: { base: 20, perKm: 18 },
    economico: { base: 37, perKm: 22 },
    confort: { base: 37, perKm: 22 },
    familiar: { base: 37, perKm: 22 },
    vip: { base: 37, perKm: 22 }
};

/** Quién toma Taxi VIP. El taxi tradicional (placa T-) no entra: sigue en el botón Taxi. */
const CAR_TYPES = new Set(['auto', 'vip', 'taxi_vip']);

export function rideCategoryLabel(id) {
    return RIDE_CATEGORY_LABELS[id] || '';
}

export function isRideCategory(id) {
    return RIDE_CATEGORY_IDS.includes(String(id || '').toLowerCase());
}

export function driverVehicleType(driver) {
    return String(driver?.vehicleType || driver?.type || driver?.vehicle?.type || 'auto').toLowerCase();
}

function comfortOf(driver) {
    const vehicle = driver?.vehicle || {};
    const type = driverVehicleType(driver);
    const rideType = (type === 'taxi' || type === 'vip' || type === 'taxi_vip') ? 'auto' : type;
    return {
        type: rideType,
        year: driver?.vehicleYear ?? vehicle.year ?? null,
        hasAC: driver?.hasAC ?? vehicle.hasAC,
        seats: driver?.seats ?? vehicle.seats ?? null
    };
}

/** Categoría que le corresponde al vehículo. Sin datos de año/aire/asientos → null (solo Económico). */
export function driverRideCategory(driver, cutoffs) {
    const type = driverVehicleType(driver);
    if (type === 'moto') return 'moto';
    if (!CAR_TYPES.has(type)) return null;
    const comfort = comfortOf(driver);
    if (comfort.year == null || comfort.year === '') return null;
    return suggestRideCategory({ ...comfort, cutoffs: normalizeCutoffs(cutoffs) });
}

/**
 * ¿Este conductor puede recibir este Viaje?
 * Económico: cualquier carro. Moto: solo motos.
 * Confort / Familiar / VIP: solo quien califica por año, aire y asientos.
 */
export function driverQualifiesForCategory(driver, category, cutoffs) {
    const cat = String(category || '').toLowerCase();
    if (!isRideCategory(cat)) return true;
    const type = driverVehicleType(driver);
    if (cat === 'moto') return type === 'moto';
    if (cat === 'economico') return CAR_TYPES.has(type);
    if (!CAR_TYPES.has(type)) return false;
    return driverRideCategory(driver, cutoffs) === cat;
}

export function categoryRate(rates, category) {
    const id = isRideCategory(category) ? category : 'economico';
    const factory = RIDE_CATEGORY_RATE_DEFAULTS[id] || RIDE_CATEGORY_RATE_DEFAULTS.economico;
    const auto = rates && rates.auto && typeof rates.auto === 'object' ? rates.auto : null;
    const autoBase = Number(auto?.base);
    const autoKm = Number(auto?.perKm);
    const fallback = {
        base: Number.isFinite(autoBase) && autoBase >= 0 ? autoBase : factory.base,
        perKm: Number.isFinite(autoKm) && autoKm >= 0 ? autoKm : factory.perKm
    };
    const row = rates && rates[id] && typeof rates[id] === 'object' ? rates[id] : {};
    const base = Number(row.base);
    const perKm = Number(row.perKm);
    return {
        base: Number.isFinite(base) && base >= 0 ? base : fallback.base,
        perKm: Number.isFinite(perKm) && perKm >= 0 ? perKm : fallback.perKm
    };
}

/** base + km × precio/km. Misma fórmula del admin. */
export function quoteCategoryFare(rates, category, km) {
    const rate = categoryRate(rates, category);
    const distance = Math.max(0, Number(km) || 0);
    return Math.round((rate.base + distance * rate.perKm) * 100) / 100;
}

/**
 * Categorías que se pueden tocar. Económico nunca se apaga por falta de conductores.
 * Sin lista de conductores (aún no llegó el mapa) no se apaga ninguna.
 */
export function categoryAvailability(drivers, cutoffs, { known = true } = {}) {
    const out = {};
    for (const id of RIDE_CATEGORY_IDS) {
        if (!known || id === 'economico') {
            out[id] = true;
            continue;
        }
        out[id] = (drivers || []).some((driver) => driverQualifiesForCategory(driver, id, cutoffs));
    }
    return out;
}

/**
 * Conductores aprobados y registrados en la ciudad.
 * Económico y Taxi VIP comparten el conteo de carros (auto / vip / taxi_vip).
 */
export function registeredCardFlags(counts, { known = true } = {}) {
    if (!known || !counts) return null;
    const car = Number(counts.car) > 0;
    return {
        moto: Number(counts.moto) > 0,
        economico: car,
        taxi_vip: car,
        confort: Number(counts.confort) > 0,
        familiar: Number(counts.familiar) > 0,
        vip: Number(counts.vip) > 0
    };
}

/**
 * Gris si no hay conductor aprobado en la ciudad.
 * En línea es una señal de más para Moto, Confort, Familiar y Premium.
 */
export function rideCardIsOff(id, {
    registeredFlags = null,
    registeredKnown = false,
    onlineFlags = null,
    onlineKnown = false,
    cityBlocked = false
} = {}) {
    if (cityBlocked) return true;
    if (registeredKnown && registeredFlags && registeredFlags[id] === false) return true;
    const onlineExtra = id === 'moto' || id === 'confort' || id === 'familiar' || id === 'vip';
    if (onlineExtra && onlineKnown && onlineFlags && onlineFlags[id] === false) return true;
    return false;
}

export function firstSelectableCard(ids, isOff) {
    return (ids || []).find((id) => !isOff(id)) || null;
}

export function rideCategoryPresenceFields(profile) {
    const vehicle = profile?.vehicle || {};
    return {
        vehicleYear: profile?.vehicleYear ?? vehicle.year ?? null,
        hasAC: profile?.hasAC === true ? true : (profile?.hasAC === false ? false : (vehicle.hasAC === true ? true : (vehicle.hasAC === false ? false : null))),
        seats: profile?.seats ?? vehicle.seats ?? null,
        suggestedCategory: profile?.suggestedCategory || vehicle.suggestedCategory || null
    };
}
