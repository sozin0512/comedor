/**
 * Reglas: la comisión oficial (server*) solo la escribe el servidor. Solo emulador.
 *   (en /workspace/rules-test) npx firebase emulators:exec --only firestore --project demo-hr \
 *     "RULES=<repo>/firestore.rules node test-rules-comision.mjs"
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
const APP = 'comayagua-vip-pro-v4'; const P = `artifacts/${APP}/public/data`;
const env = await initializeTestEnvironment({ projectId: 'demo-hr', firestore: { rules: fs.readFileSync(process.env.RULES, 'utf8'), host: '127.0.0.1', port: 8080 } });
const trip = { status: 'in_progress', serviceType: 'moto', clientId: 'cli', driverId: 'drv', priceNum: 60, price: 'L. 60.00', paymentMethod: 'efectivo' };
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, `${P}/users/drv`), { role: 'driver' });
  await setDoc(doc(db, `${P}/users/cli`), { role: 'client' });
  await setDoc(doc(db, `${P}/users/sup`), { role: 'supervisor' });
  await setDoc(doc(db, `artifacts/${APP}/roles/sup`), { role: 'supervisor' });
  for (const id of ['t1', 't2', 't3', 't4', 't5']) await setDoc(doc(db, `${P}/trips/${id}`), trip);
});
const db = (u) => env.authenticatedContext(u).firestore();
const R = []; const t = async (n, p) => { try { await p; R.push(['PASS', n]); } catch (e) { R.push(['FAIL', n, e.message]); } };
const done = { status: 'completed', completedAt: new Date() };
await t('conductor completa como siempre (comisión de la app = solo vista previa)', assertSucceeds(updateDoc(doc(db('drv'), `${P}/trips/t1`), { ...done, commissionPercent: 15, commissionAmount: 9 })));
await t('conductor NO escribe serverCommissionAmount', assertFails(updateDoc(doc(db('drv'), `${P}/trips/t2`), { ...done, serverCommissionAmount: 0 })));
await t('conductor NO escribe serverCommissionPercent', assertFails(updateDoc(doc(db('drv'), `${P}/trips/t3`), { serverCommissionPercent: 0 })));
await t('conductor NO marca serverCommissionAtMs (para que el servidor no calcule)', assertFails(updateDoc(doc(db('drv'), `${P}/trips/t4`), { ...done, serverCommissionAtMs: 1 })));
await t('pasajero NO escribe serverDriverNet', assertFails(updateDoc(doc(db('cli'), `${P}/trips/t5`), { serverDriverNet: 60 })));
await t('staff tampoco (solo el servidor)', assertFails(updateDoc(doc(db('sup'), `${P}/trips/t5`), { serverCommissionAmount: 1 })));
await t('nadie crea un viaje con server* puesto', assertFails(setDoc(doc(db('cli'), `${P}/trips/n1`), { ...trip, status: 'pending', driverId: null, serverCommissionAmount: 0 })));
for (const x of R) console.log(x[0], x[1], x[2] || '');
const pass = R.filter((x) => x[0] === 'PASS').length; console.log(`${pass}/${R.length} PASS`);
await env.cleanup(); process.exit(pass === R.length ? 0 : 1);
