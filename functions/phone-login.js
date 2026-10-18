/**
 * Entrar con teléfono: la app busca el correo en public/data/auth_phone_index/<tel>,
 * pero ANTES de iniciar sesión las reglas no dejan leer nada (catch-all exige sesión),
 * así que «Entrar con teléfono» siempre decía «No hay cuenta con ese teléfono» (QA 2026-10-18).
 * Este callable hace esa búsqueda en el servidor, sin abrir el índice a cualquiera.
 * Límite simple por IP y por teléfono (memoria de la instancia) para frenar barridos.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_IP = 20;
const MAX_PER_PHONE = 8;

function createLimiter() {
    const hits = new Map();
    return function hit(key, max, now = Date.now()) {
        const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
        arr.push(now);
        hits.set(key, arr);
        if (hits.size > 5000) hits.clear();
        return arr.length <= max;
    };
}

function validPhoneKey(v) {
    const s = String(v || '').trim();
    return /^[0-9]{8,15}$/.test(s) ? s : '';
}

/** Formas en que el teléfono pudo quedar guardado en el perfil (viejos sin normalizar). */
function phoneVariants(phoneKey) {
    const out = new Set([phoneKey, `+${phoneKey}`]);
    if (phoneKey.startsWith('504') && phoneKey.length === 11) {
        const local = phoneKey.slice(3);
        out.add(local);
        out.add(`${local.slice(0, 4)}-${local.slice(4)}`);
        out.add(`+504 ${local}`);
        out.add(`+504 ${local.slice(0, 4)}-${local.slice(4)}`);
        out.add(`504${local}`);
    }
    return [...out];
}

module.exports = function createPhoneLogin({ db, getAuth, HttpsError, onCall, APP_ID }) {
    const hit = createLimiter();
    const resolvePhoneLoginEmail = onCall({ region: 'us-central1', cors: true }, async (request) => {
        const phoneKey = validPhoneKey(request.data?.phone);
        if (!phoneKey) throw new HttpsError('invalid-argument', 'Teléfono no válido.');
        const ip = String(request.rawRequest?.ip || request.rawRequest?.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim();
        if (!hit(`ip:${ip}`, MAX_PER_IP) || !hit(`ph:${phoneKey}`, MAX_PER_PHONE)) {
            throw new HttpsError('resource-exhausted', 'Demasiados intentos. Espera unos minutos.');
        }
        const pub = `artifacts/${APP_ID}/public/data`;
        const snap = await db.doc(`${pub}/auth_phone_index/${phoneKey}`).get();
        let email = snap.exists ? String(snap.data()?.email || '').trim().toLowerCase() : '';
        let uid = snap.exists ? String(snap.data()?.uid || '') : '';
        if (!email) {
            // El índice casi nunca se llenó (las reglas no dejaban escribirlo): buscar el perfil por teléfono.
            const q = await db.collection(`${pub}/users`).where('phone', 'in', phoneVariants(phoneKey)).limit(3).get();
            const uids = [...new Set(q.docs.map((d) => d.id))];
            if (uids.length === 1) uid = uids[0];
        }
        if (!email && uid && getAuth) {
            try {
                const user = await getAuth().getUser(uid);
                email = String(user.email || '').trim().toLowerCase();
            } catch (_) { /* usuario borrado */ }
        }
        if (!email && getAuth) {
            try {
                const user = await getAuth().getUserByPhoneNumber(`+${phoneKey}`);
                email = String(user.email || '').trim().toLowerCase();
            } catch (_) { /* no tiene teléfono en Auth */ }
        }
        return { email: email || null };
    });
    return { exports: { resolvePhoneLoginEmail } };
};
module.exports.validPhoneKey = validPhoneKey;
module.exports.createLimiter = createLimiter;
module.exports.phoneVariants = phoneVariants;
