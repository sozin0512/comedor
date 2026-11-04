// firebase emulators:exec --project demo-hr --only firestore,auth "node scripts/test-store-review-notice.cjs"
process.env.GCLOUD_PROJECT = 'demo-hr';
const fns = require('../functions/index.js');
const { storeReviewNotice } = require('../functions/store-review-notice.js');
const admin = require('../functions/node_modules/firebase-admin');
const db = admin.firestore();
const A = 'comayagua-vip-pro-v4';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };
(async () => {
  ok('alta nueva pending avisa', storeReviewNotice(null, { name: 'Baleadas X', approvalStatus: 'pending' }, 's1')?.title === '🏪 Nueva tienda por verificar');
  ok('sucursal del staff (aprobada) no avisa', storeReviewNotice(null, { approvalStatus: 'approved', createdByStaffUid: 'sup' }, 's2') === null);
  ok('rechazada → pending avisa reenvío', /reenviada/.test(storeReviewNotice({ approvalStatus: 'rejected' }, { approvalStatus: 'pending' }, 's3')?.title || ''));
  ok('pending → pending (edición) no avisa', storeReviewNotice({ approvalStatus: 'pending' }, { approvalStatus: 'pending' }, 's4') === null);
  ok('aprobada no avisa', storeReviewNotice({ approvalStatus: 'pending' }, { approvalStatus: 'approved' }, 's5') === null);
  ok('borrado no avisa', storeReviewNotice({ approvalStatus: 'pending' }, null, 's6') === null);
  // Trigger real: debe intentar push a cada staff de confianza (sin token en emulador → log «sin token FCM uid=...»).
  await db.doc(`artifacts/${A}/roles/sup1`).set({ role: 'supervisor' });
  await db.doc(`artifacts/${A}/roles/adm1`).set({ role: 'admin' });
  const logs = []; const w = console.warn; console.warn = (...a) => { logs.push(a.join(' ')); };
  const after = { exists: true, data: () => ({ name: 'Baleadas X', approvalStatus: 'pending', ownerId: 'u1' }) };
  await fns.onStorePendingReviewPush.run({ params: { appId: A, storeId: 's1' }, data: { before: { exists: false }, after } });
  console.warn = w;
  const hit = (u) => logs.some((l) => l.includes(`uid=${u}`) && l.includes('store_pending_review'));
  ok('trigger avisa al supervisor', hit('sup1'));
  ok('trigger avisa al admin', hit('adm1'));
  console.log(`\n${pass}/${pass + fail} PASS`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
