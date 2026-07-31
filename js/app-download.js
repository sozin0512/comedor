/**
 * Admin: subir APK Â· Usuario web: badge dorado Â· App instalada: aviso de nueva versiÃ³n + tutorial
 */
import {
    ref, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import {
    doc, getDoc, setDoc, serverTimestamp, onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import {
    isCapacitorNative,
    isCapacitorAndroid,
    openExternalUrl,
    downloadApkNative,
    openInSystemBrowser,
    getInstalledApkVersion
} from './capacitor-native.js';

const SETTINGS_DOC = 'main';
/** Solo oculta el badge en la sesiÃ³n actual (X) â€” se limpia en cada login */
const DISMISS_KEY = 'honduber_apk_badge_dismissed';
/** Build del APK que el usuario ya descargÃ³/instalÃ³ â€” no mostrar de nuevo hasta una versiÃ³n mÃ¡s nueva */
const WEB_INSTALLED_BUILD_KEY = 'honduber_apk_web_installed_build_id';
const POS_KEY = 'honduber_panel_pos_app-download-badge';
const CLIENT_BUILD_KEY = 'honduber_apk_client_build_id';
const UPDATE_SNOOZE_KEY = 'honduber_apk_update_snooze_until';
const SNOOZE_MS = 12 * 60 * 60 * 1000;

let dbRef = null;
let appIdRef = null;
let storageRef = null;
let getCurrentUser = () => null;
let getUserProfile = () => null;
let isAdminFn = () => false;
let settingsUnsub = null;
let cachedApkMeta = null;
let updateModalOpen = false;
let installTutorialOpen = false;
/** Evita re-mostrar el badge en cada snapshot de perfil dentro de la misma sesiÃ³n de login */
let badgeSessionUid = null;

function settingsDocRef() {
    return doc(dbRef, 'artifacts', appIdRef, 'public', 'data', 'appSettings', SETTINGS_DOC);
}

function apkStoragePath(fileName = 'honduraite.apk') {
    const safe = String(fileName || 'honduraite.apk').replace(/[^\w.\-]+/g, '_');
    return `artifacts/${appIdRef}/public/apk/${safe}`;
}

function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(ts) {
    try {
        const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
        if (!d || Number.isNaN(d.getTime())) return 'â€”';
        return d.toLocaleString('es-HN', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) {
        return 'â€”';
    }
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isApkFile(file) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    return name.endsWith('.apk')
        || type === 'application/vnd.android.package-archive'
        || type === 'application/octet-stream';
}

/**
 * "2026.07.30.1" â†’ 2026073001 (mismo esquema que android/app/build.gradle versionCode).
 * Formato: YYYY * 1_000_000 + MM * 10_000 + DD * 100 + N
 *
 * BUG anterior: solo quitaba puntos (2026.07.30.1 â†’ 202607301) y el telÃ©fono
 * con versionCode real 2026072802 parecÃ­a "mÃ¡s nuevo" â†’ NO mostraba update.
 */
function versionLabelToCode(label) {
    const s = String(label || '').trim();
    if (!s) return 0;
    const m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\.(\d{1,3})$/);
    if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const n = Number(m[4]);
        if ([y, mo, d, n].every((x) => Number.isFinite(x))) {
            return (y * 1000000) + (mo * 10000) + (d * 100) + n;
        }
    }
    // Fallback: solo dÃ­gitos (builds viejos / etiquetas raras)
    const digits = s.replace(/\D/g, '');
    if (!digits) return 0;
    const num = Number(digits.length > 12 ? digits.slice(0, 12) : digits);
    return Number.isFinite(num) ? num : 0;
}

/** Mejor versionCode: el de Firestore si es coherente, si no el recalculado del label. */
function resolveRemoteVersionCode(metaOrDoc) {
    const version = String(metaOrDoc?.version || metaOrDoc?.androidApkVersion || '').trim();
    const fromLabel = versionLabelToCode(version);
    const stored = Number(metaOrDoc?.versionCode ?? metaOrDoc?.androidApkVersionCode) || 0;
    // Si el label es YYYY.MM.DD.N y el guardado no coincide (bug viejo), usar el del label
    if (fromLabel > 0) {
        if (!stored || stored !== fromLabel) {
            // stored â€œcortoâ€ tipo 202607301 vs correcto 2026073001
            if (!stored || String(stored).length < String(fromLabel).length || stored < fromLabel) {
                return fromLabel;
            }
        }
        // Si stored es mayor y plausible (admin forzÃ³ code), respetarlo
        return Math.max(stored, fromLabel);
    }
    return stored || 0;
}

function metaFromDoc(d) {
    if (!d?.androidApkUrl) return null;
    const version = d.androidApkVersion || '';
    const versionCode = resolveRemoteVersionCode({
        version,
        versionCode: d.androidApkVersionCode,
        androidApkVersion: version,
        androidApkVersionCode: d.androidApkVersionCode,
    });
    return {
        url: d.androidApkUrl,
        fileName: d.androidApkFileName || 'HonduRaite.apk',
        version,
        versionCode,
        buildId: Number(d.androidApkBuildId) || 0,
        size: d.androidApkSize || 0,
        uploadedAt: d.androidApkUploadedAt || null,
        storagePath: d.androidApkStoragePath || null,
        notes: d.androidApkNotes || '',
    };
}

/** Info nativa del APK instalado (Capacitor App.getInfo) */
let nativeAppInfo = { version: '', build: 0, ready: false };

function getClientBuildId() {
    try {
        const v = localStorage.getItem(CLIENT_BUILD_KEY);
        if (v == null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    } catch (_) {
        return null;
    }
}

function setClientBuildId(id) {
    try {
        if (id == null) localStorage.removeItem(CLIENT_BUILD_KEY);
        else localStorage.setItem(CLIENT_BUILD_KEY, String(id));
    } catch (_) {}
}

function getWebInstalledBuildId() {
    try {
        const v = localStorage.getItem(WEB_INSTALLED_BUILD_KEY);
        if (v == null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    } catch (_) {
        return null;
    }
}

/** Marca que el usuario ya descargÃ³/instalÃ³ este APK (no mostrar hasta update). */
function markApkDownloadedOrInstalled(buildId = cachedApkMeta?.buildId) {
    const id = Number(buildId) || Number(cachedApkMeta?.buildId) || 0;
    if (!id) return;
    try {
        localStorage.setItem(WEB_INSTALLED_BUILD_KEY, String(id));
    } catch (_) {}
    setClientBuildId(id);
    try { sessionStorage.removeItem(DISMISS_KEY); } catch (_) {}
}

/** En web: hay APK nuevo respecto al que ya descargÃ³/instalÃ³ (misma regla: buildId de cada subida). */
function hasWebApkUpdateAvailable() {
    if (!cachedApkMeta?.url || !cachedApkMeta.buildId) return false;
    const installed = getWebInstalledBuildId();
    if (installed == null) return false; // nunca instalÃ³ â†’ badge de â€œdescargaâ€, no â€œupdateâ€
    return Number(cachedApkMeta.buildId) > Number(installed);
}

/** Ya tiene esta versiÃ³n (o superior) marcada como instalada. */
function alreadyHasCurrentApkOnWeb() {
    if (!cachedApkMeta?.buildId) return false;
    const installed = getWebInstalledBuildId();
    if (installed == null) return false;
    return Number(installed) >= Number(cachedApkMeta.buildId);
}

function isUpdateSnoozed() {
    try {
        // Regla simple: si hay una subida nueva (buildId) no silenciar nunca
        const remoteBuildId = Number(cachedApkMeta?.buildId) || 0;
        const ack = getClientBuildId();
        if (remoteBuildId > 0 && (ack == null || remoteBuildId > Number(ack))) {
            return false;
        }
        const until = Number(localStorage.getItem(UPDATE_SNOOZE_KEY) || 0);
        return until > Date.now();
    } catch (_) {
        return false;
    }
}

function snoozeUpdate() {
    try {
        localStorage.setItem(UPDATE_SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch (_) {}
}

function clearUpdateSnooze() {
    try { localStorage.removeItem(UPDATE_SNOOZE_KEY); } catch (_) {}
}

/** Usuarios con la app instalada (APK Capacitor en Android). */
function isInstalledAndroidApp() {
    return isCapacitorNative() && isCapacitorAndroid();
}

/**
 * Lee versionName + versionCode del APK instalado.
 * Preferir PackageManager nativo; fallback Capacitor App.getInfo.
 */
export async function refreshNativeAppInfo() {
    if (!isInstalledAndroidApp()) {
        nativeAppInfo = { version: '', build: 0, ready: true };
        return nativeAppInfo;
    }
    // 1) Plugin nativo (PackageManager) â€” versionCode real del APK shell
    try {
        const pkg = await getInstalledApkVersion?.();
        if (pkg && (pkg.versionCode > 0 || pkg.versionName)) {
            nativeAppInfo = {
                version: String(pkg.versionName || '').trim(),
                build: Number(pkg.versionCode) || versionLabelToCode(pkg.versionName) || 0,
                ready: true,
            };
            return nativeAppInfo;
        }
    } catch (e) {
        console.warn('[app-download] getInstalledApkVersion:', e);
    }
    // 2) Capacitor App.getInfo
    try {
        const App = window.Capacitor?.Plugins?.App;
        if (!App?.getInfo) {
            nativeAppInfo = { version: '', build: 0, ready: true };
            return nativeAppInfo;
        }
        const info = await App.getInfo();
        nativeAppInfo = {
            version: String(info?.version || '').trim(),
            // Android: info.build = versionCode (a veces string)
            build: Number(info?.build) || versionLabelToCode(info?.version) || 0,
            ready: true
        };
        return nativeAppInfo;
    } catch (_) {
        nativeAppInfo = { version: '', build: 0, ready: true };
        return nativeAppInfo;
    }
}

/**
 * REGLA SIMPLE (como pediste):
 *   Subir APK en Admin = nueva versiÃ³n automÃ¡tica (nuevo buildId).
 *   Avisar a todos los que no hayan tomado ESA subida (descarga o â€œYa actualicÃ©â€).
 * No hace falta que el nÃºmero de versiÃ³n sea â€œmayorâ€.
 */
export function hasApkUpdateAvailable() {
    if (!isInstalledAndroidApp()) return false;
    if (!cachedApkMeta?.url) return false;

    const remoteBuildId = Number(cachedApkMeta.buildId) || 0;
    const remoteCode = resolveRemoteVersionCode(cachedApkMeta)
        || Number(cachedApkMeta.versionCode)
        || versionLabelToCode(cachedApkMeta.version)
        || 0;
    const nativeCode = Number(nativeAppInfo.build) || versionLabelToCode(nativeAppInfo.version) || 0;
    const ack = getClientBuildId();

    // 1) Nueva subida (buildId) que el usuario aÃºn no aceptÃ³ â†’ SIEMPRE update
    if (remoteBuildId > 0 && (ack == null || remoteBuildId > Number(ack))) {
        // Primera vez en el dispositivo: si el APK instalado ya es el mismo code, no spamear
        if (ack == null && remoteCode > 0 && nativeCode > 0 && nativeCode >= remoteCode) {
            return false;
        }
        return true;
    }

    // 2) Sin buildId (datos viejos): versionCode
    if (!remoteBuildId && remoteCode > 0 && nativeCode > 0) {
        return remoteCode > nativeCode;
    }

    return false;
}

/**
 * Cada publicaciÃ³n nueva en Admin: limpia snooze para que salga el aviso.
 */
function reactToNewRemotePublication() {
    if (!cachedApkMeta?.buildId) return;
    const remoteBuildId = Number(cachedApkMeta.buildId) || 0;
    if (!remoteBuildId) return;

    let prev = 0;
    try {
        prev = Number(localStorage.getItem('honduber_apk_last_remote_build_id') || 0) || 0;
    } catch (_) {}

    try {
        localStorage.setItem('honduber_apk_last_remote_build_id', String(remoteBuildId));
    } catch (_) {}

    if (remoteBuildId > prev) {
        clearUpdateSnooze();
        try { sessionStorage.removeItem(DISMISS_KEY); } catch (_) {}
        // Nueva subida: el aviso se basa en buildId > ack (no borramos ack a propÃ³sito;
        // si ack es de una subida anterior, ya es menor y se muestra el update)
    }
}

async function trySyncBuildFromNativeVersion() {
    if (!isInstalledAndroidApp() || !cachedApkMeta?.buildId) return;
    await refreshNativeAppInfo();
    reactToNewRemotePublication();
    // Baseline solo la 1Âª vez: si el APK del telÃ©fono ya es el publicado, marcar
    // este buildId como â€œtomadoâ€ para no spamear. Una subida NUEVA (buildId mayor) avisarÃ¡.
    const remoteBuildId = Number(cachedApkMeta.buildId) || 0;
    const remoteCode = resolveRemoteVersionCode(cachedApkMeta) || 0;
    const nativeCode = Number(nativeAppInfo.build) || versionLabelToCode(nativeAppInfo.version) || 0;
    const ack = getClientBuildId();
    if (
        remoteBuildId
        && ack == null
        && remoteCode > 0
        && nativeCode > 0
        && nativeCode >= remoteCode
    ) {
        setClientBuildId(remoteBuildId);
    }
}

export async function loadApkMeta() {
    if (!dbRef) return null;
    try {
        const snap = await getDoc(settingsDocRef());
        if (!snap.exists()) {
            cachedApkMeta = null;
            return null;
        }
        cachedApkMeta = metaFromDoc(snap.data() || {});
        return cachedApkMeta;
    } catch (e) {
        console.warn('[app-download] load meta:', e);
        return cachedApkMeta;
    }
}

/**
 * Corrige androidApkVersionCode en Firestore si se guardÃ³ con el bug viejo
 * (2026.07.30.1 â†’ 202607301 en vez de 2026073001). AsÃ­ los APK ya instalados
 * con lÃ³gica anterior vuelven a ver â€œhay actualizaciÃ³nâ€.
 */
async function repairRemoteVersionCodeIfNeeded() {
    if (!dbRef || !isAdminFn(getCurrentUser(), getUserProfile())) return false;
    try {
        const snap = await getDoc(settingsDocRef());
        if (!snap.exists()) return false;
        const d = snap.data() || {};
        if (!d.androidApkUrl || !d.androidApkVersion) return false;
        const correct = versionLabelToCode(d.androidApkVersion);
        const stored = Number(d.androidApkVersionCode) || 0;
        if (!(correct > 0) || stored === correct) return false;
        await setDoc(settingsDocRef(), {
            androidApkVersionCode: correct,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        if (cachedApkMeta) cachedApkMeta.versionCode = correct;
        console.info('[app-download] versionCode reparado:', stored, 'â†’', correct);
        return true;
    } catch (e) {
        console.warn('[app-download] repair versionCode:', e);
        return false;
    }
}

function renderAdminMetaHtml(meta) {
    if (!meta?.url) {
        return `
            <div class="admin-apk-status admin-apk-status--empty">
                <p class="admin-apk-status-badge"><i class="fas fa-cloud"></i> Sin APK en el servidor</p>
                <p class="text-sm text-slate-400 mt-2">AÃºn no hay archivo publicado. Abajo elige o arrastra un <strong class="text-amber-300">.apk</strong> y pulsa <strong class="text-white">Publicar</strong>.</p>
            </div>`;
    }
    return `
        <div class="admin-apk-status admin-apk-status--live">
            <p class="admin-apk-status-badge admin-apk-status-badge--ok">
                <i class="fas fa-check-circle"></i> APK ya estÃ¡ en el servidor Â· LISTO
            </p>
            <div class="admin-apk-status-grid mt-3 space-y-1.5 text-sm">
                <p class="text-slate-300"><span class="text-slate-500">Archivo:</span> <strong>${esc(meta.fileName)}</strong></p>
                <p class="text-slate-300"><span class="text-slate-500">VersiÃ³n:</span> <strong class="text-amber-200">${esc(meta.version || 'â€”')}</strong></p>
                <p class="text-slate-300"><span class="text-slate-500">VersionCode:</span> <strong class="text-sky-200">${esc(meta.versionCode || versionLabelToCode(meta.version) || 'â€”')}</strong></p>
                <p class="text-slate-300"><span class="text-slate-500">Build ID (subida):</span> ${esc(meta.buildId || 'â€”')}</p>
                <p class="text-slate-300"><span class="text-slate-500">TamaÃ±o:</span> ${esc(formatBytes(meta.size))}</p>
                <p class="text-slate-300"><span class="text-slate-500">Subido:</span> ${esc(formatWhen(meta.uploadedAt))}</p>
                ${meta.notes ? `<p class="text-slate-400 text-xs">${esc(meta.notes)}</p>` : ''}
            </div>
            <p class="text-[10px] text-emerald-200/90 mt-2"><i class="fas fa-users"></i> Pasajeros y conductores ya pueden descargar o actualizar con este archivo.</p>
            <div class="flex flex-wrap gap-2 mt-2">
                <a href="${esc(meta.url)}" target="_blank" rel="noopener" class="ops-btn ops-btn--ghost text-xs inline-flex">
                    <i class="fas fa-external-link-alt"></i> Probar enlace de descarga
                </a>
            </div>
        </div>`;
}

export async function renderAdminApkPanel(container) {
    if (!container) return;
    const U = window.OpsUi;
    if (!isAdminFn(getCurrentUser(), getUserProfile())) {
        container.innerHTML = U?.page
            ? U.page(U.hero('App Android', 'Solo el administrador puede gestionar el APK') +
                `<div class="ops-form-panel"><div class="ops-form-panel-body text-amber-200 text-sm">No tienes permiso para subir el APK.</div></div>`)
            : `<p class="text-amber-300 p-4">Solo el administrador puede subir el APK.</p>`;
        return;
    }

    container.innerHTML = U.page(
        U.hero('App Android (APK)', 'Publica versiones Â· avisa a quienes ya la tienen instalada') +
        `<div class="ops-stack">` +
        U.formPanel('APK actual', 'Enlace pÃºblico de descarga', `
            <div id="admin-apk-meta"><p class="text-slate-400 text-sm">Cargandoâ€¦</p></div>
            <div class="flex flex-wrap gap-2 mt-3">
                <button type="button" id="admin-apk-repair-code" class="ops-btn ops-btn--ghost text-xs">
                    <i class="fas fa-wrench"></i> Reparar detecciÃ³n de updates
                </button>
                <button type="button" id="admin-apk-remove" class="ops-btn ops-btn--danger text-xs hidden">
                    <i class="fas fa-trash"></i> Quitar APK
                </button>
            </div>
            <p class="text-[10px] text-slate-500 mt-2">
                <b>Regla simple:</b> cada vez que publicas un APK se genera un build nuevo y se avisa a todos
                (push + botÃ³n en la app). No hace falta que la versiÃ³n sea â€œmayorâ€: <b>subir = actualizar</b>.
                Si algo falla, pulsa <b>Reparar detecciÃ³n</b>.
            </p>
        `) +
        U.formPanel('Subir nuevo APK', '1) Elige archivo Â· 2) Pulsa Publicar Â· 3) Espera la barra al 100%', `
            <p id="admin-apk-step-hint" class="admin-apk-step-hint">Paso 1 de 3: elige o arrastra el archivo .apk</p>
            <div id="admin-apk-drop" class="admin-apk-drop" tabindex="0" role="button" aria-label="Zona para soltar APK">
                <input type="file" id="admin-apk-file" accept=".apk,application/vnd.android.package-archive" class="hidden">
                <div class="admin-apk-drop-inner" id="admin-apk-drop-inner">
                    <i class="fab fa-android text-4xl text-emerald-400 mb-2" id="admin-apk-drop-icon"></i>
                    <p class="font-black text-white text-sm" id="admin-apk-drop-title">Arrastra tu APK aquÃ­</p>
                    <p class="text-xs text-slate-400 mt-1" id="admin-apk-drop-sub">o toca para elegir archivo</p>
                    <p class="text-[10px] text-slate-500 mt-2">Elegir archivo <strong>no lo sube</strong> todavÃ­a Â· luego pulsa Publicar</p>
                </div>
            </div>
            <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label class="text-xs text-slate-400 font-bold">VersiÃ³n (igual que Android Studio versionName)</label>
                    <input id="admin-apk-version" class="ops-input mt-1" maxlength="32" placeholder="Ej: 2026.07.30.1" value="">
                    <p class="text-[10px] text-slate-500 mt-1">
                        Debe ser exactamente el <code>versionName</code> del APK (ej. <strong>2026.07.30.1</strong>).
                        Genera versionCode <code>2026073001</code>. Si estÃ¡ vacÃ­o se usa la del proyecto.
                    </p>
                </div>
                <div>
                    <label class="text-xs text-slate-400 font-bold">Notas (opcional)</label>
                    <input id="admin-apk-notes" class="ops-input mt-1" maxlength="120" placeholder="Mejoras y correcciones">
                </div>
            </div>
            <button type="button" id="admin-apk-upload-btn" class="ops-btn ops-btn--emerald ops-btn--full mt-3" disabled>
                <i class="fas fa-cloud-upload-alt"></i> Publicar y notificar actualizaciÃ³n
            </button>
            <div id="admin-apk-progress-wrap" class="admin-apk-progress-wrap hidden mt-3" aria-live="polite">
                <div class="flex justify-between text-xs text-slate-300 mb-1.5 font-bold">
                    <span id="admin-apk-progress-label"><i class="fas fa-spinner fa-spin"></i> Subiendo al servidorâ€¦</span>
                    <span id="admin-apk-progress-pct">0%</span>
                </div>
                <div class="admin-apk-progress-bar"><div id="admin-apk-progress-fill" class="admin-apk-progress-fill"></div></div>
                <p id="admin-apk-progress-detail" class="text-[10px] text-slate-400 mt-1.5">0 MB / 0 MB</p>
            </div>
            <p id="admin-apk-selected" class="text-xs text-amber-200 mt-2 hidden font-semibold"></p>
            <p id="admin-apk-upload-result" class="text-sm mt-2 hidden"></p>
        `) +
        `</div>`
    );

    let meta = await loadApkMeta();
    // Repara versionCode mal guardado (bug 202607301 vs 2026073001) para que
    // los telÃ©fonos con APK viejo vuelvan a ver â€œhay actualizaciÃ³nâ€.
    const repaired = await repairRemoteVersionCodeIfNeeded();
    if (repaired) {
        meta = await loadApkMeta();
        window.showToast?.(
            `VersionCode corregido a ${meta?.versionCode}. Los usuarios deberÃ­an ver la actualizaciÃ³n al reabrir la app.`,
            'success'
        );
    }
    const metaEl = document.getElementById('admin-apk-meta');
    if (metaEl) metaEl.innerHTML = renderAdminMetaHtml(meta);
    const removeBtn = document.getElementById('admin-apk-remove');
    if (removeBtn) removeBtn.classList.toggle('hidden', !meta?.url);
    const repairBtn = document.getElementById('admin-apk-repair-code');
    repairBtn?.addEventListener('click', async () => {
        repairBtn.disabled = true;
        try {
            const snap = await getDoc(settingsDocRef());
            if (!snap.exists() || !snap.data()?.androidApkUrl) {
                window.showToast?.('No hay APK publicado para reparar.', 'warning');
                return;
            }
            const d = snap.data() || {};
            const projectVer = document.getElementById('admin-apk-version')?.value?.trim()
                || document.querySelector('meta[name="hr-app-version"]')?.content
                || window.__HR_BUILD_VERSION__
                || '';
            const ver = String(d.androidApkVersion || projectVer || '').trim();
            const code = versionLabelToCode(ver) || versionLabelToCode(projectVer);
            if (!code) {
                window.showToast?.('Escribe la versiÃ³n exacta (ej. 2026.07.30.6) y pulsa reparar.', 'warning');
                return;
            }
            // Fuerza versionCode correcto + buildId nuevo â†’ la Cloud Function repara y manda FCM
            const newBuildId = Date.now();
            await setDoc(settingsDocRef(), {
                androidApkVersion: ver || projectVer,
                androidApkVersionCode: code,
                androidApkBuildId: newBuildId,
                androidApkUpdateSignal: newBuildId,
                updatedAt: serverTimestamp(),
            }, { merge: true });

            // Push inmediato (backup de la Cloud Function)
            try {
                const fn = window.httpsCallable?.(window.cloudFunctions, 'broadcastAppMessage');
                if (fn) {
                    await fn({
                        title: 'HonduRaite Â· Actualiza la app',
                        body: `Nueva versiÃ³n ${ver || projectVer} (${code}). Ãbrela e instala la actualizaciÃ³n.`,
                        targetRole: 'all',
                        type: 'app_update',
                        tag: `app-update-${ver || code}`,
                        version: ver || projectVer,
                        highPriority: true,
                    });
                }
            } catch (pushErr) {
                console.warn('[repair] broadcast:', pushErr);
            }

            const next = await loadApkMeta();
            if (metaEl) metaEl.innerHTML = renderAdminMetaHtml(next);
            window.showToast?.(
                `Listo. VersionCode = ${code} (v${ver || projectVer}). Push enviado. Los telÃ©fonos deben reabrir la app.`,
                'success'
            );
        } catch (e) {
            console.error(e);
            window.showToast?.('No se pudo reparar. Revisa permisos de admin.', 'error');
        } finally {
            repairBtn.disabled = false;
        }
    });
    {
        const vIn = document.getElementById('admin-apk-version');
        if (vIn && !vIn.value) {
            const projectVer = document.querySelector('meta[name="hr-app-version"]')?.content
                || window.__HR_BUILD_VERSION__
                || window.APP_CONFIG?.appVersion
                || '';
            if (projectVer) vIn.value = projectVer;
            else if (meta?.version) vIn.placeholder = `Ãšltima: ${meta.version}`;
        }
    }

    let selectedFile = null;
    const drop = document.getElementById('admin-apk-drop');
    const fileInput = document.getElementById('admin-apk-file');
    const uploadBtn = document.getElementById('admin-apk-upload-btn');
    const selectedEl = document.getElementById('admin-apk-selected');
    const stepHint = document.getElementById('admin-apk-step-hint');
    const resultEl = document.getElementById('admin-apk-upload-result');
    const dropTitle = document.getElementById('admin-apk-drop-title');
    const dropSub = document.getElementById('admin-apk-drop-sub');

    const setSelected = (file) => {
        if (resultEl) {
            resultEl.classList.add('hidden');
            resultEl.textContent = '';
        }
        if (!file) {
            selectedFile = null;
            if (uploadBtn) {
                uploadBtn.disabled = true;
                uploadBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publicar y notificar actualizaciÃ³n';
            }
            if (selectedEl) {
                selectedEl.classList.add('hidden');
                selectedEl.textContent = '';
            }
            drop?.classList.remove('is-ready', 'is-uploading');
            if (stepHint) stepHint.textContent = 'Paso 1 de 3: elige o arrastra el archivo .apk';
            if (dropTitle) dropTitle.textContent = 'Arrastra tu APK aquÃ­';
            if (dropSub) dropSub.textContent = 'o toca para elegir archivo';
            return;
        }
        if (!isApkFile(file)) {
            window.showToast?.('Solo se permiten archivos .apk', 'warning');
            return;
        }
        if (file.size > 200 * 1024 * 1024) {
            window.showToast?.('El APK supera 200 MB.', 'warning');
            return;
        }
        selectedFile = file;
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publicar y notificar actualizaciÃ³n';
        }
        if (selectedEl) {
            selectedEl.classList.remove('hidden');
            selectedEl.innerHTML = `<i class="fas fa-file-archive"></i> Listo para subir: <strong>${esc(file.name)}</strong> (${formatBytes(file.size)}) â€” aÃºn <u>no estÃ¡ en el servidor</u> hasta que pulses Publicar.`;
        }
        drop?.classList.add('is-ready');
        drop?.classList.remove('is-uploading');
        if (stepHint) stepHint.textContent = 'Paso 2 de 3: pulsa el botÃ³n verde Â«PublicarÂ» para subir al servidor';
        if (dropTitle) dropTitle.textContent = 'Archivo elegido';
        if (dropSub) dropSub.textContent = file.name;
        window.showToast?.(`Archivo listo: ${file.name}. Ahora pulsa Publicar.`, 'info');
    };

    drop?.addEventListener('click', () => fileInput?.click());
    drop?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput?.click();
        }
    });
    fileInput?.addEventListener('change', () => setSelected(fileInput.files?.[0] || null));

    ['dragenter', 'dragover'].forEach((ev) => {
        drop?.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            drop.classList.add('is-dragover');
        });
    });
    ['dragleave', 'drop'].forEach((ev) => {
        drop?.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            drop.classList.remove('is-dragover');
        });
    });
    drop?.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) setSelected(file);
    });

    uploadBtn?.addEventListener('click', async () => {
        if (!selectedFile) {
            window.showToast?.('Primero elige un archivo .apk', 'warning');
            return;
        }
        if (stepHint) stepHint.textContent = 'Paso 3 de 3: subiendoâ€¦ no cierres esta pestaÃ±a';
        drop?.classList.add('is-uploading');
        const ok = await uploadAndroidApk(selectedFile, {
            version: document.getElementById('admin-apk-version')?.value?.trim() || '',
            notes: document.getElementById('admin-apk-notes')?.value?.trim() || '',
        });
        drop?.classList.remove('is-uploading');
        if (ok) {
            setSelected(null);
            if (fileInput) fileInput.value = '';
            const next = await loadApkMeta();
            if (metaEl) metaEl.innerHTML = renderAdminMetaHtml(next);
            if (removeBtn) removeBtn.classList.toggle('hidden', !next?.url);
            if (resultEl) {
                resultEl.classList.remove('hidden');
                resultEl.className = 'text-sm mt-2 text-emerald-300 font-bold';
                resultEl.innerHTML = '<i class="fas fa-check-circle"></i> Subida completa. Arriba en Â«APK actualÂ» verÃ¡s el archivo publicado.';
            }
            if (stepHint) stepHint.textContent = 'Listo. El APK ya estÃ¡ en el servidor (mira el cuadro de arriba).';
            syncAppDownloadBadge();
            maybeShowApkUpdateModal({ force: false });
        } else if (stepHint) {
            stepHint.textContent = 'Error al subir. Revisa el mensaje e intenta de nuevo.';
        }
    });

    removeBtn?.addEventListener('click', async () => {
        if (!confirm('Â¿Quitar el APK publicado? Los usuarios ya no verÃ¡n descarga ni actualizaciones.')) return;
        await removeAndroidApk();
        if (metaEl) metaEl.innerHTML = renderAdminMetaHtml(null);
        removeBtn.classList.add('hidden');
        syncAppDownloadBadge();
    });
}

