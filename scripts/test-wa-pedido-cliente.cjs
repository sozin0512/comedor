process.env.GCLOUD_PROJECT = 'demo-hr';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-not-real';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key';
// WhatsApp «Pedir a tienda/restaurante» (cliente, functions/wa-customer-order.js) con Meta y Google SIMULADOS
// y Firestore del emulador (nunca sale un mensaje real):
//   firebase emulators:exec --project demo-hr --only firestore "node scripts/test-wa-pedido-cliente.cjs"
const path = require('path'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
const R = []; const ok = (n, c, x = '') => R.push([c ? 'PASS' : 'FAIL', n, x]);
const SENT = []; let GEO = null; const UNEXPECTED = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url); const res = (j, status = 200) => ({ ok: status < 300, status, json: async () => j });
  if (u.startsWith('https://graph.facebook.com/')) { SENT.push(JSON.parse(opts.body)); return res({ messages: [{ id: `wamid.${SENT.length}` }] }); }
  if (u.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
    if (!/components=country:HN/.test(u)) UNEXPECTED.push('geocode-sin-HN');
    return res(GEO ? { results: [{ formatted_address: GEO.address, geometry: { location: { lat: GEO.lat, lng: GEO.lng } } }] } : { results: [] });
  }
  UNEXPECTED.push(u.slice(0, 60)); return res({}, 404);
};
const take = () => { const x = SENT.splice(0, SENT.length); if (process.env.DUMP) console.log('>>', JSON.stringify(x)); return x; };
const bodyOf = (m) => m.text?.body || m.interactive?.body?.text || '';
const all = (ms) => ms.map(bodyOf).join('\n');
const rowsOf = (ms) => ms.flatMap((x) => x.interactive?.action?.sections?.[0]?.rows || []);
const btnsOf = (ms) => ms.flatMap((x) => x.interactive?.action?.buttons || []).map((b) => b.reply.id);

