/**
 * Conductor · viajes programados: hora clara, faja mientras va en otro viaje,
 * toma de control a los 30 min y holgura de la barra de Android.
 * Uso: node scripts/test-viaje-programado-conductor.mjs
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-ui-'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(dir, 'ui.mjs'), fs.readFileSync(path.join(ROOT, 'js/scheduled-trip-driver-ui.js'), 'utf8'));
const ui = await import(path.join(dir, 'ui.mjs'));
const fn = require(path.join(ROOT, 'functions/scheduled-trip-driver-ui.js'));

const PICKUP = '2026-11-10T15:30:00-06:00';
const NOW = Date.parse('2026-11-10T13:15:00-06:00');
const LOCK = Date.parse('2026-11-10T15:00:00-06:00');
const trip = {
    id: 'prog-1',
    status: 'scheduled',
    scheduledFor: PICKUP,
    price: 'L. 180.00',
    origin: 'Res. Plaza, Col. Kennedy',
    destination: 'Aeropuerto Toncontín',
    clientName: 'María López',
    driverId: 'drv'
};
const other = { id: 'ahora-1', status: 'in_progress', clientName: 'Carlos', driverId: 'drv' };
const later = { ...trip, id: 'prog-2', scheduledFor: '2026-11-10T18:00:00-06:00', clientName: 'Ana' };

ok('reloj: martes 3:30 p. m.', ui.formatWeekdayClock(ui.scheduledForMs(trip)) === 'martes 3:30 p. m.');
ok('corte 30 min: 3:00 p. m.', ui.formatClock(ui.cutoffMs(ui.scheduledForMs(trip))) === '3:00 p. m.');
ok('día largo', ui.formatLongDay(ui.scheduledForMs(trip)) === 'Martes 10 de noviembre');

const note = ui.keepWorkingNote(ui.scheduledForMs(trip));
ok('nota de seguir trabajando', note === 'Si lo aceptás, queda en tu panel y seguís haciendo viajes hasta las 3:00 p. m. A esa hora te toca ir a recoger.', note);
ok('nota usa vos', /aceptás|seguís/.test(note) && !/puedes|aceptas/.test(note));

const targeted = ui.scheduledOfferPush(trip);
const city = ui.scheduledOfferPush(trip, { kind: 'city' });
ok('push dirigida: título con hora', targeted.title === 'Viaje programado · martes 3:30 p. m.', targeted.title);
ok('push dirigida: tarifa, ruta y corte', targeted.body.includes('L. 180.00')
    && targeted.body.includes('Col. Kennedy')
    && targeted.body.includes('podés seguir trabajando hasta las 3:00 p. m.'), targeted.body);
ok('push de ciudad dice programado, hora y «en tu ciudad»', city.title.includes('programado')
    && city.title.includes('martes 3:30 p. m.')
    && city.title.includes('en tu ciudad'), city.title);
ok('push de ciudad trae la misma hora de recogida', city.body.includes('3:30 p. m.') && city.body.includes('3:00 p. m.'));

for (const [label, value] of [
    ['dirigida', targeted.body],
    ['ciudad', city.body],
    ['reserva', ui.scheduledReservedDriverPush(trip).body],
    ['aviso 30', ui.scheduledReminderPush(30, trip).body],
    ['aviso 60', ui.scheduledReminderPush(60, trip).body],
    ['activación', ui.scheduledActivationDriverPush(trip).body]
]) {
    ok(`sin «p. m..» en ${label}`, !String(value).includes('p. m..') && !String(value).includes('a. m..'), value);
    ok(`sin tú «puedes» en ${label}`, !/\bpuedes\b/i.test(String(value)), value);
}
ok('aviso de 30 min es vos', /Andá por María/.test(ui.scheduledReminderPush(30, trip).body)
    && /no podés tomar otros viajes/.test(ui.scheduledReminderPush(30, trip).body));

ok('cliente y functions dicen lo mismo', JSON.stringify(fn.scheduledOfferPush(trip)) === JSON.stringify(targeted)
    && JSON.stringify(fn.scheduledOfferPush(trip, { kind: 'city' })) === JSON.stringify(city)
    && JSON.stringify(fn.scheduledReminderPush(30, trip)) === JSON.stringify(ui.scheduledReminderPush(30, trip)));

const compact = ui.resolveScheduledSurface([trip, other], { previousId: 'ahora-1', now: NOW });
ok('durante otro viaje: faja compacta', compact.mode === 'compact' && compact.subject.id === 'prog-1' && compact.foreground.id === 'ahora-1');
ok('la faja no se esconde con el viaje aceptado', ui.companionVisibility('compact').showCompanion === true
    && ui.companionVisibility('compact').hideFullReservedCard === true);
const compactHtml = ui.compactCardHtml(trip, { now: NOW });
ok('faja: hora, ruta, tarifa y Seguí hasta', compactHtml.includes('Programado 3:30 p. m.')
    && compactHtml.includes('L. 180.00')
    && compactHtml.includes('María')
    && compactHtml.includes('Kennedy')
    && compactHtml.includes('Seguí hasta 3:00 p. m.')
    && !compactHtml.includes('class="hidden"'));

const warn = ui.resolveScheduledSurface([trip, other], { previousId: 'ahora-1', now: LOCK });
ok('a los 30 min, todavía en otro viaje: aviso', warn.mode === 'warning');
const warnHtml = ui.warningOnOtherHtml(trip);
ok('aviso: media hora, andá, ofertas en pausa y terminalo', warnHtml.includes('Ya es media hora antes')
    && warnHtml.includes('Andá por María')
    && warnHtml.includes('3:30 p. m.')
    && warnHtml.includes('Ofertas en pausa')
    && warnHtml.includes('Terminalo primero; al calificar, la app abre sola la ruta hacia María.'));
ok('el aviso sigue visible (no es la tarjeta escondida)', ui.companionVisibility('warning').showCompanion === true);

const take = ui.resolveScheduledSurface([trip], { now: LOCK });
ok('a los 30 min, libre: el programado toma el panel', take.mode === 'takeover');
const takeHtml = ui.takeoverHtml(trip);
ok('panel: Ir ahora, Maps y ofertas en pausa', takeHtml.includes('Ir ahora al punto de recogida')
    && takeHtml.includes('Abrir en Google Maps')
    && takeHtml.includes('Ofertas en pausa')
    && takeHtml.includes('Andá por María · 3:30 p. m.')
    && !takeHtml.includes('Terminalo primero'));

ok('libre y falta tiempo: tarjeta de reserva, no la faja', ui.resolveScheduledSurface([trip], { now: NOW }).mode === 'idle');
ok('inicio temprano (aceptado, aún faltan horas): viaje normal', ui.resolveScheduledSurface([{ ...trip, status: 'accepted' }], { now: NOW }).mode === 'none');
const activated = { ...trip, status: 'accepted' };
ok('activado en el servidor y sigue en otro viaje: no se esconde', ui.resolveScheduledSurface([activated, other], { previousId: 'ahora-1', now: LOCK }).mode === 'warning');

ok('el más cercano por scheduledFor', ui.nearestByScheduledFor([later, trip]).id === 'prog-1');
ok('dos reservas, sin otro viaje: muestra la más cercana', ui.resolveScheduledSurface([later, trip], { now: NOW }).subject.id === 'prog-1');

const afterOther = ui.resolveScheduledSurface([activated], { now: LOCK });
ok('al terminar el otro, abre la ruta solo si ya es la ventana', ui.shouldAutoOpenScheduledRoute({
    previousMode: 'warning',
    surface: afterOther,
    endedId: 'ahora-1'
}) === true);
ok('si todavía falta, no abre la ruta sola', ui.shouldAutoOpenScheduledRoute({
    previousMode: 'compact',
    surface: ui.resolveScheduledSurface([trip], { now: NOW }),
    endedId: 'ahora-1'
}) === false);
ok('en curso del propio programado no pisa la navegación', ui.resolveScheduledSurface([{ ...trip, status: 'in_progress' }], { now: LOCK }).mode === 'none');

ok('constantes de la barra', ui.ANDROID_NAV.gapPx === 8 && ui.ANDROID_NAV.threeButtonPx === 48 && ui.ANDROID_NAV.gesturePx === 20);

const css = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
ok('CSS: faja con 8px y 48px (3 botones)', css.includes('body.android-3btn #scheduled-companion.hr-sched-companion')
    && css.includes('bottom: calc(8px + max(var(--safe-bottom, 0px), var(--android-nav-inset, 48px), 48px));'));
ok('CSS: faja con 20px (gestos)', css.includes('body.android-gesture #scheduled-companion.hr-sched-companion')
    && css.includes('bottom: calc(8px + max(20px, var(--safe-bottom, env(safe-area-inset-bottom, 0px))));'));
ok('CSS: takeover también deja 48px y 20px', css.includes('body.android-3btn.scheduled-takeover #control-panel')
    && css.includes('body.android-gesture.scheduled-takeover #control-panel'));
ok('CSS: la reserva idle del conductor no ocupa 86dvh', /scheduled-reserved-active\.driver-mode[\s\S]{0,280}min\(58dvh/.test(css));

const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const acceptedStart = app.indexOf('window.presentTripAcceptedUi = (data, options = {}) => {');
const acceptedEnd = app.indexOf('window.syncClientPinDisplay = (data) => {', acceptedStart);
const acceptedUi = app.slice(acceptedStart, acceptedEnd);
ok('el viaje aceptado vuelve a pintar la faja', acceptedUi.includes('syncDriverScheduledCompanion'));
ok('el viaje aceptado no esconde #scheduled-companion', !acceptedUi.includes("getElementById('scheduled-companion')"));
ok('la reserva no reemplaza al otro viaje', app.includes("surface.mode === 'compact' || surface.mode === 'warning'"));
const index = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
ok('functions usa la copia y sigue activando a los 30 min', index.includes("require('./scheduled-trip-driver-ui')")
    && index.includes('exports.activateScheduledTrips')
    && index.includes('SCHEDULED_TRIP_PREP_MS'));
ok('el HTML tiene la faja fija', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('id="scheduled-companion"'));

const failed = res.filter((r) => r[0] === 'FAIL');
console.log(`${res.length - failed.length}/${res.length} pruebas OK`);
if (failed.length) {
    failed.forEach((r) => console.error(r[1], r[2]));
    process.exit(1);
}
