/**
 * Pruebas E2E (Chrome headless) y unitarias:
 * 1) Selección opcional de productos registrados en 🛵 Pedir envío (suma automática a #md-productCharge / #md-collectAmount,
 *    envío con lista de productos en tarjeta de conductor / WhatsApp / seguimiento en vivo, y envío dejándolo vacío []).
 * 2) Regla estricta de apagado automático de "Zonas / Restaurantes en Fuego" cuando isOpen === false,
 *    fuera de horario, o cuando Date.now() - lastActivityMs > 3,600,000 (1 hora sin registrar envío).
 * 3) Escala progresiva de los 5 niveles de colores (Ámbar 1–2, Naranja 3–4, Rojo 5–7, Morado 8–11, Azul Plasma 12+)
 *    y animaciones CSS arcade de ondas/orbes/halo en el mapa y tarjetas.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, loadPuppeteer, CHROME } from './e2e-sonido-pedidos/server.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function importEsmFile(relPath) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    return import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'));
}

const {
    normalizeSelectedDeliveryItems,
    calculateDeliveryItemsSubtotal,
    formatDeliveryItemsSummary,
    formatDeliveryItemsBannerText,
    buildMerchantDeliveryTrip,
    buildMerchantShareTripMessage,
} = await importEsmFile('js/merchant-delivery-request.js');

const {
    storeOrderSummary,
    storeCollectHtml,
    storeAcceptedPanelHtml,
} = await importEsmFile('js/store-trip-ui.js');

let passed = 0;
let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.error(`  ❌ ${name}\n     ${e.message}`);
    }
}

console.log('\n── 1. Productos registrados opcionales en 🛵 Pedir envío (unidad) ──');

await check('normalizeSelectedDeliveryItems y calculateDeliveryItemsSubtotal calculan subtotal exacto', () => {
    const items = normalizeSelectedDeliveryItems([
        { productId: 'prod_mondongo', name: 'Sopa de Mondongo', price: 120, qty: 2, imageUrl: 'https://example.com/mondongo.jpg' },
        { productId: 'prod_fresco', name: 'Fresco Natural', price: 35, qty: 1 },
    ]);
    assert.equal(items.length, 2);
    assert.equal(calculateDeliveryItemsSubtotal(items), 275);
    assert.equal(formatDeliveryItemsSummary(items), '2× Sopa de Mondongo, 1× Fresco Natural');
    const banner = formatDeliveryItemsBannerText(items);
    assert.ok(banner.includes('2× Sopa de Mondongo (L. 240.00)'));
    assert.ok(banner.includes('1× Fresco Natural (L. 35.00)'));
    assert.ok(banner.includes('= L. 275.00 en productos'));
});

await check('buildMerchantDeliveryTrip guarda items e itemsSummary cuando se seleccionan productos', () => {
    const trip = buildMerchantDeliveryTrip({
        store: { id: 'store_sopota', name: 'La Sopota', lat: 14.458, lng: -87.64, address: 'Barrio Arriba', phone: '99887766' },
        uid: 'uid_sopota',
        form: {
            vehicle: 'moto',
            pickupAddress: 'Barrio Arriba',
            pickupLat: 14.458,
            pickupLng: -87.64,
            dropoffAddress: 'Col. Brisas de Humuya',
            dropoffLat: 14.442,
            dropoffLng: -87.644,
            collectAmount: 275,
            customerName: 'Doña Carmen',
            customerPhone: '98112233',
            notes: 'Casa portón verde',
            items: [
                { productId: 'prod_mondongo', name: 'Sopa de Mondongo', price: 120, qty: 2 },
                { productId: 'prod_fresco', name: 'Fresco Natural', price: 35, qty: 1 },
            ],
        },
        estimate: { vehicle: 'moto', km: 2.1, price: 35 },
    });
    assert.equal(trip.deliveryDetails.items.length, 2);
    assert.equal(trip.deliveryDetails.itemsSubtotal, 275);
    assert.equal(trip.deliveryDetails.itemsSummary, '2× Sopa de Mondongo, 1× Fresco Natural');
    assert.equal(trip.itemsSummary, '2× Sopa de Mondongo, 1× Fresco Natural');
    assert.equal(trip.deliveryDetails.storeId, 'store_sopota');
    assert.equal(trip.deliveryDetails.productCharge, 275);
});

await check('buildMerchantDeliveryTrip permite dejar productos vacío ([]) y funciona 100% igual que antes', () => {
    const tripEmpty = buildMerchantDeliveryTrip({
        store: { id: 'store_sopota', name: 'La Sopota', lat: 14.458, lng: -87.64, address: 'Barrio Arriba' },
        uid: 'uid_sopota',
        form: {
            vehicle: 'moto',
            pickupAddress: 'Barrio Arriba',
            pickupLat: 14.458,
            pickupLng: -87.64,
            dropoffAddress: 'Col. Brisas de Humuya',
            dropoffLat: 14.442,
            dropoffLng: -87.644,
            collectAmount: 0,
            items: [],
        },
        estimate: { vehicle: 'moto', km: 2.1, price: 35 },
    });
    assert.deepEqual(tripEmpty.deliveryDetails.items, []);
    assert.equal(tripEmpty.deliveryDetails.itemsSummary, '');
    assert.equal(tripEmpty.itemsSummary, null);
    assert.equal(tripEmpty.deliveryDetails.productCharge, 0);
});

await check('Tarjeta del conductor, mensaje de WhatsApp y seguimiento en vivo muestran los productos seleccionados', () => {
    const tripWithItems = buildMerchantDeliveryTrip({
        store: { id: 'store_sopota', name: 'La Sopota', lat: 14.458, lng: -87.64, address: 'Barrio Arriba' },
        uid: 'uid_sopota',
        form: {
            vehicle: 'moto',
            pickupAddress: 'Barrio Arriba',
            pickupLat: 14.458,
            pickupLng: -87.64,
            dropoffAddress: 'Col. Brisas de Humuya',
            dropoffLat: 14.442,
            dropoffLng: -87.644,
            collectAmount: 275,
            customerName: 'Doña Carmen',
            customerPhone: '98112233',
            items: [
                { productId: 'prod_mondongo', name: 'Sopa de Mondongo', price: 120, qty: 2 },
                { productId: 'prod_fresco', name: 'Fresco Natural', price: 35, qty: 1 },
            ],
        },
        estimate: { vehicle: 'moto', km: 2.1, price: 35 },
    });
    const summary = storeOrderSummary(tripWithItems);
    assert.equal(summary.itemsDetailText, '2× Sopa de Mondongo, 1× Fresco Natural');

    const collectCard = storeCollectHtml(tripWithItems);
    assert.ok(collectCard.includes('2× Sopa de Mondongo, 1× Fresco Natural'));

    const acceptedCard = storeAcceptedPanelHtml(tripWithItems);
    assert.ok(acceptedCard.includes('2× Sopa de Mondongo, 1× Fresco Natural'));

    const waMsg = buildMerchantShareTripMessage({ id: 'trip_sopota_99', ...tripWithItems }, 'https://honduraite.com');
    assert.ok(waMsg.includes('🍽️ *Productos:* 2× Sopa de Mondongo, 1× Fresco Natural'), `WA msg was: ${waMsg}`);
    assert.ok(waMsg.includes('followTrip=trip_sopota_99'));
});

console.log('\n── 2. Interfaz Chrome Headless de 🛵 Pedir envío con productos opcionales ──');

const testPageHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--hn-blue:#0c4a8e;--hn-blue-light:#1a6bb5}body{margin:0;background:#f8fafc;font-family:Inter,system-ui,sans-serif}#host{padding:12px}</style>
</head><body><div id="host"></div>
<script type="module">
import { createMerchantDeliveryTab } from '/js/merchant-delivery-ui.js';
import { calculateServiceFare } from '/js/service-types.js';
window.TEST_STATE = { createdTrips: [], recordedSales: [], listCb: null };
const sampleProducts = [
    { id: 'prod_mondongo', name: 'Sopa de Mondongo', price: 120, photoUrl: '', available: true },
    { id: 'prod_marinera', name: 'Sopa Marinera Especial', price: 185, photoUrl: '', available: true },
    { id: 'prod_res', name: 'Sopa de Res Casera', price: 110, photoUrl: '', available: true },
    { id: 'prod_fresco', name: 'Fresco Natural (Horchata)', price: 35, photoUrl: '', available: true },
    { id: 'prod_arroz', name: 'Porción Extra de Arroz', price: 25, photoUrl: '', available: true },
];
const store = { id: 'store_sopota', name: 'La Sopota', lat: 14.458, lng: -87.64, address: 'Barrio Arriba, Comayagua', phone: '99887766', cityId: 'comayagua' };
const tab = createMerchantDeliveryTab({
    store,
    uid: 'uid_sopota',
    zone: { id: 'comayagua', name: 'Comayagua', center: { lat: 14.4513, lng: -87.6374 } },
    fareFn: calculateServiceFare,
    carFactor: 1.25,
    getProducts: () => sampleProducts,
    quoteFee: async () => ({ inZone: true, zoneId: 'z-centro', zoneName: 'Zona céntrica', feeMoto: 35, feeCar: 45, source: 'zone_base' }),
    getCommission: async () => 12,
    availability: () => ({ available: true }),
    placesFetch: async () => [{ description: 'Colonia Fátima, Comayagua', id: 'p1' }],
    placeDetails: async () => ({ lat: 14.4705, lng: -87.6455, address: 'Colonia Fátima, Comayagua' }),
    createTrip: async (data) => {
        window.TEST_STATE.createdTrips.push(data);
        return 'trip_' + window.TEST_STATE.createdTrips.length;
    },
    cancelTrip: async () => {},
    onTripCreated: (payload, meta) => {
        window.TEST_STATE.recordedSales.push({ payload, meta });
    },
    subscribe: (cb) => {
        window.TEST_STATE.listCb = cb;
        cb([]);
        return () => {};
    },
    toast: () => {},
});
tab.mount(document.getElementById('host'));
window.ready = true;
</script></body></html>`;

const puppeteer = await loadPuppeteer();
const { srv, url } = await serve(ROOT, { '/__test.html': testPageHtml });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

try {
    const page = await browser.newPage();
    await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${url}/__test.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.ready');

    await check('Muestra la sección "🍽️ Productos del pedido (opcional — puedes dejarlo vacío)" arriba del cobro en efectivo', async () => {
        const text = await page.$eval('#md-products-section', (el) => el.textContent);
        assert.ok(text.includes('🍽️ Productos del pedido (opcional — puedes dejarlo vacío)'));
        const count = await page.$$eval('[data-md-prod-card]', (els) => els.length);
        assert.equal(count, 5);
        const hasSearch = !!(await page.$('#md-product-search'));
        assert.equal(hasSearch, true);
    });

    await check('Al tocar [+] en productos suma automáticamente a #md-productCharge y muestra el resumen', async () => {
        await page.click('[data-md-prod-inc="prod_mondongo"]');
        await page.click('[data-md-prod-inc="prod_mondongo"]');
        await page.click('[data-md-prod-inc="prod_fresco"]');

        const chargeVal = await page.$eval('#md-productCharge', (el) => Number(el.value));
        const collectVal = await page.$eval('#md-collectAmount', (el) => Number(el.value));
        assert.equal(chargeVal, 275);
        assert.equal(collectVal, 275);

        const bannerTxt = await page.$eval('#md-selected-items-banner', (el) => el.textContent);
        assert.ok(bannerTxt.includes('2× Sopa de Mondongo (L. 240.00)'));
        assert.ok(bannerTxt.includes('1× Fresco Natural (Horchata) (L. 35.00)'));
        assert.ok(bannerTxt.includes('= L. 275.00 en productos'));
    });

    await check('Al enviar pedido con productos guarda deliveryDetails.items, registra actividad en fuego y limpia el selector', async () => {
        await page.click('[data-md-vehicle="moto"]');
        await page.type('#md-dropoffAddress', '14.4705, -87.6455');
        await new Promise((r) => setTimeout(r, 250));
        await page.type('#md-customerName', 'Carlos Mejía');
        await page.type('#md-customerPhone', '99112233');
        await page.click('[data-md-submit]');
        await new Promise((r) => setTimeout(r, 200));

        const state = await page.evaluate(() => window.TEST_STATE);
        assert.equal(state.createdTrips.length, 1);
        assert.equal(state.createdTrips[0].deliveryDetails.items.length, 2);
        assert.equal(state.createdTrips[0].deliveryDetails.productCharge, 275);
        assert.equal(state.createdTrips[0].itemsSummary, '2× Sopa de Mondongo, 1× Fresco Natural (Horchata)');
        assert.equal(state.recordedSales.length, 1);
        assert.equal(state.recordedSales[0].meta.items.length, 2);

        const qtyAfter = await page.$eval('[data-md-prod-qty="prod_mondongo"]', (el) => el.textContent.trim());
        assert.equal(qtyAfter, '0');
    });

    await check('Permite pedir otro envío dejando los productos completamente vacíos ([])', async () => {
        await page.click('[data-md-vehicle="moto"]');
        await page.type('#md-dropoffAddress', '14.4705, -87.6455');
        await new Promise((r) => setTimeout(r, 250));
        await page.$eval('#md-productCharge', (el) => {
            el.value = '150';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.click('[data-md-submit]');
        await new Promise((r) => setTimeout(r, 200));

        const state = await page.evaluate(() => window.TEST_STATE);
        assert.equal(state.createdTrips.length, 2);
        assert.deepEqual(state.createdTrips[1].deliveryDetails.items, []);
        assert.equal(state.createdTrips[1].deliveryDetails.productCharge, 150);
        assert.equal(state.recordedSales.length, 2);
    });
} finally {
    await browser.close();
    srv.close();
}

console.log('\n── 3. Zonas / Restaurantes en Fuego: apagado automático (cierre / 1 hora) y 5 niveles de color ──');

const merchantStoresSrc = fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8');
const appCssSrc = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
const indexHtmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const startMarker = 'export const FIRE_ZONE_WINDOW_MS = 60 * 60 * 1000;';
const endMarker = 'function storeInitials(name)';
const extractedBlock = merchantStoresSrc.slice(
    merchantStoresSrc.indexOf(startMarker),
    merchantStoresSrc.indexOf(endMarker)
);

const isolatedModuleCode = `
const merchantOrders = [];
const clientOrders = [];
let recentStoreDeliveryTrips = [];
const myStore = null;
const myStores = [];
const storesCache = new Map();
const generalStoresById = new Map();
const adultStoresById = new Map();
const dbRef = null;
const appIdRef = null;
function hnNowMinutes() { return 13 * 60; }
function parseHm(s) {
    if (!s || typeof s !== 'string') return null;
    const m = /^(\\d{1,2}):(\\d{2})$/.exec(s.trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}
function storeOpenInfo(store, now = hnNowMinutes()) {
    if (!store) return { open: false, label: 'Cerrado' };
    if (store.isOpen === false) return { open: false, label: 'Cerrada' };
    const h = store.hours;
    if (!h || (!h.open && !h.close)) return { open: true, label: '' };
    const o = parseHm(h.open);
    const c = parseHm(h.close);
    if (o == null || c == null) return { open: true, label: '' };
    const open = o <= c ? (now >= o && now < c) : (now >= o || now < c);
    return { open, label: '' };
}
function formatStoreBranchLabel(s) { return s?.branchName || ''; }
function esc(s) { return String(s ?? ''); }
function syncDriverHotStoresOnMap() {}
${extractedBlock}
`;

const encodedMod = 'data:text/javascript;base64,' + Buffer.from(isolatedModuleCode, 'utf8').toString('base64');
const fireMod = await import(encodedMod);

await check('FIRE_ZONE_WINDOW_MS es exactamente 3,600,000 ms (1 hora = 60 minutos)', () => {
    assert.equal(fireMod.FIRE_ZONE_WINDOW_MS, 3600000);
});

await check('Escala progresiva de 5 niveles de color según envíos en la última hora (getFireTier)', () => {
    assert.equal(fireMod.getFireTier(0), null);

    const t1 = fireMod.getFireTier(1);
    const t1b = fireMod.getFireTier(2);
    assert.equal(t1.level, 1);
    assert.equal(t1b.level, 1);
    assert.equal(t1.primaryColor, '#facc15');
    assert.equal(t1.secondaryColor, '#f59e0b');
    assert.equal(t1.label, '🔥 Encendiendo');

    const t2 = fireMod.getFireTier(3);
    const t2b = fireMod.getFireTier(4);
    assert.equal(t2.level, 2);
    assert.equal(t2b.level, 2);
    assert.equal(t2.primaryColor, '#fb923c');
    assert.equal(t2.secondaryColor, '#ea580c');
    assert.equal(t2.label, '🔥🔥 En Fuego');

    const t3 = fireMod.getFireTier(5);
    const t3b = fireMod.getFireTier(7);
    assert.equal(t3.level, 3);
    assert.equal(t3b.level, 3);
    assert.equal(t3.primaryColor, '#f43f5e');
    assert.equal(t3.secondaryColor, '#dc2626');
    assert.equal(t3.label, '🔥🔥🔥 ¡Ardiendo!');

    const t4 = fireMod.getFireTier(8);
    const t4b = fireMod.getFireTier(11);
    assert.equal(t4.level, 4);
    assert.equal(t4b.level, 4);
    assert.equal(t4.primaryColor, '#d946ef');
    assert.equal(t4.secondaryColor, '#7c3aed');
    assert.equal(t4.label, '💜⚡ Súper Fuego');

    const t5 = fireMod.getFireTier(12);
    const t5b = fireMod.getFireTier(25);
    assert.equal(t5.level, 5);
    assert.equal(t5b.level, 5);
    assert.equal(t5.primaryColor, '#38bdf8');
    assert.equal(t5.secondaryColor, '#2563eb');
    assert.equal(t5.accentColor, '#a855f7');
    assert.equal(t5.label, '💙💎 Modo Leyenda (Fuego Azul)');
});

await check('Se desactiva inmediatamente si el negocio cierra (isOpen === false o fuera de horario)', () => {
    const nowMs = Date.now();
    const closedStore = {
        id: 'store_sopota',
        name: 'La Sopota',
        isOpen: false,
        lastSaleAtMs: nowMs - 5 * 60 * 1000,
        recentSales1h: 10,
    };
    const resClosed = fireMod.storeHotInfo(closedStore, 0, { nowMs });
    assert.equal(resClosed.isHot, false);
    assert.equal(resClosed.deactivatedReason, 'store_closed');
    assert.equal(resClosed.fireTier, null);

    const afterHoursStore = {
        id: 'store_sopota',
        name: 'La Sopota',
        isOpen: true,
        hours: { open: '08:00', close: '18:00' },
        lastSaleAtMs: nowMs - 10 * 60 * 1000,
        recentSales1h: 6,
    };
    const resAfterHours = fireMod.storeHotInfo(afterHoursStore, 0, { nowMs, nowMinutes: 21 * 60 });
    assert.equal(resAfterHours.isHot, false);
    assert.equal(resAfterHours.deactivatedReason, 'store_closed');
});

await check('Se desactiva inmediatamente si pasa más de 1 hora (3,600,000 ms) sin registrar venta o envío', () => {
    const nowMs = Date.now();
    const inactiveStore = {
        id: 'store_sopota',
        name: 'La Sopota',
        isOpen: true,
        lastSaleAtMs: nowMs - (60 * 60 * 1000 + 1000),
        recentSales1h: 9,
        isHot: true,
    };
    const resInactive = fireMod.storeHotInfo(inactiveStore, 0, { nowMs });
    assert.equal(resInactive.isHot, false);
    assert.equal(resInactive.deactivatedReason, 'inactive_1h');
    assert.equal(resInactive.fireTier, null);
});

await check('Se mantiene activo y calcula nivel de color + cuenta regresiva cuando tiene envíos en la última hora', () => {
    const nowMs = Date.now();
    const sopotaActive = {
        id: 'store_sopota',
        name: 'La Sopota',
        isOpen: true,
        hours: { open: '07:00', close: '22:00' },
        lastSaleAtMs: nowMs - 12 * 60 * 1000,
        recentSales1h: 9,
    };
    const info = fireMod.storeHotInfo(sopotaActive, 0, { nowMs, nowMinutes: 13 * 60 });
    assert.equal(info.isHot, true);
    assert.equal(info.countLastHour, 9);
    assert.equal(info.fireLevel, 4);
    assert.equal(info.fireTier.primaryColor, '#d946ef');
    assert.equal(info.remainingMinutes, 48);
    assert.ok(info.shipmentsLabel.includes('⚡ 9 envíos esta hora'));
    assert.ok(info.expiryLabel.includes('⏱️ Activo · expira en 48 min si no hay otro envío'));

    const markerHtml = fireMod.buildHotStoreMapMarkerHtml(sopotaActive, info);
    assert.ok(markerHtml.includes('hr-fire-tier-4'));
    assert.ok(markerHtml.includes('hr-fire-wave-ring'));
    assert.ok(markerHtml.includes('hr-fire-halo'));
    assert.ok(markerHtml.includes('hr-fire-orb'));
    assert.ok(markerHtml.includes('💜⚡ Súper Fuego'));
    assert.ok(markerHtml.includes('⚡ 9 envíos esta hora'));
});

await check('Animaciones CSS arcade (@keyframes hrFireWavePulse, hrFireOrbsFloat, hrFireHaloSpin, hrFireArcadeBounce) existen en index.html y css/app.css', () => {
    for (const src of [appCssSrc, indexHtmlSrc]) {
        assert.match(src, /@keyframes hrFireWavePulse/);
        assert.match(src, /@keyframes hrFireOrbsFloat/);
        assert.match(src, /@keyframes hrFireHaloSpin/);
        assert.match(src, /@keyframes hrFireArcadeBounce/);
        assert.match(src, /\.hr-fire-tier-1/);
        assert.match(src, /\.hr-fire-tier-2/);
        assert.match(src, /\.hr-fire-tier-3/);
        assert.match(src, /\.hr-fire-tier-4/);
        assert.match(src, /\.hr-fire-tier-5/);
    }
});

console.log(`\nResultado: ${passed} pasaron, ${failed} fallaron\n`);
if (failed > 0) process.exit(1);
