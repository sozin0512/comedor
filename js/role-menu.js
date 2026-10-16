/**
 * Menú lateral por rol (propuesta de Jack, oct 2026).
 *
 * El menú (botón ⋮ en el teléfono) se arma según el rol DE CONFIANZA:
 *   - admin / supervisor: solo si el servidor lo confirma (callable refreshMyRoleClaims o custom
 *     claim del token). El `role` del perfil NO alcanza: el usuario lo puede editar.
 *   - conductor / pasajero: del perfil (no da permisos de staff).
 * Esconder botones no es seguridad: las pantallas de staff vuelven a verificar el rol al abrirse
 * (guardStaffRoutes) y el servidor valida cada callable y cada ruta de Firestore.
 */

const SUPREME_EMAIL = 'josuesoza0513@gmail.com';
const FN_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';

// ───────── Íconos (los mismos de la maqueta) ─────────
const svg = (body, color, fill = false) => `<svg viewBox="0 0 24 24" width="20" height="20" ${fill ? `fill="${color}" stroke="none"` : `fill="none" stroke="${color}"`} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const I = {
    moon: ['<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', '#1f2937'],
    wa: ['<path d="M4 20l1.3-3.8A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2.5 2.5 4.6 5 5l1.2-1.2-1.8-1-1 .8a4 4 0 0 1-2-2l.8-1-1-1.8z" stroke-width="1.4"/>', '#16a34a'],
    store: ['<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 11v9h13v-9"/>', '#ea8a1c'],
    mystore: ['<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 11v9h13v-9"/><path d="M10 20v-5h4v5"/>', '#16a37a'],
    history: ['<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>', '#2563eb'],
    check: ['<circle cx="12" cy="12" r="9.5"/><path d="M8 12.3l2.8 2.7L16.3 9.5" stroke="#fff" stroke-width="2.4" fill="none"/>', '#16a34a', true],
    checkOff: ['<circle cx="12" cy="12" r="9.5"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>', '#9ca3af'],
    shield: ['<path d="M12 2.5l8 3v6c0 5-3.5 8.7-8 10-4.5-1.3-8-5-8-10v-6z"/>', '#7c3aed'],
    superv: ['<circle cx="9" cy="8" r="3.6"/><path d="M2.5 20c.6-3.6 3.2-5.6 6.5-5.6s5.5 1.4 6.3 3.6"/><path d="M15.5 12.5l2 2 4-4"/>', '#16a37a'],
    power: ['<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>', '#dc2626'],
    car: ['<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3.5 11h17v5h-17z"/><circle cx="7.5" cy="16.5" r="1.6"/><circle cx="16.5" cy="16.5" r="1.6"/>', '#2563eb'],
    pin: ['<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><path d="M9.6 9.6l1.6 1.5 3.2-3.2" />', '#e11d48'],
    card: ['<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>', '#0891b2'],
    list: ['<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>', '#2563eb'],
    bank: ['<path d="M3 9.5L12 4l9 5.5"/><path d="M5 10.5v7M9.6 10.5v7M14.4 10.5v7M19 10.5v7M3 20h18"/>', '#ea8a1c'],
    doc: ['<path d="M6 2.8h8l4.5 4.5V21H6z"/><path d="M14 2.8v4.5h4.5"/><path d="M9 13h6M9 16.5h4"/>', '#4f46e5'],
    bell: ['<path d="M6 9.5a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>', '#16a34a'],
    swap: ['<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>', '#0f766e']
};
const icon = (k) => { const [b, c, f] = I[k]; return svg(b, c, !!f); };
const LOGO = '<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><defs><linearGradient id="rm-lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6bf2"/><stop offset="1" stop-color="#173f9e"/></linearGradient></defs><rect width="40" height="40" rx="10" fill="url(#rm-lg)"/><path d="M20 8a8 8 0 0 0-8 8c0 6 8 14 8 14s8-8 8-14a8 8 0 0 0-8-8z" fill="#fff"/><circle cx="20" cy="16" r="3.2" fill="#2554c7"/><path d="M8 32h24" stroke="#7fb0ff" stroke-width="2.4" stroke-linecap="round"/></svg>';

export const ROLE_META = {
    client: { chip: 'PASAJERO', color: '#2563eb', bg: '#e8f0ff', sub: 'Cliente' },
    driver: { chip: 'CONDUCTOR', color: '#16a34a', bg: '#e6f7ec', sub: 'Socio conductor' },
    supervisor: { chip: 'SUPERVISOR', color: '#0f766e', bg: '#e2f5f2', sub: 'Staff · Supervisión' },
    admin: { chip: 'ADMIN', color: '#7c3aed', bg: '#f1eafe', sub: 'Staff · Acceso total' }
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtL = (n) => `L ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ───────── Rol de confianza ─────────
let DEPS = {};
const STATE = { trusted: undefined, source: 'none', pending: null, uid: null };