/** @returns {Promise<boolean>} true si quedÃ³ publicado en el servidor */
async function uploadAndroidApk(file, { version = '', notes = '' } = {}) {
    if (!isAdminFn(getCurrentUser(), getUserProfile())) {
        window.showToast?.('Solo el administrador puede subir el APK.', 'error');
        return false;
    }
    if (!storageRef || !dbRef) {
        window.showToast?.('Storage no estÃ¡ listo.', 'error');
        return false;
    }
    if (!isApkFile(file)) {
        window.showToast?.('Archivo invÃ¡lido. Usa un .apk', 'warning');
        return false;
    }

    const progressWrap = document.getElementById('admin-apk-progress-wrap');
    const fill = document.getElementById('admin-apk-progress-fill');
    const pctEl = document.getElementById('admin-apk-progress-pct');
    const labelEl = document.getElementById('admin-apk-progress-label');
    const detailEl = document.getElementById('admin-apk-progress-detail');
    const uploadBtn = document.getElementById('admin-apk-upload-btn');
    const drop = document.getElementById('admin-apk-drop');

    progressWrap?.classList.remove('hidden');
    if (fill) fill.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';
    if (detailEl) detailEl.textContent = `0 MB / ${formatBytes(file.size)}`;
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendoâ€¦ no cierres la pestaÃ±a';
    }
    if (labelEl) {
        labelEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo al servidorâ€¦';
    }
    drop?.classList.add('is-uploading');
    window.showToast?.('Subiendo APKâ€¦ verÃ¡s el % abajo. No cierres esta pÃ¡gina.', 'info');

    const path = apkStoragePath(file.name.endsWith('.apk') ? file.name : 'honduraite.apk');
    const storageFileRef = ref(storageRef, path);
    const buildId = Date.now();
    // Preferir versiÃ³n escrita por admin; si vacÃ­o, la del proyecto (config/meta)
    const fallbackVer = (typeof window !== 'undefined' && (
        document.querySelector('meta[name="hr-app-version"]')?.content
        || window.__HR_BUILD_VERSION__
        || window.APP_CONFIG?.appVersion
    )) || '';
    const versionLabel = (version || fallbackVer || `build-${buildId}`).trim();

    try {
        const task = uploadBytesResumable(storageFileRef, file, {
            contentType: 'application/vnd.android.package-archive',
            customMetadata: {
                uploadedBy: getCurrentUser()?.uid || '',
                version: versionLabel,
                buildId: String(buildId),
            },
        });

        await new Promise((resolve, reject) => {
            task.on('state_changed',
                (snap) => {
                    const total = snap.totalBytes || file.size || 1;
                    const done = snap.bytesTransferred || 0;
                    const pct = Math.min(100, Math.round((done / total) * 100));
                    if (fill) fill.style.width = `${pct}%`;
                    if (pctEl) pctEl.textContent = `${pct}%`;
                    if (detailEl) {
                        detailEl.textContent = `${formatBytes(done)} / ${formatBytes(total)} Â· ${pct}%`;
                    }
                    if (labelEl) {
                        labelEl.innerHTML = pct < 100
                            ? `<i class="fas fa-spinner fa-spin"></i> Subiendoâ€¦ ${pct}%`
                            : '<i class="fas fa-cog fa-spin"></i> Guardando enlaceâ€¦';
                    }
                },
                reject,
                resolve
            );
        });

        if (labelEl) {
            labelEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando en la base de datosâ€¦';
        }
        const url = await getDownloadURL(storageFileRef);
        // Siempre el mismo esquema que build.gradle (2026.07.30.1 â†’ 2026073001)
        const versionCode = versionLabelToCode(versionLabel) || 0;
        if (!versionCode && versionLabel) {
            console.warn('[app-download] versionCode=0 para etiqueta:', versionLabel);
        }
        // versionCode SIEMPRE numÃ©rico correcto (2026.07.30.6 â†’ 2026073004)
        // Las APKs antiguas comparan este nÃºmero; si sale mal, no ven el update.
        const safeCode = Number(versionCode) || versionLabelToCode(versionLabel) || 0;
        await setDoc(settingsDocRef(), {
            androidApkUrl: url,
            androidApkFileName: file.name,
            androidApkVersion: versionLabel,
            androidApkVersionCode: safeCode || null,
            androidApkBuildId: buildId,
            androidApkNotes: notes || null,
            androidApkSize: file.size,
            androidApkStoragePath: path,
            androidApkUploadedAt: serverTimestamp(),
            androidApkUploadedBy: getCurrentUser()?.uid || null,
            androidApkUpdateSignal: buildId,
            updatedAt: serverTimestamp(),
        }, { merge: true });

        // NUNCA marcar â€œya instaladoâ€ en el admin
        clearUpdateSnooze();

        // Aviso FCM a todos (las APK viejas no tienen el JS nuevo; el push las despierta)
        try {
            const fn = window.httpsCallable?.(window.cloudFunctions, 'broadcastAppMessage');
            if (fn) {
                await fn({
                    title: 'HonduRaite Â· Actualiza la app',
                    body: `Nueva versiÃ³n ${versionLabel}${safeCode ? ` (${safeCode})` : ''}. Ãbrela e instala la actualizaciÃ³n.`,
                    targetRole: 'all',
                    type: 'app_update',
                    tag: `app-update-${versionLabel}`,
                    version: versionLabel,
                    highPriority: true,
                });
                window.showToast?.('Push de actualizaciÃ³n enviado a los usuarios.', 'info');
            }
        } catch (pushErr) {
            console.warn('[app-download] broadcastAppMessage:', pushErr);
            // La Cloud Function onApkSettingsPublished tambiÃ©n intenta notificar
        }

        if (labelEl) {
            labelEl.innerHTML = '<i class="fas fa-check-circle text-emerald-400"></i> Â¡Publicado en el servidor!';
        }
        if (fill) fill.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';
        if (detailEl) detailEl.textContent = `${formatBytes(file.size)} / ${formatBytes(file.size)} Â· 100%`;
        if (uploadBtn) {
            uploadBtn.innerHTML = '<i class="fas fa-check"></i> Publicado correctamente';
        }
        window.showToast?.('APK publicado. Arriba verÃ¡s Â«APK ya estÃ¡ en el servidorÂ».', 'success');
        await loadApkMeta();
        // Refrescar cuadro superior al momento
        const metaEl = document.getElementById('admin-apk-meta');
        if (metaEl) metaEl.innerHTML = renderAdminMetaHtml(cachedApkMeta);
        const removeBtn = document.getElementById('admin-apk-remove');
        if (removeBtn) removeBtn.classList.toggle('hidden', !cachedApkMeta?.url);
        return true;
    } catch (err) {
        console.error('[app-download] upload:', err);
        const msg = err?.code === 'storage/unauthorized'
            ? 'Sin permiso de Storage. Despliega storage.rules (solo admin puede subir).'
            : (err?.message || 'No se pudo subir el APK.');
        if (labelEl) {
            labelEl.innerHTML = `<i class="fas fa-times-circle text-red-400"></i> Error: ${esc(msg)}`;
        }
        if (detailEl) detailEl.textContent = 'La subida fallÃ³. Revisa reglas de Storage e internet.';
        window.showToast?.(msg, 'error');
        return false;
    } finally {
        drop?.classList.remove('is-uploading');
        if (uploadBtn) {
            uploadBtn.disabled = false;
            if (!uploadBtn.innerHTML.includes('Publicado')) {
                uploadBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publicar y notificar actualizaciÃ³n';
            }
        }
        // Dejar la barra visible unos segundos para que veas el 100% o el error
        setTimeout(() => {
            const stillOk = document.getElementById('admin-apk-progress-pct')?.textContent === '100%';
            if (stillOk) progressWrap?.classList.add('hidden');
        }, 5000);
    }
}

