/**
 * Limpia datos sensibles del conductor copiados en viajes (driverDocumentsPhotos, driverIdentity).
 * NO se ejecutó. Por defecto es simulación (DRY RUN). Para aplicar: --apply
 * Uso (PC con credenciales admin): cd functions && node ../scripts/cleanup-trip-driver-pii.js [--apply]
 */
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const APP_ID = process.env.HR_APP_ID || 'comayagua-vip-pro-v4';
const APPLY = process.argv.includes('--apply');
(async () => {
    const col = db.collection(`artifacts/${APP_ID}/public/data/trips`);
    let last = null, scanned = 0, hits = 0;
    for (;;) {
        let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(400);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;
        const batch = db.batch();
        let n = 0;
        for (const d of snap.docs) {
            scanned++;
            const t = d.data();
            if (t.driverDocumentsPhotos != null || t.driverIdentity != null) {
                hits++; n++;
                if (APPLY) batch.update(d.ref, {
                    driverDocumentsPhotos: admin.firestore.FieldValue.delete(),
                    driverIdentity: admin.firestore.FieldValue.delete(),
                });
            }
        }
        if (APPLY && n) await batch.commit();
        last = snap.docs[snap.docs.length - 1];
    }
    console.log(`${APPLY ? 'LIMPIADOS' : 'DRY RUN'}: ${hits} de ${scanned} viajes con datos sensibles.`);
})().catch((e) => { console.error(e); process.exit(1); });
