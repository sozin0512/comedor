/**
 * Misma regla que js/ride-category-offer.js, para el aviso y la aceptación en el servidor.
 * Conductor sin año/aire/asientos: solo Raite Económico.
 */
const CAR_TYPES = new Set(['auto', 'taxi', 'vip', 'taxi_vip']);
const IDS = ['moto', 'economico', 'confort', 'familiar', 'vip'];
const DEFAULTS = {
    moto: { base: 20, perKm: 18 },
    economico: { base: 37, perKm: 22 },
    confort: { base: 37, perKm: 22 },
    familiar: { base: 37, perKm: 22 },
    vip: { base: 37, perKm: 22 }
};

function normalizeCutoffs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const num = (key, fallback) => {
        const n = Number(src[key]);
        return Number.isInteger(n) ? n : fallback;
    };
    let economicoMaxYear = num('economicoMaxYear', 2015);
    let confortMinYear = num('confortMinYear', 2016);
    let vipMinYear = num('vipMinYear', 2021);
    let familiarMinSeats = num('familiarMinSeats', 6);
    let familiarMaxSeats = num('familiarMaxSeats', 7);
    if (confortMinYear < economicoMaxYear) confortMinYear = economicoMaxYear + 1;
    if (vipMinYear < confortMinYear) vipMinYear = confortMinYear;
    if (familiarMaxSeats < familiarMinSeats) familiarMaxSeats = familiarMinSeats;
    return { economicoMaxYear, confortMinYear, vipMinYear, familiarMinSeats, familiarMaxSeats };
}

function vehicleType(driver) {
    return String(driver?.vehicleType || driver?.type || driver?.vehicle?.type || 'auto').toLowerCase();
}

function suggest(driver, cutoffs) {
    const c = normalizeCutoffs(cutoffs);
    const type = vehicleType(driver);
    if (type === 'moto') return 'moto';
    if (!CAR_TYPES.has(type)) return null;
    const vehicle = driver?.vehicle || {};
    const year = Number(driver?.vehicleYear ?? vehicle.year);
    if (!Number.isInteger(year)) return null;
    const hasAC = driver?.hasAC === true || vehicle.hasAC === true;
    const seats = Number(driver?.seats ?? vehicle.seats);
    if (Number.isInteger(seats) && seats >= c.familiarMinSeats && seats <= c.familiarMaxSeats) return 'familiar';
    if (year >= c.vipMinYear) return 'vip';
    if (year >= c.confortMinYear && hasAC) return 'confort';
    return 'economico';
}

function driverQualifiesForCategory(driver, category, cutoffs) {
    const cat = String(category || '').toLowerCase();
    if (!IDS.includes(cat)) return true;
    const type = vehicleType(driver);
    if (cat === 'moto') return type === 'moto';
    if (cat === 'economico') return CAR_TYPES.has(type);
    if (!CAR_TYPES.has(type)) return false;
    return suggest(driver, cutoffs) === cat;
}

function categoryRate(rates, category) {
    const id = IDS.includes(category) ? category : 'economico';
    const fallback = DEFAULTS[id];
    const row = rates && rates[id] && typeof rates[id] === 'object' ? rates[id] : {};
    const base = Number(row.base);
    const perKm = Number(row.perKm);
    return {
        base: Number.isFinite(base) && base >= 0 ? base : fallback.base,
        perKm: Number.isFinite(perKm) && perKm >= 0 ? perKm : fallback.perKm
    };
}

function quoteCategoryFare(rates, category, km) {
    const rate = categoryRate(rates, category);
    const distance = Math.max(0, Number(km) || 0);
    return Math.round((rate.base + distance * rate.perKm) * 100) / 100;
}

module.exports = {
    driverQualifiesForCategory,
    quoteCategoryFare,
    categoryRate,
    RIDE_CATEGORY_RATE_DEFAULTS: DEFAULTS
};
