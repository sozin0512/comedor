/**
 * Dos avisos locales, una vez cada uno:
 * cerca del cliente (PIN) y cerca del destino (finalizar).
 *
 * Usa lo que el APK publicado ya trae: @capacitor/local-notifications.
 * En la web, Notification del navegador. El toque enfoca el viaje.
 *
 * Con Waze o Maps al frente, el WebView del APK actual se pausa y este JS
 * deja de ver el GPS. Ahí el aviso no puede salir sin código nativo nuevo.
 */
import {
    driverStageTargetFromWindow, arrivalStageKey, arrivalNoticeCopy, isNearStage
} from './driver-external-nav.js';

const fired = new Set();

function remember(key) {
    fired.add(key);
    try { sessionStorage.setItem(`hr_arrived_${key}`, '1'); } catch (_) {}
}

function alreadyFired(key) {
    if (fired.has(key)) return true;
    try {
        if (sessionStorage.getItem(`hr_arrived_${key}`) === '1') {
            fired.add(key);
            return true;
        }
    } catch (_) {}
    return false;
}

async function showNotice(copy, key, tripId) {
    const tag = `hr-arrival-${key}`.slice(0, 80);
    const data = { type: 'driver_arrival', tag, tripId: tripId || '', openDriver: true };
    try {
        const cap = window.Capacitor;
        const local = cap?.Plugins?.LocalNotifications;
        if (cap?.isNativePlatform?.() && local?.schedule) {
            const id = Math.abs(hashCode(key)) % 80000 + 10000;
            await local.schedule({
                notifications: [{
                    id,
                    title: copy.title,
                    body: copy.body,
                    sound: 'hondu_iconic',
                    channelId: 'hondu_wa_alert_v10',
                    smallIcon: 'ic_launcher',
                    extra: data
                }]
            });
            return true;
        }
    } catch (e) {
        console.warn('arrival local notification:', e);
    }
    try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const n = new Notification(copy.title, {
                body: copy.body,
                tag,
                renotify: true,
                data
            });
            n.onclick = () => {
                try { window.focus(); } catch (_) {}
                n.close();
            };
            return true;
        }
    } catch (e) {
        console.warn('arrival notification:', e);
    }
    return false;
}

function hashCode(text) {
    let h = 0;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
}

export async function maybeAnnounceDriverArrival(pos, trip) {
    if (!pos || !trip?.id) return false;
    if (typeof document !== 'undefined' && !document.hidden) return false;
    const stage = driverStageTargetFromWindow(trip);
    if (!isNearStage(pos, stage, pos.accuracy)) return false;
    const key = arrivalStageKey(trip, stage);
    if (!key || alreadyFired(key)) return false;
    const copy = arrivalNoticeCopy(stage);
    if (!copy) return false;
    const shown = await showNotice(copy, key, trip.id);
    if (shown) remember(key);
    return shown;
}

if (typeof window !== 'undefined') {
    window.maybeAnnounceDriverArrival = maybeAnnounceDriverArrival;
}
