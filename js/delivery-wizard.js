/**
 * Preguntas de Envío / mensajería, una a la vez.
 * Los campos reales siguen siendo los mismos inputs (#delivery-*)
 * para que la tarifa, el envío de invitado y el de cuenta usen los mismos valores.
 * Sin observers ni bucles: un click, un teclado y un foco.
 */
import { DELIVERY_CATEGORIES } from './trip-experience.js?v=2026.10.26.54';
import { formatHondurasPhone, normalizeHondurasPhone } from './phone-utils.js?v=2026.10.26.54';

/** Negocio con nombre propio. Documentos y «otro» usan solo el origen. */
export const DELIVERY_PLACE_CATEGORIES = ['comida', 'pulperia', 'farmacia'];

const PLACE_COPY = {
    comida: {
        q: '¿En qué restaurante o lugar recogemos?',
        hint: 'Ej: Pollo Campero, Burger King, comedor. La dirección va en Origen.',
        placeholder: 'Restaurante o lugar (ej: Pollo Campero)',
        kicker: 'Dónde recoger',
    },
    pulperia: {
        q: '¿En qué pulpería recogemos?',
        hint: 'El nombre de la pulpería. La dirección va en Origen.',
        placeholder: 'Nombre de la pulpería',
        kicker: 'Pulpería',
    },
    farmacia: {
        q: '¿En qué farmacia recogemos?',
        hint: 'Ej: Kielsa o la farmacia de la colonia. La dirección va en Origen.',
        placeholder: 'Nombre de la farmacia',
        kicker: 'Farmacia',
    },
};

export function deliveryPlaceApplies(categoryId) {
    return DELIVERY_PLACE_CATEGORIES.includes(String(categoryId || ''));
}

export function deliveryWizardSteps(categoryId) {
    const steps = ['category'];
    if (deliveryPlaceApplies(categoryId)) steps.push('place');
    steps.push('name', 'phone', 'details', 'review');
    return steps;
}

export function deliveryCategoryById(categoryId) {
    return DELIVERY_CATEGORIES.find((c) => c.id === categoryId) || null;
}

export function conciseDeliveryText(text, max = 42) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function deliveryStepCopy(step, categoryId) {
    if (step === 'category') {
        return { q: '¿Qué envías?', hint: 'Elige una. La puedes cambiar tocando el resumen.', kicker: 'Qué envías' };
    }
    if (step === 'place') {
        return PLACE_COPY[categoryId] || PLACE_COPY.comida;
    }
    if (step === 'name') {
        return { q: '¿Quién recibe?', hint: 'Nombre de la persona en la entrega.', kicker: 'Quién recibe' };
    }
    if (step === 'phone') {
        return { q: '¿WhatsApp de quien recibe?', hint: '8 dígitos de Honduras. Ej: 9988-7766', kicker: 'WhatsApp' };
    }
    if (step === 'details') {
        const cat = deliveryCategoryById(categoryId);
        return {
            q: '¿Qué llevamos?',
            hint: cat?.placeholder || 'Comida, paquete, documentos…',
            kicker: 'Detalle',
        };
    }
    return { q: 'Revisa y pide el envío', hint: 'Toca un resumen si quieres corregir algo.', kicker: 'Revisión' };
}

/**
 * Misma regla que al pedir: nombre, WhatsApp normalizado y detalle.
 * El lugar solo se exige en «Siguiente»; «seguir sin el nombre» lo deja vacío.
 */
export function validateDeliveryStep(step, values = {}, opts = {}) {
    const category = String(values.category || '');
    if (step === 'category') {
        if (!deliveryCategoryById(category)) return 'Elige qué envías.';
        return '';
    }
    if (step === 'place') {
        if (!deliveryPlaceApplies(category)) return '';
        if (opts.skipPlace || opts.placeOptional) return '';
        if (!String(values.place || '').trim()) return 'Escribe el lugar o sigue sin el nombre.';
        return '';
    }
    if (step === 'name') {
        if (!String(values.name || '').trim()) return 'Indica el nombre de quien recibe.';
        return '';
    }
    if (step === 'phone') {
        const norm = typeof opts.normalizePhone === 'function' ? opts.normalizePhone : normalizeHondurasPhone;
        const raw = String(values.phone || '').trim();
        if (!raw || !norm(raw)) return 'Indica el WhatsApp de quien recibe.';
        return '';
    }
    if (step === 'details') {
        if (!String(values.details || '').trim()) return 'Cuéntanos qué pediste o envías.';
        return '';
    }
    return '';
}

