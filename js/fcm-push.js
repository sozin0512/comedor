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

const PushNotifications = registerPlugin('PushNotifications');

/** Canal Android de máxima prioridad: ofertas y demanda (VIP/taxi/moto/envío). */
export const HONDU_RIDE_ALERT_CHANNEL_ID = 'hondu_ride_alerts';
const HONDU_DEFAULT_CHANNEL_ID = 'hondu_default';

export function isAndroidFcmConfigured() {
    return APP_CONFIG.androidFcmEnabled === true;
}

/** Crea canales nativos con sonido + vibración (requerido en Android 8+). */
async function ensureAndroidPushChannels() {
    if (!isCapacitorAndroid()) return;
    try {
        await PushNotifications.createChannel({
            id: HONDU_RIDE_ALERT_CHANNEL_ID,
            name: 'Viajes HonduRaite',
            description: 'Ofertas y demanda de VIP, taxi, moto y envíos. Sonido y vibración fuerte.',
            importance: 5,
            visibility: 1,
            sound: 'default',
            vibration: true,
            lights: true,
            lightColor: '#2563eb'
        });
    } catch (e) {
        console.warn('[push] canal hondu_ride_alerts:', e);
    }
    try {
        await PushNotifications.createChannel({
            id: HONDU_DEFAULT_CHANNEL_ID,
            name: 'Avisos HonduRaite',
            description: 'Notificaciones generales de HonduRaite',
            importance: 4,
            visibility: 1,
            sound: 'default',
            vibration: true
        });
    } catch (e) {
        console.warn('[push] canal hondu_default:', e);
    }
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

function routeForegroundPush(payload) {
    const data = payload.data || payload.notification?.data || {};
    const title = payload.notification?.title || data.title || payload.title || 'HonduRaite';
    const body = payload.notification?.body || data.body || payload.body || '';
    const tripId = data.tripId || null;
    const type = data.type || '';

    if (type === 'chat' || data.openChat === 'true') {
        notifyChatMessage({ senderName: title, text: body, tripId, force: true });
    } else if (type === 'freight_trip_alert') {
        notifyFreightTripAlert({
            title,
            body,
            tag: data.tag || `freight-alert-${tripId || 'x'}`,
            tripId,
            force: true
        });
    } else if (type === 'ride_demand_alert') {
        // Demanda con app en primer plano: sonido de oferta HonduRaite + vibración fuerte
        try { window.playDriverTripOfferSound?.(); } catch (_) {}
        notifyRideDemandAlert({
            title,
            body,
            tag: data.tag || `ride-demand-${tripId || 'x'}`,
            tripId,
            force: true
        });
    } else if (type === 'new_trip_staff') {
        notifyStaffNewTripAlert({
            title,
            body,
            tag: data.tag || `staff-trip-${tripId || 'x'}`,
            tripId,
            force: true
        });
    } else {
        const superVibrate = data.superVibrate === 'true'
            || type === 'freight_trip_alert'
            || type === 'ride_demand_alert'
            || type === 'trip_offer'
            || type === 'new_trip_staff';
        notifyTripEvent({
            title,
            body,
            tag: data.tag || `fcm-${type || 'trip'}-${tripId || 'x'}`,
            tripId,
            openChat: data.openChat === 'true',
            force: true,
            sound: 'default',
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
    if (data.openAdmin === 'true' || data.openAdmin === true) return false;
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
        || tag.startsWith('trip-offer-')
        || tag.startsWith('freight-alert-')
        || tag.startsWith('ride-demand-')
        || tag.startsWith('staff-trip-');

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
                let perm = await PushNotifications.checkPermissions();
                if (perm.receive === 'prompt') {
                    perm = await PushNotifications.requestPermissions();
                }
                if (perm.receive !== 'granted') return null;
            }

            await ensureAndroidPushChannels();

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
                    notification: notification.notification,
                    data: notification.data || notification.notification?.data || {}
                });
            }).catch(() => {});

            await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                handleNotificationNavigation(action.notification?.data || {});
            }).catch(() => {});

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