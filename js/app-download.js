/**
 * Admin: subir APK · Usuario web: badge dorado · App instalada: aviso de nueva versión + tutorial
 */
import {
    ref, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import {
    doc, getDoc, setDoc, serverTimestamp, onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { isCapacitorNative, isCapacitorAndroid, openExternalUrl } from './capacitor-native.js';

const SETTINGS_DOC = 'main';
/** Solo oculta el badge en la sesión actual (X) — se limpia en cada login */
const DISMISS_KEY = 'honduber_apk_badge_dismissed';
/** Build del APK que el usuario ya descargó/instaló — no mostrar de nuevo hasta una versión más nueva */
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
/** Evita re-mostrar el badge en cada snapshot de perfil dentro de la misma sesión de login */
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
        if (!d || Number.isNaN(d.getTime())) return '—';
        return d.toLocaleString('es-HN', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) {
        return '—';
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

function metaFromDoc(d) {
    if (!d?.androidApkUrl) return null;
    return {
        url: d.androidApkUrl,
        fileName: d.androidApkFileName || 'HonduRaite.apk',
        version: d.androidApkVersion || '',
        buildId: Number(d.androidApkBuildId) || 0,
        size: d.androidApkSize || 0,
        uploadedAt: d.androidApkUploadedAt || null,
        storagePath: d.androidApkStoragePath || null,
        notes: d.androidApkNotes || '',
    };
}

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

/** Marca que el usuario ya descargó/instaló este APK (no mostrar hasta update). */
function markApkDownloadedOrInstalled(buildId = cachedApkMeta?.buildId) {
    const id = Number(buildId) || Number(cachedApkMeta?.buildId) || 0;
    if (!id) return;
    try {
        localStorage.setItem(WEB_INSTALLED_BUILD_KEY, String(id));
    } catch (_) {}
    setClientBuildId(id);
    try { sessionStorage.removeItem(DISMISS_KEY); } catch (_) {}
}

/** En web: hay APK nuevo respecto al que ya descargó/instaló. */
function hasWebApkUpdateAvailable() {
    if (!cachedApkMeta?.url || !cachedApkMeta.buildId) return false;
    const installed = getWebInstalledBuildId();
    if (installed == null) return false; // nunca instaló → no es "update", es primera descarga
    return Number(cachedApkMeta.buildId) > Number(installed);
}

/** Ya tiene esta versión (o superior) marcada como instalada. */
function alreadyHasCurrentApkOnWeb() {
    if (!cachedApkMeta?.buildId) return false;
    const installed = getWebInstalledBuildId();
    if (installed == null) return false;
    return Number(installed) >= Number(cachedApkMeta.buildId);
}

function isUpdateSnoozed() {
    try {
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
 * ¿Hay APK más nuevo que el que el cliente tiene marcado?
 * Primera vez que ve el build: se registra sin molestar (asume ya instalado).
 */
export function hasApkUpdateAvailable() {
    if (!isInstalledAndroidApp()) return false;
    if (!cachedApkMeta?.url || !cachedApkMeta.buildId) return false;
    const client = getClientBuildId();
    if (client == null) {
        setClientBuildId(cachedApkMeta.buildId);
        return false;
    }
    return Number(cachedApkMeta.buildId) > Number(client);
}

async function trySyncBuildFromNativeVersion() {
    if (!isInstalledAndroidApp() || !cachedApkMeta?.buildId) return;
    try {
        const App = window.Capacitor?.Plugins?.App;
        if (!App?.getInfo) return;
        const info = await App.getInfo();
        const nativeVer = String(info?.version || '').trim();
        const remoteVer = String(cachedApkMeta.version || '').trim();
        if (nativeVer && remoteVer && nativeVer === remoteVer) {
            setClientBuildId(cachedApkMeta.buildId);
            clearUpdateSnooze();
        }
    } catch (_) {}
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

function renderAdminMetaHtml(meta) {
    if (!meta?.url) {
        return `
            <div class="admin-apk-status admin-apk-status--empty">
                <p class="admin-apk-status-badge"><i class="fas fa-cloud"></i> Sin APK en el servidor</p>
                <p class="text-sm text-slate-400 mt-2">Aún no hay archivo publicado. Abajo elige o arrastra un <strong class="text-amber-300">.apk</strong> y pulsa <strong class="text-white">Publicar</strong>.</p>
            </div>`;
    }
    return `
        <div class="admin-apk-status admin-apk-status--live">
            <p class="admin-apk-status-badge admin-apk-status-badge--ok">
                <i class="fas fa-check-circle"></i> APK ya está en el servidor · LISTO
            </p>
            <div class="admin-apk-status-grid mt-3 space-y-1.5 text-sm">
                <p class="text-slate-300"><span class="text-slate-500">Archivo:</span> <strong>${esc(meta.fileName)}</strong></p>
                <p class="text-slate-300"><span class="text-slate-500">Versión:</span> <strong class="text-amber-200">${esc(meta.version || '—')}</strong></p>
                <p class="text-slate-300"><span class="text-slate-500">Build ID:</span> ${esc(meta.buildId || '—')}</p>
                <p class="text-slate-300"><span class="text-slate-500">Tamaño:</span> ${esc(formatBytes(meta.size))}</p>
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
        U.hero('App Android (APK)', 'Publica versiones · avisa a quienes ya la tienen instalada') +
        `<div class="ops-stack">` +
        U.formPanel('APK actual', 'Enlace público de descarga', `
            <div id="admin-apk-meta"><p class="text-slate-400 text-sm">Cargando…</p></div>
            <div class="flex flex-wrap gap-2 mt-3">
                <button type="button" id="admin-apk-remove" class="ops-btn ops-btn--danger text-xs hidden">
                    <i class="fas fa-trash"></i> Quitar APK
                </button>
            </div>
        `) +
        U.formPanel('Subir nuevo APK', '1) Elige archivo · 2) Pulsa Publicar · 3) Espera la barra al 100%', `
            <p id="admin-apk-step-hint" class="admin-apk-step-hint">Paso 1 de 3: elige o arrastra el archivo .apk</p>
            <div id="admin-apk-drop" class="admin-apk-drop" tabindex="0" role="button" aria-label="Zona para soltar APK">
                <input type="file" id="admin-apk-file" accept=".apk,application/vnd.android.package-archive" class="hidden">
                <div class="admin-apk-drop-inner" id="admin-apk-drop-inner">
                    <i class="fab fa-android text-4xl text-emerald-400 mb-2" id="admin-apk-drop-icon"></i>
                    <p class="font-black text-white text-sm" id="admin-apk-drop-title">Arrastra tu APK aquí</p>
                    <p class="text-xs text-slate-400 mt-1" id="admin-apk-drop-sub">o toca para elegir archivo</p>
                    <p class="text-[10px] text-slate-500 mt-2">Elegir archivo <strong>no lo sube</strong> todavía · luego pulsa Publicar</p>
                </div>
            </div>
            <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label class="text-xs text-slate-400 font-bold">Versión visible (recomendada)</label>
                    <input id="admin-apk-version" class="ops-input mt-1" maxlength="32" placeholder="Ej: 2026.07.09.1">
                </div>
                <div>
                    <label class="text-xs text-slate-400 font-bold">Notas (opcional)</label>
                    <input id="admin-apk-notes" class="ops-input mt-1" maxlength="120" placeholder="Mejoras y correcciones">
                </div>
            </div>
            <button type="button" id="admin-apk-upload-btn" class="ops-btn ops-btn--emerald ops-btn--full mt-3" disabled>
                <i class="fas fa-cloud-upload-alt"></i> Publicar y notificar actualización
            </button>
            <div id="admin-apk-progress-wrap" class="admin-apk-progress-wrap hidden mt-3" aria-live="polite">
                <div class="flex justify-between text-xs text-slate-300 mb-1.5 font-bold">
                    <span id="admin-apk-progress-label"><i class="fas fa-spinner fa-spin"></i> Subiendo al servidor…</span>
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

    const meta = await loadApkMeta();
    const metaEl = document.getElementById('admin-apk-meta');
    if (metaEl) metaEl.innerHTML = renderAdminMetaHtml(meta);
    const removeBtn = document.getElementById('admin-apk-remove');
    if (removeBtn) removeBtn.classList.toggle('hidden', !meta?.url);
    if (meta?.version) {
        const vIn = document.getElementById('admin-apk-version');
        if (vIn && !vIn.value) vIn.placeholder = `Última: ${meta.version}`;
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
                uploadBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publicar y notificar actualización';
            }
            if (selectedEl) {
                selectedEl.classList.add('hidden');
                selectedEl.textContent = '';
            }
            drop?.classList.remove('is-ready', 'is-uploading');
            if (stepHint) stepHint.textContent = 'Paso 1 de 3: elige o arrastra el archivo .apk';
            if (dropTitle) dropTitle.textContent = 'Arrastra tu APK aquí';
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
            uploadBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publicar y notificar actualización';
        }
        if (selectedEl) {
            selectedEl.classList.remove('hidden');
            selectedEl.innerHTML = `<i class="fas fa-file-archive"></i> Listo para subir: <strong>${esc(file.name)}</strong> (${formatBytes(file.size)}) — aún <u>no está en el servidor</u> hasta que pulses Publicar.`;
        }
        drop?.classList.add('is-ready');
        drop?.classList.remove('is-uploading');
        if (stepHint) stepHint.textContent = 'Paso 2 de 3: pulsa el botón verde «Publicar» para subir al servidor';
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
        if (stepHint) stepHint.textContent = 'Paso 3 de 3: subiendo… no cierres esta pestaña';
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
                resultEl.innerHTML = '<i class="fas fa-check-circle"></i> Subida completa. Arriba en «APK actual» verás el archivo publicado.';
            }
            if (stepHint) stepHint.textContent = 'Listo. El APK ya está en el servidor (mira el cuadro de arriba).';
            syncAppDownloadBadge();
            maybeShowApkUpdateModal({ force: false });
        } else if (stepHint) {
            stepHint.textContent = 'Error al subir. Revisa el mensaje e intenta de nuevo.';
        }
    });

    removeBtn?.addEventListener('click', async () => {
        if (!confirm('¿Quitar el APK publicado? Los usuarios ya no verán descarga ni actualizaciones.')) return;
        await removeAndroidApk();
        if (metaEl) metaEl.innerHTML = renderAdminMetaHtml(null);
        removeBtn.classList.add('hidden');
        syncAppDownloadBadge();
    });
}

/** @returns {Promise<boolean>} true si quedó publicado en el servidor */
async function uploadAndroidApk(file, { version = '', notes = '' } = {}) {
    if (!isAdminFn(getCurrentUser(), getUserProfile())) {
        window.showToast?.('Solo el administrador puede subir el APK.', 'error');
        return false;
    }
    if (!storageRef || !dbRef) {
        window.showToast?.('Storage no está listo.', 'error');
        return false;
    }
    if (!isApkFile(file)) {
        window.showToast?.('Archivo inválido. Usa un .apk', 'warning');
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
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo… no cierres la pestaña';
    }
    if (labelEl) {
        labelEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo al servidor…';
    }
    drop?.classList.add('is-uploading');
    window.showToast?.('Subiendo APK… verás el % abajo. No cierres esta página.', 'info');

    const path = apkStoragePath(file.name.endsWith('.apk') ? file.name : 'honduraite.apk');
    const storageFileRef = ref(storageRef, path);
    const buildId = Date.now();
    const versionLabel = version || `build-${buildId}`;

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
                        detailEl.textContent = `${formatBytes(done)} / ${formatBytes(total)} · ${pct}%`;
                    }
                    if (labelEl) {
                        labelEl.innerHTML = pct < 100
                            ? `<i class="fas fa-spinner fa-spin"></i> Subiendo… ${pct}%`
                            : '<i class="fas fa-cog fa-spin"></i> Guardando enlace…';
                    }
                },
                reject,
                resolve
            );
        });

        if (labelEl) {
            labelEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando en la base de datos…';
        }
        const url = await getDownloadURL(storageFileRef);
        await setDoc(settingsDocRef(), {
            androidApkUrl: url,
            androidApkFileName: file.name,
            androidApkVersion: versionLabel,
            androidApkBuildId: buildId,
            androidApkNotes: notes || null,
            androidApkSize: file.size,
            androidApkStoragePath: path,
            androidApkUploadedAt: serverTimestamp(),
            androidApkUploadedBy: getCurrentUser()?.uid || null,
            updatedAt: serverTimestamp(),
        }, { merge: true });

        // Admin que sube no debería verse forzado a actualizar con este build
        setClientBuildId(buildId);

        if (labelEl) {
            labelEl.innerHTML = '<i class="fas fa-check-circle text-emerald-400"></i> ¡Publicado en el servidor!';
        }
        if (fill) fill.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';
        if (detailEl) detailEl.textContent = `${formatBytes(file.size)} / ${formatBytes(file.size)} · 100%`;
        if (uploadBtn) {
            uploadBtn.innerHTML = '<i class="fas fa-check"></i> Publicado correctamente';
        }
        window.showToast?.('APK publicado. Arriba verás «APK ya está en el servidor».', 'success');
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
        if (detailEl) detailEl.textContent = 'La subida falló. Revisa reglas de Storage e internet.';
        window.showToast?.(msg, 'error');
        return false;
    } finally {
        drop?.classList.remove('is-uploading');
        if (uploadBtn) {
            uploadBtn.disabled = false;
            if (!uploadBtn.innerHTML.includes('Publicado')) {
                uploadBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publicar y notificar actualización';
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
    // App nativa Android: solo si hay versión nueva
    if (isInstalledAndroidApp()) {
        if (document.body.classList.contains('trip-active')) return false;
        if (document.body.classList.contains('map-pick-mode')) return false;
        return hasApkUpdateAvailable() && !isUpdateSnoozed();
    }
    if (isCapacitorNative()) return false;
    if (!cachedApkMeta?.url) return false;

    // Ya instaló/descargó esta versión → no mostrar hasta que haya otra actualización
    if (alreadyHasCurrentApkOnWeb()) return false;

    // Si ya instaló antes y hay build más nuevo → sí mostrar (actualizar)
    // Si nunca instaló → mostrar (primera descarga)

    try {
        if (sessionStorage.getItem(DISMISS_KEY) === '1') return false;
    } catch (_) {}
    const profile = getUserProfile();
    const role = profile?.role || 'client';
    // Pasajeros y conductores (misma app APK). Staff de ops no necesita el badge.
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
        <button type="button" class="app-download-badge-drag" data-app-dl-drag title="Mover" aria-label="Mover botón">
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
        // X: ocultar solo hasta el próximo inicio de sesión (login)
        try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
        if (isInstalledAndroidApp()) {
            // En app nativa, la X también pospone el aviso de update hasta el próximo login
            snoozeUpdate();
        }
        el.classList.add('hidden');
        window.showToast?.('Oculto por ahora. Volverá a salir al iniciar sesión de nuevo.', 'info');
    });

    bindBadgeDraggable(el);
    return el;
}

