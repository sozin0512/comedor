import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js';
import { doc, getDoc, setDoc, deleteField, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { initTripNotifications, notifyChatMessage, notifyTripEvent, notifyFreightTripAlert, notifyRideDemandAlert, notifyStaffNewTripAlert, setAndroidNotificationPermissionCache, getNotificationPermission } from './trip-notifications.js';
import { isCapacitorNative, isCapacitorAndroid } from './capacitor-native.js';
import { getMessagingSwUrl } from './pwa-update.js';
import { isIOS, isIosStandalonePwa, canReceiveBackgroundWebPush } from './pwa-install.js';
import { registerPlugin } from './vendor/capacitor-core.js';
import { APP_CONFIG } from './config.js';

let messagingInstance = null;
let androidPushInitialized = false;
let androidPushListenersBound = false;
let androidPushResumeBound = false;
let androidPushInitPromise = null;
let lastAndroidTokenValue = '';
let lastWebTokenValue = '';
let androidPushContext = { db: null, appId: null, uid: null };
let closedSessionPushBooted = false;
let localNotifIdSeq = Math.floor(Date.now() % 100000);
const LAST_PUSH_UID_KEY = 'honduber_push_uid';

export function lastPushUid() {
    try { return localStorage.getItem(LAST_PUSH_UID_KEY) || ''; } catch (_) { return ''; }
}

export function rememberPushUid(uid) {
    if (!uid) return;
    try { localStorage.setItem(LAST_PUSH_UID_KEY, uid); } catch (_) {}
}

const PushNotifications = registerPlugin('PushNotifications');
const LocalNotifications = registerPlugin('LocalNotifications');

/**
 * Canales Android — estilo WhatsApp (v10): tono icónico hondu_iconic + enciende pantalla.
 * Debe coincidir con HonduMessagingService.WA_CHANNEL_ID y functions/index.js
 * (Android no cambia el sound de un canal ya creado → hay que versionar el id)
 * v9 a menudo nació sin wav / con USAGE_NOTIFICATION (volumen de avisos en 0 = mudo).
 */
export const ANDROID_PUSH_CHANNEL_VERSION = 'v10';
export const HONDU_WA_ALERT_CHANNEL_ID = 'hondu_wa_alert_v10';
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

    const legacyIds = [
        'hondu_wa_alert_v9',
        'hondu_wa_alert_v8',
        'hondu_wa_alert_v7',
        'hondu_wa_alert_v6',
        'hondu_wa_alert_v5',
        'hondu_ride_alert_v4',
        'hondu_temu_all_v4',
        'hondu_default_v4'
    ];
    for (const id of legacyIds) {
        try { await PushNotifications.deleteChannel({ id }); } catch (_) {}
        try { await LocalNotifications?.deleteChannel?.({ id }); } catch (_) {}
    }

    // Canal estilo WhatsApp: HIGH/MAX + tono icónico + luz + vibración
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

    try {
        const SK = registerPlugin('SessionKeepalive');
        await SK.ensureTripAlertChannel?.();
    } catch (_) {}
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

const WEB_PUSH_TOKEN_OK_KEY = 'honduber_push_token_ok';
const LAST_FCM_TOKEN_KEY = 'honduber_fcm_token_last';
const LAST_FCM_PLATFORM_KEY = 'honduber_fcm_platform_last';

function detectWebPushPlatform() {
    if (isIosStandalonePwa()) return 'ios-pwa';
    if (isIOS()) return 'ios-safari';
    return 'web';
}

export function hasSavedWebPushToken() {
    try {
        if (localStorage.getItem(WEB_PUSH_TOKEN_OK_KEY) === '1') return true;
        if (localStorage.getItem(LAST_FCM_TOKEN_KEY)) return true;
    } catch (_) {}
    if (lastWebTokenValue || lastAndroidTokenValue) return true;
    return false;
}

function markWebPushTokenOk(ok) {
    try {
        if (ok) localStorage.setItem(WEB_PUSH_TOKEN_OK_KEY, '1');
        else localStorage.removeItem(WEB_PUSH_TOKEN_OK_KEY);
    } catch (_) {}
}

/** El aviso verde depende de esto, no de que Firestore ya haya confirmado el write. */
function claimDevicePushToken(token, platform) {
    if (!token) return;
    rememberDevicePushToken(token, platform);
    markWebPushTokenOk(true);
    try { localStorage.setItem('honduber_push_enabled', '1'); } catch (_) {}
    if (platform === 'android' || isCapacitorAndroid()) {
        lastAndroidTokenValue = token;
        setAndroidNotificationPermissionCache('granted');
    } else {
        lastWebTokenValue = token;
    }
    notifyPushTokenReady(token, platform);
}

function messagingSwScriptUrl(reg) {
    return String(
        reg?.active?.scriptURL
        || reg?.waiting?.scriptURL
        || reg?.installing?.scriptURL
        || ''
    );
}

function isCurrentMessagingSwUrl(url) {
    if (!url) return false;
    const path = url.split('?')[0];
    return /\/firebase-messaging-sw\.js$/i.test(path) && !url.includes('?');
}

async function waitForServiceWorkerReady(reg, timeoutMs) {
    const ready = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(reg), timeoutMs);
        navigator.serviceWorker.ready.then((readyReg) => {
            clearTimeout(timer);
            resolve(readyReg || reg);
        }).catch(() => {
            clearTimeout(timer);
            resolve(reg);
        });
    });
    if (navigator.serviceWorker.controller) return ready;
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, Math.min(4000, timeoutMs));
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
    return ready;
}

