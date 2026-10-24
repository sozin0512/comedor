import { isCapacitorNative, isCapacitorAndroid } from './capacitor-native.js';
import { getMessagingSwUrl } from './pwa-update.js';
import { registerPlugin } from './vendor/capacitor-core.js';

// Use relative path (works in dev servers and production)
const ICON = 'icons/icon-192.png';
const BADGE = 'icons/icon-192.png';

export const DEFAULT_VIBRATE = [100, 50, 100];
export const SUPER_FREIGHT_VIBRATE = [0, 280, 120, 280, 120, 280, 120, 500, 100, 700];
// Super for all trip offers (moto, delivery, carro) and staff alerts - strong and longer
export const SUPER_TRIP_OFFER_VIBRATE = [0, 300, 80, 300, 80, 400, 120, 600, 80, 800];
/** Demanda offline / “ponéte en línea” — patrón más largo y agresivo (HonduRaite). */
export const HONDU_RIDE_DEMAND_VIBRATE = [0, 450, 100, 450, 100, 550, 120, 750, 100, 950, 150, 450];

let swRegistration = null;

function settleWithTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const timer = setTimeout(() => finish(fallback), ms);
        Promise.resolve(promise).then(
            (value) => { clearTimeout(timer); finish(value); },
            () => { clearTimeout(timer); finish(fallback); }
        );
    });
}

export function isNotificationSupported() {
    if (typeof window === 'undefined') return false;
    if (isCapacitorAndroid()) return true;
    return 'Notification' in window && 'serviceWorker' in navigator;
}

/** En APK, Notification.permission del WebView miente (casi siempre "denied"). */
let androidNativePermission = null;
/** Tras Permitir, S24 y TCL siguen diciendo "apagado" un rato. No dejar que eso borre el permiso. */
let androidGrantHoldUntil = 0;

export function holdAndroidNotificationGrant(ms = 90000) {
    androidGrantHoldUntil = Date.now() + ms;
    androidNativePermission = 'granted';
}

export function androidNotificationGrantHeld() {
    return Date.now() < androidGrantHoldUntil;
}

export function setAndroidNotificationPermissionCache(state) {
    if (state !== 'granted' && androidNotificationGrantHeld()) return;
    if (state === 'granted' || state === 'denied' || state === 'default') {
        androidNativePermission = state;
        // Permiso ≠ token. honduber_push_enabled solo cuando el FCM ya quedó.
    }
}

function hasStoredPushToken() {
    try {
        if (localStorage.getItem('honduber_push_token_ok') === '1') return true;
        if (localStorage.getItem('honduber_fcm_token_last')) return true;
    } catch (_) {}
    return false;
}

export function getNotificationPermission() {
    if (!isNotificationSupported()) return 'unsupported';
    if (isCapacitorAndroid()) {
        // Token FCM en este teléfono = ya hubo permiso. El WebView/Capacitor
        // a veces deja "denied" o "prompt" aunque el sistema sí deja avisos.
        if (androidNativePermission === 'granted') return 'granted';
        if (androidNativePermission === 'denied') return 'denied';
        if (hasStoredPushToken()) return 'granted';
        return androidNativePermission || 'default';
    }
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
}

/** Solo web/PWA: registra el service worker de mensajería. APK Android usa push nativo. */
export async function initTripNotifications() {
    if (isCapacitorNative()) return false;
    if (!isNotificationSupported()) return false;

    try {
        const swUrl = getMessagingSwUrl(import.meta.url);
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((reg) => {
                const url = String(reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '');
                const path = url.split('?')[0];
                // No tocar firebase-messaging-sw.js: en iPhone desregistrarlo revoca el permiso.
                if (/\/firebase-messaging-sw\.js$/i.test(path)) return Promise.resolve(false);
                if (/\/sw\.js$/i.test(path)) return reg.unregister().catch(() => false);
                return Promise.resolve(false);
            }));
        } catch (_) {}
        swRegistration = await navigator.serviceWorker.register(swUrl, { scope: '/' });
        try { swRegistration.waiting?.postMessage?.({ type: 'SKIP_WAITING' }); } catch (_) {}
        try { swRegistration.installing?.postMessage?.({ type: 'SKIP_WAITING' }); } catch (_) {}
        const readyMs = /iP(hone|ad|od)/i.test(navigator.userAgent || '') ? 15000 : 4000;
        await settleWithTimeout(navigator.serviceWorker.ready, readyMs, swRegistration);
        return true;
    } catch (e) {
        console.warn('initTripNotifications:', e);
        return false;
    }
}

export async function requestTripNotificationPermission() {
    if (!isNotificationSupported()) return 'unsupported';

    if (isCapacitorAndroid()) {
        try {
            const { requestAndroidTemuNotificationPermissions } = await import('./fcm-push.js?v=2026.10.24.1');
            const temu = await requestAndroidTemuNotificationPermissions({
                requestFullScreen: false,
                requestBattery: false,
                requestLocal: false
            });
            const pushState = temu.push === 'granted'
                ? 'granted'
                : (temu.push === 'denied' ? 'denied' : 'default');
            setAndroidNotificationPermissionCache(pushState);
            // Un solo diálogo. Pedirlo otra vez lo cierra antes del toque.
            return pushState;
        } catch (e) {
            console.warn('requestTripNotificationPermission (android):', e);
            return 'unsupported';
        }
    }

    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    const perm = await settleWithTimeout(
        Notification.requestPermission(),
        45000,
        Notification.permission || 'default'
    );
    return perm || Notification.permission || 'default';
}

