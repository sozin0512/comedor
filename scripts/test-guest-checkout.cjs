// firebase emulators:exec --project demo-hr --only firestore,auth "node scripts/test-guest-checkout.cjs"
process.env.GCLOUD_PROJECT = 'demo-hr';
const fns = require('../functions/index.js');
const G = require('../functions/guest-checkout.js');
const admin = require('../functions/node_modules/firebase-admin');
const db = admin.firestore();
const P = 'artifacts/comayagua-vip-pro-v4/public/data';
const call = (fn, data, auth = null, ip = '10.0.0.1') => fns[fn].run({ auth, data, rawRequest: { ip } });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };
const rejects = async (n, p, code) => { try { await p; ok(n, false); } catch (e) { ok(`${n} (${e.code})`, !code || e.code === code); } };
const TRIP = { serviceType: 'auto', origin: 'Parque Central, Comayagua', originLat: 14.4605, originLng: -87.6390, destination: 'Hospital Santa Teresa', destinationLat: 14.4520, destinationLng: -87.6420 };
(async () => {
  ok('tel: 9911-2233 → 50499112233', G.normalizeGuestPhone('9911-2233') === '50499112233');
  ok('tel: +504 9911 2233', G.normalizeGuestPhone('+504 9911 2233') === '50499112233');
  ok('tel: 2234-5678 (fijo) no', G.normalizeGuestPhone('2234-5678') === null);
  ok('tel: 7 dígitos no', G.normalizeGuestPhone('991122') === null);
  await rejects('sin nombre', call('guestCreateRequest', { kind: 'trip', name: '', phone: '99112233', payload: TRIP }), 'invalid-argument');
  await rejects('teléfono malo', call('guestCreateRequest', { kind: 'trip', name: 'Ana', phone: '123', payload: TRIP }), 'invalid-argument');
  await rejects('sin coordenadas', call('guestCreateRequest', { kind: 'trip', name: 'Ana', phone: '99112233', payload: { ...TRIP, originLat: null } }), 'invalid-argument');

  // viaje: el servidor pone la tarifa y los datos del cliente aunque el cliente mande otros
  const r = await call('guestCreateRequest', { kind: 'trip', name: 'Ana López', phone: '+504 9911-2233', deviceId: 'devA123456789', payload: { ...TRIP, priceNum: 1, price: 'L. 1.00', clientId: 'hacker', status: 'completed', driverId: 'x' } });
  const t = (await db.doc(`${P}/trips/${r.id}`).get()).data();
  ok('viaje creado pending', t.status === 'pending' && !t.driverId);
  ok('clientId guest_50499112233, guestClient', t.clientId === 'guest_50499112233' && t.guestClient === true && t.guestCheckout === true);
  ok('nombre y WhatsApp', t.clientName === 'Ana López' && t.clientPhone === '50499112233');
  ok('tarifa del servidor (no L. 1)', t.priceNum > 1 && t.price !== 'L. 1.00' && r.priceNum === t.priceNum);
  ok('createdVia app_guest, efectivo, no staff', t.createdVia === 'app_guest' && t.paymentMethod === 'efectivo' && t.staffAssistedClient === false);
  ok('token devuelto', typeof r.token === 'string' && r.token.length > 20);
  const gr = (await db.doc(`${P}/guest_requests/${r.id}`).get()).data();
  ok('token guardado como hash (no en claro)', gr.tokenHash && gr.tokenHash !== r.token);

  // límites: 3 activos por teléfono
  await call('guestCreateRequest', { kind: 'trip', name: 'Ana', phone: '99112233', deviceId: 'devA123456789', payload: TRIP });
  await call('guestCreateRequest', { kind: 'trip', name: 'Ana', phone: '99112233', deviceId: 'devA123456789', payload: TRIP });
  await rejects('4º activo bloqueado', call('guestCreateRequest', { kind: 'trip', name: 'Ana', phone: '99112233', deviceId: 'devA123456789', payload: TRIP }), 'resource-exhausted');
  await rejects('mismo equipo con otro número también', call('guestCreateRequest', { kind: 'trip', name: 'Ana', phone: '88776655', deviceId: 'devA123456789', payload: TRIP }), 'resource-exhausted');
  // terminado el viaje se libera el cupo
  await db.doc(`${P}/trips/${r.id}`).set({ status: 'completed' }, { merge: true });
  const r4 = await call('guestCreateRequest', { kind: 'trip', name: 'Ana', phone: '99112233', deviceId: 'devA123456789', payload: TRIP });
  ok('al terminar uno, vuelve a poder pedir', !!r4.id);
  // límite diario 10 por teléfono
  await db.doc(`${P}/guest_limits/p_50433334444`).set({ dayStartMs: Date.now(), dayCount: 10, active: [] });
  await rejects('límite diario 10', call('guestCreateRequest', { kind: 'trip', name: 'Luis', phone: '33334444', deviceId: 'devB123456789', payload: TRIP }), 'resource-exhausted');
  // bloqueado
  await db.doc(`${P}/guest_blocklist/50477778888`).set({ by: 'adm' });
  await rejects('número bloqueado', call('guestCreateRequest', { kind: 'trip', name: 'Xavi', phone: '77778888', deviceId: 'devC123456789', payload: TRIP }), 'permission-denied');

  // pedido de tienda: precios del producto en servidor, solo efectivo
  await db.doc(`${P}/stores/st1`).set({ name: 'Baleadas Doña Mary', ownerId: 'own1', approvalStatus: 'approved', active: true, category: 'comida', createdAt: new Date(), isOpen: true, cityId: 'comayagua', cityName: 'Comayagua', lat: 14.46, lng: -87.64, phone: '50495556666' });
  await db.doc(`${P}/store_products/p1`).set({ storeId: 'st1', name: 'Baleada sencilla', price: 25, available: true });
  await db.doc(`${P}/store_products/px`).set({ storeId: 'otra', name: 'Ajena', price: 5, available: true });
  const OP = { storeId: 'st1', items: [{ productId: 'p1', qty: 3, price: 0.01 }], deliveryAddress: 'Col. San Miguel, casa azul', deliveryLat: 14.455, deliveryLng: -87.64, recipientName: '', recipientPhone: '', notes: 'sin cebolla', deliveryVehicle: 'moto' };
  const o = await call('guestCreateRequest', { kind: 'store_order', name: 'Carla', phone: '96661234', deviceId: 'devD123456789', payload: { ...OP, paymentMethod: 'saldo' } });
  const od = (await db.doc(`${P}/store_orders/${o.id}`).get()).data();
  ok('pedido: precio del servidor 3×25 = 75', od.itemsTotal === 75 && od.items[0].price === 25);
  ok('pedido: efectivo, guest', od.paymentMethod === 'efectivo' && od.clientId === 'guest_50496661234' && od.guestClient === true && od.createdVia === 'app_guest');
  ok('pedido: quien recibe = invitado', od.recipientName === 'Carla' && od.recipientPhone === '50496661234' && od.status === 'pending' && od.deliveryFee === null);
  await rejects('producto de otra tienda', call('guestCreateRequest', { kind: 'store_order', name: 'Carla', phone: '96661234', deviceId: 'devD123456789', payload: { ...OP, items: [{ productId: 'px', qty: 1 }] } }), 'failed-precondition');
  await db.doc(`${P}/stores/st18`).set({ name: 'Bar', ownerId: 'own2', approvalStatus: 'approved', active: true, createdAt: new Date(), adultsOnly: true });
  await rejects('tienda +18 no', call('guestCreateRequest', { kind: 'store_order', name: 'Carla', phone: '96661234', deviceId: 'devD123456789', payload: { ...OP, storeId: 'st18' } }), 'failed-precondition');

  // seguimiento con token
  const tr = await call('guestTrackRequest', { kind: 'store_order', id: o.id, token: o.token });
  ok('seguimiento con token', tr.status === 'pending' && tr.itemsTotal === 75 && tr.storeName === 'Baleadas Doña Mary');
  await rejects('seguimiento con token malo', call('guestTrackRequest', { kind: 'store_order', id: o.id, token: 'xx' }), 'permission-denied');

  // pasar a la cuenta
  await rejects('reclamar sin sesión', call('guestClaimRequests', { items: [] }), 'unauthenticated');
  const cl = await call('guestClaimRequests', { items: [{ kind: 'store_order', id: o.id, token: o.token }, { kind: 'trip', id: r.id, token: r.token }, { kind: 'trip', id: r4.id, token: 'malo' }] }, { uid: 'carlaUid', token: {} });
  ok('reclama 2 (token malo no)', cl.claimed === 2);
  ok('pedido pasa a la cuenta', (await db.doc(`${P}/store_orders/${o.id}`).get()).data().clientId === 'carlaUid');
  ok('viaje con token malo sigue guest', (await db.doc(`${P}/trips/${r4.id}`).get()).data().clientId === 'guest_50499112233');
  const cl2 = await call('guestClaimRequests', { items: [{ kind: 'store_order', id: o.id, token: o.token }] }, { uid: 'otro', token: {} });
  ok('otro uid no lo vuelve a reclamar', cl2.claimed === 0 && (await db.doc(`${P}/store_orders/${o.id}`).get()).data().clientId === 'carlaUid');

  console.log(`\n${pass}/${pass + fail} ${fail ? 'FAIL' : 'PASS'}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
