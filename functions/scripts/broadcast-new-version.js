/**
 * One-shot: aviso de nueva versión a TODOS los usuarios con FCM token.
 * Uso (desde carpeta functions, con firebase login / ADC):
 *   node scripts/broadcast-new-version.js
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const PROJECT_ID = 'comedor-86278';
const APP_ID = 'comayagua-vip-pro-v4';
const VERSION = '2026.07.16.1';
const TITLE = 'HonduRaite · Nueva versión disponible';
const BODY =
    `Actualización ${VERSION}: notificaciones emergentes tipo Temu, viajes programados (negociar → reservar → avisos 1h/30/10/5 min + botón iniciar YA), subir tarifa si nadie responde, contraoferta solo la acepta el conductor, y más. Actualiza la web o instala la APK. ¡Gracias!`;

initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID
});

const db = getFirestore();
const messaging = getMessaging();
const PUSH_ICON = `https://${PROJECT_ID}.web.app/icons/icon-192.png`;
const TEMU_CHANNEL = 'hondu_temu_all_v6';

async function getUserTokens(uid) {
    const snap = await db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`).get();
    if (!snap.exists) return [];
    const raw = snap.data().fcmTokens || {};
    return Object.values(raw)
        .map((entry) => (typeof entry === 'string' ? entry : entry?.token))
        .filter(Boolean);
}

async function sendPush(uid, tokens) {
    if (!tokens.length) return { success: 0, failure: 0 };
    const payload = {
        tokens,
        notification: { title: TITLE, body: BODY },
        data: {
            type: 'app_update',
            title: TITLE,
            body: BODY,
            tag: `app-update-${VERSION}`,
            version: VERSION,
            superVibrate: 'true'
        },
        webpush: {
            headers: { Urgency: 'high' },
            notification: {
                icon: PUSH_ICON,
                requireInteraction: true,
                renotify: true,
                tag: `app-update-${VERSION}`,
                vibrate: [0, 500, 80, 500, 80, 600, 100, 800]
            },
            fcmOptions: { link: '/' }
        },
        android: {
            priority: 'high',
            notification: {
                channelId: TEMU_CHANNEL,
                sound: 'hondu_ride',
                defaultSound: false,
                priority: 'max',
                visibility: 'public',
                sticky: true,
                defaultVibrateTimings: false,
                vibrateTimingsMillis: [0, 500, 80, 500, 80, 600, 100, 800, 80, 1000]
            }
        },
        apns: {
            headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
            payload: { aps: { sound: 'default', 'interruption-level': 'time-sensitive' } }
        }
    };
    const res = await messaging.sendEachForMulticast(payload);
    return { success: res.successCount, failure: res.failureCount };
}

async function main() {
    console.log('Broadcast nueva versión →', PROJECT_ID, VERSION);
    const usersSnap = await db.collection(`artifacts/${APP_ID}/public/data/users`).get();
    let totalUsers = 0;
    let totalOk = 0;
    let totalFail = 0;
    let withTokens = 0;

    // Notificación en feed de la app (campana)
    try {
        await db.collection(`artifacts/${APP_ID}/public/data/notifications`).add({
            title: TITLE,
            body: BODY,
            type: 'app_update',
            tag: `app-update-${VERSION}`,
            version: VERSION,
            broadcastPush: true,
            sendPush: true,
            createdAt: FieldValue.serverTimestamp(),
            targetRole: 'all'
        });
        console.log('Notificación en feed (notifications) creada.');
    } catch (e) {
        console.warn('No se pudo escribir en notifications:', e.message);
    }

    for (const doc of usersSnap.docs) {
        totalUsers++;
        const tokens = await getUserTokens(doc.id);
        if (!tokens.length) continue;
        withTokens++;
        try {
            const r = await sendPush(doc.id, tokens);
            totalOk += r.success;
            totalFail += r.failure;
            if (withTokens % 25 === 0) {
                console.log(`… ${withTokens} usuarios con token | ok=${totalOk} fail=${totalFail}`);
            }
        } catch (e) {
            totalFail += tokens.length;
            console.warn('push fail', doc.id, e.message);
        }
    }

    console.log('Listo.', {
        totalUsers,
        withTokens,
        pushOk: totalOk,
        pushFail: totalFail,
        version: VERSION
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
