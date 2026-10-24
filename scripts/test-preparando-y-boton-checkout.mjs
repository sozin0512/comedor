import fs from 'node:fs';
import assert from 'node:assert/strict';

const indexHtml = fs.readFileSync('index.html', 'utf8');
const appCss = fs.readFileSync('css/app.css', 'utf8');
const merchantStoresSrc = fs.readFileSync('js/merchant-stores.js', 'utf8');
const zonesSrc = fs.readFileSync('js/store-delivery-zones.js', 'utf8');
const fnSrc = fs.readFileSync('functions/index.js', 'utf8');

let pass = 0;
const queue = [];
function check(name, fn) {
    queue.push({ name, fn });
}

check('#toast-container tiene z-[99999] en index.html y z-index: 99999 en css/app.css (por encima de .stores-world 46000)', () => {
    assert.match(indexHtml, /id="toast-container"[^>]*z-\[99999\]/);
    assert.match(appCss, /#toast-container\s*\{\s*z-index:\s*99999\s*!important;\s*\}/);
});

check('useGpsForCheckout rellena #store-checkout-address si estaba vacío al usar GPS', () => {
    assert.match(zonesSrc, /Ubicación GPS \(\$\{lat\.toFixed\(4\)\}, \$\{lng\.toFixed\(4\)\}\)/);
    assert.match(zonesSrc, /export function checkoutPointSource\(\)/);
});

check('placeOrder resalta campos faltantes con borde rojo (.stores-input--invalid), mensaje inline (.stores-field-error) y scrollIntoView', () => {
    assert.match(merchantStoresSrc, /function markCheckoutFieldInvalid\(inputId, message\)/);
    assert.match(merchantStoresSrc, /markCheckoutFieldInvalid\(\s*'store-checkout-address'/);
    assert.match(merchantStoresSrc, /markCheckoutFieldInvalid\('store-checkout-recipient'/);
    assert.match(merchantStoresSrc, /markCheckoutFieldInvalid\('store-checkout-phone'/);
    assert.match(merchantStoresSrc, /scrollIntoView\?\.\(\{\s*behavior:\s*'smooth',\s*block:\s*'center'\s*\}\)/);
});

check('Flujo estricto del restaurante: accepted solo muestra «Preparando el pedido» y preparing muestra «Pedido preparado · llamar delivery»', () => {
    assert.match(merchantStoresSrc, /👨‍🍳 Marcar: Preparando el pedido/);
    assert.match(merchantStoresSrc, /✅ Pedido preparado · llamar delivery/);
    assert.match(merchantStoresSrc, /Primero marca «Preparando el pedido» antes de llamar al delivery\./);
});

check('Notificación en vivo del cliente y barra de 5 pasos en Mis pedidos', () => {
    assert.match(merchantStoresSrc, /export function clientOrderNotificationCopy\(o\)/);
    assert.match(merchantStoresSrc, /export function orderProgressStepperHtml\(o\)/);
    assert.match(merchantStoresSrc, /Preparando el pedido/);
    assert.match(merchantStoresSrc, /¡Pedido preparado! Llamando a tu delivery/);
    const matches = merchantStoresSrc.match(/startClientOrdersListener\(\);/g) || [];
    assert.ok(matches.length >= 4, `Expected startClientOrdersListener() in init + authReady + openMarketplace + myOrders, got ${matches.length}`);
});

check('Push notifications del servidor usan «👨‍🍳 Preparando el pedido» y «✅ Pedido preparado · llamando delivery»', () => {
    assert.match(fnSrc, /preparing:\s*\{\s*title:\s*'👨‍🍳 Preparando el pedido'/);
    assert.match(fnSrc, /ready:\s*\{\s*title:\s*'✅ Pedido preparado · llamando delivery'/);
});

check('Foto de producto clickeable para ampliar (zoom-product-photo) y modal lightbox pantalla completa z-[99995]', () => {
    assert.match(merchantStoresSrc, /export function productPhotoHtml\(/);
    assert.match(merchantStoresSrc, /data-stores-action="zoom-product-photo"/);
    assert.match(merchantStoresSrc, /product-photo-zoom-badge/);
    assert.match(merchantStoresSrc, /export function buildProductPhotoLightboxHtml\(/);
    assert.match(merchantStoresSrc, /export function openProductPhotoZoomModal\(/);
    assert.match(merchantStoresSrc, /id="store-product-photo-lightbox"[^>]*z-\[99995\]/);
    assert.match(merchantStoresSrc, /max-h-\[78dvh\] object-contain/);
    assert.match(merchantStoresSrc, /Agregar al carrito/);
    assert.match(appCss, /\.product-photo-lightbox\s*\{[^}]*z-index:\s*99995\s*!important;/);
});

check('Se eliminó «Envío aparte, según tu zona» y se muestra el envío real de la zona del cliente en cada producto', () => {
    assert.ok(!merchantStoresSrc.includes('Envío aparte, según tu zona'), 'No debe existir el texto fijo «Envío aparte, según tu zona»');
    assert.match(merchantStoresSrc, /export function formatStoreMenuDeliveryLine\(/);
    assert.match(merchantStoresSrc, /export async function refreshStoreMenuDeliveryQuote\(/);
    assert.match(merchantStoresSrc, /🛵 Envío a \$\{esc\(q\.zoneName \|\| 'tu zona'\)\}: <b>\$\{esc\(feeMoto\)\}<\/b>\$\{esc\(feeCar\)\}/);
    assert.match(merchantStoresSrc, /🛵 Envío a tu ubicación: <b>\$\{esc\(feeMoto\)\}<\/b>\$\{esc\(feeCar\)\}/);
    assert.match(merchantStoresSrc, /📍 Toca para ver el envío a tu ubicación/);
    assert.match(merchantStoresSrc, /data-stores-action="detect-store-fee-gps"/);
    assert.match(zonesSrc, /export function setCheckoutPoint\(point, source = 'gps'\)/);
});

check('Mínimo para carro en zona céntrica (y envíos de tienda) es L. 75.00 (moto L. 35 -> Carro L. 75.00, nunca L. 44.00)', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const DZ = req('../functions/delivery-zones.js');
    assert.equal(DZ.CAR_MIN_DELIVERY_FEE, 75);
    assert.equal(DZ.computeCarDeliveryFee(35), 75);
    assert.equal(DZ.computeCarDeliveryFee(40), 75);
    assert.equal(DZ.computeCarDeliveryFee(110), 137.5);
    const zoneCentrica = {
        id: 'comayagua-centrica', cityId: 'comayagua', name: 'Zona Céntrica',
        active: true, priority: 1, baseFee: 35, minFee: 30, maxFee: 60,
        polygon: [{ lat: 14.47, lng: -87.66 }, { lat: 14.47, lng: -87.61 }, { lat: 14.43, lng: -87.61 }, { lat: 14.43, lng: -87.66 }],
    };
    const qMoto = DZ.quoteDelivery({ zones: [zoneCentrica], storeFees: {}, lat: 14.45, lng: -87.63, cityId: 'comayagua', vehicle: 'moto' });
    const qCar = DZ.quoteDelivery({ zones: [zoneCentrica], storeFees: {}, lat: 14.45, lng: -87.63, cityId: 'comayagua', vehicle: 'auto' });
    assert.equal(qMoto.feeMoto, 35);
    assert.equal(qMoto.feeCar, 75);
    assert.equal(qCar.fee, 75);
    const ver = DZ.verifyMerchantDirectDelivery({
        trip: { merchantId: 'u1', destinationLat: 14.45, destinationLng: -87.63, deliveryVehicle: 'auto', priceNum: 44 },
        store: { id: 's1', ownerId: 'u1', lat: 14.452, lng: -87.638 },
        quote: qCar,
        rate: DZ.DEFAULT_DELIVERY_RATE,
    });
    assert.equal(ver.ok, true);
    assert.equal(ver.corrected, true);
    assert.equal(ver.patch.priceNum, 75);
    assert.equal(ver.patch.price, 'L. 75.00');
    assert.match(zonesSrc, /export const CAR_MIN_DELIVERY_FEE = 75;/);
    assert.match(merchantStoresSrc, /CAR_MIN_DELIVERY_FEE/);
});


check('Emprendedor puede editar producto (precio, nombre, descripción, imagen y stock) y sincronizar en sus sucursales', () => {
    assert.match(merchantStoresSrc, /export function buildEditProductCardHtml\(/);
    assert.match(merchantStoresSrc, /export function startEditProduct\(productId\)/);
    assert.match(merchantStoresSrc, /export async function saveEditedProduct\(productId\)/);
    assert.match(merchantStoresSrc, /data-merchant-action="edit-product"/);
    assert.match(merchantStoresSrc, /id="m-edit-prod-name"/);
    assert.match(merchantStoresSrc, /id="m-edit-prod-price"/);
    assert.match(merchantStoresSrc, /id="m-edit-prod-desc"/);
    assert.match(merchantStoresSrc, /id="m-edit-prod-sync-branches"/);
    assert.match(merchantStoresSrc, /data-merchant-action="pick-edit-form-photo"/);
    assert.match(merchantStoresSrc, /data-merchant-action="save-edit-product"/);
});

check('Emprendedor puede tener varias sucursales del mismo restaurante con diferente ubicación GPS y diferente horario', () => {
    assert.ok(!merchantStoresSrc.includes('Solo puedes tener 1 tienda por cuenta'), 'No debe bloquear la creación de sucursales');
    assert.ok(!merchantStoresSrc.includes('Ya tienes una tienda. Solo se permite una por cuenta.'), 'saveStore no debe bloquear múltiples sucursales');
    assert.match(merchantStoresSrc, /export function buildMerchantStoreSwitcherHtml\(/);
    assert.match(merchantStoresSrc, /data-merchant-action="select-my-store"/);
    assert.match(merchantStoresSrc, /data-merchant-action="clone-branch"/);
    assert.match(merchantStoresSrc, /id="m-store-branch-name"/);
    assert.match(merchantStoresSrc, /id="m-store-copy-menu"/);
    assert.match(merchantStoresSrc, /export async function copyMenuBetweenStores\(/);
    assert.match(merchantStoresSrc, /export async function syncMenuToAllBranches\(/);
});

check('Emprendedor ve si los avisos le funcionan y puede tocar «🔊 Probar aviso»', () => {
    assert.match(merchantStoresSrc, /export function buildMerchantAlertsStatusBarHtml\(\)/);
    assert.match(merchantStoresSrc, /export async function testMerchantOrderAlert\(\)/);
    assert.match(merchantStoresSrc, /data-merchant-action="test-order-alert"/);
    assert.match(merchantStoresSrc, /🔊 Probar aviso/);
    assert.match(merchantStoresSrc, /Avisos y sonido activos en este dispositivo/);
});

check('Cliente puntúa productos entregados, Emprendedor y Clientes ven Productos Estrella y Restaurantes en Fuego, y Repartidores ven Restaurantes en Fuego en el mapa', () => {
    const rulesSrc = fs.readFileSync('firestore.rules', 'utf8');
    assert.match(rulesSrc, /'productRatings',\s*'storeRating',\s*'ratingComment',\s*'ratedAt',\s*'updatedAt'/);
    assert.match(fnSrc, /async function syncStoreOrderStatsAndRatingsAdmin\(/);
    assert.match(merchantStoresSrc, /export function productRatingInfo\(p\)/);
    assert.match(merchantStoresSrc, /export function computeStarProducts\(products = \[\], orders = \[\]\)/);
    assert.match(merchantStoresSrc, /export function storeHotInfo\(s, activeOrdersCount = 0\)/);
    assert.match(merchantStoresSrc, /export function buildOrderProductRatingModalHtml\(/);
    assert.match(merchantStoresSrc, /⭐ Puntuar los productos que te llegaron/);
    assert.match(merchantStoresSrc, /export function buildHotStoresStripHtml\(/);
    assert.match(merchantStoresSrc, /🔥 Restaurantes en fuego/);
    assert.match(merchantStoresSrc, /export function buildStoreStarProductsSectionHtml\(/);
    assert.match(merchantStoresSrc, /⭐ Productos estrella de este restaurante/);
    assert.match(merchantStoresSrc, /export function buildMerchantStarProductsHtml\(/);
    assert.match(merchantStoresSrc, /⭐ Tus productos estrella/);
    assert.match(merchantStoresSrc, /export function buildDriverHotStoresBarHtml\(/);
    assert.match(merchantStoresSrc, /export function syncDriverHotStoresOnMap\(\)/);
});

for (const { name, fn } of queue) {
    await fn();
    pass++;
    console.log(`PASS | ${name}`);
}
console.log(`\n${pass}/${pass} PASS`);
