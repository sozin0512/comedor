import fs from 'node:fs';
import assert from 'node:assert/strict';

const indexHtml = fs.readFileSync('index.html', 'utf8');
const appCss = fs.readFileSync('css/app.css', 'utf8');
const merchantStoresSrc = fs.readFileSync('js/merchant-stores.js', 'utf8');
const zonesSrc = fs.readFileSync('js/store-delivery-zones.js', 'utf8');
const fnSrc = fs.readFileSync('functions/index.js', 'utf8');

let pass = 0;
function check(name, fn) {
    fn();
    pass++;
    console.log(`PASS | ${name}`);
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
    // Auto-start listener on login
    const matches = merchantStoresSrc.match(/startClientOrdersListener\(\);/g) || [];
    assert.ok(matches.length >= 4, `Expected startClientOrdersListener() in init + authReady + openMarketplace + myOrders, got ${matches.length}`);
});

check('Push notifications del servidor usan «👨‍🍳 Preparando el pedido» y «✅ Pedido preparado · llamando delivery»', () => {
    assert.match(fnSrc, /preparing:\s*\{\s*title:\s*'👨‍🍳 Preparando el pedido'/);
    assert.match(fnSrc, /ready:\s*\{\s*title:\s*'✅ Pedido preparado · llamando delivery'/);
});

console.log(`\n${pass}/${pass} PASS`);
