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
  status: 'verifying', serviceType: 'delivery', storeDelivery: true, createdByMerchant: true, merchantDirectDelivery: true,
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
await t('NO: nace «pending» (se saltaría la verificación)', assertFails(setDoc(doc(db('owner'), `${P}/trips/x8`), base('owner', { status: 'pending' }))));
await t('NO: la app marca priceVerified', assertFails(setDoc(doc(db('owner'), `${P}/trips/x9`), base('owner', { priceVerified: true }))));
await t('AVISO previo: el catch-all de public/data deja leer trips por ID (no es aviso ni lista)', assertSucceeds(getDoc(doc(db('drv'), `${P}/trips/m1`))));
await t('conductor NO lo toma sin verificar', assertFails(updateDoc(doc(db('drv'), `${P}/trips/m1`), { status: 'accepted', driverId: 'drv' })));
await t('dueño NO lo pasa a pending él mismo', assertFails(updateDoc(doc(db('owner'), `${P}/trips/m1`), { status: 'pending', priceVerified: true })));
await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), `${P}/trips/c1`), { status: 'pending', priceVerified: true, priceNum: 43.75 }); });
await t('verificado (pending): el conductor ya lo ve', assertSucceeds(getDoc(doc(db('drv'), `${P}/trips/c1`))));
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

// ── Envío de restaurante SIN destino (cobro por zona al entregar) ──
const zb = (over = {}) => base('owner', { zoneBilling: true, destination: 'Por definir', destinationLat: null, destinationLng: null, price: 'Por zona', priceNum: 0,
  deliveryDetails: { recipientPhone: '99887766', zoneBilling: true }, ...over });
await t('zona: dueño crea sin destino con teléfono', assertSucceeds(setDoc(doc(db('owner'), `${P}/trips/z1`), zb())));
await t('zona: NO sin teléfono', assertFails(setDoc(doc(db('owner'), `${P}/trips/zx1`), zb({ deliveryDetails: { recipientPhone: '', zoneBilling: true } }))));
await t('zona: NO teléfono corto (7 dígitos)', assertFails(setDoc(doc(db('owner'), `${P}/trips/zx2`), zb({ deliveryDetails: { recipientPhone: '9988776', zoneBilling: true } }))));
await t('zona: NO con precio puesto por la app', assertFails(setDoc(doc(db('owner'), `${P}/trips/zx3`), zb({ priceNum: 40 }))));
await t('zona: NO con punto de entrega al crear', assertFails(setDoc(doc(db('owner'), `${P}/trips/zx4`), zb({ dropoffLat: 14.46, dropoffLng: -87.63 }))));
await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), `${P}/trips/z1`), { status: 'in_progress', driverId: 'drv', priceVerified: true }); });
await t('zona: otro usuario NO pone el punto', assertFails(updateDoc(doc(db('other'), `${P}/trips/z1`), { dropoffLat: 14.46, dropoffLng: -87.63 })));
await t('zona: dueño NO pone el punto', assertFails(updateDoc(doc(db('owner'), `${P}/trips/z1`), { dropoffLat: 14.46, dropoffLng: -87.63 })));
await t('zona: conductor NO pone precio', assertFails(updateDoc(doc(db('drv'), `${P}/trips/z1`), { priceNum: 300, price: 'L. 300.00' })));
await t('zona: conductor NO pone la zona', assertFails(updateDoc(doc(db('drv'), `${P}/trips/z1`), { deliveryZoneId: 'z-centro', deliveryZoneName: 'Centro' })));
await t('zona: conductor NO escribe zoneFee', assertFails(updateDoc(doc(db('drv'), `${P}/trips/z1`), { zoneFee: 10 })));
await t('zona: conductor guarda el punto GPS', assertSucceeds(updateDoc(doc(db('drv'), `${P}/trips/z1`), { dropoffLat: 14.46, dropoffLng: -87.63, dropoffAccuracyM: 12, dropoffAtMs: Date.now() })));
await t('zona: conductor NO cambia el punto ya guardado', assertFails(updateDoc(doc(db('drv'), `${P}/trips/z1`), { dropoffLat: 14.50 })));
await t('zona: conductor completa', assertSucceeds(updateDoc(doc(db('drv'), `${P}/trips/z1`), { status: 'completed' })));
await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), `${P}/trips/z1`), { priceNum: 40, price: 'L. 40.00', zoneFee: 40, zoneFeeAtMs: Date.now() }); });
await t('zona: conductor guarda precio sugerido', assertSucceeds(updateDoc(doc(db('drv'), `${P}/trips/z1`), { riderSuggestedFee: 50, riderSuggestedAtMs: Date.now() })));
await t('zona: NO precio sugerido inválido', assertFails(updateDoc(doc(db('drv'), `${P}/trips/z1`), { riderSuggestedFee: 'mucho' })));
await t('zona: dueño NO escribe precio sugerido', assertFails(updateDoc(doc(db('owner'), `${P}/trips/z1`), { riderSuggestedFee: 10 })));
await t('zona: staff puede corregir precio', assertSucceeds(updateDoc(doc(db('sup'), `${P}/trips/z1`), { priceNum: 45, price: 'L. 45.00' })));

await env.cleanup();
for (const r of R) console.log(r.join(' | '));
const fail = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fail}/${R.length} PASS`);
process.exit(fail ? 1 : 0);
