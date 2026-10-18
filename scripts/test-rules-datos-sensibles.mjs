/**
 * Pruebas de firestore.rules para colecciones sensibles (soporte, verificación, bancos, depósitos,
 * WhatsApp, logs). Solo emulador, nunca producción.
 *   npx firebase emulators:exec --only firestore --project demo-hr "node scripts/test-rules-datos-sensibles.mjs"
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, addDoc, updateDoc, collection, query, where } from 'firebase/firestore';

const APP = 'comayagua-vip-pro-v4';
const env = await initializeTestEnvironment({
  projectId: 'demo-hr',
  firestore: { rules: fs.readFileSync(process.env.RULES || new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
const P = `artifacts/${APP}/public/data`;
await env.withSecurityRulesDisabled(async (c) => {
  const d = c.firestore();
  await setDoc(doc(d, `artifacts/${APP}/roles/sup`), { role: 'supervisor' });
  await setDoc(doc(d, `${P}/users/drv`), { role: 'driver' });
  await setDoc(doc(d, `${P}/users/pax`), { role: 'client' });
  await setDoc(doc(d, `${P}/support_tickets/t1`), { userId: 'pax', status: 'open' });
  await setDoc(doc(d, `${P}/verification_alerts/a1`), { uid: 'drv', identityPhoto: 'x' });
  await setDoc(doc(d, `${P}/driver_payout_bank_events/b1`), { driverId: 'drv', payoutAccount: '123' });
  await setDoc(doc(d, `${P}/driver_deposits/d1`), { driverId: 'drv', amount: 10 });
  await setDoc(doc(d, `${P}/driver_deposits/d2`), { driverId: 'other', amount: 20 });
  await setDoc(doc(d, `${P}/driver_payout_records/p1`), { driverId: 'drv', amount: 5 });
  await setDoc(doc(d, `${P}/whatsapp_cloud_inbox/m1`), { from: '504', text: 'hola' });
  await setDoc(doc(d, `${P}/whatsapp_booking_sessions/504`), { step: 1 });
  await setDoc(doc(d, `${P}/permission_logs/l1`), { uid: 'pax' });
  await setDoc(doc(d, `${P}/notification_campaigns/c1`), { title: 'x' });
  await setDoc(doc(d, `${P}/wa_invite_contacted/pax`), { contactedByName: 'sup' });
  await setDoc(doc(d, `${P}/balance_adjustments/x1`), { uid: 'pax' });
  await setDoc(doc(d, `${P}/trip_purge_log/x1`), { n: 1 });
  await setDoc(doc(d, `${P}/appSettings/main`), { a: 1 });
  await setDoc(doc(d, `${P}/auth_phone_index/50411112222`), { uid: 'drv', email: 'drv@x.com' });
});
const db = (uid) => env.authenticatedContext(uid).firestore();
const results = [];
async function t(name, p) { try { await p; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }

// Soporte
await t('pasajero crea su ticket', assertSucceeds(addDoc(collection(db('pax'), `${P}/support_tickets`), { userId: 'pax', status: 'open' })));
await t('pasajero NO crea ticket a nombre de otro', assertFails(addDoc(collection(db('pax'), `${P}/support_tickets`), { userId: 'drv' })));
await t('pasajero lee su ticket', assertSucceeds(getDoc(doc(db('pax'), `${P}/support_tickets/t1`))));
await t('otro NO lee ticket ajeno', assertFails(getDoc(doc(db('drv'), `${P}/support_tickets/t1`))));
await t('otro NO lista tickets', assertFails(getDocs(collection(db('drv'), `${P}/support_tickets`))));
await t('staff lista tickets', assertSucceeds(getDocs(collection(db('sup'), `${P}/support_tickets`))));
await t('staff resuelve ticket', assertSucceeds(updateDoc(doc(db('sup'), `${P}/support_tickets/t1`), { status: 'resolved' })));
await t('pasajero NO resuelve ticket', assertFails(updateDoc(doc(db('pax'), `${P}/support_tickets/t1`), { status: 'resolved' })));
// Verificación (fotos de identidad)
await t('conductor crea su alerta', assertSucceeds(addDoc(collection(db('drv'), `${P}/verification_alerts`), { uid: 'drv' })));
await t('conductor NO lee alertas (fotos de cédula)', assertFails(getDoc(doc(db('drv'), `${P}/verification_alerts/a1`))));
await t('pasajero NO lee alertas', assertFails(getDocs(collection(db('pax'), `${P}/verification_alerts`))));
await t('staff lee alertas', assertSucceeds(getDocs(collection(db('sup'), `${P}/verification_alerts`))));
// Banco
await t('conductor registra cambio de su banco', assertSucceeds(addDoc(collection(db('drv'), `${P}/driver_payout_bank_events`), { driverId: 'drv' })));
await t('pasajero NO lee eventos bancarios', assertFails(getDocs(collection(db('pax'), `${P}/driver_payout_bank_events`))));
await t('staff lee eventos bancarios', assertSucceeds(getDocs(collection(db('sup'), `${P}/driver_payout_bank_events`))));
// Depósitos / pagos
await t('conductor lee SUS depósitos (consulta por driverId)', assertSucceeds(getDocs(query(collection(db('drv'), `${P}/driver_deposits`), where('driverId', '==', 'drv')))));
await t('conductor NO lista todos los depósitos', assertFails(getDocs(collection(db('drv'), `${P}/driver_deposits`))));
await t('conductor NO lee depósito ajeno', assertFails(getDoc(doc(db('drv'), `${P}/driver_deposits/d2`))));
await t('conductor NO crea depósitos', assertFails(addDoc(collection(db('drv'), `${P}/driver_deposits`), { driverId: 'drv', amount: 999 })));
await t('staff crea depósito', assertSucceeds(addDoc(collection(db('sup'), `${P}/driver_deposits`), { driverId: 'drv', amount: 1 })));
await t('conductor lee SUS pagos', assertSucceeds(getDocs(query(collection(db('drv'), `${P}/driver_payout_records`), where('driverId', '==', 'drv')))));
await t('pasajero NO lista pagos', assertFails(getDocs(collection(db('pax'), `${P}/driver_payout_records`))));
// Herramientas de staff
for (const c of ['notification_campaigns', 'wa_invite_contacted', 'balance_adjustments']) {
  await t(`pasajero NO lee ${c}`, assertFails(getDocs(collection(db('pax'), `${P}/${c}`))));
  await t(`staff lee ${c}`, assertSucceeds(getDocs(collection(db('sup'), `${P}/${c}`))));
}
await t('pasajero NO escribe wa_invite_contacted con su uid', assertFails(setDoc(doc(db('pax'), `${P}/wa_invite_contacted/pax`), { x: 1 })));
await t('staff marca contactado', assertSucceeds(setDoc(doc(db('sup'), `${P}/wa_invite_contacted/pax`), { x: 1 })));
// Logs de permisos
await t('usuario registra su error de permisos', assertSucceeds(addDoc(collection(db('pax'), `${P}/permission_logs`), { uid: 'pax' })));
await t('usuario NO lee logs', assertFails(getDocs(collection(db('pax'), `${P}/permission_logs`))));
// Solo servidor
for (const c of ['whatsapp_cloud_inbox', 'whatsapp_booking_sessions', 'trip_purge_log']) {
  await t(`pasajero NO lee ${c}`, assertFails(getDocs(collection(db('pax'), `${P}/${c}`))));
  await t(`staff lee ${c}`, assertSucceeds(getDocs(collection(db('sup'), `${P}/${c}`))));
  await t(`staff NO escribe ${c}`, assertFails(addDoc(collection(db('sup'), `${P}/${c}`), { x: 1 })));
}
await t('docId == uid ya no abre whatsapp_booking_sessions', assertFails(setDoc(doc(db('504'), `${P}/whatsapp_booking_sessions/504`), { step: 9 })));
// Índice de teléfonos
await t('sin sesión NO lee el índice', assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${P}/auth_phone_index/50411112222`))));
await t('otro NO lee el índice ajeno', assertFails(getDoc(doc(db('pax'), `${P}/auth_phone_index/50411112222`))));
await t('dueño lee su índice', assertSucceeds(getDoc(doc(db('drv'), `${P}/auth_phone_index/50411112222`))));
await t('pasajero crea el índice de su teléfono', assertSucceeds(setDoc(doc(db('pax'), `${P}/auth_phone_index/50433334444`), { uid: 'pax', email: 'p@x.com' }, { merge: true })));
await t('pasajero NO pisa el teléfono de otro', assertFails(setDoc(doc(db('pax'), `${P}/auth_phone_index/50411112222`), { uid: 'pax', email: 'p@x.com' }, { merge: true })));
await t('pasajero NO crea índice a nombre de otro', assertFails(setDoc(doc(db('pax'), `${P}/auth_phone_index/50455556666`), { uid: 'drv', email: 'evil@x.com' })));
await t('staff rellena el índice de otro', assertSucceeds(setDoc(doc(db('sup'), `${P}/auth_phone_index/50477778888`), { uid: 'drv', email: 'drv@x.com' }, { merge: true })));
// El catch-all sigue sirviendo para lo demás
await t('pasajero lee appSettings (catch-all)', assertSucceeds(getDoc(doc(db('pax'), `${P}/appSettings/main`))));

await env.cleanup();
let fail = 0;
for (const r of results) { if (r[0] === 'FAIL') fail++; console.log(r.join(' | ')); }
console.log(`${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
