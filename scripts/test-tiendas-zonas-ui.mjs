// UI de zonas de envío y panel «Pedidos» (lógica pura, sin Firebase ni navegador).
// Uso: node scripts/test-tiendas-zonas-ui.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync('/tmp/tzui-');
fs.writeFileSync(path.join(TMP, 'fs-stub.mjs'), 'export const collection=()=>{},doc=()=>{},onSnapshot=()=>()=>{},query=()=>{},where=()=>{},orderBy=()=>{},limit=()=>{},getDocs=async()=>({docs:[]}),getDoc=async()=>({exists:()=>false}),Timestamp={fromMillis:(m)=>m};');
fs.writeFileSync(path.join(TMP, 'zones.js'), 'export const getAllKnownZones=()=>[{id:"comayagua",name:"Comayagua",center:{lat:14.45,lng:-87.63}},{id:"siguatepeque",name:"Siguatepeque"}];');
for (const f of ['trip-wait', 'delivery-zones-shared', 'ops-delivery-zones', 'store-delivery-zones', 'ops-store-orders']) {
  const src = fs.readFileSync(path.join(ROOT, 'js', `${f}.js`), 'utf8')
    .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^'"]+firestore\.js/g, './fs-stub.mjs')
    .replace(/'\.\/zones\.js\?v=[^']+'/g, "'./zones.js'")
    .replace(/'\.\/delivery-zones-shared\.js\?v=[^']+'/g, "'./delivery-zones-shared.mjs'")
    .replace(/'\.\/trip-wait\.js\?v=[^']+'/g, "'./trip-wait.mjs'");
  fs.writeFileSync(path.join(TMP, `${f}.mjs`), src);
}
globalThis.window = {}; globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const imp = (f) => import(pathToFileURL(path.join(TMP, `${f}.mjs`)).href);
const SH = await imp('delivery-zones-shared'); const OZ = await imp('ops-delivery-zones'); const SZ = await imp('store-delivery-zones'); const SO = await imp('ops-store-orders');
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);

// ── compartido (mismo resultado que el servidor) ──
const DZ = (await import(pathToFileURL(path.join(ROOT, 'functions', 'delivery-zones.js')).href)).default;
const zf = { minFee: 100, maxFee: 120, baseFee: 110 };
for (const [m, f] of [['custom', 95], ['custom', 130], ['custom', 110], ['custom', ''], ['base', null], ['custom', -1]]) {
  ok(`validar tienda igual que servidor (${m} ${f})`, SH.validateStoreFee(zf, m, f) === DZ.validateStoreFee(zf, m, f), `${SH.validateStoreFee(zf, m, f)} vs ${DZ.validateStoreFee(zf, m, f)}`);
}
ok('efectiva: inválida → base', SH.effectiveFee(zf, { mode: 'custom', fee: 95 }).fee === 110);
ok('efectiva: válida → propia', SH.effectiveFee(zf, { mode: 'custom', fee: 115 }).source === 'store_custom');
const seeds = DZ.SEED_ZONES.comayagua.map((z) => ({ ...z, active: true, cityId: 'comayagua' }));
for (const [lat, lng] of [[14.4598, -87.6378], [14.47, -87.63], [14.49, -87.66], [15, -87]]) {
  ok(`zona en ${lat},${lng} igual que servidor`, (SH.findZoneForPoint(seeds, lat, lng)?.id || null) === (DZ.findZoneForPoint(seeds, lat, lng)?.id || null));
}
ok('form: mínimo > base', !!SH.validateZoneForm({ name: 'Zona', cityId: 'comayagua', baseFee: 40, minFee: 50, priority: 1, polygon: seeds[0].polygon }).minFee);
ok('form: válido', Object.keys(SH.validateZoneForm({ name: 'Zona', cityId: 'comayagua', baseFee: '40', minFee: '', maxFee: '', priority: 1, polygon: seeds[0].polygon })).length === 0);
ok('texto ⇄ polígono', JSON.stringify(SH.textToPolygon(SH.polygonToText(seeds[0].polygon))) === JSON.stringify(seeds[0].polygon.map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }))));
ok('agregar punto', SH.addMidpoint(seeds[0].polygon).length === seeds[0].polygon.length + 1);
ok('svg dibuja 3 zonas', (SH.zonesSvg(seeds).match(/<polygon/g) || []).length === 3);
ok('svg escapa nombres', !SH.zonesSvg([{ ...seeds[0], name: '<img onerror=x>' }]).includes('<img'));

