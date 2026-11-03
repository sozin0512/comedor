/**
 * v.42 Ciudad del usuario por GPS — reglas puras (sin DOM / Firestore), probadas en Node.
 *
 * serviceZoneSource en el perfil:
 *   'manual'  → la persona eligió la ciudad en la lista: nunca se cambia sola (solo se sugiere).
 *   'gps'     → detectada por GPS: se corrige si la persona está de forma constante en otra ciudad.
 *   'trip'    → guardada al pedir un viaje / elegir origen: igual que 'gps'.
 *   'default' → no había GPS al registrarse (antes quedaba «Comayagua»): se corrige en el 1er GPS.
 *   (sin campo, perfiles viejos) → si es 'comayagua' o vacío se trata como sospechoso de default;
 *                                  cualquier otra ciudad se respeta como elegida.
 */
export const UC_DEFAULT_SUSPECT_ID = 'comayagua';
export const UC_CONSISTENT_DAYS = 3;          // días distintos vistos en la otra ciudad…
export const UC_WINDOW_DAYS = 14;             // …dentro de estos últimos días
export const UC_HOME_QUIET_DAYS = 3;          // y sin aparecer en su ciudad actual en estos días
export const UC_LEGACY_CONFIRM_MS = 2 * 3600e3; // perfil viejo «Comayagua»: 2 lecturas separadas ≥2 h
export const UC_SAMPLE_GAP_MS = 10 * 60e3;    // como mucho 1 muestra cada 10 min
export const UC_MAX_SAMPLES = 80;

const DAY = 864e5;
export const ucDayKey = (ms, tzOffsetMin = 360) => new Date(ms - tzOffsetMin * 60e3).toISOString().slice(0, 10); // día en Honduras (UTC-6)

export function ucEffectiveSource(profile) {
    const s = profile?.serviceZoneSource;
    if (s) return s;
    const z = profile?.serviceZoneId || profile?.cityId || null;
    if (!z || z === UC_DEFAULT_SUSPECT_ID) return 'legacy_default';
    return 'legacy';
}

/** Añade una muestra (ciudad detectada) al historial local. Devuelve un historial nuevo. */
export function ucAddSample(history, zoneId, now) {
    const h = Array.isArray(history) ? history.filter((s) => s && now - s.t < UC_WINDOW_DAYS * DAY) : [];
    if (!zoneId) return h;
    const last = h[h.length - 1];
    if (last && last.z === zoneId && now - last.t < UC_SAMPLE_GAP_MS) return h;
    h.push({ z: zoneId, t: now, d: ucDayKey(now) });
    return h.slice(-UC_MAX_SAMPLES);
}

function daysIn(history, zoneId, sinceMs) {
    return new Set(history.filter((s) => s.z === zoneId && s.t >= sinceMs).map((s) => s.d)).size;
}

/**
 * ¿Qué hacer con la ciudad del perfil dada la ciudad detectada ahora?
 * @returns {{action:'none'|'set'|'confirm'|'suggest', zoneId?:string, source?:string, reason:string}}
 *   set     → guardar zoneId como ciudad (source 'gps')
 *   confirm → la ciudad ya es correcta; marcar source 'gps' (deja de ser «default»)
 *   suggest → la persona eligió otra ciudad a mano: solo ofrecer el cambio
 */
export function ucDecide({ profile, detectedZoneId, history = [], now = Date.now(), busy = false }) {
    if (!profile || !['client', 'driver'].includes(profile.role || 'client')) return { action: 'none', reason: 'rol' };
    if (!detectedZoneId) return { action: 'none', reason: 'sin_deteccion' };
    if (busy) return { action: 'none', reason: 'en_viaje' };
    const current = profile.serviceZoneId || profile.cityId || null;
    const src = ucEffectiveSource(profile);
    if (current === detectedZoneId) {
        return (src === 'default' || src === 'legacy_default') ? { action: 'confirm', zoneId: current, source: 'gps', reason: 'ya_correcta' } : { action: 'none', reason: 'igual' };
    }
    if (!current || src === 'default') return { action: 'set', zoneId: detectedZoneId, source: 'gps', reason: 'primer_gps' };
    if (src === 'legacy_default') {
        const seen = history.filter((s) => s.z === detectedZoneId);
        const ok = seen.length >= 2 && (seen[seen.length - 1].t - seen[0].t) >= UC_LEGACY_CONFIRM_MS;
        return ok ? { action: 'set', zoneId: detectedZoneId, source: 'gps', reason: 'perfil_viejo_comayagua' } : { action: 'none', reason: 'esperando_2a_lectura' };
    }
    const since = now - UC_WINDOW_DAYS * DAY;
    const away = daysIn(history, detectedZoneId, since);
    const home = daysIn(history, current, now - UC_HOME_QUIET_DAYS * DAY);
    const consistent = away >= UC_CONSISTENT_DAYS && home === 0;
    if (!consistent) return { action: 'none', reason: `visita (${away}/${UC_CONSISTENT_DAYS} días)` };
    if (src === 'manual' || src === 'legacy') return { action: 'suggest', zoneId: detectedZoneId, reason: 'elegida_a_mano' };
    return { action: 'set', zoneId: detectedZoneId, source: 'gps', reason: 'constante_en_otra_ciudad' };
}

/** Backfill: ciudad propuesta desde la última ubicación conocida. detect(lat,lng) → zoneId|null */
export function ucBackfillProposal(user, lastPos, detect) {
    const src = ucEffectiveSource(user);
    const current = user?.serviceZoneId || user?.cityId || null;
    if (!lastPos || !Number.isFinite(Number(lastPos.lat)) || !Number.isFinite(Number(lastPos.lng))) return { change: false, why: 'sin_ubicacion', current };
    const z = detect(Number(lastPos.lat), Number(lastPos.lng));
    if (!z) return { change: false, why: 'fuera_de_cobertura', current };
    if (z === current) return { change: false, why: 'igual', current, to: z };
    if (src === 'manual' || src === 'legacy') return { change: false, why: 'elegida_a_mano', current, to: z };
    return { change: true, why: src, current, to: z };
}

export const UC_NEAREST_MAX_KM = 40;
/** Ciudad para un punto: cobertura de la ciudad más cercana; si no, la más cercana de Honduras a ≤40 km. Z = módulo zones.js */
export function ucDetect(Z, lat, lng) {
    const a = Number(lat), b = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const z = Z.findZoneForCoords(a, b);
    if (z) return z.id;
    const n = Z.findNearestZone(a, b, { country: 'hn' });
    return n && n.distanceKm <= UC_NEAREST_MAX_KM ? n.zone.id : null;
}
