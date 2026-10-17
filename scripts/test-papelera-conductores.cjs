// Papelera del panel Viajes: un viaje «pending» con trashedAtMs no debe ofrecerse ni mostrarse a conductores.
// Prueba de guardas en el código (los puntos de entrada no se exportan). Uso: node scripts/test-papelera-conductores.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const fn = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };
const body = (src, head, len = 900) => { const i = src.indexOf(head); return i < 0 ? '' : src.slice(i, i + len); };
t('fetchPendingTripDocs descarta papelera', /trashedAtMs/.test(body(fn, 'async function fetchPendingTripDocs', 400)));
t('notifyEligibleDriversNewTrip no suena papelera', /if \(trip\.trashedAtMs\) return;/.test(body(fn, 'async function notifyEligibleDriversNewTrip', 1200)));
t('assignNextTripOfferServer no ofrece papelera', /trip\.trashedAtMs\) return false/.test(body(fn, 'async function assignNextTripOfferServer', 600)));
t('notifyOfflineRideDriversWhenNoCoverage no avisa papelera', /trip\.trashedAtMs\) return/.test(body(fn, 'async function notifyOfflineRideDriversWhenNoCoverage', 400)));
t('notifyDriversTripPriceBoost no avisa papelera', /after\.trashedAtMs\) return/.test(body(fn, 'async function notifyDriversTripPriceBoost', 300)));
// Cliente: extraer tripVisibleForMe y ejecutarlo
const m = app.match(/const tripVisibleForMe = \(t\) => \{\n([\s\S]*?)\n\s{16}\};/);
t('app.js tiene tripVisibleForMe', !!m);
if (m) {
  const f = new Function('testDriverMode', 'isTripExclusiveActive', 'currentUser', 'tripVisibleToDriver', 'driverZoneId', 'registeredDriverZones', 'window', `return (t) => {${m[1]}};`)(
    true, () => false, { uid: 'd1' }, () => true, 'z', null, { currentDriverPos: null });
  t('conductor ve viaje pending normal', f({ status: 'pending' }) === true);
  t('conductor NO ve viaje en papelera', f({ status: 'pending', trashedAtMs: Date.now() }) === false);
}
console.log(`${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
