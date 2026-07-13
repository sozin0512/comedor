/**
 * Lectura de Firestore con el token de `firebase login` (firebase-tools).
 * No requiere service account ni GOOGLE_APPLICATION_CREDENTIALS.
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function configPath() {
    const candidates = [
        path.join(process.env.HOME || '', '.config', 'configstore', 'firebase-tools.json'),
        path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json'),
        path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json')
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    // Prefer Windows-friendly default for error messages
    return (
        candidates.find((p) => p.includes('.config')) ||
        path.join(process.env.USERPROFILE || process.env.HOME || '', '.config', 'configstore', 'firebase-tools.json')
    );
}

function request(method, url, headers = {}, body = null) {
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
    try {
        const api = require(path.join(
            process.env.APPDATA || '',
            'npm/node_modules/firebase-tools/lib/api.js'
        ));
        if (typeof api.clientId === 'function' && typeof api.clientSecret === 'function') {
            return { clientId: api.clientId(), clientSecret: api.clientSecret() };
        }
    } catch (_) {
        /* fallback abajo */
    }
    return {
        clientId: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        clientSecret: 'FAKESECRET_m4n5o6p7q8r9s0t1u2v3'
    };
}

async function getAccessToken() {
    const cfgPath = configPath();
    if (!fs.existsSync(cfgPath)) {
        throw new Error('No hay sesión de Firebase. Ejecuta: firebase login');
    }
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const tokens = cfg.tokens || {};
    let access = tokens.access_token;
    const exp = Number(tokens.expires_at || 0);
    if (access && Date.now() < exp - 60000) return access;

    if (!tokens.refresh_token) {
        throw new Error('Token de Firebase inválido. Ejecuta: firebase login');
    }

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
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    return j.access_token;
}

function decodeFirestoreValue(v) {
    if (v == null) return null;
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return Number(v.doubleValue);
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.timestampValue !== undefined) return v.timestampValue;
    if (v.mapValue?.fields) {
        const o = {};
        for (const [k, val] of Object.entries(v.mapValue.fields)) {
            o[k] = decodeFirestoreValue(val);
        }
        return o;
    }
    if (v.arrayValue?.values) {
        return v.arrayValue.values.map(decodeFirestoreValue);
    }
    return null;
}

function decodeDocument(doc) {
    const fields = doc.fields || {};
    const data = {};
    for (const [k, v] of Object.entries(fields)) {
        data[k] = decodeFirestoreValue(v);
    }
    const parts = String(doc.name || '').split('/');
    data.__id = parts[parts.length - 1] || '';
    return data;
}

/**
 * Lista todos los documentos de una colección (paginado).
 * collectionPath: ej. artifacts/APP/public/data/users
 */
export async function listAllDocuments(projectId, collectionPath, { quiet = false } = {}) {
    const access = await getAccessToken();
    const base =
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/` +
        collectionPath.replace(/^\/+|\/+$/g, '');

    const docs = [];
    let pageToken = '';
    do {
        const url = new URL(base);
        url.searchParams.set('pageSize', '300');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await request('GET', url.toString(), {
            Authorization: `Bearer ${access}`
        });
        if (res.status >= 300) {
            // colección vacía / aún no creada
            if (res.status === 404) return [];
            throw new Error(`Firestore HTTP ${res.status}: ${res.body}`);
        }
        const json = JSON.parse(res.body || '{}');
        for (const doc of json.documents || []) {
            docs.push(decodeDocument(doc));
        }
        pageToken = json.nextPageToken || '';
        if (!quiet) {
            process.stdout.write(`\r  documentos leídos: ${docs.length}${pageToken ? '…' : '   '}`);
        }
    } while (pageToken);

    if (!quiet && docs.length) process.stdout.write('\n');
    return docs;
}

function encodeValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
        if (Number.isInteger(v) && Math.abs(v) < Number.MAX_SAFE_INTEGER) {
            return { integerValue: String(v) };
        }
        return { doubleValue: v };
    }
    if (Array.isArray(v)) {
        return { arrayValue: { values: v.map(encodeValue) } };
    }
    if (typeof v === 'object') {
        const fields = {};
        for (const [k, val] of Object.entries(v)) {
            fields[k] = encodeValue(val);
        }
        return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
}

function encodeFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj || {})) {
        fields[k] = encodeValue(v);
    }
    return fields;
}

/**
 * PATCH merge de un documento (crea si no existe con updateMask + allowMissing vía PATCH fields).
 * docPath: artifacts/APP/public/data/whatsapp_campaigns/ID
 */
export async function patchDocument(projectId, docPath, data) {
    const access = await getAccessToken();
    const keys = Object.keys(data || {});
    if (!keys.length) return;
    const base =
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/` +
        docPath.replace(/^\/+|\/+$/g, '');
    const url = new URL(base);
    for (const k of keys) url.searchParams.append('updateMask.fieldPaths', k);
    // permite crear el doc si no existe
    url.searchParams.set('currentDocument.exists', 'false');
    // Actually currentDocument.exists=false fails if exists. Better use update without exists check.
    // Remove exists constraint:
    url.searchParams.delete('currentDocument.exists');

    const res = await request(
        'PATCH',
        url.toString(),
        {
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json'
        },
        JSON.stringify({ fields: encodeFields(data) })
    );
    if (res.status >= 300) {
        throw new Error(`Firestore PATCH ${res.status}: ${res.body}`);
    }
    return JSON.parse(res.body || '{}');
}

export async function getDocument(projectId, docPath) {
    const access = await getAccessToken();
    const url =
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/` +
        docPath.replace(/^\/+|\/+$/g, '');
    const res = await request('GET', url, { Authorization: `Bearer ${access}` });
    if (res.status === 404) return null;
    if (res.status >= 300) {
        throw new Error(`Firestore GET ${res.status}: ${res.body}`);
    }
    return decodeDocument(JSON.parse(res.body || '{}'));
}

/** Lista con filtro simple client-side (REST structured query es más pesado). */
export async function listQueuedCampaigns(projectId, appId) {
    const docs = await listAllDocuments(
        projectId,
        `artifacts/${appId}/public/data/whatsapp_campaigns`,
        { quiet: true }
    );
    return docs
        .filter((d) => d.status === 'queued')
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
}
