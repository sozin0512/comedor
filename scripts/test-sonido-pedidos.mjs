/**
 * Melodía de «Pedido de tienda» para conductores (js/store-order-alert.js) en Chrome headless.
 * Uso: node scripts/test-sonido-pedidos.mjs   (puppeteer-core: PUPPETEER_DIR o /workspace/e2e-tools)
 * Verifica: suena en bucle con un pedido de tienda, no con un viaje normal ni para vehículos que no
 * entregan, se calla al aceptar / pasar / vencer / cancelar, y el desbloqueo de autoplay al primer toque.
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { serve, loadPuppeteer, CHROME } from './e2e-sonido-pedidos/server.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = `<!doctype html><button id="tap">tap</button><script type="module">
  if (location.search.includes('block=1')) {
    // Igual que Chrome/Safari en celular: play() sin gesto del usuario → NotAllowedError
    // (puppeteer evaluate cuenta como gesto: se usa un toque real isTrusted)
    window.__gesture = false;
    addEventListener('pointerdown', (e) => { if (e.isTrusted) window.__gesture = true; }, true);
    const real = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!window.__gesture) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      return real.call(this);
    };
  }
  import * as A from '/js/store-order-alert.js';
  window.A = A; A.bindStoreOrderAudioUnlock(document);
  window.vib = []; navigator.vibrate = (p) => { window.vib.push(p); return true; };
  window.audioOf = () => [...document.querySelectorAll('audio')][0] || window.__a;
  const Orig = window.Audio; window.Audio = function (src) { const a = new Orig(src); window.__a = a; return a; };
  window.ready = true;
</script>`;
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
const R = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { srv, url } = await serve(ROOT, { '/__sonido.html': page });
const puppeteer = await loadPuppeteer();
async function run(policyArgs, fn, q = '') {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', ...policyArgs] });
  try { const p = await browser.newPage(); await p.goto(`${url}/__sonido.html${q}`); await p.waitForFunction('window.ready'); await fn(p); }
  finally { await browser.close(); }
}
const st = (p) => p.evaluate(() => { const a = window.__a; return a ? { paused: a.paused, loop: a.loop, t: a.currentTime, src: a.src, ended: a.ended, playing: window.A.isStoreOrderAlertPlaying(), vib: window.vib.length } : { none: true, playing: window.A.isStoreOrderAlertPlaying() }; });
const store = (id, extra = {}) => ({ id, status: 'pending', serviceType: 'delivery', storeDelivery: true, createdByMerchant: true, ...extra });

ok('archivo sounds/nuevo-pedido.mp3 existe', fs.existsSync(path.join(ROOT, 'sounds/nuevo-pedido.mp3')));
ok('APK: res/raw/nuevo_pedido.mp3 existe', fs.existsSync(path.join(ROOT, 'android/app/src/main/res/raw/nuevo_pedido.mp3')));
const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
ok('app.js: sincroniza con las ofertas del conductor', /syncStoreOrderAlert\(lockTrip \? \[\] : myOffers/.test(app));
ok('app.js: se calla al aceptar', /window\.acceptTrip = async \(id, btnEl = null\) => \{\s*if \(!id \|\| !currentUser\) return;\s*try \{ markStoreOrderHandled\(id\)/.test(app));
ok('app.js: se calla al pasar', /window\.declineTripOffer = async \(tripId, btnEl = null\) => \{\s*if \(!tripId \|\| !currentUser\) return;\s*try \{ markStoreOrderHandled\(tripId\)/.test(app));

// 1) Con autoplay permitido (APK / PWA ya tocada)
await run(['--autoplay-policy=no-user-gesture-required', '--mute-audio'], async (p) => {
  await p.evaluate(() => A.syncStoreOrderAlert([{ id: 'n1', status: 'pending', serviceType: 'auto' }], { vehicleTypes: ['auto'] }));
  ok('viaje normal: no suena', !(await st(p)).playing);
  await p.evaluate(() => A.syncStoreOrderAlert([{ id: 's1', status: 'pending', serviceType: 'delivery', storeDelivery: true }], { vehicleTypes: ['paila'] }));
  ok('conductor de paila: no suena', !(await st(p)).playing);
  await p.evaluate((o) => A.syncStoreOrderAlert([o], { vehicleTypes: ['moto'] }), store('s1'));
  await sleep(2600);
  let s = await st(p);
  ok('moto + pedido de tienda: empieza a sonar', s.playing && !s.paused, JSON.stringify(s));
  ok('usa sounds/nuevo-pedido.mp3', /sounds\/nuevo-pedido\.mp3$/.test(s.src));
  ok('en bucle (loop=true, sigue sonando tras 2.6 s con un archivo de ~1.1 s)', s.loop && !s.paused && !s.ended, JSON.stringify(s));
  ok('vibra (repetido)', s.vib >= 2, `vib=${s.vib}`);
  await p.evaluate((o) => A.syncStoreOrderAlert([o], { vehicleTypes: ['moto'] }), store('s1'));
  ok('nuevo snapshot con el mismo pedido: sigue (no reinicia)', !(await st(p)).paused);
  await p.evaluate(() => A.markStoreOrderHandled('s1'));
  s = await st(p);
  ok('aceptar/pasar: se calla', !s.playing && s.paused && s.t === 0, JSON.stringify(s));
  await p.evaluate((o) => A.syncStoreOrderAlert([o], { vehicleTypes: ['moto'] }), store('s1'));
  ok('el pedido ya atendido no vuelve a sonar', !(await st(p)).playing);
  // pasar (rechazar) un pedido con otro aún pendiente
  await p.evaluate((a, b) => A.syncStoreOrderAlert([a, b], { vehicleTypes: ['auto'] }), store('s2'), store('s3', { storeOrderId: 'o3' }));
  await sleep(300);
  ok('Taxi VIP (auto) + 2 pedidos: suena', !(await st(p)).paused);
  await p.evaluate(() => A.markStoreOrderHandled('s2'));
  ok('pasa uno: sigue sonando por el otro', !(await st(p)).paused);
  await p.evaluate(() => A.markStoreOrderHandled('s3'));
  ok('pasa el otro: se calla', (await st(p)).paused);
  // vence / lo toma otro / cancelado = desaparece de la lista
  await p.evaluate((o) => A.syncStoreOrderAlert([o], { vehicleTypes: ['taxi'] }), store('s4'));
  await sleep(300);
  ok('taxi + pedido visible: suena', !(await st(p)).paused);
  await p.evaluate(() => A.syncStoreOrderAlert([], { vehicleTypes: ['taxi'] }));
  ok('venció / lo tomó otro / cancelado: se calla', (await st(p)).paused && !(await st(p)).playing);
  await p.evaluate((o) => A.syncStoreOrderAlert([o], { vehicleTypes: ['moto'] }), store('s5'));
  await sleep(200);
  await p.evaluate(() => A.stopStoreOrderAlert());
  ok('desconectarse (stop): se calla', (await st(p)).paused);
});

// 2) Política normal del navegador: sin toque no suena; al primer toque arranca sola
await run(['--autoplay-policy=document-user-activation-required'], async (p) => {
  await p.evaluate((o) => A.syncStoreOrderAlert([o], { vehicleTypes: ['moto'] }), store('w1'));
  await sleep(500);
  let s = await st(p);
  ok('sin toque previo: el navegador bloquea (queda pendiente)', s.playing && s.paused, JSON.stringify(s));
  await p.click('#tap');
  await sleep(1500);
  s = await st(p);
  ok('primer toque: desbloquea y suena en bucle', !s.paused && s.loop, JSON.stringify(s));
  await p.evaluate(() => A.markStoreOrderHandled('w1'));
  ok('aceptar: se calla', (await st(p)).paused);
  await p.evaluate((o) => A.syncStoreOrderAlert([o], { vehicleTypes: ['moto'] }), store('w2'));
  await sleep(400);
  ok('ya desbloqueado: el siguiente pedido suena sin tocar', !(await st(p)).paused);
}, '?block=1');
srv.close();
for (const r of res) console.log(r.join(' | '));
const fail = res.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${res.length - fail}/${res.length} PASS`);
process.exit(fail ? 1 : 0);
