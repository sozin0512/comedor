/**
 * Paneles flotantes arrastrables — panel central y objetivos del conductor
 */

const STORAGE_PREFIX = 'honduber_panel_pos_';
let recentDragUntil = 0;

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function loadPosition(key) {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function savePosition(key, x, y) {
    try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ x, y }));
    } catch (_) {}
}

function clearSavedPosition(key) {
    try {
        localStorage.removeItem(STORAGE_PREFIX + key);
    } catch (_) {}
}

/** Flotantes de viaje que deben quedar fijos (solo minimizar, sin arrastrar). */
const TRIP_FLOAT_FIXED_KEYS = new Set(['driver-pin']);

function markRecentDrag() {
    recentDragUntil = Date.now() + 400;
}

export function wasRecentPanelDrag() {
    return Date.now() < recentDragUntil;
}

function isInteractiveTarget(el) {
    // Drag handles: permiten arrastre
    if (el?.closest?.('[data-promo-drag-handle], .passenger-promo-drag-handle, [data-copa-map-drag-handle], .app-download-badge-drag, [data-app-dl-drag]')) return false;
    // Close button must stay clickable (not start drag)
    if (el?.closest?.('.passenger-promo-close, #passenger-promo-close, .app-download-badge-close, [data-copa-close], [data-app-dl-close], .copa-close-btn, .copa-strip-close')) return true;
    // Chevron min/max del panel: NUNCA iniciar drag (web lo confunde con movimiento)
    if (el?.closest?.('#panel-hide-btn, .panel-hide-btn, .trip-drag-handle, [data-trip-action="hide-panel"], [data-trip-action="toggle-panel"]')) return true;
    return !!el?.closest?.(
        'button, a, input, textarea, select, label, [data-no-drag], [data-trip-action], gmp-place-autocomplete, .panel-hide-btn, .wallet-compact-btn, .favorite-chip, .passenger-promo-card, [role="tab"], [role="button"], [role="slider"], [contenteditable="true"], .star-btn, .tip-btn'
    );
}

function isScrollableDragTarget(el) {
    return !!el?.closest?.('#panel-content, .trip-panel-scroll, [data-panel-scroll]');
}

export function makeDraggable(element, options = {}) {
    const {
        handle = element,
        storageKey = null,
        onActivate = null,
        minVisible = 56,
        enabled = () => true
    } = options;

    if (!element || !handle) return () => {};

    let pendingDrag = false;
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;
    let activePointerId = null;
    let dragStartTarget = null;

    const readPos = () => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
    };

    const applyPos = (x, y, persist = true) => {
        const w = element.offsetWidth || 280;
        const h = element.offsetHeight || 120;
        // Margen mínimo con el borde (safe-area + 8px) y al menos minVisible del control a la vista
        const edge = 8;
        const safeL = edge;
        const safeT = edge;
        const safeR = window.innerWidth - edge;
        const safeB = window.innerHeight - edge;
        const cx = clamp(x, safeL - w + minVisible, safeR - minVisible);
        const cy = clamp(y, safeT, Math.max(safeT, safeB - minVisible));
        element.style.position = 'fixed';
        element.style.left = `${cx}px`;
        element.style.top = `${cy}px`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.margin = '0';
        element.classList.add('is-drag-positioned');
        if (persist && storageKey) savePosition(storageKey, cx, cy);
        return { x: cx, y: cy };
    };

    const activateIfNeeded = () => {
        onActivate?.(element);
    };

    const restoreSaved = () => {
        if (!storageKey) return false;
        const pos = loadPosition(storageKey);
        if (!pos) return false;
        activateIfNeeded();
        applyPos(pos.x, pos.y, false);
        return true;
    };

    const beginDrag = (e) => {
        pendingDrag = false;
        dragging = true;
        activePointerId = e.pointerId;
        activateIfNeeded();
        const pos = readPos();
        origX = pos.x;
        origY = pos.y;
        element.classList.add('is-dragging');
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    };

    const onPointerDown = (e) => {
        if (!enabled()) return;
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (isInteractiveTarget(e.target)) return;

        pendingDrag = true;
        dragging = false;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        dragStartTarget = e.target;
        activePointerId = e.pointerId;
    };

    const onPointerMove = (e) => {
        if (!pendingDrag && !dragging) return;
        if (activePointerId != null && e.pointerId !== activePointerId) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (pendingDrag && !dragging) {
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            if (isScrollableDragTarget(dragStartTarget) && Math.abs(dy) > Math.abs(dx) + 4) {
                pendingDrag = false;
                activePointerId = null;
                dragStartTarget = null;
                return;
            }
            beginDrag(e);
        }

        if (!dragging) return;
        moved = true;
        e.preventDefault();
        applyPos(origX + dx, origY + dy);
    };

    const endDrag = (e) => {
        if (activePointerId != null && e.pointerId !== activePointerId) return;

        if (pendingDrag) {
            pendingDrag = false;
            activePointerId = null;
            dragStartTarget = null;
            return;
        }

        if (!dragging) return;
        dragging = false;
        activePointerId = null;
        dragStartTarget = null;
        element.classList.remove('is-dragging');
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        if (moved) {
            markRecentDrag();
            e.preventDefault();
            e.stopPropagation();
        }
    };

    handle.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    restoreSaved();

    return () => {
        handle.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
    };
}

function activateControlPanelFloating(panel) {
    if (!panel || panel.classList.contains('panel-is-floating')) return;
    const rect = panel.getBoundingClientRect();
    panel.classList.add('panel-is-floating');
    panel.style.width = `${Math.min(380, Math.max(280, rect.width))}px`;
    applyPosToControlPanel(panel, rect.left, rect.top);
}

