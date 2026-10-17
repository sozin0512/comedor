// Prueba del interruptor En línea / Desconectado del conductor (js/app.js real, con dependencias simuladas).
// Regresión: tras «Pausar», volver a «En línea» no re-armaba el GPS y el interruptor quedaba en «Desconectado».
// Uso: node scripts/test-driver-online-toggle.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const a = src.indexOf('        window.startDriverLocationTracking = async () => {');
const b = src.indexOf('        window.updateDriverOnlineBadge = (isOnline) => {');
if (a < 0 || b < 0) throw new Error('no se encontró el bloque de seguimiento del conductor');
const block = src.slice(a, b);

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };

function makeEnv({ android = false, notif = 'granted', blocked = false } = {}) {
  const timers = []; const intervals = new Map(); let nextId = 1;
  const listeners = {};
  let watchSeq = 0; const watches = new Set();
  const writes = []; const toasts = [];
  const win = { showToast: (m, k) => toasts.push([k, m]), userProfile: { role: 'driver', name: 'D', phone: '99999999' } };
  const geo = {
    watchPosition: () => { const id = ++watchSeq; watches.add(id); return id; },
    clearWatch: (id) => watches.delete(id),
    getCurrentPosition: () => {}
  };
  const doc = { visibilityState: 'visible', getElementById: () => null,
    addEventListener: (e, f) => { (listeners[e] ||= new Set()).add(f); },
    removeEventListener: (e, f) => listeners[e]?.delete(f) };
  const stubs = {
    window: win, navigator: { geolocation: geo }, document: doc,
    currentUser: { uid: 'drv1' }, activeTrip: null, db: {}, appId: 'app',
    setTimeout: (f, ms) => { timers.push({ f, ms }); return nextId++; },
    setInterval: (f) => { const id = nextId++; intervals.set(id, f); return id; },
    clearInterval: (id) => intervals.delete(id),
    doc: (...p) => p.join('/'),
    setDoc: async (ref, data) => { writes.push([ref, data]); },
    updateDoc: async () => {},
    getActiveVehicle: () => ({ type: 'moto', approvalStatus: 'approved', vehicle: { plate: 'X1' } }),
    isTestDriverProfile: () => false,
    computeDriverDayStats: () => ({}),
    isDriverBlockedByDepositDebt: () => blocked,
    isCapacitorAndroid: () => android,
    getNotificationPermission: () => notif,
    isNotificationSupported: () => true,
    isPushReadyForThisContext: () => notif === 'granted',
    registerPushServices: () => Promise.resolve(),
    shouldUseLowPowerMode: () => false,
    getDefaultZoneId: () => 'z', getZoneById: () => ({ name: 'Z' }), getActiveRadiusKm: () => 5,
    normalizeHondurasPhone: (x) => x, isDriverAppForeground: () => true,
    driverLocationCapabilityPatch: () => ({}),
    enforceDriverDepositDeadlineClient: () => Promise.resolve()
  };
  const scope = new Proxy(stubs, {
    has: (o, k) => typeof k === 'string' && !['Date', 'Math', 'Number', 'JSON', 'String', 'Promise', 'Object', 'Array', 'Boolean', 'Error', 'console', 'undefined', 'Infinity', 'NaN', 'isFinite', 'parseInt'].includes(k),
    get: (o, k) => (k in o ? o[k] : (k === Symbol.unscopables ? undefined : (() => Promise.resolve(undefined))))
  });
  const run = new Function('scope', `with (scope) { ${block} }`);
  run(scope);
  const flush = () => { const all = timers.splice(0); all.forEach(({ f }) => { try { const r = f(); r?.catch?.(() => {}); } catch (_) {} }); };
  const tickIntervals = () => [...intervals.values()].forEach((f) => { try { f(); } catch (_) {} });
  const fireVisible = () => [...(listeners.visibilitychange || [])].forEach((f) => f());
  return { win, watches, writes, toasts, flush, tickIntervals, fireVisible, intervals };
}
const lastOnline = (e) => { for (let i = e.writes.length - 1; i >= 0; i--) if ('online' in e.writes[i][1]) return e.writes[i][1].online; return undefined; };

(async () => {
  // 1) Web / Android con avisos: en línea → pausa → en línea otra vez
  {
    const e = makeEnv();
    await e.win.toggleDriverOnline(true);
    t('web: primera vez queda en línea (watch armado)', e.win.driverLocationWatchId != null && e.win.isDriverOnlineActive());
    await e.win.toggleDriverOnline();
    t('web: pausa limpia el watch', e.win.driverLocationWatchId == null && e.watches.size === 0 && lastOnline(e) === false);
    await e.win.toggleDriverOnline();
    t('web: VOLVER a en línea re-arma el GPS (regresión)', e.win.driverLocationWatchId != null && e.watches.size === 1);
    t('web: interruptor del menú vuelve a «Conectado»', e.win.isDriverOnlineActive() === true);
    t('web: último estado escrito online:true', lastOnline(e) === true);
    for (let i = 0; i < 3; i++) { await e.win.toggleDriverOnline(); await e.win.toggleDriverOnline(); }
    t('web: 3 ciclos más sin watches duplicados', e.watches.size === 1 && e.win.isDriverOnlineActive());
  }
  // 2) Android sin permiso de avisos: el GPS espera; pausar durante la espera no debe re-encender
  {
    const e = makeEnv({ android: true, notif: 'default' });
    await e.win.toggleDriverOnline(true);
    t('android: en espera cuenta como en línea en el menú', e.win.isDriverOnlineActive() && e.win.driverLocationWatchId == null);
    e.tickIntervals();
    t('android: espera se arma sola cuando no hay modal', e.win.driverLocationWatchId != null && e.watches.size === 1);
    await e.win.toggleDriverOnline();
    t('android: pausa', !e.win.isDriverOnlineActive() && e.watches.size === 0);
    await e.win.toggleDriverOnline();
    e.tickIntervals();
    t('android: VOLVER a en línea re-arma (regresión)', e.win.driverLocationWatchId != null && e.watches.size === 1);
    await e.win.toggleDriverOnline();
    e.tickIntervals(); e.fireVisible(); e.flush(); e.flush();
    t('android: tras pausar, timers/visibilidad viejos NO encienden el GPS', e.watches.size === 0 && e.win.driverLocationWatchId == null && !e.win.isDriverOnlineActive());
    t('android: no quedan intervalos de espera de GPS', ![...e.intervals.values()].length || e.win.__hrDriverGpsWait == null);
  }
  // 3) Doble toque mientras espera: no duplica
  {
    const e = makeEnv({ android: true, notif: 'default' });
    await e.win.startDriverLocationTracking();
    await e.win.startDriverLocationTracking();
    e.tickIntervals(); e.tickIntervals(); e.flush();
    t('android: doble arranque = un solo watch', e.watches.size === 1);
  }
  // 4) Bloqueado por deuda: no dice «¡Estás en línea!» ni marca online:true
  {
    const e = makeEnv({ blocked: true });
    await e.win.toggleDriverOnline(true);
    t('deuda: no queda en línea', !e.win.isDriverOnlineActive());
    t('deuda: no muestra «¡Estás en línea!»', !e.toasts.some(([, m]) => /Estás en línea/.test(m)));
    t('deuda: no escribe online:true', !e.writes.some(([r, d]) => /drivers_location/.test(r) && d.online === true));
  }
  console.log(`${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})();