/**
 * Inicia la descarga del APK.
 * En Android/Capacitor NO se puede usar <a download> (Firebase es otra origen y el WebView lo bloquea).
 * Se abre el navegador del celular para que el sistema gestione la descarga.
 */
async function startApkDownload() {
    const url = cachedApkMeta?.url;
    if (!url) {
        window.showToast?.('La descarga aún no está disponible.', 'warning');
        return false;
    }

    const fileName = cachedApkMeta.fileName || 'HonduRaite.apk';
    const onAndroid = isCapacitorAndroid()
        || isCapacitorNative()
        || /Android/i.test(navigator.userAgent || '');

    window.showToast?.(
        onAndroid
            ? 'Abriendo el navegador del celular para descargar el APK…'
            : 'Iniciando descarga del APK…',
        'info'
    );

    let opened = false;
    try {
        // Preferir navegador del sistema (funciona en Capacitor + Chrome móvil)
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
            // Solo en desktop/web el attr download puede ayudar si es same-origin
            if (!onAndroid) a.setAttribute('download', fileName);
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
            'No se pudo abrir la descarga. Copia el enlace desde Admin → App Android o prueba en Chrome.',
            'error'
        );
        return false;
    }

    // Tras abrir el enlace: marcar como “ya descargó esta versión”
    markApkDownloadedOrInstalled(cachedApkMeta.buildId);
    syncAppDownloadBadge();
    window.showToast?.(
        onAndroid
            ? 'Si no empieza sola, toca la notificación de descarga o abre Descargas e instala el APK.'
            : 'Descarga iniciada. Abre el archivo e instálalo cuando termine.',
        'success'
    );
    return true;
}

