/**
 * Marketplace HonduRaite: reglas puras (sin Firebase) para validar y calcular comisiones.
 * La comisión (10%) la paga SIEMPRE el vendedor; el comprador ve el precio final sin cargos extra.
 */
const MK_COMMISSION_RATE = 0.10;
const MK_CATEGORIES = ['carros_venta', 'carros_renta', 'motos', 'repuestos', 'otros'];
const MK_RENTAL_CATEGORIES = ['carros_renta'];
const MK_PERIODS = ['day', 'week', 'month'];
const MK_PERIOD_PRICE_KEY = { day: 'priceDay', week: 'priceWeek', month: 'priceMonth' };
const MK_STATUSES = ['pending', 'approved', 'rejected', 'removed', 'sold'];

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const isRental = (listing) => MK_RENTAL_CATEGORIES.includes(String(listing && listing.category || ''));

/** Comisión del vendedor. amount = monto final de la venta, o del período rentado. */
function computeCommission(amount, rate = MK_COMMISSION_RATE) {
    const a = money(amount);
    if (!(a > 0)) throw new Error('Monto inválido.');
    return { amount: a, rate, commission: money(a * rate), sellerNet: money(a - a * rate) };
}

/**
 * Datos del cierre (venta o renta) ya validados.
 * Venta: amount (si falta, el precio publicado). Renta: period + units (cuántos días/semanas/meses);
 * amount por defecto = precio del período × units.
 */
function resolveClose(listing, input = {}) {
    if (!listing) throw new Error('Publicación no encontrada.');
    if (isRental(listing)) {
        const period = String(input.period || '');
        if (!MK_PERIODS.includes(period)) throw new Error('Elige el período: día, semana o mes.');
        const units = Math.max(1, Math.min(366, Math.floor(Number(input.units) || 1)));
        const listed = money(listing[MK_PERIOD_PRICE_KEY[period]]);
        const amount = input.amount != null && input.amount !== '' ? money(input.amount) : money(listed * units);
        if (!(amount > 0)) throw new Error('Esa publicación no tiene precio para ese período; escribe el monto.');
        return { kind: 'rental', period, units, listedPrice: listed || null, ...computeCommission(amount) };
    }
    const amount = input.amount != null && input.amount !== '' ? money(input.amount) : money(listing.price);
    if (!(amount > 0)) throw new Error('Escribe el monto final de la venta.');
    return { kind: 'sale', period: null, units: 1, listedPrice: money(listing.price) || null, ...computeCommission(amount) };
}

/** Totales del panel: pendientes y pagadas. */
function commissionTotals(list) {
    const t = { pending: 0, paid: 0, pendingCount: 0, paidCount: 0 };
    (list || []).forEach((c) => {
        const k = c && c.status === 'paid' ? 'paid' : 'pending';
        t[k] = money(t[k] + money(c && c.commission));
        t[`${k}Count`] += 1;
    });
    return t;
}

module.exports = {
    MK_COMMISSION_RATE, MK_CATEGORIES, MK_RENTAL_CATEGORIES, MK_PERIODS, MK_PERIOD_PRICE_KEY, MK_STATUSES,
    computeCommission, resolveClose, commissionTotals, isRental, money,
};
