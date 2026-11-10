/**
 * Botón de continuar / pedir visible cuando ya hay tarifas,
 * aunque Taxi VIP solo esté resaltado y todavía no confirmado.
 *   node scripts/test-boton-solicitar.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
    bookingPrimaryAction,
    serviceStepCopy,
    canConfirmHighlightedType,
    bookingTypeButtonName,
    bookingNavClearancePx,
    ANDROID_3BTN_NAV_PX,
    ANDROID_GESTURE_NAV_PX,
} from '../js/booking-primary-action.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const app = read('js/app.js');
const home = read('js/passenger-home.js');
const html = read('index.html');
const css = read('css/app.css');

const faresOnService = {
    routeReady: true,
    faresVisible: true,
    serviceTypeChosen: false,
    needsService: true,
    needsPassengers: true,
    passengersChosen: false,
    whenConfirmed: false,
    highlightedType: 'auto',
    highlightedAvailable: true,
    highlightedName: 'Taxi VIP',
    requestLabel: 'SOLICITAR AHORA',
};

const onService = bookingPrimaryAction(faresOnService);
assert.equal(onService.visible, true, 'con tarifas en el paso de servicio el botón se ve');
assert.equal(onService.mode, 'confirm-service');
assert.equal(onService.label, 'CONTINUAR CON TAXI VIP');
assert.equal(onService.disabled, false);
assert.equal(onService.confirmsType, 'auto');
assert.equal(onService.nextStep, 'passengers', 'confirmar el tipo abre personas, no pide el viaje');

assert.equal(bookingPrimaryAction({ ...faresOnService, faresVisible: false }).visible, false);
assert.equal(bookingPrimaryAction({ ...faresOnService, routeReady: false }).visible, false);

const badge = serviceStepCopy({ chosen: false, highlightedName: 'Taxi VIP', chosenLabel: 'Taxi VIP (automóvil)' });
assert.equal(badge.title, 'Taxi VIP');
assert.equal(badge.badge, 'Tocá continuar');
assert.equal(badge.highlightedPending, true);
assert.notEqual(badge.badge, 'Toca para elegir');
const unpicked = serviceStepCopy({ chosen: false, highlightedName: '' });
assert.equal(unpicked.badge, 'Toca para elegir');
const chosenCopy = serviceStepCopy({ chosen: true, highlightedName: 'Taxi VIP', chosenLabel: 'Taxi VIP (automóvil)' });
assert.equal(chosenCopy.badge, 'Listo · toca para cambiar');
assert.equal(chosenCopy.title, 'Taxi VIP (automóvil)');

assert.equal(canConfirmHighlightedType({
    type: 'taxi',
    disabledTypes: ['taxi'],
    ariaDisabled: true,
    unavailable: true,
}), false, 'Taxi tradicional no disponible no se confirma');
assert.equal(canConfirmHighlightedType({
    type: 'auto',
    disabledTypes: ['taxi'],
    ariaDisabled: false,
    unavailable: false,
}), true, 'el tipo resaltado y disponible sí se confirma');
assert.equal(canConfirmHighlightedType({ type: 'moto', buttonDisabled: true, disabledTypes: ['moto'] }), false);
assert.equal(bookingTypeButtonName('auto'), 'Taxi VIP');
assert.equal(bookingTypeButtonName('moto'), 'Moto');

const blocked = bookingPrimaryAction({
    ...faresOnService,
    highlightedType: 'taxi',
    highlightedAvailable: false,
    highlightedName: 'Taxi',
});
assert.equal(blocked.visible, true);
assert.equal(blocked.mode, 'blocked');
assert.equal(blocked.disabled, true);
assert.equal(blocked.confirmsType, null);

const afterConfirm = bookingPrimaryAction({
    ...faresOnService,
    serviceTypeChosen: true,
});
assert.equal(afterConfirm.visible, true);
assert.equal(afterConfirm.mode, 'passengers');
assert.equal(afterConfirm.label, 'ELEGÍ CUÁNTAS PERSONAS');
assert.equal(afterConfirm.nextStep, 'passengers');

const afterPax = bookingPrimaryAction({
    ...faresOnService,
    serviceTypeChosen: true,
    passengersChosen: true,
    whenConfirmed: false,
    nowIsDefault: true,
});
assert.equal(afterPax.visible, true);
assert.equal(afterPax.mode, 'request');
assert.equal(afterPax.label, 'SOLICITAR AHORA');
assert.equal(afterPax.nextStep, 'request');

const scheduling = bookingPrimaryAction({
    ...faresOnService,
    serviceTypeChosen: true,
    passengersChosen: true,
    whenConfirmed: false,
    nowIsDefault: false,
});
assert.equal(scheduling.visible, true);
assert.equal(scheduling.mode, 'when');
assert.equal(scheduling.label, 'ELEGÍ LA HORA');

const ready = bookingPrimaryAction({
    ...faresOnService,
    serviceTypeChosen: true,
    passengersChosen: true,
    whenConfirmed: true,
    requestLabel: 'SOLICITAR AHORA',
});
assert.equal(ready.mode, 'request');
assert.equal(ready.label, 'SOLICITAR AHORA');
assert.equal(ready.nextStep, 'request');

const pedir = bookingPrimaryAction({
    ...faresOnService,
    serviceTypeChosen: true,
    passengersChosen: true,
    whenConfirmed: true,
    requestLabel: 'PEDIR EL VIAJE',
});
assert.equal(pedir.label, 'PEDIR EL VIAJE');

assert.equal(bookingNavClearancePx({ mode: '3btn', safeBottomPx: 0, navInsetPx: 48 }) >= ANDROID_3BTN_NAV_PX, true);
assert.equal(bookingNavClearancePx({ mode: '3btn', safeBottomPx: 0 }), 48 + 8);
assert.equal(bookingNavClearancePx({ mode: '3btn', safeBottomPx: 64 }), 64 + 8, 'no achicar un inset real más alto');
assert.equal(bookingNavClearancePx({ mode: 'gesture', safeBottomPx: 0 }) >= ANDROID_GESTURE_NAV_PX, true);
assert.equal(bookingNavClearancePx({ mode: 'gesture', safeBottomPx: 0 }), 20 + 8);
assert.equal(bookingNavClearancePx({ mode: 'gesture', safeBottomPx: 34 }), 34 + 8);

const layer = html.slice(html.indexOf('id="booking-float-layer"'), html.indexOf('id="trip-floats-layer"'));
const progressAt = layer.indexOf('id="passenger-booking-progress"');
const requestAt = layer.indexOf('id="passenger-booking-request"');
const dockAt = layer.indexOf('id="booking-primary-dock"');
const continueAt = layer.indexOf('id="booking-continue-btn"');
assert.ok(progressAt > 0 && requestAt > progressAt && dockAt > requestAt && continueAt > dockAt);
assert.match(layer, /<!-- \/passenger-booking-progress -->[\s\S]*id="booking-primary-dock"/);
assert.match(html, /id="fare-request-btn"/);

assert.match(app, /from "\.\/booking-primary-action\.mjs/);
assert.match(app, /window\.syncBookingPrimaryAction/);
assert.match(app, /window\._bookingFaresReady = types\.length > 0/);
assert.match(app, /confirmStep:\s*true/);
assert.match(home, /selectServiceType\(pick, \{ keepFareVisible: false, skipCityCheck: true, confirmStep: false \}\)/);
assert.match(home, /window\.serviceTypeChosen = selectable\.length <= 1/);
const selectFn = app.slice(app.indexOf('window.selectServiceType ='), app.indexOf('bindServiceTypePicker();'));
const cityGuard = selectFn.indexOf('isServiceTypeDisabledInCity(normalizedType, zoneId)');
const marksChosen = selectFn.indexOf('window.serviceTypeChosen = true');
assert.ok(cityGuard > 0 && marksChosen > cityGuard, 'un tipo apagado en la ciudad no queda elegido');
assert.match(selectFn, /if \(confirmStep\) \{\s*window\.serviceTypeChosen = true/);
const clickFn = app.slice(app.indexOf('window.bindBookingPrimaryAction'), app.indexOf('window.syncBookingPrimaryAction ='));
const guardAt = clickFn.indexOf('canConfirmHighlightedType');
const selectAt = clickFn.indexOf('selectServiceType?.');
assert.ok(guardAt > 0 && selectAt > guardAt, 'confirmar el resaltado pasa por el bloqueo de no disponibles');
assert.match(clickFn, /forceOpenStep: 'passengers'/);
assert.match(clickFn, /forceOpenStep: 'when'/);
assert.match(clickFn, /window\.whenStepConfirmed === true/);
assert.doesNotMatch(clickFn, /window\.passengersChosen = true/);
assert.match(app, /showPax = routeReady && serviceReady && needsPax/);
assert.match(app, /showWhen = routeReady && serviceReady && paxReady/);
assert.match(app, /showRequest = routeReady && serviceReady && paxReady && whenReady/);

assert.match(css, /body\.android-3btn \.booking-float-layer\s*\{[^}]*48px/);
assert.match(css, /body\.android-gesture \.booking-float-layer\s*\{[^}]*20px/);
assert.match(css, /\.booking-primary-dock\s*\{[^}]*position:\s*fixed/);
assert.match(app, /if \(routeReady && serviceReady && paxReady && bookingNowIsDefault\(\) && !editingWhen\) \{\s*window\.whenStepConfirmed = true;/);
assert.match(app, /openStep === 'when' && whenReady && bookingNowIsDefault\(\)/);
assert.match(app, /Personas listas y «Ahora» ya es el valor/);
assert.match(css, /\.booking-continue-btn\s*\{[^}]*min-height:\s*3rem/);
assert.match(css, /\.passenger-booking-progress\s*\{[^}]*overflow-y:\s*auto/);
assert.match(css, /@media \(max-width:\s*380px\)/);

function previewHtml({ navMode, step }) {
    const navH = navMode === '3btn' ? 48 : 20;
    const navLabel = navMode === '3btn' ? 'Android · 3 botones' : 'Android · gestos';
    const ready = step === 'ready';
    const stepNote = ready
        ? 'Taxi VIP + 1 persona · el botón sale solo, sin tocar «Ahora»'
        : 'Tarifas de ejemplo en el paso de servicio';
    const decision = bookingPrimaryAction({
        routeReady: true,
        faresVisible: true,
        serviceTypeChosen: ready,
        needsService: true,
        needsPassengers: true,
        passengersChosen: ready,
        whenConfirmed: false,
        nowIsDefault: ready,
        highlightedType: 'auto',
        highlightedAvailable: true,
        highlightedName: 'Taxi VIP',
        requestLabel: 'SOLICITAR AHORA',
    });
    const copy = serviceStepCopy({
        chosen: ready,
        highlightedName: ready ? '' : 'Taxi VIP',
        chosenLabel: 'Taxi VIP (automóvil)',
    });
    return `<!DOCTYPE html>
<html lang="es" class="${navMode === '3btn' ? 'android-3btn' : 'android-gesture'}" style="--safe-bottom:0px;--android-nav-inset:48px;--native-safe-bottom:0px">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ejemplo botón solicitar</title>
<link rel="stylesheet" href="file://${root}/css/tailwind.css">
<link rel="stylesheet" href="file://${root}/css/app.css">
<style>
  html, body { margin: 0; height: 100%; background: #dbe7f3; }
  body { font-family: Inter, system-ui, sans-serif; }
  .ex-map { position: fixed; inset: 0; z-index: 0;
    background:
      linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0)),
      repeating-linear-gradient(90deg, transparent 0 46px, rgba(148,163,184,.35) 46px 47px),
      repeating-linear-gradient(0deg, transparent 0 46px, rgba(148,163,184,.35) 46px 47px),
      #e8eef5; }
  .ex-route { position: fixed; left: 18%; top: 22%; width: 46%; height: 28%;
    border: 6px solid #2563eb; border-radius: 40% 60% 50% 50%; border-left-color: transparent; border-bottom-color: transparent; opacity: .85; }
  .ex-banner { position: fixed; top: 8px; left: 8px; right: 8px; z-index: 700;
    background: #0f172a; color: #fff; border-radius: 12px; padding: 8px 10px; font-size: 11px; font-weight: 800; line-height: 1.35; }
  .ex-banner small { display: block; font-weight: 700; color: #93c5fd; }
  #fake-system-nav { position: fixed; left: 0; right: 0; bottom: 0; height: ${navH}px; z-index: 800;
    background: ${navMode === '3btn' ? '#0f172a' : 'transparent'}; color: #fff;
    display: flex; align-items: center; justify-content: space-around; font-size: 11px; font-weight: 800; }
  #fake-system-nav .pill { width: 108px; height: 5px; border-radius: 99px; background: #0f172a; }
  #probe { display: none; }
</style>
</head>
<body class="client-mode booking-primary-visible ${navMode === '3btn' ? 'android-3btn' : 'android-gesture'}" style="--safe-bottom:0px">
<div class="ex-map"></div>
<div class="ex-route"></div>
<div class="ex-banner">EJEMPLO · datos de muestra · no es un viaje real<small>Tegucigalpa · ${navLabel} · ${stepNote}</small></div>
<div id="booking-float-layer" class="booking-float-layer" aria-label="Pasos para pedir viaje">
  <div class="booking-back-bar">
    <button type="button" class="booking-back-btn"><span>Inicio</span></button>
    <button type="button" class="booking-edit-route-btn"><span>Origen / destino</span></button>
  </div>
  <div id="passenger-booking-progress" class="passenger-booking-progress booking-float-stack">
    <div id="passenger-booking-service" class="booking-progress-step booking-float-card">
      <div id="trip-service-choice-wrap" class="trip-service-choice-wrap ${ready ? '' : 'trip-service-choice-wrap--missing'}">
        <button type="button" id="add-service-btn" class="add-extra-stop-btn add-service-btn ${ready ? 'is-chosen' : 'is-active'}" aria-expanded="${ready ? 'false' : 'true'}">
          <span class="add-extra-stop-btn-icon"><i class="fas fa-car"></i></span>
          <span class="add-extra-stop-btn-text">
            <span class="add-extra-stop-btn-label" id="add-service-btn-label">${copy.title}</span>
            <span class="add-extra-stop-btn-badge" id="add-service-btn-badge">${copy.badge}</span>
          </span>
        </button>
        <div id="trip-service-adder" class="trip-service-adder ${ready ? 'hidden' : ''}">
          <div id="service-type-picker" class="service-type-picker trip-service-picker">
            <button type="button" data-service-type="moto" id="svc-btn-moto" class="service-type-btn trip-service-chip"><span>Moto (pasajeros)</span></button>
            <button type="button" data-service-type="auto" id="svc-btn-auto" class="service-type-btn trip-service-chip active" aria-selected="true"><span>Taxi VIP</span></button>
            <button type="button" data-service-type="taxi" id="svc-btn-taxi" class="service-type-btn trip-service-chip hr-svc-unavailable" aria-disabled="true"><span>Taxi T-</span></button>
          </div>
          <div id="ride-options" class="trip-ride-options">
            <p class="trip-ride-options-label">Cambiar tipo de vehículo</p>
            <div id="ride-options-list">
              <div class="ride-card flex items-center gap-3 p-3 rounded-2xl border border-gray-200 bg-white">
                <div class="flex-1"><div class="font-black text-sm">Moto (pasajeros)</div><div class="text-[10px] text-gray-500">Hasta 2 personas</div></div>
                <div class="price-value font-black">L. 207.31</div>
              </div>
              <div class="ride-card flex items-center gap-3 p-3 rounded-2xl border border-blue-600 bg-blue-50">
                <div class="flex-1"><div class="font-black text-sm">Taxi VIP</div><div class="text-[10px] text-gray-500">Hasta 4 personas</div></div>
                <div class="price-value font-black">L. 265.93</div>
              </div>
              <div class="ride-option-unavailable" aria-disabled="true">Taxi tradicional · No disponible en Tegucigalpa (ejemplo)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="passenger-booking-passengers" class="booking-progress-step booking-float-card ${ready ? '' : 'hidden'}">
      <button type="button" id="add-passengers-btn" class="add-extra-stop-btn add-passengers-btn is-chosen">
        <span class="add-extra-stop-btn-text">
          <span class="add-extra-stop-btn-label">1 persona en el viaje</span>
          <span class="add-extra-stop-btn-badge">Listo · toca para cambiar</span>
        </span>
      </button>
      <div class="trip-passengers-adder hidden">
        <div class="flex flex-wrap gap-1.5">
          <button type="button" class="trip-pax-chip px-3 py-2.5 min-w-[2.85rem] rounded-xl text-sm font-black border-2 border-slate-200 bg-white">1</button>
          <button type="button" class="trip-pax-chip px-3 py-2.5 min-w-[2.85rem] rounded-xl text-sm font-black border-2 border-slate-200 bg-white">2</button>
          <button type="button" class="trip-pax-chip px-3 py-2.5 min-w-[2.85rem] rounded-xl text-sm font-black border-2 border-slate-200 bg-white">3</button>
          <button type="button" class="trip-pax-chip px-3 py-2.5 min-w-[2.85rem] rounded-xl text-sm font-black border-2 border-slate-200 bg-white">4</button>
        </div>
      </div>
    </div>
    <div id="passenger-booking-when" class="booking-progress-step booking-float-card ${ready ? '' : 'hidden'}">
      <button type="button" id="add-when-btn" class="add-extra-stop-btn add-when-btn is-chosen">
        <span class="add-extra-stop-btn-text">
          <span class="add-extra-stop-btn-label">Ahora · lo necesito ya</span>
          <span class="add-extra-stop-btn-badge">Listo · toca para programar</span>
        </span>
      </button>
    </div>
  </div>
  <div id="booking-primary-dock" class="booking-primary-dock" data-mode="${decision.mode}" data-above-system-nav="1">
    <button type="button" id="booking-continue-btn" class="booking-continue-btn" aria-label="${decision.label}">
      <span id="booking-continue-label">${decision.label}</span>
    </button>
  </div>
</div>
<div id="fake-system-nav" aria-hidden="true">${navMode === '3btn' ? '<span>◁</span><span>○</span><span>□</span>' : '<span class="pill"></span>'}</div>
<pre id="probe"></pre>
<script>
const btn = document.getElementById('booking-continue-btn');
const nav = document.getElementById('fake-system-nav');
const br = btn.getBoundingClientRect();
const nr = nav.getBoundingClientRect();
document.getElementById('probe').textContent = JSON.stringify({
  label: btn.textContent.trim(),
  mode: document.getElementById('booking-primary-dock').dataset.mode,
  badge: document.getElementById('add-service-btn-badge').textContent.trim(),
  title: document.getElementById('add-service-btn-label').textContent.trim(),
  btnTop: br.top, btnBottom: br.bottom, btnLeft: br.left, btnRight: br.right,
  btnH: br.height, btnW: br.width,
  navTop: nr.top, navH: nr.height,
  innerWidth: window.innerWidth, innerHeight: window.innerHeight,
  aboveNav: br.bottom <= nr.top + 0.5,
  onScreen: br.top >= 0 && br.left >= 0 && br.right <= window.innerWidth + 0.5 && br.height >= 48,
});
</script>
</body></html>`;
}

const chromeBin = ['/usr/local/bin/google-chrome', 'google-chrome', 'chromium'].find((bin) => {
    if (bin.startsWith('/')) return fs.existsSync(bin);
    const w = spawnSync('bash', ['-lc', `command -v ${bin}`], { encoding: 'utf8' });
    return w.status === 0 && w.stdout.trim();
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function capturePhone(htmlPath, { w, h, screenshot }) {
    const port = 9333 + Math.floor(Math.random() * 500);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-cdp-'));
    const proc = spawn(chromeBin, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--allow-file-access-from-files',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${dir}`,
        `--window-size=${w},${h}`,
    ], { stdio: 'ignore' });
    try {
        let version = null;
        for (let i = 0; i < 40; i++) {
            try {
                version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
                break;
            } catch (_) {
                await sleep(150);
            }
        }
        if (!version?.webSocketDebuggerUrl) throw new Error('Chrome no abrió el puerto de depuración');
        const ws = new WebSocket(version.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', () => reject(new Error('websocket')));
        });
        let seq = 0;
        const pending = new Map();
        const wait = (id) => new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`cdp timeout ${id}`)), 20000);
            pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
        });
        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && pending.has(msg.id)) {
                const done = pending.get(msg.id);
                pending.delete(msg.id);
                done(msg);
            }
        });
        const send = (method, params = {}, sessionId) => {
            const id = ++seq;
            const payload = { id, method, params };
            if (sessionId) payload.sessionId = sessionId;
            ws.send(JSON.stringify(payload));
            return wait(id);
        };
        const target = await send('Target.createTarget', { url: 'about:blank' });
        const sessionId = (await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true })).result.sessionId;
        const call = (method, params) => send(method, params, sessionId).then((m) => {
            if (m.error) throw new Error(m.error.message || method);
            return m.result;
        });
        await call('Emulation.setDeviceMetricsOverride', {
            width: w, height: h, deviceScaleFactor: 1, mobile: true,
        });
        await call('Page.enable');
        await call('Runtime.enable');
        const loaded = new Promise((resolve) => {
            const onMsg = (ev) => {
                const msg = JSON.parse(ev.data);
                if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) {
                    ws.removeEventListener('message', onMsg);
                    resolve();
                }
            };
            ws.addEventListener('message', onMsg);
        });
        await call('Page.navigate', { url: `file://${htmlPath}` });
        await Promise.race([loaded, sleep(8000)]);
        await sleep(200);
        const evaled = await call('Runtime.evaluate', {
            expression: 'document.getElementById("probe")?.textContent || ""',
            returnByValue: true,
        });
        const probe = JSON.parse(evaled.result.value || '{}');
        let png = null;
        if (screenshot) {
            const shot = await call('Page.captureScreenshot', { format: 'png' });
            png = Buffer.from(shot.data, 'base64');
        }
        ws.close();
        return { probe, png };
    } finally {
        proc.kill('SIGKILL');
    }
}

if (!chromeBin) {
    console.log('SKIP layout: no hay Chrome. Las pruebas de lógica y CSS sí corrieron.');
} else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-booking-'));
    const shots = [
        { file: 'booking-solicitar-ahora-3btn-360.png', navMode: '3btn', step: 'ready', w: 360, h: 780 },
        { file: 'booking-solicitar-ahora-gesture-360.png', navMode: 'gesture', step: 'ready', w: 360, h: 780 },
        { file: null, navMode: '3btn', step: 'ready', w: 320, h: 740 },
    ];
    const art = '/opt/cursor/artifacts';
    fs.mkdirSync(art, { recursive: true });
    for (const shot of shots) {
        const htmlPath = path.join(tmp, `preview-${shot.navMode}-${shot.w}-${shot.step}.html`);
        fs.writeFileSync(htmlPath, previewHtml(shot));
        const { probe, png } = await capturePhone(htmlPath, { w: shot.w, h: shot.h, screenshot: !!shot.file });
        assert.equal(probe.innerWidth, shot.w, `ancho real ${probe.innerWidth} ≠ ${shot.w}`);
        assert.equal(probe.aboveNav, true, `botón tapado por la barra ${shot.navMode} @${shot.w}: ${JSON.stringify(probe)}`);
        assert.equal(probe.onScreen, true, `botón fuera de la pantalla ${shot.navMode} @${shot.w}: ${JSON.stringify(probe)}`);
        assert.ok(probe.btnW >= Math.min(200, shot.w - 40), `botón angosto ${probe.btnW}`);
        assert.equal(probe.label, 'SOLICITAR AHORA');
        assert.equal(probe.mode, 'request');
        assert.equal(probe.title, 'Taxi VIP (automóvil)');
        if (shot.file && png) {
            const out = path.join(art, shot.file);
            fs.writeFileSync(out, png);
            assert.ok(png.length > 5000, shot.file);
            console.log('screenshot', out, probe);
        } else {
            console.log('narrow', shot.w, probe);
        }
    }
}

console.log('ok boton solicitar');