async function removeAndroidApk() {
    if (!isAdminFn(getCurrentUser(), getUserProfile())) {
        return window.showToast?.('Solo el administrador puede quitar el APK.', 'error');
    }
    const meta = cachedApkMeta || await loadApkMeta();
    try {
        if (meta?.storagePath && storageRef) {
            try {
                await deleteObject(ref(storageRef, meta.storagePath));
            } catch (e) {
                console.warn('[app-download] delete storage file:', e);
            }
        }
        await setDoc(settingsDocRef(), {
            androidApkUrl: null,
            androidApkFileName: null,
            androidApkVersion: null,
            androidApkVersionCode: null,
            androidApkBuildId: null,
            androidApkNotes: null,
            androidApkSize: null,
            androidApkStoragePath: null,
            androidApkUploadedAt: null,
            androidApkUploadedBy: null,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        cachedApkMeta = null;
        window.showToast?.('APK eliminado.', 'success');
    } catch (err) {
        console.error('[app-download] remove:', err);
        window.showToast?.('No se pudo eliminar el APK.', 'error');
    }
}

function shouldShowDownloadBadge() {
    // App nativa Android: botÃ³n de actualizaciÃ³n cuando hay APK mÃ¡s nuevo
    if (isInstalledAndroidApp()) {
        // Update siempre visible (tambiÃ©n en bÃºsqueda); solo ocultar en map-pick
        if (document.body.classList.contains('map-pick-mode')) return false;
        if (!hasApkUpdateAvailable()) return false;
        if (isUpdateSnoozed()) return false;
        return true;
    }
    if (isCapacitorNative()) return false;
    // Web: necesita APK publicado en Admin
    if (!cachedApkMeta?.url) return false;

    // Ya descargÃ³/instalÃ³ ESTA versiÃ³n desde web â†’ ocultar hasta un build mÃ¡s nuevo
    if (alreadyHasCurrentApkOnWeb()) return false;

    try {
        if (sessionStorage.getItem(DISMISS_KEY) === '1') return false;
    } catch (_) {}
    const profile = getUserProfile();
    const role = profile?.role || 'client';
    // Pasajeros y conductores. Staff de ops no necesita el badge.
    if (role === 'supervisor') return false;
    if (document.body.classList.contains('trip-active')) return false;
    if (document.body.classList.contains('is-searching')) return false;
    if (document.body.classList.contains('map-pick-mode')) return false;
    if (role && role !== 'client' && role !== 'driver' && role !== 'admin') return false;
    return true;
}

function ensureBadgeEl() {
    let el = document.getElementById('app-download-badge');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'app-download-badge';
    el.className = 'app-download-badge hidden';
    el.setAttribute('aria-label', 'Descarga nuestra app');
    el.innerHTML = `
        <button type="button" class="app-download-badge-drag" data-app-dl-drag title="Mover" aria-label="Mover botÃ³n">
            <i class="fas fa-grip-vertical pointer-events-none"></i>
        </button>
        <button type="button" class="app-download-badge-main" data-app-dl-open>
            <span class="app-download-badge-glow" aria-hidden="true"></span>
            <span class="app-download-badge-icon" aria-hidden="true"><i class="fab fa-android"></i></span>
            <span class="app-download-badge-text">
                <span class="app-download-badge-kicker">HonduRaite</span>
                <span class="app-download-badge-title">Descarga nuestra app</span>
            </span>
            <span class="app-download-badge-chevron" aria-hidden="true"><i class="fas fa-download"></i></span>
        </button>
        <button type="button" class="app-download-badge-close" data-app-dl-close title="Ocultar por ahora" aria-label="Ocultar">
            <i class="fas fa-times pointer-events-none"></i>
        </button>
    `;
    const host = document.getElementById('map-container') || document.body;
    host.appendChild(el);

    el.querySelector('[data-app-dl-open]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isInstalledAndroidApp() && hasApkUpdateAvailable()) {
            showApkUpdateModal({ force: true });
        } else if (hasWebApkUpdateAvailable()) {
            showInstallTutorial({ mode: 'update' });
        } else {
            showInstallTutorial({ mode: 'install' });
        }
    });
    el.querySelector('[data-app-dl-close]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // X: ocultar solo hasta el prÃ³ximo inicio de sesiÃ³n (login)
        try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
        if (isInstalledAndroidApp()) {
            // En app nativa, la X tambiÃ©n pospone el aviso de update hasta el prÃ³ximo login
            snoozeUpdate();
        }
        el.classList.add('hidden');
        window.showToast?.('Oculto por ahora. VolverÃ¡ a salir al iniciar sesiÃ³n de nuevo.', 'info');
    });

    bindBadgeDraggable(el);
    return el;
}

