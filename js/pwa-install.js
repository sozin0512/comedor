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

function isStandaloneDisplay() {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

export function isPwaInstalled() {
    if (typeof window === 'undefined') return true;
    if (isCapacitorNative()) return true;
    // iPhone/iPad: Safari y la PWA de inicio NO son lo mismo para push.
    // Solo cuenta standalone real; el flag de localStorage engaña en pestaña Safari.
    if (isIOS()) return isStandaloneDisplay();
    try {
        if (localStorage.getItem('honduber_pwa_installed') === '1') return true;
    } catch (_) {}
    return isStandaloneDisplay()
        || document.referrer.includes('android-app://');
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
            <p class="text-xs text-amber-900 leading-snug mb-2">Como ${roleLabel}, en iPhone los viajes no llegan si usas Safari. Agrega HonduRaite a inicio, ábrela desde el icono y activa avisos.</p>
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

const INSTALL_GUIDE_MODAL_ID = 'hr-install-guide-modal';

/** Guía paso a paso para instalar la PWA. Disponible para todos los roles (no solo staff). */
export function showInstallGuide() {
    if (typeof document === 'undefined' || isCapacitorNative()) return;
    const existing = document.getElementById(INSTALL_GUIDE_MODAL_ID);
    if (existing) {
        existing.remove();
    }

    const modal = document.createElement('div');
    modal.id = INSTALL_GUIDE_MODAL_ID;
    modal.className = 'fixed inset-0 bg-black/70 z-[40000] flex items-end md:items-center justify-center p-4';

    const isIOSUser = isIOS();
    const standalone = isStandaloneDisplay();

    modal.innerHTML = `
        <div class="bg-white w-full md:w-[420px] md:rounded-3xl rounded-t-3xl p-6 max-h-[92vh] overflow-auto">
            <div class="flex justify-between items-center mb-3">
                <h3 class="font-black text-xl">Instalar HonduRaite</h3>
                <button type="button" onclick="this.closest('.fixed').remove()" class="text-2xl text-gray-400 hover:text-gray-600">×</button>
            </div>

            <p class="text-sm text-gray-600 mb-5">Instala la app en tu pantalla de inicio para usarla como una aplicación nativa (recibes notificaciones aunque cierres Safari/Chrome).</p>

            ${isIOSUser ? `
            <div class="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-2xl">
                <div class="flex items-center gap-2 mb-2">
                    <i class="fab fa-apple text-2xl text-gray-900"></i>
                    <div>
                        <div class="font-black text-base">iPhone / iPad (Safari)</div>
                        <div class="text-[10px] text-blue-700">Sigue estos pasos (es rápido):</div>
                    </div>
                </div>
                <div class="space-y-3 text-sm">
                    <div class="flex gap-3">
                        <div class="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-black shrink-0">1</div>
                        <div>Toca el botón <strong>compartir</strong> <span class="text-blue-600">⎋</span> (abajo, en el centro de Safari).</div>
                    </div>
                    <div class="flex gap-3">
                        <div class="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-black shrink-0">2</div>
                        <div>Desplaza hacia abajo y toca <strong>"Agregar a pantalla de inicio"</strong>.</div>
                    </div>
                    <div class="flex gap-3">
                        <div class="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-black shrink-0">3</div>
                        <div>En la esquina superior toca <strong>"Agregar"</strong>.</div>
                    </div>
                    <div class="flex gap-3">
                        <div class="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-black shrink-0">4</div>
                        <div>Cierra Safari y abre <strong>HonduRaite desde el icono nuevo</strong> (si entras por Safari, los viajes no te caen fuera de la app).</div>
                    </div>
                    <div class="flex gap-3">
                        <div class="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-black shrink-0">5</div>
                        <div>Toca <strong>Activar avisos</strong>. Sin eso, en iPhone no llegan push si cierras la app o estás desconectado.</div>
                    </div>
                </div>
                <p class="text-[10px] text-amber-700 mt-3">⚠️ Importante: Usa <strong>Safari</strong> (no Chrome, Firefox ni otro). iOS 16.4 o superior.</p>
            </div>
            ` : ''}

            <div class="mb-4 ${isIOSUser ? 'opacity-70' : ''}">
                <div class="flex items-center gap-2 mb-2">
                    <i class="fab fa-android text-xl text-emerald-600"></i>
                    <span class="font-black">Android (Chrome / Edge)</span>
                </div>
                <ol class="list-decimal pl-5 text-sm space-y-1 text-gray-700">
                    <li>Toca el menú ⋮ (arriba derecha)</li>
                    <li>Elige <strong>"Instalar app"</strong> o <strong>"Agregar a la pantalla de inicio"</strong></li>
                    <li>Confirma con <strong>Instalar</strong></li>
                </ol>
            </div>

            ${!isIOSUser ? `
            <div class="mb-4">
                <div class="flex items-center gap-2 mb-2">
                    <i class="fab fa-apple text-xl text-gray-800"></i>
                    <span class="font-black">iPhone / iPad</span>
                </div>
                <ol class="list-decimal pl-5 text-sm space-y-1 text-gray-700">
                    <li>Abre en <strong>Safari</strong></li>
                    <li>Toca el botón compartir (cuadro con flecha ↑)</li>
                    <li>Busca y toca <strong>"Agregar a pantalla de inicio"</strong></li>
                    <li>Toca <strong>Agregar</strong></li>
                </ol>
            </div>
            ` : ''}

            <div class="pt-4 border-t flex gap-2">
                <button type="button" onclick="this.closest('.fixed').remove()"
                        class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 rounded-2xl text-sm">
                    Cerrar
                </button>
                <button type="button" onclick="window.enableTripNotifications?.(); this.closest('.fixed').remove();"
                        class="flex-1 bg-emerald-600 text-white font-black py-3 rounded-2xl text-sm">
                    ${isIOSUser && !standalone
                        ? 'Ya la instalé · abrir desde el icono'
                        : 'Activar notificaciones'}
                </button>
            </div>
        </div>
    `;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
}

/** Intenta el diálogo nativo; si no hay, muestra la guía. */
export async function showInstallFlow() {
    if (isCapacitorNative()) return;
    if (!isPwaInstalled() && canTriggerNativeInstall()) {
        const installed = await tryNativeInstall();
        if (installed) return;
    }
    showInstallGuide();
}

if (typeof window !== 'undefined') {
    window.showInstallGuide = showInstallGuide;
    window.showInstallFlow = showInstallFlow;
}