function applyPosToControlPanel(panel, x, y) {
    const w = panel.offsetWidth || 320;
    const h = panel.offsetHeight || 200;
    const cx = clamp(x, 8, window.innerWidth - w - 8);
    const cy = clamp(y, 8, window.innerHeight - h - 8);
    panel.style.position = 'fixed';
    panel.style.left = `${cx}px`;
    panel.style.top = `${cy}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    savePosition('control-panel', cx, cy);
}

function isClientPanelDocked() {
    return document.body.classList.contains('client-mode');
}

function isDriverPanelExpanded() {
    return document.body.classList.contains('driver-mode')
        && !document.body.classList.contains('panel-minimized');
}

function isDriverPanelDocked() {
    // En viaje activo el sheet no se arrastra (solo min/max); si no, al
    // minimizar makeDraggable se reactivaba y el toque se sentía como “movimiento”.
    if (!document.body.classList.contains('driver-mode')) return false;
    if (document.body.classList.contains('trip-active')
        || document.body.classList.contains('is-navigating')
        || document.body.classList.contains('driver-nav-mode')) {
        return true;
    }
    return isDriverPanelExpanded();
}

export function dockControlPanelForDriverTrip() {
    const panel = document.getElementById('control-panel');
    if (!panel || !isDriverPanelDocked()) return;

    panel.classList.remove('panel-is-floating', 'is-drag-positioned', 'is-dragging');
    panel.style.position = '';
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.width = '';
    panel.style.margin = '';
}

export function restoreControlPanelAfterDriverTrip() {
    const panel = document.getElementById('control-panel');
    if (!panel) return;

    panel.classList.remove('is-dragging');
    panel.style.position = '';
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.width = '';
    panel.style.margin = '';

    if (isClientPanelDocked()) {
        dockControlPanelForClient();
        return;
    }

    if (isDriverPanelDocked()) {
        dockControlPanelForDriverTrip();
        return;
    }

    const saved = loadPosition('control-panel');
    if (saved) {
        panel.classList.add('panel-is-floating', 'is-drag-positioned');
        panel.style.position = 'fixed';
        panel.style.width = 'min(380px, calc(100vw - 1.5rem))';
        panel.style.left = `${saved.x}px`;
        panel.style.top = `${saved.y}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }
}

export function dockControlPanelForClient() {
    const panel = document.getElementById('control-panel');
    if (!panel || !isClientPanelDocked()) return;

    panel.classList.remove('panel-is-floating', 'is-drag-positioned', 'is-dragging');
    panel.style.position = '';
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.width = '';
    panel.style.margin = '';

    const header = panel.querySelector('.control-panel-header');
    if (header) header.title = 'Minimiza el panel con el botón inferior';
}

const DRIVER_EARNINGS_MIN_KEY = 'honduber_driver_earnings_minimized';

export function isDriverEarningsMinimized() {
    try {
        return localStorage.getItem(DRIVER_EARNINGS_MIN_KEY) === '1';
    } catch (_) {
        return false;
    }
}

export function setDriverEarningsMinimized(minimized) {
    try {
        if (minimized) localStorage.setItem(DRIVER_EARNINGS_MIN_KEY, '1');
        else localStorage.removeItem(DRIVER_EARNINGS_MIN_KEY);
    } catch (_) {}
}

/**
 * Pill «Viaje activo» / radar — mismo patrón que #trip-chat-float-pill:
 * cara tappable + arrastre; al tocar abre el panel del viaje.
 */
export function bindFloatingRadarPanel() {
    const wrap = document.getElementById('driver-radar-float');
    const el = wrap?.querySelector('.driver-radar-float, .driver-radar-pill');
    if (!el) return;

    // Re-bind tras cada re-render (innerHTML limpia listeners)
    if (el.dataset.floatDragBound !== '1') {
        el.dataset.floatDragBound = '1';
        const storageKey = 'driver-radar-float';
        if (!loadPosition(storageKey)) {
            el.style.position = 'fixed';
            el.style.left = '0.65rem';
            el.style.bottom = 'calc(8.25rem + env(safe-area-inset-bottom, 0px))';
            el.style.right = 'auto';
            el.style.top = 'auto';
        }

        makeDraggable(el, {
            handle: el,
            storageKey,
            minVisible: 40,
            onActivate: (node) => {
                node.style.right = 'auto';
                node.style.bottom = 'auto';
            },
            enabled: () => !wrap?.classList.contains('hidden')
        });
    }

    const face = el.querySelector('[data-radar-tap]') || el;
    if (face.dataset.radarTapBound === '1') return;
    face.dataset.radarTapBound = '1';

    const openPanel = (e) => {
        if (wasRecentPanelDrag()) return;
        if (isInteractiveTarget(e.target) && !e.target.closest?.('[data-radar-tap]')) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        // Igual de fiable que el chat: expandir panel del viaje / radar
        if (typeof window.expandDriverControlPanel === 'function') {
            window.expandDriverControlPanel();
        } else {
            window.showControlPanel?.();
        }
    };

    face.addEventListener('pointerup', openPanel, { passive: false });
    face.addEventListener('click', openPanel);
}

export function syncDriverRadarFloatPanel() {
    const wrap = document.getElementById('driver-radar-float');
    if (!wrap) return;

    const isDriver = document.body.classList.contains('driver-mode');
    const minimized = document.body.classList.contains('panel-minimized');
    const onTrip = document.body.classList.contains('trip-active')
        || document.body.classList.contains('is-navigating')
        || document.body.classList.contains('driver-nav-mode');

    // En viaje / navegación: sin pill «Viaje activo» (el panel mini-barra basta)
    if (!isDriver || !minimized || onTrip) {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
        if (isDriver && !onTrip && isDriverPanelExpanded()) {
            dockControlPanelForDriverTrip();
        }
        return;
    }

    // Solo sin viaje: atajo a ofertas cuando el panel está minimizado
    const count = Number(window._driverRadarOfferCount) || 0;
    const label = 'Clientes pidiendo viajes';
    const sub = count > 0 ? `${count} en cola` : 'Toca para abrir ofertas';
    const ico = 'fa-radar';

    wrap.classList.remove('hidden');
    wrap.innerHTML = `
        <div class="driver-radar-float driver-radar-float--min driver-radar-pill trip-chat-pill"
             title="Toca para abrir ofertas · arrastra para mover">
            <div class="trip-pill-face driver-radar-min-pill" data-radar-tap="1" role="button" tabindex="0"
                 aria-label="${label}. ${sub}">
                <i class="fas fa-grip-vertical trip-float-grip" aria-hidden="true"></i>
                <i class="fas ${ico}" aria-hidden="true"></i>
                <span>${label}</span>
                ${count > 0 ? `<span class="driver-radar-min-count">${count}</span>` : ''}
                <span class="sr-only">${sub}</span>
            </div>
        </div>
    `;
    bindFloatingRadarPanel();
}

