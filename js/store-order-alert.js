/**
 * Sonido de «Pedido de tienda» para conductores de moto y carro (moto, taxi, Taxi VIP = 'auto').
 * Cuando una tienda/restaurante pide un delivery y la oferta le aparece al conductor,
 * suena sounds/nuevo-pedido.mp3 en bucle (+ vibración) hasta que:
 *  - acepta o pasa (markStoreOrderHandled), o
 *  - la oferta ya no está en su lista (venció, la tomó otro, la cancelaron).
 * Autoplay: se "desbloquea" el <audio> en la primera interacción del usuario.
 * Sin dependencias: probado en scripts/test-sonido-pedidos.mjs.
 */
export const STORE_ORDER_SOUND_URL = 'sounds/nuevo-pedido.mp3';
export const STORE_ALERT_VEHICLES = ['moto', 'taxi', 'auto', 'vip', 'taxi_vip'];
const VIBRATE_PATTERN = [400, 150, 400, 150, 700];
const VIBRATE_EVERY_MS = 2500;

export function isStoreOrderTrip(t) {
    if (!t || typeof t !== 'object') return false;
    return !!(t.storeOrderId || t.storeOrder === true || t.storeDelivery === true || t.merchantDirectDelivery === true || t.createdByMerchant === true || t.tripKind === "store_order" || t.tripKind === "merchant_delivery" || t.deliveryDetails?.storeOrderId || t.deliveryDetails?.storeDelivery === true || t.deliveryDetails?.merchantDirectDelivery === true || t.requestSource === "whatsapp_store_delivery" || t.createdVia === "whatsapp_store" || t.waStoreId);
}

const S = { audio: null, unlocked: false, playing: false, activeIds: new Set(), handled: new Set(), vibTimer: null, pendingStart: false };

function getAudio() {
    if (S.audio) return S.audio;
    if (typeof Audio === 'undefined') return null;
    const a = new Audio(STORE_ORDER_SOUND_URL);
    a.loop = true;
    a.preload = 'auto';
    S.audio = a;
    return a;
}
function vibrateOnce() { try { navigator.vibrate?.(VIBRATE_PATTERN); } catch (_) {} }

/** Primer toque/tecla: reproducir en silencio y pausar para que luego suene sin gesto. */
export function unlockStoreOrderAudio() {
    const a = getAudio();
    if (!a || S.unlocked) return;
    if (S.playing && !a.paused) { S.unlocked = true; return; }
    a.muted = true;
    const done = () => {
        S.unlocked = true;
        a.muted = false;
        if (S.playing) { S.pendingStart = false; startSound(true); }
        else { try { a.pause(); a.currentTime = 0; } catch (_) {} }
    };
    try {
        const p = a.play();
        if (p && typeof p.then === 'function') p.then(done).catch(() => { a.muted = false; });
        else done();
    } catch (_) { a.muted = false; }
}

let listenersBound = false;
export function bindStoreOrderAudioUnlock(target = (typeof document !== 'undefined' ? document : null)) {
    if (listenersBound || !target) return;
    listenersBound = true;
    const h = () => unlockStoreOrderAudio();
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach((ev) => target.addEventListener(ev, h, { capture: true, passive: true }));
}

function startSound(force = false) {
    const a = getAudio();
    S.playing = true;
    if (!S.vibTimer) { vibrateOnce(); S.vibTimer = setInterval(vibrateOnce, VIBRATE_EVERY_MS); }
    if (!a) return;
    a.loop = true;
    a.muted = false;
    if (!a.paused && !force) return;
    try {
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => { if (S.playing) S.pendingStart = true; });
    } catch (_) { S.pendingStart = true; }
}

export function stopStoreOrderAlert() {
    S.playing = false;
    S.pendingStart = false;
    S.activeIds.clear();
    if (S.vibTimer) { clearInterval(S.vibTimer); S.vibTimer = null; try { navigator.vibrate?.(0); } catch (_) {} }
    if (S.audio) { try { S.audio.pause(); S.audio.currentTime = 0; } catch (_) {} }
}

function driverHearsStoreAlert(vehicleTypes) {
    const list = (Array.isArray(vehicleTypes) ? vehicleTypes : [vehicleTypes]).map((v) => String(v || '').toLowerCase()).filter(Boolean);
    if (!list.length) return true;
    return list.some((v) => STORE_ALERT_VEHICLES.includes(v));
}

/** Cada snapshot con las ofertas visibles: suena si hay un pedido de tienda sin atender, si no se calla. */
export function syncStoreOrderAlert(offers, { vehicleTypes = [] } = {}) {
    const ids = (offers || []).filter((t) => t && t.id && isStoreOrderTrip(t) && !S.handled.has(t.id)).map((t) => t.id);
    if (!ids.length || !driverHearsStoreAlert(vehicleTypes)) {
        if (S.playing) stopStoreOrderAlert();
        return false;
    }
    S.activeIds = new Set(ids);
    if (!S.playing || (S.audio && S.audio.paused && !S.pendingStart)) startSound();
    return true;
}

/** Aceptó o pasó: ese pedido ya no suena. */
export function markStoreOrderHandled(tripId) {
    if (!tripId) return;
    S.handled.add(tripId);
    S.activeIds.delete(tripId);
    if (!S.activeIds.size) stopStoreOrderAlert();
}
export function isStoreOrderAlertPlaying() { return S.playing; }