/**
 * Inicia la descarga del APK.
 * En la APK Android: DownloadManager del sistema (Chrome Custom Tabs deja Firebase Storage a medias).
 * En web mÃ³vil: navegador del sistema / enlace directo.
 */
async function startApkDownload() {
    const url = cachedApkMeta?.url;
    if (!url) {
        window.showToast?.('La descarga aÃºn no estÃ¡ disponible.', 'warning');
        return false;
    }

    const fileName = cachedApkMeta.fileName || 'HonduRaite.apk';
    const onAndroidApp = isCapacitorAndroid();
    const onAndroidWeb = !onAndroidApp
        && (isCapacitorNative() || /Android/i.test(navigator.userAgent || ''));

    // 1) App nativa Android â†’ DownloadManager (completo en carpeta Descargas)
    if (onAndroidApp) {
        window.showToast?.('Iniciando descarga del APK en Descargasâ€¦', 'info');
        try {
            const native = await downloadApkNative(url, fileName);
            if (native?.ok !== false && native) {
                markApkDownloadedOrInstalled(cachedApkMeta.buildId);
                syncAppDownloadBadge();
                window.showToast?.(
                    'Descarga en curso. Mira la barra de notificaciones; al terminar abre el APK desde Descargas e instÃ¡lalo.',
                    'success'
                );
                return true;
            }
        } catch (e) {
            console.warn('[app-download] native DownloadManager:', e);
        }
        // Fallback: navegador del sistema (no Custom Tab)
        window.showToast?.('Abriendo el navegador del celular para descargarâ€¦', 'info');
        const openedSys = await openInSystemBrowser(url);
        if (openedSys) {
            markApkDownloadedOrInstalled(cachedApkMeta.buildId);
            syncAppDownloadBadge();
            window.showToast?.(
                'Si Chrome no descarga solo, toca el archivo o el icono de descarga. Luego instala desde Descargas.',
                'success'
            );
            return true;
        }
    }

    window.showToast?.(
        onAndroidWeb
            ? 'Abriendo el navegador del celular para descargar el APKâ€¦'
            : 'Iniciando descarga del APKâ€¦',
        'info'
    );

    let opened = false;
    try {
        opened = await openExternalUrl(url);
    } catch (e) {
        console.warn('[app-download] openExternalUrl:', e);
        opened = false;
    }

    // Fallback web: <a> sin attribute download (cross-origin lo ignora igual)
    if (!opened) {
        try {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            if (!onAndroidApp && !onAndroidWeb) a.setAttribute('download', fileName);
            document.body.appendChild(a);
            a.click();
            a.remove();
            opened = true;
        } catch (_) {
            try {
                window.location.href = url;
                opened = true;
            } catch (__) {
                opened = false;
            }
        }
    }

    if (!opened) {
        window.showToast?.(
            'No se pudo abrir la descarga. Copia el enlace desde Admin â†’ App Android o prueba en Chrome.',
            'error'
        );
        return false;
    }

    markApkDownloadedOrInstalled(cachedApkMeta.buildId);
    syncAppDownloadBadge();
    window.showToast?.(
        onAndroidWeb || onAndroidApp
            ? 'Si no termina sola, abre Descargas o la notificaciÃ³n y toca el APK para instalar.'
            : 'Descarga iniciada. Abre el archivo e instÃ¡lalo cuando termine.',
        'success'
    );
    return true;
}

