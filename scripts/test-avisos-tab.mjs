// Render de la pestaña «Avisos» (sin navegador). Uso: node scripts/test-avisos-tab.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join('/tmp', `vj-${Date.now()}.mjs`);
fs.writeFileSync(tmp, fs.readFileSync(path.join(ROOT, 'js', 'ops-viajes-panel.js'), 'utf8'));
globalThis.window = globalThis.window || {};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
const mod = await import(pathToFileURL(tmp).href);
const { PUSH, renderPush, pushRows, pushNudgeTargets } = mod.__test;
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
const now = Date.now();
PUSH.data = {
  generatedAtMs: now, activeWindowDays: 14, template: { name: '' }, link: 'https://honduraite.com/?activarAvisos=1#driver',
  counts: { total: 4, active: 1, expired: 2, never: 1 },
  drivers: [
    { uid: 'a', name: 'Ana', phone: '9999-0001', city: 'La Ceiba', device: 'android', status: 'active', reason: 'confirmado', lastTokenAtMs: now - 864e5, lastConfirmedAtMs: now - 3600e3, lastNudge: null, nextNudgeAtMs: null },
    { uid: 'b', name: 'Beto <b>', phone: '9999-0002', city: 'Comayagua', device: 'web', status: 'expired', reason: 'token_invalido', lastTokenAtMs: now - 30 * 864e5, lastConfirmedAtMs: null, lastNudge: { atMs: now - 3600e3, byName: 'Sup', result: 'outside_window', text: 'No se pudo: fuera de la ventana de 24 h' }, nextNudgeAtMs: null },
    { uid: 'c', name: 'Carla', phone: '9999-0003', city: 'Tegucigalpa', device: 'ios-pwa', status: 'expired', reason: 'sin_actividad', lastTokenAtMs: now - 20 * 864e5, lastConfirmedAtMs: null, lastNudge: { atMs: now - 7200e3, byName: 'Sup', result: 'sent', text: 'Enviado' }, nextNudgeAtMs: now + 20 * 3600e3 },
    { uid: 'd', name: 'Dani', phone: '', city: '', device: 'unknown', status: 'never', reason: 'nunca', lastTokenAtMs: null, lastConfirmedAtMs: null, lastNudge: null, nextNudgeAtMs: null }
  ]
};
const html = renderPush();
ok('contador «X de Y»', html.includes('1 de 4 conductores con avisos activos'));
ok('chips con conteos', html.includes('Vencidos <b>2</b>') && html.includes('Nunca activados <b>1</b>'));
ok('masivo solo a los que faltan con teléfono y sin cooldown (1)', html.includes('a todos los que faltan (1)') && pushNudgeTargets().map((d) => d.uid).join() === 'b');
ok('fallo visible por conductor', html.includes('fuera de la ventana de 24 h'));
ok('cooldown visible', html.includes('De nuevo en 20 h'));
ok('sin teléfono deshabilitado', html.includes('Sin teléfono'));
ok('activo sin botón', !/data-uid="a"/.test(html));
ok('escapa HTML', html.includes('Beto &lt;b&gt;') && !html.includes('Beto <b>'));
ok('aviso de plantilla faltante', html.includes('Sin plantilla aprobada'));
PUSH.status = 'expired'; ok('filtro estado', pushRows().map((d) => d.uid).join() === 'b,c');
PUSH.status = 'all'; PUSH.q = 'tegucigalpa'; ok('búsqueda ciudad', pushRows().map((d) => d.uid).join() === 'c');
PUSH.q = '0002'; ok('búsqueda teléfono', pushRows().map((d) => d.uid).join() === 'b');
PUSH.q = '';
for (const r of res) console.log(...r);
const all = res.every((r) => r[0] === 'PASS');
console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
fs.unlinkSync(tmp);
process.exit(all ? 0 : 1);
