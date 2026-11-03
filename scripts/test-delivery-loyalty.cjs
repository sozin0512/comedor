process.env.GCLOUD_PROJECT = 'demo-hr';
// Promo Navidad (HAM): canje con candados + ciclo 5 + abono al conductor (emulador firestore+auth).
//   firebase emulators:exec --project demo-hr --only firestore,auth "node scripts/test-delivery-loyalty.cjs"
const path = require('path'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
const msgPath = reqFn.resolve('firebase-admin/messaging');
require.cache[msgPath] = { id: msgPath, filename: msgPath, loaded: true, exports: { getMessaging: () => ({ sendEachForMulticast: async (m) => ({ successCount: m.tokens.length, responses: [] }) }) } };
const fx = reqFn('./index.js');
const LY = reqFn('./delivery-loyalty');
const db = reqFn('firebase-admin/firestore').getFirestore();
const APP = 'comayagua-vip-pro-v4'; const B = `artifacts/${APP}/public/data`;
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
const err = async (p) => { try { await p; return 'ok'; } catch (e) { return `${e.code}|${e.message}`; } };
const call = (fn, auth, data) => fx[fn].run({ auth, data, rawRequest: {} });
const SUP = { uid: 'SUP', token: { email: 'sup@example.com' } };
const u = (uid, phone) => ({ uid, token: { email: `${uid}@x.com`, ...(phone ? { phone_number: phone } : {}) } });
const sq = (lat, lng, d) => [{ lat: lat - d, lng: lng - d }, { lat: lat - d, lng: lng + d }, { lat: lat + d, lng: lng + d }, { lat: lat + d, lng: lng - d }];
const C = { lat: 14.4598, lng: -87.6378 };
(async () => {
  // pura
  const seq = Array.from({ length: 10 }, (_, n) => LY.computeLoyalty({}, n, 40).clientDeliveryFee).join(',');
  ok('ciclo 40: 35,35,35,35,0 y reinicia', seq === '35,35,35,35,0,35,35,35,35,0', seq);
  ok('nunca menos de 0 (tarifa 3)', LY.computeLoyalty({}, 0, 3).clientDeliveryFee === 0);
  ok('código sin mayúsc./minúsc.', LY.normCode(' hAm ') === 'HAM');

  await db.doc(`${B}/users/SUP`).set({ role: 'supervisor' });
  await db.doc(`artifacts/${APP}/roles/SUP`).set({ role: 'supervisor', source: 'test' });
  await db.doc(`${B}/users/OWN`).set({ role: 'client' });
  await db.doc(`${B}/stores/ST1`).set({ name: 'Baleadas', ownerId: 'OWN', cityId: 'comayagua', adultsOnly: false });
  await call('staffUpsertDeliveryZone', SUP, { name: 'Céntrica', cityId: 'comayagua', cityName: 'Comayagua', baseFee: 40, priority: 1, polygon: sq(C.lat, C.lng, 0.01), active: true });
  for (const [id, ph] of [['A', '+50499990001'], ['B', '+50499990002'], ['C', '+50499990003'], ['D', '+50499990004'], ['N', null], ['DRV', '+50499990009']]) {
    await db.doc(`${B}/users/${id}`).set({ role: id === 'DRV' ? 'driver' : 'client', phone: ph ? ph.slice(4) : '', driverBalance: id === 'DRV' ? 100 : 0 });
  }

  ok('cliente NO cambia ajustes', (await err(call('staffSetDeliveryLoyalty', u('A'), { enabled: true }))).startsWith('permission-denied'));
  ok('apagada: código rechazado', (await err(call('claimDeliveryLoyaltyCode', u('A', '+50499990001'), { code: 'HAM', deviceId: 'web-dev-aaaa1' }))).startsWith('not-found'));
  await call('staffSetDeliveryLoyalty', SUP, { enabled: true, name: 'Promo Navidad', code: 'ham', maxMembers: 2, discountL: 5, cycle: 5, lastFree: true, requireVerifiedPhone: true });
  ok('código incorrecto', (await err(call('claimDeliveryLoyaltyCode', u('A', '+50499990001'), { code: 'XMAS', deviceId: 'web-dev-aaaa1' }))).startsWith('not-found'));
  ok('sin teléfono verificado: rechazado', (await err(call('claimDeliveryLoyaltyCode', u('N'), { code: 'HAM', deviceId: 'web-dev-nnnn1' }))).startsWith('failed-precondition'));
  const ra = await call('claimDeliveryLoyaltyCode', u('A', '+50499990001'), { code: 'ham', deviceId: 'web-dev-aaaa1' });
  ok('A canjea «ham»', ra.ok && !ra.already && ra.remaining === 1, JSON.stringify(ra));
  ok('A otra vez: ya está', (await call('claimDeliveryLoyaltyCode', u('A', '+50499990001'), { code: 'HAM', deviceId: 'web-dev-aaaa1' })).already === true);
  const devDup = await err(call('claimDeliveryLoyaltyCode', u('B', '+50499990002'), { code: 'HAM', deviceId: 'web-dev-aaaa1' }));
  ok('B en el mismo dispositivo: rechazado', devDup.includes('Esta promo ya se canjeó en esta cuenta o dispositivo'), devDup);
  const phDup = await err(call('claimDeliveryLoyaltyCode', u('C', '+50499990001'), { code: 'HAM', deviceId: 'web-dev-cccc1' }));
  ok('C con el teléfono de A: rechazado', phDup.includes('Esta promo ya se canjeó'), phDup);
  ok('B en su dispositivo: entra (2/2)', (await call('claimDeliveryLoyaltyCode', u('B', '+50499990002'), { code: 'HAM', deviceId: 'web-dev-bbbb1' })).ok);
  ok('D: cupo lleno', (await err(call('claimDeliveryLoyaltyCode', u('D', '+50499990004'), { code: 'HAM', deviceId: 'web-dev-dddd1' }))).startsWith('resource-exhausted'));
  // concurrencia: subir cupo a 3 y que D y E canjeen a la vez → solo 1 entra
  await call('staffSetDeliveryLoyalty', SUP, { enabled: true, name: 'Promo Navidad', code: 'HAM', maxMembers: 3, discountL: 5, cycle: 5, lastFree: true, requireVerifiedPhone: true });
  await db.doc(`${B}/users/E`).set({ role: 'client' });
  const par = await Promise.all([err(call('claimDeliveryLoyaltyCode', u('D', '+50499990004'), { code: 'HAM', deviceId: 'web-dev-dddd1' })), err(call('claimDeliveryLoyaltyCode', u('E', '+50499990005'), { code: 'HAM', deviceId: 'web-dev-eeee1' }))]);
  const s1 = (await db.doc(`${B}/appSettings/deliveryLoyalty`).get()).data();
  ok('carrera por el último cupo: entra 1, contador 3', par.filter((x) => x === 'ok').length === 1 && s1.memberCount === 3, `${par} · ${s1.memberCount}`);

  // ciclo con pedidos de A
  const steps = []; let credits = 0;
  for (let i = 1; i <= 6; i++) {
    const id = `OA${i}`; const ref = db.doc(`${B}/store_orders/${id}`);
    const data = { storeId: 'ST1', ownerId: 'OWN', clientId: 'A', status: 'pending', deliveryLat: C.lat, deliveryLng: C.lng, deliveryFee: null, cityId: 'comayagua' };
    await ref.set(data);
    await fx.onStoreOrderCreatedZoneFee.run({ params: { appId: APP, orderId: id }, data: { data: () => data, ref } });
    const o = (await ref.get()).data();
    steps.push(`${o.loyaltyStep}:${o.deliveryFee}->${o.clientDeliveryFee}`);
    const before = { ...o, status: 'out_for_delivery', driverId: 'DRV' };
    const after = { ...before, status: 'delivered' };
    await ref.update({ status: 'delivered', driverId: 'DRV' });
    const evt = { params: { appId: APP, orderId: id }, data: { before: { data: () => before }, after: { data: () => after } } };
    await fx.onStoreOrderLoyaltyDelivered.run(evt);
    await fx.onStoreOrderLoyaltyDelivered.run(evt); // repetido: no cuenta 2 veces
    credits += o.loyaltyDiscount;
  }
  ok('A: pasos 1..5 y reinicia, 40→35 y 5.º gratis', steps.join(' ') === '1:40->35 2:40->35 3:40->35 4:40->35 5:40->0 1:40->35', steps.join(' '));
  const m = (await db.doc(`${B}/delivery_loyalty_members/A`).get()).data();
  ok('A: 6 entregados (idempotente)', m.deliveredCount === 6, m.deliveredCount);
  const drv = (await db.doc(`${B}/users/DRV`).get()).data();
  ok('conductor: +5×5 +40 = +65 al saldo', drv.driverBalance === 165 && credits === 65, drv.driverBalance);
  const prof = (await db.doc(`artifacts/${APP}/users/DRV/profile/data`).get()).data();
  ok('perfil del conductor reflejado', prof?.driverBalance === 165);
  // no miembro: sin campos
  const ref = db.doc(`${B}/store_orders/OX`); const dx = { storeId: 'ST1', ownerId: 'OWN', clientId: 'N', status: 'pending', deliveryLat: C.lat, deliveryLng: C.lng, cityId: 'comayagua' };
  await ref.set(dx); await fx.onStoreOrderCreatedZoneFee.run({ params: { appId: APP, orderId: 'OX' }, data: { data: () => dx, ref } });
  const ox = (await ref.get()).data();
  ok('no miembro: paga 40 completo, sin promo', ox.deliveryFee === 40 && ox.loyaltyPromoId === undefined && ox.clientDeliveryFee === undefined);
  // cancelado no cuenta
  const rc = db.doc(`${B}/store_orders/OC`); const dc = { storeId: 'ST1', ownerId: 'OWN', clientId: 'B', status: 'pending', deliveryLat: C.lat, deliveryLng: C.lng, cityId: 'comayagua' };
  await rc.set(dc); await fx.onStoreOrderCreatedZoneFee.run({ params: { appId: APP, orderId: 'OC' }, data: { data: () => dc, ref: rc } });
  const oc = (await rc.get()).data();
  await fx.onStoreOrderLoyaltyDelivered.run({ params: { appId: APP, orderId: 'OC' }, data: { before: { data: () => oc }, after: { data: () => ({ ...oc, status: 'cancelled' }) } } });
  ok('cancelado no cuenta', ((await db.doc(`${B}/delivery_loyalty_members/B`).get()).data().deliveredCount || 0) === 0);

  for (const r of res) console.log(r.join(' · '));
  const f = res.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${res.length - f}/${res.length} PASS`);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
