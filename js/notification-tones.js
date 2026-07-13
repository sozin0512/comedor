/**
 * Tonos propios HonduRaite (Web Audio + archivos subidos).
 * No usan el sonido del sistema del celular.
 * Web y nativo pueden mapear eventos a tonos distintos.
 * Admin configura en Personalización → aplica a todos (Firestore appSettings).
 */
import { isCapacitorNative } from './capacitor-native.js';

const PREFS_KEY = 'honduraite_notif_tone_map_v1';
const CUSTOM_KEY = 'honduraite_custom_tones_v1';
const MAX_CUSTOM_BYTES = 2.5 * 1024 * 1024; // 2.5 MB
const ALLOWED_AUDIO = /audio\/(mpeg|mp3|wav|wave|x-wav|ogg|webm|mp4|aac|x-m4a|m4a)|application\/ogg/i;

/** Eventos de notificación que se pueden mapear a un tono */
export const TONE_EVENTS = [
    { id: 'general', label: 'Aviso general', desc: 'Notificaciones normales (admin, versión, etc.)' },
    { id: 'chat', label: 'Chat', desc: 'Mensajes del chat de viaje' },
    { id: 'driver_offer', label: 'Oferta al conductor', desc: 'Nuevo viaje / oferta' },
    { id: 'ride_demand', label: 'Demanda (activar)', desc: 'Conductores offline: ponerse en línea' },
    { id: 'staff_trip', label: 'Staff · viaje nuevo', desc: 'Admin / supervisor: viaje pendiente' },
    { id: 'freight', label: 'Flete / carga', desc: 'Alertas de flete o paila' },
    { id: 'deposit', label: 'Depósito / plazo', desc: 'Recordatorios y bloqueos de depósito' },
    {
        id: 'passenger_waiting',
        label: 'Cliente · esperando conductor',
        desc: 'Se repite mientras busca conductor (hasta que acepten)'
    },
    {
        id: 'passenger_accepted',
        label: 'Cliente · viaje aceptado',
        desc: 'Suena una vez cuando un conductor acepta el viaje'
    }
];

