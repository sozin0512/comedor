/**
 * Pedidos del cliente y faja del repartidor en moto.
 * Fixtures sintéticos. No escribe Firebase ni usa cuentas reales.
 *   node scripts/test-pedidos-seguimiento-moto.mjs
 * Capturas: ARTIFACTS=/opt/cursor/artifacts (si hay Chrome).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = process.env.ARTIFACTS || '/opt/cursor/artifacts';
const JS = fs.mkdtempSync('/tmp/hr-pedidos-');
for (const f of ['client-order-track.js', 'store-trip-ui.js']) {
    fs.copyFileSync(path.join(ROOT, 'js', f), path.join(JS, f));
}
fs.writeFileSync(path.join(JS, 'package.json'), '{"type":"module"}');
const href = (f) => pathToFileURL(path.join(JS, f)).href;
const Track = await import(href('client-order-track.js'));
const Store = await import(href('store-trip-ui.js'));

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const active = {
    id: 'ex-active',
    status: 'pending',
    storeName: 'Restaurante ejemplo',
    items: [{ qty: 2, name: 'Plato ejemplo' }],
    itemsTotal: 80,
    paymentMethod: 'efectivo',
};
const done = {
    id: 'ex-done',
    status: 'delivered',
    storeName: 'Restaurante ejemplo',
    items: [{ qty: 1, name: 'Plato anterior' }],
};
const assigned = {
    id: 'ex-go',
    status: 'out_for_delivery',
    storeName: 'Restaurante ejemplo',
    driverId: 'drv-ejemplo',
    driverName: 'Repartidor Ejemplo',
    driverPhone: '0000-0000',
    tripId: 'viaje-ejemplo',
    items: [{ qty: 1, name: 'Plato ejemplo' }],
};

check('separa en curso e historial', () => {
    const split = Track.splitClientOrders([done, active, { id: 'x', status: 'cancelled' }]);
    assert.deepEqual(split.active.map((o) => o.id), ['ex-active']);
    assert.deepEqual(split.history.map((o) => o.id), ['ex-done', 'x']);
});

check('sin repartidor no inventa mapa ni llegada', () => {
    const m = Track.clientOrderTrackModel(active, null);
    assert.equal(m.assigned, false);
    assert.equal(m.map, null);
    assert.equal(m.etaMin, null);
    assert.equal(m.locationState, 'no_rider');
    const html = Track.clientOrderTrackHtml(active, null);
    assert.match(html, /data-track-rider="no_rider"/);
    assert.match(html, /data-track-map="none"/);
    assert.doesNotMatch(html, /maps\?q=/);
    assert.doesNotMatch(html, /Llegada estimada: \d/);
});

check('repartidor asignado sin gps: contacto solo si hay teléfono, sin mapa', () => {
    const noPhone = Track.clientOrderTrackModel({ ...assigned, driverPhone: '' }, {});
    assert.equal(noPhone.contactState, 'no_phone');
    assert.equal(noPhone.locationState, 'unavailable');
    const html = Track.clientOrderTrackHtml(assigned, null);
    assert.match(html, /data-track-rider="phone"/);
    assert.match(html, /0000-0000/);
    assert.match(html, /data-track-map="unavailable"/);
    assert.match(html, /data-track-eta="unknown"/);
    assert.doesNotMatch(html, /maps\?q=/);
});

check('mapa y llegada solo con números ya presentes', () => {
    const live = { lat: 14.1, lng: -87.2, etaMin: 12, driverPhone: '0000-0000' };
    const m = Track.clientOrderTrackModel(assigned, live);
    assert.equal(m.locationState, 'live');
    assert.equal(m.etaMin, 12);
    const html = Track.clientOrderTrackHtml(assigned, live);
    assert.match(html, /14\.10000, -87\.20000/);
    assert.match(html, /Llegada estimada: 12 min/);
    const bad = Track.clientOrderTrackModel(assigned, { lat: 'cerca', lng: null, etaMin: 'pronto' });
    assert.equal(bad.map, null);
    assert.equal(bad.etaMin, null);
});

check('tablero: en curso abierto e historial cerrado', () => {
    const html = Track.clientOrdersBoardHtml([active, done], { focusId: 'ex-active' });
    assert.match(html, /data-orders-section="active"/);
    assert.match(html, /id="client-orders-history"/);
    assert.doesNotMatch(html, /<details[^>]*open/);
    const activePart = html.split('id="client-orders-history"')[0];
    const historyPart = html.split('id="client-orders-history"')[1];
    assert.match(activePart, /ex-active/);
    assert.doesNotMatch(activePart, /ex-done/);
    assert.match(historyPart, /ex-done/);
    assert.match(html, /Paso 1 de 5 · Recibido/);
});

check('inicio enlaza el pedido en curso', () => {
    const html = Track.clientHomeOrderAccessHtml(active);
    assert.match(html, /data-client-order-home="1"/);
    assert.match(html, /data-order-id="ex-active"/);
    assert.match(html, /Ver seguimiento/);
    assert.equal(Track.clientHomeOrderAccessHtml(done), '');
});

function exampleTrip(stage, pay = {}) {
    const status = stage === 'to_customer' ? 'in_progress' : 'accepted';
    return {
        status,
        driverArrived: stage === 'at_store',
        serviceType: 'delivery',
        storeOrderId: 'pedido-ejemplo',
        storeDelivery: true,
        origin: 'Calle Ejemplo 10',
        destination: 'Colonia Ejemplo',
        priceNum: 40,
        deliveryZoneName: 'Zona ejemplo',
        deliveryDetails: {
            storeName: 'Restaurante ejemplo',
            storePhone: '00000000',
            storeOrderId: 'pedido-ejemplo',
            recipientName: 'Cliente ejemplo',
            recipientPhone: '00000000',
            itemsTotal: 80,
            items: [{ name: 'Plato ejemplo', qty: 2, price: 40 }],
            productsPaid: false,
            productsPaymentMethod: 'efectivo',
            deliveryNotes: 'Referencia ejemplo',
            ...pay,
        },
    };
}

check('una acción por etapa y el cobro no cambia', () => {
    for (const stage of ['to_store', 'at_store', 'to_customer']) {
        const html = Store.storeAcceptedPanelHtml(exampleTrip(stage), 40);
        const primaries = html.match(/hr-moto-primary/g) || [];
        assert.equal(primaries.length, 1, stage);
        assert.match(html, /Detalles, chat y cobro/);
    }
    const cash = exampleTrip('to_store');
    const summary = Store.storeOrderSummary(cash, 40);
    assert.equal(summary.cashToCollect, 120);
    assert.equal(summary.itemsTotal, 80);
    const paid = Store.storeOrderSummary(exampleTrip('to_store', { productsPaid: true, productsPaymentMethod: 'saldo' }), 40);
    assert.equal(paid.cashToCollect, 40);
    assert.equal(paid.productsPaid, true);
    const saldoOnly = Store.storeOrderSummary(exampleTrip('to_store', { productsPaid: false, productsPaymentMethod: 'saldo' }), 40);
    assert.equal(saldoOnly.cashToCollect, 40);
    assert.equal(saldoOnly.productsPaid, true);
});

check('ya pagado solo con verificación; si no, no confirmado', () => {
    const cashHtml = Store.storeCollectHtml(exampleTrip('to_store'), 40);
    assert.match(cashHtml, /data-pay-role="restaurant"/);
    assert.match(cashHtml, /data-pay-role="customer"/);
    assert.match(cashHtml, /data-pay-role="rider"/);
    assert.match(cashHtml, /Pagar al restaurante/);
    assert.match(cashHtml, /Total a cobrar/);
    assert.match(cashHtml, /L\. 120\.00/);
    assert.match(cashHtml, /Le pasas L\. 80\.00/);
    assert.match(cashHtml, /menos la comisión/);
    const verified = Store.storeCollectHtml(exampleTrip('to_customer', { productsPaid: true, productsPaymentMethod: 'saldo' }), 40);
    assert.match(verified, /Ya pagado · no pagues/);
    assert.match(verified, /data-pay-verified="paid"/);
    const unknown = Store.storeCollectHtml(exampleTrip('to_store', { productsPaid: false, productsPaymentMethod: 'saldo' }), 40);
    assert.match(unknown, /data-pay-verified="unknown"/);
    assert.match(unknown, /No confirmado/);
    assert.doesNotMatch(unknown, /Ya pagado/);
    assert.doesNotMatch(unknown, /no pagues/);
    const missing = exampleTrip('to_store');
    delete missing.deliveryDetails.itemsTotal;
    const missingHtml = Store.storeCollectHtml(missing, 40);
    assert.match(missingHtml, /data-pay-verified="unknown"/);
    assert.match(missingHtml, /no confirmado/i);
});

check('la ficha staff de Josué sigue en la app y no se tocó la versión', () => {
    const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    assert.match(app, /Llegó al negocio/);
    assert.match(app, /Ya recogió el pedido/);
    assert.match(app, /isStaffUser\(currentUser, window\.userProfile\) && trip\.driverId/);
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    assert.equal(version.version, '2026.10.26.59');
    assert.match(fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8'), /openClientOrdersTracking/);
    assert.match(fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8'), /clientTrackOrderId = placedRef\.id/);
});

check('los ejemplos no repiten datos de las capturas privadas', () => {
    const blob = JSON.stringify([active, assigned, done]);
    assert.doesNotMatch(blob, /Baleadas mina|Loarque|Fuerza aerea|Tegucigalpa/i);
});

let shots = [];
try {
    const { serve, loadPuppeteer, CHROME } = await import('./e2e-sonido-pedidos/server.mjs');
    if (!fs.existsSync(CHROME)) throw new Error('sin chrome');
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    const board = Track.clientOrdersBoardHtml([active, done], { focusId: 'ex-active' });
    const noRider = Track.clientOrdersBoardHtml([active], { focusId: 'ex-active' });
    const withRider = Track.clientOrdersBoardHtml([assigned], {
        focusId: 'ex-go',
        liveFor: () => ({ lat: 14.1, lng: -87.2, etaMin: 12 }),
    });
    const noGps = Track.clientOrdersBoardHtml([{ ...assigned, driverPhone: '' }], { focusId: 'ex-go' });
    const stages = ['to_store', 'at_store', 'to_customer'].map((stage) => {
        const html = Store.storeAcceptedPanelHtml(exampleTrip(stage), 40);
        return `<section class="stage"><p class="tag">EJEMPLO · etapa ${stage}</p>${html}</section>`;
    }).join('');
    const pays = [
        ['efectivo', {}],
        ['ya pagado verificado', { productsPaid: true, productsPaymentMethod: 'saldo' }],
        ['pago no confirmado', { productsPaid: false, productsPaymentMethod: 'saldo' }],
    ].map(([label, pay]) => `<section class="stage"><p class="tag">EJEMPLO · ${label}</p>${Store.storeCollectHtml(exampleTrip('to_store', pay), 40)}</section>`).join('');
    const sheet = Store.storeAcceptedPanelHtml(exampleTrip('to_store'), 40);
    const safePage = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><style>${Store.STORE_TRIP_CSS}
      body{margin:0}
      #map-container{position:absolute;inset:0;background:linear-gradient(#bfdbfe,#d1fae5);display:flex;align-items:center;justify-content:center;font-weight:900}
      #fake-nav{position:fixed;left:0;right:0;bottom:0;height:48px;background:#111;color:#fff;z-index:99999;display:flex;align-items:center;justify-content:space-around;font-weight:900}
      .ejemplo-banner{position:fixed;top:0;left:0;right:0;z-index:100000;background:#111827;color:#fff;font:900 12px/1.3 Inter,sans-serif;padding:6px 8px}
    </style></head>
    <body class="trip-active driver-mode driver-moto-compact capacitor-android android-3btn" style="--android-nav-inset:48px;--safe-bottom:0px">
      <p class="ejemplo-banner">EJEMPLO · Android 3 botones · datos sintéticos</p>
      <div id="map-container">Mapa de ejemplo</div>
      <div id="control-panel">
        <div id="panel-content">
          <div id="active-trip-panel">
            <button type="button" id="driver-panel-min-btn" class="trip-drag-handle trip-sheet-min-bar"><span class="driver-panel-min-hint">Minimizar</span></button>
            <div id="driver-active-veh-badge"><div class="hr-veh-badge" style="background:#7c3aed;color:#fff;border-radius:12px;text-align:center;font-weight:900;padding:6px 8px">TIENDA · en MOTO · ejemplo</div></div>
            <div id="driver-active-body"><div class="driver-uber-sheet">
              <div id="driver-panel-nav" class="driver-panel-nav"><p class="driver-panel-nav-text">Sigue la ruta de ejemplo</p><div class="driver-panel-nav-eta-row"><span class="driver-panel-nav-eta-time">8 min</span><span class="driver-panel-nav-eta-meta">1.2 km</span></div></div>
              <div id="driver-active-cta">${sheet}</div>
            </div></div>
          </div>
        </div>
      </div>
      <div id="fake-nav">◁ ○ ▷</div>
    </body></html>`;
    const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/app.css">
<style>${Store.STORE_TRIP_CSS}
  body{margin:0;background:#e2e8f0;font-family:Inter,system-ui,sans-serif}
  .banner{background:#111827;color:#f8fafc;font-weight:900;font-size:12px;padding:8px 10px}
  .phone{width:360px;background:#fff;min-height:640px;margin:0 auto;padding:10px 12px 16px;box-sizing:border-box}
  .stage{margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid #e2e8f0}
  .tag{margin:0 0 6px;font-size:11px;font-weight:900;color:#7c3aed}
  .map{height:280px;background:linear-gradient(#bfdbfe,#d1fae5);display:flex;align-items:flex-end;justify-content:center;font-weight:900;color:#0f172a}
  #control-panel{position:relative}
  .fake-nav{height:48px;background:#111;color:#fff;display:flex;align-items:center;justify-content:space-around;font-weight:900}
</style></head><body>
<section id="shot-orders"><p class="banner">EJEMPLO · datos sintéticos · no es un pedido real</p><div class="phone">${board}</div></section>
<section id="shot-norider"><p class="banner">EJEMPLO · sin repartidor</p><div class="phone">${noRider}</div></section>
<section id="shot-assigned"><p class="banner">EJEMPLO · repartidor con ubicación de prueba</p><div class="phone">${withRider}</div></section>
<section id="shot-nogps"><p class="banner">EJEMPLO · repartidor sin teléfono ni ubicación</p><div class="phone">${noGps}</div></section>
<section id="shot-stages"><p class="banner">EJEMPLO · etapas del repartidor</p><div class="phone">${stages}</div></section>
<section id="shot-pay"><p class="banner">EJEMPLO · pagar restaurante, cobrar cliente, envío del repartidor</p><div class="phone">${pays}</div></section>
<section id="shot-home"><p class="banner">EJEMPLO · acceso desde inicio</p><div class="phone">${Track.clientHomeOrderAccessHtml(active)}</div></section>
</body></html>`;
    const { srv, url } = await serve(ROOT, { '/preview-pedidos.html': page, '/preview-safe.html': safePage });
    const pp = await loadPuppeteer();
    const browser = await pp.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const tab = await browser.newPage();
    await tab.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    await tab.goto(url + '/preview-pedidos.html', { waitUntil: 'networkidle0' });
    const shot = async (id, file) => {
        const el = await tab.$(id);
        const dest = path.join(ARTIFACTS, file);
        await el.screenshot({ path: dest });
        shots.push(dest);
    };
    await shot('#shot-orders', 'ejemplo-pedidos-en-curso-historial.png');
    await shot('#shot-norider', 'ejemplo-pedido-sin-repartidor.png');
    await shot('#shot-assigned', 'ejemplo-pedido-con-repartidor.png');
    await shot('#shot-nogps', 'ejemplo-pedido-sin-ubicacion.png');
    await shot('#shot-stages', 'ejemplo-moto-etapas.png');
    await shot('#shot-pay', 'ejemplo-pago-restaurante-cliente-repartidor.png');
    await shot('#shot-home', 'ejemplo-inicio-pedido.png');
    await tab.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await tab.goto(url + '/preview-safe.html', { waitUntil: 'networkidle0' });
    const fit = await tab.evaluate(() => {
        const btn = document.querySelector('.hr-moto-primary');
        const nav = document.getElementById('fake-nav');
        const b = btn.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        return {
            buttonAboveNav: b.bottom <= n.top + 1,
            buttonVisible: b.height >= 44 && b.width > 200 && b.top > 80,
            top: Math.round(b.top),
            bottom: Math.round(b.bottom),
            navTop: Math.round(n.top),
        };
    });
    await tab.screenshot({ path: path.join(ARTIFACTS, 'ejemplo-moto-android-safe-area.png') });
    shots.push(path.join(ARTIFACTS, 'ejemplo-moto-android-safe-area.png'));
    check('el botón de la etapa queda sobre la barra de 3 botones', () => {
        assert.equal(fit.buttonAboveNav, true, JSON.stringify(fit));
        assert.equal(fit.buttonVisible, true, JSON.stringify(fit));
    });
    await tab.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, isMobile: true });
    await tab.screenshot({ path: path.join(ARTIFACTS, 'ejemplo-moto-pantalla-chica.png') });
    shots.push(path.join(ARTIFACTS, 'ejemplo-moto-pantalla-chica.png'));
    await tab.setViewport({ width: 740, height: 360, deviceScaleFactor: 2, isMobile: true });
    await tab.goto(url + '/preview-pedidos.html', { waitUntil: 'networkidle0' });
    await shot('#shot-stages', 'ejemplo-moto-horizontal.png');
    await browser.close();
    srv.close();
} catch (e) {
    console.warn('CAPTURAS', e && e.message ? e.message : e);
}

for (const c of checks) {
    try {
        await c.fn();
        console.log('PASS', c.name);
    } catch (e) {
        console.error('FAIL', c.name);
        console.error(e);
        process.exitCode = 1;
    }
}
console.log('ARTIFACTS', shots.join('\n') || '(ninguna)');
if (process.exitCode) process.exit(process.exitCode);
