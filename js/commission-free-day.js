/**
 * Día sin comisión rotativo POR CONDUCTOR (incentivo).
 *
 * Importante: NO es el mismo día para todos.
 * Cada conductor tiene su propio día libre; se reparte ~1/7 de la flota por día
 * para que la app siga generando comisión con el resto.
 *
 * Rotación individual (zona Honduras):
 *   semana 0 → un día base, semana 1 → el siguiente, … y así sucesivamente.
 * El “día base” de cada conductor se desfase con un offset estable de su UID.
 *
 * Config en appSettings.main.commissionFreeDay:
 * {
 *   enabled: true,
 *   defaultCityEnabled: true,
 *   cityEnabled: { "comayagua": true, "san-pedro-sula": false }
 * }
 */
const HN_TZ = 'America/Tegucigalpa';

/** Ancla fija (lunes) para contar semanas de rotación. */
const ROTATION_ANCHOR_UTC_MS = Date.UTC(2024, 0, 1); // 2024-01-01 fue lunes

export const WEEKDAY_LABELS_ES = {
    0: 'Domingo',
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
    6: 'Sábado',
};

/** @type {{ enabled: boolean, defaultCityEnabled: boolean, cityEnabled: Record<string, boolean> }} */
let freeDayConfig = {
    enabled: false,
    defaultCityEnabled: true,
    cityEnabled: {},
};

function truthyFlag(v) {
    return v === true || v === 1 || v === '1' || v === 'true';
}

export function getHondurasWeekdayAndParts(date = new Date()) {
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
    const weekday = map[wd] ?? new Date(date).getDay();
    return { year, month, day, weekday };
}

/**
 * Índice de semana (0,1,2…) en Honduras. Cambia cada lunes 00:00 HN.
 */
export function getRotationWeekIndex(date = new Date()) {
    const { year, month, day } = getHondurasWeekdayAndParts(date);
    const noonUtc = Date.UTC(year, month - 1, day, 18, 0, 0);
    const days = Math.floor((noonUtc - ROTATION_ANCHOR_UTC_MS) / 86400000);
    return Math.floor(days / 7);
}

/**
 * Offset estable 0–6 por conductor (reparte la flota en 7 grupos).
 * Mismo UID → siempre el mismo offset.
 */
export function getDriverRotationOffset(driverId) {
    const s = String(driverId || '').trim();
    if (!s) return 0;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    // positivo 0..6
    return Math.abs(h | 0) % 7;
}

/**
 * Día libre (0=dom … 6=sáb) DE ESTE conductor esta semana.
 * Fórmula: desfase por UID + avanza 1 día cada semana.
 *   week 0, offset 0 → Lunes
 *   week 0, offset 1 → Martes
 *   week 1, offset 0 → Martes  (rotó)
 * Así NUNCA toda la flota coincide el mismo día.
 */
export function getDriverFreeWeekday(driverId, date = new Date()) {
    const weekIndex = getRotationWeekIndex(date);
    const offset = getDriverRotationOffset(driverId);
    // (week + offset) → 0..6; mapear 0→lun, 1→mar, … 6→dom
    return ((weekIndex + offset) % 7 + 1) % 7;
}

export function getDriverFreeWeekdayLabel(driverId, date = new Date()) {
    if (!driverId) return '';
    return WEEKDAY_LABELS_ES[getDriverFreeWeekday(driverId, date)] || '';
}

export function getDriverNextWeekFreeWeekdayLabel(driverId, date = new Date()) {
    if (!driverId) return '';
    const weekIndex = getRotationWeekIndex(date) + 1;
    const offset = getDriverRotationOffset(driverId);
    const wd = ((weekIndex + offset) % 7 + 1) % 7;
    return WEEKDAY_LABELS_ES[wd] || '';
}

/** @deprecated nombre legacy: ya no es un solo día global */
export function getRotatingFreeWeekday(date = new Date()) {
    // Solo informativo para admin: “grupo 0” esta semana (lunes en week 0)
    const weekIndex = getRotationWeekIndex(date);
    return (weekIndex % 7 + 1) % 7;
}

export function getRotatingFreeWeekdayLabel(date = new Date()) {
    return WEEKDAY_LABELS_ES[getRotatingFreeWeekday(date)] || '';
}

export function getNextWeekFreeWeekdayLabel(date = new Date()) {
    const weekIndex = getRotationWeekIndex(date) + 1;
    const wd = (weekIndex % 7 + 1) % 7;
    return WEEKDAY_LABELS_ES[wd] || '';
}

export function normalizeCommissionFreeDayConfig(raw) {
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
        // mode documentado (siempre per_driver)
        mode: 'per_driver_rotation',
    };
}