export function shouldNotifyInBackground() {
    return document.hidden || !document.hasFocus();
}

export function triggerVibration(pattern = DEFAULT_VIBRATE) {
    try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(0);
            navigator.vibrate(pattern);
            return true;
        }
    } catch (_) {}
    return false;
}

export function triggerSuperFreightVibration() {
    triggerVibration(SUPER_FREIGHT_VIBRATE);
}

export function triggerSuperTripVibration() {
    triggerVibration(SUPER_TRIP_OFFER_VIBRATE);
}

/**
 * Web/iOS: notificaciones del sistema (página visible).
 * En iPhone el aviso fuera de la app lo pinta el service worker (firebase-messaging-sw.js).
 */
export async function showTripNotification({
    title,
    body,
    tag,
    tripId,
    openChat = false,
    openNotifications = false,
    vibrate = DEFAULT_VIBRATE,
    /** true = tono del sistema (imprescindible iOS/web en background) */
    systemSound = false,
    requireInteraction = false
}) {
    if (isCapacitorAndroid()) return false;
    if (!isNotificationSupported() || Notification.permission !== 'granted') return false;
    if (!title || !body) return false;

    const tagStr = String(tag || '');
    // Ofertas de carrera / demanda: SIEMPRE con sonido de sistema en web/iOS
    const isRideAlert = systemSound
        || tagStr.startsWith('trip-offer-')
        || tagStr.startsWith('ride-demand-')
        || tagStr.startsWith('trip-price-boost-')
        || tagStr.startsWith('freight-alert-')
        || tagStr.startsWith('staff-trip-')
        || tagStr.startsWith('push-test-')
        || tagStr.startsWith('trip-offer-city-');

    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
    const isIOSDevice = /iPad|iPhone|iPod/i.test(ua)
        || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);

    const options = {
        body: String(body).slice(0, 180),
        icon: ICON,
        badge: BADGE,
        tag: tag || 'honduber-trip',
        data: {
            tripId: tripId || null,
            openChat: !!openChat,
            openNotifications: !!openNotifications || (!openChat && String(tag || '').startsWith('fcm-admin')),
            openDriver: isRideAlert ? true : false
        }
    };
    // iOS: vibrate/renotify/requireInteraction hacen fallar showNotification y Safari revoca el push
    if (!isIOSDevice) {
        options.renotify = true;
        options.silent = !isRideAlert;
        options.requireInteraction = !!requireInteraction || isRideAlert;
        options.vibrate = vibrate;
    }

    try {
        const reg = swRegistration || await navigator.serviceWorker.ready;
        await reg.showNotification(title, options);
        return true;
    } catch (e) {
        try {
            await (swRegistration || await navigator.serviceWorker.ready).showNotification(title, {
                body: options.body,
                icon: ICON,
                badge: BADGE,
                tag: options.tag,
                data: options.data
            });
            return true;
        } catch (_) {
            try {
                new Notification(title, { body: options.body, icon: ICON });
                return true;
            } catch (err) {
                return false;
            }
        }
    }
}

/**
 * Sonido propio de la app (Web Audio + archivos HonduRaite).
 * En Safari hay que desbloquear audio con un toque; si está bloqueado se encola.
 * sound: 'none' | 'chat' | 'driver' | 'staff' | 'freight' | 'deposit' | 'ride_demand' | 'default' | eventId
 */
function playEventSound(sound = 'default', tag = '', extra = {}) {
    if (sound === 'none') return;
    // trip-offer- ya dispara playDriverTripOfferSound en el listener de ofertas
    if (String(tag || '').startsWith('trip-offer-') && sound === 'default') return;
    try {
        // Reactivar Safari antes de cada toque de notificación
        try { window.unlockNotificationTones?.(); } catch (_) {}
        if (typeof window.playEventNotificationTone === 'function') {
            const map = {
                default: 'general',
                chat: 'chat',
                driver: 'driver_offer',
                staff: 'staff_trip',
                freight: 'freight',
                deposit: 'deposit',
                ride_demand: 'ride_demand',
                general: 'general'
            };
            const eventId = map[sound] || sound || 'general';
            const ok = window.playEventNotificationTone(eventId);
            // Reintento Safari (resume async del AudioContext)
            if (!ok) {
                setTimeout(() => {
                    try { window.playEventNotificationTone?.(eventId); } catch (_) {}
                }, 180);
                setTimeout(() => {
                    try { window.playEventNotificationTone?.(eventId); } catch (_) {}
                }, 500);
            }
            return;
        }
        if (sound === 'chat') window.playChatSound?.();
        else if (sound === 'driver') window.playDriverTripOfferSound?.();
        else if (sound === 'staff') window.playStaffTripAlertSound?.();
        else if (sound === 'freight') window.playFreightAlertSound?.();
        else if (sound === 'deposit') window.playDepositAlertSound?.();
        else window.playNotificationSound?.();
    } catch (_) {}
}

