/**
 * Copia para Cloud Functions (el deploy solo sube functions/).
 * La fuente es js/scheduled-trip-driver-ui.js — el test exige que digan lo mismo.
 */
'use strict';

const SCHEDULED_LOCK_MINUTES = 30;
const LOCK_MS = SCHEDULED_LOCK_MINUTES * 60 * 1000;
const TZ = 'America/Tegucigalpa';

/** Holgura sobre la barra de Android: 8px de respiro + 48px (3 botones) o 20px (gestos). */
const ANDROID_NAV = {
    gapPx: 8,
    threeButtonPx: 48,
    gesturePx: 20
};

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function scheduledForMs(tripOrIso) {
    const raw = tripOrIso && typeof tripOrIso === 'object' ? tripOrIso.scheduledFor : tripOrIso;
    if (raw == null || raw === '') return 0;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    if (typeof raw?.toMillis === 'function') {
        const n = raw.toMillis();
        return Number.isFinite(n) ? n : 0;
    }
    if (typeof raw?.seconds === 'number') return raw.seconds * 1000;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function cutoffMs(scheduledMs, lockMinutes = SCHEDULED_LOCK_MINUTES) {
    const ms = Number(scheduledMs) || 0;
    if (!ms) return 0;
    return ms - lockMinutes * 60 * 1000;
}

/** Partes de reloj en America/Tegucigalpa, sin depender del «p. m.» del locale (evita «p. m..»). */
function hnClockFields(ms) {
    const date = new Date(ms);
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short'
    });
    const bag = {};
    fmt.formatToParts(date).forEach((p) => {
        if (p.type !== 'literal') bag[p.type] = p.value;
    });
    const hour24 = Number(bag.hour);
    const minute = String(bag.minute || '00').padStart(2, '0');
    const isPm = hour24 >= 12;
    let h12 = hour24 % 12;
    if (h12 === 0) h12 = 12;
    const y = Number(bag.year);
    const m = Number(bag.month);
    const d = Number(bag.day);
    const utcGuess = Date.UTC(y, m - 1, d);
    const weekday = WEEKDAYS[new Date(utcGuess).getUTCDay()] || '';
    return {
        weekday,
        day: d,
        month: MONTHS[m - 1] || '',
        hour24,
        minute,
        clock: `${h12}:${minute} ${isPm ? 'p. m.' : 'a. m.'}`
    };
}

function formatClock(ms) {
    if (!ms) return '';
    return hnClockFields(ms).clock;
}

/** «martes 3:30 p. m.» */
function formatWeekdayClock(ms) {
    if (!ms) return '';
    const f = hnClockFields(ms);
    return `${f.weekday} ${f.clock}`;
}

/** «martes 10 de noviembre» */
function formatLongDay(ms) {
    if (!ms) return '';
    const f = hnClockFields(ms);
    const dayName = f.weekday ? f.weekday.charAt(0).toUpperCase() + f.weekday.slice(1) : '';
    return `${dayName} ${f.day} de ${f.month}`;
}

function faltanLabel(ms, now = Date.now()) {
    if (!ms) return '';
    const mins = Math.max(0, Math.round((ms - now) / 60000));
    if (mins <= 0) return 'ya es la hora';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `faltan ${m} min`;
    return m ? `faltan ${h} h ${m} min` : `faltan ${h} h`;
}

function isLocking(trip, now = Date.now()) {
    const ms = scheduledForMs(trip);
    if (!ms) return false;
    return now >= ms - LOCK_MS;
}

function firstName(name, fallback = 'el pasajero') {
    const n = String(name || '').trim().split(/\s+/)[0];
    return n || fallback;
}

function shortPlace(text, max = 32) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t.length <= max) return t;
    return `${t.slice(0, Math.max(1, max - 1)).trim()}…`;
}

function placeNick(text, max = 24) {
    const parts = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
    const last = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '');
    return shortPlace(last, max);
}

function routeShort(origin, destination, max = 28) {
    const a = placeNick(origin, max);
    const b = placeNick(destination, max);
    if (a && b) return `${a} → ${b}`;
    return a || b || '';
}

/** Si el texto ya cierra con punto (p. ej. «3:30 p. m.»), no agrega otro. */
function sentence(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    if (/[.!?…]$/.test(t)) return t;
    return `${t}.`;
}

function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