/** Rol de staff confirmado por el servidor: 'admin' | 'supervisor' | null (no staff) | undefined (aún no se sabe). */
export function getTrustedStaffRole() { return STATE.trusted; }

/**
 * Pregunta al servidor el rol (refreshMyRoleClaims: claims + doc roles) y, si cambió,
 * renueva el token para que las reglas de Firestore lo vean ya.
 * Si el callable no responde, usa el claim del token. Si tampoco hay, queda `undefined`
 * (la app sigue con el comportamiento anterior; el servidor igual bloquea).
 */
export async function resolveTrustedRole(user, { force = false } = {}) {
    if (!user?.uid) { STATE.trusted = null; STATE.uid = null; return null; }
    if (!force && STATE.uid === user.uid && STATE.trusted !== undefined) return STATE.trusted;
    if (!force && STATE.pending && STATE.uid === user.uid) return STATE.pending;
    STATE.uid = user.uid;
    STATE.pending = (async () => {
        const email = String(user.email || '').trim().toLowerCase();
        let role;
        try {
            const call = DEPS.callFn || (async (name) => {
                const { httpsCallable } = await import(FN_URL);
                return (await httpsCallable(DEPS.functions || window.cloudFunctions, name)()).data;
            });
            const r = await call('refreshMyRoleClaims');
            role = r?.role === 'admin' || r?.role === 'supervisor' ? r.role : null;
            STATE.source = r?.source || 'server';
            if (r?.changed) { try { await user.getIdToken(true); } catch (_) {} }
        } catch (_) {
            try {
                const t = await user.getIdTokenResult();
                const c = String(t?.claims?.role || '');
                if (c === 'admin' || c === 'supervisor') { role = c; STATE.source = 'token'; } else if (c) { role = null; STATE.source = 'token'; }
            } catch (_) {}
        }
        if (role === undefined && email === SUPREME_EMAIL) { role = 'admin'; STATE.source = 'email'; }
        STATE.trusted = role;
        STATE.pending = null;
        try { window.dispatchEvent(new CustomEvent('hr:trusted-role', { detail: { role, source: STATE.source } })); } catch (_) {}
        return role;
    })();
    return STATE.pending;
}

/** Rol del menú: admin / supervisor (de confianza) o conductor / pasajero (perfil). */
export function menuRoleFor(user, profile, trusted = STATE.trusted) {
    if (trusted === 'admin') return 'admin';
    if (trusted === 'supervisor') return 'supervisor';
    const p = profile || {};
    if (p.role === 'driver') return 'driver';
    return 'client';
}

// ───────── Menú ─────────
function item({ k, label, act, color, sub, extra = '', id = '', cls = '' }) {
    return `<button type="button" class="rm-it ${cls}" role="menuitem" data-rm-act="${act}" ${id ? `id="${id}"` : ''}>
      <span class="rm-ic">${icon(k)}</span>
      <span class="rm-lb"><span${color ? ` style="color:${color}"` : ''}>${label}</span>${sub ? `<span class="rm-sub">${sub}</span>` : ''}</span>${extra}</button>`;
}
const sw = (on) => `<span class="rm-sw ${on ? 'on' : ''}" aria-hidden="true"></span>`;
const badge = (n) => (n > 0 ? `<span class="rm-cnt">${n > 99 ? '99+' : n}</span>` : '');

