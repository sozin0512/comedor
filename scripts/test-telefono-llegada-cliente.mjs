/**
 * Teléfono del cliente al llegar al local. Fixtures sintéticos.
 *   node scripts/test-telefono-llegada-cliente.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = process.env.ARTIFACTS || '/opt/cursor/artifacts';
const JS = fs.mkdtempSync('/tmp/hr-tel-');
fs.copyFileSync(path.join(ROOT, 'js/store-trip-ui.js'), path.join(JS, 'store-trip-ui.js'));
fs.writeFileSync(path.join(JS, 'package.json'), '{"type":"module"}');
const Store = await import(pathToFileURL(path.join(JS, 'store-trip-ui.js')).href);

const RIDER = 'rider-ejemplo';
const OTHER = 'otro-repartidor';
const PHONE = '99990000';

function trip(extra = {}) {
    return {
        status: 'accepted',
        driverArrived: true,
        driverId: RIDER,
        serviceType: 'delivery',
        storeOrderId: 'pedido-ejemplo',
        storeDelivery: true,
        serviceZoneId: 'comayagua',
        clientPhone: PHONE,
        origin: 'Calle Ejemplo 10',
        destination: 'Colonia Ejemplo',
        priceNum: 40,
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

check('asignado y ya llegó: llamada y WhatsApp del cliente, sin mensaje enviado', () => {
    const info = Store.arrivalCustomerPhone(trip(), RIDER);
    assert.equal(info.visible, true);
    assert.equal(info.state, 'ready');
    assert.equal(info.source, 'clientPhone');
    assert.equal(info.e164, '50499990000');
    assert.equal(info.tel, 'tel:+50499990000');
    assert.equal(info.wa, 'https://wa.me/50499990000');
    assert.equal(info.wa.includes('text='), false);
    const html = Store.storeAcceptedPanelHtml(trip(), 40, { viewerId: RIDER });
    assert.match(html, /data-arrival-customer-phone="ready"/);
    assert.match(html, /data-phone-source="clientPhone"/);
    assert.match(html, /href="tel:\+50499990000"/);
    assert.match(html, /href="https:\/\/wa\.me\/50499990000"/);
    assert.equal((html.match(/hr-moto-primary/g) || []).length, 1);
    assert.match(html, /data-driver-delivery-act="picked-up"/);
    assert.match(html, /href="tel:99991111"|href="tel:99992222"/);
    assert.match(html, /Ya recogí el pedido/);
});

check('sin clientPhone usa recipientPhone y lo etiqueta como quien recibe', () => {
    const t = trip({ clientPhone: '' });
    const info = Store.arrivalCustomerPhone(t, RIDER);
    assert.equal(info.source, 'recipientPhone');
    assert.equal(info.e164, '50499992222');
    const html = Store.arrivalCustomerPhoneHtml(t, RIDER);
    assert.match(html, /Quien recibe/);
    assert.match(html, /50499992222/);
});

check('teléfono ausente o inválido: aviso, sin enlaces', () => {
    for (const raw of ['', '123', '00000000', 'abcdefgh']) {
        const t = trip({ clientPhone: raw, deliveryDetails: { ...trip().deliveryDetails, recipientPhone: '' } });
        const info = Store.arrivalCustomerPhone(t, RIDER);
        assert.equal(info.state, 'unavailable', raw);
        const html = Store.arrivalCustomerPhoneHtml(t, RIDER);
        assert.match(html, /data-arrival-customer-phone="unavailable"/);
        assert.match(html, /no disponible/);
        assert.doesNotMatch(html, /href="tel:/);
        assert.doesNotMatch(html, /wa\.me/);
    }
});

check('10 dígitos sin marca de EE. UU. no se adivinan', () => {
    const t = trip({ clientPhone: '4155551212', serviceZoneId: 'comayagua' });
    const info = Store.arrivalCustomerPhone(t, RIDER);
    assert.equal(info.state, 'unavailable');
    assert.equal(info.reason, 'ambiguous');
});

check('marca US y 10 dígitos sí normaliza a +1', () => {
    const t = trip({ clientPhone: '4155550100', market: 'us', serviceZoneId: 'us-houston' });
    const info = Store.arrivalCustomerPhone(t, RIDER);
    assert.equal(info.state, 'ready');
    assert.equal(info.e164, '14155550100');
    assert.equal(info.wa, 'https://wa.me/14155550100');
});

check('otro repartidor o sin asignar no ve el teléfono de llegada', () => {
    const htmlOther = Store.storeAcceptedPanelHtml(trip(), 40, { viewerId: OTHER });
    const htmlNone = Store.storeAcceptedPanelHtml(trip({ driverId: '' }), 40, { viewerId: RIDER });
    const htmlStaff = Store.storeAcceptedPanelHtml(trip(), 40, { viewerId: 'staff-josue' });
    for (const html of [htmlOther, htmlNone, htmlStaff]) {
        assert.doesNotMatch(html, /data-arrival-customer-phone/);
        assert.doesNotMatch(html, /50499990000/);
    }
});

check('antes de llegar el contacto de detalles sigue y el aviso de llegada no', () => {
    const enCamino = trip({ driverArrived: false });
    const html = Store.storeAcceptedPanelHtml(enCamino, 40, { viewerId: RIDER });
    assert.equal(Store.getDeliveryStageMeta(enCamino).stage, 'to_store');
    assert.doesNotMatch(html, /data-arrival-customer-phone/);
    assert.match(html, /data-driver-delivery-act="arrived-store"/);
    assert.match(html, /href="tel:99992222"/);
    assert.match(html, /wa\.me\/50499992222/);
});

check('la versión publicada es .59 y la ficha staff sigue', () => {
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    assert.equal(version.version, '2026.10.26.59');
    const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    assert.match(app, /storeAcceptedPanelHtml\(data, fee, \{ viewerId: currentUser\?\.uid \|\| '' \}\)/);
    assert.match(app, /const isMine = data\?\.driverId === currentUser\?\.uid/);
    assert.match(app, /Llegó al negocio/);
    assert.match(app, /staff-live-trip-wa/);
});

let shot = '';
try {
    const { serve, loadPuppeteer, CHROME } = await import('./e2e-sonido-pedidos/server.mjs');
    if (!fs.existsSync(CHROME)) throw new Error('sin chrome');
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    const html = Store.storeAcceptedPanelHtml(trip(), 40, { viewerId: RIDER });
    const page = `<!doctype html><html><head><meta charset="utf-8"><style>${Store.STORE_TRIP_CSS}
      body{margin:0;background:#dbeafe;font-family:Inter,system-ui,sans-serif}
      .banner{background:#111827;color:#fff;font:900 12px/1.3 Inter,sans-serif;padding:8px 10px}
      .phone{width:360px;min-height:640px;margin:0 auto;background:linear-gradient(#bfdbfe,#d1fae5);display:flex;flex-direction:column;justify-content:flex-end}
      .sheet{background:#fff;border-radius:18px 18px 0 0;padding:10px 12px 16px;box-shadow:0 -8px 24px rgba(15,23,42,.18)}
      .nav{height:48px;background:#111;color:#fff;display:flex;align-items:center;justify-content:space-around;font-weight:900}
    </style></head><body>
      <p class="banner">EJEMPLO · teléfono sintético · no es un cliente real</p>
      <div class="phone">
        <div style="flex:1;display:flex;align-items:center;justify-content:center;font-weight:900">Mapa de ejemplo</div>
        <div class="sheet">${html}</div>
        <div class="nav">◁ ○ ▷</div>
      </div>
    </body></html>`;
    const { srv, url } = await serve(ROOT, { '/tel.html': page });
    const pp = await loadPuppeteer();
    const browser = await pp.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const tab = await browser.newPage();
    await tab.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    await tab.goto(url + '/tel.html', { waitUntil: 'networkidle0' });
    const fit = await tab.evaluate(() => {
        const btn = document.querySelector('.hr-moto-primary');
        const phone = document.querySelector('[data-arrival-customer-phone="ready"]');
        const nav = document.querySelector('.nav');
        const b = btn.getBoundingClientRect();
        const p = phone.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        return {
            phoneAboveButton: p.bottom <= b.top + 1,
            buttonAboveNav: b.bottom <= n.top + 1,
            phoneVisible: p.height > 30 && p.width > 200,
            buttonVisible: b.height >= 44 && b.width > 200,
        };
    });
    shot = path.join(ARTIFACTS, 'ejemplo-telefono-cliente-al-llegar.png');
    const frame = await tab.$('.phone');
    await (frame || tab).screenshot({ path: shot });
    await browser.close();
    srv.close();
    check('en el teléfono de ejemplo el contacto y el botón caben sin taparse', () => {
        assert.equal(fit.phoneAboveButton, true, JSON.stringify(fit));
        assert.equal(fit.buttonAboveNav, true, JSON.stringify(fit));
        assert.equal(fit.phoneVisible, true);
        assert.equal(fit.buttonVisible, true);
    });
} catch (e) {
    console.warn('CAPTURAS', e && e.message ? e.message : e);
}

let failed = 0;
for (const c of checks) {
    try {
        await c.fn();
        console.log('PASS', c.name);
    } catch (e) {
        failed += 1;
        console.error('FAIL', c.name);
        console.error(e);
    }
}
console.log('ARTIFACT', shot || '(ninguna)');
process.exit(failed ? 1 : 0);