(async () => {
  const C = reqFn('./wa-customer-order');
  ok('entrada: botón pedir_tienda, «pedir», «restaurantes»', C.isEntry('pedir_tienda', '') && C.isEntry('', 'pedir') && C.isEntry('', 'restaurantes') && !C.isEntry('', 'quiero un viaje'));
  ok('abierta: isOpen=false → cerrada; horario 8–17 a las 20:00 HN → cerrada', !C.isOpenNow({ isOpen: false }) && !C.isOpenNow({ hours: { open: '08:00', close: '17:00' } }, Date.UTC(2026, 9, 23, 2, 0)) && C.isOpenNow({ hours: { open: '08:00', close: '17:00' } }, Date.UTC(2026, 9, 23, 16, 0)));
  ok('+18 nunca por WhatsApp', C.isAdultsOnly({ adultsOnly: true }) && C.isAdultsOnly({ requiresAge18: true }));
  ok('estados: accepted/preparing→aceptado · out_for_delivery→en camino · delivered · cancelled', C.orderStatusKey({ status: 'preparing' }) === 'accepted' && C.orderStatusKey({ status: 'out_for_delivery' }) === 'on_the_way' && C.orderStatusKey({ status: 'ready' }) === null);
  if (!process.env.FIRESTORE_EMULATOR_HOST) return finish();

  const fx = reqFn('./index.js'); const wa = reqFn('./whatsapp-cloud'); const DZ = reqFn('./delivery-zones');
  const { getFirestore } = reqFn('firebase-admin/firestore'); const db = getFirestore();
  const APP = 'comayagua-vip-pro-v4'; const A = `artifacts/${APP}/public/data`;
  const CLIENT = '50497771234';
  const mk = (id, d) => db.doc(`${A}/stores/${id}`).set({ adultsOnly: false, approvalStatus: 'approved', cityId: 'comayagua', cityName: 'Comayagua', ...d });
  await mk('R1', { ownerId: 'o1', name: 'Baleadas Doña Ana', category: 'comida', lat: 14.4600, lng: -87.6400, address: 'Barrio Abajo', phone: '50411112222' });
  await mk('R2', { ownerId: 'o2', name: 'Pollo Cerrado', category: 'comida', lat: 14.461, lng: -87.641, isOpen: false });
  await mk('R3', { ownerId: 'o3', name: 'Sin Aprobar', category: 'comida', lat: 14.461, lng: -87.641, approvalStatus: 'pending' });
  await mk('R4', { ownerId: 'o4', name: 'Bar +18', category: 'comida', lat: 14.461, lng: -87.641, adultsOnly: true });
  await mk('R5', { ownerId: 'o5', name: 'Comida Lejos SPS', category: 'comida', lat: 15.50, lng: -88.03 });
  await mk('T1', { ownerId: 'o6', name: 'Farmacia Central', category: 'farmacia', lat: 14.462, lng: -87.642, address: 'Centro' });
  for (let i = 1; i <= 11; i++) await db.doc(`${A}/store_products/P${i}`).set({ storeId: 'R1', name: `Baleada ${i}`, price: 20 + i, available: true, sortOrder: i });
  await db.doc(`${A}/store_products/P0`).set({ storeId: 'R1', name: 'Agotada', price: 10, available: false, sortOrder: 0 });
  await db.doc(`${A}/store_products/F1`).set({ storeId: 'T1', name: 'Acetaminofén', price: 35, stock: 2, available: true });
  // zona de Comayagua (solo emulador) + Carro apagado en Disponibilidad
  await db.doc(`${A}/delivery_zones/zc`).set({ name: 'Céntrica', cityId: 'comayagua', baseFee: 40, active: true, priority: 1, polygon: [{ lat: 14.44, lng: -87.66 }, { lat: 14.48, lng: -87.66 }, { lat: 14.48, lng: -87.62 }, { lat: 14.44, lng: -87.62 }] });
  await db.doc(`${A}/appSettings/main`).set({ serviceAvailability: { comayagua: { auto: { mode: 'off', message: 'Carro no disponible hoy' }, delivery: { mode: 'on' } } } });
  const say = async (text, buttonId = '', location = null) => { await wa.routeAssistantMessage(CLIENT, text, buttonId, 'Luis', location, null, null); return take(); };

  let m = await say('hola');
  ok('menú principal incluye «Pedir a tienda/rest.»', rowsOf(m).some((r) => r.id === 'pedir_tienda') && rowsOf(m).some((r) => r.id === 'viaje'), JSON.stringify(m).slice(0, 500));
  m = await say('', 'pedir_tienda');
  ok('elige Restaurantes o Tiendas', ['co_type_rest', 'co_type_shop'].every((x) => btnsOf(m).includes(x)));
  m = await say('', 'co_type_rest');
  ok('pide la ubicación (pin) o dirección', m.some((x) => x.interactive?.type === 'location_request_message'));
  GEO = { address: 'Lima, Perú', lat: -12.04, lng: -77.04 };
  m = await say('gasolinera puma');
  ok('dirección fuera de Honduras → rechazada', /No encontré esa dirección en Honduras/.test(all(m)));
  m = await say('', '', { lat: 14.47, lng: -87.63, address: 'Col. Primero de Mayo, Comayagua' });
  const st = rowsOf(m).map((r) => r.id);
  ok('lista: solo restaurantes abiertos, aprobados, sin +18 y cercanos', st.join() === 'co_st:R1', st.join());
  m = await say('', 'co_st:R4');
  ok('id manipulado (+18) → rechazado', /no está disponible/.test(all(m)));
  m = await say('', 'co_st:R1');
  let rows = rowsOf(m);
  ok('menú con precios, 8 por página + «Más productos»', rows.length === 9 && rows[0].title === 'Baleada 1' && rows[0].description.startsWith('L. 21.00') && rows[8].id === 'co_more' && !rows.some((r) => /Agotada/.test(r.title)));
  m = await say('', 'co_more');
  rows = rowsOf(m);
  ok('página 2: Baleada 9–11', rows.filter((r) => r.id.startsWith('co_p:')).map((r) => r.title).join() === 'Baleada 9,Baleada 10,Baleada 11');
  m = await say('', 'co_p:P10');
  ok('elige producto → ¿cuántos?', /Cuántos/.test(all(m)) && btnsOf(m).includes('co_q:2'));
  m = await say('', 'co_q:2');
  ok('agrega al carrito con subtotal', /Agregué 2× Baleada 10/.test(all(m)) && /L\. 60\.00/.test(all(m)));
  await say('', 'co_keep'); await say('', 'co_first'); await say('', 'co_p:P1');
  m = await say('3');
  ok('cantidad escrita (3) → subtotal L. 123.00', /L\. 123\.00/.test(all(m)));
  m = await say('', 'co_cart');
  ok('carrito: líneas, total y quitar', /2× Baleada 10/.test(all(m)) && /3× Baleada 1/.test(all(m)) && rowsOf(m).some((r) => r.id === 'co_rm:P1'));
  m = await say('', 'co_rm:P1');
  ok('quitar 1 → 2× Baleada 1, L. 102.00', /2× Baleada 1 /.test(all(m)) && /L\. 102\.00/.test(all(m)));
  m = await say('', 'co_checkout');
  ok('moto/carro con Disponibilidad (carro apagado)', /Carro — No disponible/.test(all(m)) && btnsOf(m).includes('co_veh_moto') && !btnsOf(m).includes('co_veh_auto'));
  m = await say('carro');
  ok('escribir «carro» apagado → no avanza', /Carro no disponible hoy|No disponible/.test(all(m)) && !/Confirmar/.test(JSON.stringify(m)));
  m = await say('', 'co_veh_moto');
  ok('total: Productos L. 102.00 + Envío L. 40.00 (zona Céntrica) = L. 142.00', all(m).includes('Productos L. 102.00 + Envío L. 40.00 = *L. 142.00*'), all(m).slice(-120));
  m = await say('', 'co_confirm');
  ok('confirmado → «Pedido enviado» y cómo cancelar', /Pedido enviado/.test(all(m)) && /cancelar/.test(all(m)));
  let snap = await db.collection(`${A}/store_orders`).where('waCustomerPhone', '==', CLIENT).get();
  ok('se creó 1 pedido', snap.size === 1);
  const oref = snap.docs[0].ref; let o = snap.docs[0].data();
  const appKeys = ['storeId','storeName','ownerId','clientId','clientName','clientPhone','items','itemsBaseTotal','itemsDisplayTotal','itemsTotal','platformFeeMerchant','platformFeeBuyer','platformFeeTotal','commissionPercent','tariffSplit','weeklyCommissionRate','status','deliveryAddress','deliveryLat','deliveryLng','recipientName','recipientPhone','notes','deliveryVehicle','paymentMethod','paymentStatus','paidAmount','paidAt','cityId','cityName','storeAddress','storeLat','storeLng','storePhone','tripId','deliveryFee','createdAt','updatedAt'];
  const miss = appKeys.filter((k) => !(k in o));
  ok('mismas claves que el pedido de la app (js/merchant-stores.js)', !miss.length, miss.join());
  ok("pedido 'pending', efectivo, moto, total productos L. 102, ownerId de la tienda", o.status === 'pending' && o.paymentMethod === 'efectivo' && o.deliveryVehicle === 'moto' && o.itemsTotal === 102 && o.ownerId === 'o1' && o.clientId === `guest_${CLIENT}`);
  ok('precios desde el servidor por línea', o.items.find((i) => i.productId === 'P10').price === 30 && o.items.find((i) => i.productId === 'P1').qty === 2);
  // mismo trigger de tarifa de la app
  await fx.onStoreOrderCreatedZoneFee.run({ params: { appId: APP, orderId: oref.id }, data: await oref.get() });
  o = (await oref.get()).data();
  ok('onStoreOrderCreatedZoneFee (app): tarifa L. 40 zona Céntrica = la cotizada', o.deliveryFee === 40 && o.deliveryZoneName === 'Céntrica');

  // ── avisos de estado ──
  await db.collection(`${A}/whatsapp_cloud_inbox`).add({ from: CLIENT, timestamp: Math.floor(Date.now() / 1000) });
  const upd = async (b, a) => { await fx.onWaCustomerOrderStatus.run({ params: { orderId: oref.id }, data: { before: { data: () => b }, after: { data: () => a, ref: oref } } }); return take(); };
  m = await upd(o, { ...o, status: 'accepted' });
  ok('aviso «aceptado»', /aceptó tu pedido/.test(all(m)) && m[0]?.to === CLIENT);
  m = await upd({ ...o, status: 'accepted' }, { ...o, status: 'preparing' });
  ok('accepted → preparing no repite', m.length === 0);
  m = await upd({ ...o, status: 'ready' }, { ...o, status: 'out_for_delivery', driverName: 'Carlos Pérez' });
  ok('aviso «en camino» con conductor', /Carlos/.test(all(m)) && /en camino/.test(all(m)));
  m = await upd({ ...o, status: 'out_for_delivery' }, { ...o, status: 'delivered' });
  ok('aviso «entregado»', /entregado/.test(all(m)));
  m = await upd({ ...o, status: 'out_for_delivery' }, { ...o, status: 'delivered', waCustomerStatusSent: (await oref.get()).get('waCustomerStatusSent') });
  ok('reintento del trigger → no duplica', m.length === 0);
  const C2 = C({ db, APP_ID: 'x', send: {}, normalizePhone: (p) => p, lastInboundAtMs: async () => Date.now() - 30 * 3600e3, sendTemplate: async () => ({ ok: true }), templateName: () => '', log: { warn() {} } });
  const out = await C2.onOrderStatusChange({ status: 'pending' }, { status: 'accepted', createdVia: 'whatsapp_customer', waCustomerPhone: CLIENT }, 'x', null);
  ok('fuera de 24 h sin plantilla → no envía (registra motivo)', out.skipped && out.reason === 'outside_24h_no_template');
  let tpl = null; const C3 = C({ db, APP_ID: 'x', send: {}, normalizePhone: (p) => p, lastInboundAtMs: async () => 0, sendTemplate: async (...a) => { tpl = a; return { ok: true }; }, templateName: () => 'pedido_tienda_estado' });
  await C3.onOrderStatusChange({ status: 'pending' }, { status: 'cancelled', storeName: 'Baleadas Doña Ana', createdVia: 'whatsapp_customer', waCustomerPhone: CLIENT }, 'x', null);
  ok('fuera de 24 h con plantilla → pedido_tienda_estado {{1}} tienda {{2}} estado', tpl && tpl[1] === 'pedido_tienda_estado' && tpl[2][0] === 'Baleadas Doña Ana' && /cancel/.test(tpl[2][1]));

  // ── tienda (stock) + cancelar antes de aceptar ──
  await oref.update({ status: 'delivered' });
  await say('', 'pedir_tienda'); m = await say('', 'co_type_shop');
  ok('tiendas → categorías', rowsOf(m).some((r) => r.id === 'co_cat:farmacia'));
  m = await say('', 'co_cat:farmacia');
  GEO = { address: 'Barrio Arriba, Comayagua', lat: 14.465, lng: -87.635 };
  m = await say('barrio arriba comayagua');
  ok('dirección escrita → geocodificada en HN → confirmar', /Barrio Arriba/.test(all(m)) && btnsOf(m).includes('co_dest_ok'));
  m = await say('', 'co_dest_ok');
  ok('farmacias cerca: Farmacia Central', rowsOf(m).map((r) => r.id).join() === 'co_st:T1');
  await say('', 'co_st:T1'); await say('', 'co_p:F1');
  m = await say('', 'co_q:3');
  ok('stock 2 → no deja 3', /solo tiene 2/.test(all(m)));
  await say('', 'co_q:2'); await say('', 'co_checkout'); m = await say('', 'co_veh_moto');
  ok('resumen tienda: Productos L. 70.00 + Envío L. 40.00 = L. 110.00', all(m).includes('Productos L. 70.00 + Envío L. 40.00 = *L. 110.00*'));
  await say('', 'co_confirm');
  snap = await db.collection(`${A}/store_orders`).where('storeId', '==', 'T1').get();
  const o2 = snap.docs[0].ref;
  m = await say('cancelar');
  ok('«cancelar» antes de que la tienda acepte → cancelado', /cancelé tu pedido/.test(all(m)) && (await o2.get()).get('status') === 'cancelled' && (await o2.get()).get('cancelledBy') === 'client');
  await o2.update({ status: 'accepted' });
  m = await say('cancelar');
  ok('ya aceptado → no cancela', /ya aceptó/.test(all(m)) && (await o2.get()).get('status') === 'accepted');
  ok('ninguna llamada de red fuera de Meta/Geocode simulados', UNEXPECTED.length === 0, UNEXPECTED.join());
  finish();
})().catch((e) => { console.error(e); ok('sin excepción', false, e.stack); finish(); });

function finish() {
  for (const [s, n, x] of R) console.log(`${s}  ${n}${x && s === 'FAIL' ? `  → ${x}` : ''}`);
  const f = R.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${R.length - f}/${R.length} OK`); process.exit(f ? 1 : 0);
}
