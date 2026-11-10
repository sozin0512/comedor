/**
 * Viaje programado en espera · el pasajero no pide otro servicio.
 * status 'scheduled', o 'pending' con scheduledFor. Staff queda libre.
 * Sin DOM: lo usa la app y, en copia CJS, Cloud Functions.
 */
import { scheduledForMs, hnClockFields } from './scheduled-trip-driver-ui.js';

export const WAITING_LOCK_TOAST = 'Tenés un viaje en espera. No podés pedir otro servicio hasta que se complete o lo cancelés.';

export const WAITING_LOCK_SERVICES = [
    { id: 'trip', label: 'Viaje' },
    { id: 'stores', label: 'Tiendas' },
    { id: 'delivery', label: 'Envío' },
    { id: 'freight', label: 'Flete' }
];

/** Modos del inicio que piden un servicio (Marketplace no entra). */
export const WAITING_LOCK_MODES = ['trip', 'stores', 'delivery', 'freight', 'tow'];

const TERMINAL = new Set(['completed', 'cancelled', 'canceled']);

export function hasScheduledFor(trip) {
    if (!trip) return false;
    const raw = trip.scheduledFor;
    if (raw == null || raw === '') return false;
    if (typeof raw === 'object' && !raw.toMillis && raw.seconds == null && !(raw instanceof Date)) {
        if (!raw) return false;
    }
    return scheduledForMs(trip) > 0 || String(raw).trim().length > 0;
}

/**
 * Viaje programado que sigue en espera.
 * No incluye un viaje inmediato (pending sin scheduledFor, accepted, in_progress).
 */
export function isWaitingScheduledTrip(trip) {
    if (!trip || typeof trip !== 'object') return false;
    if (trip.isDemandSimulation === true) return false;
    const status = String(trip.status || '');
    if (TERMINAL.has(status)) return false;
    if (status === 'scheduled') return true;
    if (status === 'pending' && hasScheduledFor(trip)) return true;
    return false;
}

/**
 * Flags que ya calculan isAdminUser / isSupervisorUser / isStaffUser / staffGrantedBy.
 * No inventa otro modelo de roles.
 */
export function staffExemptFromWaitingLock(staff) {
    if (!staff || typeof staff !== 'object') return false;
    if (staff.isAdmin === true || staff.isSupervisor === true || staff.isStaff === true) return true;
    if (staff.helpersChecked === true) return false;
    if (staff.staffGrantedBy) return true;
    const role = String(staff.role || '').toLowerCase();
    return role === 'admin' || role === 'supervisor';
}

/** El alta la hizo staff o la tienda: no es el pasajero pidiendo otro servicio. */
export function requestSkipsWaitingLock(trip) {
    if (!trip || typeof trip !== 'object') return false;
    if (trip.isDemandSimulation === true) return true;
    if (trip.createdByMerchant === true || trip.merchantDirectDelivery === true) return true;
    const by = String(trip.staffCreatedBy || '');
    if (trip.staffAssistedClient === true && by && by !== 'whatsapp-assistant') return true;
    return false;
}

export function pickWaitingScheduledTrip(trips, { ignoreId = null } = {}) {
    const list = (Array.isArray(trips) ? trips : [])
        .filter((t) => t && t.id !== ignoreId && isWaitingScheduledTrip(t));
    if (!list.length) return null;
    list.sort((a, b) => {
        const sa = a.status === 'scheduled' ? 0 : 1;
        const sb = b.status === 'scheduled' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        const ma = scheduledForMs(a) || Number.MAX_SAFE_INTEGER;
        const mb = scheduledForMs(b) || Number.MAX_SAFE_INTEGER;
        return ma - mb;
    });
    return list[0];
}

export function waitingLockDecision({ trips, staff, ignoreId = null } = {}) {
    if (staffExemptFromWaitingLock(staff)) return { locked: false, trip: null, reason: 'staff' };
    const trip = pickWaitingScheduledTrip(trips, { ignoreId });
    if (!trip) return { locked: false, trip: null, reason: 'clear' };
    return { locked: true, trip, reason: trip.status === 'scheduled' ? 'scheduled' : 'pending-scheduled' };
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function waitingLockWhenLabel(trip, now = Date.now()) {
    const ms = scheduledForMs(trip);
    if (!ms) return 'Hora por confirmar';
    const when = hnClockFields(ms);
    const today = hnClockFields(now);
    const sameDay = when.day === today.day && when.month === today.month && when.weekday === today.weekday;
    return sameDay ? `Hoy ${when.clock}` : `${when.weekday} ${when.clock}`;
}

export function waitingLockSubtitle(trip, now = Date.now()) {
    const when = waitingLockWhenLabel(trip, now);
    const who = trip?.status === 'scheduled'
        ? (String(trip.driverName || '').trim() || 'Conductor asignado')
        : 'Buscando conductor';
    return `${when} · ${who}`;
}

export function waitingLockCardHtml(trip, now = Date.now()) {
    const sub = waitingLockSubtitle(trip, now);
    const tiles = WAITING_LOCK_SERVICES.map((s) => `
        <button type="button" class="hr-wait-lock-tile" data-waiting-lock="block" data-waiting-service="${esc(s.id)}">
            <i class="fas fa-lock" aria-hidden="true"></i>
            <strong>${esc(s.label)}</strong>
            <small>Bloqueado</small>
        </button>`).join('');
    return `
        <div class="hr-wait-lock-banner">
            <span class="hr-wait-lock-dot" aria-hidden="true"></span>
            <span class="hr-wait-lock-copy">
                <strong>Tu viaje está en espera</strong>
                <small>${esc(sub)}</small>
            </span>
            <button type="button" class="hr-wait-lock-open" data-waiting-lock="open">Ver reserva</button>
        </div>
        <div class="hr-wait-lock-grid">${tiles}</div>`;
}
