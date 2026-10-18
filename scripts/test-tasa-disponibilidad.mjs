// Tasa de aceptación + disponibilidad de servicios + pedidos de tienda en la app del conductor.
// Uso: node scripts/test-tasa-disponibilidad.mjs   (sin emulador ni navegador)
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module'; import { execFileSync } from 'child_process';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
globalThis.window = globalThis.window || {};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

// Los .js del front son ES modules pero el package.json raíz no dice "type": "module": copia a /tmp.
const JS = fs.mkdtempSync('/tmp/hr-js-');
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(JS, f));
fs.writeFileSync(path.join(JS, 'package.json'), '{"type":"module"}');
const jsUrl = (f) => pathToFileURL(path.join(JS, f)).href;
const A = await import(jsUrl('service-availability.js'));
const now = Date.now();
const MIN = 60e3;

// ── 1. Modos ──
ok('por defecto grúa/fletes automático, viajes siempre abierto',
  A.getServiceMode({}, 'comayagua', 'grua') === 'auto' && A.getServiceMode({}, 'comayagua', 'flete_camion') === 'auto' && A.getServiceMode({}, 'comayagua', 'moto') === 'on');
const cfg = A.normalizeAvailabilityConfig({
  _all: { moto: { mode: 'auto' } },
  comayagua: { grua: { mode: 'off', message: 'Sin grúa <b>hoy</b>' }, taxi: { mode: 'bogus' }, nada: { mode: 'off' } },
  'bad/zone': { grua: { mode: 'off' } },
});
ok('normaliza: quita modos/servicios/zonas inválidas y <>', !cfg['bad/zone'] && !cfg.comayagua.taxi && !cfg.comayagua.nada && cfg.comayagua.grua.message === 'Sin grúa bhoy/b');
ok('ciudad gana sobre «todas»', A.getServiceMode(cfg, 'comayagua', 'grua') === 'off' && A.getServiceMode(cfg, 'siguatepeque', 'moto') === 'auto');
ok('apagado viejo por ciudad (fletes) = cerrado', A.getServiceMode({}, 'tela', 'flete_paila', { tela: { fletes: true } }) === 'off');

// ── 2. Conteo de conductores en línea ──
const C = { lat: 14.45, lng: -87.64 };
const locs = [
  { vehicleType: 'grua', online: true, updatedAt: now - 5 * MIN, serviceZoneId: 'comayagua' },
  { vehicleType: 'grua', online: true, updatedAt: now - 50 * MIN, serviceZoneId: 'comayagua' }, // vieja
  { vehicleType: 'grua', online: false, updatedAt: now, serviceZoneId: 'comayagua' },             // fuera de línea
  { vehicleType: 'paila', online: true, updatedAt: now, lat: 14.6, lng: -87.7 },                // ~18 km, cuenta (40 km)
  { vehicleType: 'moto', online: true, updatedAt: now, lat: 14.6, lng: -87.7 },                 // ~18 km, no cuenta (15 km)
  { vehicleType: 'camion', online: true, updatedAt: now, serviceZoneId: 'comayagua', approvalStatus: 'pending' },
  { vehicleType: 'vip', online: true, updatedAt: { seconds: Math.floor(now / 1000) }, serviceZoneId: 'comayagua' },
  { vehicleType: 'moto', online: true, updatedAt: now, serviceZoneId: 'comayagua', isSimulated: true },
];
const counts = A.countOnlineByVehicle(locs, { zoneId: 'comayagua', center: C, now });
ok('cuenta solo en línea, frescos, aprobados y de la ciudad', counts.grua === 1 && counts.paila === 1 && counts.moto === 0 && counts.camion === 0 && counts.auto === 1, JSON.stringify(counts));

