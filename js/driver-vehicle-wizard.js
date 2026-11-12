/**
 * Asistente paso a paso para registrar o actualizar el vehículo del conductor.
 * Misma data, fotos y aprobación de siempre, más año, aire, asientos y categoría sugerida.
 */
import {
    BRAND_CHIPS, SEAT_CHIPS, VEHICLE_TYPES,
    vehicleTypeMeta, parseYearFromVehicleText, suggestRideCategory, rideCategoryLabel,
    splitBrandAndModel, composeVehicleModel, vehiclePhotoSlots, documentRows,
    readComfort, normalizeCutoffs, isPlausibleVehicleYear, buildApprovedComfortPatch,
    shouldAskVehicleUpdate, UPDATE_SNOOZE_MS, DEFAULT_RIDE_CUTOFFS, currentYear,
    yearChoices, placeYear, registrationChecklist
} from './vehicle-categories.js';
import { isValidTaxiPlate } from './service-types.js';
import { isUsMarket } from './market.js';

const DRAFT_PREFIX = 'hr-vehicle-wizard-draft-v1:';
const SNOOZE_PREFIX = 'hr-vehicle-update-snooze:';
const CSS_ID = 'hr-vehicle-wizard-css';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function uidOf(profile) {
    return profile?.uid || window.currentUser?.uid || 'local';
}

export function draftKey(profile) {
    return DRAFT_PREFIX + uidOf(profile);
}