export function bindFloatingEarningsPanel() {
    const wrap = document.getElementById('driver-earnings-float');
    const el = wrap?.querySelector('.driver-earnings-float');
    if (!el || el.dataset.floatDragBound === '1') return;
    el.dataset.floatDragBound = '1';

    const storageKey = 'driver-earnings-float';
    if (!loadPosition(storageKey)) {
        el.style.position = 'fixed';
        el.style.left = '0.65rem';
        el.style.bottom = 'calc(5.5rem + env(safe-area-inset-bottom, 0px))';
        el.style.right = 'auto';
        el.style.top = 'auto';
    }

    makeDraggable(el, {
        handle: el,
        storageKey,
        minVisible: 40,
        onActivate: (node) => {
            node.style.right = 'auto';
            node.style.bottom = 'auto';
        },
        enabled: () => !wrap?.classList.contains('hidden')
    });

    if (el.dataset.earningsExpand === '1') {
        el.addEventListener('pointerup', (e) => {
            if (wasRecentPanelDrag()) return;
            if (isInteractiveTarget(e.target)) return;
            setDriverEarningsMinimized(false);
            window.renderDriverEarningsToday?.();
        });
    }
}

const TRIP_FLOAT_MIN_KEY = 'honduber_trip_float_min_';
/** Estado en memoria (web): localStorage a veces falla o el sync reabre el PIN si solo leemos LS. */
const tripFloatMinMemory = Object.create(null);

function isTripFloatMinimized(key) {
    if (!key) return false;
    if (Object.prototype.hasOwnProperty.call(tripFloatMinMemory, key)) {
        return !!tripFloatMinMemory[key];
    }
    try {
        return localStorage.getItem(TRIP_FLOAT_MIN_KEY + key) === '1';
    } catch (_) {
        return false;
    }
}

function setTripFloatMinimized(key, minimized) {
    if (!key) return;
    tripFloatMinMemory[key] = !!minimized;
    try {
        if (minimized) localStorage.setItem(TRIP_FLOAT_MIN_KEY + key, '1');
        else localStorage.removeItem(TRIP_FLOAT_MIN_KEY + key);
    } catch (_) {}
}

function isNarrowTripFloatViewport() {
    return window.matchMedia('(max-width: 480px)').matches;
}

function defaultTripFloatPosition(el, key) {
    const narrow = isNarrowTripFloatViewport();
    const bottomSafe = 'calc(5.5rem + env(safe-area-inset-bottom, 0px))';
    const positions = {
        // Pasajero: una sola tarjeta flotante (conductor + PIN)
        'client-trip': { left: '0.65rem', top: 'max(4.75rem, calc(env(safe-area-inset-top, 0px) + 3.75rem))' },
        'client-pin': { left: '0.65rem', bottom: bottomSafe },
        'driver-arrived': { right: '0.65rem', bottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' },
        // Destino: un poco más arriba que el chat / mini-bar para no tapar el mapa
        'driver-arrived-dest': { right: '0.65rem', bottom: 'calc(7.25rem + env(safe-area-inset-bottom, 0px))' },
        'driver-pin': narrow
            ? { left: '0.65rem', right: '0.65rem', bottom: bottomSafe }
            : { right: '0.65rem', bottom: bottomSafe },
        chat: { left: '0.65rem', bottom: 'calc(8.5rem + env(safe-area-inset-bottom, 0px))' },
        'chat-pill': { right: '0.65rem', bottom: bottomSafe }
    };
    const pos = positions[key];
    if (!pos) return;
    el.style.position = 'fixed';
    el.style.left = pos.left || 'auto';
    el.style.right = pos.right || 'auto';
    if (pos.bottom) {
        el.style.bottom = pos.bottom;
        el.style.top = 'auto';
    }
    if (pos.top) {
        el.style.top = pos.top;
        el.style.bottom = 'auto';
    }
    if (narrow && key === 'driver-pin') {
        el.style.maxWidth = 'none';
        el.style.width = 'auto';
    }
    if (key === 'client-trip' || key === 'client-pin') {
        el.style.right = 'auto';
        el.style.width = 'auto';
        el.style.maxWidth = narrow
            ? 'min(300px, calc(100vw - 1.3rem))'
            : 'min(320px, calc(100vw - 1.3rem))';
    }
}

function dockTripFloat(el, key) {
    if (!el || !key) return;
    const storageKey = `trip-float-${key}`;
    clearSavedPosition(storageKey);
    el.classList.remove('is-drag-positioned', 'is-dragging');
    el.style.margin = '';
    defaultTripFloatPosition(el, key);
    el.classList.add('trip-float--fixed');
}

function getTripFloatDragHandle(el, key) {
    if (key === 'chat' || key === 'client-pin' || key === 'client-trip' || key === 'driver-pin') {
        return el.querySelector('.trip-float-head') || el;
    }
    return el;
}

function runTripFloatTapAction(action) {
    if (action === 'toggle-chat') window.toggleChat?.();
    else if (action === 'arrived') {
        const btn = document.getElementById('btn-driver-arrived');
        if (btn?.classList.contains('is-disabled') || btn?.getAttribute('aria-disabled') === 'true') {
            window.showToast?.('El botón se activa cuando estés a 1 km o menos del pasajero.');
            return;
        }
        window.markArrival?.();
    } else if (action === 'arrived-dest') {
        // Toast de distancia / GPS lo maneja driverSignalDestinationArrival
        window.driverSignalDestinationArrival?.();
    }
}

function bindTripChatUi() {
    const form = document.getElementById('chat-compose-form');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const chatFloat = document.getElementById('chat-float');

    const fireSend = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.sendChatMessage?.();
    };

    if (form && form.dataset.chatBound !== '1') {
        form.dataset.chatBound = '1';
        form.addEventListener('submit', fireSend, { passive: false });
        form.addEventListener('pointerdown', (e) => e.stopPropagation(), { passive: true });
    }

    if (sendBtn && sendBtn.dataset.chatBound !== '1') {
        sendBtn.dataset.chatBound = '1';
        sendBtn.addEventListener('touchend', fireSend, { passive: false });
        sendBtn.addEventListener('pointerup', fireSend, { passive: false });
    }

    if (input && input.dataset.chatBound !== '1') {
        input.dataset.chatBound = '1';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                window.sendChatMessage?.();
            }
        });
        input.addEventListener('pointerdown', (e) => e.stopPropagation(), { passive: true });
        input.addEventListener('focus', () => {
            window.setTimeout(() => {
                input.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            }, 280);
        });
    }

    if (chatFloat && chatFloat.dataset.chatStopDrag !== '1') {
        chatFloat.dataset.chatStopDrag = '1';
        chatFloat.addEventListener('pointerdown', (e) => {
            if (e.target.closest('#chat-compose-form, #chat-input, #chat-send-btn, #chat-messages, .trip-chat-compose')) {
                e.stopPropagation();
            }
        }, true);
    }
}