function passengerItems(ctx) {
    const store = ctx.myStore;
    return [
        item({ k: 'car', label: 'Pedir viaje / Inicio', act: 'home' }),
        item({ k: 'store', label: 'Tiendas virtuales', act: 'stores' }),
        item({ k: 'mystore', label: 'Mi tienda', act: store ? 'mystore' : 'createstore', sub: store ? esc(store.name || 'Abrir mi tienda') : '¿Aún no tienes? <b>Crear mi tienda (máx. 1)</b>' }),
        item({ k: 'history', label: 'Mis viajes + Facturas', act: 'history' }),
        item({ k: 'pin', label: 'Lugares favoritos', act: 'favorites' }),
        item({ k: 'card', label: 'Métodos de pago', act: 'payments' })
    ];
}
const common = (ctx) => [
    item({ k: 'moon', label: 'Modo noche', act: 'theme', extra: sw(ctx.dark) }),
    item({ k: 'wa', label: 'Soporte WhatsApp', act: 'whatsapp' })
];
const logout = () => item({ k: 'power', label: 'Cerrar sesión', act: 'logout', color: '#dc2626', cls: 'rm-danger' });
function staffBox(items) {
    return `<div class="rm-staff"><div class="rm-sh"><span>STAFF</span><i>Solo visible para staff · validado en servidor</i></div>${items.join('')}</div>`;
}

export function buildMenuHtml(role, ctx = {}) {
    const meta = ROLE_META[role] || ROLE_META.client;
    const name = ctx.name || 'Usuario';
    const head = `<div class="rm-head"><div class="rm-logo">${LOGO}<div><b>Hondu<span>Raite</span></b><small>Viajes · Envíos · Tiendas</small></div></div>
      <span class="rm-role" style="--rc:${meta.color};--rb:${meta.bg}"><span class="rm-dot"></span>${meta.chip}</span></div>
      <div class="rm-who" style="--rc:${meta.color}"><span class="rm-av">${esc(name.trim().charAt(0).toUpperCase() || 'U')}</span><div><b>${esc(name)}</b><small>${meta.sub}</small></div></div>`;
    let body = [];
    if (role === 'driver') {
        const on = !!ctx.online;
        body = [
            `<button type="button" class="rm-toggle ${on ? 'on' : 'off'}" data-rm-act="online" role="menuitemcheckbox" aria-checked="${on}">
              <span><span class="rm-tt">${on ? 'Conectado' : 'Desconectado'}</span><span class="rm-ts">${on ? 'Recibiendo solicitudes de viaje' : 'No recibes solicitudes'}</span></span>
              <span class="rm-big"><span>${on ? 'EN LÍNEA' : 'PAUSA'}</span><b></b></span></button>`,
            item({ k: 'list', label: 'Viajes disponibles', act: 'available', extra: badge(ctx.available) }),
            item({ k: 'history', label: 'Mis viajes + Ganancias', act: 'history' }),
            item({ k: 'bank', label: 'Comisión y depósitos', act: 'deposits' }),
            `<div class="rm-box"><div class="rm-row"><span>Comisión pendiente</span><span class="rm-amt">${ctx.owed == null ? '…' : fmtL(ctx.owed)}</span></div>
              <div class="rm-row s"><span>${ctx.owed ? 'Deposita y sube el baucher a revisión' : 'Sin comisión pendiente'}</span></div>
              <button type="button" class="rm-btn" data-rm-act="deposit">Enviar depósito</button></div>`,
            item({ k: 'doc', label: 'Mis documentos / Vehículo', act: 'documents' }),
            item({ k: 'bell', label: 'Avisos activos', act: 'push', sub: ctx.pushOn ? 'Recibe alertas de viajes nuevos' : 'Toca para activarlos', extra: '<span class="rm-mini" data-rm-act="pushtest">Probar notificación</span>' }),
            ...common(ctx),
            item({ k: 'swap', label: 'Cambiar a modo pasajero', act: 'passengermode' }),
            logout()
        ];
    } else {
        body = passengerItems(ctx);
        if (role === 'admin') {
            body.push(item({ k: ctx.pushOn ? 'check' : 'checkOff', label: 'Avisos activos', act: 'push', sub: ctx.pushOn ? '' : 'Toca para activarlos', extra: '<span class="rm-mini" data-rm-act="pushtest">Probar</span>' }));
        }
        body.push(...common(ctx));
        if (role === 'supervisor') {
            body.push(staffBox([item({ k: 'superv', label: 'Supervisión', act: 'supervisor', extra: badge(ctx.staffPending) })]));
        } else if (role === 'admin') {
            body.push(staffBox([
                item({ k: 'superv', label: 'Supervisión', act: 'supervisor', extra: badge(ctx.staffPending) }),
                item({ k: 'shield', label: 'Panel Admin', act: 'admin', extra: badge(ctx.adminReports) })
            ]));
        }
        body.push(logout());
    }
    return `<div class="rm r-${role}" style="--rc:${meta.color}">${head}<div class="rm-items">${body.join('')}</div></div>`;
}

