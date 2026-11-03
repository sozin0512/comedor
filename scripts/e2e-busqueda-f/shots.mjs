/**
 * Prueba de navegador (Chromium headless, teléfono 384 px como el S24 Ultra) del campo «Origen» del pasajero.
 * Bug 2026.10.16.9-10: el origen no se veía (ni «Origen» ni lo escrito ni la dirección del GPS).
 *
 *   node scripts/e2e-origen-pasajero/run.mjs [carpeta-del-sitio] [prefijo-capturas]
 *
 * - Sirve la carpeta local bajo https://honduraite.com (para que la llave de Maps acepte el referer) y
 *   reemplaza Firebase por mocks locales (sesión falsa de pasajero, Firestore vacío). No escribe nada en producción.
 * - Necesita Google Chrome y playwright-core (busca PLAYWRIGHT_CORE o el de pnpm global).
 * Comprueba:
 *   1) Con el origen vacío se ve el texto «Origen» completo (no solo la «O»).
 *   2) Si el GPS falla al iniciar sesión y luego está disponible, al entrar a «Viaje» el origen se rellena solo.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e-origen-pasajero');
const site = path.resolve(process.argv[2] || path.join(here, '..', '..'));
const shots = process.argv[3] || path.join(here, 'out');
fs.mkdirSync(path.dirname(shots + 'x'), { recursive: true });
let chromium;
try {
    const req = createRequire(process.env.PLAYWRIGHT_CORE || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/');
    ({ chromium } = req('playwright-core'));
} catch (_) { console.log('SKIP: falta playwright-core'); process.exit(0); }
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const MOCKS = path.join(here, 'firebase-mocks');
const mockMap = { 'firebase-firestore.js': 'firestore.js', 'firebase-auth.js': 'auth.js', 'firebase-app.js': 'app.js', 'firebase-functions.js': 'functions.js', 'firebase-storage.js': 'storage.js', 'firebase-messaging.js': 'messaging.js' };
const CT = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

const results = [];
const t = (name, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', name, extra]);

async function session({ geo, site }) {
    const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
        userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
        geolocation: { latitude: 14.0818, longitude: -87.2068, accuracy: 15 }, permissions: geo ? ['geolocation'] : [],
        locale: 'es-HN', timezoneId: 'America/Tegucigalpa'
    });
    await ctx.addInitScript(() => {
        const uid = 'e2e-pasajero';
        window.__HR_MOCK_USER = { uid, email: 'e2e@example.com', emailVerified: true, phoneNumber: null, displayName: 'Pasajero E2E', providerData: [], getIdToken: async () => 'x', getIdTokenResult: async () => ({ claims: {} }), reload: async () => {} };
        const profile = { role: 'client', name: 'Pasajero E2E', email: 'e2e@example.com', phone: '+50499999999', birthDate: '1990-05-13', gender: 'male', approvalStatus: 'approved',
            passengerVerificationStatus: 'approved', identityVerified: true, legalAccepted: true, termsAccepted: true, privacyAccepted: true, legalAcceptedAt: Date.now(),
            city: 'tegucigalpa', serviceZoneId: 'tegucigalpa', createdAt: Date.now() - 864e5 * 300 };
        window.__HR_MOCK_PROFILE = profile;
        window.__HR_MOCK_DOCS = (p) => (p.endsWith(`/users/${uid}/profile/data`) ? profile : null);
        try { localStorage.setItem('honduber_market', 'hn'); localStorage.setItem('hrInstallBannerDismissedAt', String(Date.now())); } catch (_) {}
    });
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, (r) => {
        const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1];
        r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(MOCKS, mockMap[f])) });
    });
    await ctx.route(/^https:\/\/honduraite\.com\//, (r) => {
        let p = decodeURIComponent(new URL(r.request().url()).pathname);
        if (p.endsWith('/')) p += 'index.html';
        const fp = path.join(site, p);
        if (!fp.startsWith(site) || !fs.existsSync(fp)) return r.fulfill({ status: 404, body: 'nf' });
        r.fulfill({ contentType: CT[path.extname(fp)] || 'application/octet-stream', body: fs.readFileSync(fp) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.goto('https://honduraite.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000);
    const later = page.getByText('Preguntarme más tarde');
    if (await later.isVisible().catch(() => false)) await later.click().catch(() => {});
    await page.waitForTimeout(600);
    return { browser, ctx, page, errors };
}

/**
 * Capturas v.38 (390×844): mismo estado montado en main (.37) y en esta rama.
 *   node scripts/e2e-mapa-38/shots.mjs <sitio-antes> <sitio-despues> <carpeta-salida>
/** Capturas v.39 opción F (datos de prueba locales, Firebase simulado). node scripts/e2e-busqueda-f/shots.mjs <sitio> <salida> */
const siteDir = path.resolve(process.argv[2]);
const out = process.argv[3] || '/workspace/artifacts/busqueda-f';
fs.mkdirSync(out, { recursive: true });
async function shot(file, { viewers, stalled, popup }) {
    const s = await session({ geo: true, site: siteDir });
    const info = await s.page.evaluate(({ viewers, stalled }) => {
        const now = Date.now();
        const vb = {};
        if (viewers) {
            vb.d1 = { driverId: 'd1', name: 'Cristian López', viewedAt: now - 5000, vehicleType: 'moto', lat: 14.0905, lng: -87.2010 };
            vb.d2 = { driverId: 'd2', name: 'Mario Reyes', viewedAt: now - 8000, vehicleType: 'auto' };
        }
        const trip = { id: 'e2e-trip', status: 'pending', clientId: 'e2e-pasajero', originLat: 14.0818, originLng: -87.2068,
            origin: 'City Mall', destination: 'Aeropuerto', price: 'L. 120', createdAtMs: now - (stalled ? 100000 : 10000),
            offeredToDriverId: viewers ? 'd2' : null, offeredToDriverName: 'Mario Reyes', offerDistanceKm: 5.1, viewedBy: vb };
        document.body.classList.add('client-mode', 'is-searching');
        document.body.classList.remove('driver-mode', 'trip-active');
        const st = document.getElementById('searching-state');
        let n = st; while (n && n !== document.body) { n.classList.remove('hidden'); n = n.parentElement; }
        document.getElementById('passenger-boost-price-panel')?.classList.remove('hidden');
        if (stalled) document.getElementById('passenger-search-stall')?.classList.remove('hidden');
        window.hrSearchF?.update(trip);
        const r = st.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, sh: st.scrollHeight, ch: st.clientHeight, hasF: document.body.classList.contains('hr-search-f'), gmap: !!window.gMap, tilt: window.gMap?.getTilt?.() };
    }, { viewers, stalled });
    if (popup) await s.page.evaluate(() => window.hrSearchF.openBoost());
    await s.page.waitForTimeout(2500);
    await s.page.screenshot({ path: file });
    console.log(file, JSON.stringify(info), 'cssTilt', await s.page.evaluate(() => document.getElementById('map')?.classList.contains('hr-f-css-tilt')), s.errors.slice(0, 3));
    await s.browser.close();
}
await shot(`${out}/f-0-viendo.png`, { viewers: false });
await shot(`${out}/f-2-viendo.png`, { viewers: true });
await shot(`${out}/f-popup-precio.png`, { viewers: true, popup: true });
await shot(`${out}/f-75s.png`, { viewers: true, stalled: true });
console.log('ok');
