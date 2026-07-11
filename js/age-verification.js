/** Utilidades de fecha de nacimiento — HonduRaite (sin restricción de edad) */

function formatLocalDateParts(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Normaliza cualquier formato guardado en Firestore a YYYY-MM-DD */
export function normalizeBirthDate(birthDate) {
    if (birthDate == null || birthDate === '') return null;

    if (typeof birthDate === 'number' && Number.isFinite(birthDate)) {
        const year = Math.trunc(birthDate);
        if (year >= 1900 && year <= 2100) return `${year}-01-01`;
        return null;
    }

    if (birthDate instanceof Date && !Number.isNaN(birthDate.getTime())) {
        return formatLocalDateParts(birthDate);
    }

    if (typeof birthDate === 'object') {
        if (typeof birthDate.toDate === 'function') {
            const d = birthDate.toDate();
            if (!Number.isNaN(d.getTime())) return formatLocalDateParts(d);
        }
        if (typeof birthDate.seconds === 'number') {
            const d = new Date(birthDate.seconds * 1000);
            if (!Number.isNaN(d.getTime())) return formatLocalDateParts(d);
        }
    }

    const raw = String(birthDate).trim();
    if (!raw) return null;

    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
        const day = dmy[1].padStart(2, '0');
        const month = dmy[2].padStart(2, '0');
        return `${dmy[3]}-${month}-${day}`;
    }

    if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return formatLocalDateParts(parsed);

    return null;
}

export function calculateAge(birthDateInput) {
    const birthDateStr = normalizeBirthDate(birthDateInput);
    if (!birthDateStr) return null;

    const birth = new Date(`${birthDateStr}T12:00:00`);
    if (Number.isNaN(birth.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}

/** Valida formato de fecha; la edad no bloquea el registro */
export function validateRegistrationAge(birthDateInput) {
    if (birthDateInput == null || birthDateInput === '') {
        return { ok: true, birthDate: null };
    }
    const birthDateStr = normalizeBirthDate(birthDateInput);
    if (!birthDateStr) {
        return { ok: false, message: 'Fecha de nacimiento inválida. Usa el selector de fecha (día, mes y año).' };
    }
    return { ok: true, age: calculateAge(birthDateStr), birthDate: birthDateStr };
}

export function isClientTripEligible(profile) {
    if (!profile) return { ok: false, message: 'No se pudo cargar tu perfil.' };

    // Permisos basados en las opciones activadas en la pantalla:
    // - Tiene modo pasajero activado si NO es conductor puro (tiene vehículos aprobados + rol driver)
    const role = profile.role || 'client';
    const isPureDriver = role === 'driver' &&
      (profile.approvalStatus === 'approved' ||
       (profile.vehicles && profile.vehicles.length > 0) ||
       profile.activeVehicleId);

    const isRestricted = profile.accountRestricted ||
      profile.approvalStatus === 'suspended' ||
      profile.approvalStatus === 'rejected';

    if (isPureDriver || isRestricted) {
        return { ok: false, message: 'Solo usuarios con modo pasajero activado pueden solicitar viajes.' };
    }
    if (profile.accountRestricted) {
        return { ok: false, message: 'Tu cuenta está restringida. Contacta a soporte.' };
    }
    // Perfiles sin estado de aprobación estricto (p. ej. admin por correo autorizado).
    if (!profile.approvalStatus) {
        return { ok: true };
    }
    const status = profile.approvalStatus;
    if (status === 'pending') {
        // Igual que Uber: el pasajero nuevo puede pedir viaje sin verificación obligatoria.
        const warning = profile.identityVerificationSubmitted
            ? 'Documentos en revisión: ya puedes viajar; el conductor verá que estás en proceso de verificación.'
            : 'Cuenta sin verificar aún: ya puedes viajar. Verificar es opcional y genera más confianza.';
        return { ok: true, warning };
    }
    if (status === 'rejected') {
        return { ok: false, message: 'Tu registro fue rechazado. Contacta a soporte si crees que es un error.' };
    }
    if (status === 'suspended') {
        return { ok: false, message: 'Tu cuenta fue bloqueada. Contacta a soporte.' };
    }
    return { ok: true };
}

export function isDriverOperationEligible(profile) {
    if (!profile || profile.role !== 'driver') return { ok: false, message: 'No eres conductor.' };
    const status = profile.approvalStatus || 'approved';
    if (status === 'suspended') {
        return { ok: false, message: 'Tu cuenta de conductor está suspendida.' };
    }
    if (status === 'pending' || status === 'rejected') {
        return { ok: false, message: 'Tu cuenta de conductor aún no está aprobada.' };
    }
    return { ok: true };
}