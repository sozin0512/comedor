/**
 * Caché del cascarón (HTML, CSS y JS) para el service worker de HonduRaite.
 * Lo usa firebase-messaging-sw.js (el mismo SW de avisos; no hay un segundo sistema).
 *
 * - La primera apertura baja los archivos y los guarda en Cache Storage del teléfono.
 * - Las siguientes sirven JS/CSS al instante desde el aparato.
 * - El HTML guardado abre al instante y, en segundo plano, se reemplaza si el servidor responde.
 * - Una recarga con hr_refresh (o cache reload) no lee la copia vieja.
 * - version.json y el propio SW no se guardan: así se ve una versión nueva.
 * - Al cambiar HR_SW_VERSION se borra la caché vieja (hr-shell-*) y no se sigue sirviendo.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module && module.exports) {
        module.exports = api;
    }
    if (root) root.HrShellCache = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    const SHELL_CACHE_PREFIX = 'hr-shell-';

    function shellCacheName(version) {
        const v = String(version || '0').trim() || '0';
        return SHELL_CACHE_PREFIX + v;
    }

    /** Nombres hr-shell-* que ya no son la versión activa. No toca hr-push-acks. */
    function cachesToDelete(existingNames, version) {
        const keep = shellCacheName(version);
        return (existingNames || []).filter((name) =>
            typeof name === 'string' && name.indexOf(SHELL_CACHE_PREFIX) === 0 && name !== keep
        );
    }

    function wantsFresh(request, url) {
        try {
            if (url.searchParams.has('hr_refresh')) return true;
        } catch (_) {}
        const mode = request && request.cache ? String(request.cache) : '';
        return mode === 'no-store' || mode === 'reload';
    }

    function stableAssetKey(url) {
        const params = new URLSearchParams(url.search || '');
        params.delete('hr_refresh');
        params.delete('_');
        const q = params.toString();
        return url.pathname + (q ? '?' + q : '');
    }

    function headerGet(request, name) {
        try {
            if (request && request.headers && typeof request.headers.get === 'function') {
                return request.headers.get(name) || '';
            }
        } catch (_) {}
        return '';
    }

    /**
     * Decide qué hacer con una petición.
     * kind: passthrough | cache-first | stale-while-revalidate | network-only-update
     */
    function planFetch(request, origin) {
        const method = String((request && request.method) || 'GET').toUpperCase();
        if (method !== 'GET') return { kind: 'passthrough' };

        let url;
        try {
            url = new URL(request.url, origin || undefined);
        } catch (_) {
            return { kind: 'passthrough' };
        }
        if (origin && url.origin !== origin) return { kind: 'passthrough' };
        if (headerGet(request, 'range')) return { kind: 'passthrough' };

        const path = url.pathname || '/';
        // Nunca guardar el manifiesto de versión ni el script del SW: si no, la app se queda vieja.
        if (
            path === '/version.json'
            || path === '/firebase-messaging-sw.js'
            || path === '/sw.js'
            || path === '/js/shell-cache.js'
        ) {
            return { kind: 'passthrough' };
        }

        const fresh = wantsFresh(request, url);
        const isDoc = path === '/' || path === '/index.html';
        if (request && request.mode === 'navigate' && !isDoc) return { kind: 'passthrough' };
        if (isDoc) {
            return {
                kind: fresh ? 'network-only-update' : 'stale-while-revalidate',
                storeAs: ['/', '/index.html']
            };
        }

        const isCode = (path.indexOf('/js/') === 0 && path.endsWith('.js'))
            || (path.indexOf('/css/') === 0 && path.endsWith('.css'));
        const isBootLogo = path === '/icons/splash-logo.webp';
        if (!isCode && !isBootLogo) return { kind: 'passthrough' };

        const key = isBootLogo ? path : stableAssetKey(url);
        if (fresh) return { kind: 'network-only-update', storeAs: [key] };
        return { kind: 'cache-first', storeAs: [key] };
    }

    function isCacheableResponse(res) {
        if (!res || res.status !== 200 || res.ok === false || res.redirected) return false;
        const type = res.type || 'basic';
        if (type === 'opaque' || type === 'opaqueredirect' || type === 'error') return false;
        return true;
    }

    async function matchFirst(cache, keys) {
        for (let i = 0; i < keys.length; i++) {
            const hit = await cache.match(keys[i]);
            if (hit) return hit;
        }
        return null;
    }

    async function putAll(cache, keys, response) {
        const seen = Object.create(null);
        const jobs = [];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!key || seen[key]) continue;
            seen[key] = true;
            try {
                jobs.push(cache.put(key, response.clone()));
            } catch (_) {}
        }
        try {
            await Promise.all(jobs);
        } catch (_) {}
    }

    async function cacheFirst(ctx, storeAs) {
        const cached = await matchFirst(ctx.cache, storeAs);
        if (cached) return { response: cached, background: null };
        const res = await ctx.fetchImpl(ctx.request);
        if (isCacheableResponse(res)) await putAll(ctx.cache, storeAs, res);
        return { response: res, background: null };
    }

    async function networkOnlyUpdate(ctx, storeAs) {
        try {
            const res = await ctx.fetchImpl(ctx.request);
            if (isCacheableResponse(res)) await putAll(ctx.cache, storeAs, res);
            return { response: res, background: null };
        } catch (error) {
            const cached = await matchFirst(ctx.cache, storeAs);
            if (cached) return { response: cached, background: null };
            throw error;
        }
    }

    function revalidate(ctx, storeAs) {
        return Promise.resolve()
            .then(() => ctx.fetchImpl(ctx.request))
            .then(async (res) => {
                if (isCacheableResponse(res)) await putAll(ctx.cache, storeAs, res);
                return res;
            })
            .catch(() => null);
    }

    async function staleWhileRevalidate(ctx, storeAs) {
        const cached = await matchFirst(ctx.cache, storeAs);
        if (cached) {
            return { response: cached, background: revalidate(ctx, storeAs) };
        }
        try {
            const res = await ctx.fetchImpl(ctx.request);
            if (isCacheableResponse(res)) await putAll(ctx.cache, storeAs, res);
            return { response: res, background: null };
        } catch (error) {
            throw error;
        }
    }

    async function handlePlannedFetch(plan, ctx) {
        if (!plan || plan.kind === 'passthrough') return null;
        const storeAs = plan.storeAs || [];
        if (plan.kind === 'cache-first') return cacheFirst(ctx, storeAs);
        if (plan.kind === 'network-only-update') return networkOnlyUpdate(ctx, storeAs);
        if (plan.kind === 'stale-while-revalidate') return staleWhileRevalidate(ctx, storeAs);
        return null;
    }

    async function purgeOldShellCaches(cacheStorage, version) {
        const names = await cacheStorage.keys();
        const doomed = cachesToDelete(names, version);
        await Promise.all(doomed.map((name) => cacheStorage.delete(name)));
        return doomed;
    }

    return {
        SHELL_CACHE_PREFIX,
        shellCacheName,
        cachesToDelete,
        planFetch,
        isCacheableResponse,
        handlePlannedFetch,
        purgeOldShellCaches
    };
});
