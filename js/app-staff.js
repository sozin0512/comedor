/** Runtime staff: estadísticas, depósitos y personalización. Tras login admin/supervisor. */
import { collection, getDocs, getDoc, doc, setDoc, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { APP_CONFIG } from './config.js';
import { getCustomTones, saveTonePrefs, listTones, getMaxCustomBytes, getPlatformToneLabel } from './notification-tones.js';
import { storeReferralFromURL, showReferralInviteModal, getPendingReferralCode } from './referrals.js';
import { isCapacitorNative } from './capacitor-native.js';
import { showEnlargedPhoto } from './photo-viewer.js';

import { formatLempiras } from './money-format.js';
import {
    computeGlobalStatsSnapshot,
    buildGlobalStatsCsv,
    buildStatsFiltersToolbarHtml,
    renderGlobalStatsHtml,
    isTripTrashed,
} from "./stats-engine.js";
export function installStaffRuntime() {
    if (window.__hrStaffRuntime) return;
    window.__hrStaffRuntime = true;
    const db = window.db;
    const appId = window.appId;
// ================================================
// ESTADÍSTICAS GLOBALES (Admin y Supervisión)
// ================================================
window._globalStatsState = window._globalStatsState || {
    period: "today",
    city: "all",
    from: "",
    to: "",
};

window.applyGlobalStatsFilter = () => {
    const cityEl = document.getElementById("stats-city-filter");
    const fromEl = document.getElementById("stats-date-from");
    const toEl = document.getElementById("stats-date-to");
    const city = cityEl ? cityEl.value : (window._globalStatsState.city || "all");
    const from = fromEl ? fromEl.value : (window._globalStatsState.from || "");
    const to = toEl ? toEl.value : (window._globalStatsState.to || "");
    const period = (from || to) ? "custom" : (window._globalStatsState.period || "today");
    return window.loadGlobalStats(period, null, { city, from, to });
};

window.applyGlobalStatsDateRange = () => {
    const cityEl = document.getElementById("stats-city-filter");
    const fromEl = document.getElementById("stats-date-from");
    const toEl = document.getElementById("stats-date-to");
    const city = cityEl ? cityEl.value : (window._globalStatsState.city || "all");
    const from = fromEl ? fromEl.value : "";
    const to = toEl ? toEl.value : "";
    const period = (from || to) ? "custom" : (window._globalStatsState.period || "today");
    return window.loadGlobalStats(period, null, { city, from, to });
};

window.exportGlobalStatsCsv = () => {
    const snap = window._lastGlobalStatsSnapshot;
    if (!snap) {
        window.showToast?.("Primero carga un período en Estadísticas para exportar.", "warning");
        return null;
    }
    const csvContent = buildGlobalStatsCsv(snap);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const citySlug = (snap.filter?.city && snap.filter.city !== "all") ? snap.filter.city : "todas";
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `estadisticas-honduraite-${snap.filter?.period || "corte"}-${citySlug}-${dateStamp}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
    }, 2000);
    window.showToast?.("CSV de estadísticas descargado.", "success");
    return csvContent;
};

window.loadGlobalStats = async (period = "today", btnElement = null, customOptions = {}) => {
    const contentDiv = document.getElementById("global-stats-content");
    if (!contentDiv) return null;

    // Insertar barra de filtros avanzados (Ciudad + Rango de fechas + Exportar CSV) si aún no existe
    if (!document.getElementById("global-stats-advanced-filters") && contentDiv.parentElement) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = buildStatsFiltersToolbarHtml(window._globalStatsState);
        if (wrapper.firstElementChild) {
            contentDiv.parentElement.insertBefore(wrapper.firstElementChild, contentDiv);
        }
    }

    // Si el usuario tocó un botón rápido (Hoy / Semana / Mes / Año), limpiar inputs de rango personalizado
    if (btnElement && period !== "custom") {
        const fromEl = document.getElementById("stats-date-from");
        const toEl = document.getElementById("stats-date-to");
        if (fromEl) fromEl.value = "";
        if (toEl) toEl.value = "";
        btnElement.parentElement?.querySelectorAll(".ops-chip, button").forEach((b) => {
            b.classList.remove("ops-chip--active", "bg-emerald-600", "text-white");
            b.classList.add("bg-gray-700", "text-white");
        });
        btnElement.classList.remove("bg-gray-700");
        btnElement.classList.add("ops-chip--active", "bg-emerald-600", "text-white");
    }

    const cityEl = document.getElementById("stats-city-filter");
    const fromEl = document.getElementById("stats-date-from");
    const toEl = document.getElementById("stats-date-to");

    const city = customOptions.city ?? (cityEl ? cityEl.value : (window._globalStatsState?.city || "all"));
    const from = customOptions.from ?? (period === "custom" ? (fromEl?.value || window._globalStatsState?.from || "") : (fromEl?.value || ""));
    const to = customOptions.to ?? (period === "custom" ? (toEl?.value || window._globalStatsState?.to || "") : (toEl?.value || ""));
    const effectivePeriod = (from || to) ? "custom" : (period || "today");

    window._globalStatsState = { period: effectivePeriod, city, from, to };

    contentDiv.innerHTML = `
        <div class="flex justify-center items-center py-12">
            <i class="fas fa-spinner fa-spin text-3xl text-emerald-500"></i>
        </div>
    `;

    try {
        // Leer en paralelo: trips, store_orders, driver_deposit_requests, users y platformConfig/main
        const [tripsRes, ordersRes, depsRes, usersRes, configRes] = await Promise.allSettled([
            getDocs(collection(db, "artifacts", appId, "public", "data", "trips")),
            getDocs(collection(db, "artifacts", appId, "public", "data", "store_orders")),
            getDocs(collection(db, "artifacts", appId, "public", "data", "driver_deposit_requests")),
            getDocs(collection(db, "artifacts", appId, "public", "data", "users")),
            getDoc(doc(db, "artifacts", appId, "public", "data", "platformConfig", "main")),
        ]);

        const trips = [];
        if (tripsRes.status === "fulfilled" && tripsRes.value) {
            tripsRes.value.forEach((d) => {
                const data = d.data() || {};
                // Excluir explícitamente viajes en papelera (trashedAt / trashedAtMs / deletedAt) en lecturas de deuda/conteo
                trips.push({ id: d.id, ...data });
            });
        }

        const storeOrders = [];
        if (ordersRes.status === "fulfilled" && ordersRes.value) {
            ordersRes.value.forEach((d) => {
                storeOrders.push({ id: d.id, ...(d.data() || {}) });
            });
        }

        const deposits = [];
        if (depsRes.status === "fulfilled" && depsRes.value) {
            depsRes.value.forEach((d) => {
                deposits.push({ id: d.id, ...(d.data() || {}) });
            });
        }

        const usersMap = new Map();
        (window.allUsersData || []).forEach((u) => {
            if (u?.uid) usersMap.set(u.uid, u);
        });
        if (usersRes.status === "fulfilled" && usersRes.value) {
            usersRes.value.forEach((ud) => {
                usersMap.set(ud.id, { uid: ud.id, ...(usersMap.get(ud.id) || {}), ...(ud.data() || {}) });
            });
        }

        let platformPct = Number(APP_CONFIG.commissionPercent) || 18;
        let byService = {};
        if (configRes.status === "fulfilled" && configRes.value?.exists?.()) {
            const cfgData = configRes.value.data() || {};
            const rawPct = parseFloat(cfgData.commissionPercentage);
            if (Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100) {
                platformPct = rawPct;
            }
            if (cfgData.commissionByService && typeof cfgData.commissionByService === "object") {
                byService = { ...cfgData.commissionByService };
            }
        } else if (typeof window.getPlatformCommission === "function") {
            try {
                const livePct = await window.getPlatformCommission();
                if (Number.isFinite(Number(livePct))) platformPct = Number(livePct);
            } catch (_) {}
        }

        const snapshot = computeGlobalStatsSnapshot({
            trips,
            storeOrders,
            deposits,
            users: [...usersMap.values()],
            commissionConfig: { platformPct, byService },
            filter: { period: effectivePeriod, city, from, to },
            now: new Date(),
        });

        window._lastGlobalStatsSnapshot = snapshot;
        window._statsOwingDrivers = snapshot.owingDrivers;

        contentDiv.innerHTML = renderGlobalStatsHtml(snapshot);
        return snapshot;
    } catch (e) {
        console.error("loadGlobalStats:", e);
        contentDiv.innerHTML = `
            <div class="text-center py-8 text-red-400">
                <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                <p>Error al cargar las estadísticas.</p>
            </div>
        `;
        return null;
    }
};

/** Recordatorio de depósito a un conductor (push + campana). */
window.sendDepositReminderToDriver = async (uid, userName, amount, sinceLabel = '', overdue = false) => {
    if (!canManageUsers()) {
        return window.showToast?.('Solo admin o supervisor.', 'warning');
    }
    if (!uid) return;
    const amt = Number(amount) || 0;
    const name = userName || 'Conductor';
    const waitBit = sinceLabel && sinceLabel !== '—'
        ? ` Llevas ${sinceLabel} sin depositar desde tu primer viaje en efectivo del período.`
        : '';
    const urgency = overdue
        ? '⚠ Tu plazo de depósito ya venció. '
        : '';
    const msg = `${urgency}Recordatorio HonduRaite: debes depositar la comisión pendiente de ${formatLempiras(amt)}.${waitBit} Toca «Depositar ahora» para ver el número de cuenta y enviar el baucher a revisión.`;
    if (!confirm(`¿Enviar recordatorio de depósito a ${name}?\n\nMonto: ${formatLempiras(amt)}\nTiempo sin depositar: ${sinceLabel || '—'}`)) {
        return;
    }
    try {
        const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'notifications');
        const newRef = doc(colRef);
        await setDoc(newRef, {
            targetRole: 'driver',
            targetUserId: String(uid),
            targetUserName: name,
            personal: true,
            sendPush: true,
            broadcastPush: false,
            pushDispatched: false,
            openDeposit: true,
            type: 'deposit_reminder',
            title: overdue ? '⚠ Depósito vencido' : 'Recordatorio de depósito',
            body: msg,
            message: msg,
            tag: `deposit-reminder-${uid}-${Date.now()}`,
            amount: amt,
            sentBy: window.currentUser?.uid || null,
            sentByName: window.getSenderDisplayName?.() || 'Staff',
            createdAt: serverTimestamp(),
            createdAtMs: Date.now()
        });
        window.showToast?.(`Recordatorio enviado a ${name}.`, 'success');
    } catch (e) {
        console.error('sendDepositReminderToDriver:', e);
        window.showToast?.(e?.message || 'No se pudo enviar el recordatorio.', 'error');
    }
};

/** Recordatorio masivo a todos los de la lista de estadísticas. */
window.sendDepositReminderBulk = async () => {
    if (!canManageUsers()) {
        return window.showToast?.('Solo admin o supervisor.', 'warning');
    }
    const list = Array.isArray(window._statsOwingDrivers) ? window._statsOwingDrivers : [];
    if (!list.length) return window.showToast?.('No hay conductores pendientes en la lista.', 'warning');
    if (!confirm(`¿Enviar recordatorio de depósito a ${list.length} conductor(es)?`)) return;
    let ok = 0;
    let fail = 0;
    for (const d of list) {
        try {
            const amt = Number(d.totalOwed) || 0;
            const waitBit = d.sinceLabel && d.sinceLabel !== '—'
                ? ` Llevas ${d.sinceLabel} sin depositar.`
                : '';
            const urgency = d.overdue ? '⚠ Tu plazo de depósito ya venció. ' : '';
            const msg = `${urgency}Recordatorio HonduRaite: debes depositar la comisión pendiente de ${formatLempiras(amt)}.${waitBit} Toca «Depositar ahora» para ver la cuenta y enviar el baucher.`;
            const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'notifications');
            const newRef = doc(colRef);
            await setDoc(newRef, {
                targetRole: 'driver',
                targetUserId: String(d.uid),
                targetUserName: d.name || 'Conductor',
                personal: true,
                sendPush: true,
                broadcastPush: false,
                pushDispatched: false,
                openDeposit: true,
                type: 'deposit_reminder',
                title: d.overdue ? '⚠ Depósito vencido' : 'Recordatorio de depósito',
                body: msg,
                message: msg,
                tag: `deposit-reminder-${d.uid}-${Date.now()}`,
                amount: amt,
                sentBy: window.currentUser?.uid || null,
                sentByName: window.getSenderDisplayName?.() || 'Staff',
                createdAt: serverTimestamp(),
                createdAtMs: Date.now()
            });
            ok += 1;
        } catch (_) {
            fail += 1;
        }
    }
    window.showToast?.(`Recordatorios: ${ok} enviados${fail ? ` · ${fail} fallaron` : ''}.`, ok ? 'success' : 'error');
};

const urlReferralCode = storeReferralFromURL();
if (urlReferralCode) showReferralInviteModal(urlReferralCode);

setTimeout(() => {
    const driverRefInput = document.getElementById('referral-code-input');
    const pendingRef = getPendingReferralCode();
    if (driverRefInput && pendingRef && !driverRefInput.value) {
        driverRefInput.value = pendingRef;
    }
}, 500);

        // Actualizar badge al iniciar sesión
        setTimeout(() => {
            if (typeof window.updateNotificationBadge === 'function') {
                window.updateNotificationBadge();
            }
        }, 3000);

        // Foto ampliada: ahora es compartida (js/photo-viewer.js) para que funcione también sin staff.
        window.showEnlargedPhoto = showEnlargedPhoto;

      // === PERSONALIZACIÓN DEL LOGIN (Admin) ===
window.loadCurrentLoginCustomization = async () => {
    try {
        const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main');
        const snap = await getDoc(settingsRef);

        if (!snap.exists()) {
            return;
        }

        const s = snap.data();

        // Cargar logo guardado
        if (s.loginLogoBase64) {
            const img = document.getElementById('current-login-logo');
            const no = document.getElementById('no-login-logo');
            if (img && no) {
                img.src = s.loginLogoBase64;
                img.style.display = 'block';
                no.style.display = 'none';
            }
        }

        // Cargar mensaje de bienvenida
        if (s.welcomeMessage) {
            const ta = document.getElementById('welcome-message');
            if (ta) ta.value = s.welcomeMessage;
        }

        const vapidInput = document.getElementById('fcm-vapid-key');
        if (vapidInput) vapidInput.value = s.fcmVapidKey || '';

        // Cargar tonos globales (mapa + personalizados) y refrescar panel si está abierto
        try {
            if (s.toneMap || s.customTones) {
                applyRemoteToneConfig({
                    toneMap: s.toneMap || null,
                    customTones: s.customTones || null
                });
            }
            window.refreshAdminTonesSamples?.();
            window.refreshAdminCustomTonesList?.();
            window.refreshAdminToneMapSelects?.();
        } catch (_) {}

        // Configurar el input de subida
        const up = document.getElementById('login-logo-upload');
        if (up) {
            up.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    const r = new FileReader();
                    r.onload = async (ev) => {
                        const img = document.getElementById('current-login-logo');
                        const no = document.getElementById('no-login-logo');
                        if (img && no) {
                            img.src = ev.target.result;
                            img.style.display = 'block';
                            no.style.display = 'none';
                        }
                        window.newLoginLogoBase64 = ev.target.result;

                        // === GUARDAR EN FIREBASE ===
                        try {
                            const msg = document.getElementById('welcome-message')?.value.trim() || null;
                            
                            const data = { 
                                welcomeMessage: msg, 
                                loginLogoBase64: window.newLoginLogoBase64,
                                updatedAt: serverTimestamp() 
                            };
                            
                            await setDoc(settingsRef, data, { merge: true });

                            // Actualizar favicon
                            let link = document.querySelector("link[rel~='icon']");
                            if (!link) {
                                link = document.createElement('link');
                                link.rel = 'icon';
                                document.head.appendChild(link);
                            }
                            link.href = window.newLoginLogoBase64;

                            window.showToast("Logo guardado correctamente", "success");
                            
                        } catch (err) {
                            console.error("ERROR AL GUARDAR:", err);
                            window.showToast("Error al guardar el logo");
                        }
                    };
                    r.readAsDataURL(e.target.files[0]);
                }
            };
        }
    } catch(e) { 
        console.error("ERROR CRÍTICO en loadCurrentLoginCustomization:", e); 
        window.showToast("Error al cargar configuración");
    }
};

window.saveLoginCustomization = async (btn) => {
    btn.disabled = true;
    btn.innerText = "GUARDANDO...";
    try {
        const msg = document.getElementById('welcome-message').value.trim();
        const vapidKey = document.getElementById('fcm-vapid-key')?.value.trim() || '';
        const data = {
            welcomeMessage: msg || null,
            fcmVapidKey: vapidKey || null,
            updatedAt: serverTimestamp()
        };
        if (window.newLoginLogoBase64) data.loginLogoBase64 = window.newLoginLogoBase64;

        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), data, { merge: true });
        window.showToast("Personalización guardada correctamente.", "success");
        btn.innerText = "GUARDAR CAMBIOS";
        btn.disabled = false;
        window.newLoginLogoBase64 = null;
        await window.loadAppCustomization();
        window.showLoginLogo?.();

        const uid = window.currentUser?.uid;
        if (uid && window.getNotificationPermission?.() === 'granted') {
            if (isCapacitorNative()) {
                await window.initAndroidFcmPush?.({ db, appId, uid })?.catch?.(() => {});
            } else if (vapidKey) {
                await window.initFcmPush?.({
                    firebaseConfig: APP_CONFIG.firebase,
                    vapidKey,
                    db,
                    appId,
                    uid
                })?.catch?.(() => {});
            }
        }
    } catch(e) {
        alert("Error al guardar los cambios");
        btn.innerText = "GUARDAR CAMBIOS";
        btn.disabled = false;
    }
};

// ─── Tonos de notificación (Personalización) ───────────────────────────────
window.renderAdminTonesPanel = (rootEl) => {
    if (!rootEl) return;
    const U = window.OpsUi;
    const maxMb = (getMaxCustomBytes() / (1024 * 1024)).toFixed(1);
    const platformNow = getPlatformToneLabel();

    rootEl.innerHTML =
        U.formPanel(
            'Tonos de notificación',
            `Sonidos propios de la app (no el del celular). Ahora estás en: <b>${platformNow}</b>. Al guardar, aplica a todos.`,
            `
            <p class="text-[11px] text-slate-400 font-bold mb-3 leading-relaxed">
                Asigna un tono por cada tipo de aviso (nuevo viaje, contraoferta, subida de tarifa, oferta al pasajero, etc.).
                <b>Web/PWA</b> y <b>App nativa</b> pueden ser distintos. Sube MP3/WAV/OGG (máx. ${maxMb} MB) y asígnalo a cualquier evento.
                Con la app abierta suena el tono que elijas; con la app en otra pantalla Android también vibra y usa el canal nativo de viajes.
            </p>

            <div class="mb-4">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Muestras integradas</p>
                <div id="admin-tones-samples" class="grid grid-cols-1 sm:grid-cols-2 gap-2"></div>
            </div>

            <div class="mb-4">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Subir / arrastrar tono nuevo</p>
                <div id="admin-tone-dropzone" class="admin-tone-dropzone border-2 border-dashed border-slate-600 rounded-2xl p-5 text-center cursor-pointer hover:border-emerald-500/60 hover:bg-slate-900/40 transition">
                    <i class="fas fa-music text-2xl text-emerald-400 mb-2"></i>
                    <p class="text-sm font-black text-white">Arrastra un audio aquí</p>
                    <p class="text-[10px] text-slate-400 font-bold mt-1">o toca para elegir archivo · MP3, WAV, OGG, M4A</p>
                    <input type="file" id="admin-tone-file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm" class="hidden">
                </div>
                <div class="mt-2 flex flex-wrap gap-2 items-center">
                    <input id="admin-tone-custom-name" type="text" maxlength="60" class="ops-input flex-1 min-w-[140px]" placeholder="Nombre del tono (opcional)">
                    <button type="button" id="admin-tone-upload-btn" class="ops-btn ops-btn--emerald" disabled>
                        <i class="fas fa-cloud-upload-alt"></i> Subir tono
                    </button>
                </div>
                <p id="admin-tone-upload-hint" class="text-[10px] text-slate-500 font-bold mt-1"></p>
            </div>

            <div class="mb-4">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Tonos personalizados</p>
                <div id="admin-tones-custom-list" class="space-y-2"></div>
            </div>

            <div class="mb-3">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Asignar por tipo de aviso</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
                    <div>
                        <p class="text-[10px] font-black text-sky-400 mb-1"><i class="fas fa-globe"></i> Web / PWA</p>
                        <div id="admin-tone-map-web" class="space-y-2"></div>
                    </div>
                    <div>
                        <p class="text-[10px] font-black text-emerald-400 mb-1"><i class="fab fa-android"></i> App nativa</p>
                        <div id="admin-tone-map-native" class="space-y-2"></div>
                    </div>
                </div>
            </div>

            <div class="flex flex-wrap gap-2">
                <button type="button" onclick="window.saveAdminToneConfig(this)" class="ops-btn ops-btn--emerald flex-1 min-w-[140px]">
                    <i class="fas fa-save"></i> Guardar tonos para todos
                </button>
                <button type="button" onclick="window.resetAdminToneDefaults(this)" class="ops-btn ops-btn--ghost flex-1 min-w-[120px]">
                    Restablecer defaults
                </button>
            </div>
            `
        );

    window.refreshAdminTonesSamples?.();
    window.refreshAdminCustomTonesList?.();
    window.refreshAdminToneMapSelects?.();
    window.bindAdminToneDropzone?.();
};

window.refreshAdminTonesSamples = () => {
    const box = document.getElementById('admin-tones-samples');
    if (!box) return;
    const tones = listTones({ includeCustom: false });
    box.innerHTML = tones.map((t) => {
        const flavor =
            t.flavor === 'web' ? 'WEB'
            : t.flavor === 'native' ? 'NATIVO'
            : 'AMBOS';
        const color =
            t.flavor === 'web' ? 'text-sky-400'
            : t.flavor === 'native' ? 'text-emerald-400'
            : 'text-amber-400';
        return `
            <div class="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2">
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-black text-white truncate">${escapeHtmlLite(t.name)}</p>
                    <p class="text-[9px] ${color} font-bold">${flavor} · ${escapeHtmlLite(t.blurb || '')}</p>
                </div>
                <button type="button" class="ops-btn ops-btn--ghost text-[10px] py-1.5 px-2.5 shrink-0"
                    onclick="window.playToneSample('${t.id}')" title="Escuchar">
                    <i class="fas fa-play"></i>
                </button>
            </div>`;
    }).join('');
};

window.refreshAdminCustomTonesList = () => {
    const box = document.getElementById('admin-tones-custom-list');
    if (!box) return;
    const customs = getCustomTones();
    if (!customs.length) {
        box.innerHTML = `<p class="text-[11px] text-slate-500 font-bold py-2">Aún no hay tonos subidos. Arrastra un audio arriba.</p>`;
        return;
    }
    box.innerHTML = customs.map((t) => `
        <div class="flex items-center gap-2 bg-slate-900/60 border border-emerald-900/40 rounded-xl px-3 py-2">
            <div class="flex-1 min-w-0">
                <p class="text-xs font-black text-white truncate">${escapeHtmlLite(t.name)}</p>
                <p class="text-[9px] text-slate-400 font-bold truncate">${escapeHtmlLite(t.fileName || t.id)}</p>
            </div>
            <button type="button" class="ops-btn ops-btn--ghost text-[10px] py-1.5 px-2.5" onclick="window.playToneSample('${t.id}')">
                <i class="fas fa-play"></i>
            </button>
            <button type="button" class="ops-btn ops-btn--ghost text-[10px] py-1.5 px-2.5 text-rose-400"
                onclick="window.deleteAdminCustomTone('${t.id}')" title="Eliminar">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
};

window.refreshAdminToneMapSelects = () => {
    const prefs = loadTonePrefs();
    const fill = (platform, containerId) => {
        const el = document.getElementById(containerId);
        if (!el) return;
        const map = prefs[platform] || {};
        el.innerHTML = TONE_EVENTS.map((ev) => {
            const sel = map[ev.id] || '';
            const opts = buildToneOptionsHtml(sel);
            return `
                <div class="bg-slate-900/50 border border-slate-700 rounded-xl p-2.5">
                    <div class="flex items-start justify-between gap-2 mb-1.5">
                        <div class="min-w-0">
                            <p class="text-[11px] font-black text-white">${escapeHtmlLite(ev.label)}</p>
                            <p class="text-[9px] text-slate-500 font-bold leading-snug">${escapeHtmlLite(ev.desc)}</p>
                        </div>
                        <button type="button" class="text-[10px] text-sky-400 font-black shrink-0"
                            onclick="window.previewAdminToneSelect('${platform}','${ev.id}')" title="Probar">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                    <select data-tone-platform="${platform}" data-tone-event="${ev.id}"
                        class="ops-input text-xs py-2 admin-tone-select w-full">
                        ${opts}
                    </select>
                </div>`;
        }).join('');
    };
    fill('web', 'admin-tone-map-web');
    fill('native', 'admin-tone-map-native');
};

function escapeHtmlLite(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.playToneSample = (toneId) => {
    try {
        const ok = playToneById(toneId);
        if (!ok) window.showToast?.('No se pudo reproducir ese tono.', 'warning');
    } catch (_) {
        window.showToast?.('Error al reproducir.', 'error');
    }
};

window.previewAdminToneSelect = (platform, eventId) => {
    const sel = document.querySelector(
        `select.admin-tone-select[data-tone-platform="${platform}"][data-tone-event="${eventId}"]`
    );
    const id = sel?.value;
    if (id) window.playToneSample(id);
};

window.collectAdminToneMapFromUI = () => {
    const web = {};
    const native = {};
    document.querySelectorAll('select.admin-tone-select').forEach((sel) => {
        const p = sel.dataset.tonePlatform;
        const ev = sel.dataset.toneEvent;
        if (!p || !ev) return;
        if (p === 'web') web[ev] = sel.value;
        if (p === 'native') native[ev] = sel.value;
    });
    return { web, native };
};

window.bindAdminToneDropzone = () => {
    const zone = document.getElementById('admin-tone-dropzone');
    const input = document.getElementById('admin-tone-file');
    const btn = document.getElementById('admin-tone-upload-btn');
    const hint = document.getElementById('admin-tone-upload-hint');
    if (!zone || !input) return;

    window._pendingToneFile = null;

    const setFile = (file) => {
        if (!file) return;
        if (!isAllowedAudioFile(file)) {
            const maxMb = (getMaxCustomBytes() / (1024 * 1024)).toFixed(1);
            window.showToast?.(`Archivo no válido. Usa MP3/WAV/OGG/M4A (máx. ${maxMb} MB).`, 'warning');
            window._pendingToneFile = null;
            if (btn) btn.disabled = true;
            if (hint) hint.textContent = '';
            return;
        }
        window._pendingToneFile = file;
        if (btn) btn.disabled = false;
        if (hint) {
            hint.textContent = `Listo: ${file.name} (${(file.size / 1024).toFixed(0)} KB) — dale a Subir tono`;
        }
        const nameInput = document.getElementById('admin-tone-custom-name');
        if (nameInput && !nameInput.value.trim()) {
            nameInput.value = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
        }
        // Preview local inmediato
        try {
            const url = URL.createObjectURL(file);
            const audio = new Audio(url);
            audio.volume = 0.9;
            audio.play().catch(() => {});
            setTimeout(() => URL.revokeObjectURL(url), 15000);
        } catch (_) {}
    };

    zone.onclick = () => input.click();
    input.onchange = () => {
        const f = input.files?.[0];
        if (f) setFile(f);
        input.value = '';
    };

    ['dragenter', 'dragover'].forEach((ev) => {
        zone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('admin-tone-dropzone--active');
        });
    });
    ['dragleave', 'drop'].forEach((ev) => {
        zone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('admin-tone-dropzone--active');
        });
    });
    zone.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) setFile(f);
    });

    if (btn) {
        btn.onclick = () => window.uploadAdminCustomTone?.(btn);
    }
};