function openApkDownload() {
    showInstallTutorial({ mode: isInstalledAndroidApp() ? 'update' : 'install' });
}

/* —— Tutorial de instalación / confianza (Play Protect) —— */
function installTutorialStepsHtml() {
    const androidHint = isCapacitorAndroid() || isCapacitorNative() || /Android/i.test(navigator.userAgent || '');
    return `
        <ol class="apk-tutorial-steps">
            <li>
                <span class="apk-tutorial-num">1</span>
                <div>
                    <strong>Toca “Descargar APK”</strong>
                    <p>${androidHint
                        ? 'Se abrirá el <b>navegador del celular</b> (Chrome u otro) y ahí empieza la descarga. No se descarga dentro de la app.'
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
                    <strong>Si Android pregunta “¿Permitir de esta fuente?”</strong>
                    <p>Activa <em>Permitir de esta fuente</em> solo para Chrome / Archivos / el navegador que uses. Es normal fuera de Play Store.</p>
                </div>
            </li>
            <li>
                <span class="apk-tutorial-num">4</span>
                <div>
                    <strong>Si sale “Play Protect” o “app bloqueada”</strong>
                    <p>Toca <em>Más detalles</em> → <em>Instalar de todos modos</em> (o <em>Instalar igualmente</em>). Google avisa porque la app no viene de su tienda, no porque sea virus.</p>
                </div>
            </li>
            <li>
                <span class="apk-tutorial-num">5</span>
                <div>
                    <strong>Confirma Instalar</strong>
                    <p>Al terminar, abre HonduRaite. Tus datos de sesión se mantienen en la mayoría de actualizaciones.</p>
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
        return window.showToast?.('Aún no hay APK publicado.', 'warning');
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
                <p class="apk-tutorial-sub">Versión <strong>${esc(ver)}</strong> · descarga oficial desde la app</p>
            </div>

            <div class="apk-tutorial-trust">
                <p class="apk-tutorial-trust-title"><i class="fas fa-shield-alt"></i> ¿Por qué Google puede avisar?</p>
                <ul>
                    <li><strong>No es Play Store:</strong> publicamos el APK nosotros (igual que muchas apps locales y bancos en prueba).</li>
                    <li><strong>No es un virus:</strong> el aviso es automático en apps “de origen desconocido” o fuera de Google Play.</li>
                    <li><strong>Solo confía en este enlace:</strong> la descarga sale de HonduRaite / SOZIN, no de chats raros ni páginas ajenas.</li>
                    <li><strong>Tú controlas:</strong> solo instalas si abriste la descarga desde aquí.</li>
                </ul>
            </div>

            ${installTutorialStepsHtml()}

            <div class="apk-tutorial-actions">
                <button type="button" class="apk-tutorial-btn apk-tutorial-btn--primary" data-apk-tut-download>
                    <i class="fas fa-download"></i> ${isUpdate ? 'Descargar actualización' : 'Descargar APK'}
                </button>
                <button type="button" class="apk-tutorial-btn apk-tutorial-btn--ghost" data-apk-tut-installed>
                    Ya instalé esta versión
                </button>
                <button type="button" class="apk-tutorial-btn apk-tutorial-btn--ghost" data-apk-tut-close>Cerrar</button>
            </div>
            <p class="apk-tutorial-foot">Empresa SOZIN · HonduRaite Honduras · El botón no reaparece hasta una nueva versión</p>
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
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Abriendo descarga…';
        }
        const ok = await startApkDownload();
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-download"></i> ${isUpdate ? 'Descargar actualización' : 'Descargar APK'}`;
        }
        // Cerrar tutorial solo si se abrió la descarga
        if (ok) close();
    });
    modal.querySelector('[data-apk-tut-installed]')?.addEventListener('click', () => {
        markApkDownloadedOrInstalled(cachedApkMeta?.buildId);
        syncAppDownloadBadge();
        close();
        window.showToast?.('Perfecto. No verás el botón hasta que haya una actualización nueva.', 'success');
    });
}

