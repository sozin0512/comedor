/**
 * Menú inicial del pasajero: elige qué busca en HonduRaite
 * (viaje, pedido, envío, flete, grúa) y siempre puede volver.
 */
const BOOKING_SECTION_IDS = [
    'passenger-booking-route',
    'passenger-booking-advanced',
    'passenger-booking-service',
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
        defaultService: 'moto',
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
    // No forzar menú si está buscando o en viaje activo
    if (document.body.classList.contains('is-searching')) return true;
    if (document.body.classList.contains('is-active-trip')) return true;
    const searching = document.getElementById('searching-state');
    if (searching && !searching.classList.contains('hidden')) return true;
    const active = document.getElementById('active-trip-panel');
    if (active && !active.classList.contains('hidden')) return true;
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
            const btn = e.target.closest('[data-home-mode]');
            if (!btn || !clientView.contains(btn)) return;
            const mode = btn.getAttribute('data-home-mode');
            if (!mode) return;
            e.preventDefault();
            setPassengerHomeMode(mode);
        });
    }
}

function setServicePickerFilter(allowedTypes) {
    const picker = document.getElementById('service-type-picker');
    if (!picker) return;
    const buttons = picker.querySelectorAll('[data-service-type], #svc-btn-stores');
    buttons.forEach((btn) => {
        const type = btn.getAttribute('data-service-type') || (btn.id === 'svc-btn-stores' ? 'stores' : '');
        if (!allowedTypes || !allowedTypes.length) {
            // En modo home no importa; en stores ocultamos todo el wrap
            btn.classList.add('hidden');
            return;
        }
        const show = allowedTypes.includes(type);
        btn.classList.toggle('hidden', !show);
    });
}

function setBookingVisible(show) {
    BOOKING_SECTION_IDS.forEach((id) => {
        if (id === 'client-stores-section') return; // se maneja aparte
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('hidden', !show);
    });
    // fare card / searching handled by existing app logic
}

function applyMode(mode) {
    const meta = MODE_META[mode] || MODE_META.home;
    const hub = document.getElementById('passenger-home-hub');
    const bar = document.getElementById('passenger-mode-bar');
    const storesSec = document.getElementById('client-stores-section');

    document.body.dataset.passengerMode = mode;
    document.body.classList.toggle('passenger-mode-home', mode === 'home');
    document.body.classList.toggle('passenger-mode-active', mode !== 'home');

    if (hub) hub.classList.toggle('hidden', mode !== 'home');
    if (bar) bar.classList.toggle('hidden', mode === 'home');

    const titleEl = document.getElementById('passenger-mode-title');
    const subEl = document.getElementById('passenger-mode-sub');
    if (titleEl) titleEl.textContent = meta.title || '';
    if (subEl) subEl.textContent = meta.subtitle || '';

    if (mode === 'home') {
        setBookingVisible(false);
        if (storesSec) storesSec.classList.add('hidden');
        // Cerrar paneles de tiendas si estaban abiertos
        window.closeStoresMarketplace?.();
        window.closeMerchantPanel?.();
        return;
    }

    const showBooking = !!meta.showBooking;
    setBookingVisible(showBooking);

    if (storesSec) {
        // La sección embebida de tiendas ya no se necesita si el menú redirige al marketplace;
        // la ocultamos para no duplicar. Emprendedor sigue por perfil/menú.
        storesSec.classList.add('hidden');
    }

    if (showBooking && meta.serviceTypes?.length) {
        setServicePickerFilter(meta.serviceTypes);
        const wrap = document.getElementById('client-service-type-wrap');
        // Si solo hay 1 tipo, se puede ocultar el picker; si hay varios, mostrar
        if (wrap) {
            wrap.classList.toggle('hidden', meta.serviceTypes.length <= 1);
        }
        if (meta.defaultService && typeof window.selectServiceType === 'function') {
            window.selectServiceType(meta.defaultService, { keepFareVisible: false });
        } else if (meta.defaultService) {
            window.currentServiceType = meta.defaultService;
        }
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
            // Entra directo al panorama completo de tiendas
            window.openStoresMarketplace?.();
        }
    } else {
        // Al salir de tiendas, cerrar el mundo sin reentrar al menú (ya estamos cambiando de modo)
        try { window.closeStoresMarketplace?.({ silent: true }); } catch (_) {}
    }
}

export function setPassengerHomeMode(mode) {
    if (!isClientLike()) return;
    const next = MODE_META[mode] ? mode : 'home';

    // Si está en búsqueda/viaje activo, solo permitir quedarse (no forzar home sin cancelar)
    if (isBusyWithTripUi() && next === 'home') {
        if (typeof window.showToast === 'function') {
            window.showToast('Cancela la búsqueda o termina el viaje para volver al menú.', 'warning');
        }
        return;
    }

    currentMode = next;
    try {
        sessionStorage.setItem('hr-passenger-mode', next);
    } catch (_) {}

    ensureHomeUi();
    applyMode(next);
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
        document.body.classList.remove('passenger-mode-home', 'passenger-mode-active');
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
    }
}

export function initPassengerHome(deps = {}) {
    getUserProfile = deps.getUserProfile || (() => null);
    ensureHomeUi();

    window.setPassengerHomeMode = setPassengerHomeMode;
    window.showPassengerHomeMenu = showPassengerHomeMenu;
    window.getPassengerHomeMode = getPassengerHomeMode;
    window.syncPassengerHomeForRole = syncPassengerHomeForRole;

    // Reintentos: en Capacitor/Android a veces client-view aún no está listo
    const boot = (why) => {
        try {
            ensureHomeUi();
            if (getUserProfile?.() && isClientLike()) {
                syncPassengerHomeForRole();
            } else if (isClientLike()) {
                // Perfil aún null → igual montar hub (rol default client)
                ensureHomeUi();
                if (!isBusyWithTripUi()) {
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

    // Por defecto: menú de inicio (hasta que cargue el perfil y sincronice)
    try {
        sessionStorage.setItem('hr-passenger-mode', 'home');
    } catch (_) {}
    currentMode = 'home';
    applyMode('home');

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isClientLike()) {
            ensureHomeUi();
        }
    });
}

export { MODE_META };
