export const MOTO_CAMPAIGN = {
    title: 'Moto Segura HonduRaite',
    tagline: 'Casco verificado · conductores validados · la moto es reina en Honduras',
    helmetRequired: true,
};

/** Placa oficial de taxi en Honduras: T-1234, T12345, etc. */
export const TAXI_PLATE_REGEX = /^[Tt]\s*-?\s*\d{3,5}$/;

export function isValidTaxiPlate(plate) {
    return TAXI_PLATE_REGEX.test((plate || '').trim());
}

export const SERVICE_TYPE_META = {
    auto: {
        id: 'auto',
        label: 'Taxi VIP',
        shortLabel: 'Taxi VIP (automóvil)',
        icon: 'fa-car',
        color: 'blue',
        base: 37,
        perKm: 12,
        driverVehicleType: 'auto',
        originPlaceholder: 'Origen',
        destPlaceholder: 'Destino final',
        calculateLabel: 'CALCULAR TAXI VIP',
        isStar: true,
        campaign: 'Automóvil privado · tarifa premium',
    },
    taxi: {
        id: 'taxi',
        label: 'Taxi tradicional',
        shortLabel: 'Taxi con número oficial',
        icon: 'fa-taxi',
        color: 'yellow',
        base: 30,
        perKm: 10,
        driverVehicleType: 'taxi',
        originPlaceholder: 'Origen',
        destPlaceholder: 'Destino final',
        calculateLabel: 'CALCULAR TAXI TRADICIONAL',
        isStar: false,
        campaign: 'Solo taxis con placa T- (número oficial)',
    },
    moto: {
        id: 'moto',
        label: 'Moto (pasajeros)',
        shortLabel: 'Viaje en moto',
        icon: 'fa-motorcycle',
        color: 'violet',
        base: 20,
        perKm: 8,
        driverVehicleType: 'moto',
        originPlaceholder: 'Origen (recogida)',
        destPlaceholder: 'Destino final',
        calculateLabel: 'CALCULAR VIAJE EN MOTO',
        isStar: true,
        campaign: MOTO_CAMPAIGN.title,
    },
    delivery: {
        id: 'delivery',
        label: 'Envío / Comida',
        shortLabel: 'Entrega o comida en moto',
        icon: 'fa-utensils',
        color: 'amber',
        base: 15,
        perKm: 7,
        driverVehicleType: 'moto',
        originPlaceholder: 'Restaurante o punto de recogida',
        destPlaceholder: 'Dirección de entrega',
        calculateLabel: 'CALCULAR ENVÍO / COMIDA',
        slaMinutes: 30,
        isStar: true,
        campaign: 'Comida y envíos en moto',
    },
    flete_paila: {
        id: 'flete_paila',
        label: 'Flete · Paila',
        shortLabel: 'Carga en pickup / paila',
        icon: 'fa-truck-pickup',
        color: 'emerald',
        base: 85,
        perKm: 18,
        driverVehicleType: 'paila',
        originPlaceholder: 'Punto de carga (bodega, obra, finca...)',
        destPlaceholder: 'Destino de descarga',
        calculateLabel: 'CALCULAR FLETE EN PAILA',
        isStar: false,
        campaign: 'Muebles, materiales, animales, carga mediana',
    },
    flete_camion: {
        id: 'flete_camion',
        label: 'Flete · Camión',
        shortLabel: 'Carga pesada en camión',
        icon: 'fa-truck',
        color: 'slate',
        base: 220,
        perKm: 38,
        driverVehicleType: 'camion',
        originPlaceholder: 'Punto de carga (bodega, puerto, obra...)',
        destPlaceholder: 'Destino de descarga',
        calculateLabel: 'CALCULAR FLETE EN CAMIÓN',
        isStar: false,
        campaign: 'Carga voluminosa o pesada · toneladas',
    },
    grua: {
        id: 'grua',
        label: 'Grúa / remolque',
        shortLabel: 'Servicio de grúa',
        icon: 'fa-truck-monster',
        color: 'rose',
        base: 1500,
        perKm: 95,
        driverVehicleType: 'grua',
        originPlaceholder: 'Dónde está el vehículo varado',
        destPlaceholder: 'Taller, casa u otro destino del remolque',
        calculateLabel: 'CALCULAR GRÚA',
        isStar: true,
        campaign: 'Remolque premium · salida cara · foto del vehículo',
    },
};

export function isFreightService(type) {
    const t = normalizeServiceType(type);
    return t === 'flete_paila' || t === 'flete_camion';
}

export function isTowService(type) {
    return normalizeServiceType(type) === 'grua';
}

/** Flete o grúa: no son viajes de pasajeros (1 “cliente”, sin cumpleaños gratis, etc.). */
export function isFreightOrTowService(type) {
    return isFreightService(type) || isTowService(type);
}

export function normalizeServiceType(type) {
    return SERVICE_TYPE_META[type] ? type : 'auto';
}

export function getServiceMeta(type) {
    return SERVICE_TYPE_META[normalizeServiceType(type)];
}