export function bindFloatingTripPanels() {
    bindTripChatUi();

    const layer = document.getElementById('trip-floats-layer');
    if (!layer) return;

    const floats = layer.querySelectorAll('[data-trip-float]');
    floats.forEach((el) => {
        if (el.dataset.floatDragBound === '1') return;
        el.dataset.floatDragBound = '1';

        const key = el.dataset.tripFloat || 'trip-float';
        const storageKey = `trip-float-${key}`;

        if (TRIP_FLOAT_FIXED_KEYS.has(key)) {
            dockTripFloat(el, key);
            return;
        }

        const dragHandle = getTripFloatDragHandle(el, key);
        if (!loadPosition(storageKey)) {
            defaultTripFloatPosition(el, key);
        }

        // Pastilla de chat / flotantes: se mueven por toda la pantalla; queda un trozo visible en el borde
        const isChatPill = key === 'chat-pill';
        makeDraggable(el, {
            handle: dragHandle,
            storageKey,
            minVisible: isChatPill ? 48 : 40,
            onActivate: (node) => {
                node.style.right = 'auto';
                node.style.bottom = 'auto';
                node.style.margin = '0';
            },
            enabled: () => !layer.classList.contains('hidden') && !el.classList.contains('hidden')
        });
    });

    layer.querySelectorAll('[data-trip-float-tap]').forEach((el) => {
        if (el.dataset.tapBound === '1') return;
        el.dataset.tapBound = '1';
        el.addEventListener('pointerup', (e) => {
            if (wasRecentPanelDrag()) return;
            if (isInteractiveTarget(e.target)) return;
            const action = el.dataset.tripFloatTap;
            if (action) runTripFloatTapAction(action);
        });
    });

    layer.querySelectorAll('[data-trip-float-min]').forEach((btn) => {
        if (btn.dataset.minBound === '1') return;
        btn.dataset.minBound = '1';
        const minimize = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            const key = btn.dataset.tripFloatMin;
            if (key) toggleTripFloatMinimized(key, true);
        };
        // capture + pointerdown/up/click: en web a veces el click se pierde o el drag lo cancela
        btn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        }, { capture: true, passive: true });
        btn.addEventListener('pointerup', minimize, { capture: true });
        btn.addEventListener('click', minimize, { capture: true });
    });

    layer.querySelectorAll('[data-trip-float-expand]').forEach((el) => {
        if (el.dataset.expandBound === '1') return;
        el.dataset.expandBound = '1';
        el.addEventListener('pointerup', (e) => {
            if (wasRecentPanelDrag()) return;
            if (isInteractiveTarget(e.target) && !e.target.closest?.('[data-trip-float-expand]')) return;
            const key = el.dataset.tripFloatExpand;
            if (key) toggleTripFloatMinimized(key, false);
        });
        el.addEventListener('click', (e) => {
            if (wasRecentPanelDrag()) return;
            if (isInteractiveTarget(e.target) && !e.target.closest?.('[data-trip-float-expand]')) return;
            const key = el.dataset.tripFloatExpand;
            if (key) toggleTripFloatMinimized(key, false);
        });
    });
}

export function toggleTripFloatMinimized(key, minimized) {
    setTripFloatMinimized(key, minimized);
    const floatEl = document.querySelector(`[data-trip-float="${key}"]`);
    if (floatEl) {
        applyTripFloatMinState(floatEl, key, minimized);
        // Pill minimizado: re-anclar tamaño compacto sin perder preferencia del usuario
        if (minimized) {
            floatEl.style.width = 'auto';
            floatEl.style.maxWidth = '';
            if (key === 'driver-pin') {
                // Mantener esquina inferior derecha en web/móvil
                floatEl.style.left = 'auto';
                floatEl.style.right = '0.65rem';
                floatEl.style.bottom = 'calc(5.5rem + env(safe-area-inset-bottom, 0px))';
                floatEl.style.top = 'auto';
            } else {
                floatEl.style.right = 'auto';
            }
        } else if (key === 'client-pin' || key === 'client-trip' || key === 'driver-pin') {
            defaultTripFloatPosition(floatEl, key);
        }
    } else {
        window.syncTripFloatPanels?.(window.currentActiveTripData);
    }
}

function applyTripFloatMinState(floatEl, key, minimized) {
    if (!floatEl) return;
    floatEl.classList.toggle('trip-float--min', !!minimized);
    floatEl.setAttribute('data-min', minimized ? '1' : '0');
    const minView = floatEl.querySelector('.trip-float-min-view');
    const fullView = floatEl.querySelector('.trip-float-full-view');
    if (minView) {
        minView.classList.toggle('hidden', !minimized);
        minView.style.display = minimized ? '' : 'none';
    }
    if (fullView) {
        fullView.classList.toggle('hidden', !!minimized);
        fullView.style.display = minimized ? 'none' : '';
    }
    // Si está minimizado, no dejar que el hero del PIN force foco/teclado
    if (minimized && key === 'driver-pin') {
        try { document.getElementById('driver-pin-input')?.blur?.(); } catch (_) {}
    }
}

