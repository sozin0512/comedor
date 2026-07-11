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

/**
 * Abre una URL externa de forma fiable (Chrome / navegador del sistema).
 * Necesario en Android WebView: <a download> y window.open casi nunca descargan APK.
 * @returns {Promise<boolean>}
 */
export async function openExternalUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const Cap = window.Capacitor;

    // 1) Capacitor Browser (Chrome Custom Tabs / Safari View) — mejor para descargas
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

    // 2) Capacitor App.openUrl
    try {
        if (Cap?.isNativePlatform?.()) {
            const App = Cap.Plugins?.App;
            if (App?.openUrl) {
                await App.openUrl({ url });
                return true;
            }
        }
    } catch (e) {
        console.warn('[openExternalUrl] App.openUrl:', e);
    }

    // 3) Cordova-style / Capacitor system target
    try {
        if (Cap?.isNativePlatform?.()) {
            const w = window.open(url, '_system');
            if (w) return true;
        }
    } catch (_) {}

    // 4) Android intent → Chrome / navegador por defecto
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

    // 5) Web / fallback
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