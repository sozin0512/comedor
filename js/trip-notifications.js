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

export function isNotificationSupported() {
    if (typeof window === 'undefined') return false;
    if (isCapacitorAndroid()) return true;
    return 'Notification' in window && 'serviceWorker' in navigator;
}

export function getNotificationPermission() {
    if (!isNotificationSupported()) return 'unsupported';
    if (isCapacitorAndroid()) {
        if (localStorage.getItem('honduber_push_enabled') === '1') return 'granted';
        if (typeof Notification !== 'undefined') return Notification.permission;
        return 'default';
    }
    return Notification.permission;
}

/** Solo web/PWA: registra el service worker de mensajería. APK Android usa push nativo. */
export async function initTripNotifications() {
    if (isCapacitorNative()) return false;
    if (!isNotificationSupported()) return false;

    try {
        const swUrl = getMessagingSwUrl(import.meta.url);
        swRegistration = await navigator.serviceWorker.register(swUrl);
        await navigator.serviceWorker.ready;
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
            const PushNotifications = registerPlugin('PushNotifications');
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive === 'prompt') {
                perm = await PushNotifications.requestPermissions();
            }
            if (perm.receive === 'granted') return 'granted';
            if (perm.receive === 'denied') return 'denied';
            return 'default';
        } catch (e) {
            console.warn('requestTripNotificationPermission (android):', e);
            return 'unsupported';
        }
    }

    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return Notification.requestPermission();
}

export function shouldNotifyInBackground() {
    return document.hidden || !document.hasFocus();
}

export function triggerSuperFreightVibration() {
    try { navigator.vibrate?.(SUPER_FREIGHT_VIBRATE); } catch (_) {}
}

export function triggerSuperTripVibration() {
    try { navigator.vibrate?.(SUPER_TRIP_OFFER_VIBRATE); } catch (_) {}
}

export async function showTripNotification({
    title,
    body,
    tag,
    tripId,
    openChat = false,
    openNotifications = false,
    vibrate = DEFAULT_VIBRATE
}) {
    if (isCapacitorAndroid()) return false;
    if (!isNotificationSupported() || Notification.permission !== 'granted') return false;
    if (!title || !body) return false;

    const options = {
        body: String(body).slice(0, 180),
        icon: ICON,
        badge: BADGE,
        tag: tag || 'honduber-trip',
        renotify: true,
        data: {
            tripId: tripId || null,
            openChat: !!openChat,
            openNotifications: !!openNotifications || (!openChat && String(tag || '').startsWith('fcm-admin'))
        },
        vibrate
    };

    try {
        const reg = swRegistration || await navigator.serviceWorker.ready;
        await reg.showNotification(title, options);
        return true;
    } catch (e) {
        try {
            new Notification(title, options);
            return true;
        } catch (_) {
            return false;
        }
    }
}

function playEventSound(sound = 'default', tag = '') {
    if (sound === 'none' || String(tag || '').startsWith('trip-offer-')) return;
    try {
        if (sound === 'chat') {
            window.playChatSound?.();
        } else {
            window.playNotificationSound?.();
        }
    } catch (_) {}
}

export async function notifyChatMessage({ senderName, text, tripId, force = false }) {
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

    if (force || inBackground) {
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
    try { navigator.vibrate?.(vibrate); } catch (_) {}
    const shown = await showTripNotification({
        title,
        body,
        tag: tag || `demand-alert-${tripId || 'x'}`,
        tripId,
        vibrate
    });
    if (force) {
        if (sound === 'driver') {
            try { window.playDriverTripOfferSound?.(); } catch (_) {}
        } else {
            playEventSound(sound, tag);
        }
    }
    return shown;
}

export async function notifyFreightTripAlert(args) {
    return notifySuperDemandAlert({ ...args, vibrate: SUPER_FREIGHT_VIBRATE, sound: 'default' });
}

/** VIP / taxi / moto / envío: avisar a conductores fuera de línea para que se activen. */
export async function notifyRideDemandAlert(args) {
    return notifySuperDemandAlert({
        ...args,
        vibrate: HONDU_RIDE_DEMAND_VIBRATE,
        sound: 'driver'
    });
}

export async function notifyTripEvent({ title, body, tag, tripId, openChat = false, force = false, sound = 'default', superVibrate = false }) {
    if (!title || !body) return false;

    const inBackground = shouldNotifyInBackground();
    let shown = false;

    if (superVibrate) triggerSuperTripVibration();

    if (force || inBackground) {
        shown = await showTripNotification({
            title,
            body,
            tag,
            tripId,
            openChat,
            vibrate: superVibrate ? SUPER_TRIP_OFFER_VIBRATE : DEFAULT_VIBRATE
        });
    }

    playEventSound(sound, tag);

    return shown || !inBackground;
}

export async function notifyStaffNewTripAlert({ title, body, tag, tripId, force = true }) {
    if (!title || !body) return false;
    triggerSuperTripVibration();
    try { window.playStaffTripAlertSound?.(); } catch (_) {}
    const shown = await showTripNotification({
        title,
        body,
        tag: tag || `staff-trip-${tripId || 'x'}`,
        tripId,
        vibrate: SUPER_TRIP_OFFER_VIBRATE
    });
    return shown;
}