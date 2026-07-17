import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { notifyChatMessage, notifyTripEvent, notifyFreightTripAlert, notifyRideDemandAlert, notifyStaffNewTripAlert } from './trip-notifications.js';
import { isCapacitorNative, isCapacitorAndroid } from './capacitor-native.js';
import { getMessagingSwUrl } from './pwa-update.js';
import { registerPlugin } from './vendor/capacitor-core.js';
import { APP_CONFIG } from './config.js';

let messagingInstance = null;
let androidPushInitialized = false;
let androidPushInitPromise = null;
let localNotifIdSeq = Math.floor(Date.now() % 100000);

const PushNotifications = registerPlugin('PushNotifications');
const LocalNotifications = registerPlugin('LocalNotifications');

/**
 * Canales Android — TODAS las notificaciones emergentes tipo Temu (v6).
 * Un canal MAX + hondu_ride: heads-up aunque estés en otra app.
 * (Android no cambia el sound de un canal ya creado → hay que versionar el id)
 */
export const ANDROID_PUSH_CHANNEL_VERSION = 'v6';
export const HONDU_TEMU_ALL_CHANNEL_ID = `hondu_temu_all_${ANDROID_PUSH_CHANNEL_VERSION}`;
export const HONDU_RIDE_ALERT_CHANNEL_ID = HONDU_TEMU_ALL_CHANNEL_ID;
export const HONDU_DEFAULT_CHANNEL_ID = HONDU_TEMU_ALL_CHANNEL_ID;
// Misma importancia MAX también para banners locales en primer plano
const HONDU_FG_LOCAL_CHANNEL_ID = HONDU_TEMU_ALL_CHANNEL_ID;

/** Modos de sonido nativo (fuera de la app). Guardado en user.pushSoundMode */
export const PUSH_SOUND_MODES = [
    {
        id: 'temu',
        label: 'Fuerte tipo Temu',
        desc: 'Máximo volumen de atención: tono de viaje + vibración fuerte (recomendado)'
    },
    {
        id: 'normal',
        label: 'Normal',
        desc: 'Viajes con tono fuerte; avisos generales más suaves'
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

    // Un solo canal MAX: heads-up tipo Temu para TODAS las notificaciones
    // sound = res/raw/hondu_ride (sin extensión)
    const temuChannel = {
        id: HONDU_TEMU_ALL_CHANNEL_ID,
        name: 'HonduRaite emergente (Temu)',
        description: 'Todas las notificaciones con banner emergente, tono fuerte y vibración (incluso en otra app).',
        importance: 5, // IMPORTANCE_MAX → heads-up
        visibility: 1, // public / lockscreen
        sound: 'hondu_ride',
        vibration: true,
        lights: true,
        lightColor: '#2563eb'
    };

    for (const ch of [temuChannel]) {
        try {
            await PushNotifications.createChannel(ch);
        } catch (e) {
            console.warn('[push] canal', ch.id, e);
        }
    }

    try {
        if (LocalNotifications?.createChannel) {
            await LocalNotifications.createChannel(temuChannel);
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
    const channelId = m === 'soft' ? HONDU_DEFAULT_CHANNEL_ID : HONDU_RIDE_ALERT_CHANNEL_ID;
    const sound = m === 'soft' ? 'hondu_alert' : 'hondu_ride';
    localNotifIdSeq = (localNotifIdSeq + 1) % 900000;
    const id = 200000 + localNotifIdSeq;
    try {
        await LocalNotifications.schedule({
            notifications: [{
                id,
                title: m === 'temu' ? '🔊 Prueba estilo Temu' : (m === 'soft' ? 'Prueba suave' : 'Prueba normal'),
                body: 'Así suena si estás en otra app o con la pantalla bloqueada.',
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
 * - Urgentes (viajes/staff/ofertas): canal ride + hondu_ride → SIEMPRE suena
 *   (Web Audio a menudo está muteado hasta un toque del usuario).
 * - Generales: canal default + hondu_alert.
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

    // Siempre canal Temu (heads-up) salvo forceSilent explícito
    let channelId = HONDU_TEMU_ALL_CHANNEL_ID;
    let sound = forceSilent ? null : 'hondu_ride';
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
export async function showAndroidAlertNotification({ title, body, data = {} } = {}) {
    return showAndroidForegroundLocalNotification({
        notification: { title, body },
        data: { ...data, title, body }
    });
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

async function registerMessagingServiceWorker() {
    const swUrl = getMessagingSwUrl(import.meta.url);
    const reg = await navigator.serviceWorker.register(swUrl);
    await navigator.serviceWorker.ready;
    return reg;
}

export async function saveFcmToken(db, appId, uid, token, platform = 'web') {
    if (!uid || !token) return;
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
    const tokenPatch = {
        [`fcmTokens.${token.replace(/\./g, '_')}`]: {
            token,
            updatedAt: Date.now(),
            platform
        },
        fcmTokenUpdatedAt: serverTimestamp()
    };
    try {
        await updateDoc(userRef, tokenPatch);
    } catch (e) {
        if (e?.code === 'not-found') {
            await setDoc(userRef, { uid, ...tokenPatch }, { merge: true });
        } else {
            throw e;
        }
    }
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data'), {
            [`fcmTokens.${token.replace(/\./g, '_')}`]: {
                token,
                updatedAt: Date.now(),
                platform
            },
            fcmTokenUpdatedAt: serverTimestamp()
        });
    } catch (_) {}
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
    const webToneOk = playConfiguredToneFromPush(data);

    // Android: SIEMPRE banner emergente Temu (canal MAX + hondu_ride), aunque estés en la app
    if (isCapacitorAndroid()) {
        showAndroidForegroundLocalNotification(
            { notification: { title, body }, data },
            { forceSilent: false }
        ).catch(() => {});
        try {
            navigator.vibrate?.([0, 500, 80, 500, 80, 600, 100, 800, 80, 1000]);
        } catch (_) {}
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
        notifyTripEvent({
            title,
            body,
            tag: data.tag || `fcm-${type || 'trip'}-${tripId || 'x'}`,
            tripId,
            openChat: data.openChat === 'true',
            force: true,
            sound: 'none',
            superVibrate
        });
    }
}

function shouldOpenNotificationsCenter(data = {}) {
    const type = String(data.type || '');
    const tag = String(data.tag || '');
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
    if (isTripOffer || data.openDriver === 'true' || data.openDriver === true) {
        location.hash = 'driver';
        if (window.userProfile?.role === 'driver') {
            document.getElementById('driver-view')?.classList.remove('hidden');
            document.getElementById('client-view')?.classList.add('hidden');
            window.showControlPanel?.();
        }
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

/** Web/PWA: FCM con service worker y VAPID. No se ejecuta en APK Android. */
export async function initFcmPush({ firebaseConfig, vapidKey, db, appId, uid }) {
    if (isCapacitorNative()) return null;
    if (!uid || !(await isSupported())) return null;

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

        if (token) await saveFcmToken(db, appId, uid, token, 'web');

        onMessage(messagingInstance, (payload) => routeForegroundPush(payload));

        return token;
    } catch (e) {
        console.warn('initFcmPush:', e);
        return null;
    }
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
