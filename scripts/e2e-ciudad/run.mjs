/** v.42 Ciudad por GPS en el navegador (Firestore simulado). node scripts/e2e-ciudad/run.mjs <sitio> [png] */
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const MOCKS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e-origen-pasajero', 'firebase-mocks');
const site = path.resolve(process.argv[2] || '.'); const png = process.argv[3] || '/workspace/artifacts/ciudad/real-ciudad.png';
fs.mkdirSync(path.dirname(png), { recursive: true });
const { chromium } = createRequire('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/')('playwright-core');
const mockMap = { 'firebase-firestore.js': 'firestore.js', 'firebase-auth.js': 'auth.js', 'firebase-app.js': 'app.js', 'firebase-functions.js': 'functions.js', 'firebase-storage.js': 'storage.js', 'firebase-messaging.js': 'messaging.js' };
const CT = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
async function run({ role, profileExtra, geo, label, shot }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    geolocation: geo, permissions: ['geolocation'], locale: 'es-HN', timezoneId: 'America/Tegucigalpa' });
  await ctx.addInitScript(([role, extra]) => {
    const uid = 'e2e-u'; const now = Date.now();
    window.__HR_MOCK_USER = { uid, email: 'e2e@example.com', emailVerified: true, displayName: 'U', providerData: [], getIdToken: async () => 'x', getIdTokenResult: async () => ({ claims: {} }), reload: async () => {} };
    const profile = { role, name: 'Usuario E2E', email: 'e2e@example.com', phone: '+50499999999', birthDate: '1990-05-13', gender: 'male', approvalStatus: 'approved', status: 'approved', identityVerified: true, legalAccepted: true, termsAccepted: true, privacyAccepted: true, legalAcceptedAt: now, vehicleType: 'moto', createdAt: now - 864e5, ...extra };
    window.__HR_MOCK_PROFILE = profile;
    window.__HR_MOCK_DOCS = (p) => p.endsWith(`/users/${uid}/profile/data`) ? profile : null;
    const _u = window.__HR_UPD = [];
    try { localStorage.setItem('honduber_market', 'hn'); localStorage.setItem('hrInstallBannerDismissedAt', String(now)); localStorage.setItem('hr_loc_disclosure_v1_driver', '1'); localStorage.setItem('hr_loc_disclosure_v1_client', '1'); } catch (_) {}
  }, [role, profileExtra]);
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, (r) => { const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1]; r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(MOCKS, mockMap[f])) }); });
  await ctx.route(/^https:\/\/honduraite\.com\//, (r) => { let p = decodeURIComponent(new URL(r.request().url()).pathname); if (p.endsWith('/')) p += 'index.html'; const fp = path.join(site, p);
    if (!fp.startsWith(site) || !fs.existsSync(fp)) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ contentType: CT[path.extname(fp)] || 'application/octet-stream', body: fs.readFileSync(fp) }); });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto('https://honduraite.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(16000);
  const r = await page.evaluate(() => ({ mod: !!window.hrUserCity, zone: window.userProfile?.serviceZoneId, src: window.userProfile?.serviceZoneSource, active: window.activeServiceZoneId,
    wrote: (window.__HR_MOCK_WRITES || []).filter((w) => /profile\/data$|public\/data\/users\//.test(w[1] || '')).length,
    samples: JSON.parse(localStorage.getItem('hr_city_samples_e2e-u') || '[]').map((s) => s.z) }));
  if (shot) { await page.evaluate(() => document.querySelectorAll('#hr-a2hs-overlay,.hr-loc-disclosure').forEach((e) => e.remove())); await page.screenshot({ path: shot }); }
  await ctx.close();
  return { ...r, errs };
}
const TEG = { latitude: 14.0723, longitude: -87.1921 }, SPS = { latitude: 15.505, longitude: -88.025 };
const metro = (z) => ['tegucigalpa', 'comayaguela'].includes(z);
let r = await run({ role: 'client', profileExtra: { serviceZoneId: 'comayagua', serviceZoneSource: 'default' }, geo: TEG, shot: png });
t('pasajero registrado sin GPS (default) en Tegus → Tegucigalpa', metro(r.zone) && r.src === 'gps' && metro(r.active) && r.wrote > 0, JSON.stringify(r));
r = await run({ role: 'driver', profileExtra: { serviceZoneId: 'comayagua', serviceZoneSource: 'default' }, geo: SPS });
t('conductor registrado sin GPS en SPS → San Pedro Sula', r.zone === 'san-pedro-sula' && r.src === 'gps', JSON.stringify(r));
r = await run({ role: 'driver', profileExtra: { serviceZoneId: 'comayagua' }, geo: TEG });
t('conductor viejo «Comayagua» en Tegus: 1ª lectura solo se anota (2ª lectura ≥2 h corrige)', r.zone === 'comayagua' && r.samples.some(metro), JSON.stringify(r));
r = await run({ role: 'client', profileExtra: { serviceZoneId: 'comayagua', serviceZoneSource: 'manual' }, geo: TEG });
t('elegida a mano → el perfil no se cambia', r.zone === 'comayagua' && r.src === 'manual', JSON.stringify(r));
t('sin errores JS', !r.errs.length, JSON.stringify(r.errs));
console.log(`\n${pass} PASS, ${fail} FAIL`); await browser.close(); process.exit(fail ? 1 : 0);
