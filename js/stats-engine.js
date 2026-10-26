/**
 * Motor de cálculo y renderizado de Estadísticas Globales (Admin y Supervisión).
 */
import { formatLempiras } from './money-format.js';
import { HONDURAS_CITIES } from './honduras-cities.js';

export const DEFAULT_STORE_COMMISSION_PCT = 10;

export const SERVICE_BREAKDOWN_DEFS = [
    {
        key: 'auto_taxi',
        label: 'Auto / Taxi',
        subtitle: 'Taxi tradicional y automóvil',
        icon: 'fa-taxi',
        badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
        barClass: 'bg-sky-500',
        configKeys: ['taxi', 'auto'],
    },
    {
        key: 'moto',
        label: 'Moto',
        subtitle: 'Viaje de pasajero en moto',
        icon: 'fa-motorcycle',
        badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        barClass: 'bg-amber-500',
        configKeys: ['moto'],
    },
    {
        key: 'vip_hourly',
        label: 'VIP / Por horas',
        subtitle: 'Servicio VIP y alquiler por horas',
        icon: 'fa-crown',
        badgeClass: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
        barClass: 'bg-violet-500',
        configKeys: ['hourly', 'vip', 'auto'],
    },
    {
        key: 'delivery',
        label: 'Delivery / Envíos',
        subtitle: 'Mandados y paquetería directa',
        icon: 'fa-box-open',
        badgeClass: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
        barClass: 'bg-teal-500',
        configKeys: ['delivery'],
    },
    {
        key: 'flete_grua',
        label: 'Flete / Grúa',
        subtitle: 'Paila, camión de carga y remolque',
        icon: 'fa-truck-pickup',
        badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        barClass: 'bg-indigo-500',
        configKeys: ['flete', 'grua'],
    },
    {
        key: 'tiendas',
        label: 'Envíos de Tiendas',
        subtitle: 'Deliveries de comercios y restaurantes',
        icon: 'fa-store',
        badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        barClass: 'bg-emerald-500',
        configKeys: ['tiendas', 'delivery'],
    },
];

export function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

export function escHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

