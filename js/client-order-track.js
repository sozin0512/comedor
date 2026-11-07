/**
 * Seguimiento de pedidos del cliente (Mis pedidos y acceso desde inicio).
 * Solo pinta datos que ya vienen en el pedido o en un viaje que el cliente puede leer.
 * No calcula ubicación ni llegada: si el campo no está, el estado queda en «no confirmado».
 */

const ACTIVE = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function isActiveClientOrder(o) {
    return ACTIVE.includes(String(o?.status || ''));
}

export function splitClientOrders(orders) {
    const active = [];
    const history = [];
    for (const o of Array.isArray(orders) ? orders : []) {
        if (!o) continue;
        if (isActiveClientOrder(o)) active.push(o);
        else history.push(o);
    }
    return { active, history };
}

const STEP_LABEL = {
    1: 'Recibido',
    2: 'Preparando',
    3: 'Preparado',
    4: 'En camino',
    5: 'Entregado',
};

export function clientOrderStep(o) {
    let current = 1;
    const status = String(o?.status || '');
    if (status === 'preparing') current = 2;
    else if (status === 'ready') current = 3;
    else if (status === 'out_for_delivery') current = 4;
    else if (status === 'delivered') current = 5;
    else if (status === 'cancelled') current = 0;
    const label = STEP_LABEL[current] || '';
    return {
        current,
        label,
        headline: current ? `Paso ${current} de 5 · ${label}` : 'Cancelado',
    };
}

export function clientOrderStepNote(o) {
    const status = String(o?.status || '');
    const who = firstName(o?.driverName);
    if (status === 'pending') return 'El restaurante aún no acepta. El reparto se pide cuando marquen que el pedido está preparado.';
    if (status === 'accepted') return 'Ya lo aceptaron. Falta que marquen que lo están preparando.';
    if (status === 'preparing') return 'Lo están preparando. El reparto se llama cuando esté preparado.';
    if (status === 'ready') return 'Pedido preparado. Se está buscando reparto.';
    if (status === 'out_for_delivery') return who ? `${who} lleva el pedido.` : 'El pedido va en camino.';
    if (status === 'delivered') return 'Pedido entregado.';
    if (status === 'cancelled') return 'Este pedido está cancelado.';
    return '';
}

function firstName(name) {
    const raw = String(name || '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0];
}

function finiteCoord(v) {
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= 180 ? n : null;
}

function finiteEta(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 24 * 60) return null;
    return Math.round(n);
}

/**
 * @param {object} order pedido
 * @param {object|null} live campos ya leídos del viaje del cliente: driverName, driverPhone, lat, lng, etaMin
 */
export function clientOrderTrackModel(order, live = null) {
    const o = order || {};
    const L = live && typeof live === 'object' ? live : {};
    const driverName = String(o.driverName || L.driverName || '').trim();
    const driverId = String(o.driverId || L.driverId || '').trim();
    const phoneRaw = String(o.driverPhone || L.driverPhone || '').trim();
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    const assigned = !!(driverId || driverName);
    const lat = finiteCoord(L.lat);
    const lng = finiteCoord(L.lng);
    const hasMap = lat != null && lng != null;
    const etaMin = finiteEta(L.etaMin);
    return {
        assigned,
        riderLabel: assigned ? (firstName(driverName) || 'Repartidor asignado') : '',
        phone: phoneDigits.length >= 8 ? phoneRaw : '',
        contactState: !assigned ? 'no_rider' : (phoneDigits.length >= 8 ? 'phone' : 'no_phone'),
        map: hasMap ? { lat, lng } : null,
        etaMin,
        locationState: !assigned ? 'no_rider' : (hasMap ? 'live' : 'unavailable'),
        etaState: etaMin == null ? 'unknown' : 'known',
    };
}

