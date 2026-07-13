import { registerPlugin } from './vendor/capacitor-core.js';
import { isCapacitorAndroid } from './capacitor-native.js';
import { isPwaInstalled } from './pwa-install.js';

const SessionKeepalive = registerPlugin('SessionKeepalive');

let overlayPrompted = false;
let batteryPrompted = false;
let backgroundTipShown = false;

async function ensureOverlayPermission() {
    if (!isCapacitorAndroid()) return;
    try {
        const { granted } = await SessionKeepalive.hasOverlayPermission();
        if (granted || overlayPrompted) return;
        overlayPrompted = true;
        window.showToast?.(
            'Activa "Mostrar sobre otras apps" para ver la burbuja de HonduRaite al minimizar.',
            'warning'
        );
        await SessionKeepalive.requestOverlayPermission();
    } catch (_) {}
}

async function ensureBatteryExemption(driverMode = false) {
    if (!isCapacitorAndroid() || !driverMode) return;
    try {
        const { granted } = await SessionKeepalive.hasBatteryExemption();
        if (granted || batteryPrompted) return;
        batteryPrompted = true;
        window.showToast?.(
            'Para seguir en línea al cambiar de app, desactiva la optimización de batería de HonduRaite.',
            'warning'
        );
        await SessionKeepalive.requestBatteryExemption();
    } catch (_) {}
}

export async function startAndroidSessionKeepalive(options = {}) {
    if (!isCapacitorAndroid()) return;
    const {
        driverMode = false,
        tripMode = false,
        title,
        body,
    } = options;

    const resolvedTitle = title
        || (tripMode ? 'Viaje en curso · HonduRaite' : 'HonduRaite activo');
    const resolvedBody = body || (
        tripMode
            ? (driverMode
                ? 'Ubicación en vivo. No cierres la app. Toca para volver.'
                : 'Tu viaje sigue activo. Toca para ver el mapa.')
            : (driverMode
                ? 'Conductor en línea. Tu sesión sigue activa.'
                : 'Tu sesión sigue abierta. Toca para volver a la app.')
    );

    try {
        await SessionKeepalive.start({
            title: resolvedTitle,
            body: resolvedBody,
            driverMode: !!(driverMode || tripMode),
            tripMode: !!tripMode,
        });
        await ensureOverlayPermission();
        await ensureBatteryExemption(!!(driverMode || tripMode));
    } catch (err) {
        console.warn('session-keepalive start:', err);
    }
}

/**
 * Modo Uber: durante accepted/in_progress fuerza servicio foreground de viaje
 * con GPS (LOCATION) y texto "Viaje en curso".
 */
export async function syncAndroidLiveTripKeepalive(trip, roleHint = null) {
    if (!isCapacitorAndroid()) return false;
    const live = trip?.id && ['accepted', 'in_progress'].includes(trip.status);
    const role = roleHint || window.userProfile?.role || '';
    const isDriver = role === 'driver' || trip?.driverId === window.currentUser?.uid;
    const isPassenger = role === 'client' || trip?.clientId === window.currentUser?.uid;

    if (!live || (!isDriver && !isPassenger)) {
        // Volver a keepalive normal si el conductor sigue en línea
        const online = window.driverLocationWatchId != null && role === 'driver';
        if (online) {
            await startAndroidSessionKeepalive({ driverMode: true, tripMode: false });
        }
        return false;
    }

    const phaseLabel = trip.status === 'in_progress'
        ? (isDriver ? 'Hacia el destino' : 'Viaje en curso')
        : (isDriver ? 'En camino al pasajero' : 'Conductor en camino');

    await startAndroidSessionKeepalive({
        driverMode: isDriver || true, // LOCATION type for both during live trip
        tripMode: true,
        title: 'Viaje en curso · HonduRaite',
        body: isDriver
            ? `${phaseLabel}. GPS en vivo — no cierres la app.`
            : `${phaseLabel}. Toca para volver al mapa.`,
    });

    // Conductor: asegurar tracking GPS
    if (isDriver && typeof window.startDriverLocationTracking === 'function') {
        try {
            await window.startDriverLocationTracking();
        } catch (_) {}
    }
    return true;
}

export async function ensureAndroidSessionKeepalive(options = {}) {
    if (!isCapacitorAndroid()) return;
    const driverMode = options.driverMode
        ?? (window.userProfile?.role === 'driver' && window.driverLocationWatchId != null);
    const tripMode = !!options.tripMode;
    try {
        const state = await SessionKeepalive.isActive();
        const needTrip = tripMode && !state?.tripMode;
        const needStart = !state?.active || needTrip;
        if (needStart) {
            await startAndroidSessionKeepalive({ ...options, driverMode, tripMode });
        }
    } catch (_) {
        await startAndroidSessionKeepalive({ ...options, driverMode, tripMode });
    }
}

