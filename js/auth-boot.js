/**
 * Login ligero: se carga antes que app.js para poder ingresar
 * mientras el resto de la app baja en segundo plano.
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    setPersistence,
    browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { APP_CONFIG } from './config.js';
window.APP_CONFIG = APP_CONFIG;

function isEmailLike(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function authErrorMessage(err, context = 'login') {
    const code = err?.code || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        return 'Correo/teléfono o contraseña incorrectos.';
    }
    if (code === 'auth/invalid-email') return 'Correo electrónico no válido.';
    if (code === 'auth/email-already-in-use') return 'Este correo ya está registrado.';
    if (code === 'auth/weak-password') return 'La contraseña debe tener al menos 6 caracteres.';
    if (code === 'auth/too-many-requests') return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
    if (code === 'auth/network-request-failed') return 'Sin conexión. Revisa tu internet.';
    return err?.message || 'Error de autenticación.';
}

function toast(msg, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(msg, type);
        return;
    }
    try { alert(msg); } catch (_) {}
}

function getAuthMode() {
    return window.__hrAuthMode === 'register' ? 'register' : 'login';
}

window.setAuthMode = function (mode) {
    window.__hrAuthMode = mode === 'register' ? 'register' : 'login';
    const loginBtn = document.getElementById('btn-auth-login');
    const registerBtn = document.getElementById('btn-auth-register');
    const submitBtn = document.getElementById('auth-submit-btn');
    const forgotLink = document.getElementById('auth-forgot-link');
    const identifierField = document.getElementById('email-field');
    if (mode === 'login') {
        if (loginBtn) loginBtn.className = 'flex-1 py-2 text-center text-blue-600 border-b-2 border-blue-600 transition-all';
        if (registerBtn) registerBtn.className = 'flex-1 py-2 text-center text-gray-400 border-b-2 border-transparent transition-all';
        if (submitBtn && !submitBtn.disabled) submitBtn.innerText = 'INICIAR SESIÓN';
        forgotLink?.classList.remove('hidden');
        if (identifierField) identifierField.placeholder = 'Correo o teléfono (+504…)';
    } else {
        if (loginBtn) loginBtn.className = 'flex-1 py-2 text-center text-gray-400 border-b-2 border-transparent transition-all';
        if (registerBtn) registerBtn.className = 'flex-1 py-2 text-center text-blue-600 border-b-2 border-blue-600 transition-all';
        if (submitBtn && !submitBtn.disabled) submitBtn.innerText = 'CREAR NUEVA CUENTA';
        forgotLink?.classList.add('hidden');
        if (identifierField) identifierField.placeholder = 'Correo electrónico';
    }
};

function resetSubmit() {
    const submitBtn = document.getElementById('auth-submit-btn');
    if (!submitBtn) return;
    submitBtn.disabled = false;
    submitBtn.innerText = getAuthMode() === 'register' ? 'CREAR NUEVA CUENTA' : 'INICIAR SESIÓN';
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(label || 'timeout')), ms))
    ]);
}

function showEnteringShell(text) {
    const login = document.getElementById('login-screen');
    if (login) login.style.display = 'none';
    let el = document.getElementById('hr-entering-shell');
    if (!el) {
        el = document.createElement('div');
        el.id = 'hr-entering-shell';
        el.style.cssText = 'position:fixed;inset:0;z-index:40000;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#e8e6e0;padding:1.5rem;text-align:center';
        el.innerHTML = '<div style="width:2rem;height:2rem;border:3px solid rgba(30,41,59,.15);border-top-color:#2563eb;border-radius:50%;animation:hr-spin .8s linear infinite"></div>'
            + '<p style="margin-top:1rem;font-weight:800;color:#0f172a" id="hr-entering-text"></p>'
            + '<p style="margin-top:.4rem;font-size:.75rem;color:#64748b;font-weight:600">El mapa y el resto siguen cargando atrás</p>'
            + '<button type="button" id="hr-entering-reload" style="display:none;margin-top:1.1rem;padding:.55rem 1.1rem;border:0;border-radius:.75rem;background:#2563eb;color:#fff;font-weight:800;cursor:pointer">Recargar</button>';
        document.body.appendChild(el);
        setTimeout(function () {
            var btn = document.getElementById('hr-entering-reload');
            var t = document.getElementById('hr-entering-text');
            if (!document.getElementById('hr-entering-shell')) return;
            if (t) t.textContent = 'Está tardando más de lo normal.';
            if (btn) {
                btn.style.display = 'inline-block';
                btn.onclick = function () { location.reload(); };
            }
        }, 20000);
    }
    const t = document.getElementById('hr-entering-text');
    if (t) t.textContent = text || 'Sesión iniciada. Abriendo tu cuenta…';
}

async function runAuth() {
    if (typeof window.__hrFullExecuteAuth === 'function' && window.__hrFullExecuteAuth !== runAuth) {
        return window.__hrFullExecuteAuth();
    }
    const identifier = document.getElementById('email-field')?.value?.trim() || '';
    const pass = document.getElementById('pass-field')?.value?.trim() || '';
    if (!identifier || !pass) {
        toast('Ingresa tus credenciales completas.');
        return;
    }
    const mode = getAuthMode();
    if (mode === 'login' && !isEmailLike(identifier) && typeof window.__hrFullExecuteAuth !== 'function') {
        const submitBtn = document.getElementById('auth-submit-btn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'CARGANDO…';
        }
        toast('Un segundo, estamos abriendo tu cuenta…');
        const started = Date.now();
        const wait = setInterval(() => {
            if (typeof window.__hrFullExecuteAuth === 'function') {
                clearInterval(wait);
                window.__hrFullExecuteAuth();
            } else if (Date.now() - started > 20000) {
                clearInterval(wait);
                resetSubmit();
                toast('Usa tu correo para entrar, o espera un momento y vuelve a tocar Ingresar.');
            }
        }, 200);
        return;
    }
    const submitBtn = document.getElementById('auth-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = mode === 'login' ? 'ENTRANDO…' : 'CREANDO CUENTA…';
    }
    try {
        const app = getApps()[0] || initializeApp(APP_CONFIG.firebase);
        const auth = getAuth(app);
        try { await withTimeout(setPersistence(auth, browserLocalPersistence), 4000, 'persist'); } catch (_) {}
        window._authEntering = true;
        if (mode === 'login') {
            await withTimeout(
                signInWithEmailAndPassword(auth, identifier.toLowerCase(), pass),
                15000,
                'auth/network-request-failed'
            );
            showEnteringShell('Sesión iniciada. Abriendo tu cuenta…');
            try { window.ensureMapsLoaded?.(); } catch (_) {}
            loadAppRuntime();
            return;
        }
        if (!isEmailLike(identifier)) {
            resetSubmit();
            toast('Para crear cuenta necesitas un correo electrónico válido.');
            return;
        }
        const selectedRole = document.getElementById('role-driver')?.classList.contains('bg-white')
            ? 'driver'
            : 'client';
        try { localStorage.setItem('lastUserRole', selectedRole); } catch (_) {}
        await withTimeout(
            createUserWithEmailAndPassword(auth, identifier.toLowerCase(), pass),
            15000,
            'auth/network-request-failed'
        );
        showEnteringShell('Cuenta creada. Abriendo tu perfil…');
        try { window.ensureMapsLoaded?.(); } catch (_) {}
        loadAppRuntime();
    } catch (err) {
        window._authEntering = false;
        resetSubmit();
        const login = document.getElementById('login-screen');
        if (login) login.style.display = '';
        document.getElementById('hr-entering-shell')?.remove();
        toast(authErrorMessage(err, mode));
    }
}

function loadAppRuntime() {
    if (window.__hrAppJsPromise) return window.__hrAppJsPromise;
    const v = window.__HR_BUILD_VERSION__ || APP_CONFIG.appVersion || '';
    window.__hrAppJsPromise = import(`./app.js?v=${v}`).catch((err) => {
        console.error('[auth-boot] app.js', err);
        window.__hrAppJsPromise = null;
        toast('No se pudo abrir HonduRaite. Recarga con Ctrl+Shift+R o ventana de incógnito.');
        throw err;
    });
    return window.__hrAppJsPromise;
}
window.loadAppRuntime = loadAppRuntime;

try {
    const bootApp = getApps()[0] || initializeApp(APP_CONFIG.firebase);
    const bootAuth = getAuth(bootApp);
    onAuthStateChanged(bootAuth, (user) => {
        if (user) loadAppRuntime();
    });
} catch (e) {
    console.warn('[auth-boot] auth listener', e);
}

try {
    const q = String(location.search || '') + String(location.hash || '');
    if (/[?&]trip=/.test(q) || /staffTrip=/.test(q)) loadAppRuntime();
} catch (_) {}

window.__hrRunAuth = runAuth;
window.executeAuth = runAuth;
window.__hrAuthBootReady = true;

if (window.__hrPendingAuth) {
    window.__hrPendingAuth = false;
    runAuth();
}

const hint = document.getElementById('auth-load-hint');
if (hint) hint.classList.add('hidden');