export function clientOrderTrackHtml(order, live = null, opts = {}) {
    const step = clientOrderStep(order);
    const note = clientOrderStepNote(order);
    const m = clientOrderTrackModel(order, live);
    let rider = '';
    if (!m.assigned) {
        rider = `<p class="client-track-rider" data-track-rider="no_rider">Aún no hay repartidor asignado.</p>`;
    } else if (m.contactState === 'phone') {
        const digits = m.phone.replace(/\D/g, '');
        rider = `<p class="client-track-rider" data-track-rider="phone">Repartidor: <b>${esc(m.riderLabel)}</b></p>
            <a class="client-track-phone" href="tel:${esc(digits)}">Llamar ${esc(m.phone)}</a>`;
    } else {
        rider = `<p class="client-track-rider" data-track-rider="no_phone">Repartidor: <b>${esc(m.riderLabel)}</b>. Teléfono no está en el pedido.</p>`;
    }
    let where = '';
    if (m.locationState === 'no_rider') {
        where = `<p class="client-track-where" data-track-map="none">Sin ubicación ni llegada: todavía no hay repartidor.</p>`;
    } else if (m.locationState === 'live') {
        const q = `${m.map.lat},${m.map.lng}`;
        where = `<p class="client-track-where" data-track-map="live">Última ubicación registrada del repartidor.</p>
            <a class="client-track-maplink" href="https://www.google.com/maps?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">${esc(m.map.lat.toFixed(5))}, ${esc(m.map.lng.toFixed(5))}</a>`;
    } else {
        where = `<p class="client-track-where" data-track-map="unavailable">Ubicación del repartidor no disponible.</p>`;
    }
    const eta = m.etaState === 'known'
        ? `<p class="client-track-eta" data-track-eta="known">Llegada estimada: ${m.etaMin} min</p>`
        : `<p class="client-track-eta" data-track-eta="unknown">Llegada estimada: no confirmada</p>`;
    const dots = opts.riderOnly ? '' : `<div class="client-track-dots" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => {
        const cls = n < step.current ? ' is-done' : (n === step.current ? ' is-current' : '');
        return `<span class="client-track-dot${cls}">${n < step.current ? '✓' : n}</span>`;
    }).join('')}</div>`;
    const stepBlock = opts.riderOnly ? '' : `${dots}<p class="client-track-step">${esc(step.headline)}</p>
        ${note ? `<p class="client-track-note">${esc(note)}</p>` : ''}`;
    return `<div class="client-order-track__body" data-track-step="${step.current}">
        ${stepBlock}
        ${rider}
        ${where}
        ${m.assigned ? eta : ''}
    </div>`;
}

export function clientHomeOrderAccessHtml(order) {
    if (!isActiveClientOrder(order)) return '';
    const step = clientOrderStep(order);
    const store = String(order.storeName || 'Tu pedido');
    return `<button type="button" class="client-home-order-access" data-client-order-home="1" data-order-id="${esc(order.id || '')}">
        <span class="client-home-order-access__kicker">Pedido en curso</span>
        <span class="client-home-order-access__title">${esc(store)}</span>
        <span class="client-home-order-access__step">${esc(step.headline)}</span>
        <span class="client-home-order-access__cta">Ver seguimiento</span>
    </button>`;
}

function defaultCard(o, { history = false, focused = false, live = null } = {}) {
    const items = Array.isArray(o.items) ? o.items.map((i) => `${i.qty}× ${i.name}`).join(', ') : '';
    const step = clientOrderStep(o);
    if (history) {
        return `<article class="order-card order-card--history" data-order-id="${esc(o.id || '')}">
            <p class="order-card-title">${esc(o.storeName || 'Tienda')}</p>
            <p class="order-card-sub">${esc(items || 'Pedido')}</p>
            <p class="order-card-status">${esc(step.headline)}</p>
        </article>`;
    }
    return `<article class="order-card order-card--active${focused ? ' order-card--focus' : ''}" data-order-id="${esc(o.id || '')}" data-order-step="${step.current}">
        <p class="order-card-title">${esc(o.storeName || 'Tienda')}</p>
        <p class="order-card-sub">${esc(items || 'Pedido')}</p>
        <div class="client-order-track" data-client-track="${esc(o.id || '')}">${clientOrderTrackHtml(o, live)}</div>
    </article>`;
}

export function clientOrdersBoardHtml(orders, opts = {}) {
    const list = Array.isArray(orders) ? orders : [];
    if (!list.length) {
        return `<div class="stores-empty" data-orders-empty="1"><p>No tienes pedidos aún.</p></div>`;
    }
    const { active, history } = splitClientOrders(list);
    const focusId = opts.focusId || active[0]?.id || '';
    const cardHtml = typeof opts.cardHtml === 'function' ? opts.cardHtml : null;
    const liveFor = typeof opts.liveFor === 'function' ? opts.liveFor : (() => null);
    const renderCard = (o, historyFlag) => {
        const ctx = { history: historyFlag, focused: o.id === focusId, live: liveFor(o) };
        return cardHtml ? cardHtml(o, ctx) : defaultCard(o, ctx);
    };
    const activeHtml = active.length
        ? active.map((o) => renderCard(o, false)).join('')
        : `<p class="orders-active-empty">No hay pedidos en curso.</p>`;
    const historyHtml = history.length
        ? history.map((o) => renderCard(o, true)).join('')
        : `<p class="orders-history-empty">Sin pedidos anteriores.</p>`;
    return `<section class="orders-active" data-orders-section="active">
        <h3 class="orders-section-title">En curso</h3>
        <div class="orders-list">${activeHtml}</div>
    </section>
    <details id="client-orders-history" class="orders-history" ${opts.historyOpen ? 'open' : ''}>
        <summary>Historial · ${history.length}</summary>
        <div class="orders-list">${historyHtml}</div>
    </details>`;
}
