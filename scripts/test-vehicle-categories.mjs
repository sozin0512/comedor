/**
 * Año en el texto del vehículo, categoría sugerida y actualización
 * de un conductor ya aprobado (no cambia su aprobación).
 * node scripts/test-vehicle-categories.mjs
 */
import { createRequire } from 'node:module';
import { photoItems } from '../js/driver-register-guide.js';
import {
    parseYearFromVehicleText,
    suggestRideCategory,
    photoCountFromGuideItems,
    vehiclePhotoSlots,
    documentRows,
    yearChoices,
    placeYear,
    registrationChecklist,
    buildApprovedComfortPatch,
    shouldAskVehicleUpdate,
    DEFAULT_RIDE_CUTOFFS,
    normalizeCutoffs
} from '../js/vehicle-categories.js';

const require = createRequire(import.meta.url);
const { protectApprovedComfortPatch } = require('../functions/vehicle-comfort.js');

const now = new Date('2026-11-12T12:00:00Z');
let failed = 0;
function eq(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failed += 1;
        console.error('FAIL', name, '\n  got ', actual, '\n  want', expected);
    } else {
        console.log('PASS', name);
    }
}
function ok(name, cond) {
    eq(name, !!cond, true);
}

eq('año al final del modelo', parseYearFromVehicleText('Toyota scion 2006', now), 2006);
eq('año al inicio', parseYearFromVehicleText('2012 Toyota Corolla', now), 2012);
eq('moto sin año', parseYearFromVehicleText('Honda Wave 110', now), null);
eq('ignora placa de 4 dígitos', parseYearFromVehicleText('placa T-1234 modelo 2018', now), 2018);
eq('fuera de rango 1979', parseYearFromVehicleText('Datsun 1979', now), null);
eq('año actual + 1', parseYearFromVehicleText('Hyundai 2027', now), 2027);
eq('año actual + 2 no', parseYearFromVehicleText('Hyundai 2028', now), null);
eq('varios años: el último plausible', parseYearFromVehicleText('2006 repintado 2016', now), 2016);
eq('texto vacío', parseYearFromVehicleText('   ', now), null);

eq('sin año no inventa Económico', suggestRideCategory({ type: 'auto', year: null, hasAC: null, seats: null }), null);
eq('moto', suggestRideCategory({ type: 'moto', year: 2024, hasAC: true, seats: 4 }), 'moto');
eq('económico hasta 2015', suggestRideCategory({ type: 'auto', year: 2015, hasAC: true, seats: 4 }), 'economico');
eq('2014 con aire sigue económico', suggestRideCategory({ type: 'auto', year: 2014, hasAC: true, seats: 5 }), 'economico');
eq('confort 2016 con aire', suggestRideCategory({ type: 'auto', year: 2016, hasAC: true, seats: 4 }), 'confort');
eq('2016 sin aire no es confort', suggestRideCategory({ type: 'auto', year: 2018, hasAC: false, seats: 4 }), 'economico');
eq('vip 2021', suggestRideCategory({ type: 'taxi', year: 2021, hasAC: false, seats: 4 }), 'vip');
eq('7 asientos es familiar aunque sea VIP', suggestRideCategory({ type: 'auto', year: 2022, hasAC: true, seats: 7 }), 'familiar');
eq('7 asientos viejo es familiar', suggestRideCategory({ type: 'auto', year: 2010, hasAC: false, seats: 7 }), 'familiar');
eq('paila no tiene categoría de raite', suggestRideCategory({ type: 'paila', year: 2020, hasAC: true, seats: 4 }), null);
eq('corte editable', suggestRideCategory({
    type: 'auto', year: 2019, hasAC: false, seats: 4,
    cutoffs: { ...DEFAULT_RIDE_CUTOFFS, vipMinYear: 2019 }
}), 'vip');
eq('normaliza cortes invertidos', normalizeCutoffs({ economicoMaxYear: 2020, confortMinYear: 2010, vipMinYear: 2000 }).confortMinYear, 2021);

for (const type of ['auto', 'taxi', 'moto', 'paila', 'camion', 'grua']) {
    eq(`fotos ${type} = photoItems()`, vehiclePhotoSlots(type).length, photoCountFromGuideItems(photoItems(type)));
}
ok('moto incluye casco', vehiclePhotoSlots('moto').some((s) => s.slot === 'helmet'));

const approved = {
    role: 'driver',
    approvalStatus: 'approved',
    approvedAt: '2026-01-01T00:00:00.000Z',
    documentsValidUntil: '2026-07-01T00:00:00.000Z',
    vehicleType: 'auto',
    activeVehicleId: 'veh1',
    vehicle: { model: 'Toyota scion 2006', plate: 'ABC123', type: 'auto' },
    vehicles: [
        { id: 'veh1', type: 'auto', approvalStatus: 'approved', vehicle: { model: 'Toyota scion 2006', plate: 'ABC123' } },
        { id: 'veh2', type: 'paila', approvalStatus: 'pending', vehicle: { model: 'Hilux', plate: 'ZZ1' } }
    ]
};

const silent = buildApprovedComfortPatch(approved, {
    type: 'auto', brand: 'Toyota', model: 'scion', year: 2006, yearConfirmed: false, hasAC: true, seats: 4, now
});
eq('sin confirmar el año no guarda', silent.ok, false);