// ── admin de zonas ──
OZ.__test.S.zones = seeds.map((z) => ({ ...z, active: false, seed: true })); OZ.__test.S.city = 'comayagua'; OZ.__test.S.loading = false;
let h = OZ.viewHtml(OZ.__test.S);
ok('zonas: aviso «Propuesta, todo inactivo»', h.includes('Propuesta, todo inactivo'));
ok('zonas: 3 tarjetas', (h.match(/data-tz="select"/g) || []).length === 3);
ok('zonas: «fuera de zonas» por distancia por defecto', /value="distance" checked/.test(h));
OZ.__test.S.zones = []; h = OZ.viewHtml(OZ.__test.S);
ok('zonas: sin zonas → botón de propuesta', h.includes('data-tz="seed"'));
OZ.__test.S.history = [{ atMs: Date.parse('2026-10-17T09:05:00-06:00'), byName: 'Admin Ejemplo', byRole: 'admin', zoneName: 'Céntrica', cityId: 'comayagua', action: 'update', changes: [{ field: 'baseFee', before: 35, after: 40 }] },
  { atMs: 1, byName: 'Tere', byRole: 'owner', storeName: 'Baleadas', cityId: 'comayagua', action: 'update', changes: [{ field: 'fee:Fuera', before: 'base', after: 115 }] }];
h = OZ.viewHtml(OZ.__test.S);
ok('historial: quién, antes → después', h.includes('Admin Ejemplo') && h.includes('L. 35.00') && h.includes('L. 40.00') && h.includes('Tarifa base'));
ok('historial: cambio de tienda legible', h.includes('Tarifa · Fuera') && h.includes('tarifa base') && h.includes('L. 115.00'));

// ── pestaña Envíos ──
Object.assign(SZ.__test.T, { store: { id: 's', name: 'T', cityName: 'Comayagua' }, zones: [{ id: 'f', name: 'Fuera', baseFee: 110, minFee: 100, maxFee: 120 }], saved: { f: { mode: 'base', fee: null } }, draft: { f: { mode: 'custom', fee: 95 } }, loading: false, error: '' });
h = SZ.merchantZonesHtml(SZ.__test.T);
ok('tienda: error de rango y «queda la base»', h.includes('Debe estar entre L. 100.00 y L. 120.00') && h.includes('queda la base'));
ok('tienda: no deja guardar con error', /data-sz="save" disabled/.test(h));
SZ.__test.T.draft = { f: { mode: 'custom', fee: 115 } }; h = SZ.merchantZonesHtml(SZ.__test.T);
ok('tienda: válido se puede guardar', /data-sz="save" >/.test(h) && h.includes('L. 115.00'));
SZ.__test.T.zones = []; ok('tienda: sin zonas activas → como siempre', SZ.merchantZonesHtml(SZ.__test.T).includes('por distancia'));

// ── confirmar pedido ──
const Q = (q) => SZ.checkoutFeeHtml({ status: 'ok', vehicle: 'moto', quote: q });
ok('pedido: «Envío a <zona>: L X»', Q({ inZone: true, zoneName: 'Comayagua céntrica', fee: 40, source: 'zone_base' }).includes('Envío en moto a Comayagua céntrica: L. 40.00'));
ok('pedido: fuera → por distancia', Q({ inZone: false, reason: 'outside', blocked: false }).includes('se calcula por distancia'));
ok('pedido: bloqueado', Q({ inZone: false, reason: 'outside', blocked: true }).includes('no llegamos'));
ok('pedido: sin ubicación → botón GPS', Q({ inZone: false, reason: 'no_location' }).includes('data-sz-checkout="gps"'));
const pick = SZ.checkoutFeeHtml({ status: 'idle', quote: { inZone: true, fee: 40, feeMoto: 40, feeCar: 75, zoneName: 'Comayagua céntrica', source: 'zone_base' } });
ok('pedido: hay que elegir moto o carro', pick.includes('Elige moto o carro') && pick.includes('Moto L. 40.00') && pick.includes('Carro L. 75.00'));
const carQ = SZ.checkoutFeeHtml({ status: 'ok', vehicle: 'auto', quote: { inZone: true, zoneName: 'Comayagua céntrica', fee: 75, feeMoto: 40, feeCar: 75, source: 'zone_base' } });
ok('pedido carro: zona + 25% (mín. L. 75.00)', carQ.includes('Envío en carro a Comayagua céntrica: L. 75.00') && carQ.includes('carro +25%'));
ok('viaje: tarifa de zona manda', SZ.deliveryTripPrice({ deliveryFee: 40, deliveryFeeSource: 'zone_base' }, 61.5).priceNum === 40);
ok('viaje: sin zona → distancia', SZ.deliveryTripPrice({ deliveryFee: null, deliveryFeeSource: 'distance' }, 61.5).priceNum === 61.5);
ok('viaje: la zona ya incluye el carro (mín. L. 75)', SZ.deliveryTripPrice({ deliveryFee: 75, deliveryFeeSource: 'zone_base', deliveryVehicle: 'auto' }, 61.5).priceNum === 75 && SZ.deliveryTripPrice({ deliveryFee: 50, deliveryFeeSource: 'zone_base', deliveryVehicle: 'auto' }, 61.5).priceNum === 75);
ok('tarjeta del pedido: línea de envío', SZ.orderFeeLineHtml({ deliveryFee: 110, deliveryFeeSource: 'store_custom', deliveryZoneName: 'Fuera' }).includes('Envío a Fuera: L. 110.00'));
ok('tarjeta: carro', SZ.orderFeeLineHtml({ deliveryFee: 75, deliveryFeeSource: 'zone_base', deliveryZoneName: 'Céntrica', deliveryVehicle: 'auto' }).includes('Carro · Envío a Céntrica: L. 75.00'));

