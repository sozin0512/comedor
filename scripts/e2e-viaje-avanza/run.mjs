/**
 * Prueba de navegador (Chromium headless, Android 384 px) del flujo «Viaje» del pasajero:
 * con origen y destino puestos, debe salir el siguiente paso (tipo → personas → ¿cuándo? → pedir).
 * Bug 2026.10.16.10 («si pongo ambos el destino y Origen no sigue el paso siguiente»).
 *
 *   node scripts/e2e-viaje-avanza/run.mjs [carpeta-del-sitio] [prefijo-capturas]
 *
 * Igual que e2e-origen-pasajero: sirve la carpeta bajo https://honduraite.com, Firebase en mocks
 * (sesión falsa de pasajero; appSettings como producción). No escribe nada en producción.
 * Usa Google Maps/Places reales (necesita red).
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
const MOCKS = path.join(here, '..', 'e2e-origen-pasajero', 'firebase-mocks');
const mockMap = { 'firebase-firestore.js': 'firestore.js', 'firebase-auth.js': 'auth.js', 'firebase-app.js': 'app.js', 'firebase-functions.js': 'functions.js', 'firebase-storage.js': 'storage.js', 'firebase-messaging.js': 'messaging.js' };
const CT = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
// Igual que appSettings/main en producción (18-oct-2026): servicios apagados por ciudad (sistema viejo)
const PROD_APP_SETTINGS = { disabledServicesByCity: {
    tegucigalpa: { grua: true, taxi: true }, comayagua: { grua: true, taxi: true, moto: true }, 'san-pedro-sula': { taxi: true, grua: true } } };
const TEGUS = { latitude: 14.0640, longitude: -87.1768, accuracy: 15 };
const COMAYAGUA = { latitude: 14.4514, longitude: -87.6375, accuracy: 15 };

const results = [];
const t = (name, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', name, extra]);

async function session({ geo, appSettings = null }) {
    const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({
        viewport: { width: 384, height: 832 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
        userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
        geolocation: geo, permissions: ['geolocation'], locale: 'es-HN', timezoneId: 'America/Tegucigalpa'
    });
    await ctx.addInitScript((apps) => {
        const uid = 'e2e-pasajero';
        window.__HR_MOCK_USER = { uid, email: 'e2e@example.com', emailVerified: true, phoneNumber: null, displayName: 'Pasajero E2E', providerData: [], getIdToken: async () => 'x', getIdTokenResult: async () => ({ claims: {} }), reload: async () => {} };
        const profile = { role: 'client', name: 'Pasajero E2E', email: 'e2e@example.com', phone: '+50499999999', birthDate: '1990-05-13', gender: 'male', approvalStatus: 'approved',
            passengerVerificationStatus: 'approved', identityVerified: true, legalAccepted: true, termsAccepted: true, privacyAccepted: true, legalAcceptedAt: Date.now(),
            city: 'tegucigalpa', serviceZoneId: 'tegucigalpa', createdAt: Date.now() - 864e5 * 300 };
        window.__HR_MOCK_PROFILE = profile;
        window.__HR_MOCK_DOCS = (p) => (p.endsWith(`/users/${uid}/profile/data`) ? profile : (apps && p.endsWith('/appSettings/main') ? apps : null));
        try { localStorage.setItem('honduber_market', 'hn'); localStorage.setItem('hrInstallBannerDismissedAt', String(Date.now())); } catch (_) {}
    }, appSettings);
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
    const errors = []; const http400 = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error' && /Error crítico|ReferenceError|TypeError/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on('response', (r) => { if (r.status() === 400 && /googleapis\.com/.test(r.url())) http400.push(r.url().slice(0, 120)); });
    await page.goto('https://honduraite.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000);
    for (let k = 0; k < 3; k++) {
        const later = page.getByText('Preguntarme más tarde').first();
        if (await later.isVisible().catch(() => false)) { await later.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(800); }
    }
    await page.getByText('Viaje', { exact: true }).first().click();
    await page.waitForTimeout(4000);
    return { browser, page, errors, http400 };
}
const state = (page) => page.evaluate(() => {
    const ep = (id) => { const e = document.getElementById(id)?._routeEndpoint; return e ? { address: e.address, latLng: e.latLng || null, source: e.source } : null; };
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
    return {
        origin: ep('origin-autocomplete'), dest: ep('destination-autocomplete'),
        steps: ['passenger-booking-service', 'passenger-booking-passengers', 'passenger-booking-when', 'passenger-booking-request'].filter(vis),
        searching: document.body.classList.contains('trip-autocomplete-open'),
        safeTop: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--search-safe-top')) || 0,
    };
});
const hasLL = (e) => !!(e && e.latLng && Number.isFinite(Number(e.latLng.lat)) && Number.isFinite(Number(e.latLng.lng)));
async function typeInto(page, id, text) {
    await page.locator(`#${id}`).click();
    await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
    await page.keyboard.type(text, { delay: 50 });
    await page.waitForTimeout(3500);
}
async function pickFirst(page) { await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(4500); }
async function skipStopPrompt(page) {
    // El aviso «¿Parada en el camino?» puede salir unos segundos después (cuando termina la ruta)
    const b = page.locator('[data-extra-stop-choice="no"]');
    await b.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    if (await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(2500); }
}
/** Recorre tipo (si hay que elegir) → 1 persona → Ahora; devuelve los pasos visibles. */
async function walkToRequest(page, svcLabel) {
    await skipStopPrompt(page);
    const svc = page.locator('#service-type-picker [data-service-type]', { hasText: svcLabel }).first();
    if (await svc.isVisible().catch(() => false)) { await svc.click({ timeout: 8000 }).catch(async () => { await skipStopPrompt(page); await svc.click({ timeout: 8000 }).catch(() => {}); }); await page.waitForTimeout(2500); }
    await skipStopPrompt(page);
    const one = page.locator('#trip-passengers-adder button', { hasText: /^\s*1\s*$/ }).first();
    if (await one.isVisible().catch(() => false)) { await one.click(); await page.waitForTimeout(2000); }
    const now = page.locator('#trip-when-now');
    if (await now.isVisible().catch(() => false)) { await now.click(); await page.waitForTimeout(5000); }
    return (await state(page)).steps;
}

