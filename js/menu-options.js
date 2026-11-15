/**
 * Opciones de un producto de tienda (sabores, acompañamientos).
 * Un producto sin optionGroups se pide igual que antes.
 */

function slug(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || `op-${Date.now().toString(36)}`;
}

function moneyRound(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

export function normalizeOption(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim().slice(0, 80);
    if (!name) return null;
    const priceDelta = moneyRound(raw.priceDelta);
    return {
        id: String(raw.id || slug(name)),
        name,
        priceDelta: Number.isFinite(priceDelta) && priceDelta >= 0 ? priceDelta : 0,
        available: raw.available !== false
    };
}

export function normalizeOptionGroup(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim().slice(0, 80);
    const options = (Array.isArray(raw.options) ? raw.options : []).map(normalizeOption).filter(Boolean);
    if (!name || !options.length) return null;
    let min = Math.max(0, Math.floor(Number(raw.min) || 0));
    let max = Math.max(1, Math.floor(Number(raw.max) || 1));
    if (max < min) max = min;
    const required = raw.required === true || min > 0;
    if (required && min < 1) min = 1;
    const maxRules = (Array.isArray(raw.maxRules) ? raw.maxRules : [])
        .map((rule) => ({
            whenOptionId: String(rule?.whenOptionId || ''),
            max: Math.max(0, Math.floor(Number(rule?.max) || 0))
        }))
        .filter((rule) => rule.whenOptionId && rule.max > 0);
    return {
        id: String(raw.id || slug(name)),
        name,
        min,
        max,
        required,
        maxRules,
        options
    };
}

export function normalizeOptionGroups(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeOptionGroup).filter(Boolean);
}

export function productHasOptionGroups(product) {
    return normalizeOptionGroups(product?.optionGroups).length > 0;
}

export function groupMax(group, picks) {
    const selected = new Set();
    Object.values(picks || {}).forEach((ids) => (ids || []).forEach((id) => selected.add(id)));
    let max = group.max;
    (group.maxRules || []).forEach((rule) => {
        if (selected.has(rule.whenOptionId)) max = rule.max;
    });
    return Math.max(group.min || 0, max);
}

export function groupHint(group, picks) {
    const max = groupMax(group, picks);
    const min = group.required ? Math.max(1, group.min) : group.min;
    if (group.required && min === 1 && max === 1) return 'Elegí 1 · Obligatorio';
    if (min > 0 && max > min) return `Elegí ${min} a ${max}${group.required ? ' · Obligatorio' : ''}`;
    if (max === 1) return 'Elegí 1';
    return `Elegí hasta ${max}`;
}

export function chosenOptions(group, picks) {
    const ids = picks?.[group.id] || [];
    return ids
        .map((id) => group.options.find((opt) => opt.id === id && opt.available !== false))
        .filter(Boolean);
}

export function validateOptionPicks(product, picks) {
    const groups = normalizeOptionGroups(product?.optionGroups);
    const missing = [];
    groups.forEach((group) => {
        const chosen = chosenOptions(group, picks);
        const max = groupMax(group, picks);
        const min = group.required ? Math.max(1, group.min) : group.min;
        if (chosen.length < min || chosen.length > max) missing.push(group.id);
    });
    return { ok: missing.length === 0, missing, groups };
}

export function optionDeltas(product, picks) {
    return validateOptionPicks(product, picks).groups.reduce((sum, group) => {
        return sum + chosenOptions(group, picks).reduce((s, opt) => s + (Number(opt.priceDelta) || 0), 0);
    }, 0);
}

export function unitPriceWithOptions(product, picks) {
    const base = Number(product?.basePrice != null ? product.basePrice : product?.price) || 0;
    return moneyRound(base + optionDeltas(product, picks));
}

export function lineTotalWithOptions(product, picks, qty) {
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    return moneyRound(unitPriceWithOptions(product, picks) * q);
}

export function optionDetailLine(product, picks) {
    const groups = normalizeOptionGroups(product?.optionGroups);
    const parts = [];
    groups.forEach((group) => {
        const names = chosenOptions(group, picks).map((opt) => opt.name);
        if (names.length) parts.push(names.join(' + '));
    });
    return parts.join(' · ');
}

