/**
 * Estadísticas/Finanzas: envíos de restaurante «sin destino» (cobro por zona) como línea propia, contados una vez.
 * Uso: node scripts/test-stats-zona.mjs   (capturas en ZONE_SHOTS o /workspace/artifacts/envio-zona)
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
import { serve, loadPuppeteer, CHROME } from './e2e-sonido-pedidos/server.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
const ZS = process.env.ZONE_SHOTS || '/workspace/artifacts/envio-zona'; fs.mkdirSync(ZS, { recursive: true });
const now = Date.parse('2026-11-02T20:00:00Z'); const h = 3.6e6;
const zt = (id, o) => ({ id, zoneBilling: true, deliveryDetails: { zoneBilling: true, recipientPhone: '98765432' }, merchantDirectDelivery: true, createdByMerchant: true, storeDelivery: true, storeId: 's1', merchantName: 'Baleadas Doña Mary', serviceType: 'delivery', status: 'completed', paymentMethod: 'efectivo', driverId: 'd1', driverName: 'Carlos', cityId: 'comayagua', serviceZoneId: 'comayagua', createdAt: now - h, completedAt: now - h, ...o });
const TRIPS = [
  zt('z1', { zoneFeeAtMs: now, deliveryZoneId: 'zc', deliveryZoneName: 'Zona céntrica', priceNum: 35, riderSuggestedFee: 40, serverCommissionAmount: 4.2 }),
  zt('z2', { zoneFeeAtMs: now, deliveryZoneId: 'zc', deliveryZoneName: 'Zona céntrica', priceNum: 35, riderSuggestedFee: 35, serverCommissionAmount: 4.2 }),
  zt('z3', { zoneFeeAtMs: now, deliveryZoneId: 'za', deliveryZoneName: 'Fuera de ciudad', priceNum: 80, riderSuggestedFee: 100, serverCommissionAmount: 9.6 }),
  zt('z4', { zoneFeeAtMs: null, priceNum: 0 }),
  zt('zOld', { zoneFeeAtMs: now, deliveryZoneId: 'zc', deliveryZoneName: 'Zona céntrica', priceNum: 35, createdAt: now - 40 * 24 * h, completedAt: now - 40 * 24 * h }),
  zt('zTgu', { zoneFeeAtMs: now, deliveryZoneId: 'zt', deliveryZoneName: 'Tegucigalpa centro', priceNum: 50, cityId: 'tegucigalpa', serviceZoneId: 'tegucigalpa' }),
  { id: 'n1', storeDelivery: true, merchantDirectDelivery: true, createdByMerchant: true, storeId: 's1', merchantName: 'Baleadas Doña Mary', serviceType: 'delivery', status: 'completed', priceNum: 45, price: 'L. 45.00', paymentMethod: 'efectivo', driverId: 'd1', cityId: 'comayagua', serviceZoneId: 'comayagua', createdAt: now - 2 * h, completedAt: now - 2 * h, deliveryDetails: { merchantDirectDelivery: true }, serverCommissionAmount: 5.4 },
  { id: 'r1', serviceType: 'auto', status: 'completed', priceNum: 100, paymentMethod: 'efectivo', driverId: 'd2', cityId: 'comayagua', serviceZoneId: 'comayagua', createdAt: now - 3 * h, completedAt: now - 3 * h },
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stz-'));
const { srv, url } = await serve(ROOT, { '/__stats.html': `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/tailwind.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"></head><body class="bg-slate-950 text-white p-3" style="font-family:Inter,system-ui,sans-serif"><div id="b"></div><script type="module">import * as S from '/js/stats-engine.js'; window.S = S; window.ready = true;</script></body></html>` });
const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage(); await p.setViewport({ width: 412, height: 900, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => ok('sin errores JS', false, e.message));
  await p.goto(`${url}/__stats.html`); await p.waitForFunction('window.ready', { timeout: 20000 });
  const snap = await p.evaluate((trips, now) => window.snap = S.computeGlobalStatsSnapshot({ trips, commissionConfig: { platformPct: 18, byService: { tiendas: 12 } }, filter: { period: 'month', city: 'comayagua' }, now: new Date(now) }), TRIPS, now);
  const z = snap.zoneDeliveries; const sb = Object.fromEntries(snap.serviceBreakdown.map((s) => [s.key, s]));
  ok('stats zona: respeta período y ciudad (3 entregados con precio, excluye viejo y Tegucigalpa)', z.count === 3 && z.pendingPrice === 1, JSON.stringify(z));
  ok('stats zona: total cobrado y comisión del servidor', z.totalCharged === 150 && z.commission === 18, JSON.stringify(z));
  const zc = z.byZone.find((r) => r.zoneId === 'zc');
  ok('stats zona: por zona cantidad, total, promedio, sugerido, diferencia', zc.count === 2 && zc.totalFee === 70 && zc.avgFee === 35 && zc.avgSuggested === 37.5 && zc.avgDiff === 2.5, JSON.stringify(zc));
  ok('Finanzas: línea propia «Restaurante sin destino» (4 envíos incl. 1 calculando, total, comisión)', sb.tiendas_zona && sb.tiendas_zona.trips === 4 && sb.tiendas_zona.revenue === 150 && sb.tiendas_zona.commission === 18, JSON.stringify(sb.tiendas_zona));
  ok('contado una vez: no entra en «Envíos de Tiendas» ni en «Delivery»', sb.tiendas.trips === 1 && sb.tiendas.revenue === 45 && sb.delivery.trips === 0, JSON.stringify([sb.tiendas.trips, sb.tiendas.revenue, sb.delivery.trips]));
  ok('contado una vez: no duplica en pedidos de tiendas (store_orders sintéticos)', snap.storeMetrics.deliveredOrders === 1 && snap.storeMetrics.deliveryFeesTotal === 45, JSON.stringify([snap.storeMetrics.deliveredOrders, snap.storeMetrics.deliveryFeesTotal]));
  const all = await p.evaluate(() => S.computeGlobalStatsSnapshot({ trips: [], filter: { period: 'month', city: 'all' } }).zoneDeliveries);
  ok('sin envíos por zona: bloque vacío sin errores', all.count === 0);
  await p.evaluate(() => { document.getElementById('b').innerHTML = `<p class="text-[11px] font-black text-emerald-300 uppercase mb-2">Estadísticas · Este mes · Comayagua</p>` + S.zoneDeliveriesStatsHtml(window.snap.zoneDeliveries); });
  ok('Estadísticas: bloque «Envíos de restaurante por zona»', !!(await p.$('[data-stats-zone-deliveries]')));
  await new Promise((r) => setTimeout(r, 1200)); await p.screenshot({ path: path.join(ZS, '5-estadisticas-zona.png') });
  const full = await p.evaluate(() => S.renderGlobalStatsHtml(window.snap));
  ok('panel completo incluye el bloque y la línea de Finanzas', full.includes('data-stats-zone-deliveries') && full.includes('Restaurante sin destino (por zona)'));
  await p.evaluate((html) => { const b = document.getElementById('b'); b.innerHTML = html; const row = [...b.querySelectorAll('tr')].find((r) => r.textContent.includes('Restaurante sin destino')); const tbl = row?.closest('table')?.parentElement?.closest('div'); if (tbl) { tbl.scrollIntoView({ block: 'start' }); row.style.outline = '2px solid #fb923c'; } }, full);
  await new Promise((r) => setTimeout(r, 800)); await p.screenshot({ path: path.join(ZS, '6-finanzas-zona.png') });
} finally { await browser.close(); srv.close(); }
for (const r of res) console.log(r.join(' | '));
const f = res.filter((r) => r[0] === 'FAIL').length; console.log(`\n${res.length - f}/${res.length} PASS`); process.exit(f ? 1 : 0);
