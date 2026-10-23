/**
 * Lo que ve el conductor de la comisión HonduRaite (js/trip-commission-view.js) — headless.
 *   node scripts/test-comision-visible.mjs     (MOCKUPS=<dir> guarda comision-*.png a 384px)
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { serve, loadPuppeteer, CHROME } from './e2e-sonido-pedidos/server.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.MOCKUPS || '';
const page = `<!doctype html><meta charset="utf-8"><meta name=viewport content="width=384">
<link rel=stylesheet href="/css/tailwind.css"><link rel=stylesheet href="/css/app.css">
<style>body{font-family:Inter,sans-serif;background:#eef2f7;padding:12px;width:384px;box-sizing:border-box;margin:0}#out>*{margin-bottom:8px}.toast{background:#0f172a;color:#fff;border-radius:14px;padding:10px 12px;font:700 12.5px Inter,sans-serif}.driver-earnings-float{position:static!important;width:auto!important}.hist{background:#1f2937;color:#fff;border-radius:16px;padding:14px;border:1px solid #374151}</style>
<div id=out></div>
<script type=module>
import * as V from '/js/trip-commission-view.js';
import { storeAcceptedPanelHtml, STORE_TRIP_CSS } from '/js/store-trip-ui.js';
const s = document.createElement('style'); s.textContent = STORE_TRIP_CSS + V.TRIP_COMMISSION_CSS; document.head.appendChild(s);
window.V = V; window.storeAcceptedPanelHtml = storeAcceptedPanelHtml; window.ready = 1;
</script>`;
const direct = { id: 't1', status: 'accepted', serviceType: 'delivery', storeDelivery: true, createdByMerchant: true, merchantDirectDelivery: true, origin: 'Baleadas Doña Mary', destination: 'Col. Centro', price: 'L. 35.00', priceNum: 35, customerPaysDelivery: true,
  deliveryDetails: { storeName: 'Baleadas Doña Mary', collectAmount: 250, itemsTotal: 250, productsPaid: false, productsPaymentMethod: 'efectivo', customerPaysDelivery: true, customerTotal: 285 } };
const srvFields = { serverCommissionAtMs: 1, serverCommissionAmount: 8.75, serverCommissionPercent: 25, serverCommissionBase: 35, serverDriverNet: 26.25, serverCommissionWaived: null };
const R = []; const ok = (n, c, x = '') => R.push([c ? 'PASS' : 'FAIL', n, x]);
const { srv, url } = await serve(ROOT, { '/c.html': page });
const pp = await loadPuppeteer(); const b = await pp.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 384, height: 760, deviceScaleFactor: 2 });
await p.goto(url + '/c.html'); await p.waitForFunction('window.ready');
const ev = (fn, ...a) => p.evaluate(fn, ...a);
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const sInfo = await ev((t) => V.tripCommissionInfo(t, { base: 35 }), { ...direct, ...srvFields });
ok('servidor: usa los campos server* (no recalcula)', sInfo.server && sInfo.amount === 8.75 && sInfo.net === 26.25 && sInfo.pct === 25);
const line = await ev((t, i) => V.commissionLineText(t, i), direct, sInfo);
ok('línea exacta del envío', line === 'Envío L. 35.00 · Comisión HonduRaite L. 8.75 (25%) · Te quedas L. 26.25', line);
const tampered = await ev((t) => V.tripCommissionInfo(t, { base: 35, previewPct: 25 }), { ...direct, ...srvFields, commissionAmount: 0, commissionPercent: 0 });
ok('si la app guardó otra cosa, manda el servidor', tampered.amount === 8.75);
const prev = await ev((t) => V.tripCommissionInfo(t, { base: 35, previewPct: 25 }), direct);
ok('en curso: vista previa con el % del admin', !prev.server && prev.amount === 8.75 && prev.net === 26.25);
const box = await ev((t, i) => V.commissionBreakdownHtml(t, i), direct, prev);
ok('vista previa marcada «estimado»', /estimado/.test(box));
ok('productos aparte: «Productos para la tienda L. 250.00»', txt(box).includes('Productos para la tienda L. 250.00'));
const boxS = await ev((t, i) => V.commissionBreakdownHtml(t, i), { ...direct, ...srvFields }, sInfo);
ok('oficial: sin «estimado»', !/estimado/.test(boxS) && txt(boxS).includes('Te quedas L. 26.25'));
const moto = { serviceType: 'moto', priceNum: 60, paymentMethod: 'efectivo' };
const mInfo = await ev((t) => V.tripCommissionInfo(t, { base: 60, previewPct: 15 }), moto);
const mLine = await ev((t, i) => V.commissionLineText(t, i), moto, mInfo);
ok('todos los servicios: moto «Viaje L. 60.00 · Comisión HonduRaite L. 9.00 (15%) · Te quedas L. 51.00»', mLine === 'Viaje L. 60.00 · Comisión HonduRaite L. 9.00 (15%) · Te quedas L. 51.00', mLine);
ok('moto: sin línea de productos', !/Productos para la tienda/.test(await ev((t, i) => V.commissionBreakdownHtml(t, i), moto, mInfo)));
const fd = await ev((t) => V.tripCommissionInfo(t, { base: 35 }), { ...direct, serverCommissionAtMs: 1, serverCommissionAmount: 0, serverCommissionPercent: 0, serverCommissionBase: 35, serverDriverNet: 35, serverCommissionWaived: 'free_day' });
const fdLine = await ev((t, i) => V.commissionLineText(t, i), direct, fd);
ok('día sin comisión: L. 0.00 (día sin comisión) · te quedas todo', fdLine === 'Envío L. 35.00 · Comisión HonduRaite L. 0.00 (día sin comisión) · Te quedas L. 35.00', fdLine);
const bd = await ev((t, i) => V.commissionLineText(t, i), direct, { base: 35, pct: 0, amount: 0, net: 35, server: false, waived: 'driver_birthday' });
ok('cumpleaños del conductor', bd.includes('(tu cumpleaños)'));
const paidPts = { ...direct, merchantDirectDelivery: false, storeOrderId: 'O1', deliveryDetails: { ...direct.deliveryDetails, productsPaid: true } };
ok('productos ya pagados con puntos → no hay efectivo para la tienda', (await ev((t) => V.productsCashForStore(t), paidPts)) === 0);
const pend = await ev((t, i) => V.commissionLineText(t, i), moto, { base: 60, pct: null, amount: null, net: null });
ok('sin % del admin: «pendiente», no inventa', pend.includes('pendiente'));
const panel = await ev((t) => storeAcceptedPanelHtml(t), direct);
ok('tarjeta de tienda ya no dice «te quedas L. 35» (eso era antes de la comisión)', !/te quedas L\. 35/.test(txt(panel)) && /menos la comisión/.test(txt(panel)));

if (OUT) {
  // 1) Viaje en curso + al finalizar
  await ev((t, i, l) => {
    document.getElementById('out').innerHTML = storeAcceptedPanelHtml(t) + V.commissionBreakdownHtml(t, i)
      + `<div class="toast">Viaje finalizado. ${l}</div>`;
  }, direct, prev, line);
  await p.screenshot({ path: path.join(OUT, 'comision-1-al-finalizar.png'), fullPage: true });
  // 2) Ganancias de hoy (mismo marcado que renderDriverEarningsToday) con 2 envíos ya verificados por el servidor
  const L = (n) => 'L. ' + n.toFixed(2);
  const gross = 35 + 45, comm = 8.75 + 11.25, net = gross - comm;
  await ev((h) => { document.getElementById('out').innerHTML = h; }, `<div class="driver-earnings-float"><div class="driver-earnings-float-head"><p class="driver-earnings-float-title"><i class="fas fa-coins"></i> Ganancias de hoy</p></div><div class="driver-earnings-float-body">
    <div class="flex items-center justify-end gap-2 mb-2"><button class="driver-earnings-link">Pagos</button><button class="driver-earnings-link driver-earnings-link--blue">Depósito</button></div>
    <div class="driver-earnings-total text-center mb-2"><p class="driver-earnings-total-label">Total ganado hoy</p><p class="driver-earnings-total-value">${L(net)}</p>
    <p class="driver-earnings-total-meta" data-earnings-gross>Cobrado ${L(gross)} − comisión HonduRaite ${L(comm)}</p><p class="driver-earnings-total-meta">2 viajes · saldo: L. 0.00</p></div>
    <div class="driver-earnings-split"><div><p class="driver-earnings-stat-label">Efectivo</p><p class="driver-earnings-stat-value driver-earnings-stat-value--blue">${L(gross)}</p></div><div><p class="driver-earnings-stat-label">Saldo recibido</p><p class="driver-earnings-stat-value driver-earnings-stat-value--violet">L. 0.00</p></div></div>
    <div class="driver-earnings-commission"><div><p class="driver-earnings-comm-label">Com. efectivo</p><p class="driver-earnings-comm-value">${L(comm)}</p></div><div><p class="driver-earnings-comm-label">Cubierta</p><p class="driver-earnings-comm-value driver-earnings-comm-value--ok">L. 0.00</p></div><div><p class="driver-earnings-comm-label">Hoy a dep.</p><p class="driver-earnings-comm-value">${L(comm)}</p></div><div><p class="driver-earnings-comm-label driver-earnings-comm-label--debt">Deuda</p><p class="driver-earnings-comm-value driver-earnings-comm-value--debt">L. 0.00</p></div></div>
    <p class="driver-earnings-owed">TOTAL A DEPOSITAR: ${L(comm)}</p></div></div>`);
  ok('ganancias: neto + comisión = cobrado, y «Hoy a dep.» = la comisión', Math.abs(net + comm - gross) < 0.001);
  await p.screenshot({ path: path.join(OUT, 'comision-2-ganancias-hoy.png'), fullPage: true });
  // 3) Historial (fila del conductor)
  const h1 = await ev((t, i) => V.commissionBreakdownHtml(t, i, { compact: true }), { ...direct, ...srvFields }, sInfo);
  const t2 = { ...direct, priceNum: 45, deliveryDetails: { ...direct.deliveryDetails, collectAmount: 0, itemsTotal: 0 } };
  const h2 = await ev((t) => V.commissionBreakdownHtml(t, V.tripCommissionInfo(t, { base: 45 }), { compact: true }), { ...t2, serverCommissionAtMs: 1, serverCommissionAmount: 11.25, serverCommissionPercent: 25, serverCommissionBase: 45, serverDriverNet: 33.75 });
  await ev((a, b2) => {
    const row = (d, x, h) => `<div class="hist"><div style="font-weight:900">Baleadas Doña Mary → ${d}</div><div style="font-size:12px;color:#9ca3af">23/10/2026 · ${x} · Envío</div>${h}</div>`;
    document.getElementById('out').innerHTML = '<p style="font:900 16px Inter;margin:0 0 8px">Historial de viajes</p>' + row('Col. Centro', 'L. 35.00', a) + row('Barrio La Merced', 'L. 45.00', b2);
  }, h1, h2);
  ok('historial: línea por viaje', txt(h1).includes('Comisión HonduRaite L. 8.75 (25%)') && txt(h1).includes('Productos para la tienda L. 250.00'));
  await p.screenshot({ path: path.join(OUT, 'comision-3-historial.png'), fullPage: true });
}
await b.close(); srv.close();
for (const x of R) console.log(x[0], x[1], x[0] === 'FAIL' ? x[2] : '');
const pass = R.filter((x) => x[0] === 'PASS').length; console.log(`${pass}/${R.length} PASS`);
process.exit(pass === R.length ? 0 : 1);