// ───────── Contexto en vivo ─────────
function numFromBadge(id) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden')) return 0;
    return parseInt(el.textContent, 10) || 0;
}
function liveCtx(user, profile) {
    const p = profile || {};
    const ids = new Set();
    document.querySelectorAll('#requests-list [data-trip-id]').forEach((el) => ids.add(el.getAttribute('data-trip-id')));
    let pushOn = false;
    try { pushOn = (typeof Notification !== 'undefined' && Notification.permission === 'granted') || !!window.hasAndroidFcmToken?.(); } catch (_) {}
    const debt = Math.max(Number(p.pendingDepositDebt) || 0, Number(p.driverLastDepositOwed) || 0);
    return {
        name: p.name || user?.displayName || (user?.email || '').split('@')[0] || 'Usuario',
        dark: document.documentElement.getAttribute('data-theme') === 'dark',
        myStore: window.getMyStoreSummary?.() || null,
        online: !!window.driverLocationWatchId,
        available: ids.size,
        owed: STATE.owed != null ? STATE.owed : debt,
        pushOn,
        staffPending: numFromBadge('supervisor-pending-badge') + numFromBadge('supervisor-reports-badge'),
        adminReports: numFromBadge('admin-reports-badge')
    };
}

export function renderRoleMenu() {
    const menu = document.getElementById('header-more-menu');
    if (!menu) return;
    const user = DEPS.getCurrentUser?.();
    if (!user) return;
    const profile = DEPS.getUserProfile?.() || {};
    const role = menuRoleFor(user, profile);
    // Los botones viejos del ⋮ se quedan en el DOM (otros módulos los buscan por id) pero ocultos por CSS.
    menu.classList.add('rm-host');
    menu.dataset.menuRole = role;
    let root = document.getElementById('rm-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'rm-root';
        menu.prepend(root);
    }
    root.innerHTML = buildMenuHtml(role, liveCtx(user, profile));
    syncStaffHeaderButtons(role);
}

/** Botones de escritorio (Panel Admin / Supervisión): solo con rol de confianza. */
function syncStaffHeaderButtons(role) {
    if (STATE.trusted === undefined) return; // aún sin respuesta del servidor: no tocar
    const show = (id, on) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('hidden', !on);
        if (on) el.classList.add('flex'); else el.classList.remove('flex');
    };
    show('admin-trigger-btn', role === 'admin');
    show('supervisor-trigger-btn', role === 'admin' || role === 'supervisor');
}

async function refreshOwed() {
    const user = DEPS.getCurrentUser?.();
    if (!user || (DEPS.getUserProfile?.() || {}).role !== 'driver' || typeof window.computeDriverDayStats !== 'function') return;
    try {
        const s = await window.computeDriverDayStats(user.uid);
        if (s) {
            STATE.owed = Math.round(((Number(s.pendingDepositDebt) || 0) + (Number(s.remainingToDeposit) || 0)) * 100) / 100;
            const menu = document.getElementById('header-more-menu');
            if (menu && !menu.classList.contains('hidden')) renderRoleMenu();
        }
    } catch (_) {}
}