export async function notifyChatMessage({ senderName, text, tripId, force = false, playSound = true }) {
    const chatHidden = !window.chatOpen;
    const inBackground = shouldNotifyInBackground();
    if (!force && !inBackground && !chatHidden) return false;

    const shown = await showTripNotification({
        title: senderName || 'Nuevo mensaje',
        body: text,
        tag: `chat-${tripId}`,
        tripId,
        openChat: true
    });

    // Si el tono ya se reprodujo en FCM (playConfiguredToneFromPush), pasar playSound: false
    if ((force || inBackground) && playSound) {
        playEventSound('chat', `chat-${tripId}`);
    }

    return shown;
}

export async function notifySuperDemandAlert({
    title,
    body,
    tag,
    tripId,
    force = true,
    vibrate = SUPER_FREIGHT_VIBRATE,
    sound = 'default'
}) {
    if (!title || !body) return false;
    triggerVibration(vibrate);
    const shown = await showTripNotification({
        title,
        body,
        tag: tag || `demand-alert-${tripId || 'x'}`,
        tripId,
        vibrate
    });
    if (force && sound && sound !== 'none') {
        if (sound === 'driver') {
            try { window.playDriverTripOfferSound?.(); } catch (_) {}
        } else {
            playEventSound(sound, tag);
        }
    }
    return shown;
}

export async function notifyFreightTripAlert(args) {
    return notifySuperDemandAlert({
        vibrate: SUPER_FREIGHT_VIBRATE,
        sound: 'freight',
        ...args
    });
}

/** VIP / taxi / moto / envío: avisar a conductores fuera de línea para que se activen. */
export async function notifyRideDemandAlert(args) {
    return notifySuperDemandAlert({
        vibrate: HONDU_RIDE_DEMAND_VIBRATE,
        sound: 'ride_demand',
        ...args
    });
}

export async function notifyTripEvent({
    title,
    body,
    tag,
    tripId,
    openChat = false,
    force = false,
    sound = 'default',
    superVibrate = false,
    systemSound = false
}) {
    if (!title || !body) return false;

    const inBackground = shouldNotifyInBackground();
    const tagStr = String(tag || '');
    const isRideAlert = systemSound
        || tagStr.startsWith('trip-offer-')
        || tagStr.startsWith('ride-demand-')
        || tagStr.startsWith('trip-price-boost-');
    const dedupKey = `trip-event:${tripId || 'global'}:${tag || title}`;
    const now = Date.now();
    const cache = window.__tripNotificationDedup || (window.__tripNotificationDedup = new Map());
    const last = cache.get(dedupKey);
    // Ofertas: dedup más corto para no tragarse renotifies de rotación
    const dedupMs = isRideAlert ? 1200 : 2000;
    if (last && now - last < dedupMs) return false;
    cache.set(dedupKey, now);

    let shown = false;

    if (superVibrate) triggerSuperTripVibration();

    // Ofertas / force / background: SIEMPRE banner del sistema (web/iOS)
    if (force || inBackground || isRideAlert) {
        shown = await showTripNotification({
            title,
            body,
            tag,
            tripId,
            openChat,
            vibrate: superVibrate ? SUPER_TRIP_OFFER_VIBRATE : DEFAULT_VIBRATE,
            systemSound: isRideAlert || systemSound,
            requireInteraction: isRideAlert
        });
    }

    // HonduRaite custom: siempre intentar en primer plano.
    // En background Safari mutea Web Audio → el banner usa silent:false (tono sistema).
    // Al volver a la app se reproduce el tono Hondu pendiente (cola en notification-tones).
    if (sound && sound !== 'none') {
        if (!inBackground) {
            playEventSound(sound, tag);
        } else {
            // Guardar para cuando el usuario vuelva / toque el aviso
            try {
                window.__hrPendingNotifTone = {
                    sound,
                    tag,
                    at: Date.now()
                };
            } catch (_) {}
        }
    } else if (isRideAlert && !inBackground && sound === 'none') {
        try { window.playDriverTripOfferSound?.(); } catch (_) {}
    }

    return shown || !inBackground;
}

export async function notifyStaffNewTripAlert({ title, body, tag, tripId, force = true, sound = 'staff' }) {
    if (!title || !body) return false;
    triggerSuperTripVibration();
    // sound: 'none' si el tono ya se reprodujo (evita general/doble tono)
    if (sound && sound !== 'none') {
        try { playEventSound(sound, tag || `staff-trip-${tripId || 'x'}`); } catch (_) {}
    }
    const shown = await showTripNotification({
        title,
        body,
        tag: tag || `staff-trip-${tripId || 'x'}`,
        tripId,
        vibrate: SUPER_TRIP_OFFER_VIBRATE
    });
    return shown;
}