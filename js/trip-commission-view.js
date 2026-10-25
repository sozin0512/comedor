/**
 * Comisión HonduRaite por viaje, para lo que ve el conductor.
 * Fuente: campos server* que escribe el servidor al completar (functions/trip-commission.js).
 * Si aún no están (viaje en curso, o completado antes del deploy) se muestra una VISTA PREVIA
 * con el % del admin para ese servicio; la app nunca guarda el valor oficial.
 */
import { storeOrderSummary } from './store-trip-ui.js?v=2026.10.24.7';

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const money = (n) => 'L. ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function hasServerCommission(t) {
    return t != null && t.serverCommissionAtMs != null && Number.isFinite(Number(t.serverCommissionAmount));
}

const WAIVED_LABEL = { free_day: 'día sin comisión', driver_birthday: 'tu cumpleaños', passenger_birthday_gift: 'regalo de cumpleaños' };

/**
 * @param {object} t viaje
 * @param {{ base: number, previewPct: number|null, waived?: string|null }} o base = precio del viaje (sin productos)
 * @returns {{ base, pct, amount, net, server: boolean, waived: string|null }}
 */
export function tripCommissionInfo(t, { base, previewPct = null, waived = null } = {}) {
    if (hasServerCommission(t)) {
        const b = Number.isFinite(Number(t.serverCommissionBase)) ? r2(t.serverCommissionBase) : r2(base);
        const amount = r2(t.serverCommissionAmount);
        return { base: b, pct: Number(t.serverCommissionPercent) || 0, amount, net: r2(t.serverDriverNet ?? (b - amount)), server: true, waived: t.serverCommissionWaived || null };
    }
    const pct = Number.isFinite(Number(previewPct)) ? Number(previewPct) : null;
    const b = r2(base || 0);
    if (pct == null) return { base: b, pct: null, amount: null, net: null, server: false, waived };
    const amount = r2(b * pct / 100);
    return { base: b, pct, amount, net: r2(b - amount), server: false, waived: waived || null };
}

/** Efectivo de productos que el conductor lleva a la tienda (no es suyo, no paga comisión). */
export function productsCashForStore(t) {
    const s = storeOrderSummary(t);
    if (!s || s.productsPaid) return 0;
    return r2(s.itemsTotal || 0);
}

function baseLabel(t) {
    return (t?.storeOrderId || t?.createdByMerchant || t?.storeDelivery || t?.serviceType === 'delivery') ? 'Envío' : 'Viaje';
}

/** Texto de una línea: «Envío L. 35.00 · Comisión HonduRaite L. 8.75 (25%) · Te quedas L. 26.25». */
export function commissionLineText(t, info) {
    if (!info || info.amount == null) return `${baseLabel(t)} ${money(info?.base)} · Comisión HonduRaite: pendiente`;
    const why = info.waived ? ` (${WAIVED_LABEL[info.waived] || 'sin comisión'})` : ` (${+info.pct.toFixed(2)}%)`;
    return `${baseLabel(t)} ${money(info.base)} · Comisión HonduRaite ${money(info.amount)}${why} · Te quedas ${money(info.net)}`;
}

export function commissionBreakdownHtml(t, info, { compact = false } = {}) {
    const prod = productsCashForStore(t);
    const tag = info?.server ? '' : '<span class="hr-comm-tag">estimado</span>';
    const waived = info?.waived ? `<span class="hr-comm-tag hr-comm-tag--ok">${esc(WAIVED_LABEL[info.waived] || 'sin comisión')}</span>` : '';
    if (compact) {
        return `<div class="hr-comm hr-comm--compact" data-trip-commission>${esc(commissionLineText(t, info))}${prod > 0 ? ` · Productos para la tienda ${money(prod)}` : ''}${tag}</div>`;
    }
    const pctTxt = info?.amount == null ? 'pendiente' : (info.waived ? '0%' : `${+info.pct.toFixed(2)}%`);
    return `<div class="hr-comm" data-trip-commission>
        <p class="hr-comm-title"><i class="fas fa-percent"></i> Tu ganancia de este viaje ${tag}${waived}</p>
        <p class="hr-comm-row"><span>${baseLabel(t)}</span><b>${money(info?.base)}</b></p>
        <p class="hr-comm-row hr-comm-row--minus"><span>Comisión HonduRaite (${pctTxt})</span><b>${info?.amount == null ? '—' : '− ' + money(info.amount)}</b></p>
        <p class="hr-comm-row hr-comm-row--net"><span>Te quedas</span><b>${info?.net == null ? '—' : money(info.net)}</b></p>
        ${prod > 0 ? `<p class="hr-comm-row hr-comm-row--store"><span>Productos para la tienda</span><b>${money(prod)}</b></p>
        <p class="hr-comm-note">Los productos son de la tienda: no son ganancia ni pagan comisión.</p>` : ''}
        <p class="hr-comm-text" hidden>${esc(commissionLineText(t, info))}</p>
    </div>`;
}

export const TRIP_COMMISSION_CSS = `
.hr-comm{background:#fff;border:1px solid #cbd5e1;border-radius:14px;padding:10px 12px;margin-top:8px;font-family:Inter,system-ui,sans-serif;color:#0f172a}
.hr-comm-title{font-weight:900;font-size:13px;margin:0 0 6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:#0c4a8e}
.hr-comm-row{display:flex;justify-content:space-between;font-size:13px;margin:3px 0}
.hr-comm-row--minus b{color:#b91c1c}
.hr-comm-row--net{border-top:1px dashed #cbd5e1;padding-top:5px;font-weight:900}
.hr-comm-row--net b{color:#047857;font-size:15px}
.hr-comm-row--store{color:#92400e}
.hr-comm-note{font-size:11px;color:#64748b;margin:4px 0 0}
.hr-comm-tag{font-size:10px;font-weight:800;background:#fef3c7;color:#92400e;border-radius:6px;padding:1px 6px}
.hr-comm-tag--ok{background:#d1fae5;color:#065f46}
.hr-comm--compact{font-size:11px;color:#cbd5e1;margin-top:4px;padding:0;border:0;background:none}
`;
