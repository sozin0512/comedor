// «Pidió hace X min» para conductores, tiendas y staff (lógica pura + HTML, sin Firebase ni navegador).
// Uso: node scripts/test-tiempo-espera.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const TMP = fs.mkdtempSync('/tmp/espera-');
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(TMP, 'fs-stub.mjs'), 'export const collection=()=>{},doc=()=>{},onSnapshot=()=>()=>{},query=()=>{},where=()=>{},orderBy=()=>{},limit=()=>{},getDocs=async()=>({docs:[]}),getDoc=async()=>({exists:()=>false}),Timestamp={fromMillis:(m)=>m};');
for (const f of ['trip-wait', 'delivery-zones-shared', 'ops-store-orders']) {
  const src = fs.readFileSync(path.join(ROOT, 'js', `${f}.js`), 'utf8')
    .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^'"]+firestore\.js/g, './fs-stub.mjs')
    .replace(/'\.\/delivery-zones-shared\.js\?v=[^']+'/g, "'./delivery-zones-shared.mjs'")
    .replace(/'\.\/trip-wait\.js\?v=[^']+'/g, "'./trip-wait.mjs'");
  fs.writeFileSync(path.join(TMP, `${f}.mjs`), src);
}
globalThis.window = {}; globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const W = await import(pathToFileURL(path.join(TMP, 'trip-wait.mjs')).href);
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
const MIN = 60e3; const NOW = 1_800_000_000_000;
const ts = (ms) => ({ toMillis: () => ms }); // como Firestore Timestamp

// ── 1. Etiquetas ──
ok('un momento', W.formatAgo(20e3) === 'Pidió hace un momento');
ok('3 min', W.formatAgo(3 * MIN + 59e3) === 'Pidió hace 3 min');
ok('1 h 5 min', W.formatAgo(65 * MIN) === 'Pidió hace 1 h 5 min');
ok('1 h exacta', W.formatAgo(60 * MIN) === 'Pidió hace 1 h');
ok('verbo de tiendas', W.formatAgo(25 * MIN, 'Pedido') === 'Pedido hace 25 min');
ok('más de un día', W.formatAgo(26 * 60 * MIN) === 'Pidió hace 1 d 2 h');
ok('colores: <5 verde, 5–14 ámbar, ≥15 rojo', W.waitTone(4 * MIN) === 'ok' && W.waitTone(5 * MIN) === 'warn' && W.waitTone(14 * MIN) === 'warn' && W.waitTone(15 * MIN) === 'bad');
ok('nunca negativo (hora en el futuro)', W.waitMs(NOW + 90e3, NOW) === 0 && W.formatAgo(W.waitMs(NOW + 90e3, NOW)) === 'Pidió hace un momento');
ok('sin hora → sin chip', W.waitChipHtml(0, { now: NOW }) === '' && W.waitMs(null, NOW) === null);

// ── 2. Chip del conductor ──
const trip = { status: 'pending', serviceType: 'moto', createdAt: ts(NOW - 7 * MIN) };
const chip = W.tripWaitChipHtml(trip, { now: NOW });
ok('viaje: «Pidió hace 7 min» ámbar con hora para el reloj', chip.includes('Pidió hace 7 min') && chip.includes('hr-wait-chip--warn') && chip.includes(`data-hr-wait-since="${NOW - 7 * MIN}"`));
const old = W.tripWaitChipHtml({ ...trip, createdAt: { seconds: (NOW - 22 * MIN) / 1000 } }, { now: NOW });
ok('viaje de hace 22 min: rojo + «lleva mucho esperando»', old.includes('hr-wait-chip--bad') && old.includes('lleva mucho esperando'));
const sched = W.tripWaitChipHtml({ ...trip, scheduledFor: '2027-01-15T15:30:00-06:00' }, { now: NOW, scheduledLabel: 'vie 15 ene 3:30 p. m.' });
ok('programado: muestra la hora programada, no la espera', sched.includes('Programado · vie 15 ene 3:30 p. m.') && !sched.includes('Pidió'));
ok('programado sin etiqueta → nada', W.tripWaitChipHtml({ ...trip, status: 'scheduled' }, { now: NOW }) === '');
const store = { status: 'pending', serviceType: 'delivery', storeOrderId: 'o1', createdAt: ts(NOW - 2 * MIN), deliveryDetails: { storeOrderId: 'o1', orderCreatedAtMs: NOW - 25 * MIN } };
const sc = W.tripWaitChipHtml(store, { now: NOW });
ok('pedido de tienda: cuenta desde el pedido del cliente («Pedido hace 25 min»)', sc.includes('Pedido hace 25 min') && sc.includes('hr-wait-chip--bad'));
ok('pedido viejo sin hora del pedido → hora del viaje', W.tripWaitChipHtml({ ...store, deliveryDetails: { storeOrderId: 'o1' } }, { now: NOW }).includes('Pedido hace 2 min'));
ok('hora del pedido posterior al viaje (mala) → se ignora', W.tripRequestSinceMs({ ...store, deliveryDetails: { orderCreatedAtMs: NOW } }) === NOW - 2 * MIN);
ok('escapa el verbo', W.waitChipHtml(NOW - MIN, { now: NOW, verb: '<b>' }).includes('&lt;b&gt;'));

