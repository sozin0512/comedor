/**
 * Guía para conductores Android: que el teléfono no "duerma" HonduRaite.
 * Samsung (One UI) mete las apps en "Aplicaciones en suspensión" / "suspensión profunda"
 * y ahí los avisos de viaje no llegan con la app cerrada.
 *
 * Solo usa lo que ya trae el APK instalado (plugin SessionKeepalive):
 *   hasBatteryExemption, requestBatteryExemption, openAppSettings, openNotificationSettings.
 * La lista de "Aplicaciones en suspensión" de Samsung no se puede leer ni abrir directo
 * sin un APK nuevo: por eso hay pasos escritos y un "Ya lo hice".
 */
import { registerPlugin } from './vendor/capacitor-core.js';
import { isCapacitorAndroid } from './capacitor-native.js';

const STORE_KEY = 'hr_sleep_guide_v1';
const DAY = 24 * 60 * 60 * 1000;
/** Batería restringida: recordar como mucho 1 vez al día. */
const REMIND_RESTRICTED_MS = DAY;
/** Batería bien pero sin confirmar la lista de Samsung: 1 vez cada 3 días. */
const REMIND_UNCONFIRMED_MS = 3 * DAY;

let SK = null;
function plugin() {
    if (SK) return SK;
    try { SK = window.Capacitor?.Plugins?.SessionKeepalive || registerPlugin('SessionKeepalive'); } catch (_) { SK = null; }
    return SK;
}

function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function writeStore(patch) {
    const next = { ...readStore(), ...patch };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch (_) {}
    return next;
}

/** 'samsung' | 'xiaomi' | 'huawei' | 'other' */
export async function detectAndroidBrand() {
    if (window.__hrForceBrand) return window.__hrForceBrand;
    const ua = String(navigator.userAgent || '');
    if (/SAMSUNG|Samsung|\bSM-[A-Z0-9]+|\bSC-\d|\bSCV\d|\bGT-/.test(ua)) return 'samsung';
    if (/Xiaomi|Redmi|POCO|\bMi \d|MIUI|HyperOS/i.test(ua)) return 'xiaomi';
    if (/HUAWEI|HONOR|\bHMA-|\bELE-/i.test(ua)) return 'huawei';
    try {
        const hi = await navigator.userAgentData?.getHighEntropyValues?.(['model', 'brands']);
        const model = String(hi?.model || '');
        if (/^SM-|^SC-|^SCV/i.test(model) || /galaxy/i.test(model)) return 'samsung';
        if (/redmi|poco|xiaomi|^2\d{3}[A-Z0-9]+$/i.test(model)) return 'xiaomi';
    } catch (_) {}
    return 'other';
}

/** true = Android dice "sin restricciones" (ignora optimización de batería). null = no se sabe. */
export async function isBatteryUnrestricted() {
    if (!isCapacitorAndroid()) return null;
    if (window.__hrForceBatteryOk !== undefined) return window.__hrForceBatteryOk;
    try {
        const res = await Promise.race([
            plugin()?.hasBatteryExemption?.(),
            new Promise((r) => setTimeout(() => r(null), 2500))
        ]);
        return typeof res?.granted === 'boolean' ? res.granted : null;
    } catch (_) {
        return null;
    }
}

function isDriver() {
    try {
        if (window.isDriverAppSession?.()) return true;
        return String(window.userProfile?.role || '').toLowerCase() === 'driver';
    } catch (_) { return false; }
}

const S = {
    overlay: 'position:fixed;inset:0;z-index:40002;background:rgba(15,23,42,0.86);display:flex;align-items:center;justify-content:center;padding:14px;',
    card: 'background:#fff;border-radius:22px;max-width:380px;width:100%;max-height:92dvh;overflow-y:auto;padding:18px 18px 14px;box-shadow:0 20px 40px rgba(0,0,0,.35);font-family:inherit;',
    h: 'margin:0;font-size:17px;font-weight:900;color:#0f172a;line-height:1.25;',
    sub: 'margin:4px 0 0;font-size:12px;color:#64748b;line-height:1.4;',
    sec: 'margin:14px 0 6px;font-size:11px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#0369a1;',
    ol: 'margin:0;padding-left:20px;font-size:13px;line-height:1.45;color:#334155;',
    li: 'margin-bottom:7px;',
    btn: 'width:100%;padding:11px 12px;border-radius:14px;border:none;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;',
};