/** Títulos de notificación push / toast por tipo de servicio */
export function getTripOfferNotificationCopy(serviceType) {
    const t = normalizeServiceType(serviceType);
    const map = {
        auto: {
            title: '🚗 ¡Taxi VIP disponible!',
            toast: '🚗 ¡Taxi VIP cerca!',
            short: 'Taxi VIP',
            staff: 'Taxi VIP pendiente',
            demand: '🚗 ¡Taxi VIP cerca!'
        },
        taxi: {
            title: '🚕 ¡Taxi tradicional cerca!',
            toast: '🚕 ¡Taxi tradicional cerca!',
            short: 'Taxi tradicional',
            staff: 'Taxi tradicional pendiente',
            demand: '🚕 ¡Taxi T- cerca!'
        },
        moto: {
            title: '🏍️ ¡Viaje en moto cerca!',
            toast: '🏍️ ¡Viaje en moto cerca!',
            short: 'Viaje en moto',
            staff: 'Viaje en moto pendiente',
            demand: '🏍️ ¡Pasajero en moto cerca!'
        },
        delivery: {
            title: '📦 ¡Envío/delivery cerca!',
            toast: '📦 ¡Envío cerca!',
            short: 'Envío en moto',
            staff: 'Envío pendiente',
            demand: '📦 ¡Envío cerca!'
        },
        flete_paila: {
            title: '🚛 ¡Flete paila disponible!',
            toast: '🚛 ¡Flete paila disponible!',
            short: 'Flete paila',
            staff: 'Flete paila pendiente',
            demand: '🚛 ¡Flete paila cerca!'
        },
        flete_camion: {
            title: '🚛 ¡Flete camión disponible!',
            toast: '🚛 ¡Flete camión disponible!',
            short: 'Flete camión',
            staff: 'Flete camión pendiente',
            demand: '🚛 ¡Flete camión cerca!'
        },
        grua: {
            title: '🛠️ ¡Solicitud de grúa!',
            toast: '🛠️ ¡Grúa solicitada cerca!',
            short: 'Grúa',
            staff: 'Grúa pendiente',
            demand: '🛠️ ¡Grúa cerca!'
        }
    };
    return map[t] || {
        title: '¡Nuevo viaje cerca!',
        toast: '¡Nuevo viaje cerca!',
        short: getServiceMeta(t).label || 'Viaje',
        staff: 'Viaje pendiente',
        demand: '¡Nuevo viaje cerca!'
    };
}

export function applyRouteConditionAdjustments(fare, conditions = {}) {
    // Tráfico diferenciado:
    // - Dentro de ciudad (corto, <15km): afecta desde ~5 min de retraso (5-12%)
    // - Carretera / sale de ciudad (>15km como CA-5): más leve, desde ~12 min (3-7%)
    // Clima: llovizna, lluvia y lluvia fuerte (10-15%)
    let adjusted = Math.max(0, parseFloat(fare) || 0);
    const trafficPct = conditions.trafficSurchargePercent || 0;
    const weatherPct = conditions.weatherSurchargePercent || 0;
    if (trafficPct > 0) adjusted *= (1 + trafficPct / 100);
    if (weatherPct > 0) adjusted *= (1 + weatherPct / 100);
    return Math.round(adjusted * 100) / 100;
}

/**
 * Personas en el viaje (cliente común elige al pedir). Incluye al solicitante.
 * Límite general: 4 en auto/taxi. Moto: 2. Delivery/flete: 1.
 */
export const MAX_TRIP_PASSENGERS = 4;

export const MAX_PASSENGERS_BY_SERVICE = {
    moto: 2,
    auto: MAX_TRIP_PASSENGERS,
    taxi: MAX_TRIP_PASSENGERS,
    delivery: 1,
    flete_paila: 1,
    flete_camion: 1,
    grua: 1,
};

/** Cobro fijo por cada persona extra (después de la 1.ª). */
export const EXTRA_PASSENGER_FEE = {
    moto: 12,
    auto: 20,
    taxi: 15,
    delivery: 0,
    flete_paila: 0,
    flete_camion: 0,
    grua: 0,
};

const INTERCITY_PASSENGER_SURCHARGE_MIN_KM = 25;

function resolvePassengerTripDistance(tripContext = null) {
    if (typeof tripContext === 'number') return tripContext;
    if (!tripContext || typeof tripContext !== 'object') return null;
    return tripContext.distanceKm
        ?? tripContext.km
        ?? tripContext.tripDistanceKm
        ?? tripContext.distanceKmForCharge
        ?? null;
}

export function isIntercityPassengerTrip(tripContext = null) {
    const distanceKm = Number(resolvePassengerTripDistance(tripContext));
    return Number.isFinite(distanceKm) && distanceKm > INTERCITY_PASSENGER_SURCHARGE_MIN_KM;
}

export function getMaxPassengers(type) {
    const t = normalizeServiceType(type);
    return MAX_PASSENGERS_BY_SERVICE[t] ?? 4;
}

export function getExtraPassengerFee(type) {
    const t = normalizeServiceType(type);
    return Number(EXTRA_PASSENGER_FEE[t]) || 0;
}

/** Normaliza 1..max. Delivery/flete siempre 1. */
export function normalizePassengerCount(type, count) {
    const t = normalizeServiceType(type);
    const max = getMaxPassengers(t);
    if (max <= 1) return 1;
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(max, n);
}

/** Monto extra por personas adicionales (0 si va 1). */
export function getPassengerSurcharge(type, passengers = 1, tripContext = null) {
    const pax = normalizePassengerCount(type, passengers);
    if (!isIntercityPassengerTrip(tripContext)) return 0;
    const extra = Math.max(0, pax - 1);
    if (extra <= 0) return 0;
    return Math.round(extra * getExtraPassengerFee(type) * 100) / 100;
}

export function applyPassengerSurcharge(baseFare, type, passengers = 1, tripContext = null) {
    const base = Math.max(0, parseFloat(baseFare) || 0);
    const surcharge = getPassengerSurcharge(type, passengers, tripContext);
    return Math.round((base + surcharge) * 100) / 100;
}

export function formatPassengersLabel(passengers = 1) {
    const n = Math.max(1, parseInt(passengers, 10) || 1);
    return n === 1 ? '1 persona' : `${n} personas`;
}

/**
 * @param {string} type
 * @param {number} km
 * @param {object|null} conditions
 * @param {number|{passengers?: number}|null} passengersOrOpts - personas o { passengers }
 */
export function calculateServiceFare(type, km, conditions = null, passengersOrOpts = null) {
    const meta = getServiceMeta(type);
    if (isFreightService(type)) {
        return calculateFreightFare(type, km, {}, conditions).total;
    }
    if (isTowService(type)) {
        return calculateTowFare(type, km, {}, conditions).total;
    }
    const distance = Math.max(0, parseFloat(km) || 0);
    let fare = meta.base + distance * meta.perKm;
    if (conditions) fare = applyRouteConditionAdjustments(fare, conditions);
    let passengers = 1;
    if (typeof passengersOrOpts === 'number') passengers = passengersOrOpts;
    else if (passengersOrOpts && typeof passengersOrOpts === 'object') {
        passengers = passengersOrOpts.passengers ?? 1;
    }
    fare = applyPassengerSurcharge(fare, type, passengers, km);
    return Math.round(fare * 100) / 100;
}

