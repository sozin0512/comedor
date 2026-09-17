/**
 * Sesión de conductor persistente en el teléfono.
 * localStorage (web/PWA) + SharedPreferences nativo (APK) para sobrevivir
 * si Android limpia el WebView.
 */

const KEY_ID = 'honduber_driver_login_id';
const KEY_PW = 'honduber_driver_login_pw';
const SKIP_AUTO_KEY = 'hr_skip_driver_autologin';

function nativePlugin() {
    try {
        return window.Capacitor?.Plugins?.SessionKeepalive || null;
    } catch (_) {
        return null;
    }
}

export function markSkipDriverAutoLogin() {
    try { sessionStorage.setItem(SKIP_AUTO_KEY, '1'); } catch (_) {}
}

export function shouldSkipDriverAutoLogin() {
    try { return sessionStorage.getItem(SKIP_AUTO_KEY) === '1'; } catch (_) { return false; }
}

export function clearSkipDriverAutoLogin() {
    try { sessionStorage.removeItem(SKIP_AUTO_KEY); } catch (_) {}
}

export function readLocalDriverLogin() {
    try {
        const identifier = (localStorage.getItem(KEY_ID) || '').trim();
        const password = localStorage.getItem(KEY_PW) || '';
        if (!identifier || !password) return null;
        return { identifier, password };
    } catch (_) {
        return null;
    }
}

export async function loadDriverLogin() {
    const local = readLocalDriverLogin();
    if (local) return local;
    const plugin = nativePlugin();
    if (!plugin?.loadDriverLogin) return null;
    try {
        const native = await plugin.loadDriverLogin();
        const identifier = String(native?.identifier || '').trim();
        const password = String(native?.password || '');
        if (!identifier || !password) return null;
        try {
            localStorage.setItem(KEY_ID, identifier);
            localStorage.setItem(KEY_PW, password);
            localStorage.setItem('lastUserRole', 'driver');
        } catch (_) {}
        return { identifier, password };
    } catch (_) {
        return null;
    }
}

export async function saveDriverLogin(identifier, password) {
    const id = String(identifier || '').trim();
    const pass = String(password || '');
    if (!id || !pass) return;
    try {
        localStorage.setItem(KEY_ID, id);
        localStorage.setItem(KEY_PW, pass);
        localStorage.setItem('lastUserRole', 'driver');
    } catch (_) {}
    const plugin = nativePlugin();
    if (!plugin?.saveDriverLogin) return;
    try {
        await plugin.saveDriverLogin({ identifier: id, password: pass });
    } catch (_) {}
}

export async function clearDriverLogin() {
    try {
        localStorage.removeItem(KEY_ID);
        localStorage.removeItem(KEY_PW);
    } catch (_) {}
    const plugin = nativePlugin();
    if (!plugin?.clearDriverLogin) return;
    try {
        await plugin.clearDriverLogin();
    } catch (_) {}
}

export function fillDriverLoginForm(creds) {
    if (!creds?.identifier || !creds?.password) return false;
    const email = document.getElementById('email-field');
    const pass = document.getElementById('pass-field');
    if (email && !email.value) email.value = creds.identifier;
    if (pass && !pass.value) pass.value = creds.password;
    try { localStorage.setItem('lastUserRole', 'driver'); } catch (_) {}
    try { window.updateRole?.('driver'); } catch (_) {}
    try { window.restoreLastRoleSelection?.(); } catch (_) {}
    const hint = document.getElementById('driver-session-hint');
    if (hint) hint.classList.remove('hidden');
    return true;
}

export async function restoreDriverLoginForm() {
    const creds = await loadDriverLogin();
    if (!creds) return null;
    fillDriverLoginForm(creds);
    return creds;
}

if (typeof window !== 'undefined') {
    window.saveDriverLogin = saveDriverLogin;
    window.clearDriverLogin = clearDriverLogin;
    window.loadDriverLogin = loadDriverLogin;
    window.restoreDriverLoginForm = restoreDriverLoginForm;
    window.markSkipDriverAutoLogin = markSkipDriverAutoLogin;
}
