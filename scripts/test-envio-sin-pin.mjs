import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = fs.mkdtempSync('/tmp/hr-js-envio-');
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(JS, f));
}
fs.writeFileSync(path.join(JS, 'package.json'), '{"type":"module"}');
const jsUrl = (f) => pathToFileURL(path.join(JS, f)).href;

const {
    isStoreOrderTrip,
    isDeliveryTrip,
    getDeliveryStoreName,
    getDeliveryRecipientName,
    getDeliveryStageMeta,
    getDeliveryChatMessages,
    getDefaultDeliveryChatChannel,
    buildDeliveryDualChatTabsHtml,
    storeAcceptedPanelHtml,
} = await import(jsUrl('store-trip-ui.js'));

let passed = 0;
function check(name, fn) {
    try {
        const detail = fn();
        passed++;
        console.log(`PASS | ${name}${detail ? ` | ${detail}` : ''}`);
    } catch (err) {
        console.error(`FAIL | ${name}:`, err);
        process.exit(1);
    }
}

const sampleStoreTrip = {
    id: 'trip-food-1',
    tripKind: 'store_order',
    storeOrder: true,
    serviceType: 'delivery',
    status: 'accepted',
    driverArrived: false,
    storeId: 'store-1',
    storeName: 'Comedor y Baleadas Doña Ana',
    storePhone: '99887766',
    merchantId: 'merchant-uid-1',
    clientId: 'client-uid-1',
    clientName: 'Josue Soza',
    recipientName: 'Josue Soza',
    recipientPhone: '99112233',
    origin: 'Comedor y Baleadas Doña Ana · barrio arriba, dos casas abajo de LTH, Comayagua',
    originLat: 14.4551,
    originLng: -87.6382,
    destination: 'F936+CMR, Comayagua',
    destinationLat: 14.4622,
    destinationLng: -87.6411,
    price: 'L. 50.00',
    priceNum: 50,
    storeItemsTotal: 180,
    storeTotalClientPays: 230,
    storeCollectCash: true,
    storeCollectAmount: 180,
    deliveryDetails: {
        storeOrderId: 'order-1',
        storeDelivery: true,
        storeName: 'Comedor y Baleadas Doña Ana',
        storePhone: '99887766',
        recipientName: 'Josue Soza',
        recipientPhone: '99112233',
        itemsTotal: 180,
        items: [{ qty: 2, name: 'Almuerzo ejecutivo', price: 90 }]
    },
    chatMerchant: [
        { sender: 'merchant-uid-1', senderName: 'Comedor Doña Ana', channel: 'merchant', text: 'El pedido ya está empacado en mostrador', time: 1700000001000 },
        { sender: 'driver-uid-1', senderName: 'Marvin Acosta', channel: 'merchant', text: 'Voy llegando en 2 minutos', time: 1700000005000 }
    ],
    chat: [
        { sender: 'client-uid-1', senderName: 'Josue Soza', channel: 'client', text: 'Portón negro frente a la pulpería', time: 1700000010000 }
    ]
};

check('isDeliveryTrip detecta pedidos de tienda, envíos de tienda y serviceType delivery', () => {
    assert.equal(isStoreOrderTrip(sampleStoreTrip), true);
    assert.equal(isDeliveryTrip(sampleStoreTrip), true);
    assert.equal(isDeliveryTrip({ serviceType: 'delivery', origin: 'Restaurante X' }), true);
    assert.equal(isDeliveryTrip({ tripKind: 'merchant_delivery' }), true);
    assert.equal(isDeliveryTrip({ serviceType: 'moto', tripKind: 'ride' }), false);
    return 'store_order + merchant_delivery + delivery = true; ride = false';
});

check('getDeliveryStoreName y getDeliveryRecipientName extraen negocio y cliente correctamente', () => {
    assert.equal(getDeliveryStoreName(sampleStoreTrip), 'Comedor y Baleadas Doña Ana');
    assert.equal(getDeliveryRecipientName(sampleStoreTrip), 'Josue Soza');
    assert.equal(
        getDeliveryStoreName({ serviceType: 'delivery', origin: 'Pollo Campero · Boulevard Centro, Comayagua' }),
        'Pollo Campero'
    );
});

check('getDeliveryStageMeta Paso 1 (accepted, !driverArrived): ir al negocio a recoger el pedido (sin PIN)', () => {
    const m = getDeliveryStageMeta(sampleStoreTrip);
    assert.equal(m.stage, 'to_store');
    assert.equal(m.stepNum, 1);
    assert.match(m.headerTitle, /En camino a Comedor y Baleadas Doña Ana a recoger el pedido/);
    assert.match(m.primaryBtnLabel, /LLEGUÉ AL NEGOCIO/i);
    assert.match(m.secondaryBtnLabel, /YA RECOGÍ EL PEDIDO · IR AL CLIENTE/i);
    assert.ok(!/PIN/i.test(m.primaryBtnLabel));
    return m.headerTitle;
});

check('getDeliveryStageMeta Paso 1B (accepted, driverArrived): en el negocio recogiendo el pedido (sin PIN)', () => {
    const m = getDeliveryStageMeta({ ...sampleStoreTrip, driverArrived: true });
    assert.equal(m.stage, 'at_store');
    assert.equal(m.stepNum, 1);
    assert.match(m.headerTitle, /En Comedor y Baleadas Doña Ana · Recogiendo pedido/);
    assert.match(m.primaryBtnLabel, /PEDIDO RECOGIDO · INICIAR RUTA AL CLIENTE/i);
    assert.ok(!m.secondaryBtnLabel);
    return m.primaryBtnLabel;
});

