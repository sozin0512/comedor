/**
 * Bloques de la hoja de pedir, sin el acordeón «Más opciones».
 * Flete y envío se ven en la hoja. Otra persona y por horas viven en el paso «cuándo».
 * El formulario de grúa sigue en el DOM, oculto: el pedido no lee esos campos.
 */

export function tripSheetAdvancedVisibility(serviceType) {
    const type = String(serviceType || '');
    return {
        masOpciones: false,
        options: true,
        freight: type === 'flete_paila' || type === 'flete_camion',
        tow: false,
        delivery: type === 'delivery',
    };
}

export function applyTripSheetAdvancedVisibility(root, serviceType) {
    const doc = root && typeof root.getElementById === 'function' ? root : null;
    if (!doc) return null;
    const show = tripSheetAdvancedVisibility(serviceType);
    const setHidden = (id, hidden) => {
        const el = doc.getElementById(id);
        if (!el?.classList) return;
        el.classList.toggle('hidden', !!hidden);
    };
    doc.getElementById('trip-advanced-body')?.classList?.remove('hidden');
    const dead = doc.getElementById('trip-advanced-toggle');
    if (dead?.classList) dead.classList.add('hidden');
    if (dead?.setAttribute) dead.setAttribute('hidden', '');
    setHidden('trip-options-panel', !show.options);
    setHidden('freight-details-panel', !show.freight);
    setHidden('tow-details-panel', !show.tow);
    setHidden('delivery-details-panel', !show.delivery);
    return show;
}
