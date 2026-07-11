/**
 * Tour guiado para conductores — enseña a recibir viajes y usar la app.
 */

import {
    pickVisible,
    isMobileLayout,
    storageIsDone,
    storageReset,
    startAppTutorial,
    scheduleAutoStartTutorial,
    bindTutorialButtons,
    isTourRunning
} from './app-tutorial-core.js';

const STORAGE_KEY = 'hr-driver-tutorial-v1-done';
const ROOT_ID = 'driver-tutorial-root';
const BODY_CLASS = 'passenger-tutorial-active';

function buildSteps() {
    const steps = [
        {
            id: 'welcome',
            icon: 'fa-car-side',
            title: '¡Bienvenido, conductor!',
            body: 'Este recorrido te enseña cómo recibir viajes, ofertar y usar cada herramienta. Se abre solo la primera vez; puedes repetirlo desde Mi Perfil.',
            placement: 'center',
        },
        {
            id: 'avatar',
            icon: 'fa-user-circle',
            title: 'Tu cuenta',
            body: 'Aquí ves tu foto y nombre. Verifica que estás en tu cuenta de conductor antes de ponerte en línea.',
            target: () => pickVisible('#avatar-placeholder', '.header-slot-left'),
            placement: 'bottom',
        },
        {
            id: 'notifications',
            icon: 'fa-bell',
            title: 'Campana de notificaciones',
            body: 'Recibes avisos de nuevos viajes, mensajes del chat, depósitos, pagos y recordatorios importantes. El número rojo indica pendientes.',
            target: () => pickVisible(
                '#header-notif-btn-mobile',
                '#app-header .header-actions-desktop button[onclick*="showNotificationsModal"]'
            ),
            placement: 'bottom',
        },
        {
            id: 'profile',
            icon: 'fa-user-cog',
            title: 'Icono de perfil',
            body: 'Aquí gestionas vehículos, cuenta bancaria para pagos, depósito del día, documentos, referidos y modo segundo plano.',
            target: () => pickVisible(
                '#header-profile-btn-mobile',
                '#app-header .header-actions-desktop button[onclick*="openProfilePanel"]'
            ),
            placement: 'bottom',
        },
    ];

    if (isMobileLayout()) {
        steps.push({
            id: 'more-menu',
            icon: 'fa-ellipsis-v',
            title: 'Menú de más opciones',
            body: 'Los tres puntos abren soporte WhatsApp, historial, instalar la app, activar avisos push y cerrar sesión.',
            target: () => document.getElementById('header-more-toggle'),
            placement: 'bottom',
        });
    } else {
        steps.push({
            id: 'support',
            icon: 'fa-whatsapp',
            title: 'Soporte y herramientas',
            body: 'En pantalla grande tienes acceso directo a WhatsApp de soporte, modo noche y cerrar sesión.',
            target: () => pickVisible('#support-whatsapp-btn', '.header-actions-desktop'),
            placement: 'bottom',
        });
    }

    steps.push(
        {
            id: 'city',
            icon: 'fa-map-marker-alt',
            title: 'Ciudad de operación',
            body: 'Toca el chip del mapa para elegir en qué ciudad trabajas. Solo verás solicitudes de pasajeros de esa zona.',
            target: () => pickVisible('#service-zone-map-chip'),
            placement: 'bottom',
            beforeShow: () => {
                window.showControlPanel?.();
                document.getElementById('service-zone-map-chip')?.classList.remove('hidden');
            },
        },
        {
            id: 'online',
            icon: 'fa-signal',
            title: 'En línea / Desconectado',
            body: 'Este indicador muestra si estás activo. Tócalo para pausarte o volver a conectarte. Debes estar en línea para recibir viajes.',
            target: () => document.getElementById('driver-online-badge'),
            placement: 'bottom',
            mobilePlacement: 'top',
            beforeShow: () => {
                window.showControlPanel?.();
                document.getElementById('driver-view')?.classList.remove('hidden');
            },
        },
        {
            id: 'vehicle-badge',
            icon: 'fa-car',
            title: 'Tu vehículo activo',
            body: 'Muestra si operas en moto, auto, taxi, paila o camión. Cámbialo en Mi Perfil → Vehículo de hoy (solo vehículos aprobados).',
            target: () => pickVisible('#driver-vehicle-type-badge', '.driver-view-header'),
            placement: 'bottom',
            mobilePlacement: 'top',
            beforeShow: () => {
                window.showControlPanel?.();
                document.getElementById('driver-view')?.classList.remove('hidden');
            },
        },
        {
            id: 'radar',
            icon: 'fa-radar',
            title: 'Radar de viajes',
            body: 'Cuando no hay solicitudes cerca, el radar indica que estás buscando clientes. Los viajes disponibles aparecen en la lista de abajo.',
            target: () => document.getElementById('driver-radar-status'),
            placement: 'top',
            mobilePlacement: 'top',
            beforeShow: () => {
                window.showControlPanel?.();
                document.getElementById('driver-view')?.classList.remove('hidden');
            },
        },
        {
            id: 'requests',
            icon: 'fa-list-ul',
            title: 'Lista de solicitudes',
            body: 'Aquí aparecen los viajes que puedes tomar. Toca uno para ver ruta en el mapa, distancia y datos del pasajero antes de ofertar.',
            target: () => pickVisible('#requests-list', '#driver-view'),
            placement: 'top',
            mobilePlacement: 'top',
            beforeShow: () => {
                window.showControlPanel?.();
                document.getElementById('driver-view')?.classList.remove('hidden');
            },
        },
        {
            id: 'offer',
            icon: 'fa-hand-holding-usd',
            title: 'Cómo ofertar',
            body: 'En cada viaje puedes proponer tu precio con el teclado numérico. El pasajero verá tu oferta y puede aceptarla. Sé competitivo y claro.',
            placement: 'center',
        },
        {
            id: 'earnings',
            icon: 'fa-coins',
            title: 'Ganancias del día',
            body: 'En el mapa verás un panel flotante con lo que llevas ganado hoy. Úsalo para controlar depósitos y comisiones.',
            target: () => pickVisible('#driver-earnings-float .driver-earnings-float', '#driver-earnings-float'),
            placement: 'center',
        },
        {
            id: 'active-trip',
            icon: 'fa-route',
            title: 'Viaje aceptado',
            body: 'Al aceptar un viaje verás la ruta, tiempo estimado y botón para abrir Google Maps hacia el punto de recogida.',
            placement: 'center',
        },
        {
            id: 'pin',
            icon: 'fa-key',
            title: 'PIN del pasajero',
            body: 'Al llegar, pide el PIN al pasajero e ingrésalo en el panel flotante. Así confirmas que es la persona correcta antes de iniciar.',
            placement: 'center',
        },
        {
            id: 'arrived',
            icon: 'fa-flag-checkered',
            title: 'Llegada y finalizar',
            body: 'Marca "Llegué" al punto de recogida y "Llegué al destino" al terminar. El botón de destino se activa cerca del punto final.',
            placement: 'center',
        },
        {
            id: 'chat',
            icon: 'fa-comments',
            title: 'Chat del viaje',
            body: 'Comunícate con el pasajero por el chat flotante. Los números de teléfono no se comparten por seguridad.',
            placement: 'center',
        },
        {
            id: 'nav',
            icon: 'fa-location-arrow',
            title: 'Navegación y mapa',
            body: 'Usa Centrar para volver a tu ubicación, el botón de tráfico para ver congestión, y el panel de navegación durante el recorrido.',
            target: () => pickVisible('#fab-center', '#fab-traffic', '#nav-hud-bottom'),
            placement: 'top',
            mobilePlacement: 'bottom',
        },
        {
            id: 'deposit',
            icon: 'fa-wallet',
            title: 'Depósitos y pagos',
            body: 'En Mi Perfil revisa el depósito del día, tus pagos recibidos (viajes con saldo) y renueva documentos cuando el supervisor lo pida.',
            placement: 'center',
        },
        {
            id: 'done',
            icon: 'fa-check-circle',
            title: '¡Listo para conducir!',
            body: 'Ya conoces lo esencial. Mantente en línea, revisa tus ofertas y respeta las reglas de la plataforma. ¡Buenos viajes!',
            placement: 'center',
        }
    );

    return steps;
}