export function syncTripFloatPanels(data) {
    const layer = document.getElementById('trip-floats-layer');
    if (!layer) return;

    const isTripActive = document.body.classList.contains('trip-active');
    const role = window.userProfile?.role;
    const isDriver = role === 'driver';
    const isClient = role === 'client';
    const isMine = !!data && (
        (isDriver && document.body.classList.contains('driver-mode'))
        || (isClient && document.body.classList.contains('client-mode'))
    );
    const inTrip = isTripActive && isMine && data && ['accepted', 'in_progress'].includes(data.status);

    if (!inTrip) {
        layer.classList.add('hidden');
        document.getElementById('client-trip-float')?.classList.add('hidden');
        document.getElementById('client-pin-float')?.classList.add('hidden');
        document.getElementById('driver-arrived-float')?.classList.add('hidden');
        document.getElementById('driver-arrived-dest-float')?.classList.add('hidden');
        document.getElementById('driver-pin-float')?.classList.add('hidden');
        document.getElementById('trip-chat-float-pill')?.classList.add('hidden');
        document.getElementById('chat-float')?.classList.add('hidden');
        document.body.classList.remove('trip-chat-open', 'passenger-trip-float-active');
        return;
    }

    layer.classList.remove('hidden');
    bindFloatingTripPanels();

    const clientTripFloat = document.getElementById('client-trip-float');
    const clientPinDisplay = document.getElementById('client-pin-display');
    const driverArrivedFloat = document.getElementById('driver-arrived-float');
    const driverArrivedDestFloat = document.getElementById('driver-arrived-dest-float');
    const driverPinFloat = document.getElementById('driver-pin-float');
    const driverPinHero = document.getElementById('driver-pin-hero');
    const pinInputGroup = document.getElementById('pin-input-group');
    const chatPill = document.getElementById('trip-chat-float-pill');
    const chatFloat = document.getElementById('chat-float');

    // Un solo flotante pasajero: datos del conductor + PIN (si aplica)
    const showClientTrip = isClient
        && !!data.driverId
        && ['accepted', 'in_progress'].includes(data.status);
    const showClientPin = showClientTrip
        && data.status === 'accepted'
        && !!data.pin;

    if (clientTripFloat) {
        if (showClientTrip) {
            document.body.classList.add('passenger-trip-float-active');
            if (clientPinDisplay) {
                clientPinDisplay.classList.toggle('hidden', !showClientPin);
            }
            const minPin = document.getElementById('client-pin-min-label');
            if (minPin) {
                if (showClientPin) {
                    minPin.textContent = `PIN ${String(data.pin || '')}`;
                    minPin.classList.remove('hidden');
                } else {
                    minPin.classList.add('hidden');
                }
            }
            const clientMin = isTripFloatMinimized('client-trip');
            applyTripFloatMinState(clientTripFloat, 'client-trip', clientMin);
            clientTripFloat.classList.remove('hidden');
            if (!clientMin && !clientTripFloat.classList.contains('is-drag-positioned')) {
                dockTripFloat(clientTripFloat, 'client-trip');
            }
            if (clientMin) {
                clientTripFloat.style.width = 'auto';
                clientTripFloat.style.maxWidth = '';
                clientTripFloat.style.right = 'auto';
            }
            // Rellenar datos del conductor en el flotante
            try { window.syncClientTripFloat?.(data); } catch (_) {}
        } else {
            clientTripFloat.classList.add('hidden');
            clientPinDisplay?.classList.add('hidden');
            document.body.classList.remove('passenger-trip-float-active');
        }
    }

    const showDriverArrived = isDriver
        && data.status === 'accepted'
        && !data.driverArrived;

    const showDriverArrivedDest = isDriver
        && data.status === 'in_progress';

    const showDriverPin = isDriver
        && data.status === 'accepted'
        && !!data.driverArrived;

    if (driverArrivedFloat) {
        driverArrivedFloat.classList.toggle('hidden', !showDriverArrived);
        if (showDriverArrived) {
            window.syncDriverPickupArrivalUi?.();
        }
    }

    if (driverArrivedDestFloat) {
        driverArrivedDestFloat.classList.toggle('hidden', !showDriverArrivedDest);
        if (showDriverArrivedDest) {
            window.syncDriverDestinationArrivalUi?.();
        }
    }

    if (driverPinFloat && driverPinHero) {
        if (showDriverPin) {
            const driverMin = isTripFloatMinimized('driver-pin');
            // Siempre mostrar controles de PIN (iniciar / sin PIN) aunque esté minimizado el float
            pinInputGroup?.classList.remove('hidden');
            driverPinHero.classList.remove('hidden');
            // Solo re-anclar posición si NO está minimizado
            if (!driverMin) {
                dockTripFloat(driverPinFloat, 'driver-pin');
            }
            applyTripFloatMinState(driverPinFloat, 'driver-pin', driverMin);
            driverPinFloat.classList.remove('hidden');
            // Asegurar que los botones no queden bajo el drag
            driverPinFloat.querySelectorAll('[data-trip-action], button, input').forEach((el) => {
                el.setAttribute('data-no-drag', '');
            });
            if (!driverMin) {
                window.setTimeout(() => {
                    if (isTripFloatMinimized('driver-pin')) return;
                    document.getElementById('driver-pin-input')?.focus?.();
                }, 280);
            }
        } else {
            driverPinFloat.classList.add('hidden');
            driverPinHero.classList.add('hidden');
            pinInputGroup?.classList.add('hidden');
            // Al salir de la fase PIN, limpiar min para el próximo viaje
            setTripFloatMinimized('driver-pin', false);
            applyTripFloatMinState(driverPinFloat, 'driver-pin', false);
        }
    }

    // Chat visible para pasajero y conductor en accepted / in_progress (incluye espera de PIN)
    chatPill?.classList.remove('hidden');
    if (isDriver) {
        // Asegurar pastilla de chat usable y por encima del panel inferior
        chatPill?.classList.add('trip-chat-pill--driver');
        document.getElementById('driver-active-tools')?.classList.remove('hidden');
    } else {
        chatPill?.classList.remove('trip-chat-pill--driver');
    }
    if (window.chatOpen) {
        chatFloat?.classList.remove('hidden');
        document.body.classList.add('trip-chat-open');
    } else {
        chatFloat?.classList.add('hidden');
        document.body.classList.remove('trip-chat-open');
    }
}

export function hideTripFloatPanels() {
    syncTripFloatPanels(null);
    window.chatOpen = false;
}

export function bindFloatingObjectivePanels() {
    const floats = document.querySelectorAll('#driver-objectives-active .driver-obj-float');
    floats.forEach((el, idx) => {
        if (el.dataset.floatDragBound === '1') return;
        el.dataset.floatDragBound = '1';

        const objId = el.dataset.objId || `idx-${idx}`;
        const storageKey = `driver-obj-${objId}`;
        if (!loadPosition(storageKey)) {
            const stackOffset = idx * 8;
            el.style.position = 'fixed';
            el.style.right = '0.65rem';
            el.style.bottom = `calc(${5.5 + stackOffset}rem + env(safe-area-inset-bottom, 0px))`;
            el.style.left = 'auto';
            el.style.top = 'auto';
        }

        makeDraggable(el, {
            handle: el,
            storageKey,
            minVisible: 40,
            onActivate: (node) => {
                node.style.right = 'auto';
                node.style.bottom = 'auto';
            },
            enabled: () => !document.getElementById('driver-objectives-active')?.classList.contains('hidden')
        });

        if (el.dataset.objExpand === '1') {
            el.addEventListener('pointerup', (e) => {
                if (wasRecentPanelDrag()) return;
                if (isInteractiveTarget(e.target)) return;
                const id = el.dataset.objId;
                if (id) window.toggleDriverObjectiveMinimized?.(id, false);
            });
        }
    });
}

