/**
 * Panel de supervisor «Viajes» — propuesta de Jack (oct 2026).
 *
 * 5 pestañas: En vivo · Historial · Programados · Por revisar · Papelera.
 * Barra de filtros (ciudad, periodo, servicio, excluir cuentas de prueba/empresa) que manda en todo el panel.
 * 7 indicadores con una sola definición cada uno (ver KPI_DEFS).
 *
 * Datos: el mismo onSnapshot de trips que ya usaba el panel anterior + users / drivers_location /
 * driver_deposit_requests / platformConfig. Las acciones sensibles van por callables con chequeo
 * de staff en el servidor (functions/viajes-panel.js).
 *
 * «Vista anterior» sigue disponible con el enlace del encabezado.
 */

const FS_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
const FN_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
const ADMIN_EMAIL = 'josuesoza0513@gmail.com';
const DAY = 24 * 60 * 60 * 1000;
const ONLINE_STALE_MS = 45 * 60 * 1000;
const TOKEN_MAX_AGE_MS = 60 * DAY;
const DEFAULT_AUTO_RESEND_S = 10;
const TRASH_DAYS = 30;
/** «Ahora · buscando conductor»: a partir de aquí la tarjeta ofrece «Mandar a papelera». */
const STALE_SEARCH_MS = 2 * 60 * 60 * 1000;
const PAGE = 10;

