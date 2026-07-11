import { APP_CONFIG } from './config.js';
import { isCapacitorNative } from './capacitor-native.js';

const VERSION_URL = '/version.json';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const IOS_CHECK_INTERVAL_MS = 60 * 1000;
const PENDING_VERSION_KEY = 'hr_pending_version';
const STALE_RETRY_KEY = 'hr_stale_reload_attempt';

let updateModalOpen = false;
let lastCheckAt = 0;
let reloadOnControllerChange = false;

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

function showAppUpdateModal({ remoteVersion, force = false, showIosHelp = false } = {}) {
    if (!force && (updateModalOpen || document.getElementById('app-update-modal'))) return;
    updateModalOpen = true;

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

    document.getElementById('app-update-confirm-btn')?.addEventListener('click', () => {
        const btn = document.getElementById('app-update-confirm-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando…';
        }
        window.applyAppUpdate?.();
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
    if (remoteVersion) url.searchParams.set('v', remoteVersion);
    url.searchParams.set('hr_refresh', String(Date.now()));
    return url.toString();
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
        location.replace(buildReloadUrl(localStorage.getItem(PENDING_VERSION_KEY)));
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

export async function applyAppUpdate({ auto = false } = {}) {
    dismissUpdateModal();
    reloadOnControllerChange = true;

    let remoteVersion = null;
    try {
        remoteVersion = await fetchLatestVersion();
        if (remoteVersion) {
            localStorage.setItem(PENDING_VERSION_KEY, remoteVersion);
        }
    } catch (_) {}

    await unregisterAllServiceWorkers();
    await clearAllCaches();
    await bustDocumentCache(remoteVersion);

    const target = buildReloadUrl(remoteVersion);

    if (isIOSDevice()) {
        try {
            location.assign(target);
        } catch (_) {
            location.href = target;
        }
        window.setTimeout(() => {
            try { location.reload(); } catch (_) {}
        }, 450);
        window.setTimeout(() => verifyPendingVersionAfterLoad(), 2800);
        return;
    }

    location.replace(target);
    window.setTimeout(() => verifyPendingVersionAfterLoad(), 2000);
}

export function initAppUpdateCheck() {
    if (typeof window === 'undefined') return;
    if (isCapacitorNative()) return;

    window.applyAppUpdate = applyAppUpdate;
    window.checkForAppUpdate = checkForAppUpdate;
    window.getBuildVersion = getBuildVersion;
    window.getMessagingSwUrl = getMessagingSwUrl;

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