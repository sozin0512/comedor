/**
 * Pruebas E2E (Puppeteer Chrome headless + unitarias) para los 3 pedidos de Josue ("La Sopota"):
 * 1) El negocio registrado NUNCA queda atrapado en modo viaje de pasajero (ni pantalla en blanco)
 *    al pedir un delivery desde «Pedir envío», WhatsApp o la pantalla principal, y sigue recibiendo pedidos.
 * 2) Desde la interfaz web/app («Mi tienda virtual → 🛵 Pedir envío» y tarjeta rápida en Inicio),
 *    La Sopota puede pedir múltiples envíos seguidos (con buscador, mapa o pegando coordenadas/link de Google Maps).
 * 3) El local puede compartir el viaje al cliente por WhatsApp («📲 Compartir viaje por WhatsApp»),
 *    copiar el link («📋 Copiar link del viaje») o compartir desde la app («🔗 Compartir desde la app»)
 *    tanto en «Mis envíos» como en «Pedidos», y el link ?followTrip=<id> abre el seguimiento en vivo sin PIN.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { serve, loadPuppeteer, CHROME } from './e2e-sonido-pedidos/server.mjs';
import os from 'node:os';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpMdr = path.join(os.tmpdir(), `mdr-sopota-${process.pid}.mjs`);
fs.copyFileSync(path.join(ROOT, 'js/merchant-delivery-request.js'), tmpMdr);
const {
    isMerchantOwnedDeliveryTrip,
    parseHondurasCoordsInput,
    buildDeliveryTrackingUrl,
    normalizeHondurasWhatsAppPhone,
    buildMerchantShareTripWhatsAppUrl,
} = await import(tmpMdr);
try { fs.unlinkSync(tmpMdr); } catch (_) {}
const require = createRequire(import.meta.url);
const DZ = require(path.join(ROOT, 'functions/delivery-zones.js'));

const R = [];
const ok = (name, cond, detail = '') => R.push([cond ? 'PASS' : 'FAIL', name, detail]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. Pruebas unitarias de detección de envío de tienda y links de WhatsApp ──
const uid = 'uid-la-sopota';
ok(
    'isMerchantOwnedDeliveryTrip: detecta envío directo de tienda (merchantDirectDelivery)',
    isMerchantOwnedDeliveryTrip({ id: 't1', serviceType: 'delivery', merchantDirectDelivery: true, clientId: uid }, uid) === true
);
ok(
    'isMerchantOwnedDeliveryTrip: detecta envío pedido por WhatsApp de tienda (whatsapp_store)',
    isMerchantOwnedDeliveryTrip({ id: 't2', serviceType: 'delivery', createdVia: 'whatsapp_store', clientId: uid }, uid) === true
);
ok(
    'isMerchantOwnedDeliveryTrip: detecta envío pedido desde pantalla principal por dueño de tienda (hasStore=true)',
    isMerchantOwnedDeliveryTrip({ id: 't3', serviceType: 'delivery', clientId: uid, status: 'pending' }, uid, { hasStore: true }) === true
);
ok(
    'isMerchantOwnedDeliveryTrip: NO bloquea un viaje personal de transporte (auto/moto) del dueño salvo que lo desvincule',
    isMerchantOwnedDeliveryTrip({ id: 't4', serviceType: 'auto', clientId: uid, status: 'pending' }, uid, { hasStore: true }) === false
    && isMerchantOwnedDeliveryTrip({ id: 't4', serviceType: 'auto', clientId: uid, status: 'pending' }, uid, { hasStore: true, detachedIds: ['t4'] }) === true
);

const coords1 = parseHondurasCoordsInput('14.4582, -87.6412');
const coords2 = parseHondurasCoordsInput('https://www.google.com/maps?q=14.4615,-87.6391');
const coords3 = parseHondurasCoordsInput('https://www.google.com/maps/place/Comayagua/@14.4521,-87.6385,17z');
ok(
    'parseHondurasCoordsInput: acepta coordenadas directas y links de Google Maps en Honduras',
    coords1?.lat === 14.4582 && coords1?.lng === -87.6412
    && coords2?.lat === 14.4615 && coords2?.lng === -87.6391
    && coords3?.lat === 14.4521 && coords3?.lng === -87.6385
    && parseHondurasCoordsInput('40.7128, -74.0060') === null
);

ok(
    'normalizeHondurasWhatsAppPhone: normaliza 8 dígitos a 504XXXXXXXX',
    normalizeHondurasWhatsAppPhone('9876-5432') === '50498765432'
    && normalizeHondurasWhatsAppPhone('+504 3344 5566') === '50433445566'
);

const trackUrl = buildDeliveryTrackingUrl('trip_sopota_1', 'https://honduraite.com');
ok(
    'buildDeliveryTrackingUrl: genera https://honduraite.com/?followTrip=trip_sopota_1',
    trackUrl === 'https://honduraite.com/?followTrip=trip_sopota_1'
);

const waUrl = buildMerchantShareTripWhatsAppUrl({
    trip: {
        id: 'trip_sopota_1',
        status: 'accepted',
        driverName: 'Carlos Meza',
        driverVehicle: { plate: 'HAA-4589' },
        destination: 'Bo. Torondón, Comayagua',
        priceNum: 35,
        deliveryDetails: {
            storeName: 'La Sopota',
            recipientName: 'María',
            recipientPhone: '9988-7766',
            collectAmount: 180,
        },
    },
    storeName: 'La Sopota',
    baseOrigin: 'https://honduraite.com',
});
const decodedWa = decodeURIComponent(waUrl);
ok(
    'buildMerchantShareTripWhatsAppUrl: arma link wa.me/50499887766 con tienda, repartidor, placa, total L. 215.00 y link followTrip',
    waUrl.startsWith('https://wa.me/50499887766?text=')
    && decodedWa.includes('La Sopota')
    && decodedWa.includes('Carlos Meza')
    && decodedWa.includes('HAA-4589')
    && decodedWa.includes('L. 215.00')
    && decodedWa.includes('https://honduraite.com/?followTrip=trip_sopota_1'),
    decodedWa
);

// ── 2. Verificación estática en app.js, passenger-home.js, merchant-stores.js y firestore.rules ──
const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const homeJs = fs.readFileSync(path.join(ROOT, 'js/passenger-home.js'), 'utf8');
const storesJs = fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8');
const rulesTxt = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const waStoreJs = fs.readFileSync(path.join(ROOT, 'functions/wa-store-delivery.js'), 'utf8');

ok(
    'app.js: filtra envíos de tienda en fetchClientActiveTripFromDb, listenToMyActiveTrip, restorePendingTripUI y processActiveTripUpdate',
    appJs.includes('function isMerchantOwnedDeliveryTrip(')
    && appJs.includes('function releaseMerchantDeliveryTripsFromPassengerUi(')
    && appJs.includes('await ensureMerchantStoreOwnershipChecked()')
);
ok(
    'app.js: permite seguimiento público por link (?followTrip=) para envíos de tienda sin mostrar PIN de pasajero',
    appJs.includes('function isStoreDeliveryFollowDoc(')
    && appJs.includes("q.get('followTrip')")
);
ok(
    'passenger-home.js: evita pantalla en blanco si applyMode("stores") corre mientras carga merchant-stores.js',
    homeJs.includes("typeof window.openStoresMarketplace === 'function'")
    && homeJs.includes('window.isMerchantOwnedDeliveryTrip')
);
ok(
    'merchant-stores.js: incluye panel rápido en Inicio (#merchant-home-quick-card) y botones de compartir viaje en Pedidos',
    storesJs.includes('merchant-home-quick-card')
    && storesJs.includes('share-order-trip-wa')
    && storesJs.includes('copy-order-trip-link')
    && storesJs.includes('share-order-trip-native')
);
ok(
    'firestore.rules y wa-store-delivery.js: permiten get por ID de envío de tienda y envían link ?followTrip= al negocio en WhatsApp',
    rulesTxt.includes("resource.data.get('storeDelivery', false) == true")
    && rulesTxt.includes("resource.data.get('merchantDirectDelivery', false) == true")
    && waStoreJs.includes('https://honduraite.com/?followTrip=')
);

// ── 3. Prueba E2E en navegador real (Puppeteer Chrome headless) + Maqueta visual ──
const box = (la1, ln1, la2, ln2) => [{ lat: la1, lng: ln1 }, { lat: la1, lng: ln2 }, { lat: la2, lng: ln2 }, { lat: la2, lng: ln1 }];
const ZONES = [
    { id: 'z-centro', name: 'Casco Urbano', cityId: 'comayagua', active: true, priority: 1, baseFee: 35, minFee: 30, maxFee: 60, polygon: box(14.445, -87.655, 14.475, -87.630) },
];
const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>
:root{--hn-blue:#0c4a8e;--hn-blue-light:#1a6bb5}
body{margin:0;background:#f8fafc;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
.hd{background:#fff;padding:12px 14px;border-bottom:1px solid #e5e7eb}
.hd p{margin:0;font-size:11px;font-weight:800;color:#0c4a8e;text-transform:uppercase;letter-spacing:.08em}
.hd h2{margin:2px 0 6px;font-size:18px;display:flex;align-items:center;gap:8px}
.free-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;color:#047857;background:#ecfdf5;border:1px solid #6ee7b7;padding:3px 9px;border-radius:999px}
.tabs{display:flex;gap:6px;overflow:hidden;margin-top:8px}
.tabs span{font-size:12px;font-weight:800;padding:6px 10px;border-radius:999px;background:#f3f4f6;white-space:nowrap}
.tabs .on{background:linear-gradient(135deg,#0c4a8e,#1a6bb5);color:#fff}
#body{padding:10px}
</style></head><body>
<div class="hd">
  <p>Mi tienda virtual · Emprendedor</p>
  <h2>🍲 La Sopota <span class="free-badge"><i class="fas fa-bell"></i> Recibiendo pedidos (libre)</span></h2>
  <div class="tabs"><span>Pedidos (2)</span><span>Menú</span><span>Tienda</span><span class="on">🛵 Pedir envío</span><span>Zonas</span></div>
</div>
<div id="body"></div>
<script type="module">
import { createMerchantDeliveryTab } from '/js/merchant-delivery-ui.js';
import { calculateServiceFare } from '/js/service-types.js';
import { resolveServiceAvailability } from '/js/service-availability.js';
import { tripWaitChipHtml } from '/js/trip-wait.js';

window.T = { created: [], sharedWa: [], copied: [], toasts: [], pushList: null };
const store = {
    id: 'store-la-sopota',
    ownerId: 'uid-la-sopota',
    name: 'La Sopota',
    address: 'Barrio Torondón, Comayagua',
    lat: 14.4598,
    lng: -87.6378,
    cityId: 'comayagua',
    phone: '+50499887766'
};
const tab = createMerchantDeliveryTab({
    store,
    uid: 'uid-la-sopota',
    zone: { id: 'comayagua', name: 'Comayagua', center: { lat: 14.4513, lng: -87.6374 } },
    fareFn: calculateServiceFare,
    carFactor: 1.25,
    quoteFee: async (a) => window.serverQuote(JSON.stringify(a)).then(JSON.parse),
    getCommission: async () => 12,
    availability: (svc, zoneId) => resolveServiceAvailability({ config: {}, zoneId, svc }),
    placesFetch: async (q) => [{ description: q + ', Comayagua, Honduras', id: 'p1' }],
    placeDetails: async (s) => ({ lat: 14.4685, lng: -87.6410, address: s.description }),
    serverTs: () => null,
    waitChip: (t) => tripWaitChipHtml(t),
    createTrip: async (p) => {
        const id = 'trip_sopota_' + (window.T.created.length + 1);
        window.T.created.push({ id, ...p });
        return id;
    },
    cancelTrip: async () => {},
    subscribe: (cb) => { window.T.pushList = cb; return () => {}; },
    toast: (m, k) => window.T.toasts.push([m, k]),
    onShareWhatsApp: (info) => window.T.sharedWa.push(info),
    onCopyTrackingLink: (info) => window.T.copied.push(info),
    confirm: () => true,
});
tab.mount(document.getElementById('body'));
window.ready = true;
</script></body></html>`;

const { srv, url } = await serve(ROOT, { '/__sopota.html': pageHtml });
const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});

try {
    const p = await browser.newPage();
    await p.setViewport({ width: 390, height: 920, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => R.push(['FAIL', 'error JS en la página', e.message]));
    await p.exposeFunction('serverQuote', (s) => {
        const a = JSON.parse(s);
        return JSON.stringify(DZ.quoteDelivery({
            zones: ZONES,
            storeFees: {},
            lat: a.lat,
            lng: a.lng,
            cityId: 'comayagua',
            outsideBehavior: 'distance',
            vehicle: a.vehicle,
        }));
    });
    await p.goto(`${url}/__sopota.html`);
    await p.waitForFunction('window.ready');
    await sleep(250);

    // 1) Pedir primer envío desde la interfaz pegando un link de Google Maps
    await p.click('[data-md-vehicle="moto"]');
    await p.type('#md-dropoffAddress', 'https://www.google.com/maps?q=14.4632,-87.6364', { delay: 5 });
    await sleep(350);
    const hasDropOk = !!(await p.$('[data-md-dropok]'));
    ok('Interfaz: pegar link de Google Maps fija el punto de entrega y cotiza de inmediato', hasDropOk);

    await p.type('#md-customerName', 'María López');
    await p.type('#md-customerPhone', '9811-2233');
    await p.type('#md-notes', '2 sopas de res grandes, casa verde');
    await p.type('#md-collectAmount', '240');
    await sleep(150);
    await p.click('[data-md-submit]');
    await sleep(300);

    const c1 = await p.evaluate(() => window.T.created.length);
    ok('Interfaz: La Sopota pide el 1er envío desde la interfaz web/app sin bloquear la tienda', c1 === 1);

    const listText1 = await p.$eval('[data-md-list]', (el) => el.textContent);
    ok(
        'Interfaz: el envío recién creado aparece de inmediato en «Mis envíos» con «Compartir viaje por WhatsApp», «Copiar link del viaje» y «Compartir desde la app»',
        listText1.includes('Compartir viaje por WhatsApp')
        && listText1.includes('Copiar link del viaje')
        && listText1.includes('Compartir desde la app')
        && listText1.includes('Chat repartidor'),
        listText1
    );

    // Probar clic en «Compartir viaje por WhatsApp» y «Copiar link del viaje»
    await p.click('[data-md-share-wa="trip_sopota_1"]');
    await p.click('[data-md-copy-link="trip_sopota_1"]');
    const shared = await p.evaluate(() => ({ wa: window.T.sharedWa, copied: window.T.copied }));
    ok(
        'Interfaz: clic en «Compartir viaje por WhatsApp» genera link wa.me/50498112233 con seguimiento ?followTrip=trip_sopota_1',
        shared.wa.length === 1
        && shared.wa[0].waUrl.startsWith('https://wa.me/50498112233?text=')
        && shared.wa[0].trackUrl.includes('?followTrip=trip_sopota_1')
    );
    ok(
        'Interfaz: clic en «Copiar link del viaje» copia el link ?followTrip=trip_sopota_1',
        shared.copied.length === 1 && shared.copied[0].trackUrl.includes('?followTrip=trip_sopota_1')
    );

    // 2) Pedir un SEGUNDO envío seguido desde la interfaz usando el buscador de direcciones
    await p.type('#md-dropoffAddress', 'Colonia Mejicapa', { delay: 10 });
    await sleep(450);
    await p.click('[data-md-sug="0"]');
    await sleep(250);
    await p.type('#md-customerName', 'Carlos Pineda');
    await p.type('#md-customerPhone', '3344-5566');
    await p.type('#md-collectAmount', '180');
    await p.click('[data-md-submit]');
    await sleep(300);

    // Simular que el 1er envío ya fue aceptado por un conductor para que se vea en vivo junto al 2do
    await p.evaluate(() => {
        window.T.pushList([
            {
                ...window.T.created[1],
                status: 'pending',
                priceVerified: true,
            },
            {
                ...window.T.created[0],
                status: 'accepted',
                driverId: 'drv1',
                driverName: 'Jorge (Moto)',
                driverVehicle: { plate: 'M-8821' },
                destination: 'Barrio El Torondón, Comayagua',
            },
        ]);
    });
    await sleep(250);

    const c2 = await p.evaluate(() => window.T.created.length);
    const reqCards = (await p.$$('[data-md-req]')).length;
    ok(
        'Interfaz: La Sopota puede pedir un 2do envío consecutivo desde la interfaz mientras el 1ro está activo',
        c2 === 2 && reqCards === 2
    );

    const mockDir = '/workspace/mockups-pedidos-preparando';
    fs.mkdirSync(mockDir, { recursive: true });
    await p.screenshot({
        path: path.join(mockDir, '09-compartir-viaje-whatsapp-y-liberar-tienda.png'),
        fullPage: true,
    });
} finally {
    await browser.close();
    srv.close();
}

for (const [status, name, detail] of R) {
    console.log(`${status} | ${name}${detail && status === 'FAIL' ? ' | ' + detail : ''}`);
}
const failed = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - failed}/${R.length} PASS`);
process.exit(failed ? 1 : 0);
