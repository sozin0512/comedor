/**
 * Previews 360×800 del UI real (mismos HTML/CSS que el conductor).
 * Uso: node scripts/preview-viaje-programado.mjs [carpeta-salida]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || '/opt/cursor/artifacts');
fs.mkdirSync(OUT, { recursive: true });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-prev-'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(dir, 'ui.mjs'), fs.readFileSync(path.join(ROOT, 'js/scheduled-trip-driver-ui.js'), 'utf8'));
const ui = await import(pathToFileURL(path.join(dir, 'ui.mjs')).href);

const trip = {
    id: 'prog-1',
    status: 'scheduled',
    scheduledFor: '2026-11-10T15:30:00-06:00',
    price: 'L. 180.00',
    origin: 'Res. Plaza, Col. Kennedy',
    destination: 'Aeropuerto Toncontín',
    clientName: 'María López',
    driverId: 'drv'
};
const NOW = Date.parse('2026-11-10T13:15:00-06:00');
const cssHref = pathToFileURL(path.join(ROOT, 'css/app.css')).href;
const shell = (bodyClass, inner) => `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=360">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<link rel="stylesheet" href="${cssHref}">
<style>
  html, body { margin: 0; width: 360px; height: 800px; overflow: hidden; background: #d7e3c8; font-family: Inter, system-ui, sans-serif; }
  .map { position: absolute; inset: 0; background:
    linear-gradient(180deg, rgba(255,255,255,.2), transparent 30%),
    repeating-linear-gradient(90deg, transparent 0 46px, rgba(255,255,255,.45) 46px 48px),
    repeating-linear-gradient(0deg, transparent 0 46px, rgba(255,255,255,.35) 46px 48px),
    #c5d7a8; }
  .road { position: absolute; background: #f8fafc; border-radius: 8px; }
  .road.a { left: 40px; top: 80px; width: 10px; height: 420px; }
  .road.b { left: 40px; top: 220px; width: 240px; height: 10px; }
  .status { position: absolute; top: 0; left: 0; right: 0; height: 28px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-size: 12px; font-weight: 700; color: #0f172a; }
  .nav { position: absolute; left: 0; right: 0; bottom: 0; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: space-around; font-size: 11px; font-weight: 700; }
  body.android-3btn .nav { height: 48px; }
  body.android-gesture .nav { height: 20px; font-size: 9px; }
  .sheet { position: absolute; left: 0; right: 0; bottom: 0; background: #fff; border-radius: 18px 18px 0 0; padding: 10px 10px 16px; box-shadow: 0 -8px 24px rgba(15,23,42,.16); }
  body.android-3btn .sheet { bottom: 48px; }
  body.android-gesture .sheet { bottom: 20px; }
  .veh { background: #2563eb; color: #fff; border-radius: 14px; text-align: center; font-weight: 900; font-size: 14px; padding: 8px 10px; }
  .price { font-size: 32px; font-weight: 900; margin: 8px 0 0; color: #0f172a; }
  .meta { margin: 0; color: #64748b; font-size: 12px; font-weight: 700; }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; font-size: 13px; font-weight: 800; color: #0f172a; }
  .go { margin-top: 10px; width: 100%; border: 0; border-radius: 12px; background: #059669; color: #fff; font-weight: 900; min-height: 46px; }
  .skip { margin-top: 6px; width: 100%; border: 0; border-radius: 12px; background: #e2e8f0; color: #334155; font-weight: 800; min-height: 40px; }
  .live { background: #fff; border-radius: 16px; padding: 10px 12px; display: flex; align-items: center; gap: 8px; }
  .live b { display: block; font-size: 14px; }
  .live span { font-size: 12px; color: #64748b; font-weight: 700; }
  .mins { margin-left: auto; font-weight: 900; color: #0f172a; }
  .arrived { margin-top: 8px; width: 100%; border: 0; border-radius: 12px; background: #059669; color: #fff; font-weight: 900; min-height: 44px; }
  body.preview-stack .dock { position: absolute; left: 8px; right: 8px; z-index: 5; display: flex; flex-direction: column; gap: 8px; }
  body.android-3btn.preview-stack .dock { bottom: calc(8px + 48px); }
  body.android-gesture.preview-stack .dock { bottom: calc(8px + 20px); }
  body.preview-stack #scheduled-companion.hr-sched-companion { position: relative; left: auto; right: auto; bottom: auto !important; }
  body.preview-stack .sheet { position: relative; left: auto; right: auto; bottom: auto; }
</style>
</head>
<body class="${bodyClass}">
<div class="map"><div class="road a"></div><div class="road b"></div></div>
<div class="status"><span>1:15</span><span>LTE 78%</span></div>
${inner}
<div class="nav"><span>◁</span><span>○</span><span>□</span></div>
</body></html>`;

const offer = shell('driver-mode android-gesture', `
  <div class="sheet">
    <p class="driver-offer-sched-banner-title" style="margin:0">${ui.offerHeadline(ui.scheduledForMs(trip))}</p>
    <p class="meta">${ui.formatLongDay(ui.scheduledForMs(trip))} · ${ui.faltanLabel(ui.scheduledForMs(trip), NOW)} · Efectivo</p>
    <div class="veh">🚗 VIAJE EN CARRO · Taxi VIP</div>
    <p class="price">L. 180.00</p>
    <p class="meta">Efectivo</p>
    <div class="row"><span class="driver-offer-sched-badge"><i class="fas fa-calendar-alt"></i> Programado · ${ui.offerChipLabel(trip)}</span><span>María</span><span>★ 4.9</span><span>1 pers.</span></div>
    ${ui.offerKeepNoteHtml(trip)}
    <div class="row"><span>A ~4 min (2.1 km)</span></div>
    <div class="row" style="font-weight:700;color:#334155">Res. Plaza, Col. Kennedy</div>
    <div class="row">Viaje: 14 min (6.3 km)</div>
    <div class="row" style="font-weight:700;color:#334155">Aeropuerto Toncontín</div>
    <button class="go">✓ Aceptar L. 180.00</button>
    <button class="skip">Pasar</button>
  </div>`);

const compact = shell('driver-mode trip-active android-3btn driver-sched-companion preview-stack', `
  <div class="dock">
    <div id="scheduled-companion" class="hr-sched-companion">${ui.compactCardHtml(trip, { now: NOW })}</div>
    <div class="sheet">
      <div class="live"><div><b>Carlos · viaje Ahora</b><span>Hacia el destino · Mall Multiplaza</span></div><div class="mins">12<br>min</div></div>
      <button class="arrived">Llegué al destino</button>
    </div>
  </div>`);

const takeover = shell('driver-mode scheduled-takeover android-gesture', `
  <div class="sheet">
    ${ui.takeoverHtml(trip)}
  </div>`);

const warning = shell('driver-mode trip-active android-3btn driver-sched-companion preview-stack', `
  <div class="dock">
    <div id="scheduled-companion" class="hr-sched-companion">${ui.warningOnOtherHtml(trip)}</div>
    <div class="sheet">
      <div class="live"><div><b>Carlos · viaje Ahora</b><span>Hacia el destino · Mall Multiplaza</span></div><div class="mins">12<br>min</div></div>
      <button class="arrived">Llegué al destino</button>
    </div>
  </div>`);

const pages = [
    ['viaje-programado-oferta', offer],
    ['viaje-programado-faja', compact],
    ['viaje-programado-media-hora', takeover],
    ['viaje-programado-otro-viaje', warning]
];

const chrome = process.env.CHROME || 'google-chrome';
for (const [name, html] of pages) {
    const file = path.join(dir, `${name}.html`);
    fs.writeFileSync(file, html);
    const png = path.join(OUT, `${name}.png`);
    const profile = path.join(dir, `chrome-${name}`);
    const run = spawnSync('timeout', ['18', chrome,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--allow-file-access-from-files',
        '--force-device-scale-factor=1',
        '--virtual-time-budget=5000',
        `--user-data-dir=${profile}`,
        '--window-size=360,800',
        `--screenshot=${png}`,
        pathToFileURL(file).href
    ], { encoding: 'utf8' });
    if (!fs.existsSync(png) || fs.statSync(png).size < 1000) {
        console.error(run.stdout, run.stderr);
        throw new Error(`No se pudo capturar ${name}`);
    }
    console.log(png, fs.statSync(png).size);
}