export const FREIGHT_HELPER_FEE_PER_PERSON = 150;
export const FREIGHT_MAX_HELPERS = 4;

/** Dentro de ciudad: base + km + peso + ayudantes. Fuera: km + horas + tráfico + clima. */
export const FREIGHT_URBAN_MAX_KM = 25;

/** Tarifas de flete: base + km + peso + ayudantes (no es un viaje de pasajeros). */
export const FREIGHT_RATE_CONFIG = {
    flete_paila: {
        label: 'Paila / pickup',
        minimum: 150,
        baseFee: 120,
        includedKm: 3,
        perKmUrban: 22,
        perKmLong: 18,
        longTripFromKm: 25,
        intercity: {
            minimum: 280,
            dispatchFee: 80,
            perKm: 28,
            hourlyRate: 250,
            trafficPerMinute: 10,
        },
        weightTiers: [
            { maxKg: 500, percent: 0, label: 'hasta 500 kg' },
            { maxKg: 1000, percent: 15, label: '500–1000 kg' },
            { maxKg: 2000, percent: 30, label: '1–2 ton' },
            { maxKg: 3500, percent: 50, label: '2–3.5 ton' },
            { maxKg: Infinity, percent: 80, label: 'más de 3.5 ton' },
        ],
        maxRecommendedKg: 3500,
    },
    flete_camion: {
        label: 'Camión',
        minimum: 480,
        baseFee: 420,
        includedKm: 4,
        perKmUrban: 48,
        perKmLong: 38,
        longTripFromKm: 35,
        intercity: {
            minimum: 650,
            dispatchFee: 150,
            perKm: 52,
            hourlyRate: 580,
            trafficPerMinute: 15,
        },
        weightTiers: [
            { maxKg: 2000, percent: 0, label: 'hasta 2 ton' },
            { maxKg: 5000, percent: 28, label: '2–5 ton' },
            { maxKg: 10000, percent: 55, label: '5–10 ton' },
            { maxKg: Infinity, percent: 85, label: 'más de 10 ton' },
        ],
        maxRecommendedKg: 15000,
    },
};

export function normalizeFreightHelperCount(details = {}) {
    if (details == null) return 0;
    const raw = details.helperCount ?? details.helpersCount ?? details.helpers ?? null;
    if (raw != null && raw !== '') {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) return Math.max(0, Math.min(FREIGHT_MAX_HELPERS, n));
    }
    if (details.needsHelpers === true || details.needsHelpers === 'true' || details.needsHelpers === 1) {
        return 1;
    }
    return 0;
}

export function formatFreightHelpersLabel(details = {}) {
    const count = normalizeFreightHelperCount(details);
    if (!count) return '';
    return count === 1 ? ' · 1 ayudante' : ` · ${count} ayudantes`;
}

export function parseFreightWeightKg(text) {
    const raw = (text || '').toLowerCase().trim();
    if (!raw) return 0;

    const tonMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:toneladas?|tons?|t\b)/);
    if (tonMatch) return Math.round(parseFloat(tonMatch[1].replace(',', '.')) * 1000);

    const kgMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilos?|kilogramos?)\b/);
    if (kgMatch) return Math.round(parseFloat(kgMatch[1].replace(',', '.')));

    const lbMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:lb|lbs|libras?)\b/);
    if (lbMatch) return Math.round(parseFloat(lbMatch[1].replace(',', '.')) * 0.453592);

    const qqMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:qq|quintales?)\b/);
    if (qqMatch) return Math.round(parseFloat(qqMatch[1].replace(',', '.')) * 46);

    const numOnly = raw.match(/^(\d+(?:[.,]\d+)?)$/);
    if (numOnly) {
        const n = parseFloat(numOnly[1].replace(',', '.'));
        return n > 200 ? Math.round(n) : Math.round(n * 1000);
    }

    return 0;
}

function getFreightWeightTier(config, weightKg) {
    const kg = Math.max(0, weightKg || 0);
    const tiers = config.weightTiers || [];
    for (const tier of tiers) {
        if (kg <= tier.maxKg) return tier;
    }
    return tiers[tiers.length - 1] || { percent: 0, label: '' };
}

export function isFreightUrbanTrip(distanceKm, urbanMaxKm = FREIGHT_URBAN_MAX_KM) {
    return Math.max(0, parseFloat(distanceKm) || 0) <= urbanMaxKm;
}

function calculateFreightUrbanDistanceCharge(config, km) {
    const distance = Math.max(0, parseFloat(km) || 0);
    const billableKm = Math.max(0, distance - (config.includedKm || 0));
    if (!billableKm) return 0;

    const urbanCap = Math.max(0, (config.longTripFromKm || FREIGHT_URBAN_MAX_KM) - (config.includedKm || 0));
    if (billableKm <= urbanCap) {
        return billableKm * config.perKmUrban;
    }
    return (urbanCap * config.perKmUrban) + ((billableKm - urbanCap) * config.perKmLong);
}

function resolveFreightDurationHours(routeMeta = {}, conditions = null) {
    const durationMs = routeMeta?.durationMs
        || conditions?.traffic?.durationMs
        || 0;
    if (!durationMs) return 1;
    return Math.max(1, Math.ceil(durationMs / 3600000));
}

function calculateFreightIntercityExtras(config, distanceKm, conditions, routeMeta = {}) {
    const ic = config.intercity || {};
    const dispatchFee = ic.dispatchFee || 0;
    const distanceCharge = Math.round(distanceKm * (ic.perKm || config.perKmLong || 0) * 100) / 100;

    const durationHours = resolveFreightDurationHours(routeMeta, conditions);
    const hoursCharge = Math.round(durationHours * (ic.hourlyRate || 0) * 100) / 100;

    const delayMinutes = conditions?.traffic?.delayMinutes || 0;
    const billableTrafficMinutes = Math.max(0, delayMinutes - 1);
    const trafficCharge = Math.round(billableTrafficMinutes * (ic.trafficPerMinute || 0) * 100) / 100;

    return {
        dispatchFee,
        distanceCharge,
        durationHours,
        hoursCharge,
        delayMinutes,
        billableTrafficMinutes,
        trafficCharge,
        minimum: ic.minimum || config.minimum,
    };
}