export function readDraft(profile) {
    try {
        const raw = localStorage.getItem(draftKey(profile));
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

export function writeDraft(profile, state) {
    try {
        const copy = { ...state, photos: { ...(state.photos || {}) } };
        localStorage.setItem(draftKey(profile), JSON.stringify(copy));
        return true;
    } catch (_) {
        try {
            const slim = { ...state, photos: {} };
            localStorage.setItem(draftKey(profile), JSON.stringify(slim));
        } catch (_) {}
        return false;
    }
}

export function clearDraft(profile) {
    try { localStorage.removeItem(draftKey(profile)); } catch (_) {}
}

function snoozeKey(profile) {
    return SNOOZE_PREFIX + uidOf(profile);
}

export function readSnoozeUntil(profile) {
    try { return Number(localStorage.getItem(snoozeKey(profile))) || 0; } catch (_) { return 0; }
}

export function snoozeVehicleUpdate(profile, now = Date.now()) {
    const until = now + UPDATE_SNOOZE_MS;
    try { localStorage.setItem(snoozeKey(profile), String(until)); } catch (_) {}
    return until;
}

function ensureCss() {
    if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = new URL('../css/vehicle-wizard.css', import.meta.url).href;
    document.head.appendChild(link);
}

function blankState(profile, mode) {
    const vehicle = profile?.vehicle || {};
    const split = splitBrandAndModel(vehicle.model || '');
    const textYear = parseYearFromVehicleText(`${vehicle.model || ''} ${vehicle.brand || ''}`);
    const saved = readComfort(profile);
    const year = saved.confirmed && saved.year ? saved.year : textYear;
    return {
        step: 1,
        type: VEHICLE_TYPES.includes(profile?.vehicleType) ? profile.vehicleType : (vehicle.type || 'auto'),
        brand: split.brand || '',
        brandOther: split.brandOther || '',
        model: split.model || '',
        plate: vehicle.plate || '',
        cargo: vehicle.cargoCapacity || '',
        year: year || null,
        yearOther: placeYear(year).other,
        hasAC: saved.hasAC,
        seats: SEAT_CHIPS.includes(saved.seats) ? saved.seats : null,
        photos: {},
        licenseNumber: vehicle.license || profile?.license || '',
        inspection: vehicle.inspection && vehicle.inspection !== 'Sin especificar' ? vehicle.inspection : '',
        penCode: profile?.documentsPhotos?.penCode || '',
        policialesCode: profile?.documentsPhotos?.policialesCode || '',
        name: profile?.name || '',
        phone: profile?.phone || '',
        emergency: profile?.emergencyContact || '',
        dni: profile?.identity && profile.identity !== 'N/D' ? profile.identity : '',
        gender: profile?.gender || '',
        birthDate: profile?.birthDate || '',
        referral: '',
        mode
    };
}

function totalSteps(mode) {
    return mode === 'update' ? 2 : 5;
}

function stepName(step, mode) {
    if (mode === 'update') return step === 1 ? 'Tu vehículo' : 'Año y comodidad';
    return ['', 'Tu vehículo', 'Año y comodidad', 'Fotos del carro', 'Documentos', 'Tu foto y enviar'][step] || '';
}

function photoNoun(type) {
    if (type === 'moto') return 'de la moto';
    if (type === 'taxi') return 'del taxi';
    if (type === 'paila') return 'de la paila';
    if (type === 'camion') return 'del camión';
    if (type === 'grua') return 'de la grúa';
    return 'del carro';
}

export function mountDriverVehicleWizard(host, options = {}) {
    ensureCss();
    const mode = options.mode === 'update' ? 'update' : 'register';
    const profile = options.profile || {};
    const cutoffs = normalizeCutoffs(options.cutoffs);
    const draft = options.ignoreDraft ? null : readDraft(profile);
    const state = { ...blankState(profile, mode), ...(draft && draft.mode === mode ? draft : {}) };
    if (options.initialStep) state.step = options.initialStep;
    if (options.seed) Object.assign(state, options.seed, { photos: { ...state.photos, ...(options.seed.photos || {}) } });
    state.mode = mode;
    const max = totalSteps(mode);
    state.step = Math.max(1, Math.min(max, Number(state.step) || 1));

    const root = document.createElement('div');
    root.className = 'vw-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    host.appendChild(root);

    let error = '';
    const preview = options.preview === true;

    function persist() {
        if (!preview) writeDraft(profile, state);
    }

    function categoryNow() {
        return suggestRideCategory({
            type: state.type,
            year: state.year,
            hasAC: state.hasAC === true,
            seats: state.seats,
            cutoffs
        });
    }

    function categoryLine() {
        if (state.type === 'paila' || state.type === 'camion' || state.type === 'grua') {
            return 'Categoría de raite: no aplica (es flete). Igual guardamos año, aire y asientos.';
        }
        const id = categoryNow();
        return `Categoría: ${id ? rideCategoryLabel(id) : 'Elegí año, aire y asientos'}`;
    }

    function render() {
        const step = state.step;
        const total = totalSteps(mode);
        const title = step === 3 ? `Fotos ${photoNoun(state.type)}` : stepName(step, mode);
        const last = step === total;
        const blue = step === 1 && !last;
        const btn = mode === 'update' && last ? 'Guardar' : (last ? 'Enviar para aprobación' : 'Siguiente');
        const report = registrationChecklist(state, { cutoffs });
        const blocked = last && (mode === 'register' ? !report.canSubmit : !report.canSaveUpdate);
        root.innerHTML = `
            <header class="vw-top">
                <div class="vw-top-row">
                    <button type="button" class="vw-back" data-vw="back" aria-label="Atrás"><i class="fas fa-arrow-left"></i></button>
                    <div class="vw-brand"><b>Hondu</b><i>Raite</i></div>
                    <button type="button" class="vw-help" data-vw="help" aria-label="Ayuda">?</button>
                </div>
                <p class="vw-step-title">Paso ${step} de ${total} · ${esc(title)}</p>
                ${progressHtml(step, total)}
            </header>
            <div class="vw-scroll">${bodyHtml(step)}</div>
            <footer class="vw-dock">
                ${error ? `<p class="vw-error">${esc(error)}</p>` : ''}
                <button type="button" class="vw-next ${blue ? 'is-blue' : 'is-orange'}" data-vw="next" ${blocked ? 'disabled' : ''}>${esc(btn)}</button>
                ${last && mode === 'register' ? '<p class="vw-foot-note">Un supervisor revisará tus datos.</p>' : ''}
            </footer>`;
        bind();
        const selectedYear = root.querySelector('.vw-years .vw-chip.is-on');
        const yearBox = root.querySelector('.vw-years');
        if (selectedYear && yearBox) {
            yearBox.scrollTop = Math.max(0, selectedYear.offsetTop - yearBox.offsetTop - 4);
        }
    }

    function progressHtml(step, total) {
        if (total > 3) {
            const pct = Math.round((step / total) * 100);
            return `<div class="vw-progress"><div class="vw-progress-track"><span style="width:${pct}%"></span></div><strong>${step}/${total}</strong></div>`;
        }
        let html = '<div class="vw-dots">';
        for (let i = 1; i <= total; i++) {
            if (i > 1) html += `<div class="vw-dot-line ${i <= step ? 'is-on' : ''}"></div>`;
            const cls = i < step ? 'is-done' : i === step ? 'is-on' : '';
            html += `<div class="vw-dot ${cls}">${i < step ? '✓' : i}</div>`;
        }
        html += '</div>';
        return html;
    }

    function bodyHtml(step) {
        if (step === 1) return stepType();
        if (step === 2) return stepComfort();
        if (step === 3) return stepPhotos();
        if (step === 4) return stepDocs();
        return stepSend();
    }

    function stepType() {
        const types = VEHICLE_TYPES.filter((t) => !(t === 'taxi' && !preview && isUsMarket()));
        return `
            <h3 class="vw-q">¿Qué tipo de vehículo usás?</h3>
            <div class="vw-types">
                ${types.map((t) => {
                    const m = vehicleTypeMeta(t);
                    const icon = m.icon.startsWith('icon-') ? m.icon : `fas ${m.icon}`;
                    return `<button type="button" class="vw-type ${state.type === t ? 'is-on' : ''}" data-type="${t}"><i class="${icon}"></i><span>${esc(m.label)}</span></button>`;
                }).join('')}
            </div>
            <p class="vw-label">Marca</p>
            <div class="vw-chips">
                ${BRAND_CHIPS.map((b) => `<button type="button" class="vw-chip ${state.brand === b ? 'is-on' : ''}" data-brand="${esc(b)}">${esc(b)}</button>`).join('')}
            </div>
            ${state.brand === 'Otra' ? `<p class="vw-label">¿Cuál marca?</p><input class="vw-field" data-field="brandOther" value="${esc(state.brandOther)}" placeholder="Escribí la marca">` : ''}
            <p class="vw-label">Modelo</p>
            <label class="vw-model"><i class="fas fa-car-side"></i><input data-field="model" value="${esc(state.model)}" placeholder="Modelo: Corolla"></label>
            <p class="vw-label">Placa</p>
            <input class="vw-field" data-field="plate" value="${esc(state.plate)}" placeholder="${state.type === 'taxi' ? 'Placa T- (ej. T-1234)' : 'Placa'}" autocapitalize="characters">
            ${(state.type === 'paila' || state.type === 'camion' || state.type === 'grua')
                ? `<p class="vw-label">Capacidad de carga</p><input class="vw-field" data-field="cargo" value="${esc(state.cargo)}" placeholder="Ej. 1.5 ton">`
                : ''}`;
    }

    function stepComfort() {
        const placed = placeYear(state.year);
        const years = yearChoices();
        return `
            <h3 class="vw-q">¿De qué año es tu vehículo?</h3>
            <div class="vw-years" role="listbox" aria-label="Año del vehículo">
                ${years.map((y) => `<button type="button" class="vw-chip ${placed.grid === y ? 'is-on' : ''}" data-year="${y}">${y}</button>`).join('')}
            </div>
            <p class="vw-label">Otro (antes de ${years[0] || 1995})</p>
            <input class="vw-field" data-field="yearOther" inputmode="numeric" maxlength="4" value="${esc(placed.other || state.yearOther || '')}" placeholder="Otro año">
            <p class="vw-label">¿Tiene aire acondicionado?</p>
            <div class="vw-ac">
                <div class="vw-ac-q"><i class="fas fa-snowflake"></i> ¿Tiene aire?</div>
                <div class="vw-seg">
                    <button type="button" data-ac="1" class="${state.hasAC === true ? 'is-on' : ''}">Sí</button>
                    <button type="button" data-ac="0" class="${state.hasAC === false ? 'is-on' : ''}">No</button>
                </div>
            </div>
            <p class="vw-label">¿Cuántos asientos tiene?</p>
            <div class="vw-seats">
                ${SEAT_CHIPS.map((n) => `<button type="button" class="vw-seat ${Number(state.seats) === n ? 'is-on' : ''}" data-seats="${n}">${n}</button>`).join('')}
            </div>
            <div class="vw-cat"><i class="fas fa-check-circle"></i> ${esc(categoryLine())}</div>`;
    }

    function stepPhotos() {
        const slots = vehiclePhotoSlots(state.type);
        const done = slots.filter((s) => state.photos[s.slot]).length;
        return `
            <h3 class="vw-q">Fotos ${esc(photoNoun(state.type))}</h3>
            <p class="vw-hint">Tocá cada cuadro y tomá la foto.</p>
            <div class="vw-grid">
                ${slots.map((s) => tileHtml(s)).join('')}
            </div>
            <p class="vw-count">${done} de ${slots.length} listas</p>`;
    }

    function tileHtml(s) {
        const src = state.photos[s.slot];
        const icon = s.icon?.startsWith('icon-') ? s.icon : `fas ${s.icon || 'fa-camera'}`;
        return `<button type="button" class="vw-tile ${src ? 'is-done' : ''}" data-photo="${esc(s.slot)}">
            ${src && String(src).startsWith('data:') ? `<img alt="" src="${src}">` : `<i class="${icon} vw-cam"></i>`}
            <span>${esc(s.label)}</span>
            ${src ? '<i class="vw-check fas fa-check"></i>' : ''}
        </button>`;
    }

    function stepDocs() {
        const rows = documentRows();
        const done = rows.filter((r) => docReady(r)).length;
        return `
            <h3 class="vw-q">Documentos</h3>
            <p class="vw-hint">Una fila por documento. Código y foto, nítidos y vigentes.</p>
            ${rows.map((r) => {
                const ready = docReady(r);
                const code = r.codeKey
                    ? `<label class="vw-code-label">${esc(r.codeLabel)}<input data-field="${esc(r.codeKey)}" value="${esc(state[r.codeKey] || '')}" placeholder="${esc(r.codeLabel)}"></label>`
                    : '';
                return `<div class="vw-doc ${ready ? 'is-done' : ''}">
                    <button type="button" class="vw-doc-ico" data-photo="${esc(r.slot)}" aria-label="Tomar foto"><i class="fas fa-camera"></i></button>
                    <div class="vw-doc-main"><strong>${esc(r.label)}</strong>${code}</div>
                    ${ready ? '<i class="fas fa-check-circle vw-ok"></i>' : `<button type="button" class="vw-photo-btn" data-photo="${esc(r.slot)}">Tomar foto</button>`}
                </div>`;
            }).join('')}
            <p class="vw-count">${done} de ${rows.length} listas</p>
            <p class="vw-note"><i class="fas fa-shield-alt"></i> Fotos a color, nítidas y vigentes.</p>`;
    }

    function docReady(row) {
        if (!state.photos[row.slot]) return false;
        if (row.needsCode && !String(state[row.codeKey] || '').trim()) return false;
        return true;
    }

    function faceGuideHtml() {
        return `<span class="vw-face-guide" aria-hidden="true"><svg viewBox="0 0 120 140">
            <ellipse cx="60" cy="62" rx="32" ry="40" fill="none" stroke="currentColor" stroke-width="3"/>
            <circle cx="48" cy="56" r="3" fill="currentColor"/>
            <circle cx="72" cy="56" r="3" fill="currentColor"/>
            <path d="M48 78c4 6 20 6 24 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        </svg></span>`;
    }

    function summaryHtml(report) {
        return report.lines.map((line) =>
            `<div><i class="fas ${line.ok ? 'fa-check-circle' : 'fa-exclamation-circle is-miss'}"></i> ${esc(line.text)}</div>`
        ).join('');
    }

    function stepSend() {
        const report = registrationChecklist(state, { cutoffs });
        const face = state.photos.face;
        return `
            <button type="button" class="vw-face" data-photo="face" aria-label="Tomar selfie">
                ${face && String(face).startsWith('data:') ? `<img alt="" src="${face}">` : faceGuideHtml()}
                ${face ? '<i class="vw-check fas fa-check"></i>' : ''}
            </button>
            <p class="vw-face-copy">De frente, con buena luz,<br>sin gorra ni lentes</p>
            <div class="vw-summary">${summaryHtml(report)}</div>
            <p class="vw-label">Tus datos</p>
            <input class="vw-field" data-field="name" value="${esc(state.name)}" placeholder="Nombre completo (como en tu DNI)" style="margin-bottom:8px">
            <input class="vw-field" data-field="phone" value="${esc(state.phone)}" placeholder="WhatsApp (+504…)" style="margin-bottom:8px">
            <input class="vw-field" data-field="emergency" value="${esc(state.emergency)}" placeholder="Emergencia WhatsApp (+504…)" style="margin-bottom:8px">
            <input class="vw-field" data-field="dni" value="${esc(state.dni)}" placeholder="N° de identidad (DNI)" style="margin-bottom:8px">
            <input class="vw-field" data-field="referral" value="${esc(state.referral)}" placeholder="Código de referido (opcional)">`;
    }

    function readFields() {
        root.querySelectorAll('[data-field]').forEach((el) => {
            state[el.getAttribute('data-field')] = el.value;
        });
        if (state.yearOther && String(state.yearOther).trim()) {
            const y = Number(state.yearOther);
            if (isPlausibleVehicleYear(y)) state.year = y;
        }
    }

    function validate(step) {
        readFields();
        if (step === 1) {
            if (!state.type) return 'Elegí el tipo de vehículo.';
            if (!state.brand) return 'Elegí la marca.';
            if (state.brand === 'Otra' && !String(state.brandOther || '').trim()) return 'Escribí la marca.';
            if (!String(state.model || '').trim()) return 'Escribí el modelo.';
            if (!String(state.plate || '').trim()) return 'Escribí la placa.';
            if (state.type === 'taxi' && !preview && !isUsMarket() && !isValidTaxiPlate(state.plate)) {
                return 'La placa del taxi lleva T- (ej. T-1234).';
            }
            if ((state.type === 'paila' || state.type === 'camion' || state.type === 'grua') && !String(state.cargo || '').trim()) {
                return 'Indicá la capacidad de carga.';
            }
            return '';
        }
        if (step === 2) {
            const y = Number(state.year);
            if (!isPlausibleVehicleYear(y)) return `Elegí el año (de 1980 a ${currentYear() + 1}).`;
            if (state.hasAC !== true && state.hasAC !== false) return 'Indicá si tiene aire.';
            if (!SEAT_CHIPS.includes(Number(state.seats))) return 'Elegí los asientos.';
            return '';
        }
        if (step === 3) {
            const missing = vehiclePhotoSlots(state.type).filter((s) => !state.photos[s.slot]);
            if (missing.length) return `Te falta la foto: ${missing[0].label}.`;
            return '';
        }
        if (step === 4) {
            const missing = documentRows().find((r) => !docReady(r));
            if (!missing) return '';
            if (!state.photos[missing.slot]) return `Tomá la foto: ${missing.label}.`;
            return `Escribí el código de ${missing.label}.`;
        }
        if (!state.photos.face) return 'Tomá tu selfie, de frente y con luz.';
        if (!String(state.name || '').trim() || !String(state.phone || '').trim()) return 'Nombre y WhatsApp son obligatorios.';
        return '';
    }

    async function goNext() {
        error = validate(state.step);
        if (error) { render(); return; }
        const total = totalSteps(mode);
        if (state.step < total) {
            state.step += 1;
            persist();
            render();
            root.querySelector('.vw-scroll')?.scrollTo(0, 0);
            return;
        }
        const btn = root.querySelector('[data-vw="next"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
        try {
            await options.onSubmit?.(collect(), { mode, cutoffs, profile });
            if (!preview) clearDraft(profile);
        } catch (e) {
            error = e?.message || 'No se pudo guardar. Intentá otra vez.';
            render();
        }
    }

    function collect() {
        const year = Number(state.year);
        const hasAC = state.hasAC === true;
        const seats = Number(state.seats);
        const suggestedCategory = suggestRideCategory({ type: state.type, year, hasAC, seats, cutoffs });
        return {
            ...state,
            year,
            hasAC,
            seats,
            yearConfirmed: true,
            suggestedCategory,
            modelText: composeVehicleModel(state),
            cutoffs
        };
    }

    function bind() {
        root.querySelector('[data-vw="back"]')?.addEventListener('click', () => {
            readFields();
            if (state.step > 1) {
                state.step -= 1;
                error = '';
                persist();
                render();
                return;
            }
            options.onClose?.();
        });
        root.querySelector('[data-vw="help"]')?.addEventListener('click', () => {
            window.openDriverRegisterGuide?.(state.step === 5 ? 'face' : state.step === 4 ? 'docs' : state.step === 3 ? 'photos' : 'vehicle');
        });
        root.querySelector('[data-vw="next"]')?.addEventListener('click', () => { goNext(); });
        root.querySelectorAll('[data-type]').forEach((btn) => btn.addEventListener('click', () => {
            readFields();
            state.type = btn.getAttribute('data-type');
            error = '';
            persist();
            render();
        }));
        root.querySelectorAll('[data-brand]').forEach((btn) => btn.addEventListener('click', () => {
            readFields();
            state.brand = btn.getAttribute('data-brand');
            persist();
            render();
        }));
        root.querySelectorAll('[data-year]').forEach((btn) => btn.addEventListener('click', () => {
            readFields();
            state.year = Number(btn.getAttribute('data-year'));
            state.yearOther = '';
            persist();
            render();
        }));
        root.querySelectorAll('[data-ac]').forEach((btn) => btn.addEventListener('click', () => {
            readFields();
            state.hasAC = btn.getAttribute('data-ac') === '1';
            persist();
            render();
        }));
        root.querySelectorAll('[data-seats]').forEach((btn) => btn.addEventListener('click', () => {
            readFields();
            state.seats = Number(btn.getAttribute('data-seats'));
            persist();
            render();
        }));
        root.querySelectorAll('[data-photo]').forEach((btn) => btn.addEventListener('click', () => {
            readFields();
            const slot = btn.getAttribute('data-photo');
            if (preview) {
                state.photos[slot] = state.photos[slot] ? '' : previewPhoto(slot);
                persist();
                render();
                return;
            }
            window.pickSetupPhoto?.(slot);
        }));
        root.querySelectorAll('[data-field]').forEach((el) => {
            el.addEventListener('input', () => {
                state[el.getAttribute('data-field')] = el.value;
                if (el.getAttribute('data-field') === 'yearOther') {
                    const y = Number(el.value);
                    if (isPlausibleVehicleYear(y)) state.year = y;
                }
                persist();
                if (state.step === 2) {
                    const cat = root.querySelector('.vw-cat');
                    if (cat) cat.innerHTML = `<i class="fas fa-check-circle"></i> ${esc(categoryLine())}`;
                }
                if (state.step === totalSteps(mode)) {
                    const report = registrationChecklist(state, { cutoffs });
                    const box = root.querySelector('.vw-summary');
                    if (box) box.innerHTML = summaryHtml(report);
                    const next = root.querySelector('[data-vw="next"]');
                    if (next) next.disabled = mode === 'register' ? !report.canSubmit : !report.canSaveUpdate;
                }
            });
        });
    }

    function onPhoto(e) {
        const slot = e.detail?.slot;
        const dataUrl = e.detail?.dataUrl;
        if (!slot || !dataUrl || !root.isConnected) return;
        state.photos[slot] = dataUrl;
        persist();
        if (root.querySelector(`[data-photo="${slot}"]`)) render();
    }

    if (!preview) {
        document.addEventListener('hr-setup-photo', onPhoto);
        Object.entries(state.photos || {}).forEach(([slot, url]) => {
            if (url && String(url).startsWith('data:')) window.__hrApplySetupPhoto?.(slot, url);
        });
    }
    persist();
    render();

    return {
        root,
        destroy() {
            document.removeEventListener('hr-setup-photo', onPhoto);
            root.remove();
        },
        getState: () => state
    };
}

function previewPhoto(slot) {
    const label = esc(slot);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#dbeafe"/><text x="160" y="108" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#1d4ed8">${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function driverInTrip() {
    const t = window.currentActiveTripData || window.activeTrip;
    return !!(t && (t.status === 'accepted' || t.status === 'in_progress'));
}

export function mountVehicleUpdateNotice(host, { onNow, onLater } = {}) {
    ensureCss();
    const el = document.createElement('div');
    el.className = 'vw-notice';
    el.innerHTML = `
        <div class="vw-sheet" role="dialog" aria-labelledby="vw-notice-title">
            <div class="vw-sheet-head">
                <h2 id="vw-notice-title">Actualizá tu vehículo</h2>
                <button type="button" class="vw-x" data-later aria-label="Más tarde">×</button>
            </div>
            <div class="vw-art" aria-hidden="true">
                <svg width="220" height="110" viewBox="0 0 220 110">
                    <ellipse cx="58" cy="96" rx="36" ry="6" fill="#e2e8f0"/>
                    <ellipse cx="150" cy="96" rx="48" ry="6" fill="#e2e8f0"/>
                    <path d="M18 70 h28 l8-16 h22 l10 16 h8" fill="none" stroke="#2563eb" stroke-width="4" stroke-linejoin="round"/>
                    <circle cx="32" cy="74" r="8" fill="#1d4ed8"/><circle cx="78" cy="74" r="8" fill="#1d4ed8"/>
                    <path d="M96 78 h18 l16-22 h46 l14 14 h18 v8 h-112z" fill="#3b82f6"/>
                    <path d="M132 58 h28 l10 12 h-46z" fill="#bfdbfe"/>
                    <circle cx="124" cy="80" r="9" fill="#1e3a8a"/><circle cx="176" cy="80" r="9" fill="#1e3a8a"/>
                </svg>
            </div>
            <h3>Nuevas categorías de viaje.</h3>
            <p class="lead">Completá los datos de tu vehículo en menos de 1 minuto para recibir más viajes.</p>
            <div class="vw-promise"><i class="fas fa-check-circle"></i><div><b>Solo 2 pasos</b><span>Es rápido y sencillo</span></div></div>
            <button type="button" class="vw-next is-orange" data-now>Actualizar ahora</button>
            <button type="button" class="vw-later" data-later>Más tarde</button>
        </div>`;
    const closeLater = () => { el.remove(); onLater?.(); };
    el.querySelector('[data-now]')?.addEventListener('click', () => { el.remove(); onNow?.(); });
    el.querySelectorAll('[data-later]').forEach((b) => b.addEventListener('click', closeLater));
    host.appendChild(el);
    return el;
}

let wizardHandle = null;
let noticeEl = null;

export function closeDriverVehicleWizard() {
    wizardHandle?.destroy?.();
    wizardHandle = null;
}

export function openDriverVehicleWizard(options = {}) {
    ensureCss();
    closeDriverVehicleWizard();
    noticeEl?.remove();
    noticeEl = null;
    const host = options.host || document.body;
    wizardHandle = mountDriverVehicleWizard(host, {
        ...options,
        onClose: () => {
            closeDriverVehicleWizard();
            options.onClose?.();
        }
    });
    return wizardHandle;
}

export async function maybeShowVehicleUpdateNotice(profile, options = {}) {
    if (typeof document === 'undefined') return false;
    if (wizardHandle || document.querySelector('.vw-notice')) return false;
    const inTrip = options.inTrip != null ? options.inTrip : driverInTrip();
    if (!shouldAskVehicleUpdate(profile, { snoozeUntil: readSnoozeUntil(profile), inTrip })) return false;
    ensureCss();
    noticeEl = mountVehicleUpdateNotice(document.body, {
        onNow: () => openDriverVehicleWizard({
            mode: 'update',
            profile,
            cutoffs: options.cutoffs || window.__hrRideCutoffs,
            onSubmit: options.onSubmit,
            onClose: () => {}
        }),
        onLater: () => snoozeVehicleUpdate(profile)
    });
    return true;
}

export function renderRideCutoffAdmin(cutoffs) {
    const c = normalizeCutoffs(cutoffs || DEFAULT_RIDE_CUTOFFS);
    return `
        <div class="vw-admin" id="ride-cutoff-admin">
            <h3>Categorías de viaje</h3>
            <p>Estos años solo arman la categoría sugerida del vehículo. No cambian el precio ni a quién le llega el viaje.</p>
            <label for="rc-eco">Raite Económico: hasta el año</label>
            <input id="rc-eco" type="number" value="${c.economicoMaxYear}">
            <label for="rc-conf">Raite Confort: desde el año (con aire)</label>
            <input id="rc-conf" type="number" value="${c.confortMinYear}">
            <label for="rc-vip">Raite VIP: desde el año</label>
            <input id="rc-vip" type="number" value="${c.vipMinYear}">
            <label for="rc-fam-min">Raite Familiar: asientos desde</label>
            <input id="rc-fam-min" type="number" value="${c.familiarMinSeats}">
            <label for="rc-fam-max">Raite Familiar: asientos hasta</label>
            <input id="rc-fam-max" type="number" value="${c.familiarMaxSeats}">
            <button type="button" class="vw-next is-orange" id="rc-save" style="margin-top:16px">Guardar cortes</button>
            <p id="rc-msg" class="vw-foot-note"></p>
        </div>`;
}

export function readRideCutoffForm(root = document) {
    const num = (id) => Number(root.querySelector(id)?.value);
    return normalizeCutoffs({
        economicoMaxYear: num('#rc-eco'),
        confortMinYear: num('#rc-conf'),
        vipMinYear: num('#rc-vip'),
        familiarMinSeats: num('#rc-fam-min'),
        familiarMaxSeats: num('#rc-fam-max')
    });
}

export { buildApprovedComfortPatch, ensureCss };