// ── 3. Resolver ──
const r1 = A.resolveServiceAvailability({ config: {}, zoneId: 'comayagua', svc: 'flete_camion', counts });
ok('automático sin camiones → no disponible (sin conductores)', !r1.available && r1.reason === 'no_drivers');
ok('programado no se bloquea por falta de conductores', A.resolveServiceAvailability({ config: {}, zoneId: 'comayagua', svc: 'flete_camion', counts, scheduled: true }).available);
ok('sin datos de conteo → no bloquea', A.resolveServiceAvailability({ config: {}, zoneId: 'comayagua', svc: 'grua', counts: null }).available);
ok('cerrado bloquea aunque haya conductores y aunque sea programado', !A.resolveServiceAvailability({ config: cfg, zoneId: 'comayagua', svc: 'grua', counts, scheduled: true }).available);
ok('siempre abierto con 0 conductores → disponible', A.resolveServiceAvailability({ config: {}, zoneId: 'comayagua', svc: 'taxi', counts }).available);
ok('mensaje sin conductores', A.unavailableMessage('grua', 'Comayagua', 'no_drivers') === 'Por ahora no hay grúas disponibles en Comayagua. Intenta más tarde o escríbenos por WhatsApp.');
ok('mensaje personalizado gana', A.unavailableMessage('grua', 'Comayagua', 'closed', A.getServiceCustomMessage(cfg, 'comayagua', 'grua')) === 'Sin grúa bhoy/b');

// ── 4. Copia del servidor al día ──
let synced = true;
try { execFileSync('node', [path.join(ROOT, 'scripts', 'sync-service-availability.js'), '--check'], { stdio: 'pipe' }); } catch (_) { synced = false; }
ok('functions/service-availability-core.js generado desde js/', synced);
const core = require(path.join(ROOT, 'functions', 'service-availability-core.js'));
ok('servidor = app (mismo resultado)', JSON.stringify(core.countOnlineByVehicle(locs, { zoneId: 'comayagua', center: C, now })) === JSON.stringify(counts));

// ── 5. Tasa de aceptación ──
const T = (o) => ({ createdAt: now - 60 * MIN, clientId: 'c1', ...o });
const trips = [
  T({ serviceType: 'grua', status: 'cancelled', cancelledBy: 'system' }),
  T({ serviceType: 'grua', status: 'expired' }),
  T({ serviceType: 'grua', status: 'completed', driverId: 'd1', driverName: 'Edwin', acceptedAt: now - 55 * MIN, viewedBy: { d1: {}, d2: { name: 'Kevin' } }, declinedDriverIds: ['d3'] }),
  T({ serviceType: 'moto', status: 'completed', driverId: 'd2', acceptedAt: now - 59 * MIN }),
  T({ serviceType: 'moto', status: 'cancelled', cancelledBy: 'c1' }),
  T({ serviceType: 'moto', status: 'cancelled', cancelledBy: 'c1', driverId: 'd2', acceptedAt: now - 58 * MIN }), // aceptado y luego cancelado = aceptado
  T({ serviceType: 'moto', status: 'pending' }),
  T({ serviceType: 'delivery', storeOrderId: 'o1', status: 'completed', driverId: 'd1' }),
  T({ serviceType: 'flete_paila', status: 'completed', driverId: 'd4' }),
  T({ serviceType: 'auto', bookingType: 'hourly', status: 'completed', driverId: 'd5' }),
  T({ serviceType: 'auto', status: 'completed', driverId: 'd5', trashedAtMs: now }),          // papelera
  T({ serviceType: 'auto', status: 'completed', driverId: 'd5', isDemandSimulation: true }),  // simulación
  T({ serviceType: 'auto', status: 'scheduled' }),                                            // sin decidir
  { serviceType: 'auto', status: 'completed', driverId: 'd5', createdAt: now - 40 * 24 * 60 * MIN }, // fuera del periodo
];
const st = A.computeAcceptanceStats(trips, { from: now - 30 * 24 * 60 * MIN, to: now });
ok('grúa 1 de 3 = 33.3%', st.byCat.grua.requests === 3 && st.byCat.grua.accepted === 1 && st.byCat.grua.rate === 33.3 && st.byCat.grua.noDriver === 2, JSON.stringify(st.byCat.grua));
ok('moto: cliente canceló antes cuenta; buscando no entra', st.byCat.moto.requests === 3 && st.byCat.moto.accepted === 2 && st.byCat.moto.clientCancelled === 1 && st.byCat.moto.searching === 1);
ok('pedido de tienda separado de envíos', st.byCat.tienda.requests === 1 && st.byCat.delivery.requests === 0);
ok('flete y por hora', st.byCat.flete.accepted === 1 && st.byCat.hourly.accepted === 1);
ok('excluye papelera, simulaciones, programados sin decidir y fuera del periodo', st.byCat.auto.requests === 0 && st.total.requests === 9, String(st.total.requests));
ok('espera hasta aceptar (promedio)', st.byCat.grua.waitAvgMs === 5 * MIN && st.byCat.moto.waitAvgMs === 1.5 * MIN, String(st.byCat.moto.waitAvgMs));
const d1 = st.drivers.find((d) => d.uid === 'd1'); const d3 = st.drivers.find((d) => d.uid === 'd3');
ok('por conductor: vio/pasó/tomó vs aceptó', d1.offers === 2 && d1.accepted === 2 && d3.offers === 1 && d3.accepted === 0 && d3.rate === 0);
ok('categoría más baja (mín. 3)', st.lowest === 'grua');
ok('tono', A.acceptanceTone(85) === 'ok' && A.acceptanceTone(60) === 'warn' && A.acceptanceTone(30) === 'bad');

