/**
 * Mantiene GPS y tracking lo más activo posible durante viajes en curso.
 * Los navegadores limitan geolocalización en pestañas ocultas; esto mitiga el retraso
 * con Wake Lock, pulsos de respaldo y sincronización al volver a primer plano.
 */

const LIVE_STATUSES = new Set(['accepted', 'in_progress']);

let wakeLock = null;
let bgPulseTimer = null;
let visibilityBound = false;
let activeLiveTripId = null;
let bgNotifySentForTrip = null;
let pulseHandler = null;
let statusEl = null;

function isLiveTrip(trip) {
    if (!trip?.id || !LIVE_STATUSES.has(trip.status)) return false;
    return true;
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
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.className = 'live-trip-gps-pill hidden';
    statusEl.innerHTML = '<i class="fas fa-location-crosshairs" aria-hidden="true"></i><span></span>';
    document.body.appendChild(statusEl);
    return statusEl;
}

function updateStatusPill(trip, wakeOk) {
    const el = ensureStatusPill();
    if (!trip || !isLiveTrip(trip)) {
        el.classList.add('hidden');
        return;
    }
    const span = el.querySelector('span');
    if (document.hidden) {
        span.textContent = 'Viaje activo — vuelve a HonduRaite para GPS en vivo';
        el.classList.remove('hidden', 'live-trip-gps-pill--ok');
        el.classList.add('live-trip-gps-pill--warn');
    } else if (wakeOk) {
        span.textContent = 'GPS activo · pantalla encendida';
        el.classList.remove('hidden', 'live-trip-gps-pill--warn');
        el.classList.add('live-trip-gps-pill--ok');
    } else {
        span.textContent = 'Viaje activo — no bloquees la pantalla';
        el.classList.remove('hidden', 'live-trip-gps-pill--ok');
        el.classList.add('live-trip-gps-pill--warn');
    }
}

function pulseGps(reason = 'interval') {
    if (!activeLiveTripId || typeof pulseHandler !== 'function') return;
    try {
        pulseHandler({ reason, tripId: activeLiveTripId, hidden: document.hidden });
    } catch (_) {}
}

function startBackgroundPulse() {
    if (bgPulseTimer) return;
    const ms = document.hidden ? 4500 : 12000;
    bgPulseTimer = setInterval(() => pulseGps('background'), ms);
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
        const wakeOk = await requestTripWakeLock();
        updateStatusPill(trip, wakeOk);
        pulseGps('visible');
        window.__liveTripRepaintPassenger?.();
    } else {
        startBackgroundPulse();
        updateStatusPill(trip, false);
        if (bgNotifySentForTrip !== activeLiveTripId) {
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
        stopBackgroundPulse();
        await releaseTripWakeLock();
        updateStatusPill(null, false);
        return;
    }

    const tripChanged = activeLiveTripId !== trip.id;
    activeLiveTripId = trip.id;
    if (tripChanged) bgNotifySentForTrip = null;

    bindVisibility();
    const wakeOk = await requestTripWakeLock();
    updateStatusPill(trip, wakeOk);

    if (document.hidden) {
        startBackgroundPulse();
    } else {
        stopBackgroundPulse();
        pulseGps('sync');
    }
}

export function isLiveTripKeepaliveActive() {
    return !!activeLiveTripId;
}