/**
 * Repara mojibake UTF-8 en js/app-download.js
 * (texto tipo Â¡Nueva versiÃ³n → ¡Nueva versión)
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'js', 'app-download.js');
let t = fs.readFileSync(file, 'utf8');

const map = [
    ['â€œ', '"'],
    ['â€', '"'],
    ['â€˜', "'"],
    ['â€™', "'"],
    ['â€”', '—'],
    ['â€“', '–'],
    ['â€¦', '…'],
    ['â†’', '→'],
    ['Â·', '·'],
    ['Â«', '«'],
    ['Â»', '»'],
    ['Â¡', '¡'],
    ['Â¿', '¿'],
    ['Ã¡', 'á'],
    ['Ã©', 'é'],
    ['Ã­', 'í'],
    ['Ã³', 'ó'],
    ['Ãº', 'ú'],
    ['Ã±', 'ñ'],
    ['Ã', 'Á'],
    ['Ã‰', 'É'],
    ['Ã', 'Í'],
    ['Ã“', 'Ó'],
    ['Ãš', 'Ú'],
    ['Ã‘', 'Ñ'],
    ['Ã¼', 'ü'],
    ['Ãœ', 'Ü'],
    ['Ã¤', 'ä'],
    ['Ã¶', 'ö'],
    ['Ã§', 'ç'],
];

let total = 0;
for (const [a, b] of map) {
    if (!t.includes(a)) continue;
    const n = t.split(a).length - 1;
    t = t.split(a).join(b);
    total += n;
    console.log(`  ${n}× ${JSON.stringify(a)} → ${b}`);
}

// Casos residuales raros
const extras = [
    [/versiA3n/g, 'versión'],
    [/actualizaciA3n/g, 'actualización'],
    [/A�Nueva/g, '¡Nueva'],
    [/A¡Nueva/g, '¡Nueva'],
    [/MÃ¡s/g, 'Más'],
    [/mÃ¡s/g, 'más'],
];
for (const [re, rep] of extras) {
    if (re.test(t)) {
        t = t.replace(re, rep);
        console.log('  extra fix', re, '→', rep);
    }
}

fs.writeFileSync(file, t, 'utf8');
console.log('Total replacements:', total);
console.log('Title OK:', t.includes('¡Nueva versión disponible!'));
console.log('Ya actualicé OK:', t.includes('Ya actualicé'));
console.log('Más tarde OK:', t.includes('Más tarde'));

const remaining = t.split(/\n/).filter((l) => /Ã.|Â.|â€|â†|A3n|A¡/.test(l));
if (remaining.length) {
    console.log('Still suspicious lines:', remaining.length);
    remaining.slice(0, 12).forEach((l) => console.log(' ', l.trim().slice(0, 140)));
} else {
    console.log('No suspicious mojibake lines left.');
}