function openApkDownload() {
    showInstallTutorial({ mode: isInstalledAndroidApp() ? 'update' : 'install' });
}

/* â€”â€” Tutorial de instalaciÃ³n / confianza (Play Protect) â€”â€” */
function installTutorialStepsHtml() {
    const androidHint = isCapacitorAndroid() || isCapacitorNative() || /Android/i.test(navigator.userAgent || '');
    return `
        <ol class="apk-tutorial-steps">
            <li>
                <span class="apk-tutorial-num">1</span>
                <div>
                    <strong>Toca â€œDescargar APKâ€</strong>
                    <p>${androidHint
                        ? (isCapacitorAndroid()
                            ? 'La app usa el <b>descargador del sistema</b>: el APK va a la carpeta <em>Descargas</em> y avisa al terminar (mÃ¡s fiable que Chrome).'
                            : 'Se abrirÃ¡ el <b>navegador del celular</b> (Chrome u otro) y ahÃ­ empieza la descarga.')
                        : 'Se descarga el instalador oficial de HonduRaite (archivo .apk).'}</p>
                </div>
            </li>
            <li>
                <span class="apk-tutorial-num">2</span>
                <div>
                    <strong>Abre el archivo descargado</strong>
                    <p>Desde la <b>barra de notificaciones</b> del celular o la carpeta <em>Descargas</em>.</p>
                </div>
            </li>
            <li>
                <span class="apk-tutorial-num">3</span>
                <div>
                    <strong>Si Android pregunta â€œÂ¿Permitir de esta fuente?â€</strong>
                    <p>Activa <em>Permitir de esta fuente</em> solo para Chrome / Archivos / el navegador que uses. Es normal fuera de Play Store.</p>
                </div>
            </li>
            <li>
                <span class="apk-tutorial-num">4</span>
                <div>
                    <strong>Si sale â€œPlay Protectâ€ o â€œapp bloqueadaâ€</strong>
                    <p>Toca <em>MÃ¡s detalles</em> â†’ <em>Instalar de todos modos</em> (o <em>Instalar igualmente</em>). Google avisa porque la app no viene de su tienda, no porque sea virus.</p>
                </div>
            </li>
            <li>
                <span class="apk-tutorial-num">5</span>
                <div>
                    <strong>Confirma Instalar</strong>
                    <p>Al terminar, abre HonduRaite. Tus datos de sesiÃ³n se mantienen en la mayorÃ­a de actualizaciones.</p>
                </div>
            </li>
        </ol>
    `;
}