/** Catálogo de tonos sintetizados (id estable) */
export const TONE_CATALOG = [
    {
        id: 'soft_ding',
        name: 'Ding suave',
        flavor: 'web',
        blurb: 'Un toque corto y limpio — ideal para avisos web',
        notes: [{ f: 880, t: 0, d: 0.55, v: 0.22, wave: 'sine' }]
    },
    {
        id: 'web_chime',
        name: 'Campanita web',
        flavor: 'web',
        blurb: 'Dos notas suaves (estilo PWA / navegador)',
        notes: [
            { f: 740, t: 0, d: 0.18, v: 0.2, wave: 'sine' },
            { f: 988, t: 0.16, d: 0.35, v: 0.24, wave: 'sine' }
        ]
    },
    {
        id: 'web_bubble',
        name: 'Burbuja',
        flavor: 'web',
        blurb: 'Sube de tono, amable para chat o avisos ligeros',
        notes: [
            { f: 520, t: 0, d: 0.12, v: 0.18, wave: 'triangle' },
            { f: 680, t: 0.1, d: 0.12, v: 0.2, wave: 'triangle' },
            { f: 860, t: 0.2, d: 0.22, v: 0.22, wave: 'triangle' }
        ]
    },
    {
        id: 'native_pulse',
        name: 'Pulso nativo',
        flavor: 'native',
        blurb: 'Ritmo más marcado para la APK (se distingue del web)',
        notes: [
            { f: 660, t: 0, d: 0.12, v: 0.34, wave: 'square' },
            { f: 660, t: 0.18, d: 0.12, v: 0.34, wave: 'square' },
            { f: 880, t: 0.4, d: 0.28, v: 0.3, wave: 'triangle' }
        ]
    },
    {
        id: 'native_siren',
        name: 'Sirena corta',
        flavor: 'native',
        blurb: 'Urgente: ofertas y demanda en la app nativa',
        notes: [
            { f: 540, t: 0, d: 0.14, v: 0.36, wave: 'sawtooth' },
            { f: 900, t: 0.16, d: 0.14, v: 0.36, wave: 'sawtooth' },
            { f: 540, t: 0.34, d: 0.14, v: 0.34, wave: 'sawtooth' },
            { f: 1100, t: 0.52, d: 0.28, v: 0.32, wave: 'triangle' }
        ]
    },
    {
        id: 'trip_offer_rise',
        name: 'Oferta (ascenso)',
        flavor: 'shared',
        blurb: 'Do–Mi–Sol clásico de “hay viaje”',
        notes: [
            { f: 784, t: 0, d: 0.16, v: 0.32, wave: 'triangle' },
            { f: 1046, t: 0.2, d: 0.16, v: 0.32, wave: 'triangle' },
            { f: 1318, t: 0.4, d: 0.32, v: 0.38, wave: 'triangle' }
        ]
    },
    {
        id: 'staff_dispatch',
        name: 'Despacho staff',
        flavor: 'shared',
        blurb: 'Alerta de control para admin/supervisor',
        notes: [
            { f: 620, t: 0, d: 0.18, v: 0.42, wave: 'sawtooth' },
            { f: 920, t: 0.22, d: 0.18, v: 0.42, wave: 'sawtooth' },
            { f: 620, t: 0.48, d: 0.22, v: 0.48, wave: 'sawtooth' },
            { f: 1150, t: 0.78, d: 0.32, v: 0.4, wave: 'triangle' },
            { f: 620, t: 1.15, d: 0.14, v: 0.36, wave: 'sawtooth' }
        ]
    },
    {
        id: 'chat_pip',
        name: 'Pip de chat',
        flavor: 'shared',
        blurb: 'Pito corto y agudo para mensajes',
        notes: [{ f: 1200, t: 0, d: 0.28, v: 0.2, wave: 'sine' }]
    },
    {
        id: 'chat_double',
        name: 'Chat doble',
        flavor: 'shared',
        blurb: 'Dos pips — se oye bien en móvil',
        notes: [
            { f: 1100, t: 0, d: 0.1, v: 0.22, wave: 'sine' },
            { f: 1400, t: 0.14, d: 0.16, v: 0.24, wave: 'sine' }
        ]
    },
    {
        id: 'deposit_warn',
        name: 'Aviso depósito',
        flavor: 'shared',
        blurb: 'Tono grave → agudo para plazos y deudas',
        notes: [
            { f: 380, t: 0, d: 0.22, v: 0.3, wave: 'triangle' },
            { f: 520, t: 0.28, d: 0.22, v: 0.28, wave: 'triangle' },
            { f: 720, t: 0.56, d: 0.4, v: 0.26, wave: 'sine' }
        ]
    },
    {
        id: 'freight_horn',
        name: 'Claxon flete',
        flavor: 'shared',
        blurb: 'Más grueso y largo — fletes / carga',
        notes: [
            { f: 280, t: 0, d: 0.2, v: 0.4, wave: 'sawtooth' },
            { f: 340, t: 0.22, d: 0.2, v: 0.38, wave: 'sawtooth' },
            { f: 280, t: 0.5, d: 0.35, v: 0.42, wave: 'square' }
        ]
    },
    {
        id: 'success_ping',
        name: 'Éxito',
        flavor: 'shared',
        blurb: 'Confirmación positiva (depósito validado, etc.)',
        notes: [
            { f: 660, t: 0, d: 0.12, v: 0.22, wave: 'sine' },
            { f: 880, t: 0.12, d: 0.28, v: 0.26, wave: 'sine' }
        ]
    },
    {
        id: 'wait_tick',
        name: 'Espera (tick)',
        flavor: 'shared',
        blurb: 'Tick suave para repetir mientras el cliente espera conductor',
        notes: [
            { f: 620, t: 0, d: 0.1, v: 0.16, wave: 'sine' },
            { f: 780, t: 0.12, d: 0.16, v: 0.18, wave: 'triangle' }
        ]
    },
    {
        id: 'wait_pulse',
        name: 'Espera (pulso)',
        flavor: 'shared',
        blurb: 'Pulso más notorio para la espera (bueno en nativo)',
        notes: [
            { f: 480, t: 0, d: 0.12, v: 0.22, wave: 'triangle' },
            { f: 640, t: 0.18, d: 0.2, v: 0.2, wave: 'sine' }
        ]
    },
    {
        id: 'accepted_fanfare',
        name: 'Aceptado (fanfarria)',
        flavor: 'shared',
        blurb: 'Tres notas alegres cuando aceptan el viaje',
        notes: [
            { f: 659, t: 0, d: 0.12, v: 0.28, wave: 'triangle' },
            { f: 784, t: 0.14, d: 0.12, v: 0.3, wave: 'triangle' },
            { f: 988, t: 0.28, d: 0.35, v: 0.34, wave: 'sine' }
        ]
    }
];

