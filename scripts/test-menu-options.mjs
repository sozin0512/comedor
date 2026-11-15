/**
 * Opciones de menú: tope según el tamaño, precio con extras y rechazo de un total alterado.
 * node --import ./scripts/import-query-register.mjs scripts/test-menu-options.mjs
 */
import { createRequire } from 'node:module';
import {
    groupMax, groupHint, optionDetailLine, unitPriceWithOptions, lineTotalWithOptions,
    validateOptionPicks, expectedOrderPricing, productHasOptionGroups
} from '../js/menu-options.js';

const require = createRequire(import.meta.url);
const server = require('../functions/menu-options.js');

let failed = 0;
function eq(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failed += 1;
        console.error('FAIL', name, '\n  got ', actual, '\n  want', expected);
    } else console.log('PASS', name);
}

const wings = {
    id: 'alitas-ejemplo',
    name: 'Alitas',
    basePrice: 120,
    optionGroups: [
        {
            id: 'tamano', name: 'Tamaño', min: 1, max: 1, required: true,
            options: [
                { id: '12', name: '12 alitas', priceDelta: 0, available: true },
                { id: '24', name: '24 alitas', priceDelta: 80, available: true }
            ]
        },
        {
            id: 'sabores', name: 'Sabores', min: 0, max: 2, required: false,
            maxRules: [{ whenOptionId: '24', max: 3 }],
            options: [
                { id: 'bbq', name: 'BBQ', priceDelta: 15, available: true },
                { id: 'bufalo', name: 'Búfalo', priceDelta: 15, available: true },
                { id: 'mango', name: 'Mango', priceDelta: 15, available: false }
            ]
        },
        {
            id: 'lado', name: 'Acompañamiento', min: 1, max: 1, required: true,
            options: [
                { id: 'papas', name: 'Papas', priceDelta: 20, available: true },
                { id: 'medio', name: 'Medio', priceDelta: 0, available: true }
            ]
        }
    ]
};

eq('sin grupos sigue igual', productHasOptionGroups({ name: 'Agua', price: 20 }), false);
eq('12 alitas: hasta 2 sabores', groupMax(wings.optionGroups[1], { tamano: ['12'] }), 2);
eq('24 alitas: hasta 3 sabores', groupMax(wings.optionGroups[1], { tamano: ['24'] }), 3);
eq('pista obligatorio', groupHint(wings.optionGroups[0], {}), 'Elegí 1 · Obligatorio');
eq('pista hasta 3', groupHint(wings.optionGroups[1], { tamano: ['24'] }), 'Elegí hasta 3');

const picks = { tamano: ['12'], sabores: ['bbq', 'bufalo'], lado: ['papas'] };
eq('detalle', optionDetailLine(wings, picks), '12 alitas · BBQ + Búfalo · Papas');
eq('precio con extras', unitPriceWithOptions(wings, picks), 170);
eq('dos porciones', lineTotalWithOptions(wings, picks, 2), 340);
eq('falta acompañamiento', validateOptionPicks(wings, { tamano: ['12'], sabores: ['bbq'] }).ok, false);
eq('sabor agotado no cuenta', validateOptionPicks(wings, { tamano: ['12'], sabores: ['mango'], lado: ['medio'] }).ok, true);

const products = { 'alitas-ejemplo': wings };
const good = expectedOrderPricing(products, [{ productId: 'alitas-ejemplo', qty: 1, selectedOptions: picks, basePrice: 170 }]);
eq('pedido válido', good, { ok: true, total: 170, lines: [{ productId: 'alitas-ejemplo', unit: 170, qty: 1 }] });
const tamper = expectedOrderPricing(products, [{ productId: 'alitas-ejemplo', qty: 1, selectedOptions: picks, basePrice: 120 }]);
eq('rechaza precio sin extras', tamper.ok, false);
const plain = { id: 'agua', price: 20 };
eq('producto viejo sin grupos', expectedOrderPricing({ agua: plain }, [{ productId: 'agua', qty: 2, basePrice: 20 }]).total, 40);

const serverGood = server.expectedOrderPricing(products, [{ productId: 'alitas-ejemplo', qty: 1, selectedOptions: picks, basePrice: 170 }]);
eq('servidor mismo total', serverGood, { ok: true, total: 170 });
eq('servidor rechaza trampa', server.expectedOrderPricing(products, [{ productId: 'alitas-ejemplo', qty: 1, selectedOptions: picks, basePrice: 1 }]).ok, false);
eq('servidor arma el detalle', server.optionDetail(wings, picks), '12 alitas · BBQ + Búfalo · Papas');

if (failed) {
    console.error(failed, 'fallaron');
    process.exit(1);
}
console.log('ok');
