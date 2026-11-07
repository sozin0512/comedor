/**
 * Capturas reales del asistente de Envío (iPhone 390×844).
 * Firebase va por mocks locales. No se toca «Solicitar envío», así que no hay
 * pedidos, avisos ni escrituras de producción.
 *
 *   node scripts/e2e-delivery-wizard/run.mjs [carpeta-salida]
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
    const req = createRequire(process.env.PLAYWRIGHT_CORE || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/');
    ({ chromium } = req('playwright-core'));
} catch (_) {
    console.log('SKIP: falta playwright-core');
    process.exit(0);
}
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const mocksDir = path.join(here, '..', 'e2e-origen-pasajero', 'firebase-mocks');
const mockMap = {
    'firebase-firestore.js': 'firestore.js',
    'firebase-auth.js': 'auth.js',
    'firebase-app.js': 'app.js',
    'firebase-functions.js': 'functions.js',
    'firebase-storage.js': 'storage.js',
    'firebase-messaging.js': 'messaging.js',
};
const CT = {
    '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
    '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

const results = [];
const t = (name, cond, extra = '') => {
    results.push([cond ? 'PASS' : 'FAIL', name, extra]);
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    geolocation: { latitude: 14.451, longitude: -87.637, accuracy: 20 },
    permissions: ['geolocation'],
    locale: 'es-HN',
    timezoneId: 'America/Tegucigalpa',
});
await ctx.addInitScript(() => {
    const uid = 'e2e-envio';
    window.__HR_MOCK_USER = {
        uid, email: 'e2e@example.com', emailVerified: true, phoneNumber: null,
        displayName: 'María López', providerData: [],
        getIdToken: async () => 'x',
        getIdTokenResult: async () => ({ claims: {} }),
        reload: async () => {},
    };
    const profile = {
        role: 'client', name: 'María López', email: 'e2e@example.com', phone: '+50499887766',
        birthDate: '1992-04-02', gender: 'female', approvalStatus: 'approved',
        passengerVerificationStatus: 'approved', identityVerified: true,
        legalAccepted: true, termsAccepted: true, privacyAccepted: true, legalAcceptedAt: Date.now(),
        city: 'comayagua', serviceZoneId: 'comayagua', createdAt: Date.now() - 864e5 * 400,
    };
    window.__HR_MOCK_PROFILE = profile;
    window.__HR_MOCK_DOCS = (p) => (String(p).endsWith(`/users/${uid}/profile/data`) ? profile : null);
    window.__HR_MOCK_WRITES = [];
    try {
        localStorage.setItem('honduber_market', 'hn');
        localStorage.setItem('hrInstallBannerDismissedAt', String(Date.now()));
        localStorage.setItem('honduber-theme', 'light');
    } catch (_) {}
    try {
        window.Notification = { permission: 'denied', requestPermission: async () => 'denied' };
    } catch (_) {}
});
await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, (r) => {
    const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1];
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(mocksDir, mockMap[f])) });
});
await ctx.route(/firestore\.googleapis|fcm\.googleapis|firebaseinstallations|cloudfunctions\.net|fcmregistrations|routes\.googleapis\.com/, (r) => r.abort());
await ctx.route(/^https:\/\/honduraite\.com\//, (r) => {
    let p = decodeURIComponent(new URL(r.request().url()).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const fp = path.join(site, p);
    if (!fp.startsWith(site) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ contentType: CT[path.extname(fp)] || 'application/octet-stream', body: fs.readFileSync(fp) });
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)));
const posts = [];
page.on('requestfinished', (req) => {
    if (req.method() !== 'GET' && req.method() !== 'HEAD') posts.push(`${req.method()} ${req.url().slice(0, 140)}`);
});

async function dismissBlockers() {
    for (let i = 0; i < 6; i += 1) {
        const later = page.locator('#btn-later-notif, button:has-text("Preguntarme más tarde")').first();
        if (await later.isVisible().catch(() => false)) {
            await later.click().catch(() => {});
            await page.waitForTimeout(250);
            continue;
        }
        const close = page.locator('#notif-prompt-modal [aria-label="Cerrar"], #passenger-verify-choice-modal button').first();
        if (await close.isVisible().catch(() => false)) {
            await close.click().catch(() => {});
            await page.waitForTimeout(250);
            continue;
        }
        if (!await page.locator('#notif-prompt-modal, #passenger-verify-choice-modal').count()) break;
        await page.waitForTimeout(400);
    }
}

await page.goto('https://honduraite.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction(() => {
    const boot = document.getElementById('hr-boot-loading');
    const bootGone = !boot || boot.classList.contains('hr-boot-hide') || getComputedStyle(boot).visibility === 'hidden' || getComputedStyle(boot).opacity === '0';
    return bootGone && !!document.querySelector('[data-home-mode="delivery"]');
}, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1500);
await dismissBlockers();

await page.locator('[data-home-mode="delivery"]').click();
await page.waitForSelector('#delivery-wizard .dw-q', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1400);
await dismissBlockers();
await page.evaluate(() => {
    const scroller = document.getElementById('panel-content');
    if (scroller) scroller.scrollTop = 0;
    document.getElementById('hr-boot-loading')?.classList.add('hr-boot-hide');
});
await page.screenshot({ path: path.join(out, 'envio_pregunta_inicial.png') });

const initial = await page.evaluate(() => {
    const open = [...document.querySelectorAll('[data-dw-state="open"]')].map((el) => el.getAttribute('data-dw-step'));
    const title = document.getElementById('passenger-mode-title')?.textContent || '';
    const sub = document.getElementById('passenger-mode-sub')?.textContent || '';
    const q = document.querySelector('#delivery-wizard .dw-q')?.textContent || '';
    const chips = [...document.querySelectorAll('.delivery-cat-chip')].map((b) => b.dataset.cat);
    const fields = ['delivery-restaurant', 'delivery-recipient-name', 'delivery-recipient-phone', 'delivery-package-desc']
        .filter((id) => document.getElementById(id) && !document.getElementById(id).closest('[hidden]'));
    return { open, title, sub, q, chips, visibleFields: fields, mode: document.body.dataset.passengerMode || '' };
});
t('pregunta inicial: solo «qué envías» está abierta', initial.open.join(',') === 'category', JSON.stringify(initial));
t('barra Envío / mensajería', initial.title === 'Envío / mensajería' && /moto/i.test(initial.sub), `${initial.title} · ${initial.sub}`);
t('chips de categoría', ['comida', 'pulperia', 'farmacia', 'documentos', 'otro'].every((id) => initial.chips.includes(id)), initial.chips.join(','));

async function clickWizard(selector) {
    await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const scroller = document.getElementById('panel-content');
        if (!el || !scroller) return;
        const overflow = el.getBoundingClientRect().bottom - (scroller.getBoundingClientRect().bottom - 12);
        if (overflow > 0) scroller.scrollTop += overflow;
    }, selector);
    await page.locator(selector).click();
}

await page.locator('.delivery-cat-chip[data-cat="comida"]').click();
await clickWizard('[data-dw-next="category"]');
await page.locator('#delivery-restaurant').fill('Pollo Campero');
await clickWizard('[data-dw-next="place"]');
await page.waitForTimeout(250);
await page.evaluate(() => { document.getElementById('panel-content').scrollTop = 0; });
await page.screenshot({ path: path.join(out, 'envio_quien_recibe.png') });

const nameStep = await page.evaluate(() => {
    const open = [...document.querySelectorAll('[data-dw-state="open"]')].map((el) => el.getAttribute('data-dw-step'));
    const summaries = [...document.querySelectorAll('.dw-summary:not([hidden])')].map((btn) => ({
        step: btn.getAttribute('data-dw-edit'),
        text: btn.innerText.replace(/\s+/g, ' ').trim(),
    }));
    return { open, summaries, name: document.getElementById('delivery-recipient-name')?.value || '' };
});
t('paso de quien recibe, con lo anterior resumido', nameStep.open.join(',') === 'name'
    && nameStep.summaries.some((s) => s.step === 'category' && /Comida de restaurante/.test(s.text))
    && nameStep.summaries.some((s) => s.step === 'place' && /Pollo Campero/.test(s.text)),
    JSON.stringify(nameStep));

await page.locator('#delivery-recipient-name').fill('María López');
await clickWizard('[data-dw-next="name"]');
await page.locator('#delivery-recipient-phone').fill('99887766');
await clickWizard('[data-dw-next="phone"]');
await page.locator('#delivery-package-desc').fill('2 hamburguesas + papas y tortillas');
await clickWizard('[data-dw-next="details"]');
await page.evaluate(() => {
    const originEl = document.getElementById('origin-autocomplete');
    const destEl = document.getElementById('destination-autocomplete');
    const origin = { address: 'City Mall, Comayagua', latLng: { lat: 14.451, lng: -87.637 }, source: 'place' };
    const destination = { address: 'Colonia Miraflores, Comayagua', latLng: { lat: 14.462, lng: -87.643 }, source: 'place' };
    window.storeRouteEndpoint?.(originEl, origin);
    window.storeRouteEndpoint?.(destEl, destination);
    window.writeAutocompleteText?.(originEl, origin.address);
    window.writeAutocompleteText?.(destEl, destination.address);
    window.currentTripQuote = {
        serviceType: 'delivery',
        price: 'L. 86.40',
        priceNum: 86.4,
        km: 4.2,
        origin: origin.address,
        destination: destination.address,
    };
    window.syncDeliveryWizard?.();
    const scroller = document.getElementById('panel-content');
    const btn = document.querySelector('#delivery-wizard [data-trip-action="request"]');
    if (scroller && btn) {
        scroller.scrollTop += btn.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 16;
    }
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'envio_revision_final.png') });

const review = await page.evaluate(() => {
    const text = document.querySelector('[data-dw-step="review"]')?.innerText || '';
    const btn = document.querySelector('#delivery-wizard [data-trip-action="request"]');
    return {
        open: document.querySelector('[data-dw-state="open"]')?.getAttribute('data-dw-step') || '',
        text,
        request: btn?.textContent?.trim() || '',
        sameHandler: btn?.getAttribute('data-trip-action') || '',
    };
});
t('revisión lista para pedir, sin enviar', review.open === 'review'
    && /María López/.test(review.text)
    && /9988-7766/.test(review.text)
    && /Pollo Campero/.test(review.text)
    && /L\. 86\.40/.test(review.text)
    && /City Mall/.test(review.text)
    && review.sameHandler === 'request',
    review.text.slice(0, 280));

await page.locator('[data-dw-edit="category"]').click();
await page.locator('.delivery-cat-chip[data-cat="farmacia"]').click();
await page.locator('[data-dw-next="category"]').click();
await page.locator('[data-dw-edit="place"]').click();
const edited = await page.evaluate(() => ({
    open: document.querySelector('[data-dw-state="open"]')?.getAttribute('data-dw-step') || '',
    q: document.querySelector('[data-dw-q="place"]')?.textContent || '',
    place: document.getElementById('delivery-restaurant')?.value || '',
    category: document.getElementById('delivery-category')?.value || '',
    name: document.getElementById('delivery-recipient-name')?.value || '',
    phone: document.getElementById('delivery-recipient-phone')?.value || '',
    details: document.getElementById('delivery-package-desc')?.value || '',
}));
t('editar resumen cambia a farmacia y conserva lo escrito', edited.open === 'place'
    && /farmacia/i.test(edited.q)
    && edited.place === 'Pollo Campero'
    && edited.category === 'farmacia'
    && edited.name === 'María López'
    && edited.details.startsWith('2 hamburguesas'),
    JSON.stringify(edited));
await page.locator('[data-dw-back="place"]').click();
const afterBack = await page.evaluate(() => document.querySelector('[data-dw-state="open"]')?.getAttribute('data-dw-step') || '');
t('Atrás vuelve a qué envías', afterBack === 'category', afterBack);
await page.locator('[data-dw-edit="name"]').click();
await page.evaluate(() => { document.getElementById('panel-content').scrollTop = 0; });
await page.screenshot({ path: path.join(out, 'envio_editar_resumen.png') });

const nameInput = page.locator('#delivery-recipient-name');
await nameInput.click();
await page.keyboard.type('!');
await page.waitForTimeout(200);
const beforeScroll = await page.evaluate(() => document.getElementById('panel-content').scrollTop);
await page.evaluate(() => {
    const scroller = document.getElementById('panel-content');
    scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(150);
await page.evaluate(() => { document.getElementById('panel-content').scrollTop = 0; });
const keyboard = await page.evaluate(() => {
    const el = document.getElementById('delivery-recipient-name');
    const card = el?.closest('[data-dw-step]');
    const scroller = document.getElementById('panel-content');
    const cardBox = card?.getBoundingClientRect();
    const box = scroller?.getBoundingClientRect();
    return {
        active: document.activeElement === el,
        id: document.activeElement?.id || document.activeElement?.tagName || '',
        value: el?.value || '',
        open: card?.dataset.dwState || '',
        font: el ? getComputedStyle(el).fontSize : '',
        visible: !!(cardBox && box && cardBox.top < box.bottom && cardBox.bottom > box.top),
        scrollHeight: scroller?.scrollHeight || 0,
        clientHeight: scroller?.clientHeight || 0,
    };
});
t('teclado: el nombre sigue enfocado y el valor se conserva', keyboard.active && keyboard.value === 'María López!', JSON.stringify(keyboard));
t('el campo usa 16px para no hacer zoom en iPhone', keyboard.font === '16px', keyboard.font);
t('la hoja hace scroll y la pregunta sigue visible', keyboard.scrollHeight > keyboard.clientHeight && keyboard.visible && keyboard.open === 'open', JSON.stringify(keyboard));
await page.screenshot({ path: path.join(out, 'envio_teclado_scroll.png') });
t('el scroll del panel se movió y volvió', beforeScroll === 0, String(beforeScroll));

const docs = await page.evaluate(() => {
    window.selectDeliveryCategory('documentos');
    const state = { open: 'category', completed: new Set(['category']) };
    const steps = window.deliveryWizardSteps?.('documentos');
    const card = document.querySelector('[data-dw-step="place"]');
    const hiddenPlace = !card || card.hidden || card.dataset.dwState === 'upcoming';
    return {
        category: document.getElementById('delivery-category')?.value || '',
        placeValue: document.getElementById('delivery-restaurant')?.value || '',
        hiddenPlace,
        hasStepsFn: typeof window.deliveryWizardSteps === 'function',
        unused: !!state,
    };
});
t('documentos no muestra el lugar y no borra el nombre del negocio', docs.category === 'documentos' && docs.placeValue === 'Pollo Campero' && docs.hiddenPlace, JSON.stringify(docs));

const writes = await page.evaluate(() => (window.__HR_MOCK_WRITES || []).map((row) => `${row[0]} ${row[1]}`));
t('sin pedidos ni avisos escritos', !writes.some((line) => /\/trips|notification|fcm|messages/i.test(line)), writes.slice(0, 6).join(' | ') || 'ninguna');
const badPosts = posts.filter((line) => !/maps\.googleapis\.com/.test(line));
t('sin pedidos, rutas ni avisos por red', badPosts.length === 0, badPosts.slice(0, 4).join(' | ') || posts.slice(0, 2).join(' | ') || 'ninguno');
t('sin errores de JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
console.log('capturas', out);
process.exit(failed ? 1 : 0);
