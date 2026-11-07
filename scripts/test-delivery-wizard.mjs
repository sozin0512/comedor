/**
 * Tarjetas de Envío / mensajería: una pregunta a la vez.
 *   node --import ./scripts/import-query-register.mjs scripts/test-delivery-wizard.mjs
 * No toca red ni Firebase.
 */
import fs from 'node:fs';
import {
    DELIVERY_PLACE_CATEGORIES,
    advanceDeliveryWizard,
    backDeliveryStep,
    conciseDeliveryText,
    deliveryPlaceApplies,
    deliveryReviewLines,
    deliveryWizardSteps,
    editDeliveryStep,
    firstBlockingDeliveryStep,
    validateDeliveryStep,
} from '../js/delivery-wizard.js';
import { normalizeHondurasPhone } from '../js/phone-utils.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const results = [];
const t = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'falso'); };
const ids = (steps) => steps.join(',');

const filled = {
    category: 'comida',
    place: 'Pollo Campero',
    name: 'María López',
    phone: '99887766',
    details: '2 hamburguesas + papas y tortillas',
};

t('comida, pulpería y farmacia piden el lugar; documentos y otro no', () => {
    ok(DELIVERY_PLACE_CATEGORIES.join(',') === 'comida,pulperia,farmacia');
    ok(deliveryPlaceApplies('comida') && deliveryPlaceApplies('farmacia') && deliveryPlaceApplies('pulperia'));
    ok(!deliveryPlaceApplies('documentos') && !deliveryPlaceApplies('otro') && !deliveryPlaceApplies(''));
    ok(ids(deliveryWizardSteps('comida')) === 'category,place,name,phone,details,review');
    ok(ids(deliveryWizardSteps('documentos')) === 'category,name,phone,details,review');
    ok(ids(deliveryWizardSteps('otro')) === 'category,name,phone,details,review');
});

t('Siguiente avanza y el lugar vacío no pasa; saltarlo sí', () => {
    const start = { open: 'category', completed: new Set() };
    const blocked = advanceDeliveryWizard(start, { ...filled, category: '' });
    ok(blocked.error === 'Elige qué envías.' && blocked.open === 'category');
    const picked = advanceDeliveryWizard(start, filled);
    ok(!picked.error && picked.open === 'place' && picked.completed.has('category'));
    const noPlace = advanceDeliveryWizard(picked, { ...filled, place: '  ' });
    ok(noPlace.open === 'place' && /sin el nombre/.test(noPlace.error));
    const skipped = advanceDeliveryWizard(picked, { ...filled, place: '' }, { skipPlace: true });
    ok(skipped.open === 'name' && skipped.completed.has('place'));
    const named = advanceDeliveryWizard(picked, filled);
    ok(named.open === 'name' && named.completed.has('place'));
});

t('documentos salta el lugar y no borra un nombre ya escrito', () => {
    const afterCategory = advanceDeliveryWizard(
        { open: 'category', completed: new Set() },
        { ...filled, category: 'documentos', place: 'Pollo Campero' }
    );
    ok(afterCategory.open === 'name');
    ok(afterCategory.completed.has('category') && !afterCategory.completed.has('place'));
    const lines = deliveryReviewLines({ ...filled, category: 'documentos', place: 'Pollo Campero' });
    ok(!lines.some((line) => line.id === 'place'));
    ok(lines.map((line) => line.id).join(',') === 'category,name,phone,details');
});

t('cambiar a comida después pide el lugar que faltaba', () => {
    let state = { open: 'category', completed: new Set(['category', 'name', 'phone', 'details']) };
    state = advanceDeliveryWizard(state, { ...filled, category: 'comida', place: '' });
    ok(state.open === 'place', state.open);
});

t('nombre, WhatsApp y detalle usan la misma regla que al pedir', () => {
    const base = { open: 'name', completed: new Set(['category', 'place']) };
    ok(/nombre de quien recibe/.test(advanceDeliveryWizard(base, { ...filled, name: '  ' }).error));
    const phone = advanceDeliveryWizard(
        { open: 'phone', completed: new Set(['category', 'place', 'name']) },
        { ...filled, phone: '' }
    );
    ok(/WhatsApp/.test(phone.error));
    const phoneOk = advanceDeliveryWizard(
        { open: 'phone', completed: new Set(['category', 'place', 'name']) },
        filled
    );
    ok(phoneOk.open === 'details' && normalizeHondurasPhone(filled.phone) === '50499887766');
    const details = advanceDeliveryWizard(
        { open: 'details', completed: new Set(['category', 'place', 'name', 'phone']) },
        { ...filled, details: '' }
    );
    ok(/qué pediste o envías/.test(details.error));
    const review = advanceDeliveryWizard(
        { open: 'details', completed: new Set(['category', 'place', 'name', 'phone']) },
        filled
    );
    ok(review.open === 'review');
});

t('Atrás y Editar no pierden lo completado', () => {
    const state = {
        open: 'phone',
        completed: new Set(['category', 'place', 'name']),
    };
    const back = backDeliveryStep(state, 'comida');
    ok(back.open === 'name' && back.completed.has('place') && back.completed.has('name'));
    const edited = editDeliveryStep(state, 'category', 'comida');
    ok(edited.open === 'category' && edited.completed.has('phone') === false && edited.completed.has('name'));
    const blocked = editDeliveryStep(state, 'details', 'comida');
    ok(blocked.open === 'phone');
});

t('el resumen es corto y el teléfono se muestra con formato', () => {
    ok(conciseDeliveryText('123456789012345678901234567890123456789012345') .endsWith('…'));
    const lines = deliveryReviewLines(filled);
    const byId = Object.fromEntries(lines.map((line) => [line.id, line.value]));
    ok(byId.category === 'Comida de restaurante');
    ok(byId.place === 'Pollo Campero');
    ok(byId.name === 'María López');
    ok(byId.phone === '504 9988-7766', byId.phone);
    ok(byId.details.startsWith('2 hamburguesas'));
});

t('al pedir, el lugar vacío no bloquea; nombre y WhatsApp sí', () => {
    ok(firstBlockingDeliveryStep({ ...filled, place: '' }) === 'review');
    ok(firstBlockingDeliveryStep({ ...filled, name: '' }) === 'name');
    ok(firstBlockingDeliveryStep({ ...filled, phone: '' }) === 'phone');
    ok(firstBlockingDeliveryStep({ ...filled, details: '' }) === 'details');
    ok(firstBlockingDeliveryStep({ ...filled, category: '' }) === 'category');
});

t('el marcado conserva los mismos campos y no observa el DOM', () => {
    const html = read('../index.html');
    const app = read('../js/app.js');
    const wizard = read('../js/delivery-wizard.js');
    for (const id of ['delivery-category', 'delivery-restaurant', 'delivery-recipient-name', 'delivery-recipient-phone', 'delivery-package-desc']) {
        ok(html.includes(`id="${id}"`), id);
        ok(app.includes(`getElementById('${id}')`), `app.js ya no lee ${id}`);
    }
    ok(app.includes('mountDeliveryWizard'), 'no monta el asistente');
    ok(app.includes('resetDeliveryWizard'), 'el borrador no reinicia el asistente');
    ok(app.includes('revealDeliveryWizardGap'), 'al faltar datos no abre la pregunta');
    ok(!/MutationObserver|ResizeObserver|setInterval|requestAnimationFrame/.test(wizard), 'hay un observer o un bucle');
    ok(/data-trip-action="request"/.test(html), 'Solicitar envío no usa el botón de siempre');
});

for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? `  → ${x}` : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
