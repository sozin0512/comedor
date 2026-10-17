/**
 * Supervisión · «Pedidos» de tiendas (solo admin/supervisor).
 * En vivo (todas las tiendas, con «atascados»), historial con búsqueda + CSV y contadores.
 * Solo lee store_orders (las reglas ya limitan la lectura a staff, dueño y cliente).
 * Los estados de las tiendas NO cambian: se agrupan para la vista.
 */
import { collection, onSnapshot, query, where, orderBy, limit, getDocs, Timestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { esc, money } from './delivery-zones-shared.js?v=2026.10.17.1';

export const STAGES = [
    { id: 'recibido', label: 'Recibido', statuses: ['pending', 'accepted'], color: '#2563EB', limitMin: 10 },
    { id: 'cocina', label: 'En cocina', statuses: ['preparing', 'ready'], color: '#7C3AED', limitMin: 30 },
    { id: 'camino', label: 'En camino', statuses: ['out_for_delivery'], color: '#0891B2', limitMin: 45 },
    { id: 'entregado', label: 'Entregado', statuses: ['delivered'], color: '#059669', limitMin: null },
    { id: 'cancelado', label: 'Cancelado', statuses: ['cancelled'], color: '#DC2626', limitMin: null },
];
const STATUS_LABEL = { pending: 'Nuevo', accepted: 'Aceptado', preparing: 'Preparando', ready: 'Listo · sin moto', out_for_delivery: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado' };
const ACTIVE_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const SOUND_KEY = 'hr_staff_orders_sound';
const TZ = 'America/Tegucigalpa';
const DAY = 864e5;

// ───────── lógica pura (con pruebas) ─────────
export function stageOf(status) { return STAGES.find((s) => s.statuses.includes(status)) || STAGES[0]; }
export const tsMs = (v) => (v == null ? 0 : typeof v === 'number' ? v : v.toMillis ? v.toMillis() : v.seconds ? v.seconds * 1000 : (Date.parse(v) || 0));
export const shortId = (id) => `#${String(id || '').slice(0, 6).toUpperCase()}`;
/** Desde cuándo está en su estado: «pending» cuenta desde que se creó; los demás desde el último cambio. */
export function stateSinceMs(o) {
    if (o.status === 'pending') return tsMs(o.createdAt);
    return tsMs(o.updatedAt) || tsMs(o.createdAt);
}
export function stuckInfo(o, now = Date.now()) {
    const st = stageOf(o.status);
    if (!st.limitMin) return null;
    const since = stateSinceMs(o);
    if (!since) return null;
    const min = Math.floor((now - since) / 60000);
    if (min < st.limitMin) return null;
    const what = o.status === 'pending' ? 'Sin aceptar' : o.status === 'ready' ? 'Listo sin moto' : o.status === 'out_for_delivery' ? 'En camino' : 'En cocina';
    return { min, limit: st.limitMin, text: `${what} hace ${fmtDur(min)} (límite ${st.limitMin})` };
}
export function fmtDur(min) { return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`; }
export function zoneName(o) { return o.deliveryZoneName || ''; }
export function feeOf(o) { const f = Number(o.deliveryFee); return Number.isFinite(f) ? f : null; }
export function filterOrders(list, f = {}) {
    const q = String(f.q || '').trim().toLowerCase();
    return list.filter((o) => {
        if (f.storeId && o.storeId !== f.storeId) return false;
        if (f.zone && (f.zone === '__none' ? !!zoneName(o) : zoneName(o) !== f.zone)) return false;
        if (f.stage && stageOf(o.status).id !== f.stage) return false;
        if (f.stuckOnly && !stuckInfo(o, f.now)) return false;
        if (q) {
            const hay = [o.id, shortId(o.id), o.storeName, o.clientName, o.recipientName, o.clientPhone, o.recipientPhone, o.deliveryAddress, zoneName(o),
                ...(o.items || []).map((i) => i.name)].join(' ').toLowerCase();
            if (!hay.includes(q.replace(/^#/, '')) && !hay.includes(q)) return false;
        }
        return true;
    });
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
export function dayKey(ms) { return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ }); }
export function hourOf(ms) { return Number(new Date(ms).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ })) % 24; }
export function ordersCsv(list) {
    const head = ['fecha', 'hora', 'pedido', 'tienda', 'cliente', 'telefono', 'zona', 'productos', 'productos_L', 'envio_L', 'envio_origen', 'total_L', 'pago', 'estado'];
    const rows = list.map((o) => {
        const ms = tsMs(o.createdAt); const fee = feeOf(o); const items = Number(o.itemsTotal) || 0;
        return [dayKey(ms), new Date(ms).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }), o.id, o.storeName || '', o.clientName || o.recipientName || '',
            o.recipientPhone || o.clientPhone || '', zoneName(o) || 'sin zona', (o.items || []).map((i) => `${i.qty}x ${i.name}`).join(' | '), items.toFixed(2),
            fee == null ? '' : fee.toFixed(2), o.deliveryFeeSource || '', (items + (fee || 0)).toFixed(2), o.paymentMethod === 'saldo' ? 'puntos' : 'efectivo', STATUS_LABEL[o.status] || o.status];
    });
    return '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
export function counters(list, { fromMs, toMs, now = Date.now() } = {}) {
    const inR = list.filter((o) => { const t = tsMs(o.createdAt); return t >= fromMs && t < toMs; });
    const days = new Map();
    for (let t = fromMs; t < toMs; t += DAY) days.set(dayKey(t + 3600e3 * 6), { day: dayKey(t + 3600e3 * 6), total: 0, cancelled: 0 });
    const stores = new Map(); const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    let delivered = 0, cancelled = 0, sold = 0, fees = 0;
    for (const o of inR) {
        const t = tsMs(o.createdAt); const k = dayKey(t);
        if (!days.has(k)) days.set(k, { day: k, total: 0, cancelled: 0 });
        const d = days.get(k); d.total++; if (o.status === 'cancelled') d.cancelled++;
        const wd = (new Date(new Date(t).toLocaleString('en-US', { timeZone: TZ })).getDay() + 6) % 7; heat[wd][hourOf(t)]++;
        const s = stores.get(o.storeId) || { storeId: o.storeId, name: o.storeName || o.storeId, total: 0, delivered: 0, cancelled: 0, sold: 0, zones: new Map() };
        s.total++;
        if (o.status === 'delivered') { s.delivered++; delivered++; s.sold += Number(o.itemsTotal) || 0; sold += Number(o.itemsTotal) || 0; fees += feeOf(o) || 0; }
        if (o.status === 'cancelled') { s.cancelled++; cancelled++; }
        const zn = zoneName(o) || 'Sin zona'; s.zones.set(zn, (s.zones.get(zn) || 0) + 1);
        stores.set(o.storeId, s);
    }
    const byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    const byStore = [...stores.values()].map((s) => ({ ...s, ticket: s.delivered ? s.sold / s.delivered : 0, topZone: [...s.zones.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—', zones: undefined }))
        .sort((a, b) => b.total - a.total);
    const nDays = Math.max(1, Math.round((toMs - fromMs) / DAY));
    const best = byDay.reduce((a, d) => (d.total > (a?.total ?? -1) ? d : a), null);
    return { total: inR.length, delivered, cancelled, sold, fees, avgPerDay: Math.round((inR.length / nDays) * 10) / 10, best, byDay, byStore, heat, today: byDay.find((d) => d.day === dayKey(now)) || null };
}

// ───────── estado y datos ─────────
let DEPS = {};
let M = null;
const S = {
    tab: 'live', active: [], todayDone: [], hist: [], histRange: '7', histFrom: null, histTo: null, histLoading: false,
    f: { storeId: '', zone: '', stage: '', stuckOnly: false, q: '' }, page: 0, pageSize: 25,
    cRange: '14', cZone: '', alert: null, sound: false, seen: null, now: Date.now(), error: '',
};
function ensureCss() {
    if (typeof document === 'undefined' || document.getElementById('tz-css')) return;
    const l = document.createElement('link'); l.id = 'tz-css'; l.rel = 'stylesheet';
    const v = (window.APP_CONFIG && window.APP_CONFIG.appVersion) || '';
    l.href = `css/tiendas-zonas.css${v ? `?v=${v}` : ''}`; document.head.appendChild(l);
}
function startOfDayMs(ms = Date.now()) {
    const k = dayKey(ms); // YYYY-MM-DD en Honduras (UTC-6, sin horario de verano)
    return Date.parse(`${k}T00:00:00-06:00`);
}
function rangeFor(key, now = Date.now()) {
    const today = startOfDayMs(now);
    if (key === 'today') return { fromMs: today, toMs: today + DAY };
    if (key === 'month') { const k = dayKey(now).slice(0, 7); return { fromMs: Date.parse(`${k}-01T00:00:00-06:00`), toMs: today + DAY }; }
    const n = Number(key) || 7;
    return { fromMs: today - (n - 1) * DAY, toMs: today + DAY };
}

// ───────── sonido ─────────
let audioCtx = null;
function beep() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t0 = audioCtx.currentTime;
        [0, 0.18, 0.36].forEach((dt, i) => {
            const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = [880, 1175, 1568][i];
            g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.16);
            o.connect(g).connect(audioCtx.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.18);
        });
        return true;
    } catch (_) { return false; }
}
function setSound(on) {
    S.sound = !!on;
    try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch (_) {}
    if (on) beep(); // el toque del usuario desbloquea el audio (autoplay)
}

// ───────── vista ─────────
const zoneTagHtml = (o) => { const z = zoneName(o); return z ? `<span class="tz-tag blue">${esc(z)}</span>` : '<span class="tz-tag">Sin zona</span>'; };
const when = (ms) => new Date(ms).toLocaleTimeString('es-HN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const dayShort = (k) => { const d = new Date(`${k}T12:00:00-06:00`); return d.toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: TZ }).replace('.', ''); };
function liveCardHtml(o, now) {
    const st = stuckInfo(o, now); const since = stateSinceMs(o); const min = since ? Math.max(0, Math.floor((now - since) / 60000)) : null;
    const fee = feeOf(o); const isNew = S.alert?.id === o.id;
    const items = (o.items || []).map((i) => `${i.qty}× ${i.name}`).join(', ');
    const tail = o.status === 'delivered' ? `Entregado ${esc(when(tsMs(o.updatedAt) || since))}` : o.status === 'cancelled' ? `Lo canceló ${o.cancelledBy === 'client' ? 'el cliente' : o.cancelledBy === 'system' ? 'el sistema (fuera de zona)' : 'la tienda'}${o.paymentStatus === 'refunded' ? ' · reembolsado' : ''}` : `${min != null ? (min < 1 ? 'Hace segundos' : `${fmtDur(min)} en este estado`) : ''}`;
    return `<div class="pd-card ${st ? 'stuck' : ''} ${isNew ? 'new' : ''}">
        ${isNew ? '<span class="pd-newtag">NUEVO</span>' : ''}
        ${st ? `<div class="pd-stuck">⚠ ${esc(st.text)}</div>` : ''}
        <div class="pd-top"><code>${esc(shortId(o.id))}</code><span class="tz-tag ${o.status === 'cancelled' ? 'bad' : o.status === 'delivered' ? 'ok' : o.status === 'ready' ? 'pur' : 'blue'}">${esc(STATUS_LABEL[o.status] || o.status)}</span></div>
        <b class="pd-store">${esc(o.storeName || 'Tienda')}</b>
        <div class="pd-sub">${esc(o.clientName || o.recipientName || 'Cliente')} · ${esc(items)}</div>
        <div>${zoneTagHtml(o)}</div>
        <div class="pd-money"><span>Envío <b>${fee == null ? '—' : esc(money(fee))}</b></span><b>${esc(money(Number(o.itemsTotal || 0) + (fee || 0)))}</b></div>
        <div class="pd-foot ${st ? 'bad' : ''}">${tail} · ${o.paymentMethod === 'saldo' ? 'Puntos' : 'Efectivo'}</div>
    </div>`;
}
function filtersHtml(list, { history = false } = {}) {
    const stores = [...new Map(list.map((o) => [o.storeId, o.storeName || o.storeId])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    const zones = [...new Set(list.map(zoneName).filter(Boolean))].sort();
    const f = S.f;
    return `<div class="pd-filters">
        ${history ? `<label class="tz-inp pd-search"><i class="fas fa-search"></i><input data-pd-f="q" value="${esc(f.q)}" placeholder="Buscar pedido, tienda, cliente, teléfono, producto…"></label>
            <select class="tz-sel" data-pd-f="range">${[['today', 'Hoy'], ['7', 'Últimos 7 días'], ['14', 'Últimos 14 días'], ['30', 'Últimos 30 días'], ['month', 'Este mes']].map(([v, l]) => `<option value="${v}" ${S.histRange === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
        <select class="tz-sel" data-pd-f="storeId"><option value="">Tienda: Todas</option>${stores.map(([id, n]) => `<option value="${esc(id)}" ${f.storeId === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <select class="tz-sel" data-pd-f="zone"><option value="">Zona: Todas</option>${zones.map((z) => `<option value="${esc(z)}" ${f.zone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}<option value="__none" ${f.zone === '__none' ? 'selected' : ''}>Sin zona</option></select>
        <select class="tz-sel" data-pd-f="stage"><option value="">Estado: Todos</option>${STAGES.map((s) => `<option value="${s.id}" ${f.stage === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        ${(f.storeId || f.zone || f.stage || f.q || f.stuckOnly) ? '<button type="button" class="tz-btn ghost sm" data-pd="clear">Quitar filtros</button>' : ''}
    </div>`;
}
function liveHtml() {
    const now = S.now;
    const all = [...S.active, ...S.todayDone];
    const list = filterOrders(all, { ...S.f, q: '', now });
    const stuck = S.active.filter((o) => stuckInfo(o, now));
    const todayAll = all.filter((o) => tsMs(o.createdAt) >= startOfDayMs(now));
    const delivered = todayAll.filter((o) => o.status === 'delivered');
    const sold = delivered.reduce((a, o) => a + (Number(o.itemsTotal) || 0), 0);
    const fees = delivered.reduce((a, o) => a + (feeOf(o) || 0), 0);
    const byStage = (id) => S.active.filter((o) => stageOf(o.status).id === id).length;
    const kpi = (l, v, d, cls = '') => `<div class="pd-kpi ${cls}"><span>${l}</span><b class="tz-num">${v}</b><small>${d}</small></div>`;
    const alert = S.alert ? `<div class="pd-alert"><i class="fas fa-bell"></i><div><b>¡Nuevo pedido! ${esc(shortId(S.alert.id))} · ${esc(S.alert.storeName || 'Tienda')} · ${esc(money(S.alert.itemsTotal))}</b><small>${esc(S.alert.clientName || 'Cliente')}${S.alert.deliveryZoneName ? ` · Envío a ${esc(S.alert.deliveryZoneName)} ${esc(money(S.alert.deliveryFee))}` : ''}${S.sound ? ' · sonó la alerta' : ' · sonido apagado'}</small></div><span class="tz-sp"></span><button type="button" class="tz-btn ghost sm" data-pd="alert-close">Cerrar</button></div>` : '';
    const cols = STAGES.map((st) => {
        const items = list.filter((o) => stageOf(o.status).id === st.id)
            .sort((a, b) => (st.limitMin ? (stuckInfo(b, now) ? 1 : 0) - (stuckInfo(a, now) ? 1 : 0) || stateSinceMs(a) - stateSinceMs(b) : tsMs(b.updatedAt) - tsMs(a.updatedAt)));
        const max = st.limitMin ? 60 : 8;
        return `<div class="pd-col"><div class="pd-colhead"><i style="background:${st.color}"></i><div><b>${st.label}${st.limitMin ? '' : ' · hoy'}</b><small>${st.statuses.join(' · ')}</small></div><span class="pd-count">${items.length}</span></div>
            ${items.slice(0, max).map((o) => liveCardHtml(o, now)).join('') || '<div class="pd-empty">—</div>'}
            ${items.length > max ? `<button type="button" class="tz-linkbtn" data-pd="tab" data-tab="history">Ver ${items.length - max} más en Historial →</button>` : ''}</div>`;
    }).join('');
    return `${alert}
    <div class="pd-kpis">
        ${kpi('Activos ahora', S.active.length, `Recibido ${byStage('recibido')} · cocina ${byStage('cocina')} · camino ${byStage('camino')}`)}
        ${kpi('Atascados', stuck.length, 'Más tiempo del límite en su estado', stuck.length ? 'alert' : '')}
        ${kpi('Pedidos hoy', todayAll.length, `${todayAll.filter((o) => o.status === 'cancelled').length} cancelados`)}
        ${kpi('Entregados hoy', delivered.length, '')}
        ${kpi('Vendido hoy', esc(money(sold)), 'Productos (sin envío)')}
        ${kpi('Envíos hoy', esc(money(fees)), 'Entregados')}
    </div>
    <div class="pd-row"><button type="button" class="pd-chip ${!S.f.stuckOnly ? 'on' : ''}" data-pd="stuck" data-v="0">Todos los activos · ${S.active.length}</button>
        <button type="button" class="pd-chip ${S.f.stuckOnly ? 'on' : ''}" data-pd="stuck" data-v="1">Solo atascados · ${stuck.length}</button>${filtersHtml(all)}</div>
    <p class="tz-small tz-mut">Límites de «atascado»: Recibido 10 min · En cocina 30 min · En camino 45 min · <span class="pd-live"></span> En vivo · se actualiza solo</p>
    <div class="pd-board">${cols}</div>`;
}
function historyHtml() {
    const list = filterOrders(S.hist, S.f).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    const pages = Math.max(1, Math.ceil(list.length / S.pageSize));
    S.page = Math.min(S.page, pages - 1);
    const rows = list.slice(S.page * S.pageSize, (S.page + 1) * S.pageSize);
    const items = list.reduce((a, o) => a + (Number(o.itemsTotal) || 0), 0);
    const fees = list.reduce((a, o) => a + (feeOf(o) || 0), 0);
    const pi = rows.reduce((a, o) => a + (Number(o.itemsTotal) || 0), 0), pf = rows.reduce((a, o) => a + (feeOf(o) || 0), 0);
    const zc = new Map(); list.forEach((o) => { const z = zoneName(o) || 'Sin zona'; zc.set(z, (zc.get(z) || 0) + 1); });
    const zonesPct = [...zc.entries()].sort((a, b) => b[1] - a[1]).map(([z, n]) => `<span class="tz-tag ${z === 'Sin zona' ? '' : 'blue'}">${esc(z)} ${Math.round((n / (list.length || 1)) * 100)}%</span>`).join(' ');
    return `<div class="tz-card">${filtersHtml(S.hist, { history: true })}
        <div class="pd-row"><p class="tz-small tz-mut pd-grow">Busca por número de pedido, tienda, cliente, teléfono o producto. El CSV exporta <b>todo lo filtrado</b> (no solo esta página).</p>
        <button type="button" class="tz-btn pri" data-pd="csv" ${list.length ? '' : 'disabled'}><i class="fas fa-download"></i> Exportar CSV · ${list.length} filas</button></div></div>
    <div class="pd-kpis pd-kpis4">
        <div class="pd-kpi"><span>Pedidos (con filtros)</span><b class="tz-num">${list.length}</b><small>Entregados ${list.filter((o) => o.status === 'delivered').length} · cancelados ${list.filter((o) => o.status === 'cancelled').length}</small></div>
        <div class="pd-kpi"><span>Productos</span><b class="tz-num">${esc(money(items))}</b><small>Ticket medio ${esc(money(list.length ? items / list.length : 0))}</small></div>
        <div class="pd-kpi"><span>Envíos</span><b class="tz-num">${esc(money(fees))}</b><small>Media ${esc(money(list.length ? fees / list.length : 0))} por pedido</small></div>
        <div class="pd-kpi"><span>Por zona</span><div class="pd-tags">${zonesPct || '—'}</div></div>
    </div>
    <div class="tz-card"><div class="tz-tablewrap"><table class="tz-table">
        <thead><tr><th>Fecha</th><th>Hora</th><th>Pedido</th><th>Tienda</th><th>Cliente</th><th>Zona</th><th class="r">Productos</th><th class="r">Envío</th><th class="r">Total</th><th>Pago</th><th>Estado</th></tr></thead>
        <tbody>${S.histLoading ? '<tr><td colspan="11" class="tz-mut">Cargando…</td></tr>' : rows.map((o) => {
            const ms = tsMs(o.createdAt); const fee = feeOf(o); const st = stageOf(o.status);
            return `<tr><td>${esc(dayShort(dayKey(ms)))}</td><td>${esc(when(ms))}</td><td><code>${esc(shortId(o.id))}</code></td><td><b>${esc(o.storeName || '')}</b></td><td>${esc(o.clientName || o.recipientName || '')}</td><td>${zoneTagHtml(o)}</td>
                <td class="r">${esc(money(o.itemsTotal))}</td><td class="r">${fee == null ? '—' : esc(money(fee))}${o.deliveryFeeSource === 'distance' && fee != null ? '<br><small class="tz-mut">por km</small>' : ''}</td><td class="r"><b>${esc(money(Number(o.itemsTotal || 0) + (fee || 0)))}</b></td>
                <td>${o.paymentMethod === 'saldo' ? 'Puntos' : 'Efectivo'}</td><td><span class="tz-tag ${st.id === 'entregado' ? 'ok' : st.id === 'cancelado' ? 'bad' : 'blue'}">${esc(STATUS_LABEL[o.status] || o.status)}</span></td></tr>`;
        }).join('') || '<tr><td colspan="11" class="tz-mut">Sin pedidos con estos filtros.</td></tr>'}
        ${rows.length ? `<tr class="tot"><td colspan="6">Esta página (${rows.length} de ${list.length})</td><td class="r">${esc(money(pi))}</td><td class="r">${esc(money(pf))}</td><td class="r">${esc(money(pi + pf))}</td><td colspan="2"></td></tr>` : ''}</tbody></table></div>
        <div class="pd-row"><span class="tz-small tz-mut">Mostrando ${list.length ? S.page * S.pageSize + 1 : 0}–${Math.min(list.length, (S.page + 1) * S.pageSize)} de ${list.length}</span><span class="tz-sp"></span>
        <button type="button" class="tz-btn ghost sm" data-pd="page" data-v="${S.page - 1}" ${S.page <= 0 ? 'disabled' : ''}>‹ Anterior</button>
        <span class="tz-small">${S.page + 1} / ${pages}</span>
        <button type="button" class="tz-btn ghost sm" data-pd="page" data-v="${S.page + 1}" ${S.page >= pages - 1 ? 'disabled' : ''}>Siguiente ›</button></div></div>`;
}
function countersHtml() {
    const r = rangeFor(S.cRange, S.now);
    const base = S.cZone ? S.hist.filter((o) => (S.cZone === '__none' ? !zoneName(o) : zoneName(o) === S.cZone)) : S.hist;
    const c = counters(base, { ...r, now: S.now });
    const zones = [...new Set(S.hist.map(zoneName).filter(Boolean))].sort();
    const maxDay = Math.max(1, ...c.byDay.map((d) => d.total));
    const today = dayKey(S.now);
    const bars = c.byDay.map((d) => `<div class="pd-bar"><b>${d.total}</b><i style="height:${Math.round((d.total / maxDay) * 150)}px" class="${d.day === today ? 'today' : ''}"><em style="height:${d.total ? Math.round((d.cancelled / d.total) * 100) : 0}%"></em></i><small>${d.day === today ? 'hoy' : esc(dayShort(d.day))}</small></div>`).join('');
    const maxH = Math.max(1, ...c.heat.flat());
    const hours = [7, 9, 11, 13, 15, 17, 19, 21];
    const heat = `<table class="pd-heat"><tr><th></th>${hours.map((h) => `<th>${h % 12 || 12}${h < 12 ? 'a' : 'p'}</th>`).join('')}</tr>${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d, i) => `<tr><th>${d}</th>${hours.map((h) => { const v = c.heat[i][h] + c.heat[i][h + 1]; return `<td style="background:rgba(37,99,235,${(0.08 + 0.8 * (v / (maxH * 2))).toFixed(2)})" title="${v}"></td>`; }).join('')}</tr>`).join('')}</table>`;
    const maxS = Math.max(1, ...c.byStore.map((s) => s.total));
    const tot = c.byStore.reduce((a, s) => ({ total: a.total + s.total, delivered: a.delivered + s.delivered, cancelled: a.cancelled + s.cancelled, sold: a.sold + s.sold }), { total: 0, delivered: 0, cancelled: 0, sold: 0 });
    const label = { today: 'hoy', 7: '7 días', 14: '14 días', 30: '30 días', month: 'este mes' }[S.cRange];
    return `<div class="pd-row">${[['today', 'Hoy'], ['7', '7 días'], ['14', '14 días'], ['month', 'Este mes']].map(([v, l]) => `<button type="button" class="pd-chip ${S.cRange === v ? 'on' : ''}" data-pd="crange" data-v="${v}">${l}</button>`).join('')}
        <select class="tz-sel" data-pd-f="czone"><option value="">Zona: Todas</option>${zones.map((z) => `<option value="${esc(z)}" ${S.cZone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}<option value="__none" ${S.cZone === '__none' ? 'selected' : ''}>Sin zona</option></select>
        <span class="tz-sp"></span><button type="button" class="tz-btn ghost sm" data-pd="csv-counters"><i class="fas fa-download"></i> CSV de contadores</button></div>
    <div class="pd-kpis pd-kpis5">
        <div class="pd-kpi"><span>Pedidos (${label})</span><b class="tz-num">${c.total}</b><small>${c.delivered} entregados</small></div>
        <div class="pd-kpi"><span>Promedio por día</span><b class="tz-num">${c.avgPerDay}</b><small>${c.best ? `Mejor día: ${esc(dayShort(c.best.day))} · ${c.best.total}` : '—'}</small></div>
        <div class="pd-kpi"><span>Hoy hasta ahora</span><b class="tz-num">${c.today?.total ?? 0}</b><small>${S.active.length} activos</small></div>
        <div class="pd-kpi"><span>Tiendas con pedidos</span><b class="tz-num">${c.byStore.length}</b><small>Vendido ${esc(money(c.sold))}</small></div>
        <div class="pd-kpi ${c.cancelled ? 'alert' : ''}"><span>Cancelados</span><b class="tz-num">${c.cancelled}</b><small>${c.total ? ((c.cancelled / c.total) * 100).toFixed(1) : 0}%</small></div>
    </div>
    <div class="pd-two"><div class="tz-card"><div class="tz-sec"><h3>Pedidos por día</h3><span class="tz-small"><i class="pd-lg b"></i>pedidos <i class="pd-lg r"></i>cancelados <i class="pd-lg c"></i>hoy</span></div><div class="pd-bars">${bars}</div></div>
        <div class="tz-card"><div class="tz-sec"><h3>Hora pico (pedidos por hora)</h3><span class="tz-small tz-mut">${label}</span></div>${heat}</div></div>
    <div class="tz-card"><div class="tz-sec"><h3>Pedidos por tienda</h3><span class="tz-small tz-mut">${label} · ordenado por pedidos</span></div><div class="tz-tablewrap"><table class="tz-table">
        <thead><tr><th>Tienda</th><th>Pedidos</th><th class="r">Entregados</th><th class="r">Cancelados</th><th class="r">Vendido</th><th class="r">Ticket medio</th><th>Zona más pedida</th></tr></thead>
        <tbody>${c.byStore.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td><span class="pd-sbar"><i style="width:${Math.round((s.total / maxS) * 100)}%"></i></span> <b>${s.total}</b></td><td class="r">${s.delivered}</td><td class="r ${s.cancelled ? 'tz-errtxt' : ''}">${s.cancelled}</td><td class="r">${esc(money(s.sold))}</td><td class="r">${esc(money(s.ticket))}</td><td>${s.topZone === 'Sin zona' ? '<span class="tz-tag">Sin zona</span>' : `<span class="tz-tag blue">${esc(s.topZone)}</span>`}</td></tr>`).join('') || '<tr><td colspan="7" class="tz-mut">Sin pedidos en este rango.</td></tr>'}
        ${c.byStore.length ? `<tr class="tot"><td>Total</td><td>${tot.total}</td><td class="r">${tot.delivered}</td><td class="r">${tot.cancelled}</td><td class="r">${esc(money(tot.sold))}</td><td class="r">${esc(money(tot.delivered ? tot.sold / tot.delivered : 0))}</td><td></td></tr>` : ''}</tbody></table></div></div>`;
}
export function viewHtml() {
    const tabs = [['live', `En vivo <b class="${S.active.length ? 'r' : ''}">${S.active.length}</b>`], ['history', 'Historial'], ['counters', 'Contadores']];
    return `<div class="tz-root pd-root">
        <div class="pd-head"><div class="pd-tabs">${tabs.map(([id, l]) => `<button type="button" class="${S.tab === id ? 'on' : ''}" data-pd="tab" data-tab="${id}">${l}</button>`).join('')}</div>
            <span class="tz-sp"></span>
            <label class="tz-tog ${S.sound ? 'on' : ''}"><input type="checkbox" data-pd-f="sound" ${S.sound ? 'checked' : ''}><i></i>${S.sound ? 'Sonido activado' : 'Activar sonido'}</label>
            <button type="button" class="tz-btn ghost sm" data-pd="test-sound"><i class="fas fa-bell"></i> Probar sonido</button></div>
        ${S.error ? `<div class="tz-card tz-errbox">${esc(S.error)}</div>` : ''}
        ${S.tab === 'live' ? liveHtml() : S.tab === 'history' ? historyHtml() : countersHtml()}
    </div>`;
}

// ───────── eventos ─────────
function render() {
    if (!M?.root) return;
    if (!M.root.isConnected) { unmount(); return; }
    const a = document.activeElement; const key = a?.getAttribute?.('data-pd-f'); const pos = a?.selectionStart;
    M.root.innerHTML = viewHtml();
    if (key === 'q') { const el = M.root.querySelector('[data-pd-f="q"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} } }
    const badge = document.getElementById('sup-store-orders-badge');
    if (badge) { badge.textContent = String(S.active.length); badge.classList.toggle('hidden', !S.active.length); }
}
function download(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function onClick(e) {
    const b = e.target.closest('[data-pd]'); if (!b) return;
    const a = b.getAttribute('data-pd');
    if (a === 'tab') { S.tab = b.getAttribute('data-tab'); if (S.tab !== 'live' && !S.hist.length) loadHistory(); return render(); }
    if (a === 'stuck') { S.f.stuckOnly = b.getAttribute('data-v') === '1'; return render(); }
    if (a === 'clear') { S.f = { storeId: '', zone: '', stage: '', stuckOnly: false, q: '' }; S.page = 0; return render(); }
    if (a === 'alert-close') { S.alert = null; return render(); }
    if (a === 'test-sound') { beep(); return; }
    if (a === 'page') { S.page = Math.max(0, Number(b.getAttribute('data-v')) || 0); return render(); }
    if (a === 'crange') { S.cRange = b.getAttribute('data-v'); ensureRange(S.cRange); return render(); }
    if (a === 'csv') return download(`pedidos-tiendas-${dayKey(Date.now())}.csv`, ordersCsv(filterOrders(S.hist, S.f).sort((x, y) => tsMs(y.createdAt) - tsMs(x.createdAt))));
    if (a === 'csv-counters') {
        const c = counters(S.hist, rangeFor(S.cRange, S.now));
        const lines = [['tienda', 'pedidos', 'entregados', 'cancelados', 'vendido_L', 'ticket_medio_L', 'zona_mas_pedida'], ...c.byStore.map((s) => [s.name, s.total, s.delivered, s.cancelled, s.sold.toFixed(2), s.ticket.toFixed(2), s.topZone]),
            [], ['dia', 'pedidos', 'cancelados'], ...c.byDay.map((d) => [d.day, d.total, d.cancelled])];
        return download(`contadores-pedidos-${dayKey(Date.now())}.csv`, '\ufeff' + lines.map((r) => r.map(csvCell).join(',')).join('\r\n'));
    }
}
function onChange(e) {
    const el = e.target.closest('[data-pd-f]'); if (!el) return;
    const k = el.getAttribute('data-pd-f');
    if (k !== 'q' && e.type === 'input') return; // selects/checkbox: solo «change»
    if (k === 'sound') { setSound(el.checked); return render(); }
    if (k === 'range') { S.histRange = el.value; S.page = 0; ensureRange(el.value); return render(); }
    if (k === 'czone') { S.cZone = el.value; return render(); }
    if (k === 'q') { if (e.type === 'input') { S.f.q = el.value; S.page = 0; clearTimeout(M.qT); M.qT = setTimeout(render, 200); } return; }
    S.f[k] = el.value; S.page = 0; render();
}

// ───────── Firestore ─────────
const col = () => collection(DEPS.db, 'artifacts', DEPS.appId, 'public', 'data', 'store_orders');
const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
function onActive(list) {
    const ids = new Set(list.map((o) => o.id));
    if (S.seen) {
        const fresh = list.filter((o) => o.status === 'pending' && !S.seen.has(o.id) && Date.now() - tsMs(o.createdAt) < 10 * 60e3);
        if (fresh.length) { S.alert = fresh.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt))[0]; if (S.sound) beep(); }
        list.forEach((o) => S.seen.add(o.id));
    } else S.seen = ids;
    S.active = list;
    render();
}
async function loadHistory(fromMs) {
    const r = fromMs ? { fromMs } : rangeFor(String(Math.max(Number(S.histRange) || 0, Number(S.cRange) || 0, 14)), Date.now());
    if (S.histFrom != null && r.fromMs >= S.histFrom) return;
    S.histLoading = true; render();
    try {
        const snap = await getDocs(query(col(), where('createdAt', '>=', Timestamp.fromMillis(r.fromMs)), orderBy('createdAt', 'desc'), limit(3000)));
        S.hist = mapDocs(snap); S.histFrom = r.fromMs;
    } catch (e) { S.error = 'No se pudo cargar el historial.'; console.warn('[pedidos] historial', e); }
    S.histLoading = false; render();
}
function ensureRange(key) { const r = rangeFor(key, Date.now()); if (S.histFrom == null || r.fromMs < S.histFrom) loadHistory(r.fromMs); }
function subscribe() {
    M.unsubs.push(onSnapshot(query(col(), where('status', 'in', ACTIVE_STATUSES), limit(300)), (snap) => onActive(mapDocs(snap)),
        (e) => { S.error = 'Sin acceso a pedidos (solo admin o supervisor).'; console.warn('[pedidos] vivo', e); render(); }));
    M.unsubs.push(onSnapshot(query(col(), where('createdAt', '>=', Timestamp.fromMillis(startOfDayMs())), orderBy('createdAt', 'desc'), limit(500)), (snap) => {
        S.todayDone = mapDocs(snap).filter((o) => !ACTIVE_STATUSES.includes(o.status)); render();
    }, (e) => console.warn('[pedidos] hoy', e)));
}
function unmount() {
    if (!M) return;
    M.unsubs.forEach((u) => { try { u(); } catch (_) {} });
    clearInterval(M.timer); M = null; S.seen = null;
}
export function mountStoreOrders(container, { live = true } = {}) {
    ensureCss(); unmount();
    try { S.sound = localStorage.getItem(SOUND_KEY) === '1'; } catch (_) {}
    container.innerHTML = '';
    const root = document.createElement('div'); container.appendChild(root);
    root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onChange);
    M = { root, unsubs: [], timer: setInterval(() => { S.now = Date.now(); if (S.tab === 'live' && document.activeElement?.tagName !== 'SELECT') render(); }, 30000) };
    render();
    if (live && DEPS.db) subscribe();
}
export function initStoreOrdersAdmin(deps = {}) {
    DEPS = { ...deps };
    const isStaff = () => { try { return !!DEPS.isStaffUser?.(DEPS.getCurrentUser?.(), DEPS.getUserProfile?.()); } catch (_) { return false; } };
    window.loadSupervisorStoreOrders = () => {
        window.setSupervisorNavActive?.('store-orders');
        const c = document.getElementById('supervisor-pending-list'); if (!c) return;
        if (!isStaff()) { c.innerHTML = '<div class="ops-empty">Solo admin o supervisor.</div>'; return; }
        window.stopSupervisorTripsListener?.();
        mountStoreOrders(c);
    };
}
/** Arnés de capturas (sin Firebase). */
export function mountStoreOrdersWithData(container, data = {}) {
    DEPS = {};
    Object.assign(S, { active: data.active || [], todayDone: data.todayDone || [], hist: data.hist || [], histFrom: 0, now: data.now || Date.now(), tab: data.tab || 'live', alert: data.alert || null, error: '' });
    if (data.f) Object.assign(S.f, data.f);
    if (data.cRange) S.cRange = data.cRange;
    if (data.histRange) S.histRange = data.histRange;
    mountStoreOrders(container, { live: false });
    if (data.sound != null) { S.sound = data.sound; }
    S.now = data.now || Date.now();
    render();
    return S;
}
export const __test = { S, rangeFor, startOfDayMs };