// ── 6. Conductor: pedido de tienda ──
const U = await import(jsUrl('store-trip-ui.js'));
const storeTrip = {
  serviceType: 'delivery', storeOrderId: 'a7f3k2xyz', priceNum: 40, price: 'L. 40.00', deliveryZoneName: 'Comayagua céntrica',
  clientName: 'María', clientPhone: '9876-5432',
  deliveryDetails: { storeOrderId: 'a7f3k2xyz', restaurant: 'Baleadas <Tere>', recipientName: 'María José', recipientPhone: '9876-5432', itemsTotal: 185,
    items: [{ name: 'Baleada', qty: 3, price: 35 }, { name: 'Horchata', qty: 1, price: 45 }], productsPaymentMethod: 'efectivo', productsPaid: false, deliveryNotes: 'Portón negro' },
};
const sm = U.storeOrderSummary(storeTrip);
ok('efectivo: cobra productos + envío', sm.cashToCollect === 225 && sm.fee === 40 && sm.itemsTotal === 185);
const paid = U.storeOrderSummary({ ...storeTrip, deliveryDetails: { ...storeTrip.deliveryDetails, productsPaid: true, productsPaymentMethod: 'saldo' } }, 110);
ok('pagado con puntos: solo el envío', paid.cashToCollect === 110 && paid.productsPaid);
const badges = U.storeOfferBadgesHtml(storeTrip);
ok('insignia «Pedido de tienda» + zona', badges.includes('Pedido de tienda') && badges.includes('Comayagua céntrica'));
const collect = U.storeCollectHtml(storeTrip, 40);
ok('caja de cobro con total L. 225.00', collect.includes('Total a cobrar') && collect.includes('L. 225.00') && collect.includes('Le pasas L. 185.00'));
const panel = U.storeAcceptedPanelHtml(storeTrip, 40);
ok('aceptado: productos, teléfono, WhatsApp y total', panel.includes('3× Baleada') && panel.includes('L. 105.00') && panel.includes('tel:98765432') && panel.includes('wa.me/50498765432') && panel.includes('Total de la tienda') && panel.includes('Portón negro'));
ok('escapa HTML del nombre de la tienda', panel.includes('Baleadas &lt;Tere&gt;') && !panel.includes('<Tere>'));
const old = U.storeOrderSummary({ serviceType: 'delivery', storeDelivery: true, priceNum: 40, deliveryDetails: { packageDescription: 'Pedido tienda: 2× Pollo chuco, 1× Coca', itemsTotal: 300 } });
ok('viaje viejo sin items: lee la descripción', old.items.length === 2 && old.items[0].qty === 2 && old.items[0].name === 'Pollo chuco');
ok('viaje normal no muestra nada', U.storeOfferBadgesHtml({ serviceType: 'moto' }) === '' && U.storeAcceptedPanelHtml({ serviceType: 'delivery', deliveryDetails: {} }) === '');

