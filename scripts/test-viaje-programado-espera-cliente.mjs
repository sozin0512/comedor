/**
 * Pasajero con viaje programado en espera: no pide otro servicio.
 * Admin y supervisor sí. El candado cubre pending+scheduledFor y status scheduled,
 * y se levanta al cancelar o completar.
 * Uso: node scripts/test-viaje-programado-espera-cliente.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const res = [];
const ok = (name, cond, extra = '') => {
    res.push([cond ? 'PASS' : 'FAIL', name, extra]);
    if (!cond) console.error('FAIL', name, extra);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wait-lock-'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
fs.copyFileSync(path.join(ROOT, 'js/scheduled-trip-driver-ui.js'), path.join(dir, 'scheduled-trip-driver-ui.js'));
fs.copyFileSync(path.join(ROOT, 'js/scheduled-trip-client-lock.js'), path.join(dir, 'scheduled-trip-client-lock.js'));
const ui = await import(path.join(dir, 'scheduled-trip-client-lock.js'));
const fn = require(path.join(ROOT, 'functions/scheduled-trip-client-lock.js'));

const TOAST = 'Tenés un viaje en espera. No podés pedir otro servicio hasta que se complete o lo cancelés.';
ok('el texto del aviso es el de la propuesta', ui.WAITING_LOCK_TOAST === TOAST && fn.WAITING_LOCK_TOAST === TOAST);

const scheduled = {
    id: 'res-1',
    status: 'scheduled',
    scheduledFor: '2026-11-10T18:00:00-06:00',
    driverName: 'Carlos Méndez',
    clientId: 'cli'
};
const searching = {
    id: 'bus-1',
    status: 'pending',
    scheduledFor: '2026-11-10T18:00:00-06:00',
    clientId: 'cli'
};
const immediate = { id: 'ya-1', status: 'pending', clientId: 'cli' };
const enCurso = { id: 'go-1', status: 'in_progress', clientId: 'cli', scheduledFor: '2026-11-10T18:00:00-06:00' };

ok('status scheduled bloquea al cliente', ui.waitingLockDecision({ trips: [scheduled], staff: { role: 'client' } }).locked === true);
ok('pending con scheduledFor bloquea al cliente', ui.waitingLockDecision({ trips: [searching], staff: { role: 'client' } }).locked === true
    && ui.waitingLockDecision({ trips: [searching], staff: { role: 'client' } }).reason === 'pending-scheduled');
ok('pending inmediato no es este candado', ui.isWaitingScheduledTrip(immediate) === false
    && ui.waitingLockDecision({ trips: [immediate], staff: { role: 'client' } }).locked === false);
ok('en curso no es viaje en espera', ui.isWaitingScheduledTrip(enCurso) === false);

ok('admin no queda bloqueado', ui.waitingLockDecision({
    trips: [scheduled, searching],
    staff: { role: 'admin', isAdmin: true, isStaff: true }
}).locked === false);
ok('supervisor no queda bloqueado', ui.waitingLockDecision({
    trips: [scheduled],
    staff: { role: 'supervisor', isSupervisor: true }
}).locked === false);
ok('staffGrantedBy no queda bloqueado', ui.waitingLockDecision({
    trips: [scheduled],
    staff: { role: 'client', staffGrantedBy: 'admin-uid' }
}).locked === false);
ok('isStaff del helper no queda bloqueado', ui.staffExemptFromWaitingLock({ isStaff: true }) === true
    && ui.waitingLockDecision({ trips: [searching], staff: { isStaff: true, role: 'client' } }).locked === false);
ok('si el helper ya dijo que no es staff, staffGrantedBy no lo pisa', ui.waitingLockDecision({
    trips: [scheduled],
    staff: { helpersChecked: true, isStaff: false, isAdmin: false, isSupervisor: false, staffGrantedBy: 'viejo', role: 'client' }
}).locked === true);

const cancelled = { ...scheduled, status: 'cancelled' };
const completed = { ...searching, status: 'completed' };
ok('al cancelar se levanta', ui.isWaitingScheduledTrip(cancelled) === false
    && ui.waitingLockDecision({ trips: [cancelled], staff: { role: 'client' } }).locked === false);
ok('al completar se levanta', ui.isWaitingScheduledTrip(completed) === false
    && ui.waitingLockDecision({ trips: [completed], staff: { role: 'client' } }).locked === false);
ok('si queda otro programado, sigue el candado', ui.waitingLockDecision({
    trips: [cancelled, scheduled],
    staff: { role: 'client' }
}).trip.id === 'res-1');

ok('ignora el viaje que se está creando', ui.pickWaitingScheduledTrip([scheduled, searching], { ignoreId: 'res-1' }).id === 'bus-1');
ok('simulación de demanda no cuenta', ui.isWaitingScheduledTrip({ ...scheduled, isDemandSimulation: true }) === false);

ok('viaje armado por staff no es un pedido del pasajero', ui.requestSkipsWaitingLock({
    staffAssistedClient: true,
    staffCreatedBy: 'uid-admin'
}) === true);
ok('WhatsApp no se salta el candado', ui.requestSkipsWaitingLock({
    staffAssistedClient: true,
    staffCreatedBy: 'whatsapp-assistant'
}) === false);
ok('envío de la tienda (merchant) no se cancela por este candado', ui.requestSkipsWaitingLock({
    createdByMerchant: true,
    serviceType: 'delivery'
}) === true);

const html = ui.waitingLockCardHtml(scheduled, Date.parse('2026-11-10T12:00:00-06:00'));
ok('tarjeta: Tu viaje está en espera y Ver reserva', html.includes('Tu viaje está en espera') && html.includes('Ver reserva'));
ok('tarjeta: hora de hoy y conductor', html.includes('Hoy 6:00 p. m.') && html.includes('Carlos Méndez'), html);
ok('tarjeta bloquea Viaje, Tiendas, Envío y Flete', ['Viaje', 'Tiendas', 'Envío', 'Flete'].every((label) => html.includes(label) && html.includes('Bloqueado')));
ok('la tarjeta usa vos en el aviso, no tú', !/\bpuedes\b|\bcanceles\b|\bcompletes\b/.test(TOAST) && /Tenés|podés|cancelés/.test(TOAST));

const same = (trips, staff, ignoreId) => JSON.stringify(ui.waitingLockDecision({ trips, staff, ignoreId }))
    === JSON.stringify(fn.waitingLockDecision({ trips, staff, ignoreId }));
ok('cliente y functions deciden igual: cliente', same([scheduled], { role: 'client' }));
ok('cliente y functions deciden igual: admin', same([scheduled, searching], { isAdmin: true, role: 'admin' }));
ok('cliente y functions deciden igual: supervisor', same([searching], { isSupervisor: true, role: 'supervisor' }));
ok('cliente y functions deciden igual: staffGrantedBy', same([scheduled], { staffGrantedBy: 'adm', role: 'client' }));
ok('cliente y functions deciden igual: pending+hora', same([searching], { role: 'client' }));
ok('cliente y functions deciden igual: cancelado', same([cancelled], { role: 'client' }));
ok('cliente y functions deciden igual: completado', same([completed], { role: 'client' }));
ok('cliente y functions: el viaje nuevo no se cuenta solo', same([scheduled], { role: 'client' }, 'res-1'));
ok('cliente y functions: helper ya revisado', same([scheduled], {
    helpersChecked: true, isStaff: false, isAdmin: false, isSupervisor: false, staffGrantedBy: 'viejo', role: 'client'
}));

const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const home = fs.readFileSync(path.join(ROOT, 'js/passenger-home.js'), 'utf8');
const stores = fs.readFileSync(path.join(ROOT, 'js/merchant-stores.js'), 'utf8');
const guest = fs.readFileSync(path.join(ROOT, 'functions/guest-checkout.js'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
const wa = fs.readFileSync(path.join(ROOT, 'functions/whatsapp-cloud.js'), 'utf8');
const waOrder = fs.readFileSync(path.join(ROOT, 'functions/wa-customer-order.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
const version = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');

ok('sendTripRequest consulta el viaje en espera', app.includes('fetchClientWaitingScheduledTrip')
    && app.includes('fetchGuestWaitingScheduledTrip')
    && app.includes('showPassengerWaitingLock'));
ok('el cliente abre Ver reserva con la UI que ya existía', app.includes('window.hrOpenWaitingReservation')
    && app.includes('presentScheduledReservedUi')
    && app.includes('restorePendingTripUI'));
ok('admin/supervisor usan isStaffUser / isAdminUser / isSupervisorUser', app.includes('passengerWaitingStaffExempt')
    && app.includes('isStaffUser(currentUser, window.userProfile)')
    && app.includes('isAdminUser(currentUser, window.userProfile)')
    && app.includes('isSupervisorUser(currentUser, window.userProfile)'));
ok('el inicio bloquea Viaje, Tiendas, Envío, Flete y Grúa', home.includes("WAITING_LOCK_ENTRY_MODES = new Set(['trip', 'stores', 'delivery', 'freight', 'tow'])")
    && home.includes('hrPassengerWaitingLockActive'));
ok('tiendas no cobra si el candado está activo', stores.includes('hrPassengerRequestBlocked'));
ok('validateTripCreation rechaza en el servidor', index.includes('waitingLock.callerIsStaff')
    && index.includes('waitingLock.loadWaitingScheduledTrip')
    && index.includes('waitingLock.WAITING_LOCK_TOAST'));
ok('onCreate cancela un segundo viaje o pedido', index.includes('rejectTripIfClientWaiting')
    && index.includes('rejectStoreOrderIfClientWaiting'));
ok('invitado no crea otro viaje ni otro pedido', guest.includes('guest_${guest.phone}')
    && guest.includes('waitingLock.WAITING_LOCK_TOAST'));
ok('WhatsApp tampoco crea el segundo viaje', wa.includes('waitingLock.loadWaitingScheduledTrip')
    && wa.includes("e?.code === 'failed-precondition'"));
ok('pedido de tienda por WhatsApp también', waOrder.includes('waitingLock.loadWaitingScheduledTrip'));
ok('versión 2026.10.26.103', version.includes('2026.10.26.103')
    && fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').includes("appVersion: '2026.10.26.103'"));
ok('CSS: tarjeta con 8px y 48px (3 botones)', css.includes('body.android-3btn #passenger-waiting-lock.hr-wait-lock')
    && css.includes('bottom: calc(8px + max(var(--safe-bottom, 0px), var(--android-nav-inset, 48px), 48px));'));
ok('CSS: tarjeta con 20px (gestos)', css.includes('body.android-gesture #passenger-waiting-lock.hr-wait-lock')
    && css.includes('bottom: calc(8px + max(20px, var(--safe-bottom, env(safe-area-inset-bottom, 0px))));'));
ok('CSS: Cancelar de la búsqueda también sube', css.includes('body.android-3btn.is-searching #searching-cancel-btn')
    && css.includes('body.android-gesture.is-searching #searching-cancel-btn'));
ok('el flujo del conductor no se reescribió en la copia de functions', fs.readFileSync(path.join(ROOT, 'functions/scheduled-trip-driver-ui.js'), 'utf8').includes('SCHEDULED_LOCK_MINUTES'));

const failed = res.filter((r) => r[0] === 'FAIL');
console.log(`${res.length - failed.length}/${res.length} PASS`);
if (failed.length) process.exit(1);
