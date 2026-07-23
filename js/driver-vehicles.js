/** Múltiples vehículos por conductor + vehículo activo del día */

export function createVehicleId() {
    return `veh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function legacyRecordFromProfile(profile) {
    if (!profile?.vehicle?.plate && !profile?.vehicleType) return null;
    return {
        id: profile.activeVehicleId || createVehicleId(),
        type: profile.vehicleType || profile.vehicle?.type || 'auto',
        label: buildVehicleLabel(profile.vehicleType || 'auto', profile.vehicle),
        vehicle: profile.vehicle || {},
        vehiclePhotos: profile.vehiclePhotos || {},
        cascoPhotos: profile.cascoPhotos || null,
        passengerCascoPhotos: profile.passengerCascoPhotos || null,
        helmetPhoto: profile.helmetPhoto || null,
        documentsPhotos: profile.documentsPhotos || {},
        approvalStatus: profile.approvalStatus || 'pending',
        documentsValidUntil: profile.documentsValidUntil || null,
        createdAt: profile.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

export function buildVehicleLabel(type, vehicle = {}) {
    const plate = (vehicle.plate || '').trim();
    const model = (vehicle.model || '').trim();
    const typeLabels = { moto: 'Moto', taxi: 'Taxi', auto: 'Auto', paila: 'Paila', camion: 'Camión', grua: 'Grúa' };
    const prefix = typeLabels[type] || 'Vehículo';
    if (model && plate) return `${prefix}: ${model} · ${plate}`;
    if (plate) return `${prefix}: ${plate}`;
    if (model) return `${prefix}: ${model}`;
    return prefix;
}

/** Migra perfil antiguo (un solo vehículo) → vehicles[] */
export function normalizeDriverProfileVehicles(profile) {
    if (!profile || profile.role !== 'driver') return profile;
    const next = { ...profile };
    if (!Array.isArray(next.vehicles) || !next.vehicles.length) {
        const legacy = legacyRecordFromProfile(next);
        next.vehicles = legacy ? [legacy] : [];
    }
    if (!next.activeVehicleId && next.vehicles.length) {
        const approved = next.vehicles.find((v) => v.approvalStatus === 'approved');
        next.activeVehicleId = (approved || next.vehicles[0]).id;
    }
    return syncLegacyVehicleFieldsFromActive(next);
}

export function getVehicleById(profile, vehicleId) {
    if (!profile?.vehicles?.length || !vehicleId) return null;
    return profile.vehicles.find((v) => v.id === vehicleId) || null;
}

export function getActiveVehicle(profile) {
    const normalized = normalizeDriverProfileVehicles(profile || {});
    return getVehicleById(normalized, normalized.activeVehicleId)
        || normalized.vehicles?.find((v) => v.approvalStatus === 'approved')
        || normalized.vehicles?.[0]
        || null;
}

export function getApprovedVehicles(profile) {
    const normalized = normalizeDriverProfileVehicles(profile || {});
    return (normalized.vehicles || []).filter((v) => v.approvalStatus === 'approved');
}

export function getPendingVehicles(profile) {
    const normalized = normalizeDriverProfileVehicles(profile || {});
    return (normalized.vehicles || []).filter((v) => v.approvalStatus === 'pending');
}

export function driverHasPendingVehicleVerification(profile) {
    const normalized = normalizeDriverProfileVehicles(profile || {});
    if (normalized.approvalStatus === 'pending') return true;
    return getPendingVehicles(normalized).length > 0;
}

export function getActiveVehicleType(profile) {
    const v = getActiveVehicle(profile);
    return v?.type || profile?.vehicleType || 'auto';
}

/** Copia campos del vehículo activo al perfil (compatibilidad con código existente) */
export function syncLegacyVehicleFieldsFromActive(profile) {
    if (!profile || profile.role !== 'driver') return profile;
    const active = getVehicleById(profile, profile.activeVehicleId)
        || profile.vehicles?.find((v) => v.approvalStatus === 'approved')
        || profile.vehicles?.[0];
    if (!active) return profile;
    profile.activeVehicleId = active.id;
    profile.vehicleType = active.type || 'auto';
    profile.vehicle = active.vehicle || {};
    profile.vehiclePhotos = active.vehiclePhotos || {};
    profile.cascoPhotos = active.cascoPhotos || null;
    profile.passengerCascoPhotos = active.passengerCascoPhotos || null;
    profile.helmetPhoto = active.helmetPhoto || null;
    profile.documentsPhotos = active.documentsPhotos || {};
    if (active.documentsValidUntil) {
        profile.documentsValidUntil = active.documentsValidUntil;
    }
    return profile;
}

export function applyActiveVehicleToProfile(profile, vehicleId) {
    const normalized = normalizeDriverProfileVehicles({ ...profile });
    const target = getVehicleById(normalized, vehicleId);
    if (!target) return null;
    if (target.approvalStatus !== 'approved') return null;
    normalized.activeVehicleId = vehicleId;
    return syncLegacyVehicleFieldsFromActive(normalized);
}

/** Para tarjetas de verificación: muestra vehículo pendiente si el conductor ya está aprobado */
export function enrichDriverForVerificationDisplay(u) {
    const normalized = normalizeDriverProfileVehicles({ ...u });
    const pendingVehicle = getPendingVehicles(normalized)[0];
    if (normalized.approvalStatus === 'approved' && pendingVehicle) {
        return {
            ...normalized,
            vehicleType: pendingVehicle.type,
            vehicle: pendingVehicle.vehicle,
            vehiclePhotos: pendingVehicle.vehiclePhotos,
            cascoPhotos: pendingVehicle.cascoPhotos,
            passengerCascoPhotos: pendingVehicle.passengerCascoPhotos,
            helmetPhoto: pendingVehicle.helmetPhoto,
            documentsPhotos: pendingVehicle.documentsPhotos,
            _pendingVehicleId: pendingVehicle.id,
            _isAdditionalVehiclePending: true,
        };
    }
    return normalized;
}

export function approvePendingVehicles(vehicles, validUntilIso, onlyVehicleId = null) {
    const list = Array.isArray(vehicles) ? [...vehicles] : [];
    return list.map((v) => {
        if (v.approvalStatus !== 'pending') return v;
        if (onlyVehicleId && v.id !== onlyVehicleId) return v;
        return {
            ...v,
            approvalStatus: 'approved',
            documentsValidUntil: validUntilIso,
            approvedAt: new Date().toISOString(),
        };
    });
}

export function approveAllPendingVehicles(vehicles, validUntilIso) {
    return approvePendingVehicles(vehicles, validUntilIso);
}

export function removeVehicleById(vehicles, vehicleId) {
    if (!vehicleId) return Array.isArray(vehicles) ? [...vehicles] : [];
    return (vehicles || []).filter((v) => v.id !== vehicleId);
}

/** Datos Firestore al aprobar conductor o vehículo adicional pendiente */
export function buildDriverApprovalFields(profile, validUntilIso, onlyVehicleId = null) {
    const normalized = normalizeDriverProfileVehicles({ ...profile });
    const vehicles = approvePendingVehicles(normalized.vehicles, validUntilIso, onlyVehicleId);
    const hasPendingVehicle = vehicles.some((v) => v.approvalStatus === 'pending');
    const isAccountPending = normalized.approvalStatus === 'pending';
    const isFullAccountApproval = !onlyVehicleId;   // when approving the driver (not just adding a vehicle)

    const next = {
        ...normalized,
        vehicles,
        hasPendingVehicle,
    };

    if (isFullAccountApproval || isAccountPending) {
        next.approvalStatus = 'approved';
        next.documentsValidUntil = validUntilIso;
        next.lastDocumentsUpdate = new Date().toISOString();
        next.approvedAt = new Date().toISOString();
        next.resubmitRequested = false;
        next.autoSuspended = false;
    }

    syncLegacyVehicleFieldsFromActive(next);

    return {
        approvalStatus: next.approvalStatus || 'approved',
        vehicles: next.vehicles,
        activeVehicleId: next.activeVehicleId,
        hasPendingVehicle: next.hasPendingVehicle,
        vehicleType: next.vehicleType,
        vehicle: next.vehicle,
        vehiclePhotos: next.vehiclePhotos,
        cascoPhotos: next.cascoPhotos || null,
        passengerCascoPhotos: next.passengerCascoPhotos || null,
        helmetPhoto: next.helmetPhoto || null,
        documentsPhotos: next.documentsPhotos || {},
        documentsValidUntil: next.documentsValidUntil || validUntilIso,
        lastDocumentsUpdate: new Date().toISOString(),
        approvedAt: next.approvedAt || new Date().toISOString(),
        resubmitRequested: false,
        autoSuspended: false,
    };
}