process.env.GCLOUD_PROJECT = 'demo-hr';
// Pestaña «Avisos» del panel Viajes: staffDriverPushStatus + staffNudgeDriverPush.
// Emuladores firestore + auth. WhatsApp y FCM son FALSOS (no sale ningún mensaje real):
//   firebase emulators:exec --project demo-hr --only firestore,auth "node scripts/test-driver-push-status.cjs"
const path = require('path'); const fs = require('fs'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
const fakeMessaging = { sendEachForMulticast: async (msg) => {
  const responses = msg.tokens.map((t) => (t.includes('DEAD') ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true }));
  return { successCount: responses.filter((r) => r.success).length, responses };
} };
const msgPath = reqFn.resolve('firebase-admin/messaging');
require.cache[msgPath] = { id: msgPath, filename: msgPath, loaded: true, exports: { getMessaging: () => fakeMessaging } };
// WhatsApp falso: se parchea el módulo real ya cacheado (el callable lo pide con require).
const wa = reqFn('./whatsapp-cloud');
const sent = []; let TEMPLATE = ''; const INBOUND = new Map(); let templateWantsOneParam = false;
wa.sendCloudTextLogged = async (to, body, meta) => { sent.push({ kind: 'text', to, body, meta }); return { ok: true, messageId: `wamid.${sent.length}` }; };
wa.sendWhatsAppTemplate = async (to, name, params) => {
  if (templateWantsOneParam && params.length !== 1) return { ok: false, error: { error: { code: 132000, message: 'number of params' } } };
  sent.push({ kind: 'template', to, name, params }); return { ok: true, result: { messages: [{ id: `wamid.t${sent.length}` }] } };
};
wa.lastInboundAtMs = async (to) => INBOUND.get(wa.normalizeWaPhone(to)) || 0;
wa.driverPushActivateTemplateName = () => TEMPLATE;
const src = fs.readFileSync(path.join(FN, 'index.js'), 'utf8') + '\nmodule.exports.__t = { driverPushStatus, sendPushToUser };\n';
const m = new Module(path.join(FN, 'index.js'), module); m.filename = path.join(FN, 'index.js'); m.paths = Module._nodeModulePaths(FN);
m._compile(src, m.filename);
const fx = m.exports; const T = fx.__t;
const DPS = reqFn('./driver-push-status');
const admin = reqFn('firebase-admin/firestore'); const db = admin.getFirestore();
const APP = 'comayagua-vip-pro-v4'; const B = `artifacts/${APP}/public/data`;
const tok = (s) => `${s}:APA91b_${'x'.repeat(40)}_${s}`;
const key = (t) => t.replace(/\./g, '_');
const tokMap = (s, at, platform = 'web') => ({ [key(tok(s))]: { token: tok(s), updatedAt: at, platform } });
const res = []; const ok = (n, c, extra = '') => res.push([c ? 'PASS' : 'FAIL', n, extra]);
const SUP = { uid: 'SUP', token: { email: 'sup@example.com' } };
const FAKESUP = { uid: 'FSUP', token: { email: 'fsup@example.com' } };
const ADM = { uid: 'ADM', token: { email: 'josuesoza0513@gmail.com' } };
const CLI = { uid: 'CLI', token: { email: 'cli@example.com' } };
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code || String(e.message || e); } };
const DAY = 864e5;
(async () => {
  const now = Date.now();
  await db.doc(`${B}/users/SUP`).set({ role: 'supervisor', name: 'Sup Uno' });
  await db.doc(`artifacts/${APP}/roles/SUP`).set({ role: 'supervisor', source: 'test' });
  await db.doc(`${B}/users/FSUP`).set({ role: 'supervisor', name: 'Falso' }); // perfil editado, sin rol de confianza
  await db.doc(`${B}/users/ADM`).set({ role: 'admin', name: 'Josue' });
  await db.doc(`${B}/users/CLI`).set({ role: 'client', name: 'Cliente', fcmTokens: tokMap('CLI', now) });
  // Conductores
  await db.doc(`${B}/users/A`).set({ role: 'driver', name: 'Ana Activa', phone: '9999-0001', serviceZoneId: 'la-ceiba', fcmTokens: tokMap('A', now - 20 * DAY, 'android') });
  await db.doc(`artifacts/${APP}/push_health/A`).set({ lastAckAtMs: now - 2 * DAY });
  await db.doc(`${B}/users/B`).set({ role: 'driver', name: 'Beto Reciente', phone: '9999-0002', fcmTokens: tokMap('B', now - DAY, 'ios-pwa') });
  await db.doc(`${B}/users/C`).set({ role: 'driver', name: 'Carlos Callado', phone: '9999-0003', fcmTokens: tokMap('C', now - 30 * DAY) });
  await db.doc(`${B}/users/D`).set({ role: 'driver', name: 'Dora Borrada', phone: '9999-0004' });
  await db.doc(`artifacts/${APP}/push_health/D`).set({ lastInvalidAtMs: now - 3 * DAY, lastFcmOkAtMs: now - 40 * DAY });
  await db.doc(`${B}/users/E`).set({ role: 'driver', name: 'Eva Vieja', phone: '9999-0005', fcmTokenUpdatedAt: new Date(now - 90 * DAY) });
  await db.doc(`${B}/users/F`).set({ role: 'driver', name: 'Fito Nunca', phone: '9999-0006' });
  await db.doc(`${B}/users/G`).set({ role: 'driver', name: 'Gabi Vencido', fcmTokens: tokMap('G', now - 70 * DAY) });
  await db.doc(`${B}/users/H`).set({ role: 'driver', name: 'Hugo Viaje', phone: '9999-0008', fcmTokens: tokMap('H', now - 30 * DAY) });
  await db.doc(`${B}/trips/TR1`).set({ status: 'completed', createdAt: new Date(now - DAY), deliveredTo: { H: { atMs: now - DAY, via: 'background' } } });
  await db.doc(`${B}/users/I`).set({ role: 'driver', name: 'Iris FCM', phone: '9999-0009', fcmTokens: tokMap('I', now - 40 * DAY, 'android') });
  await db.doc(`artifacts/${APP}/push_health/I`).set({ lastFcmOkAtMs: now - DAY });

  // ── Permisos ──
  ok('estado: sin sesión → unauthenticated', (await code(fx.staffDriverPushStatus.run({ data: {} }))) === 'unauthenticated');
  ok('estado: pasajero → permission-denied', (await code(fx.staffDriverPushStatus.run({ auth: CLI, data: {} }))) === 'permission-denied');
  ok('estado: supervisor falso (solo perfil) → permission-denied', (await code(fx.staffDriverPushStatus.run({ auth: FAKESUP, data: {} }))) === 'permission-denied');
  ok('pedir: pasajero → permission-denied', (await code(fx.staffNudgeDriverPush.run({ auth: CLI, data: { driverUid: 'F' } }))) === 'permission-denied');
  ok('pedir: sin sesión → unauthenticated', (await code(fx.staffNudgeDriverPush.run({ data: { driverUid: 'F' } }))) === 'unauthenticated');

  // ── Clasificación ──
  const st = await fx.staffDriverPushStatus.run({ auth: SUP, data: {} });
  const by = Object.fromEntries(st.drivers.map((d) => [d.uid, d]));
  ok('A: activo (confirmó hace 2 d, token de 20 d)', by.A.status === 'active' && by.A.reason === 'confirmado' && by.A.device === 'android', JSON.stringify(by.A));
  ok('A: ciudad por zona', by.A.city === 'La Ceiba', by.A.city);
  ok('B: activo (token reciente, iPhone)', by.B.status === 'active' && by.B.reason === 'token_reciente' && by.B.device === 'ios-pwa');
  ok('C: vencido (token de 30 d sin actividad)', by.C.status === 'expired' && by.C.reason === 'sin_actividad');
  ok('D: vencido (token borrado por FCM)', by.D.status === 'expired' && by.D.reason === 'token_invalido');
  ok('E: vencido (tuvo token, ya no)', by.E.status === 'expired' && by.E.reason === 'token_vencido');
  ok('F: nunca activados', by.F.status === 'never');
  ok('G: vencido (solo token > 60 d)', by.G.status === 'expired', JSON.stringify(by.G));
  ok('H: activo por confirmación en viaje (deliveredTo)', by.H.status === 'active' && by.H.reason === 'confirmado');
  ok('I: activo por FCM aceptado reciente', by.I.status === 'active' && by.I.reason === 'fcm_ok');
  ok('pasajero no aparece', !by.CLI);
  ok('conteo: 4 activos (A,B,H,I) · 4 vencidos (C,D,E,G) · 1 nunca (F)', st.counts.total === 9 && st.counts.active === 4 && st.counts.expired === 4 && st.counts.never === 1, JSON.stringify(st.counts));
  ok('no expone tokens', !JSON.stringify(st).includes('APA91b'));
  ok('fechas: última inscripción de token', by.B.lastTokenAtMs === now - DAY && by.A.lastConfirmedAtMs === now - 2 * DAY);
  ok('admin (correo) también puede', (await code(fx.staffDriverPushStatus.run({ auth: ADM, data: {} }))) === 'ok');

  // ── Pedir que activen (sin plantilla: texto solo dentro de 24 h) ──
  INBOUND.set('50499990006', now - 3600e3); // F nos escribió hace 1 h
  const r1 = await fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUid: 'F' } });
  ok('F: enviado por texto con enlace', r1.results[0].result === 'sent' && sent.length === 1 && sent[0].kind === 'text' && sent[0].body.includes('https://honduraite.com/?activarAvisos=1#driver'), JSON.stringify(r1.results[0]));
  const r2 = await fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUid: 'F' } });
  ok('F: segunda vez → cooldown 24 h, no se manda', r2.results[0].result === 'cooldown' && sent.length === 1 && r2.results[0].nextAllowedAtMs > now + 23 * 3600e3, JSON.stringify(r2.results[0]));
  const r3 = await fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUid: 'C' } });
  ok('C: sin mensaje entrante → fuera de la ventana de 24 h, no se manda', r3.results[0].result === 'outside_window' && /24 h/.test(r3.results[0].text) && sent.length === 1);
  const r3b = await fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUid: 'C' } });
  ok('C: fuera de ventana no gasta el cooldown', r3b.results[0].result === 'outside_window');
  const r4 = await fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUid: 'G' } });
  ok('G: sin teléfono', r4.results[0].result === 'no_phone');
  ok('pasajero: no es conductor', (await fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUid: 'CLI' } })).results[0].result === 'not_driver');
  // masivo exige confirmar la cantidad
  ok('masivo sin confirmCount → failed-precondition', (await code(fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUids: ['D', 'E'] } }))) === 'failed-precondition');
  ok('masivo con confirmCount distinto → failed-precondition', (await code(fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUids: ['D', 'E'], confirmCount: 3 } }))) === 'failed-precondition');
  // concurrencia: 3 pedidos a la vez al mismo conductor → 1 envío
  INBOUND.set('50499990004', now - 60e3);
  const before = sent.length;
  const par = await Promise.all([1, 2, 3].map(() => fx.staffNudgeDriverPush.run({ auth: SUP, data: { driverUid: 'D' } })));
  ok('concurrencia: 3 a la vez → 1 envío', sent.length - before === 1 && par.filter((p) => p.results[0].result === 'sent').length === 1, JSON.stringify(par.map((p) => p.results[0].result)));
  // con plantilla: se usa aunque no haya ventana; reintenta con 1 parámetro si la plantilla trae 1
  TEMPLATE = 'activar_avisos_conductor'; templateWantsOneParam = true;
  const r5 = await fx.staffNudgeDriverPush.run({ auth: ADM, data: { driverUids: ['E', 'H'], confirmCount: 2 } });
  ok('plantilla: E y H enviados fuera de ventana', r5.results.every((x) => x.result === 'sent' && x.via === 'template'), JSON.stringify(r5.results));
  ok('plantilla: reintento con 1 parámetro', sent.filter((s) => s.kind === 'template').every((s) => s.params.length === 1));
  TEMPLATE = ''; templateWantsOneParam = false;
  // bitácora
  const log = await db.collection(`artifacts/${APP}/push_nudge_log`).get();
  const logs = log.docs.map((d) => d.data());
  ok('bitácora: quién lo mandó', logs.some((l) => l.driverUid === 'F' && l.byUid === 'SUP' && l.byName === 'Sup Uno' && l.result === 'sent') && logs.some((l) => l.driverUid === 'E' && l.bulk === true && l.byUid === 'ADM'));
  // estado después: último pedido + fallo de Meta vía webhook (131047)
  const fId = (await db.doc(`artifacts/${APP}/push_health/F`).get()).data().lastNudge.messageId;
  await db.collection(`${B}/whatsapp_cloud_statuses`).add({ messageId: fId, status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }], timestamp: String(Math.floor(now / 1000)) });
  const st2 = await fx.staffDriverPushStatus.run({ auth: SUP, data: {} });
  const f2 = st2.drivers.find((d) => d.uid === 'F');
  ok('estado: último pedido con quién y próximo permitido', f2.lastNudge.byName === 'Sup Uno' && f2.nextNudgeAtMs > now, JSON.stringify(f2.lastNudge));
  ok('estado: fallo 131047 del webhook → «fuera de la ventana de 24 h»', f2.lastNudge.result === 'outside_window' && /24 h/.test(f2.lastNudge.text), JSON.stringify(f2.lastNudge));
  ok('estado: sin messageId hacia el cliente', !JSON.stringify(st2).includes('wamid'));

  // ── Señales que alimentan el estado ──
  await db.doc(`${B}/users/J`).set({ role: 'driver', name: 'Juan', fcmTokens: { ...tokMap('J', now - 30 * DAY), ...tokMap('DEADJ', now - 30 * DAY) } });
  await T.sendPushToUser(APP, 'J', { title: 't', body: 'b', data: { type: 'chat' } });
  const hj = (await db.doc(`artifacts/${APP}/push_health/J`).get()).data() || {};
  ok('sendPushToUser guarda lastFcmOkAtMs y lastInvalidAtMs', hj.lastFcmOkAtMs > now - 60e3 && hj.lastInvalidAtMs > now - 60e3, JSON.stringify(hj));
  await db.doc(`${B}/trips/TR2`).set({ status: 'pending', createdAt: now, candidateDriverIds: ['C'] });
  await fx.ackPushReceived.run({ auth: { uid: 'C' }, data: { type: 'trip_offer', tripId: 'TR2', via: 'background' } });
  const hc = (await db.doc(`artifacts/${APP}/push_health/C`).get()).data() || {};
  ok('ackPushReceived guarda lastAckAtMs', hc.lastAckAtMs > now - 60e3 && hc.lastAckVia === 'background');
  const st3 = await fx.staffDriverPushStatus.run({ auth: SUP, data: {} });
  ok('C pasa a activo tras confirmar', st3.drivers.find((d) => d.uid === 'C').status === 'active');

  // ── Puras ──
  ok('cooldown puro', DPS.nudgeCooldown({ lastNudgeAttemptAtMs: now - 3600e3 }, now).blocked && !DPS.nudgeCooldown({ lastNudgeAttemptAtMs: now - 25 * 3600e3 }, now).blocked);
  ok('131026 → sin WhatsApp', DPS.describeWaFailure([{ code: 131026 }]).code === 'not_on_whatsapp');

  for (const r of res) console.log(...r);
  const all = res.every((r) => r[0] === 'PASS');
  console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
  process.exit(all ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
