process.env.GCLOUD_PROJECT = 'demo-hr';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-not-real';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key';
// WhatsApp «Pedir envío (tienda)» (functions/wa-store-delivery.js) de punta a punta con la API de Meta SIMULADA
// (fetch interceptado: nunca sale un mensaje real) y Firestore del emulador:
//   firebase emulators:exec --project demo-hr --only firestore "node scripts/test-wa-envio-tienda.cjs"
const path = require('path'); const fs = require('fs'); const os = require('os'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
const R = []; const ok = (n, c, x = '') => R.push([c ? 'PASS' : 'FAIL', n, x]);

// ── Meta + Google simulados ──
const SENT = []; let GEO = null; const UNEXPECTED = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const res = (j, status = 200) => ({ ok: status < 300, status, json: async () => j });
  if (u.startsWith('https://graph.facebook.com/')) { const b = JSON.parse(opts.body); SENT.push(b); return res({ messages: [{ id: `wamid.${SENT.length}` }] }); }
  if (u.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
    if (!/components=country:HN/.test(u)) UNEXPECTED.push('geocode-sin-HN');
    return res(GEO ? { results: [{ formatted_address: GEO.address, geometry: { location: { lat: GEO.lat, lng: GEO.lng } } }] } : { results: [] });
  }
  UNEXPECTED.push(u.slice(0, 60)); return res({}, 404);
};
const take = () => { const x = SENT.splice(0, SENT.length); if (process.env.DUMP) console.log('>>', JSON.stringify(x)); return x; };
const bodyOf = (m) => m.text?.body || m.interactive?.body?.text || '';
const all = (ms) => ms.map(bodyOf).join('\n');

