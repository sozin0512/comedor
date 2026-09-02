import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { notifyChatMessage, notifyTripEvent, notifyFreightTripAlert, notifyRideDemandAlert, notifyStaffNewTripAlert } from './trip-notifications.js';
import { isCapacitorNative, isCapacitorAndroid } from './capacitor-native.js';
import { getMessagingSwUrl } from './pwa-update.js';
import { isIOS, isIosStandalonePwa, canReceiveBackgroundWebPush } from './pwa-install.js';
import { registerPlugin } from './vendor/capacitor-core.js';
import { APP_CONFIG } from './config.js';

let messagingInstance = null;
let androidPushInitialized = false;
let androidPushInitPromise = null;
let localNotifIdSeq = Math.floor(Date.now() % 100000);

const PushNotifications = registerPlugin('PushNotifications');
const LocalNotifications = registerPlugin('LocalNotifications');

/**
 * Canales Android — estilo WhatsApp (v9): tono icónico hondu_iconic + enciende pantalla.
 * Debe coincidir con HonduMessagingService.WA_CHANNEL_ID y functions/index.js
 * (Android no cambia el sound de un canal ya creado → hay que versionar el id)
 */
export const ANDROID_PUSH_CHANNEL_VERSION = 'v9';
export const HONDU_WA_ALERT_CHANNEL_ID = 'hondu_wa_alert_v9';
export const HONDU_TEMU_ALL_CHANNEL_ID = HONDU_WA_ALERT_CHANNEL_ID;
export const HONDU_RIDE_ALERT_CHANNEL_ID = HONDU_WA_ALERT_CHANNEL_ID;
export const HONDU_DEFAULT_CHANNEL_ID = HONDU_WA_ALERT_CHANNEL_ID;
// Misma importancia para banners locales en primer plano
const HONDU_FG_LOCAL_CHANNEL_ID = HONDU_WA_ALERT_CHANNEL_ID;
/** Archivo en android/app/src/main/res/raw/ (sin extensión en createChannel) */
export const HONDU_ICONIC_PUSH_SOUND = 'hondu_iconic';

/** Modos de sonido nativo (fuera de la app). Guardado en user.pushSoundMode */
export const PUSH_SOUND_MODES = [
    {
        id: 'temu',
        label: 'Tipo Temu / WhatsApp (recomendado)',
        desc: 'Tono icónico HonduRaite + vibra y enciende pantalla (aunque estés en otra app o bloqueado)'
    },
    {
        id: 'normal',
        label: 'Normal',
        desc: 'Mismo tono icónico; un poco menos insistente en la UI'
    },
    {
        id: 'soft',
        label: 'Suave',
        desc: 'Menos agresivo (puede pasar más desapercibido)'
    }
];

const PUSH_SOUND_MODE_KEY = 'honduber_push_sound_mode';

export function getLocalPushSoundMode() {
    try {
        const m = localStorage.getItem(PUSH_SOUND_MODE_KEY)
            || window.userProfile?.pushSoundMode
            || 'temu';
        if (m === 'soft' || m === 'normal' || m === 'temu') return m;
    } catch (_) {}
    return 'temu';
}

export function setLocalPushSoundMode(mode) {
    const m = mode === 'soft' || mode === 'normal' ? mode : 'temu';
    try { localStorage.setItem(PUSH_SOUND_MODE_KEY, m); } catch (_) {}
    return m;
}

export function isAndroidFcmConfigured() {
    return APP_CONFIG.androidFcmEnabled === true;
}

/** Todas las notificaciones se tratan como urgentes / heads-up Temu. */
function isRideAlertData(_data = {}) {
    return true;
}

/**
 * Canales nativos (app en otra app / cerrada).
 * Android 8+ solo usa el sound del canal; no el Web Audio de Personalización.
 */
