/** Detecta si la app corre dentro de Capacitor (Android/iOS), no en el navegador web. */
export function isCapacitorNative() {
    try {
        return window.Capacitor?.isNativePlatform?.() === true;
    } catch (_) {
        return false;
    }
}

export function getCapacitorPlatform() {
    try {
        return window.Capacitor?.getPlatform?.() || 'web';
    } catch (_) {
        return 'web';
    }
}

export function isCapacitorAndroid() {
    return isCapacitorNative() && getCapacitorPlatform() === 'android';
}

/** Clases en <body> para CSS (safe area, header, etc.). */
export function markCapacitorBodyClasses() {
    try {
        if (typeof document === 'undefined' || !document.body) return;
        if (isCapacitorNative()) {
            document.body.classList.add('capacitor-native');
            document.documentElement.classList.add('capacitor-native');
        }
        if (isCapacitorAndroid()) {
            document.body.classList.add('capacitor-android');
            document.documentElement.classList.add('capacitor-android');
        }
        if (isCapacitorNative() && getCapacitorPlatform() === 'ios') {
            document.body.classList.add('capacitor-ios');
            document.documentElement.classList.add('capacitor-ios');
        }
        // Fallback de safe-area si el nativo aún no inyectó insets (evita botones bajo el reloj)
        ensureNativeSafeAreaFallback();
    } catch (_) {}
}

/**
 * Si MainActivity no ha puesto --native-safe-top, usa un mínimo razonable
 * para que el header no quede bajo la barra de estado / notificaciones.
 */
export function ensureNativeSafeAreaFallback() {
    try {
        if (typeof document === 'undefined' || !isCapacitorNative()) return;
        const root = document.documentElement;
        const current = getComputedStyle(root).getPropertyValue('--native-safe-top').trim();
        if (current && current !== '0px') return;

        // Visual viewport / env() a veces sí reporta en WebViews nuevos
        let topPx = 0;
        try {
            const probe = document.createElement('div');
            probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px);';
            document.body?.appendChild(probe);
            topPx = parseFloat(getComputedStyle(probe).paddingTop) || 0;
            probe.remove();
        } catch (_) {}

        const minTop = isCapacitorAndroid() ? 52 : 44;
        const minBottom = isCapacitorAndroid() ? 16 : 12;
        const safeTop = Math.max(topPx, minTop);
        root.style.setProperty('--native-safe-top', `${safeTop}px`);
        if (!getComputedStyle(root).getPropertyValue('--native-safe-bottom').trim()) {
            root.style.setProperty('--native-safe-bottom', `${minBottom}px`);
        }
        root.classList.add('native-insets-ready');
        document.body?.classList.add('native-insets-ready');
    } catch (_) {}
}

// Marcar lo antes posible (y de nuevo al cargar el body)
try {
    markCapacitorBodyClasses();
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', markCapacitorBodyClasses, { once: true });
        } else {
            markCapacitorBodyClasses();
        }
        // Reintentar por si el WebView aplica insets tarde
        setTimeout(ensureNativeSafeAreaFallback, 80);
        setTimeout(ensureNativeSafeAreaFallback, 350);
        setTimeout(ensureNativeSafeAreaFallback, 900);
    }
} catch (_) {}

function isLikelyApkOrFirebaseStorageUrl(url) {
    const u = String(url || '').toLowerCase();
    return u.includes('.apk')
        || u.includes('firebasestorage.googleapis.com')
        || u.includes('firebasestorage.app')
        || u.includes('/o/artifacts%2f')
        || u.includes('/public/apk/');
}

/**
 * En Android nativo: encola la descarga con DownloadManager (completa en Descargas).
 * Chrome Custom Tabs a menudo deja el APK de Firebase a medias.
 * @returns {Promise<{ok:boolean, downloadId?:number, fileName?:string, pathHint?:string}|null>}
 */
export async function downloadApkNative(url, fileName = 'HonduRaite.apk') {
    if (!url || !isCapacitorAndroid()) return null;
    try {
        const plugin = window.Capacitor?.Plugins?.ApkDownload;
        if (!plugin?.download) return null;
        const res = await plugin.download({ url, fileName });
        return res || { ok: true };
    } catch (e) {
        console.warn('[downloadApkNative]', e);
        return null;
    }
}

/**
 * Abre URL en el navegador real del sistema (no Custom Tab).
 * Mejor para APK grandes de Firebase Storage.
 */
export async function openInSystemBrowser(url) {
    if (!url) return false;
    try {
        if (isCapacitorAndroid()) {
            const plugin = window.Capacitor?.Plugins?.ApkDownload;
            if (plugin?.openExternalBrowser) {
                await plugin.openExternalBrowser({ url });
                return true;
            }
        }
    } catch (e) {
        console.warn('[openInSystemBrowser] plugin:', e);
    }
    try {
        if (isCapacitorNative()) {
            const App = window.Capacitor?.Plugins?.App;
            if (App?.openUrl) {
                await App.openUrl({ url });
                return true;
            }
        }
    } catch (e) {
        console.warn('[openInSystemBrowser] App.openUrl:', e);
    }
    try {
        if (isCapacitorAndroid() || /Android/i.test(navigator.userAgent || '')) {
            const bare = url.replace(/^https?:\/\//i, '');
            const intentUrl =
                `intent://${bare}#Intent;scheme=https;action=android.intent.action.VIEW;` +
                `category=android.intent.category.BROWSABLE;end`;
            window.location.href = intentUrl;
            return true;
        }
    } catch (_) {}
    try {
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Abre una URL externa de forma fiable (Chrome / navegador del sistema).
 * Necesario en Android WebView: <a download> y window.open casi nunca descargan APK.
 * @returns {Promise<boolean>}
 */
export async function openExternalUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const Cap = window.Capacitor;
    const isApkish = isLikelyApkOrFirebaseStorageUrl(url);

    // APK / Firebase Storage: NO usar Custom Tabs (descargas a medias).
    // Preferir DownloadManager (vía JS) o navegador del sistema.
    if (isApkish && isCapacitorAndroid()) {
        const opened = await openInSystemBrowser(url);
        if (opened) return true;
    }

    // 1) Capacitor Browser (Custom Tabs) — OK para páginas normales, no para APK
    if (!isApkish) {
        try {
            if (Cap?.isNativePlatform?.()) {
                const Browser = Cap.Plugins?.Browser;
                if (Browser?.open) {
                    await Browser.open({ url, windowName: '_system' });
                    return true;
                }
            }
        } catch (e) {
            console.warn('[openExternalUrl] Browser.open:', e);
        }
    }

    // 2) Navegador del sistema / App.openUrl
    if (await openInSystemBrowser(url)) return true;

    // 3) Cordova-style
    try {
        if (Cap?.isNativePlatform?.()) {
            const w = window.open(url, '_system');
            if (w) return true;
        }
    } catch (_) {}

    // 4) Web / fallback
    try {
        const w = window.open(url, '_blank', 'noopener,noreferrer');
        if (w) return true;
    } catch (_) {}

    try {
        window.location.assign(url);
        return true;
    } catch (_) {
        return false;
    }
}

/** Atajo global por si se llama desde HTML inline */
if (typeof window !== 'undefined') {
    window.openExternalUrl = openExternalUrl;
}