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
const VERSION = '2026.07.11.2';
const TITLE = 'HonduRaite · Nueva versión disponible';
const BODY =
    `Actualización ${VERSION}: más espacio arriba en admin, conductor y pasajero (ya no choca con notificaciones), nombres reales del mapa en A/B, y texto de flota corregido. Abre o actualiza la app. ¡Gracias!`;

initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID
});

const db = getFirestore();
const messaging = getMessaging();
const PUSH_ICON = `https://${PROJECT_ID}.web.app/icons/icon-192.png`;

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
            version: VERSION
        },
        webpush: {
            headers: { Urgency: 'high' },
            notification: {
                icon: PUSH_ICON,
                requireInteraction: true,
                renotify: true,
                tag: `app-update-${VERSION}`
            },
            fcmOptions: { link: '/' }
        },
        android: {
            priority: 'high',
            notification: {
                channelId: 'hondu_ride_alerts_v2',
                sound: 'default',
                defaultSound: true,
                priority: 'high',
                visibility: 'public',
                defaultVibrateTimings: false,
                vibrateTimingsMillis: [0, 350, 100, 350, 100, 500]
            }
        },
        apns: {
            headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
            payload: { aps: { sound: 'default' } }
        }
    };
    const res = await messaging.sendEachForMulticast(payload);
    return { success: res.successCount, failure: res.failureCount };
}

async function main() {
    console.log('Broadcast nueva versión →', PROJECT_ID, VERSION);
    const usersSnap = await db.collection(`artifacts/${APP_ID}/public/data/users`).get();
    console.log('Usuarios en Firestore:', usersSnap.size);

    await db.collection(`artifacts/${APP_ID}/public/data/notifications`).add({
        targetRole: 'all',
        title: TITLE,
        body: BODY,
        message: `${TITLE} — ${BODY}`,
        broadcast: true,
        broadcastPush: true,
        pushDispatched: true,
        type: 'app_update',
        version: VERSION,
        sentBy: 'system',
        sentByName: 'HonduRaite',
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: Date.now()
    });
    console.log('Aviso en campana (notificaciones) creado para todos.');

    let pushedUsers = 0;
    let successTotal = 0;
    let failureTotal = 0;
    let noToken = 0;

    for (const doc of usersSnap.docs) {
        const tokens = await getUserTokens(doc.id);
        if (!tokens.length) {
            noToken += 1;
            continue;
        }
        try {
            const r = await sendPush(doc.id, tokens);
            pushedUsers += 1;
            successTotal += r.success;
            failureTotal += r.failure;
            console.log(`  ${doc.id.slice(0, 8)}… tokens=${tokens.length} ok=${r.success} fail=${r.failure}`);
        } catch (e) {
            failureTotal += 1;
            console.warn(`  ERROR ${doc.id}:`, e.message || e);
        }
    }

    console.log('---');
    console.log(JSON.stringify({
        totalUsers: usersSnap.size,
        pushedUsers,
        noToken,
        fcmSuccess: successTotal,
        fcmFailure: failureTotal,
        version: VERSION
    }, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
