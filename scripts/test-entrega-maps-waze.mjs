/**
 * Un solo botón al entregar un pedido de tienda, y enlaces a Maps/Waze
 * con coordenadas ya guardadas. Fixtures sintéticos. No publica.
 *   node scripts/test-entrega-maps-waze.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = process.env.ARTIFACTS || '/opt/cursor/artifacts';
const JS = fs.mkdtempSync('/tmp/hr-maps-');
fs.copyFileSync(path.join(ROOT, 'js/store-trip-ui.js'), path.join(JS, 'store-trip-ui.js'));
fs.writeFileSync(path.join(JS, 'package.json'), '{"type":"module"}');
const Store = await import(pathToFileURL(path.join(JS, 'store-trip-ui.js')).href);

const RIDER = 'rider-ejemplo';
const OTHER = 'otro-repartidor';
const BIZ = { lat: 14.1, lng: -87.2 };
const CUS = { lat: 14.11, lng: -87.21 };

function trip(stage, extra = {}) {
    const status = stage === 'to_customer' ? 'in_progress' : 'accepted';
    return {
        status,
        driverArrived: stage !== 'to_store',
        driverId: RIDER,
        serviceType: 'delivery',
        storeOrderId: 'pedido-ejemplo',
        storeDelivery: true,
        serviceZoneId: 'comayagua',
        origin: 'Calle Ejemplo 10',
        destination: 'Colonia Ejemplo',
        originLat: BIZ.lat,
        originLng: BIZ.lng,
        destinationLat: CUS.lat,
        destinationLng: CUS.lng,
        priceNum: 40,
        clientPhone: '99990000',
        deliveryDetails: {
            storeName: 'Restaurante ejemplo',
            storePhone: '99991111',
            recipientName: 'Cliente ejemplo',
            recipientPhone: '99992222',
            itemsTotal: 80,
            items: [{ name: 'Plato ejemplo', qty: 1, price: 80 }],
            productsPaid: false,
            productsPaymentMethod: 'efectivo',
        },
        ...extra,
    };
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

function primaries(html) {
    return html.match(/hr-moto-primary/g) || [];
}

check('al entregar hay un solo botón principal: Pedido entregado', () => {
    const html = Store.storeAcceptedPanelHtml(trip('to_customer'), 40, { viewerId: RIDER });
    assert.equal(primaries(html).length, 1);
    assert.match(html, /data-driver-delivery-act="delivered"/);
    assert.match(html, /Pedido entregado · Finalizar envío/);
    assert.doesNotMatch(html, /Llegué al destino/);
    assert.doesNotMatch(html, /¡He llegado!/);
});

check('las otras etapas conservan su único botón', () => {
    const toStore = Store.storeAcceptedPanelHtml(trip('to_store'), 40, { viewerId: RIDER });
    const atStore = Store.storeAcceptedPanelHtml(trip('at_store'), 40, { viewerId: RIDER });
    assert.equal(primaries(toStore).length, 1);
    assert.match(toStore, /data-driver-delivery-act="arrived-store"/);
    assert.match(toStore, /Llegué al negocio/);
    assert.equal(primaries(atStore).length, 1);
    assert.match(atStore, /data-driver-delivery-act="picked-up"/);
    assert.match(atStore, /Ya recogí el pedido/);
});

check('Maps y Waze solo con coordenadas reales y sin navegación automática', () => {
    const html = Store.deliveryExternalMapsHtml(trip('to_customer'), RIDER);
    assert.match(html, /data-map-place="business"[^>]*data-map-state="ready"/);
    assert.match(html, /data-map-place="customer"[^>]*data-map-state="ready"/);
    assert.match(html, /google\.com\/maps\/search\/\?api=1&amp;query=14\.1%2C-87\.2/);
    assert.match(html, /google\.com\/maps\/search\/\?api=1&amp;query=14\.11%2C-87\.21/);
    assert.match(html, /waze\.com\/ul\?ll=14\.1%2C-87\.2&amp;navigate=no/);
    assert.match(html, /waze\.com\/ul\?ll=14\.11%2C-87\.21&amp;navigate=no/);
    assert.doesNotMatch(html, /navigate=yes/);
    assert.doesNotMatch(html, /[?&]text=/);
});

check('coordenada ausente o inválida: aviso y sin enlace', () => {
    const missing = trip('to_customer', { destinationLat: null, destinationLng: null });
    const html = Store.deliveryExternalMapsHtml(missing, RIDER);
    assert.match(html, /data-map-place="customer"[^>]*data-map-state="unavailable"/);
    assert.match(html, /Ubicación del cliente no disponible/);
    assert.match(html, /data-map-place="business"[^>]*data-map-state="ready"/);
    const customerChunk = html.split('data-map-place="customer"')[1];
    assert.doesNotMatch(customerChunk, /maps\/search|waze\.com/);
    for (const bad of [{ destinationLat: 999, destinationLng: 10 }, { destinationLat: 0, destinationLng: 0 }, { destinationLat: 'cerca', destinationLng: -87.2 }]) {
        const h = Store.deliveryExternalMapsHtml(trip('to_customer', bad), RIDER);
        assert.match(h, /data-map-place="customer"[^>]*data-map-state="unavailable"/, JSON.stringify(bad));
    }
});

check('otro repartidor o sin asignar no ve Maps ni Waze', () => {
    for (const html of [
        Store.storeAcceptedPanelHtml(trip('to_customer'), 40, { viewerId: OTHER }),
        Store.storeAcceptedPanelHtml(trip('to_customer', { driverId: '' }), 40, { viewerId: RIDER }),
        Store.storeAcceptedPanelHtml(trip('to_customer'), 40, { viewerId: 'staff-josue' }),
        Store.deliveryExternalMapsHtml(trip('to_customer'), OTHER),
    ]) {
        assert.doesNotMatch(html, /data-delivery-map-links|google\.com\/maps|waze\.com/);
        assert.doesNotMatch(html, /14\.1|14\.11/);
    }
});

check('el cobro y la ficha staff no cambian; la versión no se toca', () => {
    const cash = Store.storeCollectHtml(trip('to_customer'), 40);
    assert.match(cash, /Total a cobrar/);
    assert.match(cash, /L\. 120\.00/);
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    assert.equal(version.version, '2026.10.26.99');
    const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    assert.match(app, /Llegó al negocio/);
    assert.match(app, /✅ Pedido entregado/);
    assert.match(app, /storeAcceptedPanelHtml\(data, fee, \{ viewerId: currentUser\?\.uid \|\| '' \}\)/);
    const css = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
    assert.match(css, /driver-moto-compact\.driver-trip-dest-phase:not\(\.panel-minimized\) #driver-panel-arrived-dest-btn/);
    assert.match(css, /#driver-arrived-dest-float/);
});

let shot = '';
try {
    const { serve, loadPuppeteer, CHROME } = await import('./e2e-sonido-pedidos/server.mjs');
    if (!fs.existsSync(CHROME)) throw new Error('sin chrome');
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    const panel = Store.storeAcceptedPanelHtml(trip('to_customer'), 40, { viewerId: RIDER });
    const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/app.css"><style>${Store.STORE_TRIP_CSS}
body{margin:0}
.ejemplo-banner{position:fixed;top:0;left:0;right:0;z-index:100000;background:#111827;color:#fff;font:900 12px/1.3 Inter,sans-serif;padding:6px 8px}
#map-container{position:absolute;inset:0;background:linear-gradient(#bfdbfe,#d1fae5);display:flex;align-items:center;justify-content:center;font-weight:900}
#fake-nav{position:fixed;left:0;right:0;bottom:0;height:48px;background:#111;color:#fff;z-index:99999;display:flex;align-items:center;justify-content:space-around;font-weight:900}
</style></head>
<body class="trip-active driver-mode driver-moto-compact driver-trip-dest-phase capacitor-android android-3btn" style="--android-nav-inset:48px;--safe-bottom:0px">
<p class="ejemplo-banner">EJEMPLO · entrega de tienda · datos sintéticos</p>
<div id="map-container">Mapa de ejemplo</div>
<div id="control-panel">
  <div id="panel-content"><div id="active-trip-panel">
    <button type="button" id="driver-panel-min-btn" class="trip-drag-handle trip-sheet-min-bar"><span class="driver-panel-min-hint">Minimizar</span></button>
    <div id="driver-active-body"><div class="driver-uber-sheet"><div id="driver-active-cta">
      <button type="button" id="driver-panel-arrived-dest-btn" class="driver-panel-arrived-dest-btn">Llegué al destino</button>
      <div id="driver-store-order-panel">${panel}</div>
    </div></div></div>
  </div></div>
</div>
<div id="fake-nav">◁ ○ ▷</div>
<div id="driver-arrived-dest-float"><span>LLEGUÉ AL DESTINO</span></div>
</body></html>`;
    const { srv, url } = await serve(ROOT, { '/entrega.html': page });
    const pp = await loadPuppeteer();
    const browser = await pp.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const tab = await browser.newPage();
    await tab.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true });
    await tab.goto(url + '/entrega.html', { waitUntil: 'networkidle0' });
    const fit = await tab.evaluate(() => {
        const primary = document.querySelector('.hr-moto-primary');
        const dup = document.getElementById('driver-panel-arrived-dest-btn');
        const float = document.getElementById('driver-arrived-dest-float');
        const nav = document.getElementById('fake-nav');
        const maps = document.querySelector('[data-delivery-map-links]');
        const shown = (el) => {
            if (!el) return false;
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0 && r.width > 0;
        };
        const b = primary.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        const m = maps.getBoundingClientRect();
        return {
            onePrimary: document.querySelectorAll('.hr-moto-primary').length === 1,
            dupHidden: !shown(dup),
            floatHidden: !shown(float),
            mapsAboveButton: m.bottom <= b.top + 1,
            buttonAboveNav: b.bottom <= n.top + 1,
            buttonVisible: b.height >= 40 && b.width > 180,
        };
    });
    shot = path.join(ARTIFACTS, 'ejemplo-entrega-maps-waze.png');
    await tab.screenshot({ path: shot });
    await browser.close();
    srv.close();
    check('en la faja de ejemplo solo se ve Pedido entregado, encima de la barra', () => {
        assert.equal(fit.onePrimary, true, JSON.stringify(fit));
        assert.equal(fit.dupHidden, true, JSON.stringify(fit));
        assert.equal(fit.floatHidden, true, JSON.stringify(fit));
        assert.equal(fit.mapsAboveButton, true, JSON.stringify(fit));
        assert.equal(fit.buttonAboveNav, true, JSON.stringify(fit));
        assert.equal(fit.buttonVisible, true, JSON.stringify(fit));
    });
} catch (e) {
    console.warn('CAPTURAS', e && e.message ? e.message : e);
}

let failed = 0;
for (const c of checks) {
    try { await c.fn(); console.log('PASS', c.name); }
    catch (e) { failed += 1; console.error('FAIL', c.name); console.error(e); }
}
console.log('ARTIFACT', shot || '(ninguna)');
process.exit(failed ? 1 : 0);