export async function stopAndroidSessionKeepalive() {
    if (!isCapacitorAndroid()) return;
    try {
        await SessionKeepalive.stop();
    } catch (err) {
        console.warn('session-keepalive stop:', err);
    }
}

export async function syncDriverSessionKeepalive(isDriverOnline) {
    if (!isCapacitorAndroid()) return;
    // Si hay viaje vivo, no bajar de tripMode
    const trip = window.currentActiveTripData;
    if (trip?.id && ['accepted', 'in_progress'].includes(trip.status)
        && (trip.driverId === window.currentUser?.uid || window.userProfile?.role === 'driver')) {
        await syncAndroidLiveTripKeepalive(trip, 'driver');
        return;
    }
    if (isDriverOnline) {
        await startAndroidSessionKeepalive({ driverMode: true, tripMode: false });
    } else {
        await startAndroidSessionKeepalive({ driverMode: false, tripMode: false });
    }
}

function statusBadge(ok) {
    return ok
        ? '<span class="text-emerald-700 font-black text-xs"><i class="fas fa-check-circle"></i> Listo</span>'
        : '<span class="text-amber-700 font-black text-xs"><i class="fas fa-exclamation-circle"></i> Pendiente</span>';
}

function detectBackgroundPlatform() {
    if (isCapacitorAndroid()) return 'android-apk';
    if (isPwaInstalled()) return 'pwa';
    return 'web';
}

export async function getBackgroundModeStatus() {
    const platform = detectBackgroundPlatform();
    if (platform !== 'android-apk') {
        return {
            supported: false,
            platform,
            pwa: platform === 'pwa',
            notifications: typeof Notification !== 'undefined' && Notification.permission === 'granted',
            sessionPersistent: true,
        };
    }
    try {
        const [overlay, battery, keepalive] = await Promise.all([
            SessionKeepalive.hasOverlayPermission(),
            SessionKeepalive.hasBatteryExemption(),
            SessionKeepalive.isActive(),
        ]);
        return {
            supported: true,
            platform: 'android',
            overlay: !!overlay?.granted,
            battery: !!battery?.granted,
            keepalive: !!keepalive?.active,
            driverOnline: window.driverLocationWatchId != null,
            notifications: typeof Notification !== 'undefined' && Notification.permission === 'granted',
        };
    } catch (_) {
        return {
            supported: true,
            platform: 'android',
            overlay: false,
            battery: false,
            keepalive: false,
            driverOnline: window.driverLocationWatchId != null,
            notifications: false,
        };
    }
}

function closeDriverBackgroundModeModal() {
    document.querySelector('[data-driver-bg-modal]')?.remove();
    if (window._driverBgModalVisHandler) {
        document.removeEventListener('visibilitychange', window._driverBgModalVisHandler);
        window._driverBgModalVisHandler = null;
    }
}

async function refreshDriverBackgroundModeModal() {
    const open = document.querySelector('[data-driver-bg-modal]');
    if (!open) return;
    closeDriverBackgroundModeModal();
    await showDriverBackgroundModeModal();
}

