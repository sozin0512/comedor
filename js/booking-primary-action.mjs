/**
 * Acción principal del pedido de viaje.
 * Taxi VIP (u otro tipo) puede verse resaltado como valor por defecto
 * sin que el pasajero lo haya confirmado. En ese caso igual tiene que
 * haber un botón visible para continuar; las preguntas de después
 * (cuántas personas, ahora o después) siguen en el flujo.
 */

export const ANDROID_3BTN_NAV_PX = 48;
export const ANDROID_GESTURE_NAV_PX = 20;
export const BOOKING_NAV_GAP_PX = 8;

const TYPE_BUTTON_NAME = {
    auto: 'Taxi VIP',
    moto: 'Moto',
    taxi: 'Taxi',
    delivery: 'Envío',
    flete_paila: 'Paila',
    flete_camion: 'Camión',
    grua: 'Grúa',
};

export function bookingTypeButtonName(type, fallbackLabel = '') {
    const named = TYPE_BUTTON_NAME[type];
    if (named) return named;
    const clean = String(fallbackLabel || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    return clean || 'este vehículo';
}

/**
 * Hueco entre el botón y el borde inferior de la pantalla.
 * 3 botones de Android: 48px si el sistema no informó un inset mayor.
 * Gestos: al menos 20px, o el safe-area real si es más alto.
 */
export function bookingNavClearancePx({
    mode = 'default',
    safeBottomPx = 0,
    navInsetPx = ANDROID_3BTN_NAV_PX,
} = {}) {
    const safe = Math.max(0, Number(safeBottomPx) || 0);
    const inset = Math.max(ANDROID_3BTN_NAV_PX, Number(navInsetPx) || ANDROID_3BTN_NAV_PX);
    let base = Math.max(safe, 12);
    if (mode === '3btn') base = Math.max(safe, inset);
    else if (mode === 'gesture') base = Math.max(safe, ANDROID_GESTURE_NAV_PX);
    return base + BOOKING_NAV_GAP_PX;
}

/** El tipo resaltado se puede confirmar solo si de verdad se puede pedir. */
export function canConfirmHighlightedType({
    type = '',
    disabledTypes = [],
    ariaDisabled = false,
    buttonDisabled = false,
    unavailable = false,
} = {}) {
    if (!type) return false;
    if (ariaDisabled || buttonDisabled || unavailable) return false;
    if (Array.isArray(disabledTypes) && disabledTypes.includes(type)) return false;
    return true;
}

/**
 * Textos de la tarjeta de tipo. Si ya hay uno resaltado, no decir
 * «Toca para elegir»: el pasajero cree que ya lo eligió.
 */
export function serviceStepCopy({
    chosen = false,
    highlightedName = '',
    chosenLabel = '',
} = {}) {
    if (chosen) {
        return {
            title: chosenLabel || highlightedName || 'Tipo de servicio',
            badge: 'Listo · toca para cambiar',
            highlightedPending: false,
        };
    }
    if (highlightedName) {
        return {
            title: highlightedName,
            badge: 'Tocá continuar',
            highlightedPending: true,
        };
    }
    return {
        title: 'Tipo de servicio',
        badge: 'Toca para elegir',
        highlightedPending: false,
    };
}

/**
 * Qué muestra el botón fijo una vez que ya hay tarifas.
 * No pide el viaje hasta que personas y «ahora o después» estén listos.
 */
export function bookingPrimaryAction({
    routeReady = false,
    faresVisible = false,
    serviceTypeChosen = false,
    needsService = true,
    needsPassengers = true,
    passengersChosen = false,
    whenConfirmed = false,
    highlightedType = '',
    highlightedAvailable = false,
    highlightedName = '',
    requestLabel = 'SOLICITAR AHORA',
    nowIsDefault = false,
} = {}) {
    if (!routeReady || !faresVisible) {
        return {
            visible: false,
            mode: 'hidden',
            label: '',
            disabled: true,
            nextStep: null,
            confirmsType: null,
        };
    }

    const servicePending = needsService && serviceTypeChosen !== true;
    if (servicePending) {
        if (!highlightedAvailable || !highlightedType) {
            return {
                visible: true,
                mode: 'blocked',
                label: 'ELEGÍ UN TIPO DISPONIBLE',
                disabled: true,
                nextStep: null,
                confirmsType: null,
            };
        }
        const name = String(highlightedName || 'este vehículo').toUpperCase();
        return {
            visible: true,
            mode: 'confirm-service',
            label: `CONTINUAR CON ${name}`,
            disabled: false,
            nextStep: needsPassengers ? 'passengers' : ((nowIsDefault || whenConfirmed) ? 'request' : 'when'),
            confirmsType: highlightedType,
        };
    }

    if (needsPassengers && !passengersChosen) {
        return {
            visible: true,
            mode: 'passengers',
            label: 'ELEGÍ CUÁNTAS PERSONAS',
            disabled: false,
            nextStep: 'passengers',
            confirmsType: null,
        };
    }

    // «Ahora» ya viene elegido. No hace falta tocarlo para ver SOLICITAR AHORA.
    if (!whenConfirmed && !nowIsDefault) {
        return {
            visible: true,
            mode: 'when',
            label: 'ELEGÍ LA HORA',
            disabled: false,
            nextStep: 'when',
            confirmsType: null,
        };
    }

    const label = String(requestLabel || 'SOLICITAR AHORA').trim() || 'SOLICITAR AHORA';
    return {
        visible: true,
        mode: 'request',
        label,
        disabled: false,
        nextStep: 'request',
        confirmsType: null,
    };
}
