/**
 * Mantiene GPS y tracking lo más activo posible durante viajes (accepted / in_progress).
 * Estilo Uber: wake lock + pulsos GPS frecuentes + foreground service nativo en APK.
 *
 * El pill de estado solo aparece si el GPS del conductor falla (apagado / sin permiso).
 *
 * Exports públicos: syncLiveTripKeepalive, registerLiveTripGpsPulse, isLiveTripKeepaliveActive.
 * El FGS nativo vive en session-keepalive.js (no re-exportar para evitar errores ESM de caché).
 */

import { isCapacitorAndroid } from './capacitor-native.js';
import { syncAndroidLiveTripKeepalive as syncAndroidLiveTripKeepaliveImpl } from './session-keepalive.js';

const LIVE_STATUSES = new Set(['accepted', 'in_progress']);
/** Sin fix GPS reciente = se considera apagado / sin permiso. */
const GPS_STALE_MS = 18000;

let wakeLock = null;
let bgPulseTimer = null;
let gpsHealthTimer = null;
let visibilityBound = false;
let activeLiveTripId = null;
let bgNotifySentForTrip = null;
let pulseHandler = null;
let statusEl = null;

function isLiveTrip(trip) {
    if (!trip?.id || !LIVE_STATUSES.has(trip.status)) return false;
    return true;
}

function isDriverOnTrip(trip) {
    const uid = window.currentUser?.uid;
    if (!uid || !trip) return false;
    if (window.userProfile?.role === 'driver' && trip.driverId === uid) return true;
    return trip.driverId === uid;
}

function pulseIntervalMs() {
    // APK: más agresivo (como Uber). Web: un poco más suave por límites del navegador.
    if (isCapacitorAndroid()) {
        return document.hidden ? 2500 : 4000;
    }
    return document.hidden ? 4500 : 10000;
}

async function requestTripWakeLock() {
    if (!('wakeLock' in navigator)) return false;
    try {
        if (wakeLock && !wakeLock.released) return true;
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
        return true;
    } catch (_) {
        return false;
    }
}

async function releaseTripWakeLock() {
    try {
        await wakeLock?.release?.();
    } catch (_) {}
    wakeLock = null;
}

function ensureStatusPill() {
    if (statusEl?.isConnected) return statusEl;
    statusEl = document.createElement('div');
    statusEl.id = 'live-trip-gps-pill';
    statusEl.setAttribute('role', 'button');
    statusEl.setAttribute('tabindex', '0');
    statusEl.setAttribute('aria-live', 'assertive');
    statusEl.className = 'live-trip-gps-pill hidden';
    statusEl.innerHTML = '<i class="fas fa-location-crosshairs" aria-hidden="true"></i><span></span>';
    statusEl.title = 'Toca para reintentar GPS';
    const retryGps = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        try {
            window.startDriverLocationTracking?.().catch?.(() => {});
        } catch (_) {}
        try {
            navigator.geolocation?.getCurrentPosition?.(
                (pos) => {
                    window._driverGpsError = null;
                    window._driverGpsOk = true;
                    window._driverLiveUpdatedAt = Date.now();
                    window.currentDriverPos = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude
                    };
                    if (typeof window.__publishDriverGpsPulse === 'function') {
                        window.__publishDriverGpsPulse(
                            pos.coords.latitude,
                            pos.coords.longitude,
                            pos.coords.heading,
                            pos.coords.accuracy
                        );
                    }
                    updateStatusPill(currentTrip());
                },
                (err) => {
                    window._driverGpsOk = false;
                    window._driverGpsError = {
                        code: err?.code ?? 2,
                        message: err?.message || '',
                        at: Date.now()
                    };
                    updateStatusPill(currentTrip());
                    window.showToast?.(
                        err?.code === 1
                            ? 'Activa el permiso de ubicación en Ajustes.'
                            : 'Enciende el GPS e inténtalo de nuevo.',
                        'warning'
                    );
                },
                { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
            );
        } catch (_) {}
        updateStatusPill(currentTrip());
    };
    statusEl.addEventListener('click', retryGps);
    statusEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') retryGps(e);
    });
    document.body.appendChild(statusEl);
    return statusEl;
}