/** Posición por defecto: alterna izquierda/derecha y apila en vertical para ver varias copas a la vez. */
function defaultCopaFloatPosition(el, idx, side = 'left') {
    el.style.position = 'fixed';
    el.style.top = 'auto';
    const row = Math.floor(idx / 2);
    const col = idx % 2;
    const useLeft = side === 'left' ? col === 0 : col === 1;
    if (useLeft) {
        el.style.left = '0.65rem';
        el.style.right = 'auto';
    } else {
        el.style.right = '0.65rem';
        el.style.left = 'auto';
    }
    // Fila 0 cerca del bottom; fila 1 más arriba para no taparse
    const bottomRem = 5.5 + row * 12.5;
    el.style.bottom = `calc(${bottomRem}rem + env(safe-area-inset-bottom, 0px))`;
    el.style.zIndex = String(27980 + idx);
}

export function bindFloatingCopaPanels() {
    const floats = document.querySelectorAll('#driver-copa-active .copa-float');
    floats.forEach((el, idx) => {
        // Re-bind tras cada re-render (innerHTML limpia el DOM)
        const copaId = el.dataset.copaId || `idx-${idx}`;
        const storageKey = `driver-copa-${copaId}`;
        if (el.dataset.floatDragBound !== '1') {
            el.dataset.floatDragBound = '1';
            if (!loadPosition(storageKey)) {
                defaultCopaFloatPosition(el, idx, 'left');
            }

            makeDraggable(el, {
                handle: el,
                storageKey,
                minVisible: 40,
                onActivate: (node) => {
                    node.style.right = 'auto';
                    node.style.bottom = 'auto';
                },
                enabled: () => !document.getElementById('driver-copa-active')?.classList.contains('hidden')
            });

            if (el.dataset.copaExpand === '1') {
                el.addEventListener('pointerup', (e) => {
                    if (wasRecentPanelDrag()) return;
                    if (isInteractiveTarget(e.target)) return;
                    const id = el.dataset.copaId;
                    if (id) window.toggleCopaMinimized?.(id, false);
                });
            }
        } else if (!loadPosition(storageKey) && !el.style.left && !el.style.right) {
            defaultCopaFloatPosition(el, idx, 'left');
        }
    });
}

export function bindFloatingPassengerCopaPanels() {
    const floats = document.querySelectorAll('#passenger-copa-active .copa-float');
    floats.forEach((el, idx) => {
        const copaId = el.dataset.copaId || `idx-${idx}`;
        const storageKey = `passenger-copa-${copaId}`;
        if (el.dataset.floatDragBound !== '1') {
            el.dataset.floatDragBound = '1';
            if (!loadPosition(storageKey)) {
                defaultCopaFloatPosition(el, idx, 'right');
            }

            makeDraggable(el, {
                handle: el,
                storageKey,
                minVisible: 40,
                onActivate: (node) => {
                    node.style.right = 'auto';
                    node.style.bottom = 'auto';
                },
                enabled: () => !document.getElementById('passenger-copa-active')?.classList.contains('hidden')
            });

            if (el.dataset.copaExpand === '1') {
                el.addEventListener('pointerup', (e) => {
                    if (wasRecentPanelDrag()) return;
                    if (isInteractiveTarget(e.target)) return;
                    const id = el.dataset.copaId;
                    if (id) window.togglePassengerCopaMinimized?.(id, false);
                });
            }
        } else if (!loadPosition(storageKey) && !el.style.left && !el.style.right) {
            defaultCopaFloatPosition(el, idx, 'right');
        }
    });
}

export function bindNavHudTopPanel() {
    const hud = document.getElementById('nav-hud-top');
    if (!hud || hud.dataset.floatDragBound === '1') return;
    hud.dataset.floatDragBound = '1';

    if (!loadPosition('nav-hud-top')) {
        const w = Math.min(480, window.innerWidth * 0.92);
        const x = Math.max(8, (window.innerWidth - w) / 2);
        const defaultTop = 12;
        hud.style.position = 'fixed';
        hud.style.left = `${x}px`;
        hud.style.top = `${defaultTop}px`;
        hud.style.right = 'auto';
        hud.style.bottom = 'auto';
        hud.style.transform = 'none';
        hud.style.width = `${w}px`;
        hud.classList.add('is-drag-positioned');
    }

    makeDraggable(hud, {
        handle: hud,
        storageKey: 'nav-hud-top',
        minVisible: 48,
        onActivate: (node) => {
            node.style.transform = 'none';
            node.style.right = 'auto';
            node.style.bottom = 'auto';
            if (!node.style.width) {
                node.style.width = 'min(480px, calc(100vw - 1.5rem))';
            }
        },
        enabled: () => document.body.classList.contains('is-navigating')
    });
}