// ── 7. Pedido sigue al viaje ──
const S = require(path.join(ROOT, 'functions', 'store-order-sync.js'));
const P = S.storeOrderPatchForTripChange;
const ord = { status: 'ready', tripId: 't1' };
const trip0 = { serviceType: 'delivery', storeOrderId: 'o1', status: 'pending' };
const pa = P(trip0, { ...trip0, status: 'accepted', driverId: 'd1', driverName: 'Edwin H.' }, ord, 't1', 1000);
ok('acepta → En camino con conductor', pa && pa.status === 'out_for_delivery' && pa.driverId === 'd1' && pa.deliveryStage === 'driver_assigned');
ok('pendiente sin conductor → no cambia (no «en camino»)', P(trip0, { ...trip0, viewedBy: {} }, ord, 't1') === null);
const pc = P({ ...trip0, status: 'in_progress', driverId: 'd1' }, { ...trip0, status: 'completed', driverId: 'd1' }, { status: 'out_for_delivery', tripId: 't1' }, 't1');
ok('completado → Entregado automático', pc && pc.status === 'delivered' && pc.deliveredBy === 'trip_completed');
const pr = P({ ...trip0, status: 'accepted', driverId: 'd1' }, { ...trip0, status: 'pending', driverId: null }, { status: 'out_for_delivery', tripId: 't1' }, 't1');
ok('conductor cancela y se reofrece → vuelve a buscando', pr && pr.status === 'ready' && pr.deliveryStage === 'driver_requeued');
const px = P(trip0, { ...trip0, status: 'cancelled' }, ord, 't1');
ok('viaje cancelado → listo sin viaje (tienda pide otro)', px && px.status === 'ready' && px.tripId === null && px.deliveryStage === 'trip_cancelled');
ok('pedido cancelado/entregado no se toca', P(trip0, { ...trip0, status: 'completed' }, { status: 'cancelled', tripId: 't1' }, 't1') === null);
ok('viaje viejo (otro tripId) no manda', P(trip0, { ...trip0, status: 'completed' }, { status: 'ready', tripId: 't2' }, 't1') === null);

// ── 8. Servidor: Taxi VIP también recibe pedidos de tienda ──
{
  const Module = require('module');
  const FN = path.join(ROOT, 'functions');
  const src = fs.readFileSync(path.join(FN, 'index.js'), 'utf8') + '\nmodule.exports.__t = { driverCanServeTrip, requiredVehicleTypesForTrip, locOrProfileCanServeTrip, isStoreDeliveryTrip };\n';
  const m = new Module(path.join(FN, 'index.js')); m.filename = path.join(FN, 'index.js'); m.paths = Module._nodeModulePaths(FN);
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-hr';
  m._compile(src, m.filename);
  const t = m.exports.__t;
  const st0 = { serviceType: 'delivery', storeOrderId: 'o1' };
  ok('pedido de tienda: tipos moto + auto', JSON.stringify(t.requiredVehicleTypesForTrip(st0)) === '["moto","auto"]');
  ok('envío normal: solo moto', JSON.stringify(t.requiredVehicleTypesForTrip({ serviceType: 'delivery' })) === '["moto"]');
  ok('Taxi VIP puede tomar pedido de tienda', t.driverCanServeTrip('auto', 'delivery', st0) && !t.driverCanServeTrip('auto', 'delivery', { serviceType: 'delivery' }));
  ok('perfil con VIP aprobado sirve pedido de tienda', t.locOrProfileCanServeTrip({ vehicleType: 'auto' }, { vehicles: [{ type: 'auto', approvalStatus: 'approved' }] }, 'delivery', st0));
  ok('taxi tradicional no', !t.driverCanServeTrip('taxi', 'delivery', st0));
  ok('export onStoreTripStatusSync y staffSetServiceAvailability', typeof m.exports.onStoreTripStatusSync === 'function' && typeof m.exports.staffSetServiceAvailability === 'function');
}