/**
 * GPS sano solo si hay fix reciente del conductor.
 * Si hay error de permiso / GPS apagado más reciente que el fix → no sano.
 * Gracia al iniciar viaje: no gritar “apagado” mientras el GPS arranca.
 */
function isDriverGpsHealthy() {
    const now = Date.now();
    const lastOk = Number(window._driverLiveUpdatedAt) || 0;
    const hasPos = !!(window.currentDriverPos?.lat != null && window.currentDriverPos?.lng != null);
    const err = window._driverGpsError;
    // Error explícito (permiso denegado / GPS off) siempre gana
    if (err?.at && (!lastOk || err.at >= lastOk)) {
        return false;
    }
    if (hasPos && lastOk && now - lastOk <= GPS_STALE_MS) {
        return true;
    }
    // Arranque: 8 s de gracia sin fix antes de mostrar el aviso
    const tripSince = Number(window._liveTripGpsWatchSince) || 0;
    if (tripSince && now - tripSince < 8000 && !err) {
        return true;
    }
    if (!hasPos || !lastOk) return false;
    if (now - lastOk > GPS_STALE_MS) return false;
    return true;
}

function gpsProblemMessage() {
    const code = Number(window._driverGpsError?.code);
    if (code === 1) {
        return 'GPS sin permiso · actívalo en Ajustes';
    }
    if (code === 2) {
        return 'GPS apagado · enciéndelo o dale permiso';
    }
    if (code === 3) {
        return 'GPS no responde · enciéndelo o reintenta';
    }
    const lastOk = Number(window._driverLiveUpdatedAt) || 0;
    if (!lastOk || !window.currentDriverPos) {
        return 'GPS apagado · enciéndelo o dale permiso';
    }
    return 'GPS perdido · enciéndelo o dale permiso';
}

/**
 * Solo muestra el pill si el conductor está en viaje Y el GPS no funciona.
 * (Antes: verde permanente «GPS activo · pantalla encendida» — molestaba.)
 */
function updateStatusPill(trip) {
    const el = ensureStatusPill();
    if (!trip || !isLiveTrip(trip) || !isDriverOnTrip(trip)) {
        el.classList.add('hidden');
        return;
    }
    if (isDriverGpsHealthy()) {
        el.classList.add('hidden');
        el.classList.remove('live-trip-gps-pill--ok', 'live-trip-gps-pill--warn', 'live-trip-gps-pill--err');
        return;
    }
    const span = el.querySelector('span');
    const icon = el.querySelector('i');
    if (span) span.textContent = gpsProblemMessage();
    if (icon) {
        icon.className = 'fas fa-location-slash';
        icon.setAttribute('aria-hidden', 'true');
    }
    el.classList.remove('hidden', 'live-trip-gps-pill--ok');
    el.classList.add('live-trip-gps-pill--err', 'live-trip-gps-pill--warn');
}

function startGpsHealthWatch() {
    stopGpsHealthWatch();
    gpsHealthTimer = setInterval(() => {
        if (!activeLiveTripId) return;
        updateStatusPill(currentTrip());
    }, 4000);
}

function stopGpsHealthWatch() {
    if (!gpsHealthTimer) return;
    clearInterval(gpsHealthTimer);
    gpsHealthTimer = null;
}

function pulseGps(reason = 'interval') {
    if (!activeLiveTripId || typeof pulseHandler !== 'function') return;
    try {
        pulseHandler({ reason, tripId: activeLiveTripId, hidden: document.hidden });
    } catch (_) {}
}

function startBackgroundPulse() {
    stopBackgroundPulse();
    const ms = pulseIntervalMs();
    bgPulseTimer = setInterval(() => {
        // Reprogramar si cambió foreground/background
        if (bgPulseTimer && Math.abs(ms - pulseIntervalMs()) > 500) {
            startBackgroundPulse();
            return;
        }
        pulseGps('background');
    }, ms);
    pulseGps(document.hidden ? 'background-start' : 'foreground-backup');
}

function stopBackgroundPulse() {
    if (!bgPulseTimer) return;
    clearInterval(bgPulseTimer);
    bgPulseTimer = null;
}

function currentTrip() {
    return window.currentActiveTripData || null;
}

