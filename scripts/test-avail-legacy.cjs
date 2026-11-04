const admin = require('../functions/node_modules/firebase-admin');
process.env.GCLOUD_PROJECT='demo-hr';

const fns0 = require('../functions/index.js'); const db = admin.firestore();
const fns = fns0;
(async () => {
  const ref = db.doc('artifacts/comayagua-vip-pro-v4/public/data/appSettings/main');
  await ref.set({ disabledServicesByCity: { comayagua: { grua: true, taxi: true } },
    serviceAvailability: { comayagua: { grua: { mode: 'off', message: 'viejo' } } } });
  await db.doc('artifacts/comayagua-vip-pro-v4/public/data/users/adm1').set({ role: 'admin' });
  await db.doc('users/adm1').set({ role: 'admin' }).catch(()=>{});
  const w = (r) => fns.staffSetServiceAvailability.run({ ...r, rawRequest: {} });
  try { await w({ data: { zoneId: 'comayagua', service: 'grua', mode: 'on', message: '' }, auth: { uid: 'adm1', token: { email: 'josuesoza0513@gmail.com', email_verified: true } } }); }
  catch (e) { console.log('ERR', e.message); }
  const d = (await ref.get()).data();
  console.log(JSON.stringify(d.disabledServicesByCity), JSON.stringify(d.serviceAvailability));
  const ok = !d.disabledServicesByCity.comayagua.grua && d.disabledServicesByCity.comayagua.taxi === true
    && d.serviceAvailability.comayagua.grua.mode === 'on' && !('message' in d.serviceAvailability.comayagua.grua);
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})();
