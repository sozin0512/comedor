/**
 * Con esbuild instalado (dependencia del proyecto) la publicación sale minificada.
 * Si no está, el build falla: no se publica el JS/CSS enorme.
 *   node scripts/test-hosting-minify.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { buildHosting, loadEsbuild } = require('../scripts/build-hosting.js');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = pkg.dependencies?.esbuild || pkg.devDependencies?.esbuild;
assert.ok(declared, 'esbuild tiene que estar en package.json');

const esbuild = loadEsbuild();
assert.ok(esbuild && typeof esbuild.transformSync === 'function', 'esbuild se resuelve desde el proyecto, no de un global');

const hostingSrc = fs.readFileSync(path.join(root, 'scripts', 'build-hosting.js'), 'utf8');
assert.match(hostingSrc, /process\.exit\(1\)/);
assert.equal(
    hostingSrc.includes('esbuild no está instalado: se publica sin minificar'),
    false,
    'ya no hay un aviso que sigue y publica sin minificar'
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-minify-'));
const srcRoot = path.join(tmp, 'src');
fs.mkdirSync(path.join(srcRoot, 'js'), { recursive: true });
fs.mkdirSync(path.join(srcRoot, 'css'));
const srcJs = '/* comentario que no debe publicarse */\nfunction solicitar() {\n  const mensaje = "SOLICITAR AHORA";\n  return mensaje;\n}\n';
fs.writeFileSync(path.join(srcRoot, 'js', 'app.js'), srcJs);
fs.writeFileSync(path.join(srcRoot, 'css', 'app.css'), '/* v.84 modo */\n.a { color: red; margin: 0px; }\n');
fs.writeFileSync(path.join(srcRoot, 'index.html'), '<meta name="hr-app-version" content="2026.10.26.100">');

const out = path.join(tmp, 'dist');
const sample = buildHosting({ root: srcRoot, out, esbuild });
assert.equal(sample.jsCount, 1);
assert.equal(sample.cssCount, 1);
const minJs = fs.readFileSync(path.join(out, 'js', 'app.js'), 'utf8');
assert.equal(minJs.includes('comentario que no debe publicarse'), false);
assert.equal(minJs.includes('SOLICITAR AHORA'), true, 'minificar no borra el texto del botón');
assert.ok(minJs.length < srcJs.length * 2, 'el JS minificado no se infla');
const minCss = fs.readFileSync(path.join(out, 'css', 'app.css'), 'utf8');
assert.equal(minCss.includes('v.84'), false);
assert.ok(minCss.length < fs.readFileSync(path.join(srcRoot, 'css', 'app.css'), 'utf8').length);

const missingOut = path.join(tmp, 'dist-missing');
assert.throws(
    () => buildHosting({ root: srcRoot, out: missingOut, esbuild: null }),
    (err) => err && err.code === 'ESBUILD_MISSING'
);
assert.equal(fs.existsSync(path.join(missingOut, 'js', 'app.js')), false, 'sin esbuild no queda una copia sin minificar');

fs.writeFileSync(path.join(srcRoot, 'js', 'roto.js'), 'function ( {');
const badOut = path.join(tmp, 'dist-bad');
assert.throws(
    () => buildHosting({ root: srcRoot, out: badOut, esbuild }),
    (err) => err && err.code === 'MINIFY_FAILED'
);
assert.equal(fs.existsSync(badOut), false, 'si un archivo no minifica se descarta la carpeta publicada');

const real = buildHosting({ esbuild });
assert.ok(real.after > 0);
assert.ok(real.after < real.before, 'el JS/CSS real publicado pesa menos que el fuente');
assert.ok(real.jsCount > 10);
assert.ok(real.cssCount > 3);

const srcApp = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const pubApp = fs.readFileSync(path.join(root, 'dist-hosting', 'js', 'app.js'), 'utf8');
assert.ok(pubApp.length < srcApp.length);
assert.equal(srcApp.includes('Low-end / Low-internet'), true);
assert.equal(pubApp.includes('Low-end / Low-internet'), false, 'app.js publicado va sin comentarios');
assert.equal(pubApp.includes('SOLICITAR AHORA'), true);

const srcCss = fs.readFileSync(path.join(root, 'css', 'app.css'), 'utf8');
const pubCss = fs.readFileSync(path.join(root, 'dist-hosting', 'css', 'app.css'), 'utf8');
assert.ok(pubCss.length < srcCss.length);
assert.equal(pubCss.includes('Modo liviano'), false);

const shellPub = fs.readFileSync(path.join(root, 'dist-hosting', 'js', 'shell-cache.js'), 'utf8');
const sandbox = { console, URL, URLSearchParams };
vm.createContext(sandbox);
vm.runInContext(shellPub, sandbox, { filename: 'shell-cache.js' });
const api = sandbox.HrShellCache || sandbox.self?.HrShellCache;
assert.equal(typeof api.planFetch, 'function', 'el shell-cache minificado sigue exportando el plan de caché');
assert.equal(api.shellCacheName('2026.10.26.100'), 'hr-shell-2026.10.26.100');
const publishedPlan = api.planFetch(
    { url: 'https://comedor-86278.web.app/version.json', method: 'GET' },
    'https://comedor-86278.web.app'
);
assert.equal(publishedPlan.kind, 'passthrough');

const mb = (n) => (n / 1048576).toFixed(2);
console.log(`test-hosting-minify: ok  JS+CSS ${mb(real.before)} MB → ${mb(real.after)} MB  (${real.jsCount} js, ${real.cssCount} css)`);
