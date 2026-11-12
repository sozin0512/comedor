/**
 * Categorías de viaje del conductor (fase de datos).
 * Se guardan año, aire, asientos y la categoría sugerida.
 * No cambian precios, emparejamiento ni ofertas de viaje.
 */

export const BRAND_CHIPS = ['Toyota', 'Honda', 'Hyundai', 'Kia', 'Nissan', 'Otra'];
export const KNOWN_BRANDS = ['Toyota', 'Honda', 'Hyundai', 'Kia', 'Nissan'];
export const YEAR_CHIPS = [2005, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024];
/** Años que se muestran uno por uno. Los más viejos van en «Otro». */
export const YEAR_GRID_START = 1995;
export const SEAT_CHIPS = [4, 5, 7];
export const VEHICLE_TYPES = ['auto', 'taxi', 'moto', 'paila', 'camion', 'grua'];

export const MIN_VEHICLE_YEAR = 1980;

export const DEFAULT_RIDE_CUTOFFS = {
    economicoMaxYear: 2015,
    confortMinYear: 2016,
    vipMinYear: 2021,
    familiarMinSeats: 6,
    familiarMaxSeats: 7
};

export const RIDE_CATEGORY_LABELS = {
    moto: 'Moto',
    economico: 'Raite Económico',
    confort: 'Raite Confort',
    familiar: 'Raite Familiar',
    vip: 'Raite VIP'
};

/** Claves que un conductor aprobado puede confirmar sin tocar su aprobación. */
export const COMFORT_PATCH_KEYS = [
    'vehicleYear',
    'hasAC',
    'seats',
    'suggestedCategory',
    'vehicleCategoryConfirmed',
    'vehicleCategoryUpdatedAt',
    'vehicle',
    'vehicleType',
    'vehicles',
    'activeVehicleId',
    'updatedAt'
];

const TYPE_META = {
    auto: { label: 'Carro', short: 'carro', icon: 'fa-car', noun: 'del carro' },
    taxi: { label: 'Taxi', short: 'taxi', icon: 'fa-taxi', noun: 'del taxi' },
    moto: { label: 'Moto', short: 'moto', icon: 'fa-motorcycle', noun: 'de la moto' },
    paila: { label: 'Paila', short: 'paila', icon: 'fa-truck-pickup', noun: 'de la paila' },
    camion: { label: 'Camión', short: 'camión', icon: 'fa-truck', noun: 'del camión' },
    grua: { label: 'Grúa', short: 'grúa', icon: 'icon-grua', noun: 'de la grúa' }
};

export function vehicleTypeMeta(type) {
    return TYPE_META[type] || TYPE_META.auto;
}

export function currentYear(now = new Date()) {
    const y = now instanceof Date ? now.getFullYear() : Number(now);
    return Number.isFinite(y) && y > 1900 ? y : new Date().getFullYear();
}

export function maxVehicleYear(now = new Date()) {
    return currentYear(now) + 1;
}

export function isPlausibleVehicleYear(year, now = new Date()) {
    const y = Number(year);
    return Number.isInteger(y) && y >= MIN_VEHICLE_YEAR && y <= maxVehicleYear(now);
}

/** Cada año desde 1995 hasta el año actual + 1. */
export function yearChoices(now = new Date()) {
    const end = maxVehicleYear(now);
    const years = [];
    for (let y = YEAR_GRID_START; y <= end; y += 1) years.push(y);
    return years;
}

/** Si el año está en la grilla, queda seleccionado ahí. Si es más viejo, va en «Otro». */
export function placeYear(year, now = new Date()) {
    const y = Number(year);
    if (!isPlausibleVehicleYear(y, now)) return { grid: null, other: '' };
    if (y >= YEAR_GRID_START && y <= maxVehicleYear(now)) return { grid: y, other: '' };
    return { grid: null, other: String(y) };
}

/**
 * Saca un año de 4 dígitos (1980 … año actual + 1) escrito dentro de marca/modelo.
 * Si hay varios, usa el último (suele ir al final: «Toyota scion 2006»).
 * No guarda nada: solo sugiere para que el conductor lo confirme.
 */
export function parseYearFromVehicleText(text, now = new Date()) {
    const raw = String(text || '');
    if (!raw.trim()) return null;
    const re = /(?:^|[^\d])((?:19|20)\d{2})(?=[^\d]|$)/g;
    let match;
    let found = null;
    while ((match = re.exec(raw))) {
        const y = Number(match[1]);
        if (isPlausibleVehicleYear(y, now)) found = y;
    }
    return found;
}