function showInstallTutorial({ mode = 'install' } = {}) {
    if (installTutorialOpen) {
        document.getElementById('apk-install-tutorial')?.remove();
    }
    if (!cachedApkMeta?.url) {
        return window.showToast?.('AÃºn no hay APK publicado.', 'warning');
    }
    installTutorialOpen = true;
    const isUpdate = mode === 'update';
    const ver = cachedApkMeta.version || 'nueva';
    const modal = document.createElement('div');
    modal.id = 'apk-install-tutorial';
    modal.className = 'apk-tutorial-overlay';
    modal.innerHTML = `
        <div class="apk-tutorial-sheet" role="dialog" aria-modal="true" aria-labelledby="apk-tutorial-title">
            <button type="button" class="apk-tutorial-x" data-apk-tut-close aria-label="Cerrar"><i class="fas fa-times"></i></button>
            <div class="apk-tutorial-hero">
                <div class="apk-tutorial-hero-icon"><i class="fab fa-android"></i></div>
                <h2 id="apk-tutorial-title">${isUpdate ? 'Actualizar HonduRaite' : 'Instalar HonduRaite'}</h2>
                <p class="apk-tutorial-sub">VersiÃ³n <strong>${esc(ver)}</strong> Â· descarga oficial desde la app</p>
            </div>

            <div class="apk-tutorial-trust">
                <p class="apk-tutorial-trust-title"><i class="fas fa-shield-alt"></i> Â¿Por quÃ© Google puede avisar?</p>
                <ul>
                    <li><strong>No es Play Store:</strong> publicamos el APK nosotros (igual que muchas apps locales y bancos en prueba).</li>
                    <li><strong>No es un virus:</strong> el aviso es automÃ¡tico en apps â€œde origen desconocidoâ€ o fuera de Google Play.</li>
                    <li><strong>Solo confÃ­a en este enlace:</strong> la descarga sale de HonduRaite / SOZIN, no de chats raros ni pÃ¡ginas ajenas.</li>
                    <li><strong>TÃº controlas:</strong> solo instalas si abriste la descarga desde aquÃ­.</li>
                </ul>
            </div>

            ${installTutorialStepsHtml()}

            <div class="apk-tutorial-actions">
                <button type="button" class="apk-tutorial-btn apk-tutorial-btn--primary" data-apk-tut-download>
                    <i class="fas fa-download"></i> ${isUpdate ? 'Descargar actualizaciÃ³n' : 'Descargar APK'}
                </button>
                <button type="button" class="apk-tutorial-btn apk-tutorial-btn--ghost" data-apk-tut-installed>
                    Ya instalÃ© esta versiÃ³n
                </button>
                <button type="button" class="apk-tutorial-btn apk-tutorial-btn--ghost" data-apk-tut-close>Cerrar</button>
            </div>
            <p class="apk-tutorial-foot">Empresa SOZIN Â· HonduRaite Honduras Â· El botÃ³n no reaparece hasta una nueva versiÃ³n</p>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
        installTutorialOpen = false;
        modal.remove();
    };
    modal.querySelectorAll('[data-apk-tut-close]').forEach((b) => b.addEventListener('click', close));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('[data-apk-tut-download]')?.addEventListener('click', async () => {
        const btn = modal.querySelector('[data-apk-tut-download]');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Abriendo descargaâ€¦';
        }
        const ok = await startApkDownload();
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-download"></i> ${isUpdate ? 'Descargar actualizaciÃ³n' : 'Descargar APK'}`;
        }
        // Cerrar tutorial solo si se abriÃ³ la descarga
        if (ok) close();
    });
    modal.querySelector('[data-apk-tut-installed]')?.addEventListener('click', () => {
        markApkDownloadedOrInstalled(cachedApkMeta?.buildId);
        syncAppDownloadBadge();
        close();
        window.showToast?.('Perfecto. No verÃ¡s el botÃ³n hasta que haya una actualizaciÃ³n nueva.', 'success');
    });
}

