/**
 * Si un conductor ya aprobado manda año / aire / asientos, no se le baja la aprobación.
 * La renovación de documentos (sin estos campos) sigue pudiendo volver a pendiente.
 */
const COMFORT_TOUCH = ['vehicleYear', 'hasAC', 'seats', 'suggestedCategory', 'vehicleCategoryConfirmed'];

function protectApprovedComfortPatch(patch, prev) {
    const next = patch && typeof patch === 'object' ? { ...patch } : {};
    const before = prev && typeof prev === 'object' ? prev : {};
    if (before.approvalStatus !== 'approved') return next;
    const touchesComfort = COMFORT_TOUCH.some((key) => Object.prototype.hasOwnProperty.call(next, key));
    if (!touchesComfort) return next;

    delete next.approvalStatus;
    delete next.approvedAt;
    delete next.approvedBy;
    delete next.approvedByName;
    delete next.documentsValidUntil;
    delete next.resubmitRequested;
    delete next.rejectionReason;
    delete next.autoSuspended;
    delete next.rejectedAt;

    if (Array.isArray(next.vehicles)) {
        const prevList = Array.isArray(before.vehicles) ? before.vehicles : [];
        const prevById = new Map(prevList.filter((v) => v && v.id).map((v) => [v.id, v]));
        next.vehicles = next.vehicles.map((v) => {
            if (!v || typeof v !== 'object') return v;
            const old = prevById.get(v.id);
            if (!old) return v;
            return { ...v, approvalStatus: old.approvalStatus };
        });
    }
    return next;
}

module.exports = { protectApprovedComfortPatch, COMFORT_TOUCH };