const BUILTIN_BY_ID = Object.fromEntries(TONE_CATALOG.map((t) => [t.id, t]));

/** Tonos personalizados en memoria (archivos subidos) */
let customTones = [];

const DEFAULT_MAP_WEB = {
    general: 'web_chime',
    chat: 'chat_pip',
    driver_offer: 'trip_offer_rise',
    ride_demand: 'trip_offer_rise',
    staff_trip: 'staff_dispatch',
    freight: 'freight_horn',
    deposit: 'deposit_warn',
    passenger_waiting: 'wait_tick',
    passenger_accepted: 'accepted_fanfare'
};

const DEFAULT_MAP_NATIVE = {
    general: 'native_pulse',
    chat: 'chat_double',
    driver_offer: 'native_siren',
    ride_demand: 'native_siren',
    staff_trip: 'staff_dispatch',
    freight: 'freight_horn',
    deposit: 'deposit_warn',
    passenger_waiting: 'wait_pulse',
    passenger_accepted: 'accepted_fanfare'
};

/** Intervalo del bucle de espera (ms) */
export const PASSENGER_WAIT_LOOP_MS = 2800;

let sharedCtx = null;
let lastFileAudio = null;
let loopTimer = null;
let loopEventId = null;
let loopPlatform = null;

function getAudioContext() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AC();
        if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
        return sharedCtx;
    } catch (_) {
        return null;
    }
}

