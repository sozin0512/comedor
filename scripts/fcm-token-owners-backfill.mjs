/**
 * Tokens FCM repetidos en varias cuentas (mismo celular/navegador usado con dos cuentas).
 * Arma el índice artifacts/<app>/fcm_token_owners/<sha256(token)> y deja cada token
 * SOLO en la cuenta que lo guardó más reciente (updatedAt mayor).
 *
 * Por defecto SOLO MUESTRA (dry-run). Para escribir hace falta --apply.
 * NO correr contra producción sin aprobación de Josue.
 *
 * Uso (raíz del repo, credenciales admin: gcloud auth application-default login):
 *   cd functions && npm install && cd ..
 *   node scripts/fcm-token-owners-backfill.mjs            # dry-run: cuántos repetidos
 *   node scripts/fcm-token-owners-backfill.mjs --apply    # índice + borrar copias viejas
 * Opciones: --project comedor-86278  --app comayagua-vip-pro-v4
 * Con FIRESTORE_EMULATOR_HOST definido escribe en el emulador.
 * Nunca imprime tokens completos ni nombres: solo uid y los últimos 8 caracteres.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(ROOT, 'functions', 'package.json'));
const admin = req('firebase-admin');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const PROJECT = arg('--project', 'comedor-86278');
const APP = arg('--app', 'comayagua-vip-pro-v4');
const PREFIX = 'fcmTokens.';

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

function entriesOf(data) {
    const out = [];
    const map = data?.fcmTokens;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
        for (const [key, v] of Object.entries(map)) {
            const token = typeof v === 'string' ? v : (v?.token || '');
            if (token) out.push({ key, token, updatedAt: Number(v?.updatedAt) || 0, platform: v?.platform || '' });
        }
    }
    for (const [k, v] of Object.entries(data || {})) {
        if (!k.startsWith(PREFIX) || !v) continue;
        const token = typeof v === 'string' ? v : (v?.token || '');
        if (token) out.push({ key: k.slice(PREFIX.length), token, updatedAt: Number(v?.updatedAt) || 0, platform: v?.platform || '' });
    }
    return out;
}

const users = await db.collection(`artifacts/${APP}/public/data/users`).get();
const byToken = new Map(); // token -> Map(uid -> {updatedAt, platform, key})
for (const u of users.docs) {
    const priv = await db.doc(`artifacts/${APP}/users/${u.id}/profile/data`).get().catch(() => null);
    for (const e of [...entriesOf(u.data()), ...entriesOf(priv?.exists ? priv.data() : {})]) {
        const owners = byToken.get(e.token) || new Map();
        const prev = owners.get(u.id);
        if (!prev || e.updatedAt > prev.updatedAt) owners.set(u.id, e);
        byToken.set(e.token, owners);
    }
}

let shared = 0;
let removals = 0;
const byPlatform = {};
for (const [token, owners] of byToken) {
    const ranked = [...owners.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    const [keepUid, keepE] = ranked[0];
    if (ranked.length > 1) {
        shared += 1;
        byPlatform[keepE.platform || '?'] = (byPlatform[keepE.platform || '?'] || 0) + 1;
        console.log(`repetido tok=…${token.slice(-8)} plat=${keepE.platform || '?'} queda=${keepUid} quitar=${ranked.slice(1).map(([id]) => id).join(',')}`);
    }
    if (!APPLY) { removals += ranked.length - 1; continue; }
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await db.doc(`artifacts/${APP}/fcm_token_owners/${hash}`).set({ uid: keepUid, platform: keepE.platform || '', updatedAt: Date.now() }, { merge: true });
    for (const [uid, e] of ranked.slice(1)) {
        for (const ref of [db.doc(`artifacts/${APP}/public/data/users/${uid}`), db.doc(`artifacts/${APP}/users/${uid}/profile/data`)]) {
            await ref.update(`fcmTokens.${e.key}`, admin.firestore.FieldValue.delete(),
                new admin.firestore.FieldPath(`${PREFIX}${e.key}`), admin.firestore.FieldValue.delete()).catch(() => {});
        }
        removals += 1;
    }
}
console.log(`usuarios=${users.size} tokens=${byToken.size} repetidos=${shared} ${APPLY ? 'quitados' : 'se quitarían'}=${removals} porPlataforma=${JSON.stringify(byPlatform)}`);
if (!APPLY) console.log('Dry-run: no se escribió nada. Agrega --apply para aplicar.');
