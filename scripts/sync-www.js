/**
 * Copia los assets web de la raíz del proyecto a www/ para Capacitor.
 * Ejecutar con: npm run build:www
 */
const fs = require('fs');
const path = require('path');
const { run: injectAppVersion } = require('./inject-app-version');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const COPY_DIRS = ['css', 'js', 'icons', 'assets'];
const COPY_FILES = [
    'index.html',
    'terminos-y-condiciones.html',
    'manifest.json',
    'version.json',
    'sw.js',
    'firebase-messaging-sw.js',
];

function emptyDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        return;
    }
    for (const entry of fs.readdirSync(dir)) {
        fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
}

function copyDir(src, dest) {
    fs.cpSync(src, dest, { recursive: true });
}

function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

injectAppVersion(ROOT);

emptyDir(WWW);

for (const dir of COPY_DIRS) {
    const src = path.join(ROOT, dir);
    if (fs.existsSync(src)) {
        copyDir(src, path.join(WWW, dir));
    }
}

for (const file of COPY_FILES) {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) {
        copyFile(src, path.join(WWW, file));
    }
}

injectAppVersion(WWW);

console.log('www/ sincronizado correctamente.');