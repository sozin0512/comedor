/** v.42 Pedido doble: reglas + servidor (Firestore falso). node scripts/test-pedido-doble.mjs */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tmp = new URL('./.pd-rules-tmp.mjs', import.meta.url);
fs.copyFileSync(new URL('../js/pedido-doble-rules.js', import.meta.url), tmp);
const R = await import(tmp.href); fs.unlinkSync(tmp);
const S = require('../functions/pedido-doble.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(cond ? 'PASS' : 'FAIL', name, extra); };

// Paridad: el bloque de reglas del servidor es copia exacta del cliente
const cli = fs.readFileSync(new URL('../js/pedido-doble-rules.js', import.meta.url), 'utf8').replace(/export /g, '');
const srv = fs.readFileSync(new URL('../functions/pedido-doble.js', import.meta.url), 'utf8');
t('paridad reglas cliente/servidor', srv.includes(cli));

const STORE = { lat: 14.0818, lng: -87.2068 };
const base = (o = {}) => ({ storeOrderId: 'o', storeId: 'campero', storeName: 'Pollo Campero', serviceType: 'delivery',
    originLat: STORE.lat, originLng: STORE.lng, ...o });
const act = base({ id: 'A', status: 'accepted', driverId: 'd1', destinationLat: 14.0950, destinationLng: -87.2000 });
const near = base({ id: 'B', status: 'pending', destinationLat: 14.0990, destinationLng: -87.1990 });       // ~0.5 km del 1º
const onWay = base({ id: 'C', status: 'pending', destinationLat: 14.1080, destinationLng: -87.1930 });      // ~1.6 km más allá, de paso
const far = base({ id: 'D', status: 'pending', destinationLat: 14.0300, destinationLng: -87.2600 });        // al otro lado
const pax = { id: 'P', status: 'pending', serviceType: 'auto', originLat: STORE.lat, originLng: STORE.lng, destinationLat: 14.095, destinationLng: -87.2 };
const otherStoreNear = base({ id: 'E', status: 'pending', storeId: 'pizza', originLat: 14.0830, originLng: -87.2060, destinationLat: 14.0960, destinationLng: -87.2005 }); // ~160 m
const otherStoreFar = base({ id: 'F', status: 'pending', storeId: 'burger', originLat: 14.0900, originLng: -87.2068, destinationLat: 14.0960, destinationLng: -87.2005 }); // ~900 m
const zone = (o) => base({ zoneBilling: true, destinationLat: null, destinationLng: null, ...o });

t('mismo negocio + entrega cerca', R.pdCanPair(act, near).ok && R.pdCanPair(act, near).reason === 'entrega_cerca', JSON.stringify(R.pdCanPair(act, near)));
const w = R.pdCanPair(act, onWay); t('entrega de paso (≤3 km desvío)', w.ok && w.reason === 'entrega_de_paso', JSON.stringify(w));
t('entrega lejos → no', R.pdCanPair(act, far).reason === 'entrega_lejos', JSON.stringify(R.pdCanPair(act, far)));
t('viaje de pasajero → no', R.pdCanPair(act, pax).reason === 'no_es_pedido_de_negocio');
t('otro negocio a ≤300 m → sí', R.pdCanPair(act, otherStoreNear).ok);
t('otro negocio lejos → no', R.pdCanPair(act, otherStoreFar).reason === 'recogida_lejos');
t('ya recogido el 1º → no', R.pdCanPair({ ...act, status: 'in_progress' }, near).reason === 'primer_pedido_ya_recogido');
t('máximo 2 (ya en pedido doble) → no', R.pdCanPair({ ...act, batchId: 'x' }, near).reason === 'ya_es_pedido_doble');
t('programado → no', R.pdCanPair(act, { ...near, scheduledFor: 1 }).reason === 'programado');
t('zona + zona mismo negocio → sí', R.pdCanPair(zone({ id: 'Z1', status: 'accepted', driverId: 'd1' }), zone({ id: 'Z2', status: 'pending' })).reason === 'zona_mismo_negocio');
t('zona + zona otro negocio (cerca) → no', R.pdCanPair(zone({ id: 'Z1', status: 'accepted' }), zone({ id: 'Z3', status: 'pending', storeId: 'pizza', originLat: 14.0830 })).reason === 'zona_otro_negocio');
t('zona + con destino → no', R.pdCanPair(act, zone({ id: 'Z4', status: 'pending' })).reason === 'zona_mezclada');
t('en el negocio: marcó llegada', R.pdAtStore({ ...act, driverArrived: true }, null));
t('en el negocio: GPS a 100 m', R.pdAtStore(act, { lat: STORE.lat + 0.0009, lng: STORE.lng }));
t('no en el negocio: GPS a 400 m', !R.pdAtStore(act, { lat: STORE.lat + 0.0036, lng: STORE.lng }));
t('prioridad solo mismo negocio', R.pdPriority({ ...act, driverArrived: true }, near, null) && !R.pdPriority({ ...act, driverArrived: true }, otherStoreNear, null));
t('orden de entrega: más cercano primero', R.pdDeliveryOrder(onWay, near)[0].id === 'B');

// ---- Firestore falso ----
function fakeDb(docs) {
    const store = new Map(Object.entries(docs));
    const snap = (path) => ({ exists: store.has(path), id: path.split('/').pop(), data: () => store.get(path), get: (k) => (store.get(path) || {})[k] });
    const apply = (path, patch) => {
        const cur = { ...(store.get(path) || {}) };
        for (const [k, v] of Object.entries(patch)) {
            if (v && v.__del) delete cur[k]; else if (v && v.__union) cur[k] = [...new Set([...(cur[k] || []), ...v.__union])]; else cur[k] = v;
        }
        store.set(path, cur);
    };
    const ref = (path) => ({ path, get: async () => snap(path), set: async (p) => apply(path, p), update: async (p) => apply(path, p) });
    return {
        store,
        doc: ref,
        runTransaction: async (fn) => fn({ get: async (r) => snap(r.path), update: (r, p) => apply(r.path, p), set: (r, p) => apply(r.path, p) }),
    };
}
const FV = { delete: () => ({ __del: 1 }), serverTimestamp: () => 'TS', arrayUnion: (...a) => ({ __union: a }) };
const P = (id) => `artifacts/app/public/data/trips/${id}`;
{
    const db = fakeDb({ [P('A')]: act, [P('B')]: near, [P('D')]: far });
    const r = await S.acceptBatchedTrip({ db, FieldValue: FV, appId: 'app', uid: 'd1', tripId: 'B', batchWithTripId: 'A', patch: { status: 'accepted', driverFinishingOtherTrip: true } });
    const a = db.store.get(P('A')), b = db.store.get(P('B'));
    t('servidor: acepta pedido doble', r.ok && a.batchId === b.batchId && b.status === 'accepted' && b.driverId === 'd1' && a.batchIndex === 1 && b.batchIndex === 2 && b.driverFinishingOtherTrip === false, JSON.stringify(r));
    const r2 = await S.acceptBatchedTrip({ db, FieldValue: FV, appId: 'app', uid: 'd1', tripId: 'D', batchWithTripId: 'A', patch: {} });
    t('servidor: 3º pedido rechazado (máx 2)', !r2.ok && db.store.get(P('D')).status === 'pending', r2.msg);
    const db2 = fakeDb({ [P('A')]: act, [P('D')]: far });
    const r3 = await S.acceptBatchedTrip({ db: db2, FieldValue: FV, appId: 'app', uid: 'd1', tripId: 'D', batchWithTripId: 'A', patch: {} });
    t('servidor: entrega lejos rechazada', !r3.ok && /entrega_lejos/.test(r3.msg));
    const db3 = fakeDb({ [P('A')]: act, [P('B')]: near });
    const r4 = await S.acceptBatchedTrip({ db: db3, FieldValue: FV, appId: 'app', uid: 'otro', tripId: 'B', batchWithTripId: 'A', patch: {} });
    t('servidor: no es tu pedido activo', !r4.ok);
    const db4 = fakeDb({ [P('A')]: act, [P('B')]: { ...near, status: 'accepted', driverId: 'd9' } });
    const r5 = await S.acceptBatchedTrip({ db: db4, FieldValue: FV, appId: 'app', uid: 'd1', tripId: 'B', batchWithTripId: 'A', patch: {} });
    t('servidor: otro ya lo tomó (carrera)', !r5.ok);
}
{
    const arrived = { ...act, driverArrived: true, driverName: 'Cristian' };
    const docs = { [P('A')]: arrived, [P('B')]: near, 'artifacts/app/public/data/drivers_location/d1': { lat: STORE.lat, lng: STORE.lng } };
    const db = fakeDb(docs);
    const tripDocs = [{ id: 'A', data: () => arrived }];
    const ok = await S.offerAtStorePriority({ db, FieldValue: FV, appId: 'app', trip: near, tripDocs });
    const b = db.store.get(P('B'));
    t('prioridad: oferta exclusiva 25 s al que está en el negocio', ok && b.offeredToDriverId === 'd1' && b.offerWindowSec === 25 && b.offerPedidoDoble === true && b.offerBatchWithTripId === 'A', JSON.stringify(b));
    const again = await S.offerAtStorePriority({ db, FieldValue: FV, appId: 'app', trip: { ...near, ...b }, tripDocs });
    t('prioridad: una sola vez por repartidor (luego rotación normal)', again === false);
    const db2 = fakeDb({ [P('A')]: act, [P('B')]: near, 'artifacts/app/public/data/drivers_location/d1': { lat: STORE.lat + 0.01, lng: STORE.lng } });
    t('prioridad: lejos del negocio → no', (await S.offerAtStorePriority({ db: db2, FieldValue: FV, appId: 'app', trip: near, tripDocs: [{ id: 'A', data: () => act }] })) === false);
    const db3 = fakeDb({ [P('A')]: act, [P('B')]: near, 'artifacts/app/public/data/drivers_location/d1': { lat: STORE.lat + 0.0005, lng: STORE.lng } });
    t('prioridad: a ≤150 m por GPS → sí', (await S.offerAtStorePriority({ db: db3, FieldValue: FV, appId: 'app', trip: near, tripDocs: [{ id: 'A', data: () => act }] })) === true);
}
{
    let handler;
    const db = fakeDb({ [P('B')]: { status: 'in_progress', batchId: 'pd' } });
    S.makeBatchCancelTrigger({ db, FieldValue: FV, onDocumentUpdated: (_p, fn) => { handler = fn; return fn; } });
    const ev = (before, after) => ({ params: { appId: 'app', tripId: 'A' }, data: { before: { data: () => before }, after: { data: () => after } } });
    await handler(ev({ status: 'in_progress', batchId: 'pd', storePickedUpAt: 1 }, { status: 'cancelled', batchId: 'pd', batchTripIds: ['A', 'B'] }));
    const b = db.store.get(P('B'));
    t('cancelación tras recoger: el otro pide devolver al negocio', b.batchPartnerCancelledTripId === 'A' && b.batchPartnerReturnToStore === true);
    const db2 = fakeDb({ [P('B')]: { status: 'accepted' } });
    S.makeBatchCancelTrigger({ db: db2, FieldValue: FV, onDocumentUpdated: (_p, fn) => { handler = fn; return fn; } });
    await handler(ev({ status: 'accepted', batchId: 'pd' }, { status: 'cancelled', batchId: 'pd', batchTripIds: ['A', 'B'] }));
    t('cancelación antes de recoger: sin devolución', db2.store.get(P('B')).batchPartnerReturnToStore === false);
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
