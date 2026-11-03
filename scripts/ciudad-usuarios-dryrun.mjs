/**
 * v.42 Ciudad de usuarios — SOLO LECTURA (dry-run). No escribe nada en Firestore.
 * Para cada pasajero/conductor propone la ciudad según su última ubicación conocida:
 *   conductor → drivers_location/{uid} (lat,lng)  ·  pasajero → recogida (originLat/Lng) de su viaje más reciente
 * y cuenta cuántos cambiarían, por ciudad actual → ciudad propuesta.
 * Solo cambia perfiles «Comayagua»/sin ciudad/'default'/'gps'/'trip'; los elegidos a mano se respetan.
 *
 * Uso (raíz del repo, credenciales admin de solo lectura: gcloud auth application-default login):
 *   cd functions && npm install && cd ..
 *   node scripts/ciudad-usuarios-dryrun.mjs [--project comedor-86278] [--app comayagua-vip-pro-v4] [--json salida.json]
 *   node scripts/ciudad-usuarios-dryrun.mjs --fixture datos.json      # sin Firestore (pruebas)
 * Nunca imprime nombres, teléfonos ni coordenadas: solo conteos (y uids en --json).
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PROJECT = arg('--project', 'comedor-86278');
const APP = arg('--app', 'comayagua-vip-pro-v4');
const FIXTURE = arg('--fixture', null);
const OUT = arg('--json', null);

// Cargar zones.js del cliente (mismas ciudades y coberturas que la app)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-city-'));
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(tmp, f));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
globalThis.window = globalThis; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { contains: () => false } } };
try { const c = await import(path.join(tmp, 'config.js')); window.APP_CONFIG ||= c.APP_CONFIG; } catch (_) {}
const Z = await import(path.join(tmp, 'zones.js'));
const R = await import(path.join(tmp, 'user-city-rules.js'));
fs.rmSync(tmp, { recursive: true, force: true });
const detect = (lat, lng) => R.ucDetect(Z, lat, lng);
const name = (id) => (id && Z.getZoneById(id)?.name) || id || '(sin ciudad)';

let users, driverPos, lastPickup;
if (FIXTURE) {
    const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    users = f.users; driverPos = new Map(Object.entries(f.drivers_location || {})); lastPickup = new Map(Object.entries(f.lastPickup || {}));
} else {
    const admin = createRequire(path.join(ROOT, 'functions', 'package.json'))('firebase-admin');
    admin.initializeApp({ projectId: PROJECT });
    const db = admin.firestore();
    const base = `artifacts/${APP}/public/data`;
    const us = await db.collection(`${base}/users`).get();
    users = [];
    for (const d of us.docs) {
        const pub = d.data() || {};
        const priv = await db.doc(`artifacts/${APP}/users/${d.id}/profile/data`).get().catch(() => null);
        users.push({ uid: d.id, ...pub, ...(priv?.exists ? priv.data() : {}) });
    }
    driverPos = new Map((await db.collection(`${base}/drivers_location`).get()).docs.map((d) => [d.id, d.data()]));
    lastPickup = new Map();
    const trips = await db.collection(`${base}/trips`).select('clientId', 'originLat', 'originLng', 'createdAtMs').get();
    for (const t of trips.docs) {
        const x = t.data(); if (!x.clientId || x.originLat == null) continue;
        const prev = lastPickup.get(x.clientId);
        if (!prev || (Number(x.createdAtMs) || 0) > (Number(prev.t) || 0)) lastPickup.set(x.clientId, { lat: x.originLat, lng: x.originLng, t: x.createdAtMs });
    }
}

const STAFF = new Set(['admin', 'supervisor', 'merchant', 'store', 'staff', 'ops']);
const tally = { total: 0, conUbicacion: 0, cambian: 0, porRol: {}, porMotivo: {}, actual: {}, propuesta: {}, movimientos: {} };
const changes = [];
for (const u of users) {
    const role = u.role || 'client';
    if (STAFF.has(role) || !['client', 'driver'].includes(role)) continue;
    tally.total++;
    tally.actual[name(u.serviceZoneId || u.cityId)] = (tally.actual[name(u.serviceZoneId || u.cityId)] || 0) + 1;
    const loc = role === 'driver' ? (driverPos.get(u.uid) || lastPickup.get(u.uid)) : (lastPickup.get(u.uid) || (u.lastLat != null ? { lat: u.lastLat, lng: u.lastLng } : null));
    const p = R.ucBackfillProposal(u, loc, detect);
    if (loc) tally.conUbicacion++;
    tally.porMotivo[p.why] = (tally.porMotivo[p.why] || 0) + 1;
    if (!p.change) continue;
    tally.cambian++;
    tally.porRol[role] = (tally.porRol[role] || 0) + 1;
    tally.propuesta[name(p.to)] = (tally.propuesta[name(p.to)] || 0) + 1;
    const k = `${name(p.current)} → ${name(p.to)}`;
    tally.movimientos[k] = (tally.movimientos[k] || 0) + 1;
    changes.push({ uid: u.uid, role, from: p.current || null, to: p.to });
}
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
console.log(`DRY-RUN (no se escribió nada) · app ${APP}${FIXTURE ? ' · fixture' : ` · proyecto ${PROJECT}`}`);
console.log(`Pasajeros+conductores: ${tally.total} · con ubicación conocida: ${tally.conUbicacion} · cambiarían: ${tally.cambian}`, JSON.stringify(tally.porRol));
console.log('Ciudad actual:', JSON.stringify(sortObj(tally.actual)));
console.log('Cambios (actual → propuesta):'); for (const [k, v] of Object.entries(sortObj(tally.movimientos))) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log('Por qué no / sí:', JSON.stringify(sortObj(tally.porMotivo)));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ app: APP, at: new Date().toISOString(), tally, changes }, null, 2));
