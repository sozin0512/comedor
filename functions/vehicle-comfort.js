/**
 * Si un conductor ya aprobado manda año / aire / asientos, no se le baja la aprobación.
 * La renovación de documentos (sin estos campos) sigue pudiendo volver a pendiente.
 */
const COMFORT_TOUCH = ['vehicleYear', 'hasAC', 'seats', 'suggestedCategory', 'vehicleCategoryConfirmed'];

/** No borra números ya guardados si el envío nuevo solo trae las fotos. */
function keepStoredDocumentCodes(patch, prev) {
    const next = patch && typeof patch === 'object' ? { ...patch } : {};
    const before = prev && typeof prev === 'object' ? prev : {};
    const prevVehicle = before.vehicle && typeof before.vehicle === 'object' ? before.vehicle : {};
    const prevDocs = before.documentsPhotos && typeof before.documentsPhotos === 'object' ? before.documentsPhotos : {};
    const text = (value) => String(value ?? '').trim();
    if (next.vehicle && typeof next.vehicle === 'object') {
        const vehicle = { ...next.vehicle };
        if (!text(vehicle.license) && text(prevVehicle.license)) vehicle.license = prevVehicle.license;
        const prevInspection = text(prevVehicle.inspection);
        const nextInspection = text(vehicle.inspection);
        if ((!nextInspection || nextInspection === 'Sin especificar') && prevInspection && prevInspection !== 'Sin especificar') {
            vehicle.inspection = prevVehicle.inspection;
        }
        next.vehicle = vehicle;
    }
    if (!text(next.license) && text(before.license || prevVehicle.license)) {
        next.license = before.license || prevVehicle.license;
    }
    if (next.documentsPhotos && typeof next.documentsPhotos === 'object') {
        const docs = { ...next.documentsPhotos };
        if (!text(docs.penCode) && text(prevDocs.penCode)) docs.penCode = prevDocs.penCode;
        if (!text(docs.policialesCode) && text(prevDocs.policialesCode)) docs.policialesCode = prevDocs.policialesCode;
        next.documentsPhotos = docs;
    }
    return next;
}

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

module.exports = { protectApprovedComfortPatch, keepStoredDocumentCodes, COMFORT_TOUCH };
