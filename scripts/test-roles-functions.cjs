// Pruebas de funciones: roles de confianza (claims + doc roles). Emuladores: firestore + auth.
// Uso: firebase emulators:exec --project demo-hr --only firestore,auth "node scripts/test-roles-functions.cjs"
process.env.GCLOUD_PROJECT = 'demo-hr';
const path = require('path'); const fs = require('fs'); const Module = require('module');
const FN = path.join(__dirname, '..', 'functions');
const reqFn = Module.createRequire(path.join(FN, 'index.js'));
const fakeMessaging = { sendEachForMulticast: async (msg) => ({ successCount: msg.tokens.length, responses: msg.tokens.map(() => ({ success: true })) }) };
const msgPath = reqFn.resolve('firebase-admin/messaging');
require.cache[msgPath] = { id: msgPath, filename: msgPath, loaded: true, exports: { getMessaging: () => fakeMessaging } };
const src = fs.readFileSync(path.join(FN, 'index.js'), 'utf8') + '\nmodule.exports.__t = { roles };\n';
const m = new Module(path.join(FN, 'index.js'), module); m.filename = path.join(FN, 'index.js'); m.paths = Module._nodeModulePaths(FN);
m._compile(src, m.filename);
const fx = m.exports; const R = fx.__t.roles.helpers;
const wa = reqFn('./whatsapp-cloud');
const mig = reqFn('./scripts/migrate-role-claims.js');
const db = reqFn('firebase-admin/firestore').getFirestore();
const auth = reqFn('firebase-admin/auth').getAuth();
const APP = 'comayagua-vip-pro-v4'; const B = `artifacts/${APP}/public/data`;
const res = []; const ok = (n, c, extra = '') => res.push([c ? 'PASS' : 'FAIL', n, extra]);
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code || String(e.message || e); } };
const claims = async (uid) => (await auth.getUser(uid)).customClaims || {};
const roleDoc = async (uid) => (await db.doc(`artifacts/${APP}/roles/${uid}`).get()).data() || null;
const A = (uid, email, extra = {}) => ({ uid, token: { email, ...extra } });