// ───────── Acciones (pantallas que ya existen) ─────────
function close() { window.closeHeaderMoreMenu?.(); }
function placeholder(title, html) {
    document.querySelectorAll('.rm-modal-bg').forEach((m) => m.remove());
    const bg = document.createElement('div');
    bg.className = 'rm-modal-bg';
    bg.innerHTML = `<div class="rm-modal" role="dialog" aria-label="${esc(title)}"><h4>${esc(title)}</h4>${html}<button type="button" class="rm-btn" data-close>Entendido</button></div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
    document.body.appendChild(bg);
    return bg;
}
function openPaymentMethods() {
    const p = DEPS.getUserProfile?.() || {};
    const saldo = Number(p.balance ?? p.passengerBalance ?? p.saldo ?? 0) || 0;
    const bg = placeholder('Métodos de pago', `
      <div class="rm-pay"><b>💵 Efectivo</b><span>Pagas al conductor al terminar el viaje.</span></div>
      <div class="rm-pay"><b>👛 Saldo HonduRaite</b><span>${fmtL(saldo)} disponible.</span>${typeof window.showRechargeModal === 'function' ? '<button type="button" class="rm-mini" data-recharge>Recargar saldo</button>' : ''}</div>
      <div class="rm-pay off"><b>💳 Tarjeta</b><span>Próximamente.</span></div>
      <p class="rm-note">El método se elige al pedir cada viaje.</p>`);
    bg.querySelector('[data-recharge]')?.addEventListener('click', () => { bg.remove(); window.showRechargeModal(); });
}
function openPassengerModeInfo() {
    placeholder('Cambiar a modo pasajero', `
      <p class="rm-note">Tu cuenta es de conductor. Para pedir un viaje como pasajero usa otra cuenta de pasajero, o escribe a soporte y te ayudamos.</p>
      <button type="button" class="rm-btn ghost" data-wa>Escribir a soporte</button>`)
        .querySelector('[data-wa]')?.addEventListener('click', () => window.openSupportWhatsApp?.('Quiero usar mi cuenta como pasajero'));
}
function openDocuments() {
    window.openProfilePanel?.();
    setTimeout(() => {
        const el = document.getElementById('btn-resubmit-documents')
            || [...document.querySelectorAll('p')].find((x) => /Mis vehículos/i.test(x.textContent || ''));
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 400);
}
function openFavorites() {
    window.setPassengerHomeMode?.('trip');
    setTimeout(() => {
        const bar = document.getElementById('favorites-bar');
        bar?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        bar?.classList.add('rm-flash');
        setTimeout(() => bar?.classList.remove('rm-flash'), 1600);
    }, 250);
}
async function pushTest() {
    const r = await (window.pingMyPushFromClient?.() || Promise.resolve(null));
    if (!r) return window.showToast?.('No se pudo probar desde aquí.', 'warning');
    if (r.sent > 0) window.showToast?.('Aviso de prueba enviado. Debe sonar en unos segundos.', 'success');
    else window.showToast?.('Este teléfono aún no tiene avisos activados. Toca «Avisos activos».', 'warning');
    return r;
}

const ACTIONS = {
    home: () => window.setPassengerHomeMode?.('home'),
    stores: () => window.openStoresMarketplace?.(),
    mystore: () => window.openMerchantPanel?.({ createNew: false }),
    createstore: () => window.openMerchantPanel?.({ createNew: true }),
    history: () => window.showMyPastTrips?.(),
    favorites: openFavorites,
    payments: openPaymentMethods,
    theme: () => { window.toggleTheme?.(); renderRoleMenu(); return 'keep'; },
    whatsapp: () => window.openSupportWhatsApp?.(),
    logout: () => window.confirmLogout?.(),
    online: async () => { await window.toggleDriverOnline?.(); setTimeout(renderRoleMenu, 300); return 'keep'; },
    available: () => { document.getElementById('requests-list')?.scrollIntoView?.({ behavior: 'smooth' }); window.toggleDriverEarningsMinimized?.(true); },
    deposits: () => window.showDailyDepositInfo?.({}),
    deposit: () => window.openDriverDepositFromReminder?.(STATE.owed || 0),
    documents: openDocuments,
    push: () => window.enableTripNotifications?.(),
    pushtest: pushTest,
    passengermode: openPassengerModeInfo,
    supervisor: () => window.openSupervisorPanel?.(),
    admin: () => window.openAdminPanel?.()
};
export async function runMenuAction(act) {
    const fn = ACTIONS[act];
    if (!fn) return;
    const r = await fn();
    if (r !== 'keep') close();
}

// ───────── Guardas de pantallas de staff ─────────
function hideStaffPanels(which) {
    if (which !== 'supervisor') {
        const a = document.getElementById('admin-panel');
        if (a && !a.classList.contains('hidden')) a.classList.add('hidden');
        try { window.stopAdminTripsListener?.(); } catch (_) {}
    }
    if (which !== 'admin') {
        const s = document.getElementById('supervisor-panel');
        if (s && !s.classList.contains('hidden')) { try { window.closeSupervisorPanel?.(); } catch (_) {} s.classList.add('hidden'); }
    }
    if (/^#(admin|supervisor|ops)/i.test(location.hash)) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    }
}
/**
 * Envuelve openAdminPanel / openSupervisorPanel: vuelve a preguntar al servidor y, si no es staff,
 * cierra el panel y regresa al inicio. También vigila si un panel de staff quedó abierto sin rol.
 */
export function guardStaffRoutes() {
    const wrap = (name, need) => {
        const orig = window[name];
        if (typeof orig !== 'function' || orig.__rmGuarded) return;
        const g = async (...args) => {
            const role = await resolveTrustedRole(DEPS.getCurrentUser?.());
            const ok = role === 'admin' || role === 'supervisor'; // openAdminPanel ya limita al supervisor a Reportes
            if (role !== undefined && !ok) {
                hideStaffPanels();
                window.showToast?.('Esta sección es solo para staff.', 'warning');
                window.setPassengerHomeMode?.('home');
                return undefined;
            }
            if (role === 'supervisor' && name === 'openAdminPanel' && !args[0]) {
                return window.openSupervisorPanel?.();
            }
            return orig(...args);
        };
        g.__rmGuarded = true;
        window[name] = g;
    };
    wrap('openAdminPanel', 'admin');
    wrap('openSupervisorPanel', 'supervisor');
    const check = () => {
        const role = STATE.trusted;
        if (role === undefined) return;
        const adminOpen = !document.getElementById('admin-panel')?.classList.contains('hidden');
        const supOpen = !document.getElementById('supervisor-panel')?.classList.contains('hidden');
        if (adminOpen && role !== 'admin' && !(role === 'supervisor' && window.currentAdminTab === 'reports')) hideStaffPanels('supervisor');
        if (supOpen && role !== 'admin' && role !== 'supervisor') hideStaffPanels('admin');
    };
    if (guardStaffRoutes.__bound) return;
    guardStaffRoutes.__bound = true;
    window.addEventListener('hashchange', check);
    window.addEventListener('hr:trusted-role', check);
    setInterval(check, 4000);
}

// ───────── Inicio ─────────
export function initRoleMenu(deps = {}) {
    DEPS = { ...DEPS, ...deps };
    const menu = document.getElementById('header-more-menu');
    if (menu && !menu.dataset.rmBound) {
        menu.dataset.rmBound = '1';
        // pointerup en el header ya llama runHeaderAction para [data-header-menu-action]; aquí manejamos los nuestros.
        menu.addEventListener('click', (e) => {
            const el = e.target.closest('[data-rm-act]');
            if (!el) return;
            e.preventDefault();
            e.stopPropagation();
            runMenuAction(el.dataset.rmAct);
        });
    }
    // Abrir el ⋮ → repintar con datos al día
    const toggle = document.getElementById('header-more-toggle');
    if (toggle && !toggle.dataset.rmBound) {
        toggle.dataset.rmBound = '1';
        toggle.addEventListener('pointerdown', () => { renderRoleMenu(); refreshOwed(); }, { passive: true });
    }
    window.addEventListener('hr:trusted-role', renderRoleMenu);
    guardStaffRoutes();
    window.hrRenderRoleMenu = renderRoleMenu;
    window.hrResolveTrustedRole = (force) => resolveTrustedRole(DEPS.getCurrentUser?.(), { force });
    window.hrGetTrustedStaffRole = getTrustedStaffRole;
}

/** Al tener perfil: preguntar el rol al servidor y pintar el menú. */
export async function onRoleProfileReady(user) {
    guardStaffRoutes();
    renderRoleMenu();
    await resolveTrustedRole(user, { force: true });
    renderRoleMenu();
    refreshOwed();
}

/** Arnés de capturas: fija el rol sin servidor. */
export function __setTrustedForTest(role, deps) {
    if (deps) DEPS = { ...DEPS, ...deps };
    STATE.trusted = role;
    STATE.uid = DEPS.getCurrentUser?.()?.uid || 'test';
}