function keepWorkingNote(scheduledMs) {
    const cut = formatClock(cutoffMs(scheduledMs));
    if (!cut) return 'Si lo aceptás, queda en tu panel y seguís haciendo otros viajes hasta media hora antes.';
    return `Si lo aceptás, queda en tu panel y seguís haciendo viajes hasta las ${cut} A esa hora te toca ir a recoger.`;
}

function offerHeadline(scheduledMs) {
    const when = formatWeekdayClock(scheduledMs);
    return when ? `Viaje programado · ${when}` : 'Viaje programado';
}

/**
 * Push de oferta (dirigida y la de toda la ciudad).
 * kind: 'targeted' | 'city' | 'nearby'
 */
function scheduledOfferPush(trip, { kind = 'targeted' } = {}) {
    const ms = scheduledForMs(trip);
    if (!ms) return null;
    const when = formatWeekdayClock(ms);
    const cut = formatClock(cutoffMs(ms));
    const price = String(trip?.price || '').trim();
    const origin = shortPlace(trip?.origin, 42);
    const dest = shortPlace(trip?.destination, 42);
    const route = [origin, dest].filter(Boolean).join(' → ');
    const keep = `No es para ya: podés seguir trabajando hasta las ${cut}`;
    const head = [price, route].filter(Boolean).join(' · ');
    const recogida = sentence(`Recogida ${when}`);
    const body = head ? `${sentence(head)} ${recogida} ${keep}` : `${recogida} ${keep}`;
    if (kind === 'city') {
        return {
            title: `🆕 Viaje programado · ${when} en tu ciudad`,
            body
        };
    }
    if (kind === 'nearby') {
        return {
            title: `🆕 Viaje programado · ${when} en tu departamento`,
            body
        };
    }
    return {
        title: offerHeadline(ms),
        body
    };
}

function scheduledReservedDriverPush(trip) {
    const ms = scheduledForMs(trip);
    const when = formatWeekdayClock(ms);
    const cut = formatClock(cutoffMs(ms));
    return {
        title: 'Viaje programado reservado',
        body: `${sentence(`Recogida ${when}`)} Seguí haciendo viajes hasta las ${cut} A esa hora te toca ir a recoger. Podés iniciar antes desde la app.`
    };
}

function scheduledReminderPush(thresholdMin, trip) {
    const ms = scheduledForMs(trip);
    const clock = formatClock(ms);
    const when = formatWeekdayClock(ms);
    const origin = shortPlace(trip?.origin, 48) || 'el punto de recogida';
    const name = firstName(trip?.clientName, 'el pasajero');
    const th = Number(thresholdMin) || 0;
    if (th >= 60) {
        return {
            title: 'Viaje programado en 1 hora',
            body: `Recogida ${sentence(when)} ${origin}.`
        };
    }
    if (th >= 30) {
        return {
            title: 'Ya es media hora antes',
            body: `Andá por ${name} a las ${clock} Ya no podés tomar otros viajes. ${origin}.`
        };
    }
    if (th >= 10) {
        return {
            title: 'Viaje programado en 10 min',
            body: `Recogida ${sentence(when)} ${origin}.`
        };
    }
    return {
        title: 'Viaje programado en 5 min',
        body: `Recogida ${sentence(when)} ${origin}.`
    };
}

function scheduledActivationDriverPush(trip) {
    const ms = scheduledForMs(trip);
    const name = firstName(trip?.clientName, 'el pasajero');
    const clock = formatClock(ms);
    return {
        title: 'Ya es media hora antes',
        body: `Andá por ${name} a las ${clock} No te entran más ofertas. Abrí la app y andá al punto de recogida.`
    };
}

function offerBannerHtml(trip, { now = Date.now(), locking = false } = {}) {
    const ms = scheduledForMs(trip);
    if (!ms) return '';
    const headline = offerHeadline(ms);
    const day = formatLongDay(ms);
    const left = faltanLabel(ms, now);
    const note = locking
        ? 'Ya es media hora antes. Andá al punto de recogida. No podés tomar otro viaje.'
        : keepWorkingNote(ms);
    return `
        <div class="driver-offer-sched-banner" role="status">
            <p class="driver-offer-sched-banner-title"><i class="fas fa-calendar-check"></i> ${escHtml(headline)}</p>
            <p class="driver-offer-sched-banner-when">${escHtml(day)}${left ? ` · ${escHtml(left)}` : ''}</p>
            <p class="driver-offer-sched-banner-sub">${escHtml(note)}</p>
        </div>`;
}

/** Texto del chip ámbar: «Programado · 3:30 p. m.» (el HTML le pone el prefijo si hace falta). */
function offerChipLabel(trip) {
    const ms = scheduledForMs(trip);
    if (!ms) return '';
    return formatClock(ms);
}

