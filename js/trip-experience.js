/** Moto estrella, favoritos, viajes programados, terceros, ETA */

export const DELIVERY_CATEGORIES = [
    { id: 'comida', label: 'Comida de restaurante', icon: 'fa-utensils', placeholder: 'Ej: 2 hamburguesas + papas, pollo asado con tortillas...' },
    { id: 'pulperia', label: 'Pulpería', icon: 'fa-store', placeholder: 'Productos de pulpería (leche, pan, huevos...)' },
    { id: 'farmacia', label: 'Farmacia', icon: 'fa-pills', placeholder: 'Medicamentos o insumos de farmacia' },
    { id: 'documentos', label: 'Documentos', icon: 'fa-file-alt', placeholder: 'Documentos, trámites, sobres' },
    { id: 'otro', label: 'Otro', icon: 'fa-box', placeholder: 'Describe el pedido' },
];

export const RIDER_RELATIONS = [
    { id: 'mama', label: 'Mi mamá' },
    { id: 'papa', label: 'Mi papá' },
    { id: 'hijo', label: 'Mi hijo/a' },
    { id: 'esposo', label: 'Mi esposo/a' },
    { id: 'otro', label: 'Otra persona' },
];

/** Mínimo de anticipación para programar (minutos). */
export const MIN_SCHEDULE_LEAD_MINUTES = 15;

const HN_TZ = 'America/Tegucigalpa';

export function getFavoriteKeys() {
    return ['home', 'work', 'pulperia'];
}

export function getFavoriteLabels() {
    return { home: 'Casa', work: 'Trabajo', pulperia: 'Pulpería' };
}

/** Textos del programador según tipo de servicio (carro, moto, flete, entregas…). */
export function getScheduleServiceCopy(serviceType) {
    const t = String(serviceType || 'auto');
    if (t === 'delivery') {
        return {
            title: '¿Cuándo quieres el envío?',
            sub: 'Comida o paquete · programar es fácil · hora de Honduras',
            later: 'Programar envío',
            requestNow: 'SOLICITAR ENVÍO',
            requestLater: 'PROGRAMAR ENVÍO',
            summaryNote: 'Buscamos moto ya; el envío queda para esa hora.',
            thirdParty: 'Envío para otra persona'
        };
    }
    if (t === 'flete_paila' || t === 'flete_camion') {
        return {
            title: '¿Cuándo necesitas el flete?',
            sub: 'Paila o camión · carga con hora fija · hora de Honduras',
            later: 'Programar flete',
            requestNow: 'SOLICITAR FLETE',
            requestLater: 'PROGRAMAR FLETE',
            summaryNote: 'Buscamos conductor ya; la carga queda para esa hora.',
            thirdParty: 'Flete para otra persona'
        };
    }
    if (t === 'grua') {
        return {
            title: '¿Cuándo necesitas la grúa?',
            sub: 'Remolque programado · hora de Honduras',
            later: 'Programar grúa',
            requestNow: 'SOLICITAR GRÚA',
            requestLater: 'PROGRAMAR GRÚA',
            summaryNote: 'Buscamos grúa ya; el servicio queda para esa hora.',
            thirdParty: 'Grúa para otra persona'
        };
    }
    if (t === 'moto') {
        return {
            title: '¿Cuándo quieres la moto?',
            sub: 'Viaje en moto · aeropuerto, cita, trabajo · hora de Honduras',
            later: 'Programar moto',
            requestNow: 'SOLICITAR AHORA',
            requestLater: 'PROGRAMAR MOTO',
            summaryNote: 'Buscamos conductor ya; el viaje queda para esa hora.',
            thirdParty: 'Viaje para otra persona'
        };
    }
    // auto / taxi y default
    return {
        title: '¿Cuándo lo necesitas?',
        sub: 'Carro, moto, flete o envío · hora de Honduras',
        later: 'Programar viaje',
        requestNow: 'SOLICITAR AHORA',
        requestLater: 'PROGRAMAR VIAJE',
        summaryNote: 'Buscamos conductor ya; el viaje queda para esa hora.',
        thirdParty: 'Viaje para otra persona'
    };
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** Partes fecha/hora en zona Honduras. */
export function isoToHnParts(isoOrDate) {
    try {
        const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
        if (!Number.isFinite(d.getTime())) return { date: '', time: '' };
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: HN_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(d);
        const get = (type) => parts.find((p) => p.type === type)?.value || '';
        let hour = get('hour') || '00';
        if (hour === '24') hour = '00';
        return {
            date: `${get('year')}-${get('month')}-${get('day')}`,
            time: `${pad2(hour)}:${pad2(get('minute') || '00')}`
        };
    } catch (_) {
        return { date: '', time: '' };
    }
}

/**
 * Interpreta YYYY-MM-DD + HH:mm como hora de pared en Honduras → ISO UTC.
 * Honduras es UTC-6 todo el año.
 */
export function hnWallTimeToIso(dateStr, timeStr) {
    if (typeof window !== 'undefined' && typeof window.hondurasWallTimeToIso === 'function') {
        try {
            const v = window.hondurasWallTimeToIso(dateStr, timeStr);
            if (v) return v;
        } catch (_) {}
    }
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const t = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m || !t) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const hh = Number(t[1]);
    const mm = Number(t[2]);
    if (!(y >= 2020) || mo < 1 || mo > 12 || day < 1 || day > 31 || hh > 23 || mm > 59) return null;
    return new Date(Date.UTC(y, mo - 1, day, hh + 6, mm, 0, 0)).toISOString();
}

