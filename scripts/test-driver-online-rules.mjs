// Reglas: las escrituras exactas de «Ponerme en línea» / «Pausar» del conductor.
// RULES=firestore.rules firebase emulators:exec --project demo-hr --only firestore "node scripts/test-driver-online-rules.mjs"
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
const APP = 'comayagua-vip-pro-v4';
const env = await initializeTestEnvironment({ projectId: 'demo-hr', firestore: { rules: fs.readFileSync(process.env.RULES, 'utf8'), host: '127.0.0.1', port: 8080 } });
const P = `artifacts/${APP}/public/data`;
const PRIV = (u) => `artifacts/${APP}/users/${u}/profile/data`;
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  for (const u of ['drvClaim', 'drvNoClaim', 'drvNew']) {
    await setDoc(doc(db, `${P}/users/${u}`), { role: 'driver', approvalStatus: 'approved', name: u });
    await setDoc(doc(db, PRIV(u)), { role: 'driver', phone: '9999' });
  }
  await setDoc(doc(db, `${P}/drivers_location/drvClaim`), { online: false, updatedAt: 1 });
});
const res = []; const ok = async (n, p) => { try { await p; res.push(['PASS', n]); } catch (e) { res.push(['FAIL', n, String(e.message || e).slice(0, 160)]); } };
const ctxs = {
  drvClaim: env.authenticatedContext('drvClaim', { email: 'a@x.com', role: 'driver' }).firestore(),
  drvNoClaim: env.authenticatedContext('drvNoClaim', { email: 'b@x.com' }).firestore(),
  drvNew: env.authenticatedContext('drvNew', { phone_number: '+50499990000' }).firestore()
};
const now = Date.now();
for (const [u, db] of Object.entries(ctxs)) {
  // startDriverLocationTracking: alta en línea (merge)
  await ok(`${u}: drivers_location online:true (alta completa)`, assertSucceeds(setDoc(doc(db, `${P}/drivers_location/${u}`), {
    online: true, appVisible: true, appVisibleAt: now, name: u, phone: '50499990000', approvalStatus: 'approved', vehicleType: 'moto', vehiclePlate: null,
    serviceZoneId: 'comayagua', searchRadiusKm: 5, updatedAt: now }, { merge: true })));
  // publishDriverGps / heartbeat
  await ok(`${u}: drivers_location GPS`, assertSucceeds(setDoc(doc(db, `${P}/drivers_location/${u}`), { lat: 14.4, lng: -87.6, heading: null, accuracy: 10, online: true, updatedAt: now, serviceZoneName: 'Comayagua' }, { merge: true })));
  // ensureDriverDepositWorkSchedule (perfil público y privado)
  const patch = { depositWorkStartedAtMs: now, depositDeadlineAt: Timestamp.fromDate(new Date(now + 864e5)), depositDeadlineAtMs: now + 864e5, updatedAt: serverTimestamp(),
    depositWarning2hSent: false, depositWarning2hSentAt: null, depositAutoBlocked: false, depositAutoBlockedAt: null, depositAutoBlockedReason: null };
  await ok(`${u}: perfil público deposit schedule`, assertSucceeds(setDoc(doc(db, `${P}/users/${u}`), patch, { merge: true })));
  await ok(`${u}: perfil privado deposit schedule`, assertSucceeds(setDoc(doc(db, PRIV(u)), patch, { merge: true })));
  // stopDriverLocationTracking: pausa
  await ok(`${u}: drivers_location online:false (pausa)`, assertSucceeds(setDoc(doc(db, `${P}/drivers_location/${u}`), { online: false, appVisible: false, appVisibleAt: now, updatedAt: now }, { merge: true })));
}
await ok('otro conductor NO puede escribir mi drivers_location', assertFails(setDoc(doc(ctxs.drvNoClaim, `${P}/drivers_location/drvClaim`), { online: true }, { merge: true })));
for (const r of res) console.log(r.join(' | '));
console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
await env.cleanup();
process.exit(res.every((r) => r[0] === 'PASS') ? 0 : 1);