export async function bootWebPushServiceWorker() {
    if (isCapacitorNative()) return null;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
        return await registerMessagingServiceWorker();
    } catch (e) {
        console.warn('[push] boot SW', e);
        return null;
    }
}

async function registerMessagingServiceWorker() {
    const swUrl = getMessagingSwUrl(import.meta.url);
    if ('serviceWorker' in navigator) {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((reg) => {
                const url = messagingSwScriptUrl(reg);
                const path = url.split('?')[0];
                // Nunca desregistrar firebase-messaging-sw.js: en iPhone eso REVOCA el permiso.
                if (/\/firebase-messaging-sw\.js$/i.test(path)) return Promise.resolve(false);
                if (/\/sw\.js$/i.test(path)) return reg.unregister().catch(() => false);
                return Promise.resolve(false);
            }));
        } catch (_) {}
    }
    const reg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
    try { reg.waiting?.postMessage?.({ type: 'SKIP_WAITING' }); } catch (_) {}
    try { reg.installing?.postMessage?.({ type: 'SKIP_WAITING' }); } catch (_) {}
    return waitForServiceWorkerReady(reg, isIOS() ? 15000 : 4000);
}

async function messagingSupportedHere() {
    try {
        if (await isSupported()) return true;
    } catch (_) {}
    // iOS PWA: isSupported() a veces da false por cookies/ITP y el push sí existe
    return isIosStandalonePwa()
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window;
}

async function getFcmTokenWithRetry(messagingInstance, key, reg) {
    const attempts = 3;
    const timeoutMs = isIOS() ? 20000 : 12000;
    let lastErr = null;
    let readyReg = reg;
    try {
        if (!readyReg?.active && typeof navigator !== 'undefined' && navigator.serviceWorker?.ready) {
            readyReg = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((resolve) => setTimeout(() => resolve(reg), 4000))
            ]);
        }
    } catch (_) {}
    for (let i = 0; i < attempts; i += 1) {
        try {
            const token = await Promise.race([
                getToken(messagingInstance, {
                    vapidKey: key,
                    serviceWorkerRegistration: readyReg || reg
                }),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('getToken-timeout')), timeoutMs);
                })
            ]);
            if (token) return token;
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 700 * (i + 1)));
        }
    }
    if (lastErr) throw lastErr;
    return null;
}

function notifyPushTokenReady(token, platform) {
    try {
        window.dispatchEvent(new CustomEvent('honduber-push-token', {
            detail: { token: token || '', platform: platform || '' }
        }));
    } catch (_) {}
    try { window.updatePushEnableButton?.(); } catch (_) {}
}

function rememberDevicePushToken(token, platform) {
    if (!token) return;
    try {
        localStorage.setItem(LAST_FCM_TOKEN_KEY, String(token));
        if (platform) localStorage.setItem(LAST_FCM_PLATFORM_KEY, String(platform));
    } catch (_) {}
}

export function getThisDevicePushTarget() {
    let token = '';
    let platform = '';
    try {
        token = localStorage.getItem(LAST_FCM_TOKEN_KEY) || '';
        platform = localStorage.getItem(LAST_FCM_PLATFORM_KEY) || '';
    } catch (_) {}
    if (!token) token = lastAndroidTokenValue || lastWebTokenValue || '';
    if (!platform) {
        if (isCapacitorAndroid()) platform = 'android';
        else platform = detectWebPushPlatform();
    }
    return { token, platform };
}

