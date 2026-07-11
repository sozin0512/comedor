/**
 * Tour guiado para pasajeros — enseña a pedir viajes y el uso de cada control.
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

const STORAGE_KEY = 'hr-passenger-tutorial-v1-done';
const ROOT_ID = 'passenger-tutorial-root';
const BODY_CLASS = 'passenger-tutorial-active';

function buildSteps() {
    const steps = [
        {
            id: 'welcome',
            icon: 'fa-route',
            title: '¡Bienvenido a HonduRaite!',
            body: 'Este recorrido te enseña paso a paso cómo pedir un viaje y para qué sirve cada botón. Se abre solo la primera vez; puedes repetirlo desde Mi Perfil.',
            placement: 'center',
        },
        {
            id: 'avatar',
            icon: 'fa-user-circle',
            title: 'Tu cuenta',
            body: 'Aquí ves tu foto y nombre. Confirma que estás en la cuenta correcta antes de pedir un viaje.',
            target: () => pickVisible('#avatar-placeholder', '.header-slot-left'),
            placement: 'bottom',
            mobilePlacement: 'bottom',
        },
        {
            id: 'notifications',
            icon: 'fa-bell',
            title: 'Campana de notificaciones',
            body: 'Aquí llegan avisos de ofertas de conductores, mensajes del chat, cambios de estado del viaje y promociones. El número rojo indica pendientes.',
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
            body: 'Abre tu perfil: saldo, recargas, código de referido, contacto de emergencia, historial y configuración de seguridad.',
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
            body: 'En celular, los tres puntos abren soporte por WhatsApp, historial de viajes, instalar la app, modo noche y cerrar sesión.',
            target: () => document.getElementById('header-more-toggle'),
            placement: 'bottom',
        });
    } else {
        steps.push({
            id: 'support',
            icon: 'fa-whatsapp',
            title: 'Soporte y más herramientas',
            body: 'En pantalla grande verás WhatsApp de soporte, modo noche, historial y cerrar sesión directamente en la barra superior.',
            target: () => pickVisible('#support-whatsapp-btn', '.header-actions-desktop'),
            placement: 'bottom',
        });
    }

    steps.push(
        {
            id: 'city',
            icon: 'fa-map-marker-alt',
            title: 'Tu ciudad',
            body: 'Toca el chip del mapa para elegir la ciudad donde pides el viaje. Solo verás conductores de esa zona.',
            target: () => pickVisible('#service-zone-map-chip'),
            placement: 'bottom',
            beforeShow: () => {
                window.showControlPanel?.();
                document.getElementById('service-zone-map-chip')?.classList.remove('hidden');
            },
        },
        {
            id: 'route',
            icon: 'fa-map-signs',
            title: 'Paso 1 · Origen y destino',
            body: 'Escribe de dónde sales y a dónde vas. Puedes agregar paradas intermedias; el destino final siempre queda al último.',
            target: () => document.getElementById('passenger-booking-route'),
            placement: 'top',
            mobilePlacement: 'top',
            spotlightPadding: 6,
            beforeShow: () => {
                window.showControlPanel?.();
                document.getElementById('client-view')?.classList.remove('hidden');
            },
        },
        {
            id: 'gps',
            icon: 'fa-crosshairs',
            title: 'Usar mi ubicación',
            body: 'La cruz azul en Origen coloca automáticamente tu posición actual del GPS. Úsala cuando ya estés en el punto de recogida.',
            target: () => document.getElementById('btn-use-location'),
            placement: 'left',
            mobilePlacement: 'top',
        },
        {
            id: 'favorites',
            icon: 'fa-bookmark',
            title: 'Lugares favoritos',
            body: 'Casa, Trabajo y Pulpería son accesos rápidos. Puedes guardar direcciones que uses seguido con el botón Guardar.',
            target: () => document.getElementById('favorites-bar'),
            placement: 'bottom',
            mobilePlacement: 'top',
        },
        {
            id: 'advanced',
            icon: 'fa-sliders-h',
            title: 'Paso 2 · Más opciones',
            body: 'Despliega aquí para programar viajes, pedir para otra persona, reservar por horas, o llenar datos de envío o flete.',
            target: () => document.getElementById('trip-advanced-toggle'),
            placement: 'top',
            mobilePlacement: 'top',
            beforeShow: () => {
                const toggle = document.getElementById('trip-advanced-toggle');
                const body = document.getElementById('trip-advanced-body');
                if (toggle && body?.classList.contains('hidden')) toggle.click();
            },
        },
        {
            id: 'service',
            icon: 'fa-motorcycle',
            title: 'Paso 3 · Tipo de servicio',
            body: 'Elige Moto, Taxi VIP, Taxi T-, envío/comida o flete (paila/camión). Cada tipo tiene conductores y tarifas distintas.',
            target: () => document.getElementById('passenger-booking-service'),
            placement: 'top',
            mobilePlacement: 'top',
        },
        {
            id: 'fare',
            icon: 'fa-hand-holding-usd',
            title: 'Tarifa y solicitar',
            body: 'Cuando pongas origen y destino, aquí verás el precio estimado y el botón SOLICITAR AHORA para buscar conductores.',
            target: () => pickVisible('#fare-request-btn', '#fare-card', '#passenger-booking-service'),
            placement: 'top',
            mobilePlacement: 'top',
        },
        {
            id: 'panel',
            icon: 'fa-chevron-down',
            title: 'Panel y mapa',
            body: 'Puedes ocultar este panel para ver más mapa, o usar Abrir panel cuando lo necesites. También puedes arrastrar el panel.',
            target: () => pickVisible(
                '#control-panel .panel-hide-btn',
                '#panel-expand-fab',
                '#control-panel .control-panel-header'
            ),
            placement: 'top',
            mobilePlacement: 'top',
        },
        {
            id: 'searching',
            icon: 'fa-radar',
            title: 'Buscando conductores',
            body: 'Al solicitar, verás conductores que miran tu viaje y pueden ofertarte. Revisa precio, vehículo y calificación antes de aceptar.',
            placement: 'center',
        },
        {
            id: 'offers',
            icon: 'fa-tags',
            title: 'Ofertas y aceptar',
            body: 'Las ofertas aparecen en la lista. Al aceptar una, el conductor va hacia ti. Puedes cancelar la solicitud si cambias de plan.',
            placement: 'center',
        },
        {
            id: 'active-trip',
            icon: 'fa-comments',
            title: 'Durante el viaje',
            body: 'Usa el chat flotante para hablar con el conductor (sin compartir teléfono). Verás el PIN de seguridad y el mapa con su ubicación.',
            placement: 'center',
        },
        {
            id: 'done',
            icon: 'fa-check-circle',
            title: '¡Listo para viajar!',
            body: 'Ya conoces lo básico. Recarga saldo en tu perfil si quieres pagar con puntos, o paga en efectivo al terminar. ¡Buen viaje!',
            placement: 'center',
        }
    );

    return steps;
}

function canStartPassengerTutorial() {
    return window.userProfile?.role === 'client';
}

export function startPassengerTutorial({ force = false } = {}) {
    startAppTutorial({
        storageKey: STORAGE_KEY,
        rootId: ROOT_ID,
        bodyClass: BODY_CLASS,
        canStart: canStartPassengerTutorial,
        buildSteps,
        force,
        forceToast: 'Tutorial de pasajero iniciado',
        blockedToast: 'El tutorial es solo para pasajeros.',
    });
}

export function maybeAutoStartPassengerTutorial() {
    scheduleAutoStartTutorial({
        storageKey: STORAGE_KEY,
        shouldRun: () => {
            if (window.userProfile?.role !== 'client') return false;
            if (isTourRunning()) return false;
            if (window.activeTrip || document.body.classList.contains('is-searching')) return false;
            return true;
        },
        start: () => startPassengerTutorial(),
    });
}

export function initPassengerTutorial() {
    window.startPassengerTutorial = (opts) => startPassengerTutorial(opts || {});
    window.resetPassengerTutorial = () => storageReset(STORAGE_KEY);

    bindTutorialButtons([
        {
            id: 'btn-passenger-tutorial',
            onClick: () => {
                window.closeProfilePanel?.();
                startPassengerTutorial({ force: true });
            },
        },
        {
            id: 'header-menu-tutorial',
            onClick: () => {
                window.closeHeaderMoreMenu?.();
                startPassengerTutorial({ force: true });
            },
        },
    ]);
}

export function syncPassengerTutorialMenuVisibility(role) {
    const show = role === 'client';
    document.getElementById('btn-passenger-tutorial')?.classList.toggle('hidden', !show);
    document.getElementById('header-menu-tutorial')?.classList.toggle('hidden', !show);
}

export function isPassengerTutorialDone() {
    return storageIsDone(STORAGE_KEY);
}