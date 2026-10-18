/**
 * Prueba del callable resolvePhoneLoginEmail (emulador de Firestore; Auth simulado).
 *   firebase emulators:exec --project demo-hr --only firestore "node scripts/test-phone-login.cjs"
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-hr';
const path = require('path');
const fnDir = path.join(__dirname, '..', 'functions');
const fnRequire = require('module').createRequire(path.join(fnDir, 'index.js'));
const admin = fnRequire('firebase-admin');
const { onCall, HttpsError } = fnRequire('firebase-functions/v2/https');
admin.initializeApp({ projectId: 'demo-hr' });
const db = admin.firestore();
const APP_ID = 'comayagua-vip-pro-v4';
const P = `artifacts/${APP_ID}/public/data`;
const authUsers = { u1: { email: 'Ana@Example.com' }, u2: { email: 'leo@example.com' } };
const getAuth = () => ({
  getUser: async (uid) => { if (!authUsers[uid]) throw new Error('no'); return authUsers[uid]; },
  getUserByPhoneNumber: async (p) => { if (p === '+50499990000') return { email: 'auth@example.com' }; throw new Error('no'); },
});
const { exports: ex } = require(path.join(fnDir, 'phone-login.js'))({ db, getAuth, HttpsError, onCall, APP_ID });
const call = (phone, ip = '1.1.1.1') => ex.resolvePhoneLoginEmail.run({ data: { phone }, rawRequest: { ip, headers: {} } });
const results = [];
async function t(name, fn) { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const eq = (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); };
(async () => {
  await db.doc(`${P}/auth_phone_index/50411112222`).set({ uid: 'u1', email: 'ana@example.com' });
  await db.doc(`${P}/users/u2`).set({ phone: '3333-4444' });
  await db.doc(`${P}/users/u3`).set({ phone: '50455556666' });
  await db.doc(`${P}/users/u4`).set({ phone: '5555-6666' });
  await t('desde el índice', async () => eq((await call('50411112222')).email, 'ana@example.com'));
  await t('sin índice: por teléfono del perfil (formato viejo 3333-4444)', async () => eq((await call('50433334444')).email, 'leo@example.com'));
  await t('dos perfiles con el mismo teléfono: no adivina', async () => eq((await call('50455556666')).email, null));
  await t('teléfono en Auth', async () => eq((await call('50499990000')).email, 'auth@example.com'));
  await t('no existe', async () => eq((await call('50400000001')).email, null));
  await t('inválido', async () => { try { await call('abc'); throw new Error('no falló'); } catch (e) { eq(e.code, 'invalid-argument'); } });
  await t('límite por IP', async () => {
    let blocked = false;
    for (let i = 0; i < 25; i++) { try { await call(`5041000${String(i).padStart(4, '0')}`, '9.9.9.9'); } catch (e) { if (e.code === 'resource-exhausted') blocked = true; } }
    eq(blocked, true);
  });
  let fail = 0;
  for (const r of results) { if (r[0] === 'FAIL') fail++; console.log(r.join(' | ')); }
  console.log(`${results.length - fail}/${results.length} PASS`);
  process.exit(fail ? 1 : 0);
})();
