/**
 * Pruebas puras (sin red) del hotfix «no puedo poner mi origen» (fix/origen-pasajero, sobre 2026.10.16.10).
 *   node scripts/test-origen-pasajero.mjs
 * La prueba de navegador que reproduce el bug está en scripts/e2e-origen-pasajero/run.mjs.
 */
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const results = [];
const t = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'falso'); };
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Reglas CSS (selector → cuerpo) de un archivo, sin comentarios. */
function rules(css) {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    for (const src of [stripComments(css)]) while ((m = re.exec(src))) out.push([m[1].trim(), m[2]]);
    return out;
}

// 1) El input interno de origen/destino NO lleva padding a la derecha en CSS:
//    maps-init.js ya pone padding-right al propio campo (5.5rem / 52px) y los dos se sumaban.
for (const file of ['../css/qa-play.css', '../css/app.css']) {
    const bad = rules(read(file)).filter(([sel, body]) =>
        /trip-(origin|dest)-wrap[^,]*::part\(input\)/.test(sel) && /padding-(inline-end|right)\s*:|padding\s*:/.test(body));
    t(`${file.replace('../', '')}: sin padding derecho en ::part(input) de origen/destino`, () =>
        ok(bad.length === 0, bad.map(([s]) => s).join(' | ')));
}
t('qa-play.css: conserva el «…» si la dirección no cabe', () => {
    const r = rules(read('../css/qa-play.css')).find(([sel]) => /trip-origin-wrap gmp-place-autocomplete::part\(input\)/.test(sel));
    ok(r && /text-overflow:\s*ellipsis/.test(r[1]), 'falta text-overflow: ellipsis');
});
t('maps-init.js: el campo origen sigue reservando el espacio de los botones GPS y pin', () => {
    const src = read('../js/maps-init.js');
    ok(/originEl\.style\.paddingRight = hasValue \? '52px' : '5\.5rem'/.test(src), 'cambió el padding del origen en maps-init.js');
    ok(/destEl\.style\.paddingRight = '52px'/.test(src), 'cambió el padding del destino en maps-init.js');
});

// 2) Reintento del GPS al entrar a un servicio (si el del inicio de sesión falló o tardó)
t('passenger-home.js: al entrar a un servicio reintenta rellenar el origen con el GPS', () => {
    const src = read('../js/passenger-home.js');
    const i = src.indexOf('export function setPassengerHomeMode(');
    const body = src.slice(i, src.indexOf('\nexport function', i + 10));
    ok(/applyMode\(next\);[\s\S]*if \(next !== 'home'\)[\s\S]*ensurePassengerOriginFromGps/.test(body), 'no está el reintento');
});
t('app.js: ensurePassengerOriginFromGps no pisa un origen escrito ni uno borrado a propósito', () => {
    const src = read('../js/app.js');
    const i = src.indexOf('window.ensurePassengerOriginFromGps = ');
    const body = src.slice(i, i + 1500);
    ok(/_passengerOriginUserCleared\) return/.test(body), 'falta guarda de borrado a propósito');
    ok(/_passengerOriginAutofillDone\) return/.test(body), 'falta guarda de ya rellenado');
    ok(/if \(existing && !opts\.force\) return/.test(body), 'falta guarda de origen ya escrito');
    ok(/_passengerOriginAutofillBusy\) return/.test(body), 'falta guarda de GPS en curso');
});

// 3) Panel Viajes (staff): «Rango» con el mismo formato en los dos extremos
t('ops-viajes-panel.js: Rango «L. 100.00 – L. 350.00»', () => {
    const src = read('../js/ops-viajes-panel.js');
    ok(/fmtL0\(Math\.min\(\.\.\.prices\)\)\} – \$\{fmtL0\(Math\.max\(\.\.\.prices\)\)\}/.test(src), 'el máximo no usa fmtL0');
    ok(!/Math\.round\(Math\.max\(\.\.\.prices\)\)/.test(src), 'queda Math.round en el máximo');
});

for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? `  → ${x}` : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