/* —— Modal: nueva versión (usuarios con app instalada) —— */
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
            <h2 id="apk-update-title">¡Nueva versión disponible!</h2>
            <p class="apk-update-text">
                Hay una actualización de HonduRaite (<strong>v${esc(ver)}</strong>).
                Puedes actualizarla <strong>desde aquí mismo</strong> en un minuto.
            </p>
            ${notes ? `<p class="apk-update-notes">${esc(notes)}</p>` : ''}
            <p class="apk-update-hint">
                Android o Google pueden mostrar un aviso de seguridad: es normal en apps fuera de Play Store.
                Te guiamos paso a paso — no hay nada raro que temer si descargas solo desde este botón.
            </p>
            <button type="button" class="apk-update-btn apk-update-btn--gold" data-apk-upd-go>
                <i class="fas fa-download"></i> Actualizar ahora
            </button>
            <button type="button" class="apk-update-btn apk-update-btn--ghost" data-apk-upd-done>
                Ya actualicé
            </button>
            <button type="button" class="apk-update-later" data-apk-upd-later>Más tarde</button>
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
        window.showToast?.('Perfecto. Gracias por actualizar. El aviso no saldrá hasta la próxima versión.', 'success');
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
    // No interrumpir viaje activo
    if (document.body.classList.contains('trip-active')) return;
    if (document.body.classList.contains('map-pick-mode')) return;
    showApkUpdateModal({ force });
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
 * Llamar al iniciar sesión de pasajero o conductor (cada login).
 * Limpia solo la X de la sesión. NO borra “ya instalé” (eso solo se resetea con update nueva).
 */
