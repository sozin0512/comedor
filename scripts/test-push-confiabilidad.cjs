// Prueba local (emulador Firestore + FCM falso). Uso: npx firebase emulators:exec --only firestore --project demo-hr "node scripts/test-push-confiabilidad.cjs"
process.env.GCLOUD_PROJECT = 'demo-hr';
const path = require('path'); const fs = require('fs'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
// FCM falso
const calls = []; const seen = {};
const fakeMessaging = { sendEachForMulticast: async (msg) => {
  calls.push({ ttl: msg.android?.ttl, webTtl: msg.webpush?.headers?.TTL, apns: msg.apns?.headers?.['apns-expiration'] || null, tokens: msg.tokens.slice(), type: msg.data?.type });
  const responses = msg.tokens.map((t) => {
    seen[t] = (seen[t] || 0) + 1;
    if (t.includes('DEAD')) return { success: false, error: { code: 'messaging/registration-token-not-registered', message: 'gone' } };
    if (t.includes('FLAKY') && seen[t] === 1) return { success: false, error: { code: 'messaging/server-unavailable', message: 'try' } };
    if (t.includes('DOWN')) return { success: false, error: { code: 'messaging/internal-error', message: 'boom' } };
    if (t.includes('THIRD')) return { success: false, error: { code: 'messaging/third-party-auth-error', message: 'apns' } };
    return { success: true };
  });
  return { successCount: responses.filter((r) => r.success).length, responses };
} };
const msgPath = reqFn.resolve('firebase-admin/messaging');
require.cache[msgPath] = { id: msgPath, filename: msgPath, loaded: true, exports: { getMessaging: () => fakeMessaging } };
const src = fs.readFileSync(path.join(FN, 'index.js'), 'utf8') + '\nmodule.exports.__t = { sendPushToUser, getUserPushMeta, liveFcmTokenRecordsFromMaps };\n';
const m = new Module(path.join(FN, 'index.js'), module); m.filename = path.join(FN, 'index.js'); m.paths = Module._nodeModulePaths(FN);
m._compile(src, m.filename);
const fx = m.exports; const T = fx.__t;
const admin = reqFn('firebase-admin/firestore'); const db = admin.getFirestore();
const APP = 'comayagua-vip-pro-v4'; const P = `artifacts/${APP}/public/data/users`;
const tok = (s) => `${s}:APA91b_${'x'.repeat(40)}_${s}`;
const now = Date.now(); const OLD = now - 70 * 864e5;
const res = []; const ok = (n, c, extra='') => res.push([c ? 'PASS' : 'FAIL', n, extra]);
(async () => {
  const keyOf = (t) => t.replace(/\./g, '_');
  // A: fresco android + viejo web (2 tokens <= 24) ; B sin nada ; C solo vencidos
  await db.doc(`${P}/A`).set({ role: 'driver', fcmTokens: { [keyOf(tok('S24'))]: { token: tok('S24'), updatedAt: now, platform: 'android', model: 'SM-S928B', osVersion: '14' }, [keyOf(tok('OLDWEB'))]: { token: tok('OLDWEB'), updatedAt: OLD, platform: 'web' } } });
  await db.doc(`artifacts/${APP}/users/A/profile/data`).set({ fcmTokens: { [keyOf(tok('OLDWEB'))]: { token: tok('OLDWEB'), updatedAt: OLD, platform: 'web' } } });
  await db.doc(`${P}/B`).set({ role: 'admin' });
  await db.doc(`${P}/C`).set({ role: 'driver', fcmTokens: { [keyOf(tok('C1'))]: { token: tok('C1'), updatedAt: OLD, platform: 'android' } } });
  await db.doc(`${P}/D`).set({ role: 'driver', fcmTokens: {
    [keyOf(tok('FLAKY'))]: { token: tok('FLAKY'), updatedAt: now, platform: 'android', model: 'T610K' },
    [keyOf(tok('DEAD'))]: { token: tok('DEAD'), updatedAt: now, platform: 'web' },
    [keyOf(tok('DOWN'))]: { token: tok('DOWN'), updatedAt: now, platform: 'ios-pwa' } } });

  // 3) no mandar a solo vencidos
  const rc = await T.sendPushToUser(APP, 'C', { title: 't', body: 'b', data: { type: 'chat' } });
  ok('C solo vencidos: no se envía', rc.sent === 0 && rc.tokens === 0, JSON.stringify(rc));
  // 3) limpieza al enviar con <=24 tokens
  const ra = await T.sendPushToUser(APP, 'A', { title: 't', body: 'b', data: { type: 'chat' } });
  ok('A: envía solo al fresco', ra.sent === 1 && ra.tokens === 1, JSON.stringify(ra));
  await new Promise((r) => setTimeout(r, 800));
  const a1 = (await db.doc(`${P}/A`).get()).data();
  ok('A: token vencido borrado (público) con <=24', !a1.fcmTokens[keyOf(tok('OLDWEB'))] && !!a1.fcmTokens[keyOf(tok('S24'))]);
  const a1p = (await db.doc(`artifacts/${APP}/users/A/profile/data`).get()).data();
  ok('A: token vencido borrado (privado)', !(a1p.fcmTokens || {})[keyOf(tok('OLDWEB'))]);
  // 5) reintentos + conteo de códigos
  calls.length = 0;
  const rd = await T.sendPushToUser(APP, 'D', { title: 't', body: 'b', data: { type: 'chat' } });
  ok('D: FLAKY llega tras reintento', rd.sent === 1 && rd.retried >= 1, JSON.stringify({ sent: rd.sent, retried: rd.retried, codes: rd.codes }));
  ok('D: códigos contados', rd.codes['messaging/internal-error'] === 1 && rd.codes['messaging/registration-token-not-registered'] === 1, JSON.stringify(rd.codes));
  ok('D: DOWN se intentó 3 veces', seen[tok('DOWN')] === 3, String(seen[tok('DOWN')]));
  const d1 = (await db.doc(`${P}/D`).get()).data();
  ok('D: token muerto borrado', !d1.fcmTokens[keyOf(tok('DEAD'))]);
  // 6) TTL oferta vs normal
  calls.length = 0;
  await T.sendPushToUser(APP, 'A', { title: 't', body: 'b', data: { type: 'trip_offer', tripId: 'x1' } });
  const c0 = calls[0];
  ok('oferta: ttl android 600 s, webpush 600, apns', c0.ttl === 600000 && c0.webTtl === '600' && !!c0.apns, JSON.stringify(c0));
  calls.length = 0;
  await T.sendPushToUser(APP, 'A', { title: 't', body: 'b', data: { type: 'trip_accepted' } });
  ok('aviso normal: TTL sin cambio', calls[0].webTtl === '86400' && !calls[0].apns, JSON.stringify(calls[0]));
  // 1+4) pingMyPush desde B con el token del S24 de A: guarda metadatos y lo quita de A
  const meta = { model: 'SM-S928B', osVersion: '14', brand: 'samsung', appVersion: '2026.10.16.1', ua: 'Mozilla/5.0 (Linux; Android 14; SM-S928B)' };
  // primero A reclama (crea índice), luego B
  await fx.registerFcmToken.run({ auth: { uid: 'A' }, data: { token: tok('S24'), platform: 'android', meta } });
  const pb = await fx.pingMyPush.run({ auth: { uid: 'B' }, data: { token: tok('S24'), platform: 'android', meta } });
  ok('ping B: enviado', pb.sent === 1 && pb.inProfile === true && pb.thisDeviceInvalid === false, JSON.stringify(pb));
  const b1 = (await db.doc(`${P}/B`).get()).data();
  const eb = b1.fcmTokens[keyOf(tok('S24'))];
  ok('B: metadatos guardados', eb?.model === 'SM-S928B' && eb?.osVersion === '14' && eb?.brand === 'samsung' && eb?.appVersion === '2026.10.16.1');
  const a2 = (await db.doc(`${P}/A`).get()).data();
  ok('A: token del S24 quitado (pasó a B)', !(a2.fcmTokens || {})[keyOf(tok('S24'))]);
  // 2) ping con token muerto → thisDeviceInvalid
  const pd = await fx.pingMyPush.run({ auth: { uid: 'B' }, data: { token: tok('DEAD2'), platform: 'web', meta } });
  ok('ping token muerto: thisDeviceInvalid', pd.thisDeviceInvalid === true && pd.sent === 0, JSON.stringify({ inv: pd.thisDeviceInvalid, codes: pd.codes }));
  // 3) limpieza nocturna con <=24
  await db.doc(`${P}/E`).set({ role: 'driver', fcmTokens: { [keyOf(tok('E1'))]: { token: tok('E1'), updatedAt: OLD, platform: 'web' }, [keyOf(tok('E2'))]: { token: tok('E2'), updatedAt: now, platform: 'web' } } });
  await fx.pruneStaleFcmTokens.run({});
  const e1 = (await db.doc(`${P}/E`).get()).data();
  ok('nocturna: borra vencido con 2 tokens', !e1.fcmTokens[keyOf(tok('E1'))] && !!e1.fcmTokens[keyOf(tok('E2'))]);
  // registerFcmToken sin sesión
  let threw = false; try { await fx.registerFcmToken.run({ data: { token: tok('Z') } }); } catch (e) { threw = e.code === 'unauthenticated'; }
  ok('registerFcmToken exige sesión', threw);
  for (const r of res) console.log(...r);
  console.log(res.every((r) => r[0] === 'PASS') ? 'TODO OK' : 'HAY FALLOS');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
