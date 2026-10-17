process.env.GCLOUD_PROJECT = 'demo-hr';
// Zonas de envío con tarifa fija: lógica pura + callables + triggers (emulador firestore+auth).
//   firebase emulators:exec --project demo-hr --only firestore,auth "node scripts/test-delivery-zones.cjs"
const path = require('path'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
const fakeMessaging = { sendEachForMulticast: async (msg) => ({ successCount: msg.tokens.length, responses: msg.tokens.map(() => ({ success: true })) }) };
const msgPath = reqFn.resolve('firebase-admin/messaging');
require.cache[msgPath] = { id: msgPath, filename: msgPath, loaded: true, exports: { getMessaging: () => fakeMessaging } };
const fx = reqFn('./index.js');
const DZ = reqFn('./delivery-zones');
const db = reqFn('firebase-admin/firestore').getFirestore();
const APP = 'comayagua-vip-pro-v4'; const B = `artifacts/${APP}/public/data`;
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code || String(e.message || e); } };
const SUP = { uid: 'SUP', token: { email: 'sup@example.com' } };
const FAKESUP = { uid: 'FSUP', token: { email: 'fsup@example.com' } };
const OWNER = { uid: 'OWN', token: { email: 'own@example.com' } };
const OTHER = { uid: 'OTH', token: { email: 'oth@example.com' } };
const CLI = { uid: 'CLI', token: { email: 'cli@example.com' } };
const call = (fn, auth, data) => fx[fn].run({ auth, data, rawRequest: {} });
const sq = (lat, lng, d) => [{ lat: lat - d, lng: lng - d }, { lat: lat - d, lng: lng + d }, { lat: lat + d, lng: lng + d }, { lat: lat + d, lng: lng - d }];
const C = { lat: 14.4598, lng: -87.6378 };
(async () => {
  // ── lógica pura ──
  const tri = [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 0 }];
  ok('punto dentro del polígono', DZ.pointInPolygon(2, 2, tri));
  ok('punto fuera del polígono', !DZ.pointInPolygon(8, 8, tri));
  ok('punto en el borde cuenta dentro', DZ.pointInPolygon(0, 5, tri));
  ok('área ~1.1 km² para cuadro de 0.005°', Math.abs(DZ.polygonAreaKm2(sq(C.lat, C.lng, 0.005)) - 1.19) < 0.1, DZ.polygonAreaKm2(sq(C.lat, C.lng, 0.005)));
  const zc = { id: 'c', name: 'Céntrica', active: true, priority: 1, baseFee: 40, polygon: sq(C.lat, C.lng, 0.005), cityId: 'comayagua' };
  const zf = { id: 'f', name: 'Fuera', active: true, priority: 2, baseFee: 110, minFee: 100, maxFee: 120, polygon: sq(C.lat, C.lng, 0.03), cityId: 'comayagua' };
  const zoff = { id: 'x', name: 'Apagada', active: false, priority: 0, baseFee: 1, polygon: sq(C.lat, C.lng, 0.1), cityId: 'comayagua' };
  ok('centro: gana la zona céntrica (prioridad)', DZ.findZoneForPoint([zf, zc, zoff], C.lat, C.lng)?.id === 'c');
  ok('afuera del centro: zona fuera', DZ.findZoneForPoint([zf, zc], C.lat + 0.02, C.lng)?.id === 'f');
  ok('zona inactiva no cuenta', DZ.findZoneForPoint([zoff], C.lat, C.lng) === null);
  ok('misma prioridad: gana la más chica', DZ.findZoneForPoint([{ ...zf, priority: 1 }, zc], C.lat, C.lng)?.id === 'c');
  ok('otra ciudad no cuenta', DZ.findZoneForPoint([zc], C.lat, C.lng, 'siguatepeque') === null);
  ok('tienda: base', JSON.stringify(DZ.resolveStoreFee(zf, { mode: 'base' })) === JSON.stringify({ fee: 110, source: 'zone_base' }));
  ok('tienda: propia dentro del rango', DZ.resolveStoreFee(zf, { mode: 'custom', fee: 115 }).fee === 115 && DZ.resolveStoreFee(zf, { mode: 'custom', fee: 115 }).source === 'store_custom');
  ok('tienda: propia fuera del rango cae a la base', DZ.resolveStoreFee(zf, { mode: 'custom', fee: 95 }).source === 'zone_base');
  ok('tienda: sin rango acepta cualquier monto', DZ.resolveStoreFee(zc, { mode: 'custom', fee: 55 }).fee === 55);
  ok('validar: debajo del mínimo', DZ.validateStoreFee(zf, 'custom', 95) === 'Debe estar entre L 100 y L 120.');
  ok('validar: arriba del máximo', !!DZ.validateStoreFee(zf, 'custom', 130));
  ok('validar: negativo', !!DZ.validateStoreFee(zc, 'custom', -5));
  ok('validar: solo mínimo', DZ.validateStoreFee({ minFee: 50 }, 'custom', 40) === 'No puede ser menos de L 50.');
  const v1 = DZ.validateZoneInput({ name: 'X', cityId: 'comayagua', baseFee: 40, polygon: sq(C.lat, C.lng, 0.01) });
  ok('zona: nombre muy corto', !v1.ok);
  ok('zona: mínimo > base', !DZ.validateZoneInput({ name: 'Zona', cityId: 'comayagua', baseFee: 40, minFee: 50, polygon: sq(C.lat, C.lng, 0.01) }).ok);
  ok('zona: máximo < base', !DZ.validateZoneInput({ name: 'Zona', cityId: 'comayagua', baseFee: 40, maxFee: 30, polygon: sq(C.lat, C.lng, 0.01) }).ok);
  ok('zona: 2 puntos no alcanza', !DZ.validateZoneInput({ name: 'Zona', cityId: 'comayagua', baseFee: 40, polygon: [C, C] }).ok);
  ok('zona: punto inválido', !DZ.validateZoneInput({ name: 'Zona', cityId: 'comayagua', baseFee: 40, polygon: [...sq(C.lat, C.lng, 0.01), { lat: 'x', lng: 1 }] }).ok);
  ok('zona: válida', DZ.validateZoneInput({ name: 'Zona', cityId: 'comayagua', baseFee: 40, minFee: '', maxFee: 60, polygon: sq(C.lat, C.lng, 0.01) }).ok);
  ok('cotizar: sin ubicación → por distancia', DZ.quoteDelivery({ zones: [zc], lat: null, lng: null }).reason === 'no_location');
  ok('cotizar: fuera + bloquear', DZ.quoteDelivery({ zones: [zc], lat: 0, lng: 1, outsideBehavior: 'block' }).blocked === true);
  ok('cotizar: fuera + distancia', DZ.quoteDelivery({ zones: [zc], lat: 0, lng: 1, outsideBehavior: 'distance' }).blocked === false);
  ok('historial: diff de tarifa y forma', JSON.stringify(DZ.diffZone({ baseFee: 35, polygon: [1, 2, 3] }, { baseFee: 40, polygon: [1, 2, 3, 4] }).map((c) => c.field)) === '["baseFee","polygon"]');
  ok('propuesta Comayagua: centro dentro de céntrica', DZ.findZoneForPoint(DZ.SEED_ZONES.comayagua.map((z) => ({ ...z, active: true })), C.lat, C.lng)?.id === 'comayagua-centrica');

  // ── datos ──
  await db.doc(`${B}/users/SUP`).set({ role: 'supervisor', name: 'Sup Uno' });
  await db.doc(`artifacts/${APP}/roles/SUP`).set({ role: 'supervisor', source: 'test' });
  await db.doc(`${B}/users/FSUP`).set({ role: 'supervisor', name: 'Falso' });
  await db.doc(`${B}/users/OWN`).set({ role: 'client', name: 'Doña Tere' });
  await db.doc(`${B}/stores/ST1`).set({ name: 'Baleadas', ownerId: 'OWN', cityId: 'comayagua', adultsOnly: false });
  await db.doc(`${B}/stores/ST2`).set({ name: 'Otra ciudad', ownerId: 'OWN', cityId: 'siguatepeque', adultsOnly: false });

  // ── auth ──
  const zin = { name: 'Comayagua céntrica', cityId: 'comayagua', cityName: 'Comayagua', baseFee: 40, priority: 1, polygon: sq(C.lat, C.lng, 0.005), active: false };
  ok('cliente NO crea zona', (await code(call('staffUpsertDeliveryZone', CLI, zin))) === 'permission-denied');
  ok('perfil «supervisor» sin rol de confianza NO crea zona', (await code(call('staffUpsertDeliveryZone', FAKESUP, zin))) === 'permission-denied');
  ok('sin sesión NO crea zona', (await code(call('staffUpsertDeliveryZone', null, zin))) === 'unauthenticated');
  ok('supervisor: datos inválidos rechazados', (await code(call('staffUpsertDeliveryZone', SUP, { ...zin, minFee: 50 }))) === 'invalid-argument');
  const r1 = await call('staffUpsertDeliveryZone', SUP, zin);
  ok('supervisor crea zona', r1.ok && r1.zoneId);
  const zid = r1.zoneId;
  const r2 = await call('staffUpsertDeliveryZone', SUP, { ...zin, zoneId: zid, baseFee: 45 });
  ok('supervisor edita tarifa', r2.changed === true);
  const r3 = await call('staffUpsertDeliveryZone', SUP, { ...zin, zoneId: zid, baseFee: 45 });
  ok('guardar sin cambios no ensucia el historial', r3.changed === false);
  await call('staffSetDeliveryZoneActive', SUP, { zoneId: zid, active: true });
  const hist = (await db.collection(`${B}/delivery_zone_history`).where('zoneId', '==', zid).get()).docs.map((d) => d.data()).sort((a, b) => a.atMs - b.atMs);
  ok('historial: crear, editar, activar', hist.map((h) => h.action).join() === 'create,update,activate', hist.map((h) => h.action).join());
  const upd = hist.find((h) => h.action === 'update');
  ok('historial: quién y antes/después', upd.byUid === 'SUP' && upd.byName === 'Sup Uno' && upd.changes.some((c) => c.field === 'baseFee' && c.before === 40 && c.after === 45) && upd.atMs > 0);
  const fzin = { name: 'Comayagua fuera del centro', cityId: 'comayagua', baseFee: 110, minFee: 100, maxFee: 120, priority: 2, polygon: sq(C.lat, C.lng, 0.03), active: true };
  const fz = (await call('staffUpsertDeliveryZone', SUP, fzin)).zoneId;
  // seed
  const seed = await call('staffSeedDeliveryZones', SUP, { cityId: 'comayagua' });
  const seed2 = await call('staffSeedDeliveryZones', SUP, { cityId: 'comayagua' });
  const sd = await db.doc(`${B}/delivery_zones/comayagua-centrica`).get();
  ok('propuesta: 3 zonas inactivas, no se duplica', seed.created === 3 && seed2.created === 0 && sd.get('active') === false && sd.get('baseFee') === 40);
  ok('cliente NO carga propuesta', (await code(call('staffSeedDeliveryZones', CLI, {}))) === 'permission-denied');

  // ── tarifa de la tienda ──
  ok('otro usuario NO cambia tarifas de la tienda', (await code(call('merchantSetStoreZoneFees', OTHER, { storeId: 'ST1', fees: { [fz]: { mode: 'custom', fee: 110 } } }))) === 'permission-denied');
  ok('dueño: fuera del rango rechazado', (await code(call('merchantSetStoreZoneFees', OWNER, { storeId: 'ST1', fees: { [fz]: { mode: 'custom', fee: 95 } } }))) === 'invalid-argument');
  ok('dueño: zona de otra ciudad rechazada', (await code(call('merchantSetStoreZoneFees', OWNER, { storeId: 'ST2', fees: { [fz]: { mode: 'base' } } }))) === 'invalid-argument');
  const mf = await call('merchantSetStoreZoneFees', OWNER, { storeId: 'ST1', fees: { [fz]: { mode: 'custom', fee: 115 }, [zid]: { mode: 'base' } } });
  ok('dueño guarda su tarifa', mf.ok && (await db.doc(`${B}/store_delivery_fees/ST1`).get()).get(`fees.${fz}.fee`) === 115);
  const sh = (await db.collection(`${B}/delivery_zone_history`).where('storeId', '==', 'ST1').get()).docs.map((d) => d.data());
  ok('historial de la tienda', sh.length === 1 && sh[0].byRole === 'owner' && sh[0].changes.some((c) => c.after === 115));
  ok('supervisor puede corregir tarifa de tienda', (await code(call('merchantSetStoreZoneFees', SUP, { storeId: 'ST1', fees: { [fz]: { mode: 'custom', fee: 115 } } }))) === 'ok');

  // ── cotizar ──
  const q1 = await call('quoteStoreDeliveryFee', CLI, { storeId: 'ST1', lat: C.lat, lng: C.lng });
  ok('cotizar centro: L 45 céntrica (base)', q1.inZone && q1.fee === 45 && q1.zoneId === zid && q1.source === 'zone_base', JSON.stringify(q1));
  const q2 = await call('quoteStoreDeliveryFee', CLI, { storeId: 'ST1', lat: C.lat + 0.02, lng: C.lng });
  ok('cotizar fuera: L 115 de la tienda', q2.inZone && q2.fee === 115 && q2.source === 'store_custom');
  const q3 = await call('quoteStoreDeliveryFee', CLI, { storeId: 'ST1', lat: 15.5, lng: -88 });
  ok('cotizar lejos: por distancia (por defecto)', !q3.inZone && q3.behavior === 'distance' && !q3.blocked);
  ok('sin sesión NO cotiza', (await code(call('quoteStoreDeliveryFee', null, { storeId: 'ST1', lat: 1, lng: 1 }))) === 'unauthenticated');
  ok('cliente NO cambia «fuera de zonas»', (await code(call('staffSetDeliveryOutsideBehavior', CLI, { cityId: 'comayagua', behavior: 'block' }))) === 'permission-denied');
  await call('staffSetDeliveryOutsideBehavior', SUP, { cityId: 'comayagua', behavior: 'block' });
  const q4 = await call('quoteStoreDeliveryFee', CLI, { storeId: 'ST1', lat: 15.5, lng: -88 });
  ok('cotizar lejos con «bloquear»', q4.blocked === true);

  // ── trigger del pedido ──
  const ev = async (id, data) => { const ref = db.doc(`${B}/store_orders/${id}`); await ref.set(data); await fx.onStoreOrderCreatedZoneFee.run({ params: { appId: APP, orderId: id }, data: { data: () => data, ref } }); return (await ref.get()).data(); };
  const o1 = await ev('O1', { storeId: 'ST1', ownerId: 'OWN', clientId: 'CLI', status: 'pending', deliveryLat: C.lat + 0.02, deliveryLng: C.lng, deliveryFee: null, cityId: 'comayagua' });
  ok('pedido: el servidor pone L 115 y la zona', o1.deliveryFee === 115 && o1.deliveryZoneId === fz && o1.deliveryFeeSource === 'store_custom' && o1.status === 'pending');
  const o2 = await ev('O2', { storeId: 'ST1', ownerId: 'OWN', clientId: 'CLI', status: 'pending', deliveryLat: 15.5, deliveryLng: -88, cityId: 'comayagua' });
  ok('pedido fuera con «bloquear»: se cancela', o2.status === 'cancelled' && o2.cancelReason === 'outside_delivery_zones');
  await call('staffSetDeliveryOutsideBehavior', SUP, { cityId: 'comayagua', behavior: 'distance' });
  const o3 = await ev('O3', { storeId: 'ST1', ownerId: 'OWN', clientId: 'CLI', status: 'pending', deliveryLat: null, deliveryLng: null, cityId: 'comayagua' });
  ok('pedido sin ubicación: como hoy (por distancia)', o3.status === 'pending' && o3.deliveryFeeSource === 'distance_no_location' && o3.deliveryFee == null);
  // ── viaje de entrega ──
  await db.doc(`${B}/trips/T1`).set({ status: 'pending', storeOrderId: 'O1', priceNum: 61.5, price: 'L. 61.50' });
  const before = (await db.doc(`${B}/store_orders/O1`).get()).data();
  const after = { ...before, tripId: 'T1', status: 'out_for_delivery' };
  await fx.onStoreOrderTripZoneFee.run({ params: { appId: APP, orderId: 'O1' }, data: { before: { data: () => before }, after: { data: () => after } } });
  const t1 = (await db.doc(`${B}/trips/T1`).get()).data();
  ok('viaje de entrega corregido a L 115', t1.priceNum === 115 && t1.price === 'L. 115.00' && t1.deliveryZoneId === fz);
  for (const r of res) console.log(...r);
  console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
  process.exit(res.every((r) => r[0] === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
