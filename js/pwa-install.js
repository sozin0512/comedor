import { isCapacitorNative } from './capacitor-native.js';

let deferredInstallPrompt = null;
let nativeInstallUiHidden = false;

function notifyInstallReady() {
    if (typeof window === 'undefined') return;
    if (isPwaInstalled()) return;
    window.dispatchEvent(new CustomEvent('honduber-install-ready'));
    refreshInstallHomeUi();
}

export function hideInstallUiForNativeApp() {
    if (!isCapacitorNative() || nativeInstallUiHidden) return;
    nativeInstallUiHidden = true;

    [
        'btn-native-install',
        'ios-install-banner',
        'hr-install-home-card',
        'hr-install-banner',
        'install-reminder-banner',
        'install-reminder-banner-driver',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            if (id !== 'hr-install-home-card') el.innerHTML = '';
        }
    });

    document.querySelectorAll('[data-header-menu-action="install"]').forEach((el) => {
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
    });

    document.querySelectorAll('button[onclick*="showInstallFlow"]').forEach((btn) => {
        btn.classList.add('hidden');
        btn.setAttribute('aria-hidden', 'true');
    });

    document.documentElement.classList.add('native-app');
}

let pendingUserInstallClick = false;

if (typeof window !== 'undefined' && !isCapacitorNative()) {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        notifyInstallReady();
        refreshInstallHomeUi();
        if (pendingUserInstallClick) {
            pendingUserInstallClick = false;
            triggerNativeInstall().catch(() => {});
        }
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        pendingUserInstallClick = false;
        try { localStorage.setItem('honduber_pwa_installed', '1'); } catch (_) {}
        markPwaInstalledClass(true);
        refreshInstallHomeUi();
        window.showToast?.('HonduRaite quedó en tu pantalla de inicio. Ábrela desde el icono.', 'success');
    });
}

function isStandaloneDisplay() {
    if (typeof window === 'undefined') return false;
    try {
        if (window.navigator.standalone === true) return true;
    } catch (_) {}
    try {
        if (window.matchMedia('(display-mode: standalone)').matches) return true;
        if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
        if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (_) {}
    return false;
}

function persistInstalledFlag() {
    try { localStorage.setItem('honduber_pwa_installed', '1'); } catch (_) {}
}

export function isPwaInstalled() {
    if (typeof window === 'undefined') return true;
    if (isCapacitorNative()) {
        persistInstalledFlag();
        return true;
    }
    if (isStandaloneDisplay()) {
        persistInstalledFlag();
        return true;
    }
    try {
        if (document.referrer.includes('android-app://')) {
            persistInstalledFlag();
            return true;
        }
    } catch (_) {}
    try {
        if (localStorage.getItem('honduber_pwa_installed') === '1') return true;
    } catch (_) {}
    return false;
}

export function isIOS() {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return true;
    // iPadOS 13+ a veces se reporta como Mac
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

/** PWA abierta desde el icono de inicio (único contexto iOS con push en background). */
export function isIosStandalonePwa() {
    return isIOS() && isStandaloneDisplay();
}

function iosVersionParts() {
    const ua = navigator.userAgent || '';
    const m = ua.match(/OS (\d+)[._](\d+)/);
    return {
        major: m ? parseInt(m[1], 10) : 0,
        minor: m ? parseInt(m[2], 10) : 0
    };
}

/**
 * En iPhone/iPad, Web Push fuera de la app SOLO funciona:
 * iOS 16.4+ y HonduRaite abierto desde "Agregar a pantalla de inicio".
 * Una pestaña de Safari no recibe viajes si cierras Safari o te desconectas.
 */
export function canReceiveBackgroundWebPush() {
    if (typeof window === 'undefined') return false;
    if (isCapacitorNative()) return true;
    if (!isIOS()) return 'Notification' in window && 'serviceWorker' in navigator;
    if (!isStandaloneDisplay()) return false;
    const { major, minor } = iosVersionParts();
    if (major && (major < 16 || (major === 16 && minor < 4))) return false;
    return true;
}

export function isIOSSafari() {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (!isIOS()) return false;
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/i.test(ua);
}

/** Chrome/Firefox/Edge en iPhone: NO tienen Web Push. Solo Safari → Agregar a pantalla de inicio. */
export function isIosNonSafariBrowser() {
    if (!isIOS()) return false;
    const ua = navigator.userAgent || '';
    return /CriOS|FxiOS|EdgiOS/i.test(ua);
}

export function canTriggerNativeInstall() {
    if (isCapacitorNative() || isPwaInstalled()) return false;
    return !!deferredInstallPrompt;
}

export async function triggerNativeInstall() {
    if (!deferredInstallPrompt) return false;
    try {
        await deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (outcome === 'accepted') {
            try { localStorage.setItem('honduber_pwa_installed', '1'); } catch (_) {}
            markPwaInstalledClass(true);
            refreshInstallHomeUi();
            return true;
        }
        refreshInstallHomeUi();
    } catch (_) {
        deferredInstallPrompt = null;
    }
    return false;
}

/** Intenta el diálogo nativo de instalación (Chrome/Edge Android). */
export async function tryNativeInstall() {
    if (isPwaInstalled() || !canTriggerNativeInstall()) return false;
    return triggerNativeInstall();
}

/**
 * Recuerda instalar la PWA antes de pedir/aceptar viajes si aún no está instalada.
 * @param {'passenger_request'|'driver_accept'} context
 */
function installBannerHtml(roleLabel) {
    const oneTap = canTriggerNativeInstall();
    return `
        <div class="mx-1 mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-left">
            <p class="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-1">
                <i class="fas fa-mobile-alt"></i> Instala HonduRaite
            </p>
            <p class="text-xs text-amber-900 leading-snug mb-2">Como ${roleLabel}, ponla en la pantalla de inicio para que los viajes te lleguen aunque cierres el navegador.</p>
            <button type="button" onclick="window.showInstallFlow()" class="w-full mt-1 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-black uppercase">
                ${oneTap ? 'Instalar con un toque' : 'Instalar en pantalla de inicio'}
            </button>
        </div>
    `;
}

export function renderInstallReminderBanner(context = null) {
    if (isCapacitorNative() || isPwaInstalled()) {
        ['install-reminder-banner', 'install-reminder-banner-driver'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('hidden');
                el.innerHTML = '';
            }
        });
        return;
    }
    const banners = [
        document.getElementById('install-reminder-banner'),
        document.getElementById('install-reminder-banner-driver')
    ].filter(Boolean);

    if (!banners.length) return;

    const roleLabel = context === 'driver_accept' ? 'conductor' : 'pasajero';
    const html = installBannerHtml(roleLabel);

    banners.forEach((banner) => {
        const isDriverBanner = banner.id === 'install-reminder-banner-driver';
        const isPassengerBanner = banner.id === 'install-reminder-banner';
        const show = !context
            || (context === 'driver_accept' && isDriverBanner)
            || (context === 'passenger_request' && isPassengerBanner);

        if (!show) return;
        banner.classList.remove('hidden');
        banner.innerHTML = html;
    });
}

