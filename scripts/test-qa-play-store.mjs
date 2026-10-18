/**
 * Pruebas puras (sin red) de lo que cambió para el lanzamiento en Play Store:
 * eliminar cuenta (bloqueos y anonimizado), formato de lempiras y nombres visibles.
 *   node scripts/test-qa-play-store.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// js/*.js son módulos del navegador; package.json no dice "type":"module", así que se copian como .mjs.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-qa-'));
async function loadEsm(rel) {
  const dest = path.join(tmp, path.basename(rel).replace(/\.js$/, '.mjs'));
  fs.copyFileSync(new URL(rel, import.meta.url), dest);
  return import(pathToFileURL(dest).href);
}
const { formatLempiras } = await loadEsm('../js/money-format.js');
const { displayPersonName } = await loadEsm('../js/display-name.js');

const require = createRequire(import.meta.url);
const del = require('../functions/account-deletion.js');
const results = [];
const t = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const codes = (r) => r.blockers.map((b) => b.code).sort();

// Lempiras
t('L. con 2 decimales', () => eq(formatLempiras(174.2), 'L. 174.20'));
t('miles con coma', () => eq(formatLempiras(1234), 'L. 1,234.00'));
t('negativo', () => eq(formatLempiras(-83), '-L. 83.00'));
t('texto numérico', () => eq(formatLempiras('1,500.5'), 'L. 1,500.50'));
t('vacío = L. 0.00', () => eq(formatLempiras(null), 'L. 0.00'));
t('texto ya formateado se respeta', () => eq(formatLempiras('L. 150'), 'L. 150'));
t('sin decimales', () => eq(formatLempiras(83, { decimals: 0 }), 'L. 83'));

// Nombres
t('relleno coreano = Pasajero', () => eq(displayPersonName('\u3164'), 'Pasajero'));
t('HonduRaite = marcador', () => eq(displayPersonName('HonduRaite'), 'Pasajero'));
t('Pasajero de prueba = marcador', () => eq(displayPersonName('Pasajero de prueba', 'Cliente'), 'Cliente'));
t('nombre real intacto', () => eq(displayPersonName('  María   López '), 'María López'));
t('quita invisibles dentro', () => eq(displayPersonName('Ana\u200B'), 'Ana'));

// Eliminar cuenta
const uid = 'u1';
t('pasajero sin pendientes: se puede', () => { const r = del.evaluateDeletion({ uid, profile: { role: 'client' } }); eq(r.blockers, []); });
t('viaje activo bloquea', () => eq(codes(del.evaluateDeletion({ uid, trips: [{ id: 'a', status: 'accepted' }] })), ['active_trip']));
t('viaje programado bloquea', () => eq(codes(del.evaluateDeletion({ uid, trips: [{ id: 'a', status: 'scheduled' }] })), ['active_trip']));
t('viaje completado no bloquea', () => eq(codes(del.evaluateDeletion({ uid, trips: [{ id: 'a', status: 'completed' }] })), []));
t('pedido de tienda en curso bloquea', () => eq(codes(del.evaluateDeletion({ uid, orders: [{ status: 'preparing', clientId: uid }] })), ['active_order']));
t('staff bloquea', () => eq(codes(del.evaluateDeletion({ uid, staffRole: 'supervisor' })), ['staff']));
t('conductor con saldo por cobrar bloquea', () => eq(codes(del.evaluateDeletion({ uid, profile: { role: 'driver', driverBalance: 50 } })), ['pending_payout']));
t('conductor con deuda bloquea', () => eq(codes(del.evaluateDeletion({ uid, profile: { role: 'driver', pendingDepositDebt: 10 } })), ['pending_deposit']));
t('depósito en revisión bloquea', () => eq(codes(del.evaluateDeletion({ uid, profile: { role: 'driver' }, pendingDepositRequests: 1 })), ['pending_deposit']));
t('saldo de pasajero solo avisa', () => { const r = del.evaluateDeletion({ uid, profile: { role: 'client', balance: 20 } }); eq(r.blockers, []); eq(r.warnings.map((w) => w.code), ['balance_loss']); });
const DEL = '__delete__';
t('viaje: anonimiza al pasajero', () => {
  const p = del.anonymizeTripPatch({ clientId: uid, clientName: 'Ana', clientPhone: '9999', driverId: 'd' }, uid, DEL);
  if (p.clientName === 'Ana' || p.clientPhone !== DEL || p.clientAccountDeleted !== true) throw new Error(JSON.stringify(p));
  if ('driverName' in p) throw new Error('tocó al conductor');
});
t('viaje: anonimiza al conductor', () => {
  const p = del.anonymizeTripPatch({ clientId: 'c', driverId: uid, driverName: 'Leo' }, uid, DEL);
  if (p.driverName === 'Leo' || p.driverAccountDeleted !== true || 'clientName' in p) throw new Error(JSON.stringify(p));
});
t('pedido: anonimiza al cliente', () => {
  const p = del.anonymizeOrderPatch({ clientId: uid, clientName: 'Ana' }, uid, DEL);
  if (p.clientName === 'Ana' || p.clientAccountDeleted !== true) throw new Error(JSON.stringify(p));
});

let fail = 0;
for (const r of results) { if (r[0] === 'FAIL') fail++; console.log(r.join(' | ')); }
console.log(`${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