const saved = buildApprovedComfortPatch(approved, {
    type: 'auto', brand: 'Toyota', model: 'Corolla', plate: 'ABC123',
    year: 2016, yearConfirmed: true, hasAC: true, seats: 4, now,
    approvalStatus: 'pending'
});
eq('guardado ok', saved.ok, true);
ok('el parche no trae approvalStatus', !Object.prototype.hasOwnProperty.call(saved.patch, 'approvalStatus'));
ok('no borra approvedAt', !Object.prototype.hasOwnProperty.call(saved.patch, 'approvedAt'));
eq('año confirmado', saved.patch.vehicleYear, 2016);
eq('categoría confort', saved.patch.suggestedCategory, 'confort');
eq('vehículo activo sigue aprobado', saved.patch.vehicles[0].approvalStatus, 'approved');
eq('el pendiente sigue pendiente', saved.patch.vehicles[1].approvalStatus, 'pending');
eq('modelo compuesto', saved.patch.vehicle.model, 'Toyota Corolla');

const serverIn = {
    vehicleYear: 2016,
    hasAC: true,
    seats: 4,
    suggestedCategory: 'confort',
    vehicleCategoryConfirmed: true,
    approvalStatus: 'pending',
    approvedAt: null,
    vehicles: [
        { id: 'veh1', approvalStatus: 'pending', vehicle: { model: 'Toyota Corolla' } },
        { id: 'veh2', approvalStatus: 'approved', vehicle: { model: 'Hilux' } }
    ]
};
const serverOut = protectApprovedComfortPatch(serverIn, approved);
ok('servidor quita approvalStatus', !Object.prototype.hasOwnProperty.call(serverOut, 'approvalStatus'));
ok('servidor no toca approvedAt', !Object.prototype.hasOwnProperty.call(serverOut, 'approvedAt'));
eq('servidor conserva estado del vehículo', serverOut.vehicles.map((v) => v.approvalStatus), ['approved', 'pending']);

const renewal = protectApprovedComfortPatch({ approvalStatus: 'pending', documentsPhotos: { licenseFront: 'x' } }, approved);
eq('renovar documentos sí puede volver a pendiente', renewal.approvalStatus, 'pending');

eq('pide actualización', shouldAskVehicleUpdate(approved, { now: Date.parse('2026-11-12T12:00:00Z') }), true);
eq('Más tarde aplaza', shouldAskVehicleUpdate(approved, { now: 1000, snoozeUntil: 5000 }), false);
eq('ya confirmó, no vuelve a pedir', shouldAskVehicleUpdate({ ...approved, vehicleCategoryConfirmed: true }), false);
eq('pendiente no ve el aviso', shouldAskVehicleUpdate({ ...approved, approvalStatus: 'pending' }), false);
eq('en viaje no interrumpe', shouldAskVehicleUpdate(approved, { inTrip: true }), false);

const years = yearChoices(now);
eq('la grilla empieza en 1995', years[0], 1995);
eq('la grilla llega al año actual + 1', years[years.length - 1], 2027);
ok('incluye años impares', years.includes(2006) && years.includes(2017));
eq('2016 queda seleccionado en la grilla', placeYear(2016, now), { grid: 2016, other: '' });
eq('1990 va en Otro', placeYear(1990, now), { grid: null, other: '1990' });

const partial = {
    type: 'auto',
    brand: 'Toyota',
    model: 'Corolla',
    plate: 'HAB 1234',
    year: 2016,
    hasAC: true,
    seats: 4,
    name: 'Ana López',
    phone: '+504 9999-0000',
    licenseNumber: 'L-48291',
    photos: { extFront: 'a', extRear: 'a', plate: 'a', licenseFront: 'a', licenseBack: 'a' }
};
const partialReport = registrationChecklist(partial, { now });
eq('borrador parcial: 3 fotos', partialReport.photosDone, 3);
eq('borrador parcial: 2 documentos', partialReport.docsDone, 2);
eq('borrador parcial no se puede enviar', partialReport.canSubmit, false);
ok('el resumen no inventa 5/5', !partialReport.lines.some((line) => line.text.includes('5/5')));
ok('dice qué documentos faltan', partialReport.docsMissing.includes('Revisión vehicular') && partialReport.docsMissing.includes('Antecedentes penales'));
ok('la selfie falta', partialReport.lines.some((line) => line.text === 'Selfie: falta'));

const fullPhotos = {};
vehiclePhotoSlots('auto').forEach((slot) => { fullPhotos[slot.slot] = 'a'; });
documentRows().forEach((row) => { fullPhotos[row.slot] = 'a'; });
fullPhotos.face = 'a';
const fullReport = registrationChecklist({
    ...partial,
    inspection: 'RV-2026',
    penCode: 'PEN-1',
    policialesCode: 'POL-1',
    photos: fullPhotos
}, { now });
eq('borrador completo: 6 fotos', fullReport.photosDone, 6);
eq('borrador completo: 5 documentos', fullReport.docsDone, 5);
eq('borrador completo sí se envía', fullReport.canSubmit, true);
ok('el resumen completo dice 5/5', fullReport.lines.some((line) => line.text === 'Documentos: 5/5'));

if (failed) {
    console.error(`${failed} pruebas fallaron`);
    process.exit(1);
}
console.log('Todas las pruebas pasaron');