export function remindInstallIfNeeded(context) {
    if (isCapacitorNative() || isPwaInstalled()) return false;

    const roleLabel = context === 'driver_accept' ? 'conductor' : 'pasajero';
    renderInstallReminderBanner(context);

    window.showToast?.(
        `Como ${roleLabel}: instala HonduRaite en tu pantalla de inicio y activa notificaciones para no perder mensajes del viaje.`,
        'warning'
    );

    setTimeout(async () => {
        if (isIOS() && !window.matchMedia('(display-mode: standalone)').matches) {
            // On iOS we can't trigger native install — show the easy step-by-step guide immediately
            window.showInstallGuide?.();
        } else if (canTriggerNativeInstall()) {
            const ok = await triggerNativeInstall().catch(() => false);
            if (!ok) window.showInstallGuide?.();
        } else {
            window.showInstallGuide?.();
        }
    }, 500);

    return true;
}

const A2HS_OVERLAY_ID = 'hr-a2hs-overlay';
const IOS_SHARE_ICON = `<svg class="hr-a2hs__share-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c.4 0 .75.35.75.75v9.04l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0L7.72 10.88a.75.75 0 0 1 1.06-1.06l2.47 2.47V3.25c0-.4.35-.75.75-.75zM6.5 13.5a.75.75 0 0 1 .75.75v4.5c0 .14.11.25.25.25h9c.14 0 .25-.11.25-.25v-4.5a.75.75 0 0 1 1.5 0v4.5A1.75 1.75 0 0 1 16.5 21h-9A1.75 1.75 0 0 1 5.75 19.25v-4.5a.75.75 0 0 1 .75-.75z"/></svg>`;