export async function ensureAndroidPushChannels() {
    if (!isCapacitorAndroid()) return;

    // Canal estilo WhatsApp: HIGH/MAX + tono icónico + luz + vibración
    // El servicio nativo HonduMessagingService también lo crea y usa full-screen intent
    const waChannel = {
        id: HONDU_WA_ALERT_CHANNEL_ID,
        name: 'HonduRaite viajes (enciende pantalla)',
        description: 'Avisos de viaje: tono icónico HonduRaite + vibración. Encienden pantalla aunque estés en otra app.',
        importance: 5, // IMPORTANCE_MAX → heads-up
        visibility: 1, // public / lockscreen
        sound: HONDU_ICONIC_PUSH_SOUND,
        vibration: true,
        lights: true,
        lightColor: '#25D366'
    };

    for (const ch of [waChannel]) {
        try {
            await PushNotifications.createChannel(ch);
        } catch (e) {
            console.warn('[push] canal', ch.id, e);
        }
    }

    try {
        if (LocalNotifications?.createChannel) {
            await LocalNotifications.createChannel(waChannel);
        }
    } catch (e) {
        console.warn('[push] local channels:', e);
    }
}

/**
 * Prueba el sonido nativo de canal (como cuando estás en otra app).
 * mode: 'temu' | 'normal' | 'soft'
 */
export async function previewAndroidSystemPushSound(mode = 'temu') {
    if (!isCapacitorAndroid() || !LocalNotifications?.schedule) {
        return { ok: false, reason: 'android_only' };
    }
    await ensureAndroidPushChannels();
    const m = mode === 'soft' ? 'soft' : (mode === 'normal' ? 'normal' : 'temu');
    const channelId = HONDU_WA_ALERT_CHANNEL_ID;
    const sound = HONDU_ICONIC_PUSH_SOUND;
    localNotifIdSeq = (localNotifIdSeq + 1) % 900000;
    const id = 200000 + localNotifIdSeq;
    try {
        await LocalNotifications.schedule({
            notifications: [{
                id,
                title: m === 'temu' ? '🔊 Prueba tono icónico' : (m === 'soft' ? 'Prueba suave' : 'Prueba normal'),
                body: 'Así suena el aviso tipo WhatsApp (tono HonduRaite) si estás en otra app o bloqueado.',
                channelId,
                sound,
                smallIcon: 'ic_launcher',
                largeIcon: 'ic_launcher',
                extra: { type: 'sound_preview', tag: 'sound-preview' }
            }]
        });
        try {
            const pattern = m === 'soft'
                ? [0, 250, 100, 250]
                : [0, 450, 100, 450, 100, 550, 120, 750];
            navigator.vibrate?.(pattern);
        } catch (_) {}
        return { ok: true, channelId, sound };
    } catch (e) {
        console.warn('[push] preview sound:', e);
        return { ok: false, reason: e?.message || 'schedule_failed' };
    }
}

/**
 * Notificación local Android con canal correcto.
 * - Urgentes (viajes/staff/ofertas): canal WhatsApp + hondu_iconic → SIEMPRE suena
 *   (Web Audio a menudo está muteado hasta un toque del usuario).
 * - Generales: mismo tono icónico en APK.
 * - forceSilent: solo banner (cuando ya sonó Web Audio custom y no queremos doble).
 */
async function showAndroidForegroundLocalNotification(payload = {}, { forceSilent = false } = {}) {
    if (!isCapacitorAndroid() || !LocalNotifications?.schedule) return false;

    const data = payload.data || payload.notification?.data || {};
    const title = payload.notification?.title
        || data.title
        || payload.title
        || 'HonduRaite';
    const body = payload.notification?.body
        || data.body
        || payload.body
        || '';
    if (!title && !body) return false;

    await ensureAndroidPushChannels();

    // Siempre canal WhatsApp + tono icónico (salvo forceSilent)
    let channelId = HONDU_TEMU_ALL_CHANNEL_ID;
    let sound = forceSilent ? null : HONDU_ICONIC_PUSH_SOUND;
    if (forceSilent) {
        channelId = HONDU_TEMU_ALL_CHANNEL_ID;
    }

    localNotifIdSeq = (localNotifIdSeq + 1) % 900000;
    const id = 100000 + localNotifIdSeq;

    try {
        await LocalNotifications.schedule({
            notifications: [{
                id,
                title: String(title).slice(0, 80),
                body: String(body).slice(0, 180),
                channelId,
                sound,
                smallIcon: 'ic_launcher',
                largeIcon: 'ic_launcher',
                extra: {
                    ...Object.fromEntries(
                        Object.entries(data || {}).map(([k, v]) => [k, String(v ?? '')])
                    ),
                    title: String(title),
                    body: String(body)
                }
            }]
        });
        return true;
    } catch (e) {
        console.warn('[push] local schedule:', e);
        return false;
    }
}

