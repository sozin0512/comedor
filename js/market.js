/**
 * Mercado HonduRaite: Honduras (lempiras) vs Estados Unidos (dólares).
 * Si el GPS cae en EE. UU., adapta moneda, mapa, teléfono y oculta el taxi tradicional.
 */
import { US_CITIES, US_DEFAULT_ZONE_ID } from './us-cities.js';

const STORAGE_KEY = 'honduber_market';
const HN = 'hn';
const US = 'us';

const US_TIMEZONES = new Set([
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Phoenix', 'America/Anchorage', 'America/Adak', 'Pacific/Honolulu',
    'America/Boise', 'America/Detroit', 'America/Indiana/Indianapolis',
    'America/Kentucky/Louisville', 'America/Puerto_Rico', 'America/Juneau',
    'America/Nome', 'America/Sitka', 'America/Yakutat',
    'America/North_Dakota/Center', 'America/Indiana/Knox',
]);

/** Taxi tradicional (placa T-) no existe como producto en EE. UU. */
const US_BLOCKED_SERVICES = new Set(['taxi']);

export const US_SERVICE_RATES = {
    auto: { base: 4.75, perKm: 1.35 },
    moto: { base: 3.50, perKm: 1.05 },
    delivery: { base: 3.25, perKm: 0.95 },
    flete_paila: { base: 32, perKm: 2.15 },
    flete_camion: { base: 68, perKm: 3.40 },
    grua: { base: 85, perKm: 4.25 },
};

export const US_HOURLY_RATES = {
    moto: 22,
    auto: 48,
    flete_paila: 55,
    flete_camion: 95,
    grua: 125,
};

export const US_EXTRA_PASSENGER_FEE = {
    moto: 2,
    auto: 3,
    taxi: 0,
    delivery: 0,
    flete_paila: 0,
    flete_camion: 0,
    grua: 0,
};

export const US_FREIGHT_HELPER_FEE = 12;

let activeMarket = HN;
let lastAppliedMarket = null;

function readStoredMarket() {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === US || v === HN) return v;
    } catch (_) {}
    return null;
}

function writeStoredMarket(id) {
    try {
        if (id === US || id === HN) localStorage.setItem(STORAGE_KEY, id);
    } catch (_) {}
}

export function getUsCities() {
    return US_CITIES;
}

export function getUsDefaultZoneId() {
    return US_DEFAULT_ZONE_ID;
}

export function coordsAreInUnitedStates(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
    // Continental
    if (la >= 24.4 && la <= 49.5 && ln >= -124.9 && ln <= -66.7) return true;
    // Alaska
    if (la >= 51 && la <= 72 && ln >= -180 && ln <= -129) return true;
    // Hawaii
    if (la >= 18.8 && la <= 22.4 && ln >= -160.4 && ln <= -154.7) return true;
    // Puerto Rico
    if (la >= 17.8 && la <= 18.6 && ln >= -67.4 && ln <= -65.2) return true;
    return false;
}

export function timezoneLooksUnitedStates() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (US_TIMEZONES.has(tz)) return true;
        if (tz && tz.startsWith('America/Indiana/')) return true;
        if (tz && tz.startsWith('America/Kentucky/')) return true;
        if (tz && tz.startsWith('America/North_Dakota/')) return true;
        return false;
    } catch (_) {
        return false;
    }
}

export function detectMarketFromCoords(lat, lng) {
    if (coordsAreInUnitedStates(lat, lng)) return US;
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) return HN;
    return null;
}

export function getActiveMarket() {
    return activeMarket === US ? US : HN;
}

export function isUsMarket() {
    return getActiveMarket() === US;
}

export function getCurrencyCode() {
    return isUsMarket() ? 'USD' : 'HNL';
}

export function getCurrencyPrefix() {
    return isUsMarket() ? '$' : 'L.';
}

export function formatMoney(amount, { withCode = false } = {}) {
    const n = Number(amount);
    const val = Number.isFinite(n) ? n : 0;
    const abs = Math.abs(val);
    const decimals = abs >= 100 && Math.abs(val % 1) < 0.001 ? 0 : 2;
    const num = val.toFixed(decimals);
    if (isUsMarket()) {
        return withCode ? `USD ${num}` : `$${num}`;
    }
    return withCode ? `L. ${num} HNL` : `L. ${num}`;
}

export function getMapCountryRestriction() {
    return isUsMarket() ? ['us'] : ['hn'];
}

export function getGeocodeRegion() {
    return isUsMarket() ? 'US' : 'HN';
}

export function isServiceAllowedInMarket(type) {
    if (!type || type === 'stores') return true;
    if (isUsMarket() && US_BLOCKED_SERVICES.has(String(type))) return false;
    return true;
}

export function filterTypesForMarket(types = []) {
    return (types || []).filter((t) => isServiceAllowedInMarket(t));
}

export function setActiveMarket(id, { persist = true, silent = false } = {}) {
    const next = id === US ? US : HN;
    const prev = activeMarket;
    activeMarket = next;
    if (persist) writeStoredMarket(next);
    applyMarketToUi({ silent: silent || prev === next });
    return next;
}

