/**
 * Marketplace HonduRaite (aparte de Tiendas): callables de estado y comisiones.
 * Las publicaciones las crea el usuario (entran «pending», ver firestore.rules); aprobar, rechazar,
 * quitar, marcar vendido/rentado y cobrar comisiones SOLO pasa por aquí.
 */
const core = require('./marketplace-core');

module.exports = function marketplaceModule({ db, FieldValue, HttpsError, onCall, APP_ID, assertCallerCanModerate }) {
    const base = (appId = APP_ID) => `artifacts/${appId}/public/data`;
    const listingRef = (id) => db.doc(`${base()}/marketplace_listings/${id}`);
    const cleanId = (v) => {
        const s = String(v || '').trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new HttpsError('invalid-argument', 'Publicación inválida.');
        return s;
    };
    const reasonOf = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

    async function isStaff(auth) {
        try { await assertCallerCanModerate(auth); return true; } catch (_) { return false; }
    }

    /** Staff: aprobar / rechazar / quitar. */
    const marketplaceModerate = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const d = request.data || {};
        const id = cleanId(d.listingId);
        const action = String(d.action || '');
        const next = { approve: 'approved', reject: 'rejected', remove: 'removed' }[action];
        if (!next) throw new HttpsError('invalid-argument', 'Acción inválida (approve, reject o remove).');
        const reason = reasonOf(d.reason);
        const now = Date.now();
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(listingRef(id));
            if (!snap.exists) throw new HttpsError('not-found', 'La publicación ya no existe.');
            const cur = snap.data() || {};
            if (cur.status === 'sold' && next !== 'removed') throw new HttpsError('failed-precondition', 'Ya está vendida.');
            const patch = { status: next, reviewedBy: caller.uid, reviewedAtMs: now, updatedAtMs: now };
            if (next === 'approved') { patch.approvedAtMs = now; patch.rejectReason = FieldValue.delete(); }
            if (next === 'rejected') patch.rejectReason = reason || 'No cumple las normas del Marketplace.';
            if (next === 'removed') patch.removedReason = reason || null;
            tx.update(listingRef(id), patch);
        });
        return { ok: true, listingId: id, status: next };
    });

    /**
     * Dueño o staff: marcar vendido (venta) o registrar una renta. El servidor calcula el 10% al vendedor
     * y crea marketplace_commissions (pending). Venta: la publicación queda «sold». Renta: sigue publicada.
     */
    const marketplaceMarkClosed = onCall(async (request) => {
        if (!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
        const uid = request.auth.uid;
        const d = request.data || {};
        const id = cleanId(d.listingId);
        const staff = await isStaff(request.auth);
        const now = Date.now();
        const out = await db.runTransaction(async (tx) => {
            const snap = await tx.get(listingRef(id));
            if (!snap.exists) throw new HttpsError('not-found', 'La publicación ya no existe.');
            const L = snap.data() || {};
            if (L.ownerUid !== uid && !staff) throw new HttpsError('permission-denied', 'Solo el vendedor o el staff pueden marcarla.');
            if (L.status !== 'approved') throw new HttpsError('failed-precondition', L.status === 'sold' ? 'Ya está vendida.' : 'Solo se marcan publicaciones aprobadas.');
            let c;
            try { c = core.resolveClose(L, d); } catch (e) { throw new HttpsError('invalid-argument', e.message); }
            const comRef = db.collection(`${base()}/marketplace_commissions`).doc();
            tx.set(comRef, {
                listingId: id, title: String(L.title || '').slice(0, 80), category: L.category || '',
                city: L.city || '', sellerUid: L.ownerUid || null, sellerName: L.ownerName || '',
                kind: c.kind, period: c.period, units: c.units, listedPrice: c.listedPrice,
                amount: c.amount, rate: c.rate, commission: c.commission, sellerNet: c.sellerNet,
                currency: 'HNL', paidBy: 'seller', status: 'pending',
                markedBy: uid, markedByRole: staff && L.ownerUid !== uid ? 'staff' : 'seller',
                createdAtMs: now, createdAt: FieldValue.serverTimestamp(),
            });
            const patch = { updatedAtMs: now, lastCommissionId: comRef.id };
            if (c.kind === 'sale') Object.assign(patch, { status: 'sold', soldAtMs: now, closedAmount: c.amount });
            else Object.assign(patch, { rentalsCount: FieldValue.increment(1), lastRentedAtMs: now });
            tx.update(listingRef(id), patch);
            return { commissionId: comRef.id, ...c };
        });
        return { ok: true, listingId: id, ...out };
    });

    /** Staff: marcar comisión pagada (o volver a pendiente). */
    const marketplaceSetCommissionStatus = onCall(async (request) => {
        const caller = await assertCallerCanModerate(request.auth);
        const d = request.data || {};
        const id = cleanId(d.commissionId);
        const status = d.status === 'pending' ? 'pending' : 'paid';
        const ref = db.doc(`${base()}/marketplace_commissions/${id}`);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError('not-found', 'Comisión no encontrada.');
        const now = Date.now();
        await ref.update(status === 'paid'
            ? { status, paidAtMs: now, paidMarkedBy: caller.uid, paidNote: reasonOf(d.note) || null }
            : { status, paidAtMs: FieldValue.delete(), paidMarkedBy: FieldValue.delete(), paidNote: FieldValue.delete() });
        return { ok: true, commissionId: id, status };
    });

    return { exports: { marketplaceModerate, marketplaceMarkClosed, marketplaceSetCommissionStatus } };
};
