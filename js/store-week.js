/**
 * Semana de ventas de una tienda (lunes 00:00 a lunes 00:00, hora de Honduras)
 * y el 10% que HonduRaite cobra sobre el total de productos. El envío no entra.
 */
export const WEEKLY_COMMISSION_RATE = 0.10;

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function hondurasYmd(date) {
    const s = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Tegucigalpa',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
    const [y, m, d] = s.split('-').map(Number);
    return { y, m, d };
}

function hondurasWeekdayIndex(date) {
    const w = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Tegucigalpa',
        weekday: 'short',
    }).format(date);
    return WEEKDAY[w] ?? 1;
}

/** @param {Date} now @param {'current'|'previous'} which */
export function hondurasWeekRange(now = new Date(), which = 'current') {
    const { y, m, d } = hondurasYmd(now);
    const day = hondurasWeekdayIndex(now);
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const shiftDays = which === 'previous' ? -7 : 0;
    // 00:00 en Honduras (UTC−6) = 06:00 UTC. Honduras no cambia de hora.
    const start = new Date(Date.UTC(y, m - 1, d + mondayOffset + shiftDays, 6, 0, 0));
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start, end, which: which === 'previous' ? 'previous' : 'current' };
}

export function formatWeekLabel(range) {
    const opt = { day: 'numeric', month: 'short', timeZone: 'America/Tegucigalpa' };
    const endShown = new Date(range.end.getTime() - 1);
    const a = range.start.toLocaleDateString('es-HN', opt).replace('.', '');
    const b = endShown.toLocaleDateString('es-HN', opt).replace('.', '');
    return `${a} – ${b}`;
}

export function orderCreatedMs(order) {
    const c = order?.createdAt;
    if (c == null) return 0;
    if (typeof c === 'number') return c;
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (typeof c.seconds === 'number') return c.seconds * 1000;
    const t = Date.parse(c);
    return Number.isFinite(t) ? t : 0;
}

function moneyRound(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Ventas de la semana: pedidos no cancelados, por el total de productos (itemsTotal).
 * El 10% es lo que se cobra a la tienda. El envío no se suma.
 */
export function weeklySalesReport(orders, range, rate = WEEKLY_COMMISSION_RATE) {
    const start = range.start.getTime();
    const end = range.end.getTime();
    const rows = [];
    for (const o of orders || []) {
        if (!o || o.status === 'cancelled') continue;
        const t = orderCreatedMs(o);
        if (!(t >= start && t < end)) continue;
        rows.push({
            id: o.id || '',
            itemsTotal: moneyRound(o.itemsTotal),
            status: o.status || '',
            clientName: o.clientName || '',
            createdAtMs: t,
        });
    }
    rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
    const gross = moneyRound(rows.reduce((s, r) => s + r.itemsTotal, 0));
    const delivered = rows.filter((r) => r.status === 'delivered');
    const deliveredGross = moneyRound(delivered.reduce((s, r) => s + r.itemsTotal, 0));
    return {
        count: rows.length,
        gross,
        fee: moneyRound(gross * rate),
        rate,
        deliveredCount: delivered.length,
        deliveredGross,
        deliveredFee: moneyRound(deliveredGross * rate),
        rows,
    };
}
