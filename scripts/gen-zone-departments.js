/**
 * Genera functions/zone-departments.js y functions/hn-city-centers.js
 * desde js/honduras-cities.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'js', 'honduras-cities.js');
const destDept = path.join(__dirname, '..', 'functions', 'zone-departments.js');
const destCities = path.join(__dirname, '..', 'functions', 'hn-city-centers.js');
const t = fs.readFileSync(src, 'utf8');
const re = /id:\s*"([^"]+)"[\s\S]*?name:\s*"([^"]+)"[\s\S]*?department:\s*"([^"]+)"[\s\S]*?lat:\s*([-\d.]+)[\s\S]*?lng:\s*([-\d.]+)/g;
const map = {};
const cities = [];
let m;
while ((m = re.exec(t))) {
    map[m[1]] = m[3];
    cities.push({
        id: m[1],
        name: m[2],
        department: m[3],
        lat: Number(m[4]),
        lng: Number(m[5])
    });
}
const header =
    ' * Cloud Functions: no cruzar notificaciones entre departamentos.\n' +
    ' * Regenerar: node scripts/gen-zone-departments.js\n';
const outDept =
    '/**\n' +
    ' * zoneId -> departamento (generado desde js/honduras-cities.js)\n' +
    header +
    ' */\n' +
    'module.exports = ' +
    JSON.stringify(map, null, 2) +
    ';\n';
fs.writeFileSync(destDept, outDept);
const outCities =
    '/**\n' +
    ' * Ciudades HN (id, name, department, lat, lng) desde js/honduras-cities.js\n' +
    header +
    ' */\n' +
    'module.exports = ' +
    JSON.stringify(cities, null, 2) +
    ';\n';
fs.writeFileSync(destCities, outCities);
console.log('Wrote', destDept, 'entries:', Object.keys(map).length);
console.log('Wrote', destCities, 'cities:', cities.length);
console.log('comayagua=', map.comayagua, 'lepaterique=', map.lepaterique, 'tegucigalpa=', map.tegucigalpa);
