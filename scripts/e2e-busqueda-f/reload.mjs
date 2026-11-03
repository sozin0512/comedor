/** v.41: recarga real con viaje pendiente guardado + panel «Maximizar» guardado. node reload.mjs <sitio> <png> */
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e-origen-pasajero');
const site = path.resolve(process.argv[2]); const png = process.argv[3];
const { chromium } = createRequire('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/')('playwright-core');
const MOCKS = path.join(here, 'firebase-mocks');
const mockMap = { 'firebase-firestore.js': 'firestore.js', 'firebase-auth.js': 'auth.js', 'firebase-app.js': 'app.js', 'firebase-functions.js': 'functions.js', 'firebase-storage.js': 'storage.js', 'firebase-messaging.js': 'messaging.js' };
const CT = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  userAgent: process.env.UA || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  geolocation: { latitude: 14.0818, longitude: -87.2068 }, permissions: ['geolocation'], locale: 'es-HN', timezoneId: 'America/Tegucigalpa' });
await ctx.addInitScript(() => {
  const uid = 'e2e-pasajero'; const now = Date.now();
  window.__HR_MOCK_USER = { uid, email: 'e2e@example.com', emailVerified: true, displayName: 'P', providerData: [], getIdToken: async () => 'x', getIdTokenResult: async () => ({ claims: {} }), reload: async () => {} };
  const profile = { role: 'client', name: 'Pasajero E2E', email: 'e2e@example.com', phone: '+50499999999', birthDate: '1990-05-13', gender: 'male', approvalStatus: 'approved', passengerVerificationStatus: 'approved', identityVerified: true, legalAccepted: true, termsAccepted: true, privacyAccepted: true, legalAcceptedAt: now, city: 'tegucigalpa', serviceZoneId: 'tegucigalpa', createdAt: now - 864e5 * 300 };
  const trip = { status: 'pending', clientId: uid, originLat: 14.0818, originLng: -87.2068, destLat: 14.0609, destLng: -87.2172, origin: 'Shadai School', destination: 'Aeropuerto', price: 'L. 120', createdAtMs: now - 20000,
    viewedBy: { d1: { driverId: 'd1', name: 'Cristian López', viewedAt: now - 5000, vehicleType: 'moto', lat: 14.0905, lng: -87.2010 } } };
  window.__HR_MOCK_PROFILE = profile;
  window.__HR_MOCK_DOCS = (p) => p.endsWith(`/users/${uid}/profile/data`) ? profile : (p.endsWith('/e2e-trip') ? trip : null);
  try { localStorage.setItem('honduber_market', 'hn'); localStorage.setItem('hrInstallBannerDismissedAt', String(now));
    localStorage.setItem('honduber_active_trip_id', 'e2e-trip'); localStorage.setItem('honduber_control_panel_hidden', '1'); } catch (_) {}
});
await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, (r) => { const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1]; r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(MOCKS, mockMap[f])) }); });
await ctx.route(/^https:\/\/honduraite\.com\//, (r) => { let p = decodeURIComponent(new URL(r.request().url()).pathname); if (p.endsWith('/')) p += 'index.html'; const fp = path.join(site, p);
  if (!fp.startsWith(site) || !fs.existsSync(fp)) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ contentType: CT[path.extname(fp)] || 'application/octet-stream', body: fs.readFileSync(fp) }); });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.goto('https://honduraite.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);
const later = page.getByText('Preguntarme más tarde'); if (await later.isVisible().catch(() => false)) await later.click().catch(() => {});
await page.waitForTimeout(3000);
const info = await page.evaluate(() => ({ body: document.body.className, panel: document.getElementById('control-panel')?.className, st: document.getElementById('searching-state')?.className,
  hasF: document.body.classList.contains('hr-search-f'), tilt: document.getElementById('map')?.classList.contains('hr-f-css-tilt'),
  fPanel: (() => { const e = document.getElementById('hr-f-panel'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), getComputedStyle(e).display]; })(),
  maxi: [...document.querySelectorAll('button')].filter(b => /maximizar/i.test(b.textContent) && b.checkVisibility({ visibilityProperty: true })).map(b => b.id || b.className) }));
const anc = await page.evaluate(() => { const out=[]; let n=document.getElementById('hr-f-panel'); while(n&&n!==document.documentElement){ const c=getComputedStyle(n); const bad=[c.transform!=='none'&&'tf:'+c.transform, c.filter!=='none'&&'filter', c.backdropFilter&&c.backdropFilter!=='none'&&'bdf', c.willChange!=='auto'&&'wc:'+c.willChange, c.contain!=='none'&&'contain:'+c.contain, c.perspective!=='none'&&'persp', c.overflow!=='visible'&&'ov:'+c.overflow].filter(Boolean); if(bad.length) out.push((n.id||n.className.slice(0,30))+' '+bad.join(',')); n=n.parentElement;} const b=document.getElementById('passenger-panel-min-btn').getBoundingClientRect(); const cp=document.getElementById('control-panel').getBoundingClientRect(); const cpe=document.getElementById('control-panel'); const cs=getComputedStyle(cpe); return {style:cpe.getAttribute('style'), h:[cs.height,cs.maxHeight,cs.minHeight,cs.transform], pc:document.getElementById('panel-content')?.getAttribute('style'), anc:out, minBtn:[b.top,b.height], cp:[cp.top,cp.height]}; });
console.log(JSON.stringify(anc));
await page.screenshot({ path: png });
const ok = info.hasF && info.tilt && info.fPanel && info.fPanel[1] > 150 && !info.maxi.length;
console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(info), errs.slice(0, 3)); await browser.close(); process.exit(ok ? 0 : 1);