/** API pública para alertas in-app (admin staff, etc.) en APK. */
export async function showAndroidAlertNotification({ title, body, data = {}, silent = false } = {}) {
    return showAndroidForegroundLocalNotification({
        notification: { title, body },
        data: { ...data, title, body }
    }, { forceSilent: !!silent });
}

// Exponer para app.js (staff alerts sin import circular)
if (typeof window !== 'undefined') {
    window.showAndroidAlertNotification = showAndroidAlertNotification;
}

function ensureFirebaseApp(firebaseConfig) {
    if (getApps().length) return getApp();
    return initializeApp(firebaseConfig);
}

async function resolveVapidKey(db, appId, configVapid) {
    if (configVapid) return configVapid;
    try {
        const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'));
        return snap.exists() ? (snap.data().fcmVapidKey || '') : '';
    } catch (_) {
        return '';
    }
}

function detectWebPushPlatform() {
    if (isIosStandalonePwa()) return 'ios-pwa';
    if (isIOS()) return 'ios-safari';
    return 'web';
}

async function registerMessagingServiceWorker() {
    const swUrl = getMessagingSwUrl(import.meta.url);
    if ('serviceWorker' in navigator) {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((reg) => {
                const url = String(reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '');
                // Quitar SW viejos con ?v= (rompían la suscripción en iOS)
                if (url.includes('firebase-messaging-sw.js?')) return reg.unregister().catch(() => false);
                return Promise.resolve(false);
            }));
        } catch (_) {}
    }
    const reg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
}

export async function saveFcmToken(db, appId, uid, token, platform = 'web') {
    if (!uid || !token) return;
    const tokenPatch = {
        [`fcmTokens.${token.replace(/\./g, '_')}`]: {
            token,
            updatedAt: Date.now(),
            platform
        },
        fcmTokenUpdatedAt: serverTimestamp()
    };
    const pubRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
    const privRef = doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data');
    // Siempre merge: si el público falla (reglas / doc incompleto) igual queda en privado.
    let saved = false;
    try {
        await setDoc(pubRef, { uid, ...tokenPatch }, { merge: true });
        saved = true;
    } catch (e) {
        console.warn('saveFcmToken public', e?.code || e?.message || e);
    }
    try {
        await setDoc(privRef, tokenPatch, { merge: true });
        saved = true;
    } catch (e) {
        console.warn('saveFcmToken private', e?.code || e?.message || e);
    }
    if (saved) {
        try { localStorage.setItem('honduber_push_enabled', '1'); } catch (_) {}
    }
    return saved;
}

function playConfiguredToneFromPush(data = {}) {
    try {
        // Preferir tonos configurados por admin (Personalización)
        if (typeof window.playEventNotificationTone === 'function') {
            const eventId = typeof window.resolveToneEventFromPush === 'function'
                ? window.resolveToneEventFromPush(data)
                : (window.HonduTones?.resolveToneEventFromPush?.(data) || 'general');
            return !!window.playEventNotificationTone(eventId);
        }
        if (window.HonduTones?.playEventTone) {
            const eventId = window.HonduTones.resolveToneEventFromPush?.(data) || 'general';
            return !!window.HonduTones.playEventTone(eventId);
        }
        const type = String(data.type || '');
        if (type === 'chat') return !!window.playChatSound?.();
        if (type === 'trip_offer' || type === 'ride_demand_alert' || type === 'trip_price_boost') {
            return !!window.playDriverTripOfferSound?.();
        }
        if (type === 'new_trip_staff') return !!window.playStaffTripAlertSound?.();
        if (type === 'store_order') return !!window.playStoreOrderTone?.();
        if (type === 'store_order_update') return !!window.playStoreOrderUpdateTone?.();
        if (type.includes('deposit')) return !!window.playDepositAlertSound?.();
        return !!window.playNotificationSound?.();
    } catch (_) {
        return false;
    }
}

