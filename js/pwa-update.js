import { APP_CONFIG } from './config.js';
import { isCapacitorNative } from './capacitor-native.js';

const VERSION_URL = '/version.json';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const IOS_CHECK_INTERVAL_MS = 60 * 1000;
const PENDING_VERSION_KEY = 'hr_pending_version';
const STALE_RETRY_KEY = 'hr_stale_reload_attempt';
/** Si SW/caché se cuelgan, forzar recarga igual (evita botón “Actualizando…” eterno). */
const PRE_RELOAD_TIMEOUT_MS = 2500;
const HARD_RELOAD_FALLBACK_MS = 1200;

let updateModalOpen = false;
let lastCheckAt = 0;
let reloadOnControllerChange = false;
let applyInFlight = false;

export function getBuildVersion() {
    const meta = document.querySelector('meta[name="hr-app-version"]')?.content?.trim();
    if (meta) return meta;
    if (window.__HR_BUILD_VERSION__) return String(window.__HR_BUILD_VERSION__).trim();
    return String(APP_CONFIG.appVersion || '0').trim();
}

export function getMessagingSwUrl(baseUrl = import.meta.url) {
    const v = encodeURIComponent(getBuildVersion());
    return new URL(`../firebase-messaging-sw.js?v=${v}`, baseUrl);
}

function isIOSDevice() {
    return /iPad|iPhone|iPod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalonePwa() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

function getCheckInterval() {
    return (isIOSDevice() || isStandalonePwa()) ? IOS_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS;
}

function dismissUpdateModal() {
    updateModalOpen = false;
    document.getElementById('app-update-modal')?.remove();
}

function versionsDiffer(running, remote) {
    if (!remote || !running) return false;
    return String(running).trim() !== String(remote).trim();
}

function withTimeout(promise, ms, label = 'timeout') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(label)), ms);
    });
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        timeout
    ]);
}

async function fetchLatestVersion() {
    const url = new URL(VERSION_URL, location.origin);
    url.searchParams.set('t', String(Date.now()));
    const res = await fetch(url.href, {
        cache: 'no-store',
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache'
        }
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.version || null;
}

function iosHelpBlock() {
    if (!isIOSDevice()) return '';
    return `
        <div class="app-update-ios-help">
            <p class="app-update-ios-help-title"><i class="fab fa-apple"></i> Si en iPhone no se actualiza</p>
            <ol class="app-update-ios-help-list">
                <li>Toca <strong>Actualizar ahora</strong> otra vez.</li>
                <li>Cierra HonduRaite desde el multitarea (desliza hacia arriba).</li>
                <li>Vuelve a abrir el ícono en la pantalla de inicio.</li>
            </ol>
        </div>
    `;
}

function setConfirmButtonLoading(loading) {
    const btn = document.getElementById('app-update-confirm-btn');
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando…';
    } else {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.innerHTML = 'Actualizar ahora';
    }
}

function showAppUpdateModal({ remoteVersion, force = false, showIosHelp = false } = {}) {
    if (!force && (updateModalOpen || document.getElementById('app-update-modal'))) return;
    // Si quedó un modal viejo colgado, reemplazarlo
    document.getElementById('app-update-modal')?.remove();
    updateModalOpen = true;
    applyInFlight = false;

    const running = getBuildVersion();
    const overlay = document.createElement('div');
    overlay.id = 'app-update-modal';
    overlay.className = 'app-update-modal-overlay';
    overlay.innerHTML = `
        <div class="app-update-modal-sheet" role="dialog" aria-labelledby="app-update-title" aria-modal="true">
            <div class="app-update-modal-icon">
                <i class="fas fa-sync-alt"></i>
            </div>
            <h2 id="app-update-title" class="app-update-modal-title">Nueva versión disponible</h2>
            <p class="app-update-modal-text">
                Hay una actualización de HonduRaite. Toca <strong>Actualizar ahora</strong> para cargar los cambios más recientes.
            </p>
            <p class="app-update-modal-meta">Instalada: ${running}${remoteVersion ? ` · Disponible: ${remoteVersion}` : ''}</p>
            ${showIosHelp || isIOSDevice() ? iosHelpBlock() : ''}
            <button type="button" id="app-update-confirm-btn" class="app-update-modal-btn">
                Actualizar ahora
            </button>
        </div>
    `;

    document.body.appendChild(overlay);

    const confirmBtn = document.getElementById('app-update-confirm-btn');
    confirmBtn?.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (applyInFlight) return;
        setConfirmButtonLoading(true);
        // Llamar la función del módulo (no window) + fallback duro si se cuelga
        const hardFallback = window.setTimeout(() => {
            try {
                hardReload(remoteVersion || localStorage.getItem(PENDING_VERSION_KEY));
            } catch (_) {
                try { location.reload(); } catch (__) {}
            }
        }, PRE_RELOAD_TIMEOUT_MS + HARD_RELOAD_FALLBACK_MS + 800);

        Promise.resolve(applyAppUpdate({ fromButton: true }))
            .catch((err) => {
                console.warn('[pwa-update] applyAppUpdate failed', err);
                hardReload(remoteVersion);
            })
            .finally(() => {
                clearTimeout(hardFallback);
            });
    });
}