/** Prueba FCM real (Cloud Function). No uses LocalNotifications: eso no demuestra avisos fuera de la app. */
export async function pingMyPushFromClient() {
    try {
        const callable = window.httpsCallable;
        const fns = window.cloudFunctions;
        if (typeof callable !== 'function' || !fns) {
            return { sent: 0, tokens: 0, error: 'no_callable' };
        }
        let { token, platform } = getThisDevicePushTarget();
        if (!token && isCapacitorAndroid()) {
            await waitForAndroidToken(8000);
            ({ token, platform } = getThisDevicePushTarget());
        }
        if (!token) {
            return { sent: 0, tokens: 0, error: 'no_local_token' };
        }
        const res = await callable(fns, 'pingMyPush')({ token, platform });
        return res?.data || { sent: 0, tokens: 0 };
    } catch (e) {
        console.warn('[push] pingMyPush', e?.message || e);
        return { sent: 0, tokens: 0, error: e?.message || 'ping_failed' };
    }
}

export async function showWebPushSelfTest(body) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const text = body || 'Avisos activos. Si ves esto, el permiso del navegador ya funciona.';
    try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification('HonduRaite', {
            body: text,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: 'hr-push-test',
            data: { type: 'push_test' }
        });
        return true;
    } catch (_) {
        try {
            new Notification('HonduRaite', { body: text, icon: '/icons/icon-192.png' });
            return true;
        } catch (e) {
            return false;
        }
    }
}

const FCM_TOKEN_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const FCM_TOKEN_MAX_KEEP = 24;

function fcmTokenMapEntries(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.entries(raw).map(([key, entry]) => {
        const token = typeof entry === 'string'
            ? entry
            : (entry?.token || entry?.value || '');
        const updatedAt = (entry && typeof entry === 'object')
            ? (Number(entry.updatedAt) || 0)
            : 0;
        return { key, token, updatedAt };
    }).filter((e) => e.key);
}

function staleFcmTokenDeletePatch(raw, { keepToken = null } = {}) {
    const entries = fcmTokenMapEntries(raw);
    if (!entries.length) return null;
    const cutoff = Date.now() - FCM_TOKEN_MAX_AGE_MS;
    const ranked = [...entries].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const keep = new Set();
    for (const e of ranked) {
        if (keepToken && e.token === keepToken) {
            keep.add(e.key);
            continue;
        }
        if (e.updatedAt > 0 && e.updatedAt < cutoff) continue;
        if (keep.size >= FCM_TOKEN_MAX_KEEP) continue;
        if (e.updatedAt > 0 || entries.length <= FCM_TOKEN_MAX_KEEP) keep.add(e.key);
    }
    if (keepToken) {
        const current = entries.find((e) => e.token === keepToken || e.key === keepToken.replace(/\./g, '_'));
        if (current) keep.add(current.key);
    }
    const patch = {};
    let n = 0;
    for (const e of entries) {
        if (!keep.has(e.key)) {
            patch[`fcmTokens.${e.key}`] = deleteField();
            n += 1;
        }
    }
    return n ? patch : null;
}

async function pruneStaleFcmTokens(db, appId, uid, keepToken = null) {
    if (!uid) return;
    const refs = [
        doc(db, 'artifacts', appId, 'public', 'data', 'users', uid),
        doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data')
    ];
    for (const ref of refs) {
        try {
            const snap = await getDoc(ref);
            if (!snap.exists()) continue;
            const patch = staleFcmTokenDeletePatch(snap.data()?.fcmTokens, { keepToken });
            if (patch) await setDoc(ref, patch, { merge: true });
        } catch (e) {
            console.warn('pruneStaleFcmTokens', e?.code || e?.message || e);
        }
    }
}

export async function saveFcmToken(db, appId, uid, token, platform = 'web') {
    if (!token) return false;
    claimDevicePushToken(token, platform);
    if (!uid || !db || !appId) return false;
    rememberPushUid(uid);
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
        pruneStaleFcmTokens(db, appId, uid, token).catch(() => {});
    }
    return saved;
}

function playTripHtmlAlert() {
    try {
        const audio = new Audio('icons/hondu_iconic.wav');
        audio.playsInline = true;
        audio.setAttribute('playsinline', 'true');
        audio.muted = false;
        audio.volume = 1;
        const p = audio.play();
        if (p?.catch) p.catch(() => {});
        return true;
    } catch (_) {
        return false;
    }
}