check('getDeliveryStageMeta Paso 2 (in_progress): en camino al cliente a entregar el pedido', () => {
    const m = getDeliveryStageMeta({ ...sampleStoreTrip, status: 'in_progress', driverArrived: true });
    assert.equal(m.stage, 'to_customer');
    assert.equal(m.stepNum, 2);
    assert.match(m.headerTitle, /En camino al cliente a entregar el pedido/);
    assert.match(m.primaryBtnLabel, /PEDIDO ENTREGADO/i);
    return m.headerTitle;
});

check('storeAcceptedPanelHtml muestra ruta 1 Negocio -> 2 Cliente, Sin PIN de pasajero, y botones de Chat con Negocio y Chat con Cliente', () => {
    const html = storeAcceptedPanelHtml(sampleStoreTrip, 50);
    assert.match(html, /Sin PIN de pasajero/);
    assert.match(html, /1\. 🏪 Recoger en negocio/);
    assert.match(html, /2\. 👤 Entregar al cliente/);
    assert.match(html, /1\. Recoger en negocio.*Comedor y Baleadas Doña Ana/);
    assert.match(html, /2\. Entregar a Josue Soza \(recibe\)/);
    assert.match(html, /Chat con Negocio/);
    assert.match(html, /Chat con Cliente/);
    assert.match(html, /openDeliveryTripChat\?\.\('merchant'\)/);
    assert.match(html, /openDeliveryTripChat\?\.\('client'\)/);
    assert.ok(!/PIN DEL PASAJERO/i.test(html));
    assert.ok(!/INICIAR SIN PIN/i.test(html));
});

check('Chat dual (Negocio + Cliente): separa mensajes de chatMerchant y chat y cambia pestaña por defecto según etapa', () => {
    assert.equal(getDefaultDeliveryChatChannel({ ...sampleStoreTrip, status: 'accepted' }), 'merchant');
    assert.equal(getDefaultDeliveryChatChannel({ ...sampleStoreTrip, status: 'in_progress' }), 'client');

    const merchantMsgs = getDeliveryChatMessages(sampleStoreTrip, 'merchant');
    const clientMsgs = getDeliveryChatMessages(sampleStoreTrip, 'client');
    assert.equal(merchantMsgs.length, 2);
    assert.equal(merchantMsgs[0].text, 'El pedido ya está empacado en mostrador');
    assert.equal(clientMsgs.length, 1);
    assert.equal(clientMsgs[0].text, 'Portón negro frente a la pulpería');

    const tabsHtml = buildDeliveryDualChatTabsHtml(sampleStoreTrip, 'merchant');
    assert.match(tabsHtml, /Chat Negocio/);
    assert.match(tabsHtml, /Chat Cliente/);
    assert.match(tabsHtml, /setDeliveryTripChatChannel\?\.\('merchant'\)/);
    assert.match(tabsHtml, /setDeliveryTripChatChannel\?\.\('client'\)/);
});

check('js/app-driver.js: getTripPickupCoords usa siempre originLat/originLng del negocio en envíos (nunca clientLiveLat del cliente)', () => {
    const driverSrc = fs.readFileSync(path.join(ROOT, 'js/app-driver.js'), 'utf8');
    assert.match(driverSrc, /window\.isDeliveryTrip\?\.\(t\)[\s\S]*?source:\s*["']store_origin["']/);
    assert.match(driverSrc, /PEDIDO RECOGIDO · IR AL CLIENTE/);
    assert.match(driverSrc, /🏪 LLEGUÉ AL NEGOCIO/);
});

check('js/app.js: elimina PIN en envíos, muestra 1. RECOGER EN NEGOCIO y 2. ENTREGAR A CLIENTE en showStaffLiveTripMapSheet y soporta chat 2 canales', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    assert.match(appSrc, /const randomPin = isDeliveryTrip\(t\) \? null : Math\.floor\(1000 \+ Math\.random\(\) \* 9000\)\.toString\(\)/);
    assert.match(appSrc, /Envío sin PIN de pasajero/);
    assert.match(appSrc, /1\. Negocio \(recoger\)/);
    assert.match(appSrc, /2\. Cliente \(recibe\)/);
    assert.match(appSrc, /window\.driverConfirmOrderPickedUp = async/);
    assert.match(appSrc, /window\.setDeliveryTripChatChannel =/);
    assert.match(appSrc, /window\.switchStaffSheetChatChannel =/);
    assert.match(appSrc, /window\.sendTripChannelMessage =/);
});

check('js/merchant-stores.js y js/merchant-delivery-ui.js: negocio y cliente tienen botón «💬 Chat con repartidor» y modal en vivo', () => {
    const msSrc = fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8');
    const mdSrc = fs.readFileSync(path.join(ROOT, 'js/merchant-delivery-ui.js'), 'utf8');
    assert.match(msSrc, /export function openOrderDriverChatModal/);
    assert.match(msSrc, /data-merchant-action="chat-driver"/);
    assert.match(msSrc, /data-stores-action="chat-driver"/);
    assert.match(msSrc, /🏪 Negocio ↔ Repartidor/);
    assert.match(msSrc, /👤 Cliente ↔ Repartidor/);
    assert.match(mdSrc, /data-md-chat="/);
});

check('firestore.rules y functions/index.js: permiten chatMerchant del negocio y envían notificaciones push sin PIN', () => {
    const rulesSrc = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const fnSrc = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
    assert.match(rulesSrc, /\['chat', 'chatMerchant', 'chatSeenBy', 'updatedAt'\]/);
    assert.match(rulesSrc, /resource\.data\.get\('merchantId', ''\) == requestUid\(\)/);
    assert.match(fnSrc, /const isDelivTrip = isStoreDeliveryTrip\(after\) \|\| after\.serviceType === 'delivery'/);
    assert.match(fnSrc, /after\.chatMerchant/);
});

console.log(`\n${passed}/${passed} PASS`);
