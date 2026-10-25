import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = fs.mkdtempSync('/tmp/hr-js-test-');
fs.writeFileSync(path.join(JS, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(JS, 'fb-stub.js'), 'export const collection=()=>{};export const doc=()=>{};export const onSnapshot=()=>{};export const query=()=>{};export const where=()=>{};export const orderBy=()=>{};export const limit=()=>{};export const getDocs=async()=>({docs:[]});export const getDoc=async()=>({exists:()=>false});export const Timestamp={fromMillis:(m)=>({toMillis:()=>m})};');
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    if (!f.endsWith('.js')) continue;
    let src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    src = src.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^'"]+firebase-firestore\.js/g, './fb-stub.js');
    src = src.replace(/\.js\?v=[0-9.]+/g, '.js');
    fs.writeFileSync(path.join(JS, f), src);
}
const jsUrl = (f) => pathToFileURL(path.join(JS, f)).href;

const {
    isStoreDeliveryTripDoc,
    normalizeTripAsStoreOrder,
    reconcileStoreOrdersAndTrips,
} = await import(jsUrl('ops-store-orders.js'));

const {
    storeAcceptedPanelHtml,
    buildCancelConfirmModalHtml,
} = await import(jsUrl('store-trip-ui.js'));

let passed = 0;
function ok(name, fn) {
    fn();
    passed++;
    console.log('PASS', name);
}

const now = Date.parse('2026-10-25T20:00:00Z');

// 1) t189u: WhatsApp store delivery trips (e.g. La Sopota) appear in Pedidos de tiendas
ok('t189u: detecta viaje de tienda por WhatsApp (La Sopota) y lo normaliza como pedido', () => {
    const waTrip = {
        id: 'trip_wa_sopota_1',
        createdVia: 'whatsapp_store',
        storeDelivery: true,
        storeName: 'LA SOPOTA',
        status: 'in_progress',
        driverId: 'drv_1',
        driverName: 'Carlos Mejía',
        destination: 'Col. San Juan',
        priceNum: 50,
        deliveryDetails: {
            fromStore: true,
            whatsappStore: true,
            storeName: 'LA SOPOTA',
            recipientName: 'María López',
            recipientPhone: '50499887766',
            deliveryFee: 50,
            itemsTotal: 240,
            itemsDetailText: '2x Sopa de res grande',
        },
        createdAt: now - 10 * 60e3,
    };
    assert.equal(isStoreDeliveryTripDoc(waTrip), true);
    const norm = normalizeTripAsStoreOrder(waTrip);
    assert.equal(norm.storeName, 'LA SOPOTA');
    assert.equal(norm.sourceType, 'whatsapp_store');
    assert.equal(norm.status, 'out_for_delivery');
    assert.equal(norm.driverName, 'Carlos Mejía');
});

// 2) t189u: Stuck/cancelled orders in «En cocina» (>12h or trip_cancelled) auto-heal to cancelled
ok('t189u: limpia pedidos pegados en cocina (#I28KR5 > 25h o trip_cancelled) pasándolos a cancelados', () => {
    const autoCancelled = [];
    const stuckOrder1 = {
        id: 'I28KR5_SOPOTA',
        storeId: 'store_sopota',
        storeName: 'LA SOPOTA',
        status: 'ready',
        deliveryStage: 'trip_cancelled',
        itemsTotal: 190,
        deliveryFee: 50,
        createdAt: now - 25 * 3600e3,
        updatedAt: now - 25 * 3600e3,
    };
    const stuckOrder2 = {
        id: 'STALE_25H',
        storeId: 'store_sopota',
        storeName: 'LA SOPOTA',
        status: 'ready',
        itemsTotal: 140,
        deliveryFee: 50,
        createdAt: now - 26 * 3600e3,
        updatedAt: now - 25 * 3600e3,
    };
    const reconciled = reconcileStoreOrdersAndTrips([stuckOrder1, stuckOrder2], [], {
        now,
        onAutoCancelOrder: (o, meta) => autoCancelled.push({ id: o.id, reason: meta.reason }),
    });
    assert.equal(reconciled[0].status, 'cancelled');
    assert.equal(reconciled[1].status, 'cancelled');
    assert.equal(autoCancelled.length, 2);
});

// 3) t195u: Driver buttons advance store_orders directly without waiting on the restaurant
ok('t195u: cuando el repartidor recoge (in_progress) o entrega (completed), el pedido avanza sin depender del restaurante', () => {
    const synced = [];
    const orderPending = {
        id: 'ord_pending_1',
        storeId: 'store_sopota',
        storeName: 'LA SOPOTA',
        status: 'pending',
        tripId: 'trip_1',
        createdAt: now - 15 * 60e3,
        updatedAt: now - 15 * 60e3,
    };
    const tripInProgress = {
        id: 'trip_1',
        storeOrderId: 'ord_pending_1',
        status: 'in_progress',
        driverId: 'drv_1',
        driverName: 'Carlos Mejía',
    };
    const rec1 = reconcileStoreOrdersAndTrips([orderPending], [tripInProgress], {
        now,
        onAutoSyncOrder: (o, patch) => synced.push(patch.status),
    });
    assert.equal(rec1[0].status, 'out_for_delivery');

    const tripCompleted = { ...tripInProgress, status: 'completed' };
    const rec2 = reconcileStoreOrdersAndTrips([orderPending], [tripCompleted], {
        now,
        onAutoSyncOrder: (o, patch) => synced.push(patch.status),
    });
    assert.equal(rec2[0].status, 'delivered');
});

