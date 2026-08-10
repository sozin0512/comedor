/**
 * Lógica de día sin comisión POR CONDUCTOR (mismo criterio que js/commission-free-day.js del cliente).
 * CommonJS para Cloud Functions.
 */
const HN_TZ = 'America/Tegucigalpa';
const ROTATION_ANCHOR_UTC_MS = Date.UTC(2024, 0, 1);

const WEEKDAY_LABELS_ES = {
    0: 'Domingo',
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
    6: 'Sábado',
};

function truthyFlag(v) {
    return v === true || v === 1 || v === '1' || v === 'true';
}

function getHondurasWeekdayAndParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: HN_TZ,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
    });
    const parts = fmt.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    const year = parseInt(get('year'), 10) || 0;
    const month = parseInt(get('month'), 10) || 0;
    const day = parseInt(get('day'), 10) || 0;
    const wd = (get('weekday') || '').slice(0, 3).toLowerCase();
    const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const weekday = map[wd] ?? date.getDay();
    return { year, month, day, weekday };
}

function getHondurasDateKey(date = new Date()) {
    const { year, month, day } = getHondurasWeekdayAndParts(date);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getRotationWeekIndex(date = new Date()) {
    const { year, month, day } = getHondurasWeekdayAndParts(date);
    const noonUtc = Date.UTC(year, month - 1, day, 18, 0, 0);
    const days = Math.floor((noonUtc - ROTATION_ANCHOR_UTC_MS) / 86400000);
    return Math.floor(days / 7);
}

function getDriverRotationOffset(driverId) {
    const s = String(driverId || '').trim();
    if (!s) return 0;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h | 0) % 7;
}

function getDriverFreeWeekday(driverId, date = new Date()) {
    const weekIndex = getRotationWeekIndex(date);
    const offset = getDriverRotationOffset(driverId);
    return ((weekIndex + offset) % 7 + 1) % 7;
}

function getDriverFreeWeekdayLabel(driverId, date = new Date()) {
    return WEEKDAY_LABELS_ES[getDriverFreeWeekday(driverId, date)] || '';
}

function isDriverFreeCommissionDayToday(driverId, date = new Date()) {
    if (!driverId) return false;
    const { weekday } = getHondurasWeekdayAndParts(date);
    return weekday === getDriverFreeWeekday(driverId, date);
}

function normalizeCommissionFreeDayConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const cityEnabled = {};
    if (src.cityEnabled && typeof src.cityEnabled === 'object') {
        Object.keys(src.cityEnabled).forEach((id) => {
            const key = String(id || '').trim();
            if (!key) return;
            cityEnabled[key] = truthyFlag(src.cityEnabled[id]);
        });
    }
    return {
        enabled: truthyFlag(src.enabled),
        defaultCityEnabled: src.defaultCityEnabled === false ? false : true,
        cityEnabled,
        mode: 'per_driver_rotation',
    };
}

function isCityInProgram(zoneId, config) {
    if (!config?.enabled) return false;
    if (!zoneId) return false;
    const map = config.cityEnabled || {};
    if (Object.prototype.hasOwnProperty.call(map, zoneId)) {
        return !!map[zoneId];
    }
    return config.defaultCityEnabled !== false;
}

function isCommissionFreeDayActive(zoneId, driverId, date = new Date(), config) {
    if (!config?.enabled) return false;
    if (!driverId) return false;
    if (!isCityInProgram(zoneId, config)) return false;
    return isDriverFreeCommissionDayToday(driverId, date);
}

module.exports = {
    HN_TZ,
    WEEKDAY_LABELS_ES,
    getHondurasDateKey,
    getHondurasWeekdayAndParts,
    getRotationWeekIndex,
    getDriverFreeWeekday,
    getDriverFreeWeekdayLabel,
    isDriverFreeCommissionDayToday,
    normalizeCommissionFreeDayConfig,
    isCityInProgram,
    isCommissionFreeDayActive,
};