function routeForegroundPush(payload) {
    const data = payload.data || payload.notification?.data || {};
    const title = payload.notification?.title || data.title || payload.title || 'HonduRaite';
    const body = payload.notification?.body || data.body || payload.body || '';
    const tripId = data.tripId || null;
    const type = data.type || '';

    // Tono de Personalización (Web Audio). En Android puede fallar si el AudioContext está bloqueado.
    const playedJsTone = playConfiguredToneFromPush(data);

    // Android en PRIMER PLANO: banner local. En background el nativo HonduMessagingService
    // ya pinta el aviso tipo WhatsApp (evitar doble notificación).
    if (isCapacitorAndroid()) {
        const appVisible = typeof document === 'undefined'
            || document.visibilityState === 'visible';
        if (appVisible) {
            showAndroidForegroundLocalNotification(
                { notification: { title, body }, data },
                { forceSilent: !!playedJsTone }
            ).catch(() => {});
            try {
                navigator.vibrate?.([0, 500, 80, 500, 80, 600, 100, 800, 80, 1000]);
            } catch (_) {}
        }
    }

    // Helpers de UI: sound 'none' para no volver a sonar (ya se reprodujo arriba)
    if (type === 'chat' || data.openChat === 'true') {
        notifyChatMessage({ senderName: title, text: body, tripId, force: true, playSound: false });
    } else if (type === 'freight_trip_alert') {
        notifyFreightTripAlert({
            title,
            body,
            tag: data.tag || `freight-alert-${tripId || 'x'}`,
            tripId,
            force: true,
            sound: 'none'
        });
    } else if (type === 'ride_demand_alert') {
        notifyRideDemandAlert({
            title,
            body,
            tag: data.tag || `ride-demand-${tripId || 'x'}`,
            tripId,
            force: true,
            sound: 'none'
        });
    } else if (type === 'new_trip_staff') {
        notifyStaffNewTripAlert({
            title,
            body,
            tag: data.tag || `staff-trip-${tripId || 'x'}`,
            tripId,
            force: true,
            sound: 'none'
        });
    } else {
        const superVibrate = data.superVibrate === 'true' || isRideAlertData(data);
        const tag = data.tag || `fcm-${type || 'trip'}-${tripId || 'x'}`;
        const dedupKey = `foreground-push:${tripId || 'global'}:${tag}`;
        const now = Date.now();
        const cache = window.__tripNotificationDedup || (window.__tripNotificationDedup = new Map());
        const last = cache.get(dedupKey);
        if (!last || now - last >= 2000) {
            cache.set(dedupKey, now);
            notifyTripEvent({
                title,
                body,
                tag,
                tripId,
                openChat: data.openChat === 'true',
                force: true,
                sound: 'none',
                superVibrate
            });
        }
    }

    // Admin envió “nueva versión” / broadcast de update
    if (
        type === 'app_update'
        || type === 'broadcast'
        || data.forceUpdate === 'true'
        || String(data.tag || '').startsWith('app-update-')
        || String(data.tag || '').startsWith('broadcast-')
    ) {
        try {
            // Si el push trae version, guardarla como pendiente
            const remoteV = String(data.version || data.appVersion || '').trim();
            if (remoteV) {
                try { localStorage.setItem('hr_pending_version', remoteV); } catch (_) {}
            }
            // PWA (version.json)
            setTimeout(() => {
                window.checkForAppUpdate?.({ force: true });
            }, 400);
            setTimeout(() => {
                window.checkForAppUpdate?.({ force: true });
            }, 2500);
            // APK nativo: forzar modal de actualización (no solo version.json de la web)
            const forceApk = () => {
                try {
                    window.__apkForceUpdateCheck?.();
                } catch (_) {}
                try {
                    window.maybeShowApkUpdateModal?.({ force: true });
                } catch (_) {}
                try {
                    window.showApkUpdateModal?.();
                } catch (_) {}
                try {
                    window.syncAppDownloadBadge?.();
                } catch (_) {}
            };
            setTimeout(forceApk, 500);
            setTimeout(forceApk, 2000);
            setTimeout(forceApk, 5000);
        } catch (_) {}
    }
}

