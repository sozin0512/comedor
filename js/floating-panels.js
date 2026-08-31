/**
 * Paneles flotantes arrastrables — panel central y objetivos del conductor
 */

const STORAGE_PREFIX = 'honduber_panel_pos_';
let recentDragUntil = 0;

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

/** Insets del sistema (MainActivity → --safe-* / --native-safe-*). Estilo WhatsApp. */
function readSafeInsets() {
    try {
        const root = getComputedStyle(document.documentElement);
        const body = document.body ? getComputedStyle(document.body) : root;
        const px = (style, name) => {
            const n = parseFloat(String(style.getPropertyValue(name) || '').trim());
            return Number.isFinite(n) ? n : 0;
        };
        // --safe-top en :root es env() (0 en WebView Android). El real está en
        // --native-safe-top (html) o --safe-top de body.capacitor-android.
        let top = Math.max(
            px(root, '--native-safe-top'),
            px(body, '--native-safe-top'),
            px(body, '--safe-top'),
            px(root, '--safe-top')
        );
        let bottom = Math.max(
            px(root, '--native-safe-bottom'),
            px(body, '--native-safe-bottom'),
            px(body, '--safe-bottom'),
            px(root, '--safe-bottom')
        );
        const left = Math.max(px(root, '--native-safe-left'), px(body, '--safe-left'), px(root, '--safe-left'));
        const right = Math.max(px(root, '--native-safe-right'), px(body, '--safe-right'), px(root, '--safe-right'));
        const android = document.body?.classList.contains('capacitor-android')
            || document.documentElement.classList.contains('capacitor-android');
        if (android && top < 32) top = 32;
        if (android && bottom < 8) bottom = 8;
        return {
            top: Math.max(0, top),
            bottom: Math.max(0, bottom),
            left: Math.max(0, left),
            right: Math.max(0, right)
        };
    } catch (_) {
        return { top: 0, bottom: 0, left: 0, right: 0 };
    }
}

function cssSafeBottom(extraRem) {
    if (extraRem) {
        return `calc(${extraRem} + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))`;
    }
    return `var(--safe-bottom, env(safe-area-inset-bottom, 0px))`;
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
    // Burbuja azul “tocar para maximizar”: no arrastrar, solo expandir
    if (el?.closest?.('[data-trip-float-expand], .client-trip-min-pill, .trip-float-min-view')) return true;
    // Botón minimizar del flotante
    if (el?.closest?.('[data-trip-float-min], .trip-float-min-btn, .driver-earnings-min-btn')) return true;
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
        keepFullyVisible = false,
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
        let h = element.offsetHeight || 120;
        // No entrar bajo el reloj / notch / barra de gestos (como WhatsApp)
        const insets = readSafeInsets();
        const edge = 8;
        const android = document.body?.classList.contains('capacitor-android')
            || document.documentElement.classList.contains('capacitor-android');
        const extraTop = android ? 6 : 0;
        const safeL = edge + insets.left;
        const safeT = edge + insets.top + extraTop;
        const safeR = window.innerWidth - edge - insets.right;
        let extraBottom = 0;
        if (element.classList.contains('driver-earnings-float')) {
            const panel = document.getElementById('control-panel');
            if (panel && !panel.classList.contains('hidden')) {
                try {
                    const pr = panel.getBoundingClientRect();
                    const vis = pr.height > 8 && getComputedStyle(panel).display !== 'none';
                    if (vis) extraBottom = Math.max(0, (window.innerHeight || 0) - pr.top + 10);
                } catch (_) {}
            }
        }
        const safeB = window.innerHeight - edge - insets.bottom - extraBottom;
        const availH = Math.max(120, safeB - safeT);

        // Si el panel es más alto que la zona útil: acotar altura y scrollear dentro
        // (si no, al pegarlo arriba el final queda fuera de la pantalla)
        if (h > availH) {
            element.style.maxHeight = `${availH}px`;
            element.style.overflowY = 'auto';
            element.style.webkitOverflowScrolling = 'touch';
            // Forzar reflow y re-medir
            h = Math.min(element.offsetHeight || availH, availH);
        }

        const cx = keepFullyVisible
            ? clamp(x, safeL, Math.max(safeL, safeR - w))
            : clamp(x, safeL - w + minVisible, safeR - minVisible);
        // Mantener el panel ENTERO visible cuando quepa (no solo minVisible abajo)
        const cyMax = Math.max(safeT, safeB - h);
        const cy = clamp(y, safeT, cyMax);

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
    let h = panel.offsetHeight || 200;
    const insets = readSafeInsets();
    const edge = 8;
    const safeL = edge + insets.left;
    const safeT = edge + insets.top;
    const safeR = window.innerWidth - edge - insets.right;
    const safeB = window.innerHeight - edge - insets.bottom;
    const availH = Math.max(160, safeB - safeT);

    // No dejar que el panel flotante sea más alto que la pantalla útil
    if (h > availH) {
        panel.style.maxHeight = `${availH}px`;
        panel.style.overflow = 'hidden';
        const content = panel.querySelector('#panel-content');
        if (content) {
            content.style.overflowY = 'auto';
            content.style.webkitOverflowScrolling = 'touch';
            content.style.minHeight = '0';
            content.style.flex = '1 1 auto';
        }
        h = Math.min(panel.offsetHeight || availH, availH);
    }

    const cx = clamp(x, safeL, Math.max(safeL, safeR - w));
    // Siempre caber entero: si lo pegas arriba, el fondo sigue en pantalla
    const cy = clamp(y, safeT, Math.max(safeT, safeB - h));
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
    if (header) header.removeAttribute('title');
}

