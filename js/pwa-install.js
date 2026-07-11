import { isCapacitorNative } from './capacitor-native.js';

let deferredInstallPrompt = null;
let nativeInstallUiHidden = false;

function notifyInstallReady() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('honduber-install-ready'));
    const btn = document.getElementById('btn-native-install');
    if (btn) btn.classList.remove('hidden');
}

export function hideInstallUiForNativeApp() {
    if (!isCapacitorNative() || nativeInstallUiHidden) return;
    nativeInstallUiHidden = true;

    [
        'btn-native-install',
        'ios-install-banner',
        'install-reminder-banner',
        'install-reminder-banner-driver',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.innerHTML = '';
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

if (typeof window !== 'undefined' && !isCapacitorNative()) {
    window.addEventListener('beforeinstallprompt', (e) => {
        // Store without preventDefault to avoid the "Banner not shown: preventDefault() called" message.
        // The native prompt can be triggered via triggerNativeInstall() from the install button.
        deferredInstallPrompt = e;
        notifyInstallReady();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        try { localStorage.setItem('honduber_pwa_installed', '1'); } catch (_) {}
    });
}

export function isPwaInstalled() {
    if (typeof window === 'undefined') return true;
    if (isCapacitorNative()) return true;
    try {
        if (localStorage.getItem('honduber_pwa_installed') === '1') return true;
    } catch (_) {}
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true
        || document.referrer.includes('android-app://');
}

export function isIOS() {
    if (typeof window === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export function isIOSSafari() {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return isIOSDevice && isSafari;
}

export function canTriggerNativeInstall() {
    if (isCapacitorNative()) return false;
    return !!deferredInstallPrompt;
}

export async function triggerNativeInstall() {
    if (!deferredInstallPrompt) return false;
    try {
        await deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        document.getElementById('btn-native-install')?.classList.add('hidden');
        if (outcome === 'accepted') {
            try { localStorage.setItem('honduber_pwa_installed', '1'); } catch (_) {}
            return true;
        }
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
    return `
        <div class="mx-1 mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-left">
            <p class="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-1">
                <i class="fas fa-mobile-alt"></i> Instala HonduRaite
            </p>
            <p class="text-xs text-amber-900 leading-snug mb-2">Como ${roleLabel}, agrega la app a tu pantalla de inicio y activa notificaciones para no perder mensajes del viaje aunque cierres el navegador.</p>
            <button type="button" onclick="window.showInstallFlow()" class="text-[10px] font-black text-amber-700 underline uppercase">Ver cómo instalar</button>
        </div>
    `;
}

export function renderInstallReminderBanner(context = null) {
    if (isCapacitorNative()) return;
    const banners = [
        document.getElementById('install-reminder-banner'),
        document.getElementById('install-reminder-banner-driver')
    ].filter(Boolean);

    if (!banners.length) return;

    if (isPwaInstalled()) {
        banners.forEach((banner) => {
            banner.classList.add('hidden');
            banner.innerHTML = '';
        });
        return;
    }

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

    window.enableTripNotifications?.();
    return true;
}

let iosBannerInitialized = false;

export function initIOSInstallBanner() {
    if (typeof window === 'undefined' || iosBannerInitialized || isCapacitorNative()) return;
    iosBannerInitialized = true;

    const banner = document.getElementById('ios-install-banner');
    const btn = document.getElementById('ios-install-btn');
    const closeBtn = document.getElementById('ios-install-close');

    if (!banner) return;

    const update = () => {
        const isSearching = document.body.classList.contains('is-searching');
        const shouldShow = isIOS() && !isPwaInstalled() && !sessionStorage.getItem('iosInstallBannerDismissed') && !isSearching;
        if (shouldShow) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    };

    update();

    if (btn) {
        btn.addEventListener('click', () => {
            window.showInstallGuide?.();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            banner.classList.add('hidden');
            try { sessionStorage.setItem('iosInstallBannerDismissed', '1'); } catch (_) {}
        });
    }

    // Hide automatically if it gets installed
    window.addEventListener('appinstalled', () => {
        banner.classList.add('hidden');
    });

    // Re-check on visibility (in case of manual install / PWA detection)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) update();
    });

    // Expose for external refresh
    window.refreshIOSInstallBanner = update;
}

export function showIOSInstallBannerIfNeeded() {
    if (isCapacitorNative()) return;
    if (window.refreshIOSInstallBanner) {
        window.refreshIOSInstallBanner();
        return;
    }
    const banner = document.getElementById('ios-install-banner');
    if (!banner) return;
    const isSearching = document.body.classList.contains('is-searching');
    if (isIOS() && !isPwaInstalled() && !sessionStorage.getItem('iosInstallBannerDismissed') && !isSearching) {
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}