export function onPassengerAppBadgeSessionStart(uid) {
    const id = uid || getCurrentUser()?.uid || null;
    if (!id) return;
    // Misma sesión de login: no tocar el estado de la X
    if (badgeSessionUid === id) {
        syncAppDownloadBadge();
        return;
    }
    badgeSessionUid = id;
    // Solo limpia la X temporal — si ya instaló, el badge sigue oculto hasta nueva versión
    try {
        sessionStorage.removeItem(DISMISS_KEY);
    } catch (_) {}
    // Nativo: al re-entrar, si hay update pendiente y no está snoozed… (snooze se limpia para ver updates)
    try {
        localStorage.removeItem(UPDATE_SNOOZE_KEY);
    } catch (_) {}
    syncAppDownloadBadge();
}

export function onPassengerAppBadgeSessionEnd() {
    badgeSessionUid = null;
    try {
        sessionStorage.removeItem(DISMISS_KEY);
    } catch (_) {}
}

export function syncAppDownloadBadge() {
    const el = ensureBadgeEl();
    const show = shouldShowDownloadBadge();
    el.classList.toggle('hidden', !show);
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
    syncAppDownloadBadge();
    trySyncBuildFromNativeVersion().finally(() => {
        // Pequeño delay para no chocar con el boot
        setTimeout(() => maybeShowApkUpdateModal({ force: false }), 1400);
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

    const mo = new MutationObserver(() => {
        syncAppDownloadBadge();
        // Si termina un viaje, reintentar aviso de update
        if (!document.body.classList.contains('trip-active')
            && !document.body.classList.contains('is-searching')) {
            maybeShowApkUpdateModal({ force: false });
        }
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            trySyncBuildFromNativeVersion().finally(() => maybeShowApkUpdateModal({ force: false }));
        }
    });
}