export function calculateFreightFare(serviceType, km, freightDetails = {}, conditions = null, routeMeta = null) {
    const type = normalizeServiceType(serviceType);
    const config = FREIGHT_RATE_CONFIG[type];
    if (!config) {
        return { total: 0, breakdown: {}, warnings: [] };
    }

    const weightKg = parseFreightWeightKg(freightDetails?.estimatedWeight);
    const helperCount = normalizeFreightHelperCount(freightDetails);
    const distanceKm = Math.max(0, parseFloat(km) || 0);
    const urban = isFreightUrbanTrip(distanceKm);

    const weightTier = getFreightWeightTier(config, weightKg);
    const helperFee = helperCount * FREIGHT_HELPER_FEE_PER_PERSON;

    let baseFee;
    let distanceCharge;
    let dispatchFee = 0;
    let hoursCharge = 0;
    let durationHours = 0;
    let trafficCharge = 0;
    let billableTrafficMinutes = 0;
    let delayMinutes = 0;
    let minimum = config.minimum;

    if (urban) {
        baseFee = config.baseFee;
        distanceCharge = calculateFreightUrbanDistanceCharge(config, distanceKm);
    } else {
        const ic = calculateFreightIntercityExtras(config, distanceKm, conditions, routeMeta || {});
        dispatchFee = ic.dispatchFee;
        baseFee = dispatchFee;
        distanceCharge = ic.distanceCharge;
        hoursCharge = ic.hoursCharge;
        durationHours = ic.durationHours;
        trafficCharge = ic.trafficCharge;
        billableTrafficMinutes = ic.billableTrafficMinutes;
        delayMinutes = ic.delayMinutes;
        minimum = ic.minimum;
    }

    const subtotal = baseFee + distanceCharge + hoursCharge + trafficCharge;
    const weightSurcharge = Math.round(subtotal * (weightTier.percent / 100) * 100) / 100;

    let beforeConditions = subtotal + weightSurcharge + helperFee;
    const conditionAdjustments = urban
        ? {
            trafficSurchargePercent: 0,
            weatherSurchargePercent: conditions?.weatherSurchargePercent || 0,
        }
        : (conditions || {});
    let total = applyRouteConditionAdjustments(beforeConditions, conditionAdjustments);
    total = Math.max(minimum, Math.round(total * 100) / 100);

    const warnings = [];
    if (!urban) {
        warnings.push('Flete fuera de ciudad: incluye km completos, tiempo en ruta, tráfico (+1 min) y clima.');
    }
    if (weightKg > config.maxRecommendedKg) {
        warnings.push(type === 'flete_paila'
            ? 'Carga muy pesada para paila. Considera flete en camión.'
            : 'Carga excepcional: el conductor puede ajustar el precio al ver la carga.');
    } else if (weightKg === 0 && freightDetails?.estimatedWeight) {
        warnings.push('No pudimos leer el peso. Usa formato como "800 kg" o "2 ton".');
    }

    const conditionsExtra = Math.round((total - Math.max(minimum, beforeConditions)) * 100) / 100;

    return {
        total,
        breakdown: {
            pricingMode: urban ? 'urban' : 'intercity',
            baseFee,
            includedKm: urban ? config.includedKm : 0,
            dispatchFee,
            distanceKm,
            distanceCharge: Math.round(distanceCharge * 100) / 100,
            durationHours,
            hoursCharge,
            delayMinutes,
            billableTrafficMinutes,
            trafficCharge,
            weightKg,
            weightTierLabel: weightTier.label,
            weightSurchargePercent: weightTier.percent,
            weightSurcharge,
            helperCount,
            helperFeePerPerson: FREIGHT_HELPER_FEE_PER_PERSON,
            helperFee,
            trafficSurchargePercent: urban ? 0 : (conditions?.trafficSurchargePercent || 0),
            weatherSurchargePercent: conditions?.weatherSurchargePercent || 0,
            conditionsExtra,
            minimum,
            subtotalBeforeConditions: Math.round(beforeConditions * 100) / 100,
        },
        warnings,
    };
}

export function formatFreightFareBreakdown(serviceType, quote) {
    if (!quote?.breakdown) return '';
    const b = quote.breakdown;
    const parts = [];

    if (b.pricingMode === 'intercity') {
        if (b.dispatchFee > 0) parts.push(`Despacho L. ${b.dispatchFee.toFixed(0)}`);
        if (b.distanceCharge > 0) parts.push(`+ ${b.distanceKm.toFixed(1)} km → L. ${b.distanceCharge.toFixed(2)}`);
        if (b.hoursCharge > 0) parts.push(`+ ${b.durationHours} h ruta → L. ${b.hoursCharge.toFixed(2)}`);
        if (b.trafficCharge > 0) parts.push(`+ tráfico ${b.billableTrafficMinutes} min → L. ${b.trafficCharge.toFixed(2)}`);
    } else {
        parts.push(`Base L. ${b.baseFee.toFixed(0)} (incl. ${b.includedKm} km)`);
        if (b.distanceCharge > 0) parts.push(`+ ${b.distanceKm.toFixed(1)} km → L. ${b.distanceCharge.toFixed(2)}`);
    }

    if (b.weightSurcharge > 0) parts.push(`+ carga ${b.weightTierLabel} (${b.weightSurchargePercent}%) L. ${b.weightSurcharge.toFixed(2)}`);
    if (b.helperFee > 0) {
        const label = b.helperCount === 1 ? '1 ayudante' : `${b.helperCount} ayudantes`;
        parts.push(`+ ${label} × L. ${(b.helperFeePerPerson || FREIGHT_HELPER_FEE_PER_PERSON).toFixed(0)} = L. ${b.helperFee.toFixed(2)}`);
    }
    if (b.conditionsExtra > 0) {
        const bits = [];
        if (b.trafficSurchargePercent > 0) bits.push(`tráfico +${b.trafficSurchargePercent}%`);
        if (b.weatherSurchargePercent > 0) bits.push(`clima +${b.weatherSurchargePercent}%`);
        parts.push(`+ ${bits.join(' y ') || 'ajuste ruta'} L. ${b.conditionsExtra.toFixed(2)}`);
    }
    return parts.join(' · ');
}