export function deliveryStepSummary(step, values = {}, opts = {}) {
    if (step === 'category') {
        return deliveryCategoryById(values.category)?.label || '';
    }
    if (step === 'place') {
        return conciseDeliveryText(values.place, 36) || 'Sin nombre del lugar';
    }
    if (step === 'name') return conciseDeliveryText(values.name, 36);
    if (step === 'phone') {
        const fmt = typeof opts.formatPhone === 'function' ? opts.formatPhone : formatHondurasPhone;
        return fmt(values.phone) || conciseDeliveryText(values.phone, 24);
    }
    if (step === 'details') return conciseDeliveryText(values.details, 48);
    return '';
}

export function deliveryReviewLines(values = {}, opts = {}) {
    return deliveryWizardSteps(values.category)
        .filter((step) => step !== 'review')
        .map((step) => ({
            id: step,
            label: deliveryStepCopy(step, values.category).kicker,
            value: deliveryStepSummary(step, values, opts) || '—',
        }));
}

/** Primer paso que el pedido real todavía no aceptaría (el lugar no bloquea). */
export function firstBlockingDeliveryStep(values = {}, opts = {}) {
    const steps = deliveryWizardSteps(values.category).filter((step) => step !== 'review' && step !== 'place');
    for (let i = 0; i < steps.length; i += 1) {
        if (validateDeliveryStep(steps[i], values, { ...opts, placeOptional: true })) return steps[i];
    }
    return 'review';
}

export function advanceDeliveryWizard(state, values = {}, opts = {}) {
    const completed = new Set(state?.completed || []);
    const steps = deliveryWizardSteps(values.category);
    const open = steps.includes(state?.open) ? state.open : steps[0];
    if (open === 'review') return { open, completed, error: '' };
    const error = validateDeliveryStep(open, values, opts);
    if (error) return { open, completed, error };
    completed.add(open);
    const questions = steps.filter((step) => step !== 'review');
    const next = questions.find((step) => !completed.has(step)) || 'review';
    return { open: next, completed, error: '' };
}

export function backDeliveryStep(state, categoryId) {
    const steps = deliveryWizardSteps(categoryId);
    const index = steps.indexOf(state?.open);
    const prev = index > 0 ? steps[index - 1] : steps[0];
    return { open: prev, completed: new Set(state?.completed || []), error: '' };
}

export function editDeliveryStep(state, step, categoryId) {
    const steps = deliveryWizardSteps(categoryId);
    const completed = new Set(state?.completed || []);
    if (!steps.includes(step) || step === 'review' || !completed.has(step)) {
        return { open: state?.open || steps[0], completed, error: '' };
    }
    return { open: step, completed, error: '' };
}

function blankState() {
    return { open: 'category', completed: new Set() };
}

let wizardState = blankState();
let wizardBound = false;

function wizardRoot() {
    return document.getElementById('delivery-wizard');
}

export function readDeliveryWizardValues() {
    if (typeof document === 'undefined') {
        return { category: '', place: '', name: '', phone: '', details: '' };
    }
    return {
        category: document.getElementById('delivery-category')?.value || '',
        place: document.getElementById('delivery-restaurant')?.value || '',
        name: document.getElementById('delivery-recipient-name')?.value || '',
        phone: document.getElementById('delivery-recipient-phone')?.value || '',
        details: document.getElementById('delivery-package-desc')?.value || '',
    };
}

function endpointLabel(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    try {
        return String(window.readAutocompleteText?.(el) || el._routeEndpoint?.address || '').trim();
    } catch (_) {
        return '';
    }
}

function scrollIntoScroller(el) {
    const scroller = document.getElementById('panel-content');
    if (!scroller || !el) return;
    const box = scroller.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (rect.top >= box.top + 4 && rect.bottom <= box.bottom - 4) return;
    if (rect.bottom > box.bottom - 4) scroller.scrollTop += rect.bottom - box.bottom + 8;
    else if (rect.top < box.top + 4) scroller.scrollTop += rect.top - box.top - 8;
}

function revealCard(card) {
    const action = card?.querySelector?.('.dw-actions, .dw-next, .dw-request');
    scrollIntoScroller(action || card);
}

