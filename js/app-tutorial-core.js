/**
 * Motor compartido para tours guiados (pasajero y conductor).
 */

export const AUTO_START_DELAY_MS = 2200;

let activeTour = null;

export function isElementVisible(el) {
    if (!el) return false;
    if (el.classList?.contains('hidden')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

export function pickVisible(...selectors) {
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (isElementVisible(el)) return el;
    }
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

export function isMobileLayout() {
    return window.matchMedia('(max-width: 639px)').matches;
}

function storageMarkDone(key) {
    try { localStorage.setItem(key, '1'); } catch (_) {}
}

export function storageIsDone(key) {
    try { return localStorage.getItem(key) === '1'; } catch (_) { return false; }
}

export function storageReset(key) {
    try { localStorage.removeItem(key); } catch (_) {}
}

function rectsOverlap(a, b, gap = 10) {
    return !(
        a.right + gap < b.left
        || a.left - gap > b.right
        || a.bottom + gap < b.top
        || a.top - gap > b.bottom
    );
}

export function prepareMobileTutorialView() {
    if (!isMobileLayout()) return;
    document.body.classList.remove('panel-hidden');
    window.showControlPanel?.();
    const panel = document.getElementById('control-panel');
    panel?.classList.remove('panel-collapsed', 'panel-hidden');
}

function scrollPanelToTarget(targetEl) {
    if (!targetEl) return;
    const panelScroll = targetEl.closest('#panel-content, .trip-panel-scroll, [data-panel-scroll]');
    if (!panelScroll) return;
    const panelRect = panelScroll.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    if (targetRect.top < panelRect.top || targetRect.bottom > panelRect.bottom) {
        const offset = targetEl.offsetTop - panelScroll.clientHeight * 0.35;
        panelScroll.scrollTop = Math.max(0, offset);
    }
}

function scrollTargetClearOfCard(targetEl, card) {
    if (!targetEl || !card) return;

    scrollPanelToTarget(targetEl);

    const cardRect = card.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const headerReserve = 58;
    const margin = 10;

    const dockedTop = card.classList.contains('passenger-tutorial-card--docked-top');
    const dockedBottom = card.classList.contains('passenger-tutorial-card--docked-bottom');

    let zoneTop = headerReserve;
    let zoneBottom = window.innerHeight - margin;

    if (dockedTop) zoneTop = Math.max(zoneTop, cardRect.bottom + margin);
    if (dockedBottom) zoneBottom = Math.min(zoneBottom, cardRect.top - margin);

    const targetTooLow = targetRect.bottom > zoneBottom;
    const targetTooHigh = targetRect.top < zoneTop;

    if (targetTooLow || targetTooHigh || rectsOverlap(cardRect, targetRect, 14)) {
        const block = targetTooLow ? 'end' : targetTooHigh ? 'start' : 'center';
        targetEl.scrollIntoView?.({ block, behavior: 'smooth', inline: 'nearest' });
        window.setTimeout(() => scrollPanelToTarget(targetEl), 320);
    }
}

function centerTooltipCard(card) {
    const margin = 12;
    const cardRect = card.getBoundingClientRect();
    const top = Math.max(margin, (window.innerHeight - cardRect.height) / 2);
    const left = Math.max(margin, (window.innerWidth - cardRect.width) / 2);
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
    card.style.right = '';
    card.style.bottom = '';
    card.style.transform = '';
}

function positionTooltipDesktop(card, targetRect, placement) {
    const margin = 12;
    const cardRect = card.getBoundingClientRect();
    let top;
    let left;

    const placements = [placement, 'bottom', 'top', 'left', 'right'];
    let best = null;

    for (const place of placements) {
        if (place === 'bottom') {
            top = targetRect.bottom + margin;
            left = targetRect.left + targetRect.width / 2 - cardRect.width / 2;
        } else if (place === 'top') {
            top = targetRect.top - cardRect.height - margin;
            left = targetRect.left + targetRect.width / 2 - cardRect.width / 2;
        } else if (place === 'left') {
            top = targetRect.top + targetRect.height / 2 - cardRect.height / 2;
            left = targetRect.left - cardRect.width - margin;
        } else if (place === 'right') {
            top = targetRect.top + targetRect.height / 2 - cardRect.height / 2;
            left = targetRect.right + margin;
        } else {
            continue;
        }

        left = Math.max(margin, Math.min(left, window.innerWidth - cardRect.width - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - cardRect.height - margin));

        const candidate = {
            top,
            left,
            rect: {
                top,
                left,
                right: left + cardRect.width,
                bottom: top + cardRect.height,
                width: cardRect.width,
                height: cardRect.height,
            },
        };

        if (!rectsOverlap(candidate.rect, targetRect, 12)) {
            best = candidate;
            break;
        }
        if (!best) best = candidate;
    }

    card.style.top = `${best.top}px`;
    card.style.left = `${best.left}px`;
    card.style.right = '';
    card.style.bottom = '';
    card.style.transform = '';
}

function positionTooltipMobile(card, targetEl, targetRect) {
    card.style.top = '';
    card.style.left = '';
    card.style.right = '';
    card.style.bottom = '';
    card.style.transform = '';

    const targetMidY = targetRect.top + targetRect.height / 2;
    const preferTop = targetMidY > window.innerHeight * 0.42;

    card.classList.toggle('passenger-tutorial-card--docked-top', preferTop);
    card.classList.toggle('passenger-tutorial-card--docked-bottom', !preferTop);

    requestAnimationFrame(() => {
        const cardRect = card.getBoundingClientRect();
        if (rectsOverlap(cardRect, targetRect, 12)) {
            card.classList.toggle('passenger-tutorial-card--docked-top');
            card.classList.toggle('passenger-tutorial-card--docked-bottom');
        }
        scrollTargetClearOfCard(targetEl, card);
    });
}

function positionTooltip(card, targetEl, targetRect, placement) {
    const isCenter = placement === 'center' || !targetRect || !targetEl;

    card.classList.remove(
        'passenger-tutorial-card--docked-top',
        'passenger-tutorial-card--docked-bottom',
        'passenger-tutorial-card--center'
    );

    if (isCenter) {
        card.classList.add('passenger-tutorial-card--center');
        requestAnimationFrame(() => centerTooltipCard(card));
        return;
    }

    if (isMobileLayout()) {
        positionTooltipMobile(card, targetEl, targetRect);
        return;
    }

    positionTooltipDesktop(card, targetRect, placement || 'bottom');
}

function updateSpotlight(spotlight, targetEl, padding = 8) {
    if (!targetEl) {
        spotlight.classList.add('hidden');
        return;
    }
    const rect = targetEl.getBoundingClientRect();
    const pad = padding;
    spotlight.classList.remove('hidden');
    spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
    spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;
}

function renderTourStep(root, step, index, total) {
    const targetEl = typeof step.target === 'function' ? step.target() : (step.target ? document.querySelector(step.target) : null);
    const placement = isMobileLayout() && step.mobilePlacement ? step.mobilePlacement : (step.placement || 'bottom');
    const hasTarget = placement !== 'center' && isElementVisible(targetEl);

    if (isMobileLayout()) prepareMobileTutorialView();
    step.beforeShow?.();

    const spotlight = root.querySelector('.passenger-tutorial-spotlight');
    const card = root.querySelector('.passenger-tutorial-card');

    if (hasTarget) {
        updateSpotlight(spotlight, targetEl, step.spotlightPadding ?? (isMobileLayout() ? 6 : 8));
        scrollPanelToTarget(targetEl);
    } else {
        spotlight.classList.add('hidden');
    }

    card.innerHTML = `
        <div class="passenger-tutorial-card-head">
            <span class="passenger-tutorial-step-badge">${index + 1} / ${total}</span>
            <button type="button" class="passenger-tutorial-close" data-tutorial-action="close" aria-label="Cerrar tutorial">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="passenger-tutorial-card-icon"><i class="fas ${step.icon}"></i></div>
        <h3 class="passenger-tutorial-card-title">${step.title}</h3>
        <p class="passenger-tutorial-card-body">${step.body}</p>
        <div class="passenger-tutorial-card-actions">
            <button type="button" class="passenger-tutorial-btn passenger-tutorial-btn--ghost" data-tutorial-action="skip">Saltar tour</button>
            <div class="passenger-tutorial-card-nav">
                ${index > 0 ? '<button type="button" class="passenger-tutorial-btn passenger-tutorial-btn--ghost" data-tutorial-action="prev"><i class="fas fa-arrow-left"></i> Anterior</button>' : ''}
                <button type="button" class="passenger-tutorial-btn passenger-tutorial-btn--primary" data-tutorial-action="next">
                    ${index >= total - 1 ? '¡Entendido!' : 'Siguiente <i class="fas fa-arrow-right"></i>'}
                </button>
            </div>
        </div>
    `;

    requestAnimationFrame(() => {
        positionTooltip(
            card,
            hasTarget ? targetEl : null,
            hasTarget ? targetEl.getBoundingClientRect() : null,
            hasTarget ? placement : 'center'
        );
        if (hasTarget) {
            requestAnimationFrame(() => scrollTargetClearOfCard(targetEl, card));
        }
    });
}

function removeTourDom(rootId, bodyClass) {
    document.getElementById(rootId)?.remove();
    document.body.classList.remove(bodyClass);
}

export function stopActiveTour(markDone = false) {
    if (!activeTour) return;
    if (markDone) storageMarkDone(activeTour.storageKey);
    window.removeEventListener('resize', activeTour.onResize);
    window.removeEventListener('keydown', activeTour.onKeydown);
    removeTourDom(activeTour.rootId, activeTour.bodyClass);
    activeTour = null;
}

export function isTourRunning() {
    return !!activeTour;
}

/**
 * @param {object} config
 * @param {string} config.storageKey
 * @param {string} config.rootId
 * @param {string} config.bodyClass
 * @param {() => boolean} config.canStart
 * @param {() => Array} config.buildSteps
 * @param {boolean} [config.force]
 * @param {string} [config.forceToast]
 * @param {string} [config.blockedToast]
 */
export function startAppTutorial(config) {
    if (!config.canStart()) {
        if (config.blockedToast) window.showToast?.(config.blockedToast, 'warning');
        return;
    }

    const app = document.getElementById('app-interface');
    if (!app || app.classList.contains('hidden')) {
        window.showToast?.('Inicia sesión para ver el tutorial.', 'info');
        return;
    }

    stopActiveTour(false);

    window.closeHeaderMoreMenu?.();
    window.closeProfilePanel?.();
    prepareMobileTutorialView();

    const steps = config.buildSteps();
    let index = 0;

    const root = document.createElement('div');
    root.id = config.rootId;
    root.className = 'passenger-tutorial-root';
    root.innerHTML = `
        <div class="passenger-tutorial-backdrop" data-tutorial-action="close"></div>
        <div class="passenger-tutorial-spotlight hidden" aria-hidden="true"></div>
        <div class="passenger-tutorial-card" role="dialog" aria-modal="true"></div>
    `;
    document.body.appendChild(root);
    document.body.classList.add(config.bodyClass);

    const go = (nextIndex) => {
        index = Math.max(0, Math.min(nextIndex, steps.length - 1));
        renderTourStep(root, steps[index], index, steps.length);
    };

    const onResize = () => go(index);
    const onKeydown = (e) => {
        if (e.key === 'Escape') stopActiveTour(false);
        if (e.key === 'ArrowRight') go(index + 1);
        if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
    };

    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tutorial-action]');
        if (!btn) return;
        const action = btn.dataset.tutorialAction;
        if (action === 'close' || action === 'skip') stopActiveTour(action === 'skip');
        else if (action === 'prev') go(index - 1);
        else if (action === 'next') {
            if (index >= steps.length - 1) stopActiveTour(true);
            else go(index + 1);
        }
    });

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeydown);

    activeTour = {
        storageKey: config.storageKey,
        rootId: config.rootId,
        bodyClass: config.bodyClass,
        onResize,
        onKeydown,
    };

    go(0);

    if (config.force && config.forceToast) {
        window.showToast?.(config.forceToast, 'info');
    }
}

/**
 * @param {object} config
 * @param {string} config.storageKey
 * @param {() => boolean} config.shouldRun
 * @param {() => void} config.start
 */
export function scheduleAutoStartTutorial(config) {
    if (storageIsDone(config.storageKey)) return;
    if (!config.shouldRun()) return;

    window.setTimeout(() => {
        if (isTourRunning() || storageIsDone(config.storageKey)) return;
        if (!config.shouldRun()) return;
        const app = document.getElementById('app-interface');
        if (!app || app.classList.contains('hidden')) return;
        config.start();
    }, AUTO_START_DELAY_MS);
}

export function bindTutorialButtons(bindings) {
    for (const { id, onClick } of bindings) {
        const btn = document.getElementById(id);
        if (!btn || btn.dataset.tutorialBound === '1') continue;
        btn.dataset.tutorialBound = '1';
        btn.addEventListener('click', onClick);
    }
}