// ── 9. WhatsApp / servidor: checkServiceAvailable con db falsa ──
{
  const SA = require(path.join(ROOT, 'functions', 'service-availability.js'));
  const fakeDb = (settings, locDocs) => ({
    doc: () => ({ get: async () => ({ exists: !!settings, data: () => settings }) }),
    collection: () => ({ get: async () => ({ docs: locDocs.map((d) => ({ data: () => d })) }) }),
  });
  const c1 = await SA.checkServiceAvailable(fakeDb({}, []), 'app', { serviceType: 'grua', zoneId: 'comayagua' });
  ok('WA: grúa sin conductores → no disponible con mensaje', c1.available === false && /no hay grúas disponibles en Comayagua/.test(c1.message), c1.message);
  const c2 = await SA.checkServiceAvailable(fakeDb({}, [{ vehicleType: 'grua', online: true, updatedAt: Date.now(), serviceZoneId: 'comayagua' }]), 'app', { serviceType: 'grua', zoneId: 'comayagua' });
  ok('WA: con grúa en línea → disponible', c2.available === true);
  const c3 = await SA.checkServiceAvailable(fakeDb({}, []), 'app', { serviceType: 'auto', zoneId: 'comayagua' });
  ok('WA: Taxi VIP (siempre abierto) → disponible', c3.available === true);
  const c4 = await SA.checkServiceAvailable(fakeDb({ serviceAvailability: { comayagua: { moto: { mode: 'off' } } } }, []), 'app', { serviceType: 'moto', zoneId: 'comayagua', scheduled: true });
  ok('WA: cerrado bloquea también programado', c4.available === false && c4.reason === 'closed');

  // callable con transacción falsa
  let saved = null; const added = [];
  const store = { serviceAvailability: { comayagua: { grua: { mode: 'auto' } } }, disabledServicesByCity: { comayagua: { fletes: true } } };
  const db = {
    doc: () => ({}),
    runTransaction: async (fn) => fn({ get: async () => ({ exists: true, data: () => store }), set: (_r, patch) => { saved = patch; } }),
    collection: () => ({ add: async (x) => { added.push(x); } }),
  };
  class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  const mod = SA({ db, FieldValue: { serverTimestamp: () => 'ts' }, HttpsError, onCall: (fn) => fn, APP_ID: 'app', assertCallerCanModerate: async (a) => { if (!a) throw new HttpsError('unauthenticated', 'x'); return { uid: a.uid }; } });
  const call = mod.exports.staffSetServiceAvailability;
  const out = await call({ auth: { uid: 'SUP' }, data: { zoneId: 'comayagua', service: 'flete_paila', mode: 'on', message: ' Llama <antes> ' } });
  ok('callable guarda modo + mensaje limpio', out.ok && saved.serviceAvailability.comayagua.flete_paila.mode === 'on' && saved.serviceAvailability.comayagua.flete_paila.message === 'Llama antes' && saved.serviceAvailabilityUpdatedBy === 'SUP');
  ok('abrir paila limpia el apagado viejo de fletes y deja camión cerrado', saved.disabledServicesByCity && !saved.disabledServicesByCity.comayagua && saved.serviceAvailability.comayagua.flete_camion.mode === 'off');
  ok('historial registrado', added.length === 1 && added[0].service === 'flete_paila');
  let denied = false; try { await call({ auth: null, data: {} }); } catch (e) { denied = e.code === 'unauthenticated'; }
  ok('sin sesión → rechazado', denied);
  let bad = false; try { await call({ auth: { uid: 'SUP' }, data: { zoneId: 'comayagua', service: 'helicoptero', mode: 'on' } }); } catch (e) { bad = e.code === 'invalid-argument'; }
  ok('servicio inválido → rechazado', bad);
}