function shouldOpenNotificationsCenter(data = {}) {
    const type = String(data.type || '');
    const tag = String(data.tag || '');
    if (data.openDeposit === 'true' || data.openDeposit === true || type === 'deposit_reminder'
        || tag.startsWith('deposit-reminder-')) return false;
    if (data.openNotifications === 'true' || data.openNotifications === true) return true;
    if (data.openChat === 'true' || data.openChat === true) return false;
    if (data.openDriver === 'true' || data.openDriver === true) return false;
    if (data.openPassenger === 'true' || data.openPassenger === true) return false;
    if (data.openClient === 'true' || data.openClient === true) return false;
    if (data.openAdmin === 'true' || data.openAdmin === true) return false;
    if (type === 'driver_bid' || type === 'trip_accepted' || type === 'trip_arrived'
        || type === 'passenger_counter' || type === 'trip_offer'
        || type === 'staff_created_trip') return false;
    // Avisos admin / versión / campañas / promos → campana de notificaciones
    return type === 'admin_notify'
        || type === 'app_update'
        || type === 'recurring_notify'
        || type === 'promo_new'
        || type === 'broadcast'
        || tag.startsWith('broadcast-')
        || tag.startsWith('app-update-')
        || tag.startsWith('campaign-')
        || tag.startsWith('fcm-admin')
        || tag.startsWith('notif-');
}

function openDepositFromPush(data = {}) {
    const amt = Number(data.amount) || 0;
    try { location.hash = 'deposit'; } catch (_) {}
    const open = () => {
        try {
            if (typeof window.openDriverDepositFromReminder === 'function') {
                window.openDriverDepositFromReminder(amt);
            } else {
                window.showDailyDepositInfo?.({ amount: amt || undefined, fromReminder: true, forceForm: true });
            }
        } catch (_) {}
    };
    if (typeof window.openDriverDepositFromReminder === 'function' || typeof window.showDailyDepositInfo === 'function') {
        open();
        setTimeout(open, 400);
    } else {
        setTimeout(open, 900);
        setTimeout(open, 2000);
    }
}

export function openNotificationsCenterFromPush() {
    try { location.hash = 'notifications'; } catch (_) {}
    const open = () => {
        try { window.showNotificationsModal?.(); } catch (_) {}
    };
    // Esperar un poco si la app aún bootea (click con app cerrada)
    if (typeof window.showNotificationsModal === 'function') {
        open();
        setTimeout(open, 400);
    } else {
        setTimeout(open, 900);
        setTimeout(open, 2000);
    }
}

