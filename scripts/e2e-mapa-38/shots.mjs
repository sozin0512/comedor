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
 */
const before = path.resolve(process.argv[2]);
const after = path.resolve(process.argv[3]);
const out = process.argv[4] || '/workspace/artifacts/mapa-38';
fs.mkdirSync(out, { recursive: true });

const chip = (label, meta) => `<div class="copa-chip-wrap public-copa-strip-inner"><button type="button" class="copa-chip copa-chip--map"><span class="copa-chip-pulse"></span><span class="copa-chip-ico"><i class="fas fa-trophy"></i></span><span class="copa-chip-body"><span class="copa-chip-label">${label}</span><span class="copa-chip-rank copa-chip-rank--live">LIVE</span><span class="copa-chip-sep">·</span><span class="copa-chip-meta">${meta}</span></span><i class="fas fa-chevron-right copa-chip-chevron"></i></button><button type="button" class="copa-chip-close passenger-promo-close public-copa-close"><i class="fas fa-times pointer-events-none"></i></button></div>`;

async function mapState(siteDir, file) {
    const s = await session({ geo: true, site: siteDir });
    await s.page.evaluate(({ a, b }) => {
        // Estado del bug: panel de viaje del conductor visible sin «trip-active»
        document.body.classList.add('driver-mode');
        document.body.classList.remove('client-mode', 'trip-active', 'is-searching');
        document.querySelectorAll('#control-panel > *').forEach((el) => el.classList.add('hidden'));
        const host = document.getElementById('driver-view')?.parentElement;
        if (host) host.classList.remove('hidden');
        let n = document.getElementById('driver-view'); while (n && n.id !== 'control-panel') { n.classList.remove('hidden'); n = n.parentElement; }
        document.getElementById('driver-view')?.classList.add('hidden');
        document.getElementById('active-trip-panel')?.classList.remove('hidden');
        const s1 = document.getElementById('public-copa-strip'); s1.innerHTML = a; s1.classList.remove('hidden');
        const s2 = document.getElementById('public-pcopa-strip'); s2.innerHTML = b; s2.classList.remove('hidden');
    }, { a: chip('Copa', 'Carrera a 1000 viajes'), b: chip('Copa pax', 'Todos vs todos') });
    await s.page.waitForTimeout(1200);
    await s.page.screenshot({ path: file });
    await s.browser.close();
}

async function searchState(siteDir, file, stalled) {
    const s = await session({ geo: true, site: siteDir });
    await s.page.evaluate(({ stalled }) => {
        const now = Date.now();
        const trip = {
            id: 'e2e-trip', status: 'pending', clientId: 'e2e-pasajero', originLat: 14.0818, originLng: -87.2068,
            origin: 'City Mall', destination: 'Aeropuerto', price: 'L. 120', createdAtMs: now - 100000,
            viewedBy: {
                d1: { driverId: 'd1', name: 'Diego', rating: '5.0', viewedAt: now - 5000, vehicleType: 'moto', lat: 14.0905, lng: -87.2050 },
                d2: { driverId: 'd2', name: 'Geral', rating: '5.0', viewedAt: now - 8000, vehicleType: 'auto', lat: 14.0760, lng: -87.1900 },
                d3: { driverId: 'd3', name: 'Cristian', rating: '5.0', viewedAt: now - 9000, vehicleType: 'moto', lat: 14.0830, lng: -87.2070 }
            }
        };
        document.body.classList.add('client-mode', 'is-searching');
        document.body.classList.remove('driver-mode', 'trip-active');
        const cnt = document.getElementById('trip-viewers-count');
        let n = cnt; while (n && n !== document.body) { n.classList.remove('hidden'); n = n.parentElement; }
        try { window.renderTripViewersPanel?.(trip); } catch (e) { console.log('RENDER-ERR', String(e)); }
        if (stalled) document.getElementById('passenger-search-stall')?.classList.remove('hidden');
        document.getElementById('passenger-boost-price-panel')?.classList.add('hidden');
        document.getElementById('trip-viewers-count')?.scrollIntoView({ block: 'start' });
    }, { stalled });
    await s.page.waitForTimeout(1200);
    await s.page.screenshot({ path: file });
    console.log('errores JS', file, s.errors.slice(0, 3));
    await s.browser.close();
}






await mapState(before, `${out}/mapa-antes.png`);
await mapState(after, `${out}/mapa-despues.png`);
await searchState(before, `${out}/busqueda-antes.png`, false);
await searchState(after, `${out}/busqueda.png`, true);
console.log('ok');