function offerKeepNoteHtml(trip, { locking = false } = {}) {
    const ms = scheduledForMs(trip);
    if (!ms) return '';
    const note = locking
        ? 'Ya es media hora antes. Andá al punto de recogida. No podés tomar otro viaje.'
        : keepWorkingNote(ms);
    return `<p class="driver-offer-sched-keep" role="note">${escHtml(note)}</p>`;
}

function compactCardHtml(trip, { now = Date.now() } = {}) {
    const ms = scheduledForMs(trip);
    if (!ms) return '';
    const clock = formatClock(ms);
    const cut = formatClock(cutoffMs(ms));
    const fare = String(trip?.price || '').trim();
    const who = firstName(trip?.clientName, 'Pasajero');
    const route = routeShort(trip?.origin, trip?.destination) || 'Ruta guardada';
    const note = `Al terminar, seguí recibiendo viajes. Tu programado sigue guardado. A las ${cut} dejan de entrar ofertas.`;
    return `
        <article class="hr-sched-compact" data-scheduled-companion="compact" data-trip-id="${escHtml(trip.id || '')}">
            <div class="hr-sched-compact-main">
                <span class="hr-sched-compact-cal" aria-hidden="true"><i class="fas fa-calendar-check"></i></span>
                <div class="hr-sched-compact-copy">
                    <p class="hr-sched-compact-title">Programado ${escHtml(clock)}${fare ? ` · ${escHtml(fare)}` : ''}</p>
                    <p class="hr-sched-compact-route">${escHtml(who)} · ${escHtml(route)}</p>
                </div>
                <span class="hr-sched-compact-pill">Seguí hasta ${escHtml(cut)}</span>
            </div>
            <p class="hr-sched-compact-note">${escHtml(note)}</p>
        </article>`;
}

function takeoverHtml(trip, { stillOnOther = false, pickupHint = '' } = {}) {
    const ms = scheduledForMs(trip);
    const clock = formatClock(ms);
    const name = firstName(trip?.clientName, 'el pasajero');
    const origin = String(trip?.origin || 'Punto de recogida').trim();
    const fare = String(trip?.price || '').trim();
    const meta = [origin, pickupHint, fare].filter(Boolean).join(' · ');
    const warn = stillOnOther ? warningBlockHtml(name) : '';
    return `
        <section class="hr-sched-takeover" data-scheduled-companion="${stillOnOther ? 'warning' : 'takeover'}" data-trip-id="${escHtml(trip?.id || '')}">
            <div class="hr-sched-takeover-banner">
                <p class="hr-sched-takeover-kicker">Ya es media hora antes</p>
                <p class="hr-sched-takeover-title">Andá por ${escHtml(name)} · ${escHtml(clock)}</p>
                <p class="hr-sched-takeover-meta">${escHtml(meta)}</p>
            </div>
            <button type="button" class="hr-sched-takeover-go" data-scheduled-go="${escHtml(trip?.id || '')}">
                <i class="fas fa-location-arrow" aria-hidden="true"></i> Ir ahora al punto de recogida
            </button>
            <button type="button" class="hr-sched-takeover-maps" data-scheduled-maps="${escHtml(trip?.id || '')}">
                <i class="fab fa-google" aria-hidden="true"></i> Abrir en Google Maps
            </button>
            <div class="hr-sched-pause">
                <p class="hr-sched-pause-title">Ofertas en pausa</p>
                <p>No te entran más viajes hasta que termines el programado.</p>
            </div>
            ${warn}
        </section>`;
}

function warningBlockHtml(passengerName) {
    const name = passengerName || 'el pasajero';
    return `
        <div class="hr-sched-still" role="alert">
            <p class="hr-sched-still-q">¿Todavía vas en otro viaje?</p>
            <p>Terminalo primero; al calificar, la app abre sola la ruta hacia ${escHtml(name)}.</p>
        </div>`;
}

/** Aviso fijo encima del viaje en curso cuando ya son los 30 min. */
function warningOnOtherHtml(trip, { pickupHint = '' } = {}) {
    return takeoverHtml(trip, { stillOnOther: true, pickupHint });
}

function isLiveTrip(trip) {
    return !!trip && ['accepted', 'in_progress'].includes(trip.status);
}

