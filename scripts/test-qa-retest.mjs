/**
 * Pruebas puras (sin red) del re-test QA del 2026-10-18 (fix/qa-retest-1).
 *   node scripts/test-qa-retest.mjs
 */
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const results = [];
const t = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'falso'); };
/** Saca una función de nivel superior del archivo (sin importar el módulo entero, que necesita navegador). */
function grab(src, name) {
    const i = src.indexOf(`function ${name}(`);
    if (i < 0) throw new Error(`no está ${name}`);
    let depth = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
    }
    throw new Error(`sin cierre ${name}`);
}
const constLine = (src, name) => (src.match(new RegExp(`^const ${name} = .*;$`, 'm')) || [''])[0];

// 1) Moneda: panel de Viajes del staff (se prueba suelto, sin window.formatLempiras = usa el respaldo local)
const ops = read('../js/ops-viajes-panel.js');
const fmtL = new Function(`${grab(ops, 'fmtL')}; return fmtL;`)();
t('Viajes staff: 83 → L. 83.00', () => eq(fmtL(83), 'L. 83.00'));
t('Viajes staff: 174.2 → L. 174.20', () => eq(fmtL(174.2), 'L. 174.20'));
t('Viajes staff: miles con coma', () => eq(fmtL(1234), 'L. 1,234.00'));
t('Viajes staff: fmtL0 = fmtL (ya no hay 0 decimales)', () => ok(/const fmtL0 = fmtL;/.test(ops)));

// 1) Moneda: Copa conductores / pasajeros
for (const f of ['driver', 'passenger']) {
    const src = read(`../js/${f}-global-challenges.js`);
    const fn = new Function('formatLempiras', `${grab(src, 'formatLps')}; ${grab(src, 'rewardText')}; return { formatLps, rewardText };`)(
        (n) => `${n < 0 ? '-' : ''}L. ${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    t(`Copa ${f}: formatLps usa formatLempiras`, () => ok(/formatLempiras\(Number\(n\) \|\| 0\)/.test(grab(src, 'formatLps'))));
    t(`Copa ${f}: import de money-format`, () => ok(/import \{ formatLempiras \} from '\.\/money-format\.js'/.test(src)));
    t(`Copa ${f}: 83 → L. 83.00`, () => eq(fn.formatLps(83), 'L. 83.00'));
    t(`Copa ${f}: premio en texto libre`, () => eq(fn.rewardText('L. 1500 — Campeón'), 'L. 1,500.00 — Campeón'));
    t(`Copa ${f}: sin toFixed(0) junto a L.`, () => ok(!/L\. ?\$\{[^}]*toFixed\(0\)/.test(src)));
}

// 4) Nombres de prueba / en blanco en el panel de Viajes
const cleanSrc = [constLine(ops, 'NAME_INVISIBLE'), constLine(ops, 'NAME_PLACEHOLDER'), grab(ops, 'cleanName')].join('\n');
const cleanName = new Function(`${cleanSrc}; return cleanName;`)();
t('Viajes staff: relleno coreano = vacío', () => eq(cleanName('\u3164'), ''));
t('Viajes staff: HonduRaite = vacío', () => eq(cleanName('HonduRaite'), ''));
t('Viajes staff: Pasajero de prueba = vacío', () => eq(cleanName('Pasajero de prueba'), ''));
t('Viajes staff: nombre real intacto', () => eq(cleanName('  María  López '), 'María López'));
t('Viajes staff: mismos filtros que display-name.js', () => {
    const dn = read('../js/display-name.js');
    const inv = (s, n) => (s.match(new RegExp(`${n} = (/.*/g?);`)) || [])[1];
    eq(inv(ops, 'NAME_INVISIBLE'), inv(dn, 'INVISIBLE'));
    eq(inv(ops, 'NAME_PLACEHOLDER'), inv(dn, 'PLACEHOLDER'));
});
t('Viajes staff: clientName/driverName pasan por tripPersonName', () => {
    ok(/const clientName = \(t\) => tripPersonName\(t, 'client'\);/.test(ops));
    ok(/const driverName = \(t\) => tripPersonName\(t, 'driver'\);/.test(ops));
});

// 6) «Calificar (staff)»
const app = read('../js/app.js');
t('ya no dice «Calificar (staff)»', () => ok(!/Calificar \(staff\)/.test(app) && !/Calificar \(staff\)/.test(read('../js/app-staff.js'))));

// 2) Manifest
const man = JSON.parse(read('../manifest.json'));
t('manifest: nombre/short_name/descripción sin «comedor»', () => ok(!/comedor/i.test(`${man.name} ${man.short_name} ${man.description}`)));
t('manifest: related_applications conserva el origen del APK', () => ok(man.related_applications.some((a) => /comedor-86278\.web\.app/.test(a.url))));

// 3) Banner «Pantalla de inicio» fuera del panel
const html = read('../index.html');
t('banner fuera de #control-panel', () => {
    const b = html.indexOf('id="ios-install-banner"');
    const cp = html.indexOf('id="control-panel"');
    const map = html.indexOf('id="map-container"');
    ok(b > 0 && b < map && map < cp, `banner ${b} map ${map} panel ${cp}`);
});
const css = read('../css/qa-play.css');
t('banner flota (absolute, z-index menor que el panel)', () => ok(/#ios-install-banner\.hr-install-float \{[^}]*position: absolute;[^}]*z-index: 40;/s.test(css)));

// 5) Verificaciones: sin cortes a mitad de palabra
t('KPI: sin overflow-wrap:anywhere', () => ok(!/overflow-wrap:\s*anywhere/.test(css)));
t('KPI: word-break keep-all', () => ok(/\.ops-kpi-label \{[^}]*word-break: keep-all;/s.test(css)));

// 7) Enlaces legales en el login
t('login: enlaces a Privacidad y Términos', () => {
    const i = html.indexOf('id="login-screen"');
    const j = html.indexOf('</div>\n\n', html.indexOf('id="login-legal-links"'));
    const block = html.slice(i, j);
    ok(/href="politica-de-privacidad\.html"/.test(block), 'privacidad');
    ok(/href="terminos-y-condiciones\.html"/.test(block), 'términos');
});

let fail = 0;
for (const r of results) { if (r[0] === 'FAIL') fail++; console.log(r.join(' | ')); }
console.log(`${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