export function initFloatingPanels() {
    if (typeof window === 'undefined') return;

    bindTripChatUi();

    window.wasRecentPanelDrag = wasRecentPanelDrag;
    window.bindFloatingObjectivePanels = bindFloatingObjectivePanels;
    window.bindFloatingCopaPanels = bindFloatingCopaPanels;
    window.bindFloatingPassengerCopaPanels = bindFloatingPassengerCopaPanels;
    window.bindFloatingDriverCopaMapStrip = bindFloatingDriverCopaMapStrip;
    window.bindFloatingTripPanels = bindFloatingTripPanels;
    window.syncTripFloatPanels = syncTripFloatPanels;
    window.hideTripFloatPanels = hideTripFloatPanels;
    window.toggleTripFloatMinimized = toggleTripFloatMinimized;
    window.bindFloatingEarningsPanel = bindFloatingEarningsPanel;
    window.bindFloatingRadarPanel = bindFloatingRadarPanel;
    window.syncDriverRadarFloatPanel = syncDriverRadarFloatPanel;
    window.isDriverEarningsMinimized = isDriverEarningsMinimized;
    window.toggleDriverEarningsMinimized = (minimized) => {
        setDriverEarningsMinimized(minimized);
        window.renderDriverEarningsToday?.();
    };
    window.bindNavHudTopPanel = bindNavHudTopPanel;
    bindNavHudTopPanel();

    const panel = document.getElementById('control-panel');
    if (panel) {
        if (isClientPanelDocked()) {
            dockControlPanelForClient();
        } else if (isDriverPanelDocked()) {
            dockControlPanelForDriverTrip();
        } else {
            const saved = loadPosition('control-panel');
            if (saved) {
                panel.classList.add('panel-is-floating', 'is-drag-positioned');
                panel.style.position = 'fixed';
                panel.style.width = 'min(380px, calc(100vw - 1.5rem))';
                panel.style.left = `${saved.x}px`;
                panel.style.top = `${saved.y}px`;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
            }
        }

        makeDraggable(panel, {
            handle: panel,
            storageKey: 'control-panel',
            minVisible: 72,
            onActivate: () => activateControlPanelFloating(panel),
            enabled: () => !panel.classList.contains('panel-hidden')
                && !isClientPanelDocked()
                && !isDriverPanelDocked()
        });
    }

    window.dockControlPanelForClient = dockControlPanelForClient;
    window.dockControlPanelForDriverTrip = dockControlPanelForDriverTrip;
    window.restoreControlPanelAfterDriverTrip = restoreControlPanelAfterDriverTrip;

    window.addEventListener('resize', () => {
        const p = document.getElementById('control-panel');
        if (isClientPanelDocked()) {
            dockControlPanelForClient();
            return;
        }
        if (isDriverPanelExpanded()) {
            dockControlPanelForDriverTrip();
            return;
        }
        if (document.body.classList.contains('driver-mode')) {
            syncDriverRadarFloatPanel();
            return;
        }
        if (!p?.classList.contains('is-drag-positioned')) return;
        const rect = p.getBoundingClientRect();
        applyPosToControlPanel(p, rect.left, rect.top);
        bindFloatingObjectivePanels();
        bindFloatingTripPanels();
    });

    bindFloatingTripPanels();
    bindPassengerPromoStrip();
    bindFloatingDriverCopaMapStrip();
}

/**
 * Copa conductor en mapa — mismo arrastre que promos de pasajero
 * (grip mueve; ✕ y chips no inician drag).
 */
export function bindFloatingDriverCopaMapStrip() {
    const strip = document.getElementById('driver-copa-map-strip');
    if (!strip || strip.dataset.copaMapDragBound === '1') return;

    const grip = strip.querySelector('[data-copa-map-drag-handle], .passenger-promo-drag-handle');
    if (!grip) return;
    strip.dataset.copaMapDragBound = '1';

    const storageKey = 'driver-copa-map-strip';

    const isStripVisible = () =>
        !strip.classList.contains('hidden')
        && strip.style.display !== 'none'
        && document.body.classList.contains('driver-mode');

    const activate = (el) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.position = 'fixed';
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.top}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.width = `${Math.min(rect.width || 200, window.innerWidth - 12)}px`;
        el.style.maxWidth = 'min(16.5rem, calc(100vw - 0.75rem))';
        el.classList.add('is-drag-positioned');
    };

    const clampToViewport = () => {
        if (!strip.classList.contains('is-drag-positioned') || !isStripVisible()) return;
        const rect = strip.getBoundingClientRect();
        const w = strip.offsetWidth || 160;
        const h = strip.offsetHeight || 48;
        const x = clamp(rect.left, -w + 40, window.innerWidth - 40);
        const y = clamp(rect.top, 0, window.innerHeight - 40);
        strip.style.left = `${x}px`;
        strip.style.top = `${y}px`;
        strip.style.right = 'auto';
        strip.style.bottom = 'auto';
        savePosition(storageKey, x, y);
    };

    const saved = loadPosition(storageKey);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        activate(strip);
        strip.style.left = `${saved.x}px`;
        strip.style.top = `${saved.y}px`;
        strip.classList.add('is-drag-positioned');
        requestAnimationFrame(clampToViewport);
    }

    let dragState = null;

    const pointFromEvent = (e) => {
        if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches[0]) {
            return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    };

    const onGripDown = (e) => {
        if (!isStripVisible()) return;
        if (e.type === 'mousedown' && e.button !== 0) return;
        if (e.target?.closest?.('.passenger-promo-close, [data-copa-close], .copa-chip, [data-no-drag]')) {
            return;
        }
        const p = pointFromEvent(e);
        const rect = strip.getBoundingClientRect();
        dragState = {
            startX: p.x,
            startY: p.y,
            origX: rect.left,
            origY: rect.top,
            moved: false,
            pointerId: e.pointerId
        };
        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
        try {
            if (e.pointerId != null) grip.setPointerCapture?.(e.pointerId);
        } catch (_) {}
    };

    const onGripMove = (e) => {
        if (!dragState) return;
        if (dragState.pointerId != null && e.pointerId != null && e.pointerId !== dragState.pointerId) return;
        const p = pointFromEvent(e);
        const dx = p.x - dragState.startX;
        const dy = p.y - dragState.startY;
        if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (!dragState.moved) {
            dragState.moved = true;
            activate(strip);
            strip.classList.add('is-dragging');
        }
        try { e.preventDefault(); } catch (_) {}
        const w = strip.offsetWidth || 160;
        const x = clamp(dragState.origX + dx, -w + 40, window.innerWidth - 40);
        const y = clamp(dragState.origY + dy, 0, window.innerHeight - 40);
        strip.style.position = 'fixed';
        strip.style.left = `${x}px`;
        strip.style.top = `${y}px`;
        strip.style.right = 'auto';
        strip.style.bottom = 'auto';
        strip.style.margin = '0';
    };

    const onGripUp = (e) => {
        if (!dragState) return;
        if (dragState.pointerId != null && e.pointerId != null && e.pointerId !== dragState.pointerId) return;
        if (dragState.moved) {
            markRecentDrag();
            const rect = strip.getBoundingClientRect();
            savePosition(storageKey, rect.left, rect.top);
            try { e.preventDefault(); } catch (_) {}
            try { e.stopPropagation(); } catch (_) {}
        }
        strip.classList.remove('is-dragging');
        try {
            if (dragState.pointerId != null) grip.releasePointerCapture?.(dragState.pointerId);
        } catch (_) {}
        dragState = null;
    };

    if (typeof window.PointerEvent === 'function') {
        grip.addEventListener('pointerdown', onGripDown, { passive: false });
        window.addEventListener('pointermove', onGripMove, { passive: false });
        window.addEventListener('pointerup', onGripUp, { passive: false });
        window.addEventListener('pointercancel', onGripUp, { passive: false });
    } else {
        grip.addEventListener('touchstart', onGripDown, { passive: false });
        window.addEventListener('touchmove', onGripMove, { passive: false });
        window.addEventListener('touchend', onGripUp, { passive: false });
        window.addEventListener('touchcancel', onGripUp, { passive: false });
        grip.addEventListener('mousedown', onGripDown);
        window.addEventListener('mousemove', onGripMove);
        window.addEventListener('mouseup', onGripUp);
    }

    grip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener('orientationchange', () => setTimeout(clampToViewport, 180), { passive: true });
    window.addEventListener('resize', () => {
        if (strip.classList.contains('is-drag-positioned')) clampToViewport();
    }, { passive: true });
}