function handleNotificationNavigation(data = {}) {
    const type = String(data.type || '');
    const tag = String(data.tag || '');
    const isTripOffer = type === 'trip_offer'
        || type === 'freight_trip_alert'
        || type === 'ride_demand_alert'
        || type === 'new_trip_staff'
        || type === 'passenger_counter'
        || type === 'trip_price_boost'
        || tag.startsWith('trip-offer-')
        || tag.startsWith('freight-alert-')
        || tag.startsWith('ride-demand-')
        || tag.startsWith('staff-trip-')
        || tag.startsWith('passenger-counter-')
        || tag.startsWith('trip-price-boost-');
    const isPassengerTrip = type === 'driver_bid'
        || type === 'trip_accepted'
        || type === 'trip_arrived'
        || type === 'staff_created_trip'
        || data.openPassenger === 'true'
        || data.openPassenger === true
        || data.openClient === 'true'
        || data.openClient === true
        || tag.startsWith('driver-bid-')
        || tag.startsWith('trip-accepted-')
        || tag.startsWith('trip-arrived-')
        || tag.startsWith('staff-created-');

    if (data.openChat === 'true' || data.openChat === true) {
        location.hash = 'chat';
        const chat = document.getElementById('chat-section');
        if (chat?.classList.contains('collapsed')) window.toggleChat?.();
        return;
    }
    if (
        data.openDeposit === 'true'
        || data.openDeposit === true
        || type === 'deposit_reminder'
        || tag.startsWith('deposit-reminder-')
    ) {
        openDepositFromPush(data);
        return;
    }
    if (isTripOffer || data.openDriver === 'true' || data.openDriver === true) {
        try { location.hash = 'driver'; } catch (_) {}
        const wakeDriverOffer = (playSound = false) => {
            try {
                if (window.userProfile?.role !== 'driver') return;
                document.body.classList.add('driver-mode');
                document.getElementById('driver-view')?.classList.remove('hidden');
                document.getElementById('client-view')?.classList.add('hidden');
                if (playSound) {
                    window.playDriverTripOfferSound?.();
                    window.triggerSuperTripVibration?.();
                }
                const offers = window._lastDriverMyOffers;
                if (Array.isArray(offers) && offers.length) {
                    window.syncDriverTripOfferPopup?.(offers, { forceShow: true });
                }
            } catch (_) {}
        };
        wakeDriverOffer(true);
        setTimeout(() => wakeDriverOffer(false), 500);
        setTimeout(() => wakeDriverOffer(false), 1500);
        return;
    }
    if (isPassengerTrip) {
        location.hash = 'client';
        try {
            document.getElementById('client-view')?.classList.remove('hidden');
            document.getElementById('driver-view')?.classList.add('hidden');
            window.showControlPanel?.();
        } catch (_) {}
        return;
    }
    // Pedido de tienda virtual → panel del emprendedor
    if (
        type === 'store_order'
        || data.openMerchant === 'true'
        || data.openMerchant === true
        || tag.startsWith('store-order-')
    ) {
        try { location.hash = 'merchant-store'; } catch (_) {}
        const open = () => {
            try { window.openMerchantPanel?.({ createNew: false }); } catch (_) {}
        };
        open();
        setTimeout(open, 400);
        setTimeout(open, 1200);
        return;
    }
    if (
        type === 'store_order_update'
        || data.openStores === 'true'
        || data.openStores === true
        || tag.startsWith('store-order-upd-')
    ) {
        try { location.hash = 'tiendas'; } catch (_) {}
        try { window.openStoresMarketplace?.(); } catch (_) {}
        return;
    }
    if (type === 'new_trip_staff' || data.openAdmin === 'true' || data.openAdmin === true) {
        location.hash = 'admin';
        return;
    }
    // Notificaciones generales (admin, versión, campañas): abrir centro de notificaciones
    if (shouldOpenNotificationsCenter(data)) {
        openNotificationsCenterFromPush();
        return;
    }
    // Por defecto (avisos de viaje al pasajero, etc.) también ir a la campana
    if (!isTripOffer) {
        openNotificationsCenterFromPush();
    }
}

let onMessageBound = false;
let tokenRefreshBound = false;
let lastWebTokenSaveAt = 0;
let lastWebTokenValue = '';

