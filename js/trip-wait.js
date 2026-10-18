/**
 * «Pidió hace X min»: cuánto lleva esperando un cliente (viajes) o un pedido de tienda.
 * - La hora es la del servidor (createdAt = serverTimestamp). Si el reloj del teléfono está
 *   corrido, se corrige con lo que se aprende de los viajes nuevos que llegan en vivo.
 * - Nunca muestra tiempos negativos.
 * - Las etiquetas se actualizan solas cada 15 s sin volver a dibujar la tarjeta.
 * Sin imports: lo usan app.js, merchant-stores.js y ops-store-orders.js.
 */
export const WAIT_WARN_MS = 5 * 60e3;
export const WAIT_BAD_MS = 15 * 60e3;
/** Viajes que llevan mucho esperando suben primero si la recogida está a ≤ este radio. */
export const WAIT_PRIORITY_MAX_KM = 5;
const MAX_SKEW_MS = 6 * 3600e3;

export function tsMs(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    if (v instanceof Date) return v.getTime();
    const p = Date.parse(v);
    return Number.isFinite(p) ? p : 0;
}

// ───────── reloj del servidor ─────────
const G = typeof window !== 'undefined' ? window : globalThis;
/** Diferencia servidor − teléfono (ms). Compartida entre instancias del módulo. */
export function getClockOffsetMs() { return Number(G.__hrClockOffsetMs) || 0; }
export function setClockOffsetMs(v) { G.__hrClockOffsetMs = Number.isFinite(v) ? Math.max(-MAX_SKEW_MS, Math.min(MAX_SKEW_MS, v)) : 0; }
export function serverNowMs(localNow = Date.now()) { return localNow + getClockOffsetMs(); }

/**
 * Nueva estimación del desfase a partir de un documento recién creado que llegó en vivo.
 * sample = creado − ahora_local. Un doc recién creado tiene edad real ~0–3 s, así que
 * sample ≈ desfase (un poco menos por la latencia).
 * - sample > actual (el teléfono va atrasado / la hora del doc está «en el futuro»): se acepta tal cual.
 * - sample < actual (el teléfono va adelantado): se acerca poco a poco y solo si está a ≤ 10 min,
 *   para que un viaje de hace rato que llega tarde (reconexión) no mueva el reloj.
 */
export function nextClockOffset(prev, createdMs, localNow) {
    const p = Number.isFinite(prev) ? prev : 0;
    if (!(createdMs > 0)) return p;
    const sample = createdMs - localNow;
    if (Math.abs(sample) > MAX_SKEW_MS) return p;
    if (sample > p) return sample;
    if (p - sample > 10 * 60e3) return p;
    return Math.round(p + (sample - p) * 0.3);
}

/**
 * Aprende del snapshot de viajes (colección completa). Solo usa docs «added» de un snapshot
 * en vivo (no caché, no el primero, ≤ 2 nuevos) y además corrige si hay alguno en el futuro.
 */
export function learnClockFromTripSnap(snap, { isFirst = false, localNow = Date.now() } = {}) {
    if (!snap) return getClockOffsetMs();
    let off = getClockOffsetMs();
    const fromCache = !!snap.metadata?.fromCache;
    let changes = [];
    try { changes = typeof snap.docChanges === 'function' ? snap.docChanges() : []; } catch (_) { changes = []; }
    const added = changes.filter((c) => c.type === 'added' && !c.doc?.metadata?.hasPendingWrites);
    if (!isFirst && !fromCache && added.length > 0 && added.length <= 2) {
        added.forEach((c) => { off = nextClockOffset(off, tsMs(c.doc.data()?.createdAt), localNow); });
    }
    // Cualquier doc con hora «en el futuro» delata que el teléfono va atrasado.
    changes.forEach((c) => {
        if (c.doc?.metadata?.hasPendingWrites) return;
        const ms = tsMs(c.doc?.data?.()?.createdAt);
        if (ms > 0 && ms - localNow > off && ms - localNow < MAX_SKEW_MS) off = ms - localNow;
    });
    setClockOffsetMs(off);
    return off;
}