// ───────────────────────── Servicios ─────────────────────────
const svgIcon = (p, c) => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const SVC = {
    moto: { label: 'Moto', color: '#FF5A1F', bg: '#FFEDE5', p: '<circle cx="5.5" cy="16.5" r="3"/><circle cx="18.5" cy="16.5" r="3"/><path d="M5.5 16.5 10 10h5l3.5 6.5M14 6h3l1.5 4"/>' },
    auto: { label: 'Taxi VIP', color: '#7C3AED', bg: '#F1EAFE', p: '<path d="m12 3 2.6 5.6 6 .6-4.5 4 1.3 6L12 16.2l-5.4 3 1.3-6-4.5-4 6-.6z"/>' },
    taxi: { label: 'Taxi tradicional', color: '#0A6CFF', bg: '#E6F0FF', p: '<path d="M3 16v-4l2-5h14l2 5v4z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>' },
    delivery: { label: 'Envío', color: '#00A396', bg: '#DDF6F3', p: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>' },
    flete: { label: 'Flete', color: '#0B1E3F', bg: '#E3E8F2', p: '<path d="M2 6h11v10H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>' },
    grua: { label: 'Grúa', color: '#B07800', bg: '#FFF4D6', p: '<path d="M3 17h10V9h4l4 5v3h-3M7 17V5l9 4v3"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>' },
    hourly: { label: 'Por hora', color: '#12A150', bg: '#E3F6EA', p: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' }
};
const SVC_ORDER = ['moto', 'auto', 'taxi', 'delivery', 'flete', 'grua', 'hourly'];
const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

function svcKey(t) {
    if (!t) return 'auto';
    if (t.bookingType === 'hourly') return 'hourly';
    const s = String(t.serviceType || 'auto');
    if (s === 'flete_paila' || s === 'flete_camion') return 'flete';
    return SVC[s] ? s : 'auto';
}
function svcIcon(k, size = 28) {
    const m = SVC[k] || SVC.auto;
    return `<span class="vj-svc" style="background:${m.bg};width:${size}px;height:${size}px">${svgIcon(m.p, m.color)}</span>`;
}
function svcLabel(t) {
    const k = svcKey(t);
    if (k === 'flete') return t.serviceType === 'flete_camion' ? 'Flete · camión' : 'Flete · paila';
    return SVC[k].label;
}

// ───────────────────────── Utilidades ─────────────────────────
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function tsMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') { const n = Date.parse(v); return Number.isFinite(n) ? n : 0; }
    return 0;
}
const createdMs = (t) => tsMs(t.createdAt) || Number(t.createdAtMs) || 0;
const n2 = (n) => (Math.round((Number(n) || 0) * 100) / 100);
function fmtL(n, dec = 2) {
    const v = Number(n) || 0;
    return `L ${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}
function fmtL0(n) {
    const v = Number(n) || 0;
    return Math.abs(v - Math.round(v)) < 0.005 ? fmtL(v, 0) : fmtL(v, 2);
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtTime(ms, withSec = false) {
    if (!ms) return '—';
    const d = new Date(ms);
    let h = d.getHours();
    const ap = h >= 12 ? 'p. m.' : 'a. m.';
    h = h % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = withSec ? `:${String(d.getSeconds()).padStart(2, '0')}` : '';
    return `${h}:${mm}${ss} ${ap}`;
}
function fmtClock(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
const fmtDay = (ms) => { if (!ms) return '—'; const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`; };
const fmtDayShort = (ms) => { if (!ms) return '—'; const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtDateTime = (ms) => (ms ? `${fmtDay(ms)} ${fmtTime(ms)}` : '—');
const fmtDayYear = (ms) => { if (!ms) return '—'; const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
function fmtDur(msDiff) {
    const s = Math.max(0, Math.round(msDiff / 1000));
    if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtWait(msDiff) {
    const s = Math.max(0, Math.round(msDiff / 1000));
    if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
    if (s >= 60) return `${Math.floor(s / 60)} min ${s % 60} s`;
    return `${s} s`;
}
const shortId = (id) => `#${String(id || '').slice(0, 6).toUpperCase()}`;
function median(arr) {
    if (!arr.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function haversineKm(a, b, c, d) {
    const R = 6371;
    const toR = (x) => (x * Math.PI) / 180;
    const dLat = toR(c - a);
    const dLng = toR(d - b);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const keysOf = (o) => (o && typeof o === 'object' ? (Array.isArray(o) ? o.map((v) => v?.driverId || v).filter(Boolean) : Object.keys(o)) : []);
const isCancelled = (t) => t.status === 'cancelled' || t.status === 'canceled';
function priceOf(t) {
    try {
        const p = window.parseTripPrice?.(t);
        if (Number.isFinite(p) && p > 0) return p;
    } catch (_) {}
    if (t.negotiatedPrice != null && Number.isFinite(Number(t.negotiatedPrice))) return Number(t.negotiatedPrice);
    if (Number.isFinite(Number(t.priceNum))) return Number(t.priceNum);
    const m = String(t.price || '').replace(/,/g, '').match(/[\d.]+/);
    return m ? Number(m[0]) || 0 : 0;
}
function kmOf(t) {
    const k = Number(t.tripDistanceKm ?? t.distanceKm ?? t.routeDistanceKm);
    return Number.isFinite(k) ? k : 0;
}
function slug(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function cityOf(t) {
    const name = t.cityName || t.serviceZoneName || '';
    const key = t.cityId || t.serviceZoneId || slug(name) || 'sin-ciudad';
    const us = t.market === 'us' || String(key).startsWith('us-') || /,\s*CA$|San Jose/i.test(name);
    return { key, name: name || 'Sin ciudad', us };
}
function scheduledMs(t) {
    return tsMs(t.scheduledFor) || 0;
}
function isFutureScheduled(t, now = Date.now()) {
    const s = scheduledMs(t);
    return !!s && s > now - 30 * 60 * 1000 && (t.status === 'scheduled' || (t.status === 'pending' && s > now + 15 * 60 * 1000));
}
function isSearching(t, now = Date.now()) {
    if (t.status !== 'pending' || t.driverId || t.isDemandSimulation) return false;
    if (t.trashedAtMs) return false;
    const s = scheduledMs(t);
    if (s && s > now + 15 * 60 * 1000) return false;
    return true;
}
const isActiveRide = (t) => !t.trashedAtMs && (t.status === 'accepted' || t.status === 'in_progress');
const notifiedIds = (t) => (Array.isArray(t.alertNotifiedDriverIds) ? t.alertNotifiedDriverIds : []);
const notifiedCount = (t) => notifiedIds(t).length || Number(t.eligibleDriverAlertCount) || 0;
const deliveredIds = (t) => keysOf(t.deliveredTo);
const fcmOkCount = (t) => (Array.isArray(t.alertFcmOkDriverIds) ? t.alertFcmOkDriverIds.length : (Number(t.eligibleDriverAlertPushed) || 0));
const viewerIds = (t) => keysOf(t.viewedBy);
const bidIds = (t) => keysOf(t.driverBids);
function firstViewMs(t) {
    const v = t.viewedBy;
    if (!v || typeof v !== 'object') return 0;
    let min = 0;
    Object.values(v).forEach((e) => {
        const m = tsMs(e?.viewedAt) || tsMs(e?.lastViewedAt);
        if (m && (!min || m < min)) min = m;
    });
    return min;
}
function placeOf(t, which) {
    const v = t[`${which}PlaceName`] || t[which] || t[`${which}Text`] || t[`${which}FormattedAddress`] || '';
    const str = typeof v === 'string' ? v : (v?.name || v?.address || '');
    return str ? str.split(',')[0].trim() : (which === 'destination' && t.bookingType === 'hourly' ? `${Number(t.hours || t.hourlyHours || 0) || ''} horas`.trim() : '—');
}
const chatOf = (t) => (Array.isArray(t.chat) ? t.chat.filter((m) => m && m.sender !== 'system') : []);
const cancelledByPassenger = (t) => isCancelled(t) && !!t.cancelledBy && t.cancelledBy === t.clientId;
function rateStars(t) {
    const s = Number(t.ratedByClientStars ?? t.staffRatedDriverStars);
    return Number.isFinite(s) && s > 0 ? s : null;
}

// ───────────────────────── Teléfonos / avisos ─────────────────────────
function tokenRecords(u) {
    if (!u || typeof u !== 'object') return [];
    const out = [];
    const push = (e) => { if (e && typeof e === 'object' && e.token) out.push(e); };
    if (u.fcmTokens && typeof u.fcmTokens === 'object') Object.values(u.fcmTokens).forEach(push);
    Object.keys(u).forEach((k) => { if (k.startsWith('fcmTokens.')) push(u[k]); });
    const now = Date.now();
    return out
        .filter((e) => !(Number(e.updatedAt) > 0) || now - Number(e.updatedAt) <= TOKEN_MAX_AGE_MS)
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
}
function deviceClass(rec) {
    if (!rec) return { key: 'none', label: 'Sin avisos activados' };
    const plat = String(rec.platform || '').toLowerCase();
    const brand = String(rec.brand || '').toLowerCase();
    const model = String(rec.model || '');
    const ua = String(rec.ua || '');
    if (plat === 'ios-pwa' || plat === 'ios' || brand === 'apple' || /iPhone|iPad/i.test(model + ua)) return { key: 'iphone', label: 'iPhone' };
    if (brand === 'samsung' || /^SM-/i.test(model)) {
        if (/^SM-S92/i.test(model)) return { key: 'samsung-s24', label: 'Samsung S24' };
        return { key: 'samsung', label: 'Samsung (otros)' };
    }
    if (brand === 'tcl' || /^T\d{3}/i.test(model)) return { key: 'tcl', label: 'Android · TCL' };
    if (plat === 'android' || brand || /Android/i.test(ua)) return { key: 'android', label: 'Otros Android' };
    if (plat === 'web') return { key: 'web', label: 'Web / PC' };
    return { key: 'android', label: 'Otros Android' };
}
function deviceLabel(rec) {
    if (!rec) return 'Sin avisos';
    const c = deviceClass(rec);
    const os = rec.osVersion ? ` · ${c.key === 'iphone' ? 'iOS' : 'Android'} ${rec.osVersion}` : '';
    const model = rec.model && c.key !== 'iphone' ? ` (${rec.model})` : '';
    return `${c.label}${model}${os}`;
}
const DEVICE_ORDER = ['tcl', 'iphone', 'samsung-s24', 'samsung', 'android', 'web', 'none'];

// ───────────────────────── KPI ─────────────────────────
const KPI_DEFS = {
    requests: 'Solicitudes: toda petición de viaje creada en el periodo (completados + cancelados + activos). Sin simulaciones de demanda.',
    completed: 'Completados: viajes con estado «completado» (llegaron a destino) creados en el periodo.',
    acceptance: 'Tasa de aceptación: solicitudes que consiguieron conductor (tienen conductor asignado) ÷ solicitudes.',
    cancelNoDriver: 'Cancelados sin conductor: cancelados antes de que un conductor aceptara. «Nadie lo vio» = ningún conductor abrió la solicitud.',
    assignTime: 'Tiempo de asignación: promedio desde «solicitado» hasta «aceptado», solo viajes inmediatos (no programados).',
    revenue: 'Ingresos: suma del precio de los viajes completados del periodo (lo que pagó el pasajero).',
    commission: 'Comisión: por viaje completado, el monto guardado al completarlo; si no hay, precio × % de su servicio (Ajustes de comisión).'
};
const info = (k) => `<span class="vj-info" tabindex="0" data-tip="${esc(KPI_DEFS[k])}">i</span>`;

// ───────────────────────── Estado ─────────────────────────
const ST = {
    trips: [], users: new Map(), locs: new Map(), deposits: [], config: {}, appSettings: {},
    loadedTrips: false, now: Date.now()
};
const UI_KEY = 'hr_vj_ui_v1';
const UI = Object.assign({
    tab: 'live', city: 'all', period: 'month', from: '', to: '', svc: 'all', excludeTest: false,
    histPage: 1, histSize: PAGE, histQ: '', reviewChip: 'all', detailId: null
}, (() => { try { return JSON.parse(sessionStorage.getItem(UI_KEY) || '{}'); } catch (_) { return {}; } })());
const SEL = { review: new Set(), trash: new Set() };
let DEPS = {};
let mounted = null; // { container, root, kind, unsubs: [] }
let tickTimer = null;
let refreshTimer = null;
let renderQueued = false;
let popTrashFor = null;
const pinShown = {};

function saveUi() {
    try {
        const { tab, city, period, from, to, svc, excludeTest, reviewChip } = UI;
        sessionStorage.setItem(UI_KEY, JSON.stringify({ tab, city, period, from, to, svc, excludeTest, reviewChip }));
    } catch (_) {}
}
function me() { return DEPS.getCurrentUser?.() || null; }
function myProfile() { return DEPS.getUserProfile?.() || {}; }
function isAdmin() {
    try { if (DEPS.isAdminUser) return !!DEPS.isAdminUser(me(), myProfile()); } catch (_) {}
    return me()?.email === ADMIN_EMAIL;
}
function toast(msg, type = 'info') {
    if (typeof window.showToast === 'function') return window.showToast(msg, type);
    const el = document.createElement('div');
    el.className = 'vj-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
    return null;
}
async function callFn(name, data) {
    if (DEPS.callFn) return DEPS.callFn(name, data);
    const { httpsCallable } = await import(FN_URL);
    const res = await httpsCallable(DEPS.functions || window.cloudFunctions, name)(data);
    return res?.data ?? res;
}
function errMsg(e) {
    const m = String(e?.message || e || '');
    return m.replace(/^Firebase: /, '').replace(/\(functions\/[a-z-]+\)\.?/, '').trim() || 'No se pudo completar.';
}

// ───────────────────────── Cuentas de prueba / empresa ─────────────────────────
function testInfo(uid) {
    if (!uid) return null;
    const u = ST.users.get(uid);
    if (!u) return null;
    if (u.isTestAccount === true) return { kind: u.testAccountKind === 'company' ? 'company' : 'test', excluded: true };
    if (u.isTestDriver || (ST.appSettings.testDriverUid && ST.appSettings.testDriverUid === uid)) return { kind: 'test', excluded: true };
    const role = String(u.role || '').toLowerCase();
    if (role === 'admin' || role === 'supervisor' || u.email === ADMIN_EMAIL) return { kind: 'company', excluded: true };
    if (/prueba|test/i.test(String(u.name || ''))) return { kind: 'suggest', excluded: false };
    return null;
}
function tripTestKind(t) {
    const a = testInfo(t.clientId);
    const b = testInfo(t.driverId);
    if (t.isDemandSimulation) return 'test';
    if (a?.excluded) return a.kind;
    if (b?.excluded) return b.kind;
    return null;
}

// ───────────────────────── Comisión ─────────────────────────
function rulePct(key) {
    const by = ST.config.commissionByService || {};
    const v = Number(by[key]);
    if (by[key] != null && by[key] !== '' && Number.isFinite(v)) return v;
    const g = Number(ST.config.commissionPercentage);
    return Number.isFinite(g) ? g : (Number(window.APP_CONFIG?.commissionPercent) || 0);
}
function tripCommission(t) {
    const price = priceOf(t);
    const stored = Number(t.commissionPercent);
    const hasStored = t.commissionPercent != null && Number.isFinite(stored);
    const p = hasStored ? stored : rulePct(svcKey(t));
    const amt = t.commissionAmount != null && Number.isFinite(Number(t.commissionAmount)) ? Number(t.commissionAmount) : price * p / 100;
    const rule = rulePct(svcKey(t));
    // 0% por cumpleaños / día libre no es «distinto a la regla»
    const waived = !!(t.commissionFreeDay || t.commissionWaivedBirthday || t.birthdayFree);
    return { pct: p, amount: n2(amt), rule, differs: hasStored && !waived && Math.abs(stored - rule) > 0.01 };
}
function autoResendS() {
    const v = Number(ST.config.autoResendSeconds);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_AUTO_RESEND_S;
}

// ───────────────────────── Filtros ─────────────────────────
function periodRange() {
    const now = new Date();
    const end = now.getTime();
    const sod = new Date(now); sod.setHours(0, 0, 0, 0);
    if (UI.period === 'today') return [sod.getTime(), end];
    if (UI.period === 'week') return [sod.getTime() - 6 * DAY, end];
    if (UI.period === 'month') return [sod.getTime() - 29 * DAY, end];
    const f = UI.from ? new Date(`${UI.from}T00:00:00`).getTime() : 0;
    const t = UI.to ? new Date(`${UI.to}T23:59:59`).getTime() : end;
    return [f || 0, t || end];
}
function passCity(t) { return UI.city === 'all' || cityOf(t).key === UI.city; }
function passSvc(t) { return UI.svc === 'all' || svcKey(t) === UI.svc; }
function passTest(t) { return !UI.excludeTest || !tripTestKind(t); }
function passPeriod(t, rng) { const c = createdMs(t); return c >= rng[0] && c <= rng[1]; }
function baseTrips() { return ST.trips.filter((t) => !t.isDemandSimulation && !cityOf(t).us); }
function filtered({ period = true, trash = 'include' } = {}) {
    const rng = periodRange();
    return baseTrips().filter((t) => passCity(t) && passSvc(t) && passTest(t)
        && (!period || passPeriod(t, rng))
        && (trash === 'include' || (trash === 'exclude' ? !t.trashedAtMs : !!t.trashedAtMs)));
}
function cityList() {
    const m = new Map();
    baseTrips().forEach((t) => {
        const c = cityOf(t);
        if (c.key === 'sin-ciudad') return;
        const prev = m.get(c.key) || { key: c.key, name: c.name, n: 0 };
        prev.n += 1;
        m.set(c.key, prev);
    });
    return [...m.values()].sort((a, b) => b.n - a.n);
}

// ───────────────────────── Cálculos ─────────────────────────
function computeKpis(list) {
    const req = list.filter((t) => t.status !== 'scheduled' || t.driverId);
    const completed = req.filter((t) => t.status === 'completed');
    const withDriver = req.filter((t) => !!t.driverId || !!tsMs(t.acceptedAt));
    const cancNo = req.filter((t) => isCancelled(t) && !t.driverId && !tsMs(t.acceptedAt));
    const nobodySaw = cancNo.filter((t) => viewerIds(t).length === 0).length;
    const assign = req
        .filter((t) => !scheduledMs(t) && tsMs(t.acceptedAt) && createdMs(t))
        .map((t) => tsMs(t.acceptedAt) - createdMs(t))
        .filter((d) => d >= 0 && d < 6 * 3600 * 1000);
    const revenue = completed.reduce((s, t) => s + priceOf(t), 0);
    const comm = completed.map(tripCommission);
    const commission = comm.reduce((s, c) => s + c.amount, 0);
    const differs = comm.filter((c) => c.differs).length;
    return {
        requests: req.length, completed: completed.length, withDriver: withDriver.length,
        acceptance: pct(withDriver.length, req.length), cancNo: cancNo.length, nobodySaw,
        assignAvgMs: assign.length ? assign.reduce((a, b) => a + b, 0) / assign.length : 0,
        assignMedMs: median(assign), assignN: assign.length,
        revenue, commission, commissionDiffers: differs,
        commissionPct: revenue ? (commission / revenue) * 100 : 0
    };
}

function computeOwing() {
    // Misma regla que Estadísticas: hueco 7 d = comisión de viajes en efectivo − cubierto por saldo − depósitos aprobados;
    // se compara con la deuda guardada en el perfil y se toma la mayor.
    const now = Date.now();
    const since = now - 7 * DAY;
    const cash = {};
    const saldo = {};
    ST.trips.forEach((t) => {
        if (t.status !== 'completed' || !t.driverId || t.trashedAtMs) return;
        const at = tsMs(t.completedAt) || createdMs(t);
        if (!at || at < since) return;
        const c = tripCommission(t);
        const free = t.commissionWaivedBirthday || t.birthdayFree || t.paymentMethod === 'birthday_gift';
        if (t.paymentMethod === 'saldo' || free) {
            if (!free) saldo[t.driverId] = (saldo[t.driverId] || 0) + c.amount;
            return;
        }
        const r = cash[t.driverId] || (cash[t.driverId] = { due: 0, oldest: at, name: t.driverName || '' });
        r.due += c.amount;
        r.oldest = Math.min(r.oldest, at);
    });
    const dep = {};
    ST.deposits.forEach((d) => {
        if (d.status !== 'approved' || !d.driverId) return;
        const at = tsMs(d.approvedAt) || tsMs(d.createdAt);
        if (at && at < since) return;
        dep[d.driverId] = (dep[d.driverId] || 0) + (Number(d.amount) || 0);
    });
    const ids = new Set(Object.keys(cash));
    ST.users.forEach((u, uid) => {
        const role = String(u.role || '').toLowerCase();
        if (role && role !== 'driver' && role !== 'conductor') return;
        if ((Number(u.pendingDepositDebt) || 0) > 0.009 || (Number(u.driverLastDepositOwed) || 0) > 0.009 || u.depositAutoBlocked) ids.add(uid);
    });
    const out = [];
    ids.forEach((uid) => {
        const u = ST.users.get(uid) || {};
        const c = cash[uid] || { due: 0, oldest: 0, name: '' };
        const gap = Math.max(0, n2(c.due - (saldo[uid] || 0) - (dep[uid] || 0)));
        const debt = Math.max(0, Number(u.pendingDepositDebt) || 0, Number(u.driverLastDepositOwed) || 0);
        const amount = n2(Math.max(gap, debt));
        if (amount < 0.01) return;
        const sinceMs = c.oldest || tsMs(u.driverDepositWorkStartAt) || 0;
        const days = sinceMs ? Math.floor((now - sinceMs) / DAY) : 0;
        out.push({
            uid, name: u.name || c.name || 'Conductor', amount, since: sinceMs, days,
            overdue: !!u.depositAutoBlocked || days >= 2, blocked: !!u.depositAutoBlocked, test: testInfo(uid)
        });
    });
    out.sort((a, b) => (b.overdue - a.overdue) || (b.amount - a.amount));
    return UI.excludeTest ? out.filter((o) => !o.test?.excluded) : out;
}

function computeHealth(list) {
    const now = Date.now();
    const recent = list.filter((t) => createdMs(t) >= now - 7 * DAY);
    const by = new Map();
    const get = (key, label) => {
        if (!by.has(key)) by.set(key, { key, label, drivers: new Set(), notified: 0, delivered: 0, viewed: 0, tests: [], noToken: 0 });
        return by.get(key);
    };
    const driverClass = (uid) => {
        const u = ST.users.get(uid);
        const rec = tokenRecords(u)[0];
        return rec ? deviceClass(rec) : { key: 'none', label: 'Sin avisos activados' };
    };
    ST.users.forEach((u, uid) => {
        if (String(u.role || '').toLowerCase() !== 'driver') return;
        if (UI.excludeTest && testInfo(uid)?.excluded) return;
        const c = driverClass(uid);
        const g = get(c.key, c.label);
        g.drivers.add(uid);
        if (c.key === 'none') g.noToken += 1;
        if (u.lastPushTest) g.tests.push({ uid, name: u.name, ...u.lastPushTest });
    });
    recent.forEach((t) => {
        const del = new Set(deliveredIds(t));
        const vw = new Set(viewerIds(t));
        const bd = new Set(bidIds(t));
        notifiedIds(t).forEach((uid) => {
            const c = driverClass(uid);
            const g = get(c.key, c.label);
            g.notified += 1;
            if (del.has(uid) || vw.has(uid) || bd.has(uid) || t.driverId === uid) g.delivered += 1;
            if (vw.has(uid) || bd.has(uid) || t.driverId === uid) g.viewed += 1;
        });
    });
    const groups = [...by.values()].map((g) => {
        const rate = g.notified ? pct(g.delivered, g.notified) : null;
        const lastTest = g.tests.sort((a, b) => (b.sentAtMs || 0) - (a.sentAtMs || 0))[0] || null;
        return { ...g, nDrivers: g.drivers.size, rate, lastTest };
    }).sort((a, b) => DEVICE_ORDER.indexOf(a.key) - DEVICE_ORDER.indexOf(b.key));
    let online = 0;
    let onlineFresh = 0;
    ST.locs.forEach((l, uid) => {
        if (UI.excludeTest && testInfo(uid)?.excluded) return;
        if (l.online === false || l.isOnline === false) return;
        const at = tsMs(l.updatedAt) || tsMs(l.lastUpdate) || Number(l.updatedAtMs) || 0;
        if (!at || now - at > ONLINE_STALE_MS) return;
        online += 1;
        if (now - at < 5 * 60 * 1000) onlineFresh += 1;
    });
    return { groups, online, onlineFresh };
}

function possibleCause(t) {
    const n = notifiedCount(t);
    const v = viewerIds(t).length;
    const b = bidIds(t).length;
    const d = deliveredIds(t).length;
    if (t.status === 'completed') {
        if (rateStars(t) == null && !t.ratedByClient) return { text: 'Viaje completado y el pasajero no calificó. Revise que todo estuvo bien.', level: 'warn' };
        if ((rateStars(t) || 5) <= 3) return { text: `El pasajero calificó ${rateStars(t)} ★. Revise el chat y contacte al pasajero.`, level: 'bad' };
        return { text: 'Completado sin novedades.', level: 'ok' };
    }
    if (isCancelled(t)) {
        if (t.driverId) return { text: cancelledByPassenger(t) ? 'El pasajero canceló con conductor asignado.' : 'Se canceló con conductor asignado. Revise el chat.', level: 'warn' };
        if (n === 0) return { text: 'No había conductores elegibles a quién avisar (fuera de zona o ninguno conectado).', level: 'bad' };
        if (v === 0 && d === 0) return { text: `Se avisó a ${n} conductores pero el aviso no les llegó o no lo abrieron. Revise «Salud de avisos».`, level: 'bad' };
        if (v === 0) return { text: `Al menos a ${d} les llegó el aviso, pero nadie abrió la solicitud.`, level: 'bad' };
        if (b === 0) return { text: `${v} conductor(es) lo vieron pero nadie ofertó. Posible precio bajo o distancia larga.`, level: 'warn' };
        return { text: `${b} oferta(s), pero el pasajero no aceptó ninguna.`, level: 'warn' };
    }
    if (isSearching(t)) {
        if (n === 0) return { text: 'Aún no se avisó a ningún conductor elegible.', level: 'bad' };
        if (v === 0) return { text: 'Avisado, nadie lo ha abierto todavía.', level: 'warn' };
        if (b === 0) return { text: 'Lo vieron, nadie ofertó todavía.', level: 'warn' };
        return { text: 'Hay ofertas esperando que el pasajero elija.', level: 'ok' };
    }
    return { text: '', level: 'ok' };
}

const REVIEW_CHIPS = [
    { k: 'all', l: 'Todos' },
    { k: 'nobody', l: 'Nadie lo vio', red: true },
    { k: 'nodriver', l: 'Sin conductor' },
    { k: 'passenger', l: 'Canceló pasajero' },
    { k: 'withdriver', l: 'Con conductor' },
    { k: 'unrated', l: 'Sin calificar' }
];
function reviewKinds(t) {
    const out = [];
    if (isCancelled(t)) {
        if (!t.driverId && viewerIds(t).length === 0) out.push('nobody');
        if (!t.driverId) out.push('nodriver');
        if (cancelledByPassenger(t)) out.push('passenger');
        if (t.driverId) out.push('withdriver');
    } else if (t.status === 'completed') {
        if (rateStars(t) == null && !t.ratedByClient) out.push('unrated');
        else if ((rateStars(t) || 5) <= 3) out.push('withdriver');
    }
    return out;
}
function reviewQueue() {
    return filtered({ trash: 'exclude' })
        .filter((t) => !t.staffReviewedAtMs && reviewKinds(t).length)
        .sort((a, b) => createdMs(b) - createdMs(a));
}
function personName(uid, fallback) {
    const u = uid ? ST.users.get(uid) : null;
    return u?.name || u?.displayName || fallback || '—';
}
const clientName = (t) => t.clientName || personName(t.clientId, 'Pasajero');
const driverName = (t) => t.driverName || personName(t.driverId, '');
function statusTag(t) {
    if (t.trashedAtMs) return '<span class="vj-tag dark">En papelera</span>';
    if (t.status === 'completed') return '<span class="vj-tag ok">Completado</span>';
    if (isCancelled(t)) {
        if (!t.driverId && viewerIds(t).length === 0) return '<span class="vj-tag bad">Cancelado · nadie lo vio</span>';
        if (!t.driverId) return '<span class="vj-tag bad">Cancelado · sin conductor</span>';
        return `<span class="vj-tag warn">Cancelado ${cancelledByPassenger(t) ? 'por pasajero' : 'con conductor'}</span>`;
    }
    if (t.status === 'in_progress') return '<span class="vj-tag blue">En curso</span>';
    if (t.status === 'accepted') return '<span class="vj-tag blue">Conductor en camino</span>';
    if (t.status === 'scheduled' || isFutureScheduled(t)) return '<span class="vj-tag pur">Programado</span>';
    if (t.status === 'pending') return '<span class="vj-tag warn">Buscando</span>';
    return `<span class="vj-tag">${esc(t.status || '—')}</span>`;
}
function testTag(t) {
    const k = tripTestKind(t);
    if (k === 'test') return ' <span class="vj-tag warn">Prueba</span>';
    if (k === 'company') return ' <span class="vj-tag">Empresa</span>';
    return '';
}

// ───────────────────────── Render: encabezado / filtros ─────────────────────────
const IC_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const IC_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const IC_SEARCH = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#6B7690" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const IC_RESEND = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>';
const IC_WARN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="#E8A400"><path d="M12 2 1 21h22z"/><path d="M12 9v5M12 17v.5" stroke="#fff" stroke-width="2.4"/></svg>';

function tabsCounts() {
    const now = Date.now();
    const all = filtered({ period: false, trash: 'exclude' });
    const inPeriod = filtered({ trash: 'exclude' });
    return {
        live: all.filter((t) => isSearching(t, now) || isActiveRide(t)).length,
        hist: inPeriod.filter((t) => t.status === 'completed' || isCancelled(t)).length,
        sched: all.filter((t) => isFutureScheduled(t, now)).length,
        review: reviewQueue().length,
        trash: baseTrips().filter((t) => t.trashedAtMs && passCity(t) && passSvc(t)).length,
        push: PUSH.data ? (PUSH.data.counts.total - PUSH.data.counts.active) : 0,
        rate: (() => { try { const r = rateStats(); return r && r.total.rate != null ? `${Math.round(r.total.rate)}%` : '—'; } catch (_) { return '—'; } })(),
        avail: (() => { try { return DEPS.avail ? availRows(availCityKey()).filter((x) => !x.r.available).length : 0; } catch (_) { return 0; } })()
    };
}
function periodLabel() {
    const [a, b] = periodRange();
    if (UI.period === 'today') return `Hoy · ${fmtDayShort(b)}`;
    return `${fmtDayShort(a)} – ${fmtDayShort(b)} ${new Date(b).getFullYear()}`;
}
function renderTop() {
    const cities = cityList();
    const counts = tabsCounts();
    const cityName = UI.city === 'all' ? 'Todas las ciudades' : (cities.find((c) => c.key === UI.city)?.name || UI.city);
    const svcCounts = {};
    filtered({ trash: 'exclude' }).forEach((t) => { const k = svcKey(t); svcCounts[k] = (svcCounts[k] || 0) + 1; });
    const chip = (k, label, icon) => `<button class="vj-chip ${UI.svc === k ? 'on' : ''}" data-act="svc" data-v="${k}">${icon || ''}${esc(label)}</button>`;
    const svcChips = [chip('all', 'Todos los servicios')]
        .concat(SVC_ORDER.map((k) => chip(k, SVC[k].label, svcIcon(k, 18)))).join('');
    const cityLine = cities.length
        ? `Ciudades: ${cities.slice(0, 3).map((c) => esc(c.name)).join(' · ')}${cities.length > 3 ? ' · …' : ''} <span class="vj-mut">(sin «San Jose, CA»)</span>`
        : '';
    const seg = [['today', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'], ['range', 'Rango']]
        .map(([k, l]) => `<button class="${UI.period === k ? 'on' : ''}" data-act="period" data-v="${k}">${l}</button>`).join('');
    const tab = (k, l, n, red) => `<button class="${UI.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l} <b class="${red && n ? 'r' : ''}">${n}</b></button>`;
    return `
    <div class="vj-top">
      <div class="vj-row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div class="vj-h1">Viajes</div>
          <div class="vj-sub">Panel de supervisor · se actualiza solo cada 10 s · <span class="vj-classic" data-act="classic">Vista anterior</span>${isAdmin() ? ' · <span class="vj-classic" data-act="settings">Ajustes › Comisiones</span>' : ''}</div>
        </div>
        <div class="vj-row">
          <label class="vj-sel dark">${IC_PIN}<span>${esc(cityName)} ▾</span>
            <select data-act="city" aria-label="Ciudad">
              <option value="all" ${UI.city === 'all' ? 'selected' : ''}>Todas las ciudades</option>
              ${cities.map((c) => `<option value="${esc(c.key)}" ${UI.city === c.key ? 'selected' : ''}>${esc(c.name)} (${c.n})</option>`).join('')}
            </select></label>
          <div class="vj-seg">${seg}</div>
          <span class="vj-range ${UI.period === 'range' ? 'on' : ''}">
            <input type="date" data-act="from" value="${esc(UI.from)}"><input type="date" data-act="to" value="${esc(UI.to)}"></span>
          <span class="vj-sel vj-hide-m">${IC_CAL}<span>${periodLabel()}</span></span>
        </div>
      </div>
      <div class="vj-chips scroll" style="margin-top:10px">${svcChips}</div>
      <div class="vj-row" style="justify-content:space-between;margin-top:9px">
        <button class="vj-tog ${UI.excludeTest ? 'on' : ''}" data-act="excludeTest"><i></i>Excluir cuentas de prueba y de la empresa</button>
        <span class="vj-row" style="gap:12px"><span class="vj-link vj-sub" data-act="testAccounts" style="font-weight:600">Cuentas de prueba…</span><span class="vj-sub vj-hide-m">${cityLine}</span></span>
      </div>
    </div>
    <div class="vj-tabs">
      ${tab('live', 'En vivo', counts.live)}${tab('hist', 'Historial', counts.hist)}${tab('sched', 'Programados', counts.sched)}${tab('review', 'Por revisar', counts.review, true)}${tab('trash', 'Papelera', counts.trash)}${tab('push', 'Avisos', counts.push, true)}${tab('rate', 'Tasa de aceptación', counts.rate)}${tab('avail', 'Disponibilidad', counts.avail, true)}
    </div>`;
}

function renderKpis(k) {
    const avg = k.assignAvgMs;
    const m = Math.floor(avg / 60000);
    const s = Math.round((avg % 60000) / 1000);
    const commHead = (() => {
        const by = ST.config.commissionByService || {};
        const vals = new Set(SVC_ORDER.map((x) => rulePct(x)));
        return vals.size === 1 && !Object.keys(by).length ? `Comisión ${rulePct('auto')}%` : 'Comisión';
    })();
    const owing = computeOwing();
    const owingTotal = owing.reduce((a, o) => a + o.amount, 0);
    return `
    <div class="vj-kpis">
      <div class="vj-kpi"><div class="l">Solicitudes ${info('requests')}</div><div class="v num">${k.requests}</div>
        <div class="d">Toda petición creada en el periodo (${k.completed} completados + ${k.requests - k.completed} otros).</div></div>
      <div class="vj-kpi"><div class="l">Completados ${info('completed')}</div><div class="v num">${k.completed}</div>
        <div class="d">Llegaron a destino.${k.completed ? ` Promedio ${fmtL0(k.revenue / k.completed)}.` : ''}</div></div>
      <div class="vj-kpi"><div class="l">Tasa de aceptación ${info('acceptance')}</div><div class="v num">${k.acceptance}%</div>
        <div class="d">Solicitudes que consiguieron conductor (${k.withDriver} de ${k.requests}).</div></div>
      <div class="vj-kpi ${k.cancNo ? 'alert' : ''}"><div class="l">Cancel. sin conductor ${info('cancelNoDriver')}</div>
        <div class="v num" style="color:${k.cancNo ? 'var(--bad)' : 'inherit'}">${k.cancNo}</div>
        ${k.nobodySaw ? `<span class="vj-hl">${k.nobodySaw} nadie lo vio</span>` : ''}
        <div class="d">${k.cancNo - k.nobodySaw} los vio alguien pero nadie aceptó.</div></div>
      <div class="vj-kpi"><div class="l">Tiempo de asignación ${info('assignTime')}</div>
        <div class="v num">${k.assignN ? `${m}:${String(s).padStart(2, '0')} <small>min</small>` : '—'}</div>
        <div class="d">Promedio de «solicitado» a «aceptado»${k.assignN ? ` · mediana ${fmtDur(k.assignMedMs)}` : ''}.</div></div>
      <div class="vj-kpi"><div class="l">Ingresos ${info('revenue')}</div><div class="v num">${fmtL0(k.revenue)}</div>
        <div class="d">Suma de viajes completados del periodo.</div></div>
      <div class="vj-kpi"><div class="l">${commHead} ${info('commission')}</div><div class="v num">${fmtL0(k.commission)}</div>
        <div class="d">${k.revenue ? `${k.commissionPct.toFixed(1)}% de ingresos` : 'Sin viajes completados'}${owing.length ? ` · ${owing.length} conductor${owing.length > 1 ? 'es' : ''} deben ${fmtL0(owingTotal)}` : ''}.</div></div>
    </div>`;
}

function renderCommissionBar(k) {
    const by = ST.config.commissionByService || {};
    const rules = SVC_ORDER.filter((x) => by[x] != null && by[x] !== '').map((x) => `${SVC[x].label} ${rulePct(x)}%`);
    const general = rulePct('__general__');
    const admin = isAdmin();
    const link = admin ? '<a data-act="settings">Ajustes › Comisiones</a>' : '<b>Ajustes › Comisiones</b> (solo admin)';
    if (k.commissionDiffers) {
        return `<div class="vj-warnbar" style="margin:-4px 0 14px">${IC_WARN}<span><b>Comisión distinta a la regla:</b> ${k.commissionDiffers} viaje(s) del periodo guardaron un % diferente al de su servicio hoy (general ${general}%${rules.length ? ` · ${rules.join(' · ')}` : ''}). Los totales usan el % guardado en cada viaje. ${link}.</span></div>`;
    }
    return `<div class="vj-warnbar blue" style="margin:-4px 0 14px"><span><b>Comisión:</b> general ${general}%${rules.length ? ` · ${rules.join(' · ')}` : ' para todos los servicios'} · Reenvío automático a los ${autoResendS()} s sin ofertas. ${link}.</span></div>`;
}

// ───────────────────────── Render: En vivo ─────────────────────────
function badDeviceKeys(health) {
    return new Set(health.groups.filter((g) => (g.rate != null && g.rate < 50) || g.key === 'none'
        || (g.lastTest && g.lastTest.sentAtMs && !g.lastTest.confirmedAtMs && (g.rate == null || g.rate < 50))).map((g) => g.key));
}
function deviceCauseText(t, health) {
    const bad = badDeviceKeys(health);
    const ids = notifiedIds(t);
    if (!ids.length || !bad.size) return '';
    const hits = ids.filter((uid) => bad.has(deviceClass(tokenRecords(ST.users.get(uid))[0]).key));
    if (!hits.length) return '';
    const labels = [...new Set(hits.map((uid) => deviceClass(tokenRecords(ST.users.get(uid))[0]).label))];
    return `${hits.length} de los ${ids.length} notificados usan ${labels.join(' o ')}, donde los avisos no están llegando.`;
}
function ringHtml(t) {
    const now = Date.now();
    const c = createdMs(t);
    const sec = autoResendS();
    if (isSearching(t, now)) {
        const left = Math.max(0, c + sec * 1000 - now);
        const frac = left > 0 ? left / (sec * 1000) : 0;
        const col = left > 0 ? (frac > 0.5 ? 'var(--teal)' : 'var(--warn)') : 'var(--bad)';
        return left > 0 && !t.autoResendAtMs
            ? `<div class="vj-ring" style="background:conic-gradient(${col} ${Math.round(frac * 360)}deg,#E6EAF2 0)"><div><b class="num">${fmtDur(left)}</b><span>para reenvío</span></div></div>`
            : `<div class="vj-ring" style="background:conic-gradient(${now - c > 120000 ? 'var(--bad)' : 'var(--warn)'} 360deg,#E6EAF2 0)"><div><b class="num">${fmtDur(now - c)}</b><span>esperando</span></div></div>`;
    }
    return `<div class="vj-ring" style="background:conic-gradient(var(--blue) 360deg,#E6EAF2 0)"><div><b class="num" style="font-size:12px">${t.status === 'in_progress' ? 'En curso' : 'Asignado'}</b><span>${fmtDur(now - (tsMs(t.acceptedAt) || c))}</span></div></div>`;
}
function liveCard(t, health) {
    const now = ST.now;
    const k = svcKey(t);
    const c = createdMs(t);
    const searching = isSearching(t, now);
    const city = cityOf(t).name;
    const n = notifiedCount(t);
    const d = deliveredIds(t).length;
    const v = viewerIds(t).length;
    const b = bidIds(t).length;
    const sec = autoResendS();
    const resends = Number(t.resendCount) || 0;
    const ring = `<span data-ring="${esc(t.id)}">${ringHtml(t)}</span>`;
    const cause = searching && n > 0 && v === 0 && now - c > 20000
        ? (deviceCauseText(t, health) || possibleCause(t).text) : (searching && n === 0 ? possibleCause(t).text : '');
    const stale = searching && c && now - c > STALE_SEARCH_MS;
    const fdiv = (num, l, bad) => `<div class="${bad ? 'bad' : ''}"><b class="num">${num}</b><span>${l}</span></div>`;
    return `
    <div class="vj-card vj-live">
      <div class="vj-live-h">
        ${svcIcon(k, 38)}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px" class="vj-ellip">${esc(svcLabel(t))} · ${shortId(t.id)}${testTag(t)}${resends ? ` <span class="vj-tag blue">Reenviado ${resends}×</span>` : ''}</div>
          <div class="vj-sub vj-ellip">${esc(placeOf(t, 'origin'))} → ${esc(placeOf(t, 'destination'))}</div>
          <div class="vj-row" style="gap:5px;margin-top:4px"><span class="vj-tag">${esc(city)}</span><span class="vj-tag">${esc(clientName(t))}</span>${t.driverId ? `<span class="vj-tag blue">${esc(driverName(t) || 'Conductor')}</span>` : ''}<span class="vj-tag">${fmtL0(priceOf(t))}</span></div>
        </div>
        ${ring}
      </div>
      ${searching ? `<div class="vj-funnel">${fdiv(n, 'notificados', n === 0)}${fdiv(d, 'les llegó', n > 0 && d === 0 && now - c > 20000)}${fdiv(v, 'lo vieron', n > 0 && v === 0 && now - c > 20000)}${fdiv(b, 'ofertas', false)}</div>` : ''}
      ${cause ? `<div class="vj-warnbar red" style="margin-top:8px">${esc(cause)}</div>` : ''}
      ${stale ? `<div class="vj-warnbar red" style="margin-top:8px">Lleva ${esc(fmtWait(now - c))} buscando conductor. Si ya no hace falta, mándelo a la papelera: los conductores dejan de verlo.</div>` : ''}
      <div class="vj-actions">
        ${searching ? `<button class="vj-b" data-act="resend" data-id="${esc(t.id)}">${IC_RESEND} Reenviar a más conductores</button>
        <button class="vj-b o" data-act="assign" data-id="${esc(t.id)}">Asignar manual</button>` : `<button class="vj-b o" data-act="detail" data-id="${esc(t.id)}">Ver detalle</button>`}
        <button class="vj-b g" data-act="notifyPassenger" data-id="${esc(t.id)}">Avisar</button>
        ${stale ? `<button class="vj-b rr" data-act="trashPop" data-id="${esc(t.id)}">Mandar a papelera</button>` : ''}
      </div>
      ${stale ? trashPopHtml(t) : ''}
    </div>`;
}
function renderHealth(health) {
    const online = health.online;
    const withNotified = health.groups.filter((g) => g.notified);
    const totN = withNotified.reduce((a, g) => a + g.notified, 0);
    const totD = withNotified.reduce((a, g) => a + g.delivered, 0);
    const reach = totN ? pct(totD, totN) : null;
    const rows = health.groups.filter((g) => g.nDrivers || g.notified).map((g) => {
        const r = g.rate;
        const col = r == null ? '#CDD4E2' : r >= 80 ? 'var(--ok)' : r >= 50 ? 'var(--warn)' : 'var(--bad)';
        const tag = g.key === 'none' ? '<span class="vj-tag bad">Sin avisos</span>'
            : r == null ? '<span class="vj-tag warn">? Sin datos</span>'
                : r >= 80 ? '<span class="vj-tag ok">✓ Llegan</span>' : r >= 50 ? '<span class="vj-tag warn">A medias</span>' : '<span class="vj-tag bad">✕ No llegan</span>';
        const lt = g.lastTest;
        const test = g.key === 'none'
            ? `${g.nDrivers} conductor(es) sin teléfono registrado para avisos.`
            : lt ? `Prueba ${fmtDayShort(lt.sentAtMs)} ${fmtTime(lt.sentAtMs)}: ${lt.confirmedAtMs ? 'llegó ✓' : (lt.sent ? 'enviada, sin confirmar' : 'no se pudo enviar')} (${esc(lt.name || '')}).`
                : 'Sin prueba todavía.';
        return `<div class="vj-dev"><div class="vj-dev-h"><b>${esc(g.label)}</b>${tag}</div>
          <div class="vj-row" style="gap:8px;margin-top:5px;flex-wrap:nowrap"><div class="vj-bar" style="flex:1"><i style="width:${r == null ? 0 : Math.max(2, r)}%;background:${col}"></i></div><b class="num" style="font-size:12px;width:36px;text-align:right">${r == null ? '—' : `${r}%`}</b></div>
          <div class="vj-sub" style="font-size:10.5px;margin-top:3px">${g.nDrivers} conductor(es) · ${g.notified ? `${g.delivered} de ${g.notified} avisos llegaron (7 d)` : 'sin avisos en 7 d'} · ${test}</div></div>`;
    }).join('');
    const drivers = [];
    ST.users.forEach((u, uid) => {
        if (String(u.role || '').toLowerCase() !== 'driver') return;
        drivers.push({ uid, name: u.name || 'Conductor', rec: tokenRecords(u)[0] || null });
    });
    drivers.sort((a, b) => (!!b.rec - !!a.rec) || a.name.localeCompare(b.name));
    const sel = drivers.length ? `<label class="vj-sel" style="flex:1;min-width:0"><span class="vj-ellip" id="vj-test-label">${(() => { const d0 = drivers.find((d) => d.uid === UI.testDriver) || drivers[0]; return `${esc(d0.name)} · ${esc(d0.rec ? deviceClass(d0.rec).label : 'sin avisos')}`; })()} ▾</span>
        <select data-act="testDriver">${drivers.map((d) => `<option value="${esc(d.uid)}" ${UI.testDriver === d.uid ? 'selected' : ''}>${esc(d.name)} · ${esc(deviceLabel(d.rec))}</option>`).join('')}</select></label>` : '';
    const lastAny = health.groups.map((g) => g.lastTest).filter(Boolean).sort((a, b) => b.sentAtMs - a.sentAtMs)[0];
    return `
    <div class="vj-card">
      <div class="vj-sec"><h3>Salud de notificaciones</h3><span>últimos 7 días</span></div>
      <div class="vj-mini">
        <div><span class="vj-sub">Conductores en línea</span><b>${online}</b></div>
        <div class="${reach != null && reach < 60 ? 'bad' : ''}"><span class="vj-sub">Les llegan los avisos</span><b>${reach == null ? '—' : `${reach}%`}</b></div>
      </div>
      <div style="margin-top:6px">${rows || '<div class="vj-empty">Aún no hay conductores con avisos registrados.</div>'}</div>
      ${drivers.length ? `<div class="vj-row" style="margin-top:10px;flex-wrap:nowrap">${sel}<button class="vj-b t" data-act="sendTest">Enviar prueba</button></div>` : ''}
      <div class="vj-sub" style="font-size:10.5px;margin-top:6px">${lastAny ? `Última prueba: ${esc(lastAny.name || '')} · enviada ${fmtTime(lastAny.sentAtMs)} · ${lastAny.confirmedAtMs ? '<b style="color:var(--ok)">confirmada</b>' : '<b style="color:var(--bad)">no confirmada</b>'}` : '«Llegó» = el teléfono del conductor confirmó que recibió el aviso.'}</div>
    </div>`;
}
function renderDebt() {
    const owing = computeOwing();
    const total = owing.reduce((a, o) => a + o.amount, 0);
    const rows = owing.slice(0, 8).map((o) => `
      <div class="vj-debt">
        <span class="vj-av">${esc((o.name || '?').trim().charAt(0).toUpperCase())}</span>
        <div style="flex:1;min-width:0"><div style="font-weight:700" class="vj-ellip">${esc(o.name)}${o.test?.excluded ? ' <span class="vj-tag warn">Prueba</span>' : ''}</div>
          <div class="vj-sub" style="font-size:10.5px">${o.since ? `desde ${fmtDayShort(o.since)}` : 'deuda de perfil'}${o.overdue ? ' · <b style="color:var(--bad)">vencido</b>' : ''}${o.blocked ? ' · bloqueado' : ''}</div></div>
        <b class="num" style="white-space:nowrap">${fmtL(o.amount)}</b>
        <button class="vj-b g" data-act="remind" data-uid="${esc(o.uid)}">Recordar</button>
      </div>`).join('');
    return `
    <div class="vj-card">
      <div class="vj-sec"><h3>Comisión pendiente</h3><span>${owing.length} conductor${owing.length === 1 ? '' : 'es'}</span></div>
      ${rows || '<div class="vj-empty">Ningún conductor debe comisión.</div>'}
      ${owing.length > 8 ? `<div class="vj-sub" style="margin-top:6px">y ${owing.length - 8} más…</div>` : ''}
      ${owing.length ? `<div class="vj-row" style="justify-content:space-between;margin:10px 0 8px"><b>Total</b><b class="num" style="font-size:17px">${fmtL(total)}</b></div>
      <div class="vj-row" style="flex-wrap:nowrap"><button class="vj-b" style="flex:1" data-act="remindAll">Recordar a los ${owing.length}</button><button class="vj-b o" style="flex:1" data-act="markPaid">Marcar pagado…</button></div>
      <div class="vj-sub" style="font-size:10.5px;margin-top:6px">«Recordar» manda solo un aviso dentro de la app. «Marcar pagado» pide confirmación y guarda quién lo hizo.</div>` : ''}
    </div>`;
}
function renderLive() {
    const now = ST.now;
    const k = computeKpis(filtered({ trash: 'exclude' }));
    const health = computeHealth(filtered({ period: false, trash: 'exclude' }));
    const all = filtered({ period: false, trash: 'exclude' });
    const searching = all.filter((t) => isSearching(t, now)).sort((a, b) => createdMs(a) - createdMs(b));
    const active = all.filter(isActiveRide).sort((a, b) => createdMs(b) - createdMs(a));
    const cards = searching.map((t) => liveCard(t, health)).join('');
    const act = active.slice(0, 6).map((t) => liveCard(t, health)).join('');
    return `${renderKpis(k)}${renderCommissionBar(k)}
    <div class="vj-grid3">
      <div>
        <div class="vj-sec"><h3><span class="vj-dot ${searching.length ? 'live' : ''}"></span>Ahora · buscando conductor</h3><span>${searching.length} en este momento</span></div>
        ${cards || '<div class="vj-empty" style="margin-bottom:10px">Nadie está buscando conductor en este momento.</div>'}
        ${active.length ? `<div class="vj-sec" style="margin-top:12px"><h3>En curso</h3><span>${active.length}</span></div>${act}` : ''}
        <div class="vj-legend">Si nadie oferta en ${autoResendS()} s se reenvía solo a un radio más grande (una vez). «Reenviar» lo hace ya.</div>
      </div>
      ${renderHealth(health)}
      ${renderDebt()}
    </div>`;
}

// ───────────────────────── Render: Historial ─────────────────────────
function histRows() {
    const q = String(UI.histQ || '').trim().toLowerCase();
    return filtered({ trash: 'exclude' })
        .filter((t) => t.status === 'completed' || isCancelled(t))
        .filter((t) => !q || [shortId(t.id), t.id, clientName(t), driverName(t), placeOf(t, 'origin'), placeOf(t, 'destination'), svcLabel(t)]
            .some((x) => String(x || '').toLowerCase().includes(q)))
        .sort((a, b) => createdMs(b) - createdMs(a));
}
function dataQuality(rows) {
    const done = rows.filter((t) => t.status === 'completed');
    const zeroKm = done.filter((t) => kmOf(t) < 0.05).length;
    const company = rows.filter((t) => tripTestKind(t) === 'company').length;
    const test = rows.filter((t) => tripTestKind(t) === 'test').length;
    const unrated = done.filter((t) => rateStars(t) == null && !t.ratedByClient).length;
    const differs = done.filter((t) => tripCommission(t).differs).length;
    return { zeroKm, company, test, unrated, differs };
}
function histRow(t) {
    const k = svcKey(t);
    const done = t.status === 'completed';
    const km = kmOf(t);
    const c = tripCommission(t);
    const stars = rateStars(t);
    const tk = tripTestKind(t);
    const reviewing = !t.staffReviewedAtMs && reviewKinds(t).length;
    const kmCell = done && km < 0.05 ? '<span class="vj-tag warn">0.0 km ⚠</span>' : (km ? km.toFixed(1) : '—');
    const commCell = !done ? '<span class="vj-mut">—</span>'
        : c.differs ? `<span class="vj-tag bad">${c.pct}% · ${fmtL(c.amount)}</span>` : fmtL(c.amount);
    const rate = !done ? '<span class="vj-mut">—</span>' : stars != null ? `<span style="color:#E8A400">★</span> ${stars.toFixed(1)}` : '<span class="vj-tag warn">Sin calificar</span>';
    const state = reviewing ? '<span class="vj-tag warn">Por revisar</span>' : statusTag(t);
    return `<tr data-act="detail" data-id="${esc(t.id)}" class="${UI.detailId === t.id ? 'sel' : ''}">
      <td class="vj-mut">${fmtDateTime(createdMs(t))}</td>
      <td><span class="vj-row" style="gap:7px;flex-wrap:nowrap">${svcIcon(k, 24)}<b>${esc(svcLabel(t))}</b></span></td>
      <td class="vj-route">${esc(placeOf(t, 'origin'))} → ${esc(placeOf(t, 'destination'))}</td>
      <td><div>${tk === 'company' ? '<span class="vj-tag pur">Cuenta empresa</span>' : tk === 'test' ? '<span class="vj-tag warn">Prueba</span>' : esc(clientName(t))}</div><div class="vj-sub" style="font-size:10.5px">${esc(driverName(t) || 'sin conductor')}</div></td>
      <td class="r">${kmCell}</td>
      <td class="r"><b>${fmtL(priceOf(t))}</b></td>
      <td class="r">${commCell}</td>
      <td>${rate}</td>
      <td>${state}</td>
    </tr>`;
}
function renderHistory() {
    const rows = histRows();
    const done = rows.filter((t) => t.status === 'completed');
    const prices = done.map(priceOf).filter((p) => p > 0);
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const dq = dataQuality(rows);
    const [a, b] = periodRange();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    UI.histPage = Math.min(Math.max(1, UI.histPage), pages);
    const start = (UI.histPage - 1) * PAGE;
    const end = Math.min(rows.length, start + Math.max(PAGE, UI.histSize || PAGE));
    const slice = rows.slice(start, end);
    const pnums = [];
    const from = Math.max(1, Math.min(UI.histPage - 2, pages - 4));
    for (let i = from; i <= Math.min(pages, from + 4); i += 1) pnums.push(i);
    const testCount = filtered({ trash: 'exclude' }).filter((t) => tripTestKind(t)).length;
    const dqTags = [
        dq.zeroKm ? `<span class="vj-tag warn">0.0 km: ${dq.zeroKm}</span>` : '',
        dq.company ? `<span class="vj-tag pur">Cuenta empresa: ${dq.company}</span>` : '',
        dq.test ? `<span class="vj-tag warn">Prueba: ${dq.test}</span>` : '',
        dq.unrated ? `<span class="vj-tag warn">Sin calificar: ${dq.unrated}</span>` : '',
        dq.differs ? `<span class="vj-tag bad">Comisión distinta: ${dq.differs}</span>` : ''
    ].filter(Boolean).join(' ');
    return `
    <div class="vj-stats">
      <div class="vj-stat"><div class="vj-sub">Completados</div><b>${done.length}</b></div>
      <div class="vj-stat"><div class="vj-sub">Precio promedio</div><b>${prices.length ? fmtL0(avg) : '—'}</b></div>
      <div class="vj-stat"><div class="vj-sub">Mediana</div><b>${prices.length ? fmtL0(median(prices)) : '—'}</b></div>
      <div class="vj-stat"><div class="vj-sub">Rango</div><b>${prices.length ? `${fmtL0(Math.min(...prices))} – ${Math.round(Math.max(...prices))}` : '—'}</b></div>
      <div class="vj-stat"><div class="vj-sub">Fechas</div><b>${a ? fmtDayShort(a) : '…'} – ${fmtDayShort(b)}</b></div>
      <div class="vj-stat"><div class="vj-sub">Calidad de datos</div><div class="vj-row" style="gap:4px;margin-top:3px">${dqTags || '<span class="vj-tag ok">Sin alertas</span>'}</div></div>
    </div>
    <div class="vj-card">
      <div class="vj-row" style="justify-content:space-between;margin-bottom:6px">
        <div class="vj-row" style="gap:6px"><h3 style="margin:0;font-size:14px">Viajes pasados</h3><span class="vj-sub">· completados y cancelados · clic = detalle y factura</span></div>
        <div class="vj-row">
          <label class="vj-search">${IC_SEARCH}<input data-act="histQ" value="${esc(UI.histQ)}" placeholder="Buscar por #, conductor o lugar"></label>
          <button class="vj-tog ${UI.excludeTest ? 'on' : ''}" data-act="excludeTest"><i></i>Excluir prueba y empresa</button>
          <span class="vj-sub vj-hide-m">(${testCount} en este periodo)</span>
          <button class="vj-b o" data-act="csv">Exportar CSV</button>
        </div>
      </div>
      <div class="vj-table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Servicio</th><th>Ruta</th><th>Pasajero · Conductor</th><th class="r">Km</th><th class="r">Precio</th><th class="r">Comisión</th><th>Calif.</th><th>Estado</th></tr></thead>
        <tbody>${slice.map(histRow).join('') || '<tr><td colspan="9"><div class="vj-empty">No hay viajes con estos filtros.</div></td></tr>'}</tbody>
      </table></div>
      <div class="vj-pager">
        <span class="vj-sub" style="flex:1">Mostrando <b style="color:var(--ink)">${rows.length ? start + 1 : 0}–${end} de ${rows.length}</b></span>
        ${pages > 1 ? `<button class="pg" data-act="page" data-v="${UI.histPage - 1}">‹</button>${pnums.map((p) => `<button class="pg ${p === UI.histPage ? 'on' : ''}" data-act="page" data-v="${p}">${p}</button>`).join('')}<button class="pg" data-act="page" data-v="${UI.histPage + 1}">›</button>` : ''}
        ${end < rows.length ? `<button class="vj-b o" data-act="more">Cargar ${PAGE} más</button>` : ''}
      </div>
    </div>
    <div class="vj-legend">Cada fila muestra el servicio real. «Comisión» en rojo = el viaje guardó un % distinto al de su servicio. Con el interruptor activado, las cuentas de prueba y de la empresa no cuentan en totales ni en comisión.</div>`;
}

// ───────────────────────── Render: Avisos (notificaciones por conductor) ─────────────────────────
// Datos calculados en el servidor (staffDriverPushStatus): nunca llegan tokens al navegador.
const PUSH = { data: null, loading: false, error: '', at: 0, status: 'all', q: '', busy: new Set(), bulkBusy: false };
const PUSH_STATUS = {
    active: { label: 'Activos', tag: 'ok' },
    expired: { label: 'Vencidos', tag: 'warn' },
    never: { label: 'Nunca activados', tag: 'bad' }
};
const PUSH_REASON = {
    confirmado: 'confirmó un aviso',
    fcm_ok: 'FCM aceptó un aviso (sin confirmación del celular)',
    token_reciente: 'registró su teléfono hace poco',
    sin_actividad: 'sin avisos confirmados en 14 días',
    token_invalido: 'FCM borró su registro (token muerto)',
    token_vencido: 'su registro venció',
    nunca: 'nunca activó los avisos'
};
const PUSH_DEVICE = { android: 'App Android', 'ios-pwa': 'iPhone (app de inicio)', web: 'Web', unknown: '—' };
async function loadPushStatus(force = false) {
    if (PUSH.loading) return;
    if (!force && PUSH.data && Date.now() - PUSH.at < 60000) return;
    PUSH.loading = true; PUSH.error = '';
    scheduleRender();
    try {
        PUSH.data = await callFn('staffDriverPushStatus', {});
        PUSH.at = Date.now();
    } catch (e) {
        PUSH.error = errMsg(e);
    } finally {
        PUSH.loading = false;
        scheduleRender();
    }
}
function fmtWhen(ms) {
    if (!ms) return '—';
    const d = Date.now() - ms;
    if (d < 60 * 60 * 1000) return `hace ${Math.max(1, Math.round(d / 60000))} min`;
    if (d < DAY) return `hace ${Math.round(d / 3600000)} h`;
    return `${fmtDayShort(ms)} ${new Date(ms).getFullYear() !== new Date().getFullYear() ? new Date(ms).getFullYear() : ''}`.trim();
}
function pushRows() {
    const list = PUSH.data?.drivers || [];
    const q = slug(PUSH.q);
    return list.filter((d) => (PUSH.status === 'all' || d.status === PUSH.status)
        && (!q || slug(`${d.name} ${d.phone} ${d.city}`).includes(q) || String(d.phone || '').replace(/\D/g, '').includes(PUSH.q.replace(/\D/g, '') || '§')))
        .sort((a, b) => ({ never: 0, expired: 1, active: 2 }[a.status] - { never: 0, expired: 1, active: 2 }[b.status]) || a.name.localeCompare(b.name));
}
function pushNudgeTargets() {
    const now = Date.now();
    return (PUSH.data?.drivers || []).filter((d) => d.status !== 'active' && d.phone && !(d.nextNudgeAtMs > now) && !d.isTest);
}
function pushRow(d) {
    const now = Date.now();
    const st = PUSH_STATUS[d.status] || PUSH_STATUS.never;
    const ln = d.lastNudge;
    const lnBad = ln && ln.result && ln.result !== 'sent';
    const lnTxt = ln ? `Pedido ${fmtWhen(ln.atMs)}${ln.byName ? ` por ${esc(ln.byName)}` : ''} · <b style="color:${lnBad ? 'var(--bad)' : 'var(--ok)'}">${esc(ln.text || ln.result)}</b>${ln.delivery === 'read' ? ' · leído' : ln.delivery === 'delivered' ? ' · entregado' : ''}` : '';
    const wait = d.nextNudgeAtMs > now ? Math.ceil((d.nextNudgeAtMs - now) / 3600000) : 0;
    let btn = '';
    if (d.status !== 'active') {
        if (!d.phone) btn = '<button class="vj-b g" disabled>Sin teléfono</button>';
        else if (wait) btn = `<button class="vj-b g" disabled title="Una vez cada 24 h por conductor">De nuevo en ${wait} h</button>`;
        else btn = `<button class="vj-b t" data-act="pushNudge" data-uid="${esc(d.uid)}" ${PUSH.busy.has(d.uid) ? 'disabled' : ''}>${PUSH.busy.has(d.uid) ? 'Enviando…' : 'Pedir que activen'}</button>`;
    }
    return `
      <div class="vj-pd">
        <span class="vj-av">${esc((d.name || '?').trim().charAt(0).toUpperCase())}</span>
        <div class="vj-pd-who">
          <div style="font-weight:700" class="vj-ellip">${esc(d.name)}${d.isTest ? ' <span class="vj-tag warn">Prueba</span>' : ''}</div>
          <div class="vj-sub" style="font-size:11px">${d.phone ? esc(d.phone) : 'sin teléfono'} · ${esc(d.city || 'sin ciudad')} · ${esc(PUSH_DEVICE[d.device] || '—')}</div>
        </div>
        <div class="vj-pd-st"><span class="vj-tag ${st.tag}">${st.label}</span>
          <div class="vj-sub" style="font-size:10.5px;margin-top:2px">${esc(PUSH_REASON[d.reason] || '')}</div></div>
        <div class="vj-pd-dates vj-sub" style="font-size:11px">
          <div>Registro: <b style="color:var(--ink)">${fmtWhen(d.lastTokenAtMs)}</b></div>
          <div>Último aviso recibido: <b style="color:var(--ink)">${fmtWhen(d.lastConfirmedAtMs)}</b></div>
        </div>
        <div class="vj-pd-act">${btn}${lnTxt ? `<div class="vj-sub" style="font-size:10.5px;margin-top:3px">${lnTxt}</div>` : ''}</div>
      </div>`;
}
function renderPush() {
    if (!PUSH.data && !PUSH.error) { loadPushStatus(); return '<div class="vj-empty">Revisando los avisos de cada conductor…</div>'; }
    if (!PUSH.data) return `<div class="vj-card"><div class="vj-empty">No se pudo cargar: ${esc(PUSH.error)} · <span class="vj-link" data-act="pushReload">Reintentar</span></div></div>`;
    const c = PUSH.data.counts;
    const pctOk = c.total ? Math.round((c.active / c.total) * 100) : 0;
    const rows = pushRows();
    const targets = pushNudgeTargets();
    const chip = (k, label, n) => `<button class="vj-chip ${PUSH.status === k ? 'on' : ''} ${k === 'never' ? 'red' : ''}" data-act="pushStatus" data-v="${k}">${label} <b>${n}</b></button>`;
    const tpl = PUSH.data.template?.name;
    return `
    <div class="vj-card">
      <div class="vj-row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div class="vj-h1" style="font-size:19px">${c.active} de ${c.total} conductores con avisos activos</div>
          <div class="vj-sub">Activo = teléfono registrado y un aviso confirmado, aceptado o un registro en los últimos ${PUSH.data.activeWindowDays} días · actualizado ${fmtWhen(PUSH.data.generatedAtMs)}</div>
        </div>
        <button class="vj-b o" data-act="pushReload" ${PUSH.loading ? 'disabled' : ''}>${PUSH.loading ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
      <div class="vj-bar" style="margin:10px 0 4px"><i style="width:${Math.max(2, pctOk)}%;background:${pctOk >= 80 ? 'var(--ok)' : pctOk >= 50 ? 'var(--warn)' : 'var(--bad)'}"></i></div>
      <div class="vj-row" style="justify-content:space-between;margin-top:10px">
        <div class="vj-chips scroll">${chip('all', 'Todos', c.total)}${chip('active', 'Activos', c.active)}${chip('expired', 'Vencidos', c.expired)}${chip('never', 'Nunca activados', c.never)}</div>
        <div class="vj-row" style="flex:1;justify-content:flex-end">
          <label class="vj-search">${IC_SEARCH}<input data-act="pushQ" value="${esc(PUSH.q)}" placeholder="Buscar nombre, teléfono o ciudad"></label>
          <button class="vj-b" data-act="pushNudgeAll" ${!targets.length || PUSH.bulkBusy ? 'disabled' : ''}>${PUSH.bulkBusy ? 'Enviando…' : `Pedir que activen a todos los que faltan (${targets.length})`}</button>
        </div>
      </div>
      <div class="vj-sub" style="font-size:10.5px;margin-top:6px">${tpl
        ? `WhatsApp con la plantilla aprobada «${esc(tpl)}» (llega aunque no te hayan escrito).`
        : 'Sin plantilla aprobada: el WhatsApp solo sale a quien escribió a HonduRaite en las últimas 24 h; a los demás se marca «fuera de la ventana de 24 h».'} Máximo 1 pedido cada 24 h por conductor. El enlace abre la activación de avisos y la guía (Samsung incluida).</div>
    </div>
    <div class="vj-card">
      ${rows.map(pushRow).join('') || '<div class="vj-empty">Ningún conductor con estos filtros.</div>'}
    </div>`;
}

// ───────────────────────── Tasa de aceptación por categoría ─────────────────────────
// Lógica en js/service-availability.js (la inyecta app.js en DEPS.avail; también la usa el servidor).
const RATE_EMOJI = { auto: '🚘', taxi: '🚕', moto: '🏍️', delivery: '📦', tienda: '🛍️', flete: '🛻', grua: '🪝', hourly: '⏱️' };
const TONE_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', none: 'var(--mut)' };
function rateStats() {
    const A = DEPS.avail;
    if (!A) return null;
    return A.computeAcceptanceStats(filtered({ trash: 'exclude' }));
}
function fmtRate(r) { return r == null ? '—' : `${Math.round(r)}%`; }
function fmtRateWait(ms) { return ms == null ? '—' : fmtWait(ms); }
function renderRate() {
    const A = DEPS.avail;
    const st = rateStats();
    if (!A || !st) return '<div class="vj-card"><div class="vj-empty">Actualiza la app para ver la tasa de aceptación.</div></div>';
    const tone = (r) => TONE_COLOR[A.acceptanceTone(r)];
    const T = st.total;
    const low = st.lowest;
    const lowRow = low ? st.byCat[low] : null;
    const rows = A.ACCEPT_CATEGORIES.filter((c) => st.byCat[c].requests || st.byCat[c].searching).map((c) => {
        const r = st.byCat[c];
        const w = r.rate == null ? 0 : Math.max(2, r.rate);
        return `<tr><td>${RATE_EMOJI[c] || ''} <b>${esc(A.ACCEPT_LABELS[c])}</b></td><td class="r">${r.requests}</td><td class="r">${r.accepted}</td>
          <td style="min-width:140px"><div class="vj-bar"><i style="width:${w}%;background:${tone(r.rate)}"></i></div></td>
          <td class="r"><b style="color:${tone(r.rate)};font-size:15px">${fmtRate(r.rate)}</b></td>
          <td class="r">${r.noDriver}</td><td class="r vj-mut">${r.clientCancelled}</td><td class="r">${fmtRateWait(r.waitAvgMs)}</td><td class="r vj-mut">${r.searching || ''}</td></tr>`;
    }).join('');
    const drivers = st.drivers.slice(0, 25).map((d) => {
        const u = ST.users.get(d.uid) || {};
        const name = u.name || u.displayName || d.name || d.uid.slice(0, 6);
        return `<tr><td>${esc(name)}</td><td class="r">${d.offers}</td><td class="r">${d.accepted}</td><td class="r"><b style="color:${tone(d.rate)}">${fmtRate(d.rate)}</b></td></tr>`;
    }).join('');
    return `
    <div class="vj-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="vj-kpi"><div class="l">Tasa de aceptación general</div><div class="v num" style="color:${tone(T.rate)}">${fmtRate(T.rate)}</div><div class="d">${T.accepted} de ${T.requests} solicitudes${T.searching ? ` · ${T.searching} buscando ahora` : ''}</div></div>
      <div class="vj-kpi ${T.noDriver ? 'alert' : ''}"><div class="l">Sin conductor</div><div class="v num">${T.noDriver}</div><div class="d">Se vencieron o se cancelaron sin que nadie aceptara</div></div>
      <div class="vj-kpi"><div class="l">El cliente canceló antes</div><div class="v num">${T.clientCancelled}</div><div class="d">Antes de que alguien aceptara</div></div>
      <div class="vj-kpi ${lowRow && A.acceptanceTone(lowRow.rate) === 'bad' ? 'alert' : ''}"><div class="l">Categoría más baja</div><div class="v num" style="font-size:19px">${low ? `${esc(A.ACCEPT_LABELS[low])} ${fmtRate(lowRow.rate)}` : '—'}</div><div class="d">${low ? `${lowRow.accepted} de ${lowRow.requests}` : 'Mínimo 3 solicitudes'}</div></div>
    </div>
    <div class="vj-card">
      <div class="vj-row" style="justify-content:space-between"><b>Por categoría</b><span class="vj-sub">Tasa = aceptadas ÷ solicitudes que ya se decidieron (sin papelera ni simulaciones). Usa los filtros de arriba.</span></div>
      <div class="vj-table-wrap"><table class="vj-rate-t"><thead><tr><th>Categoría</th><th class="r">Solicitudes</th><th class="r">Aceptadas</th><th></th><th class="r">Tasa</th><th class="r">Sin conductor</th><th class="r">Cliente canceló</th><th class="r">Espera hasta aceptar</th><th class="r">Buscando</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="vj-empty">Sin solicitudes en este periodo.</td></tr>'}</tbody>
      ${rows ? `<tfoot><tr><td><b>Total</b></td><td class="r"><b>${T.requests}</b></td><td class="r"><b>${T.accepted}</b></td><td></td><td class="r"><b>${fmtRate(T.rate)}</b></td><td class="r">${T.noDriver}</td><td class="r">${T.clientCancelled}</td><td class="r">${fmtRateWait(T.waitAvgMs)}</td><td class="r">${T.searching || ''}</td></tr></tfoot>` : ''}</table></div>
    </div>
    <div class="vj-card">
      <div class="vj-row" style="justify-content:space-between"><b>Por conductor</b><span class="vj-sub">Solicitudes que vio, pasó o tomó vs. las que aceptó</span></div>
      <div class="vj-table-wrap"><table class="vj-rate-t"><thead><tr><th>Conductor</th><th class="r">Le llegaron</th><th class="r">Aceptó</th><th class="r">Tasa</th></tr></thead>
      <tbody>${drivers || '<tr><td colspan="4" class="vj-empty">Sin datos de conductores en este periodo.</td></tr>'}</tbody></table></div>
      <div class="vj-sub" style="margin-top:8px">Verde 80% o más · amarillo 55–79% · rojo menos de 55%: la gente pide y no llega nadie; conviene ponerlo «No disponible» en la pestaña Disponibilidad o reclutar.</div>
    </div>`;
}

// ───────────────────────── Disponibilidad de servicios ─────────────────────────
const AVAIL_UI = { city: '', saving: '' };
const AVAIL_EMOJI = { auto: '🚘', taxi: '🚕', moto: '🏍️', delivery: '📦', flete_paila: '🛻', flete_camion: '🚚', grua: '🪝' };
function availConfig() {
    const A = DEPS.avail;
    return A ? A.normalizeAvailabilityConfig(ST.appSettings.serviceAvailability || {}) : {};
}
function availCities() {
    const m = new Map();
    cityList().forEach((c) => m.set(c.key, c.name));
    ST.locs.forEach((l) => { const z = l.serviceZoneId; if (z && !m.has(z)) m.set(z, DEPS.getZoneById?.(z)?.name || z); });
    Object.keys(availConfig()).forEach((z) => { if (z !== '_all' && !m.has(z)) m.set(z, DEPS.getZoneById?.(z)?.name || z); });
    return [...m.entries()].filter(([k]) => k && k !== 'sin-ciudad').map(([key, name]) => ({ key, name }));
}
function availCityKey() {
    const cities = availCities();
    if (AVAIL_UI.city && (AVAIL_UI.city === '_all' || cities.some((c) => c.key === AVAIL_UI.city))) return AVAIL_UI.city;
    if (UI.city !== 'all' && cities.some((c) => c.key === UI.city)) return UI.city;
    return cities[0]?.key || '_all';
}
function availRows(zoneKey) {
    const A = DEPS.avail;
    const cfg = availConfig();
    const legacy = ST.appSettings.disabledServicesByCity || null;
    const zoneId = zoneKey === '_all' ? null : zoneKey;
    const center = zoneId ? (DEPS.getZoneById?.(zoneId)?.center || null) : null;
    const counts = A.countOnlineByVehicle([...ST.locs.values()], { zoneId, center, now: Date.now() });
    return A.AVAIL_SERVICES.map((svc) => {
        const mode = zoneKey === '_all'
            ? ((cfg._all && cfg._all[svc] && cfg._all[svc].mode) || A.DEFAULT_SERVICE_MODES[svc])
            : A.getServiceMode(cfg, zoneId, svc, legacy);
        const r = A.resolveServiceAvailability({ config: cfg, legacyByCity: legacy, zoneId, svc, counts });
        const custom = A.getServiceCustomMessage(cfg, zoneId, svc);
        const veh = A.availVehicleForService(svc);
        return { svc, mode, r, online: counts[veh] || 0, custom, explicit: !!(zoneId ? cfg[zoneId]?.[svc]?.mode : cfg._all?.[svc]?.mode) };
    });
}
function renderAvail() {
    const A = DEPS.avail;
    if (!A) return '<div class="vj-card"><div class="vj-empty">Actualiza la app para ver la disponibilidad.</div></div>';
    const key = availCityKey();
    const cities = availCities();
    const zoneName = key === '_all' ? 'todas las ciudades' : (cities.find((c) => c.key === key)?.name || key);
    const rows = availRows(key).map(({ svc, mode, r, online, custom, explicit }) => {
        const badge = r.available
            ? '<span class="vj-tag" style="background:#D1FAE5;color:#047857">Disponible</span>'
            : (r.reason === 'closed'
                ? '<span class="vj-tag" style="background:#FEE2E2;color:var(--bad)">No disponible · cerrado</span>'
                : '<span class="vj-tag" style="background:#FEF3C7;color:#92400E">No disponible · sin conductores</span>');
        const seg = [['auto', 'Automático'], ['on', 'Siempre abierto'], ['off', 'Cerrado']].map(([m, l]) =>
            `<button class="${mode === m ? 'on' : ''} vj-av-${m}" data-act="availMode" data-svc="${svc}" data-v="${m}" ${AVAIL_UI.saving ? 'disabled' : ''}>${l}</button>`).join('');
        return `<tr><td>${AVAIL_EMOJI[svc] || ''} <b>${esc(A.AVAIL_SERVICE_LABELS[svc])}</b>${explicit ? '' : ' <span class="vj-mut" style="font-size:10.5px">(por defecto)</span>'}</td>
          <td>${key === '_all' ? '<span class="vj-mut">—</span>' : badge}</td><td class="vj-mut">${key === '_all' ? '—' : `${online} en línea`}</td>
          <td><div class="vj-seg vj-avail-seg">${seg}</div></td>
          <td><span class="vj-link" data-act="availMsg" data-svc="${svc}">${custom ? 'Editar mensaje' : 'Mensaje…'}</span></td></tr>`;
    }).join('');
    const opts = [`<option value="_all" ${key === '_all' ? 'selected' : ''}>Todas las ciudades (por defecto)</option>`]
        .concat(cities.map((c) => `<option value="${esc(c.key)}" ${key === c.key ? 'selected' : ''}>${esc(c.name)}</option>`)).join('');
    return `
    <div class="vj-card">
      <div class="vj-row" style="justify-content:space-between">
        <label class="vj-sel">${IC_PIN}<select data-act="availCity" aria-label="Ciudad">${opts}</select></label>
        <span class="vj-sub">Lo que ve el cliente al abrir la app y en WhatsApp · se actualiza en vivo</span>
      </div>
      <div class="vj-table-wrap" style="margin-top:10px"><table class="vj-rate-t"><thead><tr><th>Servicio en ${esc(zoneName)}</th><th>Estado ahora</th><th>Conductores</th><th>Modo</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="vj-card vj-sub" style="line-height:1.5">
      <b>Automático:</b> se pone «No disponible» solo cuando no hay ningún conductor aprobado de ese tipo en línea en la ciudad, y vuelve solo cuando alguien se conecta. Los viajes programados sí se pueden pedir.<br>
      <b>Siempre abierto:</b> se puede pedir aunque no haya nadie en línea (se avisa a los conductores fuera de línea, como hoy).<br>
      <b>Cerrado:</b> nadie lo puede pedir en esa ciudad hasta que lo vuelvas a abrir.<br>
      «Todas las ciudades» es el valor por defecto; lo que pongas en una ciudad gana. Queda registrado quién lo cambió.
    </div>`;
}
async function saveAvail(svc, mode, message) {
    const zoneId = availCityKey();
    const cfg = availConfig();
    const prevMsg = DEPS.avail.getServiceCustomMessage(cfg, zoneId === '_all' ? null : zoneId, svc);
    const curMode = zoneId === '_all'
        ? ((cfg._all && cfg._all[svc] && cfg._all[svc].mode) || DEPS.avail.DEFAULT_SERVICE_MODES[svc])
        : DEPS.avail.getServiceMode(cfg, zoneId, svc, ST.appSettings.disabledServicesByCity || null);
    AVAIL_UI.saving = svc;
    render();
    try {
        const res = await callFn('staffSetServiceAvailability', {
            zoneId, service: svc, mode: mode || curMode, message: message != null ? message : (zoneId !== '_all' && cfg[zoneId]?.[svc]?.message) || (zoneId === '_all' ? prevMsg : '') || ''
        });
        if (res?.config) ST.appSettings = { ...ST.appSettings, serviceAvailability: res.config };
        toast('Guardado. La app de los clientes se actualiza sola.', 'success');
        reloadSlow();
    } catch (e) {
        toast(errMsg(e), 'error');
    } finally {
        AVAIL_UI.saving = '';
        render();
    }
}

function applyNudgeResults(results = []) {
    const by = new Map((PUSH.data?.drivers || []).map((d) => [d.uid, d]));
    const name = myProfile()?.name || 'Tú';
    results.forEach((r) => {
        const d = by.get(r.uid);
        if (!d) return;
        if (r.result === 'cooldown') { d.nextNudgeAtMs = r.nextAllowedAtMs || d.nextNudgeAtMs; return; }
        d.lastNudge = { atMs: Date.now(), byName: name, result: r.result, text: r.text, via: r.via };
        if (r.nextAllowedAtMs) d.nextNudgeAtMs = r.nextAllowedAtMs;
    });
}
function nudgeSummary(results = []) {
    const okN = results.filter((r) => r.result === 'sent').length;
    const outN = results.filter((r) => r.result === 'outside_window').length;
    const other = results.length - okN - outN;
    return [`${okN} enviado(s)`, outN ? `${outN} fuera de la ventana de 24 h` : '', other ? `${other} no se pudo (ver lista)` : ''].filter(Boolean).join(' · ');
}
async function pushNudge(uids, bulk = false) {
    const list = [...new Set(uids)].filter(Boolean);
    if (!list.length) return;
    if (bulk) PUSH.bulkBusy = true;
    list.forEach((u) => PUSH.busy.add(u));
    render();
    try {
        const r = await callFn('staffNudgeDriverPush', bulk ? { driverUids: list, confirmCount: list.length, bulk: true } : { driverUid: list[0] });
        applyNudgeResults(r?.results || []);
        const one = (r?.results || [])[0];
        if (!bulk && one) toast(one.result === 'sent' ? 'WhatsApp enviado.' : one.text || 'No se pudo enviar.', one.result === 'sent' ? 'success' : 'warning');
        else toast(nudgeSummary(r?.results || []), 'info');
    } catch (e) {
        toast(errMsg(e), 'error');
    } finally {
        list.forEach((u) => PUSH.busy.delete(u));
        PUSH.bulkBusy = false;
        render();
    }
}
function pushNudgeAll() {
    const targets = pushNudgeTargets();
    if (!targets.length) return;
    const tpl = PUSH.data?.template?.name;
    const msg = `¿Mandar WhatsApp a ${targets.length} conductor(es) sin avisos activos para que los activen?\n\n`
        + (tpl ? `Se usa la plantilla «${tpl}».` : 'Sin plantilla: solo llega a quien escribió en las últimas 24 h; los demás quedan marcados «fuera de la ventana de 24 h».')
        + '\nA cada conductor se le puede pedir 1 vez cada 24 h.';
    if (!confirm(msg)) return;
    pushNudge(targets.map((d) => d.uid), true);
}

// ───────────────────────── Render: Programados ─────────────────────────
function renderScheduled() {
    const now = ST.now;
    const list = filtered({ period: false, trash: 'exclude' }).filter((t) => isFutureScheduled(t, now))
        .sort((a, b) => scheduledMs(a) - scheduledMs(b));
    const rows = list.map((t) => {
        const s = scheduledMs(t);
        const soon = s - now < 60 * 60 * 1000;
        return `<div class="vj-card vj-sched">
          ${svcIcon(svcKey(t), 36)}
          <div style="flex:1;min-width:0"><div style="font-weight:700">${esc(svcLabel(t))} · ${shortId(t.id)}${testTag(t)}</div>
            <div class="vj-sub vj-ellip">${esc(placeOf(t, 'origin'))} → ${esc(placeOf(t, 'destination'))} · ${esc(clientName(t))}</div></div>
          <div style="text-align:right"><b class="num">${fmtDayShort(s)} · ${fmtTime(s)}</b><div class="vj-sub">${soon ? `<b style="color:var(--warn)">en ${fmtWait(s - now)}</b>` : `en ${fmtWait(s - now)}`}</div></div>
          <span>${t.driverId ? `<span class="vj-tag blue">${esc(driverName(t) || 'Conductor')}</span>` : '<span class="vj-tag warn">Sin conductor</span>'}</span>
          <div class="vj-row" style="gap:6px">${t.driverId ? '' : `<button class="vj-b o" data-act="assign" data-id="${esc(t.id)}">Asignar</button>`}<button class="vj-b g" data-act="detail" data-id="${esc(t.id)}">Detalle</button></div>
        </div>`;
    }).join('');
    return `<div class="vj-sec"><h3>Viajes programados</h3><span>${list.length} próximos · ordenados por hora de salida</span></div>${rows || '<div class="vj-empty">No hay viajes programados con estos filtros.</div>'}`;
}

// ───────────────────────── Render: Detalle de viaje ─────────────────────────
function mapSvg(t) {
    const a = [Number(t.originLat), Number(t.originLng)];
    const b = [Number(t.destinationLat), Number(t.destinationLng)];
    const ok = a.every(Number.isFinite) && b.every(Number.isFinite) && (a[0] || a[1]) && (b[0] || b[1]);
    const km = kmOf(t) || (ok ? haversineKm(a[0], a[1], b[0], b[1]) : 0);
    // Esquema simple (sin Google Maps): A abajo-izquierda, B arriba-derecha, orientado como en la realidad.
    let ax = 90; let ay = 150; let bx = 470; let by = 40;
    if (ok) {
        const dx = b[1] - a[1];
        const dy = b[0] - a[0];
        const len = Math.hypot(dx, dy) || 1;
        const cx = 290; const cy = 95; const r = 170;
        ax = cx - (dx / len) * r; bx = cx + (dx / len) * r;
        ay = cy + (dy / len) * 60; by = cy - (dy / len) * 60;
    }
    const mx = (ax + bx) / 2; const my = Math.min(ay, by) - 10;
    const dur = Number(t.tripDurationMs) ? `${Math.round(Number(t.tripDurationMs) / 60000)} min` : (km ? `${Math.max(1, Math.round(km * 3))} min estimados` : '');
    const tagAt = (x, y, txt) => {
        const left = Math.min(70, Math.max(1, (x / 580) * 100 - 4));
        const below = y < 95;
        return `<span class="vj-tag" style="left:${left.toFixed(1)}%;${below ? `top:${Math.round(y + 12)}px` : `top:${Math.round(y - 30)}px`};background:#fff;max-width:45%;overflow:hidden;text-overflow:ellipsis">${txt}</span>`;
    };
    const gmaps = ok ? `https://www.google.com/maps/dir/${a[0]},${a[1]}/${b[0]},${b[1]}` : '';
    return `<div class="vj-map">
      <svg viewBox="0 0 580 190" width="100%" height="190" preserveAspectRatio="none">
        <rect width="580" height="190" fill="#EAF0F7"/>
        <g stroke="#fff" stroke-width="14"><path d="M0 60H580M0 130H580M120 0V190M300 0V190M450 0V190"/></g>
        <g stroke="#fff" stroke-width="6"><path d="M0 20 580 170M60 190 520 0"/></g>
        <rect x="380" y="18" width="62" height="34" rx="4" fill="#D4EED8"/><rect x="20" y="150" width="56" height="20" rx="4" fill="#D4EED8"/>
        <path d="M${ax} ${ay} Q ${mx} ${my} ${bx} ${by}" stroke="#0A6CFF" stroke-width="4.5" fill="none" stroke-linecap="round"/>
        <circle cx="${ax}" cy="${ay}" r="7" fill="#12A150" stroke="#fff" stroke-width="3"/>
        <circle cx="${bx}" cy="${by}" r="7" fill="#E5484D" stroke="#fff" stroke-width="3"/>
      </svg>
      ${tagAt(ax, ay, `A · ${esc(placeOf(t, 'origin'))}`)}
      ${tagAt(bx, by, `B · ${esc(placeOf(t, 'destination'))}`)}
      <span class="vj-tag" style="right:10px;bottom:10px;background:transparent;color:var(--blue)">${km ? `${km.toFixed(1)} km` : ''}${dur ? ` · ${dur}` : ''}${gmaps ? ` · <a href="${gmaps}" target="_blank" rel="noopener" style="color:inherit">Abrir mapa</a>` : ''}</span>
    </div>`;
}
function timeline(t) {
    const c = createdMs(t);
    const notifAt = Number(t.alertFirstNotifiedAtMs) || tsMs(t.eligibleDriverAlertAt) || 0;
    const n = notifiedCount(t);
    const v = viewerIds(t).length;
    const vAt = firstViewMs(t);
    const acc = tsMs(t.acceptedAt);
    const st = tsMs(t.startedAt);
    const done = tsMs(t.completedAt);
    const canc = isCancelled(t);
    const steps = [
        { l: 'Solicitado', at: c, ok: !!c, sub: fmtClock(c) },
        { l: 'Notificado', at: notifAt, ok: n > 0, sub: n ? `${notifAt ? fmtClock(notifAt) : ''} · a ${n}` : '0' },
        { l: 'Visto', at: vAt, ok: v > 0, sub: `${v} de ${n || 0}` },
        { l: 'Aceptado', at: acc, ok: !!acc || !!t.driverId, sub: acc ? fmtClock(acc) : '—' },
        { l: 'Recogido', at: st, ok: !!st, sub: st ? fmtClock(st) : '—' },
        { l: 'Completado', at: done, ok: t.status === 'completed', sub: done ? fmtClock(done) : '—' }
    ];
    let failAt = -1;
    if (canc) failAt = steps.findIndex((s) => !s.ok);
    let lastOk = -1;
    steps.forEach((s, i) => { if (s.ok && (failAt < 0 || i < failAt)) lastOk = i; });
    const greenPct = steps.length > 1 ? (Math.max(0, failAt >= 0 ? failAt : lastOk) / (steps.length - 1)) * 84 : 0;
    const html = steps.map((s, i) => {
        const state = failAt === i ? 'bad' : (i <= lastOk ? 'ok' : 'off');
        const bg = state === 'ok' ? 'var(--ok)' : state === 'bad' ? 'var(--bad)' : '#CDD4E2';
        const sym = state === 'ok' ? '✓' : state === 'bad' ? '✕' : '';
        return `<div class="vj-step"><i style="background:${bg}">${sym}</i><b>${s.l}</b><span>${state === 'off' ? '—' : esc(s.sub)}</span></div>`;
    }).join('');
    const cAt = tsMs(t.cancelledAt);
    const cancelNote = canc
        ? `<div style="text-align:center;margin-top:8px"><span class="vj-tag dark">✕ Cancelado ${cancelledByPassenger(t) ? 'por el pasajero' : t.cancelledBy && t.cancelledBy === t.driverId ? 'por el conductor' : t.cancelledBy ? 'por staff/sistema' : ''} · ${fmtClock(cAt)}${cAt && c ? ` (${fmtWait(cAt - c)} esperando)` : ''}</span></div>` : '';
    return `<div class="vj-tl"><div class="vj-tl-line" style="background:linear-gradient(90deg,var(--ok) ${greenPct}%,#CDD4E2 ${greenPct}%)"></div>${html}</div>${cancelNote}`;
}
function detailHtml(t, { inDrawer = false } = {}) {
    if (!t) return '<div class="vj-empty">Elija un viaje de la lista para ver el detalle.</div>';
    const k = svcKey(t);
    const cause = possibleCause(t);
    const devCause = isCancelled(t) && !t.driverId && viewerIds(t).length === 0 ? deviceCauseText(t, computeHealth(filtered({ period: false, trash: 'exclude' }))) : '';
    const chat = chatOf(t);
    const price = priceOf(t);
    const paid = t.status === 'completed';
    const pinVisible = pinShown[t.id];
    const c = tripCommission(t);
    const trashBtn = t.trashedAtMs
        ? `<button class="vj-b o" data-act="restore" data-id="${esc(t.id)}">Restaurar</button>`
        : `<button class="vj-b rr" data-act="trashPop" data-id="${esc(t.id)}">Mover a papelera</button>`;
    const pop = trashPopHtml(t);
    return detailBody(t, { k, cause, devCause, chat, price, paid, pinVisible, c, trashBtn, pop, inDrawer });
}
function trashPopHtml(t) {
    return popTrashFor === t.id && !t.trashedAtMs ? `
      <div class="vj-pop">
        <div style="font-weight:800;font-size:15px">¿Mover a la papelera?</div>
        <div class="vj-sub" style="font-size:12px;margin-top:4px;color:var(--ink)">El viaje ${shortId(t.id)} sale de esta lista. Se puede <b>recuperar durante ${TRASH_DAYS} días</b> y no cambia las estadísticas.</div>
        <div class="vj-empty" style="text-align:left;margin-top:8px;padding:8px 10px;color:var(--ink)">Borrar para siempre solo desde <b>Papelera</b>, escribiendo <b>BORRAR</b>.</div>
        <div class="vj-row" style="justify-content:flex-end;margin-top:10px"><button class="vj-b g" data-act="trashCancel">Cancelar</button><button class="vj-b red" data-act="trashYes" data-id="${esc(t.id)}">Sí, mover</button></div>
      </div>` : '';
}
function detailBody(t, { k, cause, devCause, chat, price, paid, pinVisible, c, trashBtn, pop, inDrawer }) {
    return `
    <div class="vj-row" style="flex-wrap:nowrap;align-items:flex-start">
      ${svcIcon(k, 36)}
      <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:16px">Viaje ${shortId(t.id)} · ${esc(svcLabel(t))}${testTag(t)}</div>
        <div class="vj-sub">${fmtDayYear(createdMs(t))} · ${esc(cityOf(t).name)} · ${esc(clientName(t))} · ${t.driverId ? esc(driverName(t) || 'Conductor') : 'sin conductor'}</div></div>
      ${statusTag(t)}
      <button class="vj-b g" data-act="closeDetail" aria-label="Cerrar" style="padding:5px 9px">✕</button>
    </div>
    <div style="margin-top:12px">${mapSvg(t)}</div>
    <div style="font-weight:700;margin:14px 0 8px">Línea de tiempo</div>
    ${timeline(t)}
    ${cause.text && cause.level !== 'ok' ? `<div class="vj-warnbar ${cause.level === 'bad' ? 'red' : ''}" style="margin-top:12px"><span><b>Posible causa:</b> ${esc(devCause || cause.text)}</span></div>` : ''}
    <div class="vj-boxes">
      <div><div class="k">CHAT</div>${chat.length ? `<div style="margin-top:3px">${chat.length} mensaje(s)</div><div class="vj-sub vj-ellip">«${esc(String(chat[chat.length - 1].text || '').slice(0, 60))}»</div><span class="vj-link vj-sub" data-act="chat" data-id="${esc(t.id)}">Ver chat</span>` : `<div style="margin-top:3px">Sin mensajes</div><div class="vj-sub">${t.driverId ? 'No escribieron en el chat.' : 'No hubo conductor con quien chatear.'}</div>`}</div>
      <div><div class="k">PIN DE VIAJE</div><div style="margin-top:3px;font-size:16px;letter-spacing:3px" class="num">${pinVisible ? esc(pinVisible) : (t.pin || t.tripPin || t.hasPin ? '• • • •' : '—')}</div>${t.pin || t.tripPin || t.hasPin ? `<span class="vj-link vj-sub" data-act="pin" data-id="${esc(t.id)}">Mostrar (queda en el registro)</span>` : '<div class="vj-sub">Sin PIN</div>'}</div>
      <div><div class="k">PRECIO Y FACTURA</div><div style="margin-top:3px">${paid ? 'Cobrado' : 'Base'} <b>${fmtL(price)}</b>${paid ? ` · comisión ${fmtL(c.amount)} (${c.pct}%)` : ' · cobro L 0.00'}</div>${paid ? `<span class="vj-link vj-sub" data-act="factura" data-id="${esc(t.id)}">Ver factura</span>` : '<div class="vj-sub">Sin factura (no hubo cobro)</div>'}</div>
    </div>
    <div class="vj-row" style="margin-top:14px;position:relative">
      ${t.staffReviewedAtMs ? `<button class="vj-b o" data-act="unreview" data-id="${esc(t.id)}">Revisado ✓ · deshacer</button>` : `<button class="vj-b" data-act="reviewOne" data-id="${esc(t.id)}">✓ Marcar revisado</button>`}
      <button class="vj-b o" data-act="contact" data-id="${esc(t.id)}">Contactar pasajero</button>
      <button class="vj-b o" data-act="viewers" data-id="${esc(t.id)}">Ver vistas y ofertas</button>
      <span style="flex:1"></span>
      ${trashBtn}
      ${pop}
    </div>
    ${t.staffReviewedAtMs ? `<div class="vj-sub" style="margin-top:6px">Revisado por ${esc(t.staffReviewedByName || '')} · ${fmtDateTime(t.staffReviewedAtMs)}</div>` : ''}
    ${inDrawer ? '' : ''}`;
}

// ───────────────────────── Render: Por revisar ─────────────────────────
function renderReview() {
    const all = reviewQueue();
    const counts = {};
    REVIEW_CHIPS.forEach((c) => { counts[c.k] = c.k === 'all' ? all.length : all.filter((t) => reviewKinds(t).includes(c.k)).length; });
    const list = UI.reviewChip === 'all' ? all : all.filter((t) => reviewKinds(t).includes(UI.reviewChip));
    [...SEL.review].forEach((id) => { if (!list.some((t) => t.id === id)) SEL.review.delete(id); });
    if (!UI.detailId || !ST.trips.some((t) => t.id === UI.detailId)) UI.detailId = list[0]?.id || null;
    const cur = ST.trips.find((t) => t.id === UI.detailId) || null;
    const chips = REVIEW_CHIPS.map((c) => `<button class="vj-chip ${c.red ? 'red' : ''} ${UI.reviewChip === c.k ? 'on' : ''}" data-act="reviewChip" data-v="${c.k}">${c.l} <b>${counts[c.k]}</b></button>`).join('');
    const shown = list.slice(0, 60);
    const items = shown.map((t) => {
        const kinds = reviewKinds(t);
        const tags = [];
        if (kinds.includes('nobody')) tags.push('<span class="vj-tag bad">Nadie lo vio</span>');
        else if (isCancelled(t) && !t.driverId) tags.push(`<span class="vj-tag">Visto por ${viewerIds(t).length}</span>`);
        if (isCancelled(t) && !t.driverId) tags.push(`<span class="vj-tag">${bidIds(t).length} ofertas</span>`);
        if (cancelledByPassenger(t) && !t.driverId) tags.push('<span class="vj-tag">Canceló pasajero</span>');
        if (isCancelled(t) && t.driverId) tags.push('<span class="vj-tag warn">Canceló con conductor</span>');
        if (kinds.includes('unrated')) tags.push('<span class="vj-tag warn">Sin calificar</span>');
        if (t.status === 'completed' && rateStars(t) != null) tags.push(`<span class="vj-tag bad">${rateStars(t)} ★</span>`);
        const on = SEL.review.has(t.id);
        return `<div class="vj-card vj-q ${on ? 'sel' : ''} ${UI.detailId === t.id ? 'cur' : ''}" data-act="pick" data-id="${esc(t.id)}">
          <span class="vj-ck ${on ? 'on' : ''}" data-act="check" data-id="${esc(t.id)}">${on ? '✓' : ''}</span>
          ${svcIcon(svcKey(t), 30)}
          <div style="flex:1;min-width:0"><div class="vj-ellip"><b>${shortId(t.id)}</b> <span class="vj-sub">· ${fmtDayShort(createdMs(t))} · ${fmtTime(createdMs(t))}</span>${testTag(t)}</div>
            <div class="vj-sub vj-ellip" style="color:var(--ink)">${esc(placeOf(t, 'origin'))} → ${esc(placeOf(t, 'destination'))}</div>
            <div class="vj-row" style="gap:4px;margin-top:3px">${tags.join('')}</div></div>
          <div style="text-align:right"><div class="vj-sub" style="font-size:10px">${t.status === 'completed' ? 'Cobrado' : 'Precio base'}</div><b class="num">${fmtL(priceOf(t))}</b></div>
        </div>`;
    }).join('');
    return `
    <div class="vj-split">
      <div class="vj-queue">
        <div class="vj-card" style="margin-bottom:10px"><div class="vj-row" style="justify-content:space-between"><b style="font-size:15px">Por revisar</b><b class="num" style="font-size:22px">${all.length}</b></div>
          <div class="vj-sub">Un solo número para todo: cancelados + completados sin calificar o con mala nota, que nadie ha marcado como revisados. La lista y el contador usan el mismo filtro.</div></div>
        <div class="vj-chips" style="margin-bottom:8px">${chips}</div>
        <div class="vj-row" style="justify-content:space-between;margin-bottom:8px">
          <span class="vj-sub"><b style="color:var(--ink)">${SEL.review.size}</b> seleccionados · <span class="vj-link" data-act="checkAll">${SEL.review.size && SEL.review.size === shown.length ? 'Quitar todos' : 'Elegir todos'}</span></span>
          <span class="vj-row" style="gap:6px"><button class="vj-b" data-act="reviewSel" ${SEL.review.size ? '' : 'disabled'}>✓ Marcar revisados</button><button class="vj-b r" data-act="trashSel" ${SEL.review.size ? '' : 'disabled'}>Mover a papelera</button></span>
        </div>
        ${items || '<div class="vj-empty">Nada por revisar con estos filtros. 🎉</div>'}
        ${list.length > shown.length ? `<div class="vj-legend" style="text-align:center">Mostrando 60 de ${list.length} · marque revisados para ver más</div>` : ''}
      </div>
      <div class="vj-card vj-detail">${detailHtml(cur)}</div>
    </div>`;
}

// ───────────────────────── Render: Papelera ─────────────────────────
function renderTrash() {
    const list = baseTrips().filter((t) => t.trashedAtMs && passCity(t) && passSvc(t)).sort((a, b) => b.trashedAtMs - a.trashedAtMs);
    [...SEL.trash].forEach((id) => { if (!list.some((t) => t.id === id)) SEL.trash.delete(id); });
    const rows = list.map((t) => {
        const purge = Number(t.trashPurgeAfterMs) || (t.trashedAtMs + TRASH_DAYS * DAY);
        const left = Math.max(0, Math.ceil((purge - ST.now) / DAY));
        const on = SEL.trash.has(t.id);
        return `<div class="vj-card vj-trash-row ${on ? 'vj-q sel' : ''}" style="cursor:default">
          <span class="vj-ck ${on ? 'on' : ''}" data-act="checkTrash" data-id="${esc(t.id)}" style="cursor:pointer">${on ? '✓' : ''}</span>
          ${svcIcon(svcKey(t), 30)}
          <div style="flex:1;min-width:0"><div class="vj-ellip"><b>${shortId(t.id)}</b> · ${esc(svcLabel(t))} <span class="vj-sub">· ${fmtDateTime(createdMs(t))}</span></div>
            <div class="vj-sub vj-ellip">${esc(placeOf(t, 'origin'))} → ${esc(placeOf(t, 'destination'))} · movido por ${esc(t.trashedByName || 'staff')} el ${fmtDayShort(t.trashedAtMs)}</div></div>
          <div style="text-align:right"><b class="num">${fmtL(priceOf(t))}</b><div class="vj-sub">${left} día${left === 1 ? '' : 's'} para borrarse</div></div>
          <button class="vj-b o" data-act="restore" data-id="${esc(t.id)}">Restaurar</button>
        </div>`;
    }).join('');
    return `
    <div class="vj-sec"><h3>Papelera</h3><span>Se borran solos a los ${TRASH_DAYS} días. Las estadísticas siguen contándolos hasta entonces.</span></div>
    <div class="vj-row" style="margin-bottom:10px;justify-content:space-between">
      <span class="vj-sub"><b style="color:var(--ink)">${SEL.trash.size}</b> seleccionados · <span class="vj-link" data-act="checkAllTrash">${SEL.trash.size && SEL.trash.size === list.length ? 'Quitar todos' : 'Elegir todos'}</span></span>
      <span class="vj-row" style="gap:6px"><button class="vj-b o" data-act="restoreSel" ${SEL.trash.size ? '' : 'disabled'}>Restaurar</button><button class="vj-b red" data-act="purgeSel" ${SEL.trash.size ? '' : 'disabled'}>Borrar para siempre…</button></span>
    </div>
    ${rows || '<div class="vj-empty">La papelera está vacía.</div>'}`;
}

// ───────────────────────── Modales ─────────────────────────
function closeModal() { document.querySelectorAll('.vj-modal-bg[data-vj]').forEach((m) => m.remove()); }
function openModal(html, onBind) {
    closeModal();
    const bg = document.createElement('div');
    bg.className = 'vj-modal-bg';
    bg.dataset.vj = '1';
    bg.innerHTML = `<div class="vj-modal" role="dialog">${html}</div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) closeModal(); });
    document.body.appendChild(bg);
    onBind?.(bg.querySelector('.vj-modal'));
    return bg;
}
function closeDrawer() { document.querySelectorAll('.vj-drawer-bg').forEach((m) => m.remove()); }
function openDrawer(id) {
    closeDrawer();
    const t = ST.trips.find((x) => x.id === id);
    if (!t) return;
    const bg = document.createElement('div');
    bg.className = 'vj-drawer-bg';
    bg.dataset.id = id;
    bg.innerHTML = `<div class="vj vj-drawer"><div class="vj-card" style="padding:16px">${detailHtml(t, { inDrawer: true })}</div></div>`;
    bg.addEventListener('click', (e) => {
        if (e.target === bg) { closeDrawer(); return; }
        onClick(e, bg);
    });
    document.body.appendChild(bg);
}
function refreshDrawer() {
    const bg = document.querySelector('.vj-drawer-bg');
    if (!bg) return;
    const t = ST.trips.find((x) => x.id === bg.dataset.id);
    const card = bg.querySelector('.vj-card');
    if (t && card) card.innerHTML = detailHtml(t, { inDrawer: true });
}

function openSettings() {
    const admin = isAdmin();
    const by = ST.config.commissionByService || {};
    const general = Number.isFinite(Number(ST.config.commissionPercentage)) ? Number(ST.config.commissionPercentage) : (Number(window.APP_CONFIG?.commissionPercent) || 0);
    const rows = SVC_ORDER.map((k) => `<div class="row"><span class="vj-row" style="gap:8px">${svcIcon(k, 24)}<b>${SVC[k].label}</b></span>
      <span><input type="number" min="0" max="100" step="0.5" data-svc="${k}" value="${by[k] != null ? esc(by[k]) : ''}" placeholder="${general} (general)" ${admin ? '' : 'disabled'}> %</span></div>`).join('');
    openModal(`
      <h4>Ajustes › Comisiones y reenvío</h4>
      <p class="vj-sub" style="margin:0 0 8px">Usted elige el % de cada servicio. Vacío = usa el % general. Aplica a viajes nuevos; los completados conservan el % con que se cobraron.${admin ? '' : ' <b>Solo el administrador puede cambiarlos.</b>'}</p>
      <div class="row"><b>% general (todos los servicios)</b><span><input type="number" min="0" max="100" step="0.5" id="vj-gen" value="${esc(general)}" ${admin ? '' : 'disabled'}> %</span></div>
      ${rows}
      <div class="row"><span><b>Reenvío automático</b><div class="vj-sub">Si nadie oferta en estos segundos, se reenvía a un radio más grande (una vez). 5 a 100 s.</div></span>
        <span><input type="number" min="5" max="100" step="1" id="vj-sec" value="${autoResendS()}" ${admin ? '' : 'disabled'}> s</span></div>
      <div class="vj-row" style="justify-content:flex-end;margin-top:12px"><button class="vj-b g" data-close>Cerrar</button>${admin ? '<button class="vj-b" id="vj-save">Guardar</button>' : ''}</div>`,
    (m) => {
        m.querySelector('#vj-save')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const map = {};
            m.querySelectorAll('input[data-svc]').forEach((i) => { if (i.value !== '') map[i.dataset.svc] = Number(i.value); });
            const gen = m.querySelector('#vj-gen').value;
            const sec = Number(m.querySelector('#vj-sec').value) || DEFAULT_AUTO_RESEND_S;
            btn.disabled = true;
            try {
                const r = await callFn('adminSetTripsPanelConfig', { commissionByService: map, autoResendSeconds: sec, commissionPercentage: gen === '' ? null : Number(gen) });
                ST.config = { ...ST.config, commissionByService: r?.commissionByService || map, autoResendSeconds: r?.autoResendSeconds || sec, ...(gen === '' ? {} : { commissionPercentage: Number(gen) }) };
                try { window.invalidatePlatformCommissionCache?.(); } catch (_) {}
                toast('Ajustes guardados.', 'success');
                closeModal();
                render();
            } catch (err) { toast(errMsg(err), 'error'); btn.disabled = false; }
        });
    });
}

function openTestAccounts() {
    const marked = [];
    const suggested = [];
    ST.users.forEach((u, uid) => {
        const ti = testInfo(uid);
        if (!ti) return;
        const row = { uid, name: u.name || u.email || uid, role: u.role || '', ti, flag: u.isTestAccount === true };
        (ti.kind === 'suggest' ? suggested : marked).push(row);
    });
    const line = (r) => `<div class="row"><span><b>${esc(r.name)}</b> <span class="vj-sub">${esc(r.role)}</span><div class="vj-sub">${r.ti.kind === 'company' ? 'Empresa' : r.ti.kind === 'test' ? 'Prueba' : 'Sugerida: el nombre dice «prueba/test»'}${r.flag ? ' · marcada a mano' : r.ti.kind !== 'suggest' ? ' · automática (rol o conductor de prueba)' : ''}</div></span>
      <span class="vj-row" style="gap:6px">${r.flag ? `<button class="vj-b g" data-uid="${esc(r.uid)}" data-on="0">Quitar</button>` : r.ti.kind === 'suggest' ? `<button class="vj-b o" data-uid="${esc(r.uid)}" data-on="1" data-kind="test">Prueba</button><button class="vj-b o" data-uid="${esc(r.uid)}" data-on="1" data-kind="company">Empresa</button>` : ''}</span></div>`;
    openModal(`
      <h4>Cuentas de prueba y de la empresa</h4>
      <p class="vj-sub" style="margin:0 0 8px">Con «Excluir» activado, sus viajes no cuentan en totales ni comisión. Nada se marca solo: las sugeridas necesitan su clic.</p>
      <div class="row" style="border:0"><input type="text" id="vj-ta-q" placeholder="Buscar usuario por nombre o correo" style="width:100%"></div>
      <div id="vj-ta-found"></div>
      <div style="font-weight:700;margin-top:8px">Marcadas (${marked.length})</div>${marked.map(line).join('') || '<div class="vj-sub">Ninguna.</div>'}
      <div style="font-weight:700;margin-top:10px">Sugeridas (${suggested.length})</div>${suggested.map(line).join('') || '<div class="vj-sub">Ninguna.</div>'}
      <div class="vj-row" style="justify-content:flex-end;margin-top:12px"><button class="vj-b g" data-close>Cerrar</button></div>`,
    (m) => {
        const bind = (root) => root.querySelectorAll('button[data-uid]').forEach((b) => b.addEventListener('click', async () => {
            b.disabled = true;
            try {
                await callFn('staffSetTestAccount', { uid: b.dataset.uid, isTestAccount: b.dataset.on === '1', kind: b.dataset.kind || 'test' });
                const u = ST.users.get(b.dataset.uid);
                if (u) { u.isTestAccount = b.dataset.on === '1'; u.testAccountKind = b.dataset.on === '1' ? (b.dataset.kind || 'test') : null; }
                toast('Guardado.', 'success');
                openTestAccounts();
                render();
            } catch (err) { toast(errMsg(err), 'error'); b.disabled = false; }
        }));
        bind(m);
        m.querySelector('#vj-ta-q').addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            const box = m.querySelector('#vj-ta-found');
            if (q.length < 2) { box.innerHTML = ''; return; }
            const hits = [];
            ST.users.forEach((u, uid) => {
                if (hits.length >= 8) return;
                if (`${u.name || ''} ${u.email || ''}`.toLowerCase().includes(q) && u.isTestAccount !== true) hits.push({ uid, u });
            });
            box.innerHTML = hits.map(({ uid, u }) => `<div class="row"><span><b>${esc(u.name || uid)}</b> <span class="vj-sub">${esc(u.role || '')} ${esc(u.email || '')}</span></span>
              <span class="vj-row" style="gap:6px"><button class="vj-b o" data-uid="${esc(uid)}" data-on="1" data-kind="test">Prueba</button><button class="vj-b o" data-uid="${esc(uid)}" data-on="1" data-kind="company">Empresa</button></span></div>`).join('') || '<div class="vj-sub">Sin resultados.</div>';
            bind(box);
        });
    });
}

function driverCandidates(t) {
    const lat = Number(t.originLat);
    const lng = Number(t.originLng);
    const now = Date.now();
    const out = [];
    const seen = new Set();
    const add = (uid, extra = {}) => {
        if (!uid || seen.has(uid)) return;
        const u = ST.users.get(uid) || {};
        if (u.role && String(u.role).toLowerCase() !== 'driver') return;
        seen.add(uid);
        const l = ST.locs.get(uid) || {};
        const at = tsMs(l.updatedAt) || Number(l.updatedAtMs) || 0;
        const online = l.online !== false && at && now - at < ONLINE_STALE_MS;
        const km = Number.isFinite(lat) && Number.isFinite(Number(l.lat ?? l.latitude)) ? haversineKm(lat, lng, Number(l.lat ?? l.latitude), Number(l.lng ?? l.longitude)) : null;
        out.push({ uid, name: u.name || l.name || extra.name || 'Conductor', online, km, ...extra });
    };
    bidIds(t).forEach((uid) => add(uid, { bid: true, name: t.driverBids?.[uid]?.driverName }));
    viewerIds(t).forEach((uid) => add(uid, { viewed: true, name: t.viewedBy?.[uid]?.name }));
    ST.locs.forEach((_, uid) => add(uid));
    out.sort((a, b) => (!!b.bid - !!a.bid) || (!!b.viewed - !!a.viewed) || (b.online - a.online) || ((a.km ?? 1e9) - (b.km ?? 1e9)));
    return out.slice(0, 30);
}
function openAssign(id) {
    const t = ST.trips.find((x) => x.id === id);
    if (!t) return;
    const list = driverCandidates(t);
    openModal(`
      <h4>Asignar manual · ${shortId(t.id)}</h4>
      <p class="vj-sub" style="margin:0 0 8px">${esc(placeOf(t, 'origin'))} → ${esc(placeOf(t, 'destination'))} · ${fmtL0(priceOf(t))}. Primero quienes ofertaron o lo vieron, luego los más cercanos en línea.</p>
      ${list.map((d) => `<div class="row"><span><b>${esc(d.name)}</b><div class="vj-sub">${d.bid ? 'Ofertó · ' : d.viewed ? 'Lo vio · ' : ''}${d.online ? '<span style="color:var(--ok)">en línea</span>' : 'desconectado'}${d.km != null ? ` · ${d.km.toFixed(1)} km` : ''}</div></span>
        <button class="vj-b" data-uid="${esc(d.uid)}">Asignar</button></div>`).join('') || '<div class="vj-empty">No hay conductores para mostrar.</div>'}
      <div class="vj-row" style="justify-content:flex-end;margin-top:12px"><button class="vj-b g" data-close>Cerrar</button></div>`,
    (m) => m.querySelectorAll('button[data-uid]').forEach((b) => b.addEventListener('click', async () => {
        if (typeof window.staffAssignTripToViewer !== 'function') { toast('Asignar no está disponible en esta vista.', 'warning'); return; }
        b.disabled = true;
        try { await window.staffAssignTripToViewer(t.id, b.dataset.uid); closeModal(); } catch (err) { toast(errMsg(err), 'error'); b.disabled = false; }
    })));
}
function openViewers(id) {
    const t = ST.trips.find((x) => x.id === id);
    if (!t) return;
    const notified = new Set(notifiedIds(t));
    const delivered = new Set(deliveredIds(t));
    const viewers = t.viewedBy || {};
    const bids = t.driverBids || {};
    const ids = [...new Set([...notified, ...Object.keys(viewers), ...Object.keys(bids)])];
    const rows = ids.map((uid) => {
        const u = ST.users.get(uid) || {};
        const rec = tokenRecords(u)[0];
        const v = viewers[uid];
        const b = bids[uid];
        return `<div class="row"><span><b>${esc(u.name || v?.name || b?.driverName || uid.slice(0, 6))}</b><div class="vj-sub">${esc(deviceLabel(rec))}</div></span>
          <span class="vj-row" style="gap:4px">${notified.has(uid) ? '<span class="vj-tag">Notificado</span>' : ''}${delivered.has(uid) ? '<span class="vj-tag ok">Le llegó</span>' : notified.has(uid) ? '<span class="vj-tag warn">Sin confirmar</span>' : ''}${v ? `<span class="vj-tag blue">Vio ${fmtTime(tsMs(v.viewedAt) || tsMs(v.lastViewedAt), true)}</span>` : ''}${b ? `<span class="vj-tag pur">Ofertó ${fmtL0(Number(b.price ?? b.amount ?? b.offer) || 0)}</span>` : ''}</span></div>`;
    }).join('');
    openModal(`<h4>Vistas y ofertas · ${shortId(t.id)}</h4>
      <p class="vj-sub" style="margin:0 0 8px">${notifiedCount(t)} notificados · ${delivered.size} confirmaron que les llegó · ${Object.keys(viewers).length} lo vieron · ${Object.keys(bids).length} ofertaron${t.resendCount ? ` · reenviado ${t.resendCount}×` : ''}.</p>
      ${rows || '<div class="vj-empty">Nadie fue notificado ni lo vio.</div>'}
      <div class="vj-row" style="justify-content:flex-end;margin-top:12px"><button class="vj-b g" data-close>Cerrar</button></div>`);
}
function openChat(id) {
    const t = ST.trips.find((x) => x.id === id);
    if (!t) return;
    const msgs = Array.isArray(t.chat) ? t.chat : [];
    openModal(`<h4>Chat · ${shortId(t.id)}</h4>
      ${msgs.map((m) => `<div class="row" style="align-items:flex-start"><span><b>${esc(m.senderName || (m.sender === t.clientId ? 'Pasajero' : m.sender === t.driverId ? 'Conductor' : 'Sistema'))}</b><div>${esc(m.text || '')}</div></span><span class="vj-sub">${fmtTime(Number(m.time) || tsMs(m.time))}</span></div>`).join('') || '<div class="vj-empty">Sin mensajes.</div>'}
      <div class="vj-row" style="justify-content:flex-end;margin-top:12px"><button class="vj-b g" data-close>Cerrar</button></div>`);
}
function phoneOf(uid) {
    const u = ST.users.get(uid) || {};
    return String(u.phone || u.phoneNumber || '').replace(/[^\d+]/g, '');
}
function openContact(id) {
    const t = ST.trips.find((x) => x.id === id);
    if (!t) return;
    const ph = phoneOf(t.clientId) || String(t.clientPhone || '').replace(/[^\d+]/g, '');
    openModal(`<h4>Contactar a ${esc(clientName(t))}</h4>
      <p class="vj-sub" style="margin:0 0 8px">Viaje ${shortId(t.id)} · ${statusTag(t)}</p>
      <div class="row"><span>Aviso dentro de la app (push)</span><button class="vj-b" data-act2="push">Escribir aviso</button></div>
      ${ph ? `<div class="row"><span>Llamar <b>${esc(ph)}</b></span><a class="vj-b o" href="tel:${esc(ph)}">Llamar</a></div>` : '<div class="row"><span class="vj-sub">Sin teléfono guardado.</span></div>'}
      <div class="vj-row" style="justify-content:flex-end;margin-top:12px"><button class="vj-b g" data-close>Cerrar</button></div>`,
    (m) => m.querySelector('[data-act2="push"]').addEventListener('click', () => { closeModal(); notifyPassenger(t.id); }));
}
function openMarkPaid() {
    const owing = computeOwing();
    openModal(`<h4>Marcar pagado</h4>
      <p class="vj-sub" style="margin:0 0 8px">Pone en cero la cuenta pendiente del conductor (usa la función de siempre, pide confirmación y guarda quién lo hizo).</p>
      ${owing.map((o) => `<div class="row"><span><b>${esc(o.name)}</b><div class="vj-sub">${fmtL(o.amount)}${o.since ? ` · desde ${fmtDayShort(o.since)}` : ''}</div></span><button class="vj-b o" data-uid="${esc(o.uid)}">Marcar pagado</button></div>`).join('') || '<div class="vj-empty">Nadie debe.</div>'}
      <div class="vj-row" style="justify-content:flex-end;margin-top:12px"><button class="vj-b g" data-close>Cerrar</button></div>`,
    (m) => m.querySelectorAll('button[data-uid]').forEach((b) => b.addEventListener('click', async () => {
        const o = owing.find((x) => x.uid === b.dataset.uid);
        if (!o || typeof window.staffClearDriverPendingAccount !== 'function') return;
        await window.staffClearDriverPendingAccount(o.uid, o.name, o.amount);
        closeModal();
        reloadSlow();
    })));
}
function openPurge(ids) {
    openModal(`<h4>Borrar para siempre (${ids.length})</h4>
      <p class="vj-sub" style="margin:0 0 8px">Esto <b>no se puede deshacer</b>. Se borra el viaje y queda una nota en el registro con su nombre. Escriba <b>BORRAR</b> para confirmar.</p>
      <div class="row" style="border:0"><input type="text" id="vj-confirm" placeholder="BORRAR" style="width:100%" autocomplete="off"></div>
      <div class="vj-row" style="justify-content:flex-end;margin-top:12px"><button class="vj-b g" data-close>Cancelar</button><button class="vj-b red" id="vj-purge" disabled>Borrar para siempre</button></div>`,
    (m) => {
        const inp = m.querySelector('#vj-confirm');
        const btn = m.querySelector('#vj-purge');
        inp.addEventListener('input', () => { btn.disabled = inp.value.trim() !== 'BORRAR'; });
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
                const r = await callFn('staffTripsAction', { action: 'purge', tripIds: ids, confirm: 'BORRAR' });
                toast(`${r?.done ?? ids.length} viaje(s) borrados para siempre.`, 'success');
                ids.forEach((id) => SEL.trash.delete(id));
                closeModal();
            } catch (err) { toast(errMsg(err), 'error'); btn.disabled = false; }
        });
    });
}

// ───────────────────────── Acciones ─────────────────────────
async function tripsAction(action, ids, okMsg) {
    if (!ids.length) return;
    try {
        const r = await callFn('staffTripsAction', { action, tripIds: ids });
        const done = r?.done ?? ids.length;
        const now = Date.now();
        // Reflejo inmediato (el onSnapshot lo confirma luego)
        ids.forEach((id) => {
            const t = ST.trips.find((x) => x.id === id);
            if (!t) return;
            if (action === 'trash') { t.trashedAtMs = now; t.trashPurgeAfterMs = now + TRASH_DAYS * DAY; t.trashedByName = myProfile().name || 'Staff'; }
            if (action === 'restore') { delete t.trashedAtMs; delete t.trashPurgeAfterMs; }
            if (action === 'review') { t.staffReviewedAtMs = now; t.staffReviewedByName = myProfile().name || 'Staff'; }
            if (action === 'unreview') { delete t.staffReviewedAtMs; }
        });
        toast(okMsg.replace('{n}', done), 'success');
    } catch (e) { toast(errMsg(e), 'error'); }
    render();
}
async function moveToTrash(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    await tripsAction('trash', list, '{n} viaje(s) en la papelera (se pueden recuperar 30 días).');
}
async function resend(id, btn) {
    if (btn) btn.disabled = true;
    try {
        const r = await callFn('staffResendTrip', { tripId: id });
        if (r?.ok === false) {
            const why = { 'not-pending': 'ya tiene conductor o no está pendiente', 'waiting-client': 'el pasajero aún no confirma', simulation: 'es una simulación', 'not-found': 'ya no existe' }[r.reason] || r.reason;
            toast(`No se reenvió: ${why}.`, 'warning');
        } else {
            toast(`Reenviado: ${r?.notified ?? 0} conductor(es) avisados${r?.noToken ? ` · ${r.noToken} sin avisos activados` : ''}.`, 'success');
        }
    } catch (e) { toast(errMsg(e), 'error'); }
    if (btn) btn.disabled = false;
}
async function sendTestPush(btn) {
    const sel = mounted?.root?.querySelector('select[data-act="testDriver"]');
    const uid = sel?.value;
    if (!uid) return;
    btn.disabled = true;
    try {
        const r = await callFn('staffSendTestPush', { driverUid: uid });
        const u = ST.users.get(uid);
        if (u) u.lastPushTest = { sentAtMs: Date.now(), sent: r?.sent, confirmedAtMs: null, testId: r?.testId };
        toast(r?.sent ? `Prueba enviada a ${r.sent} teléfono(s). Si llega, se marca «confirmada» sola.` : 'No se pudo enviar: el conductor no tiene avisos activados.', r?.sent ? 'success' : 'warning');
        render();
        setTimeout(reloadSlow, 15000);
    } catch (e) { toast(errMsg(e), 'error'); }
    btn.disabled = false;
}
async function revealPin(id) {
    if (!confirm('¿Mostrar el PIN? Queda registrado quién lo vio.')) return;
    try {
        const r = await callFn('staffRevealTripPin', { tripId: id });
        pinShown[id] = r?.pin || '—';
        render();
        refreshDrawer();
    } catch (e) { toast(errMsg(e), 'error'); }
}
async function notifyPassenger(id) {
    const t = ST.trips.find((x) => x.id === id);
    if (!t?.clientId) return;
    const def = isSearching(t) ? 'Seguimos buscando conductor para su viaje. Gracias por esperar.' : 'Mensaje de HonduRaite sobre su viaje.';
    const text = window.prompt(`Aviso dentro de la app para ${clientName(t)}:`, def);
    if (!text || !text.trim()) return;
    try {
        const fs = DEPS.firestore || await import(FS_URL);
        const db = DEPS.db;
        const ref = fs.doc(fs.collection(db, 'artifacts', DEPS.appId, 'public', 'data', 'notifications'));
        await fs.setDoc(ref, {
            targetRole: 'client', targetUserId: String(t.clientId), targetUserName: clientName(t), personal: true,
            sendPush: true, broadcastPush: false, pushDispatched: false, type: 'staff_trip_update', tripId: t.id,
            title: 'HonduRaite · su viaje', body: text.trim().slice(0, 400), message: text.trim().slice(0, 400),
            tag: `staff-trip-${t.id}-${Date.now()}`, sentBy: me()?.uid || null, sentByName: myProfile().name || 'Staff',
            createdAt: fs.serverTimestamp(), createdAtMs: Date.now()
        });
        toast('Aviso enviado al pasajero.', 'success');
    } catch (e) { toast(errMsg(e), 'error'); }
}
function remind(uid) {
    const o = computeOwing().find((x) => x.uid === uid);
    if (!o || typeof window.sendDepositReminderToDriver !== 'function') return;
    window.sendDepositReminderToDriver(o.uid, o.name, o.amount, o.since ? fmtWait(Date.now() - o.since) : '', o.overdue);
}
function remindAll() {
    const owing = computeOwing();
    if (!owing.length || typeof window.sendDepositReminderBulk !== 'function') return;
    window._statsOwingDrivers = owing.map((o) => ({ uid: o.uid, name: o.name, totalOwed: o.amount, sinceLabel: o.since ? fmtWait(Date.now() - o.since) : '—', overdue: o.overdue }));
    window.sendDepositReminderBulk();
}
function exportCsv() {
    const rows = histRows();
    const head = ['id', 'fecha', 'servicio', 'ciudad', 'origen', 'destino', 'pasajero', 'conductor', 'km', 'precio', 'comision_pct', 'comision', 'calificacion', 'estado', 'cuenta'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(',')].concat(rows.map((t) => {
        const c = tripCommission(t);
        const done = t.status === 'completed';
        return [t.id, new Date(createdMs(t)).toISOString(), svcLabel(t), cityOf(t).name, placeOf(t, 'origin'), placeOf(t, 'destination'), clientName(t), driverName(t),
            kmOf(t).toFixed(1), priceOf(t).toFixed(2), done ? c.pct : '', done ? c.amount.toFixed(2) : '', rateStars(t) ?? '', t.status, tripTestKind(t) || ''].map(q).join(',');
    }));
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `viajes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function openDetail(id) {
    const narrow = window.matchMedia?.('(max-width: 760px)')?.matches;
    if (UI.tab === 'review' && !narrow) { UI.detailId = id; popTrashFor = null; render(); return; }
    UI.detailId = id;
    openDrawer(id);
}

function onClick(e, scope) {
    const el = e.target.closest('[data-act]');
    if (!el || (scope && !scope.contains(el))) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    const v = el.dataset.v;
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    switch (act) {
        case 'tab': UI.tab = v; popTrashFor = null; saveUi(); render(); break;
        case 'svc': UI.svc = v; UI.histPage = 1; saveUi(); render(); break;
        case 'period': UI.period = v; UI.histPage = 1; saveUi(); render(); break;
        case 'excludeTest': UI.excludeTest = !UI.excludeTest; saveUi(); render(); break;
        case 'testAccounts': openTestAccounts(); break;
        case 'settings': openSettings(); break;
        case 'classic': openClassic(); break;
        case 'resend': resend(id, el); break;
        case 'assign': openAssign(id); break;
        case 'notifyPassenger': notifyPassenger(id); break;
        case 'detail': case 'pick':
            if (e.target.closest('[data-act="check"]')) break;
            openDetail(id); break;
        case 'check': SEL.review.has(id) ? SEL.review.delete(id) : SEL.review.add(id); render(); break;
        case 'checkAll': {
            const shown = (UI.reviewChip === 'all' ? reviewQueue() : reviewQueue().filter((t) => reviewKinds(t).includes(UI.reviewChip))).slice(0, 60);
            if (SEL.review.size === shown.length) SEL.review.clear(); else shown.forEach((t) => SEL.review.add(t.id));
            render(); break;
        }
        case 'reviewChip': UI.reviewChip = v; UI.detailId = null; saveUi(); render(); break;
        case 'reviewSel': tripsAction('review', [...SEL.review], '{n} marcado(s) como revisados.').then(() => SEL.review.clear()); break;
        case 'trashSel': if (confirm(`¿Mover ${SEL.review.size} viaje(s) a la papelera? Se pueden recuperar durante ${TRASH_DAYS} días.`)) moveToTrash([...SEL.review]).then(() => SEL.review.clear()); break;
        case 'reviewOne': tripsAction('review', [id], 'Marcado como revisado.'); break;
        case 'unreview': tripsAction('unreview', [id], 'Vuelve a «Por revisar».'); break;
        case 'trashPop': popTrashFor = id; render(); refreshDrawer(); break;
        case 'trashCancel': popTrashFor = null; render(); refreshDrawer(); break;
        case 'trashYes': popTrashFor = null; closeDrawer(); moveToTrash([id]); break;
        case 'restore': tripsAction('restore', [id], 'Viaje restaurado.'); closeDrawer(); break;
        case 'checkTrash': SEL.trash.has(id) ? SEL.trash.delete(id) : SEL.trash.add(id); render(); break;
        case 'checkAllTrash': {
            const list = baseTrips().filter((t) => t.trashedAtMs && passCity(t) && passSvc(t));
            if (SEL.trash.size === list.length) SEL.trash.clear(); else list.forEach((t) => SEL.trash.add(t.id));
            render(); break;
        }
        case 'restoreSel': tripsAction('restore', [...SEL.trash], '{n} viaje(s) restaurados.').then(() => SEL.trash.clear()); break;
        case 'purgeSel': openPurge([...SEL.trash]); break;
        case 'closeDetail': closeDrawer(); if (UI.tab === 'review') { UI.detailId = null; } popTrashFor = null; render(); break;
        case 'contact': openContact(id); break;
        case 'viewers': openViewers(id); break;
        case 'chat': openChat(id); break;
        case 'pin': revealPin(id); break;
        case 'factura': if (typeof window.showFacturaForTrip === 'function') window.showFacturaForTrip(id); break;
        case 'page': UI.histPage = Number(v) || 1; UI.histSize = PAGE; render(); break;
        case 'more': UI.histSize = (UI.histSize || PAGE) + PAGE; render(); break;
        case 'csv': exportCsv(); break;
        case 'sendTest': sendTestPush(el); break;
        case 'remind': remind(el.dataset.uid); break;
        case 'remindAll': remindAll(); break;
        case 'markPaid': openMarkPaid(); break;
        case 'pushReload': loadPushStatus(true); break;
        case 'pushStatus': PUSH.status = v || 'all'; render(); break;
        case 'pushNudge': pushNudge([el.dataset.uid]); break;
        case 'pushNudgeAll': pushNudgeAll(); break;
        case 'availMode': if (!AVAIL_UI.saving) saveAvail(el.dataset.svc, v, null); break;
        case 'availMsg': {
            const A = DEPS.avail;
            const zk = availCityKey();
            const cur = A ? A.getServiceCustomMessage(availConfig(), zk === '_all' ? null : zk, el.dataset.svc) : '';
            const msg = window.prompt('Mensaje que verá el cliente cuando este servicio no esté disponible (vacío = mensaje normal):', cur || '');
            if (msg !== null) saveAvail(el.dataset.svc, null, msg);
            break;
        }
        default: break;
    }
}
function onChange(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'city') { UI.city = el.value; UI.histPage = 1; saveUi(); render(); }
    if (act === 'availCity') { AVAIL_UI.city = el.value; render(); }
    if (act === 'from' || act === 'to') { UI[act] = el.value; UI.period = 'range'; UI.histPage = 1; saveUi(); render(); }
    if (act === 'testDriver') {
        const lab = mounted?.root?.querySelector('#vj-test-label');
        UI.testDriver = el.value;
        if (lab) lab.textContent = `${el.options[el.selectedIndex].text} ▾`;
    }
}
let qTimer = null;
function onInput(e) {
    const pq = e.target.closest('[data-act="pushQ"]');
    if (pq) {
        PUSH.q = pq.value;
        clearTimeout(qTimer);
        qTimer = setTimeout(() => {
            render();
            const inp = mounted?.root?.querySelector('[data-act="pushQ"]');
            if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
        }, 250);
        return;
    }
    const el = e.target.closest('[data-act="histQ"]');
    if (!el) return;
    UI.histQ = el.value;
    UI.histPage = 1;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
        render();
        const inp = mounted?.root?.querySelector('[data-act="histQ"]');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 250);
}

// ───────────────────────── Render principal / montaje ─────────────────────────
function bodyHtml() {
    if (!ST.loadedTrips) return '<div class="vj-empty">Cargando viajes…</div>';
    switch (UI.tab) {
        case 'hist': return renderHistory();
        case 'sched': return renderScheduled();
        case 'review': return renderReview();
        case 'trash': return renderTrash();
        case 'push': return renderPush();
        case 'rate': return renderRate();
        case 'avail': return renderAvail();
        default: return renderLive();
    }
}
function render() {
    if (!mounted) return;
    if (!mounted.root.isConnected) { unmount(); return; }
    ST.now = Date.now();
    const scrollEl = mounted.root.querySelector('.vj-body');
    const keep = scrollEl ? scrollEl.scrollTop : 0;
    try {
        mounted.root.innerHTML = `${renderTop()}<div class="vj-body">${bodyHtml()}</div>`;
    } catch (e) {
        console.error('[viajes] render', e);
        mounted.root.innerHTML = `<div class="vj-body"><div class="vj-empty">No se pudo dibujar el panel: ${esc(e?.message || e)} · <span class="vj-link" data-act="classic">Vista anterior</span></div></div>`;
    }
    const sc = mounted.root.querySelector('.vj-body');
    if (sc && keep) sc.scrollTop = keep;
    const tabs = mounted.root.querySelector('.vj-tabs');
    const on = tabs?.querySelector('button.on');
    if (tabs && on && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = Math.max(0, on.offsetLeft - 24);
    refreshDrawer();
}
function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
        renderQueued = false;
        const ae = document.activeElement;
        // No redibujar mientras el usuario escribe o tiene un menú abierto
        if (mounted && ae && mounted.root.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) { setTimeout(scheduleRender, 1500); return; }
        render();
    }, 250);
}
function tick() {
    if (!mounted) return;
    if (!mounted.root.isConnected) { unmount(); return; }
    if (UI.tab !== 'live') return;
    mounted.root.querySelectorAll('[data-ring]').forEach((el) => {
        const t = ST.trips.find((x) => x.id === el.dataset.ring);
        if (t) el.innerHTML = ringHtml(t);
    });
}
function unmount() {
    if (!mounted) return;
    mounted.unsubs.forEach((u) => { try { u(); } catch (_) {} });
    clearInterval(tickTimer);
    clearInterval(refreshTimer);
    tickTimer = null;
    refreshTimer = null;
    closeDrawer();
    try { delete window.__vjMounted; } catch (_) {}
    mounted = null;
}
function attach(container, kind) {
    unmount();
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'vj';
    root.addEventListener('click', (e) => onClick(e));
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    container.appendChild(root);
    mounted = { container, root, kind, unsubs: [] };
    window.__vjMounted = true;
    tickTimer = setInterval(tick, 1000);
    return mounted;
}
function ensureCss() {
    if (document.getElementById('vj-css')) return;
    const l = document.createElement('link');
    l.id = 'vj-css';
    l.rel = 'stylesheet';
    const v = (window.APP_CONFIG && window.APP_CONFIG.appVersion) || '';
    l.href = `css/ops-viajes.css${v ? `?v=${v}` : ''}`;
    document.head.appendChild(l);
}

// ───────────────────────── Datos (Firestore) ─────────────────────────
async function reloadSlow() {
    if (!mounted || !DEPS.db) return;
    const fs = DEPS.firestore || await import(FS_URL);
    const base = ['artifacts', DEPS.appId, 'public', 'data'];
    const [users, deps, app] = await Promise.allSettled([
        fs.getDocs(fs.collection(DEPS.db, ...base, 'users')),
        fs.getDocs(fs.collection(DEPS.db, ...base, 'driver_deposit_requests')),
        fs.getDoc(fs.doc(DEPS.db, ...base, 'appSettings', 'main'))
    ]);
    if (users.status === 'fulfilled') {
        const m = new Map();
        users.value.forEach((d) => m.set(d.id, { uid: d.id, ...d.data() }));
        ST.users = m;
    }
    if (deps.status === 'fulfilled') ST.deposits = deps.value.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (app.status === 'fulfilled' && app.value.exists()) ST.appSettings = app.value.data() || {};
    scheduleRender();
}
async function startData() {
    const fs = DEPS.firestore || await import(FS_URL);
    DEPS.firestore = fs;
    const base = ['artifacts', DEPS.appId, 'public', 'data'];
    const onErr = (what) => (err) => { console.warn(`[viajes] ${what}:`, err); toast(`No se pudo leer ${what}.`, 'error'); };
    mounted.unsubs.push(fs.onSnapshot(fs.collection(DEPS.db, ...base, 'trips'), (snap) => {
        ST.trips = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        ST.loadedTrips = true;
        scheduleRender();
    }, onErr('viajes')));
    mounted.unsubs.push(fs.onSnapshot(fs.collection(DEPS.db, ...base, 'drivers_location'), (snap) => {
        const m = new Map();
        snap.forEach((d) => m.set(d.id, d.data() || {}));
        ST.locs = m;
        scheduleRender();
    }, onErr('ubicaciones')));
    mounted.unsubs.push(fs.onSnapshot(fs.doc(DEPS.db, ...base, 'platformConfig', 'main'), (snap) => {
        ST.config = snap.exists() ? (snap.data() || {}) : {};
        try { window.invalidatePlatformCommissionCache?.(); } catch (_) {}
        scheduleRender();
    }, () => {}));
    reloadSlow();
    refreshTimer = setInterval(() => { reloadSlow(); }, 60000);
    // «se actualiza solo cada 10 s»: aunque no cambien datos, recalcula tiempos y KPIs
    mounted.unsubs.push((() => { const h = setInterval(scheduleRender, 10000); return () => clearInterval(h); })());
}
function mountLive(container, kind) {
    ensureCss();
    attach(container, kind);
    render();
    startData().catch((e) => { console.error('[viajes] datos', e); });
}

// ───────────────────────── Vista anterior ─────────────────────────
const ORIG = {};
function openClassic() {
    const kind = mounted?.kind;
    const container = mounted?.container;
    unmount();
    if (kind === 'admin' && ORIG.startAdmin) {
        window.__vjClassic = true;
        ORIG.startAdmin(container);
    } else if (ORIG.loadSup) {
        window.__vjClassic = true;
        ORIG.loadSup();
    }
    setTimeout(() => {
        if (!container) return;
        const bar = document.createElement('div');
        bar.style.cssText = 'padding:8px 12px;font:600 12px Inter,system-ui,sans-serif;color:#0A6CFF;cursor:pointer;text-decoration:underline';
        bar.textContent = '← Volver al panel nuevo de Viajes';
        bar.onclick = () => { window.__vjClassic = false; if (kind === 'admin') window.startAdminTripsListener(container); else window.loadSupervisorTrips(); };
        container.prepend(bar);
    }, 600);
}

// ───────────────────────── Público ─────────────────────────
export function initViajesPanel(deps = {}) {
    DEPS = { ...deps };
    window.viajesMoveToTrash = (ids) => moveToTrash(ids);
    window.viajesPanelOpenSettings = () => openSettings();
    window.viajesOpenTrip = (id) => { if (mounted) { UI.tab = 'review'; UI.detailId = id; render(); } };
    const me0 = () => DEPS.getCurrentUser?.();
    const isStaff = () => { try { return !!DEPS.isStaffUser?.(me0(), DEPS.getUserProfile?.()); } catch (_) { return false; } };

    // Supervisor: «Viajes» abre el panel nuevo
    ORIG.loadSup = window.loadSupervisorTrips;
    window.loadSupervisorTrips = () => {
        if (window.__vjClassic || !isStaff()) { ORIG.loadSup?.(); return; }
        window.setSupervisorNavActive?.('trips');
        window.stopSupervisorTripsListener?.();
        const c = document.getElementById('supervisor-pending-list');
        if (c) mountLive(c, 'supervisor');
    };
    // Admin: el listener anterior sigue corriendo (alertas de viaje nuevo) pero pinta en un div suelto
    ORIG.startAdmin = window.startAdminTripsListener;
    ORIG.stopAdmin = window.stopAdminTripsListener;
    if (typeof ORIG.startAdmin === 'function') {
        window.startAdminTripsListener = (targetContainer = null) => {
            const c = targetContainer || document.getElementById('admin-users-list');
            if (window.__vjClassic || !c || !isStaff()) { ORIG.startAdmin(targetContainer); return; }
            ORIG.startAdmin(document.createElement('div'));
            mountLive(c, 'admin');
        };
        window.stopAdminTripsListener = () => {
            if (mounted?.kind === 'admin') unmount();
            ORIG.stopAdmin?.();
        };
    }
}

/** Para el arnés local de capturas: monta con datos de muestra, sin Firebase. */
export function mountViajesPanelWithData(container, data = {}, opts = {}) {
    DEPS = {
        getCurrentUser: () => ({ uid: 'staff-1', email: opts.admin ? ADMIN_EMAIL : 'sup@example.com' }),
        getUserProfile: () => ({ name: 'Supervisor', role: opts.admin ? 'admin' : 'supervisor' }),
        isAdminUser: () => !!opts.admin,
        callFn: async (name, d) => { console.log('[harness] callFn', name, d); return { ok: true, done: (d?.tripIds || []).length, notified: 6, sent: 1 }; },
        ...(opts.deps || {})
    };
    ST.trips = data.trips || [];
    ST.users = new Map(Object.entries(data.users || {}));
    ST.locs = new Map(Object.entries(data.locs || {}));
    ST.deposits = data.deposits || [];
    ST.config = data.config || {};
    ST.appSettings = data.appSettings || {};
    ST.loadedTrips = true;
    Object.assign(UI, { histPage: 1, histSize: PAGE, histQ: '', detailId: null }, opts.ui || {});
    SEL.review = new Set(opts.selectReview || []);
    SEL.trash = new Set(opts.selectTrash || []);
    popTrashFor = opts.trashPop || null;
    attach(container, 'harness');
    render();
    return { render, ST, UI };
}

export const __test = { renderRate, renderAvail, availRows, AVAIL_UI, setDeps: (d) => { DEPS = { ...DEPS, ...d }; }, liveCard, detailHtml, setPopTrash: (id) => { popTrashFor = id; }, computeKpis, computeOwing, computeHealth, reviewQueue, reviewKinds, tripCommission, deviceClass, svcKey, possibleCause, ST, UI, PUSH, renderPush, pushRows, pushNudgeTargets };
