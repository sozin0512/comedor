/**
 * Roles de confianza (menú por rol, oct 2026).
 *
 * Antes el rol de staff salía del perfil público/privado del usuario, que el mismo
 * usuario puede editar (escalada de privilegios). Ahora el rol de staff vive en:
 *   - custom claims de Firebase Auth: { role: 'admin'|'supervisor'|'driver', staff: bool }
 *   - artifacts/{app}/roles/{uid}: { role, grantedBy, grantedAtMs, source }  (las reglas: write false)
 * Solo el servidor los escribe (setUserRole del admin supremo, migración, refreshMyRoleClaims).
 *
 * Respaldo anti-bloqueo (no editable por el usuario): correo de Firebase Auth del admin
 * supremo y KNOWN_STAFF_EMAILS.
 */
'use strict';

const STAFF_ROLES = new Set(['admin', 'supervisor']);
const CLAIM_ROLES = new Set(['admin', 'supervisor', 'driver']);

module.exports = function createRoles(deps) {
    const { db, getAuth, FieldValue, HttpsError, onCall, APP_ID, ADMIN_EMAIL, KNOWN_STAFF_EMAILS } = deps;
    const rolesRef = (appId, uid) => db.doc(`artifacts/${appId}/roles/${uid}`);

    async function authEmailOf(auth) {
        let email = String(auth?.token?.email || '').trim().toLowerCase();
        if (email || !auth?.uid) return email;
        try {
            const rec = await getAuth().getUser(auth.uid);
            email = String(rec.email || '').trim().toLowerCase();
        } catch (_) {}
        return email;
    }

    /**
     * Rol de staff de confianza del que llama.
     * Orden: correo admin supremo → doc roles (manda si existe: degradar es inmediato)
     *        → claim del token → claim fresco de Auth (token viejo) → correo staff conocido.
     * @returns {Promise<{role: string|null, source: string}>}
     */
    async function resolveTrustedRole(auth, appId = APP_ID) {
        if (!auth?.uid) return { role: null, source: 'none' };
        const email = await authEmailOf(auth);
        if (email && email === ADMIN_EMAIL) return { role: 'admin', source: 'admin-email' };
        try {
            const snap = await rolesRef(appId, auth.uid).get();
            if (snap.exists) {
                const r = String(snap.data()?.role || '');
                return { role: STAFF_ROLES.has(r) ? r : (r || null), source: 'roles-doc' };
            }
        } catch (_) {}
        const tokenRole = String(auth.token?.role || '');
        if (STAFF_ROLES.has(tokenRole)) return { role: tokenRole, source: 'token-claim' };
        try {
            const rec = await getAuth().getUser(auth.uid);
            const r = String(rec.customClaims?.role || '');
            if (STAFF_ROLES.has(r)) return { role: r, source: 'auth-claim' };
        } catch (_) {}
        if (email && KNOWN_STAFF_EMAILS.has(email)) return { role: 'supervisor', source: 'known-email' };
        return { role: tokenRole || null, source: 'none' };
    }

    async function isTrustedStaff(auth, appId = APP_ID) {
        const r = await resolveTrustedRole(auth, appId);
        return STAFF_ROLES.has(r.role) ? r : null;
    }

    /** Escribe claim + doc roles. role: 'client' quita el claim de staff. */
    async function applyTrustedRole(uid, role, { byUid = null, source = 'setUserRole', appId = APP_ID } = {}) {
        const clean = CLAIM_ROLES.has(role) ? role : 'client';
        let current = {};
        try {
            const rec = await getAuth().getUser(uid);
            current = rec.customClaims || {};
        } catch (e) {
            throw new HttpsError('not-found', 'La cuenta no existe en Firebase Auth.');
        }
        const next = { ...current };
        if (clean === 'client') {
            delete next.role;
            delete next.staff;
        } else {
            next.role = clean;
            next.staff = STAFF_ROLES.has(clean);
        }
        await getAuth().setCustomUserClaims(uid, next);
        await rolesRef(appId, uid).set({
            role: clean,
            grantedBy: byUid,
            grantedAtMs: Date.now(),
            source
        });
        return { uid, role: clean, claims: next };
    }

    /** Lista de uids de staff de confianza (para avisos a staff). Sin migración aún → null. */
    async function listTrustedStaffUids(appId = APP_ID) {
        const out = new Set();
        let any = false;
        try {
            const snap = await db.collection(`artifacts/${appId}/roles`).where('role', 'in', ['admin', 'supervisor']).get();
            snap.forEach((d) => { any = true; out.add(d.id); });
        } catch (_) {}
        try {
            const rec = await getAuth().getUserByEmail(ADMIN_EMAIL);
            if (rec?.uid) out.add(rec.uid);
        } catch (_) {}
        return any ? [...out] : null;
    }

    /**
     * Cualquier usuario: recalcula su claim desde fuentes de confianza (nunca desde el perfil
     * para staff). Para conductores sí se usa el perfil (ser conductor no da permisos de staff).
     */
    const refreshMyRoleClaims = onCall(async (request) => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión.');
        const trusted = await resolveTrustedRole(request.auth);
        let want = STAFF_ROLES.has(trusted.role) ? trusted.role : null;
        if (!want) {
            try {
                const pub = await db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`).get();
                if (pub.exists && pub.data()?.role === 'driver') want = 'driver';
            } catch (_) {}
        }
        const rec = await getAuth().getUser(uid);
        const claims = rec.customClaims || {};
        const have = claims.role || null;
        let changed = false;
        if ((want || null) !== have) {
            const next = { ...claims };
            if (want) { next.role = want; next.staff = STAFF_ROLES.has(want); } else { delete next.role; delete next.staff; }
            await getAuth().setCustomUserClaims(uid, next);
            changed = true;
        }
        // El correo admin / correo staff conocido también deja su doc de roles (respaldo de reglas).
        if ((trusted.source === 'admin-email' || trusted.source === 'known-email') && want) {
            const snap = await rolesRef(APP_ID, uid).get();
            if (!snap.exists) {
                await rolesRef(APP_ID, uid).set({ role: want, grantedBy: 'auto', grantedAtMs: Date.now(), source: trusted.source });
            }
        }
        return { ok: true, role: want || 'client', staff: STAFF_ROLES.has(want), changed, source: trusted.source };
    });

    return {
        helpers: { resolveTrustedRole, isTrustedStaff, applyTrustedRole, listTrustedStaffUids, authEmailOf },
        exports: { refreshMyRoleClaims }
    };
};
module.exports.STAFF_ROLES = STAFF_ROLES;
/** Correos de Firebase Auth con staff de respaldo (anti-bloqueo). */
module.exports.DEFAULT_KNOWN_STAFF_EMAILS = new Set(['josuesoza0513@gmail.com', 'sozajob146@gmail.com']);
