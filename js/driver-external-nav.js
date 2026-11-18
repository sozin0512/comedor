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

if (typeof window !== 'undefined') {
    applyDriverTurnByTurnFlag();
    window.openDriverStageInWaze = openDriverStageInWaze;
    window.openDriverStageInGoogleMaps = openDriverStageInGoogleMaps;
}