function playConfiguredToneFromPush(data = {}) {
    try {
        try { window.unlockNotificationTones?.(); } catch (_) {}
        const type = String(data.type || '');
        const tripLike = type === 'trip_offer'
            || type === 'push_test'
            || type === 'new_trip_staff'
            || type === 'ride_demand_alert'
            || type === 'freight_trip_alert'
            || type === 'trip_price_boost'
            || data.openDriver === 'true';
        if (tripLike) playTripHtmlAlert();
        // Preferir tonos configurados por admin (Personalización)
        if (typeof window.playEventNotificationTone === 'function') {
            const eventId = typeof window.resolveToneEventFromPush === 'function'
                ? window.resolveToneEventFromPush(data)
                : (window.HonduTones?.resolveToneEventFromPush?.(data) || 'general');
            return !!window.playEventNotificationTone(eventId) || tripLike;
        }
        if (window.HonduTones?.playEventTone) {
            const eventId = window.HonduTones.resolveToneEventFromPush?.(data) || 'general';
            return !!window.HonduTones.playEventTone(eventId);
        }
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

    // Tono JS (Web Audio). En iPhone/Android a menudo está bloqueado: el canal nativo
    // / la notificación de sistema deben sonar igual.
    try { window.unlockNotificationTones?.(); } catch (_) {}
    const playedJsTone = playConfiguredToneFromPush(data);
    const typeForSound = String(type || data.type || '');
    const tripLike = typeForSound === 'trip_offer'
        || typeForSound === 'push_test'
        || typeForSound === 'new_trip_staff'
        || typeForSound === 'ride_demand_alert'
        || typeForSound === 'freight_trip_alert'
        || typeForSound === 'trip_price_boost'
        || data.openDriver === 'true'
        || data.wake === '1';

    // Android en PRIMER PLANO: banner local. Viajes NUNCA silent (Web Audio miente “ok”).
    if (isCapacitorAndroid()) {
        const appVisible = typeof document === 'undefined'
            || document.visibilityState === 'visible';
        if (appVisible) {
            showAndroidForegroundLocalNotification(
                { notification: { title, body }, data },
                { forceSilent: !!playedJsTone && !tripLike }
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
        || type === 'push_test'
        || tag.startsWith('trip-offer-')
        || tag.startsWith('freight-alert-')
        || tag.startsWith('ride-demand-')
        || tag.startsWith('staff-trip-')
        || tag.startsWith('passenger-counter-')
        || tag.startsWith('trip-price-boost-')
        || tag.startsWith('push-test-');
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
                const driverSession = typeof window.isDriverAppSession === 'function'
                    ? window.isDriverAppSession()
                    : (
                        document.body.classList.contains('driver-mode')
                        || String(window.userProfile?.role || '').toLowerCase() === 'driver'
                        || String(localStorage.getItem('lastUserRole') || '').toLowerCase() === 'driver'
                    );
                if (!driverSession) return;
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
let webPushInitPromise = null;
try {
    if (!isCapacitorAndroid()) {
        lastWebTokenValue = localStorage.getItem(LAST_FCM_TOKEN_KEY) || '';
        if (lastWebTokenValue) markWebPushTokenOk(true);
    }
} catch (_) {}

/** Web/PWA: FCM con service worker y VAPID. No se ejecuta en APK Android. */
export async function initFcmPush({ firebaseConfig, vapidKey, db, appId, uid }) {
    if (isCapacitorNative()) return null;
    const tokenUid = uid || lastPushUid() || null;
    if (!(await messagingSupportedHere())) return null;

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

    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        return null;
    }

    await recoverSavedPushTokenFromProfile(db, appId, tokenUid).catch(() => '');
    if (webPushInitPromise) return lastWebTokenValue || webPushInitPromise;

    webPushInitPromise = (async () => {
    try {
        const app = ensureFirebaseApp(firebaseConfig);
        const reg = await registerMessagingServiceWorker();
        messagingInstance = getMessaging(app);
        const token = await getFcmTokenWithRetry(messagingInstance, key, reg);

        if (token) {
            const platform = detectWebPushPlatform();
            const prev = lastWebTokenValue;
            lastWebTokenValue = token;
            claimDevicePushToken(token, platform);
            const now = Date.now();
            const shouldSave = !!tokenUid && (token !== prev || now - lastWebTokenSaveAt > 60 * 1000);
            if (shouldSave) {
                const saved = await saveFcmToken(db, appId, tokenUid, token, platform);
                if (saved) lastWebTokenSaveAt = now;
            }
        }

        if (!onMessageBound) {
            onMessageBound = true;
            onMessage(messagingInstance, (payload) => routeForegroundPush(payload));
        }

        if (tokenUid) {
            bindWebPushTokenRefresh({ firebaseConfig, vapidKey, db, appId, uid: tokenUid });
        }

        return token || lastWebTokenValue || null;
    } catch (e) {
        console.warn('initFcmPush:', e);
        if (tokenUid) {
            bindWebPushTokenRefresh({ firebaseConfig, vapidKey, db, appId, uid: tokenUid });
        }
        return lastWebTokenValue || null;
    } finally {
        webPushInitPromise = null;
    }
    })();

    return lastWebTokenValue || webPushInitPromise;
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

export function hasAndroidFcmToken() {
    if (lastAndroidTokenValue) return true;
    try {
        const stored = localStorage.getItem(LAST_FCM_TOKEN_KEY) || '';
        if (stored) {
            lastAndroidTokenValue = stored;
            return true;
        }
    } catch (_) {}
    return false;
}

function normalizeAndroidReceiveState(receive) {
    if (receive === 'granted') return 'granted';
    if (receive === 'denied') return 'denied';
    return 'default';
}

/** Permiso nativo POST_NOTIFICATIONS + interruptor del sistema. No uses Notification.permission del WebView. */
export async function refreshAndroidNativePermission() {
    if (!isCapacitorAndroid()) return getNotificationPermission();
    let receive = 'default';
    try {
        const perm = await PushNotifications.checkPermissions();
        receive = perm?.receive || 'default';
    } catch (e) {
        console.warn('[push] checkPermissions', e);
    }
    try {
        const SK = registerPlugin('SessionKeepalive');
        const sys = await SK.areNotificationsEnabled?.();
        if (sys && sys.enabled === false) receive = 'denied';
        else if (sys && sys.enabled === true) receive = 'granted';
    } catch (_) {}
    const state = normalizeAndroidReceiveState(receive);
    setAndroidNotificationPermissionCache(state);
    return state;
}

export async function openAndroidNotificationSettings() {
    if (!isCapacitorAndroid()) return false;
    try {
        const SK = registerPlugin('SessionKeepalive');
        if (SK.openNotificationSettings) {
            await SK.openNotificationSettings();
            return true;
        }
        if (SK.openAppSettings) {
            await SK.openAppSettings();
            return true;
        }
    } catch (e) {
        console.warn('[push] openNotificationSettings', e);
    }
    return false;
}

/**
 * Pide permisos para notificaciones emergentes tipo Temu:
 * 1) Notificaciones (Android 13+)
 * 2) Local notifications
 * 3) Full-screen intent / heads-up (Android 14+)
 * 4) Crea canal MAX
 * 5) (opcional) batería sin optimizar
 */
/** Arranca el diálogo nativo en el mismo toque, antes de cualquier await. */
export function beginAndroidNotificationPermissionRequest() {
    if (!isCapacitorAndroid()) return null;
    try {
        return PushNotifications.requestPermissions();
    } catch (_) {
        return null;
    }
}

export async function requestAndroidTemuNotificationPermissions({
    requestFullScreen = true,
    requestBattery = false,
    requestLocal = false
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
        const SK = registerPlugin('SessionKeepalive');
        const sys = await SK.areNotificationsEnabled?.();
        // No pises un diálogo que el usuario todavía no contestó.
        if (result.push === 'prompt' || result.push === 'prompt-with-rationale') {
            // dejar prompt
        } else if (sys && sys.enabled === false) result.push = 'denied';
        else if (sys && sys.enabled === true && result.push === 'granted') result.push = 'granted';
        else if (sys && sys.enabled === true && result.push !== 'denied') result.push = 'granted';
    } catch (_) {}

    // Un segundo diálogo (local / pantalla completa) en el mismo instante
    // cierra el de notificaciones antes de que el conductor toque Permitir.
    if (result.push !== 'granted') {
        result.ok = false;
        return result;
    }

    if (requestLocal) {
        await new Promise((r) => setTimeout(r, 700));
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

    const state = normalizeAndroidReceiveState(result.push);
    setAndroidNotificationPermissionCache(state);
    result.ok = result.push === 'granted';
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
    window.initAndroidFcmPush = initAndroidFcmPush;
    window.initFcmPush = initFcmPush;
    window.refreshAndroidNativePermission = refreshAndroidNativePermission;
    window.openAndroidNotificationSettings = openAndroidNotificationSettings;
    window.pingMyPushFromClient = pingMyPushFromClient;
    window.hasSavedWebPushToken = hasSavedWebPushToken;
    window.hasAndroidFcmToken = hasAndroidFcmToken;
    window.getThisDevicePushTarget = getThisDevicePushTarget;
    window.bootWebPushServiceWorker = bootWebPushServiceWorker;
}

function bindAndroidPushResume() {
    if (androidPushResumeBound || typeof document === 'undefined') return;
    androidPushResumeBound = true;
    const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        refreshAndroidNativePermission().then((state) => {
            if (state !== 'granted') return;
            const { db, appId } = androidPushContext;
            initAndroidFcmPush({
                db,
                appId,
                uid: lastPushUid() || null,
                skipPermissionRequest: true
            }).catch(() => {});
        }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
}

async function persistAndroidToken(tokenValue) {
    if (!tokenValue) return;
    lastAndroidTokenValue = tokenValue;
    claimDevicePushToken(tokenValue, 'android');
    stopAndroidTokenWatchdog();
    const saveUid = lastPushUid() || androidPushContext.uid || null;
    const { db, appId } = androidPushContext;
    if (saveUid && db && appId) {
        await saveFcmToken(db, appId, saveUid, tokenValue, 'android').catch(() => {});
    }
}

function bindAndroidPushListeners() {
    if (androidPushListenersBound || !isCapacitorAndroid()) return;
    androidPushListenersBound = true;

    PushNotifications.addListener('registration', async (token) => {
        const tokenValue = token?.value || null;
        if (!tokenValue) return;
        await persistAndroidToken(tokenValue);
    }).catch((e) => console.warn('[push] registration listener', e));

    PushNotifications.addListener('registrationError', (err) => {
        console.warn('[push] registrationError', err);
    }).catch(() => {});

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
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

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        handleNotificationNavigation(action.notification?.data || {});
    }).catch(() => {});

    try {
        if (LocalNotifications?.addListener) {
            LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
                const extra = action.notification?.extra || {};
                handleNotificationNavigation(extra);
            }).catch(() => {});
        }
    } catch (_) {}

    bindAndroidPushResume();
}

async function waitForAndroidToken(timeoutMs = 10000) {
    if (lastAndroidTokenValue) return lastAndroidTokenValue;
    try {
        const stored = localStorage.getItem(LAST_FCM_TOKEN_KEY) || '';
        if (stored) {
            lastAndroidTokenValue = stored;
            return stored;
        }
    } catch (_) {}
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (lastAndroidTokenValue) return lastAndroidTokenValue;
        await new Promise((r) => setTimeout(r, 200));
    }
    return lastAndroidTokenValue || null;
}

let nativeGetFcmTokenState = 'unknown';

function raceTimeout(promise, ms, fallback) {
    let timer = null;
    return Promise.race([
        Promise.resolve(promise).then(
            (v) => { if (timer) clearTimeout(timer); return v; },
            () => { if (timer) clearTimeout(timer); return fallback; }
        ),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallback), ms);
        })
    ]);
}

