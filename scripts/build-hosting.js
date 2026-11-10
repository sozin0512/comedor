/**
 * Arma la carpeta que se publica en Firebase Hosting (dist-hosting/) con JS y CSS minificados.
 *
 * - Lo corre `firebase deploy --only hosting` (predeploy en firebase.json).
 * - El código fuente del repo no se toca: solo la copia publicada va comprimida.
 * - esbuild es dependencia del proyecto (no hace falta instalarlo global).
 * - Si no está y se puede, este script lo instala. Si no puede minificar, falla:
 *   no se publica la copia enorme sin minificar.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-hosting');

const SKIP_TOP = new Set([
    'android', 'functions', 'whatsapp-bot', 'www', 'scripts', 'docs', 'node_modules', 'dist-hosting',
    'firebase.json', 'cors.json', 'debug_app_section.txt', 'package.json', 'package-lock.json',
    'capacitor.config.json', 'tailwind.config.js', 'firestore.rules', 'firestore.indexes.json', 'storage.rules',
]);
const skipName = (name) => name.startsWith('.') || name === 'node_modules'
    || /\.(md|jks|keystore)$/i.test(name) || /^\.env/.test(name);

const JS_TRANSFORM = {
    loader: 'js',
    minify: true,
    keepNames: true,          // por si algún código usa fn.name
    legalComments: 'none',
    charset: 'utf8',
    target: 'esnext',         // sin cambiar la sintaxis: solo quitar espacios y comentarios
};

const CSS_TRANSFORM = {
    loader: 'css',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
};

function esbuildVersionRange() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        return String(pkg.dependencies?.esbuild || pkg.devDependencies?.esbuild || '0.24.0');
    } catch (_) {
        return '0.24.0';
    }
}

function loadEsbuild() {
    const tries = [
        process.env.ESBUILD_PATH,
        path.join(ROOT, 'node_modules', 'esbuild'),
        'esbuild',
    ].filter(Boolean);
    for (const t of tries) {
        try { return require(t); } catch (_) {}
    }
    return null;
}

function installEsbuild() {
    const range = esbuildVersionRange();
    const pinned = range.replace(/^[\^~>=< ]+/, '');
    const spec = /^\d+\.\d+\.\d+/.test(pinned) ? `esbuild@${pinned}` : `esbuild@${range}`;
    console.log(`[build-hosting] No está esbuild. Instalando ${spec} en el proyecto (no hace falta tenerlo global)…`);
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(cmd, [
        'install',
        '--no-save',
        '--package-lock=false',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        spec,
    ], {
        cwd: ROOT,
        stdio: 'inherit',
        env: process.env,
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) return null;
    return loadEsbuild();
}

function copyTree(src, dst, top) {
    fs.mkdirSync(dst, { recursive: true });
    const dstResolved = path.resolve(dst);
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        if (skipName(ent.name)) continue;
        if (top && SKIP_TOP.has(ent.name)) continue;
        const s = path.join(src, ent.name);
        const resolved = path.resolve(s);
        // No copiar la carpeta de salida dentro de sí misma.
        if (resolved === dstResolved || resolved.startsWith(dstResolved + path.sep)) continue;
        const d = path.join(dst, ent.name);
        if (ent.isDirectory()) copyTree(s, d, false);
        else if (ent.isFile()) fs.copyFileSync(s, d);
    }
}

function listFiles(dir, ext) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...listFiles(p, ext));
        else if (ent.name.endsWith(ext)) out.push(p);
    }
    return out;
}

function minifyFile(esbuild, file, transform) {
    const code = fs.readFileSync(file, 'utf8');
    const before = Buffer.byteLength(code);
    if (!code.trim()) return { before, after: before };
    let res;
    try {
        res = esbuild.transformSync(code, transform);
    } catch (e) {
        const err = new Error(`No se pudo minificar ${file}: ${String(e && e.message || e).split('\n')[0]}`);
        err.code = 'MINIFY_FAILED';
        err.cause = e;
        throw err;
    }
    if (!res || typeof res.code !== 'string') {
        const err = new Error(`No se pudo minificar ${file}: resultado vacío`);
        err.code = 'MINIFY_FAILED';
        throw err;
    }
    fs.writeFileSync(file, res.code, 'utf8');
    return { before, after: Buffer.byteLength(res.code) };
}

/**
 * Copia `root` a `out` y minifica js/ y css/.
 * Si esbuild no viene, lanza (código ESBUILD_MISSING) y no deja una publicación sin minificar.
 */
function buildHosting({ root = ROOT, out = OUT, esbuild } = {}) {
    if (!esbuild || typeof esbuild.transformSync !== 'function') {
        const err = new Error('esbuild no está instalado. En la carpeta del proyecto corre: npm install');
        err.code = 'ESBUILD_MISSING';
        throw err;
    }
    fs.rmSync(out, { recursive: true, force: true });
    try {
        copyTree(root, out, true);
        let before = 0;
        let after = 0;
        const jsFiles = listFiles(path.join(out, 'js'), '.js');
        const cssFiles = listFiles(path.join(out, 'css'), '.css');
        for (const file of jsFiles) {
            try {
                const stats = minifyFile(esbuild, file, JS_TRANSFORM);
                before += stats.before;
                after += stats.after;
            } catch (e) {
                const err = new Error(`No se pudo minificar ${path.relative(out, file)}: ${String(e.message || e).split('\n')[0]}`);
                err.code = 'MINIFY_FAILED';
                throw err;
            }
        }
        for (const file of cssFiles) {
            try {
                const stats = minifyFile(esbuild, file, CSS_TRANSFORM);
                before += stats.before;
                after += stats.after;
            } catch (e) {
                const err = new Error(`No se pudo minificar ${path.relative(out, file)}: ${String(e.message || e).split('\n')[0]}`);
                err.code = 'MINIFY_FAILED';
                throw err;
            }
        }
        return { before, after, jsCount: jsFiles.length, cssCount: cssFiles.length, out };
    } catch (e) {
        fs.rmSync(out, { recursive: true, force: true });
        throw e;
    }
}

function main() {
    let esbuild = loadEsbuild();
    if (!esbuild && process.env.HR_SKIP_ESBUILD_INSTALL !== '1') {
        esbuild = installEsbuild();
    }
    if (!esbuild) {
        console.error('[build-hosting] Falta esbuild y no se pudo instalar. No se publica sin minificar.');
        console.error('[build-hosting] En la carpeta del proyecto corre: npm install');
        try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_) {}
        process.exit(1);
    }
    try {
        const stats = buildHosting({ esbuild });
        const mb = (n) => (n / 1048576).toFixed(2);
        console.log(`[build-hosting] JS+CSS: ${mb(stats.before)} MB → ${mb(stats.after)} MB (${stats.jsCount} js, ${stats.cssCount} css)`);
    } catch (e) {
        console.error(`[build-hosting] ${e.message}`);
        console.error('[build-hosting] No se publica sin minificar.');
        try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_) {}
        process.exit(1);
    }
}

module.exports = {
    buildHosting,
    loadEsbuild,
    installEsbuild,
    minifyFile,
    ROOT,
    OUT,
};

if (require.main === module) {
    main();
}
