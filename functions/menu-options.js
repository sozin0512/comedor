/** Misma cuenta que js/menu-options.js, para no aceptar un total alterado. */

function moneyRound(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeGroups(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((g) => {
        if (!g || typeof g !== 'object') return null;
        const options = (Array.isArray(g.options) ? g.options : []).map((opt) => {
            const name = String(opt?.name || '').trim();
            if (!name) return null;
            return {
                id: String(opt.id || name),
                name,
                priceDelta: Math.max(0, moneyRound(opt.priceDelta)),
                available: opt.available !== false
            };
        }).filter(Boolean);
        if (!options.length) return null;
        let min = Math.max(0, Math.floor(Number(g.min) || 0));
        let max = Math.max(1, Math.floor(Number(g.max) || 1));
        if (max < min) max = min;
        const required = g.required === true || min > 0;
        if (required && min < 1) min = 1;
        const maxRules = (Array.isArray(g.maxRules) ? g.maxRules : [])
            .map((rule) => ({ whenOptionId: String(rule?.whenOptionId || ''), max: Math.floor(Number(rule?.max) || 0) }))
            .filter((rule) => rule.whenOptionId && rule.max > 0);
        return { id: String(g.id || g.name), name: String(g.name || ''), min, max, required, maxRules, options };
    }).filter(Boolean);
}

function groupMax(group, picks) {
    const selected = new Set();
    Object.values(picks || {}).forEach((ids) => (ids || []).forEach((id) => selected.add(id)));
    let max = group.max;
    (group.maxRules || []).forEach((rule) => {
        if (selected.has(rule.whenOptionId)) max = rule.max;
    });
    return Math.max(group.min || 0, max);
}

function chosen(group, picks) {
    return (picks?.[group.id] || [])
        .map((id) => group.options.find((opt) => opt.id === id && opt.available !== false))
        .filter(Boolean);
}

function expectedOrderPricing(productsById, items) {
    let total = 0;
    for (const item of items || []) {
        const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
        const picks = item.selectedOptions && typeof item.selectedOptions === 'object' ? item.selectedOptions : {};
        const product = productsById[item?.productId];
        if (!product) {
            if (Object.keys(picks).length) return { ok: false, reason: 'Producto no encontrado' };
            const submittedOnly = Number(item.basePrice ?? item.price);
            if (!Number.isFinite(submittedOnly)) return { ok: false, reason: 'Precio inválido' };
            total += submittedOnly * qty;
            continue;
        }
        const groups = normalizeGroups(product.optionGroups);
        for (const group of groups) {
            const count = chosen(group, picks).length;
            const max = groupMax(group, picks);
            const min = group.required ? Math.max(1, group.min) : group.min;
            if (count < min || count > max) return { ok: false, reason: 'Faltan opciones obligatorias' };
        }
        const base = Number(product.basePrice != null ? product.basePrice : product.price) || 0;
        const delta = groups.reduce((sum, group) => sum + chosen(group, picks).reduce((s, opt) => s + (Number(opt.priceDelta) || 0), 0), 0);
        const unit = moneyRound(base + delta);
        const submitted = Number(item.basePrice ?? item.price);
        if (Number.isFinite(submitted) && Math.abs(submitted - unit) > 0.02) {
            return { ok: false, reason: 'El precio no coincide con el menú' };
        }
        total += unit * qty;
    }
    return { ok: true, total: moneyRound(total) };
}

function optionDetail(product, picks) {
    return normalizeGroups(product?.optionGroups)
        .map((group) => chosen(group, picks).map((opt) => opt.name).join(' + '))
        .filter(Boolean)
        .join(' · ');
}

module.exports = { expectedOrderPricing, optionDetail };
