// Pruebas sin emulador: helpers del cliente (viaje vencido al tocar, token en servidor)
// y el SW (abre la app con ?hrPushTrip=). Uso: node scripts/test-push-viaje-vencido.cjs
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'fcm-push.js'), 'utf8');
function grab(re) { const m = src.match(re); if (!m) throw new Error('no encontrado ' + re); return m[0]; }
const code = [
  grab(/const STALE_PUSH_TRIP_TYPES = [^\n]+\n/),
  grab(/export function isStalePushTripType[\s\S]*?\n}\n/),
  grab(/export function pushTripAvailability[\s\S]*?\n}\n/),
  grab(/export function tokenInFcmMaps[\s\S]*?\n}\n/)
].join('\n').replace(/export /g, '') + '\n;({ isStalePushTripType, pushTripAvailability, tokenInFcmMaps })';
const H = vm.runInNewContext(code, {});
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);

ok('tipo viaje: trip_offer', H.isStalePushTripType({ type: 'trip_offer' }));
ok('tipo viaje: ride_demand_alert por tag', H.isStalePushTripType({ tag: 'ride-demand-abc' }));
ok('no es viaje: recurring_notify', !H.isStalePushTripType({ type: 'recurring_notify' }));
ok('no es viaje: new_trip_staff (staff)', !H.isStalePushTripType({ type: 'new_trip_staff' }));
ok('pendiente → disponible', H.pushTripAvailability({ status: 'pending' }, 'me').available);
ok('tomado por otro → no disponible', !H.pushTripAvailability({ status: 'accepted', driverId: 'otro' }, 'me').available);
ok('aceptado por mí → disponible', H.pushTripAvailability({ status: 'accepted', driverId: 'me' }, 'me').available);
ok('cancelado → no disponible', !H.pushTripAvailability({ status: 'cancelled' }, 'me').available);
ok('completado → no disponible', !H.pushTripAvailability({ status: 'completed', driverId: 'otro' }, 'me').available);
ok('borrado → no disponible', !H.pushTripAvailability(null, 'me').available);
const t = 'abc.def:APA91b_xyz';
ok('token en mapa (clave con _)', H.tokenInFcmMaps(t, { fcmTokens: { 'abc_def:APA91b_xyz': { token: t } } }));
ok('token en mapa privado', H.tokenInFcmMaps(t, null, { fcmTokens: { k: { token: t } } }));
ok('token legado fcmToken', H.tokenInFcmMaps(t, { fcmToken: t }));
ok('token borrado por el servidor → false', !H.tokenInFcmMaps(t, { fcmTokens: { otro: { token: 'otro' } } }, {}));
ok('sin token → false', !H.tokenInFcmMaps('', { fcmTokens: {} }));

// SW: notificationclick abre /?hrPushTrip=<id>#driver para viajes, nada extra para campañas
const sw = fs.readFileSync(path.join(ROOT, 'firebase-messaging-sw.js'), 'utf8');
function runSwClick(data) {
  const listeners = {}; let opened = null;
  const self = {
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
    registration: { scope: 'https://honduraite.com/', showNotification: async () => {} },
    clients: { matchAll: async () => [], openWindow: async (u) => { opened = u; }, claim: async () => {} },
    skipWaiting: () => {}, navigator: { userAgent: 'x' }
  };
  vm.runInNewContext(sw, { self, URL, Set, setTimeout, caches: {}, Request: function () {}, Response: function () {}, console });
  let p;
  listeners.notificationclick({ notification: { close() {}, data }, waitUntil: (x) => { p = x; } });
  return p.then(() => opened);
}
(async () => {
  const u1 = await runSwClick({ type: 'trip_offer', tripId: 'Z24r', tag: 'trip-offer-Z24r' });
  ok('SW: oferta abre con hrPushTrip y #driver', u1 === 'https://honduraite.com/?hrPushTrip=Z24r#driver', u1);
  const u2 = await runSwClick({ type: 'recurring_notify', tag: 'x' });
  ok('SW: campaña abre #notifications sin hrPushTrip', u2 === 'https://honduraite.com/#notifications', u2);
  const u3 = await runSwClick({ type: 'new_trip_staff', tripId: 'Z', openAdmin: true });
  ok('SW: staff sin hrPushTrip', !String(u3).includes('hrPushTrip'), u3);
  for (const r of res) console.log(...r);
  const all = res.every((r) => r[0] === 'PASS');
  console.log(all ? 'TODO OK' : 'HAY FALLOS');
  process.exit(all ? 0 : 1);
})();
