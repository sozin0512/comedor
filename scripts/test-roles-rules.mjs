// Uso (necesita @firebase/rules-unit-testing + firebase):
//   RULES=firestore.rules firebase emulators:exec --project demo-hr --only firestore "node scripts/test-roles-rules.mjs"
// Pruebas de reglas: roles de confianza (menú por rol). RULES=/workspace/honduraite/firestore.rules
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, limit, deleteField } from 'firebase/firestore';

const APP = 'comayagua-vip-pro-v4';
const env = await initializeTestEnvironment({
  projectId: 'demo-hr',
  firestore: { rules: fs.readFileSync(process.env.RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});
const P = `artifacts/${APP}/public/data`;
const PRIV = (u) => `artifacts/${APP}/users/${u}/profile/data`;
const ROLES = (u) => `artifacts/${APP}/roles/${u}`;
const ymd = (y) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };

await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const users = {
    pas: { role: 'client', name: 'Ana' }, pas2: { role: 'client' }, drv: { role: 'driver', approvalStatus: 'approved' },
    fakesup: { role: 'supervisor' }, fakeadm: { role: 'admin' }, supdoc: { role: 'supervisor', staffGrantedBy: 'ADMINUID' },
    supclaim: { role: 'client' }, demoted: { role: 'supervisor' }, admclaim: { role: 'client' }, adm: { role: 'admin' }, soza: { role: 'supervisor' },
  };
  for (const [u, d] of Object.entries(users)) {
    await setDoc(doc(db, `${P}/users/${u}`), d);
    await setDoc(doc(db, PRIV(u)), { ...d, phone: '9999' });
  }
  await setDoc(doc(db, ROLES('supdoc')), { role: 'supervisor', grantedBy: 'ADMINUID', source: 'migration' });
  await setDoc(doc(db, ROLES('demoted')), { role: 'client', grantedBy: 'ADMINUID', source: 'setUserRole' });
  await setDoc(doc(db, `${P}/stores/adult18`), { name: 'F', ownerId: 'x', active: true, adultsOnly: true, approvalStatus: 'approved' });
  await setDoc(doc(db, `${P}/trips/t1`), { clientId: 'pas', driverId: 'drv', status: 'accepted', price: 50 });
  await setDoc(doc(db, `${P}/trips/t2`), { clientId: 'pas2', status: 'pending', price: 40 });
});

const ctx = {
  anon: () => env.unauthenticatedContext().firestore(),
  pas: () => env.authenticatedContext('pas', { email: 'ana@x.com' }).firestore(),
  pas2: () => env.authenticatedContext('pas2', { email: 'p2@x.com' }).firestore(),
  drv: () => env.authenticatedContext('drv', { email: 'd@x.com', role: 'driver' }).firestore(),
  fakesup: () => env.authenticatedContext('fakesup', { email: 'f@x.com' }).firestore(),
  fakeadm: () => env.authenticatedContext('fakeadm', { email: 'fa@x.com' }).firestore(),
  supdoc: () => env.authenticatedContext('supdoc', { email: 's@x.com' }).firestore(),            // doc roles, sin claim
  supclaim: () => env.authenticatedContext('supclaim', { email: 'sc@x.com', role: 'supervisor', staff: true }).firestore(), // claim, sin doc
  demoted: () => env.authenticatedContext('demoted', { email: 'dm@x.com', role: 'supervisor', staff: true }).firestore(), // claim viejo, doc dice client
  admclaim: () => env.authenticatedContext('admclaim', { email: 'ac@x.com', role: 'admin', staff: true }).firestore(),
  adm: () => env.authenticatedContext('adm', { email: 'josuesoza0513@gmail.com' }).firestore(),     // correo supremo (sin claim)
  soza: () => env.authenticatedContext('soza', { email: 'sozajob146@gmail.com' }).firestore(),    // correo staff conocido
  forged: () => env.authenticatedContext('forged', { email: 'x@x.com', role: 'Admin' }).firestore(),
};
const results = [];
async function t(name, p) { try { await p; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).slice(0, 160)]); } }
const ok = (n, p) => t(n, assertSucceeds(p));
const no = (n, p) => t(n, assertFails(p));
const staffRead = (d) => getDoc(doc(d, PRIV('pas2')));               // perfil privado ajeno: solo staff
const staffList = (d) => getDocs(query(collection(d, `artifacts/${APP}/users/pas2/vehicles`), limit(50))); // vehículos ajenos: solo staff
const adultQ = (d) => getDocs(query(collection(d, `${P}/stores`), where('active', '==', true), where('adultsOnly', '==', true), limit(10)));