function focusOpenCard(card) {
    if (!card) return;
    const field = card.querySelector('input:not([type="hidden"]), textarea');
    const target = field || card.querySelector('.dw-next');
    try { target?.focus?.({ preventScroll: true }); } catch (_) {}
    revealCard(card);
}

function paintReview(values) {
    const list = wizardRoot()?.querySelector('[data-dw-review]');
    if (!list) return;
    const lines = deliveryReviewLines(values);
    list.replaceChildren();
    lines.forEach((line) => {
        const li = document.createElement('li');
        const k = document.createElement('span');
        k.className = 'dw-review-k';
        k.textContent = line.label;
        const v = document.createElement('span');
        v.className = 'dw-review-v';
        v.textContent = line.value;
        li.append(k, v);
        list.appendChild(li);
    });
    const origin = endpointLabel('origin-autocomplete');
    const dest = endpointLabel('destination-autocomplete');
    const route = wizardRoot()?.querySelector('[data-dw-route]');
    if (route) {
        route.textContent = (origin || dest)
            ? `Origen: ${origin || '—'} · Destino: ${dest || '—'}`
            : 'Origen y destino se eligen abajo. Con los dos se calcula la ruta y la tarifa.';
    }
    const fare = wizardRoot()?.querySelector('[data-dw-fare]');
    if (fare) {
        const quote = window.currentTripQuote;
        const price = quote && quote.serviceType === 'delivery' ? String(quote.price || '') : '';
        const km = Number(quote?.km);
        fare.textContent = price
            ? `Tarifa estimada ${price}${Number.isFinite(km) && km > 0 ? ` · ${km.toFixed(1)} km` : ''}`
            : '';
    }
}

export function renderDeliveryWizard(opts = {}) {
    const root = wizardRoot();
    if (!root) return;
    const values = readDeliveryWizardValues();
    const steps = deliveryWizardSteps(values.category);
    if (!steps.includes(wizardState.open)) {
        wizardState.open = steps.find((step) => !wizardState.completed.has(step)) || 'review';
    }
    root.querySelectorAll('[data-dw-step]').forEach((card) => {
        const step = card.getAttribute('data-dw-step');
        const inFlow = steps.includes(step);
        let mode = 'upcoming';
        if (!inFlow) mode = 'upcoming';
        else if (step === wizardState.open) mode = 'open';
        else if (wizardState.completed.has(step)) mode = 'summary';
        card.dataset.dwState = mode;
        card.hidden = mode === 'upcoming';
        const summaryBtn = card.querySelector('.dw-summary');
        const body = card.querySelector('.dw-body');
        if (summaryBtn) summaryBtn.hidden = mode !== 'summary';
        if (body) body.hidden = mode !== 'open';
        const summary = card.querySelector(`[data-dw-summary="${step}"]`);
        if (summary && mode === 'summary') summary.textContent = deliveryStepSummary(step, values) || '—';
        const err = card.querySelector(`[data-dw-error="${step}"]`);
        if (err && step !== wizardState.open) {
            err.textContent = '';
            err.classList.add('hidden');
        }
    });
    const placeCopy = deliveryStepCopy('place', values.category);
    const placeQ = root.querySelector('[data-dw-q="place"]');
    const placeHint = root.querySelector('[data-dw-hint="place"]');
    const placeKicker = root.querySelector('[data-dw-kicker="place"]');
    const placeInput = document.getElementById('delivery-restaurant');
    if (placeQ) placeQ.textContent = placeCopy.q;
    if (placeHint) placeHint.textContent = placeCopy.hint;
    if (placeKicker) placeKicker.textContent = placeCopy.kicker;
    if (placeInput && placeCopy.placeholder && document.activeElement !== placeInput) {
        placeInput.placeholder = placeCopy.placeholder;
    }
    const detailHint = root.querySelector('[data-dw-hint="details"]');
    if (detailHint) detailHint.textContent = deliveryStepCopy('details', values.category).hint;
    const desc = document.getElementById('delivery-package-desc');
    const cat = deliveryCategoryById(values.category);
    if (desc && cat && !desc.value.trim() && document.activeElement !== desc) desc.placeholder = cat.placeholder;
    if (wizardState.open === 'review') paintReview(values);
    const openCard = root.querySelector(`[data-dw-step="${wizardState.open}"]`);
    if (opts.focus) focusOpenCard(openCard);
    else if (opts.reveal) revealCard(openCard);
}