async function unregisterAllServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
}

async function clearAllCaches() {
    if (!('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
}

async function bustDocumentCache(version) {
    const stamp = version || String(Date.now());
    const targets = [
        '/',
        '/index.html',
        `/index.html?v=${encodeURIComponent(stamp)}`,
        `/version.json?t=${Date.now()}`
    ];
    await Promise.all(targets.map(async (path) => {
        try {
            await fetch(new URL(path, location.origin).href, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    Pragma: 'no-cache'
                }
            });
        } catch (_) {}
    }));
}

function buildReloadUrl(remoteVersion) {
    const url = new URL(location.href);
    url.hash = '';
    // Quitar stamps viejos para no acumular query basura
    url.searchParams.delete('hr_refresh');
    if (remoteVersion) url.searchParams.set('v', remoteVersion);
    else url.searchParams.delete('v');
    url.searchParams.set('hr_refresh', String(Date.now()));
    return url.toString();
}

/** Recarga forzada con varios fallbacks (PWA / iOS / Android WebView). */
function hardReload(remoteVersion) {
    const target = buildReloadUrl(remoteVersion);
    try {
        // Intento principal: navegación limpia con cache bust
        location.replace(target);
    } catch (_) {
        try { location.href = target; } catch (__) {}
    }
    // Si replace no navega (algunos WebViews / same-document quirks)
    window.setTimeout(() => {
        try {
            if (location.href !== target) location.assign(target);
        } catch (_) {}
    }, 200);
    window.setTimeout(() => {
        try { location.reload(); } catch (_) {}
    }, HARD_RELOAD_FALLBACK_MS);
}

async function prepareUpdateAssets(remoteVersion) {
    // Nunca bloquear el reload más de PRE_RELOAD_TIMEOUT_MS
    await withTimeout((async () => {
        try {
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const reg of regs) {
                    try { reg.waiting?.postMessage?.({ type: 'SKIP_WAITING' }); } catch (_) {}
                    try { reg.active?.postMessage?.({ type: 'SKIP_WAITING' }); } catch (_) {}
                }
            }
        } catch (_) {}
        try { await unregisterAllServiceWorkers(); } catch (_) {}
        try { await clearAllCaches(); } catch (_) {}
        try { await bustDocumentCache(remoteVersion); } catch (_) {}
    })(), PRE_RELOAD_TIMEOUT_MS, 'pre-reload-timeout').catch(() => {});
}

async function checkForAppUpdate({ force = false } = {}) {
    const now = Date.now();
    const interval = getCheckInterval();
    if (!force && now - lastCheckAt < interval) return false;
    lastCheckAt = now;

    try {
        const remoteVersion = await fetchLatestVersion();
        if (!remoteVersion) return false;

        const running = getBuildVersion();
        if (!versionsDiffer(running, remoteVersion)) {
            localStorage.removeItem(PENDING_VERSION_KEY);
            localStorage.removeItem(STALE_RETRY_KEY);
            dismissUpdateModal();
            return false;
        }

        showAppUpdateModal({
            remoteVersion,
            force,
            showIosHelp: isIOSDevice() && !!localStorage.getItem(PENDING_VERSION_KEY)
        });
        return true;
    } catch (_) {
        return false;
    }
}