// ── 1. Quién es staff (rutas de staff en Firestore)
for (const u of ['pas', 'drv', 'fakesup', 'fakeadm', 'demoted', 'forged']) {
  await no(`${u}: NO lee perfil privado ajeno (no es staff)`, staffRead(ctx[u]()));
  await no(`${u}: NO lista vehículos ajenos`, staffList(ctx[u]()));
  await no(`${u}: NO edita perfil de otro usuario`, updateDoc(doc(ctx[u](), `${P}/users/pas2`), { approvalStatus: 'suspended' }));
}
for (const u of ['supdoc', 'supclaim', 'admclaim', 'adm', 'soza']) {
  await ok(`${u}: lee perfil privado ajeno (staff)`, staffRead(ctx[u]()));
  await ok(`${u}: lista vehículos ajenos (staff)`, staffList(ctx[u]()));
  await ok(`${u}: edita aprobación de otro (moderación)`, updateDoc(doc(ctx[u](), `${P}/users/pas2`), { approvalStatus: 'approved' }));
  await ok(`${u}: consulta tiendas +18 sin fecha (staff)`, adultQ(ctx[u]()));
}
await no('fakesup (role supervisor solo en perfil): consulta +18 DENEGADA', adultQ(ctx.fakesup()));

// ── 2. getRole() arreglado: conductor / pasajero
await ok('drv: lee viaje pendiente (conductor)', getDoc(doc(ctx.drv(), `${P}/trips/t2`)));
await ok('drv (asignado): actualiza su viaje (llegada)', updateDoc(doc(ctx.drv(), `${P}/trips/t1`), { arrivedAtMs: 1 }));
await ok('pas: lee su viaje', getDoc(doc(ctx.pas(), `${P}/trips/t1`)));
await ok('pas: crea su viaje', setDoc(doc(ctx.pas(), `${P}/trips/n1`), { clientId: 'pas', status: 'pending', price: 10 }));

// ── 3. Nadie se da rol de staff a sí mismo
for (const u of ['pas', 'drv']) {
  await no(`${u}: se pone role supervisor (público) DENEGADO`, updateDoc(doc(ctx[u](), `${P}/users/${u}`), { role: 'supervisor' }));
  await no(`${u}: se pone role admin (público) DENEGADO`, updateDoc(doc(ctx[u](), `${P}/users/${u}`), { role: 'admin' }));
  await no(`${u}: se pone role supervisor (privado) DENEGADO`, updateDoc(doc(ctx[u](), PRIV(u)), { role: 'supervisor' }));
  await no(`${u}: se pone staffGrantedBy DENEGADO`, updateDoc(doc(ctx[u](), `${P}/users/${u}`), { staffGrantedBy: u }));
  await no(`${u}: se marca cuenta de prueba DENEGADO`, updateDoc(doc(ctx[u](), `${P}/users/${u}`), { isTestAccount: true }));
  await no(`${u}: escribe su doc roles DENEGADO`, setDoc(doc(ctx[u](), ROLES(u)), { role: 'admin' }));
  await ok(`${u}: lee su propio doc roles (aunque no exista)`, getDoc(doc(ctx[u](), ROLES(u))));
}
await no('pas: lee doc roles de otro DENEGADO', getDoc(doc(ctx.pas(), ROLES('supdoc'))));
await ok('pas: cambia su nombre/foto (normal)', updateDoc(doc(ctx.pas(), `${P}/users/pas`), { name: 'Ana M.', photoUrl: 'x' }));
await ok('pas: pasa a conductor (registro de conductor)', updateDoc(doc(ctx.pas(), `${P}/users/pas`), { role: 'driver' }));
await ok('pas: vuelve a client', updateDoc(doc(ctx.pas(), `${P}/users/pas`), { role: 'client' }));
await ok('fakesup: se baja a client (stripFake) OK', updateDoc(doc(ctx.fakesup(), `${P}/users/fakesup`), { role: 'client' }));
await ok('fakesup: limpia staffGrantedBy a null OK', updateDoc(doc(ctx.fakesup(), `${P}/users/fakesup`), { staffGrantedBy: null, staffGrantedAt: null }));
await no('nuevo: crea perfil con role supervisor DENEGADO', setDoc(doc(env.authenticatedContext('new1').firestore(), `${P}/users/new1`), { role: 'supervisor', name: 'N' }));
await no('nuevo: crea perfil con role admin DENEGADO', setDoc(doc(env.authenticatedContext('new2').firestore(), `${P}/users/new2`), { role: 'admin' }));
await no('nuevo: crea perfil privado con staffGrantedBy DENEGADO', setDoc(doc(env.authenticatedContext('new3').firestore(), PRIV('new3')), { role: 'client', staffGrantedBy: 'x' }));
await ok('nuevo: crea perfil pasajero OK', setDoc(doc(env.authenticatedContext('new4').firestore(), `${P}/users/new4`), { role: 'client', name: 'N' }));
await ok('nuevo: crea perfil conductor OK', setDoc(doc(env.authenticatedContext('new5').firestore(), PRIV('new5')), { role: 'driver', name: 'N' }));
await ok('nuevo: crea perfil sin role OK', setDoc(doc(env.authenticatedContext('new6').firestore(), `${P}/users/new6`), { name: 'N' }));
await no('forged (claim "Admin" mal escrito): no es admin', updateDoc(doc(ctx.forged(), `${P}/users/pas2`), { role: 'supervisor' }));

