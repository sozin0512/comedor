import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, loadPuppeteer, CHROME } from './e2e-sonido-pedidos/server.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = [];
const ok = (name, cond, detail = '') => R.push([cond ? 'PASS' : 'FAIL', name, detail]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Verificar reglas Firestore: isStaff(app) puede crear en stores y store_products
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
ok(
    'firestore.rules: permite a Admin y Supervisor (isStaff(app)) crear sucursales en stores/{storeId}',
    /match \/artifacts\/\{app\}\/public\/data\/stores\/\{storeId\}[\s\S]*?allow create: if isSignedIn\(\) && \(\s*\(\s*isStaff\(app\)/.test(rules)
);
ok(
    'firestore.rules: permite a Admin y Supervisor (isStaff(app)) copiar/crear productos en store_products/{productId}',
    /match \/artifacts\/\{app\}\/public\/data\/store_products\/\{productId\}[\s\S]*?allow create: if isSignedIn\(\)[\s\S]*?isStaff\(app\)/.test(rules)
);

// 2. Prueba en navegador real (Puppeteer) de las funciones exportadas de merchant-stores.js y del modal interactivo
const pageHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<link rel="stylesheet" href="/css/tailwind.css">
<link rel="stylesheet" href="/css/app.css">
<style>
  body { margin: 0; background: #0f172a; font-family: Inter, system-ui, -apple-system, sans-serif; color: #f8fafc; }
  .demo-shell { display: grid; grid-template-columns: 400px 1fr; gap: 18px; padding: 18px; min-height: 100vh; box-sizing: border-box; align-items: start; }
  .sup-panel { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 16px; box-shadow: 0 20px 45px rgba(0,0,0,0.4); }
  .sup-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .sup-badge { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; color: #93c5fd; background: rgba(37,99,235,0.25); border: 1px solid rgba(59,130,246,0.45); padding: 4px 10px; border-radius: 999px; }
  /* Override modal fixed full-screen to sit cleanly in the right column for the preview screenshot */
  #hr-staff-branch-modal { position: relative !important; inset: auto !important; background: transparent !important; backdrop-filter: none !important; padding: 0 !important; z-index: 10 !important; }
  #hr-staff-branch-modal .hr-staff-branch-card { max-width: 100% !important; max-height: none !important; box-shadow: 0 25px 55px rgba(0,0,0,0.45) !important; }
  .fake-map-grid {
    width: 100%; height: 100%;
    background-color: #dbeafe;
    background-image:
      linear-gradient(rgba(59,130,246,0.16) 1px, transparent 1px),
      linear-gradient(90deg, rgba(59,130,246,0.16) 1px, transparent 1px),
      linear-gradient(35deg, transparent 44%, #fde68a 45%, #fde68a 51%, transparent 52%),
      linear-gradient(-22deg, transparent 58%, #ffffff 59%, #ffffff 63%, transparent 64%);
    background-size: 28px 28px, 28px 28px, 100% 100%, 100% 100%;
    position: relative;
  }
  .fake-map-label {
    position: absolute; background: rgba(255,255,255,0.92); color: #1e293b; font-size: 10px; font-weight: 800;
    padding: 2px 7px; border-radius: 6px; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.08);
  }
</style>
</head><body>
<div class="demo-shell">
  <div class="sup-panel">
    <div class="sup-head">
      <div>
        <span class="sup-badge"><i class="fas fa-user-shield"></i> Panel Admin / Supervisor</span>
        <h2 style="margin:6px 0 2px;font-size:18px;font-weight:900;color:#fff">Tiendas Registradas</h2>
        <p style="margin:0;font-size:12px;color:#94a3b8;font-weight:600">Agrega sucursales con pin en el mapa, días, horario y mismo menú</p>
      </div>
    </div>
    <div id="sup-cards" class="space-y-3"></div>
  </div>
  <div id="modal-slot"></div>
</div>
<script type="module">
import {
  STORE_WEEKDAYS,
  storeOperatingDays,
  formatStoreOperatingDaysSummary,
  storeOpenInfo,
  formatStoreHoursSummary,
  mergeSharedMenuProducts,
  buildStaffBranchModalHtml,
} from '/js/merchant-stores.js';

window.TEST_API = {
  STORE_WEEKDAYS,
  storeOperatingDays,
  formatStoreOperatingDaysSummary,
  storeOpenInfo,
  formatStoreHoursSummary,
  mergeSharedMenuProducts,
  buildStaffBranchModalHtml,
};

// Render supervisor store cards on the left
const mainStore = {
  id: 'store_la_sopota',
  name: 'La Sopota',
  category: 'comida',
  cityName: 'Comayagua',
  cityId: 'comayagua',
  address: 'Barrio Torondón, Comayagua',
  phone: '+504 9988-7766',
  ownerName: 'Doña Carmen',
  isOpen: true,
  hours: { open: '08:00', close: '20:00', days: [1,2,3,4,5,6,0] },
  operatingDays: [1,2,3,4,5,6,0],
};

const branchStore = {
  id: 'store_la_sopota_boulevard',
  name: 'La Sopota',
  branchName: 'Sucursal Boulevard',
  parentStoreId: 'store_la_sopota',
  sharedMenuStoreId: 'store_la_sopota',
  sameMenuAsParent: true,
  category: 'comida',
  cityName: 'Comayagua',
  cityId: 'comayagua',
  address: 'Boulevard Cuarto Centenario, frente a Mall Premier',
  phone: '+504 9988-7766',
  ownerName: 'Doña Carmen',
  isOpen: true,
  hours: { open: '09:00', close: '21:00', days: [1,2,3,4,5,6] },
  operatingDays: [1,2,3,4,5,6],
};

function renderSupCard(s, isBranch = false) {
  return \`
    <article class="ops-card hr-staff-store rounded-2xl border border-slate-700/80 bg-slate-900/75 p-4 space-y-3">
      <div class="flex gap-3 items-start">
        <div class="hr-store-avatar" style="background:linear-gradient(135deg,#0c4a8e,#2563eb);color:#fff;display:flex;align-items:center;justify-content:center;border-radius:14px;font-weight:900">🍲</div>
        <div class="min-w-0 flex-1">
          <h3 class="font-black text-white text-sm">\${s.name}\${s.branchName ? \` <span class="text-xs font-extrabold text-sky-300">· 📍 \${s.branchName}</span>\` : ''}</h3>
          <p class="text-[11px] text-slate-400 font-semibold mt-0.5">Comida / Restaurante · \${s.cityName}</p>
          <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span class="ops-badge ops-badge--emerald">Verificada</span>
            <span class="text-[10px] font-bold text-emerald-400">● Abierta</span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1"><i class="fas fa-map-marker-alt text-sky-400"></i> \${s.address}</p>
          <p class="text-[11px] text-sky-400 font-semibold mt-0.5"><i class="fas fa-clock"></i> \${formatStoreHoursSummary(s)}\${isBranch ? ' · 🍽️ Menú compartido' : ' · 📋 18 productos'}</p>
          <p class="text-[10px] text-slate-500 mt-0.5">Dueño: \${s.ownerName} (\${s.phone})</p>
        </div>
      </div>
      <div class="hr-staff-actions">
        <button type="button" class="hr-staff-act hr-staff-act--view"><i class="fas fa-external-link-alt"></i> Ver en app</button>
        <button type="button" class="hr-staff-act hr-staff-act--city"><i class="fas fa-map-marker-alt"></i> Ciudad</button>
        <button type="button" class="hr-staff-act" style="background:rgba(16,185,129,0.18);color:#6EE7B7;border-color:rgba(16,185,129,0.4);"><i class="fas fa-map-pin"></i> Pin / Horario</button>
        <button type="button" class="hr-staff-act" style="background:rgba(37,99,235,0.28);color:#93C5FD;border-color:rgba(59,130,246,0.55);grid-column:span 3;padding:9px 8px;font-size:12px;font-weight:900;"><i class="fas fa-plus-circle"></i> ➕ Agregar sucursal</button>
      </div>
    </article>
  \`;
}

document.getElementById('sup-cards').innerHTML = renderSupCard(mainStore, false) + renderSupCard(branchStore, true);

// Render the modal on the right pre-filled as a demonstration
const modalHtml = buildStaffBranchModalHtml({
  ...mainStore,
  lat: 14.45862,
  lng: -87.64118,
  address: 'Boulevard Cuarto Centenario, frente a Mall Premier, Comayagua',
  hours: { open: '09:00', close: '21:00', days: [1,2,3,4,5,6] },
  operatingDays: [1,2,3,4,5,6],
}, { mode: 'create', menuCount: 18 });

document.getElementById('modal-slot').innerHTML = modalHtml;
const brNameInput = document.getElementById('sb-branch-name');
if (brNameInput) brNameInput.value = 'Sucursal Boulevard Mall Premier';
const searchInput = document.getElementById('sb-place-search');
if (searchInput) searchInput.value = 'Boulevard Cuarto Centenario, Comayagua';

const mapBox = document.getElementById('sb-pin-map');
if (mapBox) {
  mapBox.innerHTML = \`
    <div class="fake-map-grid">
      <span class="fake-map-label" style="top:16px;left:18px;">🛣️ Blvr. Cuarto Centenario</span>
      <span class="fake-map-label" style="top:38px;right:22px;">🏬 Mall Premier Comayagua</span>
      <span class="fake-map-label" style="bottom:36px;left:38%;">📍 Comayagua Centro</span>
    </div>
  \`;
}

window.ready = true;
</script>
</body></html>`;

const { srv, url } = await serve(ROOT, { '/__sucursal_demo.html': pageHtml });
const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--mute-audio'],
});

try {
    const p = await browser.newPage();
    await p.setViewport({ width: 1120, height: 1180, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => R.push(['FAIL', 'error JS en página', e.message]));
    await p.goto(`${url}/__sucursal_demo.html`);
    await p.waitForFunction('window.ready === true');
    await sleep(250);

    // Run unit assertions inside browser context
    const testResults = await p.evaluate(() => {
        const api = window.TEST_API;
        const branch = {
            isOpen: true,
            operatingDays: [1, 2, 3, 4, 5, 6], // Lunes a Sábado
            hours: { open: '09:00', close: '21:00', days: [1, 2, 3, 4, 5, 6] },
        };
        const openMon = api.storeOpenInfo(branch, 11 * 60, 1); // Lunes 11:00 AM
        const closedMon = api.storeOpenInfo(branch, 22 * 60, 1); // Lunes 10:00 PM
        const closedSun = api.storeOpenInfo(branch, 11 * 60, 0); // Domingo 11:00 AM
        const summary = api.formatStoreHoursSummary(branch);

        const parentMenu = [
            { id: 'p1', name: 'Sopa de Res Grande', price: 145, sortOrder: 0 },
            { id: 'p2', name: 'Baleada con Todo', price: 55, sortOrder: 1 },
            { id: 'p3', name: ' Refresco Natural', price: 35, sortOrder: 2 },
        ];
        const mergedFromEmpty = api.mergeSharedMenuProducts([], parentMenu);
        const mergedWithExisting = api.mergeSharedMenuProducts(
            [{ id: 'b1', sourceProductId: 'p1', name: 'Sopa de Res Grande', price: 145, sortOrder: 0 }],
            parentMenu
        );

        return {
            openMon,
            closedMon,
            closedSun,
            summary,
            mergedFromEmptyCount: mergedFromEmpty.length,
            mergedWithExistingCount: mergedWithExisting.length,
            hasModal: !!document.getElementById('hr-staff-branch-modal'),
            branchNameVal: document.getElementById('sb-branch-name')?.value,
            sameMenuChecked: document.getElementById('sb-same-menu')?.checked,
            checkedDays: [...document.querySelectorAll('[data-sb-day]:checked')].map((el) => Number(el.value)),
        };
    });

    ok('Horario y días: Lunes 11:00 AM figura ABIERTA (Lun a Sáb · 9:00 a. m. – 9:00 p. m.)', testResults.openMon.open === true && testResults.openMon.label.includes('Lun a Sáb'));
    ok('Horario y días: Lunes 10:00 PM figura CERRADA fuera de horario', testResults.closedMon.open === false);
    ok('Horario y días: Domingo 11:00 AM figura CERRADA porque Domingo no opera', testResults.closedSun.open === false && testResults.closedSun.label.includes('Opera Lun a Sáb'));
    ok('Resumen de horario formatea días y horas: "Lun a Sáb · 9:00 a. m. – 9:00 p. m."', testResults.summary === 'Lun a Sáb · 9:00 a. m. – 9:00 p. m.', testResults.summary);
    ok('Menú compartido: sucursal sin productos propios resuelve automáticamente todos los productos de la tienda principal', testResults.mergedFromEmptyCount === 3);
    ok('Menú compartido: si la tienda principal agrega nuevos platos, se combinan sin duplicar los ya copiados', testResults.mergedWithExistingCount === 3);
    ok('Modal Admin/Supervisor: renderiza nombre de sucursal, mapa con pin, días de operación (Lun–Sáb) y menú compartido activo',
        testResults.hasModal
        && testResults.branchNameVal === 'Sucursal Boulevard Mall Premier'
        && testResults.sameMenuChecked === true
        && JSON.stringify(testResults.checkedDays) === JSON.stringify([1, 2, 3, 4, 5, 6])
    );

    const outDir = '/workspace/mockups-pedidos-preparando';
    fs.mkdirSync(outDir, { recursive: true });
    const shotPath = path.join(outDir, '15-agregar-sucursal-admin-supervisor.png');
    await p.screenshot({ path: shotPath, fullPage: true });
    ok('Captura visual generada en ' + shotPath, fs.existsSync(shotPath));
} finally {
    await browser.close();
    srv.close();
}

let failed = 0;
for (const [st, name, detail] of R) {
    console.log(`${st}  ${name}${detail ? ` -> ${detail}` : ''}`);
    if (st !== 'PASS') failed++;
}
if (failed > 0) process.exit(1);
