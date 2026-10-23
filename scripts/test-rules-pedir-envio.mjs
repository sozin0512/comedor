/**
 * Reglas de «Pedir envío» directo de tienda. Solo emulador, nunca producción.
 *   (en /workspace/rules-test) npx firebase emulators:exec --only firestore --project demo-hr \
 *     "RULES=<repo>/firestore.rules node <repo>/scripts/test-rules-pedir-envio.mjs"
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';

const APP = 'comayagua-vip-pro-v4';
const P = `artifacts/${APP}/public/data`;
const env = await initializeTestEnvironment({
  projectId: 'demo-hr',
  firestore: { rules: fs.readFileSync(process.env.RULES || new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, `${P}/stores/s1`), { name: 'Baleadas Doña Mary', ownerId: 'owner', active: true });
  await setDoc(doc(db, `${P}/users/owner`), { role: 'client' });
  await setDoc(doc(db, `${P}/users/other`), { role: 'client' });
  await setDoc(doc(db, `${P}/users/drv`), { role: 'driver' });
  await setDoc(doc(db, `${P}/drivers_location/drv`), { online: true });
  await setDoc(doc(db, `${P}/users/sup`), { role: 'supervisor' });
  await setDoc(doc(db, `artifacts/${APP}/roles/sup`), { role: 'supervisor' });
});
const db = (u) => env.authenticatedContext(u).firestore();
const base = (uid, over = {}) => ({
  status: 'pending', serviceType: 'delivery', storeDelivery: true, createdByMerchant: true, merchantDirectDelivery: true,
  storeId: 's1', merchantId: uid, clientId: uid, deliveryVehicle: 'moto', allowedDriverVehicles: ['moto'],
  offeredToDriverId: null, origin: 'Tienda', destination: 'Col. Centro', price: 'L. 40.00', priceNum: 40, ...over,
});
const R = []; const t = async (n, p) => { try { await p; R.push(['PASS', n]); } catch (e) { R.push(['FAIL', n, e.message]); } };

await t('dueño crea envío en moto', assertSucceeds(setDoc(doc(db('owner'), `${P}/trips/m1`), base('owner'))));
await t('dueño crea envío en carro', assertSucceeds(setDoc(doc(db('owner'), `${P}/trips/c1`), base('owner', { deliveryVehicle: 'auto', allowedDriverVehicles: ['auto'] }))));
await t('otro usuario NO crea envío a nombre de la tienda', assertFails(setDoc(doc(db('other'), `${P}/trips/x1`), base('other'))));
await t('NO: merchantId de otro', assertFails(setDoc(doc(db('other'), `${P}/trips/x2`), base('other', { merchantId: 'owner' }))));
await t('NO: tienda inexistente', assertFails(setDoc(doc(db('owner'), `${P}/trips/x3`), base('owner', { storeId: 'nope' }))));
await t('NO: vehículo mezclado (moto + carro)', assertFails(setDoc(doc(db('owner'), `${P}/trips/x4`), base('owner', { allowedDriverVehicles: ['moto', 'auto'] }))));
await t('NO: vehículo taxi', assertFails(setDoc(doc(db('owner'), `${P}/trips/x5`), base('owner', { deliveryVehicle: 'taxi', allowedDriverVehicles: ['taxi'] }))));
await t('NO: ya con conductor asignado', assertFails(setDoc(doc(db('owner'), `${P}/trips/x6`), base('owner', { driverId: 'drv' }))));
await t('NO: nace aceptado', assertFails(setDoc(doc(db('owner'), `${P}/trips/x7`), base('owner', { status: 'accepted' }))));
await t('viaje normal de pasajero sigue funcionando', assertSucceeds(setDoc(doc(db('other'), `${P}/trips/n1`), { status: 'pending', serviceType: 'auto', clientId: 'other', origin: 'a', destination: 'b' })));
await t('dueño ve su envío', assertSucceeds(getDoc(doc(db('owner'), `${P}/trips/m1`))));

await t('otro usuario NO cancela', assertFails(updateDoc(doc(db('other'), `${P}/trips/m1`), { status: 'cancelled', cancelledBy: 'merchant' })));
await t('dueño NO cambia el precio', assertFails(updateDoc(doc(db('owner'), `${P}/trips/m1`), { priceNum: 5 })));
await t('dueño NO cambia vehículo', assertFails(updateDoc(doc(db('owner'), `${P}/trips/m1`), { allowedDriverVehicles: ['moto', 'auto'] })));
await t('dueño cancela antes de aceptar', assertSucceeds(updateDoc(doc(db('owner'), `${P}/trips/m1`), { status: 'cancelled', cancelledBy: 'merchant', cancelReason: 'merchant_cancelled', cancelledAtMs: Date.now() })));
await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), `${P}/trips/c1`), { status: 'accepted', driverId: 'drv' }); });
await t('dueño NO cancela después de aceptado', assertFails(updateDoc(doc(db('owner'), `${P}/trips/c1`), { status: 'cancelled', cancelledBy: 'merchant' })));
await t('conductor asignado sigue avanzando el viaje', assertSucceeds(updateDoc(doc(db('drv'), `${P}/trips/c1`), { status: 'in_progress' })));
await t('staff puede cancelar', assertSucceeds(updateDoc(doc(db('sup'), `${P}/trips/c1`), { status: 'cancelled', cancelledBy: 'staff' })));

await env.cleanup();
for (const r of R) console.log(r.join(' | '));
const fail = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fail}/${R.length} PASS`);
process.exit(fail ? 1 : 0);