function isIPadDevice() {
    if (!isIOS()) return false;
    const ua = navigator.userAgent || '';
    if (/iPad/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

function closeA2hsOverlay() {
    document.getElementById(A2HS_OVERLAY_ID)?.remove();
}

function showIosAddToHomeOverlay() {
    closeA2hsOverlay();
    const ipad = isIPadDevice();
    const overlay = document.createElement('div');
    overlay.id = A2HS_OVERLAY_ID;
    overlay.className = `hr-a2hs${ipad ? ' hr-a2hs--top' : ''}`;
    overlay.innerHTML = `
        <div class="hr-a2hs__sheet">
            <button type="button" class="hr-a2hs__close" aria-label="Cerrar">×</button>
            <p class="hr-a2hs__kicker"><i class="fab fa-apple"></i> iPhone / iPad</p>
            <h2 class="hr-a2hs__title">Instalar en pantalla de inicio</h2>
            <p class="hr-a2hs__lead">Toca <b>Compartir</b> ${ipad ? 'arriba' : 'abajo'} y luego <b>Agregar a pantalla de inicio</b>.</p>
            <ol class="hr-a2hs__steps">
                <li><span>1</span> Toca el botón ${IOS_SHARE_ICON} <b>Compartir</b></li>
                <li><span>2</span> Toca <b>Agregar a pantalla de inicio</b></li>
                <li><span>3</span> Toca <b>Agregar</b> y ábrela desde el icono</li>
            </ol>
            <p class="hr-a2hs__hint">Si estás en Chrome, abre honduraite.com en <b>Safari</b> para que te lleguen los avisos de viaje.</p>
        </div>
        <div class="hr-a2hs__arrow" aria-hidden="true">
            <div class="hr-a2hs__share-bubble">${IOS_SHARE_ICON}</div>
            <div class="hr-a2hs__chevron">${ipad ? '↑' : '↓'}</div>
        </div>
    `;
    overlay.querySelector('.hr-a2hs__close')?.addEventListener('click', closeA2hsOverlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeA2hsOverlay();
    });
    document.body.appendChild(overlay);
}

function showChromeAddToHomeOverlay() {
    closeA2hsOverlay();
    const overlay = document.createElement('div');
    overlay.id = A2HS_OVERLAY_ID;
    overlay.className = 'hr-a2hs hr-a2hs--chrome';
    overlay.innerHTML = `
        <div class="hr-a2hs__sheet">
            <button type="button" class="hr-a2hs__close" aria-label="Cerrar">×</button>
            <p class="hr-a2hs__kicker"><i class="fab fa-chrome"></i> Chrome</p>
            <h2 class="hr-a2hs__title">Instalar en pantalla de inicio</h2>
            <p class="hr-a2hs__lead">Toca el menú <b>⋮</b> arriba a la derecha y elige <b>Instalar app</b>.</p>
            <ol class="hr-a2hs__steps">
                <li><span>1</span> Toca <b>⋮</b> (arriba derecha)</li>
                <li><span>2</span> Toca <b>Instalar app</b> o <b>Agregar a la pantalla de inicio</b></li>
                <li><span>3</span> Confirma con <b>Instalar</b></li>
            </ol>
        </div>
        <div class="hr-a2hs__arrow hr-a2hs__arrow--chrome" aria-hidden="true">
            <div class="hr-a2hs__share-bubble">⋮</div>
            <div class="hr-a2hs__chevron">↑</div>
        </div>
    `;
    overlay.querySelector('.hr-a2hs__close')?.addEventListener('click', closeA2hsOverlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeA2hsOverlay();
    });
    document.body.appendChild(overlay);
}

/** Guía / overlay. Chrome usa el diálogo nativo desde showInstallFlow. */
export function showInstallGuide() {
    if (typeof document === 'undefined' || isCapacitorNative() || isPwaInstalled()) return;
    if (isIOS()) {
        showIosAddToHomeOverlay();
        return;
    }
    showChromeAddToHomeOverlay();
}

/** Un toque: Chrome instala nativo; Safari abre la guía pegada a Compartir. */
export async function showInstallFlow() {
    if (isCapacitorNative() || isPwaInstalled()) return;
    if (canTriggerNativeInstall()) {
        const installed = await tryNativeInstall();
        if (installed) return;
    }
    if (isIOS()) {
        showIosAddToHomeOverlay();
        return;
    }
    pendingUserInstallClick = true;
    window.setTimeout(() => {
        if (!pendingUserInstallClick) return;
        pendingUserInstallClick = false;
        if (canTriggerNativeInstall()) {
            triggerNativeInstall().catch(() => showChromeAddToHomeOverlay());
            return;
        }
        showChromeAddToHomeOverlay();
    }, 350);
}

function markPwaInstalledClass(on) {
    try {
        document.documentElement.classList.toggle('hr-pwa-installed', !!on);
    } catch (_) {}
}

