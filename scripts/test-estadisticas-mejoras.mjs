import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_TMP = fs.mkdtempSync('/tmp/hr-js-stats-');
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(JS_TMP, f));
}
fs.writeFileSync(path.join(JS_TMP, 'package.json'), '{"type":"module"}');
const jsUrl = (f) => pathToFileURL(path.join(JS_TMP, f)).href;

const {
    SERVICE_BREAKDOWN_DEFS,
    isTripTrashed,
    classifyTripServiceBucket,
    resolveTripCommissionRate,
    resolveTripCommissionAmount,
    resolveStatsDateRange,
    matchesCityFilter,
    computeGlobalStatsSnapshot,
    buildGlobalStatsCsv,
    buildStatsFiltersToolbarHtml,
    renderGlobalStatsHtml,
} = await import(jsUrl('stats-engine.js'));

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

const refNow = new Date('2026-10-24T15:00:00-06:00');
const commissionConfig = {
    platformPct: 18,
    byService: {
        taxi: 15,
        auto: 18,
        moto: 12,
        hourly: 20,
        delivery: 14,
        flete: 16,
        grua: 16,
        tiendas: 10,
        store_products: 10,
    },
};

const sampleTrips = [
    // 1. Auto / Taxi (Tegucigalpa) - 15% por servicio taxi
    {
        id: 'trip-taxi-1',
        serviceType: 'taxi',
        status: 'completed',
        serviceZoneId: 'tegucigalpa',
        serviceZoneName: 'Tegucigalpa',
        driverId: 'drv-1',
        driverName: 'Carlos Mejía',
        clientName: 'Ana López',
        origin: 'Blvd Morazán, Tegucigalpa',
        destination: 'Multiplaza, Tegucigalpa',
        priceNum: 120,
        paymentMethod: 'efectivo',
        createdAt: new Date('2026-10-24T09:15:00-06:00'),
        completedAt: new Date('2026-10-24T09:35:00-06:00'),
        startedAt: new Date('2026-10-24T09:18:00-06:00'),
    },
    // 2. Moto (Comayagua) - 12% por servicio moto
    {
        id: 'trip-moto-1',
        serviceType: 'moto',
        status: 'completed',
        serviceZoneId: 'comayagua',
        serviceZoneName: 'Comayagua',
        driverId: 'drv-2',
        driverName: 'Marvin Acosta',
        clientName: 'Josue Soza',
        origin: 'Parque Central, Comayagua',
        destination: 'Col. Brisas, Comayagua',
        priceNum: 50,
        paymentMethod: 'efectivo',
        createdAt: new Date('2026-10-24T10:00:00-06:00'),
        completedAt: new Date('2026-10-24T10:12:00-06:00'),
    },
    // 3. VIP / Por horas (Tegucigalpa) - serverCommissionPercent explícito 22%
    {
        id: 'trip-vip-1',
        serviceType: 'auto',
        bookingType: 'hourly',
        status: 'completed',
        serviceZoneId: 'tegucigalpa',
        driverId: 'drv-1',
        driverName: 'Carlos Mejía',
        clientName: 'Roberto Pineda',
        origin: 'Hotel Clarion, Tegucigalpa',
        destination: '2 horas VIP',
        priceNum: 500,
        serverCommissionPercent: 22,
        paymentMethod: 'saldo',
        createdAt: new Date('2026-10-24T11:00:00-06:00'),
        completedAt: new Date('2026-10-24T13:00:00-06:00'),
    },
    // 4. Delivery / Envíos directo (Comayagua) - 14%
    {
        id: 'trip-del-1',
        serviceType: 'delivery',
        status: 'completed',
        serviceZoneId: 'comayagua',
        driverId: 'drv-2',
        driverName: 'Marvin Acosta',
        clientName: 'Farmacia El Ahorro',
        origin: 'Farmacia El Ahorro, Comayagua',
        destination: 'Barrio Torondón, Comayagua',
        priceNum: 60,
        paymentMethod: 'efectivo',
        createdAt: new Date('2026-10-24T11:30:00-06:00'),
        completedAt: new Date('2026-10-24T11:50:00-06:00'),
    },
    // 5. Flete / Grúa (San Pedro Sula) - 16%
    {
        id: 'trip-flete-1',
        serviceType: 'flete_paila',
        status: 'completed',
        serviceZoneId: 'san-pedro-sula',
        driverId: 'drv-3',
        driverName: 'Jorge Rivera',
        clientName: 'Ferretería Monterroso',
        origin: 'Bodega SPS',
        destination: 'Col. Trejo, San Pedro Sula',
        priceNum: 400,
        paymentMethod: 'efectivo',
        createdAt: new Date('2026-10-24T12:00:00-06:00'),
        completedAt: new Date('2026-10-24T12:45:00-06:00'),
    },
    // 6. Envíos de Tiendas (Comayagua) - 10%
    {
        id: 'trip-store-del-1',
        serviceType: 'delivery',
        storeOrderId: 'ord-1',
        tripKind: 'store_order',
        status: 'completed',
        serviceZoneId: 'comayagua',
        driverId: 'drv-2',
        driverName: 'Marvin Acosta',
        clientName: 'Josue Soza',
        origin: 'Comedor Doña Ana, Comayagua',
        destination: 'Barrio Arriba, Comayagua',
        priceNum: 45,
        paymentMethod: 'efectivo',
        createdAt: new Date('2026-10-24T12:30:00-06:00'),
        completedAt: new Date('2026-10-24T12:55:00-06:00'),
    },
    // 7. Viaje en curso (para Embudo)
    {
        id: 'trip-active-1',
        serviceType: 'moto',
        status: 'in_progress',
        serviceZoneId: 'comayagua',
        driverId: 'drv-2',
        priceNum: 35,
        createdAt: new Date('2026-10-24T14:30:00-06:00'),
    },
    // 8. Viaje cancelado sin conductor (para Embudo)
    {
        id: 'trip-cancel-1',
        serviceType: 'auto',
        status: 'cancelled',
        serviceZoneId: 'tegucigalpa',
        priceNum: 90,
        createdAt: new Date('2026-10-24T13:20:00-06:00'),
    },
    // 9. Viaje de prueba EN PAPELERA (trashedAt) -> DEBE SER EXCLUIDO
    {
        id: 'trip-trashed-1',
        serviceType: 'auto',
        status: 'completed',
        serviceZoneId: 'comayagua',
        driverId: 'drv-trashed',
        driverName: 'Conductor Prueba Borrado',
        priceNum: 9999,
        paymentMethod: 'efectivo',
        trashedAt: '2026-10-24T14:00:00.000Z',
        createdAt: new Date('2026-10-24T10:30:00-06:00'),
        completedAt: new Date('2026-10-24T10:40:00-06:00'),
    },
    // 10. Viaje de prueba EN PAPELERA con trashedAtMs -> DEBE SER EXCLUIDO
    {
        id: 'trip-trashed-2',
        serviceType: 'moto',
        status: 'completed',
        serviceZoneId: 'tegucigalpa',
        driverId: 'drv-trashed-2',
        priceNum: 5000,
        trashedAtMs: 1761330000000,
        createdAt: new Date('2026-10-24T11:10:00-06:00'),
    },
];