async function onVisibilityChange() {
    if (!activeLiveTripId) return;
    const trip = currentTrip();

    if (document.visibilityState === 'visible') {
        stopBackgroundPulse();
        await requestTripWakeLock();
        updateStatusPill(trip);
        pulseGps('visible');
        // Reafirmar servicio nativo al volver
        if (trip) syncAndroidLiveTripKeepaliveImpl(trip).catch(() => {});
        window.__liveTripRepaintPassenger?.();
        // En APK seguimos pulsando GPS en primer plano (más fluido)
        if (isCapacitorAndroid()) startBackgroundPulse();
    } else {
        startBackgroundPulse();
        updateStatusPill(trip);
        if (trip) syncAndroidLiveTripKeepaliveImpl(trip).catch(() => {});
        if (bgNotifySentForTrip !== activeLiveTripId && !isCapacitorAndroid()) {
            bgNotifySentForTrip = activeLiveTripId;
            window.notifyTripEvent?.({
                title: 'Viaje en curso',
                body: 'Mantén HonduRaite abierta para que el mapa siga actualizándose en tiempo real.',
                tag: `live-trip-bg-${activeLiveTripId}`,
                tripId: activeLiveTripId,
                force: false,
                sound: 'none'
            });
        }
    }
}

function bindVisibility() {
    if (visibilityBound) return;
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => onVisibilityChange());
    window.addEventListener('pagehide', () => pulseGps('pagehide'));
    window.addEventListener('focus', () => {
        if (activeLiveTripId) pulseGps('focus');
    });
}

export function registerLiveTripGpsPulse(handler) {
    pulseHandler = handler;
}

export async function syncLiveTripKeepalive(trip) {
    if (!isLiveTrip(trip)) {
        activeLiveTripId = null;
        bgNotifySentForTrip = null;
        window._liveTripGpsWatchSince = null;
        stopBackgroundPulse();
        stopGpsHealthWatch();
        await releaseTripWakeLock();
        updateStatusPill(null);
        // Bajar de tripMode a sesión normal
        try {
            const online = window.userProfile?.role === 'driver' && window.driverLocationWatchId != null;
            if (online) {
                const { startAndroidSessionKeepalive } = await import('./session-keepalive.js');
                await startAndroidSessionKeepalive({ driverMode: true, tripMode: false });
            }
        } catch (_) {}
        return;
    }

    const tripChanged = activeLiveTripId !== trip.id;
    activeLiveTripId = trip.id;
    if (tripChanged) {
        bgNotifySentForTrip = null;
        window._liveTripGpsWatchSince = Date.now();
    } else if (!window._liveTripGpsWatchSince) {
        window._liveTripGpsWatchSince = Date.now();
    }

    bindVisibility();
    await requestTripWakeLock();
    updateStatusPill(trip);
    startGpsHealthWatch();

    // Foreground service nativo: "Viaje en curso" (tipo LOCATION)
    syncAndroidLiveTripKeepaliveImpl(trip).catch(() => {});

    // Conductor: tracking de ubicación siempre en viaje
    if (trip.driverId && trip.driverId === window.currentUser?.uid) {
        window.startDriverLocationTracking?.().catch?.(() => {});
    }

    // Pulsos GPS (foreground y background)
    startBackgroundPulse();
    if (!document.hidden) {
        pulseGps('sync');
    }
}

/** Llamar desde el watch GPS del conductor cuando llega un fix o un error. */
export function notifyDriverGpsHealth(ok, err = null) {
    if (ok) {
        window._driverGpsOk = true;
        window._driverGpsError = null;
    } else {
        window._driverGpsOk = false;
        if (err) {
            window._driverGpsError = {
                code: err.code ?? err?.code ?? 2,
                message: err.message || err?.message || '',
                at: Date.now()
            };
        }
    }
    if (activeLiveTripId) updateStatusPill(currentTrip());
}

// Exponer para app.js sin import circular
if (typeof window !== 'undefined') {
    window.notifyDriverGpsHealth = notifyDriverGpsHealth;
    window.refreshLiveTripGpsPill = () => updateStatusPill(currentTrip());
}

export function isLiveTripKeepaliveActive() {
    return !!activeLiveTripId;
}