export function normalizeCutoffs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const num = (key, fallback, min, max) => {
        const n = Number(src[key]);
        if (!Number.isInteger(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    };
    const economicoMaxYear = num('economicoMaxYear', DEFAULT_RIDE_CUTOFFS.economicoMaxYear, 1980, 2100);
    let confortMinYear = num('confortMinYear', DEFAULT_RIDE_CUTOFFS.confortMinYear, 1980, 2100);
    let vipMinYear = num('vipMinYear', DEFAULT_RIDE_CUTOFFS.vipMinYear, 1980, 2100);
    if (confortMinYear < economicoMaxYear) confortMinYear = economicoMaxYear + 1;
    if (vipMinYear < confortMinYear) vipMinYear = confortMinYear;
    let familiarMinSeats = num('familiarMinSeats', DEFAULT_RIDE_CUTOFFS.familiarMinSeats, 2, 15);
    let familiarMaxSeats = num('familiarMaxSeats', DEFAULT_RIDE_CUTOFFS.familiarMaxSeats, 2, 15);
    if (familiarMaxSeats < familiarMinSeats) familiarMaxSeats = familiarMinSeats;
    return { economicoMaxYear, confortMinYear, vipMinYear, familiarMinSeats, familiarMaxSeats };
}

/**
 * Categoría sugerida. No se asigna a viajes.
 * Moto siempre es Moto. Paila, camión y grúa no entran en estas categorías de raite.
 * En carro/taxi: 6–7 asientos → Familiar; si no, 2021+ → VIP; 2016+ con aire → Confort; el resto → Económico.
 */
export function suggestRideCategory({ type, year, hasAC, seats, cutoffs } = {}) {
    const t = String(type || '').toLowerCase();
    if (t === 'moto') return 'moto';
    if (t === 'paila' || t === 'camion' || t === 'grua') return null;
    if (t !== 'auto' && t !== 'taxi') return null;
    const c = normalizeCutoffs(cutoffs);
    const seatN = Number(seats);
    if (seats != null && seats !== '' && Number.isInteger(seatN) && seatN >= c.familiarMinSeats && seatN <= c.familiarMaxSeats) {
        return 'familiar';
    }
    if (year == null || year === '') return null;
    const y = Number(year);
    if (!Number.isInteger(y) || y < MIN_VEHICLE_YEAR) return null;
    if (y >= c.vipMinYear) return 'vip';
    if (y >= c.confortMinYear && hasAC === true) return 'confort';
    return 'economico';
}

export function rideCategoryLabel(id) {
    return RIDE_CATEGORY_LABELS[id] || '';
}

export function splitBrandAndModel(text) {
    const raw = String(text || '').trim().replace(/\s+/g, ' ');
    if (!raw) return { brand: '', brandOther: '', model: '' };
    for (const brand of KNOWN_BRANDS) {
        const re = new RegExp(`^${brand}\\b`, 'i');
        if (re.test(raw)) {
            return { brand, brandOther: '', model: raw.replace(re, '').trim() };
        }
    }
    return { brand: 'Otra', brandOther: '', model: raw };
}

export function composeVehicleModel({ brand, brandOther, model } = {}) {
    const b = brand === 'Otra' ? String(brandOther || '').trim() : String(brand || '').trim();
    const m = String(model || '').trim();
    if (!b) return m;
    if (!m) return b;
    if (m.toLowerCase().startsWith(b.toLowerCase())) return m;
    return `${b} ${m}`.replace(/\s+/g, ' ').trim();
}

/**
 * Fotos del paso 3. El orden y la cantidad siguen a photoItems() de la guía:
 * cada línea cuenta 1, o el número entre paréntesis si trae «(3)».
 */
export function vehiclePhotoSlots(type) {
    const t = VEHICLE_TYPES.includes(type) ? type : 'auto';
    if (t === 'moto') {
        return [
            { slot: 'helmet', label: 'Con casco', hint: 'Foto tuya con el casco puesto', icon: 'fa-hard-hat' },
            { slot: 'int1', label: 'Casco general', hint: 'Casco del conductor', icon: 'fa-hard-hat' },
            { slot: 'int2', label: 'Por dentro', hint: 'Casco del conductor por dentro', icon: 'fa-hard-hat' },
            { slot: 'int3', label: 'Verificación', hint: 'Casco del conductor, verificación', icon: 'fa-check-circle' },
            { slot: 'pc1', label: 'Pasajero', hint: 'Casco para pasajeros, afuera', icon: 'fa-user-friends' },
            { slot: 'pc2', label: 'Pasajero dentro', hint: 'Casco para pasajeros, por dentro', icon: 'fa-user' },
            { slot: 'extFront', label: 'Frente', hint: 'Exterior de la moto', icon: 'fa-motorcycle' },
            { slot: 'extRear', label: 'Atrás', hint: 'Exterior de la moto', icon: 'fa-motorcycle' },
            { slot: 'plate', label: 'Placa', hint: 'Placa bien legible', icon: 'fa-id-card' }
        ];
    }
    const interior = t === 'taxi'
        ? [
            { slot: 'int1', label: 'Asientos', icon: 'fa-chair' },
            { slot: 'int2', label: 'Tablero', icon: 'fa-tachometer-alt' },
            { slot: 'int3', label: 'Maletero', icon: 'fa-box-open' }
        ]
        : t === 'paila'
            ? [
                { slot: 'int1', label: 'Cabina', icon: 'fa-truck-pickup' },
                { slot: 'int2', label: 'Caja', icon: 'fa-truck-pickup' },
                { slot: 'int3', label: 'Carga', icon: 'fa-box' }
            ]
            : t === 'camion'
                ? [
                    { slot: 'int1', label: 'Cabina', icon: 'fa-truck' },
                    { slot: 'int2', label: 'Furgón', icon: 'fa-truck' },
                    { slot: 'int3', label: 'Lateral', icon: 'fa-truck' }
                ]
                : t === 'grua'
                    ? [
                        { slot: 'int1', label: 'Cabina', icon: 'fa-truck' },
                        { slot: 'int2', label: 'Pluma', icon: 'fa-tools' },
                        { slot: 'int3', label: 'Gancho', icon: 'fa-link' }
                    ]
                    : [
                        { slot: 'int1', label: 'Asientos', icon: 'fa-chair' },
                        { slot: 'int2', label: 'Tablero', icon: 'fa-tachometer-alt' },
                        { slot: 'int3', label: 'Maletero', icon: 'fa-box-open' }
                    ];
    return [
        { slot: 'extFront', label: 'Frente', icon: t === 'taxi' ? 'fa-taxi' : 'fa-car' },
        { slot: 'extRear', label: 'Atrás', icon: 'fa-car-side' },
        { slot: 'plate', label: 'Placa', icon: 'fa-id-card' },
        ...interior
    ];
}

/** Cuenta las fotos que pide photoItems() (una línea = 1, o el (N) que traiga). */
export function photoCountFromGuideItems(items) {
    return (items || []).reduce((n, html) => {
        const text = String(html || '').replace(/<[^>]+>/g, '');
        const m = text.match(/\((\d+)\)/);
        const count = m ? Number(m[1]) : 1;
        return n + (count > 0 ? count : 1);
    }, 0);
}

function photoNoun(type) {
    if (type === 'moto') return 'de la moto';
    if (type === 'taxi') return 'del taxi';
    if (type === 'paila') return 'de la paila';
    if (type === 'camion') return 'del camión';
    if (type === 'grua') return 'de la grúa';
    return 'del carro';
}

/**
 * Resumen del paso final a partir del borrador real.
 * Un estado con 2 de 5 documentos no puede decir 5/5, y no deja enviar.
 */
export function registrationChecklist(state = {}, { now = new Date(), cutoffs } = {}) {
    const type = VEHICLE_TYPES.includes(state.type) ? state.type : 'auto';
    const slots = vehiclePhotoSlots(type);
    const photosMissing = slots.filter((slot) => !state.photos?.[slot.slot]).map((slot) => slot.label);
    const docs = documentRows();
    const docsMissing = docs.filter((row) => {
        if (!state.photos?.[row.slot]) return true;
        if (row.needsCode && !String(state[row.codeKey] || '').trim()) return true;
        return false;
    }).map((row) => row.label);
    const selfie = !!state.photos?.face;
    const model = composeVehicleModel(state);
    const year = Number(state.year);
    const yearOk = isPlausibleVehicleYear(year, now);
    const acOk = state.hasAC === true || state.hasAC === false;
    const seatsOk = SEAT_CHIPS.includes(Number(state.seats));
    const plateOk = !!String(state.plate || '').trim();
    const nameOk = !!String(state.name || '').trim();
    const phoneOk = !!String(state.phone || '').trim();
    const brandOk = !!state.brand && (state.brand !== 'Otra' || !!String(state.brandOther || '').trim());
    const freight = type === 'paila' || type === 'camion' || type === 'grua';
    const cargoOk = !freight || !!String(state.cargo || state.cargoCapacity || '').trim();
    const photosDone = slots.length - photosMissing.length;
    const docsDone = docs.length - docsMissing.length;
    const category = yearOk && acOk && seatsOk
        ? suggestRideCategory({ type, year, hasAC: state.hasAC === true, seats: Number(state.seats), cutoffs })
        : null;
    const canSubmit = !!(brandOk && model && plateOk && cargoOk && yearOk && acOk && seatsOk
        && photosMissing.length === 0 && docsMissing.length === 0 && selfie && nameOk && phoneOk);
    const canSaveUpdate = !!(brandOk && model && plateOk && cargoOk && yearOk && acOk && seatsOk);
    const photoLine = photosMissing.length
        ? `Fotos ${photoNoun(type)}: ${photosDone}/${slots.length} · falta ${photosMissing.join(', ')}`
        : `Fotos ${photoNoun(type)}: ${photosDone}/${slots.length}`;
    const docLine = docsMissing.length
        ? `Documentos: ${docsDone}/${docs.length} · falta ${docsMissing.join(', ')}`
        : `Documentos: ${docsDone}/${docs.length}`;
    const lines = [
        { ok: !!(model && plateOk), text: `Vehículo: ${model || 'falta'}${yearOk ? ` ${year}` : ''}` },
        { ok: freight || !!category, text: freight ? 'Categoría de raite: no aplica' : `Categoría: ${category ? rideCategoryLabel(category) : 'falta'}` },
        { ok: photosMissing.length === 0, text: photoLine },
        { ok: docsMissing.length === 0, text: docLine },
        { ok: selfie, text: selfie ? 'Selfie: lista' : 'Selfie: falta' }
    ];
    return {
        photosDone,
        photosTotal: slots.length,
        photosMissing,
        docsDone,
        docsTotal: docs.length,
        docsMissing,
        selfie,
        canSubmit,
        canSaveUpdate,
        lines,
        category
    };
}

export function documentRows() {
    return [
        { slot: 'licenseFront', label: 'Licencia — frente', codeKey: 'licenseNumber', codeLabel: 'N° de licencia', needsCode: true },
        { slot: 'licenseBack', label: 'Licencia — revés', needsCode: false },
        { slot: 'inspection', label: 'Revisión vehicular', codeKey: 'inspection', codeLabel: 'N° o fecha', needsCode: true },
        { slot: 'antecedentes', label: 'Antecedentes penales', codeKey: 'penCode', codeLabel: 'Código', needsCode: true },
        { slot: 'policiales', label: 'Antecedentes policiales', codeKey: 'policialesCode', codeLabel: 'Código', needsCode: true }
    ];
}

export function readComfort(profile) {
    const vehicle = profile?.vehicle || {};
    const year = profile?.vehicleYear ?? vehicle.year ?? null;
    const hasAC = profile?.hasAC ?? vehicle.hasAC;
    const seats = profile?.seats ?? vehicle.seats ?? null;
    const suggestedCategory = profile?.suggestedCategory || vehicle.suggestedCategory || null;
    return {
        year: year == null || year === '' ? null : Number(year),
        hasAC: hasAC === true ? true : hasAC === false ? false : null,
        seats: seats == null || seats === '' ? null : Number(seats),
        suggestedCategory: suggestedCategory || null,
        confirmed: profile?.vehicleCategoryConfirmed === true
    };
}

export function comfortReviewLines(profile) {
    const c = readComfort(profile);
    const ac = c.hasAC === true ? 'Sí' : c.hasAC === false ? 'No' : 'Sin confirmar';
    return [
        { label: 'Año', value: c.year ? String(c.year) : 'Sin confirmar' },
        { label: 'Aire acondicionado', value: ac },
        { label: 'Asientos', value: c.seats ? String(c.seats) : 'Sin confirmar' },
        { label: 'Categoría sugerida', value: rideCategoryLabel(c.suggestedCategory) || 'Sin categoría' }
    ];
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function comfortReviewHtml(profile) {
    const lines = comfortReviewLines(profile);
    return `<div class="hr-comfort-review">${lines.map((line) =>
        `<div><span>${esc(line.label)}:</span> <b>${esc(line.value)}</b></div>`
    ).join('')}</div>`;
}

function cloneVehicles(profile) {
    const list = Array.isArray(profile?.vehicles) ? profile.vehicles : [];
    return list.map((v) => ({
        ...v,
        vehicle: { ...(v?.vehicle || {}) },
        approvalStatus: v?.approvalStatus
    }));
}

/**
 * Parche del conductor ya aprobado. No incluye approvalStatus ni lo baja en vehicles[].
 * El año solo entra si el conductor lo confirmó (yearConfirmed).
 */
export function buildApprovedComfortPatch(profile, input = {}) {
    if (!profile || profile.role !== 'driver') {
        return { ok: false, message: 'Solo un conductor puede actualizar su vehículo.' };
    }
    if (profile.approvalStatus !== 'approved') {
        return { ok: false, message: 'Esta actualización es para conductores ya aprobados.' };
    }
    const now = input.now instanceof Date ? input.now : new Date();
    const type = VEHICLE_TYPES.includes(input.type) ? input.type : (profile.vehicleType || 'auto');
    const modelText = composeVehicleModel(input);
    if (!modelText) return { ok: false, message: 'Indicá la marca y el modelo.' };
    if (!input.yearConfirmed) {
        return { ok: false, message: 'Confirmá el año antes de guardarlo.' };
    }
    const year = Number(input.year);
    if (!isPlausibleVehicleYear(year, now)) {
        return { ok: false, message: 'Elegí un año válido del vehículo.' };
    }
    if (input.hasAC !== true && input.hasAC !== false) {
        return { ok: false, message: 'Indicá si tiene aire acondicionado.' };
    }
    const seats = Number(input.seats);
    if (!SEAT_CHIPS.includes(seats)) {
        return { ok: false, message: 'Elegí cuántos asientos tiene.' };
    }
    const cutoffs = normalizeCutoffs(input.cutoffs);
    const suggestedCategory = suggestRideCategory({
        type, year, hasAC: input.hasAC === true, seats, cutoffs
    });
    const plate = String(input.plate != null ? input.plate : (profile.vehicle?.plate || '')).trim();
    const cargo = String(input.cargoCapacity || profile.vehicle?.cargoCapacity || '').trim();
    if ((type === 'paila' || type === 'camion' || type === 'grua') && !cargo) {
        return { ok: false, message: 'Indicá la capacidad de carga.' };
    }

    const vehicle = {
        ...(profile.vehicle || {}),
        type,
        model: modelText,
        plate,
        year,
        hasAC: input.hasAC === true,
        seats,
        suggestedCategory: suggestedCategory || null
    };
    if (cargo) vehicle.cargoCapacity = cargo;
    else delete vehicle.cargoCapacity;

    const vehicles = cloneVehicles(profile);
    const activeId = profile.activeVehicleId
        || vehicles.find((v) => v.approvalStatus === 'approved')?.id
        || vehicles[0]?.id
        || null;
    if (vehicles.length) {
        for (const v of vehicles) {
            const keepStatus = v.approvalStatus;
            if (activeId && v.id === activeId) {
                v.type = type;
                v.vehicle = { ...(v.vehicle || {}), ...vehicle };
                v.label = v.label || modelText;
                v.updatedAt = new Date().toISOString();
            }
            v.approvalStatus = keepStatus;
        }
    }

    const patch = {
        vehicleYear: year,
        hasAC: input.hasAC === true,
        seats,
        suggestedCategory: suggestedCategory || null,
        vehicleCategoryConfirmed: true,
        vehicleCategoryUpdatedAt: Date.now(),
        vehicleType: type,
        vehicle,
        updatedAt: Date.now()
    };
    if (vehicles.length) {
        patch.vehicles = vehicles;
        if (activeId) patch.activeVehicleId = activeId;
    }
    if (type === 'paila' || type === 'camion') {
        patch.freightEnabled = true;
        patch.canDoFreight = true;
    }
    return { ok: true, patch, suggestedCategory, year };
}

export const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;

/** ¿Mostrar el aviso al conductor aprobado? «Más tarde» solo aplaza, no bloquea el trabajo. */
export function shouldAskVehicleUpdate(profile, { now = Date.now(), snoozeUntil = 0, inTrip = false } = {}) {
    if (!profile || profile.role !== 'driver') return false;
    if (profile.approvalStatus !== 'approved') return false;
    if (profile.vehicleCategoryConfirmed === true) return false;
    if (inTrip) return false;
    const until = Number(snoozeUntil) || 0;
    if (until && now < until) return false;
    return true;
}
