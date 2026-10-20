/**
 * Stock de tiendas que no son comida/restaurante.
 * Al crear el pedido el servidor descuenta. Si no alcanza, cancela el pedido.
 * Si el pedido se cancela después, devuelve las unidades.
 */
'use strict';

const FOOD_CATEGORIES = new Set(['comida', 'restaurante']);

function storeTracksStock(store) {
    const c = String(store?.category || '').toLowerCase().trim();
    if (!c) return true;
    if (FOOD_CATEGORIES.has(c)) return false;
    if (c.includes('restaurante') || c.includes('comida')) return false;
    return true;
}

function qtyOf(item) {
    const n = Math.floor(Number(item?.qty));
    return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Array} items
 * @param {Record<string, { stock?: number }>} stockById
 * @returns {{ ok: true, lines: { productId: string, qty: number, next: number }[] } | { ok: false, error: string }}
 */
function planStockDebit(items, stockById) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return { ok: false, error: 'El pedido no trae productos.' };
    if (list.length > 40) return { ok: false, error: 'Demasiados productos en un pedido.' };
    const need = new Map();
    for (const it of list) {
        const id = String(it?.productId || '').trim();
        const qty = qtyOf(it);
        if (!id || qty <= 0) return { ok: false, error: 'Hay un producto sin cantidad.' };
        need.set(id, (need.get(id) || 0) + qty);
    }
    const lines = [];
    for (const [productId, qty] of need) {
        const row = stockById?.[productId];
        if (!row) return { ok: false, error: 'Un producto del pedido ya no está en la tienda.' };
        const stock = Math.floor(Number(row.stock));
        if (!Number.isFinite(stock) || stock < qty) {
            return { ok: false, error: 'No hay suficiente stock para este pedido.' };
        }
        lines.push({ productId, qty, next: stock - qty });
    }
    return { ok: true, lines };
}

/** Suma de vuelta lo que se descontó. Ignora líneas inválidas. */
function planStockRestore(lines, stockById) {
    const out = [];
    for (const line of Array.isArray(lines) ? lines : []) {
        const productId = String(line?.productId || '').trim();
        const qty = Math.floor(Number(line?.qty));
        if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
        const row = stockById?.[productId];
        if (!row) continue;
        const stock = Math.floor(Number(row.stock));
        const base = Number.isFinite(stock) ? stock : 0;
        out.push({ productId, qty, next: base + qty });
    }
    return out;
}

module.exports = function createStoreStock(deps) {
    const { db, FieldValue, onDocumentCreated, onDocumentUpdated } = deps;

    const onStoreOrderStock = onDocumentCreated(
        'artifacts/{appId}/public/data/store_orders/{orderId}',
        async (event) => {
            const created = event.data?.data() || {};
            if (created.status && created.status !== 'pending') return;
            const { appId, orderId } = event.params;
            if (!orderId || orderId.includes('/')) return;
            const orderRef = db.doc(`artifacts/${appId}/public/data/store_orders/${orderId}`);
            const storeId = String(created.storeId || '');
            if (!storeId) return;
            const storeSnap = await db.doc(`artifacts/${appId}/public/data/stores/${storeId}`).get();
            const store = storeSnap.exists ? storeSnap.data() : null;
            if (!storeTracksStock(store)) {
                await orderRef.set({ stockTracked: false }, { merge: true });
                return;
            }
            await db.runTransaction(async (tx) => {
                const orderSnap = await tx.get(orderRef);
                if (!orderSnap.exists) return;
                const order = orderSnap.data() || {};
                if (order.status === 'cancelled' || order.stockDebited === true) return;
                const items = Array.isArray(order.items) ? order.items : [];
                const ids = [...new Set(items.map((it) => String(it?.productId || '').trim()).filter(Boolean))].slice(0, 40);
                const refs = ids.map((id) => db.doc(`artifacts/${appId}/public/data/store_products/${id}`));
                const snaps = refs.length ? await Promise.all(refs.map((ref) => tx.get(ref))) : [];
                const stockById = {};
                snaps.forEach((snap, i) => {
                    if (snap.exists) stockById[ids[i]] = snap.data() || {};
                });
                const plan = planStockDebit(items, stockById);
                if (!plan.ok) {
                    tx.update(orderRef, {
                        status: 'cancelled',
                        cancelledBy: 'system',
                        cancelReason: 'out_of_stock',
                        stockTracked: true,
                        stockDebited: false,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                    return;
                }
                for (const line of plan.lines) {
                    const ref = db.doc(`artifacts/${appId}/public/data/store_products/${line.productId}`);
                    tx.update(ref, { stock: line.next, updatedAt: FieldValue.serverTimestamp() });
                }
                tx.update(orderRef, {
                    stockTracked: true,
                    stockDebited: true,
                    stockRestored: false,
                    stockLines: plan.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            });
        }
    );

    const onStoreOrderStockRestore = onDocumentUpdated(
        'artifacts/{appId}/public/data/store_orders/{orderId}',
        async (event) => {
            const before = event.data.before.data() || {};
            const after = event.data.after.data() || {};
            if (after.status !== 'cancelled' || before.status === 'cancelled') return;
            if (after.stockDebited !== true || after.stockRestored === true) return;
            const { appId, orderId } = event.params;
            const orderRef = db.doc(`artifacts/${appId}/public/data/store_orders/${orderId}`);
            await db.runTransaction(async (tx) => {
                const orderSnap = await tx.get(orderRef);
                if (!orderSnap.exists) return;
                const order = orderSnap.data() || {};
                if (order.stockDebited !== true || order.stockRestored === true) return;
                const lines = Array.isArray(order.stockLines) ? order.stockLines : [];
                const ids = [...new Set(lines.map((l) => String(l?.productId || '').trim()).filter(Boolean))];
                const snaps = await Promise.all(ids.map((id) => tx.get(db.doc(`artifacts/${appId}/public/data/store_products/${id}`))));
                const stockById = {};
                snaps.forEach((snap, i) => {
                    if (snap.exists) stockById[ids[i]] = snap.data() || {};
                });
                for (const line of planStockRestore(lines, stockById)) {
                    tx.update(db.doc(`artifacts/${appId}/public/data/store_products/${line.productId}`), {
                        stock: line.next,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
                tx.update(orderRef, {
                    stockRestored: true,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            });
        }
    );

    return { exports: { onStoreOrderStock, onStoreOrderStockRestore } };
};

module.exports.storeTracksStock = storeTracksStock;
module.exports.planStockDebit = planStockDebit;
module.exports.planStockRestore = planStockRestore;
