/**
 * Comisión HonduRaite por viaje, calculada SOLO en el servidor al completar.
 *
 * Antes la calculaba y guardaba la app del conductor (commissionAmount / commissionPercent):
 * una app modificada podía guardar menos. Ahora este trigger escribe los campos server*
 * (las reglas impiden que la app los toque) y la deuda / «Hoy a dep.» del conductor usa estos.
 * Los campos viejos de la app quedan como vista previa / compatibilidad (viajes previos al deploy).
 *
 * % = platformConfig/main.commissionByService[clave] → (tiendas → delivery) → commissionPercentage.
 * Sin % configurado no se inventa ninguno: no escribe y la app sigue con su cálculo de antes.
 * 0% si: cumpleaños del conductor, día sin comisión rotativo (appSettings/main.commissionFreeDay)
 * o viaje regalo de cumpleaños del pasajero.
 * Base = precio del viaje (para tiendas/envío directo es SOLO el envío; los productos no cuentan).
 */
const freeDay = require('./commission-free-day');

const money = (v) => Math.round(Number(v) * 100) / 100;
const PARENT = { tiendas: 'delivery' };

function commissionServiceKey(t) {
    if (!t) return '';
    if (t.bookingType === 'hourly') return 'hourly';
    if (t.storeOrderId || t.createdByMerchant) return 'tiendas';
    const s = String(t.serviceType || 'auto');
    return (s === 'flete_paila' || s === 'flete_camion') ? 'flete' : s;
}

function validPct(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** % del admin para esa clave, o null si el admin no tiene ninguno guardado. */
function percentFromConfig(cfg, key) {
    const by = (cfg && typeof cfg.commissionByService === 'object' && cfg.commissionByService) || {};
    let k = key;
    for (let i = 0; k && i < 3; i++) {
        const v = validPct(by[k]);
        if (v != null) return { pct: v, source: `service:${k}` };
        k = PARENT[k];
    }
    const g = validPct(cfg?.commissionPercentage);
    return g != null ? { pct: g, source: 'general' } : null;
}

function parsePriceText(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const m = String(v || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    const n = m ? parseFloat(m[0]) : NaN;
    return Number.isFinite(n) ? n : 0;
}

/** Precio base de la comisión (igual que parseTripPrice de la app). */
function commissionBase(t) {
    if (t.birthdayFree && Number(t.originalPriceNum) > 0) return money(t.originalPriceNum);
    if (typeof t.priceNum === 'number' && Number.isFinite(t.priceNum) && t.priceNum > 0) return money(t.priceNum);
    return money(parsePriceText(t.price));
}

function hnMonthDay(date) {
    const p = freeDay.getHondurasWeekdayAndParts(date);
    return { month: Number(p.month), day: Number(p.day) };
}

function isDriverBirthday(profile, date) {
    if (!profile || profile.role !== 'driver' || typeof profile.birthDate !== 'string') return false;
    const m = profile.birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return false;
    const hn = hnMonthDay(date);
    return Number(m[2]) === hn.month && Number(m[3]) === hn.day;
}

/**
 * Cálculo puro. Devuelve null si no hay % configurado (no escribir).
 * @returns {{patch, amount, pct, base, net, waived, key, source} | null}
 */
function computeTripCommission({ trip, platformConfig, freeDayConfig, driverProfile, nowMs = Date.now() }) {
    const t = trip || {};
    const key = commissionServiceKey(t);
    const date = new Date(nowMs);
    const base = commissionBase(t);
    let waived = null;
    if (t.birthdayFree || t.paymentMethod === 'birthday_gift') waived = 'passenger_birthday_gift';
    else if (isDriverBirthday(driverProfile, date)) waived = 'driver_birthday';
    else {
        const cfg = freeDay.normalizeCommissionFreeDayConfig(freeDayConfig || {});
        const zoneId = t.serviceZoneId || t.cityId || t.originZoneId || driverProfile?.serviceZoneId || driverProfile?.cityId || null;
        if (t.driverId && freeDay.isCommissionFreeDayActive(zoneId, t.driverId, date, cfg)) waived = 'free_day';
    }
    const found = percentFromConfig(platformConfig, key);
    if (!found && !waived) return null;
    const pct = waived ? 0 : found.pct;
    const amount = money(base * pct / 100);
    const net = money(base - amount);
    const clientAmount = t.saldoCommissionPaid != null ? Number(t.saldoCommissionPaid) : (t.commissionAmount != null ? Number(t.commissionAmount) : null);
    const patch = {
        serverCommissionKey: key,
        serverCommissionPercent: pct,
        serverCommissionAmount: amount,
        serverCommissionBase: base,
        serverDriverNet: net,
        serverCommissionWaived: waived,
        serverCommissionSource: waived ? `waived:${waived}` : found.source,
        serverCommissionAtMs: nowMs,
        serverCommissionClientAmount: Number.isFinite(clientAmount) ? clientAmount : null,
    };
    return { patch, amount, pct, base, net, waived, key, source: patch.serverCommissionSource };
}

const SERVER_COMMISSION_KEYS = ['serverCommissionKey', 'serverCommissionPercent', 'serverCommissionAmount', 'serverCommissionBase',
    'serverDriverNet', 'serverCommissionWaived', 'serverCommissionSource', 'serverCommissionAtMs', 'serverCommissionClientAmount'];

module.exports = ({ db, FieldValue, onDocumentUpdated } = {}) => {
    const onTripCompletedCommission = onDocumentUpdated && onDocumentUpdated(
        { document: 'artifacts/{appId}/public/data/trips/{tripId}', region: 'us-central1', timeoutSeconds: 60 },
        async (event) => {
            const before = event.data?.before?.data() || {};
            const after = event.data?.after?.data() || {};
            // Solo en la transición a completado (los viajes viejos no se recalculan con el % de hoy)
            if (before.status === 'completed' || after.status !== 'completed') return;
            if (after.serverCommissionAtMs != null || after.isDemandSimulation) return;
            const { appId, tripId } = event.params;
            let r;
            try {
                const [pc, st, drv] = await Promise.all([
                    db.doc(`artifacts/${appId}/public/data/platformConfig/main`).get(),
                    db.doc(`artifacts/${appId}/public/data/appSettings/main`).get(),
                    after.driverId ? db.doc(`artifacts/${appId}/public/data/users/${after.driverId}`).get() : null,
                ]);
                r = computeTripCommission({
                    trip: after,
                    platformConfig: pc.exists ? pc.data() : null,
                    freeDayConfig: st.exists ? (st.get('commissionFreeDay') || {}) : {},
                    driverProfile: drv && drv.exists ? drv.data() : null,
                    nowMs: Date.now(),
                });
            } catch (e) {
                console.error('[comision] calcular', tripId, e?.message || e);
                return;
            }
            if (!r) { console.warn('[comision] sin % en platformConfig; queda el de la app', tripId); return; }
            const ca = r.patch.serverCommissionClientAmount;
            if (ca != null && Math.abs(ca - r.amount) > 0.009) {
                console.warn('[comision] app difiere', JSON.stringify({ tripId, driverId: after.driverId || null, app: ca, server: r.amount, pct: r.pct, key: r.key }));
            }
            await event.data.after.ref.update({ ...r.patch, updatedAt: FieldValue.serverTimestamp() });
        }
    );
    return { exports: onTripCompletedCommission ? { onTripCompletedCommission } : {} };
};
Object.assign(module.exports, { computeTripCommission, percentFromConfig, commissionServiceKey, commissionBase, isDriverBirthday, SERVER_COMMISSION_KEYS });