/* â€”â€” Modal: nueva versiÃ³n (usuarios con app instalada) â€”â€” */
function showApkUpdateModal({ force = false } = {}) {
    if (!hasApkUpdateAvailable() && !force) return;
    if (!cachedApkMeta?.url) return;
    if (!force && isUpdateSnoozed()) return;
    if (updateModalOpen && document.getElementById('apk-update-modal')) return;

    document.getElementById('apk-update-modal')?.remove();
    updateModalOpen = true;

    const ver = cachedApkMeta.version || 'nueva';
    const notes = cachedApkMeta.notes || '';
    const modal = document.createElement('div');
    modal.id = 'apk-update-modal';
    modal.className = 'apk-update-overlay';
    modal.innerHTML = `
        <div class="apk-update-sheet" role="dialog" aria-modal="true" aria-labelledby="apk-update-title">
            <div class="apk-update-icon"><i class="fas fa-rocket"></i></div>
            <h2 id="apk-update-title">Â¡Nueva versiÃ³n disponible!</h2>
            <p class="apk-update-text">
                Hay una actualizaciÃ³n de HonduRaite (<strong>v${esc(ver)}</strong>).
                Puedes actualizarla <strong>desde aquÃ­ mismo</strong> en un minuto.
            </p>
            ${notes ? `<p class="apk-update-notes">${esc(notes)}</p>` : ''}
            <p class="apk-update-hint">
                Android o Google pueden mostrar un aviso de seguridad: es normal en apps fuera de Play Store.
                Te guiamos paso a paso â€” no hay nada raro que temer si descargas solo desde este botÃ³n.
            </p>
            <button type="button" class="apk-update-btn apk-update-btn--gold" data-apk-upd-go>
                <i class="fas fa-download"></i> Actualizar ahora
            </button>
            <button type="button" class="apk-update-btn apk-update-btn--ghost" data-apk-upd-done>
                Ya actualicÃ©
            </button>
            <button type="button" class="apk-update-later" data-apk-upd-later>MÃ¡s tarde</button>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
        updateModalOpen = false;
        modal.remove();
    };

    modal.querySelector('[data-apk-upd-go]')?.addEventListener('click', () => {
        close();
        showInstallTutorial({ mode: 'update' });
    });
    modal.querySelector('[data-apk-upd-done]')?.addEventListener('click', () => {
        markApkDownloadedOrInstalled(cachedApkMeta?.buildId);
        clearUpdateSnooze();
        close();
        syncAppDownloadBadge();
        window.showToast?.('Perfecto. Gracias por actualizar. El aviso no saldrÃ¡ hasta la prÃ³xima versiÃ³n.', 'success');
    });
    modal.querySelector('[data-apk-upd-later]')?.addEventListener('click', () => {
        snoozeUpdate();
        close();
        syncAppDownloadBadge();
    });
}

export function maybeShowApkUpdateModal({ force = false } = {}) {
    if (!isInstalledAndroidApp()) return;
    if (!hasApkUpdateAvailable()) return;
    if (!force && isUpdateSnoozed()) return;
    // No interrumpir viaje activo (salvo force)
    if (!force && document.body.classList.contains('trip-active')) return;
    if (!force && document.body.classList.contains('map-pick-mode')) return;
    showApkUpdateModal({ force: true });
}

function bindBadgeDraggable(el) {
    if (!el || el.dataset.dragBound === '1') return;
    el.dataset.dragBound = '1';

    const handle = el.querySelector('[data-app-dl-drag]') || el;
    let pending = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;
    let pointerId = null;

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

    const loadPos = () => {
        try {
            const raw = localStorage.getItem(POS_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
            return p;
        } catch (_) {
            return null;
        }
    };

    const savePos = (x, y) => {
        try {
            localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
        } catch (_) {}
    };

    const apply = (x, y, persist = true) => {
        const w = el.offsetWidth || 200;
        const h = el.offsetHeight || 48;
        const cx = clamp(x, -w + 48, window.innerWidth - 48);
        const cy = clamp(y, 8, window.innerHeight - h - 8);
        el.style.position = 'fixed';
        el.style.left = `${cx}px`;
        el.style.top = `${cy}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.classList.add('is-drag-positioned');
        if (persist) savePos(cx, cy);
    };

    const saved = loadPos();
    if (saved) apply(saved.x, saved.y, false);

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        pending = true;
        dragging = false;
        startX = e.clientX;
        startY = e.clientY;
        pointerId = e.pointerId;
        const rect = el.getBoundingClientRect();
        origX = rect.left;
        origY = rect.top;
        try { e.preventDefault(); } catch (_) {}
        try { handle.setPointerCapture?.(e.pointerId); } catch (_) {}
    }, { passive: false });

    window.addEventListener('pointermove', (e) => {
        if (!pending && !dragging) return;
        if (pointerId != null && e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (pending && !dragging) {
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            pending = false;
            dragging = true;
            el.classList.add('is-dragging');
        }
        if (!dragging) return;
        e.preventDefault();
        apply(origX + dx, origY + dy);
    }, { passive: false });

    const end = (e) => {
        if (pointerId != null && e.pointerId !== pointerId) return;
        pending = false;
        if (dragging) {
            dragging = false;
            el.classList.remove('is-dragging');
        }
        pointerId = null;
        try { handle.releasePointerCapture?.(e.pointerId); } catch (_) {}
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    window.addEventListener('resize', () => {
        if (!el.classList.contains('is-drag-positioned') || el.classList.contains('hidden')) return;
        const rect = el.getBoundingClientRect();
        apply(rect.left, rect.top, true);
    }, { passive: true });
}

/**
 * Llamar al iniciar sesiÃ³n de pasajero o conductor (cada login).
 * Limpia solo la X de la sesiÃ³n. NO borra â€œya instalÃ©â€ (eso solo se resetea con update nueva).
 */
export function onPassengerAppBadgeSessionStart(uid) {
    const id = uid || getCurrentUser()?.uid || null;
    if (!id) return;
    // Misma sesiÃ³n de login: no tocar el estado de la X
    if (badgeSessionUid === id) {
        syncAppDownloadBadge();
        // Reintentar update en cada llamada (meta puede llegar tarde)
        Promise.resolve(refreshNativeAppInfo())
            .then(() => loadApkMeta())
            .then(() => {
                reactToNewRemotePublication();
                syncAppDownloadBadge();
                if (hasApkUpdateAvailable()) maybeShowApkUpdateModal({ force: true });
            })
            .catch(() => {});
        return;
    }
    badgeSessionUid = id;
    // Solo limpia la X temporal â€” si ya instalÃ³, el badge sigue oculto hasta nueva versiÃ³n
    try {
        sessionStorage.removeItem(DISMISS_KEY);
    } catch (_) {}
    // Nativo: al re-entrar, limpia snooze para ver updates
    try {
        localStorage.removeItem(UPDATE_SNOOZE_KEY);
    } catch (_) {}
    syncAppDownloadBadge();
    // Tras login: forzar chequeo de update (App.getInfo a veces llega tarde)
    Promise.resolve(refreshNativeAppInfo())
        .then(() => loadApkMeta())
        .then(() => {
            reactToNewRemotePublication();
            syncAppDownloadBadge();
            setTimeout(() => {
                if (hasApkUpdateAvailable()) maybeShowApkUpdateModal({ force: true });
            }, 1200);
            setTimeout(() => {
                refreshNativeAppInfo().then(() => {
                    syncAppDownloadBadge();
                    if (hasApkUpdateAvailable()) maybeShowApkUpdateModal({ force: true });
                });
            }, 4000);
        })
        .catch(() => {});
}

export function onPassengerAppBadgeSessionEnd() {
    badgeSessionUid = null;
    try {
        sessionStorage.removeItem(DISMISS_KEY);
    } catch (_) {}
}

/** Barra fija inferior: no depende del badge (CSS a veces lo oculta en driver-mode). */
function syncApkUpdateBanner() {
    const need = isInstalledAndroidApp()
        && hasApkUpdateAvailable()
        && !isUpdateSnoozed()
        && !document.body.classList.contains('map-pick-mode');
    let bar = document.getElementById('apk-update-force-bar');
    if (!need) {
        bar?.classList.add('hidden');
        // Solo mutar body si hace falta (evita reentrada del MutationObserver)
        if (document.body.classList.contains('apk-update-bar-visible')) {
            document.body.classList.remove('apk-update-bar-visible');
        }
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'apk-update-force-bar';
        bar.className = 'apk-update-force-bar';
        bar.innerHTML = `
            <div class="apk-update-force-bar-inner">
                <div class="apk-update-force-bar-text">
                    <strong>Nueva versiÃ³n de HonduRaite</strong>
                    <span id="apk-update-force-bar-ver"></span>
                </div>
                <button type="button" class="apk-update-force-bar-btn" data-apk-force-go>
                    Actualizar
                </button>
            </div>`;
        document.body.appendChild(bar);
        bar.querySelector('[data-apk-force-go]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showApkUpdateModal({ force: true });
        });
    }
    const verEl = bar.querySelector('#apk-update-force-bar-ver');
    if (verEl) {
        const v = cachedApkMeta?.version || '';
        const rc = resolveRemoteVersionCode(cachedApkMeta || {}) || cachedApkMeta?.versionCode || '';
        verEl.textContent = v
            ? ` Â· v${v}${rc ? ` (${rc})` : ''} disponible`
            : ' Â· hay una actualizaciÃ³n lista';
    }
    bar.classList.remove('hidden');
    if (!document.body.classList.contains('apk-update-bar-visible')) {
        document.body.classList.add('apk-update-bar-visible');
    }
}

