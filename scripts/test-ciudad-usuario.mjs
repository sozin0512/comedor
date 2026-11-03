/** v.42 Ciudad del usuario por GPS: reglas + detección con las ciudades reales. node scripts/test-ciudad-usuario.mjs */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-city-'));
for (const f of fs.readdirSync(path.join(root, 'js'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(root, 'js', f), path.join(tmp, f));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
globalThis.window = globalThis; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { contains: () => false } } };
try { const c = await import(path.join(tmp, 'config.js')); window.APP_CONFIG ||= c.APP_CONFIG; } catch (_) {}
const Z = await import(path.join(tmp, 'zones.js'));
const R = await import(path.join(tmp, 'user-city-rules.js'));
const detect = (lat, lng) => R.ucDetect(Z, lat, lng);
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };

// Detección con ciudades reales
const metro = (id) => ['tegucigalpa', 'comayaguela'].includes(id);
t('GPS en Tegucigalpa (Los Próceres) → Tegucigalpa/Comayagüela', metro(detect(14.0818, -87.2068)), detect(14.0818, -87.2068));
t('GPS en Comayagua centro → comayagua', detect(14.4598, -87.6378) === 'comayagua');
t('GPS en Valle de Ángeles → valle-angeles', detect(14.1500, -87.0333) === 'valle-angeles', detect(14.15, -87.0333));
t('GPS en San Pedro Sula → san-pedro-sula', detect(15.5050, -88.0250) === 'san-pedro-sula', detect(15.505, -88.025));
t('GPS en Siguatepeque → siguatepeque', detect(14.6000, -87.8333) === 'siguatepeque');
t('GPS en Guatemala → sin ciudad (no inventa)', detect(14.6349, -90.5069) === null, detect(14.6349, -90.5069));

const now = Date.UTC(2026, 10, 3, 18);
const DAY = 864e5;
const P = (o) => ({ role: 'client', ...o });
// Registro / primer GPS
t('perfil nuevo sin GPS al registrarse (default) → 1er GPS lo corrige', R.ucDecide({ profile: P({ serviceZoneId: 'comayagua', serviceZoneSource: 'default' }), detectedZoneId: 'tegucigalpa', now }).action === 'set');
t('perfil sin ciudad → 1er GPS', R.ucDecide({ profile: P({}), detectedZoneId: 'tegucigalpa', now }).action === 'set');
t('default y ya está bien → confirmar como gps', R.ucDecide({ profile: P({ serviceZoneId: 'comayagua', serviceZoneSource: 'default' }), detectedZoneId: 'comayagua', now }).action === 'confirm');
t('conductor también', R.ucDecide({ profile: { role: 'driver', serviceZoneId: 'comayagua', serviceZoneSource: 'default' }, detectedZoneId: 'danli', now }).action === 'set');
t('staff no se toca', R.ucDecide({ profile: { role: 'admin', serviceZoneId: 'comayagua' }, detectedZoneId: 'danli', now }).action === 'none');
t('en viaje → no cambia', R.ucDecide({ profile: { role: 'driver', serviceZoneSource: 'default', serviceZoneId: 'comayagua' }, detectedZoneId: 'danli', now, busy: true }).action === 'none');
// Perfiles viejos «Comayagua» sin source
let h = R.ucAddSample([], 'tegucigalpa', now);
t('viejo «Comayagua»: 1 lectura → espera', R.ucDecide({ profile: P({ serviceZoneId: 'comayagua' }), detectedZoneId: 'tegucigalpa', history: h, now }).action === 'none');
h = R.ucAddSample(h, 'tegucigalpa', now + 3 * 3600e3);
t('viejo «Comayagua»: 2 lecturas ≥2 h → corrige', R.ucDecide({ profile: P({ serviceZoneId: 'comayagua' }), detectedZoneId: 'tegucigalpa', history: h, now: now + 3 * 3600e3 }).action === 'set');
t('viejo «Comayagua» y está en Comayagua → confirmar', R.ucDecide({ profile: P({ serviceZoneId: 'comayagua' }), detectedZoneId: 'comayagua', now }).action === 'confirm');
t('viejo con otra ciudad (eligió) → igual se respeta', R.ucEffectiveSource({ serviceZoneId: 'danli' }) === 'legacy');
// Cambio constante
const gpsP = P({ serviceZoneId: 'tegucigalpa', serviceZoneSource: 'gps' });
let v = []; v = R.ucAddSample(v, 'tegucigalpa', now - 10 * DAY); v = R.ucAddSample(v, 'la-ceiba', now - 1 * DAY);
t('visita de 1 día → no cambia', R.ucDecide({ profile: gpsP, detectedZoneId: 'la-ceiba', history: v, now }).action === 'none');
let m = []; for (const d of [6, 5, 4, 3]) m = R.ucAddSample(m, 'la-ceiba', now - d * DAY); m = R.ucAddSample(m, 'la-ceiba', now);
t('3+ días en otra ciudad y nada en la suya → cambia', R.ucDecide({ profile: gpsP, detectedZoneId: 'la-ceiba', history: m, now }).action === 'set');
const m2 = R.ucAddSample(m, 'tegucigalpa', now - 0.5 * DAY);
t('…pero si volvió a su ciudad hace poco → no', R.ucDecide({ profile: gpsP, detectedZoneId: 'la-ceiba', history: m2, now }).action === 'none');
t('elegida a mano → solo sugerir', R.ucDecide({ profile: P({ serviceZoneId: 'tegucigalpa', serviceZoneSource: 'manual' }), detectedZoneId: 'la-ceiba', history: m, now }).action === 'suggest');
t('muestras: máx 1 cada 10 min', R.ucAddSample(R.ucAddSample([], 'x', now), 'x', now + 60e3).length === 1);
// Backfill
t('backfill: default + GPS Tegus → cambia', R.ucBackfillProposal({ serviceZoneId: 'comayagua' }, { lat: 14.0723, lng: -87.1921 }, detect).change);
t('backfill: manual → no', !R.ucBackfillProposal({ serviceZoneId: 'comayagua', serviceZoneSource: 'manual' }, { lat: 14.0723, lng: -87.1921 }, detect).change);
t('backfill: sin ubicación → no', R.ucBackfillProposal({ serviceZoneId: 'comayagua' }, null, detect).why === 'sin_ubicacion');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0);