(async () => {
  const people = {
    ADM: 'josuesoza0513@gmail.com', SOZA: 'sozajob146@gmail.com', FAKESUP: 'fake@x.com', FAKEADM: 'fa@x.com',
    REALSUP: 'real@x.com', CLAIMSUP: 'cs@x.com', DEMOTED: 'dm@x.com', DRV: 'drv@x.com', PAS: 'pas@x.com', TGT: 'tgt@x.com', REVIEW: 'rv@x.com',
  };
  for (const [uid, email] of Object.entries(people)) { try { await auth.deleteUser(uid); } catch (_) {} await auth.createUser({ uid, email }); }
  const prof = { ADM: { role: 'admin' }, SOZA: { role: 'supervisor' }, FAKESUP: { role: 'supervisor' }, FAKEADM: { role: 'admin' },
    REALSUP: { role: 'supervisor', staffGrantedBy: 'ADM' }, CLAIMSUP: { role: 'client' }, DEMOTED: { role: 'supervisor', staffGrantedBy: 'ADM' },
    DRV: { role: 'driver' }, PAS: { role: 'client' }, TGT: { role: 'client' }, REVIEW: { role: 'supervisor', staffGrantedBy: 'SOMEONE' } };
  for (const [uid, p] of Object.entries(prof)) { await db.doc(`${B}/users/${uid}`).set({ name: uid, ...p }); await db.doc(`artifacts/${APP}/users/${uid}/profile/data`).set({ name: uid, ...p }); }
  await auth.setCustomUserClaims('CLAIMSUP', { role: 'supervisor', staff: true });
  await auth.setCustomUserClaims('DEMOTED', { role: 'supervisor', staff: true });
  await db.doc(`artifacts/${APP}/roles/DEMOTED`).set({ role: 'client', source: 'setUserRole' });
  await db.doc(`${B}/trips/T1`).set({ status: 'cancelled', clientId: 'PAS', createdAt: Date.now() });
  const review = (a) => code(fx.staffTripsAction.run({ auth: a, data: { action: 'review', tripIds: ['T1'] } }));

  // ── Antes de migrar: admin y correo staff conocido no quedan bloqueados
  ok('pre-migración: admin (correo) modera', (await review(A('ADM', people.ADM))) === 'ok');
  ok('pre-migración: sozajob (correo staff conocido) modera', (await review(A('SOZA', people.SOZA))) === 'ok');
  ok('pre-migración: claim supervisor en token modera', (await review(A('CLAIMSUP', people.CLAIMSUP, { role: 'supervisor' }))) === 'ok');
  ok('token viejo (sin claim) pero claim fresco en Auth → modera', (await review(A('CLAIMSUP', people.CLAIMSUP))) === 'ok');
  ok('perfil role=supervisor (editable) → NO modera', (await review(A('FAKESUP', people.FAKESUP))) === 'permission-denied');
  ok('perfil role=admin falso → NO modera', (await review(A('FAKEADM', people.FAKEADM))) === 'permission-denied');
  ok('pasajero → NO modera', (await review(A('PAS', people.PAS))) === 'permission-denied');
  ok('conductor → NO modera', (await review(A('DRV', people.DRV, { role: 'driver' }))) === 'permission-denied');
  ok('degradado (doc roles=client, claim viejo supervisor) → NO modera', (await review(A('DEMOTED', people.DEMOTED, { role: 'supervisor' }))) === 'permission-denied');
  ok('token forjado role=admin pero doc roles=client → NO', (await review(A('DEMOTED', people.DEMOTED, { role: 'admin' }))) === 'permission-denied');
  ok('sin sesión → unauthenticated', (await code(fx.staffTripsAction.run({ data: { action: 'review', tripIds: ['T1'] } }))) === 'unauthenticated');

  // ── WhatsApp Cloud (antes miraba el perfil)
  ok('sendWhatsAppCloudText: perfil supervisor falso → denegado', (await code(wa.sendWhatsAppCloudText.run({ auth: A('FAKESUP', people.FAKESUP), data: { to: '50499999999', text: 'x' } }))) === 'permission-denied');
  ok('testWhatsAppTripTemplate: pasajero → denegado', (await code(wa.testWhatsAppTripTemplate.run({ auth: A('PAS', people.PAS), data: { to: '50499999999' } }))) === 'permission-denied');
  const waStaff = await code(wa.sendWhatsAppCloudText.run({ auth: A('CLAIMSUP', people.CLAIMSUP, { role: 'supervisor' }), data: { to: '50499999999', text: 'x' } }));
  ok('sendWhatsAppCloudText: supervisor de confianza pasa el permiso', waStaff !== 'permission-denied', waStaff);

  // ── refreshMyRoleClaims
  const rf = await fx.refreshMyRoleClaims.run({ auth: A('FAKESUP', people.FAKESUP), data: {} });
  ok('refresh: supervisor falso queda client y sin claim', rf.role === 'client' && !(await claims('FAKESUP')).role, JSON.stringify(rf));
  const rd = await fx.refreshMyRoleClaims.run({ auth: A('DRV', people.DRV), data: {} });
  ok('refresh: conductor recibe claim driver (sin staff)', rd.role === 'driver' && (await claims('DRV')).role === 'driver' && (await claims('DRV')).staff === false, JSON.stringify(rd));
  const ra = await fx.refreshMyRoleClaims.run({ auth: A('ADM', people.ADM), data: {} });
  ok('refresh: admin (correo) recibe claim admin + doc roles', ra.role === 'admin' && ra.changed && (await claims('ADM')).role === 'admin' && (await roleDoc('ADM'))?.role === 'admin', JSON.stringify(ra));
  const rs = await fx.refreshMyRoleClaims.run({ auth: A('SOZA', people.SOZA), data: {} });
  ok('refresh: correo staff conocido → claim supervisor + doc', rs.role === 'supervisor' && (await claims('SOZA')).role === 'supervisor' && (await roleDoc('SOZA'))?.role === 'supervisor', JSON.stringify(rs));
  const rdm = await fx.refreshMyRoleClaims.run({ auth: A('DEMOTED', people.DEMOTED, { role: 'supervisor' }), data: {} });
  ok('refresh: degradado pierde el claim viejo', rdm.role === 'client' && !(await claims('DEMOTED')).role, JSON.stringify(rdm));
  ok('refresh: sin sesión', (await code(fx.refreshMyRoleClaims.run({ data: {} }))) === 'unauthenticated');

  // ── setUserRole (solo admin supremo)
  ok('setUserRole: supervisor no puede', (await code(fx.setUserRole.run({ auth: A('CLAIMSUP', people.CLAIMSUP, { role: 'supervisor' }), data: { targetUid: 'TGT', newRole: 'supervisor' } }))) === 'permission-denied');
  ok('setUserRole: admin claim falso no puede', (await code(fx.setUserRole.run({ auth: A('FAKEADM', people.FAKEADM, { role: 'admin' }), data: { targetUid: 'TGT', newRole: 'supervisor' } }))) === 'permission-denied');
  ok('setUserRole: no deja crear admin', (await code(fx.setUserRole.run({ auth: A('ADM', people.ADM), data: { targetUid: 'TGT', newRole: 'admin' } }))) === 'invalid-argument');
  await fx.setUserRole.run({ auth: A('ADM', people.ADM), data: { targetUid: 'TGT', newRole: 'supervisor' } });
  ok('setUserRole: admin hace supervisor → claim + doc + perfil', (await claims('TGT')).role === 'supervisor' && (await roleDoc('TGT'))?.role === 'supervisor' && (await db.doc(`${B}/users/TGT`).get()).data().role === 'supervisor');
  ok('setUserRole: el nuevo supervisor ya modera (token viejo)', (await review(A('TGT', people.TGT))) === 'ok');
  await fx.setUserRole.run({ auth: A('ADM', people.ADM), data: { targetUid: 'TGT', newRole: 'client' } });
  ok('setUserRole: degradar quita claim y doc=client', !(await claims('TGT')).role && (await roleDoc('TGT'))?.role === 'client');
  ok('setUserRole: degradado ya NO modera aunque su token diga supervisor', (await review(A('TGT', people.TGT, { role: 'supervisor' }))) === 'permission-denied');
  ok('setUserRole: uid sin cuenta Auth → not-found', (await code(fx.setUserRole.run({ auth: A('ADM', people.ADM), data: { targetUid: 'NOPE', newRole: 'driver' } }))) === 'not-found');

  // ── syncAdminUid
  await db.doc(`artifacts/${APP}/roles/ADM`).delete(); await auth.setCustomUserClaims('ADM', null);
  ok('syncAdminUid: otro no puede', (await code(fx.syncAdminUid.run({ auth: A('FAKEADM', people.FAKEADM, { role: 'admin' }), data: {} }))) === 'permission-denied');
  await fx.syncAdminUid.run({ auth: A('ADM', people.ADM), data: {} });
  ok('syncAdminUid: re-sella admin (claim + doc)', (await claims('ADM')).role === 'admin' && (await roleDoc('ADM'))?.role === 'admin');

  // ── listTrustedStaffUids (avisos a staff)
  const staffUids = await R.listTrustedStaffUids();
  ok('avisos a staff: solo staff de confianza', staffUids.includes('ADM') && staffUids.includes('SOZA') && !staffUids.includes('FAKESUP') && !staffUids.includes('TGT'), JSON.stringify(staffUids));

  // ── Migración (dry-run / apply)
  for (const u of ['REALSUP', 'REVIEW', 'FAKEADM', 'PAS', 'SOZA', 'ADM']) { await db.doc(`artifacts/${APP}/roles/${u}`).delete(); }
  await auth.setCustomUserClaims('SOZA', null); await auth.setCustomUserClaims('DRV', null); await auth.setCustomUserClaims('ADM', null);
  const args = mig.parseArgs([]);
  ok('migración: dry-run por defecto', args.apply === false);
  const { plan } = await mig.buildPlan({ db, auth, args });
  const P = (u) => plan.find((e) => e.uid === u) || {};
  ok('migración: admin = solo el correo supremo', P('ADM').want === 'admin' && P('FAKEADM').want !== 'admin', JSON.stringify([P('ADM').want, P('FAKEADM').want]));
  ok('migración: supervisor con staffGrantedBy=admin confirmado', P('REALSUP').want === 'supervisor' && !P('REALSUP').review);
  ok('migración: correo staff conocido confirmado', P('SOZA').want === 'supervisor');
  ok('migración: supervisor de perfil sin respaldo → A REVISAR (sin staff)', P('FAKESUP').review && P('FAKESUP').want === 'client' && P('REVIEW').review);
  ok('migración: conductor → driver', P('DRV').want === 'driver');
  ok('migración: degradado (doc roles) se respeta', P('DEMOTED').why.startsWith('ya tiene doc roles') && P('DEMOTED').want !== 'supervisor');
  ok('migración: dry-run no escribió nada', !(await claims('REALSUP')).role && !(await roleDoc('REALSUP')));
  const args2 = mig.parseArgs(['--apply', '--approve=REVIEW']);
  const { plan: plan2 } = await mig.buildPlan({ db, auth, args: args2 });
  const n = await mig.applyPlan({ db, auth, plan: plan2 });
  ok('migración --apply: escribe', n > 0, String(n));
  ok('migración --apply: admin claim + doc', (await claims('ADM')).role === 'admin' && (await roleDoc('ADM'))?.role === 'admin');
  ok('migración --apply: supervisor confirmado claim + doc', (await claims('REALSUP')).role === 'supervisor' && (await roleDoc('REALSUP'))?.role === 'supervisor');
  ok('migración --apply: --approve da supervisor', (await claims('REVIEW')).role === 'supervisor');
  ok('migración --apply: supervisor falso sin staff (doc=client)', !['admin', 'supervisor'].includes((await claims('FAKESUP')).role) && (await roleDoc('FAKESUP'))?.role === 'client');
  ok('migración --apply: admin falso sin staff', !['admin', 'supervisor'].includes((await claims('FAKEADM')).role));
  ok('migración --apply: conductor claim driver', (await claims('DRV')).role === 'driver');
  ok('después de migrar: supervisor confirmado modera', (await review(A('REALSUP', people.REALSUP))) === 'ok');
  ok('después de migrar: falso sigue sin moderar', (await review(A('FAKESUP', people.FAKESUP))) === 'permission-denied');
  const { plan: plan3 } = await mig.buildPlan({ db, auth, args: mig.parseArgs([]) });
  ok('migración: segunda corrida no cambia staff (idempotente)', plan3.filter((e) => (e.action === 'set' || e.action === 'claim') && (e.want === 'admin' || e.want === 'supervisor')).length === 0, JSON.stringify(plan3.filter((e) => e.action === 'set' || e.action === 'claim').map((e) => [e.uid, e.want, e.action])));

  let fails = 0;
  for (const r of res) { if (r[0] === 'FAIL') fails++; console.log(r.join(' | ')); }
  console.log(`\n${res.length - fails}/${res.length} PASS`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