export function toMs(val) {
    if (!val) return 0;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    if (typeof val.toDate === 'function') {
        const d = val.toDate();
        return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : 0;
    }
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (typeof val.seconds === 'number') {
        return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6);
    }
    if (val instanceof Date) return Number.isFinite(val.getTime()) ? val.getTime() : 0;
    if (typeof val === 'string') {
        const parsed = Date.parse(val);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

export function isTripTrashed(t) {
    if (!t || typeof t !== 'object') return false;
    return Boolean(t.trashedAt || t.trashedAtMs || t.deletedAt || t.status === 'trashed');
}

export function parseNumericPrice(t) {
    if (!t || typeof t !== 'object') return 0;
    if (typeof window !== 'undefined' && typeof window.parseTripPrice === 'function') {
        const p = Number(window.parseTripPrice(t));
        if (Number.isFinite(p) && p > 0) return p;
    }
    if (t.negotiatedPrice != null && Number.isFinite(Number(t.negotiatedPrice)) && Number(t.negotiatedPrice) > 0) {
        return Number(t.negotiatedPrice);
    }
    if (t.priceNum != null && Number.isFinite(Number(t.priceNum))) {
        return Number(t.priceNum);
    }
    if (typeof t.price === 'number' && Number.isFinite(t.price)) return t.price;
    const m = String(t.price || '').replace(/,/g, '').match(/[\d.]+/);
    return m ? Number(m[0]) || 0 : 0;
}

export function normalizeCitySlug(str) {
    const raw = String(str || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    if (raw === 'valle-de-angeles') return 'valle-angeles';
    if (raw === 'comayaguela') return 'tegucigalpa';
    return raw;
}

const CITY_BY_ID = new Map(HONDURAS_CITIES.map((c) => [c.id, c]));

export function getCityCatalog(extraItems = []) {
    const priorityIds = [
        'tegucigalpa',
        'comayagua',
        'san-pedro-sula',
        'valle-angeles',
        'siguatepeque',
        'la-ceiba',
        'choluteca',
        'danli',
        'santa-rosa-copan',
        'juticalpa',
        'roatan',
        'puerto-cortes',
        'la-paz',
        'talanga',
        'santa-lucia',
    ];
    const seen = new Map();
    for (const id of priorityIds) {
        const c = CITY_BY_ID.get(id);
        if (c) seen.set(c.id, { id: c.id, name: c.name, department: c.department || '' });
    }
    for (const c of HONDURAS_CITIES) {
        if (c?.id && !seen.has(c.id)) {
            seen.set(c.id, { id: c.id, name: c.name, department: c.department || '' });
        }
    }
    for (const item of extraItems || []) {
        const resolved = resolveItemCity(item);
        if (resolved.cityId && resolved.cityId !== 'sin-ciudad' && !seen.has(resolved.cityId)) {
            seen.set(resolved.cityId, { id: resolved.cityId, name: resolved.cityName, department: 'Otras zonas' });
        }
    }
    return [...seen.values()];
}

export function resolveItemCity(item, profilesById = {}) {
    if (!item || typeof item !== 'object') return { cityId: 'sin-ciudad', cityName: 'Sin ciudad' };
    const driverProfile = (item.driverId && profilesById[item.driverId]) || {};
    const rawId = item.serviceZoneId || item.cityId || driverProfile.serviceZoneId || driverProfile.cityId || '';
    const normId = normalizeCitySlug(rawId);
    if (normId && CITY_BY_ID.has(normId)) {
        const known = CITY_BY_ID.get(normId);
        return { cityId: known.id, cityName: known.name };
    }
    const rawName = item.serviceZoneName || item.cityName || driverProfile.serviceZoneName || driverProfile.cityName || '';
    const slugFromName = normalizeCitySlug(rawName);
    if (slugFromName && CITY_BY_ID.has(slugFromName)) {
        const known = CITY_BY_ID.get(slugFromName);
        return { cityId: known.id, cityName: known.name };
    }
    if (normId) {
        return { cityId: normId, cityName: rawName || rawId };
    }
    const addressBlob = normalizeCitySlug([
        item.origin,
        item.destination,
        item.deliveryAddress,
        item.storeAddress,
        item.deliveryZoneName,
    ].filter(Boolean).join(' '));
    if (addressBlob) {
        for (const c of HONDURAS_CITIES) {
            const cSlug = normalizeCitySlug(c.name);
            if (cSlug && addressBlob.includes(cSlug)) {
                return { cityId: c.id, cityName: c.name };
            }
        }
    }
    return { cityId: 'sin-ciudad', cityName: rawName || 'Sin ciudad' };
}

export function matchesCityFilter(item, cityFilter = 'all', profilesById = {}) {
    if (!cityFilter || cityFilter === 'all' || cityFilter === 'todas') return true;
    const target = normalizeCitySlug(cityFilter);
    if (!target) return true;
    const { cityId, cityName } = resolveItemCity(item, profilesById);
    if (cityId === target || normalizeCitySlug(cityName) === target) return true;
    const zoneSlug = normalizeCitySlug(item?.deliveryZoneName || '');
    if (zoneSlug && zoneSlug === target) return true;
    return false;
}

export function resolveStatsDateRange({ period = 'today', from = '', to = '', now = new Date() } = {}) {
    const refNow = now instanceof Date ? new Date(now.getTime()) : new Date(now || Date.now());
    const fromTrim = String(from || '').trim();
    const toTrim = String(to || '').trim();

    if (period === 'custom' || fromTrim || toTrim) {
        let startDate;
        let endDate;
        if (fromTrim) {
            const [y, m, d] = fromTrim.split('-').map(Number);
            startDate = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
        } else {
            startDate = new Date(2020, 0, 1, 0, 0, 0, 0);
        }
        if (toTrim) {
            const [y, m, d] = toTrim.split('-').map(Number);
            endDate = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
        } else {
            endDate = new Date(refNow.getTime());
        }
        if (startDate > endDate) {
            const tmp = startDate;
            startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
            endDate = new Date(tmp.getFullYear(), tmp.getMonth(), tmp.getDate(), 23, 59, 59, 999);
        }
        return {
            period: 'custom',
            from: fromTrim,
            to: toTrim,
            startDate,
            endDate,
            startMs: startDate.getTime(),
            endMs: endDate.getTime(),
            label: `${fromTrim || 'Inicio'} → ${toTrim || 'Hoy'}`,
        };
    }

    const startDate = new Date(refNow.getTime());
    const endDate = new Date(refNow.getTime());
    let label = 'Hoy';

    if (period === 'today') {
        startDate.setHours(0, 0, 0, 0);
        label = 'Hoy';
    } else if (period === 'week') {
        startDate.setDate(startDate.getDate() - 7);
        label = 'Últimos 7 días';
    } else if (period === 'month') {
        startDate.setMonth(startDate.getMonth() - 1);
        label = 'Último mes';
    } else if (period === 'year') {
        startDate.setFullYear(startDate.getFullYear() - 1);
        label = 'Último año';
    } else {
        startDate.setHours(0, 0, 0, 0);
    }

    return {
        period,
        from: '',
        to: '',
        startDate,
        endDate,
        startMs: startDate.getTime(),
        endMs: endDate.getTime(),
        label,
    };
}

export function isStoreDeliveryTrip(t) {
    if (!t || typeof t !== 'object') return false;
    const d = t.deliveryDetails || {};
    return Boolean(
        t.storeDelivery
        || t.merchantDirectDelivery
        || t.createdByMerchant
        || t.storeOrder
        || t.storeOrderId
        || t.storeId
        || t.whatsappOrder
        || t.createdVia === 'whatsapp_store'
        || t.tripKind === 'store_order'
        || t.tripKind === 'merchant_delivery'
        || t.serviceType === 'tiendas'
        || d.fromStore
        || d.merchantDirect
        || d.merchantDirectDelivery
        || d.whatsappStore
        || d.storeDelivery
        || d.storeOrderId
        || d.storeId
    );
}

export function classifyTripServiceBucket(t) {
    if (!t || typeof t !== 'object') return 'auto_taxi';
    if (isStoreDeliveryTrip(t)) {
        return 'tiendas';
    }
    const st = String(t.serviceType || t.requestedVehicleType || t.vehicleType || 'auto').toLowerCase().trim();
    if (t.bookingType === 'hourly' || st === 'hourly' || st === 'vip' || t.isVip === true) {
        return 'vip_hourly';
    }
    if (st === 'moto') return 'moto';
    if (st === 'delivery' || st === 'envio' || t.tripKind === 'delivery') return 'delivery';
    if (st === 'flete' || st === 'flete_paila' || st === 'flete_camion' || st === 'grua') return 'flete_grua';
    return 'auto_taxi';
}

export function resolveRawServiceCommissionKey(t) {
    if (!t || typeof t !== 'object') return 'auto';
    if (isStoreDeliveryTrip(t)) {
        return 'tiendas';
    }
    const st = String(t.serviceType || t.requestedVehicleType || t.vehicleType || 'auto').toLowerCase().trim();
    if (t.bookingType === 'hourly' || st === 'hourly') return 'hourly';
    if (st === 'vip') return 'vip';
    if (st === 'flete_paila' || st === 'flete_camion' || st === 'flete') return 'flete';
    if (st === 'grua') return 'grua';
    if (st === 'moto') return 'moto';
    if (st === 'delivery' || st === 'envio') return 'delivery';
    if (st === 'taxi') return 'taxi';
    return 'auto';
}

const SERVICE_FALLBACK_CHAIN = {
    tiendas: ['tiendas', 'delivery'],
    vip: ['vip', 'hourly', 'auto'],
    hourly: ['hourly', 'vip', 'auto'],
    flete: ['flete'],
    grua: ['grua', 'flete'],
    delivery: ['delivery'],
    moto: ['moto'],
    taxi: ['taxi', 'auto'],
    auto: ['auto', 'taxi'],
};

export function resolveConfiguredServicePct(serviceKeyOrBucket, commissionConfig = {}) {
    const platformPct = Number.isFinite(Number(commissionConfig.platformPct))
        ? Number(commissionConfig.platformPct)
        : 18;
    const byService = (commissionConfig.byService && typeof commissionConfig.byService === 'object')
        ? commissionConfig.byService
        : {};

    const def = SERVICE_BREAKDOWN_DEFS.find((d) => d.key === serviceKeyOrBucket);
    const chain = def
        ? def.configKeys
        : (SERVICE_FALLBACK_CHAIN[serviceKeyOrBucket] || [serviceKeyOrBucket]);

    for (const k of chain) {
        const raw = byService[k];
        const v = raw != null && raw !== '' ? Number(raw) : NaN;
        if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
    }
    return platformPct;
}

export function resolveTripCommissionRate(t, commissionConfig = {}) {
    if (!t || typeof t !== 'object') return resolveConfiguredServicePct('auto', commissionConfig);
    if (
        t.commissionWaivedBirthday
        || t.birthdayFree
        || t.paymentMethod === 'birthday_gift'
        || t.commissionFreeDay === true
        || t.commissionWaivedPromo === 'free_day_rotation'
    ) {
        return 0;
    }
    if (t.serverCommissionPercent != null && t.serverCommissionPercent !== '') {
        const srv = Number(t.serverCommissionPercent);
        if (Number.isFinite(srv) && srv >= 0 && srv <= 100) return srv;
    }
    if (t.commissionPercent != null && t.commissionPercent !== '') {
        const stored = Number(t.commissionPercent);
        if (Number.isFinite(stored) && stored >= 0 && stored <= 100) return stored;
    }
    const rawKey = resolveRawServiceCommissionKey(t);
    return resolveConfiguredServicePct(rawKey, commissionConfig);
}

export function resolveTripCommissionAmount(t, commissionConfig = {}) {
    const price = parseNumericPrice(t);
    const pct = resolveTripCommissionRate(t, commissionConfig);
    if (pct === 0) return { price, pct: 0, amount: 0 };
    if (t?.serverCommissionAmount != null && Number.isFinite(Number(t.serverCommissionAmount)) && Number(t.serverCommissionAmount) >= 0) {
        return { price, pct, amount: round2(Number(t.serverCommissionAmount)) };
    }
    if (t?.commissionAmount != null && Number.isFinite(Number(t.commissionAmount)) && Number(t.commissionAmount) >= 0) {
        return { price, pct, amount: round2(Number(t.commissionAmount)) };
    }
    return { price, pct, amount: round2(price * (pct / 100)) };
}

export function computeGlobalStatsSnapshot({
    trips = [],
    storeOrders = [],
    deposits = [],
    users = [],
    commissionConfig = { platformPct: 18, byService: {} },
    filter = { period: 'today', city: 'all', from: '', to: '' },
    now = new Date(),
} = {}) {
    const refNow = now instanceof Date ? now : new Date(now || Date.now());
    const range = resolveStatsDateRange({
        period: filter.period || 'today',
        from: filter.from || '',
        to: filter.to || '',
        now: refNow,
    });
    const cityFilter = filter.city || 'all';

    const profilesById = {};
    for (const u of users || []) {
        const uid = u?.uid || u?.id;
        if (uid) profilesById[uid] = { uid, ...u };
    }

    let trashedExcludedCount = 0;
    const periodTrips = [];
    for (const rawTrip of trips || []) {
        if (!rawTrip || rawTrip.isDemandSimulation) continue;
        const createdMs = toMs(rawTrip.createdAt) || toMs(rawTrip.completedAt);
        const inRange = createdMs >= range.startMs && createdMs <= range.endMs;
        const inCity = matchesCityFilter(rawTrip, cityFilter, profilesById);
        if (isTripTrashed(rawTrip)) {
            if (inRange && inCity) trashedExcludedCount++;
            continue;
        }
        if (!inRange || !inCity) continue;
        periodTrips.push(rawTrip);
    }

    let funnelRequested = 0;
    let funnelCompleted = 0;
    let funnelInProgress = 0;
    let funnelCancelled = 0;
    let funnelCancelledNoDriver = 0;

    for (const t of periodTrips) {
        funnelRequested++;
        const st = String(t.status || 'pending').toLowerCase();
        if (st === 'completed') {
            funnelCompleted++;
        } else if (st === 'cancelled' || st === 'canceled' || st === 'rejected' || st === 'expired' || st === 'no_driver') {
            funnelCancelled++;
            if (!t.driverId && !toMs(t.acceptedAt)) funnelCancelledNoDriver++;
        } else {
            funnelInProgress++;
        }
    }

    const conversionPct = funnelRequested > 0 ? round2((funnelCompleted / funnelRequested) * 100) : 0;
    const inProgressPct = funnelRequested > 0 ? round2((funnelInProgress / funnelRequested) * 100) : 0;
    const cancelledPct = funnelRequested > 0 ? round2((funnelCancelled / funnelRequested) * 100) : 0;

    const bucketsMap = new Map();
    for (const def of SERVICE_BREAKDOWN_DEFS) {
        bucketsMap.set(def.key, {
            ...def,
            requested: 0,
            trips: 0,
            revenue: 0,
            commission: 0,
            configuredPct: resolveConfiguredServicePct(def.key, commissionConfig),
            effectivePct: resolveConfiguredServicePct(def.key, commissionConfig),
            pctWeightedSum: 0,
            sharePct: 0,
        });
    }

    let totalTrips = 0;
    let totalEarned = 0;
    let cashEarned = 0;
    let saldoEarned = 0;
    let cashTrips = 0;
    let saldoTrips = 0;
    let cashCommissionSum = 0;
    let saldoCommissionSum = 0;
    const driverStats = {};
    const tripRows = [];

    for (const t of periodTrips) {
        const bucketKey = classifyTripServiceBucket(t);
        const bucket = bucketsMap.get(bucketKey) || bucketsMap.get('auto_taxi');
        bucket.requested++;

        if (t.status !== 'completed') continue;

        const { price, pct, amount: commAmount } = resolveTripCommissionAmount(t, commissionConfig);
        const tripMs = toMs(t.createdAt) || toMs(t.completedAt) || refNow.getTime();
        const tripDate = new Date(tripMs);
        const completedMs = toMs(t.completedAt);
        const startedMs = toMs(t.startedAt);
        const durationMin = (completedMs && startedMs && completedMs > startedMs)
            ? Math.max(1, Math.round((completedMs - startedMs) / 60000))
            : null;
        const cityInfo = resolveItemCity(t, profilesById);

        totalTrips++;
        totalEarned = round2(totalEarned + price);

        bucket.trips++;
        bucket.revenue = round2(bucket.revenue + price);
        bucket.commission = round2(bucket.commission + commAmount);
        bucket.pctWeightedSum += price > 0 ? (pct * price) : pct;

        if (t.paymentMethod === 'saldo') {
            saldoEarned = round2(saldoEarned + price);
            saldoTrips++;
            saldoCommissionSum += commAmount;
        } else {
            cashEarned = round2(cashEarned + price);
            cashTrips++;
            cashCommissionSum += commAmount;
        }

        const driverKey = t.driverId || 'sin-conductor';
        if (!driverStats[driverKey]) {
            driverStats[driverKey] = {
                uid: driverKey,
                name: t.driverName || profilesById[driverKey]?.name || 'Sin conductor',
                trips: 0,
                earned: 0,
                commission: 0,
            };
        }
        driverStats[driverKey].trips++;
        driverStats[driverKey].earned = round2(driverStats[driverKey].earned + price);
        driverStats[driverKey].commission = round2(driverStats[driverKey].commission + commAmount);

        tripRows.push({
            id: t.id || '',
            date: tripDate,
            dateMs: tripMs,
            serviceKey: bucket.key,
            serviceLabel: bucket.label,
            cityId: cityInfo.cityId,
            cityName: cityInfo.cityName,
            driverName: t.driverName || '—',
            clientName: t.clientName || t.recipientName || '—',
            origin: t.origin || '—',
            destination: t.destination || '—',
            price,
            commissionPct: pct,
            commissionAmount: commAmount,
            payment: t.paymentMethod === 'saldo' ? 'Saldo' : 'Efectivo',
            durationMin,
            timeLabel: tripDate.toLocaleString('es-HN', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
            }),
        });
    }

    tripRows.sort((a, b) => b.dateMs - a.dateMs);

    const serviceBreakdown = SERVICE_BREAKDOWN_DEFS.map((def) => {
        const b = bucketsMap.get(def.key);
        const effectivePct = b.revenue > 0
            ? round2((b.commission / b.revenue) * 100)
            : b.configuredPct;
        const sharePct = totalEarned > 0 ? round2((b.revenue / totalEarned) * 100) : 0;
        return {
            key: b.key,
            label: b.label,
            subtitle: b.subtitle,
            icon: b.icon,
            badgeClass: b.badgeClass,
            barClass: b.barClass,
            requested: b.requested,
            trips: b.trips,
            revenue: b.revenue,
            configuredPct: b.configuredPct,
            effectivePct,
            commission: b.commission,
            sharePct,
        };
    });

    const cashCommission = round2(cashCommissionSum);
    const saldoCommission = round2(saldoCommissionSum);
    const commissionGenerated = round2(cashCommission + saldoCommission);

    let storeTotalOrders = 0;
    let storeDeliveredOrders = 0;
    let storeActiveOrders = 0;
    let storeCancelledOrders = 0;
    let storeItemsSoldTotal = 0;
    let storeDeliveryFeesTotal = 0;
    let storeCommissionTotal = 0;
    const storesMap = new Map();
    const orderRows = [];

    const configuredStoreCommPct = Number.isFinite(Number(commissionConfig?.byService?.store_products))
        ? Number(commissionConfig.byService.store_products)
        : DEFAULT_STORE_COMMISSION_PCT;

    const tripByIdForStore = new Map();
    const tripByOrderIdForStore = new Map();
    for (const t of trips || []) {
        if (!t || t.isDemandSimulation) continue;
        if (t.id) tripByIdForStore.set(t.id, t);
        const oid = t.storeOrderId || t.deliveryDetails?.storeOrderId || '';
        if (oid && !tripByOrderIdForStore.has(oid)) tripByOrderIdForStore.set(oid, t);
    }

    const reconciledStoreOrders = [];
    const coveredTripIdsForStore = new Set();
    const seenStoreOrderIds = new Set();

    for (const rawOrder of storeOrders || []) {
        if (!rawOrder) continue;
        if (rawOrder.id) seenStoreOrderIds.add(rawOrder.id);
        const linkedTrip = (rawOrder.tripId && tripByIdForStore.get(rawOrder.tripId))
            || (rawOrder.id && tripByOrderIdForStore.get(rawOrder.id))
            || null;
        if (linkedTrip?.id) coveredTripIdsForStore.add(linkedTrip.id);

        let syncedStatus = String(rawOrder.status || 'pending').toLowerCase();
        if (linkedTrip) {
            const tSt = String(linkedTrip.status || '').toLowerCase();
            if (tSt === 'completed') {
                syncedStatus = 'delivered';
            } else if ((tSt === 'cancelled' || tSt === 'canceled' || tSt === 'expired' || tSt === 'rejected') && syncedStatus !== 'delivered') {
                syncedStatus = 'cancelled';
            } else if (tSt === 'in_progress' && syncedStatus !== 'delivered' && syncedStatus !== 'cancelled') {
                syncedStatus = 'out_for_delivery';
            }
        }
        const syncedDeliveryFee = Number(rawOrder.deliveryFee) > 0
            ? Number(rawOrder.deliveryFee)
            : (linkedTrip ? parseNumericPrice(linkedTrip) : 0);

        reconciledStoreOrders.push({
            ...rawOrder,
            status: syncedStatus,
            deliveryFee: syncedDeliveryFee,
            trashedAtMs: rawOrder.trashedAtMs || (isTripTrashed(linkedTrip) ? (linkedTrip.trashedAtMs || 1) : 0),
        });
    }

    for (const t of trips || []) {
        if (!t || t.isDemandSimulation || !isStoreDeliveryTrip(t)) continue;
        const oid = t.storeOrderId || t.deliveryDetails?.storeOrderId || '';
        if ((t.id && coveredTripIdsForStore.has(t.id)) || (oid && seenStoreOrderIds.has(oid))) continue;
        if (t.id) coveredTripIdsForStore.add(t.id);

        const d = t.deliveryDetails || {};
        const rawSt = String(t.status || 'pending').toLowerCase();
        const synthStatus = rawSt === 'completed'
            ? 'delivered'
            : (rawSt === 'cancelled' || rawSt === 'canceled' || rawSt === 'rejected' || rawSt === 'expired' || rawSt === 'no_driver'
                ? 'cancelled'
                : (rawSt === 'in_progress' ? 'out_for_delivery' : 'ready'));
        const synthStoreName = t.storeName || d.storeName || d.restaurant || t.merchantName || t.originPlaceName || t.clientName || t.origin || 'Tienda';
        const synthStoreId = t.storeId || d.storeId || t.merchantId || synthStoreName || 'tienda';
        const synthClientName = d.recipientName || t.recipientName || (t.clientName && t.clientName !== synthStoreName ? t.clientName : '') || t.destination || 'Cliente';
        const synthItemsTotal = round2(Number(d.itemsTotal ?? d.productCharge ?? d.collectAmount ?? d.collectFromCustomer ?? t.itemsTotal ?? 0) || 0);
        const synthDeliveryFee = round2(Number(d.deliveryFee ?? t.deliveryFee ?? parseNumericPrice(t)) || 0);

        reconciledStoreOrders.push({
            id: oid || t.id || '',
            tripId: t.id || '',
            fromTripOnly: true,
            storeId: synthStoreId,
            storeName: synthStoreName,
            clientName: synthClientName,
            recipientName: synthClientName,
            cityId: t.cityId || t.serviceZoneId || d.cityId || '',
            cityName: t.cityName || t.serviceZoneName || d.cityName || '',
            serviceZoneId: t.serviceZoneId || t.cityId || '',
            serviceZoneName: t.serviceZoneName || t.cityName || '',
            deliveryZoneName: t.deliveryZoneName || d.deliveryZoneName || t.serviceZoneName || t.cityName || '',
            origin: t.origin || '',
            destination: t.destination || '',
            deliveryAddress: d.address || t.destination || '',
            driverId: t.driverId || '',
            status: synthStatus,
            itemsTotal: synthItemsTotal,
            deliveryFee: synthDeliveryFee,
            commissionPercent: t.serverCommissionPercent ?? t.commissionPercent ?? null,
            paymentMethod: t.paymentMethod || 'efectivo',
            createdAt: t.createdAt || t.completedAt || t.updatedAt || null,
            updatedAt: t.updatedAt || t.completedAt || null,
            trashedAt: t.trashedAt || null,
            trashedAtMs: t.trashedAtMs || 0,
            deletedAt: t.deletedAt || null,
        });
    }

    for (const o of reconciledStoreOrders) {
        if (!o || isTripTrashed(o)) continue;
        const createdMs = toMs(o.createdAt) || toMs(o.updatedAt);
        if (createdMs < range.startMs || createdMs > range.endMs) continue;
        if (!matchesCityFilter(o, cityFilter, profilesById)) continue;

        storeTotalOrders++;
        const st = String(o.status || 'pending').toLowerCase();
        const itemsAmt = round2(Number(o.itemsTotal) || 0);
        const deliveryFeeAmt = round2(Number(o.deliveryFee) || 0);
        const orderCommPct = (o.commissionPercent != null && Number.isFinite(Number(o.commissionPercent)))
            ? Number(o.commissionPercent)
            : (o.weeklyCommissionRate != null && Number.isFinite(Number(o.weeklyCommissionRate))
                ? round2(Number(o.weeklyCommissionRate) * 100)
                : configuredStoreCommPct);
        const commBaseAmt = itemsAmt > 0 ? itemsAmt : (o.fromTripOnly ? deliveryFeeAmt : 0);
        const orderCommAmt = st === 'delivered'
            ? round2(commBaseAmt * (orderCommPct / 100))
            : 0;

        if (st === 'delivered') {
            storeDeliveredOrders++;
            storeItemsSoldTotal = round2(storeItemsSoldTotal + itemsAmt);
            storeDeliveryFeesTotal = round2(storeDeliveryFeesTotal + deliveryFeeAmt);
            storeCommissionTotal = round2(storeCommissionTotal + orderCommAmt);
        } else if (st === 'cancelled' || st === 'canceled') {
            storeCancelledOrders++;
        } else {
            storeActiveOrders++;
        }

        const sKey = normalizeCitySlug(o.storeName || '') || o.storeId || 'tienda';
        const sRow = storesMap.get(sKey) || {
            storeId: o.storeId || sKey,
            storeName: o.storeName || 'Tienda',
            orders: 0,
            delivered: 0,
            cancelled: 0,
            itemsSold: 0,
            deliveryFees: 0,
            commission: 0,
        };
        sRow.orders++;
        if (st === 'delivered') {
            sRow.delivered++;
            sRow.itemsSold = round2(sRow.itemsSold + itemsAmt);
            sRow.deliveryFees = round2(sRow.deliveryFees + deliveryFeeAmt);
            sRow.commission = round2(sRow.commission + orderCommAmt);
        } else if (st === 'cancelled' || st === 'canceled') {
            sRow.cancelled++;
        }
        storesMap.set(sKey, sRow);

        const cityInfo = resolveItemCity(o, profilesById);
        orderRows.push({
            id: o.id || '',
            dateMs: createdMs,
            timeLabel: createdMs
                ? new Date(createdMs).toLocaleString('es-HN', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                })
                : '—',
            storeName: o.storeName || 'Tienda',
            clientName: o.clientName || o.recipientName || 'Cliente',
            cityName: cityInfo.cityName,
            zoneName: o.deliveryZoneName || cityInfo.cityName,
            status: st,
            itemsTotal: itemsAmt,
            deliveryFee: deliveryFeeAmt,
            totalOrder: round2(itemsAmt + deliveryFeeAmt),
            commissionPct: orderCommPct,
            commissionAmount: orderCommAmt,
            paymentMethod: o.paymentMethod === 'saldo' ? 'Saldo' : 'Efectivo',
        });
    }

    orderRows.sort((a, b) => b.dateMs - a.dateMs);
    const byStore = [...storesMap.values()].sort((a, b) => (b.itemsSold + b.deliveryFees) - (a.itemsSold + a.deliveryFees) || b.orders - a.orders);

    let depositsApprovedAmount = 0;
    let depositsApprovedCount = 0;

    for (const dep of deposits || []) {
        if (!dep || dep.status !== 'approved') continue;
        const depMs = toMs(dep.createdAt) || toMs(dep.approvedAt);
        if (depMs < range.startMs || depMs > range.endMs) continue;
        if (!matchesCityFilter(dep, cityFilter, profilesById)) continue;
        const amt = Number(dep.amount) || 0;
        if (amt > 0) {
            depositsApprovedAmount = round2(depositsApprovedAmount + amt);
            depositsApprovedCount++;
        }
    }

    const depositLookback = new Date(refNow.getTime());
    depositLookback.setDate(depositLookback.getDate() - 7);
    depositLookback.setHours(0, 0, 0, 0);
    const depositSinceMs = Math.min(range.startMs, depositLookback.getTime());
    const todayStart = new Date(refNow.getTime());
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    const cashByDriver = {};
    const saldoCoveredByDriver = {};

    for (const t of trips || []) {
        if (!t || t.isDemandSimulation || isTripTrashed(t)) continue;
        if (t.status !== 'completed' || !t.driverId) continue;
        if (!matchesCityFilter(t, cityFilter, profilesById)) continue;
        const tripMs = toMs(t.completedAt) || toMs(t.createdAt);
        if (!tripMs || tripMs < depositSinceMs) continue;

        const id = t.driverId;
        const { price, amount: comm } = resolveTripCommissionAmount(t, commissionConfig);
        if (t.paymentMethod === 'saldo' || t.paymentMethod === 'birthday_gift' || t.birthdayFree) {
            saldoCoveredByDriver[id] = round2((saldoCoveredByDriver[id] || 0) + comm);
            continue;
        }
        if (t.commissionWaivedBirthday) continue;

        if (!cashByDriver[id]) {
            cashByDriver[id] = {
                oldestMs: tripMs,
                newestMs: tripMs,
                name: t.driverName || profilesById[id]?.name || 'Conductor',
                trips: 0,
                cashGross: 0,
                commissionDue: 0,
                commissionDueToday: 0,
            };
        }
        const row = cashByDriver[id];
        row.oldestMs = Math.min(row.oldestMs, tripMs);
        row.newestMs = Math.max(row.newestMs, tripMs);
        row.trips += 1;
        row.cashGross = round2(row.cashGross + price);
        row.commissionDue = round2(row.commissionDue + comm);
        if (tripMs >= todayStartMs) {
            row.commissionDueToday = round2(row.commissionDueToday + comm);
        }
        if (t.driverName) row.name = t.driverName;
    }

    const depositsByDriverLookback = {};
    const depositsTodayByDriver = {};
    for (const dep of deposits || []) {
        if (!dep || dep.status !== 'approved' || !dep.driverId) continue;
        const depMs = toMs(dep.createdAt) || toMs(dep.approvedAt);
        if (depMs && depMs < depositSinceMs) continue;
        const amt = Number(dep.amount) || 0;
        depositsByDriverLookback[dep.driverId] = round2((depositsByDriverLookback[dep.driverId] || 0) + amt);
        if (depMs && depMs >= todayStartMs) {
            depositsTodayByDriver[dep.driverId] = round2((depositsTodayByDriver[dep.driverId] || 0) + amt);
        }
    }

    const debtByDriver = {};
    for (const [id, u] of Object.entries(profilesById)) {
        const role = String(u.role || '').toLowerCase();
        if (role && role !== 'driver' && role !== 'conductor') continue;
        if (!matchesCityFilter(u, cityFilter, profilesById)) continue;
        const d = Math.max(
            0,
            parseFloat(u.pendingDepositDebt) || 0,
            parseFloat(u.driverLastDepositOwed) || 0
        );
        if (d > 0.009 || u.depositAutoBlocked) {
            debtByDriver[id] = Math.max(debtByDriver[id] || 0, d);
        }
    }

    const formatElapsedSince = (fromMs) => {
        if (!fromMs || !Number.isFinite(fromMs)) return '—';
        const sec = Math.max(0, Math.floor((refNow.getTime() - fromMs) / 1000));
        if (sec < 60) return `${sec} s`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} min`;
        const h = Math.floor(min / 60);
        if (h < 48) {
            const m = min % 60;
            return m ? `${h} h ${m} min` : `${h} h`;
        }
        const d = Math.floor(h / 24);
        const rh = h % 24;
        return rh ? `${d} d ${rh} h` : `${d} d`;
    };

    const owingDrivers = [];
    const candidateIds = new Set([
        ...Object.keys(cashByDriver),
        ...Object.keys(debtByDriver),
        ...Object.keys(driverStats).filter((k) => k !== 'sin-conductor'),
    ]);

    for (const driverId of candidateIds) {
        if (!driverId || driverId === 'sin-conductor') continue;
        const cash = cashByDriver[driverId] || {
            oldestMs: 0,
            newestMs: 0,
            name: 'Conductor',
            trips: 0,
            cashGross: 0,
            commissionDue: 0,
            commissionDueToday: 0,
        };
        const deposited = Math.max(0, Number(depositsByDriverLookback[driverId]) || 0);
        const depositedToday = Math.max(0, Number(depositsTodayByDriver[driverId]) || 0);
        const saldoCovered = Math.max(0, Number(saldoCoveredByDriver[driverId]) || 0);
        const commissionDue = round2(cash.commissionDue || 0);
        const gapFromTrips = Math.max(0, round2(commissionDue - saldoCovered - deposited));
        const remainingToday = Math.max(0, round2((cash.commissionDueToday || 0) - depositedToday));
        const profile = profilesById[driverId] || {};
        const debt = Math.max(
            0,
            Number(debtByDriver[driverId]) || 0,
            parseFloat(profile.pendingDepositDebt) || 0,
            parseFloat(profile.driverLastDepositOwed) || 0
        );
        const totalOwed = round2(Math.max(debt + remainingToday, gapFromTrips, debt, remainingToday));
        if (totalOwed < 0.01) continue;

        const sinceMs = cash.oldestMs || 0;
        const overdue = Boolean(profile.depositAutoBlocked)
            || (sinceMs > 0 && (refNow.getTime() - sinceMs) >= 36 * 3600 * 1000);

        owingDrivers.push({
            uid: driverId,
            name: cash.name || profile.name || driverStats[driverId]?.name || 'Conductor',
            phone: profile.phone || '',
            totalOwed,
            remainingToday,
            debt: round2(debt),
            gapFromTrips,
            commissionDue,
            deposited: round2(deposited),
            sinceMs,
            sinceLabel: formatElapsedSince(sinceMs),
            newestLabel: cash.newestMs ? formatElapsedSince(cash.newestMs) : '—',
            cashTripsPeriod: cash.trips || 0,
            deadlineLabel: '12:00 p.m.',
            graceOn: false,
            overdue,
        });
    }

    owingDrivers.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        return b.totalOwed - a.totalOwed;
    });

    const commissionPendingPeriod = Math.max(0, round2(cashCommission - depositsApprovedAmount));
    const owingDriversTotal = round2(owingDrivers.reduce((acc, d) => acc + d.totalOwed, 0));
    const commissionPendingStreet = round2(Math.max(commissionPendingPeriod, owingDriversTotal));

    const driverSummaryList = Object.values(driverStats).sort((a, b) => b.earned - a.earned);

    return {
        filter: {
            period: range.period,
            city: cityFilter,
            from: range.from,
            to: range.to,
            label: range.label,
            startMs: range.startMs,
            endMs: range.endMs,
        },
        commissionConfig: {
            platformPct: Number(commissionConfig.platformPct) || 18,
            byService: commissionConfig.byService || {},
        },
        trashedExcludedCount,
        funnel: {
            requested: funnelRequested,
            completed: funnelCompleted,
            inProgress: funnelInProgress,
            cancelled: funnelCancelled,
            cancelledNoDriver: funnelCancelledNoDriver,
            conversionPct,
            inProgressPct,
            cancelledPct,
        },
        financial: {
            totalTrips,
            totalEarned,
            cashEarned,
            cashTrips,
            saldoEarned,
            saldoTrips,
            commissionGenerated,
            cashCommission,
            saldoCommission,
            storeCommissionGenerated: storeCommissionTotal,
            totalCommissionWithStores: round2(commissionGenerated + storeCommissionTotal),
            depositsApprovedAmount,
            depositsApprovedCount,
            commissionCollectedInPeriod: round2(depositsApprovedAmount + saldoCommission),
            commissionPendingPeriod,
            commissionPendingStreet,
            owingDriversTotal,
        },
        serviceBreakdown,
        storeMetrics: {
            totalOrders: storeTotalOrders,
            deliveredOrders: storeDeliveredOrders,
            activeOrders: storeActiveOrders,
            cancelledOrders: storeCancelledOrders,
            conversionPct: storeTotalOrders > 0 ? round2((storeDeliveredOrders / storeTotalOrders) * 100) : 0,
            itemsSoldTotal: storeItemsSoldTotal,
            deliveryFeesTotal: storeDeliveryFeesTotal,
            grossMerchandiseTotal: round2(storeItemsSoldTotal + storeDeliveryFeesTotal),
            storeCommissionPct: configuredStoreCommPct,
            storeCommissionTotal,
            byStore,
            orderRows,
        },
        driverSummary: driverSummaryList,
        tripRows,
        owingDrivers,
    };
}

function csvEscape(val) {
    const s = String(val ?? '');
    if (/[",\n\r;]/.test(s) || /^[=+\-@]/.test(s)) {
        const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return s;
}

export function buildGlobalStatsCsv(snapshot) {
    if (!snapshot) return '\ufeff';
    const { filter, financial, funnel, serviceBreakdown, storeMetrics, tripRows, trashedExcludedCount } = snapshot;
    const lines = [];
    const addRow = (cols) => lines.push(cols.map(csvEscape).join(','));

    addRow(['REPORTE DE ESTADÍSTICAS GLOBALES - HONDURAITE']);
    addRow(['Período', filter.label, 'Ciudad/Zona', filter.city === 'all' ? 'Todas las ciudades' : filter.city, 'Viajes en papelera excluidos', trashedExcludedCount]);
    addRow([]);

    addRow(['1. RESUMEN FINANCIERO Y COMISIONES']);
    addRow(['Métrica', 'Valor (L.)', 'Detalle']);
    addRow(['Viajes completados', financial.totalTrips, `Efectivo: ${financial.cashTrips} | Saldo: ${financial.saldoTrips}`]);
    addRow(['Facturación bruta viajes (L.)', financial.totalEarned.toFixed(2), `Efectivo: L. ${financial.cashEarned.toFixed(2)} | Saldo: L. ${financial.saldoEarned.toFixed(2)}`]);
    addRow(['Comisión generada viajes (L.)', financial.commissionGenerated.toFixed(2), `Efectivo: L. ${financial.cashCommission.toFixed(2)} | Saldo: L. ${financial.saldoCommission.toFixed(2)}`]);
    addRow(['Comisión generada tiendas (L.)', financial.storeCommissionGenerated.toFixed(2), `Sobre L. ${storeMetrics.itemsSoldTotal.toFixed(2)} en productos entregados`]);
    addRow(['Comisión depositada (aprobada en período) (L.)', financial.depositsApprovedAmount.toFixed(2), `${financial.depositsApprovedCount} depósito(s) aprobado(s)`]);
    addRow(['Comisión pendiente del período (L.)', financial.commissionPendingPeriod.toFixed(2), 'Comisión efectivo del período menos depósitos aprobados']);
    addRow(['Comisión pendiente en la calle (total conductores) (L.)', financial.commissionPendingStreet.toFixed(2), `${snapshot.owingDrivers.length} conductor(es) con saldo pendiente`]);
    addRow([]);

    addRow(['2. EMBUDO DE VIAJES (FUNNEL)']);
    addRow(['Solicitados', 'Completados', '% Conversión', 'En curso', 'Cancelados / Sin conductor', 'Excluidos papelera']);
    addRow([funnel.requested, funnel.completed, `${funnel.conversionPct.toFixed(1)}%`, funnel.inProgress, funnel.cancelled, trashedExcludedCount]);
    addRow([]);

    addRow(['3. DESGLOSE POR SERVICIO Y COMISIÓN PROPIA']);
    addRow(['Servicio', 'Solicitados', 'Viajes completados', 'Monto facturado (L.)', '% Comisión aplicable', 'Comisión generada (L.)', '% Participación']);
    for (const s of serviceBreakdown) {
        addRow([
            s.label,
            s.requested,
            s.trips,
            s.revenue.toFixed(2),
            `${s.effectivePct}%`,
            s.commission.toFixed(2),
            `${s.sharePct}%`,
        ]);
    }
    addRow([]);

    addRow(['4. MÉTRICAS DE PEDIDOS DE TIENDAS (STORE_ORDERS)']);
    addRow(['Pedidos recibidos', 'Entregados', 'En curso', 'Cancelados', 'Total vendido productos (L.)', 'Total envíos comercios (L.)', 'Comisión tiendas (L.)']);
    addRow([
        storeMetrics.totalOrders,
        storeMetrics.deliveredOrders,
        storeMetrics.activeOrders,
        storeMetrics.cancelledOrders,
        storeMetrics.itemsSoldTotal.toFixed(2),
        storeMetrics.deliveryFeesTotal.toFixed(2),
        storeMetrics.storeCommissionTotal.toFixed(2),
    ]);
    addRow([]);

    addRow(['5. DETALLE DE VIAJES COMPLETADOS']);
    addRow(['ID', 'Fecha/Hora', 'Servicio', 'Ciudad', 'Conductor', 'Pasajero', 'Origen', 'Destino', 'Pago', 'Monto (L.)', '% Comisión', 'Comisión (L.)']);
    for (const r of tripRows) {
        addRow([
            r.id,
            r.timeLabel,
            r.serviceLabel,
            r.cityName,
            r.driverName,
            r.clientName,
            r.origin,
            r.destination,
            r.payment,
            r.price.toFixed(2),
            `${r.commissionPct}%`,
            r.commissionAmount.toFixed(2),
        ]);
    }
    addRow([]);

    addRow(['6. DETALLE DE PEDIDOS DE TIENDAS']);
    addRow(['ID Pedido', 'Fecha/Hora', 'Tienda', 'Cliente', 'Ciudad/Zona', 'Estado', 'Productos (L.)', 'Envío (L.)', 'Total (L.)', '% Comisión Tienda', 'Comisión Tienda (L.)', 'Pago']);
    for (const o of storeMetrics.orderRows) {
        addRow([
            o.id,
            o.timeLabel,
            o.storeName,
            o.clientName,
            o.zoneName,
            o.status,
            o.itemsTotal.toFixed(2),
            o.deliveryFee.toFixed(2),
            o.totalOrder.toFixed(2),
            `${o.commissionPct}%`,
            o.commissionAmount.toFixed(2),
            o.paymentMethod,
        ]);
    }

    return '\ufeff' + lines.join('\r\n');
}

export function buildStatsFiltersToolbarHtml(currentFilter = {}) {
    const city = currentFilter.city || 'all';
    const from = currentFilter.from || '';
    const to = currentFilter.to || '';
    const cities = getCityCatalog();
    const cityOptions = [
        `<option value="all" ${city === 'all' ? 'selected' : ''}>🌎 Todas las ciudades</option>`,
        ...cities.map((c) => `<option value="${escHtml(c.id)}" ${city === c.id ? 'selected' : ''}>📍 ${escHtml(c.name)}</option>`),
    ].join('');

    return `
        <div id="global-stats-advanced-filters" class="bg-slate-900/90 border border-slate-700/70 rounded-2xl p-3 mb-3 flex flex-wrap items-end gap-2.5 text-xs">
            <div class="flex-1 min-w-[160px]">
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-1" for="stats-city-filter">Ciudad / Zona</label>
                <select id="stats-city-filter" onchange="window.applyGlobalStatsFilter()" class="ops-input w-full text-xs py-1.5 px-2.5 rounded-xl bg-slate-800 border border-slate-600 text-white font-bold">
                    ${cityOptions}
                </select>
            </div>
            <div class="min-w-[135px]">
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-1" for="stats-date-from">Desde</label>
                <input id="stats-date-from" type="date" value="${escHtml(from)}" onchange="window.applyGlobalStatsDateRange()" class="ops-input w-full text-xs py-1.5 px-2.5 rounded-xl bg-slate-800 border border-slate-600 text-white font-bold">
            </div>
            <div class="min-w-[135px]">
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-1" for="stats-date-to">Hasta</label>
                <input id="stats-date-to" type="date" value="${escHtml(to)}" onchange="window.applyGlobalStatsDateRange()" class="ops-input w-full text-xs py-1.5 px-2.5 rounded-xl bg-slate-800 border border-slate-600 text-white font-bold">
            </div>
            <div class="flex items-center gap-2">
                <button type="button" onclick="window.applyGlobalStatsDateRange()" class="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs">
                    <i class="fas fa-filter"></i> Filtrar rango
                </button>
                <button type="button" onclick="window.exportGlobalStatsCsv()" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs">
                    📥 Exportar CSV
                </button>
            </div>
        </div>
    `;
}

export function renderGlobalStatsHtml(snapshot) {
    const {
        filter,
        commissionConfig,
        trashedExcludedCount,
        funnel,
        financial,
        serviceBreakdown,
        storeMetrics,
        driverSummary,
        tripRows,
        owingDrivers,
    } = snapshot;

    const cityLabel = filter.city && filter.city !== 'all'
        ? (CITY_BY_ID.get(filter.city)?.name || filter.city)
        : 'Todas las ciudades';

    const serviceRowsHtml = serviceBreakdown.map((s) => `
        <tr class="border-b border-slate-800/80 hover:bg-slate-800/40 transition">
            <td class="py-2.5 px-3">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl border ${s.badgeClass} flex items-center justify-center shrink-0">
                        <i class="fas ${s.icon} text-xs"></i>
                    </span>
                    <div>
                        <p class="font-black text-white text-xs leading-tight">${escHtml(s.label)}</p>
                        <p class="text-[10px] text-slate-400">${escHtml(s.subtitle)}</p>
                    </div>
                </div>
            </td>
            <td class="py-2.5 px-2 text-center">
                <span class="font-black text-white text-xs">${s.trips}</span>
                <span class="block text-[10px] text-slate-400">de ${s.requested} sol.</span>
            </td>
            <td class="py-2.5 px-2 text-right font-bold text-slate-200 text-xs">
                ${formatLempiras(s.revenue)}
                <span class="block text-[10px] text-slate-500">${s.sharePct}% del total</span>
            </td>
            <td class="py-2.5 px-2 text-center">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-black border ${s.badgeClass}">
                    ${s.effectivePct}%
                </span>
                ${s.effectivePct !== s.configuredPct ? `<span class="block text-[9px] text-slate-400 mt-0.5">Regla: ${s.configuredPct}%</span>` : ''}
            </td>
            <td class="py-2.5 px-3 text-right font-black text-amber-300 text-xs">
                ${formatLempiras(s.commission)}
            </td>
        </tr>
    `).join('');

    const topStoresHtml = storeMetrics.byStore.length
        ? storeMetrics.byStore.slice(0, 6).map((st) => `
            <div class="flex justify-between items-center bg-slate-800/70 border border-slate-700/60 rounded-xl px-3 py-2 text-xs">
                <div class="min-w-0">
                    <p class="font-black text-white truncate">${escHtml(st.storeName)}</p>
                    <p class="text-[10px] text-slate-400">
                        ${st.delivered} entregados · ${st.cancelled} cancelados (de ${st.orders})
                    </p>
                </div>
                <div class="text-right shrink-0">
                    <p class="font-black text-emerald-300">${formatLempiras(st.itemsSold)} <span class="text-[10px] text-slate-400">prod.</span></p>
                    <p class="text-[10px] text-amber-300 font-bold">Envíos: ${formatLempiras(st.deliveryFees)} · Com: ${formatLempiras(st.commission)}</p>
                </div>
            </div>
        `).join('')
        : '<p class="text-slate-500 text-xs py-2 text-center">Sin pedidos de tiendas en este período y ciudad.</p>';

    const owingHtml = owingDrivers.length
        ? owingDrivers.map((d) => {
            const safeName = String(d.name || 'Conductor').replace(/'/g, "\\'");
            const border = d.overdue ? 'border-rose-500/50 bg-rose-950/40' : 'border-amber-600/40 bg-amber-950/30';
            return `
            <div class="rounded-xl border ${border} p-3 text-[11px] space-y-1.5">
                <div class="flex justify-between gap-2 items-start">
                    <div class="min-w-0">
                        <p class="font-black text-white truncate">${escHtml(d.name || '')}</p>
                        <p class="text-[10px] font-bold ${d.overdue ? 'text-rose-300' : 'text-amber-200'}">
                            ${d.overdue ? '⚠ PLAZO VENCIDO' : 'Pendiente de depósito'}
                            ${d.graceOn ? ' · prórroga activa' : ''}
                        </p>
                    </div>
                    <p class="font-black text-amber-300 shrink-0">${formatLempiras(d.totalOwed)}</p>
                </div>
                <p class="text-slate-300 font-bold leading-snug">
                    Sin depositar desde el 1.er viaje en efectivo:
                    <b class="text-white">hace ${escHtml(d.sinceLabel)}</b>
                    ${d.cashTripsPeriod ? ` · ${d.cashTripsPeriod} viaje(s) efectivo (últ. 7 d)` : ''}
                </p>
                <p class="text-slate-400 font-bold text-[10px] leading-snug">
                    Último viaje efectivo: hace ${escHtml(d.newestLabel)}<br>
                    Comisión debida ~${formatLempiras(Number(d.commissionDue || 0))}
                    · Depositado ${formatLempiras(Number(d.deposited || 0))}
                    · Deuda perfil ${formatLempiras(d.debt)}
                    · Hoy ${formatLempiras(d.remainingToday)}
                </p>
                <div class="flex flex-wrap gap-2 pt-1">
                    <button type="button"
                        onclick="window.sendDepositReminderToDriver('${escHtml(d.uid)}', '${safeName}', ${d.totalOwed.toFixed(2)}, '${escHtml(d.sinceLabel)}', ${d.overdue ? 'true' : 'false'})"
                        class="flex-1 min-w-[7rem] py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-black">
                        <i class="fas fa-bell"></i> Recordar depósito
                    </button>
                    <button type="button"
                        onclick="window.sendIndividualNotification('${escHtml(d.uid)}', '${safeName}', 'driver')"
                        class="flex-1 min-w-[7rem] py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-black">
                        Mensaje libre
                    </button>
                    <button type="button"
                        onclick="window.staffClearDriverPendingAccount('${escHtml(d.uid)}', '${safeName}', ${d.totalOwed.toFixed(2)})"
                        class="flex-1 min-w-[7rem] py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-[10px] font-black">
                        <i class="fas fa-trash-alt"></i> Borrar cuenta pendiente
                    </button>
                </div>
            </div>`;
        }).join('')
        : '<p class="text-emerald-400/90 text-xs font-bold py-2">Ningún conductor con hueco de depósito en los últimos 7 días ni deuda en perfil.</p>';

    const bulkBtn = owingDrivers.length
        ? `<button type="button" onclick="window.sendDepositReminderBulk()"
            class="w-full mb-3 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs font-black">
            <i class="fas fa-bullhorn"></i> Recordar a todos (${owingDrivers.length})
           </button>`
        : '';

    const driverSummaryHtml = driverSummary.length
        ? driverSummary.map((d) => `
            <div class="flex justify-between items-center bg-gray-800/80 rounded-xl px-3 py-2 text-xs">
                <span class="text-emerald-300 font-bold truncate max-w-[50%]">${escHtml(d.name)}</span>
                <span class="text-white font-black">${d.trips} viajes · ${formatLempiras(d.earned)} <span class="text-amber-300 text-[10px]">(Com. ${formatLempiras(d.commission)})</span></span>
            </div>
        `).join('')
        : '<p class="text-gray-500 text-xs">Sin viajes completados en este filtro</p>';

    const tripTableHtml = tripRows.slice(0, 40).map((r) => `
        <div class="bg-gray-800/60 rounded-xl p-3 text-[10px] space-y-1 border border-gray-700/50">
            <div class="flex justify-between gap-2 items-center">
                <span class="text-gray-400 font-bold">${escHtml(r.timeLabel)} · <b class="text-sky-300">${escHtml(r.serviceLabel)}</b> · ${escHtml(r.cityName)}</span>
                <span class="text-emerald-400 font-black">${formatLempiras(r.price)} · ${escHtml(r.payment)} <span class="text-amber-300">(Com. ${r.commissionPct}%: ${formatLempiras(r.commissionAmount)})</span></span>
            </div>
            <p><b class="text-blue-300">Pasajero:</b> ${escHtml(r.clientName)} · <b class="text-emerald-300">Conductor:</b> ${escHtml(r.driverName)}</p>
            <p class="text-gray-400 truncate">${escHtml(r.origin)} → ${escHtml(r.destination)}</p>
            ${r.durationMin ? `<p class="text-violet-300">Duración: ${r.durationMin} min</p>` : ''}
        </div>
    `).join('');

    const cPct = Math.max(0, Math.min(100, funnel.conversionPct));
    const pPct = Math.max(0, Math.min(100 - cPct, funnel.inProgressPct));
    const xPct = Math.max(0, Math.min(100 - cPct - pPct, funnel.cancelledPct));

    return buildStatsDashboardBody({
        filter,
        cityLabel,
        trashedExcludedCount,
        financial,
        funnel,
        commissionConfig,
        owingDrivers,
        cPct,
        pPct,
        xPct,
        serviceRowsHtml,
        storeMetrics,
        topStoresHtml,
        bulkBtn,
        owingHtml,
        driverSummary,
        driverSummaryHtml,
        tripRows,
        tripTableHtml,
    });
}

function buildStatsDashboardBody({
    filter,
    cityLabel,
    trashedExcludedCount,
    financial,
    funnel,
    commissionConfig,
    owingDrivers,
    cPct,
    pPct,
    xPct,
    serviceRowsHtml,
    storeMetrics,
    topStoresHtml,
    bulkBtn,
    owingHtml,
    driverSummary,
    driverSummaryHtml,
    tripRows,
    tripTableHtml,
}) {
    return `
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4 bg-slate-900/90 border border-slate-700/70 rounded-xl px-3.5 py-2.5 text-xs">
            <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-black">
                    <i class="fas fa-calendar-alt"></i> ${escHtml(filter.label)}
                </span>
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 font-black">
                    <i class="fas fa-map-marker-alt"></i> ${escHtml(cityLabel)}
                </span>
                ${trashedExcludedCount > 0 ? `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-600/60 text-slate-300 text-[11px] font-bold">
                    <i class="fas fa-trash-restore text-rose-400"></i> ${trashedExcludedCount} en papelera excluido(s)
                </span>` : `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800/80 text-slate-400 text-[10px] font-semibold">
                    <i class="fas fa-shield-alt text-emerald-400"></i> Papelera excluida
                </span>`}
            </div>
            <button type="button" onclick="window.exportGlobalStatsCsv()" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow">
                <i class="fas fa-file-csv"></i> 📥 Exportar CSV
            </button>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-4">
            <div class="bg-gray-800/90 border border-gray-700/60 p-3.5 rounded-2xl">
                <p class="text-[10px] font-black text-gray-400 uppercase tracking-wider">VIAJES COMPLETADOS</p>
                <p class="text-2xl sm:text-3xl font-black text-white mt-1">${financial.totalTrips}</p>
                <p class="text-[10px] text-emerald-400 font-bold mt-0.5">${funnel.conversionPct}% de ${funnel.requested} solicitados</p>
            </div>
            <div class="bg-gray-800/90 border border-gray-700/60 p-3.5 rounded-2xl">
                <p class="text-[10px] font-black text-gray-400 uppercase tracking-wider">FACTURADO VIAJES</p>
                <p class="text-xl sm:text-2xl font-black text-emerald-400 mt-1">${formatLempiras(financial.totalEarned)}</p>
                <p class="text-[10px] text-slate-400 font-bold mt-0.5">Efec: ${formatLempiras(financial.cashEarned)} · Saldo: ${formatLempiras(financial.saldoEarned)}</p>
            </div>
            <div class="bg-gray-800/90 border border-gray-700/60 p-3.5 rounded-2xl">
                <p class="text-[10px] font-black text-gray-400 uppercase tracking-wider">VENTAS TIENDAS</p>
                <p class="text-xl sm:text-2xl font-black text-cyan-300 mt-1">${formatLempiras(storeMetrics.itemsSoldTotal)}</p>
                <p class="text-[10px] text-slate-400 font-bold mt-0.5">${storeMetrics.deliveredOrders} entregados · Envíos ${formatLempiras(storeMetrics.deliveryFeesTotal)}</p>
            </div>
            <div class="bg-gray-800/90 border border-amber-500/40 p-3.5 rounded-2xl">
                <p class="text-[10px] font-black text-amber-300 uppercase tracking-wider">COMISIÓN TOTAL</p>
                <p class="text-xl sm:text-2xl font-black text-amber-400 mt-1">${formatLempiras(financial.totalCommissionWithStores)}</p>
                <p class="text-[10px] text-amber-200/80 font-bold mt-0.5">Viajes: ${formatLempiras(financial.commissionGenerated)} · Tiendas: ${formatLempiras(financial.storeCommissionGenerated)}</p>
            </div>
        </div>

        <div class="bg-slate-900/95 border border-amber-500/30 rounded-2xl p-4 mb-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-black text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                    <i class="fas fa-coins"></i> Balance de Comisiones (Generada vs. Depositada vs. Pendiente)
                </p>
                <span class="text-[10px] text-slate-400 font-bold">Base general: ${commissionConfig.platformPct}% · o % por servicio</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="rounded-xl bg-amber-950/30 border border-amber-500/40 p-3">
                    <p class="text-[10px] font-black text-amber-300 uppercase">1. Comisión generada (período)</p>
                    <p class="text-xl font-black text-white mt-1">${formatLempiras(financial.commissionGenerated)}</p>
                    <p class="text-[10px] text-slate-300 mt-1">
                        En efectivo: <b>${formatLempiras(financial.cashCommission)}</b> (${financial.cashTrips} v.)<br>
                        En saldo: <b>${formatLempiras(financial.saldoCommission)}</b> (${financial.saldoTrips} v.)
                    </p>
                </div>
                <div class="rounded-xl bg-emerald-950/30 border border-emerald-500/40 p-3">
                    <p class="text-[10px] font-black text-emerald-300 uppercase">2. Comisión depositada / cobrada</p>
                    <p class="text-xl font-black text-emerald-400 mt-1">${formatLempiras(financial.depositsApprovedAmount)}</p>
                    <p class="text-[10px] text-slate-300 mt-1">
                        <b>${financial.depositsApprovedCount}</b> depósito(s) bancario(s) aprobado(s)<br>
                        + Retenido en saldo: <b>${formatLempiras(financial.saldoCommission)}</b>
                    </p>
                </div>
                <div class="rounded-xl bg-rose-950/30 border border-rose-500/40 p-3">
                    <p class="text-[10px] font-black text-rose-300 uppercase">3. Pendiente en la calle (por cobrar)</p>
                    <p class="text-xl font-black text-rose-400 mt-1">${formatLempiras(financial.commissionPendingStreet)}</p>
                    <p class="text-[10px] text-slate-300 mt-1">
                        Del período (efectivo − dep.): <b>${formatLempiras(financial.commissionPendingPeriod)}</b><br>
                        Deuda activa conductores (${owingDrivers.length}): <b>${formatLempiras(financial.owingDriversTotal)}</b>
                    </p>
                </div>
            </div>
        </div>

        <div class="bg-slate-900/95 border border-slate-700/70 rounded-2xl p-4 mb-4">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p class="text-xs font-black text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                    <i class="fas fa-filter"></i> Embudo de Viajes del Período
                </p>
                <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-black">
                    Conversión: ${funnel.conversionPct}% completados
                </span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center mb-3">
                <div class="bg-slate-800/90 rounded-xl p-2.5 border border-slate-700/60">
                    <p class="text-[10px] text-slate-400 font-bold uppercase">Solicitados</p>
                    <p class="text-xl font-black text-white">${funnel.requested}</p>
                    <p class="text-[10px] text-slate-500">100% demanda real</p>
                </div>
                <div class="bg-emerald-950/30 rounded-xl p-2.5 border border-emerald-500/30">
                    <p class="text-[10px] text-emerald-300 font-bold uppercase">Completados</p>
                    <p class="text-xl font-black text-emerald-400">${funnel.completed}</p>
                    <p class="text-[10px] text-emerald-300/80 font-bold">${funnel.conversionPct}% efectividad</p>
                </div>
                <div class="bg-sky-950/30 rounded-xl p-2.5 border border-sky-500/30">
                    <p class="text-[10px] text-sky-300 font-bold uppercase">En curso / Espera</p>
                    <p class="text-xl font-black text-sky-400">${funnel.inProgress}</p>
                    <p class="text-[10px] text-sky-300/80">${funnel.inProgressPct}% del total</p>
                </div>
                <div class="bg-rose-950/30 rounded-xl p-2.5 border border-rose-500/30">
                    <p class="text-[10px] text-rose-300 font-bold uppercase">Cancelados / Sin cond.</p>
                    <p class="text-xl font-black text-rose-400">${funnel.cancelled}</p>
                    <p class="text-[10px] text-rose-300/80">${funnel.cancelledNoDriver} sin conductor (${funnel.cancelledPct}%)</p>
                </div>
            </div>
            <div class="w-full h-3 bg-slate-800 rounded-full overflow-hidden flex border border-slate-700/60">
                <div class="bg-emerald-500 h-full" style="width:${cPct}%"></div>
                <div class="bg-sky-500 h-full" style="width:${pPct}%"></div>
                <div class="bg-rose-500 h-full" style="width:${xPct}%"></div>
            </div>
        </div>

        <div class="bg-slate-900/95 border border-slate-700/70 rounded-2xl p-4 mb-4">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                    <p class="text-xs font-black text-violet-300 uppercase tracking-wider flex items-center gap-1.5">
                        <i class="fas fa-layer-group"></i> Desglose por Servicio y Comisión Propia
                    </p>
                    <p class="text-[10px] text-slate-400 font-semibold">
                        Cada servicio calcula su comisión según su tasa configurada o el % guardado en cada viaje.
                    </p>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-slate-700 text-[10px] font-black text-slate-400 uppercase">
                            <th class="py-2 px-3">Servicio</th>
                            <th class="py-2 px-2 text-center">Viajes</th>
                            <th class="py-2 px-2 text-right">Facturado</th>
                            <th class="py-2 px-2 text-center">% Comisión</th>
                            <th class="py-2 px-3 text-right">Comisión generada</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${serviceRowsHtml}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="bg-slate-900/95 border border-cyan-500/30 rounded-2xl p-4 mb-4">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                    <p class="text-xs font-black text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                        <i class="fas fa-store"></i> Pedidos de Tiendas y Restaurantes (store_orders)
                    </p>
                    <p class="text-[10px] text-slate-400 font-semibold">
                        Ventas de comercios, envíos generados y comisión de plataforma sobre productos entregados.
                    </p>
                </div>
                <span class="px-2.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-black">
                    ${storeMetrics.deliveredOrders} / ${storeMetrics.totalOrders} entregados (${storeMetrics.conversionPct}%)
                </span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center mb-3">
                <div class="bg-slate-800/80 rounded-xl p-2.5 border border-slate-700/60">
                    <p class="text-[10px] text-slate-400 font-bold uppercase">Recibidos / Activos</p>
                    <p class="text-lg font-black text-white">${storeMetrics.totalOrders} <span class="text-xs text-sky-300">(${storeMetrics.activeOrders} en curso)</span></p>
                    <p class="text-[10px] text-rose-300 font-bold">${storeMetrics.cancelledOrders} cancelados</p>
                </div>
                <div class="bg-emerald-950/30 rounded-xl p-2.5 border border-emerald-500/30">
                    <p class="text-[10px] text-emerald-300 font-bold uppercase">Vendido en Productos</p>
                    <p class="text-lg font-black text-emerald-400">${formatLempiras(storeMetrics.itemsSoldTotal)}</p>
                    <p class="text-[10px] text-slate-400">${storeMetrics.deliveredOrders} pedidos entregados</p>
                </div>
                <div class="bg-teal-950/30 rounded-xl p-2.5 border border-teal-500/30">
                    <p class="text-[10px] text-teal-300 font-bold uppercase">Envíos de Comercios</p>
                    <p class="text-lg font-black text-teal-300">${formatLempiras(storeMetrics.deliveryFeesTotal)}</p>
                    <p class="text-[10px] text-slate-400">GMV Total: ${formatLempiras(storeMetrics.grossMerchandiseTotal)}</p>
                </div>
                <div class="bg-amber-950/30 rounded-xl p-2.5 border border-amber-500/30">
                    <p class="text-[10px] text-amber-300 font-bold uppercase">Comisión Tiendas (${storeMetrics.storeCommissionPct}%)</p>
                    <p class="text-lg font-black text-amber-400">${formatLempiras(storeMetrics.storeCommissionTotal)}</p>
                    <p class="text-[10px] text-slate-400">Sobre productos entregados</p>
                </div>
            </div>
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Desempeño por comercio</p>
            <div class="space-y-1.5 max-h-48 overflow-y-auto">${topStoresHtml}</div>
        </div>

        <div class="bg-gray-900 border border-amber-700/40 rounded-2xl p-4 mb-4">
            <p class="text-[10px] font-black text-amber-300 uppercase tracking-widest mb-1">
                <i class="fas fa-piggy-bank"></i> Sin depositar · comisión en la calle (${owingDrivers.length})
            </p>
            <p class="text-[10px] text-slate-400 font-bold mb-3 leading-snug">
                Revisa <b>últimos 7 días</b> (excluyendo viajes en papelera): comisión en efectivo − depósitos aprobados + deuda en perfil.
                Usa <b>Borrar cuenta pendiente</b> si pagó en persona o condonas el monto (admin/supervisor).
            </p>
            ${bulkBtn}
            <div class="space-y-2 max-h-72 overflow-y-auto">${owingHtml}</div>
        </div>

        <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Por conductor (${driverSummary.length})</p>
        <div class="space-y-2 mb-4 max-h-44 overflow-y-auto">${driverSummaryHtml}</div>

        <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Detalle de viajes completados (${tripRows.length})</p>
        <div class="space-y-2 max-h-80 overflow-y-auto">${tripTableHtml || '<p class="text-gray-500 text-xs text-center py-4">No hay viajes completados en este período y ciudad</p>'}</div>
    `;
}
