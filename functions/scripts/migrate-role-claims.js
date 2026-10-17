#!/usr/bin/env node
/**
 * Migración de roles a custom claims + artifacts/{app}/roles/{uid}  (menú por rol, oct 2026).
 *
 * POR DEFECTO NO ESCRIBE NADA (dry-run): imprime el plan y guarda un JSON en scripts/out/.
 *
 *   node scripts/migrate-role-claims.js                      # dry-run (producción: comedor-86278)
 *   node scripts/migrate-role-claims.js --apply              # escribe claims + docs roles
 *   node scripts/migrate-role-claims.js --apply --approve=UID1,UID2   # + supervisores "a revisar"
 *   node scripts/migrate-role-claims.js --project=demo-hr    # otro proyecto (o emulador con
 *        FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST)
 *   --no-drivers   no poner claim 'driver' (solo staff)
 *
 * Fuentes:
 *   - admin:      SOLO la cuenta Auth con ADMIN_EMAIL. Cualquier otro perfil con role 'admin' es falso
 *                 → se lista y queda client (o supervisor si está confirmado como supervisor).
 *   - supervisor: perfil con role 'supervisor' o staffGrantedBy. Como el perfil lo puede editar el
 *                 usuario, solo se aplica automáticamente si está CONFIRMADO:
 *                   · correo en KNOWN_STAFF_EMAILS, o
 *                   · staffGrantedBy = uid del admin (appSettings/main.adminUid o cuenta ADMIN_EMAIL), o
 *                   · ya tiene claim role=supervisor.
 *                 El resto sale como "A REVISAR" y solo se aplica con --approve=uid (o --include-review).
 *   - driver:     perfil público con role 'driver' (no da permisos de staff).
 * Si ya existe doc roles/{uid}, no se toca (el admin ya decidió con setUserRole).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { DEFAULT_KNOWN_STAFF_EMAILS } = require('../roles');

const ADMIN_EMAIL = 'josuesoza0513@gmail.com';
const APP_ID = process.env.HR_APP_ID || 'comayagua-vip-pro-v4';

function parseArgs(argv) {
    const a = { apply: false, project: 'comedor-86278', approve: new Set(), includeReview: false, drivers: true };
    for (const x of argv) {
        if (x === '--apply') a.apply = true;
        else if (x === '--include-review') a.includeReview = true;
        else if (x === '--no-drivers') a.drivers = false;
        else if (x.startsWith('--project=')) a.project = x.slice(10);
        else if (x.startsWith('--approve=')) x.slice(10).split(',').map((s) => s.trim()).filter(Boolean).forEach((u) => a.approve.add(u));
        else if (x === '--help' || x === '-h') a.help = true;
        else throw new Error(`Argumento desconocido: ${x}`);
    }
    return a;
}

async function buildPlan({ db, auth, appId = APP_ID, args }) {
    const lower = (v) => String(v || '').trim().toLowerCase();
    let adminUid = null;
    try { adminUid = (await auth.getUserByEmail(ADMIN_EMAIL)).uid; } catch (_) {}
    let settingsAdminUid = null;
    try { settingsAdminUid = (await db.doc(`artifacts/${appId}/public/data/appSettings/main`).get()).data()?.adminUid || null; } catch (_) {}
    const adminUids = new Set([adminUid, settingsAdminUid].filter(Boolean));

    const [pubSnap, rolesSnap] = await Promise.all([
        db.collection(`artifacts/${appId}/public/data/users`).get(),
        db.collection(`artifacts/${appId}/roles`).get()
    ]);
    const existingRoles = new Map();
    rolesSnap.forEach((d) => existingRoles.set(d.id, d.data()));

    const users = new Map();
    pubSnap.forEach((d) => users.set(d.id, { uid: d.id, pub: d.data() || {} }));
    if (adminUid && !users.has(adminUid)) users.set(adminUid, { uid: adminUid, pub: {} });
    for (const email of DEFAULT_KNOWN_STAFF_EMAILS) {
        try { const r = await auth.getUserByEmail(email); if (!users.has(r.uid)) users.set(r.uid, { uid: r.uid, pub: {} }); } catch (_) {}
    }

    const plan = [];
    for (const u of users.values()) {
        const p = u.pub;
        let rec = null;
        try { rec = await auth.getUser(u.uid); } catch (_) {}
        const email = lower(rec?.email);
        const haveClaim = rec?.customClaims?.role || null;
        const profileRole = String(p.role || '');
        const looksSup = profileRole === 'supervisor' || !!p.staffGrantedBy;
        const entry = { uid: u.uid, email: email || null, name: p.name || null, profileRole: profileRole || null, staffGrantedBy: p.staffGrantedBy || null, claimNow: haveClaim, rolesDocNow: existingRoles.get(u.uid)?.role || null };

        if (!rec) { plan.push({ ...entry, action: 'skip', want: null, why: 'no existe en Firebase Auth' }); continue; }
        if (existingRoles.has(u.uid)) {
            const r = existingRoles.get(u.uid).role;
            const staffDoc = r === 'admin' || r === 'supervisor';
            const staffClaim = haveClaim === 'admin' || haveClaim === 'supervisor';
            // Doc no-staff: solo se quita un claim de staff sobrante (no se toca el de conductor).
            const ok = staffDoc ? haveClaim === r : !staffClaim;
            const want = staffDoc ? r : (profileRole === 'driver' ? 'driver' : 'client');
            plan.push({ ...entry, action: ok ? 'ok' : 'claim', want, why: 'ya tiene doc roles (decisión del admin)' });
            continue;
        }
        let want = null; let why = ''; let review = false;
        if (email === ADMIN_EMAIL) { want = 'admin'; why = 'correo admin supremo'; }
        else if (looksSup || haveClaim === 'supervisor' || haveClaim === 'admin' || profileRole === 'admin') {
            const confirmed = DEFAULT_KNOWN_STAFF_EMAILS.has(email)
                || (p.staffGrantedBy && adminUids.has(p.staffGrantedBy))
                || haveClaim === 'supervisor';
            if (confirmed) { want = 'supervisor'; why = DEFAULT_KNOWN_STAFF_EMAILS.has(email) ? 'correo staff conocido' : (haveClaim === 'supervisor' ? 'ya tenía claim supervisor' : 'staffGrantedBy = admin'); }
            else if (args.approve.has(u.uid) || args.includeReview) { want = 'supervisor'; why = 'aprobado a mano (--approve)'; }
            else { review = true; want = profileRole === 'driver' ? 'driver' : 'client'; why = profileRole === 'admin' ? 'role admin en perfil NO es admin real' : 'supervisor solo según el perfil (editable): A REVISAR'; }
            if (profileRole === 'admin' && want !== 'supervisor') why = 'role admin falso en perfil → sin staff';
        } else if (profileRole === 'driver' && args.drivers) { want = 'driver'; why = 'perfil conductor'; }
        else { plan.push({ ...entry, action: 'none', want: 'client', why: 'pasajero' }); continue; }

        const wantClaim = want === 'client' ? null : want;
        const isStaffish = want === 'admin' || want === 'supervisor' || review || haveClaim === 'admin' || haveClaim === 'supervisor';
        plan.push({ ...entry, action: haveClaim === wantClaim && !isStaffish ? 'ok' : 'set', want, why, review, writeRolesDoc: isStaffish });
    }
    return { adminUid, settingsAdminUid, plan };
}

async function applyPlan({ db, auth, appId = APP_ID, plan }) {
    let n = 0;
    for (const e of plan) {
        if (e.action !== 'set' && e.action !== 'claim') continue;
        const rec = await auth.getUser(e.uid);
        const next = { ...(rec.customClaims || {}) };
        if (!e.want || e.want === 'client') { delete next.role; delete next.staff; }
        else { next.role = e.want; next.staff = e.want === 'admin' || e.want === 'supervisor'; }
        await auth.setCustomUserClaims(e.uid, next);
        if (e.action === 'set' && e.writeRolesDoc) {
            await db.doc(`artifacts/${appId}/roles/${e.uid}`).set({ role: e.want || 'client', grantedBy: 'migration', grantedAtMs: Date.now(), source: `migrate-role-claims: ${e.why}` });
        }
        n++;
    }
    return n;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); return; }
    initializeApp({ credential: applicationDefault(), projectId: args.project });
    const db = getFirestore();
    const auth = getAuth();
    console.log(`Proyecto: ${args.project}  app: ${APP_ID}  modo: ${args.apply ? 'APPLY (escribe)' : 'DRY-RUN (no escribe)'}`);
    const { adminUid, settingsAdminUid, plan } = await buildPlan({ db, auth, args });
    console.log(`Admin (Auth ${ADMIN_EMAIL}): ${adminUid || 'NO ENCONTRADO'} · appSettings.adminUid: ${settingsAdminUid || '—'}`);
    const show = (title, rows) => {
        if (!rows.length) return;
        console.log(`\n== ${title} (${rows.length}) ==`);
        rows.forEach((e) => console.log(`  ${e.uid}  ${e.email || '(sin correo)'}  ${e.name || ''}  perfil=${e.profileRole || '—'} claim=${e.claimNow || '—'} → ${e.want}  [${e.why}]`));
    };
    show('ADMIN', plan.filter((e) => e.want === 'admin'));
    show('SUPERVISORES confirmados', plan.filter((e) => e.want === 'supervisor'));
    show('A REVISAR (no se les da staff sin --approve=uid)', plan.filter((e) => e.review));
    show('Conductores (claim driver)', plan.filter((e) => e.want === 'driver' && e.action === 'set' && !e.review));
    show('Ya con doc roles', plan.filter((e) => e.why.startsWith('ya tiene doc roles')));
    show('Sin Auth (omitidos)', plan.filter((e) => e.action === 'skip'));
    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `migrate-role-claims-${args.project}-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ args: { ...args, approve: [...args.approve] }, adminUid, plan }, null, 2));
    console.log(`\nPlan guardado: ${outFile}`);
    if (!adminUid) console.warn('\n⚠️  No se encontró la cuenta admin en Auth. Revisa antes de --apply.');
    if (!args.apply) { console.log('\nDRY-RUN: no se escribió nada. Repite con --apply para aplicar.'); return; }
    const n = await applyPlan({ db, auth, plan });
    console.log(`\nAPLICADO: ${n} cuenta(s). Los usuarios ven el cambio al renovar su token (≤1 h, o al abrir la app: refreshMyRoleClaims).`);
}

module.exports = { buildPlan, applyPlan, parseArgs };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
