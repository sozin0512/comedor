/**
 * Alertas de proximidad para pasajeros (sonido, voz, push, vibración).
 */
import { notifyTripEvent } from './trip-notifications.js';

const PREFS_KEY = 'honduber_passenger_alerts';

const DEFAULT_PREFS = {
    sound: true,
    voice: true,
    notify: true,
    vibrate: true
};

const PICKUP_ALERT_RULES = [
    {
        key: 'prep_5',
        test: (mins) => mins <= 5 && mins > 3,
        title: 'Conductor en camino',
        body: (n) => `${n} llega en ~5 min. ¡Allista tus cosas!`,
        speak: (n) => `${n} llega en unos cinco minutos. Allista tus cosas y prepárate.`,
        toastType: 'info'
    },
    {
        key: 'prep_3',
        test: (mins) => mins <= 3 && mins > 1,
        title: '¡Está cerca!',
        body: (n) => `${n} viene en ~3 min. Prepárate para salir.`,
        speak: (n) => `Atención. ${n} está cerca y llega en unos tres minutos. Prepárate.`,
        toastType: 'warning'
    },
    {
        key: 'near_1',
        test: (mins) => mins <= 1,
        title: '¡Ya casi llega!',
        body: (n) => `${n} está a menos de 1 minuto. Sal cuando puedas.`,
        speak: (n) => `Ya casi. ${n} está a menos de un minuto. Sal al punto de encuentro.`,
        toastType: 'warning'
    },
    {
        key: 'near_400m',
        test: (mins, meters) => meters > 0 && meters <= 400,
        title: '¡Muy cerca!',
        body: (n) => `${n} está a la vuelta. Revisa tu PIN y sal ya.`,
        speak: (n) => `${n} está muy cerca, a pocos metros. Revisa tu PIN y sal ya.`,
        toastType: 'success'
    }
];

const DESTINATION_ALERT_RULES = [
    {
        key: 'dest_5',
        test: (mins) => mins <= 5 && mins > 2,
        title: 'Llegando al destino',
        body: (n) => `~5 min para llegar. ${n} te lleva al destino.`,
        speak: () => 'Llegaremos a tu destino en unos cinco minutos.',
        toastType: 'info'
    },
    {
        key: 'dest_2',
        test: (mins) => mins <= 2 && mins > 0,
        title: 'Casi en el destino',
        body: (n) => `~2 min. ${n} está por llegar.`,
        speak: () => 'Casi llegamos a tu destino. Prepárate para bajar.',
        toastType: 'warning'
    },
    {
        key: 'dest_near',
        test: (mins, meters) => meters > 0 && meters <= 350,
        title: '¡Ya casi llegamos!',
        body: () => 'Tu destino está a la vuelta de la esquina.',
        speak: () => 'Ya casi llegamos. Tu destino está muy cerca.',
        toastType: 'success'
    }
];

export function getPassengerAlertPrefs() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...DEFAULT_PREFS };
}

export function savePassengerAlertPrefs(patch) {
    const next = { ...getPassengerAlertPrefs(), ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch (_) {}
    return next;
}

function ensureAlertSession(tripId) {
    if (!window._passengerAlertSession || window._passengerAlertSession.tripId !== tripId) {
        window._passengerAlertSession = { tripId, fired: new Set() };
    }
    return window._passengerAlertSession;
}

export function resetPassengerAlertSession(tripId = null) {
    if (!tripId) {
        window._passengerAlertSession = null;
        return;
    }
    if (window._passengerAlertSession?.tripId === tripId) {
        window._passengerAlertSession = null;
    }
}

let alertAudioCtx = null;
let alertsMediaUnlocked = false;
let alertUnlockBound = false;

function getAlertAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!alertAudioCtx || alertAudioCtx.state === 'closed') {
        alertAudioCtx = new Ctx();
    }
    return alertAudioCtx;
}

export async function unlockPassengerAlertMedia() {
    const ctx = getAlertAudioContext();
    if (!ctx) return false;
    try {
        if (ctx.state === 'suspended') await ctx.resume();
        alertsMediaUnlocked = ctx.state === 'running';
    } catch (_) {
        alertsMediaUnlocked = false;
    }
    return alertsMediaUnlocked;
}

function initPassengerAlertUnlock() {
    if (alertUnlockBound) return;
    alertUnlockBound = true;
    const unlock = () => { unlockPassengerAlertMedia(); };
    document.addEventListener('pointerdown', unlock, { once: false, passive: true });
    document.addEventListener('keydown', unlock, { once: false, passive: true });
}

async function playPassengerAlertSound() {
    if (!alertsMediaUnlocked) return;
    try {
        const ctx = getAlertAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            await ctx.resume();
            if (ctx.state !== 'running') return;
        }
        const playTone = (freq, start, dur) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.22, start);
            gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + dur);
        };
        const t = ctx.currentTime;
        playTone(740, t, 0.18);
        playTone(988, t + 0.22, 0.22);
        playTone(1175, t + 0.48, 0.28);
    } catch (_) {
        if (alertsMediaUnlocked) window.playNotificationSound?.();
    }
}