export function formatScheduleSummary(isoOrDate) {
    try {
        const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
        if (!Number.isFinite(d.getTime())) return '';
        return d.toLocaleString('es-HN', {
            timeZone: HN_TZ,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (_) {
        return '';
    }
}

function roundUpTo5Min(date) {
    const d = new Date(date.getTime());
    d.setSeconds(0, 0);
    const m = d.getMinutes();
    const rem = m % 5;
    if (rem !== 0) d.setMinutes(m + (5 - rem));
    return d;
}

function minScheduleDate() {
    return new Date(Date.now() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000);
}

/** Atajos fáciles: 30 min, 1h, 2h, hoy tarde, mañana mañana/tarde, elegir. */
export function getSchedulePresets() {
    const minMs = minScheduleDate().getTime();
    const now = new Date();
    const hnNow = isoToHnParts(now);
    const makeAt = (dateStr, hh, mm) => {
        const iso = hnWallTimeToIso(dateStr, `${pad2(hh)}:${pad2(mm)}`);
        if (!iso) return null;
        const ms = new Date(iso).getTime();
        if (ms < minMs) return null;
        return iso;
    };

    // Mañana en HN
    const tomorrowDate = (() => {
        try {
            const base = hnWallTimeToIso(hnNow.date, '12:00');
            const t = new Date(new Date(base).getTime() + 24 * 60 * 60 * 1000);
            return isoToHnParts(t).date;
        } catch (_) {
            return '';
        }
    })();

    const inMinutes = (mins) => {
        const d = roundUpTo5Min(new Date(Date.now() + mins * 60 * 1000));
        if (d.getTime() < minMs) d.setTime(minMs);
        return roundUpTo5Min(d).toISOString();
    };

    const presets = [
        { id: 'm30', label: 'En 30 min', icon: 'fa-hourglass-half', iso: inMinutes(30) },
        { id: 'h1', label: 'En 1 hora', icon: 'fa-clock', iso: inMinutes(60) },
        { id: 'h2', label: 'En 2 horas', icon: 'fa-clock', iso: inMinutes(120) },
    ];

    // Hoy a las 17:00 o 19:00 si aún alcanza
    const today17 = makeAt(hnNow.date, 17, 0);
    const today19 = makeAt(hnNow.date, 19, 0);
    if (today17) presets.push({ id: 'today17', label: 'Hoy 5:00 p.m.', icon: 'fa-sun', iso: today17 });
    else if (today19) presets.push({ id: 'today19', label: 'Hoy 7:00 p.m.', icon: 'fa-moon', iso: today19 });

    if (tomorrowDate) {
        const t7 = makeAt(tomorrowDate, 7, 0);
        const t8 = makeAt(tomorrowDate, 8, 0);
        const t12 = makeAt(tomorrowDate, 12, 0);
        if (t7) presets.push({ id: 'tm7', label: 'Mañana 7:00 a.m.', icon: 'fa-plane-departure', iso: t7 });
        if (t8) presets.push({ id: 'tm8', label: 'Mañana 8:00 a.m.', icon: 'fa-briefcase', iso: t8 });
        if (t12) presets.push({ id: 'tm12', label: 'Mañana 12:00 m.', icon: 'fa-calendar-day', iso: t12 });
    }

    presets.push({ id: 'custom', label: 'Elegir fecha y hora', icon: 'fa-edit', iso: null, custom: true });

    return presets;
}

function setHiddenScheduleFields({ enabled, date = '', time = '' }) {
    const toggle = document.getElementById('trip-schedule-toggle');
    const hiddenDt = document.getElementById('trip-schedule-datetime');
    if (toggle) toggle.checked = !!enabled;
    if (hiddenDt) {
        if (enabled && date && time) {
            // Compat con datetime-local: YYYY-MM-DDTHH:mm
            hiddenDt.value = `${date}T${time}`;
        } else {
            hiddenDt.value = '';
        }
    }
}

function updateRequestButtonLabel() {
    const fareBtn = document.getElementById('fare-request-btn');
    if (!fareBtn) return;
    const serviceType = (typeof window !== 'undefined' && window.currentServiceType) || 'auto';
    const copy = getScheduleServiceCopy(serviceType);
    const on = !!document.getElementById('trip-schedule-toggle')?.checked;
    const hourly = typeof window !== 'undefined' && window.currentBookingMode === 'hourly';
    let label;
    if (on) label = copy.requestLater;
    else if (hourly) label = 'RESERVAR POR HORAS';
    else label = copy.requestNow;
    const span = fareBtn.querySelector('.pointer-events-none');
    if (span) span.textContent = label;
    else fareBtn.innerText = label;
    // Mantener sincronizada la tarjeta expandible «¿Ahora o en otro momento?»
    try { syncWhenCardSummary?.(); } catch (_) {}
}

/** Tarjeta expandible (mismo patrón que parada/pasajeros). */
export function syncWhenAdderBtnState() {
    const btn = document.getElementById('add-when-btn');
    const adder = document.getElementById('trip-when-adder');
    if (!btn || !adder) return;
    const open = !adder.classList.contains('hidden');
    btn.classList.toggle('is-active', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function setWhenAdderOpen(open) {
    const adder = document.getElementById('trip-when-adder');
    if (!adder) return;
    adder.classList.toggle('hidden', !open);
    syncWhenAdderBtnState();
}

/** Etiqueta del botón: Ahora / Programado para … */
export function syncWhenCardSummary() {
    const btn = document.getElementById('add-when-btn');
    const labelEl = document.getElementById('add-when-btn-label');
    const badgeEl = document.getElementById('add-when-btn-badge');
    if (!btn && !labelEl && !badgeEl) return;

    const later = !!document.getElementById('trip-schedule-toggle')?.checked;
    const summaryText = document.getElementById('trip-when-summary-text')?.textContent?.trim() || '';
    const hasSummary = later && summaryText && summaryText !== '—';

    btn?.classList.toggle('is-chosen', true);
    btn?.classList.toggle('is-later', later);

    if (labelEl) {
        if (!later) {
            labelEl.textContent = 'Ahora · lo necesito ya';
        } else if (hasSummary) {
            labelEl.textContent = `Programado · ${summaryText}`;
        } else {
            labelEl.textContent = 'En otro momento · elige hora';
        }
    }
    if (badgeEl) {
        if (!later) {
            badgeEl.textContent = 'Toca para programar';
        } else if (hasSummary) {
            badgeEl.textContent = 'Listo · toca para cambiar';
        } else {
            badgeEl.textContent = 'Elige un atajo o fecha';
        }
    }
    syncWhenAdderBtnState();
}

export function bindWhenAdder() {
    const toggle = document.getElementById('add-when-btn');
    const adder = document.getElementById('trip-when-adder');
    const closeInline = document.getElementById('btn-when-cancel-inline');
    if (!toggle || !adder) return;
    if (toggle.dataset.bound === '1') {
        syncWhenCardSummary();
        return;
    }
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', () => {
        const willOpen = adder.classList.contains('hidden');
        setWhenAdderOpen(willOpen);
    });
    if (closeInline && closeInline.dataset.bound !== '1') {
        closeInline.dataset.bound = '1';
        closeInline.addEventListener('click', () => setWhenAdderOpen(false));
    }
    syncWhenCardSummary();
}

function setActiveWhenMode(mode) {
    document.querySelectorAll('.trip-when-mode-btn').forEach((btn) => {
        const active = btn.dataset.whenMode === mode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.getElementById('trip-when-schedule')?.classList.toggle('hidden', mode !== 'later');
}

function setActivePreset(presetId) {
    document.querySelectorAll('.trip-when-preset').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.preset === presetId);
    });
}

function showCustomFields(show) {
    document.getElementById('trip-when-custom')?.classList.toggle('hidden', !show);
}

function updateSummary(iso) {
    const box = document.getElementById('trip-when-summary');
    const text = document.getElementById('trip-when-summary-text');
    const note = document.getElementById('trip-when-summary-note');
    if (!box || !text) return;
    if (!iso) {
        box.classList.add('hidden');
        text.textContent = '—';
        return;
    }
    const serviceType = (typeof window !== 'undefined' && window.currentServiceType) || 'auto';
    const copy = getScheduleServiceCopy(serviceType);
    text.textContent = formatScheduleSummary(iso);
    if (note) note.textContent = copy.summaryNote;
    box.classList.remove('hidden');
}

function applyIsoToInputs(iso) {
    const parts = isoToHnParts(iso);
    const dateEl = document.getElementById('trip-schedule-date');
    const timeEl = document.getElementById('trip-schedule-time');
    if (dateEl && parts.date) dateEl.value = parts.date;
    if (timeEl && parts.time) timeEl.value = parts.time;
    setHiddenScheduleFields({ enabled: true, date: parts.date, time: parts.time });
    updateSummary(iso);
    updateRequestButtonLabel();
    syncWhenCardSummary();
}

function readIsoFromCustomInputs() {
    const date = document.getElementById('trip-schedule-date')?.value || '';
    const time = document.getElementById('trip-schedule-time')?.value || '';
    if (!date || !time) return null;
    return hnWallTimeToIso(date, time);
}

function ensureCustomMinAttributes() {
    const min = minScheduleDate();
    const parts = isoToHnParts(min);
    const dateEl = document.getElementById('trip-schedule-date');
    const timeEl = document.getElementById('trip-schedule-time');
    if (dateEl && parts.date) dateEl.min = parts.date;
    // time min only meaningful if same day — browsers handle loosely
    if (timeEl && !timeEl.value && parts.time) {
        // leave empty until user picks; preset fills
    }
}

export function renderSchedulePresets() {
    const wrap = document.getElementById('trip-when-presets');
    if (!wrap) return;
    const presets = getSchedulePresets();
    wrap.innerHTML = presets.map((p) => `
        <button type="button" class="trip-when-preset" data-preset="${p.id}" data-custom="${p.custom ? '1' : '0'}"
                ${p.iso ? `data-iso="${p.iso}"` : ''}>
            <i class="fas ${p.icon}"></i>
            <span>${p.label}</span>
        </button>
    `).join('');
}

export function setTripScheduleMode(mode, { expandCustom = false } = {}) {
    const later = mode === 'later';
    setActiveWhenMode(later ? 'later' : 'now');
    if (!later) {
        setHiddenScheduleFields({ enabled: false });
        showCustomFields(false);
        setActivePreset('');
        updateSummary(null);
        updateRequestButtonLabel();
        syncWhenCardSummary();
        // No forzar cierre aquí: la progresión decide si colapsar al confirmar
        return;
    }
    setHiddenScheduleFields({
        enabled: true,
        date: document.getElementById('trip-schedule-date')?.value || '',
        time: document.getElementById('trip-schedule-time')?.value || ''
    });
    ensureCustomMinAttributes();
    renderSchedulePresets();
    // Programar: mantener la tarjeta abierta para elegir hora
    setWhenAdderOpen(true);
    if (expandCustom) {
        showCustomFields(true);
        setActivePreset('custom');
        // Prefill mínimo + 30 min redondeado si vacío
        const dateEl = document.getElementById('trip-schedule-date');
        const timeEl = document.getElementById('trip-schedule-time');
        if (dateEl && !dateEl.value) {
            const pref = isoToHnParts(roundUpTo5Min(new Date(Date.now() + 30 * 60 * 1000)));
            dateEl.value = pref.date;
            if (timeEl) timeEl.value = pref.time;
        }
        const iso = readIsoFromCustomInputs();
        if (iso) {
            setHiddenScheduleFields({
                enabled: true,
                date: document.getElementById('trip-schedule-date')?.value || '',
                time: document.getElementById('trip-schedule-time')?.value || ''
            });
            updateSummary(iso);
        }
    }
    updateRequestButtonLabel();
    syncWhenCardSummary();
}

export function applySchedulePreset(presetId) {
    const presets = getSchedulePresets();
    const p = presets.find((x) => x.id === presetId);
    if (!p) return;
    setTripScheduleMode('later');
    setActivePreset(presetId);
    if (p.custom) {
        showCustomFields(true);
        ensureCustomMinAttributes();
        if (!document.getElementById('trip-schedule-date')?.value) {
            const pref = isoToHnParts(roundUpTo5Min(new Date(Date.now() + 30 * 60 * 1000)));
            const dateEl = document.getElementById('trip-schedule-date');
            const timeEl = document.getElementById('trip-schedule-time');
            if (dateEl) dateEl.value = pref.date;
            if (timeEl) timeEl.value = pref.time;
        }
        const iso = readIsoFromCustomInputs();
        if (iso) {
            applyIsoToInputs(iso);
        } else {
            updateSummary(null);
        }
        return;
    }
    showCustomFields(false);
    if (p.iso) applyIsoToInputs(p.iso);
}

/** Actualiza textos del panel al cambiar carro/moto/flete/entrega. */
export function updateTripScheduleLabels(serviceType) {
    const copy = getScheduleServiceCopy(serviceType);
    const title = document.getElementById('trip-when-title');
    const sub = document.getElementById('trip-when-sub');
    const laterLbl = document.getElementById('trip-when-later-label');
    const note = document.getElementById('trip-when-summary-note');
    if (title) title.innerHTML = `<i class="fas fa-clock"></i> ${copy.title}`;
    if (sub) sub.textContent = copy.sub;
    if (laterLbl) laterLbl.textContent = copy.later;
    if (note) note.textContent = copy.summaryNote;
    // Etiqueta de «para otra persona» en opciones avanzadas
    const thirdLbl = document.querySelector('label[for="trip-third-party-toggle"] span, #trip-third-party-toggle + span');
    // el markup usa span hermano del checkbox
    const thirdSibling = document.querySelector('#trip-third-party-toggle')?.parentElement?.querySelector('span');
    if (thirdSibling) {
        thirdSibling.innerHTML = `<i class="fas fa-user-friends"></i> ${copy.thirdParty}`;
    } else if (thirdLbl) {
        thirdLbl.textContent = copy.thirdParty;
    }
    updateRequestButtonLabel();
}

export function buildTripOptionsFromUI() {
    const scheduledToggle = document.getElementById('trip-schedule-toggle')?.checked;
    const thirdPartyToggle = document.getElementById('trip-third-party-toggle')?.checked;
    const riderName = document.getElementById('trip-rider-name')?.value?.trim() || '';
    const riderPhone = document.getElementById('trip-rider-phone')?.value?.trim() || '';
    const riderRelation = document.getElementById('trip-rider-relation')?.value || '';
    const deliveryCategory = document.getElementById('delivery-category')?.value || 'otro';

    let scheduledFor = null;
    if (scheduledToggle) {
        // Prefer date+time fields (nuevo UI)
        const date = document.getElementById('trip-schedule-date')?.value || '';
        const time = document.getElementById('trip-schedule-time')?.value || '';
        if (date && time) {
            const iso = hnWallTimeToIso(date, time);
            if (iso && new Date(iso).getTime() > Date.now() + (MIN_SCHEDULE_LEAD_MINUTES - 1) * 60 * 1000) {
                scheduledFor = iso;
            }
        }
        // Fallback: hidden datetime-local / valor de preset
        if (!scheduledFor) {
            const scheduledAt = document.getElementById('trip-schedule-datetime')?.value || '';
            if (scheduledAt.includes('T')) {
                // valor local YYYY-MM-DDTHH:mm → interpretar como HN
                const [d, t] = scheduledAt.split('T');
                const iso = hnWallTimeToIso(d, (t || '').slice(0, 5));
                if (iso && new Date(iso).getTime() > Date.now() + (MIN_SCHEDULE_LEAD_MINUTES - 1) * 60 * 1000) {
                    scheduledFor = iso;
                }
            } else if (scheduledAt) {
                const dt = new Date(scheduledAt);
                if (!Number.isNaN(dt.getTime()) && dt.getTime() > Date.now() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000) {
                    scheduledFor = dt.toISOString();
                }
            }
        }
    }

    const riderInfo = thirdPartyToggle && riderName
        ? {
            name: riderName,
            phone: (typeof window !== 'undefined' && window.normalizeHondurasPhone
                ? window.normalizeHondurasPhone(riderPhone)
                : riderPhone),
            relation: riderRelation,
            bookedByUid: null
        }
        : null;

    return { scheduledFor, riderInfo, deliveryCategory };
}

export function validateTripOptions(options) {
    if (document.getElementById('trip-schedule-toggle')?.checked) {
        if (!options.scheduledFor) {
            try {
                setWhenAdderOpen(true);
                document.getElementById('passenger-booking-when')
                    ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            } catch (_) {}
            return {
                ok: false,
                message: `Elige cuándo lo necesitas (mínimo ${MIN_SCHEDULE_LEAD_MINUTES} minutos). Usa un atajo o fecha y hora.`
            };
        }
        const ms = new Date(options.scheduledFor).getTime();
        if (!Number.isFinite(ms) || ms < Date.now() + (MIN_SCHEDULE_LEAD_MINUTES - 1) * 60 * 1000) {
            try {
                setWhenAdderOpen(true);
                document.getElementById('passenger-booking-when')
                    ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            } catch (_) {}
            return {
                ok: false,
                message: `La hora programada debe ser al menos ${MIN_SCHEDULE_LEAD_MINUTES} minutos en el futuro.`
            };
        }
    }
    if (document.getElementById('trip-third-party-toggle')?.checked) {
        if (!options.riderInfo?.name) return { ok: false, message: 'Indica el nombre de quien recibe o viaja.' };
        if (!options.riderInfo?.phone) return { ok: false, message: 'Indica el WhatsApp de quien recibe o viaja.' };
    }
    return { ok: true };
}

export function formatDriverEtaMessage(route, driverName) {
    if (!route) return 'Calculando llegada del conductor...';
    const km = typeof window?.getRouteDistanceKm === 'function' ? window.getRouteDistanceKm(route) : 0;
    const duration = typeof window?.formatRouteDuration === 'function' ? window.formatRouteDuration(route) : '';
    const name = driverName ? driverName.split(' ')[0] : 'Conductor';
    if (km > 0 && duration) return `${name} a ${km.toFixed(1)} km · llega en ${duration}`;
    if (duration) return `${name} llega en ${duration}`;
    return `Llegada estimada: ${duration || 'calculando...'}`;
}

export function getDeliverySlaText(km = 0) {
    const base = 30;
    const extra = km > 8 ? Math.ceil((km - 8) * 2) : 0;
    return `Meta de entrega: ${base + extra} min`;
}

export function estimateArrivalMinutes(route) {
    if (!route?.durationMillis) return null;
    return Math.max(1, Math.round(route.durationMillis / 60000));
}

/** Inicializa UI de programación (chips Ahora/Programar + atajos). */
export function initTripScheduleUI() {
    if (typeof document === 'undefined') return;
    if (document.documentElement.dataset.tripScheduleUi === '1') return;
    document.documentElement.dataset.tripScheduleUi = '1';

    const panel = document.getElementById('trip-when-panel');
    if (!panel) return;

    // Tarjeta expandible «¿Ahora o en otro momento?»
    bindWhenAdder();

    panel.addEventListener('click', (e) => {
        const modeBtn = e.target?.closest?.('[data-when-mode]');
        if (modeBtn) {
            e.preventDefault();
            const mode = modeBtn.dataset.whenMode === 'later' ? 'later' : 'now';
            setTripScheduleMode(mode, { expandCustom: false });
            if (mode === 'later') {
                // Atajos visibles; el usuario toca uno (30 min, 1 h, etc.) y ahí se despliega «Pedir viaje»
                if (typeof window !== 'undefined') {
                    window.whenStepConfirmed = false;
                    window.syncBookingProgression?.({ forceOpenStep: 'when', scroll: false });
                    window.syncWhenCardSummary?.();
                }
            } else {
                // «Ahora» confirma el paso y despliega «Pedir el viaje»
                if (typeof window !== 'undefined') {
                    window.confirmWhenStep?.('now');
                }
            }
            return;
        }
        const presetBtn = e.target?.closest?.('.trip-when-preset');
        if (presetBtn) {
            e.preventDefault();
            applySchedulePreset(presetBtn.dataset.preset);
            // Tras elegir un atajo (no custom), confirmar y pasar al último paso
            if (presetBtn.dataset.custom !== '1') {
                if (typeof window !== 'undefined') {
                    window.whenStepConfirmed = true;
                    window.confirmWhenStep?.('later');
                }
                setTimeout(() => setWhenAdderOpen(false), 120);
            } else {
                if (typeof window !== 'undefined') window.whenStepConfirmed = false;
            }
        }
    });

    const onCustomChange = () => {
        if (!document.getElementById('trip-schedule-toggle')?.checked) return;
        setActivePreset('custom');
        showCustomFields(true);
        const iso = readIsoFromCustomInputs();
        if (iso) {
            applyIsoToInputs(iso);
            if (typeof window !== 'undefined') {
                window.whenStepConfirmed = true;
                window.syncBookingProgression?.({ scroll: true });
            }
        } else {
            const date = document.getElementById('trip-schedule-date')?.value || '';
            const time = document.getElementById('trip-schedule-time')?.value || '';
            setHiddenScheduleFields({ enabled: true, date, time });
            updateSummary(null);
            updateRequestButtonLabel();
            if (typeof window !== 'undefined') {
                window.whenStepConfirmed = false;
                window.syncBookingProgression?.({ scroll: false });
            }
        }
        syncWhenCardSummary();
    };
    document.getElementById('trip-schedule-date')?.addEventListener('change', onCustomChange);
    document.getElementById('trip-schedule-time')?.addEventListener('change', onCustomChange);
    document.getElementById('trip-schedule-time')?.addEventListener('input', onCustomChange);

    // Default: Ahora
    setTripScheduleMode('now');
    updateTripScheduleLabels(
        (typeof window !== 'undefined' && window.currentServiceType) || 'auto'
    );
    syncWhenCardSummary();
}

// Atajos globales (tutorial + validación al pedir viaje)
try {
    if (typeof window !== 'undefined') {
        window.setWhenAdderOpen = setWhenAdderOpen;
        window.syncWhenCardSummary = syncWhenCardSummary;
        window.bindWhenAdder = bindWhenAdder;
    }
} catch (_) {}

// Auto-init cuando el DOM esté listo
try {
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => initTripScheduleUI(), { once: true });
        } else {
            initTripScheduleUI();
        }
    }
} catch (_) {}
