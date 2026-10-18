/**
 * Genera functions/service-availability-core.js (CommonJS) desde js/service-availability.js.
 * Uso: node scripts/sync-service-availability.js        (escribe)
 *      node scripts/sync-service-availability.js --check (falla si la copia está vieja)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'js', 'service-availability.js');
const OUT = path.join(ROOT, 'functions', 'service-availability-core.js');

function build() {
    const src = fs.readFileSync(SRC, 'utf8');
    const names = [];
    const body = src.replace(/^export (function|const) ([A-Za-z0-9_]+)/gm, (m, kind, name) => { names.push(name); return `${kind} ${name}`; });
    if (/^export /m.test(body)) throw new Error('export no soportado en service-availability.js');
    return `// GENERADO por scripts/sync-service-availability.js desde js/service-availability.js — no editar a mano.\n'use strict';\n${body}\nmodule.exports = { ${names.join(', ')} };\n`;
}
const next = build();
if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== next) { console.error('functions/service-availability-core.js está desactualizado: corre node scripts/sync-service-availability.js'); process.exit(1); }
    console.log('service-availability-core.js al día');
} else {
    fs.writeFileSync(OUT, next);
    console.log('escrito', path.relative(ROOT, OUT));
}