function verifyPendingVersionAfterLoad() {
    const pending = localStorage.getItem(PENDING_VERSION_KEY);
    if (!pending) return;

    const running = getBuildVersion();
    if (!versionsDiffer(running, pending)) {
        localStorage.removeItem(PENDING_VERSION_KEY);
        localStorage.removeItem(STALE_RETRY_KEY);
        dismissUpdateModal();
        return;
    }

    const retries = parseInt(localStorage.getItem(STALE_RETRY_KEY) || '0', 10);
    if (retries < 1) {
        localStorage.setItem(STALE_RETRY_KEY, String(retries + 1));
        window.setTimeout(() => applyAppUpdate({ auto: true }), 1200);
        return;
    }

    showAppUpdateModal({
        remoteVersion: pending,
        force: true,
        showIosHelp: true
    });
}

function bindServiceWorkerUpdateFlow() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloadOnControllerChange) return;
        reloadOnControllerChange = false;
        hardReload(localStorage.getItem(PENDING_VERSION_KEY));
    });

    navigator.serviceWorker.ready.then((reg) => {
        reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
                if (installing.state !== 'installed') return;
                if (!navigator.serviceWorker.controller) return;
                checkForAppUpdate({ force: true });
            });
        });
        reg.update().catch(() => {});
    }).catch(() => {});

    if ('serviceWorker' in navigator) {
        window.setInterval(() => {
            navigator.serviceWorker.ready.then((reg) => reg.update()).catch(() => {});
        }, isIOSDevice() ? IOS_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS);
    }
}

export async function applyAppUpdate({ auto = false, fromButton = false } = {}) {
    if (applyInFlight) return;
    applyInFlight = true;
    reloadOnControllerChange = true;

    let remoteVersion = null;
    try {
        remoteVersion = await withTimeout(fetchLatestVersion(), 2000, 'version-fetch').catch(() => null);
        if (remoteVersion) {
            localStorage.setItem(PENDING_VERSION_KEY, remoteVersion);
        } else {
            remoteVersion = localStorage.getItem(PENDING_VERSION_KEY);
        }
    } catch (_) {
        remoteVersion = localStorage.getItem(PENDING_VERSION_KEY);
    }

    // Limpiar SW/caché con tope de tiempo; luego SIEMPRE recargar
    await prepareUpdateAssets(remoteVersion);

    // Quitar modal solo justo antes de navegar (así el spinner no se queda “muerto” si algo falla antes)
    dismissUpdateModal();

    hardReload(remoteVersion);

    // Si la navegación no ocurrió, reintentar verificación (y re-mostrar modal si sigue stale)
    window.setTimeout(() => {
        applyInFlight = false;
        try { verifyPendingVersionAfterLoad(); } catch (_) {}
    }, isIOSDevice() ? 2800 : 2200);
}

export function initAppUpdateCheck() {
    if (typeof window === 'undefined') return;

    // Siempre exponer applyAppUpdate (también en Capacitor por si se usa WebView con version.json remoto)
    window.applyAppUpdate = applyAppUpdate;
    window.checkForAppUpdate = checkForAppUpdate;
    window.getBuildVersion = getBuildVersion;
    window.getMessagingSwUrl = getMessagingSwUrl;

    // App nativa empaqueta assets: el update de web/PWA no aplica
    if (isCapacitorNative()) return;

    bindServiceWorkerUpdateFlow();

    window.setTimeout(() => checkForAppUpdate({ force: true }), 1800);
    window.setTimeout(() => verifyPendingVersionAfterLoad(), 3200);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkForAppUpdate({ force: true });
    });

    window.addEventListener('focus', () => checkForAppUpdate({ force: true }));

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            checkForAppUpdate({ force: true });
            verifyPendingVersionAfterLoad();
        }
    });
}