export function unlockNotificationTones() {
    const ctx = getAudioContext();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

function platformKey() {
    return isCapacitorNative() ? 'native' : 'web';
}

function defaultMapForPlatform(platform = platformKey()) {
    return { ...(platform === 'native' ? DEFAULT_MAP_NATIVE : DEFAULT_MAP_WEB) };
}

function loadCustomTonesLocal() {
    try {
        const raw = localStorage.getItem(CUSTOM_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((t) => t?.id && t?.url) : [];
    } catch (_) {
        return [];
    }
}

function persistCustomTonesLocal() {
    try {
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(customTones));
    } catch (_) {}
}

/** Inicializa custom tones desde localStorage al arrancar */
export function initCustomTonesFromCache() {
    customTones = loadCustomTonesLocal();
}

export function getCustomTones() {
    return [...customTones];
}

export function setCustomTones(list = []) {
    customTones = (Array.isArray(list) ? list : [])
        .filter((t) => t?.id && (t.url || t.notes))
        .map((t) => ({
            id: String(t.id),
            name: String(t.name || 'Tono personalizado').slice(0, 60),
            flavor: 'custom',
            kind: t.kind || (t.url ? 'file' : 'synth'),
            blurb: t.blurb || 'Subido por admin',
            url: t.url || null,
            notes: t.notes || null,
            fileName: t.fileName || null,
            createdAt: t.createdAt || Date.now()
        }));
    persistCustomTonesLocal();
    return getCustomTones();
}

export function upsertCustomTone(tone) {
    if (!tone?.id) return getCustomTones();
    const next = getCustomTones().filter((t) => t.id !== tone.id);
    next.unshift({
        id: String(tone.id),
        name: String(tone.name || 'Tono personalizado').slice(0, 60),
        flavor: 'custom',
        kind: tone.kind || (tone.url ? 'file' : 'synth'),
        blurb: tone.blurb || 'Subido por admin',
        url: tone.url || null,
        notes: tone.notes || null,
        fileName: tone.fileName || null,
        createdAt: tone.createdAt || Date.now()
    });
    return setCustomTones(next);
}

export function removeCustomTone(toneId) {
    return setCustomTones(getCustomTones().filter((t) => t.id !== toneId));
}

export function getToneById(id) {
    if (!id) return null;
    if (BUILTIN_BY_ID[id]) return BUILTIN_BY_ID[id];
    return customTones.find((t) => t.id === id) || null;
}

export function listTones({ flavor = null, includeCustom = true } = {}) {
    let list = [...TONE_CATALOG];
    if (includeCustom) list = list.concat(customTones);
    if (!flavor) return list;
    if (flavor === 'custom') return customTones.slice();
    return list.filter((t) => t.flavor === flavor || t.flavor === 'shared' || t.flavor === 'custom');
}

/**
 * Preferencias:
 * { web: { eventId: toneId }, native: { ... } }
 */
export function loadTonePrefs() {
    const base = {
        web: defaultMapForPlatform('web'),
        native: defaultMapForPlatform('native')
    };
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return base;
        const parsed = JSON.parse(raw);
        if (parsed?.web && typeof parsed.web === 'object') {
            base.web = { ...base.web, ...parsed.web };
        }
        if (parsed?.native && typeof parsed.native === 'object') {
            base.native = { ...base.native, ...parsed.native };
        }
        if (!parsed.web && !parsed.native && typeof parsed === 'object') {
            TONE_EVENTS.forEach((ev) => {
                if (parsed[ev.id]) {
                    base.web[ev.id] = parsed[ev.id];
                    base.native[ev.id] = parsed[ev.id];
                }
            });
        }
    } catch (_) {}
    return base;
}

export function saveTonePrefs(prefs) {
    const next = {
        web: { ...defaultMapForPlatform('web'), ...(prefs?.web || {}) },
        native: { ...defaultMapForPlatform('native'), ...(prefs?.native || {}) }
    };
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch (_) {}
    return next;
}

/**
 * Aplica config remota (appSettings) para todos los usuarios.
 * @param {{ toneMap?: object, customTones?: array }} remote
 */
export function applyRemoteToneConfig(remote = {}) {
    if (Array.isArray(remote.customTones)) {
        setCustomTones(remote.customTones);
    }
    if (remote.toneMap && typeof remote.toneMap === 'object') {
        saveTonePrefs(remote.toneMap);
    }
    return {
        toneMap: loadTonePrefs(),
        customTones: getCustomTones()
    };
}

export function getEventToneId(eventId, platform = platformKey()) {
    const prefs = loadTonePrefs();
    const map = prefs[platform] || defaultMapForPlatform(platform);
    const id = map[eventId] || defaultMapForPlatform(platform)[eventId] || 'soft_ding';
    if (getToneById(id)) return id;
    return defaultMapForPlatform(platform)[eventId] || 'soft_ding';
}

function playNotes(notes = []) {
    const ctx = getAudioContext();
    if (!ctx || !notes.length) return false;
    try {
        const endPad = 0.06;
        notes.forEach((n) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();
            osc.type = n.wave || 'sine';
            osc.frequency.value = n.f;
            filter.type = 'lowpass';
            filter.frequency.value = Math.max(1200, (n.f || 800) * 1.8);
            const t0 = ctx.currentTime + (n.t || 0);
            const dur = Math.max(0.05, n.d || 0.2);
            const vol = Math.min(0.55, Math.max(0.05, n.v ?? 0.28));
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + dur + endPad);
        });
        return true;
    } catch (_) {
        return false;
    }
}