function latestStoredFcmToken(map, preferPlatform = '') {
    if (!map || typeof map !== 'object') return null;
    let best = null;
    for (const v of Object.values(map)) {
        const token = typeof v === 'string' ? v : String(v?.token || '');
        if (!token) continue;
        const platform = typeof v === 'object' ? String(v.platform || '') : '';
        const at = typeof v === 'object' ? Number(v.updatedAt) || 0 : 0;
        const pref = preferPlatform && platform === preferPlatform ? 1 : 0;
        const score = pref * 1e15 + at;
        if (!best || score > best.score) best = { token, platform, at, score };
    }
    return best;
}

async function recoverSavedPushTokenFromProfile(db, appId, uid) {
    if (lastAndroidTokenValue || lastWebTokenValue) {
        return lastAndroidTokenValue || lastWebTokenValue;
    }
    try {
        const stored = localStorage.getItem(LAST_FCM_TOKEN_KEY) || '';
        if (stored) {
            const platform = isCapacitorAndroid()
                ? 'android'
                : (localStorage.getItem(LAST_FCM_PLATFORM_KEY) || detectWebPushPlatform());
            claimDevicePushToken(stored, platform);
            return stored;
        }
    } catch (_) {}
    if (!db || !appId || !uid) return '';
    const prefer = isCapacitorAndroid() ? 'android' : detectWebPushPlatform();
    const refs = [
        doc(db, 'artifacts', appId, 'public', 'data', 'users', uid),
        doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data')
    ];
    let best = null;
    for (const ref of refs) {
        try {
            const snap = await getDoc(ref);
            if (!snap.exists()) continue;
            const found = latestStoredFcmToken(snap.data()?.fcmTokens, prefer);
            if (found && (!best || found.score > best.score)) best = found;
        } catch (_) {}
    }
    if (!best?.token) return '';
    const platform = best.platform || prefer;
    claimDevicePushToken(best.token, platform);
    return best.token;
}