export function selectionKey(product, picks) {
    const groups = normalizeOptionGroups(product?.optionGroups);
    if (!groups.length) return '';
    return groups.map((group) => {
        const ids = chosenOptions(group, picks).map((opt) => opt.id).sort();
        return `${group.id}:${ids.join(',')}`;
    }).join('|');
}

/** Precio esperado de un pedido. Sin grupos, el precio es el del producto. */
export function buildOptionPanelHtml(product, { money }) {
    const groups = normalizeOptionGroups(product?.optionGroups);
    const base = Number(product?.basePrice != null ? product.basePrice : product?.price) || 0;
    return `
        <div class="menu-options-sheet" role="dialog" aria-modal="true" aria-label="${escAttr(product?.name || 'Opciones')}">
            <header class="menu-options-head">
                <div>
                    <p class="menu-options-kicker">Personalizá tu pedido</p>
                    <h2>${esc(product?.name || 'Producto')}</h2>
                    <p class="menu-options-base">Precio base ${money(base)}</p>
                </div>
                <button type="button" class="menu-options-close" data-menu-opt="close" aria-label="Cerrar">×</button>
            </header>
            <div class="menu-options-list">
                ${groups.map((group) => `
                    <section class="menu-options-card" data-group-id="${escAttr(group.id)}">
                        <div class="menu-options-card-top">
                            <strong>${esc(group.name)}</strong>
                            <span class="menu-options-hint" data-hint-for="${escAttr(group.id)}">${esc(groupHint(group, {}))}</span>
                        </div>
                        <div class="menu-options-choices">
                            ${group.options.filter((opt) => opt.available !== false).map((opt) => `
                                <label class="menu-options-choice">
                                    <input type="${groupMax(group, {}) === 1 && !group.maxRules.length ? 'radio' : 'checkbox'}" name="opt-${escAttr(group.id)}" value="${escAttr(opt.id)}" data-menu-opt="pick" data-group-id="${escAttr(group.id)}">
                                    <span>${esc(opt.name)}</span>
                                    <b>${opt.priceDelta > 0 ? `+ ${money(opt.priceDelta)}` : 'Incluido'}</b>
                                </label>
                            `).join('')}
                        </div>
                    </section>
                `).join('')}
                <label class="menu-options-note">
                    <span>Nota para la cocina</span>
                    <textarea data-menu-opt="note" maxlength="180" placeholder="Sin cebolla, bien doradas…"></textarea>
                </label>
                <div class="menu-options-qty">
                    <span>Cantidad</span>
                    <button type="button" data-menu-opt="qty-dec" aria-label="Menos">−</button>
                    <b data-menu-opt="qty">1</b>
                    <button type="button" data-menu-opt="qty-inc" aria-label="Más">+</button>
                </div>
            </div>
            <button type="button" class="menu-options-add" data-menu-opt="add">AGREGAR · ${money(base)}</button>
        </div>`;
}

export function buildOptionEditorHtml(groups, library = []) {
    const list = normalizeOptionGroups(groups);
    const rows = list.length ? list : [];
    const saved = normalizeOptionGroups(library);
    return `
        <div class="menu-opt-editor" data-menu-editor="1">
            <p class="menu-opt-editor-title">Opciones del cliente</p>
            <p class="menu-opt-editor-help">Sabores, tamaños o acompañamientos. Si no agregás grupos, el producto se pide como siempre. Un grupo guardado se puede reusar en otro producto.</p>
            ${saved.length ? `<div class="menu-opt-editor-library">${saved.map((group) => `<button type="button" class="stores-secondary-btn" data-menu-editor-use="${escAttr(group.id)}">Usar «${esc(group.name)}»</button>`).join('')}</div>` : ''}
            <div data-menu-editor-groups>
                ${rows.map((group) => editorGroupHtml(group)).join('')}
            </div>
            <button type="button" class="stores-secondary-btn" data-menu-editor-add-group>+ Grupo de opciones</button>
        </div>`;
}

