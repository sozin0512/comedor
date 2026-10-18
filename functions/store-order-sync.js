/**
 * Pedidos de tienda ↔ viaje de entrega.
 *
 * Antes: al tocar «Listo · pedir moto» el pedido pasaba a «En camino» (y el cliente recibía
 * «Pedido en camino») aunque ningún conductor lo hubiera aceptado, y la tienda tenía que tocar
 * «Marcar entregado» a mano.
 * Ahora el servidor sigue al viaje:
 *   - conductor acepta          → pedido «out_for_delivery» (En camino) con el conductor
 *   - conductor cancela/reofrece → pedido vuelve a «ready» · buscando conductor (sin aviso)
 *   - viaje completado          → pedido «delivered» (Entregado) automáticamente
 *   - viaje cancelado del todo  → pedido «ready» sin viaje, la tienda puede pedir otro conductor
 */
'use strict';

const ACTIVE_ORDER = new Set(['accepted', 'preparing', 'ready', 'out_for_delivery']);

function isStoreTrip(t) {
    return !!(t && (t.storeOrderId || t.deliveryDetails?.storeOrderId));
}

function orderIdOfTrip(t) {
    return String(t?.storeOrderId || t?.deliveryDetails?.storeOrderId || '');
}

/**
 * Qué cambiar en el pedido cuando cambia el viaje. null = nada.
 * @param {object} before - viaje antes
 * @param {object} after - viaje después
 * @param {object} order - pedido actual
 * @param {string} tripId
 * @param {number} nowMs
 */
function storeOrderPatchForTripChange(before, after, order, tripId, nowMs = Date.now()) {
    if (!after || !order || !isStoreTrip(after)) return null;
    // Solo el viaje vigente del pedido manda (si la tienda pidió otro, el viejo ya no cuenta)
    if (order.tripId && String(order.tripId) !== String(tripId)) return null;
    const st = String(order.status || '');
    if (st === 'delivered' || st === 'cancelled') return null;
    const b = String(before?.status || '');
    const a = String(after.status || '');
    if (a === b && (before?.driverId || null) === (after.driverId || null)) return null;

    if (a === 'completed') {
        return {
            status: 'delivered',
            deliveredAtMs: nowMs,
            deliveredBy: 'trip_completed',
            deliveryStage: 'delivered',
            driverId: after.driverId || order.driverId || null,
            driverName: after.driverName || order.driverName || null,
        };
    }
    if ((a === 'accepted' || a === 'in_progress') && after.driverId) {
        if (st === 'out_for_delivery' && order.driverId === after.driverId && order.deliveryStage === (a === 'in_progress' ? 'picked_up' : 'driver_assigned')) return null;
        if (!ACTIVE_ORDER.has(st)) return null;
        return {
            status: 'out_for_delivery',
            deliveryStage: a === 'in_progress' ? 'picked_up' : 'driver_assigned',
            driverId: after.driverId,
            driverName: after.driverName || null,
            driverVehicleType: after.driverVehicleType || after.vehicleType || null,
            driverAssignedAtMs: order.driverAssignedAtMs || nowMs,
        };
    }
    if (a === 'pending' && (b === 'accepted' || b === 'in_progress')) {
        // El conductor canceló y el viaje se reofrece: vuelve a «buscando conductor» sin aviso al cliente.
        return { status: 'ready', deliveryStage: 'driver_requeued', driverId: null, driverName: null, driverVehicleType: null };
    }
    if (a === 'cancelled' || a === 'canceled' || a === 'expired') {
        if (!ACTIVE_ORDER.has(st)) return null;
        return { status: 'ready', deliveryStage: 'trip_cancelled', tripId: null, driverId: null, driverName: null, driverVehicleType: null, lastTripId: tripId };
    }
    return null;
}

module.exports = function createStoreOrderSync({ db, FieldValue, onDocumentUpdated }) {
    const onStoreTripStatusSync = onDocumentUpdated(
        { document: 'artifacts/{appId}/public/data/trips/{tripId}', region: 'us-central1' },
        async (event) => {
            const before = event.data.before.data() || {};
            const after = event.data.after.data() || {};
            if (!isStoreTrip(after)) return;
            if (before.status === after.status && (before.driverId || null) === (after.driverId || null)) return;
            const { appId, tripId } = event.params;
            const orderId = orderIdOfTrip(after);
            if (!orderId || orderId.includes('/')) return;
            const ref = db.doc(`artifacts/${appId}/public/data/store_orders/${orderId}`);
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists) return;
                const patch = storeOrderPatchForTripChange(before, after, snap.data() || {}, tripId);
                if (!patch) return;
                const extra = { updatedAt: FieldValue.serverTimestamp() };
                if (patch.status === 'delivered') extra.deliveredAt = FieldValue.serverTimestamp();
                tx.update(ref, { ...patch, ...extra });
            });
        }
    );
    return { exports: { onStoreTripStatusSync } };
};
Object.assign(module.exports, { storeOrderPatchForTripChange, isStoreTrip, orderIdOfTrip });