async function fetchNativeFcmToken() {
    if (!isCapacitorAndroid()) return '';
    if (nativeGetFcmTokenState === 'missing') return '';
    try {
        const SK = registerPlugin('SessionKeepalive');
        const res = await raceTimeout(SK.getFcmToken(), 8000, null);
        if (!res) return '';
        nativeGetFcmTokenState = 'ok';
        return String(res?.token || '').trim();
    } catch (e) {
        const msg = String(e?.message || e || '');
        if (/unimplemented|not implemented|unavailable/i.test(msg)) {
            nativeGetFcmTokenState = 'missing';
        }
        return '';
    }
}

let androidTokenWatchdog = null;
let androidTokenWatchdogBusy = false;

function stopAndroidTokenWatchdog() {
    if (androidTokenWatchdog) {
        clearInterval(androidTokenWatchdog);
        androidTokenWatchdog = null;
    }
    androidTokenWatchdogBusy = false;
}

async function forceAndroidRegister() {
    bindAndroidPushListeners();
    try {
        await PushNotifications.register();
    } catch (e) {
        console.warn('[push] force register', e);
    }
}

function startAndroidTokenWatchdog() {
    if (!isCapacitorAndroid() || androidTokenWatchdog) return;
    let attempt = 0;
    androidTokenWatchdog = setInterval(() => {
        if (lastAndroidTokenValue || hasAndroidFcmToken()) {
            stopAndroidTokenWatchdog();
            persistAndroidToken(lastAndroidTokenValue).catch(() => {});
            return;
        }
        if (androidTokenWatchdogBusy) return;
        androidTokenWatchdogBusy = true;
        attempt += 1;
        (async () => {
            try {
                const perm = await refreshAndroidNativePermission();
                if (perm === 'denied') {
                    stopAndroidTokenWatchdog();
                    return;
                }
                const native = await fetchNativeFcmToken();
                if (native) {
                    await persistAndroidToken(native);
                    stopAndroidTokenWatchdog();
                    return;
                }
                await forceAndroidRegister();
            } catch (e) {
                console.warn('[push] token watchdog', e);
            } finally {
                androidTokenWatchdogBusy = false;
            }
        })();
        if (attempt >= 36) stopAndroidTokenWatchdog();
    }, 4000);
}