export function driverCanServeTrip(driverVehicleType, tripServiceType, vehiclePlate = null) {
    const driverRaw = (driverVehicleType || 'auto').toLowerCase();
    const tripRaw = normalizeServiceType(tripServiceType);
    const plate = (vehiclePlate || '').trim();

    // VIP / Taxi VIP category: trips requested as VIP (auto) should only be taken by drivers with VIP vehicle
    const isVipTrip = (tripRaw === 'auto' || tripRaw === 'vip' || tripRaw === 'taxi_vip');
    const isVipDriver = (driverRaw === 'auto' || driverRaw === 'vip' || driverRaw === 'taxi_vip');

    if (tripRaw === 'taxi') {
        return driverRaw === 'taxi' && isValidTaxiPlate(plate);
    }
    if (isVipTrip) {
        return isVipDriver;
    }
    if (tripRaw === 'moto' || tripRaw === 'delivery') {
        return driverRaw === 'moto';
    }
    if (tripRaw === 'flete_paila') {
        return driverRaw === 'paila';
    }
    if (tripRaw === 'flete_camion') {
        return driverRaw === 'camion';
    }
    if (tripRaw === 'grua') {
        return driverRaw === 'grua';
    }
    return false;
}

export function driverTripMismatchMessage(tripServiceType, driverVehicleType = null) {
    const trip = normalizeServiceType(tripServiceType);
    const driver = (driverVehicleType || 'auto').toLowerCase();
    if (trip === 'auto' || trip === 'vip' || trip === 'taxi_vip') {
        return 'Este viaje es Taxi VIP. Selecciona un vehículo VIP / Auto / Taxi VIP en "Vehículo de hoy".';
    }
    if (trip === 'taxi') {
        if (driver === 'taxi') {
            return 'Tu taxi necesita placa oficial (T-1234). Registra un taxi con número T- válido.';
        }
        return 'Este viaje es taxi tradicional. Cambia a tu taxi con número T- en "Vehículo de hoy".';
    }
    if (trip === 'delivery') return 'Este envío/comida es en moto. Selecciona tu moto en "Vehículo de hoy".';
    if (trip === 'flete_paila') return 'Este flete requiere paila/pickup. Selecciona tu vehículo de paila en "Vehículo de hoy".';
    if (trip === 'flete_camion') return 'Este flete requiere camión. Selecciona tu camión en "Vehículo de hoy".';
    if (trip === 'grua') return 'Esta solicitud es de grúa. Selecciona tu grúa registrada en "Vehículo de hoy".';
    return 'Este viaje es en moto. Selecciona tu moto en "Vehículo de hoy".';
}

export function getServiceLabel(type) {
    return getServiceMeta(type).shortLabel;
}

export function getServiceBadgeHtml(type, compact = false) {
    const meta = getServiceMeta(type);
    const size = compact ? 'text-[8px]' : 'text-[9px]';
    const colors = {
        blue: 'bg-blue-100 text-blue-700',
        violet: 'bg-violet-100 text-violet-700',
        amber: 'bg-amber-100 text-amber-800',
        yellow: 'bg-yellow-100 text-yellow-700',
        emerald: 'bg-emerald-100 text-emerald-800',
        slate: 'bg-slate-200 text-slate-800',
        rose: 'bg-rose-100 text-rose-800',
    };
    const cls = colors[meta.color] || colors.blue;
    return `<span class="${size} font-black uppercase px-2 py-0.5 rounded-full ${cls}"><i class="fas ${meta.icon}"></i> ${meta.label}</span>`;
}

export function getDriverVehicleTypeLabel(type) {
    if (type === 'taxi') return 'Taxi tradicional (placa T-)';
    if (type === 'moto') return 'Moto · viajes y envíos / comida';
    if (type === 'paila') return 'Paila / pickup · fletes';
    if (type === 'camion') return 'Camión · fletes pesados';
    if (type === 'grua') return 'Grúa · remolque';
    return 'Automóvil · Taxi VIP';
}

export function getDriverVehicleBadgeHtml(type) {
    const cls = 'text-[9px] font-black uppercase px-2 py-0.5 rounded-full mt-1 inline-block';
    if (type === 'moto') return `<span class="${cls} text-violet-400 bg-violet-500/10">🏍️ Moto · envíos</span>`;
    if (type === 'taxi') return `<span class="${cls} text-yellow-400 bg-yellow-500/10">🚕 Taxi</span>`;
    if (type === 'paila') return `<span class="${cls} text-emerald-400 bg-emerald-500/10"><i class="fas fa-truck-pickup"></i> Paila · fletes</span>`;
    if (type === 'camion') return `<span class="${cls} text-slate-300 bg-slate-500/10"><i class="fas fa-truck"></i> Camión · fletes</span>`;
    if (type === 'grua') return `<span class="${cls} text-rose-400 bg-rose-500/10">🏗️ Grúa</span>`;
    return `<span class="${cls} text-blue-400 bg-blue-500/10">🚗 Auto</span>`;
}

export function getDriverVehicleEmoji(type) {
    if (type === 'moto') return '🏍️';
    if (type === 'taxi') return '🚕';
    if (type === 'paila') return '🛻';
    if (type === 'camion') return '🚛';
    if (type === 'grua') return '🏗️';
    return '🚗';
}

export function getDriverVehicleTypeColorClass(type) {
    if (type === 'moto') return 'text-violet-400';
    if (type === 'taxi') return 'text-yellow-400';
    if (type === 'paila') return 'text-emerald-400';
    if (type === 'camion') return 'text-slate-300';
    if (type === 'grua') return 'text-rose-400';
    return 'text-blue-400';
}