const sampleStoreOrders = [
    {
        id: 'ord-1',
        storeId: 'store-ana',
        storeName: 'Comedor y Baleadas Doña Ana',
        clientName: 'Josue Soza',
        cityId: 'comayagua',
        cityName: 'Comayagua',
        deliveryZoneName: 'Zona Céntrica',
        status: 'delivered',
        itemsTotal: 220,
        deliveryFee: 45,
        commissionPercent: 10,
        paymentMethod: 'efectivo',
        createdAt: new Date('2026-10-24T12:15:00-06:00'),
    },
    {
        id: 'ord-2',
        storeId: 'store-asados',
        storeName: 'Asados El Gordo',
        clientName: 'María Fernanda',
        cityId: 'tegucigalpa',
        cityName: 'Tegucigalpa',
        deliveryZoneName: 'Blvd Morazán',
        status: 'delivered',
        itemsTotal: 380,
        deliveryFee: 75,
        commissionPercent: 10,
        paymentMethod: 'saldo',
        createdAt: new Date('2026-10-24T13:10:00-06:00'),
    },
    {
        id: 'ord-3',
        storeId: 'store-ana',
        storeName: 'Comedor y Baleadas Doña Ana',
        clientName: 'Pedro Gómez',
        cityId: 'comayagua',
        status: 'preparing',
        itemsTotal: 150,
        deliveryFee: 35,
        createdAt: new Date('2026-10-24T14:40:00-06:00'),
    },
    {
        id: 'ord-4',
        storeId: 'store-asados',
        storeName: 'Asados El Gordo',
        clientName: 'Cliente Canceló',
        cityId: 'tegucigalpa',
        status: 'cancelled',
        itemsTotal: 190,
        deliveryFee: 50,
        createdAt: new Date('2026-10-24T11:05:00-06:00'),
    },
];