// ───────── etiquetas ─────────
export function waitMs(sinceMs, now = serverNowMs()) {
    if (!(sinceMs > 0)) return null;
    return Math.max(0, now - sinceMs);
}
export function formatWaitDuration(ms) {
    const mins = Math.floor(Math.max(0, ms) / 60000);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60); const m = mins % 60;
    if (h >= 24) { const d = Math.floor(h / 24); return `${d} d ${h % 24} h`; }
    return m ? `${h} h ${m} min` : `${h} h`;
}
/** «Pidió hace un momento» · «Pidió hace 3 min» · «Pidió hace 1 h 5 min». */
export function formatAgo(ms, verb = 'Pidió') {
    if (ms == null) return '';
    if (ms < 45e3) return `${verb} hace un momento`;
    if (ms < 60e3) return `${verb} hace 1 min`;
    return `${verb} hace ${formatWaitDuration(ms)}`;
}
export function waitTone(ms) {
    if (ms == null) return '';
    if (ms >= WAIT_BAD_MS) return 'bad';
    if (ms >= WAIT_WARN_MS) return 'warn';
    return 'ok';
}
function escAttr(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/**
 * Chip en vivo. `since` en ms (hora del servidor). Devuelve '' si no hay hora.
 * opts.verb: 'Pidió' (viajes) · 'Pedido' (tiendas) · 'Esperando'.
 */
export function waitChipHtml(since, { verb = 'Pidió', now = serverNowMs(), extraClass = '', title = '' } = {}) {
    const ms = waitMs(since, now);
    if (ms == null) return '';
    const tone = waitTone(ms);
    const hint = tone === 'bad' ? ' · lleva mucho esperando' : '';
    return `<span class="hr-wait-chip hr-wait-chip--${tone}${extraClass ? ` ${escAttr(extraClass)}` : ''}" data-hr-wait-since="${since}" data-hr-wait-verb="${escAttr(verb)}"${title ? ` title="${escAttr(title)}"` : ''}><i class="fas fa-clock" aria-hidden="true"></i> <span class="hr-wait-txt">${escAttr(formatAgo(ms, verb))}</span><span class="hr-wait-hint">${hint}</span></span>`;
}

// ───────── viajes ─────────
export function tripCreatedMs(t) {
    if (!t) return 0;
    return tsMs(t.createdAt) || tsMs(t.createdAtMs) || 0;
}
export function isStoreTrip(t) {
    return !!(t && (t.storeOrderId || t.storeDelivery || t.createdByMerchant || t.deliveryDetails?.storeOrderId));
}
/** Pedido de tienda: desde que el cliente hizo el pedido (no desde que la tienda pidió la moto). */
export function tripRequestSinceMs(t) {
    if (!t) return 0;
    if (isStoreTrip(t)) {
        const o = tsMs(t.storeOrderCreatedAtMs) || tsMs(t.deliveryDetails?.orderCreatedAtMs);
        const c = tripCreatedMs(t);
        if (o > 0 && (!c || o <= c)) return o;
        return c;
    }
    return tripCreatedMs(t);
}
export function isScheduledTrip(t) {
    return !!(t && (t.scheduledFor || t.status === 'scheduled'));
}
/**
 * Chip del conductor. Programados: muestra la hora programada (si la manda app.js) en lugar del tiempo.
 */
export function tripWaitChipHtml(t, { now = serverNowMs(), scheduledLabel = '' } = {}) {
    if (!t) return '';
    if (isScheduledTrip(t)) {
        return scheduledLabel
            ? `<span class="hr-wait-chip hr-wait-chip--sched"><i class="fas fa-calendar-alt" aria-hidden="true"></i> Programado · ${escAttr(scheduledLabel)}</span>`
            : '';
    }
    const store = isStoreTrip(t);
    return waitChipHtml(tripRequestSinceMs(t), {
        verb: store ? 'Pedido' : 'Pidió',
        now,
        title: store ? 'Desde que el cliente hizo el pedido en la tienda' : 'Desde que el cliente pidió el viaje',
    });
}

/**
 * Orden de la lista del conductor: primero los que llevan ≥ 15 min esperando con recogida
 * a ≤ 5 km (del que más espera al que menos); luego el resto por cercanía y antigüedad.
 */
export function isLongWaitPriority(t, now = serverNowMs()) {
    if (!t || isScheduledTrip(t)) return false;
    const ms = waitMs(tripRequestSinceMs(t), now);
    if (ms == null || ms < WAIT_BAD_MS) return false;
    const km = t.offerDistanceKm;
    return km == null || !Number.isFinite(Number(km)) || Number(km) <= WAIT_PRIORITY_MAX_KM;
}
export function sortDriverOffers(list, now = serverNowMs()) {
    const arr = Array.isArray(list) ? list.slice() : [];
    return arr.sort((a, b) => {
        const pa = isLongWaitPriority(a, now) ? 1 : 0;
        const pb = isLongWaitPriority(b, now) ? 1 : 0;
        if (pa !== pb) return pb - pa;
        if (pa && pb) return tripRequestSinceMs(a) - tripRequestSinceMs(b);
        const d = (a.offerDistanceKm ?? 999) - (b.offerDistanceKm ?? 999);
        if (d !== 0) return d;
        return tripRequestSinceMs(a) - tripRequestSinceMs(b);
    });
}

// ───────── pedidos de tienda ─────────
const ORDER_WAITING = ['pending', 'accepted', 'preparing', 'ready'];
/** Pedido aún sin entregar: cuánto lleva desde que el cliente lo hizo. '' si ya terminó. */
export function orderWaitChipHtml(o, { now = serverNowMs() } = {}) {
    if (!o || !(ORDER_WAITING.includes(o.status) || o.status === 'out_for_delivery')) return '';
    return waitChipHtml(tsMs(o.createdAt), { verb: 'Pedido', now, title: 'Desde que el cliente hizo el pedido' });
}

// ───────── actualización en vivo ─────────
export function refreshWaitChips(root, now = serverNowMs()) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope?.querySelectorAll) return 0;
    let n = 0;
    scope.querySelectorAll('[data-hr-wait-since]').forEach((el) => {
        const since = Number(el.getAttribute('data-hr-wait-since'));
        const ms = waitMs(since, now);
        if (ms == null) return;
        const verb = el.getAttribute('data-hr-wait-verb') || 'Pidió';
        const tone = waitTone(ms);
        const txt = el.querySelector('.hr-wait-txt');
        const label = formatAgo(ms, verb);
        if (txt && txt.textContent !== label) txt.textContent = label;
        const hint = el.querySelector('.hr-wait-hint');
        if (hint) hint.textContent = tone === 'bad' ? ' · lleva mucho esperando' : '';
        ['ok', 'warn', 'bad'].forEach((k) => el.classList.toggle(`hr-wait-chip--${k}`, k === tone));
        n++;
    });
    return n;
}
export function startWaitTicker(everyMs = 15000) {
    if (typeof window === 'undefined' || window.__hrWaitTicker) return;
    window.__hrWaitTicker = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        refreshWaitChips(document);
    }, everyMs);
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWaitChips(document); });
    }
}

export const WAIT_CHIP_CSS = `
.hr-wait-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;line-height:1.2;padding:3px 8px;border-radius:999px;border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;white-space:nowrap}
.hr-wait-chip i{font-size:10px}
.hr-wait-chip--ok{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
.hr-wait-chip--warn{background:#fffbeb;border-color:#fcd34d;color:#b45309}
.hr-wait-chip--bad{background:#fef2f2;border-color:#fca5a5;color:#b91c1c;animation:hrWaitPulse 2s ease-in-out infinite}
.hr-wait-chip--sched{background:#fff7ed;border-color:#fdba74;color:#c2410c}
.hr-wait-hint:empty{display:none}
.hr-wait-row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}
@keyframes hrWaitPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.0)}50%{box-shadow:0 0 0 4px rgba(239,68,68,.18)}}
@media (prefers-reduced-motion:reduce){.hr-wait-chip--bad{animation:none}}
`;
export function injectWaitChipCss() {
    if (typeof document === 'undefined' || document.getElementById('hr-wait-chip-css')) return;
    const s = document.createElement('style'); s.id = 'hr-wait-chip-css'; s.textContent = WAIT_CHIP_CSS;
    (document.head || document.documentElement).appendChild(s);
}
