/**
 * Pruebas de storage.rules (solo emulador):
 *   npx firebase emulators:exec --only storage --project demo-hr "node scripts/test-storage-rules.mjs"
 *   (STORAGE_PORT si el emulador no usa 9199)
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadString, getMetadata } from 'firebase/storage';

const APP = 'comayagua-vip-pro-v4';
const env = await initializeTestEnvironment({
  projectId: 'demo-hr',
  storage: { rules: fs.readFileSync(process.env.STORAGE_RULES || new URL('../storage.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: Number(process.env.STORAGE_PORT || 9199) },
});
const U = `artifacts/${APP}/users/u1`;
await env.withSecurityRulesDisabled(async (c) => {
  const st = c.storage();
  for (const p of ['profile/avatar.jpg', 'verification/id-front.jpg', 'resubmit/x.jpg', 'deposits/1.jpg', 'surveys/a.webm', 'vehicles/v1/p.jpg', 'store_logos/l.jpg']) {
    await uploadString(ref(st, `${U}/${p}`), 'x');
  }
});
const st = (uid, token = {}) => env.authenticatedContext(uid, token).storage();
const results = [];
async function t(name, p) { try { await p; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const meta = (s, p) => getMetadata(ref(s, `${U}/${p}`));
await t('otro usuario ve foto de perfil', assertSucceeds(meta(st('u2'), 'profile/avatar.jpg')));
await t('otro usuario ve foto de vehículo', assertSucceeds(meta(st('u2'), 'vehicles/v1/p.jpg')));
await t('otro usuario ve logo de tienda', assertSucceeds(meta(st('u2'), 'store_logos/l.jpg')));
for (const p of ['verification/id-front.jpg', 'resubmit/x.jpg', 'deposits/1.jpg', 'surveys/a.webm']) {
  await t(`otro usuario NO lee ${p}`, assertFails(meta(st('u2'), p)));
  await t(`dueño lee ${p}`, assertSucceeds(meta(st('u1'), p)));
  await t(`admin lee ${p}`, assertSucceeds(meta(st('adm', { email: 'josuesoza0513@gmail.com' }), p)));
}
await t('dueño sube a verification', assertSucceeds(uploadString(ref(st('u1'), `${U}/verification/new.jpg`), 'x', 'raw', { contentType: 'image/jpeg' })));
await t('otro NO sube a carpeta ajena', assertFails(uploadString(ref(st('u2'), `${U}/profile/hack.jpg`), 'x', 'raw', { contentType: 'image/jpeg' })));
await env.cleanup();
let fail = 0;
for (const r of results) { if (r[0] === 'FAIL') fail++; console.log(r.join(' | ')); }
console.log(`${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
