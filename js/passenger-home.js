/**
 * Menú inicial del pasajero: elige qué busca en HonduRaite
 * (viaje, pedido, envío, flete, grúa) y siempre puede volver.
 */
import {
    isServiceTypeDisabledInCity,
    getCityServiceDisabledMessage,
    isMalePassengerMotoRideBlocked,
    firstAllowedPassengerTripType,
    DECRETO_91_2012_MSG,
} from './service-types.js?v=2026.10.25.4';
import { getDefaultZoneId, getZoneById } from './zones.js?v=2026.10.25.4';
import { isUsMarket, isServiceAllowedInMarket, filterTypesForMarket } from './market.js';

const BOOKING_SECTION_IDS = [
    'passenger-booking-route',
    'passenger-booking-advanced',
    // tipo de servicio / pasajeros / cuándo / pedir van en #booking-float-layer
    'client-stores-section',
    'favorites-bar',
];

const MODE_META = {
    home: {
        title: 'Inicio',
        subtitle: '¿Qué necesitas hoy?',
    },
    trip: {
        title: 'Viaje',
        subtitle: 'Moto · Taxi VIP · Taxi tradicional',
        serviceTypes: ['moto', 'auto', 'taxi'],
        defaultService: 'auto',
        showBooking: true,
        showStoresSection: false,
    },
    stores: {
        title: 'Pedidos en tiendas',
        subtitle: 'Marketplace completo de negocios',
        serviceTypes: [],
        defaultService: null,
        showBooking: false,
        showStoresSection: false,
        openMarketplace: true,
        fullWorld: true,
    },
    delivery: {
        title: 'Envío / mensajería',
        subtitle: 'Recoger y entregar en moto',
        serviceTypes: ['delivery'],
        defaultService: 'delivery',
        showBooking: true,
        showStoresSection: false,
    },
    freight: {
        title: 'Flete',
        subtitle: 'Paila o camión para carga',
        serviceTypes: ['flete_paila', 'flete_camion'],
        defaultService: 'flete_paila',
        showBooking: true,
        showStoresSection: false,
    },
    tow: {
        title: 'Grúa',
        subtitle: 'Remolque y auxilio vial',
        serviceTypes: ['grua'],
        defaultService: 'grua',
        showBooking: true,
        showStoresSection: false,
    },
};

let currentMode = 'home';
let getUserProfile = () => null;
let bound = false;

function isClientLike() {
    const role = getUserProfile()?.role || 'client';
    return role === 'client' || role === 'admin' || role === 'supervisor' || !role;
}

function isBusyWithTripUi() {
    const trip = window.activeTrip || window.currentActiveTripData;
    if (trip && typeof window.isMerchantOwnedDeliveryTrip === 'function' && window.isMerchantOwnedDeliveryTrip(trip)) {
        try { window.releaseMerchantDeliveryTripsFromPassengerUi?.(); } catch (_) {}
        return false;
    }
    // No forzar menú si está buscando o en viaje activo
    if (document.body.classList.contains('is-searching')) return true;
    if (document.body.classList.contains('trip-active')) return true;
    if (document.body.classList.contains('is-active-trip')) return true;
    const searching = document.getElementById('searching-state');
    if (searching && !searching.classList.contains('hidden')) return true;
    const active = document.getElementById('active-trip-panel');
    if (active && !active.classList.contains('hidden')) return true;
    if (trip && ['pending', 'accepted', 'in_progress'].includes(trip.status)) return true;
    return false;
}

