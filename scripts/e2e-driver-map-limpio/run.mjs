/**
 * Mapa del conductor, antes no: esta corrida es el estado nuevo (Mapa limpio).
 * Firebase mock. No abre «en línea» de verdad ni crea viajes.
 *   PLAYWRIGHT_CORE=/tmp/e2e-tools/package.json node scripts/e2e-driver-map-limpio/run.mjs [salida]
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
} catch (_) { console.log('SKIP: falta playwright-core'); process.exit(0); }
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const mocksDir = path.join(here, '..', 'e2e-origen-pasajero', 'firebase-mocks');
const mockMap = {
    'firebase-firestore.js': 'firestore.js', 'firebase-auth.js': 'auth.js', 'firebase-app.js': 'app.js',
    'firebase-functions.js': 'functions.js', 'firebase-storage.js': 'storage.js', 'firebase-messaging.js': 'messaging.js',
};
const CT = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const results = [];
const t = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };
const chip = (label, meta) => `<div class="copa-chip-wrap public-copa-strip-inner"><button type="button" class="copa-chip copa-chip--map"><span class="copa-chip-ico"><i class="fas fa-trophy"></i></span><span class="copa-chip-body"><span class="copa-chip-label">${label}</span><span class="copa-chip-rank copa-chip-rank--live">LIVE</span><span class="copa-chip-sep">·</span><span class="copa-chip-meta">${meta}</span></span></button></div>`;

async function session(viewport) {
    const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({
        viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
        locale: 'es-HN', timezoneId: 'America/Tegucigalpa',
        userAgent: viewport.width < 380
            ? 'Mozilla/5.0 (Linux; Android 14; SM-A155M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
            : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    });
    await ctx.addInitScript(() => {
        const uid = 'e2e-conductor';
        window.__HR_MOCK_USER = { uid, email: 'driver@example.com', emailVerified: true, displayName: 'Diego', providerData: [], getIdToken: async () => 'x', getIdTokenResult: async () => ({ claims: {} }), reload: async () => {} };
        const profile = { role: 'driver', name: 'Diego', email: 'driver@example.com', phone: '+50499887766', approvalStatus: 'approved', legalAccepted: true, termsAccepted: true, privacyAccepted: true, city: 'tegucigalpa', serviceZoneId: 'tegucigalpa', driverBalance: 0 };
        window.__HR_MOCK_PROFILE = profile;
        window.__HR_MOCK_DOCS = (p) => (String(p).endsWith(`/users/${uid}/profile/data`) ? profile : null);
        try { localStorage.setItem('honduber_market', 'hn'); localStorage.setItem('hrInstallBannerDismissedAt', String(Date.now())); localStorage.setItem('honduber-theme', 'light'); } catch (_) {}
        window.Notification = { permission: 'denied', requestPermission: async () => 'denied' };
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
    await page.waitForTimeout(3500);
    return { browser, page, posts };
}

async function paint(page, html) {
    await page.evaluate((html) => {
        document.getElementById('hr-boot-loading')?.classList.add('hr-boot-hide');
        document.getElementById('notif-prompt-modal')?.remove();
        document.querySelectorAll('.toast, #toast-container, [class*="toast"]').forEach((el) => el.remove());
        document.body.classList.add('driver-mode', 'panel-minimized', 'panel-collapsed');
        document.body.classList.remove('client-mode', 'trip-active', 'is-searching', 'passenger-mode-home', 'driver-copa-tray');
        window.isDriverOnlineActive = () => true;
        window._driverRadarOfferCount = 2;
        const earn = document.getElementById('driver-earnings-float');
        earn.classList.remove('hidden');
        earn.innerHTML = `<div class="driver-earnings-float driver-earnings-float--min" data-earnings-expand="1"><div class="driver-earnings-min-pill"><i class="fas fa-grip-vertical trip-float-grip"></i><i class="fas fa-coins"></i><span>L. 0.00 hoy</span></div></div>`;
        const a = document.getElementById('public-copa-strip');
        a.innerHTML = html.copa; a.classList.remove('hidden');
        const b = document.getElementById('public-pcopa-strip');
        b.innerHTML = html.pax; b.classList.remove('hidden');
        window.syncDriverMapDock?.();
    }, html);
    await page.waitForTimeout(200);
}

const sample = { copa: chip('Copa', 'Carrera a 1000'), pax: chip('Copa pax', 'Todos vs todos') };

{
    const s = await session({ width: 360, height: 800 });
    await paint(s.page, sample);
    const layout = await s.page.evaluate(() => {
        const dock = document.getElementById('driver-map-dock');
        const open = document.getElementById('driver-map-open');
        const fab = document.getElementById('panel-expand-fab');
        const radar = document.getElementById('driver-radar-float');
        const earn = document.querySelector('#driver-map-earn-slot .driver-earnings-min-pill');
        const status = document.getElementById('driver-map-status');
        const copa = document.getElementById('public-copa-strip');
        const map = document.getElementById('map');
        const dockBox = dock.getBoundingClientRect();
        const openBox = open.getBoundingClientRect();
        const earnBox = earn?.getBoundingClientRect();
        const statusBox = status.getBoundingClientRect();
        const copaBox = copa.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const visible = (el) => {
            const cs = getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
        };
        return {
            dock: getComputedStyle(dock).display,
            fab: getComputedStyle(fab).display,
            radar: getComputedStyle(radar).display,
            earnInSlot: !!earn,
            status: status?.textContent?.trim(),
            online: status?.dataset.online,
            action: open?.getAttribute('data-trip-action'),
            actionText: open?.innerText?.replace(/\s+/g, ' ').trim(),
            copaHidden: getComputedStyle(copa).visibility === 'hidden' || getComputedStyle(copa).opacity === '0',
            mapH: map.getBoundingClientRect().height,
            vh, vw,
            overflow: openBox.right > vw + 1 || openBox.left < -1 || earnBox.right > vw + 1 || statusBox.right > vw + 1,
            stacked: earnBox && statusBox ? earnBox.top < statusBox.bottom && statusBox.top < earnBox.bottom + 8 : false,
            overlapCopa: earnBox && copaBox && getComputedStyle(copa).visibility !== 'hidden'
                ? !(earnBox.bottom < copaBox.top || earnBox.top > copaBox.bottom)
                : false,
            dockCovers: dockBox.height > vh * 0.2,
        };
    });
    t('android: una sola tarjeta y el FAB suelto no se ve', layout.dock === 'block' && layout.fab === 'none' && layout.radar === 'none' && layout.action === 'show-panel', JSON.stringify(layout));
    t('android: balance y En línea van juntos, Copa no tapa el balance', layout.earnInSlot && layout.status === 'En línea' && layout.online === '1' && layout.stacked && layout.copaHidden && !layout.overflow, JSON.stringify(layout));
    t('android: el mapa sigue alto', layout.mapH > layout.vh * 0.55, `${layout.mapH}/${layout.vh}`);
    await s.page.screenshot({ path: path.join(out, 'android_mapa_limpio.png') });
    const nav = async (inset, ready) => {
        await s.page.evaluate(({ inset, ready }) => {
            document.documentElement.style.setProperty('--native-safe-bottom', `${inset}px`);
            document.body.classList.add('capacitor-android', 'capacitor-native');
            document.documentElement.classList.add('capacitor-android', 'capacitor-native');
            document.body.classList.toggle('native-insets-ready', ready);
            document.documentElement.classList.toggle('native-insets-ready', ready);
            let bar = document.getElementById('e2e-nav-bar');
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'e2e-nav-bar';
                document.body.appendChild(bar);
            }
            bar.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${inset}px;z-index:70;pointer-events:auto;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:space-around;font:700 12px/1 sans-serif`;
            bar.textContent = inset >= 40 ? '◁    ○    □' : '';
        }, { inset, ready });
        return s.page.evaluate((inset) => {
            const btn = document.getElementById('driver-map-open');
            const box = btn.getBoundingClientRect();
            const x = Math.round(box.left + box.width * 0.82);
            const y = Math.round(box.top + box.height / 2);
            const hit = document.elementFromPoint(x, y);
            return {
                gap: Math.round(innerHeight - inset - box.bottom),
                hit: !!(hit && hit.closest && hit.closest('#driver-map-open')),
                cssBottom: getComputedStyle(document.querySelector('.driver-map-dock-bottom')).bottom,
            };
        }, inset);
    };
    const buttons = await nav(48, true);
    await s.page.screenshot({ path: path.join(out, 'android_nav_tres_botones.png') });
    t('3 botones: la tarjeta queda encima de la barra y se puede tocar', buttons.hit && buttons.gap >= 8 && buttons.gap < 40, JSON.stringify(buttons));
    const gesture = await nav(20, true);
    await s.page.screenshot({ path: path.join(out, 'android_nav_gestos.png') });
    t('gestos: la tarjeta baja con el inset real y sigue tocable', gesture.hit && gesture.gap >= 8 && gesture.gap < buttons.gap + 2, JSON.stringify(gesture));
    await s.page.evaluate(() => {
        document.documentElement.style.setProperty('--native-safe-bottom', '0px');
        document.body.classList.add('capacitor-android');
        document.body.classList.remove('native-insets-ready');
        document.documentElement.classList.remove('native-insets-ready');
        const bar = document.getElementById('e2e-nav-bar');
        if (bar) bar.style.height = '48px';
    });
    const early = await s.page.evaluate(() => {
        const box = document.getElementById('driver-map-open').getBoundingClientRect();
        const css = parseFloat(getComputedStyle(document.querySelector('.driver-map-dock-bottom')).bottom);
        const y = Math.round(box.top + box.height / 2);
        const x = Math.round(box.left + box.width * 0.82);
        const hit = document.elementFromPoint(x, y);
        return {
            css,
            gap: Math.round(innerHeight - 48 - box.bottom),
            hit: !!(hit && hit.closest && hit.closest('#driver-map-open')),
        };
    });
    t('sin inset todavía: piso de 48px para no quedar bajo los 3 botones', early.hit && early.css >= 56 && early.gap >= 8, JSON.stringify(early));
    await s.page.evaluate(() => {
        document.getElementById('e2e-nav-bar')?.remove();
        document.body.classList.remove('capacitor-android', 'capacitor-native', 'native-insets-ready');
        document.documentElement.classList.remove('capacitor-android', 'capacitor-native', 'native-insets-ready');
        document.documentElement.style.removeProperty('--native-safe-bottom');
    });
    await s.page.locator('#driver-map-copa-toggle').click();
    const more = s.page.locator('[data-copa-more]');
    if (await more.count()) await more.click();
    const tray = await s.page.evaluate(() => {
        const copa = document.getElementById('public-copa-strip');
        const pax = document.getElementById('public-pcopa-strip');
        const cs = getComputedStyle(copa);
        const a = copa.getBoundingClientRect();
        const b = pax.getBoundingClientRect();
        const earn = document.querySelector('#driver-map-earn-slot .driver-earnings-min-pill')?.getBoundingClientRect();
        return {
            open: document.body.classList.contains('driver-copa-tray'),
            visible: cs.visibility !== 'hidden' && cs.opacity !== '0',
            stacked: b.height > 10 && b.top >= a.bottom - 6,
            belowEarn: !earn || a.top >= earn.bottom - 2,
            text: (copa.textContent || '').includes('Copa') && (pax.textContent || '').includes('Copa pax'),
            a: Math.round(a.top), b: Math.round(b.top), ah: Math.round(a.height),
            ai: copa.style.getPropertyValue('--copa-tray-i'),
            bi: pax.style.getPropertyValue('--copa-tray-i'),
        };
    });
    t('android: Copa se abre en bandeja sin perder los dos rankings', tray.open && tray.visible && tray.stacked && tray.belowEarn && tray.text, JSON.stringify(tray));
    await s.page.screenshot({ path: path.join(out, 'android_copa_bandeja.png') });
    await s.page.locator('#driver-map-open').click();
    await s.page.waitForTimeout(200);
    const opened = await s.page.evaluate(() => ({
        minimized: document.body.classList.contains('panel-minimized'),
        dock: getComputedStyle(document.getElementById('driver-map-dock')).display,
        panelH: document.getElementById('control-panel')?.getBoundingClientRect().height || 0,
    }));
    t('android: Abrir panel usa el handler y quita el minimizado', opened.minimized === false && opened.dock === 'none' && opened.panelH > 80, JSON.stringify(opened));
    await s.page.evaluate(() => {
        document.body.classList.add('panel-minimized', 'panel-collapsed');
        document.getElementById('control-panel')?.classList.add('panel-collapsed');
        window.syncDriverMapDock?.();
    });
    const back = await s.page.evaluate(() => getComputedStyle(document.getElementById('driver-map-dock')).display);
    t('android: al minimizar otra vez vuelve la tarjeta', back === 'block', back);
    const mapStill = await s.page.evaluate(() => document.getElementById('map').getBoundingClientRect().height);
    t('android: cerrar el panel no encoge el mapa a cero', mapStill > 400, String(mapStill));
    await s.page.evaluate(() => {
        document.body.classList.remove('driver-mode', 'panel-minimized', 'panel-collapsed', 'driver-copa-tray');
        document.body.classList.add('client-mode');
    });
    const pax = await s.page.evaluate(() => ({
        dock: getComputedStyle(document.getElementById('driver-map-dock')).display,
        copaVis: getComputedStyle(document.getElementById('public-copa-strip')).visibility,
    }));
    t('pasajero: el dock no se muestra y Copa no queda forzada invisible', pax.dock === 'none' && pax.copaVis !== 'hidden', JSON.stringify(pax));
    const bad = s.posts.filter((u) => !/maps\.googleapis/.test(u));
    t('sin escrituras de viajes', !bad.some((u) => /trips|firestore/.test(u)), bad.slice(0, 3).join(' | ') || 'ninguna');
    await s.browser.close();
}

{
    const s = await session({ width: 390, height: 844 });
    await paint(s.page, sample);
    await s.page.screenshot({ path: path.join(out, 'iphone_mapa_limpio.png') });
    const fit = await s.page.evaluate(() => {
        const open = document.getElementById('driver-map-open').getBoundingClientRect();
        const top = document.querySelector('.driver-map-dock-top').getBoundingClientRect();
        return { openBottom: open.bottom, topTop: top.top, vw: innerWidth, vh: innerHeight, right: open.right };
    });
    t('iphone: la tarjeta cabe y el tope no se sale', fit.openBottom < fit.vh - 2 && fit.topTop > 40 && fit.right <= fit.vw + 1, JSON.stringify(fit));
    await s.browser.close();
}

const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