// ── panel Pedidos ──
const now = Date.parse('2026-10-17T10:15:00-06:00'); const m = (x) => now - x * 60e3;
ok('estados: pending/accepted → Recibido', SO.stageOf('pending').id === 'recibido' && SO.stageOf('accepted').id === 'recibido');
ok('estados: preparing/ready → En cocina', SO.stageOf('preparing').id === 'cocina' && SO.stageOf('ready').id === 'cocina');
ok('estados: out_for_delivery/delivered/cancelled', SO.stageOf('out_for_delivery').id === 'camino' && SO.stageOf('delivered').id === 'entregado' && SO.stageOf('cancelled').id === 'cancelado');
ok('atascado: nuevo 14 min (límite 10)', SO.stuckInfo({ status: 'pending', createdAt: m(14) }, now)?.text === 'Sin aceptar hace 14 min (límite 10)');
ok('no atascado: nuevo 9 min', SO.stuckInfo({ status: 'pending', createdAt: m(9) }, now) === null);
ok('atascado: cocina 31 min desde el último cambio', !!SO.stuckInfo({ status: 'preparing', createdAt: m(90), updatedAt: m(31) }, now));
ok('no atascado: cocina 29 min', !SO.stuckInfo({ status: 'preparing', createdAt: m(90), updatedAt: m(29) }, now));
ok('atascado: en camino 46 min', !!SO.stuckInfo({ status: 'out_for_delivery', updatedAt: m(46) }, now));
ok('entregado nunca atascado', !SO.stuckInfo({ status: 'delivered', updatedAt: m(500) }, now));
const L = [{ id: 'AAA111', storeId: 's1', storeName: 'Baleadas', status: 'pending', deliveryZoneName: 'Céntrica', clientPhone: '99990001', items: [{ name: 'Baleada', qty: 2 }], createdAt: m(14), itemsTotal: 70, deliveryFee: 40 },
  { id: 'BBB222', storeId: 's2', storeName: 'Pollo', status: 'delivered', deliveryZoneName: null, items: [{ name: 'Pollo chuco', qty: 1 }], createdAt: m(60), itemsTotal: 210, deliveryFee: 85, deliveryFeeSource: 'distance' },
  { id: 'CCC333', storeId: 's1', storeName: 'Baleadas', status: 'cancelled', deliveryZoneName: 'Fuera', items: [], createdAt: m(60 * 30), itemsTotal: 35, deliveryFee: 110, clientName: '=HYPERLINK("x")' }];
ok('filtro tienda', SO.filterOrders(L, { storeId: 's1' }).length === 2);
ok('filtro zona / sin zona', SO.filterOrders(L, { zone: 'Céntrica' }).length === 1 && SO.filterOrders(L, { zone: '__none' }).length === 1);
ok('filtro estado', SO.filterOrders(L, { stage: 'cancelado' }).length === 1);
ok('solo atascados', SO.filterOrders(L, { stuckOnly: true, now }).map((o) => o.id).join() === 'AAA111');
ok('buscar por producto, teléfono y #pedido', SO.filterOrders(L, { q: 'pollo' }).length === 1 && SO.filterOrders(L, { q: '9999' }).length === 1 && SO.filterOrders(L, { q: '#bbb222' }).length === 1);
const csv = SO.ordersCsv(L);
ok('CSV: encabezado con fecha, hora, envío, zona', csv.split('\r\n')[0].includes('fecha,hora,pedido,tienda,cliente,telefono,zona,productos,productos_L,envio_L'));
ok('CSV: todas las filas', csv.split('\r\n').length === 4);
ok('CSV: sin fórmulas (=HYPERLINK neutralizado)', csv.includes(`"'=HYPERLINK(""x"")"`));
ok('CSV: hora de Honduras', csv.includes('2026-10-17,10:01'));
const c = SO.counters(L, { fromMs: Date.parse('2026-10-16T00:00:00-06:00'), toMs: Date.parse('2026-10-18T00:00:00-06:00'), now });
ok('contadores por día', c.byDay.length === 2 && c.byDay[1].total === 2 && c.byDay[0].cancelled === 1, JSON.stringify(c.byDay));
ok('contadores por tienda', c.byStore[0].storeId === 's1' && c.byStore[0].total === 2 && c.byStore[0].cancelled === 1);
ok('vendido = solo entregados', c.sold === 210 && c.fees === 85);

for (const r of res) console.log(...r);
console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(res.every((r) => r[0] === 'PASS') ? 0 : 1);
