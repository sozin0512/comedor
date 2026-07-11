/**
 * Repara perfil sozajob146@gmail.com — quita admin falso y claims viejos.
 * Uso: node scripts/repair-sozajob.js
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const TARGET_EMAIL = 'sozajob146@gmail.com';
const ADMIN_EMAIL = 'josuesoza0513@gmail.com';
const APP_ID = 'comayagua-vip-pro-v4';

initializeApp({
    credential: applicationDefault(),
    projectId: 'comedor-86278',
});

const db = getFirestore();
const auth = getAuth();

async function main() {
    const rec = await auth.getUserByEmail(TARGET_EMAIL);
    const uid = rec.uid;
    console.log('UID:', uid, 'Auth email:', rec.email);

    if (rec.customClaims && Object.keys(rec.customClaims).length) {
        await auth.setCustomUserClaims(uid, null);
        console.log('Custom claims eliminados:', rec.customClaims);
    }

    const pubRef = db.doc(`artifacts/${APP_ID}/public/data/users/${uid}`);
    const privRef = db.doc(`artifacts/${APP_ID}/users/${uid}/profile/data`);
    const pubSnap = await pubRef.get();
    const privSnap = await privRef.get();
    const pub = pubSnap.data() || {};
    const priv = privSnap.data() || {};

    const isSupervisor = pub.role === 'supervisor' || priv.role === 'supervisor'
        || pub.staffGrantedBy || priv.staffGrantedBy;

    const fix = {
        email: TARGET_EMAIL,
        role: isSupervisor ? 'supervisor' : 'client',
        updatedAt: FieldValue.serverTimestamp(),
    };
    if (fix.role !== 'supervisor') {
        fix.staffGrantedBy = null;
        fix.staffGrantedAt = null;
    } else if (pub.staffGrantedBy || priv.staffGrantedBy) {
        fix.staffGrantedBy = pub.staffGrantedBy || priv.staffGrantedBy;
        fix.staffGrantedAt = pub.staffGrantedAt || priv.staffGrantedAt || FieldValue.serverTimestamp();
    }

    await pubRef.set(fix, { merge: true });
    await privRef.set(fix, { merge: true });

    console.log('Perfiles actualizados:', fix);
    console.log('Antes — public role:', pub.role, 'email:', pub.email);
    console.log('Antes — private role:', priv.role, 'email:', priv.email);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});