window.uploadAdminCustomTone = async (btn) => {
    const file = window._pendingToneFile;
    if (!file) return window.showToast?.('Elige o arrastra un audio primero.', 'warning');
    if (!isAllowedAudioFile(file)) return window.showToast?.('Archivo de audio no válido.', 'warning');

    const nameInput = document.getElementById('admin-tone-custom-name');
    const name = (nameInput?.value || file.name || 'Tono personalizado').trim().slice(0, 60);
    const toneId = makeCustomToneId();
    const safeFile = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const path = `artifacts/${appId}/public/tones/${toneId}_${safeFile}`;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo…';
    }

    try {
        if (!storage) throw new Error('Storage no disponible');
        const url = await uploadFile(storage, file, path);
        upsertCustomTone({
            id: toneId,
            name,
            kind: 'file',
            flavor: 'custom',
            url,
            fileName: file.name,
            blurb: 'Subido por admin',
            createdAt: Date.now()
        });

        // Persistir en appSettings (con el mapa actual) para todos
        const toneMap = window.collectAdminToneMapFromUI?.() || loadTonePrefs();
        saveTonePrefs(toneMap);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), {
            customTones: getCustomTones(),
            toneMap,
            tonesUpdatedAt: serverTimestamp()
        }, { merge: true });

        window._pendingToneFile = null;
        const hint = document.getElementById('admin-tone-upload-hint');
        if (hint) hint.textContent = `✓ Subido: ${name}`;
        if (nameInput) nameInput.value = '';
        window.refreshAdminCustomTonesList?.();
        window.refreshAdminToneMapSelects?.();
        window.showToast?.(`Tono “${name}” listo. Ya puedes asignarlo a un aviso.`, 'success');
        playToneById(toneId);
    } catch (e) {
        console.error('uploadAdminCustomTone:', e);
        window.showToast?.(e?.message || 'No se pudo subir el audio. Revisa permisos de Storage.', 'error');
    } finally {
        if (btn) {
            btn.disabled = !window._pendingToneFile;
            btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Subir tono';
        }
    }
};