/** Si el permiso ya está, no pide nada: registra FCM hasta que quede el token. */
export async function ensureAndroidPushToken({ db, appId, uid } = {}) {
    if (!isCapacitorAndroid()) return lastAndroidTokenValue || null;
    if (!isAndroidFcmConfigured()) return lastAndroidTokenValue || null;
    if (db && appId) androidPushContext = { db, appId, uid: uid || androidPushContext.uid || lastPushUid() || null };
    if (uid) rememberPushUid(uid);
    bindAndroidPushListeners();

    if (lastAndroidTokenValue || hasAndroidFcmToken()) {
        await persistAndroidToken(lastAndroidTokenValue);
        return lastAndroidTokenValue;
    }

    const recovered = await recoverSavedPushTokenFromProfile(
        androidPushContext.db,
        androidPushContext.appId,
        lastPushUid() || uid || null
    ).catch(() => '');
    if (recovered) {
        await persistAndroidToken(recovered);
        forceAndroidRegister().catch(() => {});
        return recovered;
    }

    const native = await fetchNativeFcmToken();
    if (native) {
        await persistAndroidToken(native);
        return native;
    }

    const fromInit = await initAndroidFcmPush({
        db: androidPushContext.db,
        appId: androidPushContext.appId,
        uid: lastPushUid() || uid || null,
        skipPermissionRequest: true
    }).catch(() => null);

    if (fromInit || lastAndroidTokenValue) return fromInit || lastAndroidTokenValue;

    startAndroidTokenWatchdog();
    const waited = await waitForAndroidToken(18000);
    if (waited) return waited;
    startAndroidTokenWatchdog();
    return lastAndroidTokenValue || null;
}

if (typeof window !== 'undefined') {
    window.ensureAndroidPushToken = ensureAndroidPushToken;
    if (isCapacitorAndroid()) {
        try {
            const stored = localStorage.getItem(LAST_FCM_TOKEN_KEY) || '';
            if (stored) lastAndroidTokenValue = stored;
        } catch (_) {}
        try { bindAndroidPushListeners(); } catch (_) {}
    }
}

