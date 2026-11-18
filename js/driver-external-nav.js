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

export function haversineMeters(a, b) {
    if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return Infinity;
    const r = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Una vez por etapa: cambia al pasar de recogida a parada o destino. */
export function arrivalStageKey(trip, stage) {
    if (!trip?.id || !stage) return '';
    return [
        trip.id,
        stage.label || '',
        trip.status || '',
        trip.driverArrived ? 1 : 0,
        Number(trip.routeLegIndex) || 0
    ].join('|');
}

export function arrivalNoticeCopy(stage) {
    const place = stage?.label === 'Hacia el negocio' ? 'al negocio'
        : stage?.label === 'Hacia el destino' ? 'al destino'
            : stage?.label === 'Hacia la parada' ? 'a la parada'
                : 'al pasajero';
    return {
        title: 'Llegaste',
        body: `Llegaste ${place}. Tocá para volver a HonduRaite`
    };
}

/** ~100 m. Si el GPS está muy borroso no avisamos. */
export function isNearStage(pos, stage, accuracy) {
    if (!pos || !stage) return false;
    const acc = Number(accuracy);
    if (Number.isFinite(acc) && acc > 120) return false;
    return haversineMeters(pos, stage) <= 100;
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

const BUBBLE_PROMPT_KEY = 'hr_bubble_prompt_v1';

/** La primera vez que abre Waze o Maps, pide la burbuja. Si dice que no, igual abre el mapa. */
async function ensureReturnBubblePermission() {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null;
    if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android') return 'skip';
    let granted = false;
    let plugin = null;
    try {
        const { registerPlugin } = await import('./vendor/capacitor-core.js');
        plugin = registerPlugin('SessionKeepalive');
        granted = !!(await plugin.hasOverlayPermission())?.granted;
    } catch (_) {
        return 'skip';
    }
    if (granted) return 'skip';
    try {
        if (localStorage.getItem(BUBBLE_PROMPT_KEY) === '1') return 'skip';
    } catch (_) {}
    const choice = await new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.dataset.bubblePrompt = '1';
        modal.style.cssText = 'position:fixed;inset:0;z-index:46000;background:rgba(15,23,42,.72);display:flex;align-items:flex-end;justify-content:center;padding:16px;';
        modal.innerHTML = `
            <div style="width:100%;max-width:24rem;background:#fff;border-radius:1.5rem;padding:1.25rem 1.15rem 1.1rem;box-shadow:0 18px 40px rgba(0,0,0,.28)">
                <p style="margin:0;font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748b">Volver desde Waze o Maps</p>
                <h2 style="margin:.35rem 0 0;font-size:1.15rem;font-weight:900;color:#0f172a">Burbuja de HonduRaite</h2>
                <p style="margin:.55rem 0 0;font-size:.92rem;line-height:1.35;color:#334155">Para volver al viaje con un toque, Android tiene que dejar que HonduRaite se muestre sobre otras apps. Vas a ver un círculo con el ícono encima de Waze o Maps. Si no lo activás, igual te avisamos con una notificación al llegar.</p>
                <div style="display:flex;gap:.5rem;margin-top:1rem">
                    <button type="button" data-act="later" style="flex:1;min-height:3rem;border:0;border-radius:1rem;background:#e2e8f0;font-weight:800;color:#0f172a">Ahora no</button>
                    <button type="button" data-act="allow" style="flex:1.2;min-height:3rem;border:0;border-radius:1rem;background:#0f172a;font-weight:900;color:#fff">Activar burbuja</button>
                </div>
            </div>`;
        modal.querySelector('[data-act="later"]').onclick = () => { modal.remove(); resolve('later'); };
        modal.querySelector('[data-act="allow"]').onclick = () => { modal.remove(); resolve('allow'); };
        document.body.appendChild(modal);
    });
    try { localStorage.setItem(BUBBLE_PROMPT_KEY, '1'); } catch (_) {}
    if (choice === 'allow') {
        try { await plugin.requestOverlayPermission(); } catch (_) {}
        return 'settings';
    }
    return 'skip';
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
    if (await ensureReturnBubblePermission() === 'settings') return false;
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
    if (await ensureReturnBubblePermission() === 'settings') return false;
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
