/**
 * La hoja Viaje ya no tiene la fila «2 Más opciones» (no abre al tocarla).
 *   node scripts/test-viaje-sin-mas-opciones.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyTripSheetAdvancedVisibility,
    tripSheetAdvancedVisibility,
} from '../js/trip-sheet-advanced.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const html = read('index.html');
const css = read('css/app.css');
const app = read('js/app.js');
const home = read('js/passenger-home.js');

function slice(from, to) {
    const i = html.indexOf(from);
    const j = html.indexOf(to, i + from.length);
    assert.ok(i >= 0 && j > i, `no se encontró ${from} … ${to}`);
    return html.slice(i, j);
}

const sheet = slice('id="passenger-booking-route"', 'id="searching-state"');
const whenCard = slice('id="passenger-booking-when"', 'id="passenger-booking-request"');
const route = slice('id="passenger-booking-route"', 'id="passenger-booking-advanced"');

assert.doesNotMatch(sheet, /Más opciones/i, 'la hoja Viaje no dice Más opciones');
assert.doesNotMatch(sheet, /id="trip-advanced-toggle"/, 'no queda el botón del acordeón');
assert.doesNotMatch(sheet, /trip-step-badge--muted/, 'no queda el número 2 de Más opciones');
assert.doesNotMatch(html, /id="trip-advanced-toggle"/);
assert.equal((html.match(/id="trip-options-panel"/g) || []).length, 1);
assert.equal((html.match(/id="trip-hourly-toggle"/g) || []).length, 1);
assert.equal((html.match(/id="trip-third-party-toggle"/g) || []).length, 1);

assert.match(route, /id="origin-autocomplete"/);
assert.match(route, /id="destination-autocomplete"/);
assert.match(route, /id="add-extra-stop-btn"/);
assert.match(route, /id="favorites-bar"/);
assert.match(route, /Casa/);
assert.match(route, /Trabajo/);
assert.match(home, />\s*Cambiar\s*</);

assert.match(whenCard, /id="trip-when-adder"/);
assert.ok(whenCard.indexOf('id="trip-options-panel"') > whenCard.indexOf('id="trip-when-adder"'));
assert.ok(whenCard.indexOf('id="trip-when-adder"') < whenCard.indexOf('id="trip-hourly-toggle"'));
assert.equal(sheet.includes('id="trip-options-panel"'), false, 'la hoja de origen no lleva el bloque opcional');
assert.match(whenCard, /id="trip-third-party-toggle"/);
assert.match(whenCard, /id="trip-hourly-toggle"/);
assert.match(whenCard, /id="trip-schedule-toggle"/);
assert.match(whenCard, /id="add-when-btn"/);
assert.doesNotMatch(whenCard, /Más opciones/i);

assert.match(sheet, /id="freight-cargo-desc"/);
assert.match(sheet, /id="freight-notes"/);
assert.match(sheet, /id="tow-vehicle-desc"/);
assert.match(sheet, /id="tow-vehicle-photo-input"/);
assert.match(sheet, /id="delivery-details-panel"/);
assert.match(html, /SOLICITAR AHORA|PEDIR EL VIAJE/);
assert.match(app, /SOLICITAR AHORA/);

assert.match(css, /#trip-advanced-toggle\s*\{[^}]*display:\s*none\s*!important/);
assert.match(css, /#passenger-booking-advanced:not\(:has\(#delivery-details-panel:not\(\.hidden\)\)\)/);

const version = JSON.parse(read('version.json'));
assert.equal(version.version, '2026.10.26.100');
assert.match(read('js/config.js'), /appVersion:\s*'2026\.10\.26\.100'/);
assert.match(read('manifest.json'), /"version":\s*"2026\.10\.26\.100"/);

assert.equal(tripSheetAdvancedVisibility('auto').masOpciones, false);
assert.equal(tripSheetAdvancedVisibility('moto').masOpciones, false);
assert.equal(tripSheetAdvancedVisibility('taxi').options, true);
assert.equal(tripSheetAdvancedVisibility('auto').freight, false);
assert.equal(tripSheetAdvancedVisibility('flete_paila').freight, true);
assert.equal(tripSheetAdvancedVisibility('flete_camion').freight, true);
assert.equal(tripSheetAdvancedVisibility('delivery').delivery, true);
assert.equal(tripSheetAdvancedVisibility('grua').tow, false, 'la grúa no lee esos campos en el pedido');

function fakeEl(id, className = '') {
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    return {
        id,
        classList: {
            toggle(name, force) {
                if (force === true) classes.add(name);
                else if (force === false) classes.delete(name);
                else if (classes.has(name)) classes.delete(name);
                else classes.add(name);
                return classes.has(name);
            },
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); },
            contains(name) { return classes.has(name); },
        },
        setAttribute() {},
        get hiddenClasses() { return classes; },
    };
}

function fakeDoc(extra = {}) {
    const nodes = {
        'trip-advanced-body': fakeEl('trip-advanced-body', 'trip-advanced-body hidden'),
        'trip-advanced-toggle': fakeEl('trip-advanced-toggle', 'trip-advanced-toggle'),
        'trip-options-panel': fakeEl('trip-options-panel', 'trip-advanced-block'),
        'freight-details-panel': fakeEl('freight-details-panel', 'hidden freight-panel'),
        'tow-details-panel': fakeEl('tow-details-panel', 'hidden tow-panel'),
        'delivery-details-panel': fakeEl('delivery-details-panel', 'hidden delivery-panel'),
        ...extra,
    };
    return {
        getElementById(id) { return nodes[id] || null; },
        nodes,
    };
}

function shown(doc, id) {
    return !doc.nodes[id].classList.contains('hidden');
}

const viaje = fakeDoc();
const viajeVis = applyTripSheetAdvancedVisibility(viaje, 'auto');
assert.equal(viajeVis.masOpciones, false);
assert.equal(shown(viaje, 'trip-options-panel'), true, 'otra persona y por horas siguen en el DOM');
assert.equal(shown(viaje, 'freight-details-panel'), false);
assert.equal(shown(viaje, 'tow-details-panel'), false);
assert.equal(shown(viaje, 'delivery-details-panel'), false);
assert.equal(viaje.nodes['trip-advanced-body'].classList.contains('hidden'), false);
assert.equal(viaje.nodes['trip-advanced-toggle'].classList.contains('hidden'), true, 'si quedara el botón, no es un toque');

const flete = fakeDoc();
applyTripSheetAdvancedVisibility(flete, 'flete_camion');
assert.equal(shown(flete, 'freight-details-panel'), true, 'el flete se ve sin abrir un acordeón');
assert.equal(shown(flete, 'trip-options-panel'), true);

const envio = fakeDoc();
applyTripSheetAdvancedVisibility(envio, 'delivery');
assert.equal(shown(envio, 'delivery-details-panel'), true);
assert.equal(shown(envio, 'freight-details-panel'), false);

assert.doesNotMatch(app, /trip-advanced-toggle'\)[\s\S]{0,180}addEventListener\('click'/);
assert.match(app, /applyTripSheetAdvancedVisibility\(document,/);
assert.doesNotMatch(home, /Más opciones/);

console.log('ok viaje sin más opciones');