function showStepError(step, message) {
    const err = wizardRoot()?.querySelector(`[data-dw-error="${step}"]`);
    if (!err) return;
    err.textContent = message || '';
    err.classList.toggle('hidden', !message);
}

function applyTransition(next) {
    wizardState = { open: next.open, completed: next.completed };
    showStepError(next.open, next.error);
    renderDeliveryWizard({ focus: !next.error, reveal: true });
}

function onWizardClick(event) {
    const root = wizardRoot();
    if (!root) return;
    const skip = event.target.closest?.('[data-dw-skip]');
    const nextBtn = event.target.closest?.('[data-dw-next]');
    const backBtn = event.target.closest?.('[data-dw-back]');
    const editBtn = event.target.closest?.('[data-dw-edit]');
    if (!skip && !nextBtn && !backBtn && !editBtn) return;
    if (!root.contains(skip || nextBtn || backBtn || editBtn)) return;
    const values = readDeliveryWizardValues();
    if (skip) {
        event.preventDefault();
        applyTransition(advanceDeliveryWizard(wizardState, values, { skipPlace: true }));
        return;
    }
    if (nextBtn) {
        event.preventDefault();
        applyTransition(advanceDeliveryWizard(wizardState, values));
        return;
    }
    if (backBtn) {
        event.preventDefault();
        applyTransition(backDeliveryStep(wizardState, values.category));
        return;
    }
    if (editBtn) {
        event.preventDefault();
        applyTransition(editDeliveryStep(wizardState, editBtn.getAttribute('data-dw-edit'), values.category));
    }
}

function onWizardKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const field = event.target;
    if (!field || field.tagName === 'TEXTAREA') return;
    if (field.tagName !== 'INPUT') return;
    const card = field.closest?.('[data-dw-step]');
    if (!card || card.dataset.dwState !== 'open') return;
    event.preventDefault();
    applyTransition(advanceDeliveryWizard(wizardState, readDeliveryWizardValues()));
}

function onWizardFocusIn(event) {
    const field = event.target;
    if (!field?.closest || !field.matches?.('input, textarea')) return;
    const card = field.closest('[data-dw-step]');
    if (!card || card.dataset.dwState !== 'open') return;
    scrollIntoScroller(field);
}

export function mountDeliveryWizard() {
    if (typeof document === 'undefined') return;
    const root = wizardRoot();
    if (!root || wizardBound) {
        renderDeliveryWizard();
        return;
    }
    wizardBound = true;
    root.addEventListener('click', onWizardClick);
    root.addEventListener('keydown', onWizardKeyDown);
    root.addEventListener('focusin', onWizardFocusIn);
    renderDeliveryWizard();
}

export function resetDeliveryWizard() {
    wizardState = blankState();
    if (typeof document === 'undefined') return;
    ['delivery-category', 'delivery-restaurant', 'delivery-recipient-name', 'delivery-recipient-phone', 'delivery-package-desc']
        .forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    document.querySelectorAll('.delivery-cat-chip').forEach((btn) => {
        btn.classList.remove('bg-amber-500', 'text-white', 'border-amber-500');
        btn.setAttribute('aria-pressed', 'false');
    });
    wizardRoot()?.querySelectorAll('[data-dw-error]').forEach((err) => {
        err.textContent = '';
        err.classList.add('hidden');
    });
    renderDeliveryWizard();
}

export function revealDeliveryWizardGap() {
    const values = readDeliveryWizardValues();
    const step = firstBlockingDeliveryStep(values);
    wizardState = { open: step, completed: wizardState.completed };
    if (step === 'review') {
        deliveryWizardSteps(values.category).forEach((id) => {
            if (id !== 'review') wizardState.completed.add(id);
        });
    }
    renderDeliveryWizard({ focus: true, reveal: true });
}

export function syncDeliveryWizard() {
    renderDeliveryWizard({ reveal: wizardState.open === 'review' });
}

if (typeof window !== 'undefined') {
    window.mountDeliveryWizard = mountDeliveryWizard;
    window.resetDeliveryWizard = resetDeliveryWizard;
    window.revealDeliveryWizardGap = revealDeliveryWizardGap;
    window.syncDeliveryWizard = syncDeliveryWizard;
    window.onDeliveryCategoryPicked = () => {
        if (wizardState.open === 'category') showStepError('category', '');
        renderDeliveryWizard();
    };
}
