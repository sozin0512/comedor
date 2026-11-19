/**
 * La caché del cascarón se actualiza cuando cambia la versión y no se sirve para siempre.
 *   node scripts/test-shell-cache.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cache = require('../js/shell-cache.js');

const {
    shellCacheName,
    cachesToDelete,
    planFetch,
    handlePlannedFetch,
    purgeOldShellCaches,
} = cache;

const ORIGIN = 'https://comedor-86278.web.app';
const V_OLD = '2026.10.26.99';
const V_NEW = '2026.10.26.100';

function req(pathname, extra = {}) {
    return {
        url: ORIGIN + pathname,
        method: extra.method || 'GET',
        mode: extra.mode || 'same-origin',
        cache: extra.cache || 'default',
        headers: {
            get(name) {
                return extra.headers?.[String(name).toLowerCase()] || '';
            },
        },
    };
}

function fakeResponse(body, extra = {}) {
    const status = extra.status ?? 200;
    const res = {
        status,
        ok: status >= 200 && status < 300,
        type: extra.type || 'basic',
        redirected: !!extra.redirected,
        async text() { return String(body); },
        clone() { return fakeResponse(body, extra); },
    };
    return res;
}

function createMemoryCaches() {
    const stores = new Map();
    return {
        async keys() { return [...stores.keys()]; },
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const bucket = stores.get(name);
            return {
                async match(key) {
                    const hit = bucket.get(String(key));
                    return hit ? hit.clone() : undefined;
                },
                async put(key, value) {
                    bucket.set(String(key), value.clone());
                },
            };
        },
        async delete(name) {
            const had = stores.has(name);
            stores.delete(name);
            return had;
        },
    };
}

assert.equal(shellCacheName(V_NEW), 'hr-shell-' + V_NEW);
assert.deepEqual(
    cachesToDelete(
        ['hr-shell-' + V_OLD, 'hr-shell-' + V_NEW, 'hr-push-acks', 'otra-cache'],
        V_NEW
    ),
    ['hr-shell-' + V_OLD],
    'al cambiar la versión se borra la caché vieja y se conservan los acuses de push'
);

assert.equal(planFetch(req('/version.json?t=1'), ORIGIN).kind, 'passthrough', 'version.json no se cachea');
assert.equal(planFetch(req('/firebase-messaging-sw.js'), ORIGIN).kind, 'passthrough');
assert.equal(planFetch(req('/sw.js'), ORIGIN).kind, 'passthrough');
assert.equal(planFetch(req('/js/shell-cache.js'), ORIGIN).kind, 'passthrough');
assert.equal(planFetch(req('/js/app.js?v=' + V_NEW, { method: 'POST' }), ORIGIN).kind, 'passthrough');
assert.equal(
    planFetch({ url: 'https://maps.googleapis.com/maps/api/js?key=x', method: 'GET' }, ORIGIN).kind,
    'passthrough',
    'Maps y el resto de otros orígenes no pasan por esta caché'
);
assert.equal(
    planFetch(req('/taxi-aeropuerto-toncontin', { mode: 'navigate' }), ORIGIN).kind,
    'passthrough'
);

const jsPlan = planFetch(req('/js/app.js?v=' + V_NEW), ORIGIN);
assert.equal(jsPlan.kind, 'cache-first');
assert.deepEqual(jsPlan.storeAs, ['/js/app.js?v=' + V_NEW]);

const cssPlan = planFetch(req('/css/app.css?v=' + V_NEW), ORIGIN);
assert.equal(cssPlan.kind, 'cache-first');

const navPlan = planFetch(req('/', { mode: 'navigate' }), ORIGIN);
assert.equal(navPlan.kind, 'stale-while-revalidate');
assert.deepEqual(navPlan.storeAs, ['/', '/index.html']);

const refreshPlan = planFetch(req('/?hr_refresh=1&v=' + V_NEW, { mode: 'navigate' }), ORIGIN);
assert.equal(refreshPlan.kind, 'network-only-update', 'la recarga de actualización no lee la copia vieja');

const reloadPlan = planFetch(req('/index.html', { cache: 'reload' }), ORIGIN);
assert.equal(reloadPlan.kind, 'network-only-update');

const mem = createMemoryCaches();
const oldName = shellCacheName(V_OLD);
const oldCache = await mem.open(oldName);
await oldCache.put('/js/app.js?v=' + V_OLD, fakeResponse('JS_VIEJO'));
await oldCache.put('/', fakeResponse('HTML_VIEJO'));
await oldCache.put('/index.html', fakeResponse('HTML_VIEJO'));
const removed = await purgeOldShellCaches(mem, V_NEW);
assert.deepEqual(removed, [oldName]);
assert.equal(await (await mem.open(oldName)).match('/js/app.js?v=' + V_OLD), undefined, 'la caché vieja ya no existe');

const freshName = shellCacheName(V_NEW);
const fresh = await mem.open(freshName);
let fetches = 0;
const firstJs = await handlePlannedFetch(planFetch(req('/js/app.js?v=' + V_OLD), ORIGIN), {
    request: req('/js/app.js?v=' + V_OLD),
    cache: fresh,
    fetchImpl() {
        fetches += 1;
        return fakeResponse('JS_NUEVO');
    },
});
assert.equal(fetches, 1, 'después de borrar la caché vieja no se reutiliza el JS anterior');
assert.equal(await firstJs.response.text(), 'JS_NUEVO');

const secondJs = await handlePlannedFetch(planFetch(req('/js/app.js?v=' + V_OLD), ORIGIN), {
    request: req('/js/app.js?v=' + V_OLD),
    cache: fresh,
    fetchImpl() {
        fetches += 1;
        return fakeResponse('NO_DEBERIA');
    },
});
assert.equal(fetches, 1, 'la segunda apertura del mismo JS sale del teléfono');
assert.equal(await secondJs.response.text(), 'JS_NUEVO');

await fresh.put('/', fakeResponse('HTML_LENTO_VIEJO'));
await fresh.put('/index.html', fakeResponse('HTML_LENTO_VIEJO'));
let releaseNetwork;
const gate = new Promise((resolve) => { releaseNetwork = resolve; });
const slow = handlePlannedFetch(planFetch(req('/', { mode: 'navigate' }), ORIGIN), {
    request: req('/', { mode: 'navigate' }),
    cache: fresh,
    fetchImpl() { return gate.then(() => fakeResponse('HTML_NUEVO')); },
});
const slowResult = await slow;
assert.equal(await slowResult.response.text(), 'HTML_LENTO_VIEJO', 'con copia guardada la pantalla abre sin esperar la red');
releaseNetwork();
await slowResult.background;

const afterUpdate = await handlePlannedFetch(planFetch(req('/', { mode: 'navigate' }), ORIGIN), {
    request: req('/', { mode: 'navigate' }),
    cache: fresh,
    timeoutMs: 30,
    fetchImpl() { return Promise.reject(new Error('offline')); },
});
assert.equal(await afterUpdate.response.text(), 'HTML_NUEVO', 'cuando la red responde, la copia vieja deja de servirse');

const refreshed = await handlePlannedFetch(refreshPlan, {
    request: req('/?hr_refresh=1', { mode: 'navigate' }),
    cache: fresh,
    fetchImpl() { return fakeResponse('HTML_FORZADO'); },
});
assert.equal(await refreshed.response.text(), 'HTML_FORZADO');
assert.equal(await (await fresh.match('/')).text(), 'HTML_FORZADO');

const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
assert.equal(version, '2026.10.26.100', 'esta caché no sube el número público de la app');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'js', 'config.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'firebase-messaging-sw.js'), 'utf8');
assert.match(html, /name="hr-app-version" content="2026\.10\.26\.100"/);
assert.match(config, /appVersion:\s*'2026\.10\.26\.100'/);
assert.match(sw, /const HR_SW_VERSION = '2026\.10\.26\.100'/);
assert.match(sw, /importScripts\('\/js\/shell-cache\.js'\)/);
assert.match(sw, /purgeOldShellCaches/);
assert.match(html, /firebase-messaging-sw\.js/);
assert.match(html, /updateViaCache:\s*'none'/);

console.log('test-shell-cache: ok');