export async function showDriverBackgroundModeModal() {
    closeDriverBackgroundModeModal();
    const status = await getBackgroundModeStatus();

    const modal = document.createElement('div');
    modal.dataset.driverBgModal = '1';
    modal.className = 'fixed inset-0 bg-black/70 z-[45000] flex items-center justify-center p-4';

    if (!status.supported) {
        const isPwa = status.platform === 'pwa';
        modal.innerHTML = `
            <div class="bg-white rounded-3xl w-full max-w-md p-6 max-h-[92dvh] overflow-y-auto">
                <div class="text-center mb-4">
                    <div class="w-14 h-14 mx-auto mb-3 rounded-2xl ${isPwa ? 'bg-emerald-50' : 'bg-slate-50'} flex items-center justify-center text-3xl">
                        ${isPwa ? '📲' : '🌐'}
                    </div>
                    <h2 class="text-xl font-black text-gray-900">Modo segundo plano</h2>
                    <p class="text-gray-500 text-xs mt-1 leading-snug">
                        ${isPwa
                            ? 'Instalaste HonduRaite desde la web en la pantalla de inicio (PWA).'
                            : 'Estás usando HonduRaite en el navegador, sin instalar en la pantalla de inicio.'}
                    </p>
                </div>

                <div class="space-y-2 mb-4">
                    <div class="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50">
                        <div class="min-w-0">
                            <p class="text-xs font-black text-gray-800">Sesión sin cerrar</p>
                            <p class="text-[10px] text-gray-500">Sigue activa al cambiar de app</p>
                        </div>
                        ${statusBadge(true)}
                    </div>
                    <div class="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50">
                        <div class="min-w-0">
                            <p class="text-xs font-black text-gray-800">Notificaciones</p>
                            <p class="text-[10px] text-gray-500">Viajes y mensajes minimizado</p>
                        </div>
                        ${statusBadge(status.notifications)}
                    </div>
                    <div class="flex items-center justify-between gap-3 p-3 rounded-2xl border border-amber-200 bg-amber-50">
                        <div class="min-w-0">
                            <p class="text-xs font-black text-amber-900">GPS en segundo plano</p>
                            <p class="text-[10px] text-amber-800">Limitado por el navegador / PWA</p>
                        </div>
                        <span class="text-amber-700 font-black text-xs"><i class="fas fa-minus-circle"></i> Parcial</span>
                    </div>
                    <div class="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50">
                        <div class="min-w-0">
                            <p class="text-xs font-black text-gray-800">Burbuja y servicio nativo</p>
                            <p class="text-[10px] text-gray-500">Solo en la APK de Android</p>
                        </div>
                        <span class="text-slate-500 font-black text-xs">N/A</span>
                    </div>
                </div>

                <p class="text-gray-600 text-xs mb-4 leading-snug">
                    ${isPwa
                        ? 'La PWA <b>sí mantiene tu sesión</b> y puede enviarte notificaciones, pero <b>no puede</b> usar burbuja flotante ni GPS continuo como la APK. Para conducir todo el día en segundo plano, instala la app APK.'
                        : 'Instálala primero en la pantalla de inicio (menú del navegador → Instalar app) para mejor experiencia. Aun así, el GPS en vivo se limita fuera de la APK.'}
                </p>

                <div class="space-y-2">
                    ${!status.notifications ? `<button type="button" data-bg-action="notifications-web"
                        class="w-full py-3 rounded-2xl bg-violet-600 text-white text-sm font-black flex items-center justify-center gap-2">
                        <i class="fas fa-bell"></i><span>Activar notificaciones</span></button>` : ''}
                    ${isPwa ? '' : `<button type="button" data-bg-action="install"
                        class="w-full py-3 rounded-2xl bg-blue-600 text-white text-sm font-black flex items-center justify-center gap-2">
                        <i class="fas fa-download"></i><span>Cómo instalar en pantalla de inicio</span></button>`}
                    <button type="button" data-bg-action="close"
                        class="w-full py-3 rounded-2xl bg-slate-100 text-slate-700 text-sm font-black">Cerrar</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-bg-action]');
            if (!btn) return;
            const action = btn.dataset.bgAction;
            if (action === 'close') {
                closeDriverBackgroundModeModal();
                return;
            }
            if (action === 'notifications-web') {
                if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    try { await Notification.requestPermission(); } catch (_) {}
                    refreshDriverBackgroundModeModal().catch(() => {});
                } else {
                    window.showToast?.('Activa notificaciones en Ajustes → Apps → tu navegador → Notificaciones.', 'warning');
                }
            } else if (action === 'install') {
                window.showInstallFlow?.();
            }
        });
        return;
    }

    const allOk = status.keepalive && status.overlay && status.battery && status.notifications;

    modal.innerHTML = `
        <div class="bg-white rounded-3xl w-full max-w-md p-6 max-h-[92dvh] overflow-y-auto">
            <div class="text-center mb-4">
                <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-sky-50 flex items-center justify-center">
                    <i class="fas fa-layer-group text-2xl text-sky-600"></i>
                </div>
                <h2 class="text-xl font-black text-gray-900">Modo segundo plano</h2>
                <p class="text-gray-500 text-xs mt-1 leading-snug">
                    Mantén HonduRaite activo al cambiar de app. No cierres sesión ni deslices la app para cerrarla.
                </p>
            </div>

            <div class="space-y-2 mb-4">
                <div class="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50">
                    <div class="min-w-0">
                        <p class="text-xs font-black text-gray-800">Servicio activo</p>
                        <p class="text-[10px] text-gray-500">Notificación persistente en la barra</p>
                    </div>
                    ${statusBadge(status.keepalive)}
                </div>
                <div class="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50">
                    <div class="min-w-0">
                        <p class="text-xs font-black text-gray-800">Burbuja flotante</p>
                        <p class="text-[10px] text-gray-500">Volver rápido desde otras apps</p>
                    </div>
                    ${statusBadge(status.overlay)}
                </div>
                <div class="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50">
                    <div class="min-w-0">
                        <p class="text-xs font-black text-gray-800">Sin optimización de batería</p>
                        <p class="text-[10px] text-gray-500">Evita que Android pause la app</p>
                    </div>
                    ${statusBadge(status.battery)}
                </div>
                <div class="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50">
                    <div class="min-w-0">
                        <p class="text-xs font-black text-gray-800">Notificaciones</p>
                        <p class="text-[10px] text-gray-500">Viajes y mensajes con la app minimizada</p>
                    </div>
                    ${statusBadge(status.notifications)}
                </div>
            </div>

            ${allOk
                ? '<p class="text-emerald-700 text-xs font-bold text-center mb-4"><i class="fas fa-check"></i> Todo listo para trabajar en segundo plano</p>'
                : '<p class="text-amber-700 text-xs font-bold text-center mb-4">Completa los permisos pendientes</p>'}

            <div class="space-y-2">
                ${!status.overlay ? `<button type="button" data-bg-action="overlay"
                    class="w-full py-3 rounded-2xl bg-sky-600 text-white text-sm font-black flex items-center justify-center gap-2">
                    <i class="fas fa-circle-notch"></i><span>Activar burbuja flotante</span></button>` : ''}
                ${!status.battery ? `<button type="button" data-bg-action="battery"
                    class="w-full py-3 rounded-2xl bg-amber-500 text-white text-sm font-black flex items-center justify-center gap-2">
                    <i class="fas fa-battery-full"></i><span>Desactivar optimización de batería</span></button>` : ''}
                ${!status.notifications ? `<button type="button" data-bg-action="notifications"
                    class="w-full py-3 rounded-2xl bg-violet-600 text-white text-sm font-black flex items-center justify-center gap-2">
                    <i class="fas fa-bell"></i><span>Activar notificaciones</span></button>` : ''}
                ${!status.keepalive ? `<button type="button" data-bg-action="keepalive"
                    class="w-full py-3 rounded-2xl bg-emerald-600 text-white text-sm font-black flex items-center justify-center gap-2">
                    <i class="fas fa-play"></i><span>Reiniciar servicio en segundo plano</span></button>` : ''}
                <button type="button" data-bg-action="settings"
                    class="w-full py-3 rounded-2xl border border-slate-200 bg-white text-slate-800 text-sm font-black flex items-center justify-center gap-2">
                    <i class="fas fa-cog"></i><span>Ajustes de la app (ubicación y más)</span>
                </button>
                <button type="button" data-bg-action="close"
                    class="w-full py-3 rounded-2xl bg-slate-100 text-slate-700 text-sm font-black">Cerrar</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    modal.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-bg-action]');
        if (!btn) return;
        const action = btn.dataset.bgAction;
        if (action === 'close') {
            closeDriverBackgroundModeModal();
            return;
        }
        if (action === 'overlay') {
            await SessionKeepalive.requestOverlayPermission();
        } else if (action === 'battery') {
            await SessionKeepalive.requestBatteryExemption();
        } else if (action === 'notifications') {
            if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                try { await Notification.requestPermission(); } catch (_) {}
            } else {
                await SessionKeepalive.openNotificationSettings();
            }
        } else if (action === 'keepalive') {
            await startAndroidSessionKeepalive({
                driverMode: status.driverOnline || window.userProfile?.role === 'driver',
            });
        } else if (action === 'settings') {
            await SessionKeepalive.openAppSettings();
        }
    });

    window._driverBgModalVisHandler = () => {
        if (document.visibilityState === 'visible') {
            refreshDriverBackgroundModeModal().catch(() => {});
        }
    };
    document.addEventListener('visibilitychange', window._driverBgModalVisHandler);
}

export function bindSessionKeepaliveResume(isLoggedIn = () => false, getOptions = () => ({})) {
    if (!isCapacitorAndroid() || window._sessionKeepaliveResumeBound) return;
    window._sessionKeepaliveResumeBound = true;

    document.addEventListener('visibilitychange', () => {
        if (!isLoggedIn()) return;

        if (document.visibilityState === 'hidden') {
            if (!backgroundTipShown) {
                backgroundTipShown = true;
                window.showToast?.(
                    'HonduRaite sigue activo en segundo plano. No cierres sesión ni deslices la app para cerrarla.',
                    'info'
                );
            }
            return;
        }

        ensureAndroidSessionKeepalive(getOptions()).catch(() => {});
    });
}