/** Web/PWA: FCM con service worker y VAPID. No se ejecuta en APK Android. */
export async function initFcmPush({ firebaseConfig, vapidKey, db, appId, uid }) {
    if (isCapacitorNative()) return null;
    if (!uid || !(await isSupported())) return null;

    // iPhone: en pestaña Safari el token NO entrega viajes con la app cerrada.
    if (isIOS() && !canReceiveBackgroundWebPush()) {
        console.warn('initFcmPush: iOS requiere PWA en pantalla de inicio (iOS 16.4+) para push fuera de Safari');
        return null;
    }

    const key = await resolveVapidKey(db, appId, vapidKey);
    if (!key) {
        console.warn('FCM: agrega messaging.vapidKey en config.js o fcmVapidKey en appSettings/main');
        return null;
    }

    try {
        const app = ensureFirebaseApp(firebaseConfig);
        const reg = await registerMessagingServiceWorker();
        messagingInstance = getMessaging(app);
        const token = await getToken(messagingInstance, {
            vapidKey: key,
            serviceWorkerRegistration: reg
        });

        if (token) {
            const platform = detectWebPushPlatform();
            const now = Date.now();
            if (token !== lastWebTokenValue || now - lastWebTokenSaveAt > 60 * 1000) {
                lastWebTokenValue = token;
                lastWebTokenSaveAt = now;
                await saveFcmToken(db, appId, uid, token, platform);
            }
        }

        if (!onMessageBound) {
            onMessageBound = true;
            onMessage(messagingInstance, (payload) => routeForegroundPush(payload));
        }

        bindWebPushTokenRefresh({ firebaseConfig, vapidKey, db, appId, uid });

        return token || null;
    } catch (e) {
        console.warn('initFcmPush:', e);
        return null;
    }
}

function bindWebPushTokenRefresh({ firebaseConfig, vapidKey, db, appId, uid }) {
    if (tokenRefreshBound || !uid || isCapacitorNative()) return;
    tokenRefreshBound = true;
    let lastAttempt = 0;
    const refresh = () => {
        if (document.visibilityState === 'hidden') return;
        const now = Date.now();
        if (now - lastAttempt < 45 * 1000) return;
        lastAttempt = now;
        initFcmPush({ firebaseConfig, vapidKey, db, appId, uid }).catch(() => {});
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh();
    });
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', () => refresh());
}

/**
 * Pide permisos para notificaciones emergentes tipo Temu:
 * 1) Notificaciones (Android 13+)
 * 2) Local notifications
 * 3) Full-screen intent / heads-up (Android 14+)
 * 4) Crea canal MAX
 * 5) (opcional) batería sin optimizar
 */
export async function requestAndroidTemuNotificationPermissions({
    requestFullScreen = true,
    requestBattery = false
} = {}) {
    if (!isCapacitorAndroid()) return { ok: false, reason: 'not_android' };

    const result = {
        ok: false,
        push: 'default',
        local: 'default',
        fullScreen: null,
        battery: null
    };

    try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
            perm = await PushNotifications.requestPermissions();
        }
        result.push = perm.receive || 'default';
    } catch (e) {
        console.warn('[push] request push perm:', e);
    }

    try {
        if (LocalNotifications?.checkPermissions) {
            let lp = await LocalNotifications.checkPermissions();
            if (lp.display === 'prompt' || lp.display === 'prompt-with-rationale') {
                lp = await LocalNotifications.requestPermissions();
            }
            result.local = lp.display || 'default';
        }
    } catch (e) {
        console.warn('[push] request local perm:', e);
    }

    await ensureAndroidPushChannels();

    // Full-screen intent (banner emergente agresivo en Android 14+)
    if (requestFullScreen) {
        try {
            const SK = registerPlugin('SessionKeepalive');
            const fs = await SK.hasFullScreenIntentPermission?.();
            result.fullScreen = !!fs?.granted;
            if (!fs?.granted) {
                // Abre ajustes del sistema para activar “mostrar a pantalla completa / emergente”
                await SK.requestFullScreenIntentPermission?.();
                // Marcar para re-chequear al volver a la app
                try { sessionStorage.setItem('honduber_await_fullscreen_perm', '1'); } catch (_) {}
            }
        } catch (e) {
            console.warn('[push] fullScreen intent:', e);
        }
    }

    if (requestBattery) {
        try {
            const SK = registerPlugin('SessionKeepalive');
            const bat = await SK.hasBatteryExemption?.();
            result.battery = !!bat?.granted;
            if (!bat?.granted) {
                await SK.requestBatteryExemption?.();
            }
        } catch (e) {
            console.warn('[push] battery:', e);
        }
    }

    result.ok = result.push === 'granted' || result.local === 'granted'
        || localStorage.getItem('honduber_push_enabled') === '1';
    return result;
}