function playFileUrl(url) {
    if (!url) return false;
    try {
        if (lastFileAudio) {
            try {
                lastFileAudio.pause();
                lastFileAudio.currentTime = 0;
            } catch (_) {}
        }
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.volume = 0.9;
        lastFileAudio = audio;
        const p = audio.play();
        if (p?.catch) p.catch(() => {});
        return true;
    } catch (_) {
        return false;
    }
}

/** Reproduce un tono del catálogo o personalizado */
export function playToneById(toneId) {
    unlockNotificationTones();
    const tone = getToneById(toneId);
    if (!tone) return false;
    if (tone.url || tone.kind === 'file') {
        return playFileUrl(tone.url);
    }
    if (tone.notes?.length) return playNotes(tone.notes);
    return false;
}

export function playEventTone(eventId, { platform = platformKey() } = {}) {
    const toneId = getEventToneId(eventId, platform);
    return playToneById(toneId);
}

export function playGeneralTone() {
    return playEventTone('general');
}
export function playChatTone() {
    return playEventTone('chat');
}
export function playDriverOfferTone() {
    return playEventTone('driver_offer');
}
export function playRideDemandTone() {
    return playEventTone('ride_demand');
}
export function playStaffTripTone() {
    return playEventTone('staff_trip');
}
export function playFreightTone() {
    return playEventTone('freight');
}
export function playDepositTone() {
    return playEventTone('deposit');
}
export function playPassengerWaitingTone() {
    return playEventTone('passenger_waiting');
}
export function playPassengerAcceptedTone() {
    return playEventTone('passenger_accepted');
}

/**
 * Reproduce en bucle el tono de un evento (p. ej. espera del pasajero).
 * Se detiene con stopLoopingTone().
 */
export function startLoopingEventTone(eventId, {
    intervalMs = PASSENGER_WAIT_LOOP_MS,
    platform = platformKey(),
    playImmediately = true
} = {}) {
    if (!eventId) return false;
    // Si ya suena el mismo evento, no reiniciar (evita “reset” en cada snapshot)
    if (loopTimer && loopEventId === eventId && loopPlatform === platform) {
        return true;
    }
    stopLoopingTone();
    loopEventId = eventId;
    loopPlatform = platform;
    unlockNotificationTones();
    const tick = () => {
        if (loopEventId !== eventId) return;
        playEventTone(eventId, { platform });
    };
    if (playImmediately) tick();
    loopTimer = setInterval(tick, Math.max(1200, Number(intervalMs) || PASSENGER_WAIT_LOOP_MS));
    return true;
}

export function stopLoopingTone() {
    if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
    }
    loopEventId = null;
    loopPlatform = null;
    if (lastFileAudio) {
        try {
            lastFileAudio.pause();
            lastFileAudio.currentTime = 0;
        } catch (_) {}
    }
}

export function isLoopingToneActive(eventId = null) {
    if (!loopTimer) return false;
    if (eventId) return loopEventId === eventId;
    return true;
}

/** Espera del pasajero: bucle hasta que acepten o cancelen */
export function startPassengerWaitingLoop(opts = {}) {
    return startLoopingEventTone('passenger_waiting', {
        intervalMs: opts.intervalMs ?? PASSENGER_WAIT_LOOP_MS,
        platform: opts.platform,
        playImmediately: opts.playImmediately !== false
    });
}

export function stopPassengerWaitingLoop() {
    if (loopEventId === 'passenger_waiting' || !loopEventId) {
        stopLoopingTone();
    }
}

export function resolveToneEventFromPush(data = {}) {
    const type = String(data.type || '');
    const tag = String(data.tag || '');
    if (type === 'chat' || data.openChat === 'true' || tag.startsWith('chat-')) return 'chat';
    if (type === 'freight_trip_alert' || tag.startsWith('freight-')) return 'freight';
    if (type === 'ride_demand_alert' || tag.startsWith('ride-demand-')) return 'ride_demand';
    if (type === 'new_trip_staff' || tag.startsWith('staff-trip-')) return 'staff_trip';
    if (type === 'trip_offer' || tag.startsWith('trip-offer-')) return 'driver_offer';
    if (
        type === 'deposit_deadline_warning'
        || type === 'deposit_auto_blocked'
        || type === 'deposit_grace'
        || type === 'deposit_verified'
        || tag.startsWith('deposit-')
        || tag.startsWith('dep-')
    ) return 'deposit';
    return 'general';
}