export function getDriverVehicleNoun(type) {
    if (type === 'moto') return 'Moto';
    if (type === 'taxi') return 'Taxi';
    if (type === 'paila') return 'Paila';
    if (type === 'camion') return 'Camión';
    if (type === 'grua') return 'Grúa';
    return 'Vehículo';
}

export function collectFreightDetailsFromUI() {
    return {
        cargoDescription: document.getElementById('freight-cargo-desc')?.value.trim() || '',
        estimatedWeight: document.getElementById('freight-weight')?.value.trim() || '',
        contactName: document.getElementById('freight-contact-name')?.value.trim() || '',
        contactPhone: document.getElementById('freight-contact-phone')?.value.trim() || '',
        helperCount: normalizeFreightHelperCount({
            helperCount: document.getElementById('freight-helpers-count')?.value,
        }),
        needsHelpers: normalizeFreightHelperCount({
            helperCount: document.getElementById('freight-helpers-count')?.value,
        }) > 0,
        notes: document.getElementById('freight-notes')?.value.trim() || '',
    };
}

export function validateFreightDetails(details, serviceType = null) {
    if (!details?.cargoDescription) {
        return { ok: false, message: 'Describe qué vas a transportar (carga, materiales, muebles...).' };
    }
    if (!details?.estimatedWeight) {
        return { ok: false, message: 'Indica el peso o volumen estimado (ej: 800 kg, 2 ton).' };
    }
    if (!details?.contactName || !details?.contactPhone) {
        return { ok: false, message: 'Indica nombre y WhatsApp de contacto en destino.' };
    }
    const type = serviceType ? normalizeServiceType(serviceType) : null;
    if (type === 'flete_paila') {
        const kg = parseFreightWeightKg(details.estimatedWeight);
        if (kg > FREIGHT_RATE_CONFIG.flete_paila.maxRecommendedKg) {
            return {
                ok: false,
                message: 'Esa carga supera lo recomendado para paila. Cambia a Flete · Camión.',
            };
        }
    }
    return { ok: true };
}

// ================================================
// GRÚA / REMOLQUE — tarifa premium (salida cara)
// Mínimo ciudad L. 1,800 · interurbano L. 3,500+
// ================================================

export const TOW_URBAN_MAX_KM = 25;

export const TOW_SITUATION_OPTIONS = [
    { id: 'no_arranca', label: 'No arranca / se apagó', surcharge: 0 },
    { id: 'accidente', label: 'Accidente / choque', surcharge: 500 },
    { id: 'llanta_bloqueo', label: 'Llanta / freno bloqueado', surcharge: 400 },
    { id: 'zanja', label: 'En zanja / fuera de vía', surcharge: 900 },
    { id: 'volcado', label: 'Volcado / volcadura', surcharge: 1500 },
    { id: 'sin_llaves', label: 'Sin llaves / cerrado', surcharge: 350 },
];

export const TOW_VEHICLE_CLASS_OPTIONS = [
    { id: 'liviano', label: 'Sedán / hatch / compacto', surcharge: 0 },
    { id: 'suv', label: 'SUV / camioneta', surcharge: 350 },
    { id: 'pickup', label: 'Pickup', surcharge: 300 },
    { id: 'van', label: 'Van / microbús', surcharge: 500 },
    { id: 'pesado', label: 'Pesado / maquinaria', surcharge: 2000 },
];

/** Tarifas duras de grúa en Honduras (Lempiras). */
export const TOW_RATE_CONFIG = {
    grua: {
        label: 'Grúa / remolque',
        minimum: 1800,
        baseFee: 1500,
        includedKm: 5,
        perKmUrban: 95,
        perKmLong: 85,
        longTripFromKm: 25,
        nightPercent: 25,
        intercity: {
            minimum: 3500,
            dispatchFee: 1200,
            perKm: 120,
            hourlyRate: 1100,
            trafficPerMinute: 25,
        },
    },
};

function getTowSituationSurcharge(situationId) {
    const opt = TOW_SITUATION_OPTIONS.find((o) => o.id === situationId);
    return opt ? Number(opt.surcharge) || 0 : 0;
}

function getTowVehicleClassSurcharge(classId) {
    const opt = TOW_VEHICLE_CLASS_OPTIONS.find((o) => o.id === classId);
    return opt ? Number(opt.surcharge) || 0 : 0;
}

export function getTowSituationLabel(situationId) {
    return TOW_SITUATION_OPTIONS.find((o) => o.id === situationId)?.label || situationId || '';
}

export function getTowVehicleClassLabel(classId) {
    return TOW_VEHICLE_CLASS_OPTIONS.find((o) => o.id === classId)?.label || classId || '';
}

function isHondurasNightNow(date = new Date()) {
    try {
        const hour = Number(new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Tegucigalpa',
            hour: 'numeric',
            hour12: false,
        }).format(date));
        return hour >= 22 || hour < 6;
    } catch {
        const h = date.getHours();
        return h >= 22 || h < 6;
    }
}

function calculateTowUrbanDistanceCharge(config, km) {
    const distance = Math.max(0, parseFloat(km) || 0);
    const billableKm = Math.max(0, distance - (config.includedKm || 0));
    if (!billableKm) return 0;
    const urbanCap = Math.max(0, (config.longTripFromKm || TOW_URBAN_MAX_KM) - (config.includedKm || 0));
    if (billableKm <= urbanCap) {
        return billableKm * config.perKmUrban;
    }
    return (urbanCap * config.perKmUrban) + ((billableKm - urbanCap) * config.perKmLong);
}

/**
 * Cotización de grúa: base alta + km + dificultad + clase de vehículo + noche.
 * @returns {{ total: number, breakdown: object, warnings: string[] }}
 */
