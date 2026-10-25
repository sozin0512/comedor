import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

async function importEsmFile(relPath) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    return import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'));
}

const {
    TRIP_STORE_OFFER_STEP_SEC,
    TRIP_STORE_OFFER_STEP_MS,
    isStoreDeliveryTrip,
    getStoreOfferWindowSec,
    getStoreOfferExpiresAtMs,
    isStoreOfferExclusiveActive,
    isStoreOfferWindowExpired,
    getStoreOfferRemainingSec,
    computeDriverStoreDeliveryStatsToday,
    rankDriversForStoreDelivery,
    planNextStoreDeliveryOffer,
    storeExclusiveTurnBadgeHtml,
} = await importEsmFile('js/store-delivery-rotation.js');

const cjsRotation = require('../functions/store-delivery-rotation.js');

let passed = 0;
let failed = 0;

async function check(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ❌ ${name}:`, err?.message || err);
    }
}

console.log('\n── 1. Alcance: SOLO envíos de tiendas (viajes normales intactos) ──');

await check('TRIP_STORE_OFFER_STEP_SEC es exactamente 15 segundos (15,000 ms)', () => {
    assert.equal(TRIP_STORE_OFFER_STEP_SEC, 15);
    assert.equal(TRIP_STORE_OFFER_STEP_MS, 15000);
    assert.equal(cjsRotation.TRIP_STORE_OFFER_STEP_SEC, 15);
});

await check('isStoreDeliveryTrip detecta todos los tipos de envíos de tienda y excluye viajes normales', () => {
    assert.equal(isStoreDeliveryTrip({ storeOrderId: 'ord_1', serviceType: 'delivery' }), true);
    assert.equal(isStoreDeliveryTrip({ storeDelivery: true, serviceType: 'delivery' }), true);
    assert.equal(isStoreDeliveryTrip({ createdByMerchant: true, merchantDirectDelivery: true }), true);
    assert.equal(isStoreDeliveryTrip({ deliveryDetails: { storeOrderId: 'ord_2' } }), true);
    assert.equal(isStoreDeliveryTrip({ createdVia: 'whatsapp_store', waStoreId: 'st_1' }), true);

    // Viajes normales de pasajeros o envíos particulares NO son envíos de tienda
    assert.equal(isStoreDeliveryTrip({ serviceType: 'auto', status: 'pending' }), false);
    assert.equal(isStoreDeliveryTrip({ serviceType: 'moto', status: 'pending' }), false);
    assert.equal(isStoreDeliveryTrip({ serviceType: 'taxi', status: 'pending' }), false);
    assert.equal(isStoreDeliveryTrip({ serviceType: 'delivery', status: 'pending', createdByMerchant: false }), false);
    assert.equal(
        isStoreOfferExclusiveActive({
            serviceType: 'auto',
            status: 'pending',
            offerPhase: 'exclusive',
            offeredToDriverId: 'drv1',
            offerExpiresAtMs: Date.now() + 15000,
        }),
        false,
        'Un viaje normal de pasajero jamás activa ventana exclusiva de tienda'
    );
});

console.log('\n── 2. Cola de rotación justa (menos envíos hoy → desempate por distancia y aceptación) ──');

await check('Conductor B (0 envíos hoy a 0.8 km) va ANTES que Conductor A (3 envíos hoy a 0.2 km)', () => {
    const nowMs = Date.parse('2026-10-25T18:00:00Z'); // 12:00 PM Honduras
    const storeTrip = {
        id: 'trip_sopota_1',
        status: 'pending',
        serviceType: 'delivery',
        storeDelivery: true,
        createdByMerchant: true,
        storeOrderId: 'ord_sopota_1',
        originLat: 14.4600,
        originLng: -87.6400,
    };

    const todayTrips = [
        { driverId: 'driverA', status: 'completed', storeDelivery: true, completedAt: nowMs - 7200_000 },
        { driverId: 'driverA', status: 'completed', storeDelivery: true, completedAt: nowMs - 3600_000 },
        { driverId: 'driverA', status: 'completed', storeDelivery: true, completedAt: nowMs - 1800_000 },
        { driverId: 'driverC', status: 'completed', storeDelivery: true, completedAt: nowMs - 5400_000 },
    ];

    const candidates = [
        { driverId: 'driverA', name: 'Carlos (3 envíos hoy)', distanceKm: 0.2, acceptanceRate: 98 },
        { driverId: 'driverB', name: 'Luis (0 envíos hoy)', distanceKm: 0.8, acceptanceRate: 95 },
        { driverId: 'driverC', name: 'Mario (1 envío hoy)', distanceKm: 0.5, acceptanceRate: 96 },
    ];

    const ranked = rankDriversForStoreDelivery(candidates, storeTrip, { tripDocs: todayTrips, nowMs });
    assert.deepEqual(
        ranked.map((r) => r.driverId),
        ['driverB', 'driverC', 'driverA'],
        'Orden justo: primero Luis (0 hoy), luego Mario (1 hoy), luego Carlos (3 hoy)'
    );
    assert.equal(ranked[0].storeDeliveriesToday, 0);
    assert.equal(ranked[1].storeDeliveriesToday, 1);
    assert.equal(ranked[2].storeDeliveriesToday, 3);

    const rankedCjs = cjsRotation.rankDriversForStoreDelivery(candidates, storeTrip, { tripDocs: todayTrips, nowMs });
    assert.deepEqual(rankedCjs.map((r) => r.driverId), ['driverB', 'driverC', 'driverA']);
});

await check('Desempate a igual número de envíos hoy: más cercano al local y mejor tasa de aceptación', () => {
    const nowMs = Date.parse('2026-10-25T18:00:00Z');
    const storeTrip = { id: 'trip_tie', status: 'pending', storeDelivery: true };
    const candidates = [
        { driverId: 'drv_far', name: 'Lejos', distanceKm: 1.4, storeDeliveriesToday: 0, acceptanceRate: 95 },
        { driverId: 'drv_near', name: 'Cerca', distanceKm: 0.3, storeDeliveriesToday: 0, acceptanceRate: 90 },
        { driverId: 'drv_near_hi', name: 'Cerca Mejor Tasa', distanceKm: 0.3, storeDeliveriesToday: 0, acceptanceRate: 99 },
    ];
    const ranked = rankDriversForStoreDelivery(candidates, storeTrip, { nowMs });
    assert.deepEqual(ranked.map((r) => r.driverId), ['drv_near_hi', 'drv_near', 'drv_far']);
});

console.log('\n── 3. Simulación paso a paso: Turno 1 (15s) → Turno 2 (15s) → Fallback Ciudad Abierta ──');

await check('Flujo completo: Turno 1 (Driver B, 15s) → vence → Turno 2 (Driver A, 15s) → vence → Ciudad Abierta (todos)', () => {
    const t0 = Date.parse('2026-10-25T18:00:00Z');
    const candidates = [
        { driverId: 'driverA', name: 'Carlos (3 envíos hoy · 0.2 km)', distanceKm: 0.2, storeDeliveriesToday: 3 },
        { driverId: 'driverB', name: 'Luis (0 envíos hoy · 0.8 km)', distanceKm: 0.8, storeDeliveriesToday: 0 },
    ];

    let trip = {
        id: 'trip_rot_15s',
        status: 'pending',
        serviceType: 'delivery',
        storeDelivery: true,
        createdByMerchant: true,
        storeOrderId: 'ord_99',
        offerPhase: 'exclusive',
        offerWindowSec: 15,
        offeredToDriverId: null,
        offeredHistoryIds: [],
        declinedDriverIds: [],
    };

    // Paso 1 (t = 0s): se asigna Turno #1 a Driver B (0 envíos hoy) por 15 segundos
    const step1 = planNextStoreDeliveryOffer(trip, candidates, { nowMs: t0 });
    assert.equal(step1.phase, 'exclusive');
    assert.equal(step1.nextDriver.driverId, 'driverB');
    assert.equal(step1.stepIndex, 1);
    assert.equal(step1.offerWindowSec, 15);
    assert.equal(step1.offerExpiresAtMs, t0 + 15000);
    assert.deepEqual(step1.offeredHistoryIds, ['driverB']);
    assert.deepEqual(step1.offerQueueDriverIds, ['driverB', 'driverA']);

    trip = {
        ...trip,
        offerPhase: step1.phase,
        offerWindowSec: step1.offerWindowSec,
        offeredToDriverId: step1.nextDriver.driverId,
        offeredToDriverName: step1.nextDriver.name,
        offerSentAt: t0,
        offerExpiresAtMs: step1.offerExpiresAtMs,
        offerStepIndex: step1.stepIndex,
        offeredHistoryIds: step1.offeredHistoryIds,
        offerQueueDriverIds: step1.offerQueueDriverIds,
    };

    // A los t = +6s (faltan 9s): Turno #1 sigue activo exclusivamente para Driver B
    assert.equal(isStoreOfferExclusiveActive(trip, t0 + 6000), true);
    assert.equal(isStoreOfferWindowExpired(trip, t0 + 6000), false);
    assert.equal(getStoreOfferRemainingSec(trip, t0 + 6000), 9);

    const badgeTurn1 = storeExclusiveTurnBadgeHtml(trip, { nowMs: t0 + 6000 });
    assert.match(badgeTurn1, /Turno exclusivo:/);
    assert.match(badgeTurn1, /9s/);
    assert.match(badgeTurn1, /Turno 1\/2/);

    // A los t = +15s: vence el turno de 15s de Driver B sin aceptar → pasa a Turno #2 (Driver A)
    const t1 = t0 + 15000;
    assert.equal(isStoreOfferWindowExpired(trip, t1), true);
    assert.equal(isStoreOfferExclusiveActive(trip, t1), false);

    const step2 = planNextStoreDeliveryOffer(trip, candidates, { nowMs: t1 });
    assert.equal(step2.phase, 'exclusive');
    assert.equal(step2.nextDriver.driverId, 'driverA');
    assert.equal(step2.stepIndex, 2);
    assert.equal(step2.offerExpiresAtMs, t1 + 15000);
    assert.deepEqual(step2.offeredHistoryIds, ['driverB', 'driverA']);

    trip = {
        ...trip,
        offerPhase: step2.phase,
        offerWindowSec: step2.offerWindowSec,
        offeredToDriverId: step2.nextDriver.driverId,
        offeredToDriverName: step2.nextDriver.name,
        offerSentAt: t1,
        offerExpiresAtMs: step2.offerExpiresAtMs,
        offerStepIndex: step2.stepIndex,
        offeredHistoryIds: step2.offeredHistoryIds,
        offerQueueDriverIds: step2.offerQueueDriverIds,
    };

    // A los t = +20s (faltan 10s del Turno #2): exclusivo para Driver A
    assert.equal(isStoreOfferExclusiveActive(trip, t1 + 5000), true);
    assert.equal(getStoreOfferRemainingSec(trip, t1 + 5000), 10);

    // A los t = +30s: vence también el turno de 15s de Driver A → Fallback a 'city' (abierto a todos)
    const t2 = t1 + 15000;
    assert.equal(isStoreOfferWindowExpired(trip, t2), true);

    const step3 = planNextStoreDeliveryOffer(trip, candidates, { nowMs: t2 });
    assert.equal(step3.phase, 'city');
    assert.equal(step3.nextDriver, null);

    trip = {
        ...trip,
        offerPhase: 'city',
        offeredToDriverId: null,
        offeredToDriverName: null,
        offerExpiresAtMs: null,
        offeredHistoryIds: step3.offeredHistoryIds,
    };

    // En 'city', isStoreOfferExclusiveActive es false → visible para TODOS los repartidores en línea
    assert.equal(isStoreOfferExclusiveActive(trip, t2 + 1000), false);
    const badgeOpenCity = storeExclusiveTurnBadgeHtml(trip, { nowMs: t2 + 1000 });
    assert.match(badgeOpenCity, /Disponible para todos los repartidores en línea/);
});

console.log('\n── 4. Verificación de playNewOrderTone y sintaxis ES Module ──');

await check('js/merchant-stores.js define playNewOrderTone y testMerchantOrderAlert no lanza ReferenceError', () => {
    const msPath = path.join(ROOT, 'js/merchant-stores.js');
    const msCode = fs.readFileSync(msPath, 'utf8');
    new vm.SourceTextModule(msCode, { identifier: msPath });
    assert.match(msCode, /function playNewOrderTone\(\)/);
    assert.match(msCode, /window\.playNewOrderTone\s*=\s*playNewOrderTone/);
});

console.log(`\nResultado: ${passed} pasaron, ${failed} fallaron\n`);
if (failed > 0) process.exit(1);