export function getPlatformToneLabel() {
    return isCapacitorNative() ? 'App nativa (APK)' : 'Web / PWA';
}

export function isAllowedAudioFile(file) {
    if (!file) return false;
    if (file.size > MAX_CUSTOM_BYTES) return false;
    const type = String(file.type || '');
    if (type && ALLOWED_AUDIO.test(type)) return true;
    // Algunos SO no mandan type: mirar extensión
    const name = String(file.name || '').toLowerCase();
    return /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(name);
}

export function makeCustomToneId() {
    return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getMaxCustomBytes() {
    return MAX_CUSTOM_BYTES;
}

/** Opciones HTML para <select> de tonos */
export function buildToneOptionsHtml(selectedId = '') {
    const groups = [
        { label: 'Web', items: listTones({ flavor: 'web', includeCustom: false }) },
        { label: 'Nativo', items: listTones({ flavor: 'native', includeCustom: false }) },
        { label: 'Compartidos', items: listTones({ flavor: 'shared', includeCustom: false }) },
        { label: 'Personalizados', items: getCustomTones() }
    ];
    let html = '';
    groups.forEach((g) => {
        if (!g.items.length) return;
        html += `<optgroup label="${g.label}">`;
        g.items.forEach((t) => {
            const sel = t.id === selectedId ? ' selected' : '';
            const safeName = String(t.name || t.id).replace(/</g, '&lt;').replace(/"/g, '&quot;');
            html += `<option value="${t.id}"${sel}>${safeName}</option>`;
        });
        html += '</optgroup>';
    });
    return html;
}

export function installNotificationTonesApi() {
    initCustomTonesFromCache();

    window.resolveToneEventFromPush = resolveToneEventFromPush;
    window.playEventNotificationTone = (eventId) => playEventTone(eventId);
    window.HonduTones = {
        catalog: TONE_CATALOG,
        events: TONE_EVENTS,
        listTones,
        getToneById,
        playToneById,
        playEventTone,
        loadTonePrefs,
        saveTonePrefs,
        getEventToneId,
        resolveToneEventFromPush,
        getPlatformToneLabel,
        unlock: unlockNotificationTones,
        defaults: { web: DEFAULT_MAP_WEB, native: DEFAULT_MAP_NATIVE },
        getCustomTones,
        setCustomTones,
        upsertCustomTone,
        removeCustomTone,
        applyRemoteToneConfig,
        isAllowedAudioFile,
        makeCustomToneId,
        getMaxCustomBytes,
        buildToneOptionsHtml
    };

    window.playNotificationSound = () => playGeneralTone();
    window.playChatSound = () => playChatTone();
    window.playDriverTripOfferSound = () => playDriverOfferTone();
    window.playStaffTripAlertSound = () => playStaffTripTone();
    window.playFreightAlertSound = () => playFreightTone();
    window.playDepositAlertSound = () => playDepositTone();
    window.playRideDemandSound = () => playRideDemandTone();
    window.playPassengerWaitingSound = () => playPassengerWaitingTone();
    window.playPassengerAcceptedSound = () => playPassengerAcceptedTone();
    window.playEventNotificationTone = (eventId) => playEventTone(eventId);
    window.startPassengerWaitingLoop = (opts) => startPassengerWaitingLoop(opts);
    window.stopPassengerWaitingLoop = () => stopPassengerWaitingLoop();
    window.stopNotificationToneLoop = () => stopLoopingTone();

    const unlock = () => unlockNotificationTones();
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach((evt) => {
        document.addEventListener(evt, unlock, { passive: true, capture: true });
    });
}
