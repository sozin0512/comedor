/**
 * Reproduce, en la app real, que un historial de cancelaciones propias
 * no vuelve a mostrar «Viaje cancelado correctamente.» mientras hay un envío en vivo.
 * Firebase mock. No escribe pedidos.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(path.join(here, '..', '..'));
const out = path.resolve(process.argv[2] || path.join(here, 'out'));
fs.mkdirSync(out, { recursive: true });
let chromium;
try {
    ({ chromium } = createRequire(process.env.PLAYWRIGHT_CORE || '/tmp/e2e-tools/package.json')('playwright-core'));
} catch (_) { console.log('SKIP: falta playwright-core'); process.exit(0); }
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const mocksDir = path.join(here, '..', 'e2e-origen-pasajero', 'firebase-mocks');
const mockMap = {
    'firebase-firestore.js': 'firestore.js', 'firebase-auth.js': 'auth.js', 'firebase-app.js': 'app.js',
    'firebase-functions.js': 'functions.js', 'firebase-storage.js': 'storage.js', 'firebase-messaging.js': 'messaging.js',
};
const CT = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const results = [];
const t = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'es-HN' });
await ctx.addInitScript(() => {
    const uid = 'e2e-josue';
    window.__HR_MOCK_USER = { uid, email: 'josue@example.com', emailVerified: true, displayName: 'Josue', providerData: [], getIdToken: async () => 'x', getIdTokenResult: async () => ({ claims: {} }), reload: async () => {} };
    const profile = { role: 'client', name: 'Josue', email: 'josue@example.com', approvalStatus: 'approved', legalAccepted: true, termsAccepted: true, privacyAccepted: true, city: 'tegucigalpa', serviceZoneId: 'tegucigalpa' };
    window.__HR_MOCK_PROFILE = profile;
    window.__HR_MOCK_DOCS = (p) => (String(p).endsWith(`/users/${uid}/profile/data`) ? profile : null);
    try { localStorage.setItem('honduber_market', 'hn'); localStorage.setItem('hrInstallBannerDismissedAt', String(Date.now())); } catch (_) {}
});
await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, (r) => {
    const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1];
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(mocksDir, mockMap[f])) });
});
await ctx.route(/firestore\.googleapis|fcm\.googleapis|firebaseinstallations|cloudfunctions\.net|routes\.googleapis/, (r) => r.abort());
await ctx.route(/^https:\/\/honduraite\.com\//, (r) => {
    let p = decodeURIComponent(new URL(r.request().url()).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const fp = path.join(site, p);
    if (!fp.startsWith(site) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ contentType: CT[path.extname(fp)] || 'application/octet-stream', body: fs.readFileSync(fp) });
});
const page = await ctx.newPage();
const posts = [];
page.on('requestfinished', (req) => { if (req.method() !== 'GET' && req.method() !== 'HEAD') posts.push(req.url()); });
await page.goto('https://honduraite.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction(() => typeof window.hrFindMyRelevantTrip === 'function' && typeof window.handleTripCancelled === 'function' && window.currentUser?.uid, { timeout: 40000 });
document_boot: {
    const run = await page.evaluate(() => {
        const uid = window.currentUser?.uid || 'e2e-josue';
        window.userProfile = { ...(window.userProfile || {}), role: 'client' };
        window.handledCancelledTripIds = new Set();
        const toasts = [];
        window.showToast = (message, level) => { toasts.push({ message, level }); };
        const live = { id: 'live-envio', status: 'in_progress', clientId: uid, driverId: 'rider-1', createdAt: 300 };
        const olds = [1, 2, 3].map((n) => ({
            id: `old-${n}`,
            status: 'cancelled',
            clientId: uid,
            cancelledBy: uid,
            cancelledFromStatus: 'pending',
            createdAt: n,
        }));
        const picked = window.hrFindMyRelevantTrip([olds[2], live, olds[0]]);
        window.activeTrip = live;
        window.currentActiveTripData = live;
        olds.forEach((trip) => window.handleTripCancelled(trip.id, trip, 'listener'));
        const afterReplay = toasts.map((x) => x.message);
        window.handleTripCancelled('fresh', {
            status: 'cancelled',
            cancelledBy: uid,
            cancelledFromStatus: 'pending',
        }, 'user-action');
        window.handleTripCancelled('fresh', {
            status: 'cancelled',
            cancelledBy: uid,
            cancelledFromStatus: 'pending',
        }, 'user-action');
        const notices = (window._hrLocalNotices || []).map((n) => n.title);
        return {
            picked: picked?.id || null,
            afterReplay,
            toasts: toasts.map((x) => x.message),
            notices,
        };
    });
    t('el viaje en vivo gana sobre cancelados viejos', run.picked === 'live-envio', JSON.stringify(run));
    t('el historial no repite el toast de éxito', run.afterReplay.length === 0, JSON.stringify(run));
    t('cancelar ahora sí confirma una sola vez', run.toasts.filter((m) => m === 'Viaje cancelado correctamente.').length === 1, JSON.stringify(run));
    t('lo viejo queda en la campana', run.notices.includes('Cancelaste un viaje'), JSON.stringify(run));
    await page.evaluate(() => {
        document.getElementById('hr-boot-loading')?.classList.add('hr-boot-hide');
        document.getElementById('notif-prompt-modal')?.remove();
        window.showNotificationsModal?.();
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'campana_cancelacion.png') });
    const bellText = await page.locator('body').innerText();
    t('la campana muestra la cancelación sin teléfonos', /Cancelaste un viaje/.test(bellText) && !/504\d{8}/.test(bellText));
}
const bad = posts.filter((u) => /trips|firestore\.googleapis/.test(u));
t('sin escrituras de viajes', bad.length === 0, bad.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