// v.82 · Lugares recientes: los últimos destinos de raite (solo en este teléfono) para pedir con un toque.
const HR_RECENT_KEY = 'hr_recent_places';
const HR_RECENT_SVCS = ['moto', 'auto', 'taxi'];
function readRecentPlaces() {
    try {
        const arr = JSON.parse(localStorage.getItem(HR_RECENT_KEY) || '[]');
        return Array.isArray(arr) ? arr.filter((r) => r && r.address) : [];
    } catch (_) { return []; }
}
function hrEsc(t) {
    return String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderHomeRecents() {
    const box = document.getElementById('hrh-recent');
    if (!box) return;
    const list = readRecentPlaces().slice(0, 3);
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<p class="hrh-h">Recientes</p>` + list.map((r, i) => {
        const parts = String(r.address).split(',');
        const title = r.name || parts[0];
        const sub = parts.filter((x) => x.trim() && x.trim() !== String(title).trim()).slice(0, 2).join(',');
        return `<button type="button" class="hrh-recent-row" data-hrh-recent="${i}">
            <span class="hrh-recent-ico"><i class="fas fa-history"></i></span>
            <span class="hrh-recent-txt"><strong>${hrEsc(title)}</strong><small>${hrEsc(sub.trim())}</small></span>
            <i class="fas fa-chevron-right"></i>
        </button>`;
    }).join('');
}
window.hrRememberRecentPlace = (rec) => {
    try {
        if (!rec || !rec.address || !HR_RECENT_SVCS.includes(rec.svc)) return;
        const key = String(rec.address).trim().toLowerCase();
        const list = readRecentPlaces().filter((r) => String(r.address).trim().toLowerCase() !== key);
        list.unshift({
            address: String(rec.address).slice(0, 200), name: String(rec.name || '').slice(0, 80),
            lat: Number.isFinite(rec.lat) ? rec.lat : null, lng: Number.isFinite(rec.lng) ? rec.lng : null,
            svc: rec.svc, at: Date.now()
        });
        localStorage.setItem(HR_RECENT_KEY, JSON.stringify(list.slice(0, 6)));
        renderHomeRecents();
    } catch (_) {}
};
window.hrRepeatTrip = (idx, btn) => {
    const r = (window._hrHistTrips || [])[idx];
    if (!r || !r.address) return;
    try { btn?.closest('.fixed')?.remove(); } catch (_) {}
    applyRecentPlace(-1, r);
};
function applyRecentPlace(idx, given) {
    const r = given || readRecentPlaces()[idx];
    if (!r) return;
    window._hrHomePreferredService = r.svc;
    setPassengerHomeMode('trip');
    setTimeout(() => {
        try {
            const el = document.getElementById('destination-autocomplete');
            if (!el) return;
            window.storeRouteEndpoint?.(el, {
                address: r.address,
                latLng: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null,
                source: 'recent'
            });
            window.writeAutocompleteText?.(el, r.address);
            window.calculateTripRoute?.({ silent: true });
        } catch (_) {}
    }, 120);
}

// v.82 · Barra de abajo del inicio (Inicio · Servicios · Raite · Actividad · Cuenta)
function runHomeNav(what, hub) {
    const loggedIn = !!(window.currentUser?.uid || window.auth?.currentUser?.uid);
    if (what === 'raite') { setPassengerHomeMode('trip'); return; }
    if (what === 'home') {
        hub.setAttribute('data-hrh-active', 'raites');
        try { document.getElementById('panel-content')?.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
        return;
    }
    if (what === 'services') {
        hub.setAttribute('data-hrh-active', 'envios');
        try { localStorage.setItem('hr_home_tab', 'envios'); } catch (_) {}
        try { hub.querySelector('.hrh-seg')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
        return;
    }
    if (!loggedIn) { window.openGuestAuthModal?.(); return; }
    if (what === 'activity') { window.showMyPastTrips?.(); return; }
    if (what === 'account') {
        const t = document.getElementById('header-more-toggle');
        if (t && t.offsetParent !== null) {
            try { t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (_) {}
            t.click();
        } else {
            window.openProfilePanel?.();
        }
    }
}

function ensureHomeUi() {
    const clientView = document.getElementById('client-view');
    if (!clientView) return;

    let hub = document.getElementById('passenger-home-hub');
    if (!hub || hub.getAttribute('data-layout') !== 'hr-v3') {
        const isNew = !hub;
        if (!hub) {
            hub = document.createElement('section');
            hub.id = 'passenger-home-hub';
            hub.className = 'passenger-home-hub';
            hub.setAttribute('aria-label', 'Menú principal del pasajero');
        }
        hub.setAttribute('data-layout', 'hr-v3');
        hub.classList.add('hrh');
        let tab = 'raites';
        try { tab = localStorage.getItem('hr_home_tab') === 'envios' ? 'envios' : 'raites'; } catch (_) {}
        hub.setAttribute('data-hrh-active', tab);
        // Estilo HonduRaite (v.79): una tarjeta por servicio con data-home-mode (la usa syncHomeCardsForCity);
        // «Pedí tu raite» y los círculos Moto/VIP/Taxi usan data-hrh-* para no confundirla.
        const card = (mode, cls, icon, title, sub, extra = '') => `
                <button type="button" class="passenger-home-card passenger-home-card--${cls} hrh-tile" data-home-mode="${mode}" role="listitem" ${extra}>
                    <span class="passenger-home-card-icon hrh-ico">${icon}</span>
                    <span class="passenger-home-card-text"><strong>${title}</strong><small>${sub}</small></span>
                </button>`;
        hub.innerHTML = `
            <div class="hrh-hero">
                <svg class="hrh-road" viewBox="0 0 230 170" aria-hidden="true"><path d="M10 170 C70 120 120 110 150 70 C175 38 200 25 230 20" stroke="#5aa2ff" stroke-width="34" fill="none" opacity=".35"/><path d="M10 170 C70 120 120 110 150 70 C175 38 200 25 230 20" stroke="#cfe3ff" stroke-width="3" stroke-dasharray="10 10" fill="none"/></svg>
                <svg class="hrh-stars" viewBox="0 0 72 40" aria-hidden="true"><g fill="#7fb3ff"><path d="M12 4l2 5 5 .4-4 3.3 1.3 5-4.3-2.8-4.3 2.8L9 12.7 5 9.4l5-.4z"/><path d="M36 14l2 5 5 .4-4 3.3 1.3 5-4.3-2.8-4.3 2.8 1.3-5-4-3.3 5-.4z"/><path d="M60 4l2 5 5 .4-4 3.3 1.3 5-4.3-2.8-4.3 2.8 1.3-5-4-3.3 5-.4z"/><path d="M24 24l2 5 5 .4-4 3.3 1.3 5-4.3-2.8-4.3 2.8 1.3-5-4-3.3 5-.4z"/><path d="M48 24l2 5 5 .4-4 3.3 1.3 5-4.3-2.8-4.3 2.8 1.3-5-4-3.3 5-.4z"/></g></svg>
                <p class="passenger-home-kicker hrh-kicker">HonduRaite · Viaja seguro, llega lejos</p>
                <h2 class="passenger-home-title hrh-title">¿Para dónde vamos?</h2>
                <button type="button" class="hrh-search" data-hrh-go="trip"><span class="hrh-dot"></span><span>Pedí tu raite</span><i class="fas fa-arrow-right"></i></button>
            </div>
            <div class="hrh-flag" aria-hidden="true"></div>
            <div id="hrh-recent" class="hrh-recent" hidden></div>
            <div class="hrh-seg" role="tablist">
                <button type="button" role="tab" data-hrh-tab="raites"><i class="fas fa-car-side"></i> Raites</button>
                <button type="button" role="tab" data-hrh-tab="envios"><i class="fas fa-shopping-bag"></i> Envíos y tiendas</button>
            </div>
            <div class="hrh-pane" data-hrh-pane="raites">
                <p class="hrh-h">¿Cómo querés ir? <span class="hrh-st">★★★★★</span></p>
                <div class="hrh-circles">
                    <button type="button" data-hrh-svc="moto"><i class="fas fa-motorcycle"></i><span>Moto</span></button>
                    <button type="button" data-hrh-svc="auto"><i class="fas fa-car"></i><span>Taxi VIP</span></button>
                    <button type="button" data-hrh-svc="taxi"><i class="fas fa-taxi"></i><span>Taxi</span></button>
                </div>
                <div class="passenger-home-grid hrh-grid" role="list">
                    ${card('trip', 'trip', '<i class="fas fa-car-side"></i>', 'Viaje', 'Moto · VIP · Taxi', 'title="Moto, Taxi VIP o taxi tradicional"')}
                    ${card('tow', 'tow', '<i class="icon-grua" aria-hidden="true"></i>', 'Grúa', 'Remolque', 'title="Remolque y auxilio"')}
                </div>
            </div>
            <div class="hrh-pane" data-hrh-pane="envios">
                <div class="passenger-home-grid hrh-grid" role="list">
                    ${card('stores', 'stores', '<i class="fas fa-store"></i>', 'Tiendas', 'Comida y productos', 'title="Comprar a emprendedores"')}
                    ${card('delivery', 'delivery', '<i class="fas fa-box"></i>', 'Envío', 'Mensajería en moto', 'title="Recoger y entregar"')}
                    ${card('freight', 'freight', '<i class="fas fa-truck"></i>', 'Flete', 'Paila · Camión', 'title="Paila o camión"')}
                    ${card('marketplace', 'market', '<i class="fas fa-tags"></i>', 'Marketplace', 'Carros · Motos · Renta', 'title="Carros, motos y repuestos en venta o renta"')}
                </div>
            </div>
            <div id="want-to-be-driver-card" class="hrh-driver-wrap">
                <button type="button" id="btn-want-to-be-driver" data-home-action="want-to-be-driver" class="hrh-driver">
                    <span class="hrh-driver-ico"><i class="fas fa-id-card"></i></span>
                    <span class="hrh-driver-txt"><strong>Quiero ser conductor</strong><small>Registrá tu auto, moto, taxi, paila o grúa</small></span>
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
            <nav class="hrh-nav" aria-label="Navegación">
                <button type="button" data-hrh-nav="home" class="on"><i class="fas fa-home"></i><span>Inicio</span></button>
                <button type="button" data-hrh-nav="services"><i class="fas fa-th-large"></i><span>Servicios</span></button>
                <button type="button" data-hrh-nav="raite" class="hrh-fab" aria-label="Pedí tu raite"><i class="fas fa-car-side"></i><span>Raite</span></button>
                <button type="button" data-hrh-nav="activity"><i class="fas fa-receipt"></i><span>Actividad</span></button>
                <button type="button" data-hrh-nav="account"><i class="fas fa-user"></i><span>Cuenta</span></button>
            </nav>
        `;
        if (!hub.dataset.hrhBound) {
            hub.dataset.hrhBound = '1';
            hub.addEventListener('click', (e) => {
                const tabBtn = e.target.closest('[data-hrh-tab]');
                if (tabBtn) {
                    const t = tabBtn.getAttribute('data-hrh-tab');
                    hub.setAttribute('data-hrh-active', t);
                    try { localStorage.setItem('hr_home_tab', t); } catch (_) {}
                    return;
                }
                const nav = e.target.closest('[data-hrh-nav]');
                if (nav) { e.preventDefault(); runHomeNav(nav.getAttribute('data-hrh-nav'), hub); return; }
                const rec = e.target.closest('[data-hrh-recent]');
                if (rec) { e.preventDefault(); applyRecentPlace(Number(rec.getAttribute('data-hrh-recent'))); return; }
                const go = e.target.closest('[data-hrh-go]');
                if (go) { e.preventDefault(); setPassengerHomeMode(go.getAttribute('data-hrh-go')); return; }
                const svcBtn = e.target.closest('[data-hrh-svc]');
                if (svcBtn) {
                    e.preventDefault();
                    if (svcBtn.classList.contains('hrh-off')) {
                        const label = svcBtn.textContent.trim();
                        const why = svcBtn.hasAttribute('data-hrh-decree')
                            ? `${DECRETO_91_2012_MSG}. Probá con Taxi VIP o Taxi.`
                            : `${label} no está disponible en tu ciudad por ahora. Probá con otro servicio.`;
                        try { showServiceUnavailableSheet(label, why); } catch (_) {}
                        return;
                    }
                    window._hrHomePreferredService = svcBtn.getAttribute('data-hrh-svc');
                    setPassengerHomeMode('trip');
                }
            });
        }
        if (isNew) {
            clientView.insertBefore(hub, clientView.firstChild);
        }
        renderHomeRecents();
        try { window.mountClientOrderHomeChip?.(); } catch (_) {}
    }

    if (!document.getElementById('passenger-mode-bar')) {
        const bar = document.createElement('div');
        bar.id = 'passenger-mode-bar';
        bar.className = 'passenger-mode-bar hidden';
        bar.innerHTML = `
            <button type="button" class="passenger-mode-back" data-home-mode="home" aria-label="Volver al menú de inicio">
                <i class="fas fa-th-large"></i>
                <span>Inicio</span>
            </button>
            <div class="passenger-mode-copy min-w-0">
                <p id="passenger-mode-title" class="passenger-mode-title">Viaje</p>
                <p id="passenger-mode-sub" class="passenger-mode-sub">Elige origen y destino</p>
            </div>
            <button type="button" id="passenger-mode-change" class="passenger-mode-change" data-home-mode="home">
                Cambiar
            </button>
        `;
        // Justo debajo del hub / arriba del contenido
        const hub = document.getElementById('passenger-home-hub');
        if (hub?.nextSibling) {
            clientView.insertBefore(bar, hub.nextSibling);
        } else {
            clientView.appendChild(bar);
        }
    }

    if (!bound) {
        bound = true;
        clientView.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('[data-home-action]');
            if (actionBtn && clientView.contains(actionBtn)) {
                e.preventDefault();
                const action = actionBtn.getAttribute('data-home-action');
                if (action === 'side-driver') {
                    switchPanelSideView('driver');
                } else if (action === 'side-passenger') {
                    switchPanelSideView('passenger');
                } else if (action === 'want-to-be-driver') {
                    if (typeof window.openWantToBeDriverFlow === 'function') {
                        window.openWantToBeDriverFlow({ source: 'panel' });
                    } else if (typeof window.openGuestAuthModal === 'function') {
                        window.openGuestAuthModal({
                            role: 'driver',
                            mode: 'register',
                            icon: '🚗',
                            reasonTitle: 'Quiero ser conductor de HonduRaite',
                            reasonSub: 'Crea tu cuenta de conductor y registra los datos de tu vehículo.'
                        });
                    }
                } else if (action === 'driver-login') {
                    if (typeof window.openDriverLoginModal === 'function') {
                        window.openDriverLoginModal();
                    } else if (typeof window.openGuestAuthModal === 'function') {
                        window.openGuestAuthModal({
                            role: 'driver',
                            mode: 'login',
                            icon: '🔑',
                            reasonTitle: 'Acceso para Conductores',
                            reasonSub: 'Ingresa con tu correo o teléfono de conductor.'
                        });
                    }
                } else if (action === 'open-auth') {
                    if (typeof window.openGuestAuthModal === 'function') {
                        window.openGuestAuthModal({ role: 'client', mode: 'login' });
                    } else if (typeof window.revealLoginScreen === 'function') {
                        window.revealLoginScreen();
                    }
                }
                return;
            }
            const btn = e.target.closest('[data-home-mode]');
            if (!btn || !clientView.contains(btn)) return;
            const mode = btn.getAttribute('data-home-mode');
            if (!mode) return;
            e.preventDefault();
            if (mode === 'marketplace') { window.hrOpenMarketplace?.(); return; }
            setPassengerHomeMode(mode);
        });
    }
    syncGuestAndDriverCtaInHome();
}


export function switchPanelSideView(side = 'passenger') {
    const isDriverSide = side === 'driver';
    const passengerSide = document.getElementById('panel-passenger-side-view');
    const driverSide = document.getElementById('panel-driver-side-view');
    const tabPassenger = document.getElementById('panel-side-tab-passenger');
    const tabDriver = document.getElementById('panel-side-tab-driver');
    if (passengerSide) passengerSide.classList.toggle('hidden', isDriverSide);
    if (driverSide) driverSide.classList.toggle('hidden', !isDriverSide);
    if (tabPassenger) {
        tabPassenger.className = isDriverSide
            ? 'flex-1 py-2 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5'
            : 'flex-1 py-2 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all bg-white text-blue-600 shadow-sm flex items-center justify-center gap-1.5';
    }
    if (tabDriver) {
        tabDriver.className = isDriverSide
            ? 'flex-1 py-2 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all bg-slate-900 text-amber-300 shadow-sm flex items-center justify-center gap-1.5'
            : 'flex-1 py-2 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5';
    }
}

export function syncGuestAndDriverCtaInHome() {
    const isGuest = !window.currentUser;
    const prof = getUserProfile?.() || window.userProfile || null;
    const isAlreadyDriver = prof?.role === 'driver';
    const guestBar = document.getElementById('guest-welcome-auth-bar');
    const guestPill = document.getElementById('panel-guest-login-pill');
    const driverCard = document.getElementById('want-to-be-driver-card');
    if (guestBar) guestBar.classList.toggle('hidden', !isGuest);
    if (guestPill) {
        guestPill.classList.toggle('hidden', !isGuest);
        guestPill.classList.toggle('inline-flex', isGuest);
    }
    if (driverCard) {
        driverCard.classList.toggle('hidden', isAlreadyDriver);
    }
}
try {
    window.switchPanelSideView = switchPanelSideView;
    window.syncGuestAndDriverCtaInHome = syncGuestAndDriverCtaInHome;
} catch (_) {}

function getActiveCityId() {
    return window.activeServiceZoneId || getDefaultZoneId() || null;
}

/** Filtra tipos permitidos por lo que el admin desactivó en la ciudad. */
function filterTypesByCity(types = []) {
    const zoneId = getActiveCityId();
    const allowed = filterTypesForMarket(types);
    if (!zoneId) return allowed;
    return allowed.filter((t) => !isServiceTypeDisabledInCity(t, zoneId));
}

const HOME_CARD_TYPES = {
    trip: ['moto', 'auto', 'taxi'],
    delivery: ['delivery'],
    freight: ['flete_paila', 'flete_camion'],
    tow: ['grua'],
};
const HOME_CARD_SUB = { trip: 'Moto · VIP · Taxi', delivery: 'Mensajería', freight: 'Paila · Camión', tow: 'Remolque' };

/** ¿La tarjeta del inicio no tiene ningún servicio disponible en la ciudad? (cerrado o sin conductores) */
function homeCardUnavailable(mode, zoneId = getActiveCityId()) {
    const types = filterTypesForMarket(HOME_CARD_TYPES[mode] || []);
    if (!types.length) return false;
    return types.every((t) => isServiceTypeDisabledInCity(t, zoneId));
}

/** Mensaje del primer servicio no disponible de la tarjeta. */
function homeCardMessage(mode, zoneId = getActiveCityId()) {
    const zoneName = getZoneById(zoneId)?.name || '';
    const types = filterTypesForMarket(HOME_CARD_TYPES[mode] || []);
    if (mode === 'trip') {
        return `No hay viajes (moto / Taxi VIP / taxi) disponibles${zoneName ? ` en ${zoneName}` : ' en esta ciudad'} por ahora. Intenta más tarde o escríbenos por WhatsApp.`;
    }
    return getCityServiceDisabledMessage(types[0] || 'auto', zoneName, zoneId);
}

const SHEET_TITLES = { trip: 'Viajes', delivery: 'Envíos', freight: 'Fletes', tow: 'Grúa', flete_paila: 'Flete en paila', flete_camion: 'Flete en camión', grua: 'Grúa', moto: 'Moto', auto: 'Taxi VIP', taxi: 'Taxi tradicional' };
// Mismo número del asistente de WhatsApp que el botón del login
const WA_LINK = 'https://wa.me/14693876894?text=Hola%2C%20quiero%20pedir%20un%20servicio';

/** Hoja «No disponible»: explica y no deja pedir. */
export function showServiceUnavailableSheet(what, message) {
    document.getElementById('hr-unavail-sheet')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'hr-unavail-sheet';
    wrap.className = 'hr-unavail-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    const title = `${SHEET_TITLES[what] || 'Servicio'} no disponible`;
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    wrap.innerHTML = `<div class="hr-unavail-dim" data-unavail-close></div>
        <div class="hr-unavail-sheet">
            <div class="hr-unavail-grab"></div>
            <h3>${esc(title)}</h3>
            <p>${esc(message || 'Este servicio no está disponible por ahora.')}</p>
            <button type="button" class="hr-unavail-ok" data-unavail-close>Entendido</button>
            <a class="hr-unavail-wa" href="${WA_LINK}" target="_blank" rel="noopener" onclick="return window.openHonduWhatsApp ? window.openHonduWhatsApp(event) : true"><i class="fab fa-whatsapp"></i> Escribir por WhatsApp</a>
            <small>No se creó ninguna solicitud</small>
        </div>`;
    wrap.addEventListener('click', (e) => {
        if (e.target.closest('[data-unavail-close]')) wrap.remove();
    });
    document.body.appendChild(wrap);
}
try { window.showServiceUnavailableSheet = showServiceUnavailableSheet; } catch (_) {}

/** Tarjetas del inicio: en gris con «No disponible» si no hay servicio en la ciudad (ya no se esconden). */
function syncHomeCardsForCity() {
    const hub = document.getElementById('passenger-home-hub');
    if (!hub) return;
    const zoneId = getActiveCityId();
    // Círculos Moto / Taxi VIP / Taxi del inicio: en gris si no hay ese servicio en la ciudad
    const maleMotoBlocked = isMalePassengerMotoRideBlocked(getUserProfile?.());
    hub.querySelectorAll('[data-hrh-svc]').forEach((b) => {
        const svc = b.getAttribute('data-hrh-svc');
        // v.103 · Moto en gris también cuando el admin activó el Decreto 91-2012 y el pasajero es hombre
        const decree = svc === 'moto' && maleMotoBlocked;
        const off = decree || isServiceTypeDisabledInCity(svc, zoneId);
        b.classList.toggle('hrh-off', off);
        b.toggleAttribute('data-hrh-decree', decree);
        b.setAttribute('aria-disabled', off ? 'true' : 'false');
    });
    Object.keys(HOME_CARD_TYPES).forEach((mode) => {
        const card = hub.querySelector(`[data-home-mode="${mode}"]`);
        if (!card) return;
        const off = homeCardUnavailable(mode, zoneId);
        card.classList.remove('hidden');
        card.classList.toggle('passenger-home-card--off', off);
        card.setAttribute('aria-disabled', off ? 'true' : 'false');
        const small = card.querySelector('small');
        if (!small) return;
        if (off) {
            small.innerHTML = '<em class="passenger-home-off">No disponible</em>';
            return;
        }
        if (mode === 'trip') {
            const parts = [];
            if (!isServiceTypeDisabledInCity('moto', zoneId)) parts.push('Moto');
            if (!isServiceTypeDisabledInCity('auto', zoneId)) parts.push('VIP');
            if (!isUsMarket() && !isServiceTypeDisabledInCity('taxi', zoneId)) parts.push('Taxi');
            small.textContent = parts.length ? parts.join(' · ') : 'Viajes';
        } else if (mode === 'freight') {
            const parts = [];
            if (!isServiceTypeDisabledInCity('flete_paila', zoneId)) parts.push('Paila');
            if (!isServiceTypeDisabledInCity('flete_camion', zoneId)) parts.push('Camión');
            small.textContent = parts.join(' · ') || HOME_CARD_SUB.freight;
        } else {
            small.textContent = HOME_CARD_SUB[mode];
        }
    });
}
try { window.refreshPassengerHomeCityServices = () => { try { syncHomeCardsForCity(); } catch (_) {} }; } catch (_) {}

function setChipVisible(btn, show) {
    if (!btn) return;
    btn.classList.toggle('hidden', !show);
    btn.hidden = !show;
    if (show) {
        btn.style.removeProperty('display');
    } else {
        btn.style.setProperty('display', 'none', 'important');
    }
}

function setServicePickerFilter(allowedTypes) {
    const picker = document.getElementById('service-type-picker');
    if (!picker) return;
    const zoneId = getActiveCityId();
    const maleMotoBlocked = isMalePassengerMotoRideBlocked(getUserProfile?.());
    const buttons = picker.querySelectorAll('[data-service-type], #svc-btn-stores');
    buttons.forEach((btn) => {
        const type = btn.getAttribute('data-service-type') || (btn.id === 'svc-btn-stores' ? 'stores' : '');
        if (!allowedTypes || !allowedTypes.length) {
            setChipVisible(btn, false);
            return;
        }
        const cityBlocked = type && type !== 'stores' && isServiceTypeDisabledInCity(type, zoneId);
        const marketBlocked = type && !isServiceAllowedInMarket(type);
        // No disponible en la ciudad: se muestra en gris (al tocarlo sale el mensaje), no se esconde
        const show = allowedTypes.includes(type) && !marketBlocked;
        setChipVisible(btn, show);
        btn.classList.toggle('hr-svc-unavailable', !!(show && cityBlocked));
        if (type === 'moto' && show && maleMotoBlocked) {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
            btn.title = DECRETO_91_2012_MSG;
        } else if (type === 'moto' && show) {
            btn.disabled = false;
            btn.removeAttribute('aria-disabled');
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
            btn.removeAttribute('title');
        }
    });
}

function setBookingVisible(show, { resetProgress = true } = {}) {
    BOOKING_SECTION_IDS.forEach((id) => {
        if (id === 'client-stores-section') return; // se maneja aparte
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('hidden', !show);
    });
    // Flotantes de progresión (fuera del panel): ocultar al salir; al entrar re-sync
    if (!show) {
        document.getElementById('booking-float-layer')?.classList.add('hidden');
        document.body.classList.remove('booking-float-active');
        ['passenger-booking-service', 'passenger-booking-passengers', 'passenger-booking-when', 'passenger-booking-request']
            .forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    } else {
        try {
            if (resetProgress) {
                window.whenStepConfirmed = false;
                window.serviceTypeChosen = false;
            }
            window.syncBookingProgression?.({ scroll: false });
        } catch (_) {}
    }
}

function applyMode(mode) {
    const meta = MODE_META[mode] || MODE_META.home;
    const hub = document.getElementById('passenger-home-hub');
    const bar = document.getElementById('passenger-mode-bar');
    const storesSec = document.getElementById('client-stores-section');
    const reenter = (document.body.dataset.passengerMode === mode) && mode !== 'home';

    document.body.dataset.passengerMode = mode;
    // v.100 · Al cambiar de modo sin el buscador abierto, quitar medidas fijas que dejó el buscador
    if (!document.body.classList.contains('trip-autocomplete-open')) {
        try {
            const pnl = document.getElementById('control-panel');
            if (pnl && (pnl.style.getPropertyPriority('min-height') === 'important' || pnl.style.getPropertyPriority('top') === 'important')) {
                window.hrClearPanelSearchInline?.(pnl);
            }
        } catch (_) {}
    }
    document.body.classList.toggle('passenger-mode-home', mode === 'home');
    document.body.classList.toggle('passenger-mode-active', mode !== 'home');
    document.body.classList.toggle('passenger-mode-trip', mode === 'trip');
    document.body.classList.toggle('passenger-mode-delivery', mode === 'delivery');
    document.body.classList.toggle('passenger-mode-freight', mode === 'freight');
    document.body.classList.toggle('passenger-mode-tow', mode === 'tow');

    if (hub) hub.classList.toggle('hidden', mode !== 'home');
    if (bar) bar.classList.toggle('hidden', mode === 'home');

    const titleEl = document.getElementById('passenger-mode-title');
    const subEl = document.getElementById('passenger-mode-sub');
    if (titleEl) titleEl.textContent = meta.title || '';
    if (subEl) {
        if (mode === 'trip' && isUsMarket()) subEl.textContent = 'Moto · Auto';
        else subEl.textContent = meta.subtitle || '';
    }

    if (mode === 'home') {
        setBookingVisible(false);
        if (storesSec) storesSec.classList.add('hidden');
        // Cerrar paneles de tiendas si estaban abiertos
        window.closeStoresMarketplace?.();
        window.closeMerchantPanel?.();
        document.body.classList.remove('panel-minimized', 'panel-collapsed', 'panel-hidden');
        document.getElementById('control-panel')?.classList.remove('panel-collapsed', 'panel-hidden');
        try { window.showControlPanel?.({ forceExpand: true }); } catch (_) {}
        syncHomeCardsForCity();
        return;
    }

    const showBooking = !!meta.showBooking;
    setBookingVisible(showBooking, { resetProgress: !reenter });

    if (storesSec) {
        // La sección embebida de tiendas ya no se necesita si el menú redirige al marketplace;
        // la ocultamos para no duplicar. Emprendedor sigue por perfil/menú.
        storesSec.classList.add('hidden');
    }

    if (showBooking && meta.serviceTypes?.length) {
        const allowed = filterTypesByCity(meta.serviceTypes);
        setServicePickerFilter(allowed);
        const wrap = document.getElementById('client-service-type-wrap');
        // Si solo hay 1 tipo, se puede ocultar el picker; si hay varios, mostrar
        if (wrap) {
            wrap.classList.toggle('hidden', allowed.length <= 1);
        }
        const selectable = allowed.filter((t) => !(t === 'moto' && isMalePassengerMotoRideBlocked(getUserProfile?.())));
        // Círculo del inicio (Moto / Taxi VIP / Taxi): usar ese servicio en vez del predeterminado
        const preferred = window._hrHomePreferredService;
        window._hrHomePreferredService = null;
        let pick = (preferred && allowed.includes(preferred)) ? preferred : meta.defaultService;
        if (pick === 'moto' && isMalePassengerMotoRideBlocked(getUserProfile?.())) {
            pick = firstAllowedPassengerTripType(selectable);
        }
        if (pick && isServiceTypeDisabledInCity(pick, getActiveCityId())) {
            pick = selectable[0] || allowed[0] || null;
        }
        if (!reenter) {
            window.serviceTypeChosen = selectable.length <= 1;
        }
        if (!reenter || !window.currentServiceType || !allowed.includes(window.currentServiceType)) {
            if (pick && typeof window.selectServiceType === 'function') {
                window.selectServiceType(pick, { keepFareVisible: false, skipCityCheck: true, confirmStep: false });
            } else if (pick) {
                window.currentServiceType = pick;
            }
        }
        try { window.syncServiceCardSummary?.(); } catch (_) {}
        try { window.applyCityServiceAvailabilityToUI?.({ skipHomeRefresh: true }); } catch (_) {}
        setServicePickerFilter(allowed);
        // Expandir panel de control
        window.showControlPanel?.();
        // Flete y grúa siguen abriendo «Más opciones». El envío usa sus tarjetas.
        if (['freight', 'tow'].includes(mode)) {
            window.expandTripAdvancedPanel?.();
        }
    } else {
        setServicePickerFilter([]);
        document.getElementById('client-service-type-wrap')?.classList.add('hidden');
    }

    // Tiendas: pantalla completa (mundo marketplace), no un panel chico
    const storesLanding = document.getElementById('passenger-stores-landing');
    if (storesLanding) storesLanding.classList.add('hidden');

    if (mode === 'stores') {
        if (meta.openMarketplace) {
            if (typeof window.openStoresMarketplace === 'function') {
                window.openStoresMarketplace();
            } else {
                try { window.loadHeavyUiAfterAuth?.(); } catch (_) {}
                // Lazy module merchant-stores.js aún cargando: no dejar #control-panel en blanco
                if (hub) hub.classList.remove('hidden');
                if (bar) bar.classList.add('hidden');
                let tries = 0;
                const waitStores = setInterval(() => {
                    tries += 1;
                    if (document.body.dataset.passengerMode !== 'stores') {
                        clearInterval(waitStores);
                        return;
                    }
                    if (typeof window.openStoresMarketplace === 'function') {
                        clearInterval(waitStores);
                        if (hub) hub.classList.add('hidden');
                        if (bar) bar.classList.remove('hidden');
                        window.openStoresMarketplace();
                    } else if (tries >= 25) {
                        clearInterval(waitStores);
                        applyMode('home');
                    }
                }, 150);
            }
        }
    } else {
        // Al salir de tiendas, cerrar el mundo sin reentrar al menú (ya estamos cambiando de modo)
        try { window.closeStoresMarketplace?.({ silent: true }); } catch (_) {}
    }
}

export function setPassengerHomeMode(mode) {
    if (!isClientLike()) return;
    let next = MODE_META[mode] ? mode : 'home';

    // Si está en búsqueda/viaje activo, solo permitir quedarse (no forzar home sin cancelar)
    if (isBusyWithTripUi() && next === 'home') {
        if (typeof window.showToast === 'function') {
            window.showToast('Cancela la búsqueda o termina el viaje para volver al menú.', 'warning');
        }
        return;
    }

    // No entrar a modos sin servicios disponibles en la ciudad (cerrado o sin conductores en línea)
    const zoneId = getActiveCityId();
    if (HOME_CARD_TYPES[next] && homeCardUnavailable(next, zoneId)) {
        showServiceUnavailableSheet(next, homeCardMessage(next, zoneId));
        next = currentMode === next ? 'home' : (currentMode || 'home');
        if (next === currentMode && next !== 'home') return;
    }

    currentMode = next;
    try {
        sessionStorage.setItem('hr-passenger-mode', next);
    } catch (_) {}

    ensureHomeUi();
    applyMode(next);
    // Origen vacío al entrar a un servicio (el GPS del inicio de sesión pudo fallar o tardar):
    // reintentar con la ubicación actual. No hace nada si ya hay origen, si el pasajero lo borró
    // a propósito o si ya se rellenó una vez (ver ensurePassengerOriginFromGps en app.js).
    if (next !== 'home') {
        setTimeout(() => { try { window.ensurePassengerOriginFromGps?.(); } catch (_) {} }, 400);
    }
}

export function getPassengerHomeMode() {
    return currentMode;
}

export function showPassengerHomeMenu() {
    setPassengerHomeMode('home');
}

export function syncPassengerHomeForRole() {
    ensureHomeUi();
    if (!isClientLike()) {
        // Conductor/otros: no mostrar hub
        document.getElementById('passenger-home-hub')?.classList.add('hidden');
        document.getElementById('passenger-mode-bar')?.classList.add('hidden');
        setBookingVisible(true);
        document.body.classList.remove(
            'passenger-mode-home', 'passenger-mode-active',
            'passenger-mode-trip', 'passenger-mode-delivery',
            'passenger-mode-freight', 'passenger-mode-tow'
        );
        delete document.body.dataset.passengerMode;
        return;
    }

    if (isBusyWithTripUi()) {
        // Mantener UI de viaje; no pisar con home
        document.getElementById('passenger-home-hub')?.classList.add('hidden');
        return;
    }

    // Restaurar último modo de la sesión, o home
    let saved = 'home';
    try {
        saved = sessionStorage.getItem('hr-passenger-mode') || 'home';
    } catch (_) {}
    // En app nativa, preferir siempre menú de inicio al abrir (evita quedar en “viaje” viejo)
    try {
        const isNative = !!(window.Capacitor?.isNativePlatform?.());
        if (isNative && (!saved || saved === 'trip')) {
            // Si no hay búsqueda activa, forzar home en Android para ver el panel nuevo
            if (!isBusyWithTripUi()) saved = 'home';
        }
    } catch (_) {}
    if (!MODE_META[saved]) saved = 'home';

    // Si el modo guardado quedó deshabilitado por ciudad, volver a inicio
    const zoneId = getActiveCityId();
    if (HOME_CARD_TYPES[saved] && homeCardUnavailable(saved, zoneId)) saved = 'home';

    currentMode = saved;
    applyMode(saved);

    // Asegurar hub visible en home
    if (saved === 'home') {
        const hub = document.getElementById('passenger-home-hub');
        if (hub) {
            hub.classList.remove('hidden');
            hub.style.display = '';
        }
        document.body.classList.add('passenger-mode-home');
        document.body.classList.remove('passenger-mode-active');
        syncHomeCardsForCity();
    }
}

/** Refrescar menú/botones cuando el admin cambia servicios o el pasajero cambia de ciudad. */
export function refreshPassengerHomeCityServices() {
    if (!isClientLike()) return;
    ensureHomeUi();
    if (currentMode === 'home') {
        syncHomeCardsForCity();
    } else {
        // Re-aplicar filtros del modo actual
        applyMode(currentMode);
    }
}

// Expone para app.js / cambio de ciudad
if (typeof window !== 'undefined') {
    window.refreshPassengerHomeCityServices = refreshPassengerHomeCityServices;
}

export function initPassengerHome(deps = {}) {
    getUserProfile = deps.getUserProfile || (() => null);
    ensureHomeUi();

    window.setPassengerHomeMode = setPassengerHomeMode;
    window.showPassengerHomeMenu = showPassengerHomeMenu;
    window.getPassengerHomeMode = getPassengerHomeMode;
    window.syncPassengerHomeForRole = syncPassengerHomeForRole;
    window.setServicePickerFilter = setServicePickerFilter;

    // Reintentos: en Capacitor/Android a veces client-view aún no está listo
    const boot = (why) => {
        try {
            if (isBusyWithTripUi()) return;
            ensureHomeUi();
            if (getUserProfile?.() && isClientLike()) {
                // No pisar un flujo ya abierto (Viaje / envío / flete) con el menú inicio
                if (currentMode && currentMode !== 'home') return;
                syncPassengerHomeForRole();
            } else if (isClientLike()) {
                // Perfil aún null → igual montar hub (rol default client)
                ensureHomeUi();
                if (!isBusyWithTripUi() && (!currentMode || currentMode === 'home')) {
                    currentMode = 'home';
                    applyMode('home');
                }
            }
        } catch (e) {
            console.warn('[passenger-home] boot', why, e);
        }
    };
    setTimeout(() => boot('t300'), 300);
    setTimeout(() => boot('t1200'), 1200);
    setTimeout(() => boot('t3000'), 3000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') boot('visible');
    });

    // Por defecto: menú de inicio, salvo que ya haya búsqueda/viaje activo
    if (!isBusyWithTripUi()) {
        try {
            sessionStorage.setItem('hr-passenger-mode', 'home');
        } catch (_) {}
        currentMode = 'home';
        applyMode('home');
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isClientLike() && !isBusyWithTripUi()) {
            ensureHomeUi();
        }
    });
}

export { MODE_META };