/**
 * Conductores / quien recibe ofertas de viaje: asegura canal + full-screen intent +
 * (opcional) batería sin optimizar para que el push suene y encienda pantalla fuera de la app.
 * Idempotente: no spamea si ya está concedido.
 */
export async function ensureAndroidTripWakePermissions({
    requestBattery = true,
    requestFullScreen = true
} = {}) {
    if (!isCapacitorAndroid()) return { ok: false, reason: 'not_android' };
    try {
        const res = await requestAndroidTemuNotificationPermissions({
            requestFullScreen,
            requestBattery
        });
        return res;
    } catch (e) {
        console.warn('[push] ensureAndroidTripWakePermissions:', e);
        return { ok: false, reason: e?.message || 'error' };
    }
}

// Exponer para app.js (al ir en línea el conductor)
if (typeof window !== 'undefined') {
    window.ensureAndroidTripWakePermissions = ensureAndroidTripWakePermissions;
}

/** APK Android: push nativo vía Capacitor. No registra SW ni toca tokens web. */
export async function initAndroidFcmPush({ db, appId, uid, skipPermissionRequest = false }) {
    if (!isCapacitorAndroid() || !uid) return null;
    if (!isAndroidFcmConfigured()) {
        console.warn('initAndroidFcmPush: falta google-services.json para honduraite.com');
        return null;
    }
    if (androidPushInitialized) return 'ready';
    if (androidPushInitPromise) return androidPushInitPromise;

    androidPushInitPromise = (async () => {
        try {
            if (!skipPermissionRequest) {
                const temu = await requestAndroidTemuNotificationPermissions({
                    requestFullScreen: true,
                    requestBattery: false
                });
                if (temu.push !== 'granted' && temu.local !== 'granted') {
                    // Si el SO no reporta bien, igual intentamos registrar si el usuario ya dio permiso antes
                    if (localStorage.getItem('honduber_push_enabled') !== '1') return null;
                }
            } else {
                await ensureAndroidPushChannels();
            }

            let tokenValue = null;
            const tokenPromise = new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 12000);
                PushNotifications.addListener('registration', async (token) => {
                    clearTimeout(timeout);
                    tokenValue = token?.value || null;
                    if (tokenValue) {
                        await saveFcmToken(db, appId, uid, tokenValue, 'android');
                        localStorage.setItem('honduber_push_enabled', '1');
                    }
                    resolve(tokenValue);
                }).catch(() => {
                    clearTimeout(timeout);
                    resolve(null);
                });
                PushNotifications.addListener('registrationError', () => {
                    clearTimeout(timeout);
                    resolve(null);
                }).catch(() => {
                    clearTimeout(timeout);
                    resolve(null);
                });
            });

            await PushNotifications.register();
            await tokenPromise;

            await PushNotifications.addListener('pushNotificationReceived', (notification) => {
                routeForegroundPush({
                    notification: notification.notification || {
                        title: notification.title,
                        body: notification.body
                    },
                    data: notification.data || notification.notification?.data || {},
                    title: notification.title,
                    body: notification.body
                });
            }).catch(() => {});

            await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                handleNotificationNavigation(action.notification?.data || {});
            }).catch(() => {});

            // Click en notificación local (foreground)
            try {
                if (LocalNotifications?.addListener) {
                    await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
                        const extra = action.notification?.extra || {};
                        handleNotificationNavigation(extra);
                    });
                }
            } catch (_) {}

            androidPushInitialized = true;
            return tokenValue || 'ready';
        } catch (e) {
            console.warn('initAndroidFcmPush:', e);
            return null;
        } finally {
            androidPushInitPromise = null;
        }
    })();

    return androidPushInitPromise;
}
