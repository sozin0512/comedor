/**
 * Repara androidApkVersionCode en appSettings y avisa por FCM.
 *
 * Uso (desde carpeta functions, con ADC / GOOGLE_APPLICATION_CREDENTIALS):
 *   node scripts/repair-apk-update.js
 *   node scripts/repair-apk-update.js --notify
 *   node scripts/repair-apk-update.js --version=2026.07.30.6 --notify
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const PROJECT_ID = 'comedor-86278';
const APP_ID = 'comayagua-vip-pro-v4';

function versionLabelToCode(label) {
    const s = String(label || '').trim();
    const m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\.(\d{1,3})$/);
    if (m) {
        return (
            Number(m[1]) * 1000000
            + Number(m[2]) * 10000
            + Number(m[3]) * 100
            + Number(m[4])
        );
    }
    const digits = s.replace(/\D/g, '');
    if (!digits) return 0;
    return Number(digits.length > 12 ? digits.slice(0, 12) : digits) || 0;
}

const args = process.argv.slice(2);
const doNotify = args.includes('--notify');
const versionArg = (args.find((a) => a.startsWith('--version=')) || '').split('=')[1] || '';

initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
});

const db = getFirestore();
const messaging = getMessaging();
const settingsRef = db.doc(`artifacts/${APP_ID}/public/data/appSettings/main`);

async function getAllTokens() {
    const snap = await db.collection(`artifacts/${APP_ID}/public/data/users`).get();
    const tokens = [];
    snap.forEach((docSnap) => {
        const raw = docSnap.data()?.fcmTokens || {};
        Object.values(raw).forEach((entry) => {
            const t = typeof entry === 'string' ? entry : entry?.token;
            if (t) tokens.push(t);
        });
    });
    return [...new Set(tokens)];
}

async function notifyAll(version, versionCode) {
    const tokens = await getAllTokens();
    console.log(`Tokens FCM: ${tokens.length}`);
    if (!tokens.length) return { success: 0, failure: 0 };

    const TITLE = 'HonduRaite Â· Actualiza la app';
    const BODY = `Hay una nueva versiÃ³n (${version || versionCode}). Ãbrela e instala la actualizaciÃ³n para seguir recibiendo viajes.`;
    const TEMU_CHANNEL = 'hondu_temu_all_v6';
    const PUSH_ICON = `https://${PROJECT_ID}.web.app/icons/icon-192.png`;

    let success = 0;
    let failure = 0;
    const chunk = 500;
    for (let i = 0; i < tokens.length; i += chunk) {
        const batch = tokens.slice(i, i + chunk);
        const res = await messaging.sendEachForMulticast({
            tokens: batch,
            notification: { title: TITLE, body: BODY },
            data: {
                type: 'app_update',
                title: TITLE,
                body: BODY,
                tag: `app-update-${version || versionCode || Date.now()}`,
                version: String(version || ''),
                versionCode: String(versionCode || ''),
                superVibrate: 'true',
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: TEMU_CHANNEL,
                    sound: 'hondu_ride',
                    priority: 'max',
                    visibility: 'public',
                    sticky: true,
                },
            },
            webpush: {
                headers: { Urgency: 'high' },
                notification: {
                    icon: PUSH_ICON,
                    requireInteraction: true,
                    tag: `app-update-${version || versionCode}`,
                },
                fcmOptions: { link: '/' },
            },
        });
        success += res.successCount;
        failure += res.failureCount;
        console.log(`  lote ${i / chunk + 1}: ok=${res.successCount} fail=${res.failureCount}`);
    }
    return { success, failure };
}

async function main() {
    const snap = await settingsRef.get();
    if (!snap.exists) {
        console.error('No existe appSettings/main. Sube un APK desde Admin primero.');
        process.exit(1);
    }
    const d = snap.data() || {};
    console.log('--- ANTES ---');
    console.log({
        androidApkUrl: d.androidApkUrl ? String(d.androidApkUrl).slice(0, 80) + 'â€¦' : null,
        androidApkVersion: d.androidApkVersion || null,
        androidApkVersionCode: d.androidApkVersionCode ?? null,
        androidApkBuildId: d.androidApkBuildId ?? null,
        androidApkFileName: d.androidApkFileName || null,
    });

    if (!d.androidApkUrl) {
        console.error('No hay androidApkUrl. Publica un APK en Admin primero.');
        process.exit(1);
    }

    const version = String(versionArg || d.androidApkVersion || '').trim();
    const correctCode = versionLabelToCode(version);
    if (!version || !correctCode) {
        console.error('No se pudo calcular versionCode. Pasa --version=2026.07.30.6');
        process.exit(1);
    }

    const patch = {
        androidApkVersion: version,
        androidApkVersionCode: correctCode,
        androidApkUpdateSignal: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
    };
    // Si no hay buildId, crear uno nuevo para que clientes vean â€œpublicaciÃ³n nuevaâ€
    if (!d.androidApkBuildId) {
        patch.androidApkBuildId = Date.now();
    }

    await settingsRef.set(patch, { merge: true });

    const after = (await settingsRef.get()).data() || {};
    console.log('--- DESPUÃ‰S ---');
    console.log({
        androidApkVersion: after.androidApkVersion,
        androidApkVersionCode: after.androidApkVersionCode,
        androidApkBuildId: after.androidApkBuildId,
        androidApkUpdateSignal: after.androidApkUpdateSignal,
    });
    console.log(
        `OK: versionCode forzado a ${correctCode}. ` +
        `Un telÃ©fono con code < ${correctCode} deberÃ­a ver update (si su JS compara versionCode).`
    );

    if (doNotify) {
        console.log('Enviando FCM app_updateâ€¦');
        const r = await notifyAll(version, correctCode);
        console.log('FCM total:', r);
    } else {
        console.log('Sin FCM. Para avisar a todos: node scripts/repair-apk-update.js --notify');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
