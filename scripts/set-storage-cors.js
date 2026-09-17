/**
 * Aplica cors.json al bucket de Firebase Storage usando el token de `firebase login`.
 * No imprime tokens.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const BUCKET = 'comedor-86278.firebasestorage.app';
const CLIENT_ID = '563584335930-as0ifsdhui63qmf95aqlnr7e58f8atfk.apps.googleusercontent.com';
const CLIENT_SECRET = 'jEQC9BkYnK3uiCjcTG0uXgql';

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function request(url, { method = 'GET', headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method,
            headers,
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = text ? JSON.parse(text) : null; } catch (_) {}
                resolve({ status: res.statusCode, text, json });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    }).toString();
    const res = await request('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        body,
    });
    if (res.status !== 200 || !res.json?.access_token) {
        throw new Error(`No se pudo refrescar el token (${res.status})`);
    }
    return res.json.access_token;
}

async function getAccessToken() {
    const cfgPath = path.join(process.env.USERPROFILE || process.env.HOME, '.config', 'configstore', 'firebase-tools.json');
    const cfg = readJson(cfgPath);
    const tokens = cfg.tokens || {};
    if (tokens.access_token && tokens.expires_at && Date.now() < Number(tokens.expires_at) - 60_000) {
        return tokens.access_token;
    }
    if (!tokens.refresh_token) throw new Error('No hay refresh_token de Firebase CLI. Ejecuta firebase login.');
    return refreshAccessToken(tokens.refresh_token);
}

async function main() {
    const cors = readJson(path.join(ROOT, 'cors.json'));
    const token = await getAccessToken();
    const auth = { Authorization: `Bearer ${token}` };

    const current = await request(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}?fields=name,cors`,
        { headers: auth }
    );
    if (current.status === 403 || current.status === 401) {
        console.error(`Sin permiso para leer el bucket (${current.status}).`);
        process.exit(2);
    }
    if (current.status !== 200) {
        console.error(`Error al leer bucket (${current.status}):`, current.json?.error?.message || current.text.slice(0, 300));
        process.exit(1);
    }

    const patchBody = JSON.stringify({ cors });
    const patched = await request(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}?fields=name,cors`,
        {
            method: 'PATCH',
            headers: {
                ...auth,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(patchBody),
            },
            body: patchBody,
        }
    );
    if (patched.status !== 200) {
        console.error(`Error al aplicar CORS (${patched.status}):`, patched.json?.error?.message || patched.text.slice(0, 400));
        process.exit(1);
    }
    const origins = (patched.json?.cors || []).flatMap((r) => r.origin || []);
    console.log(`CORS aplicado en gs://${BUCKET}`);
    console.log(`Orígenes: ${origins.join(', ') || '(vacío)'}`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
