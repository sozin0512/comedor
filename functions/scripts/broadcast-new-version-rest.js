/**
 * Broadcast nueva versión usando el token de firebase-tools (login local).
 * Crea un doc en notifications con broadcastPush=true → onNotificationBroadcastPush.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const VERSION = '2026.07.13.2';
const TITLE = 'HonduRaite · Nueva versión disponible';
const BODY =
    `Actualización ${VERSION}: viaje activo estilo Uber (GPS + notificación \"Viaje en curso\" en segundo plano), tonos APK, PIN en mapa, y más. Actualiza web o instala la APK. ¡Gracias!`;
const APP_ID = 'comayagua-vip-pro-v4';
const PROJECT = 'comedor-86278';
const CFG_PATH = path.join(
    process.env.USERPROFILE || process.env.HOME,
    '.config',
    'configstore',
    'firebase-tools.json'
);

function request(method, url, headers, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request(
            {
                method,
                hostname: u.hostname,
                path: u.pathname + u.search,
                headers
            },
            (res) => {
                let d = '';
                res.on('data', (c) => {
                    d += c;
                });
                res.on('end', () => resolve({ status: res.statusCode, body: d }));
            }
        );
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function loadFirebaseToolsOAuth() {
    // Preferir clientSecret del firebase-tools instalado (cambia entre versiones)
    try {
        const api = require(path.join(
            process.env.APPDATA || '',
            'npm/node_modules/firebase-tools/lib/api.js'
        ));
        if (typeof api.clientId === 'function' && typeof api.clientSecret === 'function') {
            return { clientId: api.clientId(), clientSecret: api.clientSecret() };
        }
    } catch (_) {}
    return {
        clientId: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        clientSecret: 'FAKESECRET_m4n5o6p7q8r9s0t1u2v3'
    };
}

async function getAccessToken(cfg) {
    const tokens = cfg.tokens || {};
    let access = tokens.access_token;
    const exp = Number(tokens.expires_at || 0);
    if (access && Date.now() < exp - 60000) return access;

    console.log('Refrescando token de Firebase…');
    const { clientId, clientSecret } = loadFirebaseToolsOAuth();
    const form = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token'
    });
    const r = await request(
        'POST',
        'https://oauth2.googleapis.com/token',
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        form.toString()
    );
    const j = JSON.parse(r.body || '{}');
    if (!j.access_token) {
        throw new Error(`No se pudo refrescar token: ${r.body}`);
    }
    cfg.tokens.access_token = j.access_token;
    cfg.tokens.expires_at = Date.now() + (j.expires_in || 3600) * 1000;
    fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
    return j.access_token;
}

async function main() {
    if (!fs.existsSync(CFG_PATH)) {
        throw new Error('No hay firebase-tools.json. Ejecuta: firebase login');
    }
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    const access = await getAccessToken(cfg);
    const now = Date.now();

    const doc = {
        fields: {
            targetRole: { stringValue: 'all' },
            title: { stringValue: TITLE },
            body: { stringValue: BODY },
            message: { stringValue: `${TITLE} — ${BODY}` },
            broadcast: { booleanValue: true },
            broadcastPush: { booleanValue: true },
            type: { stringValue: 'app_update' },
            version: { stringValue: VERSION },
            tag: { stringValue: `app-update-${VERSION}` },
            sentBy: { stringValue: 'system' },
            sentByName: { stringValue: 'HonduRaite' },
            createdAtMs: { integerValue: String(now) }
        }
    };

    const url =
        `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/` +
        `artifacts/${APP_ID}/public/data/notifications`;

    console.log('Creando anuncio de versión', VERSION, '…');
    const res = await request(
        'POST',
        url,
        {
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json'
        },
        JSON.stringify(doc)
    );

    console.log('HTTP', res.status);
    if (res.status >= 300) {
        console.error(res.body);
        process.exit(1);
    }

    let name = '';
    try {
        name = JSON.parse(res.body).name || '';
    } catch (_) {}
    console.log('Documento:', name || '(ok)');
    console.log('OK: campana creada. La Cloud Function onNotificationBroadcastPush envía el push a todos.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