const DRIVER_EARNINGS_MIN_KEY = 'honduber_driver_earnings_minimized';

export function isDriverEarningsMinimized() {
    try {
        const v = localStorage.getItem(DRIVER_EARNINGS_MIN_KEY);
        if (v === '0') return false;
        return true;
    } catch (_) {
        return true;
    }
}

export function setDriverEarningsMinimized(minimized) {
    try {
        localStorage.setItem(DRIVER_EARNINGS_MIN_KEY, minimized ? '1' : '0');
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
            el.style.bottom = cssSafeBottom('8.25rem');
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

function isEarningsOffScreen(el) {
    if (!el) return true;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    if (r.width < 8 || r.height < 8) return true;
    if (r.right < 24 || r.left > vw - 24) return true;
    if (r.bottom < 24 || r.top > vh - 24) return true;
    return false;
}

function parkEarningsAtMapTop(el) {
    if (!el) return;
    const insets = readSafeInsets();
    el.style.position = 'fixed';
    el.style.left = '0.75rem';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.top = `${Math.max(56, insets.top + 52)}px`;
}

function earningsOverlapsPanel(el) {
    if (!el) return false;
    const panel = document.getElementById('control-panel');
    if (!panel) return false;
    const cs = getComputedStyle(panel);
    if (cs.display === 'none' || cs.visibility === 'hidden' || panel.classList.contains('hidden')) return false;
    const er = el.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    if (pr.height < 8 || pr.width < 8) return false;
    const pad = 6;
    return er.bottom > pr.top - pad
        && er.top < pr.bottom + pad
        && er.right > pr.left - pad
        && er.left < pr.right + pad;
}

function parkEarningsClearOfPanel(el) {
    if (!el) return;
    if (isEarningsOffScreen(el) || earningsOverlapsPanel(el)) {
        el.classList.remove('is-drag-positioned', 'is-dragging');
        parkEarningsAtMapTop(el);
        try { localStorage.removeItem('honduber_panel_pos_driver-earnings-float'); } catch (_) {}
    }
}

export function bindFloatingEarningsPanel() {
    const wrap = document.getElementById('driver-earnings-float');
    const el = wrap?.querySelector('.driver-earnings-float');
    if (!el || el.dataset.floatDragBound === '1') return;
    el.dataset.floatDragBound = '1';

    const storageKey = 'driver-earnings-float';
    const saved = loadPosition(storageKey);
    if (saved && (saved.x < -40 || saved.y < -40 || saved.x > (window.innerWidth || 400) - 24 || saved.y > (window.innerHeight || 700) - 24)) {
        clearSavedPosition(storageKey);
    }
    if (!loadPosition(storageKey)) {
        parkEarningsAtMapTop(el);
    }

    makeDraggable(el, {
        handle: el,
        storageKey,
        minVisible: 80,
        keepFullyVisible: true,
        onActivate: (node) => {
            node.style.right = 'auto';
            node.style.bottom = 'auto';
        },
        enabled: () => true
    });

    requestAnimationFrame(() => {
        parkEarningsClearOfPanel(el);
        if (!isEarningsOffScreen(el) && !earningsOverlapsPanel(el)) return;
        clearSavedPosition(storageKey);
        el.classList.remove('is-drag-positioned', 'is-dragging');
        parkEarningsAtMapTop(el);
    });

    el.querySelectorAll('.driver-earnings-min-btn').forEach((btn) => {
        btn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        }, { capture: true });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setDriverEarningsMinimized(true);
            window.renderDriverEarningsToday?.();
        });
    });

    if (el.dataset.earningsExpand === '1') {
        const expand = (e) => {
            if (wasRecentPanelDrag()) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            setDriverEarningsMinimized(false);
            window.renderDriverEarningsToday?.();
        };
        el.addEventListener('pointerup', expand);
        el.addEventListener('click', expand);
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
    // APK: --safe-* inyectado por MainActivity (env() en WebView Android suele ser 0)
    const bottomSafe = cssSafeBottom('5.5rem');
    const positions = {
        // Pasajero: una sola tarjeta flotante (conductor + PIN), bajo el reloj
        'client-trip': {
            left: '0.65rem',
            top: 'max(4.75rem, calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 3.75rem))'
        },
        'client-pin': { left: '0.65rem', bottom: bottomSafe },
        'driver-arrived': { right: '0.65rem', bottom: cssSafeBottom('6.5rem') },
        // Destino: un poco más arriba que el chat / mini-bar para no tapar el mapa
        'driver-arrived-dest': { right: '0.65rem', bottom: cssSafeBottom('7.25rem') },
        'driver-pin': narrow
            ? { left: '0.65rem', right: '0.65rem', bottom: bottomSafe }
            : { right: '0.65rem', bottom: bottomSafe },
        chat: { left: '0.65rem', bottom: cssSafeBottom('8.5rem') },
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
        let lastExpandAt = 0;
        const expand = (e) => {
            // Debounce pointerup+click
            const now = Date.now();
            if (now - lastExpandAt < 350) return;
            lastExpandAt = now;
            try {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            } catch (_) {}
            const key = el.dataset.tripFloatExpand;
            if (key) toggleTripFloatMinimized(key, false);
        };
        // capture: gana al drag del contenedor
        el.addEventListener('pointerup', expand, { capture: true });
        el.addEventListener('click', expand, { capture: true });
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
                floatEl.style.bottom = cssSafeBottom('5.5rem');
                floatEl.style.top = 'auto';
            } else {
                floatEl.style.right = 'auto';
            }
        } else if (key === 'client-pin' || key === 'client-trip' || key === 'driver-pin') {
            defaultTripFloatPosition(floatEl, key);
            // Maximizar burbuja del conductor: bajar el panel central (no abrir los 2)
            if (key === 'client-trip' && document.body.classList.contains('client-mode')) {
                try {
                    const panel = document.getElementById('control-panel');
                    document.body.classList.add('panel-minimized', 'panel-collapsed');
                    document.body.classList.remove('panel-hidden');
                    panel?.classList.add('panel-collapsed');
                    panel?.classList.remove('panel-hidden');
                    try { localStorage.setItem('honduber_control_panel_hidden', '1'); } catch (_) {}
                    try { window.syncPanelHideChevron?.(); } catch (_) {}
                    try { window.syncPassengerPanelToggleLabel?.(); } catch (_) {}
                    const paxMinLabel = document.querySelector('#passenger-panel-min-btn .passenger-panel-min-label');
                    if (paxMinLabel) paxMinLabel.textContent = 'Maximizar';
                } catch (_) {}
            }
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
            // Independiente del panel central: el usuario maximiza la burbuja o el panel por separado.
            // (Antes se forzaba pastilla al minimizar el panel → la burbuja azul no se abría.)
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
            el.style.bottom = cssSafeBottom(`${5.5 + stackOffset}rem`);
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
    el.style.bottom = cssSafeBottom(`${bottomRem}rem`);
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

/** Baja chips/flotantes que se metieron bajo el reloj (APK). */
export function reclampTopFloats() {
    try {
        const insets = readSafeInsets();
        const android = document.body?.classList.contains('capacitor-android')
            || document.documentElement.classList.contains('capacitor-android');
        const minTop = 8 + insets.top + (android ? 6 : 0);
        document.querySelectorAll(
            '.copa-float, .copa-chip--map, #public-copa-strip, #public-pcopa-strip, .driver-earnings-float, .is-drag-positioned'
        ).forEach((el) => {
            if (!el || el.classList.contains('hidden')) return;
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
            const r = el.getBoundingClientRect();
            if (r.height < 8 || r.width < 8) return;
            if (r.top >= minTop - 1) return;
            el.style.top = `${minTop}px`;
            el.style.bottom = 'auto';
        });
        const earn = document.querySelector('#driver-earnings-float .driver-earnings-float');
        if (earn) parkEarningsClearOfPanel(earn);
    } catch (_) {}
}

export function initFloatingPanels() {
    if (typeof window === 'undefined') return;

    window.reclampTopFloats = reclampTopFloats;
    window.addEventListener('hr-safe-insets', reclampTopFloats);
    window.addEventListener('resize', reclampTopFloats);
    setTimeout(reclampTopFloats, 200);
    setTimeout(reclampTopFloats, 700);
    setTimeout(reclampTopFloats, 1400);

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
    window.parkEarningsClearOfPanel = parkEarningsClearOfPanel;
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

    // Re-encajar flotantes que quedaron pegados arriba con el fondo fuera de pantalla
    const refitFloatingInViewport = () => {
        document.querySelectorAll(
            '#control-panel.is-drag-positioned, #client-trip-float.is-drag-positioned, .trip-float.is-drag-positioned'
        ).forEach((el) => {
            try {
                const rect = el.getBoundingClientRect();
                if (rect.height < 8) return;
                const insets = readSafeInsets();
                const edge = 8;
                const safeT = edge + insets.top;
                const safeB = window.innerHeight - edge - insets.bottom;
                const availH = Math.max(120, safeB - safeT);
                if (rect.height > availH + 2) {
                    el.style.maxHeight = `${availH}px`;
                    el.style.overflowY = 'auto';
                }
                if (rect.bottom > safeB + 2 || rect.top < safeT - 2) {
                    const x = rect.left;
                    const y = clamp(rect.top, safeT, Math.max(safeT, safeB - Math.min(rect.height, availH)));
                    el.style.top = `${y}px`;
                    el.style.bottom = 'auto';
                    if (el.id === 'control-panel') {
                        applyPosToControlPanel(el, x, y);
                    }
                }
            } catch (_) {}
        });
    };
    window.refitFloatingPanelsInViewport = refitFloatingInViewport;
    setTimeout(refitFloatingInViewport, 300);
    window.addEventListener('orientationchange', () => setTimeout(refitFloatingInViewport, 250));

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