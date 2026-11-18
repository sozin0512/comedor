/**
 * Navegación del conductor fuera de la app (Waze y Google Maps).
 *
 * El giro a giro de HonduRaite (banner, voz, recálculo) sigue en el código
 * y se enciende con APP_CONFIG.driverTurnByTurnEnabled = true.
 *
 * GPS con la app en segundo plano (Waze / Maps abiertos):
 * - Android APK: NativeTripGps, dentro del servicio «Viaje en curso», escribe
 *   drivers_location y trips.driverLive* aunque el WebView esté pausado.
 *   No hace falta otro plugin. El APK instalado tiene que incluir esa clase
 *   (ya está en android/). Un deploy solo de hosting no actualiza el APK.
 * - iPhone (Safari / PWA): no hay proyecto iOS ni plugin de geolocalización
 *   en segundo plano. watchPosition se pausa al salir de la app. El pasajero
 *   deja de ver el carro hasta que el conductor vuelve a HonduRaite.
 */
import { APP_CONFIG } from './config.js';
import { openExternalUrl } from './capacitor-native.js';

export function driverTurnByTurnEnabled() {
    return APP_CONFIG.driverTurnByTurnEnabled === true;
}

export function applyDriverTurnByTurnFlag() {
    const on = driverTurnByTurnEnabled();
    if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('hr-turnbyturn-off', !on);
        document.body?.classList.toggle('hr-turnbyturn-off', !on);
    }
    if (typeof window !== 'undefined') {
        window.hrDriverTurnByTurnEnabled = driverTurnByTurnEnabled;
        if (!on) window.driverVoiceNavEnabled = false;
    }
    return on;
}

export function wazeAppUrl(lat, lng) {
    return `waze://?ll=${Number(lat)},${Number(lng)}&navigate=yes`;
}

export function wazeWebUrl(lat, lng) {
    return `https://waze.com/ul?ll=${Number(lat)},${Number(lng)}&navigate=yes`;
}

export function googleMapsNavUrl(lat, lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}&travelmode=driving`;
}

/**
 * A dónde mandar al conductor ahora.
 * Aceptado y todavía no llegó: recogida (negocio si es envío).
 * Ya llegó o el viaje va en curso: parada actual o destino.
 */
export function driverStageTarget(trip, helpers = {}) {
    if (!trip) return null;
    const isDelivery = trip.serviceType === 'delivery' || !!trip.storeId || !!trip.storeOrderId;
    const arrived = !!trip.driverArrived;
    const toPickup = trip.status === 'accepted' && !(arrived && !isDelivery);
    if (toPickup) {
        const lat = Number(trip.originLat);
        const lng = Number(trip.originLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
            lat,
            lng,
            label: isDelivery ? 'Hacia el negocio' : 'Hacia el pasajero',
        };
    }
    const leg = helpers.leg;
    if (leg && Number.isFinite(Number(leg.lat)) && Number.isFinite(Number(leg.lng))) {
        return {
            lat: Number(leg.lat),
            lng: Number(leg.lng),
            label: helpers.final === false ? 'Hacia la parada' : 'Hacia el destino',
        };
    }
    const lat = Number(trip.destinationLat);
    const lng = Number(trip.destinationLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, label: 'Hacia el destino' };
}

export function driverStageTargetFromWindow(trip) {
    const leg = typeof window !== 'undefined' ? window.getTripCurrentLegNavTarget?.(trip) : null;
    const final = typeof window !== 'undefined' ? window.isTripAtFinalRouteLeg?.(trip) : true;
    return driverStageTarget(trip, {
        leg: leg && typeof leg === 'object' ? leg : null,
        final,
    });
}

export function externalNavButtonsHtml() {
    return `<div class="driver-external-nav" data-external-nav>
        <button type="button" data-trip-action="driver-waze" class="driver-ext-nav-btn driver-ext-nav-btn--waze" aria-label="Abrir en Waze">
            <span class="pointer-events-none">Waze</span>
        </button>
        <button type="button" data-trip-action="driver-gmaps" class="driver-ext-nav-btn driver-ext-nav-btn--gmaps" aria-label="Abrir en Google Maps">
            <span class="pointer-events-none">Google Maps</span>
        </button>
    </div>`;
}

async function armBackgroundGps(trip) {
    try { await window.syncLiveTripKeepalive?.(trip); } catch (_) {}
    try {
        const { syncAndroidLiveTripKeepalive } = await import('./session-keepalive.js');
        await syncAndroidLiveTripKeepalive(trip, 'driver');
    } catch (_) {}
}

export async function openDriverStageInWaze(trip) {
    const target = driverStageTargetFromWindow(trip);
    if (!target) {
        window.showToast?.('Falta la ubicación de esta etapa.', 'warning');
        return false;
    }
    await armBackgroundGps(trip);
    const native = window.Capacitor?.isNativePlatform?.() === true;
    if (native) {
        try {
            await window.Capacitor.Plugins.App.openUrl({ url: wazeAppUrl(target.lat, target.lng) });
            return true;
        } catch (e) {
            console.warn('waze app url:', e);
        }
    }
    return openExternalUrl(wazeWebUrl(target.lat, target.lng));
}

export async function openDriverStageInGoogleMaps(trip) {
    const target = driverStageTargetFromWindow(trip);
    if (!target) {
        window.showToast?.('Falta la ubicación de esta etapa.', 'warning');
        return false;
    }
    await armBackgroundGps(trip);
    const url = googleMapsNavUrl(target.lat, target.lng);
    if (typeof window.openGoogleMapsDirectionsUrl === 'function') {
        return window.openGoogleMapsDirectionsUrl(url);
    }
    return openExternalUrl(url);
}

function projectPoints(points, w = 320, h = 108, pad = 14) {
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const dx = Math.max(0.00008, maxLng - minLng);
    const dy = Math.max(0.00008, maxLat - minLat);
    return points.map((p) => {
        const x = pad + ((p.lng - minLng) / dx) * (w - pad * 2);
        const y = pad + ((maxLat - p.lat) / dy) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
}

function polyline(points, color) {
    if (!points || points.length < 2) return '';
    const d = projectPoints(points).join(' ');
    return `<polyline points="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
}