function pickDriverForeground(trips, { previousId = null } = {}) {
    const live = (trips || []).filter((t) => isLiveTrip(t) && !t.isDemandSimulation);
    if (!live.length) return null;
    const prev = previousId ? live.find((t) => t.id === previousId) : null;
    if (prev?.status === 'in_progress') return prev;
    const progressing = live.filter((t) => t.status === 'in_progress');
    if (progressing.length) return progressing[0];
    if (prev && !prev.scheduledFor) return prev;
    const plain = live.filter((t) => !t.scheduledFor);
    if (plain.length) {
        if (prev && plain.some((t) => t.id === prev.id)) return prev;
        return plain[0];
    }
    if (prev) return prev;
    return live.slice().sort((a, b) => scheduledForMs(a) - scheduledForMs(b))[0];
}

/**
 * Qué pintar.
 * mode: none | compact | warning | idle | takeover
 * foreground: viaje que el conductor sigue haciendo (o null)
 * subject: el programado del que habla la UI
 */
function resolveScheduledSurface(trips, { previousId = null, now = Date.now() } = {}) {
    const clean = (trips || []).filter((t) => t && !t.isDemandSimulation);
    const foreground = pickDriverForeground(clean, { previousId });
    const scheduledOnes = clean.filter((t) => t.scheduledFor && ['scheduled', 'accepted'].includes(t.status) && t.status !== 'in_progress');
    const others = scheduledOnes.filter((t) => !foreground || t.id !== foreground.id);
    const pool = others.length ? others : scheduledOnes;
    const subject = pool.slice().sort((a, b) => scheduledForMs(a) - scheduledForMs(b))[0] || null;
    if (!subject) return { mode: 'none', foreground, subject: null };

    const otherLive = !!(foreground && foreground.id !== subject.id && isLiveTrip(foreground));
    const locking = isLocking(subject, now);

    if (otherLive) {
        if (locking || subject.status === 'accepted') return { mode: 'warning', foreground, subject };
        return { mode: 'compact', foreground, subject };
    }
    if (locking && subject.status !== 'in_progress') {
        return { mode: 'takeover', foreground: foreground && foreground.id === subject.id ? foreground : null, subject };
    }
    if (subject.status === 'scheduled') return { mode: 'idle', foreground: null, subject };
    return { mode: 'none', foreground, subject };
}

function nearestByScheduledFor(trips) {
    return (trips || [])
        .filter((t) => t && t.status === 'scheduled' && scheduledForMs(t) && !t.isDemandSimulation)
        .slice()
        .sort((a, b) => scheduledForMs(a) - scheduledForMs(b))[0] || null;
}

/** Al terminar el otro viaje, abrir la ruta solo si ya es la ventana de 30 min. */
function shouldAutoOpenScheduledRoute({ previousMode, surface, endedId } = {}) {
    if (!surface?.subject?.id || surface.subject.id === endedId) return false;
    if (surface.mode !== 'takeover') return false;
    return previousMode === 'warning' || previousMode === 'takeover';
}

/** El plan de visibilidad: la faja compacta no se esconde por el viaje aceptado. */
function companionVisibility(mode) {
    if (mode === 'compact' || mode === 'warning') {
        return {
            showCompanion: true,
            hideFullReservedCard: true,
            takeoverInPanel: false,
            blocksOffers: mode === 'warning'
        };
    }
    if (mode === 'takeover') {
        return {
            showCompanion: false,
            hideFullReservedCard: false,
            takeoverInPanel: true,
            blocksOffers: true
        };
    }
    if (mode === 'idle') {
        return {
            showCompanion: false,
            hideFullReservedCard: false,
            takeoverInPanel: false,
            blocksOffers: false
        };
    }
    return {
        showCompanion: false,
        hideFullReservedCard: true,
        takeoverInPanel: false,
        blocksOffers: false
    };
}

module.exports = { scheduledForMs, cutoffMs, hnClockFields, formatClock, formatWeekdayClock, formatLongDay, faltanLabel, isLocking, firstName, shortPlace, placeNick, routeShort, sentence, escHtml, keepWorkingNote, offerHeadline, scheduledOfferPush, scheduledReservedDriverPush, scheduledReminderPush, scheduledActivationDriverPush, offerBannerHtml, offerChipLabel, offerKeepNoteHtml, compactCardHtml, takeoverHtml, warningBlockHtml, warningOnOtherHtml, isLiveTrip, pickDriverForeground, resolveScheduledSurface, nearestByScheduledFor, shouldAutoOpenScheduledRoute, companionVisibility, SCHEDULED_LOCK_MINUTES, ANDROID_NAV };
