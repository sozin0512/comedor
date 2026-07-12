/**
 * Reportes de crashes, errores y sugerencias → admin / supervisores
 */

const RECENT_ERROR_KEY = 'honduber_recent_errors';
const ERROR_COOLDOWN_MS = 90000;

/** Patrones que no son bugs de la app (CDN cross-origin, browser quirks, extensiones). */
const NOISE_ERROR_PATTERNS = [
    /^Script error\.?$/i,
    /ResizeObserver loop/i,
    /Loading chunk [\d]+ failed/i,
    /Failed to fetch dynamically imported module/i,
    /Importing a module script failed/i,
    /ChunkLoadError/i,
    /^AbortError/i,
    /The user aborted a request/i,
    /The operation was aborted/i,
    /^Load failed$/i,
    /NetworkError when attempting to fetch resource/i,
    /Non-Error promise rejection captured/i,
    /^undefined$/i,
    /^null$/i,
    /^\[object (Event|Object)\]$/i,
];

function readRecentErrors() {
    try {
        return JSON.parse(sessionStorage.getItem(RECENT_ERROR_KEY) || '{}');
    } catch (_) {
        return {};
    }
}

function markErrorSent(fingerprint) {
    try {
        const map = readRecentErrors();
        map[fingerprint] = Date.now();
        // Limitar tamaño del mapa de cooldown
        const keys = Object.keys(map);
        if (keys.length > 40) {
            keys.sort((a, b) => (map[a] || 0) - (map[b] || 0))
                .slice(0, keys.length - 30)
                .forEach((k) => delete map[k]);
        }
        sessionStorage.setItem(RECENT_ERROR_KEY, JSON.stringify(map));
    } catch (_) {}
}

function shouldSendError(fingerprint) {
    const map = readRecentErrors();
    const last = map[fingerprint] || 0;
    return Date.now() - last > ERROR_COOLDOWN_MS;
}