// 1) Tegucigalpa: origen por GPS + destino escrito y elegido de la lista
{
    const s = await session({ geo: TEGUS, appSettings: PROD_APP_SETTINGS });
    const a = await state(s.page);
    t('Tegus GPS: origen con coordenadas', hasLL(a.origin) && a.origin.source === 'gps', JSON.stringify(a.origin));
    await typeInto(s.page, 'destination-autocomplete', 'City Mall Tegucigalpa');
    await pickFirst(s.page);
    const b = await state(s.page);
    t('Tegus sugerencia: destino con coordenadas', hasLL(b.dest) && b.dest.source === 'place', JSON.stringify(b.dest));
    const steps = await walkToRequest(s.page, 'VIP');
    await s.page.screenshot({ path: `${shots}-tegus-pedir.png` });
    t('Tegus: llega a «Pedir el viaje»', steps.includes('passenger-booking-request'), steps.join(','));
    t('Tegus: Routes API sin 400', s.http400.length === 0, s.http400.join(' | '));
    t('Tegus: arranque sin errores de JS', s.errors.length === 0, s.errors.join(' | '));
    await s.browser.close();
}
// 2) Destino escrito y se cierra la búsqueda SIN elegir sugerencia (tecla atrás / Escape)
{
    const s = await session({ geo: TEGUS, appSettings: PROD_APP_SETTINGS });
    // Abrir y cerrar la búsqueda varias veces: el escudo del reloj no debe crecer
    for (let i = 0; i < 4; i++) {
        await s.page.locator('#destination-autocomplete').click(); await s.page.waitForTimeout(900);
        await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(600);
    }
    await typeInto(s.page, 'destination-autocomplete', 'Mall Multiplaza Tegucigalpa');
    await s.page.keyboard.press('Escape');
    await s.page.waitForTimeout(800);
    const w = await state(s.page);
    await s.page.screenshot({ path: `${shots}-escrito-sin-elegir.png` });
    t('sin elegir: escudo blanco del reloj no tapa la pantalla (≤ 60 px)', w.safeTop <= 60, `${w.safeTop}px`);
    // Tocar el mapa (fuera del panel) cierra el teclado, como en el teléfono
    await s.page.mouse.click(192, 250);
    await s.page.waitForTimeout(6000);
    const b = await state(s.page);
    t('sin elegir: destino guardado con coordenadas (geocodificado)', hasLL(b.dest), JSON.stringify(b.dest));
    t('sin elegir: sale el siguiente paso', b.steps.length > 0 || await s.page.locator('#extra-stop-prompt-modal').isVisible().catch(() => false), b.steps.join(','));
    const steps = await walkToRequest(s.page, 'VIP');
    await s.page.screenshot({ path: `${shots}-escrito-sin-elegir-pedir.png` });
    t('sin elegir: llega a «Pedir el viaje»', steps.includes('passenger-booking-request'), steps.join(','));
    await s.browser.close();
}
// 3) Comayagua con appSettings de producción (taxi y moto apagados): solo Taxi VIP y aun así avanza
{
    const s = await session({ geo: COMAYAGUA, appSettings: PROD_APP_SETTINGS });
    await typeInto(s.page, 'origin-autocomplete', 'Catedral de Comayagua');
    await pickFirst(s.page);
    const a = await state(s.page);
    t('Comayagua: origen escrito y elegido con coordenadas', hasLL(a.origin) && a.origin.source === 'place', JSON.stringify(a.origin));
    await typeInto(s.page, 'destination-autocomplete', 'Hospital Santa Teresa Comayagua');
    await pickFirst(s.page);
    const b = await state(s.page);
    t('Comayagua: destino con coordenadas', hasLL(b.dest), JSON.stringify(b.dest));
    const steps = await walkToRequest(s.page, 'VIP');
    await s.page.screenshot({ path: `${shots}-comayagua-pedir.png` });
    t('Comayagua: llega a «Pedir el viaje»', steps.includes('passenger-booking-request'), steps.join(','));
    await s.browser.close();
}
for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? `  (${x})` : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