function speakPassengerAlert(text) {
    if (!text) return;
    if (typeof window.speakMessage === 'function') {
        window.speakMessage(text);
        return;
    }
    if (!('speechSynthesis' in window)) return;
    try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-HN';
        u.rate = 1.02;
        const voice = window.pickSpanishVoice?.();
        if (voice) u.voice = voice;
        window.speechSynthesis.speak(u);
    } catch (_) {}
}

function dispatchPassengerAlert({ tripId, tag, title, body, speak, toastType = 'info', phase }) {
    const prefs = getPassengerAlertPrefs();
    const toastMsg = body;

    window.showToast?.(toastMsg, toastType);

    if (prefs.sound && alertsMediaUnlocked) playPassengerAlertSound();
    if (prefs.vibrate && alertsMediaUnlocked) {
        try { navigator.vibrate?.([120, 60, 120, 60, 200]); } catch (_) {}
    }
    if (prefs.voice && speak) speakPassengerAlert(speak);
    if (prefs.notify) {
        notifyTripEvent({
            title,
            body,
            tag: tag || `passenger-alert-${tripId}`,
            tripId,
            force: true,
            sound: 'none'
        });
    }
}

export function updatePassengerProximityAlerts(route, tripData, phase = 'pickup') {
    if (!route || !tripData?.id) return;
    if (window.userProfile?.role !== 'client') return;
    if (tripData.status === 'accepted' && tripData.driverArrived) return;
    if (!['pickup', 'destination'].includes(phase)) return;

    const mins = Math.max(0, Math.round((route.durationMillis || 0) / 60000));
    const meters = Number.isFinite(route.distanceMeters)
        ? route.distanceMeters
        : Math.round((window.getRouteDistanceKm?.(route) || 0) * 1000);
    const firstName = (tripData.driverName || 'Tu conductor').split(' ')[0];
    const session = ensureAlertSession(tripData.id);
    const rules = phase === 'destination' ? DESTINATION_ALERT_RULES : PICKUP_ALERT_RULES;

    rules.forEach((rule) => {
        if (session.fired.has(rule.key)) return;
        if (!rule.test(mins, meters, tripData)) return;
        session.fired.add(rule.key);

        const body = typeof rule.body === 'function' ? rule.body(firstName) : rule.body;
        const speak = typeof rule.speak === 'function' ? rule.speak(firstName) : rule.speak;

        dispatchPassengerAlert({
            tripId: tripData.id,
            tag: `passenger-${phase}-${rule.key}-${tripData.id}`,
            title: rule.title,
            body,
            speak,
            toastType: rule.toastType,
            phase
        });
    });
}

export function triggerPassengerArrivedAlert(tripData) {
    if (!tripData?.id || window.userProfile?.role !== 'client') return;
    const session = ensureAlertSession(tripData.id);
    if (session.fired.has('arrived')) return;
    session.fired.add('arrived');

    const firstName = (tripData.driverName || 'Tu conductor').split(' ')[0];
    dispatchPassengerAlert({
        tripId: tripData.id,
        tag: `passenger-arrived-${tripData.id}`,
        title: '¡Tu conductor llegó!',
        body: `${firstName} ya está en el punto. Muéstrale tu PIN.`,
        speak: `${firstName} ya llegó. Muéstrale tu PIN de seguridad.`,
        toastType: 'success',
        phase: 'pickup'
    });
}

export function initPassengerAlertSettings() {
    const wrap = document.getElementById('passenger-alert-settings');
    if (!wrap || wrap.dataset.bound === '1') return;
    wrap.dataset.bound = '1';

    initPassengerAlertUnlock();

    const prefs = getPassengerAlertPrefs();
    const map = {
        'pa-alert-sound': 'sound',
        'pa-alert-voice': 'voice',
        'pa-alert-notify': 'notify',
        'pa-alert-vibrate': 'vibrate'
    };

    Object.entries(map).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = prefs[key] !== false;
        el.addEventListener('change', () => {
            savePassengerAlertPrefs({ [key]: el.checked });
            if (key === 'voice' && el.checked) {
                speakPassengerAlert('Alertas de voz activadas.');
            } else if (key === 'sound' && el.checked) {
                unlockPassengerAlertMedia().then(() => playPassengerAlertSound());
            } else if (key === 'vibrate' && el.checked) {
                unlockPassengerAlertMedia();
            }
        });
    });
}

export function syncPassengerAlertSettingsVisibility(isClientTrip = false) {
    const wrap = document.getElementById('passenger-alert-settings');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !isClientTrip);
    if (isClientTrip) {
        initPassengerAlertUnlock();
        initPassengerAlertSettings();
    }
}