const sampleDeposits = [
    {
        id: 'dep-1',
        driverId: 'drv-1',
        status: 'approved',
        amount: 15,
        cityId: 'tegucigalpa',
        createdAt: new Date('2026-10-24T14:00:00-06:00'),
    },
    {
        id: 'dep-2',
        driverId: 'drv-2',
        status: 'approved',
        amount: 10,
        cityId: 'comayagua',
        createdAt: new Date('2026-10-24T14:15:00-06:00'),
    },
    {
        id: 'dep-pending',
        driverId: 'drv-3',
        status: 'pending',
        amount: 64,
        cityId: 'san-pedro-sula',
        createdAt: new Date('2026-10-24T14:20:00-06:00'),
    },
];

const sampleUsers = [
    { uid: 'drv-1', name: 'Carlos Mejía', role: 'driver', serviceZoneId: 'tegucigalpa', pendingDepositDebt: 0 },
    { uid: 'drv-2', name: 'Marvin Acosta', role: 'driver', serviceZoneId: 'comayagua', pendingDepositDebt: 0 },
    { uid: 'drv-3', name: 'Jorge Rivera', role: 'driver', serviceZoneId: 'san-pedro-sula', pendingDepositDebt: 25 },
];

const snapshotAll = computeGlobalStatsSnapshot({
    trips: sampleTrips,
    storeOrders: sampleStoreOrders,
    deposits: sampleDeposits,
    users: sampleUsers,
    commissionConfig,
    filter: { period: 'today', city: 'all' },
    now: refNow,
});

check('Req 6: Excluir papelera (trashedAt / trashedAtMs) ignora viajes borrados en conteos, ingresos y deudas', () => {
    assert.equal(isTripTrashed(sampleTrips[8]), true);
    assert.equal(isTripTrashed(sampleTrips[9]), true);
    assert.equal(snapshotAll.trashedExcludedCount, 2);
    assert.equal(snapshotAll.financial.totalTrips, 6);
    // 120 + 50 + 500 + 60 + 400 + 45 = 1175 (no incluye 9999 ni 5000)
    assert.equal(snapshotAll.financial.totalEarned, 1175);
    assert.ok(!snapshotAll.owingDrivers.some((d) => d.uid === 'drv-trashed' || d.uid === 'drv-trashed-2'));
    return `excluidos=${snapshotAll.trashedExcludedCount}, totalEarned=L. ${snapshotAll.financial.totalEarned}`;
});

