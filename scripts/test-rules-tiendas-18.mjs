/**
 * Pruebas de firestore.rules para Tiendas (+18 en el servidor). Solo emulador, nunca producción.
 * Requiere Java + (fuera del repo): npm i firebase-tools @firebase/rules-unit-testing@5 firebase@12
 *   npx firebase emulators:exec --only firestore --project demo-hr "node scripts/test-rules-tiendas-18.mjs"
 * La prueba "sup (por role) puede quitar +18" FALLA hoy por un error previo en getRole()
 * (usa userDoc.exists, que no existe en reglas): los supervisores por role no pasan isStaff().
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where, limit } from 'firebase/firestore';

const APP = 'comayagua-vip-pro-v4';
const env = await initializeTestEnvironment({
  projectId: 'demo-hr',
  firestore: { rules: fs.readFileSync(process.env.RULES || new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
const P = `artifacts/${APP}/public/data`;
const ymd = (yearsAgo, dayShift = 0) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - yearsAgo); d.setUTCDate(d.getUTCDate() + dayShift); return d.toISOString().slice(0, 10); };

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, `${P}/users/adult`), { role: 'client', birthDate: ymd(30) });
  await setDoc(doc(db, `${P}/users/minor`), { role: 'client', birthDate: ymd(15) });
  await setDoc(doc(db, `${P}/users/turns18tomorrow`), { role: 'client', birthDate: ymd(18, 1) });
  await setDoc(doc(db, `${P}/users/turned18today`), { role: 'client', birthDate: ymd(18, 0) });
  await setDoc(doc(db, `${P}/users/nobirth`), { role: 'client' });
  await setDoc(doc(db, `${P}/users/privonly`), { role: 'client' });
  await setDoc(doc(db, `artifacts/${APP}/users/privonly/profile/data`), { birthDate: ymd(40) });
  await setDoc(doc(db, `${P}/users/sup`), { role: 'supervisor' });
  await setDoc(doc(db, `${P}/stores/normal`), { name: 'Pasion', ownerId: 'o1', active: true, adultsOnly: false, approvalStatus: 'approved' });
  await setDoc(doc(db, `${P}/stores/adult18`), { name: 'Ferias', ownerId: 'minorOwner', active: true, adultsOnly: true, requiresAge18: true, approvalStatus: 'approved' });
});
const db = (uid) => env.authenticatedContext(uid).firestore();
const general = (d) => getDocs(query(collection(d, `${P}/stores`), where('active', '==', true), where('adultsOnly', '==', false), limit(300)));
const adultQ = (d) => getDocs(query(collection(d, `${P}/stores`), where('active', '==', true), where('adultsOnly', '==', true), limit(300)));
const oldQ = (d) => getDocs(query(collection(d, `${P}/stores`), where('active', '==', true), limit(300)));
const results = [];
async function t(name, p) { try { await p; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }

for (const u of ['adult', 'minor', 'nobirth', 'sup']) await t(`${u}: consulta general (adultsOnly==false)`, assertSucceeds(general(db(u))));
await t('minor: general query returns only non-+18', general(db('minor')).then((s) => { if (s.docs.map((d) => d.id).join() !== 'normal') throw new Error(s.docs.map((d) => d.id).join()); }));
await t('adult: consulta +18', assertSucceeds(adultQ(db('adult'))));
await t('privonly (birthDate solo en perfil privado): consulta +18', assertSucceeds(adultQ(db('privonly'))));
await t('turned18today: consulta +18', assertSucceeds(adultQ(db('turned18today'))));
await t('sup: consulta +18', assertSucceeds(adultQ(db('sup'))));
await t('minor: consulta +18 DENEGADA', assertFails(adultQ(db('minor'))));
await t('turns18tomorrow: consulta +18 DENEGADA', assertFails(adultQ(db('turns18tomorrow'))));
await t('nobirth: consulta +18 DENEGADA', assertFails(adultQ(db('nobirth'))));
await t('minor: consulta vieja (sin filtro adultsOnly) DENEGADA', assertFails(oldQ(db('minor'))));
await t('adult: consulta vieja sigue funcionando', assertSucceeds(oldQ(db('adult'))));
await t('minor: enlace directo a tienda +18 DENEGADO', assertFails(getDoc(doc(db('minor'), `${P}/stores/adult18`))));
await t('minor: enlace directo a tienda normal OK', assertSucceeds(getDoc(doc(db('minor'), `${P}/stores/normal`))));
await t('no logueado: DENEGADO', assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${P}/stores/normal`))));
await t('dueño menor lee su propia tienda +18', assertSucceeds(getDoc(doc(db('minorOwner'), `${P}/stores/adult18`))));
await t('dueño: consulta por ownerId', assertSucceeds(getDocs(query(collection(db('minorOwner'), `${P}/stores`), where('ownerId', '==', 'minorOwner'), limit(1)))));
await t('sup: lista staff sin filtros', assertSucceeds(getDocs(query(collection(db('sup'), `${P}/stores`), limit(300)))));
await t('dueño NO puede quitar +18', assertFails(updateDoc(doc(db('minorOwner'), `${P}/stores/adult18`), { adultsOnly: false, requiresAge18: false })));
await t('dueño puede editar otros campos de tienda +18', assertSucceeds(updateDoc(doc(db('minorOwner'), `${P}/stores/adult18`), { description: 'x', adultsOnly: true })));
await t('admin (email) puede quitar +18', assertSucceeds(updateDoc(doc(env.authenticatedContext('adm', { email: 'josuesoza0513@gmail.com' }).firestore(), `${P}/stores/adult18`), { adultsOnly: true })));
await t('ghost (sin documentos de perfil): consulta +18 DENEGADA', assertFails(adultQ(db('ghost'))));
await t('ghost: consulta general OK', assertSucceeds(general(db('ghost'))));
await t('minor: catch-all de otra coleccion publica sigue OK', assertSucceeds(getDoc(doc(db('minor'), `${P}/appSettings/x`))));
// Conocido: falla por getRole() (ver encabezado)
await t('sup (por role) puede quitar +18 [verifica isStaff por role]', assertSucceeds(updateDoc(doc(db('sup'), `${P}/stores/adult18`), { adultsOnly: false })));
await t('dueño guarda números autorizados de WhatsApp', assertSucceeds(updateDoc(doc(db('o1'), `${P}/stores/normal`), { waAuthorizedPhones: ['50487776666'] })));
await t('otro usuario NO puede autorizarse en tienda ajena', assertFails(updateDoc(doc(db('adult'), `${P}/stores/normal`), { waAuthorizedPhones: ['50411111111'] })));
await t('dueño: máximo 10 números autorizados', assertFails(updateDoc(doc(db('o1'), `${P}/stores/normal`), { waAuthorizedPhones: Array.from({ length: 11 }, (_, i) => `5049000000${i}`) })));
await t('números autorizados deben ser lista', assertFails(updateDoc(doc(db('o1'), `${P}/stores/normal`), { waAuthorizedPhones: '50487776666' })));
await t('dueño puede marcar +18', assertSucceeds(updateDoc(doc(db('o1'), `${P}/stores/normal`), { adultsOnly: true })));
await t('crear tienda con adultsOnly bool', assertSucceeds(setDoc(doc(db('n1'), `${P}/stores/new1`), { name: 'Nueva', ownerId: 'n1', active: true, adultsOnly: false, approvalStatus: 'pending' })));
await t('crear tienda sin adultsOnly DENEGADO', assertFails(setDoc(doc(db('n2'), `${P}/stores/new2`), { name: 'Nueva', ownerId: 'n2', active: true, approvalStatus: 'pending' })));
await t('crear tienda auto-aprobada DENEGADO', assertFails(setDoc(doc(db('n3'), `${P}/stores/new3`), { name: 'N', ownerId: 'n3', adultsOnly: false, approvalStatus: 'approved' })));

await env.cleanup();
results.forEach((r) => console.log(r.join(' | ')));
console.log(results.filter((r) => r[0] === 'FAIL').length ? 'SOME FAILED' : 'ALL PASSED');
