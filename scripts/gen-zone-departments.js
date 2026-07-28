/**
 * Genera functions/zone-departments.js desde js/honduras-cities.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'js', 'honduras-cities.js');
const dest = path.join(__dirname, '..', 'functions', 'zone-departments.js');
const t = fs.readFileSync(src, 'utf8');
const re = /id:\s*"([^"]+)"[\s\S]*?department:\s*"([^"]+)"/g;
const map = {};
let m;
while ((m = re.exec(t))) {
    map[m[1]] = m[2];
}
const out =
    '/**\n' +
    ' * zoneId -> departamento (generado desde js/honduras-cities.js)\n' +
    ' * Cloud Functions: no cruzar notificaciones entre departamentos.\n' +
    ' * Regenerar: node scripts/gen-zone-departments.js\n' +
    ' */\n' +
    'module.exports = ' +
    JSON.stringify(map, null, 2) +
    ';\n';
fs.writeFileSync(dest, out);
console.log('Wrote', dest, 'entries:', Object.keys(map).length);
console.log('comayagua=', map.comayagua, 'lepaterique=', map.lepaterique, 'tegucigalpa=', map.tegucigalpa);