check('Req 1: Desglose por servicio y comisión propia calcula viajes, facturación, % y comisión de los 6 servicios', () => {
    assert.equal(snapshotAll.serviceBreakdown.length, 6);
    const byKey = Object.fromEntries(snapshotAll.serviceBreakdown.map((s) => [s.key, s]));

    // Auto / Taxi: 1 viaje, L. 120, 15% = L. 18.00
    assert.equal(byKey.auto_taxi.trips, 1);
    assert.equal(byKey.auto_taxi.revenue, 120);
    assert.equal(byKey.auto_taxi.effectivePct, 15);
    assert.equal(byKey.auto_taxi.commission, 18);

    // Moto: 1 viaje completado (de 2 solicitados), L. 50, 12% = L. 6.00
    assert.equal(byKey.moto.trips, 1);
    assert.equal(byKey.moto.requested, 2);
    assert.equal(byKey.moto.revenue, 50);
    assert.equal(byKey.moto.effectivePct, 12);
    assert.equal(byKey.moto.commission, 6);

    // VIP / Por horas: 1 viaje, L. 500, serverCommissionPercent 22% = L. 110.00
    assert.equal(byKey.vip_hourly.trips, 1);
    assert.equal(byKey.vip_hourly.revenue, 500);
    assert.equal(byKey.vip_hourly.effectivePct, 22);
    assert.equal(byKey.vip_hourly.commission, 110);

    // Delivery / Envíos: 1 viaje, L. 60, 14% = L. 8.40
    assert.equal(byKey.delivery.trips, 1);
    assert.equal(byKey.delivery.revenue, 60);
    assert.equal(byKey.delivery.effectivePct, 14);
    assert.equal(byKey.delivery.commission, 8.4);

    // Flete / Grúa: 1 viaje, L. 400, 16% = L. 64.00
    assert.equal(byKey.flete_grua.trips, 1);
    assert.equal(byKey.flete_grua.revenue, 400);
    assert.equal(byKey.flete_grua.effectivePct, 16);
    assert.equal(byKey.flete_grua.commission, 64);

    // Envíos de Tiendas: 1 viaje, L. 45, 10% = L. 4.50
    assert.equal(byKey.tiendas.trips, 1);
    assert.equal(byKey.tiendas.revenue, 45);
    assert.equal(byKey.tiendas.effectivePct, 10);
    assert.equal(byKey.tiendas.commission, 4.5);

    return '6 servicios verificados con su % y comisión exacta';
});

check('Req 2: Incluir pedidos de tiendas (store_orders) suma entregados, cancelados, productos, envíos y comisión 10%', () => {
    const sm = snapshotAll.storeMetrics;
    assert.equal(sm.totalOrders, 4);
    assert.equal(sm.deliveredOrders, 2);
    assert.equal(sm.activeOrders, 1);
    assert.equal(sm.cancelledOrders, 1);
    assert.equal(sm.itemsSoldTotal, 600); // 220 + 380
    assert.equal(sm.deliveryFeesTotal, 120); // 45 + 75
    assert.equal(sm.storeCommissionTotal, 60); // 10% de 600
    return `entregados=${sm.deliveredOrders}, prod=L.${sm.itemsSoldTotal}, envíos=L.${sm.deliveryFeesTotal}, com=L.${sm.storeCommissionTotal}`;
});

check('Req 3: Filtro por ciudad/zona y rango de fechas (Desde - Hasta) filtra viajes, pedidos y depósitos', () => {
    const snapComayagua = computeGlobalStatsSnapshot({
        trips: sampleTrips,
        storeOrders: sampleStoreOrders,
        deposits: sampleDeposits,
        users: sampleUsers,
        commissionConfig,
        filter: { period: 'custom', city: 'comayagua', from: '2026-10-24', to: '2026-10-24' },
        now: refNow,
    });
    // En Comayagua: 3 completados (moto L.50, delivery L.60, envío tienda L.45 = L.155) + 1 en curso = 4 solicitados
    assert.equal(snapComayagua.funnel.requested, 4);
    assert.equal(snapComayagua.funnel.completed, 3);
    assert.equal(snapComayagua.financial.totalEarned, 155);
    // Pedidos de tienda en Comayagua: ord-1 (delivered L.220) y ord-3 (preparing)
    assert.equal(snapComayagua.storeMetrics.totalOrders, 2);
    assert.equal(snapComayagua.storeMetrics.deliveredOrders, 1);
    assert.equal(snapComayagua.storeMetrics.itemsSoldTotal, 220);
    // Depósitos aprobados en Comayagua: dep-2 (L. 10)
    assert.equal(snapComayagua.financial.depositsApprovedAmount, 10);
    return `Comayagua: ${snapComayagua.financial.totalTrips} viajes (L.${snapComayagua.financial.totalEarned}), ${snapComayagua.storeMetrics.totalOrders} pedidos tienda`;
});

