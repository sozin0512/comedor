process.env.GCLOUD_PROJECT = 'demo-hr';
// Comisión HonduRaite en el servidor (functions/trip-commission.js): lógica pura + trigger (emulador firestore).
//   firebase emulators:exec --project demo-hr --only firestore "node scripts/test-comision-servidor.cjs"
// Sin emulador (FIRESTORE_EMULATOR_HOST vacío) solo corre la parte pura.
const path = require('path'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
const TC = reqFn('./trip-commission');
const FD = reqFn('./commission-free-day');
const R = []; const ok = (n, c, x = '') => R.push([c ? 'PASS' : 'FAIL', n, x]);
const NOW = Date.UTC(2026, 9, 23, 18, 0, 0); // vie 23 oct 2026 12:00 HN
const PC = { commissionPercentage: 20, commissionByService: { tiendas: 25, moto: 15, delivery: 18 } };
const direct = { status: 'completed', serviceType: 'delivery', createdByMerchant: true, merchantDirectDelivery: true, priceNum: 35, price: 'L. 35.00', paymentMethod: 'efectivo', driverId: 'drvA',
  deliveryDetails: { collectAmount: 250, itemsTotal: 250, customerTotal: 285 } };
const c = (trip, o = {}) => TC.computeTripCommission({ trip, platformConfig: PC, freeDayConfig: {}, driverProfile: { role: 'driver' }, nowMs: NOW, ...o });

let r = c(direct);
ok('envío directo: % «Tiendas» del admin (25%) solo sobre el envío', r.key === 'tiendas' && r.pct === 25 && r.amount === 8.75 && r.net === 26.25 && r.base === 35, JSON.stringify(r?.patch));
ok('productos L. 250 NO cuentan para la comisión', r.base === 35);
r = c({ ...direct, storeOrderId: 'O1', createdByMerchant: false });
ok('pedido de tienda también usa «Tiendas»', r.key === 'tiendas' && r.amount === 8.75);
r = c(direct, { platformConfig: { commissionPercentage: 20, commissionByService: { delivery: 18 } } });
ok('sin % de Tiendas → usa el de Envío', r.pct === 18 && r.source === 'service:delivery');
r = c({ serviceType: 'moto', priceNum: 60, driverId: 'drvA' });
ok('moto: su % propio (15%)', r.pct === 15 && r.amount === 9);
r = c({ serviceType: 'taxi', priceNum: 100, driverId: 'drvA' });
ok('servicio sin % propio → general (20%)', r.pct === 20 && r.amount === 20 && r.source === 'general');
r = c({ serviceType: 'flete_camion', priceNum: 100 }, { platformConfig: { commissionPercentage: 20, commissionByService: { flete: 10 } } });
ok('flete_camion usa la clave flete', r.key === 'flete' && r.pct === 10);
r = c({ serviceType: 'auto', bookingType: 'hourly', priceNum: 200 }, { platformConfig: { commissionByService: { hourly: 12 } } });
ok('por horas: clave hourly', r.key === 'hourly' && r.amount === 24);
ok('sin ningún % configurado → no escribe (null), no inventa', c(direct, { platformConfig: {} }) === null && c(direct, { platformConfig: null }) === null);
r = c(direct, { driverProfile: { role: 'driver', birthDate: '1990-10-23' } });
ok('cumpleaños del conductor (hora HN) → 0%', r.pct === 0 && r.amount === 0 && r.waived === 'driver_birthday' && r.net === 35);
ok('otro día no es cumpleaños', c(direct, { driverProfile: { role: 'driver', birthDate: '1990-10-24' } }).pct === 25);
let free = null; for (let i = 0; i < 500 && !free; i++) if (FD.isDriverFreeCommissionDayToday('d' + i, new Date(NOW))) free = 'd' + i;
let notFree = null; for (let i = 0; i < 500 && !notFree; i++) if (!FD.isDriverFreeCommissionDayToday('d' + i, new Date(NOW))) notFree = 'd' + i;
const fdc = { enabled: true, defaultCityEnabled: true };
r = c({ ...direct, driverId: free, serviceZoneId: 'comayagua' }, { freeDayConfig: fdc });
ok('día sin comisión rotativo del conductor → 0%', free && r.pct === 0 && r.waived === 'free_day');
ok('día sin comisión: otro conductor sí paga', c({ ...direct, driverId: notFree, serviceZoneId: 'comayagua' }, { freeDayConfig: fdc }).pct === 25);
ok('programa apagado → paga', c({ ...direct, driverId: free, serviceZoneId: 'comayagua' }, { freeDayConfig: { enabled: false } }).pct === 25);
r = c({ serviceType: 'moto', priceNum: 0, birthdayFree: true, originalPriceNum: 50, paymentMethod: 'birthday_gift' });
ok('regalo de cumpleaños del pasajero → 0% sobre el precio original', r.pct === 0 && r.base === 50 && r.waived === 'passenger_birthday_gift');
r = c({ ...direct, commissionAmount: 1, commissionPercent: 2.86, commissionFreeDay: true });
ok('la app NO decide: commissionAmount/commissionFreeDay del cliente se ignoran', r.amount === 8.75 && r.patch.serverCommissionClientAmount === 1);
ok('precio en texto si no hay priceNum', c({ serviceType: 'moto', price: 'L. 80.00' }).amount === 12);
ok('las claves server* son las de las reglas', require('fs').readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8').includes(TC.SERVER_COMMISSION_KEYS.map((k) => `'${k}'`).slice(0, 4).join(', ')));

(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const fakeMessaging = { sendEachForMulticast: async (m) => ({ successCount: m.tokens.length, responses: m.tokens.map(() => ({ success: true })) }) };
    const mp = reqFn.resolve('firebase-admin/messaging');
    require.cache[mp] = { id: mp, filename: mp, loaded: true, exports: { getMessaging: () => fakeMessaging } };
    const fx = reqFn('./index.js');
    const db = reqFn('firebase-admin/firestore').getFirestore();
    const APP = 'comayagua-vip-pro-v4'; const B = `artifacts/${APP}/public/data`;
    await db.doc(`${B}/platformConfig/main`).set(PC);
    await db.doc(`${B}/users/drvA`).set({ role: 'driver', birthDate: '1990-01-01' });
    const run = async (id, before, after) => {
      const ref = db.doc(`${B}/trips/${id}`); await ref.set(after);
      await fx.onTripCompletedCommission.run({ params: { appId: APP, tripId: id }, data: { before: { data: () => before }, after: { data: () => after, ref } } });
      return (await ref.get()).data();
    };
    let t = await run('T1', { ...direct, status: 'in_progress' }, { ...direct, commissionAmount: 0.5, commissionPercent: 1 });
    ok('trigger: escribe la comisión oficial al completar', t.serverCommissionAmount === 8.75 && t.serverCommissionPercent === 25 && t.serverDriverNet === 26.25 && t.serverCommissionKey === 'tiendas', JSON.stringify(t));
    ok('trigger: guarda lo que puso la app (0.50) para auditar, sin usarlo', t.serverCommissionClientAmount === 0.5 && t.commissionAmount === 0.5);
    t = await run('T2', { ...direct, status: 'completed' }, { ...direct, note: 'editado' });
    ok('trigger: viaje que YA estaba completado no se recalcula (viejos quedan igual)', t.serverCommissionAtMs == null);
    t = await run('T3', { ...direct, status: 'accepted' }, { ...direct, status: 'in_progress' });
    ok('trigger: viaje en curso no se toca', t.serverCommissionAtMs == null);
    await db.doc(`${B}/platformConfig/main`).delete();
    t = await run('T4', { ...direct, status: 'in_progress' }, { ...direct });
    ok('trigger: sin % configurado no escribe nada', t.serverCommissionAtMs == null);
  } else {
    console.log('(sin emulador: se omite la parte del trigger)');
  }
  for (const x of R) console.log(x[0], x[1], x[0] === 'FAIL' ? x[2] : '');
  const pass = R.filter((x) => x[0] === 'PASS').length;
  console.log(`${pass}/${R.length} PASS`);
  process.exit(pass === R.length ? 0 : 1);
})();