function canStartDriverTutorial() {
    return window.userProfile?.role === 'driver';
}

export function startDriverTutorial({ force = false } = {}) {
    startAppTutorial({
        storageKey: STORAGE_KEY,
        rootId: ROOT_ID,
        bodyClass: BODY_CLASS,
        canStart: canStartDriverTutorial,
        buildSteps,
        force,
        forceToast: 'Tutorial de conductor iniciado',
        blockedToast: 'El tutorial es solo para conductores.',
    });
}

export function maybeAutoStartDriverTutorial() {
    scheduleAutoStartTutorial({
        storageKey: STORAGE_KEY,
        shouldRun: () => {
            if (window.userProfile?.role !== 'driver') return false;
            if (isTourRunning()) return false;
            if (window.activeTrip) return false;
            const app = document.getElementById('app-interface');
            if (!app || app.classList.contains('hidden')) return false;
            return true;
        },
        start: () => startDriverTutorial(),
    });
}

export function initDriverTutorial() {
    window.startDriverTutorial = (opts) => startDriverTutorial(opts || {});
    window.resetDriverTutorial = () => storageReset(STORAGE_KEY);

    bindTutorialButtons([
        {
            id: 'btn-driver-tutorial',
            onClick: () => {
                window.closeProfilePanel?.();
                startDriverTutorial({ force: true });
            },
        },
        {
            id: 'header-menu-driver-tutorial',
            onClick: () => {
                window.closeHeaderMoreMenu?.();
                startDriverTutorial({ force: true });
            },
        },
    ]);
}

export function syncDriverTutorialMenuVisibility(role) {
    const show = role === 'driver';
    document.getElementById('btn-driver-tutorial')?.classList.toggle('hidden', !show);
    document.getElementById('header-menu-driver-tutorial')?.classList.toggle('hidden', !show);
}

export function isDriverTutorialDone() {
    return storageIsDone(STORAGE_KEY);
}