check('Req 4: Embudo de viajes calcula solicitados, completados, en curso, cancelados y % de conversión', () => {
    const f = snapshotAll.funnel;
    assert.equal(f.requested, 8); // 6 completados + 1 en curso + 1 cancelado (excluyendo 2 en papelera)
    assert.equal(f.completed, 6);
    assert.equal(f.inProgress, 1);
    assert.equal(f.cancelled, 1);
    assert.equal(f.cancelledNoDriver, 1);
    assert.equal(f.conversionPct, 75);
    return `solicitados=${f.requested}, completados=${f.completed} (${f.conversionPct}%), enCurso=${f.inProgress}, cancelados=${f.cancelled}`;
});

check('Req 5: Comisión generada vs depositada (approved) vs pendiente por cobrar en la calle', () => {
    const fin = snapshotAll.financial;
    // Comisión generada viajes: 18 (taxi) + 6 (moto) + 110 (vip saldo) + 8.4 (delivery) + 64 (flete) + 4.5 (envío tienda) = 210.90
    assert.equal(fin.commissionGenerated, 210.9);
    assert.equal(fin.saldoCommission, 110);
    assert.equal(fin.cashCommission, 100.9);
    // Depósitos aprobados (dep-1 L.15 + dep-2 L.10; dep-pending se ignora por no ser approved) = L. 25.00
    assert.equal(fin.depositsApprovedAmount, 25);
    assert.equal(fin.depositsApprovedCount, 2);
    // Pendiente del período en efectivo: 100.90 - 25.00 = 75.90
    assert.equal(fin.commissionPendingPeriod, 75.9);
    // Pendiente en la calle incluye deuda de perfil + hueco de efectivo
    assert.ok(fin.commissionPendingStreet >= fin.commissionPendingPeriod);
    return `generada=L.${fin.commissionGenerated}, depositada=L.${fin.depositsApprovedAmount}, pendientePeriodo=L.${fin.commissionPendingPeriod}, pendienteCalle=L.${fin.commissionPendingStreet}`;
});

check('Req 7: Exportar a CSV genera archivo UTF-8 con BOM y las 6 secciones completas + UI renderiza todos los bloques', () => {
    const csv = buildGlobalStatsCsv(snapshotAll);
    assert.ok(csv.startsWith('\ufeffREPORTE DE ESTADÍSTICAS GLOBALES - HONDURAITE'));
    assert.match(csv, /1\. RESUMEN FINANCIERO Y COMISIONES/);
    assert.match(csv, /2\. EMBUDO DE VIAJES \(FUNNEL\)/);
    assert.match(csv, /3\. DESGLOSE POR SERVICIO Y COMISIÓN PROPIA/);
    assert.match(csv, /4\. MÉTRICAS DE PEDIDOS DE TIENDAS \(STORE_ORDERS\)/);
    assert.match(csv, /5\. DETALLE DE VIAJES COMPLETADOS/);
    assert.match(csv, /6\. DETALLE DE PEDIDOS DE TIENDAS/);
    assert.match(csv, /Comedor y Baleadas Doña Ana/);

    const toolbarHtml = buildStatsFiltersToolbarHtml({ city: 'comayagua', from: '2026-10-01', to: '2026-10-24' });
    assert.match(toolbarHtml, /stats-city-filter/);
    assert.match(toolbarHtml, /stats-date-from/);
    assert.match(toolbarHtml, /stats-date-to/);
    assert.match(toolbarHtml, /exportGlobalStatsCsv/);

    const bodyHtml = renderGlobalStatsHtml(snapshotAll);
    assert.match(bodyHtml, /Balance de Comisiones \(Generada vs\. Depositada vs\. Pendiente\)/);
    assert.match(bodyHtml, /Embudo de Viajes del Período/);
    assert.match(bodyHtml, /Desglose por Servicio y Comisión Propia/);
    assert.match(bodyHtml, /Pedidos de Tiendas y Restaurantes \(store_orders\)/);
    assert.match(bodyHtml, /2 en papelera excluido\(s\)/);
    return `CSV (${csv.length} chars) + HTML validados`;
});

console.log(`\nALL ${passed} TESTS PASSED!`);
