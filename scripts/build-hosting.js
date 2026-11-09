/**
 * Arma la carpeta que se publica en Firebase Hosting (dist-hosting/) con JS y CSS minificados.
 *
 * - Lo corre solo `firebase deploy --only hosting` (predeploy en firebase.json), en tu PC y en GitHub Actions.
 * - El código fuente del repo NO se toca: solo la copia publicada va comprimida (≈ la mitad de peso
 *   y de tiempo de lectura en celulares lentos).
 * - Si esbuild no está instalado, publica la copia sin minificar (funciona igual, solo pesa más).
 *   Instalar:  npm install --no-save esbuild@0.24.0   (o definir ESBUILD_PATH)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-hosting');

const SKIP_TOP = new Set([
    'android', 'functions', 'whatsapp-bot', 'www', 'scripts', 'docs', 'node_modules', 'dist-hosting',
    'firebase.json', 'cors.json', 'debug_app_section.txt', 'package.json', 'package-lock.json',
    'capacitor.config.json', 'tailwind.config.js', 'firestore.rules', 'firestore.indexes.json', 'storage.rules',
]);
const skipName = (name) => name.startsWith('.') || name === 'node_modules'
    || /\.(md|jks|keystore)$/i.test(name) || /^\.env/.test(name);

function loadEsbuild() {
    const tries = [process.env.ESBUILD_PATH, 'esbuild'].filter(Boolean);
    for (const t of tries) {
        try { return require(t); } catch (_) {}
    }
    return null;
}

function copyTree(src, dst, top) {
    fs.mkdirSync(dst, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        if (skipName(ent.name)) continue;
        if (top && SKIP_TOP.has(ent.name)) continue;
        const s = path.join(src, ent.name);
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

function main() {
    fs.rmSync(OUT, { recursive: true, force: true });
    copyTree(ROOT, OUT, true);

    const esbuild = loadEsbuild();
    if (!esbuild) {
        console.warn('[build-hosting] esbuild no está instalado: se publica sin minificar.');
        return;
    }
    let before = 0;
    let after = 0;
    const minify = (file, loader) => {
        const code = fs.readFileSync(file, 'utf8');
        before += Buffer.byteLength(code);
        try {
            const res = esbuild.transformSync(code, {
                loader,
                minify: true,
                keepNames: true,          // por si algún código usa fn.name
                legalComments: 'none',
                charset: 'utf8',
                target: 'esnext',         // sin cambiar la sintaxis: solo quitar espacios y comentarios
            });
            fs.writeFileSync(file, res.code, 'utf8');
            after += Buffer.byteLength(res.code);
        } catch (e) {
            // Si un archivo no se puede minificar, se publica tal cual.
            after += Buffer.byteLength(code);
            console.warn(`[build-hosting] sin minificar ${path.relative(OUT, file)}: ${e.message.split('\n')[0]}`);
        }
    };
    listFiles(path.join(OUT, 'js'), '.js').forEach((f) => minify(f, 'js'));
    listFiles(path.join(OUT, 'css'), '.css').forEach((f) => minify(f, 'css'));
    console.log(`[build-hosting] JS+CSS: ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);
}

main();
