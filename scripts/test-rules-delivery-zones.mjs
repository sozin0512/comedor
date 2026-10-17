// Reglas: zonas de envío (solo lectura para clientes, historial solo staff) y
// campos de tarifa por zona en store_orders (solo el servidor los pone).
// RULES=firestore.rules firebase emulators:exec --project demo-hr --only firestore "node scripts/test-rules-delivery-zones.mjs"
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, addDoc, collection, query, orderBy, limit } from 'firebase/firestore';
const APP = 'comayagua-vip-pro-v4';
const env = await initializeTestEnvironment({ projectId: 'demo-hr', firestore: { rules: fs.readFileSync(process.env.RULES, 'utf8'), host: '127.0.0.1', port: 8080 } });
const P = `artifacts/${APP}/public/data`;
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, `${P}/users/sup`), { role: 'supervisor' });
  await setDoc(doc(db, `artifacts/${APP}/roles/sup`), { role: 'supervisor', source: 'test' });
  await setDoc(doc(db, `${P}/users/fake`), { role: 'supervisor' });
  await setDoc(doc(db, `${P}/users/cli`), { role: 'client' });
  await setDoc(doc(db, `${P}/users/own`), { role: 'client' });
  await setDoc(doc(db, `${P}/delivery_zones/z1`), { name: 'Céntrica', cityId: 'comayagua', baseFee: 40, active: true });
  await setDoc(doc(db, `${P}/delivery_zone_settings/comayagua`), { outsideBehavior: 'distance' });
  await setDoc(doc(db, `${P}/store_delivery_fees/st`), { storeId: 'st', fees: {} });
  await setDoc(doc(db, `${P}/delivery_zone_history/h1`), { type: 'zone', atMs: 1 });
  await setDoc(doc(db, `${P}/store_orders/o1`), { storeId: 'st', ownerId: 'own', clientId: 'cli', status: 'pending', deliveryFee: 40, deliveryFeeSource: 'zone_base', deliveryZoneId: 'z1' });
  await setDoc(doc(db, `${P}/store_orders/o2`), { storeId: 'st', ownerId: 'own', clientId: 'cli', status: 'pending', deliveryFee: null, deliveryFeeSource: 'distance' });
});
const ctx = {
  sup: () => env.authenticatedContext('sup', { email: 's@x.com' }).firestore(),
  fake: () => env.authenticatedContext('fake', { email: 'f@x.com' }).firestore(),
  cli: () => env.authenticatedContext('cli', { email: 'c@x.com' }).firestore(),
  own: () => env.authenticatedContext('own', { email: 'o@x.com' }).firestore(),
  anon: () => env.unauthenticatedContext().firestore(),
};
let pass = 0, fail = 0;
const t = async (name, p, want) => { try { await (want ? assertSucceeds(p) : assertFails(p)); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, e.message); } };
const order = (extra = {}) => ({ storeId: 'st', ownerId: 'own', clientId: 'cli', status: 'pending', items: [], deliveryFee: null, ...extra });