function editorGroupHtml(group) {
    return `
        <div class="menu-opt-editor-group" data-editor-group data-group-id="${escAttr(group.id)}" data-max-rules="${escAttr(JSON.stringify(group.maxRules || []))}">
            <input class="stores-input" data-editor-name placeholder="Nombre del grupo" value="${escAttr(group.name)}">
            <div class="menu-opt-editor-row">
                <label>Mín <input class="stores-input" data-editor-min type="number" min="0" value="${group.min}"></label>
                <label>Máx <input class="stores-input" data-editor-max type="number" min="1" value="${group.max}"></label>
                <label><input data-editor-required type="checkbox" ${group.required ? 'checked' : ''}> Obligatorio</label>
            </div>
            <div data-editor-options>
                ${group.options.map((opt) => editorOptionHtml(opt)).join('')}
            </div>
            <button type="button" class="stores-secondary-btn" data-editor-add-option>+ Opción</button>
        </div>`;
}

function editorOptionHtml(opt) {
    return `
        <div class="menu-opt-editor-option" data-editor-option data-opt-id="${escAttr(opt?.id || '')}">
            <input class="stores-input" data-editor-opt-name placeholder="Opción" value="${escAttr(opt?.name || '')}">
            <input class="stores-input" data-editor-opt-price type="number" min="0" step="0.01" placeholder="Extra L." value="${opt?.priceDelta || 0}">
            <label><input data-editor-opt-available type="checkbox" ${opt?.available === false ? '' : 'checked'}> Disponible</label>
        </div>`;
}

export function groupEditorHtml(group) {
    const normalized = normalizeOptionGroup(group);
    return normalized ? editorGroupHtml(normalized) : '';
}

export function blankGroupHtml() {
    return editorGroupHtml(normalizeOptionGroup({
        name: 'Nuevo grupo', min: 1, max: 1, required: true,
        options: [{ name: 'Opción', priceDelta: 0, available: true }]
    }));
}

export function blankOptionHtml() {
    return editorOptionHtml({ name: '', priceDelta: 0, available: true });
}

export function readOptionEditor(root) {
    if (!root) return [];
    return [...root.querySelectorAll('[data-editor-group]')].map((groupEl) => {
        let maxRules = [];
        try { maxRules = JSON.parse(groupEl.getAttribute('data-max-rules') || '[]'); } catch (_) { maxRules = []; }
        return normalizeOptionGroup({
            id: groupEl.getAttribute('data-group-id') || undefined,
            name: groupEl.querySelector('[data-editor-name]')?.value,
            min: groupEl.querySelector('[data-editor-min]')?.value,
            max: groupEl.querySelector('[data-editor-max]')?.value,
            required: !!groupEl.querySelector('[data-editor-required]')?.checked,
            maxRules,
            options: [...groupEl.querySelectorAll('[data-editor-option]')].map((optEl) => ({
                id: optEl.getAttribute('data-opt-id') || undefined,
                name: optEl.querySelector('[data-editor-opt-name]')?.value,
                priceDelta: optEl.querySelector('[data-editor-opt-price]')?.value,
                available: !!optEl.querySelector('[data-editor-opt-available]')?.checked
            }))
        });
    }).filter(Boolean);
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(value) { return esc(value); }

export function expectedOrderPricing(productsById, items) {
    let total = 0;
    const lines = [];
    for (const item of items || []) {
        const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
        const product = productsById[item?.productId];
        const picks = item.selectedOptions && typeof item.selectedOptions === 'object' ? item.selectedOptions : {};
        if (!product) {
            if (Object.keys(picks).length) return { ok: false, reason: 'Producto no encontrado' };
            const submitted = Number(item.basePrice ?? item.price);
            if (!Number.isFinite(submitted)) return { ok: false, reason: 'Precio inválido' };
            total += submitted * qty;
            lines.push({ productId: item.productId, unit: submitted, qty });
            continue;
        }
        const check = validateOptionPicks(product, picks);
        if (!check.ok) return { ok: false, reason: 'Faltan opciones obligatorias' };
        const unit = unitPriceWithOptions(product, picks);
        const submitted = Number(item.basePrice ?? item.price);
        if (Number.isFinite(submitted) && Math.abs(submitted - unit) > 0.02) {
            return { ok: false, reason: 'El precio no coincide con el menú' };
        }
        total += unit * qty;
        lines.push({ productId: item.productId, unit, qty });
    }
    return { ok: true, total: moneyRound(total), lines };
}
