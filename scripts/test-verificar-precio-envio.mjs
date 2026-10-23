/**
 * Verificación del precio de «Pedir envío» en el servidor (functions/delivery-zones.js
 * verifyMerchantDirectDelivery + quoteDelivery, la misma cotización de los pedidos de tienda).
 * Uso: node scripts/test-verificar-precio-envio.mjs
 */
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const DZ = require(path.join(ROOT, 'functions/delivery-zones.js'));
// js/ es ESM de navegador: se copia a una carpeta temporal con "type":"module" para importarlo en Node.
import fs from 'node:fs'; import os from 'node:os';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-js-'));
fs.cpSync(path.join(ROOT, 'js'), path.join(TMP, 'js'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'js/package.json'), '{"type":"module"}');
globalThis.window = globalThis.window || {};
const { calculateServiceFare } = await import(path.join(TMP, 'js/service-types.js'));
const { buildMerchantDeliveryTrip, resolveMerchantDeliveryPrice, haversineKm } = await import(path.join(TMP, 'js/merchant-delivery-request.js'));
const box = (a, b, c, d) => [{ lat: a, lng: b }, { lat: a, lng: d }, { lat: c, lng: d }, { lat: c, lng: b }];
const ZONES = [{ id: 'z-centro', name: 'Zona céntrica', cityId: 'comayagua', active: true, priority: 1, baseFee: 35, minFee: 30, maxFee: 60, polygon: box(14.445, -87.655, 14.475, -87.630) }];
const store = { id: 's1', name: 'Baleadas', ownerId: 'owner', lat: 14.4598, lng: -87.6378, cityId: 'comayagua', address: 'Barrio Abajo' };
const R = []; const ok = (n, c, x = '') => R.push([c ? 'PASS' : 'FAIL', n, x]);
const quote = (lat, lng, vehicle, outside = 'distance') => DZ.quoteDelivery({ zones: ZONES, storeFees: {}, lat, lng, cityId: 'comayagua', outsideBehavior: outside, vehicle });
// Viaje tal como lo arma la app (precio del cliente con la misma lógica)
const appTrip = (lat, lng, vehicle, q, collect = 0) => {
  const km = haversineKm(store.lat, store.lng, lat, lng);
  const est = resolveMerchantDeliveryPrice({ quote: q, km, vehicle, fareFn: calculateServiceFare, carFactor: DZ.CAR_DELIVERY_FACTOR });
  return buildMerchantDeliveryTrip({ store, uid: 'owner', form: { vehicle, pickupLat: store.lat, pickupLng: store.lng, dropoffAddress: 'X', dropoffLat: lat, dropoffLng: lng, collectAmount: collect }, estimate: est });
};
const rate = DZ.deliveryRateFrom(null);

ok('tarifa por defecto del servidor = js/service-types.js delivery', rate.base === 15 && rate.perKm === 17);
ok('la app crea en «verifying»', appTrip(14.4705, -87.6455, 'moto', quote(14.4705, -87.6455, 'moto')).status === 'verifying');

// 1) precio correcto pasa (zona)
let t = appTrip(14.4705, -87.6455, 'moto', quote(14.4705, -87.6455, 'moto'), 250);
let r = DZ.verifyMerchantDirectDelivery({ trip: t, store, quote: quote(14.4705, -87.6455, 'moto'), rate, nowMs: 1 });
ok('zona: precio correcto pasa sin corregir', r.ok && !r.corrected && r.patch.status === 'pending' && r.patch.priceNum === 35 && r.patch.priceVerified === true, JSON.stringify(r.patch));
ok('total del cliente = envío + productos', r.patch['deliveryDetails.customerTotal'] === 285);
// carro en zona
t = appTrip(14.4705, -87.6455, 'auto', quote(14.4705, -87.6455, 'auto'));
r = DZ.verifyMerchantDirectDelivery({ trip: t, store, quote: quote(14.4705, -87.6455, 'auto'), rate });
ok('zona carro: pasa (35 × 1.25 = 43.75)', r.ok && !r.corrected && r.patch.priceNum === 43.75);
// distancia: la app y el servidor dan lo mismo
t = appTrip(14.38, -87.62, 'moto', quote(14.38, -87.62, 'moto'));
r = DZ.verifyMerchantDirectDelivery({ trip: t, store, quote: quote(14.38, -87.62, 'moto'), rate });
ok('distancia moto: app = servidor', r.ok && !r.corrected && r.patch.deliveryFeeSource === 'distance', `${t.priceNum} vs ${r.fee}`);
t = appTrip(14.38, -87.62, 'auto', quote(14.38, -87.62, 'auto'));
r = DZ.verifyMerchantDirectDelivery({ trip: t, store, quote: quote(14.38, -87.62, 'auto'), rate });
ok('distancia carro: app = servidor', r.ok && !r.corrected, `${t.priceNum} vs ${r.fee}`);
// tarifa del admin cambiada
const rate2 = DZ.deliveryRateFrom({ serviceRates: { delivery: { base: 20, perKm: 19 } } });
r = DZ.verifyMerchantDirectDelivery({ trip: { ...t, deliveryVehicle: 'moto' }, store, quote: quote(14.38, -87.62, 'moto'), rate: rate2 });
const km = r.patch.tripDistanceKm;
ok('usa la tarifa Envío del admin (appSettings.fixedFares)', r.fee === Math.round((20 + km * 19) * 100) / 100, `${r.fee} km=${km}`);

// 2) precio manipulado → se corrige y se guarda el original
t = { ...appTrip(14.4705, -87.6455, 'moto', quote(14.4705, -87.6455, 'moto'), 250), priceNum: 5, price: 'L. 5.00' };
r = DZ.verifyMerchantDirectDelivery({ trip: t, store, quote: quote(14.4705, -87.6455, 'moto'), rate });
ok('precio bajo manipulado → corregido a la zona', r.ok && r.corrected && r.patch.priceNum === 35 && r.patch.price === 'L. 35.00' && r.patch.priceCheckOriginal === 5 && r.patch.priceCorrected === true);
ok('total del cliente se recalcula con el precio verificado', r.patch['deliveryDetails.customerTotal'] === 285);
// origen manipulado → se usa la tienda
t = { ...appTrip(14.4705, -87.6455, 'moto', null), originLat: 14.4704, originLng: -87.6454, priceNum: 15 };
r = DZ.verifyMerchantDirectDelivery({ trip: t, store, quote: quote(14.4705, -87.6455, 'moto'), rate });
ok('recogida siempre en la ubicación guardada de la tienda', r.patch.originLat === store.lat && r.patch.originLng === store.lng && r.corrected);

// 3) zona «bloquear» → rechazado
t = appTrip(14.38, -87.62, 'moto', quote(14.38, -87.62, 'moto'));
r = DZ.verifyMerchantDirectDelivery({ trip: t, store, quote: quote(14.38, -87.62, 'moto', 'block'), rate });
ok('punto en área «bloquear» → cancelado, nunca pending', !r.ok && r.patch.status === 'cancelled' && r.patch.cancelReason === 'outside_delivery_zones');
// tienda ajena
r = DZ.verifyMerchantDirectDelivery({ trip: { ...t, merchantId: 'otro' }, store, quote: quote(14.4705, -87.6455, 'moto'), rate });
ok('tienda que no es del que pidió → cancelado', !r.ok && r.reason === 'store_mismatch');

for (const x of R) console.log(x.join(' | '));
const fail = R.filter((x) => x[0] === 'FAIL').length;
console.log(`\n${R.length - fail}/${R.length} PASS`);
process.exit(fail ? 1 : 0);