function bindPassengerPromoStrip() {
    const strip = document.getElementById('passenger-promo-strip');
    if (!strip || strip.dataset.promoDragBound === '1') return;
    strip.dataset.promoDragBound = '1';

    const grip = strip.querySelector('[data-promo-drag-handle], .passenger-promo-drag-handle') || strip;
    const storageKey = 'passenger-promo-strip';

    const isStripVisible = () =>
        !strip.classList.contains('hidden')
        && strip.style.display !== 'none'
        && !document.body.classList.contains('driver-mode')
        && !document.body.classList.contains('trip-active')
        && !document.body.classList.contains('is-searching');

    const activate = (el) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.position = 'fixed';
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.top}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.width = `${Math.min(rect.width || 180, window.innerWidth - 12)}px`;
        el.style.maxWidth = 'min(16.5rem, calc(100vw - 0.75rem))';
        el.classList.add('is-drag-positioned');
    };

    const clampToViewport = () => {
        if (!strip.classList.contains('is-drag-positioned') || !isStripVisible()) return;
        const rect = strip.getBoundingClientRect();
        const w = strip.offsetWidth || 160;
        const h = strip.offsetHeight || 48;
        const x = clamp(rect.left, -w + 40, window.innerWidth - 40);
        const y = clamp(rect.top, 0, window.innerHeight - 40);
        strip.style.left = `${x}px`;
        strip.style.top = `${y}px`;
        strip.style.right = 'auto';
        strip.style.bottom = 'auto';
        savePosition(storageKey, x, y);
    };

    // Restore saved place early so it does not jump when promos load
    const saved = loadPosition(storageKey);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        activate(strip);
        strip.style.left = `${saved.x}px`;
        strip.style.top = `${saved.y}px`;
        strip.classList.add('is-drag-positioned');
        requestAnimationFrame(clampToViewport);
    }

    // Arrastre dedicado (más fiable en WebView Android que solo pointer en el grip)
    let dragState = null;

    const pointFromEvent = (e) => {
        if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches[0]) {
            return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    };

    const onGripDown = (e) => {
        if (!isStripVisible()) return;
        if (e.type === 'mousedown' && e.button !== 0) return;
        // No iniciar drag si el toque es la X u otra zona interactiva
        if (e.target?.closest?.('.passenger-promo-close, #passenger-promo-close, .passenger-promo-card, [data-no-drag]')) {
            return;
        }
        const p = pointFromEvent(e);
        const rect = strip.getBoundingClientRect();
        dragState = {
            startX: p.x,
            startY: p.y,
            origX: rect.left,
            origY: rect.top,
            moved: false,
            pointerId: e.pointerId
        };
        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
        try {
            if (e.pointerId != null) grip.setPointerCapture?.(e.pointerId);
        } catch (_) {}
    };

    const onGripMove = (e) => {
        if (!dragState) return;
        if (dragState.pointerId != null && e.pointerId != null && e.pointerId !== dragState.pointerId) return;
        const p = pointFromEvent(e);
        const dx = p.x - dragState.startX;
        const dy = p.y - dragState.startY;
        if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (!dragState.moved) {
            dragState.moved = true;
            activate(strip);
            strip.classList.add('is-dragging');
        }
        try { e.preventDefault(); } catch (_) {}
        const w = strip.offsetWidth || 160;
        const h = strip.offsetHeight || 48;
        const x = clamp(dragState.origX + dx, -w + 40, window.innerWidth - 40);
        const y = clamp(dragState.origY + dy, 0, window.innerHeight - 40);
        strip.style.position = 'fixed';
        strip.style.left = `${x}px`;
        strip.style.top = `${y}px`;
        strip.style.right = 'auto';
        strip.style.bottom = 'auto';
        strip.style.margin = '0';
    };

    const onGripUp = (e) => {
        if (!dragState) return;
        if (dragState.pointerId != null && e.pointerId != null && e.pointerId !== dragState.pointerId) return;
        const wasMoved = dragState.moved;
        if (wasMoved) {
            markRecentDrag();
            const rect = strip.getBoundingClientRect();
            savePosition(storageKey, rect.left, rect.top);
            try { e.preventDefault(); } catch (_) {}
            try { e.stopPropagation(); } catch (_) {}
        }
        strip.classList.remove('is-dragging');
        try {
            if (dragState.pointerId != null) grip.releasePointerCapture?.(dragState.pointerId);
        } catch (_) {}
        dragState = null;
    };

    // Pointer Events en Android moderno; touch como fallback (sin duplicar ambos)
    if (typeof window.PointerEvent === 'function') {
        grip.addEventListener('pointerdown', onGripDown, { passive: false });
        window.addEventListener('pointermove', onGripMove, { passive: false });
        window.addEventListener('pointerup', onGripUp, { passive: false });
        window.addEventListener('pointercancel', onGripUp, { passive: false });
    } else {
        grip.addEventListener('touchstart', onGripDown, { passive: false });
        window.addEventListener('touchmove', onGripMove, { passive: false });
        window.addEventListener('touchend', onGripUp, { passive: false });
        window.addEventListener('touchcancel', onGripUp, { passive: false });
        grip.addEventListener('mousedown', onGripDown);
        window.addEventListener('mousemove', onGripMove);
        window.addEventListener('mouseup', onGripUp);
    }

    grip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener('orientationchange', () => setTimeout(clampToViewport, 180), { passive: true });
    window.addEventListener('resize', () => {
        if (strip.classList.contains('is-drag-positioned')) clampToViewport();
    }, { passive: true });
}