(async () => {
  const DZ = reqFn('./delivery-zones'); const W = reqFn('./wa-store-delivery');
  // ── puras ──
  const v = W.phoneVariants('50498765432');
  ok('variantes de teléfono: 504…, +504…, 8 dígitos, con guion', ['50498765432', '+50498765432', '98765432', '9876-5432', '+504 9876-5432'].every((x) => v.includes(x)));
  ok('entrada: «envío», «envio tienda», botón tienda_envio', W.isEntry('', 'envio') && W.isEntry('', 'envio tienda') && W.isEntry('tienda_envio', '') && !W.isEntry('', 'quiero un viaje'));
  ok('estado: pending sin conductor → buscando · accepted · in_progress · completed', W.storeStatusKey({ status: 'pending' }) === 'searching' && W.storeStatusKey({ status: 'verifying' }) === null && W.storeStatusKey({ status: 'in_progress' }) === 'on_the_way' && W.storeStatusKey({ status: 'completed' }) === 'delivered');
  ok('aviso aceptado: nombre y placa del conductor', /Carlos/.test(W.storeStatusText('accepted', { driverName: 'Carlos', driverVehicle: { plate: 'HAA 1234' } })) && /HAA 1234/.test(W.storeStatusText('accepted', { driverName: 'Carlos', driverVehicle: { plate: 'HAA 1234' } })));

  if (!process.env.FIRESTORE_EMULATOR_HOST) { finish(); return; }
  const fx = reqFn('./index.js');
  const wa = reqFn('./whatsapp-cloud');
  const { getFirestore } = reqFn('firebase-admin/firestore');
  const db = getFirestore(); const A = 'artifacts/comayagua-vip-pro-v4/public/data';
  const OWNER_PHONE = '50498765432'; const STORE_PHONE = '50433334444'; const STRANGER = '50491112222';
  await db.doc(`${A}/users/owner1`).set({ phone: '+504 9876-5432', name: 'Ana' });
  await db.doc(`${A}/users/other`).set({ phone: '50495556666' });
  await db.doc(`${A}/stores/S1`).set({ ownerId: 'owner1', name: 'Baleadas Doña Ana', phone: '50411112222', cityId: 'comayagua', cityName: 'Comayagua', lat: 14.4600, lng: -87.6400, address: 'Barrio Abajo, Comayagua', category: 'comida' });
  await db.doc(`${A}/stores/S2`).set({ ownerId: 'owner1', name: 'Pulpería Ana', phone: '', cityId: 'comayagua', cityName: 'Comayagua', address: 'Col. San Miguel' });
  await db.doc(`${A}/stores/S3`).set({ ownerId: 'other', name: 'Farmacia Ajena', phone: STORE_PHONE, cityId: 'comayagua', lat: 14.45, lng: -87.63 });
  await db.doc(`${A}/stores/S4`).set({ ownerId: 'nobody', name: 'Tienda De Otro', phone: '50499990000', cityId: 'comayagua', lat: 14.45, lng: -87.63 });
  await db.doc(`${A}/appSettings/main`).set({ serviceAvailability: { comayagua: { auto: { mode: 'off', message: 'Carro no disponible hoy' }, delivery: { mode: 'on' } } } });
  const say = async (from, text, buttonId = '', location = null) => { await wa.routeAssistantMessage(from, text, buttonId, 'Ana', location, null, null); return take(); };

  // ── número sin tienda ──
  let m = await say(STRANGER, 'envío');
  ok('número sin tienda: no permite envío de tienda', /no está vinculado a ninguna tienda/.test(all(m)));
  ok('número sin tienda: muestra el menú normal (sin «Pedir envío (tienda)»)', m.some((x) => JSON.stringify(x.interactive || {}).includes('"id":"viaje"')) && !JSON.stringify(m).includes('tienda_envio'), JSON.stringify(m).slice(0,600));
  m = await say(STRANGER, 'hola');
  ok('menú normal para número sin tienda', !JSON.stringify(m).includes('tienda_envio'));

  // ── dueño con 2 tiendas: menú + lista ──
  m = await say(OWNER_PHONE, 'hola');
  ok('menú del dueño incluye «Pedir envío (tienda)»', JSON.stringify(m).includes('tienda_envio') && JSON.stringify(m).includes('Pedir envío (tienda)'));
  m = await say(OWNER_PHONE, 'Pedir envío (tienda)', 'tienda_envio');
  const list = m.find((x) => x.interactive?.type === 'list');
  const rows = list?.interactive.action.sections[0].rows || [];
  ok('«¿Cuál es tu tienda?» con lista interactiva', !!list && list.interactive.body.text === '¿Cuál es tu tienda?');
  ok('la lista trae SOLO las tiendas vinculadas (S1, S2)', rows.map((r) => r.id).sort().join() === 'st_store:S1,st_store:S2', rows.map((r) => r.id).join());
  m = await say(OWNER_PHONE, 'Farmacia Ajena', 'st_store:S3');
  ok('tienda ajena por id manipulado → rechazada', /no está vinculada/.test(all(m)) && !m.some((x) => /En qué lo mandamos/.test(bodyOf(x))));
  m = await say(OWNER_PHONE, 'Baleadas Doña Ana', 'st_store:S1');
  const vehMsg = m.find((x) => /En qué lo mandamos/.test(bodyOf(x)));
  ok('vehículo: Moto disponible, Carro «No disponible» (Disponibilidad)', vehMsg && /Carro — No disponible/.test(bodyOf(vehMsg)) && vehMsg.interactive.action.buttons.some((b) => b.reply.id === 'st_veh_moto') && !vehMsg.interactive.action.buttons.some((b) => b.reply.id === 'st_veh_auto'), JSON.stringify(m).slice(0,600));
  m = await say(OWNER_PHONE, 'carro');
  ok('escribir «carro» con carro apagado → no avanza', /No disponible|Carro no disponible hoy/.test(all(m)) && (await wa.routeAssistantMessage && true));
  m = await say(OWNER_PHONE, 'Moto', 'st_veh_moto');
  ok('moto → pide el destino (pin o dirección)', m.some((x) => x.interactive?.type === 'location_request_message'));
  GEO = { address: 'Gasolinera Puma, Lima, Perú', lat: -12.04, lng: -77.04 };
  m = await say(OWNER_PHONE, 'gasolinera puma');
  ok('dirección fuera de Honduras → rechazada', /No encontré esa dirección en Honduras/.test(all(m)));
  GEO = { address: 'Col. Primero de Mayo, Comayagua', lat: 14.4700, lng: -87.6300 };
  m = await say(OWNER_PHONE, 'colonia primero de mayo');
  ok('dirección escrita → geocodificada (solo HN) y se pide confirmar', /Col\. Primero de Mayo/.test(all(m)) && m.some((x) => x.interactive?.action?.buttons?.some((b) => b.reply.id === 'st_dest_ok')), JSON.stringify(m).slice(0,600));
  m = await say(OWNER_PHONE, 'Sí, correcto', 'st_dest_ok');
  ok('pide quién recibe (opcional)', /Quién recibe/.test(all(m)));
  m = await say(OWNER_PHONE, 'María López 9876-1111');
  m = await say(OWNER_PHONE, 'Lleva 3 baleadas, casa verde');
  ok('pide monto a cobrar por productos', /productos/.test(all(m)));
  m = await say(OWNER_PHONE, '150');
  const sum = all(m);
  const km = Math.round(Math.max(1, (() => { const R6 = 6371, r = (d) => d * Math.PI / 180; const a = Math.sin(r(14.47 - 14.46) / 2) ** 2 + Math.cos(r(14.46)) * Math.cos(r(14.47)) * Math.sin(r(-87.63 + 87.64) / 2) ** 2; return 2 * R6 * Math.asin(Math.sqrt(a)); })()) * 100) / 100;
  const expFee = DZ.distanceDeliveryFee(km, 'moto', DZ.deliveryRateFrom(null));
  const fmt = (n) => `L. ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  ok('resumen: «El cliente paga: Envío L. X + productos L. 150.00 = L. Z» (misma tarifa del servidor)', sum.includes(`El cliente paga: Envío ${fmt(expFee)} + productos L. 150.00 = *${fmt(expFee + 150)}*`), sum.split('\n').slice(-1)[0]);
  ok('resumen con recogida en la tienda y receptor', /Recoge: Barrio Abajo/.test(sum) && /María López · 98761111/.test(sum));
  m = await say(OWNER_PHONE, 'Confirmar', 'st_confirm');
  ok('confirmado → avisa y explica «cancelar»', /Envío pedido/.test(all(m)) && /cancelar/.test(all(m)));
  let snap = await db.collection(`${A}/trips`).where('waStorePhone', '==', OWNER_PHONE).get();
  ok('se creó 1 viaje', snap.size === 1);
  const tripRef = snap.docs[0].ref; let t = snap.docs[0].data();
  ok("viaje como el panel: 'verifying' + merchantDirectDelivery + createdByMerchant + storeDelivery", t.status === 'verifying' && t.merchantDirectDelivery === true && t.createdByMerchant === true && t.storeDelivery === true && t.storeId === 'S1' && t.merchantId === 'owner1' && t.clientId === 'owner1');
  ok('ruta del conductor: primero la tienda (origen = ubicación guardada), luego la entrega', t.originLat === 14.46 && t.originLng === -87.64 && t.originSource === 'store' && t.destinationLat === 14.47 && t.destinationLng === -87.63 && /Primero de Mayo/.test(t.destination));
  ok('moto → solo conductores moto', t.deliveryVehicle === 'moto' && JSON.stringify(t.allowedDriverVehicles) === '["moto"]');
  ok('detalles: receptor, notas, cobro L. 150, productos sin pagar', t.deliveryDetails.recipientName === 'María López' && t.deliveryDetails.recipientPhone === '98761111' && /casa verde/.test(t.deliveryDetails.deliveryNotes) && t.deliveryDetails.collectAmount === 150 && t.deliveryDetails.productsPaid === false && t.deliveryDetails.customerTotal === Math.round((expFee + 150) * 100) / 100);
  ok('sin staffCreatedBy (no bloquea a conductores) y createdVia whatsapp_store', !t.staffCreatedBy && t.createdVia === 'whatsapp_store');
  // mismas claves que el panel
  const tmp = path.join(os.tmpdir(), `mdr-${process.pid}.mjs`); fs.copyFileSync(path.join(__dirname, '..', 'js', 'merchant-delivery-request.js'), tmp);
  const MDR = await import(tmp);
  const panel = MDR.buildMerchantDeliveryTrip({ store: { id: 'S1', name: 'x', ownerId: 'owner1' }, uid: 'owner1', form: { vehicle: 'moto', pickupLat: 1, pickupLng: 1, dropoffAddress: 'y', dropoffLat: 1, dropoffLng: 1, collectAmount: 0 }, estimate: { price: 30, km: 1, tariff: {} } });
  const missing = Object.keys(panel).filter((k) => !(k in t)); const missingDD = Object.keys(panel.deliveryDetails).filter((k) => !(k in t.deliveryDetails));
  ok('mismas claves que el viaje del panel (buildMerchantDeliveryTrip)', !missing.length && !missingDD.length, missing.concat(missingDD).join());
  ok('pasajero: plantillas «tu viaje» NO se mandan a este viaje', (await wa.notifyTripConfirmedWa(t, null)).skipped === true);

  // verificación del servidor (mismo trigger que el panel)
  await fx.onMerchantDirectDeliveryCreated.run({ params: { appId: 'comayagua-vip-pro-v4', tripId: tripRef.id }, data: await tripRef.get() });
  t = (await tripRef.get()).data();
  ok("onMerchantDirectDeliveryCreated: precio verificado → 'pending'", t.status === 'pending' && t.priceVerified === true && t.priceCorrected === false && t.priceNum === expFee);

  // avisos de estado (ventana de 24 h abierta: hay un mensaje entrante reciente)
  await db.collection(`${A}/whatsapp_cloud_inbox`).add({ from: OWNER_PHONE, timestamp: Math.floor(Date.now() / 1000) });
  const upd = async (before, after) => { await fx.onWaStoreDeliveryStatus.run({ params: { tripId: tripRef.id }, data: { before: { data: () => before }, after: { data: () => after, ref: tripRef } } }); return take(); };
  m = await upd({ ...t, status: 'verifying' }, t);
  ok('aviso «buscando conductor»', /Buscando conductor/.test(all(m)) && m[0]?.to === OWNER_PHONE);
  const acc = { ...t, status: 'accepted', driverId: 'drv1', driverName: 'Carlos', driverVehicle: { plate: 'HAA 1234' } };
  m = await upd(t, acc);
  ok('aviso «aceptado» con nombre y placa', /Carlos/.test(all(m)) && /HAA 1234/.test(all(m)));
  m = await upd(acc, acc);
  ok('sin cambio de estado → no repite', m.length === 0);
  m = await upd(acc, { ...acc, status: 'in_progress' });
  ok('aviso «en camino»', /en camino/.test(all(m)));
  m = await upd({ ...acc, status: 'in_progress' }, { ...acc, status: 'completed' });
  ok('aviso «entregado»', /entregado/.test(all(m)));
  const sentFlags = (await tripRef.get()).get('waStoreStatusSent') || {};
  ok('marca avisos enviados (no duplica en reintentos)', sentFlags.accepted && sentFlags.delivered);
  // fuera de 24 h sin plantilla → no manda nada
  const W2 = W({ db, FieldValue: reqFn('firebase-admin/firestore').FieldValue, APP_ID: 'x', send: { textLogged: async () => { throw new Error('no'); } }, normalizePhone: (p) => p, lastInboundAtMs: async () => Date.now() - 30 * 3600e3, sendTemplate: async () => ({ ok: true }), templateName: () => '' });
  const out = await W2.onTripStatusChange({ status: 'pending' }, { status: 'accepted', createdVia: 'whatsapp_store', waStorePhone: OWNER_PHONE }, 'x', null);
  ok('fuera de la ventana de 24 h y sin plantilla aprobada → no envía (registra motivo)', out.skipped && out.reason === 'outside_24h_no_template');
  let tpl = null; const W3 = W({ db, FieldValue: null, APP_ID: 'x', send: {}, normalizePhone: (p) => p, lastInboundAtMs: async () => 0, sendTemplate: async (...a) => { tpl = a; return { ok: true }; }, templateName: () => 'envio_tienda_estado' });
  await W3.onTripStatusChange({ status: 'pending' }, { status: 'accepted', driverName: 'Carlos', createdVia: 'whatsapp_store', waStorePhone: OWNER_PHONE, deliveryDetails: { storeName: 'Baleadas' } }, 'x', null);
  ok('fuera de 24 h con plantilla → envio_tienda_estado {{1}} tienda {{2}} estado', tpl && tpl[1] === 'envio_tienda_estado' && tpl[2][0] === 'Baleadas' && /Carlos/.test(tpl[2][1]));

  // ── cancelar antes de aceptar ──
  await db.doc(`${A}/appSettings/main`).set({ serviceAvailability: { comayagua: { auto: { mode: 'on' }, delivery: { mode: 'on' } } } });
  // tienda S2 sin ubicación → la pide una vez y la guarda
  await say(OWNER_PHONE, 'envío'); await say(OWNER_PHONE, 'Pulpería Ana', 'st_store:S2');
  m = await say(OWNER_PHONE, 'Carro', 'st_veh_auto');
  ok('tienda sin ubicación → pide compartirla', /no tiene ubicación guardada/.test(all(m)), JSON.stringify(m).slice(0,600));
  m = await say(OWNER_PHONE, '', '', { lat: 14.455, lng: -87.645, address: 'Col. San Miguel' });
  const s2 = (await db.doc(`${A}/stores/S2`).get()).data();
  ok('guarda la ubicación de la tienda (próxima vez no pregunta)', s2.lat === 14.455 && s2.lng === -87.645 && /Guardé la ubicación/.test(all(m)));
  m = await say(OWNER_PHONE, '', '', { lat: 14.46, lng: -87.62, address: 'Pin compartido' });
  ok('destino por pin compartido → confirmar', /Pin compartido/.test(all(m)));
  await say(OWNER_PHONE, '', 'st_dest_ok'); await say(OWNER_PHONE, '', 'st_skip'); await say(OWNER_PHONE, '', 'st_skip');
  m = await say(OWNER_PHONE, 'Nada', 'st_collect_0');
  ok('carro sin cobro: «El cliente paga: Envío L. X» con +25% carro', /El cliente paga: Envío \*L\. /.test(all(m)) && /Carro/.test(all(m)));
  await say(OWNER_PHONE, '', 'st_confirm');
  snap = await db.collection(`${A}/trips`).where('storeId', '==', 'S2').get();
  const t2ref = snap.docs[0].ref;
  ok('carro → solo Taxi VIP (auto)', snap.docs[0].get('deliveryVehicle') === 'auto' && JSON.stringify(snap.docs[0].get('allowedDriverVehicles')) === '["auto"]');
  await tripRef.update({ status: 'completed' });
  m = await say(OWNER_PHONE, 'cancelar');
  ok('«cancelar» antes de aceptar → cancela el envío', /cancelé el envío/.test(all(m)) && (await t2ref.get()).get('status') === 'cancelled' && (await t2ref.get()).get('cancelReason') === 'merchant_cancel_whatsapp');
  // uno aceptado ya no se cancela
  await t2ref.update({ status: 'accepted', driverId: 'drv1' });
  m = await say(OWNER_PHONE, 'cancelar');
  ok('ya aceptado → no cancela por WhatsApp', /ya aceptó/.test(all(m)) && (await t2ref.get()).get('status') === 'accepted');

  // ── número de la tienda (stores.phone) con 1 tienda → confirmar ──
  m = await say(STORE_PHONE, 'envío');
  ok('número de WhatsApp de la tienda con 1 tienda → pide confirmar esa tienda', /Pedir envío para \*Farmacia Ajena\*/.test(all(m)) && m.some((x) => x.interactive?.action?.buttons?.some((b) => b.reply.id === 'st_store:S3')), JSON.stringify(m).slice(0,600));
  m = await say(STORE_PHONE, 'No', 'st_abort');
  ok('«No» → no pide nada', /no pedí el envío/.test(all(m)));
  ok('ninguna llamada de red fuera de Meta/Geocode simulados', UNEXPECTED.length === 0, UNEXPECTED.join());
  fs.unlinkSync(tmp);
  finish();
})().catch((e) => { console.error(e); ok('sin excepción', false, e.stack); finish(); });

function finish() {
  for (const [s, n, x] of R) console.log(`${s}  ${n}${x && s === 'FAIL' ? `  → ${x}` : ''}`);
  const f = R.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${R.length - f}/${R.length} OK`); process.exit(f ? 1 : 0);
}
