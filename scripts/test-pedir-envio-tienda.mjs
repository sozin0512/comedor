/**
 * «Pedir envío» desde la tienda (js/merchant-delivery-ui.js + merchant-delivery-request.js) en Chrome headless.
 * Firebase y Google Places van con stubs (nada toca producción). Saca maquetas de 384 px si MOCKUPS=<carpeta>.
 * Uso: node scripts/test-pedir-envio-tienda.mjs   (puppeteer-core: PUPPETEER_DIR o /workspace/e2e-tools)
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { serve, loadPuppeteer, CHROME } from './e2e-sonido-pedidos/server.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAR = Number((fs.readFileSync(path.join(ROOT, 'js/store-delivery-zones.js'), 'utf8').match(/CAR_DELIVERY_FACTOR = ([\d.]+)/) || [])[1]);
const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>body{margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.hd{background:#fff;padding:12px 14px;border-bottom:1px solid #e5e7eb}.hd p{margin:0;font-size:11px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em}.hd h2{margin:2px 0 8px;font-size:18px}
.tabs{display:flex;gap:6px;overflow:hidden}.tabs span{font-size:12px;font-weight:800;padding:6px 10px;border-radius:999px;background:#f3f4f6;white-space:nowrap}.tabs .on{background:#7c3aed;color:#fff}
#body{padding:10px}</style></head><body>
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
window.T = { created: [], cancelled: [], toasts: [], pushList: null, driverCanServeTrip, storeOfferBadgesHtml, tripWaitChipHtml, Alert, calculateServiceFare };
const store = { id: 's1', name: 'Baleadas Doña Mary', address: 'Barrio Abajo, frente al parque, Comayagua', lat: 14.4598, lng: -87.6378, cityId: 'comayagua', phone: '+50499990000' };
const tab = createMerchantDeliveryTab({
  store, uid: 'owner', zone: { id: 'comayagua', name: 'Comayagua' },
  fareFn: calculateServiceFare, carFactor: ${CAR},
  getCommission: async (svc) => (svc === 'delivery' ? 12 : 20),
  availability: (svc, zoneId) => { const r = resolveServiceAvailability({ config, zoneId, svc }); return r.available ? r : { ...r, message: unavailableMessage(svc, 'Comayagua', r.reason) }; },
  placesFetch: async (s) => [{ description: 'Colonia Fátima, Comayagua, Honduras', id: 'p1' }, { description: 'Hospital Santa Teresa, Comayagua, Honduras', id: 'p2' }].filter((x) => x.description.toLowerCase().includes(s.toLowerCase().slice(0, 3)) || true),
  placeDetails: async (s) => (s.id === 'p1' ? { lat: 14.4705, lng: -87.6455, address: 'Colonia Fátima, Comayagua, Honduras' } : { lat: 14.452, lng: -87.64, address: s.description }),
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
const shot = async (p, name) => { if (MOCK) { await sleep(250); await p.screenshot({ path: path.join(MOCK, name), fullPage: true }); } };
try {
  ok('CAR_DELIVERY_FACTOR leído de store-delivery-zones.js', CAR > 1, String(CAR));
  const p = await browser.newPage();
  await p.setViewport({ width: 384, height: 820, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => res.push(['FAIL', 'error JS en la página', e.message]));
  await p.goto(`${url}/__pedir.html`); await p.waitForFunction('window.ready');
  await sleep(300);
  ok('botones Moto y Carro', (await p.$$('[data-md-vehicle]')).length === 2);
  ok('recogida = dirección de la tienda', (await p.$eval('#md-pickupAddress', (e) => e.value)).includes('Barrio Abajo'));
  ok('sin vehículo: botón deshabilitado', await p.$eval('[data-md-submit]', (b) => b.disabled));
  await shot(p, '01-pedir-envio-vacio.png');

  await p.click('[data-md-vehicle="moto"]');
  await p.type('#md-dropoffAddress', 'Colonia Fat', { delay: 15 });
  await sleep(500);
  ok('autocompletar muestra sugerencias', (await p.$$('[data-md-sug]')).length === 2);
  await shot(p, '02-pedir-envio-direccion.png');
  await p.click('[data-md-sug="0"]'); await sleep(200);
  await p.type('#md-customerName', 'Carlos Méndez');
  await p.type('#md-customerPhone', '9876-5432');
  await p.type('#md-collectAmount', '250');
  await p.type('#md-notes', 'Casa verde de dos pisos, portón negro');
  await p.click('[data-md-vehicle="moto"]'); await sleep(150);
  const est = await p.$eval('[data-md-estimate]', (e) => e.textContent.replace(/\s+/g, ' '));
  const expected = await p.evaluate(() => {
    const R = 6371, r = (d) => d * Math.PI / 180, a = [14.4598, -87.6378], b = [14.4705, -87.6455];
    const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
    const km = Math.max(0.5, 2 * R * Math.asin(Math.sqrt(h)));
    return T.calculateServiceFare('delivery', km, null, 1);
  });
  ok('precio estimado = tarifa del servicio Envío (admin)', est.includes(expected.toFixed(2)), `${est} vs ${expected}`);
  ok('muestra la comisión configurada del servicio', est.includes('Comisión del servicio: 12%'), est);
  await shot(p, '03-pedir-envio-precio.png');

  await p.click('[data-md-submit]'); await sleep(300);
  const t = await p.evaluate(() => T.created[0]);
  ok('se creó 1 viaje', !!t);
  ok('marcas de tienda (storeDelivery, createdByMerchant, merchantDirectDelivery)', t.storeDelivery && t.createdByMerchant && t.merchantDirectDelivery);
  ok('moto → solo motos', JSON.stringify(t.allowedDriverVehicles) === '["moto"]' && t.deliveryVehicle === 'moto');
  ok('dueño = merchantId = clientId', t.merchantId === 'owner' && t.clientId === 'owner' && t.storeId === 's1');
  ok('coordenadas de entrega del lugar elegido', t.destinationLat === 14.4705 && t.destinationLng === -87.6455);
  ok('cobrar al entregar 250 en efectivo', t.deliveryDetails.collectAmount === 250 && t.deliveryDetails.productsPaymentMethod === 'efectivo');
  ok('quien recibe', t.deliveryDetails.recipientName === 'Carlos Méndez' && t.deliveryDetails.recipientPhone === '98765432');
  ok('precio = estimado', Math.abs(t.priceNum - expected) < 0.01);
  const drv = await p.evaluate((t) => ({ moto: T.driverCanServeTrip('moto', t.serviceType, null, t), vip: T.driverCanServeTrip('auto', t.serviceType, null, t), taxi: T.driverCanServeTrip('taxi', t.serviceType, 'T-1234', t) }), t);
  ok('conductor moto puede tomarlo; Taxi VIP y taxi no', drv.moto && !drv.vip && !drv.taxi, JSON.stringify(drv));
  ok('insignia «Pedido de tienda» en la oferta', (await p.evaluate((t) => T.storeOfferBadgesHtml(t), t)).includes('Pedido de tienda'));
  ok('chip de espera «Pedido hace …»', /Pedido/.test(await p.evaluate((t) => T.tripWaitChipHtml({ ...t, createdAt: Date.now() - 5 * 60000 }), t)));
  const loud = await p.evaluate((t) => { const r = T.Alert.syncStoreOrderAlert([{ id: 'trip1', ...t }], { vehicleTypes: ['moto'] }); const on = T.Alert.isStoreOrderAlertPlaying(); T.Alert.stopStoreOrderAlert(); return r && on; }, t);
  ok('al conductor de moto le suena la melodía en bucle', loud);
  ok('formulario se limpia', (await p.$eval('#md-dropoffAddress', (e) => e.value)) === '');

  // estados para la tienda
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
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(p, '04-mis-envios-estados.png');
  await p.click('[data-md-cancel="trip1"]'); await sleep(150);
  const c = await p.evaluate(() => T.cancelled[0]);
  ok('cancelar manda solo status cancelled + motivo', c && c[0] === 'trip1' && c[1].status === 'cancelled' && Object.keys(c[1]).sort().join() === 'cancelReason,cancelledAtMs,cancelledBy,status', JSON.stringify(c));

  // carro
  await p.click('[data-md-vehicle="auto"]');
  await p.type('#md-dropoffAddress', 'Hosp'); await sleep(450); await p.click('[data-md-sug="1"]'); await sleep(150);
  await p.click('[data-md-submit]'); await sleep(300);
  const car = await p.evaluate(() => T.created[1]);
  ok('carro → solo Taxi VIP (auto)', car && JSON.stringify(car.allowedDriverVehicles) === '["auto"]');
  const carExp = await p.evaluate((km) => T.calculateServiceFare('delivery', km, null, 1), car.tripDistanceKm);
  ok('carro = tarifa Envío × recargo de carro', Math.abs(car.priceNum - Math.round(carExp * CAR * 100) / 100) < 0.1, `${car.priceNum} vs ${carExp * CAR}`);

  // validación: dirección escrita sin elegir de la lista
  await p.type('#md-dropoffAddress', 'mi casa'); await sleep(400);
  await p.click('[data-md-submit]'); await sleep(200);
  ok('sin elegir de la lista: error y no crea', (await p.evaluate(() => T.created.length)) === 2 && (await p.$eval('body', (b) => b.textContent)).includes('Elige la dirección de la lista'));

  // Disponibilidad: moto cerrada en la ciudad
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 384, height: 820, deviceScaleFactor: 2 });
  await p2.goto(`${url}/__pedir.html?motoOff=1`); await p2.waitForFunction('window.ready'); await sleep(200);
  ok('Disponibilidad: moto apagada → «No disponible» y deshabilitada', await p2.$eval('[data-md-vehicle="moto"]', (b) => b.disabled && b.textContent.includes('No disponible')));
  ok('Disponibilidad: carro sigue disponible', !(await p2.$eval('[data-md-vehicle="auto"]', (b) => b.disabled)));
  await shot(p2, '05-moto-no-disponible.png');
} finally { await browser.close(); srv.close(); }
for (const r of res) console.log(r.join(' | '));
const fail = res.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${res.length - fail}/${res.length} PASS`);
process.exit(fail ? 1 : 0);