window.deleteAdminCustomTone = async (toneId) => {
    if (!toneId) return;
    if (!confirm('¿Eliminar este tono personalizado? Si estaba asignado a un aviso, vuelve al default.')) return;
    removeCustomTone(toneId);
    const toneMap = window.collectAdminToneMapFromUI?.() || loadTonePrefs();
    // Limpiar referencias huérfanas en el mapa
    ['web', 'native'].forEach((p) => {
        Object.keys(toneMap[p] || {}).forEach((ev) => {
            if (toneMap[p][ev] === toneId) {
                const defaults = window.HonduTones?.defaults?.[p] || {};
                toneMap[p][ev] = defaults[ev] || 'soft_ding';
            }
        });
    });
    saveTonePrefs(toneMap);
    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), {
            customTones: getCustomTones(),
            toneMap,
            tonesUpdatedAt: serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.warn('deleteAdminCustomTone persist:', e);
    }
    window.refreshAdminCustomTonesList?.();
    window.refreshAdminToneMapSelects?.();
    window.showToast?.('Tono eliminado.', 'success');
};

window.saveAdminToneConfig = async (btn) => {
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
    }
    try {
        const toneMap = window.collectAdminToneMapFromUI?.() || loadTonePrefs();
        saveTonePrefs(toneMap);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), {
            toneMap,
            customTones: getCustomTones(),
            tonesUpdatedAt: serverTimestamp()
        }, { merge: true });
        window.showToast?.('Tonos guardados para todos (web y app).', 'success');
    } catch (e) {
        console.error('saveAdminToneConfig:', e);
        window.showToast?.(e?.message || 'No se pudieron guardar los tonos.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar tonos para todos';
        }
    }
};

window.resetAdminToneDefaults = async (btn) => {
    if (!confirm('¿Restablecer los tonos por defecto de web y nativo? (Los personalizados subidos se conservan)')) return;
    const defaults = window.HonduTones?.defaults || {};
    const toneMap = {
        web: { ...(defaults.web || {}) },
        native: { ...(defaults.native || {}) }
    };
    saveTonePrefs(toneMap);
    window.refreshAdminToneMapSelects?.();
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Guardando…';
    }
    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), {
            toneMap,
            customTones: getCustomTones(),
            tonesUpdatedAt: serverTimestamp()
        }, { merge: true });
        window.showToast?.('Defaults de tonos restablecidos.', 'success');
    } catch (e) {
        window.showToast?.('Defaults locales listos; error al guardar en nube.', 'warning');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Restablecer defaults';
        }
    }
};
        
}