function errorFingerprint(type, message, source) {
    const raw = `${type}|${(message || '').slice(0, 120)}|${source || ''}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
    return String(h);
}

/**
 * "Script error." es el mensaje genérico del navegador cuando un script de
 * otro dominio (Maps, Firebase CDN, etc.) falla y oculta el stack por CORS.
 * No aporta nada al panel admin y spamea usuarios nuevos (guest / sin perfil).
 */
function isNoiseError(message, details = '', meta = {}) {
    const msg = String(message || '').trim();
    const det = String(details || '');
    const source = String(meta.source || meta.filename || '');
    const combined = `${msg}\n${det}\n${source}`;

    // Fallos de carga de recursos (img/script/link) no son crashes de la app
    if (meta.isResourceError) return true;

    // Extensiones del navegador
    if (/chrome-extension:|moz-extension:|safari-extension:|webkit-masked-url/i.test(combined)) {
        return true;
    }

    // Classic cross-origin: mensaje vacío / "Script error." sin stack ni archivo
    const isScriptErrorLabel = !msg || /^Script error\.?$/i.test(msg);
    const hasUsefulStack = !!(meta.hasStack || /at\s+\S+|@\S+:\d+|:\d+:\d+/.test(det));
    const hasFilename = !!(meta.filename || (source && !/^unhandledrejection$/i.test(source)));
    if (isScriptErrorLabel && !hasUsefulStack && !hasFilename) {
        return true;
    }

    // Patrones benignos conocidos
    for (const re of NOISE_ERROR_PATTERNS) {
        if (re.test(msg)) return true;
    }

    // Rechazos de Firebase/permiso durante bootstrap (usuarios recién creados)
    if (/permission-denied|Missing or insufficient permissions/i.test(msg)
        && /artifacts\/|firestore/i.test(det)) {
        // Solo silenciar si aún no hay perfil (registro en curso)
        if (!window.userProfile?.role) return true;
    }

    return false;
}

function resolveFeedbackUserMeta(partial = {}) {
    const profile = window.userProfile || {};
    const user = window.currentUserFeedbackUser || null;
    const role = profile.role || partial.userRole || (user ? 'signed_in' : 'guest');
    const name = profile.name
        || partial.userName
        || (user?.displayName)
        || (user?.email ? String(user.email).split('@')[0] : null)
        || (user ? 'Usuario nuevo' : 'Usuario');

    return {
        userId: user?.uid || partial.userId || null,
        userName: name,
        userRole: role,
        userPhone: profile.phone || partial.userPhone || '',
        userEmail: profile.email || user?.email || partial.userEmail || ''
    };
}

export function buildFeedbackPayload(db, appId, partial = {}) {
    const userMeta = resolveFeedbackUserMeta(partial);

    return {
        type: partial.type || 'suggestion',
        message: (partial.message || '').slice(0, 2000),
        details: (partial.details || '').slice(0, 8000),
        ...userMeta,
        pageUrl: partial.pageUrl || (typeof location !== 'undefined' ? location.href : ''),
        userAgent: partial.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
        screenSize: partial.screenSize || (typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : ''),
        appVersion: partial.appVersion
            || (typeof document !== 'undefined'
                ? document.querySelector('meta[name="hr-app-version"]')?.content
                : '')
            || window.__HR_BUILD_VERSION__
            || '',
        status: 'new',
        ...partial,
        // partial no debe pisar userMeta con undefined
        userId: partial.userId ?? userMeta.userId,
        userName: partial.userName || userMeta.userName,
        userRole: partial.userRole || userMeta.userRole,
        userPhone: partial.userPhone || userMeta.userPhone,
        userEmail: partial.userEmail || userMeta.userEmail
    };
}

export async function submitAppFeedback(db, appId, collectionFn, addDocFn, serverTimestampFn, payload) {
    const data = buildFeedbackPayload(db, appId, payload);
    if (!data.message && !data.details) return null;

    const ref = await addDocFn(collectionFn(db, 'artifacts', appId, 'public', 'data', 'app_feedback'), {
        ...data,
        createdAt: serverTimestampFn()
    });
    return ref.id;
}

export function initCrashReporting({ db, appId, collection, addDoc, serverTimestamp, onSubmitted }) {
    if (window._honduberCrashReportingInit) return;
    window._honduberCrashReportingInit = true;

    const report = async (type, message, details = '', extra = {}) => {
        if (isNoiseError(message, details, extra)) {
            if (typeof console !== 'undefined' && console.debug) {
                console.debug('[crash-report] ignorado (ruido):', message);
            }
            return;
        }

        // Sin sesión no se puede escribir en app_feedback (reglas Firestore)
        if (!window.currentUserFeedbackUser?.uid && type !== 'bug_report') {
            return;
        }

        const fp = errorFingerprint(type, message, extra.source);
        if (!shouldSendError(fp)) return;

        try {
            await submitAppFeedback(db, appId, collection, addDoc, serverTimestamp, {
                type,
                message,
                details,
                source: extra.source || '',
                lineno: extra.lineno || 0,
                colno: extra.colno || 0
            });
            markErrorSent(fp);
            onSubmitted?.(type);
        } catch (e) {
            console.warn('submitAppFeedback failed:', e);
        }
    };

    window.addEventListener('error', (event) => {
        // Errores de carga de <script>/<img>/<link> (target ≠ window)
        const t = event.target;
        const isResourceError = !!(t && t !== window && t.nodeName
            && /^(SCRIPT|IMG|LINK|VIDEO|AUDIO|SOURCE)$/i.test(t.nodeName));

        const msg = event.message || (isResourceError
            ? `Fallo al cargar ${t.nodeName?.toLowerCase() || 'recurso'}`
            : 'Error de script');
        const details = [
            event.filename ? `Archivo: ${event.filename}` : '',
            event.lineno ? `Línea: ${event.lineno}:${event.colno || 0}` : '',
            isResourceError && t?.src ? `src: ${t.src}` : '',
            isResourceError && t?.href ? `href: ${t.href}` : '',
            event.error?.stack || ''
        ].filter(Boolean).join('\n');

        report('crash', msg, details, {
            source: event.filename || (isResourceError ? String(t?.src || t?.href || '') : ''),
            filename: event.filename || '',
            hasStack: !!event.error?.stack,
            isResourceError,
            lineno: event.lineno || 0,
            colno: event.colno || 0
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        let msg = 'Promise rechazada';
        let details = '';
        let hasStack = false;

        if (reason == null) {
            msg = 'Promise rechazada (sin detalle)';
        } else if (typeof reason === 'string') {
            msg = reason;
            details = reason;
        } else if (reason instanceof Error) {
            msg = reason.message || reason.name || 'Error';
            details = reason.stack || String(reason);
            hasStack = !!reason.stack;
        } else if (typeof reason === 'object') {
            msg = reason.message || reason.code || reason.name || String(reason);
            try {
                details = reason.stack || JSON.stringify(reason).slice(0, 2000);
            } catch (_) {
                details = String(reason);
            }
            hasStack = !!reason.stack;
        } else {
            msg = String(reason);
            details = String(reason);
        }

        report('error', msg, details, {
            source: 'unhandledrejection',
            hasStack
        });
    });

    window.reportAppIssue = (message, details = '') => report('bug_report', message, details);

    return report;
}

export function showSuggestionModal({ db, appId, collection, addDoc, serverTimestamp, showToast }) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/70 z-[50000] flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-3xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h3 class="font-black text-xl text-gray-900 mb-1">Enviar sugerencia</h3>
            <p class="text-gray-500 text-xs mb-4">Cuéntanos una idea para mejorar HonduRaite. Lo verán admin y supervisores.</p>
            <textarea id="feedback-suggestion-text" placeholder="Ej: Me gustaría poder ver el historial de viajes..."
                class="w-full p-4 rounded-2xl border border-gray-200 bg-gray-50 text-sm h-32 resize-none outline-none focus:border-blue-500 mb-3"></textarea>
            <button type="button" id="feedback-suggestion-send"
                class="w-full bg-blue-600 text-white font-black py-4 rounded-2xl text-sm mb-2">ENVIAR SUGERENCIA</button>
            <button type="button" onclick="this.closest('.fixed').remove()"
                class="w-full py-3 text-gray-500 text-sm font-bold">Cancelar</button>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#feedback-suggestion-send').onclick = async (e) => {
        const btn = e.currentTarget;
        const text = document.getElementById('feedback-suggestion-text')?.value?.trim();
        if (!text || text.length < 5) return showToast?.('Escribe al menos 5 caracteres.', 'warning');

        btn.disabled = true;
        btn.innerText = 'ENVIANDO...';

        try {
            await submitAppFeedback(db, appId, collection, addDoc, serverTimestamp, {
                type: 'suggestion',
                message: text
            });
            modal.remove();
            showToast?.('¡Gracias! Tu sugerencia fue enviada al equipo.', 'success');
        } catch (err) {
            console.error(err);
            showToast?.('No se pudo enviar. Intenta de nuevo.');
            btn.disabled = false;
            btn.innerText = 'ENVIAR SUGERENCIA';
        }
    };
}

export function showBugReportModal({ db, appId, collection, addDoc, serverTimestamp, showToast }) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/70 z-[50000] flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-3xl w-full max-w-md p-6">
            <h3 class="font-black text-xl text-gray-900 mb-1">Reportar problema</h3>
            <p class="text-gray-500 text-xs mb-4">Si la app falló o algo no funciona, descríbelo aquí.</p>
            <textarea id="feedback-bug-text" placeholder="¿Qué estabas haciendo cuando falló?"
                class="w-full p-4 rounded-2xl border border-gray-200 bg-gray-50 text-sm h-28 resize-none outline-none focus:border-amber-500 mb-3"></textarea>
            <button type="button" id="feedback-bug-send"
                class="w-full bg-amber-600 text-white font-black py-4 rounded-2xl text-sm mb-2">ENVIAR REPORTE</button>
            <button type="button" onclick="this.closest('.fixed').remove()"
                class="w-full py-3 text-gray-500 text-sm font-bold">Cancelar</button>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#feedback-bug-send').onclick = async (e) => {
        const btn = e.currentTarget;
        const text = document.getElementById('feedback-bug-text')?.value?.trim();
        if (!text || text.length < 5) return showToast?.('Describe el problema brevemente.', 'warning');

        btn.disabled = true;
        btn.innerText = 'ENVIANDO...';

        try {
            await submitAppFeedback(db, appId, collection, addDoc, serverTimestamp, {
                type: 'bug_report',
                message: text,
                details: `Reporte manual · ${new Date().toISOString()}`
            });
            modal.remove();
            showToast?.('Reporte enviado. Gracias por ayudarnos a mejorar.', 'success');
        } catch (err) {
            showToast?.('Error al enviar el reporte.');
            btn.disabled = false;
            btn.innerText = 'ENVIAR REPORTE';
        }
    };
}

export function isAppFeedbackAlert(entry) {
    return ['crash', 'error', 'suggestion', 'bug_report'].includes(entry.type);
}

export function renderAppFeedbackCard(entry, options = {}) {
    const { markReviewed, isAdmin = false } = options;
    const date = entry.createdAt?.toDate ? entry.createdAt.toDate().toLocaleString('es-HN') : '';
    const typeLabels = {
        crash: { label: 'CRASH', color: 'red', icon: 'fa-bomb' },
        error: { label: 'ERROR', color: 'orange', icon: 'fa-bug' },
        suggestion: { label: 'SUGERENCIA', color: 'blue', icon: 'fa-lightbulb' },
        bug_report: { label: 'PROBLEMA', color: 'amber', icon: 'fa-exclamation-circle' }
    };
    const meta = typeLabels[entry.type] || typeLabels.bug_report;
    const statusBadge = entry.status === 'reviewed'
        ? '<span class="text-[9px] font-black text-emerald-400 bg-emerald-900/40 px-2 py-0.5 rounded-full">REVISADO</span>'
        : '<span class="text-[9px] font-black text-amber-400 bg-amber-900/40 px-2 py-0.5 rounded-full">NUEVO</span>';

    const borderColors = { red: 'border-red-800', orange: 'border-orange-800', blue: 'border-blue-800', amber: 'border-amber-800' };
    const bgColors = { red: 'bg-red-900/30', orange: 'bg-orange-900/30', blue: 'bg-blue-900/30', amber: 'bg-amber-900/30' };
    const textColors = { red: 'text-red-300', orange: 'text-orange-300', blue: 'text-blue-300', amber: 'text-amber-300' };

    return `
        <div class="${bgColors[meta.color]} p-4 rounded-2xl border ${borderColors[meta.color]} shadow-md mb-2">
            <div class="flex justify-between items-start gap-2 border-b ${borderColors[meta.color]} pb-2 mb-2">
                <span class="font-black text-[10px] uppercase ${textColors[meta.color]} tracking-widest">
                    <i class="fas ${meta.icon}"></i> ${meta.label}
                </span>
                ${statusBadge}
            </div>
            <p class="text-white text-sm font-semibold">${(entry.message || '').replace(/</g, '&lt;')}</p>
            ${entry.details ? `<pre class="text-[9px] text-gray-400 mt-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto bg-black/20 p-2 rounded-xl">${String(entry.details).replace(/</g, '&lt;').slice(0, 1500)}</pre>` : ''}
            <div class="mt-2 text-[10px] text-gray-400 space-y-0.5">
                <p><b class="text-gray-300">Usuario:</b> ${entry.userName || 'N/D'} (${entry.userRole || '—'})</p>
                ${entry.userPhone ? `<p><b class="text-gray-300">Tel:</b> ${entry.userPhone}</p>` : ''}
                ${entry.userEmail ? `<p><b class="text-gray-300">Email:</b> ${entry.userEmail}</p>` : ''}
                <p class="text-[9px]">${date}</p>
            </div>
            ${entry.status !== 'reviewed' ? `
                <button type="button" onclick="window.markAppFeedbackReviewed('${entry.id}')"
                    class="mt-3 w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-[10px] font-black rounded-xl">
                    MARCAR COMO REVISADO
                </button>
            ` : ''}
        </div>
    `;
}