/** Dos trazos: ámbar conductor→recogida, verde recogida→destino. */
export function offerRouteSketchSvg({ driver, pickup, destination, toPickupPath, tripPath } = {}) {
    const amber = (toPickupPath && toPickupPath.length >= 2)
        ? toPickupPath
        : (driver && pickup ? [driver, pickup] : null);
    const green = (tripPath && tripPath.length >= 2)
        ? tripPath
        : (pickup && destination ? [pickup, destination] : null);
    const all = [...(amber || []), ...(green || [])];
    if (all.length < 2) return '';
    return `<svg class="hr-ofr-sketch-svg" viewBox="0 0 320 108" role="img" aria-label="Ruta de la oferta">
        <rect width="320" height="108" rx="14" fill="#eef3f8"></rect>
        ${polyline(amber, '#f59e0b')}
        ${polyline(green, '#059669')}
    </svg>`;
}

export function offerRouteSketchHtml(trip, driverPos = null) {
    const pickup = trip?.originLat != null ? { lat: Number(trip.originLat), lng: Number(trip.originLng) } : null;
    const destination = trip?.destinationLat != null ? { lat: Number(trip.destinationLat), lng: Number(trip.destinationLng) } : null;
    const svg = offerRouteSketchSvg({
        driver: driverPos,
        pickup,
        destination,
    });
    if (!svg) return '';
    return `<div class="hr-ofr-sketch" data-offer-sketch="${String(trip.id || '')}">${svg}</div>`;
}

export function paintOfferRouteSketch(tripId, route, trip) {
    if (typeof document === 'undefined' || !tripId) return;
    const el = document.querySelector(`[data-offer-sketch="${tripId}"]`);
    if (!el || !route) return;
    const legs = Array.isArray(route.previewLegs) ? route.previewLegs : [];
    const toPickup = legs.find((leg) => leg.role === 'toPickup')?.path;
    const client = legs.find((leg) => leg.role === 'clientTrip')?.path;
    const svg = offerRouteSketchSvg({
        driver: toPickup?.[0] || null,
        pickup: trip?.originLat != null ? { lat: Number(trip.originLat), lng: Number(trip.originLng) } : null,
        destination: trip?.destinationLat != null ? { lat: Number(trip.destinationLat), lng: Number(trip.destinationLng) } : null,
        toPickupPath: toPickup,
        tripPath: client,
    });
    if (svg) el.innerHTML = svg;
}

if (typeof window !== 'undefined') {
    applyDriverTurnByTurnFlag();
    window.openDriverStageInWaze = openDriverStageInWaze;
    window.openDriverStageInGoogleMaps = openDriverStageInGoogleMaps;
    window.paintOfferRouteSketch = paintOfferRouteSketch;
}