/** APK Android: push nativo vía Capacitor. No registra SW ni toca tokens web. */
export async function initAndroidFcmPush({ db, appId, uid, skipPermissionRequest = false } = {}) {
    if (!isCapacitorAndroid()) return null;
    if (!isAndroidFcmConfigured()) {
        console.warn('initAndroidFcmPush: falta google-services.json para honduraite.com');
        return null;
    }
    if (db && appId) {
        androidPushContext = { db, appId, uid: uid || androidPushContext.uid || lastPushUid() || null };
    }
    const tokenUid = uid || lastPushUid() || androidPushContext.uid || null;
    if (tokenUid) rememberPushUid(tokenUid);

    bindAndroidPushListeners();

    await recoverSavedPushTokenFromProfile(
        androidPushContext.db,
        androidPushContext.appId,
        tokenUid
    ).catch(() => '');
    if (lastAndroidTokenValue) {
        persistAndroidToken(lastAndroidTokenValue).catch(() => {});
    }
    if (androidPushInitPromise) {
        return lastAndroidTokenValue || androidPushInitPromise;
    }

    androidPushInitPromise = (async () => {
        try {
            let nativePerm = await refreshAndroidNativePermission();
            if (nativePerm !== 'granted') {
                if (skipPermissionRequest) {
                    if (lastAndroidTokenValue) {
                        await persistAndroidToken(lastAndroidTokenValue);
                    }
                    const nativeTok = await fetchNativeFcmToken();
                    if (nativeTok) {
                        await persistAndroidToken(nativeTok);
                        return nativeTok;
                    }
                    if (nativePerm !== 'denied') {
                        try { await PushNotifications.register(); } catch (_) {}
                        const skippedTok = await waitForAndroidToken(8000);
                        if (skippedTok) {
                            await persistAndroidToken(skippedTok);
                            return skippedTok;
                        }
                    }
                    startAndroidTokenWatchdog();
                    return lastAndroidTokenValue || null;
                }
                const temu = await requestAndroidTemuNotificationPermissions({
                    requestFullScreen: false,
                    requestBattery: false
                });
                nativePerm = await refreshAndroidNativePermission();
                if (nativePerm !== 'granted' && temu.push !== 'granted') {
                    startAndroidTokenWatchdog();
                    return lastAndroidTokenValue || null;
                }
            } else {
                await ensureAndroidPushChannels();
            }

            const nativeTok = await fetchNativeFcmToken();
            if (nativeTok) {
                await persistAndroidToken(nativeTok);
                androidPushInitialized = true;
                return nativeTok;
            }

            try {
                await PushNotifications.register();
            } catch (e) {
                console.warn('[push] register', e);
            }

            let token = await waitForAndroidToken(
                lastAndroidTokenValue ? 2500 : 14000
            );
            if (!token) {
                try { await PushNotifications.register(); } catch (_) {}
                token = await waitForAndroidToken(8000);
            }
            if (token) await persistAndroidToken(token);
            else startAndroidTokenWatchdog();
            androidPushInitialized = true;
            return token || lastAndroidTokenValue || null;
        } catch (e) {
            console.warn('initAndroidFcmPush:', e);
            return lastAndroidTokenValue || null;
        } finally {
            androidPushInitPromise = null;
        }
    })();

    return lastAndroidTokenValue || androidPushInitPromise;
}

/**
 * Pantalla de login / sesión cerrada: hay que seguir recibiendo el aviso de viaje.
 * El token ya quedó en el conductor; aquí solo se escucha y se pinta el banner.
 * No pide permiso (eso es al entrar a la cuenta) y NO bloquea un registro posterior.
 */
export async function initClosedSessionPushReceiver({ db, appId, firebaseConfig, vapidKey } = {}) {
    const uid = lastPushUid();
    closedSessionPushBooted = true;
    if (isCapacitorAndroid()) {
        return initAndroidFcmPush({
            db,
            appId,
            uid: uid || null,
            skipPermissionRequest: true
        }).catch(() => null);
    }
    if (isCapacitorNative()) return null;
    if (onMessageBound) return lastWebTokenValue || 'ready';
    try {
        await initTripNotifications();
    } catch (_) {}
    if (!uid || !firebaseConfig) return uid ? null : 'sw';
    if (isIOS() && !canReceiveBackgroundWebPush()) return null;
    return initFcmPush({
        firebaseConfig,
        vapidKey: vapidKey || '',
        db,
        appId,
        uid
    }).catch(() => null);
}
