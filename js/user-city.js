/**
 * v.42 Ciudad del usuario por GPS (pasajeros y conductores).
 * Antes: al registrarse sin GPS listo quedaba la ciudad por defecto («Comayagua») y nunca se corregía.
 * Ahora: el 1er GPS fija la ciudad real; si después está de forma constante en otra ciudad se cambia
 * (o se sugiere si la eligió a mano). Reglas en user-city-rules.js.
 */
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { findZoneForCoords, findNearestZone, getZoneById, setActiveServiceZone, updateServiceZoneSummary, updateZoneHint } from './zones.js?v=2026.10.26.50';
import { ucDecide, ucAddSample, ucDetect } from './user-city-rules.js?v=2026.10.26.50';

const W = window;
const uid = () => W.currentUser?.uid || W.auth?.currentUser?.uid || null;
const HKEY = (u) => `hr_city_samples_${u}`;
const SUGKEY = (u) => `hr_city_suggested_${u}`;

/** Ciudad para un punto: cobertura de la ciudad más cercana; si no, la más cercana dentro de Honduras. */
export function detectCityId(lat, lng) {
    return ucDetect({ findZoneForCoords, findNearestZone }, lat, lng);
}

const readHist = (u) => { try { return JSON.parse(localStorage.getItem(HKEY(u)) || '[]'); } catch (_) { return []; } };
const writeHist = (u, h) => { try { localStorage.setItem(HKEY(u), JSON.stringify(h)); } catch (_) {} };

function permissionGranted() {
    try {
        if (!navigator.permissions?.query) return Promise.resolve(false);
        return navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state === 'granted').catch(() => false);
    } catch (_) { return Promise.resolve(false); }
}

/** Posición actual sin volver a pedir permiso (usa la del conductor si ya está viva). */
async function currentPos() {
    const d = W.currentDriverPos || W._driverLivePos;
    if (d && Number.isFinite(Number(d.lat))) return { lat: Number(d.lat), lng: Number(d.lng) };
    if (W._hrLastGpsFix && Date.now() - W._hrLastGpsFix.t < 10 * 60e3) return W._hrLastGpsFix;
    if (!navigator.geolocation || !(await permissionGranted())) return null;
    return new Promise((res) => {
        const to = setTimeout(() => res(null), 6000);
        navigator.geolocation.getCurrentPosition((p) => {
            clearTimeout(to);
            W._hrLastGpsFix = { lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now() };
            res(W._hrLastGpsFix);
        }, () => { clearTimeout(to); res(null); }, { enableHighAccuracy: false, maximumAge: 5 * 60e3, timeout: 6000 });
    });
}

/** Guarda la ciudad en perfil privado + público (+ drivers_location si es conductor). */
export async function saveUserCity(zoneId, source, { quiet = false, detectedLat = null, detectedLng = null } = {}) {
    const u = uid(); const zone = getZoneById(zoneId);
    if (!u || !zone || !W.db || !W.appId) return false;
    const patch = { serviceZoneId: zone.id, serviceZoneName: zone.name, cityId: zone.id, cityName: zone.name, serviceZoneSource: source, serviceZoneSetAtMs: Date.now(), updatedAt: Date.now() };
    if (detectedLat != null) Object.assign(patch, { serviceZoneDetectedLat: Number(detectedLat), serviceZoneDetectedLng: Number(detectedLng) });
    await setDoc(doc(W.db, 'artifacts', W.appId, 'users', u, 'profile', 'data'), patch, { merge: true });
    await setDoc(doc(W.db, 'artifacts', W.appId, 'public', 'data', 'users', u), patch, { merge: true }).catch(() => {});
    if (W.userProfile) Object.assign(W.userProfile, patch);
    const isDriver = W.userProfile?.role === 'driver';
    if (W.activeServiceZoneId !== zone.id) {
        try { setActiveServiceZone(zone.id, { persist: true, biasMap: !isDriver }); } catch (_) {}
        try { updateServiceZoneSummary(); updateZoneHint(); } catch (_) {}
    }
    if (isDriver) {
        try { await W.forceRefreshDriverLocationZone?.(); } catch (_) {}
        try { W.startDriverListener?.(); } catch (_) {}
    }
    if (!quiet) W.showToast?.(`📍 Tu ciudad: ${zone.name} (según tu ubicación). Puedes cambiarla en tu perfil.`, 'success');
    return true;
}

let running = false;
/** Una lectura: detectar ciudad, guardar muestra y aplicar la regla. */
export async function checkUserCity({ pos = null } = {}) {
    const u = uid(); const p = W.userProfile;
    if (running || !u || !p || !['client', 'driver'].includes(p.role || 'client')) return null;
    running = true;
    try {
        const at = pos || await currentPos();
        if (!at) return null;
        const zoneId = detectCityId(at.lat, at.lng);
        const now = Date.now();
        const hist = ucAddSample(readHist(u), zoneId, now);
        writeHist(u, hist);
        const busy = !!(W.activeTrip && ['accepted', 'in_progress', 'arrived'].includes(W.activeTrip.status));
        const r = ucDecide({ profile: p, detectedZoneId: zoneId, history: hist, now, busy });
        if (r.action === 'set') await saveUserCity(r.zoneId, 'gps', { detectedLat: at.lat, detectedLng: at.lng });
        else if (r.action === 'confirm') await saveUserCity(r.zoneId, 'gps', { quiet: true, detectedLat: at.lat, detectedLng: at.lng });
        else if (r.action === 'suggest') {
            const day = new Date().toISOString().slice(0, 10);
            if (localStorage.getItem(SUGKEY(u)) !== day) {
                try { localStorage.setItem(SUGKEY(u), day); } catch (_) {}
                const z = getZoneById(r.zoneId);
                W.showToast?.(`📍 Hace días te vemos en ${z?.name || 'otra ciudad'}. Si ahora estás ahí, cámbiala en «Ciudad».`, 'info');
            }
        }
        return { zoneId, ...r };
    } catch (e) { console.warn('[user-city]', e); return null; }
    finally { running = false; }
}

/** Para el registro: ciudad por GPS (o null si no hay permiso/fijo). Nunca inventa «Comayagua». */
export async function detectCityForSignup() {
    const at = await currentPos();
    const id = at ? detectCityId(at.lat, at.lng) : null;
    return id ? { zoneId: id, source: 'gps', lat: at.lat, lng: at.lng } : null;
}

W.hrUserCity = { detectCityId, checkUserCity, saveUserCity, detectCityForSignup };
// Primer chequeo poco después del login y luego cada 10 min (solo usa GPS si el permiso ya está dado).
setTimeout(() => checkUserCity(), 8000);
setInterval(() => checkUserCity(), 10 * 60e3);
