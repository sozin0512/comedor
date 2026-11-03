/** v.42 Pedido doble e2e (Firestore/Functions simulados en vivo). node run.mjs <sitio> <carpeta-png> */
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const MOCKS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mocks');
const site = path.resolve(process.argv[2] || '.'); const out = process.argv[3] || '/workspace/artifacts/pedido-doble';
const { chromium } = createRequire('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/')('playwright-core');
const mockMap = { 'firebase-firestore.js': 'firestore.js', 'firebase-auth.js': 'auth.js', 'firebase-app.js': 'app.js', 'firebase-functions.js': 'functions.js', 'firebase-storage.js': 'storage.js', 'firebase-messaging.js': 'messaging.js' };
const CT = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  geolocation: { latitude: 14.0818, longitude: -87.2068 }, permissions: ['geolocation'], locale: 'es-HN', timezoneId: 'America/Tegucigalpa' });
await ctx.addInitScript(() => {
  const uid = 'd1'; const now = Date.now();
  window.__HR_MOCK_USER = { uid, email: 'rider@example.com', emailVerified: true, displayName: 'Cristian', providerData: [], getIdToken: async () => 'x', getIdTokenResult: async () => ({ claims: {} }), reload: async () => {} };
  const profile = { role: 'driver', name: 'Cristian López', email: 'rider@example.com', phone: '+50488888888', birthDate: '1990-05-13', gender: 'male', approvalStatus: 'approved', status: 'approved', identityVerified: true, legalAccepted: true, termsAccepted: true, privacyAccepted: true, legalAcceptedAt: now,
    city: 'tegucigalpa', serviceZoneId: 'tegucigalpa', vehicleType: 'moto', vehicleTypes: ['moto'], isOnline: true, saldo: 500, createdAt: now - 864e5 * 300 };
  const T = 'artifacts/comayagua-vip-pro-v4/public/data/trips/';
  const store = { storeId: 'campero', storeName: 'Pollo Campero Los Próceres', serviceType: 'delivery', paymentMethod: 'efectivo', originLat: 14.0818, originLng: -87.2068, origin: 'Pollo Campero Los Próceres', vehicleType: 'moto' };
  const A = { ...store, storeOrderId: 'oA', status: 'accepted', driverId: uid, driverName: 'Cristian López', clientId: 'cA', clientName: 'Ana Martínez', clientPhone: '+50499110011', destination: 'Col. Palmira, casa 12', destinationLat: 14.0950, destinationLng: -87.2000, price: 'L. 60', priceNum: 60, createdAtMs: now - 300000, acceptedAtMs: now - 200000 };
  const B = { ...store, storeOrderId: 'oB', status: 'pending', clientId: 'cB', clientName: 'María Reyes', clientPhone: '+50499220022', destination: 'Col. Palmira, frente al parque', destinationLat: 14.0990, destinationLng: -87.1990, price: 'L. 55', priceNum: 55, createdAtMs: now - 20000,
    offeredToDriverId: uid, offerPhase: 'exclusive', offerWindowSec: 25, offerExpiresAtMs: now + 600000, offerPedidoDoble: true, offerBatchWithTripId: 'A', pdPriorityDriverId: uid, offerDistanceKm: 0.05 };
  window.__HR_SEED = { A, B, T };
  window.__HR_MOCK_PROFILE = profile;
  window.__HR_MOCK_DOCS = (p) => p.endsWith(`/users/${uid}/profile/data`) ? profile : p === T + 'A' ? A : p === T + 'B' ? B : null;
  window.__HR_CALLS = [];
  window.__HR_CALL = async (name, data) => {
    window.__HR_CALLS.push([name, data]);
    if (name === 'acceptDriverTrip' && data?.batchWithTripId) {   // simula functions/pedido-doble.js acceptBatchedTrip
      const ids = [data.batchWithTripId, data.tripId]; const batchId = `pd_${ids[0]}_${ids[1]}`;
      const common = { batchId, batchTripIds: ids, pedidoDoble: true, batchCreatedAtMs: Date.now(), batchReason: 'entrega_cerca' };
      window.__HR_APPLY(T + ids[0], { ...common, batchIndex: 1 });
      window.__HR_APPLY(T + ids[1], { ...common, batchIndex: 2, status: 'accepted', driverId: uid, driverName: 'Cristian López', acceptedAtMs: Date.now(), offeredToDriverId: { __del: 1 } });
      return { ok: true, pedidoDoble: true, batchId, batchWithTripId: ids[0] };
    }
    return { ok: true };
  };
  try { localStorage.setItem('honduber_market', 'hn'); localStorage.setItem('hrInstallBannerDismissedAt', String(now)); localStorage.setItem('honduber_active_trip_id', 'A'); localStorage.setItem('hr_loc_disclosure_v1_driver', '1'); } catch (_) {}
});
await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, (r) => { const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1]; r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(MOCKS, mockMap[f])) }); });
await ctx.route(/^https:\/\/honduraite\.com\//, (r) => { let p = decodeURIComponent(new URL(r.request().url()).pathname); if (p.endsWith('/')) p += 'index.html'; const fp = path.join(site, p);
  if (!fp.startsWith(site) || !fs.existsSync(fp)) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ contentType: CT[path.extname(fp)] || 'application/octet-stream', body: fs.readFileSync(fp) }); });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (/pedido-doble/.test(m.text())) console.log('  [console]', m.text().slice(0, 200)); });
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const clean = () => page.evaluate(() => document.querySelectorAll('#hr-a2hs-overlay,.hr-loc-disclosure').forEach((e) => e.remove()));
const shot = async (n) => { await clean(); return page.screenshot({ path: path.join(out, `real-${n}.png`) }); };
await page.goto('https://honduraite.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);
for (const txt of ['Preguntarme más tarde', 'Ahora no', 'Entendido']) { const b = page.getByText(txt).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); }
const st0 = await page.evaluate(() => ({ role: window.userProfile?.role, active: window.activeTrip?.id, st: window.activeTrip?.status, pd: !!window.hrPedidoDoble }));
t('carga: conductor con pedido activo A + módulo pedido doble', st0.role === 'driver' && st0.active === 'A' && st0.pd, JSON.stringify(st0));

