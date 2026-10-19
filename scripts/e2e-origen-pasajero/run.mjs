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

const here = path.dirname(fileURLToPath(import.meta.url));
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

async function session({ geo }) {
    const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({
        viewport: { width: 384, height: 832 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
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
const originText = (page) => page.evaluate(() => {
    const o = document.getElementById('origin-autocomplete');
    return String(window.readAutocompleteText?.(o) || o?._routeEndpoint?.address || '').trim();
});
async function openViaje(page) {
    await page.getByText('Viaje', { exact: true }).first().click();
    await page.waitForTimeout(2500);
}
/** Ancho (px CSS) de texto visible entre la lupa y el botón GPS del campo origen. */
async function visibleTextWidth(page, file) {
    const box = await page.locator('#origin-autocomplete').boundingBox();
    const gps = await page.locator('#btn-use-location').boundingBox();
    const buf = await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    // PNG → píxeles con el propio Chromium (sin dependencias)
    const startX = 44; // después de la lupa
    const endX = Math.max(startX + 1, (gps ? gps.x - box.x : box.width - 90) - 4);
    const cols = await page.evaluate(async ({ b64, startX, endX, dpr }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let x = Math.round(startX * dpr); x < Math.round(endX * dpr); x++) {
            for (let y = Math.round(c.height * 0.25); y < Math.round(c.height * 0.75); y++) {
                const i = (y * c.width + x) * 4;
                if (d[i] + d[i + 1] + d[i + 2] < 500) { n++; break; } // píxel de texto (gris/negro)
            }
        }
        return n / dpr;
    }, { b64: buf.toString('base64'), startX, endX, dpr: 2 });
    return cols;
}

// 1) Origen vacío (sin permiso de GPS) → debe verse «Origen» completo
{
    const s = await session({ geo: false });
    await openViaje(s.page);
    const txt = await originText(s.page);
    const w = await visibleTextWidth(s.page, `${shots}-origen-vacio.png`);
    await s.page.screenshot({ path: `${shots}-panel-vacio.png` });
    t('origen vacío: el campo está vacío (GPS sin permiso)', txt === '', JSON.stringify(txt));
    t('origen vacío: se ve el placeholder «Origen» completo (≥ 30 px de texto)', w >= 30, `${w.toFixed(1)} px`);
    t('sin errores de JS', s.errors.length === 0, s.errors.join(' | '));
    // 2) GPS disponible después del inicio de sesión → al volver a entrar a «Viaje» se rellena
    await s.ctx.grantPermissions(['geolocation'], { origin: 'https://honduraite.com' });
    await s.page.evaluate(() => window.setPassengerHomeMode?.('home'));
    await s.page.waitForTimeout(1200);
    await openViaje(s.page);
    await s.page.waitForTimeout(4000);
    const txt2 = await originText(s.page);
    await s.page.screenshot({ path: `${shots}-panel-gps-tarde.png` });
    t('GPS tarde: al entrar a «Viaje» el origen se rellena con la ubicación', txt2.length > 0, JSON.stringify(txt2));
    await s.browser.close();
}
// 3) GPS listo desde el inicio → origen relleno y legible
{
    const s = await session({ geo: true });
    await openViaje(s.page);
    const txt = await originText(s.page);
    const w = await visibleTextWidth(s.page, `${shots}-origen-gps.png`);
    await s.page.screenshot({ path: `${shots}-panel-gps.png` });
    t('GPS al iniciar: origen relleno', txt.length > 0, JSON.stringify(txt));
    t('GPS al iniciar: la dirección se lee (≥ 60 px de texto)', w >= 60, `${w.toFixed(1)} px`);
    await s.browser.close();
}
for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? `  (${x})` : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