// ── 3. Orden: quien más espera cerca va primero ──
const T = (id, minsAgo, km, extra = {}) => ({ id, status: 'pending', createdAt: ts(NOW - minsAgo * MIN), offerDistanceKm: km, ...extra });
const sorted = W.sortDriverOffers([
  T('cerca-nuevo', 1, 0.8), T('lejos-viejo', 30, 9), T('medio-viejo', 18, 3.5), T('mas-viejo', 40, 4.9),
  T('cerca-2', 6, 0.8), T('prog', 60, 1, { scheduledFor: '2027-01-01T10:00:00Z' }),
], NOW).map((t) => t.id);
ok('≥15 min y ≤5 km primero (más viejo arriba); luego por cercanía/antigüedad', JSON.stringify(sorted) === JSON.stringify(['mas-viejo', 'medio-viejo', 'cerca-2', 'cerca-nuevo', 'prog', 'lejos-viejo']), JSON.stringify(sorted));
ok('lejos (>5 km) no sube aunque espere', !W.isLongWaitPriority(T('x', 30, 9), NOW) && W.isLongWaitPriority(T('y', 30, null), NOW));

// ── 4. Reloj del teléfono corrido ──
W.setClockOffsetMs(0);
ok('doc recién creado con teléfono atrasado 2 min → desfase +2 min', W.nextClockOffset(0, NOW + 2 * MIN, NOW) === 2 * MIN);
ok('teléfono adelantado: se acerca poco a poco', W.nextClockOffset(0, NOW - 3 * MIN, NOW) === Math.round(-0.3 * 3 * MIN));
ok('viaje viejo que llega tarde (reconexión) no mueve el reloj', W.nextClockOffset(0, NOW - 40 * MIN, NOW) === 0);
ok('desfase absurdo (>6 h) se ignora', W.nextClockOffset(0, NOW + 9 * 3600e3, NOW) === 0);
const mkSnap = (docs, { fromCache = false } = {}) => ({ metadata: { fromCache }, docChanges: () => docs.map((d) => ({ type: 'added', doc: { metadata: { hasPendingWrites: false }, data: () => d } })) });
W.setClockOffsetMs(0);
W.learnClockFromTripSnap(mkSnap([{ createdAt: ts(NOW - 50 * MIN) }, { createdAt: ts(NOW - 30 * MIN) }, { createdAt: ts(NOW - 10 * MIN) }]), { isFirst: true, localNow: NOW });
ok('primer snapshot (viajes viejos) no cambia el reloj', W.getClockOffsetMs() === 0);
W.learnClockFromTripSnap(mkSnap([{ createdAt: ts(NOW + 90e3) }]), { localNow: NOW });
ok('viaje nuevo «en el futuro» → corrige 90 s', W.getClockOffsetMs() === 90e3);
ok('serverNow usa el desfase', W.serverNowMs(NOW) === NOW + 90e3);
W.learnClockFromTripSnap(mkSnap([{ createdAt: ts(NOW - 5 * MIN) }], { fromCache: true }), { localNow: NOW });
ok('snapshot de caché no se usa', W.getClockOffsetMs() === 90e3);
ok('compartido entre instancias (window)', window.__hrClockOffsetMs === 90e3);
W.setClockOffsetMs(0);

// ── 5. Se actualiza solo (sin volver a dibujar) ──
{
  const mk = (cls) => { const set = new Set(cls.split(' ')); return { classList: { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), has: (c) => set.has(c) } }; };
  const txt = { textContent: 'Pidió hace 4 min' }; const hint = { textContent: '' };
  const el = { ...mk('hr-wait-chip hr-wait-chip--ok'), getAttribute: (k) => ({ 'data-hr-wait-since': String(NOW - 16 * MIN), 'data-hr-wait-verb': 'Pidió' }[k]), querySelector: (q) => (q === '.hr-wait-txt' ? txt : hint) };
  const n = W.refreshWaitChips({ querySelectorAll: () => [el] }, NOW);
  ok('tick: texto y color se actualizan', n === 1 && txt.textContent === 'Pidió hace 16 min' && el.classList.has('hr-wait-chip--bad') && !el.classList.has('hr-wait-chip--ok') && hint.textContent.includes('mucho'));
}