function statusRow(ok, label, detail) {
    const color = ok === true ? '#047857' : ok === false ? '#b45309' : '#475569';
    const bg = ok === true ? '#ecfdf5' : ok === false ? '#fffbeb' : '#f8fafc';
    const border = ok === true ? '#a7f3d0' : ok === false ? '#fde68a' : '#e2e8f0';
    const badge = ok === true ? '✔ Listo' : ok === false ? '⚠ Falta' : 'Revisa tú';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;border-radius:14px;border:1px solid ${border};background:${bg};margin-bottom:6px;">
        <div style="min-width:0;"><p style="margin:0;font-size:12px;font-weight:800;color:#0f172a;">${label}</p>
        <p style="margin:1px 0 0;font-size:10.5px;color:#64748b;">${detail}</p></div>
        <span style="font-size:11px;font-weight:900;color:${color};white-space:nowrap;">${badge}</span></div>`;
}

function stepsFor(brand) {
    if (brand === 'samsung') {
        return {
            title: 'Samsung Galaxy',
            groups: [
                ['1 · Batería de HonduRaite', [
                    'Ajustes → <strong>Aplicaciones</strong> → <strong>HonduRaite</strong> → <strong>Batería</strong>.',
                    'Elige <strong>Sin restricciones</strong>.'
                ]],
                ['2 · Que Samsung no la duerma', [
                    'Ajustes → <strong>Batería</strong> (o “Mantenimiento del dispositivo” → Batería) → <strong>Límites de uso en segundo plano</strong>.',
                    'Abre <strong>Aplicaciones en suspensión</strong>: si está HonduRaite, mantenla presionada y toca <strong>Quitar</strong>.',
                    'Haz lo mismo en <strong>Aplicaciones en suspensión profunda</strong>.',
                    'Abre <strong>Aplicaciones que nunca se suspenden</strong> → <strong>+</strong> → marca HonduRaite → <strong>Agregar</strong>.',
                    'Si ves “<strong>Poner en suspensión apps no usadas</strong>”, apágalo.'
                ]],
                ['3 · Notificaciones', [
                    'Ajustes → Aplicaciones → HonduRaite → <strong>Notificaciones</strong>: activadas, y en <strong>“HonduRaite viajes”</strong> sonido y “Mostrar como emergente”.'
                ]]
            ]
        };
    }
    const brandTip = brand === 'xiaomi'
        ? ['Xiaomi / Redmi / POCO: Ajustes → Apps → HonduRaite → <strong>Ahorro de batería: Sin restricciones</strong> y activa <strong>Inicio automático</strong>.']
        : brand === 'huawei'
            ? ['Huawei / Honor: Ajustes → Batería → <strong>Inicio de aplicaciones</strong> → HonduRaite → gestionar manualmente y activa las 3 opciones.']
            : [];
    return {
        title: 'Android',
        groups: [
            ['1 · Batería de HonduRaite', [
                'Ajustes → <strong>Aplicaciones</strong> → <strong>HonduRaite</strong> → <strong>Batería</strong> → <strong>Sin restricciones</strong> (o “No optimizar”).',
                ...brandTip
            ]],
            ['2 · Que no se duerma', [
                'Si tu teléfono tiene “Ahorro de batería”, “Apps en suspensión” o “Apps inactivas”, quita HonduRaite de esa lista.',
                'Desactiva “Pausar actividad si no se usa” / “Quitar permisos si no se usa” en la info de HonduRaite.'
            ]],
            ['3 · Notificaciones', [
                'Ajustes → Aplicaciones → HonduRaite → <strong>Notificaciones</strong>: activadas, con sonido y emergentes.'
            ]]
        ]
    };
}

function closeGuide() {
    const el = document.getElementById('hr-sleep-guide');
    if (el?._onVis) document.removeEventListener('visibilitychange', el._onVis);
    el?.remove();
}

/**
 * Muestra la guía. source: 'push-failed' | 'activated' | 'online' | 'manual'.
 * reason: texto corto (p. ej. el código de FCM) que se muestra en gris.
 */
export async function showDriverSleepGuide({ reason = '', source = 'manual' } = {}) {
    closeGuide();
    const brand = await detectAndroidBrand();
    const battery = await isBatteryUnrestricted();
    const store = readStore();
    const steps = stepsFor(brand);
    const failed = source === 'push-failed';
    const restrictedAgain = battery === false && !!store.confirmedAt;

    const el = document.createElement('div');
    el.id = 'hr-sleep-guide';
    el.dataset.source = source;
    el.style.cssText = S.overlay;
    el.innerHTML = `
      <div style="${S.card}" role="dialog" aria-modal="true" aria-labelledby="hr-sg-title">
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="width:44px;height:44px;flex:0 0 44px;border-radius:14px;background:${failed ? '#fff7ed' : '#e0f2fe'};display:flex;align-items:center;justify-content:center;font-size:22px;">${failed ? '🔕' : '🔋'}</div>
          <div style="min-width:0;">
            <p id="hr-sg-title" style="${S.h}">${failed ? 'Los avisos no llegan a este celular' : 'Que los viajes siempre te lleguen'}</p>
            <p style="${S.sub}">${brand === 'samsung'
                ? 'Tu Samsung pone a “dormir” las apps que no usas. Dormida, HonduRaite <strong>no recibe viajes</strong> con la pantalla apagada.'
                : 'Tu teléfono puede pausar HonduRaite para ahorrar batería. Pausada, <strong>no recibe viajes</strong> con la app cerrada.'}</p>
            ${reason ? `<p style="margin:6px 0 0;font-size:10.5px;color:#94a3b8;">${reason}</p>` : ''}
          </div>
        </div>

        ${restrictedAgain ? `<div style="margin-top:12px;padding:9px 11px;border-radius:12px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;">Marcaste “Ya lo hice”, pero Android todavía dice que la batería de HonduRaite está restringida.</div>` : ''}

        <div style="margin-top:12px;" data-sg-status>
          ${statusRow(battery, 'Batería sin restricciones', battery === null ? 'No se pudo revisar en este teléfono' : (battery ? 'Android ya no la frena' : 'Android la está frenando'))}
          ${statusRow(store.confirmedAt ? true : null, brand === 'samsung' ? 'Fuera de “Aplicaciones en suspensión”' : 'Fuera de apps en suspensión', store.confirmedAt ? 'Confirmado por ti' : 'Android no deja revisarlo: sigue los pasos')}
        </div>

        ${steps.groups.map(([title, items]) => `
          <p style="${S.sec}">${title}</p>
          <ol style="${S.ol}">${items.map((t) => `<li style="${S.li}">${t}</li>`).join('')}</ol>`).join('')}

        <div style="position:sticky;bottom:-14px;margin:12px -18px -14px;padding:10px 18px 12px;background:#fff;border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:7px;">
          <p data-sg-msg style="margin:0;font-size:11.5px;color:#b45309;font-weight:700;text-align:center;display:none;"></p>
          <button type="button" data-sg="battery" style="${S.btn}background:#0369a1;color:#fff;">🔋 ${battery === false ? 'Quitar restricción de batería' : 'Abrir batería de HonduRaite'}</button>
          <div style="display:flex;gap:7px;">
            <button type="button" data-sg="app" style="${S.btn}flex:1;background:#0f172a;color:#fff;font-size:12px;">⚙️ Ajustes de la app</button>
            <button type="button" data-sg="notif" style="${S.btn}flex:1;background:#e0f2fe;color:#075985;font-size:12px;">🔔 Notificaciones</button>
          </div>
          <div style="display:flex;gap:7px;">
            <button type="button" data-sg="later" style="${S.btn}flex:1;background:#f1f5f9;color:#334155;font-weight:700;">Ahora no</button>
            <button type="button" data-sg="done" style="${S.btn}flex:1.4;background:#059669;color:#fff;">✅ Ya lo hice</button>
          </div>
          <p style="margin:0;font-size:10px;color:#94a3b8;text-align:center;">No cierres HonduRaite deslizándola del selector ni uses “Forzar detención”.</p>
        </div>
      </div>`;

    const msg = (t) => {
        const p = el.querySelector('[data-sg-msg]');
        if (!p) return;
        p.textContent = t || '';
        p.style.display = t ? 'block' : 'none';
    };

    const refreshStatus = async () => {
        const ok = await isBatteryUnrestricted();
        const box = el.querySelector('[data-sg-status]');
        if (!box) return ok;
        const st = readStore();
        box.innerHTML = statusRow(ok, 'Batería sin restricciones', ok === null ? 'No se pudo revisar en este teléfono' : (ok ? 'Android ya no la frena' : 'Android la está frenando'))
            + statusRow(st.confirmedAt ? true : null, brand === 'samsung' ? 'Fuera de “Aplicaciones en suspensión”' : 'Fuera de apps en suspensión', st.confirmedAt ? 'Confirmado por ti' : 'Android no deja revisarlo: sigue los pasos');
        if (ok) writeStore({ batteryOkAt: Date.now() });
        return ok;
    };

    // Al volver de Ajustes se revisa solo.
    el._onVis = () => { if (document.visibilityState === 'visible') refreshStatus().catch(() => {}); };
    document.addEventListener('visibilitychange', el._onVis);

    el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-sg]');
        if (!b) return;
        const action = b.dataset.sg;
        const sk = plugin();
        try {
            if (action === 'battery') {
                const ok = await isBatteryUnrestricted();
                if (ok === false && sk?.requestBatteryExemption) {
                    // Diálogo del sistema "¿Permitir que HonduRaite se ejecute en segundo plano?"
                    await sk.requestBatteryExemption();
                } else {
                    await sk?.openAppSettings?.();
                }
            } else if (action === 'app') {
                await sk?.openAppSettings?.();
            } else if (action === 'notif') {
                if (sk?.openNotificationSettings) await sk.openNotificationSettings();
                else await sk?.openAppSettings?.();
            } else if (action === 'later') {
                writeStore({ lastAutoAt: Date.now() });
                closeGuide();
            } else if (action === 'done') {
                const ok = await refreshStatus();
                if (ok === false) {
                    msg('Android todavía dice que la batería está restringida. Toca “Quitar restricción de batería” y elige Permitir.');
                    return;
                }
                writeStore({ confirmedAt: Date.now(), lastAutoAt: Date.now() });
                closeGuide();
                window.showToast?.('¡Listo! Te mando un aviso de prueba: sal de la app con Inicio y espera que suene.', 'success');
                try { if (typeof window.enableTripNotifications === 'function') setTimeout(() => window.enableTripNotifications(), 1200); } catch (_) {}
            }
        } catch (err) {
            console.warn('[sleep-guide]', action, err);
            msg('Este teléfono no abrió esa pantalla. Entra a Ajustes → Aplicaciones → HonduRaite.');
        }
    });

    document.body.appendChild(el);
    return el;
}

/**
 * Recordatorio sin insistir:
 * - Batería restringida → máximo 1 vez al día (aunque haya dicho "Ya lo hice").
 * - Batería bien y ya confirmó → nunca solo.
 * - Batería bien sin confirmar (Samsung no deja revisar la lista) → 1 vez cada 3 días.
 */
export async function maybeRemindDriverSleepGuide({ source = 'online', force = false } = {}) {
    if (!isCapacitorAndroid() || !isDriver()) return false;
    if (document.getElementById('hr-sleep-guide') || document.getElementById('notif-prompt-modal')) return false;
    const st = readStore();
    const battery = await isBatteryUnrestricted();
    const since = Date.now() - (Number(st.lastAutoAt) || 0);
    let due = force;
    if (!due) {
        if (battery === false) due = since > REMIND_RESTRICTED_MS;
        else if (st.confirmedAt) due = false;
        else due = since > REMIND_UNCONFIRMED_MS;
    }
    if (!due) return false;
    writeStore({ lastAutoAt: Date.now() });
    await showDriverSleepGuide({ source });
    return true;
}

if (typeof window !== 'undefined') {
    window.showDriverSleepGuide = showDriverSleepGuide;
    window.maybeRemindDriverSleepGuide = maybeRemindDriverSleepGuide;
}