await t('cliente lee zonas', getDoc(doc(ctx.cli(), `${P}/delivery_zones/z1`)), true);
await t('sin sesión NO lee zonas', getDoc(doc(ctx.anon(), `${P}/delivery_zones/z1`)), false);
await t('cliente NO escribe zona', setDoc(doc(ctx.cli(), `${P}/delivery_zones/z2`), { name: 'x' }), false);
await t('supervisor NO escribe zona directo (solo callable)', updateDoc(doc(ctx.sup(), `${P}/delivery_zones/z1`), { baseFee: 1 }), false);
await t('supervisor NO borra zona', deleteDoc(doc(ctx.sup(), `${P}/delivery_zones/z1`)), false);
await t('cliente lee «fuera de zonas»', getDoc(doc(ctx.cli(), `${P}/delivery_zone_settings/comayagua`)), true);
await t('cliente NO cambia «fuera de zonas»', setDoc(doc(ctx.cli(), `${P}/delivery_zone_settings/comayagua`), { outsideBehavior: 'block' }), false);
await t('dueño lee tarifas de tienda', getDoc(doc(ctx.own(), `${P}/store_delivery_fees/st`)), true);
await t('dueño NO escribe tarifas directo (solo callable)', setDoc(doc(ctx.own(), `${P}/store_delivery_fees/st`), { fees: { z1: { mode: 'custom', fee: 1 } } }), false);
await t('supervisor lee historial', getDocs(query(collection(ctx.sup(), `${P}/delivery_zone_history`), orderBy('atMs', 'desc'), limit(10))), true);
await t('perfil «supervisor» falso NO lee historial', getDocs(query(collection(ctx.fake(), `${P}/delivery_zone_history`), limit(10))), false);
await t('cliente NO lee historial', getDoc(doc(ctx.cli(), `${P}/delivery_zone_history/h1`)), false);
await t('supervisor NO edita historial', updateDoc(doc(ctx.sup(), `${P}/delivery_zone_history/h1`), { atMs: 2 }), false);
await t('supervisor NO borra historial', deleteDoc(doc(ctx.sup(), `${P}/delivery_zone_history/h1`)), false);
// store_orders
await t('cliente crea pedido como hoy (deliveryFee null)', addDoc(collection(ctx.cli(), `${P}/store_orders`), order()), true);
await t('cliente crea pedido sin deliveryFee', addDoc(collection(ctx.cli(), `${P}/store_orders`), (({ deliveryFee, ...o }) => o)(order())), true);
await t('cliente NO pone tarifa', addDoc(collection(ctx.cli(), `${P}/store_orders`), order({ deliveryFee: 1 })), false);
await t('cliente NO pone zona', addDoc(collection(ctx.cli(), `${P}/store_orders`), order({ deliveryZoneId: 'z1' })), false);
await t('cliente NO pone fuente de tarifa', addDoc(collection(ctx.cli(), `${P}/store_orders`), order({ deliveryFeeSource: 'zone_base' })), false);
await t('dueño avanza estado (pedido con zona)', updateDoc(doc(ctx.own(), `${P}/store_orders/o1`), { status: 'accepted' }), true);
await t('dueño guarda el viaje (pedido con zona, misma tarifa)', updateDoc(doc(ctx.own(), `${P}/store_orders/o1`), { tripId: 't1', deliveryFee: 40 }), true);
await t('dueño NO cambia la tarifa de zona', updateDoc(doc(ctx.own(), `${P}/store_orders/o1`), { deliveryFee: 10 }), false);
await t('dueño NO cambia la zona', updateDoc(doc(ctx.own(), `${P}/store_orders/o1`), { deliveryZoneId: 'z9' }), false);
await t('dueño pone tarifa por distancia (como hoy)', updateDoc(doc(ctx.own(), `${P}/store_orders/o2`), { tripId: 't2', deliveryFee: 61.5 }), true);
await t('dueño NO marca la tarifa como «de zona»', updateDoc(doc(ctx.own(), `${P}/store_orders/o2`), { deliveryFeeSource: 'zone_base' }), false);
await t('cliente cancela (pedido con zona)', updateDoc(doc(ctx.cli(), `${P}/store_orders/o1`), { status: 'cancelled', cancelledBy: 'client' }), true);
await t('cliente NO cancela cambiando la tarifa', updateDoc(doc(ctx.cli(), `${P}/store_orders/o2`), { status: 'cancelled', deliveryZoneName: 'x' }), false);
await t('supervisor corrige tarifa de zona', updateDoc(doc(ctx.sup(), `${P}/store_orders/o1`), { deliveryFee: 45 }), true);
await t('otro cliente NO lee pedido ajeno', getDoc(doc(ctx.fake(), `${P}/store_orders/o1`)), false);
await t('cliente NO escribe pedido con docId == su uid (catch-all)', setDoc(doc(ctx.cli(), `${P}/store_orders/cli`), order({ deliveryFee: 1, deliveryFeeSource: 'zone_base' })), false);
await t('cliente lee su pedido', getDoc(doc(ctx.cli(), `${P}/store_orders/o2`)), true);
await t('supervisor lee todos los pedidos (panel Pedidos)', getDocs(query(collection(ctx.sup(), `${P}/store_orders`), limit(50))), true);
console.log(`${pass}/${pass + fail} PASS`);
await env.cleanup();
process.exit(fail ? 1 : 0);
