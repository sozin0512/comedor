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
} from './service-types.js?v=2026.10.25.3';
import { getDefaultZoneId, getZoneById } from './zones.js?v=2026.10.25.3';
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

function ensureHomeUi() {
    const clientView = document.getElementById('client-view');
    if (!clientView) return;

    let hub = document.getElementById('passenger-home-hub');
    if (!hub || hub.getAttribute('data-layout') !== 'hgrid-v1') {
        const isNew = !hub;
        if (!hub) {
            hub = document.createElement('section');
            hub.id = 'passenger-home-hub';
            hub.className = 'passenger-home-hub';
            hub.setAttribute('aria-label', 'Menú principal del pasajero');
        }
        hub.setAttribute('data-layout', 'hgrid-v1');
        hub.innerHTML = `
            <div class="passenger-home-hero">
                <p class="passenger-home-kicker">HonduRaite</p>
                <h2 class="passenger-home-title">¿Qué buscas hoy?</h2>
            </div>
            <div class="passenger-home-grid" role="list">
                <button type="button" class="passenger-home-card passenger-home-card--trip" data-home-mode="trip" role="listitem" title="Moto, Taxi VIP o taxi tradicional">
                    <span class="passenger-home-card-icon"><i class="fas fa-car-side"></i></span>
                    <span class="passenger-home-card-text">
                        <strong>Viaje</strong>
                        <small>Moto · VIP · Taxi</small>
                    </span>
                </button>
                <button type="button" class="passenger-home-card passenger-home-card--stores" data-home-mode="stores" role="listitem" title="Comprar a emprendedores">
                    <span class="passenger-home-card-icon"><i class="fas fa-store"></i></span>
                    <span class="passenger-home-card-text">
                        <strong>Tiendas</strong>
                        <small>Pedidos</small>
                    </span>
                </button>
                <button type="button" class="passenger-home-card passenger-home-card--delivery" data-home-mode="delivery" role="listitem" title="Recoger y entregar">
                    <span class="passenger-home-card-icon"><i class="fas fa-box"></i></span>
                    <span class="passenger-home-card-text">
                        <strong>Envío</strong>
                        <small>Mensajería</small>
                    </span>
                </button>
                <button type="button" class="passenger-home-card passenger-home-card--freight" data-home-mode="freight" role="listitem" title="Paila o camión">
                    <span class="passenger-home-card-icon"><i class="fas fa-truck"></i></span>
                    <span class="passenger-home-card-text">
                        <strong>Flete</strong>
                        <small>Paila · Camión</small>
                    </span>
                </button>
                <button type="button" class="passenger-home-card passenger-home-card--tow" data-home-mode="tow" role="listitem" title="Remolque y auxilio">
                    <span class="passenger-home-card-icon"><i class="icon-grua" aria-hidden="true"></i></span>
                    <span class="passenger-home-card-text">
                        <strong>Grúa</strong>
                        <small>Remolque</small>
                    </span>
                </button>
            </div>
            <div id="want-to-be-driver-card" style="margin-top:0.5rem;">
                <button type="button" id="btn-want-to-be-driver" data-home-action="want-to-be-driver"
                    style="width:100%;display:flex;align-items:center;gap:0.65rem;padding:0.55rem 0.75rem;border-radius:0.95rem;border:1px solid #e2e8f0;background:#ffffff;box-shadow:0 4px 14px rgba(15,23,42,0.05);text-align:left;transition:transform 0.12s ease;">
                    <span style="width:2.2rem;height:2.2rem;border-radius:0.7rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;font-size:0.9rem;background:linear-gradient(135deg,#2563eb,#1d4ed8);">
                        <i class="fas fa-id-card"></i>
                    </span>
                    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:0.05rem;">
                        <strong style="font-size:0.78rem;font-weight:900;color:#0f172a;line-height:1.15;">Quiero ser conductor</strong>
                        <small style="font-size:0.64rem;font-weight:600;color:#64748b;line-height:1.2;">Registra tu auto, moto, taxi, paila o grúa en HonduRaite</small>
                    </span>
                    <i class="fas fa-chevron-right" style="color:#94a3b8;font-size:0.72rem;flex-shrink:0;"></i>
                </button>
            </div>
            <p class="passenger-home-foot">Toca una opción · vuelve con <b>Inicio</b></p>
        `;
        if (isNew) {
            clientView.insertBefore(hub, clientView.firstChild);
        }
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
        let pick = meta.defaultService;
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
        // Avanzados para delivery/flete/grúa
        if (['delivery', 'freight', 'tow'].includes(mode)) {
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