function refreshInstallHomeUi() {
    if (typeof document === 'undefined') return;
    const installed = isPwaInstalled();
    markPwaInstalledClass(installed);
    if (installed) closeA2hsOverlay();
    const oneTap = !installed && canTriggerNativeInstall();
    const label = oneTap ? 'Instalar con un toque' : 'Instalar';
    const sub = isIOS()
        ? 'Safari: Compartir → Agregar a pantalla de inicio'
        : (oneTap ? 'Un toque y queda como app' : 'Chrome: menú ⋮ → Instalar app');

    const card = document.getElementById('hr-install-home-card');
    if (card) {
        card.classList.toggle('hidden', installed);
        const btn = card.querySelector('[data-hr-install-btn]');
        const subEl = card.querySelector('[data-hr-install-sub]');
        if (btn) btn.textContent = label;
        if (subEl) subEl.textContent = sub;
    }

    const banner = document.getElementById('ios-install-banner');
    if (banner) {
        const searching = document.body.classList.contains('is-searching');
        const dismissed = (() => {
            try {
                if (sessionStorage.getItem('hrInstallBannerDismissed') === '1' || sessionStorage.getItem('iosInstallBannerDismissed') === '1') return true;
                // Cerrado hace menos de 7 días: no volver a tapar el panel en cada visita.
                const at = Number(localStorage.getItem('hrInstallBannerDismissedAt') || 0);
                return at > 0 && Date.now() - at < 7 * 24 * 3600 * 1000;
            } catch (_) { return false; }
        })();
        const show = !installed && !searching && !dismissed;
        banner.classList.toggle('hidden', !show);
        const bBtn = banner.querySelector('#ios-install-btn, [data-hr-install-btn]');
        if (bBtn) bBtn.textContent = oneTap ? 'INSTALAR' : 'INSTALAR';
    }

    document.getElementById('btn-native-install')?.classList.toggle('hidden', true);

    document.querySelectorAll('[data-header-menu-action="install"]').forEach((el) => {
        el.classList.toggle('hidden', installed);
        el.setAttribute('aria-hidden', installed ? 'true' : 'false');
    });

    document.querySelectorAll('[data-hr-install-btn]').forEach((el) => {
        if (el.id === 'ios-install-btn' || el.closest('#hr-install-home-card')) return;
        el.classList.toggle('hidden', installed);
    });
}

let installHomeUiInitialized = false;

export function initInstallHomeUi() {
    if (typeof window === 'undefined' || installHomeUiInitialized || isCapacitorNative()) {
        if (isCapacitorNative()) hideInstallUiForNativeApp();
        return;
    }
    installHomeUiInitialized = true;
    refreshInstallHomeUi();
    if (typeof navigator !== 'undefined' && typeof navigator.getInstalledRelatedApps === 'function') {
        navigator.getInstalledRelatedApps().then((apps) => {
            if (Array.isArray(apps) && apps.length) {
                persistInstalledFlag();
                refreshInstallHomeUi();
            }
        }).catch(() => {});
    }

    document.querySelectorAll('[data-hr-install-btn], #hr-install-home-btn, #ios-install-btn').forEach((btn) => {
        if (btn.dataset.hrInstallBound === '1') return;
        btn.dataset.hrInstallBound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            showInstallFlow();
        });
    });

    const closeBtn = document.getElementById('ios-install-close');
    if (closeBtn && closeBtn.dataset.hrInstallBound !== '1') {
        closeBtn.dataset.hrInstallBound = '1';
        closeBtn.addEventListener('click', () => {
            document.getElementById('ios-install-banner')?.classList.add('hidden');
            try {
                sessionStorage.setItem('hrInstallBannerDismissed', '1');
                sessionStorage.setItem('iosInstallBannerDismissed', '1');
                localStorage.setItem('hrInstallBannerDismissedAt', String(Date.now()));
            } catch (_) {}
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshInstallHomeUi();
    });
    window.addEventListener('pageshow', refreshInstallHomeUi);
    window.addEventListener('honduber-install-ready', refreshInstallHomeUi);
    window.refreshIOSInstallBanner = refreshInstallHomeUi;
    window.refreshInstallHomeUi = refreshInstallHomeUi;

    if (window.__hrInstallQueued) {
        window.__hrInstallQueued = false;
        if (!isPwaInstalled()) showInstallFlow();
    }
}

export function initIOSInstallBanner() {
    initInstallHomeUi();
}

export function showIOSInstallBannerIfNeeded() {
    refreshInstallHomeUi();
}

if (typeof window !== 'undefined') {
    window.showInstallGuide = showInstallGuide;
    window.showInstallFlow = showInstallFlow;
    window.initInstallHomeUi = initInstallHomeUi;
}