/**
 * Corrige datos viejos de Tiendas (P0):
 *   1) Ciudad: tiendas publicadas en la ciudad equivocada (p. ej. "San Jose", California).
 *      Se deriva de las coordenadas reales de la tienda o de --set <storeId>=<cityId>.
 *   2) +18: deja adultsOnly como bool en TODAS las tiendas (la lista general consulta
 *      adultsOnly == false; una tienda sin el campo no aparecería).
 *
 * Por defecto SOLO MUESTRA lo que cambiaría (dry-run). Para escribir hace falta --apply.
 * NO correr contra producción sin aprobación de Josue.
 *
 * Uso (desde la raíz del repo, con credenciales de admin: GOOGLE_APPLICATION_CREDENTIALS
 * o `gcloud auth application-default login`):
 *   cd functions && npm install && cd ..
 *   node scripts/fix-stores-city-y-18.mjs                      # dry-run
 *   node scripts/fix-stores-city-y-18.mjs --set ID1=tegucigalpa --set ID2=comayagua
 *   node scripts/fix-stores-city-y-18.mjs --set ID1=tegucigalpa --apply
 * Opciones: --project comedor-86278  --app comayagua-vip-pro-v4
 * Con FIRESTORE_EMULATOR_HOST definido escribe en el emulador.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_KM = 60; // igual que STORE_CITY_MAX_KM en js/merchant-stores.js

function argList(name) {
    const out = [];
    process.argv.forEach((a, i) => {
        if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
        else if (a.startsWith(`${name}=`)) out.push(a.slice(name.length + 1));
    });
    return out;
}
const APPLY = process.argv.includes('--apply');
const PROJECT = argList('--project')[0] || 'comedor-86278';
const APP_ID = argList('--app')[0] || 'comayagua-vip-pro-v4';
const OVERRIDES = new Map(argList('--set').map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
}));

/** Carga las listas de ciudades del app (archivos ESM en un package CJS). */
function loadList(file, name) {
    const src = fs.readFileSync(path.join(ROOT, 'js', file), 'utf8').replace(/export const /g, 'const ');
    return new Function(`${src}\nreturn ${name};`)();
}
const ZONES = [
    ...loadList('honduras-cities.js', 'HONDURAS_CITIES').map((z) => ({ ...z, country: 'hn' })),
    ...loadList('us-cities.js', 'US_CITIES'),
];
const byId = new Map(ZONES.map((z) => [z.id, z]));

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function validCoords(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}
function isZoneCenter(lat, lng) {
    return ZONES.some((z) => Math.abs(z.center.lat - lat) < 0.0005 && Math.abs(z.center.lng - lng) < 0.0005);
}
function nearestZone(lat, lng) {
    let best = null;
    for (const z of ZONES) {
        const d = haversineKm(lat, lng, z.center.lat, z.center.lng);
        if (!best || d < best.km) best = { zone: z, km: d };
    }
    return best;
}

const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const col = db.collection(`artifacts/${APP_ID}/public/data/stores`);
const snap = await col.get();
console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN (no escribe)'} · proyecto ${PROJECT} · app ${APP_ID} · ${snap.size} tiendas\n`);

let pending = 0;
let manual = 0;
const batch = db.batch();
for (const d of snap.docs) {
    const s = d.data();
    const patch = {};
    const notes = [];

    // --- +18: adultsOnly siempre bool y coherente con los flags viejos ---
    const adults = s.adultsOnly === true || s.requiresAge18 === true || s.ageRestricted === true;
    if (s.adultsOnly !== adults) patch.adultsOnly = adults;
    if (s.requiresAge18 !== adults) patch.requiresAge18 = adults;

    // --- Ciudad ---
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    const realCoords = validCoords(lat, lng) && !isZoneCenter(lat, lng);
    let target = null;
    if (OVERRIDES.has(d.id)) {
        target = byId.get(OVERRIDES.get(d.id));
        if (!target) notes.push(`--set con ciudad desconocida "${OVERRIDES.get(d.id)}"`);
        else notes.push('ciudad por --set');
    } else if (realCoords) {
        const n = nearestZone(lat, lng);
        if (n && n.km <= MAX_KM) { target = n.zone; notes.push(`ciudad por coordenadas (${n.km.toFixed(1)} km)`); }
    }
    const current = byId.get(s.cityId);
    if (target && target.id !== s.cityId) {
        Object.assign(patch, {
            cityId: target.id,
            cityName: target.name,
            cityDepartment: target.department || null,
            citySource: 'migration',
        });
        if (!realCoords) {
            // Las coords eran el centro de la ciudad equivocada: usar el centro de la ciudad real
            Object.assign(patch, { lat: target.center.lat, lng: target.center.lng, locationApprox: true });
        }
    } else if (!target && (!current || current.country === 'us')) {
        manual += 1;
        notes.push('REVISAR: no se puede deducir la ciudad; usa --set ' + d.id + '=<cityId>');
    }

    const keys = Object.keys(patch);
    console.log(`• ${d.id} · ${s.name || '(sin nombre)'} · ciudad actual: ${s.cityName || '—'} (${s.cityId || '—'}) · +18: ${adults}`);
    notes.forEach((n) => console.log(`    ${n}`));
    if (keys.length) {
        pending += 1;
        console.log(`    cambia: ${JSON.stringify(patch)}`);
        if (APPLY) {
            batch.update(d.ref, {
                ...patch,
                dataFixedAt: admin.firestore.FieldValue.serverTimestamp(),
                dataFixedBy: 'scripts/fix-stores-city-y-18.mjs',
            });
        }
    }
}

console.log(`\n${pending} tiendas con cambios · ${manual} para revisar a mano`);
if (APPLY && pending) {
    await batch.commit();
    console.log('Cambios escritos.');
} else if (!APPLY) {
    console.log('Nada escrito. Agrega --apply para escribir.');
}