export function syncAppDownloadBadge() {
    const el = ensureBadgeEl();
    const show = shouldShowDownloadBadge();
    el.classList.toggle('hidden', !show);
    try { syncApkUpdateBanner(); } catch (_) {}
    if (!show) return;

    const update = (isInstalledAndroidApp() && hasApkUpdateAvailable())
        || hasWebApkUpdateAvailable();
    const kicker = el.querySelector('.app-download-badge-kicker');
    const title = el.querySelector('.app-download-badge-title');
    const chevron = el.querySelector('.app-download-badge-chevron i');
    const ver = cachedApkMeta?.version;
    if (update) {
        if (kicker) kicker.textContent = ver ? `v${ver}` : 'Nueva';
        if (title) title.textContent = 'Actualiza la app';
        if (chevron) chevron.className = 'fas fa-sync-alt';
        el.classList.add('is-update');
    } else {
        if (kicker) kicker.textContent = ver ? `v${ver}` : 'HonduRaite';
        if (title) title.textContent = 'Descarga nuestra app';
        if (chevron) chevron.className = 'fas fa-download';
        el.classList.remove('is-update');
    }
}

function onApkMetaChanged() {
    // Primero leer versionCode del APK instalado, luego decidir si hay update
    Promise.resolve(refreshNativeAppInfo())
        .then(() => {
            reactToNewRemotePublication();
            return trySyncBuildFromNativeVersion();
        })
        .finally(() => {
            syncAppDownloadBadge();
            setTimeout(() => {
                syncAppDownloadBadge();
                maybeShowApkUpdateModal({ force: false });
            }, 600);
            // Reintento: a veces App.getInfo llega tarde en WebView
            setTimeout(() => {
                refreshNativeAppInfo().then(() => {
                    reactToNewRemotePublication();
                    trySyncBuildFromNativeVersion().finally(() => {
                        syncAppDownloadBadge();
                        if (hasApkUpdateAvailable()) {
                            // Si hay update real, forzar modal (limpia snooze viejo de otra versiÃ³n)
                            if (isUpdateSnoozed()) {
                                // solo respetar snooze si es la misma remote build
                                // (reactToNewRemotePublication ya limpia snooze en build nuevo)
                            }
                            maybeShowApkUpdateModal({ force: !isUpdateSnoozed() });
                            if (hasApkUpdateAvailable() && !isUpdateSnoozed()) {
                                maybeShowApkUpdateModal({ force: true });
                            }
                        }
                    });
                });
            }, 1800);
            setTimeout(() => {
                refreshNativeAppInfo().then(() => {
                    syncAppDownloadBadge();
                    if (hasApkUpdateAvailable() && !isUpdateSnoozed()
                        && !document.body.classList.contains('trip-active')) {
                        maybeShowApkUpdateModal({ force: true });
                    }
                });
            }, 5000);
        });
}

function startSettingsListener() {
    if (!dbRef || settingsUnsub) return;
    try {
        settingsUnsub = onSnapshot(settingsDocRef(), (snap) => {
            const d = snap.exists() ? (snap.data() || {}) : {};
            cachedApkMeta = metaFromDoc(d);
            onApkMetaChanged();
        }, (err) => console.warn('[app-download] settings listen:', err));
    } catch (e) {
        console.warn('[app-download] listener:', e);
        loadApkMeta().then(() => onApkMetaChanged());
    }
}

export function initAppDownload(opts = {}) {
    dbRef = opts.db;
    appIdRef = opts.appId;
    storageRef = opts.storage;
    getCurrentUser = opts.getCurrentUser || (() => null);
    getUserProfile = opts.getUserProfile || (() => null);
    isAdminFn = opts.isAdminUser || (() => false);

    window.renderAdminApkPanel = (container) => renderAdminApkPanel(container || document.getElementById('admin-users-list'));
    window.syncAppDownloadBadge = syncAppDownloadBadge;
    window.onPassengerAppBadgeSessionStart = onPassengerAppBadgeSessionStart;
    window.onPassengerAppBadgeSessionEnd = onPassengerAppBadgeSessionEnd;
    window.openApkDownload = openApkDownload;
    window.showApkInstallTutorial = () => showInstallTutorial({ mode: 'install' });
    window.showApkUpdateModal = () => showApkUpdateModal({ force: true });
    window.maybeShowApkUpdateModal = maybeShowApkUpdateModal;

    const boot = () => {
        ensureBadgeEl();
        startSettingsListener();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // OJO: no llamar sync en CADA class de body (boot/theme/ops cambian class a menudo).
    // Sin debounce/reentrancy se congela el main thread y el splash no termina.
    let badgeMoTimer = 0;
    let badgeMoRunning = false;
    const RELEVANT_BODY_CLASSES = ['trip-active', 'is-searching', 'map-pick-mode', 'driver-mode', 'client-mode'];
    const mo = new MutationObserver((mutations) => {
        if (badgeMoRunning) return;
        let relevant = false;
        for (const m of mutations) {
            if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
            const prev = String(m.oldValue || '');
            const next = String(document.body.className || '');
            // Ignorar cambios solo de apk-update-bar-visible (los provoca este mismo módulo)
            const prevSet = new Set(prev.split(/\s+/).filter(Boolean));
            const nextSet = new Set(next.split(/\s+/).filter(Boolean));
            for (const c of RELEVANT_BODY_CLASSES) {
                if (prevSet.has(c) !== nextSet.has(c)) {
                    relevant = true;
                    break;
                }
            }
            if (relevant) break;
        }
        if (!relevant) return;
        if (badgeMoTimer) clearTimeout(badgeMoTimer);
        badgeMoTimer = window.setTimeout(() => {
            badgeMoTimer = 0;
            if (badgeMoRunning) return;
            badgeMoRunning = true;
            try {
                syncAppDownloadBadge();
                if (!document.body.classList.contains('trip-active')
                    && !document.body.classList.contains('is-searching')) {
                    maybeShowApkUpdateModal({ force: false });
                }
            } catch (e) {
                console.warn('[app-download] body class observer', e);
            } finally {
                badgeMoRunning = false;
            }
        }, 120);
    });
    mo.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshNativeAppInfo()
                .then(() => trySyncBuildFromNativeVersion())
                .finally(() => {
                    syncAppDownloadBadge();
                    maybeShowApkUpdateModal({ force: false });
                });
        }
    });

    // Debug rÃ¡pido en consola WebView: window.__apkUpdateDebug()
    window.__apkUpdateDebug = async () => {
        await refreshNativeAppInfo();
        await loadApkMeta();
        reactToNewRemotePublication();
        const remoteCode = resolveRemoteVersionCode(cachedApkMeta || {}) || 0;
        const info = {
            isNative: isInstalledAndroidApp(),
            native: { ...nativeAppInfo },
            remote: cachedApkMeta,
            remoteCodeResolved: remoteCode,
            clientBuildId: getClientBuildId(),
            snoozed: isUpdateSnoozed(),
            hasUpdate: hasApkUpdateAvailable(),
        };
        console.log('[apk-update-debug]', info);
        try {
            window.showToast?.(
                !isInstalledAndroidApp()
                    ? 'No es APK nativo (navegador web)'
                    : hasApkUpdateAvailable()
                        ? `Update SÃ Â· app ${nativeAppInfo.version}(${nativeAppInfo.build}) < remoto ${cachedApkMeta?.version}(${remoteCode})`
                        : `Update NO Â· app ${nativeAppInfo.version || '?'}(${nativeAppInfo.build || 0}) Â· remoto ${cachedApkMeta?.version || 'â€”'}(${remoteCode}) Â· snooze ${isUpdateSnoozed()}`,
                hasApkUpdateAvailable() ? 'warning' : 'info'
            );
        } catch (_) {}
        return info;
    };

    /** Fuerza mostrar update (admin/pruebas): limpia snooze y reevalÃºa */
    window.__apkForceUpdateCheck = async () => {
        clearUpdateSnooze();
        setClientBuildId(null);
        try { localStorage.removeItem(WEB_INSTALLED_BUILD_KEY); } catch (_) {}
        try { localStorage.removeItem('honduber_apk_last_remote_build_id'); } catch (_) {}
        await refreshNativeAppInfo();
        await loadApkMeta();
        reactToNewRemotePublication();
        syncAppDownloadBadge();
        maybeShowApkUpdateModal({ force: true });
        return window.__apkUpdateDebug?.();
    };
}
