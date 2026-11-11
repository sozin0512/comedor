/**
 * Tarjeta fija «Tu viaje está en espera» y servicios bloqueados en el inicio del pasajero.
 */
import {
    WAITING_LOCK_TOAST,
    WAITING_LOCK_MODES,
    waitingLockCardHtml,
    waitingLockDecision,
    staffExemptFromWaitingLock
} from './scheduled-trip-client-lock.js?v=2026.10.26.104';

const BLOCKED_HOME_MODES = ['trip', 'stores', 'delivery', 'freight', 'tow'];

function staffFlagsFromWindow() {
    const user = window.currentUser || null;
    const profile = window.userProfile || null;
    let isAdmin = false;
    let isSupervisor = false;
    let isStaff = false;
    try { isAdmin = window.isAdminUser?.(user, profile) === true; } catch (_) {}
    try { isSupervisor = window.isSupervisorUser?.(user, profile) === true; } catch (_) {}
    try { isStaff = window.isStaffUser?.(user, profile) === true; } catch (_) {}
    // isAdminUser / isSupervisorUser / isStaffUser ya incluyen staffGrantedBy
    // cuando el rol de confianza todavía no cargó. Si ya dijeron que no, no se pisa.
    return { isAdmin, isSupervisor, isStaff, helpersChecked: true };
}

function ensureCard() {
    let el = document.getElementById('passenger-waiting-lock');
    if (el) return el;
    el = document.createElement('aside');
    el.id = 'passenger-waiting-lock';
    el.className = 'hr-wait-lock hidden';
    el.setAttribute('hidden', '');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Viaje en espera');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
        const open = e.target.closest('[data-waiting-lock="open"]');
        const block = e.target.closest('[data-waiting-lock="block"]');
        if (!open && !block) return;
        e.preventDefault();
        e.stopPropagation();
        if (open) {
            window.hrOpenWaitingReservation?.();
            return;
        }
        window.showToast?.(WAITING_LOCK_TOAST, 'warning');
    });
    return el;
}

export function paintWaitingLockOnHome() {
    const hub = document.getElementById('passenger-home-hub');
    const locked = document.body.classList.contains('passenger-waiting-lock')
        && !staffExemptFromWaitingLock(staffFlagsFromWindow());
    if (!hub) return;
    hub.classList.toggle('hrh--waiting-lock', locked);
    BLOCKED_HOME_MODES.forEach((mode) => {
        const card = hub.querySelector(`[data-home-mode="${mode}"]`);
        if (!card) return;
        card.classList.toggle('hr-wait-blocked', locked);
        card.setAttribute('aria-disabled', locked ? 'true' : card.classList.contains('passenger-home-card--off') ? 'true' : 'false');
        const small = card.querySelector('small');
        if (!small) return;
        if (locked) {
            small.innerHTML = '<i class="fas fa-lock" aria-hidden="true"></i> Bloqueado';
        }
    });
    hub.querySelectorAll('[data-hrh-svc], [data-hrh-go="trip"], [data-hrh-nav="raite"]').forEach((btn) => {
        btn.classList.toggle('hr-wait-blocked', locked);
        if (locked) btn.setAttribute('aria-disabled', 'true');
        else if (!btn.classList.contains('hrh-off')) btn.removeAttribute('aria-disabled');
    });
}

export function syncPassengerWaitingLock(trip, staff) {
    const flags = staff || staffFlagsFromWindow();
    const decision = waitingLockDecision({ trips: trip ? [trip] : [], staff: flags });
    const show = decision.locked && !flagsHideCard();
    window._hrWaitingScheduledTrip = decision.locked ? decision.trip : null;
    window.HR_WAITING_LOCK_TOAST = WAITING_LOCK_TOAST;
    document.body.classList.toggle('passenger-waiting-lock', decision.locked);
    const el = ensureCard();
    if (!show) {
        el.classList.add('hidden');
        el.setAttribute('hidden', '');
        el.innerHTML = '';
        delete el.dataset.html;
    } else {
        const html = waitingLockCardHtml(decision.trip, Date.now());
        if (el.dataset.html !== html) {
            el.innerHTML = html;
            el.dataset.html = html;
        }
        el.classList.remove('hidden');
        el.removeAttribute('hidden');
    }
    try { paintWaitingLockOnHome(); } catch (_) {}
    return decision;
}

function flagsHideCard() {
    if (document.body.classList.contains('driver-mode')) return true;
    if (document.body.classList.contains('is-searching')) return true;
    if (document.body.classList.contains('scheduled-reserved-active')) return true;
    if (document.body.classList.contains('trip-active')) return true;
    return false;
}

export function passengerWaitingLockActive() {
    return document.body.classList.contains('passenger-waiting-lock')
        && !staffExemptFromWaitingLock(staffFlagsFromWindow());
}

export function installPassengerWaitingLock() {
    window.HR_WAITING_LOCK_TOAST = WAITING_LOCK_TOAST;
    window.WAITING_LOCK_MODES = WAITING_LOCK_MODES;
    window.hrSyncPassengerWaitingLock = syncPassengerWaitingLock;
    window.hrPaintWaitingLockOnHome = paintWaitingLockOnHome;
    window.hrPassengerWaitingLockActive = passengerWaitingLockActive;
    window.hrRevealPassengerWaitingLock = () => {
        const trip = window._hrWaitingScheduledTrip;
        if (!trip) return;
        syncPassengerWaitingLock(trip, staffFlagsFromWindow());
    };
}

try { installPassengerWaitingLock(); } catch (_) {}