// ── 10. Panel Viajes: pestañas Tasa y Disponibilidad ──
{
  const tmp = path.join('/tmp', `vj-tasa-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, fs.readFileSync(path.join(ROOT, 'js', 'ops-viajes-panel.js'), 'utf8'));
  const mod = await import(pathToFileURL(tmp).href);
  const X = mod.__test;
  X.setDeps({ avail: A, getZoneById: (id) => (id === 'comayagua' ? { name: 'Comayagua', center: C } : null) });
  X.ST.trips = trips.map((t, i) => ({ id: `t${i}`, cityId: 'comayagua', cityName: 'Comayagua', ...t }));
  X.ST.locs = new Map(locs.map((l, i) => [`d${i}`, l]));
  X.ST.users = new Map([['d1', { name: 'Edwin <H>' }]]);
  X.ST.appSettings = { serviceAvailability: { comayagua: { grua: { mode: 'off' } } } };
  X.ST.loadedTrips = true;
  X.UI.period = 'month'; X.UI.city = 'all'; X.UI.svc = 'all'; X.UI.excludeTest = false;
  const h = X.renderRate();
  ok('Tasa: fila Grúa 33%', /Grúa \/ remolque<\/b><\/td><td class="r">3<\/td><td class="r">1<\/td>/.test(h) && h.includes('33%'));
  ok('Tasa: por conductor escapado', h.includes('Edwin &lt;H&gt;') && !h.includes('Edwin <H>'));
  ok('Tasa: categoría más baja', h.includes('Categoría más baja') && h.includes('Grúa / remolque 33%'));
  X.AVAIL_UI.city = 'comayagua';
  const av = X.renderAvail();
  ok('Disponibilidad: grúa cerrada', /Grúa \/ remolque[\s\S]*?No disponible · cerrado/.test(av));
  ok('Disponibilidad: camión sin conductores (aprobados)', /Flete · Camión[\s\S]*?No disponible · sin conductores/.test(av));
  ok('Disponibilidad: paila disponible (1 en línea)', /Flete · Paila[\s\S]*?Disponible<\/span><\/td><td class="vj-mut">1 en línea/.test(av));
  ok('Disponibilidad: botones de modo', av.includes('data-act="availMode" data-svc="grua" data-v="off"') && av.includes('Siempre abierto'));
  const rows = X.availRows('_all');
  ok('Todas las ciudades: valores por defecto', rows.find((r) => r.svc === 'grua').mode === 'auto' && rows.find((r) => r.svc === 'moto').mode === 'on');
  fs.unlinkSync(tmp);
}

// ── 11. service-types: el hook bloquea y da el mensaje (otra instancia del módulo también) ──
{
  const st1 = await import(jsUrl('service-types.js') + '?a=1');
  const st2 = await import(jsUrl('service-types.js') + '?b=2');
  window.__hrServiceAvailability = (svc, zone) => (svc === 'grua' ? { available: false, reason: 'no_drivers', message: 'Por ahora no hay grúas disponibles en Comayagua.' } : { available: true });
  ok('isServiceTypeDisabledInCity usa la disponibilidad', st1.isServiceTypeDisabledInCity('grua', 'comayagua') && !st1.isServiceTypeDisabledInCity('moto', 'comayagua'));
  ok('mensaje de disponibilidad', st1.getCityServiceDisabledMessage('grua', 'Comayagua', 'comayagua') === 'Por ahora no hay grúas disponibles en Comayagua.');
  st1.setDisabledServicesByCity({ tela: { taxi: true } });
  ok('apagado viejo compartido entre instancias (window)', st2.isServiceTypeDisabledInCity('taxi', 'tela'));
  delete window.__hrServiceAvailability;
}

fs.rmSync(JS, { recursive: true, force: true });
for (const r of res) console.log(...r);
const all = res.every((r) => r[0] === 'PASS');
console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
process.exit(all ? 0 : 1);
