/** Moto estrella, favoritos, viajes programados, terceros, ETA */

export const DELIVERY_CATEGORIES = [
    { id: 'comida', label: 'Comida de restaurante', icon: 'fa-utensils', placeholder: 'Ej: 2 hamburguesas + papas, pollo asado con tortillas...' },
    { id: 'pulperia', label: 'Pulpería', icon: 'fa-store', placeholder: 'Productos de pulpería (leche, pan, huevos...)' },
    { id: 'farmacia', label: 'Farmacia', icon: 'fa-pills', placeholder: 'Medicamentos o insumos de farmacia' },
    { id: 'documentos', label: 'Documentos', icon: 'fa-file-alt', placeholder: 'Documentos, trámites, sobres' },
    { id: 'otro', label: 'Otro', icon: 'fa-box', placeholder: 'Describe el pedido' },
];

export const RIDER_RELATIONS = [
    { id: 'mama', label: 'Mi mamá' },
    { id: 'papa', label: 'Mi papá' },
    { id: 'hijo', label: 'Mi hijo/a' },
    { id: 'esposo', label: 'Mi esposo/a' },
    { id: 'otro', label: 'Otra persona' },
];

export function getFavoriteKeys() {
    return ['home', 'work', 'pulperia'];
}

export function getFavoriteLabels() {
    return { home: 'Casa', work: 'Trabajo', pulperia: 'Pulpería' };
}

export function buildTripOptionsFromUI() {
    const scheduledToggle = document.getElementById('trip-schedule-toggle')?.checked;
    const scheduledAt = document.getElementById('trip-schedule-datetime')?.value || '';
    const thirdPartyToggle = document.getElementById('trip-third-party-toggle')?.checked;
    const riderName = document.getElementById('trip-rider-name')?.value?.trim() || '';
    const riderPhone = document.getElementById('trip-rider-phone')?.value?.trim() || '';
    const riderRelation = document.getElementById('trip-rider-relation')?.value || '';
    const deliveryCategory = document.getElementById('delivery-category')?.value || 'otro';

    let scheduledFor = null;
    if (scheduledToggle && scheduledAt) {
        const dt = new Date(scheduledAt);
        if (!Number.isNaN(dt.getTime()) && dt.getTime() > Date.now() + 5 * 60 * 1000) {
            scheduledFor = dt.toISOString();
        }
    }

    const riderInfo = thirdPartyToggle && riderName
        ? { name: riderName, phone: (typeof window !== 'undefined' && window.normalizeHondurasPhone ? window.normalizeHondurasPhone(riderPhone) : riderPhone), relation: riderRelation, bookedByUid: null }
        : null;

    return { scheduledFor, riderInfo, deliveryCategory };
}

export function validateTripOptions(options) {
    if (document.getElementById('trip-schedule-toggle')?.checked) {
        if (!options.scheduledFor) {
            return { ok: false, message: 'Elige fecha y hora futura para programar el viaje (mínimo 5 minutos).' };
        }
    }
    if (document.getElementById('trip-third-party-toggle')?.checked) {
        if (!options.riderInfo?.name) return { ok: false, message: 'Indica el nombre de quien viajará.' };
        if (!options.riderInfo?.phone) return { ok: false, message: 'Indica el WhatsApp de quien viajará.' };
    }
    return { ok: true };
}

export function formatDriverEtaMessage(route, driverName) {
    if (!route) return 'Calculando llegada del conductor...';
    const km = typeof window?.getRouteDistanceKm === 'function' ? window.getRouteDistanceKm(route) : 0;
    const duration = typeof window?.formatRouteDuration === 'function' ? window.formatRouteDuration(route) : '';
    const name = driverName ? driverName.split(' ')[0] : 'Conductor';
    if (km > 0 && duration) return `${name} a ${km.toFixed(1)} km · llega en ${duration}`;
    if (duration) return `${name} llega en ${duration}`;
    return `Llegada estimada: ${duration || 'calculando...'}`;
}

export function getDeliverySlaText(km = 0) {
    const base = 30;
    const extra = km > 8 ? Math.ceil((km - 8) * 2) : 0;
    return `Meta de entrega: ${base + extra} min`;
}

export function estimateArrivalMinutes(route) {
    if (!route?.durationMillis) return null;
    return Math.max(1, Math.round(route.durationMillis / 60000));
}