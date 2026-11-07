/**
 * Mapa limpio del conductor: la tarjeta inferior reutiliza Abrir panel
 * y las reglas no tocan la pantalla del pasajero.
 *   node scripts/test-driver-map-limpio.mjs
 */
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const results = [];
const t = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'falso'); };

const html = read('../index.html');
const css = read('../css/app.css');
const floats = read('../js/floating-panels.js');
const passenger = read('../js/passenger-home.js');
const version = read('../version.json');

t('la tarjeta inferior usa el mismo Abrir panel', () => {
    const i = html.indexOf('id="driver-map-open"');
    ok(i > 0);
    const btn = html.slice(i - 80, i + 220);
    ok(/data-trip-action="show-panel"/.test(btn), btn);
    ok(/Abrir panel/.test(html));
    ok(/Clientes pidiendo viajes/.test(html));
    ok(/id="driver-map-status"/.test(html));
    ok(/id="driver-map-copa-toggle"/.test(html));
});

t('el mapa limpio solo aplica al conductor y no al pasajero', () => {
    ok(/body\.driver-mode\.panel-minimized:not\(\.trip-active\)/.test(css));
    ok(!passenger.includes('driver-map-dock'));
    ok(/#public-copa-strip,\s*\n#public-pcopa-strip \{/.test(css), 'se borró la posición de Copa del pasajero');
    const dockRule = css.split('Mapa limpio del conductor')[1] || '';
    ok(dockRule.includes('driver-map-open'), 'falta el CSS de la tarjeta');
    const fnStart = floats.indexOf('export function syncDriverMapDock');
    const fn = floats.slice(fnStart, floats.indexOf('function bindDriverMapDock'));
    ok(fnStart > 0 && fn.length > 40);
    ok(!/MutationObserver|ResizeObserver|setInterval|requestAnimationFrame/.test(fn), 'el sync observa el DOM');
});

t('la versión de publicación es .56 y la app no trae datos de ejemplo', () => {
    ok(version.includes('2026.10.26.56'));
    ok(!html.includes('L. 0.00 hoy'));
    ok(!html.includes('__HR_MOCK'));
});

t('la tarjeta queda sobre la barra de Android, gestos o 3 botones', () => {
    const dock = css.split('Mapa limpio del conductor')[1] || '';
    ok(dock.includes('--native-safe-bottom'), 'no usa el inset que inyecta MainActivity');
    ok(/capacitor-android:not\(\.native-insets-ready\) \.driver-map-dock-bottom/.test(dock));
    ok(/0\.75rem \+ 48px/.test(dock), 'falta el piso de 3 botones antes del inset');
    ok(dock.includes('position: fixed'), 'la tarjeta no se ancla al viewport');
    ok(!dock.includes('#passenger-booking') && !passenger.includes('driver-map-dock'));
});

t('el estado en línea y el conteo salen del mismo sync del radar', () => {
    const fn = floats.slice(floats.indexOf('export function syncDriverMapDock'));
    ok(fn.includes('_driverRadarOfferCount'));
    ok(fn.includes('isDriverOnlineActive'));
    ok(fn.includes('driver-copa-tray'));
    ok(floats.includes('syncDriverMapDock();'));
});

for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? `  → ${x}` : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