// 1) Oferta del 2º pedido mientras está en el negocio
const o = await page.evaluate(() => { const B = { id: 'B', ...window.__HR_SEED.B }; window.__hrSyncDriverTripOfferPopup([B], { onActiveTrip: true, forceShow: true });
  const pop = document.getElementById('driver-trip-offer-popup'); return { badge: !!pop?.querySelector('.hr-pd-offer'), prio: !!pop?.querySelector('.hr-pd-prio'), sub: document.getElementById('driver-trip-offer-popup-sub')?.textContent, vis: pop && !pop.classList.contains('hidden') }; });
t('oferta: etiqueta «Pedido doble» + prioridad en el negocio', o.badge && o.prio && /Pedido doble/.test(o.sub || ''), JSON.stringify(o));
await page.evaluate(() => document.querySelector('#driver-trip-offer-popup .hr-pd-offer')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(600); await shot('1-oferta');

// 2) Aceptar → llamada transaccional con batchWithTripId
await page.evaluate(() => window.acceptTrip('B'));
await page.waitForTimeout(2500);
const c = await page.evaluate(() => ({ call: window.__HR_CALLS.find((x) => x[0] === 'acceptDriverTrip')?.[1], active: window.activeTrip?.id, rows: document.querySelectorAll('#hr-pd-card .hr-pd-row').length, head: document.querySelector('#hr-pd-card .hr-pd-head')?.textContent, queued: window.driverQueuedTripId || null }));
t('aceptar: acceptDriverTrip con batchWithTripId=A y sin cola', c.call?.batchWithTripId === 'A' && !c.call?.queuedTripId && !c.queued, JSON.stringify(c.call));
t('aceptar: el 1º sigue activo y la tarjeta muestra los 2', c.active === 'A' && c.rows === 2, JSON.stringify(c));
await shot('2-activo-dos');

// 3) Llegué + recogí (el viaje activo pasa a en curso) → el 2º copia la etapa
await page.evaluate(() => window.__HR_APPLY(window.__HR_SEED.T + 'A', { driverArrived: true }));
await page.waitForTimeout(2500);
const arr = await page.evaluate(() => window.__HR_DB[window.__HR_SEED.T + 'B']?.driverArrived);
t('llegué al negocio: se copia al 2º pedido', arr === true);
await page.evaluate(() => window.__HR_APPLY(window.__HR_SEED.T + 'A', { status: 'in_progress', storePickedUpAt: Date.now() }));
await page.waitForTimeout(3500);
const p = await page.evaluate(() => ({ b: window.__HR_DB[window.__HR_SEED.T + 'B']?.status, ord: window.__HR_DB['artifacts/comayagua-vip-pro-v4/public/data/store_orders/oB']?.status, btns: document.querySelectorAll('#hr-pd-card [data-pd-deliver]').length, act: window.activeTrip?.status }));
t('recogí los 2: el 2º pasa a en curso + orden en camino', p.b === 'in_progress' && p.ord === 'out_for_delivery' && p.btns === 2, JSON.stringify(p));

// 4) Entregar el 1º (botón de la tarjeta) → cierre ligero con su cobro; el otro pasa a activo
await clean(); await page.locator('#hr-pd-card [data-pd-deliver]').first().click({ timeout: 8000 });
await page.waitForTimeout(800);
const ok = page.getByText('Sí, entregado').first(); if (await ok.isVisible().catch(() => false)) await ok.click();
await page.waitForTimeout(3500);
const d = await page.evaluate(() => { const T = window.__HR_SEED.T; return { a: window.__HR_DB[T + 'A']?.status, aPrice: window.__HR_DB[T + 'A']?.priceNum, b: window.__HR_DB[T + 'B']?.status, ordA: window.__HR_DB['artifacts/comayagua-vip-pro-v4/public/data/store_orders/oA']?.status,
  active: window.activeTrip?.id, done: document.querySelectorAll('#hr-pd-card .hr-pd-row.is-done').length, charge: document.querySelector('#hr-pd-card .hr-pd-charge')?.textContent, rating: !!document.querySelector('#rating-modal:not(.hidden)') }; });
t('1º entregado: completado con su cobro, sin calificar aún', d.a === 'completed' && d.aPrice === 60 && d.ordA === 'delivered' && d.b === 'in_progress' && d.done === 1 && /60/.test(d.charge || ''), JSON.stringify(d));
t('1º entregado: el 2º queda como viaje activo', d.active === 'B', d.active);
await shot('3-primero-entregado');

// 5) Último pedido: la app lo cierra con su flujo normal (aquí simulado) → resumen
await page.evaluate(() => { const T = window.__HR_SEED.T; window.__HR_APPLY(T + 'A', { serverCommissionAmount: 6, serverCommissionAtMs: Date.now() });
  window.__HR_APPLY(T + 'B', { status: 'completed', serverCommissionAmount: 5.5, serverCommissionAtMs: Date.now() }); });
await page.waitForTimeout(3500);
const s = await page.evaluate(() => ({ sum: document.querySelector('#hr-pd-summary')?.innerText || '' }));
t('resumen: 2 pedidos, comisión y ganancia', /Pedido doble completado/.test(s.sum) && /2 entregas/.test(s.sum) && /103/.test(s.sum.replace(/,/g, '')), JSON.stringify(s.sum.slice(0, 300)));
await shot('4-resumen');
t('sin errores JS de página', !errs.length, JSON.stringify(errs.slice(0, 4)));
console.log(`\n${pass} PASS, ${fail} FAIL`); await browser.close(); process.exit(fail ? 1 : 0);