export function calculateTowFare(serviceType, km, towDetails = {}, conditions = null, routeMeta = null) {
    const type = normalizeServiceType(serviceType);
    const config = TOW_RATE_CONFIG[type] || TOW_RATE_CONFIG.grua;
    const distanceKm = Math.max(0, parseFloat(km) || 0);
    const urban = isFreightUrbanTrip(distanceKm, TOW_URBAN_MAX_KM);

    const situationId = towDetails?.situation || 'no_arranca';
    const vehicleClass = towDetails?.vehicleClass || 'liviano';
    const situationSurcharge = getTowSituationSurcharge(situationId);
    const vehicleClassSurcharge = getTowVehicleClassSurcharge(vehicleClass);
    const forceNight = towDetails?.isNight === true
        || towDetails?.forceNight === true
        || (towDetails?.isNight == null && isHondurasNightNow());

    let baseFee;
    let distanceCharge;
    let dispatchFee = 0;
    let hoursCharge = 0;
    let durationHours = 0;
    let trafficCharge = 0;
    let billableTrafficMinutes = 0;
    let delayMinutes = 0;
    let minimum = config.minimum;

    if (urban) {
        baseFee = config.baseFee;
        distanceCharge = calculateTowUrbanDistanceCharge(config, distanceKm);
    } else {
        const ic = config.intercity || {};
        dispatchFee = ic.dispatchFee || 0;
        baseFee = dispatchFee;
        distanceCharge = Math.round(distanceKm * (ic.perKm || config.perKmLong || 0) * 100) / 100;
        durationHours = resolveFreightDurationHours(routeMeta || {}, conditions);
        hoursCharge = Math.round(durationHours * (ic.hourlyRate || 0) * 100) / 100;
        delayMinutes = conditions?.traffic?.delayMinutes || 0;
        billableTrafficMinutes = Math.max(0, delayMinutes - 1);
        trafficCharge = Math.round(billableTrafficMinutes * (ic.trafficPerMinute || 0) * 100) / 100;
        minimum = ic.minimum || config.minimum;
    }

    const subtotal = baseFee + distanceCharge + hoursCharge + trafficCharge
        + situationSurcharge + vehicleClassSurcharge;

    const conditionAdjustments = urban
        ? {
            trafficSurchargePercent: 0,
            weatherSurchargePercent: conditions?.weatherSurchargePercent || 0,
        }
        : (conditions || {});

    let total = applyRouteConditionAdjustments(subtotal, conditionAdjustments);

    let nightSurcharge = 0;
    if (forceNight && (config.nightPercent || 0) > 0) {
        nightSurcharge = Math.round(total * (config.nightPercent / 100) * 100) / 100;
        total += nightSurcharge;
    }

    total = Math.max(minimum, Math.round(total * 100) / 100);

    const warnings = [];
    if (!urban) {
        warnings.push('Remolque fuera de ciudad: despacho + km completos + tiempo en ruta. Precio premium.');
    }
    if (vehicleClass === 'pesado') {
        warnings.push('Vehículo pesado: la grúa puede confirmar capacidad al llegar. Recargo aplicado.');
    }
    if (situationId === 'volcado' || situationId === 'zanja') {
        warnings.push('Situación difícil: el operador puede ajustar si requiere equipo especial.');
    }
    if (forceNight) {
        warnings.push(`Recargo nocturno +${config.nightPercent}% (22:00–05:59 Honduras).`);
    }
    if (!towDetails?.vehiclePhotoUrl && !towDetails?.vehiclePhotoDataUrl) {
        warnings.push('Sube una foto del vehículo varado para que la grúa sepa qué llevar.');
    }

    const conditionsExtra = Math.round((total - nightSurcharge - Math.max(minimum, subtotal)) * 100) / 100;

    return {
        total,
        breakdown: {
            pricingMode: urban ? 'urban' : 'intercity',
            baseFee,
            includedKm: urban ? config.includedKm : 0,
            dispatchFee,
            distanceKm,
            distanceCharge: Math.round(distanceCharge * 100) / 100,
            durationHours,
            hoursCharge,
            delayMinutes,
            billableTrafficMinutes,
            trafficCharge,
            situationId,
            situationLabel: getTowSituationLabel(situationId),
            situationSurcharge,
            vehicleClass,
            vehicleClassLabel: getTowVehicleClassLabel(vehicleClass),
            vehicleClassSurcharge,
            isNight: !!forceNight,
            nightPercent: forceNight ? (config.nightPercent || 0) : 0,
            nightSurcharge,
            trafficSurchargePercent: urban ? 0 : (conditions?.trafficSurchargePercent || 0),
            weatherSurchargePercent: conditions?.weatherSurchargePercent || 0,
            conditionsExtra: Math.max(0, conditionsExtra),
            minimum,
            subtotalBeforeConditions: Math.round(subtotal * 100) / 100,
        },
        warnings,
    };
}

export function formatTowFareBreakdown(serviceType, quote) {
    if (!quote?.breakdown) return '';
    const b = quote.breakdown;
    const parts = [];

    if (b.pricingMode === 'intercity') {
        if (b.dispatchFee > 0) parts.push(`Despacho L. ${b.dispatchFee.toFixed(0)}`);
        if (b.distanceCharge > 0) parts.push(`+ ${b.distanceKm.toFixed(1)} km → L. ${b.distanceCharge.toFixed(2)}`);
        if (b.hoursCharge > 0) parts.push(`+ ${b.durationHours} h ruta → L. ${b.hoursCharge.toFixed(2)}`);
        if (b.trafficCharge > 0) parts.push(`+ tráfico ${b.billableTrafficMinutes} min → L. ${b.trafficCharge.toFixed(2)}`);
    } else {
        parts.push(`Salida L. ${b.baseFee.toFixed(0)} (incl. ${b.includedKm} km)`);
        if (b.distanceCharge > 0) parts.push(`+ ${b.distanceKm.toFixed(1)} km → L. ${b.distanceCharge.toFixed(2)}`);
    }

    if (b.situationSurcharge > 0) {
        parts.push(`+ ${b.situationLabel || 'dificultad'} L. ${b.situationSurcharge.toFixed(0)}`);
    }
    if (b.vehicleClassSurcharge > 0) {
        parts.push(`+ ${b.vehicleClassLabel || 'clase'} L. ${b.vehicleClassSurcharge.toFixed(0)}`);
    }
    if (b.nightSurcharge > 0) {
        parts.push(`+ noche +${b.nightPercent}% L. ${b.nightSurcharge.toFixed(2)}`);
    }
    if (b.conditionsExtra > 0) {
        const bits = [];
        if (b.trafficSurchargePercent > 0) bits.push(`tráfico +${b.trafficSurchargePercent}%`);
        if (b.weatherSurchargePercent > 0) bits.push(`clima +${b.weatherSurchargePercent}%`);
        parts.push(`+ ${bits.join(' y ') || 'ajuste ruta'} L. ${b.conditionsExtra.toFixed(2)}`);
    }
    parts.push(`mín. L. ${b.minimum.toFixed(0)}`);
    return parts.join(' · ');
}