/**
 * Detecta mercado por GPS y aplica cambios (moneda, mapa, taxi, etc.).
 * @returns {'us'|'hn'|null}
 */
export function applyMarketFromCoords(lat, lng, opts = {}) {
    const detected = detectMarketFromCoords(lat, lng);
    if (!detected) return null;
    const silent = opts.silent === true;
    if (detected === activeMarket) {
        applyMarketToUi({ silent: true });
        return detected;
    }
    setActiveMarket(detected, { persist: true, silent });
    if (!silent && detected === US) {
        window.showToast?.(
            'Estás en Estados Unidos · precios en dólares · sin taxi tradicional',
            'info'
        );
    }
    return detected;
}

function applyPlacesRestriction() {
    const codes = getMapCountryRestriction();
    try { window.updatePlacesCountryRestriction?.(codes); } catch (_) {}
    const originEl = document.getElementById('origin-autocomplete');
    const destEl = document.getElementById('destination-autocomplete');
    const extra = document.getElementById('extra-stop-autocomplete');
    [originEl, destEl, extra].forEach((el) => {
        if (!el) return;
        try { el.includedRegionCodes = codes; } catch (_) {}
    });
}

function hideUsBlockedServices() {
    const hideTaxi = isUsMarket();
    document.getElementById('svc-btn-taxi')?.classList.toggle('hidden', hideTaxi);
    const drvTaxi = document.getElementById('drv-type-taxi');
    if (drvTaxi) {
        drvTaxi.classList.toggle('hidden', hideTaxi);
        drvTaxi.toggleAttribute('disabled', hideTaxi);
    }
    const sel = document.getElementById('driver-vehicle-type');
    const taxiOpt = sel?.querySelector('option[value="taxi"]');
    if (taxiOpt) taxiOpt.hidden = hideTaxi;
    if (hideTaxi && sel?.value === 'taxi') {
        window.selectDriverVehicleType?.('auto');
    }
    if (hideTaxi && window.currentServiceType === 'taxi') {
        window.selectServiceType?.('auto', { keepFareVisible: true, skipCityCheck: true });
    }
}

function applyPhonePlaceholders() {
    const us = isUsMarket();
    const phone = document.getElementById('phone-number');
    if (phone) phone.placeholder = us ? 'WhatsApp (+1 555…)' : 'WhatsApp (+504...)';
    const emergency = document.getElementById('emergency-contact-setup');
    if (emergency) emergency.placeholder = us ? 'Contacto de emergencia (+1…)' : (emergency.placeholder || 'Contacto de emergencia');
}

function applyHomeCopy() {
    const hub = document.getElementById('passenger-home-hub');
    const tripCard = hub?.querySelector('[data-home-mode="trip"]');
    if (tripCard) {
        tripCard.title = isUsMarket()
            ? 'Moto o auto'
            : 'Moto, Taxi VIP o taxi tradicional';
    }
    const sub = document.getElementById('passenger-mode-sub');
    const mode = document.body.dataset.passengerMode;
    if (sub && mode === 'trip') {
        sub.textContent = isUsMarket() ? 'Moto · Auto' : 'Moto · Taxi VIP · Taxi tradicional';
    }
}

export function applyMarketToUi({ silent = true } = {}) {
    const market = getActiveMarket();
    document.body.dataset.market = market;
    document.body.classList.toggle('market-us', market === US);
    document.documentElement.dataset.currency = getCurrencyCode();
    applyPlacesRestriction();
    hideUsBlockedServices();
    applyPhonePlaceholders();
    applyHomeCopy();
    try { window.refreshPassengerHomeCityServices?.(); } catch (_) {}
    try { window.applyCityServiceAvailabilityToUI?.({ skipHomeRefresh: true }); } catch (_) {}

    if (lastAppliedMarket !== market) {
        lastAppliedMarket = market;
        try {
            window.dispatchEvent(new CustomEvent('honduraite-market-change', { detail: { market } }));
        } catch (_) {}
        if (!silent && market === US) {
            window.showToast?.(
                'Modo Estados Unidos · cobro en dólares',
                'info'
            );
        }
    }
}

export function initMarketDetection() {
    const stored = readStoredMarket();
    if (stored) {
        activeMarket = stored;
    } else if (timezoneLooksUnitedStates()) {
        activeMarket = US;
    } else {
        activeMarket = HN;
    }
    applyMarketToUi({ silent: true });
    installWindowApi();
    return getActiveMarket();
}

function installWindowApi() {
    window.isUsMarket = isUsMarket;
    window.getActiveMarket = getActiveMarket;
    window.getCurrencyCode = getCurrencyCode;
    window.formatMoney = formatMoney;
    window.getCurrencyPrefix = getCurrencyPrefix;
    window.applyMarketFromCoords = applyMarketFromCoords;
    window.setActiveMarket = setActiveMarket;
    window.isServiceAllowedInMarket = isServiceAllowedInMarket;
    window.getMapCountryRestriction = getMapCountryRestriction;
    window.getGeocodeRegion = getGeocodeRegion;
}

export { HN as MARKET_HN, US as MARKET_US };
