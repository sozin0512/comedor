/**
 * Sesión persistente en el teléfono.
 * localStorage (web/PWA) + SharedPreferences nativo (APK) para sobrevivir
 * si Android limpia el WebView. No se cierra sola: solo logout explícito.
 */

const KEY_ID = 'honduber_driver_login_id';
const KEY_PW = 'honduber_driver_login_pw';
const KEY_ROLE = 'honduber_login_role';
const SKIP_AUTO_KEY = 'hr_skip_driver_autologin';
const KEEP_KEY = 'hr_keep_session';
const WANTED_ONLINE_KEY = 'hr_driver_wanted_online';

function nativePlugin() {
    try {
        return window.Capacitor?.Plugins?.SessionKeepalive || null;
    } catch (_) {
        return null;
    }
}

function readStoredRole() {
    try {
        return localStorage.getItem(KEY_ROLE) || localStorage.getItem('lastUserRole') || '';
    } catch (_) {
        return '';
    }
}

export function markKeepSession() {
    try {
        localStorage.setItem(KEEP_KEY, '1');
        document.documentElement.setAttribute('data-hr-restore-session', '1');
    } catch (_) {}
}

export function clearKeepSession() {
    try {
        localStorage.removeItem(KEEP_KEY);
        document.documentElement.removeAttribute('data-hr-restore-session');
    } catch (_) {}
}

export function shouldKeepSession() {
    try {
        return localStorage.getItem(KEEP_KEY) === '1' || !!readLocalDriverLogin();
    } catch (_) {
        return false;
    }
}

export function markDriverWantedOnline() {
    try { localStorage.setItem(WANTED_ONLINE_KEY, '1'); } catch (_) {}
}

export function clearDriverWantedOnline() {
    try { localStorage.setItem(WANTED_ONLINE_KEY, '0'); } catch (_) {}
}

export function shouldResumeDriverOnline() {
    try { return localStorage.getItem(WANTED_ONLINE_KEY) === '1'; } catch (_) { return false; }
}

export function driverOnlinePreferenceUnset() {
    try {
        const v = localStorage.getItem(WANTED_ONLINE_KEY);
        return v !== '1' && v !== '0';
    } catch (_) {
        return true;
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
        return { identifier, password, role: readStoredRole() };
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
        const role = readStoredRole() || 'client';
        try {
            localStorage.setItem(KEY_ID, identifier);
            localStorage.setItem(KEY_PW, password);
            if (role) localStorage.setItem(KEY_ROLE, role);
        } catch (_) {}
        return { identifier, password, role };
    } catch (_) {
        return null;
    }
}

export async function saveUserLogin(identifier, password, roleHint) {
    const id = String(identifier || '').trim();
    const pass = String(password || '');
    if (!id || !pass) return;
    const role = roleHint === 'driver' || roleHint === 'client' ? roleHint : (readStoredRole() || '');
    try {
        localStorage.setItem(KEY_ID, id);
        localStorage.setItem(KEY_PW, pass);
        if (role) {
            localStorage.setItem(KEY_ROLE, role);
            localStorage.setItem('lastUserRole', role);
        }
        localStorage.setItem(KEEP_KEY, '1');
        document.documentElement.setAttribute('data-hr-restore-session', '1');
    } catch (_) {}
    const plugin = nativePlugin();
    if (!plugin?.saveDriverLogin) return;
    try {
        await plugin.saveDriverLogin({ identifier: id, password: pass });
    } catch (_) {}
}

export async function saveDriverLogin(identifier, password) {
    return saveUserLogin(identifier, password, 'driver');
}

export async function clearDriverLogin() {
    try {
        localStorage.removeItem(KEY_ID);
        localStorage.removeItem(KEY_PW);
        localStorage.removeItem(KEY_ROLE);
        localStorage.removeItem(KEEP_KEY);
        localStorage.removeItem(WANTED_ONLINE_KEY);
        document.documentElement.removeAttribute('data-hr-restore-session');
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
    const role = creds.role === 'driver' || creds.role === 'client'
        ? creds.role
        : (readStoredRole() || 'client');
    try { if (role) localStorage.setItem('lastUserRole', role); } catch (_) {}
    try { window.updateRole?.(role === 'driver' ? 'driver' : 'client'); } catch (_) {}
    try { window.restoreLastRoleSelection?.(); } catch (_) {}
    const hint = document.getElementById('driver-session-hint');
    if (hint) {
        hint.classList.remove('hidden');
        hint.textContent = role === 'driver'
            ? 'Sesión de conductor guardada en este teléfono. No se cierra si sales un rato.'
            : 'Sesión de pasajero guardada en este teléfono. No se cierra si sales un rato.';
    }
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
    window.saveUserLogin = saveUserLogin;
    window.clearDriverLogin = clearDriverLogin;
    window.loadDriverLogin = loadDriverLogin;
    window.restoreDriverLoginForm = restoreDriverLoginForm;
    window.markSkipDriverAutoLogin = markSkipDriverAutoLogin;
    window.shouldSkipDriverAutoLogin = shouldSkipDriverAutoLogin;
    window.markKeepSession = markKeepSession;
    window.clearKeepSession = clearKeepSession;
    window.shouldKeepSession = shouldKeepSession;
    window.markDriverWantedOnline = markDriverWantedOnline;
    window.clearDriverWantedOnline = clearDriverWantedOnline;
    window.shouldResumeDriverOnline = shouldResumeDriverOnline;
    window.driverOnlinePreferenceUnset = driverOnlinePreferenceUnset;
}