// ── 6. Pedidos de tienda (Mi tienda virtual + panel Pedidos) ──
ok('pedido pendiente: chip', W.orderWaitChipHtml({ status: 'pending', createdAt: ts(NOW - 8 * MIN) }, { now: NOW }).includes('Pedido hace 8 min'));
ok('listo sin moto: chip rojo', W.orderWaitChipHtml({ status: 'ready', createdAt: ts(NOW - 31 * MIN) }, { now: NOW }).includes('hr-wait-chip--bad'));
ok('entregado/cancelado: sin chip', W.orderWaitChipHtml({ status: 'delivered', createdAt: ts(NOW - MIN) }) === '' && W.orderWaitChipHtml({ status: 'cancelled', createdAt: ts(NOW - MIN) }) === '');
{
  const SO = await import(pathToFileURL(path.join(TMP, 'ops-store-orders.mjs')).href);
  const now = Date.now();
  Object.assign(SO.__test.S, { tab: 'live', now, active: [{ id: 'abc123', status: 'pending', storeName: 'Baleadas Tere', createdAt: ts(now - 12 * MIN), items: [] }], todayDone: [{ id: 'zzz999', status: 'delivered', storeName: 'X', createdAt: ts(now - 50 * MIN), updatedAt: ts(now - 5 * MIN), items: [] }] });
  const h = SO.viewHtml();
  ok('panel Pedidos (staff): «Pedido hace 12 min» en el activo', h.includes('Pedido hace 12 min') && h.includes('hr-wait-chip--warn'));
  ok('panel Pedidos: el entregado no lleva chip', (h.match(/data-hr-wait-since/g) || []).length === 1);
}

// ── 7. Integración (app.js / merchant-stores.js) ──
const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
ok('app.js importa trip-wait con versión', /from "\.\/trip-wait\.js\?v=[\d.]+"/.test(app));
ok('tarjeta de lista y popup llevan el chip', (app.match(/\$\{waitChip\}/g) || []).length >= 2 && app.includes('hr-wait-row'));
ok('lista ordenada con sortDriverOffers', app.includes('sortDriverOffers(myOffers)'));
ok('reloj aprendido del snapshot de viajes', app.includes('learnClockFromTripSnap(snap'));
const ms = fs.readFileSync(path.join(ROOT, 'js', 'merchant-stores.js'), 'utf8');
ok('el viaje de tienda guarda la hora del pedido', ms.includes('orderCreatedAtMs: waitTsMs(order.createdAt)'));
ok('Mi tienda virtual: chip en pedidos de la tienda', ms.includes("${merchant ? orderWaitChipHtml(o) : ''}"));

// ── 8. Push de oferta (servidor) ──
{
  const Module = require('module'); const FN = path.join(ROOT, 'functions');
  const src = fs.readFileSync(path.join(FN, 'index.js'), 'utf8') + '\nmodule.exports.__w = { requestWaitPushSuffix };\n';
  const m = new Module(path.join(FN, 'index.js')); m.filename = path.join(FN, 'index.js'); m.paths = Module._nodeModulePaths(FN);
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-hr';
  m._compile(src, m.filename);
  const S = m.exports.__w.requestWaitPushSuffix;
  ok('push: « · pidió hace 7 min»', S({ createdAt: ts(NOW - 7 * MIN) }, NOW) === ' · pidió hace 7 min');
  ok('push: recién pedido → nada', S({ createdAt: ts(NOW - 60e3) }, NOW) === '');
  ok('push: pedido de tienda desde el pedido', S({ storeOrderId: 'o', createdAt: ts(NOW - 3 * MIN), deliveryDetails: { orderCreatedAtMs: NOW - 70 * MIN } }, NOW) === ' · pedido hace 1 h 10 min');
  ok('push: programado → nada', S({ scheduledFor: '2027-01-01', createdAt: ts(NOW - 90 * MIN) }, NOW) === '');
}

fs.rmSync(TMP, { recursive: true, force: true });
for (const r of res) console.log(...r);
console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
process.exit(res.every((r) => r[0] === 'PASS') ? 0 : 1);
