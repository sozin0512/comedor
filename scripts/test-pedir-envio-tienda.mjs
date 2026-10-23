/**
 * «Pedir envío» desde la tienda (js/merchant-delivery-ui.js + merchant-delivery-request.js) en Chrome headless.
 * La cotización usa la MISMA función del servidor (functions/delivery-zones.js quoteDelivery) con zonas de prueba;
 * Firebase, Google Places y el mapa van con stubs (nada toca producción). Maquetas de 384 px si MOCKUPS=<carpeta>.
 * Uso: node scripts/test-pedir-envio-tienda.mjs   (puppeteer-core: PUPPETEER_DIR o /workspace/e2e-tools)
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
import { serve, loadPuppeteer, CHROME } from './e2e-sonido-pedidos/server.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const DZ = require(path.join(ROOT, 'functions/delivery-zones.js'));
const CAR = Number((fs.readFileSync(path.join(ROOT, 'js/store-delivery-zones.js'), 'utf8').match(/CAR_DELIVERY_FACTOR = ([\d.]+)/) || [])[1]);
const box = (la1, ln1, la2, ln2) => [{ lat: la1, lng: ln1 }, { lat: la1, lng: ln2 }, { lat: la2, lng: ln2 }, { lat: la2, lng: ln1 }];
// Zonas de prueba (como las del admin «Envíos»): céntrica chica dentro de una más grande «Fuera de ciudad».
const ZONES = [
  { id: 'z-centro', name: 'Zona céntrica', cityId: 'comayagua', active: true, priority: 1, baseFee: 35, minFee: 30, maxFee: 60, polygon: box(14.445, -87.655, 14.475, -87.630) },
  { id: 'z-afuera', name: 'Fuera de ciudad', cityId: 'comayagua', active: true, priority: 2, baseFee: 70, minFee: 60, maxFee: 120, polygon: box(14.40, -87.70, 14.53, -87.58) },
];
const STORE_FEES = { 'z-afuera': { mode: 'custom', fee: 80 } };
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>:root{--hn-blue:#0c4a8e;--hn-blue-light:#1a6bb5}body{margin:0;background:#f8fafc;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.hd{background:#fff;padding:12px 14px;border-bottom:1px solid #e5e7eb}.hd p{margin:0;font-size:11px;font-weight:800;color:#0c4a8e;text-transform:uppercase;letter-spacing:.08em}.hd h2{margin:2px 0 8px;font-size:18px}
.tabs{display:flex;gap:6px;overflow:hidden}.tabs span{font-size:12px;font-weight:800;padding:6px 10px;border-radius:999px;background:#f3f4f6;white-space:nowrap}.tabs .on{background:linear-gradient(135deg,#0c4a8e,#1a6bb5);color:#fff}
#body{padding:10px}
.fake-map{position:absolute;inset:0;background:#eef0e6;background-image:linear-gradient(#fff 6px,transparent 6px),linear-gradient(90deg,#fff 6px,transparent 6px),linear-gradient(#fbe7a1 12px,transparent 12px);background-size:90px 90px,120px 120px,100% 260px;background-position:0 30px,40px 0,0 140px}
.fake-map i{position:absolute;font-size:11px;color:#6b7280;font-style:normal}</style></head><body>
<div class="hd"><p>Emprendedor</p><h2>Baleadas Doña Mary</h2><div class="tabs"><span>Pedidos</span><span>Menú</span><span>Tienda</span><span class="on">Pedir envío</span><span>Envíos</span></div></div>
<div id="body"></div>
<script type="module">
import { createMerchantDeliveryTab } from '/js/merchant-delivery-ui.js';
import { calculateServiceFare, driverCanServeTrip } from '/js/service-types.js';
import { resolveServiceAvailability, unavailableMessage } from '/js/service-availability.js';
import { storeOfferBadgesHtml } from '/js/store-trip-ui.js';
import { tripWaitChipHtml } from '/js/trip-wait.js';
import * as Alert from '/js/store-order-alert.js';
const q = new URLSearchParams(location.search);
const config = q.get('motoOff') ? { comayagua: { delivery: { mode: 'off' } } } : {};
window.T = { created: [], cancelled: [], toasts: [], quotes: [], saved: [], pushList: null, mapMove: null, driverCanServeTrip, storeOfferBadgesHtml, tripWaitChipHtml, Alert, calculateServiceFare };
const store = { id: 's1', name: 'Baleadas Doña Mary', address: 'Barrio Abajo, frente al parque, Comayagua', lat: 14.4598, lng: -87.6378, cityId: 'comayagua', phone: '+50499990000' };
if (q.get('noLoc')) { store.lat = 14.4513; store.lng = -87.6374; store.locationApprox = true; }
const tab = createMerchantDeliveryTab({
  store, uid: 'owner', zone: { id: 'comayagua', name: 'Comayagua', center: { lat: 14.4513, lng: -87.6374 } },
  fareFn: calculateServiceFare, carFactor: ${CAR},
  quoteFee: async (a) => { T.quotes.push(a); return window.serverQuote(JSON.stringify({ ...a, outside: q.get('outside') || 'distance' })).then(JSON.parse); },
  createMap: (el, center, onMove) => { el.innerHTML = '<div class="fake-map"><i style="left:18px;top:60px">Calle del Comercio</i><i style="left:150px;top:210px">Col. San Miguel</i><i style="left:40px;top:330px">Parque Central</i></div>'; T.mapMove = onMove; return { setCenter: () => {}, destroy: () => {} }; },
  reverseGeocode: async (lat, lng) => (lat > 14.47 ? 'Col. San Miguel, Comayagua, Honduras' : 'Barrio Abajo, Comayagua, Honduras'),
  getGps: async () => ({ lat: 14.46, lng: -87.638 }),
  saveStoreLocation: async (loc) => { T.saved.push(loc); },
  getCommission: async (svc) => (svc === 'delivery' ? 12 : 20),
  availability: (svc, zoneId) => { const r = resolveServiceAvailability({ config, zoneId, svc }); return r.available ? r : { ...r, message: unavailableMessage(svc, 'Comayagua', r.reason) }; },
  placesFetch: async () => [{ description: 'Colonia Fátima, Comayagua, Honduras', id: 'p1' }, { description: 'Aldea El Volcán, Comayagua, Honduras', id: 'p2' }, { description: 'Hospital Santa Teresa, Comayagua, Honduras', id: 'p3' }],
  placeDetails: async (s) => ({ p1: { lat: 14.4705, lng: -87.6455 }, p2: { lat: 14.50, lng: -87.60 }, p3: { lat: 14.38, lng: -87.62 } }[s.id] ? { ...({ p1: { lat: 14.4705, lng: -87.6455 }, p2: { lat: 14.50, lng: -87.60 }, p3: { lat: 14.38, lng: -87.62 } }[s.id]), address: s.description } : null),
  serverTs: () => null,
  waitChip: (t) => tripWaitChipHtml(t),
  createTrip: async (p) => { T.created.push(p); return 'trip' + T.created.length; },
  cancelTrip: async (id, patch) => { T.cancelled.push([id, patch]); },
  subscribe: (cb) => { T.pushList = cb; return () => {}; },
  toast: (m, k) => T.toasts.push([m, k]),
  confirm: () => true,
});
tab.mount(document.getElementById('body'));
window.ready = true;
</script></body></html>`;
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOCK = process.env.MOCKUPS || '';
if (MOCK) fs.mkdirSync(MOCK, { recursive: true });
const { srv, url } = await serve(ROOT, { '/__pedir.html': page });
const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const shot = async (p, name, full = true) => { if (MOCK) { await sleep(300); await p.screenshot({ path: path.join(MOCK, name), fullPage: full }); } };
const quote = (a) => DZ.quoteDelivery({ zones: ZONES, storeFees: STORE_FEES, lat: a.lat, lng: a.lng, cityId: 'comayagua', outsideBehavior: a.outside, vehicle: a.vehicle });
const newPage = async (qs = '') => {
  const p = await browser.newPage();
  await p.setViewport({ width: 384, height: 820, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => res.push(['FAIL', 'error JS en la página', e.message]));
  await p.exposeFunction('serverQuote', (s) => JSON.stringify(quote(JSON.parse(s))));
  await p.goto(`${url}/__pedir.html${qs}`); await p.waitForFunction('window.ready'); await sleep(300);
  return p;
};
const txt = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
try {
  ok('CAR_DELIVERY_FACTOR leído de store-delivery-zones.js', CAR > 1, String(CAR));
  const p = await newPage();
  ok('botones Moto y Carro', (await p.$$('[data-md-vehicle]')).length === 2);
  ok('recoger = tienda guardada, bloqueado (sin campo de texto)', (await p.$('[data-md-pickup="locked"]')) && !(await p.$('#md-pickupAddress')) && (await txt(p, '[data-md-pickup]')).includes('Barrio Abajo'));
  ok('sin vehículo: botón deshabilitado', await p.$eval('[data-md-submit]', (b) => b.disabled));
  ok('botón «Usar mapa» junto a la búsqueda', !!(await p.$('[data-md-map="dropoff"]')));
  await shot(p, '01-pedir-envio-vacio.png');

  // 1) Buscar (Places HN) → Zona céntrica
  await p.click('[data-md-vehicle="moto"]');
  await p.type('#md-dropoffAddress', 'Colonia Fat', { delay: 15 });
  await sleep(500);
  ok('autocompletar muestra sugerencias', (await p.$$('[data-md-sug]')).length === 3);
  await shot(p, '02-pedir-envio-buscar.png');
  await p.click('[data-md-sug="0"]'); await sleep(250);
  ok('punto con coordenadas', (await txt(p, '[data-md-dropok]')).includes('14.47050, -87.64550'));
  const q1 = quote({ lat: 14.4705, lng: -87.6455, vehicle: 'moto', outside: 'distance' });
  let est = await txt(p, '[data-md-estimate]');
  ok('moto en Zona céntrica = tarifa de la zona (servidor quoteDelivery)', q1.inZone && est.includes(q1.feeMoto.toFixed(2)) && est.includes('Tarifa: Zona céntrica'), est);
  ok('cotiza con la tienda y el punto', (await p.evaluate(() => T.quotes.at(-1))).storeId === 's1');
  await p.type('#md-customerName', 'Carlos Méndez');
  await p.type('#md-customerPhone', '9876-5432');
  await p.type('#md-notes', 'Casa verde de dos pisos, portón negro');
  await p.type('#md-collectAmount', '250'); await sleep(100);
  const sum = await txt(p, '[data-md-summary]');
  ok('cobro en efectivo separado de la tarifa', sum.includes(`Envío L. ${q1.feeMoto.toFixed(2)}`) && sum.includes('cobra L. 250.00 al cliente'), sum);
  ok('comisión del servicio informativa', est.includes('Comisión del servicio: 12%'));
  await p.evaluate(() => document.querySelector('[data-md-estimate]').scrollIntoView({ block: 'center' }));
  await shot(p, '03-tarifa-zona-centrica.png');

  // carro en la misma zona → zona × 1.25
  await p.click('[data-md-vehicle="auto"]'); await sleep(250);
  est = await txt(p, '[data-md-estimate]');
  ok('carro en Zona céntrica = zona × recargo carro', est.includes(q1.feeCar.toFixed(2)) && est.includes('carro +25%'), est);
  await p.click('[data-md-vehicle="moto"]'); await sleep(250);

  await p.click('[data-md-submit]'); await sleep(300);
  const t = await p.evaluate(() => T.created[0]);
  ok('se creó 1 viaje', !!t);
  ok('marcas de tienda', t.storeDelivery && t.createdByMerchant && t.merchantDirectDelivery);
  ok('moto → solo motos', JSON.stringify(t.allowedDriverVehicles) === '["moto"]' && t.deliveryVehicle === 'moto');
  ok('dueño = merchantId = clientId', t.merchantId === 'owner' && t.clientId === 'owner' && t.storeId === 's1');
  ok('recoge en la ubicación guardada', t.originLat === 14.4598 && t.originLng === -87.6378);
  ok('precio del viaje = tarifa de zona + metadatos', t.priceNum === q1.feeMoto && t.deliveryZoneId === 'z-centro' && t.deliveryFeeSource === 'zone_base' && /Zona céntrica/.test(t.fareLabel), JSON.stringify([t.priceNum, t.deliveryZoneId, t.deliveryFeeSource, t.fareLabel]));
  ok('cobrar 250 en efectivo (aparte)', t.deliveryDetails.collectAmount === 250 && t.deliveryDetails.productsPaymentMethod === 'efectivo');
  ok('quien recibe', t.deliveryDetails.recipientName === 'Carlos Méndez' && t.deliveryDetails.recipientPhone === '98765432');
  const drv = await p.evaluate((t) => ({ moto: T.driverCanServeTrip('moto', t.serviceType, null, t), vip: T.driverCanServeTrip('auto', t.serviceType, null, t), taxi: T.driverCanServeTrip('taxi', t.serviceType, 'T-1234', t) }), t);
  ok('conductor moto puede tomarlo; Taxi VIP y taxi no', drv.moto && !drv.vip && !drv.taxi, JSON.stringify(drv));
  ok('insignia «Pedido de tienda»', (await p.evaluate((t) => T.storeOfferBadgesHtml(t), t)).includes('Pedido de tienda'));
  const loud = await p.evaluate((t) => { const r = T.Alert.syncStoreOrderAlert([{ id: 'trip1', ...t }], { vehicleTypes: ['moto'] }); const on = T.Alert.isStoreOrderAlertPlaying(); T.Alert.stopStoreOrderAlert(); return r && on; }, t);
  ok('al conductor de moto le suena la melodía en bucle', loud);
  ok('formulario se limpia', (await p.$eval('#md-dropoffAddress', (e) => e.value)) === '');

  // 2) Fuera de ciudad: tarifa propia de la tienda dentro del rango del admin
  await p.type('#md-dropoffAddress', 'Aldea'); await sleep(450); await p.click('[data-md-sug="1"]'); await sleep(250);
  const q2 = quote({ lat: 14.50, lng: -87.60, vehicle: 'moto', outside: 'distance' });
  est = await txt(p, '[data-md-estimate]');
  ok('Fuera de ciudad: tarifa de la tienda (custom) de esa zona', q2.zoneName === 'Fuera de ciudad' && est.includes(q2.feeMoto.toFixed(2)) && est.includes('Fuera de ciudad (tu tarifa)'), est);

  // 3) Fuera de todas las zonas → por distancia (tarifa Envío del admin)
  await p.$eval('#md-dropoffAddress', (e) => { e.value = ''; });
  await p.type('#md-dropoffAddress', 'Hosp'); await sleep(450); await p.click('[data-md-sug="2"]'); await sleep(250);
  const kmH = await p.evaluate(() => { const R = 6371, r = (d) => d * Math.PI / 180, a = [14.4598, -87.6378], b = [14.38, -87.62]; const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100; });
  const distFare = await p.evaluate((km) => T.calculateServiceFare('delivery', km, null, 1), kmH);
  est = await txt(p, '[data-md-estimate]');
  ok('sin zona: por distancia con tarifa Envío del admin', est.includes(distFare.toFixed(2)) && est.includes('por distancia'), `${est} vs ${distFare}`);

  // 4) Usar mapa: pin → dirección (reverse geocode)
  await p.click('[data-md-map="dropoff"]'); await sleep(200);
  ok('mapa abre a pantalla completa con pin', !!(await p.$('[data-md-mapov="dropoff"] .md-map-pin')));
  await p.evaluate(() => T.mapMove({ lat: 14.4722, lng: -87.6401 })); await sleep(200);
  ok('al mover el mapa muestra la dirección', (await txt(p, '[data-mm-addr]')).includes('Col. San Miguel'));
  await shot(p, '04-usar-mapa-pin.png', false);
  await p.click('[data-mm="ok"]'); await sleep(300);
  ok('«Entregar aquí» pone dirección y coords', (await p.$eval('#md-dropoffAddress', (e) => e.value)).includes('Col. San Miguel') && (await txt(p, '[data-md-dropok]')).includes('14.47220, -87.64010') && !(await p.$('[data-md-mapov]')));
  ok('punto del mapa en Zona céntrica', (await txt(p, '[data-md-estimate]')).includes('Zona céntrica'));
  await p.click('[data-md-vehicle="auto"]'); await sleep(250);
  await p.click('[data-md-submit]'); await sleep(300);
  const car = await p.evaluate(() => T.created[1]);
  const q3 = quote({ lat: 14.4722, lng: -87.6401, vehicle: 'auto', outside: 'distance' });
  ok('carro → solo Taxi VIP (auto) con tarifa zona×carro', car && JSON.stringify(car.allowedDriverVehicles) === '["auto"]' && car.priceNum === q3.feeCar, JSON.stringify(car && [car.priceNum, q3.feeCar]));

  // validación: texto sin elegir
  await p.type('#md-dropoffAddress', 'mi casa'); await sleep(400);
  await p.click('[data-md-submit]'); await sleep(200);
  ok('texto sin elegir de la lista ni mapa: error y no crea', (await p.evaluate(() => T.created.length)) === 2 && (await p.$eval('body', (b) => b.textContent)).includes('ponla en el mapa'));

  // estados
  await p.click('.md-card h3'); await sleep(100);
  ok('tocar fuera cierra las sugerencias', (await p.$$('[data-md-sug]')).length === 0);
  const now = Date.now();
  await p.evaluate((t, now) => T.pushList([
    { id: 'trip1', ...t, createdAt: now - 4 * 60000 },
    { id: 'trip0', ...t, destination: 'Hospital Santa Teresa', status: 'accepted', driverId: 'd1', driverName: 'Luis (moto)' },
    { id: 'tripA', ...t, destination: 'Col. San Miguel', deliveryVehicle: 'auto', status: 'in_progress', driverId: 'd2', driverName: 'Ana (carro)' },
    { id: 'tripB', ...t, destination: 'Res. Las Colinas', status: 'completed', driverId: 'd3' },
  ]), t, now);
  await sleep(150);
  const labels = await p.$$eval('[data-md-status]', (els) => els.map((e) => e.textContent));
  ok('estados: buscando · aceptado · en camino · entregado', labels.join('|') === 'Buscando conductor|Aceptado|En camino|Entregado', labels.join('|'));
  ok('solo se puede cancelar el que busca conductor', (await p.$$('[data-md-cancel]')).length === 1);
  await p.evaluate(() => document.querySelector('[data-md-list]').scrollIntoView({ block: 'end' }));
  await shot(p, '07-mis-envios-estados.png', false);
  await p.click('[data-md-cancel="trip1"]'); await sleep(150);
  const c = await p.evaluate(() => T.cancelled[0]);
  ok('cancelar manda solo status cancelled + motivo', c && c[0] === 'trip1' && Object.keys(c[1]).sort().join() === 'cancelReason,cancelledAtMs,cancelledBy,status', JSON.stringify(c));

  // Tienda sin ubicación: pedir pin una vez y guardarla
  const p3 = await newPage('?noLoc=1');
  ok('sin ubicación: aviso + botón poner pin, no deja pedir', !!(await p3.$('[data-md-pickup="missing"]')) && (await p3.$eval('[data-md-submit]', (b) => b.disabled)));
  await shot(p3, '05-tienda-sin-ubicacion.png', false);
  await p3.click('[data-md-map="pickup"]'); await sleep(200);
  await p3.evaluate(() => T.mapMove({ lat: 14.4601, lng: -87.6381 })); await sleep(200);
  await shot(p3, '06-pin-de-la-tienda.png', false);
  await p3.click('[data-mm="ok"]'); await sleep(300);
  const sv = await p3.evaluate(() => T.saved[0]);
  ok('guarda la ubicación en la tienda', sv && sv.lat === 14.4601 && sv.lng === -87.6381 && /Barrio Abajo/.test(sv.address), JSON.stringify(sv));
  ok('después queda bloqueada con la nueva ubicación', !!(await p3.$('[data-md-pickup="locked"]')));

  // Admin «bloquear fuera de zona»
  const p4 = await newPage('?outside=block');
  await p4.click('[data-md-vehicle="moto"]');
  await p4.type('#md-dropoffAddress', 'Hosp'); await sleep(450); await p4.click('[data-md-sug="2"]'); await sleep(250);
  ok('fuera de zonas con «bloquear»: no hay envío y botón deshabilitado', (await txt(p4, '[data-md-estimate]')).includes('No hay envío') && (await p4.$eval('[data-md-submit]', (b) => b.disabled)));

  // Disponibilidad
  const p2 = await newPage('?motoOff=1');
  ok('Disponibilidad: moto apagada → «No disponible»', await p2.$eval('[data-md-vehicle="moto"]', (b) => b.disabled && b.textContent.includes('No disponible')));
  ok('Disponibilidad: carro sigue disponible', !(await p2.$eval('[data-md-vehicle="auto"]', (b) => b.disabled)));
  await shot(p2, '08-moto-no-disponible.png', false);

  // 360 px: sin desborde horizontal
  await p.setViewport({ width: 360, height: 760, deviceScaleFactor: 2 });
  await sleep(150);
  ok('360 px sin scroll horizontal', await p.evaluate(() => document.documentElement.scrollWidth <= 361));
} finally { await browser.close(); srv.close(); }
for (const r of res) console.log(r.join(' | '));
const fail = res.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${res.length - fail}/${res.length} PASS`);
process.exit(fail ? 1 : 0);