export function setCommissionFreeDayConfig(raw) {
    freeDayConfig = normalizeCommissionFreeDayConfig(raw);
    try {
        window.__HR_COMMISSION_FREE_DAY = freeDayConfig;
    } catch (_) {}
    return freeDayConfig;
}

export function getCommissionFreeDayConfig() {
    return {
        ...freeDayConfig,
        cityEnabled: { ...freeDayConfig.cityEnabled },
    };
}

/** ¿La ciudad participa del programa? */
export function isCityInCommissionFreeDayProgram(zoneId, config = freeDayConfig) {
    if (!config?.enabled) return false;
    if (!zoneId) return false;
    const map = config.cityEnabled || {};
    if (Object.prototype.hasOwnProperty.call(map, zoneId)) {
        return !!map[zoneId];
    }
    return config.defaultCityEnabled !== false;
}

/**
 * ¿Hoy es el día libre DE ESTE conductor? (sin mirar ciudad)
 */
export function isDriverFreeCommissionDayToday(driverId, date = new Date()) {
    if (!driverId) return false;
    const { weekday } = getHondurasWeekdayAndParts(date);
    return weekday === getDriverFreeWeekday(driverId, date);
}

/** @deprecated usar isDriverFreeCommissionDayToday + ciudad */
export function isRotatingFreeDayToday(date = new Date()) {
    // Ya no hay “día global”; se mantiene por compat (siempre false si se usa solo)
    return false;
}

/**
 * ¿Aplica 0% comisión para ESTE conductor en esta ciudad hoy?
 * Sin driverId → false (nunca gratis para toda la flota a la vez).
 *
 * @param {string|null} zoneId
 * @param {string|null} driverId  — obligatorio
 * @param {Date} [date]
 * @param {object} [config]
 */
export function isCommissionFreeDayActive(zoneId, driverId = null, date = new Date(), config = freeDayConfig) {
    if (!config?.enabled) return false;
    if (!driverId || typeof driverId !== 'string') return false;
    if (!isCityInCommissionFreeDayProgram(zoneId, config)) return false;
    return isDriverFreeCommissionDayToday(driverId, date);
}

/** Texto para UI admin (reparto de flota). */
export function getCommissionFreeDayStatusText(date = new Date(), config = freeDayConfig, sampleDriverId = null) {
    const weekIndex = getRotationWeekIndex(date);
    const group0Label = getRotatingFreeWeekdayLabel(date);
    const group0Next = getNextWeekFreeWeekdayLabel(date);

    let sampleLine = '';
    if (sampleDriverId) {
        const mine = getDriverFreeWeekdayLabel(sampleDriverId, date);
        const mineNext = getDriverNextWeekFreeWeekdayLabel(sampleDriverId, date);
        const mineToday = isDriverFreeCommissionDayToday(sampleDriverId, date);
        sampleLine = mineToday
            ? ` Tu día libre es HOY (${mine}). Próxima semana: ${mineNext}.`
            : ` Tu día libre esta semana: ${mine}. Próxima semana: ${mineNext}.`;
    }

    if (!config?.enabled) {
        return {
            enabled: false,
            isToday: false,
            todayLabel: group0Label,
            nextLabel: group0Next,
            weekIndex,
            headline: 'Día sin comisión: APAGADO',
            detail: `Cuando lo actives, cada conductor tiene SU día (repartido en 7 grupos). La app sigue cobrando comisión al resto (~6/7 de la flota cada día).`,
        };
    }

    return {
        enabled: true,
        isToday: !!sampleDriverId && isDriverFreeCommissionDayToday(sampleDriverId, date),
        todayLabel: group0Label,
        nextLabel: group0Next,
        weekIndex,
        headline: 'Día sin comisión ON · por conductor (no todos el mismo día)',
        detail:
            `Cada día ~1 de cada 7 conductores no paga comisión; el resto sí (la app sigue generando). `
            + `El día de cada uno rota cada semana (ej. un conductor: ${group0Label} esta semana → ${group0Next} la próxima).`
            + sampleLine,
    };
}

/**
 * Resuelve zoneId del viaje o del perfil del conductor.
 */
export function resolveZoneIdForCommission(trip = null, driverProfile = null) {
    return (
        trip?.serviceZoneId
        || trip?.cityId
        || trip?.originZoneId
        || driverProfile?.serviceZoneId
        || driverProfile?.cityId
        || (typeof window !== 'undefined' ? window.activeServiceZoneId : null)
        || null
    );
}

export function resolveDriverIdForCommission(trip = null, fallbackUid = null) {
    return trip?.driverId || fallbackUid || null;
}