export function collectTowDetailsFromUI() {
    const situation = document.getElementById('tow-situation')?.value || 'no_arranca';
    const vehicleClass = document.getElementById('tow-vehicle-class')?.value || 'liviano';
    return {
        vehicleDescription: document.getElementById('tow-vehicle-desc')?.value.trim() || '',
        vehiclePlate: (document.getElementById('tow-vehicle-plate')?.value || '').trim().toUpperCase(),
        vehicleClass,
        situation,
        hasKeys: document.getElementById('tow-has-keys')?.checked !== false,
        contactName: document.getElementById('tow-contact-name')?.value.trim() || '',
        contactPhone: document.getElementById('tow-contact-phone')?.value.trim() || '',
        notes: document.getElementById('tow-notes')?.value.trim() || '',
        vehiclePhotoDataUrl: (typeof window !== 'undefined' && window.towVehiclePhotoDataUrl) || null,
        vehiclePhotoUrl: null,
    };
}

export function validateTowDetails(details) {
    if (!details?.vehicleDescription) {
        return { ok: false, message: 'Describe el vehículo a remolcar (marca, modelo, color).' };
    }
    if (!details?.vehiclePlate) {
        return { ok: false, message: 'Indica la placa del vehículo varado.' };
    }
    if (!details?.situation) {
        return { ok: false, message: 'Indica qué le pasó al vehículo.' };
    }
    if (!details?.contactName || !details?.contactPhone) {
        return { ok: false, message: 'Indica nombre y WhatsApp de contacto en el lugar.' };
    }
    if (!details?.vehiclePhotoUrl && !details?.vehiclePhotoDataUrl) {
        return { ok: false, message: 'Sube una foto del vehículo varado (obligatoria).' };
    }
    return { ok: true };
}

export function formatTowDetailsSummary(details = {}) {
    if (!details) return '';
    const bits = [
        details.vehicleDescription || null,
        details.vehiclePlate ? `placa ${details.vehiclePlate}` : null,
        details.situation ? getTowSituationLabel(details.situation) : null,
        details.vehicleClass ? getTowVehicleClassLabel(details.vehicleClass) : null,
        details.hasKeys === false ? 'sin llaves' : null,
    ].filter(Boolean);
    return bits.join(' · ');
}

// ================================================
// HOURLY BOOKING (Reserva por horas) - Referencia Uber
// Uber ofrece "Hourly" / "Reserva por horas" para múltiples paradas con precio fijo por bloque.
// Comisión típica Uber ~25% (efectiva varía 25-42% según reportes). Usamos 25% para alinearnos.
// Misma comisión y split aplica a reservas por horas.
// Máximo: 24 horas.
// ================================================

export const HOURLY_BASE_RATES = {
    moto: 100,
    auto: 300,
    taxi: 200,
    flete_paila: 250,
    flete_camion: 580,
    grua: 1100,
};

export function getHourlyRate(type) {
    const t = normalizeServiceType(type);
    return HOURLY_BASE_RATES[t] || 150;
}

export function calculateHourlyFare(type, hours = 1, options = {}, conditions = null) {
    let rate = getHourlyRate(type);
    const h = Math.max(1, Math.min(24, parseInt(hours || 1, 10))); // 1-24 horas

    // Recargo nocturno (22:00 - 05:59 hora de Honduras)
    if (options.isNight) {
        rate = rate * 1.25;  // +25%
    }

    let total = rate * h;

    // Cobro de km para viajes ciudad a ciudad (cuando aplique)
    if (options.distanceKm && options.distanceKm > 25) {
        const meta = getServiceMeta(type);
        const kmRate = meta.perKm || 15;
        // Se cobra km completo (100%) para viajes largos/interciudad (Comayagua-Tegus etc.) porque el conductor invierte tiempo y vehículo
        total += kmRate * options.distanceKm * 1.0;
    }

    // Opción de múltiples paradas: +15% por flexibilidad
    if (options.multipleStops) {
        total = total * 1.15;
    }

    // Para reservas por horas: el tráfico SI aplica aunque sea 1 minuto de retraso.
    // Se cobra más porque el conductor se compromete y no recibe otras notificaciones.
    const traffic = conditions?.traffic;
    if (traffic && traffic.delayMinutes >= 1) {
        let trafficPct = 0;
        const mins = traffic.delayMinutes;
        if (mins >= 15) {
            trafficPct = 30;
        } else if (mins >= 5) {
            trafficPct = 25;  // subido aún más para tráfico de 5 min en reservas por horas
        } else {
            trafficPct = 8; // incluso 1-4 minutos
        }
        if (trafficPct > 0) {
            total = total * (1 + trafficPct / 100);
        }
    }

    if (conditions?.weatherSurchargePercent > 0) {
        total = total * (1 + conditions.weatherSurchargePercent / 100);
    }

    // Personas extra solo en viajes interciudad.
    if (options.passengers != null) {
        total = applyPassengerSurcharge(total, type, options.passengers, options.distanceKm);
    }

    return Math.round(total * 100) / 100;
}

export function getHourlyLabel(hours) {
    const h = parseInt(hours || 1, 10);
    return `${h} hora${h > 1 ? 's' : ''}`;
}

// Nota: ahora soporta hasta 24 horas de reserva


export function isHourlyService(type) {
    return normalizeServiceType(type) === 'hora'; // we'll also support bookingType flag
}