// ── 4. Staff: supervisor NO da staff; admin sí
await ok('supdoc: cambia otro client→driver OK', updateDoc(doc(ctx.supdoc(), `${P}/users/pas2`), { role: 'driver' }));
await no('supdoc: hace supervisor a otro DENEGADO (solo admin)', updateDoc(doc(ctx.supdoc(), `${P}/users/pas2`), { role: 'supervisor' }));
await no('supdoc: pone staffGrantedBy a otro DENEGADO', updateDoc(doc(ctx.supdoc(), `${P}/users/pas2`), { staffGrantedBy: 'supdoc' }));
await no('supdoc: escribe doc roles de otro DENEGADO', setDoc(doc(ctx.supdoc(), ROLES('pas2')), { role: 'supervisor' }));
await ok('supdoc: marca cuenta de prueba OK (staff)', updateDoc(doc(ctx.supdoc(), `${P}/users/pas2`), { isTestAccount: true }));
await ok('supdoc: lee doc roles de otro (staff)', getDoc(doc(ctx.supdoc(), ROLES('demoted'))));
await ok('adm (correo): hace supervisor a otro (perfil) OK', updateDoc(doc(ctx.adm(), `${P}/users/pas2`), { role: 'supervisor', staffGrantedBy: 'adm' }));
await ok('admclaim (claim admin): hace client a otro OK', updateDoc(doc(ctx.admclaim(), `${P}/users/pas2`), { role: 'client', staffGrantedBy: null }));
await no('adm: escribe doc roles desde la app DENEGADO (solo servidor)', setDoc(doc(ctx.adm(), ROLES('pas2')), { role: 'supervisor' }));
await no('nadie: lastPushTest desde la app', updateDoc(doc(ctx.adm(), `${P}/users/adm`), { lastPushTest: 1 }));

// ── 5. Degradación inmediata: doc roles manda sobre claim viejo
await no('demoted (claim supervisor viejo, doc=client): NO es staff', staffRead(ctx.demoted()));

// ── 6. Papelera / campos del servidor en viajes
const trash = { trashedAtMs: 1, trashedBy: 'x', trashPurgeAfterMs: 2 };
await no('pas (pasajero del viaje): manda a papelera DENEGADO', updateDoc(doc(ctx.pas(), `${P}/trips/t1`), trash));
await no('drv (conductor del viaje): manda a papelera DENEGADO', updateDoc(doc(ctx.drv(), `${P}/trips/t1`), trash));
await no('pas: se marca revisado DENEGADO', updateDoc(doc(ctx.pas(), `${P}/trips/t1`), { staffReviewedAtMs: 1 }));
await no('drv: escribe deliveredTo DENEGADO', updateDoc(doc(ctx.drv(), `${P}/trips/t1`), { deliveredTo: ['drv'] }));
await no('supdoc (staff): papelera directa DENEGADO (solo callable)', updateDoc(doc(ctx.supdoc(), `${P}/trips/t1`), trash));
await no('adm: restaurar directo DENEGADO (solo callable)', updateDoc(doc(ctx.adm(), `${P}/trips/t1`), { restoredAtMs: 1 }));
await no('pas: crea viaje ya en papelera DENEGADO', setDoc(doc(ctx.pas(), `${P}/trips/n2`), { clientId: 'pas', status: 'pending', trashedAtMs: 1 }));
await no('pas: crea viaje con resendCount DENEGADO', setDoc(doc(ctx.pas(), `${P}/trips/n3`), { clientId: 'pas', status: 'pending', resendCount: 9 }));
await ok('pas: cancela su viaje (normal) OK', updateDoc(doc(ctx.pas(), `${P}/trips/t1`), { status: 'cancelled' }));
await ok('supdoc: edita precio de un viaje (staff) OK', updateDoc(doc(ctx.supdoc(), `${P}/trips/t2`), { price: 45 }));
await no('pas2: viaje ajeno no-participante con papelera DENEGADO', updateDoc(doc(ctx.pas2(), `${P}/trips/t1`), trash));
await no('anon: lee perfiles DENEGADO', getDoc(doc(ctx.anon(), `${P}/users/pas`)));

let fails = 0;
for (const r of results) { if (r[0] === 'FAIL') fails++; console.log(r.join(' | ')); }
console.log(`\n${results.length - fails}/${results.length} PASS`);
await env.cleanup();
process.exit(fails ? 1 : 0);