// 4) t192u & t194u: Driver 3-step action buttons in storeAcceptedPanelHtml
ok('t192u/t194u: ficha del repartidor muestra los botones de 3 pasos (Llegué, Ya recogí, Pedido entregado y Cancelar)', () => {
    const tStep1 = { id: 't1', status: 'accepted', driverArrived: false, storeDelivery: true, storeName: 'LA SOPOTA' };
    const html1 = storeAcceptedPanelHtml(tStep1, 'L 50.00', { isDriver: true });
    assert.ok(html1.includes('🏪 Llegué al negocio'));
    assert.ok(html1.includes('📦 Ya recogí el pedido · Ir al cliente'));
    assert.ok(html1.includes('✕ Cancelar envío'));

    const tStep2 = { id: 't1', status: 'accepted', driverArrived: true, storeDelivery: true, storeName: 'LA SOPOTA' };
    const html2 = storeAcceptedPanelHtml(tStep2, 'L 50.00', { isDriver: true });
    assert.ok(html2.includes('📦 Pedido recogido · Iniciar ruta al cliente'));

    const tStep3 = { id: 't1', status: 'in_progress', driverArrived: true, storeDelivery: true, storeName: 'LA SOPOTA' };
    const html3 = storeAcceptedPanelHtml(tStep3, 'L 50.00', { isDriver: true });
    assert.ok(html3.includes('✅ Pedido entregado · Finalizar envío'));
});

// 5) t191u: Confirmation modal for client, merchant, driver, and staff
ok('t191u: modal de confirmación de cancelación para cliente, restaurante, repartidor y supervisión', () => {
    for (const role of ['client', 'merchant', 'driver', 'staff']) {
        const html = buildCancelConfirmModalHtml({ role, storeName: 'LA SOPOTA', clientName: 'María López', orderShortId: '#I28KR5' });
        assert.ok(html.includes('LA SOPOTA') || html.includes('María López'));
        assert.ok(html.includes('data-cancel-confirm="no"'));
        assert.ok(html.includes('data-cancel-confirm="yes"'));
    }
});

// 6) t193u & t197u: Restore to driver & Mark as Delivered buttons on cancelled orders
ok('t193u/t197u: tarjetas canceladas tienen botones «✅ Marcar Entregado» y «🔄 Devolver a repartidor»', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    const ordersSrc = fs.readFileSync(path.join(ROOT, 'js/ops-store-orders.js'), 'utf8');
    const viajesSrc = fs.readFileSync(path.join(ROOT, 'js/ops-viajes-panel.js'), 'utf8');
    assert.ok(appSrc.includes('window.staffRestoreOrReassignStoreOrder = async'));
    assert.ok(ordersSrc.includes('data-pd="mark-delivered"'));
    assert.ok(ordersSrc.includes('data-pd="restore-driver"'));
    assert.ok(viajesSrc.includes('data-act="markDelivered"'));
    assert.ok(viajesSrc.includes('data-act="restoreDriver"'));
});

// 7) t196u: Branch creation modal in merchant-stores.js does not swallow click events
ok('t196u: modal de crear sucursal no bloquea el burbujeo del botón #sb-save-btn', () => {
    const msSrc = fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8');
    const startIdx = msSrc.indexOf('function openStaffStoreBranchModal');
    const endIdx = msSrc.indexOf('window.openStaffStoreBranchModal =', startIdx);
    const fnBody = msSrc.slice(startIdx, endIdx);
    assert.ok(!fnBody.includes("card?.addEventListener('click', (ev) => ev.stopPropagation())"), 'card stopPropagation must be removed');
    assert.ok(fnBody.includes('sb-inline-status'), 'inline status feedback must exist');
});

// 8) t199u: Iconos y emojis de tiendas y sucursales en el mapa
ok('t199u: pines con emojis para tiendas principales y sucursales en el mapa (🍲, 🥩, 🍻, 👗, ✨, ⚽ + 🏬 Sucursal)', () => {
    const msSrc = fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8');
    assert.ok(msSrc.includes('export function getStoreCategoryEmoji('));
    assert.ok(msSrc.includes('export function getStoreMapPinMeta('));
    assert.ok(msSrc.includes('export function resolveStoreMapPositions('));
    assert.ok(msSrc.includes('export function buildStoreMapPinHtml('));
    assert.ok(msSrc.includes('export function syncAllStoresOnMap('));
    assert.ok(msSrc.includes('export function openStoreMapPinSheet('));
});

// 9) t200u: Pines circulares compactos de 34px sin encimarse en zoom móvil + separación espacial de 85m
ok('t200u: pines circulares compactos (34px) con micro-label al hacer zoom/tocar y separación de 85m', () => {
    const msSrc = fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8');
    const cssSrc = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
    assert.ok(msSrc.includes('hr-store-map-pin__circle'));
    assert.ok(msSrc.includes('hr-store-map-pin__micro-label'));
    assert.ok(msSrc.includes('const thresholdDeg = 0.00055'));
    assert.ok(msSrc.includes('const radiusDeg = 0.00078'));
    assert.ok(cssSrc.includes('.hr-store-map-pin__circle'));
    assert.ok(cssSrc.includes('.hr-map-zoom-close .hr-store-map-pin__micro-label'));
});

console.log(`${passed}/${passed} PASS`);


