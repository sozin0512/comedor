process.env.GCLOUD_PROJECT = 'demo-hr';
// Pruebas del panel Viajes contra el emulador de Firestore:
//   firebase emulators:exec --project demo-hr --only firestore "node scripts/test-viajes-panel.cjs"
// (necesita firebase-admin instalado en functions/)
const path = require('path'); const fs = require('fs'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
const calls = [];
const fakeMessaging = { sendEachForMulticast: async (msg) => {
  calls.push({ tokens: msg.tokens.slice(), type: msg.data?.type, data: msg.data });
  const responses = msg.tokens.map(() => ({ success: true }));
  return { successCount: responses.length, responses };
} };
const msgPath = reqFn.resolve('firebase-admin/messaging');
require.cache[msgPath] = { id: msgPath, filename: msgPath, loaded: true, exports: { getMessaging: () => fakeMessaging } };
const src = fs.readFileSync(path.join(FN, 'index.js'), 'utf8') + '\nmodule.exports.__t = { viajesPanel };\n';
const m = new Module(path.join(FN, 'index.js'), module); m.filename = path.join(FN, 'index.js'); m.paths = Module._nodeModulePaths(FN);
m._compile(src, m.filename);
const fx = m.exports; const H = fx.__t.viajesPanel.helpers;
const admin = reqFn('firebase-admin/firestore'); const db = admin.getFirestore();
const APP = 'comayagua-vip-pro-v4'; const B = `artifacts/${APP}/public/data`;
const tok = (s) => `${s}:APA91b_${'x'.repeat(40)}_${s}`;
const res = []; const ok = (n, c, extra = '') => res.push([c ? 'PASS' : 'FAIL', n, extra]);
const SUP = { uid: 'SUP', token: { email: 'sup@example.com' } };
const ADM = { uid: 'ADM', token: { email: 'josuesoza0513@gmail.com' } };
const CLI = { uid: 'CLI', token: { email: 'cli@example.com' } };
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code || String(e.message || e); } };
const get = async (p) => (await db.doc(p).get()).data();
(async () => {
  const now = Date.now();
  await db.doc(`${B}/users/SUP`).set({ role: 'supervisor', name: 'Sup Uno' });
  await db.doc(`artifacts/${APP}/roles/SUP`).set({ role: 'supervisor', source: 'test' }); // rol de confianza (oct 2026)
  await db.doc(`${B}/users/ADM`).set({ role: 'admin', name: 'Josue' });
  await db.doc(`${B}/users/CLI`).set({ role: 'client', name: 'Cliente' });
  await db.doc(`${B}/users/DRV1`).set({ role: 'driver', name: 'Chofer 1', fcmTokens: { k1: { token: tok('D1'), updatedAt: now, platform: 'android', brand: 'TCL', model: 'T610K', osVersion: '13' } } });
  await db.doc(`${B}/users/DRV2`).set({ role: 'driver', name: 'Chofer 2' });
  await db.doc(`${B}/trips/T1`).set({ status: 'cancelled', clientId: 'CLI', createdAt: now - 3600e3, pin: '1234' });
  await db.doc(`${B}/trips/T2`).set({ status: 'pending', clientId: 'CLI', createdAt: now, serviceType: 'moto', candidateDriverIds: ['DRV1'] });

  // Permisos
  ok('papelera: cliente no puede', (await code(fx.staffTripsAction.run({ auth: CLI, data: { action: 'trash', tripIds: ['T1'] } }))) === 'permission-denied');
  ok('papelera: sin sesión no puede', (await code(fx.staffTripsAction.run({ data: { action: 'trash', tripIds: ['T1'] } }))) === 'unauthenticated');
  // Mover a papelera
  const r1 = await fx.staffTripsAction.run({ auth: SUP, data: { action: 'trash', tripIds: ['T1'] } });
  const t1 = await get(`${B}/trips/T1`);
  ok('papelera: supervisor mueve', r1.done === 1 && t1.trashedAtMs > 0 && t1.trashedBy === 'SUP' && t1.trashedByName === 'Sup Uno');
  ok('papelera: se borra en 30 días', Math.abs(t1.trashPurgeAfterMs - t1.trashedAtMs - 30 * 864e5) < 5);
  ok('papelera: no cambia estado', t1.status === 'cancelled' && t1.trashStatusAtMove === 'cancelled');
  // Borrar para siempre
  ok('borrar: sin BORRAR falla', (await code(fx.staffTripsAction.run({ auth: SUP, data: { action: 'purge', tripIds: ['T1'] } }))) === 'failed-precondition');
  const rp2 = await fx.staffTripsAction.run({ auth: SUP, data: { action: 'purge', tripIds: ['T2'], confirm: 'BORRAR' } });
  ok('borrar: viaje vivo no se borra', rp2.done === 0 && !!(await get(`${B}/trips/T2`)));
  // Restaurar
  await fx.staffTripsAction.run({ auth: SUP, data: { action: 'restore', tripIds: ['T1'] } });
  const t1r = await get(`${B}/trips/T1`);
  ok('restaurar: quita campos', !t1r.trashedAtMs && !t1r.trashPurgeAfterMs && t1r.restoredBy === 'SUP');
  // Revisado
  await fx.staffTripsAction.run({ auth: SUP, data: { action: 'review', tripIds: ['T1'] } });
  ok('revisado: marca', (await get(`${B}/trips/T1`)).staffReviewedAtMs > 0);
  await fx.staffTripsAction.run({ auth: SUP, data: { action: 'unreview', tripIds: ['T1'] } });
  ok('revisado: deshacer', !(await get(`${B}/trips/T1`)).staffReviewedAtMs);
  // Purga real
  await fx.staffTripsAction.run({ auth: SUP, data: { action: 'trash', tripIds: ['T1'] } });
  const rp = await fx.staffTripsAction.run({ auth: SUP, data: { action: 'purge', tripIds: ['T1'], confirm: 'BORRAR' } });
  const logs = await db.collection(`${B}/trip_purge_log`).where('tripId', '==', 'T1').get();
  ok('borrar: desde papelera borra y deja registro', rp.done === 1 && !(await get(`${B}/trips/T1`)) && logs.size === 1 && logs.docs[0].data().purgedBy === 'SUP');
  // Purga automática
  await db.doc(`${B}/trips/T3`).set({ status: 'cancelled', createdAt: now - 40 * 864e5, trashedAtMs: now - 31 * 864e5, trashPurgeAfterMs: now - 864e5 });
  await db.doc(`${B}/trips/T4`).set({ status: 'cancelled', createdAt: now - 5 * 864e5, trashedAtMs: now - 2 * 864e5, trashPurgeAfterMs: now + 28 * 864e5 });
  const pr = await H.purgeExpiredTrash(APP, now);
  ok('purga 30 d: borra vencido, deja reciente', pr.purged === 1 && !(await get(`${B}/trips/T3`)) && !!(await get(`${B}/trips/T4`)), JSON.stringify(pr));

  // Reenviar
  calls.length = 0;
  ok('reenviar: cliente no puede', (await code(fx.staffResendTrip.run({ auth: CLI, data: { tripId: 'T2' } }))) === 'permission-denied');
  const rr = await fx.staffResendTrip.run({ auth: SUP, data: { tripId: 'T2' } });
  const t2 = await get(`${B}/trips/T2`);
  ok('reenviar: avisa y cuenta', rr.ok && rr.notified >= 1 && t2.resendCount === 1 && t2.lastResendBy === 'SUP', JSON.stringify(rr));
  ok('reenviar: embudo guardado', (t2.alertNotifiedDriverIds || []).includes('DRV1') && (t2.alertFcmOkDriverIds || []).includes('DRV1') && t2.alertFirstNotifiedAtMs > 0);
  ok('reenviar: push de oferta', calls.some((c) => c.type === 'trip_offer' && c.data.tripId === 'T2'));
  await db.doc(`${B}/trips/T5`).set({ status: 'completed', clientId: 'CLI', createdAt: now, driverId: 'DRV1' });
  ok('reenviar: completado no', (await code(fx.staffResendTrip.run({ auth: SUP, data: { tripId: 'T5' } }))) === 'failed-precondition');

  // «Le llegó»
  const a1 = await fx.ackPushReceived.run({ auth: { uid: 'DRV1' }, data: { tripId: 'T2', type: 'trip_offer', via: 'sw' } });
  const t2a = await get(`${B}/trips/T2`);
  ok('llegó: conductor notificado confirma', a1.trip === true && t2a.deliveredTo?.DRV1?.via === 'sw');
  const a2 = await fx.ackPushReceived.run({ auth: { uid: 'CLI' }, data: { tripId: 'T2', type: 'trip_offer' } });
  ok('llegó: un pasajero no puede', a2.trip === false && !(await get(`${B}/trips/T2`)).deliveredTo?.CLI);
  const a3 = await fx.ackPushReceived.run({ auth: { uid: 'DRV2' }, data: { tripId: 'T5', type: 'trip_offer' } });
  ok('llegó: no notificado + no pendiente no escribe', a3.trip === false);
  ok('llegó: sin sesión falla', (await code(fx.ackPushReceived.run({ data: { tripId: 'T2' } }))) === 'unauthenticated');

  // Enviar prueba
  calls.length = 0;
  const tp = await fx.staffSendTestPush.run({ auth: SUP, data: { driverUid: 'DRV1' } });
  const d1 = await get(`${B}/users/DRV1`);
  ok('prueba: enviada y guardada', tp.sent === 1 && d1.lastPushTest?.testId === tp.testId && d1.lastPushTest.confirmedAtMs === null && calls[0]?.type === 'push_test', JSON.stringify({ sent: tp.sent, devices: tp.devices }));
  await fx.ackPushReceived.run({ auth: { uid: 'DRV1' }, data: { testId: 'otro', type: 'push_test' } });
  ok('prueba: testId ajeno no confirma', (await get(`${B}/users/DRV1`)).lastPushTest.confirmedAtMs === null);
  await fx.ackPushReceived.run({ auth: { uid: 'DRV1' }, data: { testId: tp.testId, type: 'push_test', via: 'foreground' } });
  ok('prueba: confirmada por el celular', (await get(`${B}/users/DRV1`)).lastPushTest.confirmedAtMs > 0);
  const tp2 = await fx.staffSendTestPush.run({ auth: SUP, data: { driverUid: 'DRV2' } });
  ok('prueba: sin token → sent 0', tp2.sent === 0);
  ok('prueba: cliente no puede', (await code(fx.staffSendTestPush.run({ auth: CLI, data: { driverUid: 'DRV1' } }))) === 'permission-denied');

  // PIN
  await db.doc(`${B}/trips/T6`).set({ status: 'cancelled', clientId: 'CLI', createdAt: now, pin: '9876' });
  const pin = await fx.staffRevealTripPin.run({ auth: SUP, data: { tripId: 'T6' } });
  ok('PIN: devuelve y registra', pin.pin === '9876' && (await get(`${B}/trips/T6`)).pinRevealLog?.[0]?.byUid === 'SUP');
  ok('PIN: cliente no puede', (await code(fx.staffRevealTripPin.run({ auth: CLI, data: { tripId: 'T6' } }))) === 'permission-denied');

  // Cuenta de prueba
  await fx.staffSetTestAccount.run({ auth: SUP, data: { uid: 'CLI', isTestAccount: true, kind: 'company' } });
  const cpub = await get(`${B}/users/CLI`); const cpriv = await get(`artifacts/${APP}/users/CLI/profile/data`);
  ok('prueba/empresa: marca público y privado', cpub.isTestAccount === true && cpub.testAccountKind === 'company' && cpriv?.isTestAccount === true);
  await fx.staffSetTestAccount.run({ auth: SUP, data: { uid: 'CLI', isTestAccount: false } });
  ok('prueba/empresa: quitar', (await get(`${B}/users/CLI`)).isTestAccount === false);
  ok('prueba/empresa: cliente no puede', (await code(fx.staffSetTestAccount.run({ auth: CLI, data: { uid: 'CLI', isTestAccount: false } }))) === 'permission-denied');

  // Ajustes (solo admin)
  ok('ajustes: supervisor no puede', (await code(fx.adminSetTripsPanelConfig.run({ auth: SUP, data: { commissionByService: { moto: 10 } } }))) === 'permission-denied');
  await db.doc(`${B}/platformConfig/main`).set({ commissionPercentage: 25, otherField: 'x' });
  const cfg = await fx.adminSetTripsPanelConfig.run({ auth: ADM, data: { commissionByService: { moto: 10, hourly: 25, bogus: 5, taxi: 140 }, autoResendSeconds: 2 } });
  const pc = await get(`${B}/platformConfig/main`);
  ok('ajustes: guarda solo claves válidas', JSON.stringify(pc.commissionByService) === JSON.stringify({ moto: 10, hourly: 25 }) && pc.otherField === 'x' && pc.commissionPercentage === 25, JSON.stringify(pc));
  ok('ajustes: reenvío mínimo 5 s', pc.autoResendSeconds === 5 && cfg.autoResendSeconds === 5);
  await fx.adminSetTripsPanelConfig.run({ auth: ADM, data: { commissionByService: { moto: 12 }, autoResendSeconds: 10, commissionPercentage: 18 } });
  const pc2 = await get(`${B}/platformConfig/main`);
  ok('ajustes: % general y reemplazo del mapa', pc2.commissionPercentage === 18 && JSON.stringify(pc2.commissionByService) === '{"moto":12}' && pc2.autoResendSeconds === 10);
  // Editor de Cuentas bancarias: % de Tiendas y sin mandar el reenvío (no debe cambiarlo)
  await db.doc(`${B}/platformConfig/main`).update({ autoResendSeconds: 37 });
  await fx.adminSetTripsPanelConfig.run({ auth: ADM, data: { commissionByService: { moto: 11, tiendas: 7 }, commissionPercentage: 18 } });
  const pc3 = (await db.doc(`${B}/platformConfig/main`).get()).data();
  ok('ajustes: acepta % de Tiendas', pc3.commissionByService.tiendas === 7 && pc3.commissionByService.moto === 11);
  ok('ajustes: sin autoResendSeconds no toca el reenvío', pc3.autoResendSeconds === 37);
  await fx.adminSetTripsPanelConfig.run({ auth: ADM, data: { commissionByService: { moto: 12 }, autoResendSeconds: 10, commissionPercentage: 18 } });
  ok('ajustes: % general fuera de rango', (await code(fx.adminSetTripsPanelConfig.run({ auth: ADM, data: { commissionPercentage: 150 } }))) === 'invalid-argument');
  const gc = await H.getTripsPanelConfig(APP);
  ok('config: lee 10 s y mapa', gc.autoResendSeconds === 10 && gc.commissionByService.moto === 12);
  await db.doc(`${B}/platformConfig/main`).update({ autoResendSeconds: admin.FieldValue.delete() });
  ok('config: sin valor → 10 s por defecto', (await H.getTripsPanelConfig(APP)).autoResendSeconds === 10);

  // Reenvío automático (5 s para la prueba)
  await db.doc(`${B}/platformConfig/main`).update({ autoResendSeconds: 5 });
  const t7 = { status: 'pending', clientId: 'CLI', createdAt: Date.now(), serviceType: 'moto', candidateDriverIds: ['DRV1'] };
  await db.doc(`${B}/trips/T7`).set(t7);
  const t8 = { ...t7, createdAt: Date.now() };
  await db.doc(`${B}/trips/T8`).set(t8);
  const t9 = { ...t7, createdAt: Date.now(), scheduledFor: Date.now() + 3 * 3600e3 };
  await db.doc(`${B}/trips/T9`).set(t9);
  setTimeout(() => db.doc(`${B}/trips/T8`).update({ 'driverBids.DRV1': { price: 50 } }), 1500);
  const t0 = Date.now();
  const [ar7, ar8, ar9] = await Promise.all([H.runAutoResend(APP, 'T7', t7), H.runAutoResend(APP, 'T8', t8), H.runAutoResend(APP, 'T9', t9)]);
  const waited = Date.now() - t0;
  const g7 = await get(`${B}/trips/T7`);
  ok('auto: espera los segundos configurados', waited >= 4500 && waited < 9000, `${waited} ms`);
  ok('auto: sin ofertas → reenvía 1 vez', ar7.ok === true && g7.resendCount === 1 && g7.autoResendAtMs > 0 && g7.autoResendAfterSeconds === 5 && g7.lastResendReason === 'auto');
  ok('auto: con oferta → no reenvía', ar8.ok === false && !(await get(`${B}/trips/T8`)).resendCount);
  ok('auto: programado para luego → no reenvía', ar9.ok === false);
  const again = await H.runAutoResend(APP, 'T7', g7);
  ok('auto: segunda vez no repite', again.ok === false && (await get(`${B}/trips/T7`)).resendCount === 1);

  for (const r of res) console.log(...r);
  console.log(res.every((r) => r[0] === 'PASS') ? 'TODO OK' : 'HAY FALLOS');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
