/**
 * Objetivos para conductores — panel supervisor + vista conductor
 */
import {
    collection, addDoc, getDocs, getDoc, updateDoc, doc, setDoc,
    serverTimestamp, query, where, onSnapshot, orderBy, limit, arrayUnion, Timestamp
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

let dbRef = null;
let appIdRef = null;
let getCurrentUser = () => null;
let getSenderName = () => 'Supervisor';
let getDriverProfile = () => null;
let driverObjectivesUnsub = null;
let driverResponseUnsubs = [];
let objectiveExpiryTimer = null;

const MINIMIZED_KEY = 'honduber_obj_min';

const OBJECTIVE_DURATION_PRESETS = {
    '1h': { ms: 60 * 60 * 1000, label: '1 hora' },
    '6h': { ms: 6 * 60 * 60 * 1000, label: '6 horas' },
    '1d': { ms: 24 * 60 * 60 * 1000, label: '1 día' },
    '3d': { ms: 3 * 24 * 60 * 60 * 1000, label: '3 días' },
    '7d': { ms: 7 * 24 * 60 * 60 * 1000, label: '1 semana' },
    '14d': { ms: 14 * 24 * 60 * 60 * 1000, label: '2 semanas' }
};

const DEFAULT_OBJECTIVE_DURATION = '7d';

function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escAttr(s) {
    return String(s || '').toLowerCase().replace(/"/g, "'");
}

/** Meta numérica: campo del supervisor o número en el título (ej. "10 viajes"). */
function effectiveTargetCount(obj) {
    const explicit = parseInt(obj?.targetCount, 10);
    if (Number.isFinite(explicit) && explicit >= 1) return Math.min(explicit, 999);

    const title = String(obj?.title || '');
    const patterns = [
        /(\d{1,3})\s*(viaje|viajes|trip|trips|carrera|carreras)\b/i,
        /(?:completar|hacer|realizar|terminar)\s*(\d{1,3})\b/i,
        /^(\d{1,3})\b/
    ];
    for (const re of patterns) {
        const m = title.match(re);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n >= 1) return Math.min(n, 999);
        }
    }
    return 1;
}

function formatObjectiveDate(ts) {
    if (!ts) return '—';
    let d = null;
    if (typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' });
}

function getExpiresAtMs(obj) {
    if (!obj) return null;
    if (typeof obj.expiresAtMs === 'number' && obj.expiresAtMs > 0) return obj.expiresAtMs;
    const exp = obj.expiresAt;
    if (exp) {
        if (typeof exp.toDate === 'function') return exp.toDate().getTime();
        if (exp.seconds) return exp.seconds * 1000;
    }
    const created = obj.createdAt;
    if (created) {
        const cms = typeof created.toDate === 'function'
            ? created.toDate().getTime()
            : (created.seconds ? created.seconds * 1000 : null);
        if (cms) return cms + (OBJECTIVE_DURATION_PRESETS[DEFAULT_OBJECTIVE_DURATION]?.ms || 0);
    }
    return null;
}

function isObjectiveExpired(obj) {
    if (!obj || obj.status === 'expired' || obj.status === 'cancelled' || obj.status === 'completed') {
        return obj?.status === 'expired';
    }
    const expMs = getExpiresAtMs(obj);
    if (!expMs) return false;
    return Date.now() >= expMs;
}

function formatTimeRemaining(obj) {
    const expMs = getExpiresAtMs(obj);
    if (!expMs) return '';
    const diff = expMs - Date.now();
    if (diff <= 0) return 'Tiempo agotado';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min restante${mins === 1 ? '' : 's'}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h restante${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    return `${days} día${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}`;
}

function resolveDurationPreset(presetId) {
    return OBJECTIVE_DURATION_PRESETS[presetId] || OBJECTIVE_DURATION_PRESETS[DEFAULT_OBJECTIVE_DURATION];
}

function renderDurationSelect(selected = DEFAULT_OBJECTIVE_DURATION) {
    return Object.entries(OBJECTIVE_DURATION_PRESETS).map(([id, p]) =>
        `<option value="${id}"${id === selected ? ' selected' : ''}>${p.label}</option>`
    ).join('');
}

function objectivesCol() {
    return collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'driver_objectives');
}

function objectiveDocRef(objectiveId) {
    return doc(dbRef, 'artifacts', appIdRef, 'public', 'data', 'driver_objectives', objectiveId);
}

function responseDocRef(objectiveId, driverId) {
    return doc(dbRef, 'artifacts', appIdRef, 'public', 'data', 'driver_objectives', objectiveId, 'responses', driverId);
}

function responsesCol(objectiveId) {
    return collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'driver_objectives', objectiveId, 'responses');
}

function isObjectiveMinimized(objectiveId) {
    try {
        return localStorage.getItem(`${MINIMIZED_KEY}_${objectiveId}`) === '1';
    } catch (_) {
        return false;
    }
}

function setObjectiveMinimized(objectiveId, minimized) {
    try {
        if (minimized) localStorage.setItem(`${MINIMIZED_KEY}_${objectiveId}`, '1');
        else localStorage.removeItem(`${MINIMIZED_KEY}_${objectiveId}`);
    } catch (_) {}
}

function cardMatchesObjectiveSearch(card, term) {
    if (!term) return true;
    const fmtPhone = window.formatHondurasPhone?.(card.dataset.phone || '') || (card.dataset.phone || '');
    const fields = [
        card.dataset.name || '',
        fmtPhone,
        card.dataset.email || '',
        card.dataset.plate || '',
        card.dataset.identity || ''
    ];
    return fields.some((f) => String(f).toLowerCase().includes(term));
}

function buildDriverSearchAttrs(u) {
    const email = (u.email || u.contactEmail || '').toLowerCase();
    return `data-name="${escAttr(u.name)}" data-phone="${u.phone || ''}" data-email="${email}" data-plate="${escAttr(u.vehicle?.plate)}" data-identity="${escAttr(u.identity)}"`;
}

function responseStatusLabel(status, rewardPaid) {
    if (status === 'completed' && rewardPaid) return { text: 'Recompensa pagada', variant: 'blue' };
    if (status === 'completed') return { text: 'Completado · pagar', variant: 'amber' };
    if (status === 'expired') return { text: 'Vencido', variant: 'muted' };
    if (status === 'accepted') return { text: 'En progreso', variant: 'emerald' };
    if (status === 'rejected') return { text: 'Rechazado', variant: 'muted' };
    return { text: 'Pendiente', variant: 'muted' };
}

function objectiveStatusLabel(obj) {
    if (obj.status === 'expired' || isObjectiveExpired(obj)) return { text: 'Vencido', variant: 'red' };
    if (obj.status === 'active') return { text: 'Activo', variant: 'emerald' };
    if (obj.status === 'completed') return { text: 'Cerrado', variant: 'blue' };
    return { text: 'Cancelado', variant: 'muted' };
}

async function fetchApprovedDrivers() {
    const cached = (window.allUsersData || []).filter((u) =>
        u.role === 'driver' && (u.approvalStatus === 'approved' || u.approvalStatus === 'suspended')
    );
    if (cached.length) return cached.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));

    const snap = await getDocs(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'users'));
    const list = [];
    snap.forEach((d) => {
        const u = { uid: d.id, ...d.data() };
        if (u.role === 'driver' && (u.approvalStatus === 'approved' || u.approvalStatus === 'suspended')) {
            list.push(u);
        }
    });
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
}

function getSelectedDriverIds() {
    if (!window._supObjectiveSelectedDrivers) window._supObjectiveSelectedDrivers = new Set();
    return window._supObjectiveSelectedDrivers;
}

function updateObjectiveSelectionCount() {
    const el = document.getElementById('sup-objective-selected-count');
    if (!el) return;
    const n = getSelectedDriverIds().size;
    el.textContent = `${n} conductor${n === 1 ? '' : 'es'} seleccionado${n === 1 ? '' : 's'}`;
}

function renderDriverPicker(drivers) {
    const U = window.OpsUi;
    const selected = getSelectedDriverIds();

    let rows = '';
    drivers.forEach((u) => {
        const checked = selected.has(u.uid) ? 'checked' : '';
        rows += `
            <label class="ops-objective-driver-row sup-objective-driver-row" ${buildDriverSearchAttrs(u)}>
                <input type="checkbox" class="ops-objective-check" data-uid="${u.uid}"
                    ${checked} onchange="window.toggleSupObjectiveDriver('${u.uid}', this.checked)">
                <span class="ops-objective-driver-info">
                    <span class="ops-objective-driver-name">${escHtml(u.name || 'Sin nombre')}</span>
                    <span class="ops-objective-driver-meta">${escHtml(u.vehicle?.plate || 'Sin placa')} · ${escHtml(u.phone || '')}</span>
                </span>
            </label>
        `;
    });

    return `
        ${U.toolbar({
            searchHtml: `<input type="search" id="sup-objective-driver-search" placeholder="Buscar nombre, WhatsApp, correo o placa…" class="ops-input" oninput="window.filterSupObjectiveDriverSearch()">`,
            chipsHtml: [
                U.chip('Seleccionar todos', 'window.toggleSupObjectiveAllDrivers(true)', { variant: 'emerald' }),
                U.chip('Quitar todos', 'window.toggleSupObjectiveAllDrivers(false)', { variant: 'muted' })
            ].join(''),
            hint: 'Marca conductores uno por uno o usa «Seleccionar todos».',
            sticky: false
        })}
        <p id="sup-objective-selected-count" class="ops-objective-selected-count">0 conductores seleccionados</p>
        <div class="ops-objective-driver-list" id="sup-objective-driver-list">${rows || U.empty('fa-users', 'Sin conductores', 'No hay conductores aprobados.')}</div>
    `;
}

function renderResponseSummary(responses = []) {
    const counts = { pending: 0, accepted: 0, rejected: 0, completed: 0, paid: 0 };
    responses.forEach((r) => {
        if (r.status === 'pending') counts.pending++;
        else if (r.status === 'accepted') counts.accepted++;
        else if (r.status === 'rejected') counts.rejected++;
        else if (r.status === 'completed') {
            counts.completed++;
            if (r.rewardPaid) counts.paid++;
        }
    });
    const awaitingPay = counts.completed - counts.paid;
    let parts = [];
    if (counts.accepted) parts.push(`${counts.accepted} en progreso`);
    if (counts.pending) parts.push(`${counts.pending} sin responder`);
    if (awaitingPay > 0) parts.push(`${awaitingPay} por pagar`);
    if (counts.rejected) parts.push(`${counts.rejected} rechazados`);
    return parts.join(' · ') || 'Sin respuestas aún';
}

function renderSupervisorResponseRows(obj, responses, driversById) {
    const U = window.OpsUi;
    if (!responses.length) return '';

    let rows = '';
    responses.forEach((r) => {
        const driver = driversById[r.driverUid] || { name: r.driverName || 'Conductor' };
        const st = responseStatusLabel(r.status, r.rewardPaid);
        const target = effectiveTargetCount(obj);
        const progress = Math.min(target, Math.max(0, parseInt(r.progress, 10) || 0));
        const pct = Math.round((progress / target) * 100);

        let actions = '';
        if (r.status === 'completed' && !r.rewardPaid) {
            actions = U.btn('Marcar pagada', `window.markObjectiveRewardPaid('${obj.id}', '${r.driverUid}')`, { variant: 'emerald', icon: 'fa-hand-holding-usd' });
        }

        rows += `
            <div class="ops-objective-response-row">
                <div class="min-w-0 flex-1">
                    <p class="ops-objective-response-name">${escHtml(driver.name)}</p>
                    <p class="ops-objective-response-progress">${progress}/${target} (${pct}%)</p>
                </div>
                ${U.badge(st.text, st.variant)}
                ${actions}
            </div>
        `;
    });
    return `<div class="ops-objective-responses">${rows}</div>`;
}

function renderObjectiveCard(obj, { showActions = true, responses = [], driversById = {} } = {}) {
    const U = window.OpsUi;
    const st = objectiveStatusLabel(obj);
    const driverCount = (obj.driverIds || []).length;
    const target = effectiveTargetCount(obj);
    const summary = renderResponseSummary(responses);
    const expiryLine = obj.status === 'active' && !isObjectiveExpired(obj)
        ? `<p class="ops-objective-meta"><i class="fas fa-clock"></i> Vence: ${formatObjectiveDate(obj.expiresAt)} · ${escHtml(obj.durationLabel || '')}</p>`
        : obj.expiredAt || obj.status === 'expired'
            ? `<p class="ops-objective-meta"><i class="fas fa-hourglass-end"></i> Venció: ${formatObjectiveDate(obj.expiredAt || obj.expiresAt)}</p>`
            : '';

    let actions = '';
    if (showActions && obj.status === 'active' && !isObjectiveExpired(obj)) {
        actions = `
            <div class="ops-trip-actions">
                ${U.btn('Cerrar objetivo', `window.closeDriverObjective('${obj.id}')`, { variant: 'ghost', icon: 'fa-check-double' })}
                ${U.btn('Cancelar', `window.cancelDriverObjective('${obj.id}')`, { variant: 'ghost', icon: 'fa-ban' })}
            </div>
        `;
    }

    return U.card(`
        <div class="ops-objective-card-head">
            <div class="min-w-0 flex-1">
                <p class="ops-objective-title">${escHtml(obj.title)}</p>
                <p class="ops-objective-reward"><i class="fas fa-gift"></i> Recompensa: <b>${escHtml(obj.reward)}</b></p>
                <p class="ops-objective-meta">Meta: ${target} viaje${target === 1 ? '' : 's'} · ${driverCount} conductor${driverCount === 1 ? '' : 'es'} · ${formatObjectiveDate(obj.createdAt)}</p>
                ${expiryLine}
                <p class="ops-objective-drivers">${escHtml(summary)}</p>
            </div>
            ${U.badge(st.text, st.variant)}
        </div>
        ${renderSupervisorResponseRows(obj, responses, driversById)}
        ${actions}
    `, 'objective');
}

async function notifyDriversAboutObjective(driverIds, title, reward, nameMap) {
    const user = getCurrentUser();
    if (!user || !driverIds.length) return;

    const msg = `🎯 Nuevo objetivo: ${title}\n🏆 Recompensa: ${reward}\n⏱️ Tienes tiempo limitado para completarlo.\nResponde Aceptar o Rechazar en tu pantalla de conductor.`;
    const colRef = collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications');
    const sender = getSenderName();

    await Promise.all(driverIds.slice(0, 80).map(async (uid) => {
        const newRef = doc(colRef);
        await setDoc(newRef, {
            targetRole: 'driver',
            targetUserId: String(uid),
            targetUserName: nameMap[uid] || 'Conductor',
            personal: true,
            allowReply: true,
            threadId: newRef.id,
            message: msg,
            sentBy: user.uid,
            sentByName: sender,
            createdAt: serverTimestamp(),
            createdAtMs: Date.now(),
            objectiveAlert: true
        });
    }));
}

async function notifySupervisorsObjectiveComplete(objective, driverName) {
    const user = getCurrentUser();
    if (!user) return;

    const msg = `✅ ${driverName} completó el objetivo «${objective.title}». Recompensa: ${objective.reward}. ¡Págale su recompensa!`;
    await addDoc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'), {
        targetRole: 'supervisor',
        message: msg,
        sentBy: user.uid,
        sentByName: driverName,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
        objectiveId: objective.id,
        objectiveCompleteAlert: true,
        relatedDriverId: user.uid,
        rewardText: objective.reward
    });
}

async function loadObjectivesList() {
    const snap = await getDocs(query(objectivesCol(), orderBy('createdAt', 'desc'), limit(80)));
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    return list;
}

async function loadResponsesForObjective(objectiveId) {
    const snap = await getDocs(responsesCol(objectiveId));
    const list = [];
    snap.forEach((d) => list.push({ driverUid: d.id, ...d.data() }));
    return list;
}

function renderSupervisorObjectivesPage(drivers, objectives, responsesMap) {
    const U = window.OpsUi;
    const driversById = Object.fromEntries(drivers.map((d) => [d.uid, d]));
    const active = objectives.filter((o) => o.status === 'active' && !isObjectiveExpired(o));
    const history = objectives.filter((o) => o.status !== 'active' || isObjectiveExpired(o));
    const awaitingPay = active.reduce((n, o) => {
        const rs = responsesMap[o.id] || [];
        return n + rs.filter((r) => r.status === 'completed' && !r.rewardPaid).length;
    }, 0);

    let body = U.hero(
        'Objetivos',
        'Asigna metas y recompensas personalizadas a tus conductores',
        U.kpiRow([
            { value: active.length, label: 'Activos', variant: 'emerald' },
            { value: awaitingPay, label: 'Por pagar', variant: 'amber' },
            { value: drivers.length, label: 'Conductores', variant: 'default' }
        ])
    );

    body += U.section({
        title: 'Crear objetivo',
        subtitle: 'Describe la meta, la recompensa y cuántas unidades debe completar',
        icon: 'fa-bullseye',
        variant: 'emerald',
        body: U.formPanel('', '', `
            ${U.fieldLabel('Objetivo')}
            <textarea id="sup-objective-title" class="ops-input" rows="3" maxlength="500" placeholder="Ej: Completar 10 viajes esta semana"></textarea>
            ${U.fieldLabel('Recompensa')}
            <input type="text" id="sup-objective-reward" class="ops-input" maxlength="300" placeholder="Ej: L. 200 de bono, día libre de comisión, etc.">
            ${U.fieldLabel('Cantidad de viajes a completar')}
            <input type="number" id="sup-objective-target" class="ops-input" min="1" max="999" value="10" placeholder="Ej: 10">
            <p class="ops-toolbar-hint" style="margin-top:0.35rem">El conductor verá 0/10 y el progreso sube solo al terminar cada viaje.</p>
            ${U.fieldLabel('Tiempo para completar')}
            <select id="sup-objective-duration" class="ops-input">${renderDurationSelect()}</select>
            <p class="ops-toolbar-hint" style="margin-top:0.35rem">Si no se completa a tiempo, el objetivo se elimina automáticamente.</p>
            ${U.fieldLabel('Asignar a')}
            ${renderDriverPicker(drivers)}
            <div class="ops-form-actions">
                ${U.btn('Crear objetivo', 'window.createDriverObjective(this)', { variant: 'emerald', icon: 'fa-plus', full: true })}
            </div>
        `)
    });

    body += U.section({
        title: 'Objetivos activos',
        icon: 'fa-flag-checkered',
        badge: active.length,
        variant: 'emerald',
        body: active.length
            ? active.map((o) => renderObjectiveCard(o, { responses: responsesMap[o.id] || [], driversById })).join('')
            : U.empty('fa-bullseye', 'Sin objetivos activos', 'Crea uno arriba para motivar a tu equipo.')
    });

    if (history.length) {
        body += U.section({
            title: 'Historial',
            icon: 'fa-history',
            badge: history.length,
            variant: 'muted',
            collapsible: true,
            open: false,
            body: history.map((o) => renderObjectiveCard(o, { showActions: false, responses: responsesMap[o.id] || [], driversById })).join('')
        });
    }

    return U.page(body);
}

function renderProgressBar(progress, target) {
    const pct = Math.min(100, Math.round((progress / target) * 100));
    const unit = target === 1 ? 'viaje' : 'viajes';
    return `
        <div class="driver-obj-progress">
            <div class="driver-obj-progress-head">
                <span>Viajes completados</span>
                <span>${progress}/${target} ${unit}</span>
            </div>
            <div class="driver-obj-progress-track">
                <div class="driver-obj-progress-fill" style="width:${pct}%"></div>
            </div>
        </div>
    `;
}

function renderPendingObjectiveCard(obj) {
    return `
        <div class="driver-obj-pending-card">
            <p class="driver-obj-pending-label"><i class="fas fa-bullseye"></i> Nuevo objetivo del supervisor</p>
            <p class="driver-obj-pending-title">${escHtml(obj.title)}</p>
            <p class="driver-obj-pending-reward"><i class="fas fa-gift"></i> ${escHtml(obj.reward)}</p>
            <p class="driver-obj-pending-meta">Meta: ${effectiveTargetCount(obj)} viaje${effectiveTargetCount(obj) === 1 ? '' : 's'} · ${formatTimeRemaining(obj)}</p>
            <p class="driver-obj-pending-meta">${escHtml(obj.createdByName || 'Supervisor')}</p>
            <div class="driver-obj-pending-actions">
                <button type="button" class="driver-obj-btn driver-obj-btn--reject" onclick="window.rejectDriverObjective('${obj.id}')">Rechazar</button>
                <button type="button" class="driver-obj-btn driver-obj-btn--accept" onclick="window.acceptDriverObjective('${obj.id}')">Aceptar</button>
            </div>
        </div>
    `;
}

function renderActiveObjectiveWidget(obj, response) {
    const target = effectiveTargetCount(obj);
    const progress = Math.min(target, Math.max(0, parseInt(response.progress, 10) || 0));
    const minimized = isObjectiveMinimized(obj.id);
    const canComplete = progress >= target;
    const waitingPay = response.status === 'completed' && !response.rewardPaid;
    const paid = response.status === 'completed' && response.rewardPaid;

    if (minimized) {
        return `
            <div class="driver-obj-float driver-obj-float--min" data-obj-id="${obj.id}" data-obj-expand="1" title="Toca para ver · arrastra para mover">
                <div class="driver-obj-min-pill" role="presentation">
                    <i class="fas fa-bullseye"></i>
                    <span>${paid ? 'Pagado' : waitingPay ? 'Esperando pago' : `${progress}/${target}`}</span>
                </div>
            </div>
        `;
    }

    let footer = '';
    if (paid) {
        footer = `<p class="driver-obj-status driver-obj-status--paid"><i class="fas fa-check-circle"></i> Recompensa pagada</p>`;
    } else if (waitingPay) {
        footer = `<p class="driver-obj-status driver-obj-status--wait"><i class="fas fa-hourglass-half"></i> Completado — esperando que el supervisor pague tu recompensa</p>`;
    } else if (response.status === 'accepted') {
        footer = `
            ${renderProgressBar(progress, target)}
            <p class="driver-obj-auto-hint"><i class="fas fa-route"></i> El contador sube al terminar cada viaje</p>
            <button type="button" class="driver-obj-complete-btn" data-no-drag onclick="window.submitDriverObjectiveComplete('${obj.id}')"
                ${canComplete ? '' : 'disabled title="Completa los viajes de la meta para notificar al supervisor"'}>
                <i class="fas fa-flag-checkered"></i> Marcar completado
            </button>
        `;
    }

    return `
        <div class="driver-obj-float" data-obj-id="${obj.id}">
            <div class="driver-obj-float-head">
                <p class="driver-obj-float-title"><i class="fas fa-bullseye"></i> Objetivo activo</p>
                <button type="button" class="driver-obj-min-btn" data-no-drag onclick="window.toggleDriverObjectiveMinimized('${obj.id}', true)" title="Minimizar">
                    <i class="fas fa-minus"></i>
                </button>
            </div>
            <p class="driver-obj-float-desc">${escHtml(obj.title)}</p>
            <p class="driver-obj-float-reward"><i class="fas fa-gift"></i> ${escHtml(obj.reward)}</p>
            <p class="driver-obj-time-left"><i class="fas fa-clock"></i> ${formatTimeRemaining(obj)}</p>
            ${footer}
        </div>
    `;
}

function mergeDriverObjectivesData(objectives, responses) {
    const respByObj = {};
    responses.forEach((r) => {
        if (!respByObj[r.objectiveId]) respByObj[r.objectiveId] = r;
    });

    return objectives
        .filter((o) => o.status === 'active' && !isObjectiveExpired(o))
        .map((o) => ({
            ...o,
            myResponse: respByObj[o.id] || { status: 'pending', progress: 0, rewardPaid: false }
        }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

function renderDriverObjectivesPanels(merged) {
    const pendingEl = document.getElementById('driver-objectives-pending');
    const activeEl = document.getElementById('driver-objectives-active');
    if (!pendingEl || !activeEl) return;

    const pending = merged.filter((o) => o.myResponse.status === 'pending');
    const active = merged.filter((o) =>
        o.myResponse.status === 'accepted' ||
        (o.myResponse.status === 'completed')
    );

    if (pending.length) {
        pendingEl.classList.remove('hidden');
        pendingEl.innerHTML = pending.map((o) => renderPendingObjectiveCard(o)).join('');
    } else {
        pendingEl.classList.add('hidden');
        pendingEl.innerHTML = '';
    }

    if (active.length) {
        activeEl.classList.remove('hidden');
        activeEl.innerHTML = active.map((o) => renderActiveObjectiveWidget(o, o.myResponse)).join('');
        window.bindFloatingObjectivePanels?.();
    } else {
        activeEl.classList.add('hidden');
        activeEl.innerHTML = '';
    }
}

let cachedDriverObjectives = [];
let cachedDriverResponses = [];

function defaultDriverResponse(objectiveId, driverUid) {
    return {
        objectiveId,
        driverUid,
        status: 'pending',
        progress: 0,
        rewardPaid: false
    };
}

function upsertCachedDriverResponse(response) {
    const objectiveId = response.objectiveId;
    if (!objectiveId) return;
    const idx = cachedDriverResponses.findIndex((r) => r.objectiveId === objectiveId);
    if (idx >= 0) cachedDriverResponses[idx] = { ...cachedDriverResponses[idx], ...response };
    else cachedDriverResponses.push(response);
}

async function loadDriverResponsesForObjectives(objectives, driverUid) {
    if (!driverUid || !objectives.length) return [];

    const responses = await Promise.all(objectives.map(async (o) => {
        try {
            const snap = await getDoc(responseDocRef(o.id, driverUid));
            if (snap.exists()) {
                return { ...snap.data(), objectiveId: o.id, driverUid };
            }
        } catch (e) {
            console.warn('loadDriverResponse:', o.id, e);
        }
        return defaultDriverResponse(o.id, driverUid);
    }));
    return responses;
}

function stopDriverResponseListeners() {
    driverResponseUnsubs.forEach((unsub) => {
        try { unsub(); } catch (_) {}
    });
    driverResponseUnsubs = [];
}

function bindDriverResponseListeners(objectives, driverUid) {
    stopDriverResponseListeners();
    if (!driverUid) return;

    objectives
        .filter((o) => o.status === 'active')
        .forEach((o) => {
            const unsub = onSnapshot(
                responseDocRef(o.id, driverUid),
                (snap) => {
                    const data = snap.exists()
                        ? { ...snap.data(), objectiveId: o.id, driverUid }
                        : defaultDriverResponse(o.id, driverUid);
                    upsertCachedDriverResponse(data);
                    refreshDriverObjectivesUI();
                },
                (err) => console.warn('driverResponseListener:', o.id, err)
            );
            driverResponseUnsubs.push(unsub);
        });
}

async function reloadDriverObjectivesState() {
    const user = getCurrentUser();
    if (!user || window.userProfile?.role !== 'driver') {
        document.getElementById('driver-objectives-pending')?.classList.add('hidden');
        document.getElementById('driver-objectives-active')?.classList.add('hidden');
        return;
    }

    const objSnap = await getDocs(query(
        objectivesCol(),
        where('driverIds', 'array-contains', user.uid),
        limit(30)
    ));

    cachedDriverObjectives = [];
    objSnap.forEach((d) => cachedDriverObjectives.push({ id: d.id, ...d.data() }));
    cachedDriverResponses = await loadDriverResponsesForObjectives(cachedDriverObjectives, user.uid);
    bindDriverResponseListeners(cachedDriverObjectives, user.uid);
    refreshDriverObjectivesUI();
}

function refreshDriverObjectivesUI() {
    const user = getCurrentUser();
    if (!user || window.userProfile?.role !== 'driver') {
        document.getElementById('driver-objectives-pending')?.classList.add('hidden');
        document.getElementById('driver-objectives-active')?.classList.add('hidden');
        return;
    }
    const merged = mergeDriverObjectivesData(cachedDriverObjectives, cachedDriverResponses);
    renderDriverObjectivesPanels(merged);
}

async function incrementProgressOnTripComplete(driverId, tripId) {
    if (!dbRef || !appIdRef || !driverId || !tripId) return;

    try {
        const objSnap = await getDocs(query(
            objectivesCol(),
            where('driverIds', 'array-contains', driverId),
            limit(30)
        ));

        const objectives = [];
        objSnap.forEach((d) => {
            const data = d.data();
            if (data.status === 'active') objectives.push({ id: d.id, ...data });
        });
        if (!objectives.length) return;

        for (const obj of objectives) {
            const respRef = responseDocRef(obj.id, driverId);
            const respSnap = await getDoc(respRef);
            if (!respSnap.exists()) continue;

            const resp = respSnap.data();
            if (resp.status !== 'accepted') continue;

            const counted = Array.isArray(resp.countedTripIds) ? resp.countedTripIds : [];
            if (counted.includes(tripId)) continue;

            const target = effectiveTargetCount(obj);
            const progress = parseInt(resp.progress, 10) || 0;
            if (progress >= target) continue;

            const newProgress = Math.min(target, progress + 1);
            await updateDoc(respRef, {
                progress: newProgress,
                countedTripIds: arrayUnion(tripId),
                updatedAt: serverTimestamp()
            });

            if (newProgress >= target) {
                window.showToast?.(`¡Meta cumplida! ${newProgress}/${target} viajes. Marca completado para cobrar tu recompensa.`, 'success');
            }
        }
    } catch (e) {
        console.warn('incrementProgressOnTripComplete:', e);
    }
}

async function ensureDriverResponse(objectiveId, driverUid, driverName) {
    const ref = responseDocRef(objectiveId, driverUid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();

    const data = {
        driverUid,
        driverName: driverName || 'Conductor',
        objectiveId,
        status: 'pending',
        progress: 0,
        rewardPaid: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    await setDoc(ref, data);
    return data;
}

export function initDriverObjectives({ db, appId, getCurrentUser: getUser, getSenderDisplayName, getDriverProfile: getProfile }) {
    dbRef = db;
    appIdRef = appId;
    getCurrentUser = getUser || (() => null);
    getSenderName = getSenderDisplayName || (() => 'Supervisor');
    getDriverProfile = getProfile || (() => window.userProfile || null);

    window.filterSupObjectiveDriverSearch = () => {
        const term = (document.getElementById('sup-objective-driver-search')?.value || '').toLowerCase().trim();
        document.querySelectorAll('.sup-objective-driver-row').forEach((row) => {
            row.style.display = cardMatchesObjectiveSearch(row, term) ? '' : 'none';
        });
    };

    window.toggleSupObjectiveDriver = (uid, checked) => {
        const set = getSelectedDriverIds();
        if (checked) set.add(uid);
        else set.delete(uid);
        updateObjectiveSelectionCount();
    };

    window.toggleSupObjectiveAllDrivers = (selectAll) => {
        const set = getSelectedDriverIds();
        document.querySelectorAll('.ops-objective-check').forEach((cb) => {
            const uid = cb.dataset.uid;
            cb.checked = !!selectAll;
            if (selectAll) set.add(uid);
            else set.delete(uid);
        });
        updateObjectiveSelectionCount();
    };

    window.loadSupervisorObjectives = async () => {
        const container = document.getElementById('supervisor-pending-list');
        if (!container) return;

        window.setSupervisorNavActive?.('objectives');
        container.innerHTML = window.OPS_LOADING_HTML || '<div class="ops-loading"><p>Cargando objetivos…</p></div>';

        try {
            window._supObjectiveSelectedDrivers = new Set();
            const [drivers, objectives] = await Promise.all([
                fetchApprovedDrivers(),
                loadObjectivesList()
            ]);
            const responsesMap = {};
            await Promise.all(objectives.map(async (o) => {
                responsesMap[o.id] = await loadResponsesForObjective(o.id);
            }));
            container.innerHTML = renderSupervisorObjectivesPage(drivers, objectives, responsesMap);
            updateObjectiveSelectionCount();
        } catch (e) {
            console.error('loadSupervisorObjectives:', e);
            container.innerHTML = `<p class="text-red-500 text-center font-bold p-6">Error al cargar objetivos: ${escHtml(e.message)}</p>`;
        }
    };

    window.createDriverObjective = async (btn) => {
        const user = getCurrentUser();
        if (!user) return window.showToast?.('Inicia sesión de nuevo.');

        const title = document.getElementById('sup-objective-title')?.value?.trim();
        const reward = document.getElementById('sup-objective-reward')?.value?.trim();
        const targetRaw = parseInt(document.getElementById('sup-objective-target')?.value, 10);
        const targetCount = Number.isFinite(targetRaw) && targetRaw >= 1 ? Math.min(targetRaw, 999) : 10;
        const durationPreset = document.getElementById('sup-objective-duration')?.value || DEFAULT_OBJECTIVE_DURATION;
        const duration = resolveDurationPreset(durationPreset);
        const expiresAtDate = new Date(Date.now() + duration.ms);
        const driverIds = Array.from(getSelectedDriverIds());

        if (!title) return window.showToast?.('Escribe el objetivo.');
        if (!reward) return window.showToast?.('Escribe la recompensa.');
        if (!driverIds.length) return window.showToast?.('Selecciona al menos un conductor.');

        const original = btn?.innerHTML;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Creando…</span>';
        }

        try {
            const drivers = await fetchApprovedDrivers();
            const nameMap = {};
            const driverNames = [];
            drivers.forEach((d) => {
                if (driverIds.includes(d.uid)) {
                    nameMap[d.uid] = d.name || 'Conductor';
                    driverNames.push(d.name || 'Conductor');
                }
            });

            const objRef = await addDoc(objectivesCol(), {
                title,
                reward,
                targetCount,
                durationPreset,
                durationLabel: duration.label,
                durationMs: duration.ms,
                expiresAt: Timestamp.fromDate(expiresAtDate),
                expiresAtMs: expiresAtDate.getTime(),
                driverIds,
                driverNames,
                status: 'active',
                createdByUid: user.uid,
                createdByName: getSenderName(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            await Promise.all(driverIds.map((uid) => setDoc(responseDocRef(objRef.id, uid), {
                driverUid: uid,
                driverName: nameMap[uid] || 'Conductor',
                objectiveId: objRef.id,
                status: 'pending',
                progress: 0,
                rewardPaid: false,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            })));

            notifyDriversAboutObjective(driverIds, title, reward, nameMap).catch(() => {});

            window.showToast?.(`Objetivo creado para ${driverIds.length} conductor${driverIds.length === 1 ? '' : 'es'}.`, 'success');
            await window.loadSupervisorObjectives();
        } catch (e) {
            console.error('createDriverObjective:', e);
            window.showToast?.('No se pudo crear el objetivo.');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        }
    };

    window.closeDriverObjective = async (id) => {
        if (!confirm('¿Cerrar este objetivo? Los conductores ya no podrán actualizarlo.')) return;
        try {
            await updateDoc(objectiveDocRef(id), {
                status: 'completed',
                closedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            window.showToast?.('Objetivo cerrado.', 'success');
            await window.loadSupervisorObjectives();
        } catch (e) {
            console.error('closeDriverObjective:', e);
            window.showToast?.('Error al cerrar.');
        }
    };

    window.cancelDriverObjective = async (id) => {
        if (!confirm('¿Cancelar este objetivo?')) return;
        try {
            await updateDoc(objectiveDocRef(id), {
                status: 'cancelled',
                updatedAt: serverTimestamp()
            });
            window.showToast?.('Objetivo cancelado.', 'warning');
            await window.loadSupervisorObjectives();
        } catch (e) {
            console.error('cancelDriverObjective:', e);
            window.showToast?.('Error al cancelar.');
        }
    };

    window.markObjectiveRewardPaid = async (objectiveId, driverUid) => {
        if (!confirm('¿Confirmas que ya pagaste la recompensa a este conductor?')) return;
        const user = getCurrentUser();
        try {
            await updateDoc(responseDocRef(objectiveId, driverUid), {
                rewardPaid: true,
                rewardPaidAt: serverTimestamp(),
                rewardPaidBy: user?.uid || null,
                rewardPaidByName: getSenderName(),
                updatedAt: serverTimestamp()
            });

            const driver = (window.allUsersData || []).find((d) => d.uid === driverUid);
            const driverName = driver?.name || 'Conductor';
            const objSnap = await getDoc(objectiveDocRef(objectiveId));
            const reward = objSnap.data()?.reward || '';

            const newRef = doc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'));
            await setDoc(newRef, {
                targetRole: 'driver',
                targetUserId: String(driverUid),
                targetUserName: driverName,
                personal: true,
                threadId: newRef.id,
                message: `🎉 Tu recompensa fue marcada como pagada: ${reward}`,
                sentBy: user?.uid,
                sentByName: getSenderName(),
                createdAt: serverTimestamp(),
                createdAtMs: Date.now()
            });

            window.showToast?.('Recompensa marcada como pagada.', 'success');
            await window.loadSupervisorObjectives();
        } catch (e) {
            console.error('markObjectiveRewardPaid:', e);
            window.showToast?.('Error al marcar pago.');
        }
    };

    window.acceptDriverObjective = async (objectiveId) => {
        const user = getCurrentUser();
        const profile = getDriverProfile();
        if (!user) return;

        try {
            const objSnap = await getDoc(objectiveDocRef(objectiveId));
            if (!objSnap.exists() || isObjectiveExpired({ ...objSnap.data(), id: objectiveId })) {
                return window.showToast?.('Este objetivo ya venció.');
            }
            await ensureDriverResponse(objectiveId, user.uid, profile?.name);
            await updateDoc(responseDocRef(objectiveId, user.uid), {
                status: 'accepted',
                acceptedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            setObjectiveMinimized(objectiveId, false);
            upsertCachedDriverResponse({
                objectiveId,
                driverUid: user.uid,
                status: 'accepted',
                progress: 0,
                rewardPaid: false
            });
            window.showToast?.('Objetivo aceptado. ¡Mucho éxito!', 'success');
            refreshDriverObjectivesUI();
            reloadDriverObjectivesState().catch(() => {});
        } catch (e) {
            console.error('acceptDriverObjective:', e);
            window.showToast?.('No se pudo aceptar el objetivo.');
        }
    };

    window.rejectDriverObjective = async (objectiveId) => {
        const user = getCurrentUser();
        const profile = getDriverProfile();
        if (!user) return;
        if (!confirm('¿Rechazar este objetivo?')) return;

        try {
            await ensureDriverResponse(objectiveId, user.uid, profile?.name);
            await updateDoc(responseDocRef(objectiveId, user.uid), {
                status: 'rejected',
                rejectedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            upsertCachedDriverResponse({
                objectiveId,
                driverUid: user.uid,
                status: 'rejected',
                progress: 0,
                rewardPaid: false
            });
            window.showToast?.('Objetivo rechazado.');
            refreshDriverObjectivesUI();
            reloadDriverObjectivesState().catch(() => {});
        } catch (e) {
            console.error('rejectDriverObjective:', e);
            window.showToast?.('No se pudo rechazar.');
        }
    };

    window.adjustDriverObjectiveProgress = async (objectiveId, delta) => {
        const user = getCurrentUser();
        if (!user) return;

        try {
            const [objSnap, respSnap] = await Promise.all([
                getDoc(objectiveDocRef(objectiveId)),
                getDoc(responseDocRef(objectiveId, user.uid))
            ]);
            if (!objSnap.exists() || objSnap.data().status !== 'active' || isObjectiveExpired({ ...objSnap.data(), id: objectiveId })) return;
            if (!respSnap.exists() || respSnap.data().status !== 'accepted') return;

            const target = effectiveTargetCount({ targetCount: objSnap.data().targetCount, title: objSnap.data().title });
            const current = parseInt(respSnap.data().progress, 10) || 0;
            const next = Math.max(0, Math.min(target, current + delta));

            await updateDoc(responseDocRef(objectiveId, user.uid), {
                progress: next,
                updatedAt: serverTimestamp()
            });
        } catch (e) {
            console.error('adjustDriverObjectiveProgress:', e);
            window.showToast?.('No se pudo actualizar el progreso.');
        }
    };

    window.submitDriverObjectiveComplete = async (objectiveId) => {
        const user = getCurrentUser();
        const profile = getDriverProfile();
        if (!user) return;

        try {
            const [objSnap, respSnap] = await Promise.all([
                getDoc(objectiveDocRef(objectiveId)),
                getDoc(responseDocRef(objectiveId, user.uid))
            ]);
            if (!objSnap.exists()) return;
            if (isObjectiveExpired({ ...objSnap.data(), id: objectiveId })) {
                return window.showToast?.('Este objetivo ya venció.');
            }

            const objective = { id: objectiveId, ...objSnap.data() };
            const target = effectiveTargetCount(objective);
            const progress = parseInt(respSnap.data()?.progress, 10) || 0;

            if (progress < target) {
                return window.showToast?.(`Alcanza ${target} para marcar completado.`);
            }
            if (!confirm('¿Confirmas que completaste este objetivo? Se notificará a los supervisores para que paguen tu recompensa.')) return;

            await updateDoc(responseDocRef(objectiveId, user.uid), {
                status: 'completed',
                completedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            await notifySupervisorsObjectiveComplete(objective, profile?.name || 'Conductor');
            window.showToast?.('¡Objetivo completado! Los supervisores fueron notificados.', 'success');
            refreshDriverObjectivesUI();
        } catch (e) {
            console.error('submitDriverObjectiveComplete:', e);
            window.showToast?.('No se pudo marcar como completado.');
        }
    };

    window.toggleDriverObjectiveMinimized = (objectiveId, minimized) => {
        setObjectiveMinimized(objectiveId, minimized);
        refreshDriverObjectivesUI();
    };

    window.renderDriverObjectivesPanel = async () => {
        try {
            await reloadDriverObjectivesState();
        } catch (e) {
            console.warn('renderDriverObjectivesPanel:', e);
        }
    };

    function startObjectiveExpiryTimer() {
        clearInterval(objectiveExpiryTimer);
        objectiveExpiryTimer = setInterval(() => {
            if (window.userProfile?.role !== 'driver') return;
            const hadActive = cachedDriverObjectives.some((o) => o.status === 'active' && !isObjectiveExpired(o));
            cachedDriverObjectives = cachedDriverObjectives.filter((o) => o.status === 'active' && !isObjectiveExpired(o));
            if (hadActive) refreshDriverObjectivesUI();
        }, 30000);
    }

    window.startDriverObjectivesListener = () => {
        const user = getCurrentUser();
        if (!user || window.userProfile?.role !== 'driver') return;
        if (driverObjectivesUnsub) return;

        startObjectiveExpiryTimer();

        try {
            driverObjectivesUnsub = onSnapshot(
                query(objectivesCol(), where('driverIds', 'array-contains', user.uid), limit(30)),
                async (snap) => {
                    cachedDriverObjectives = [];
                    snap.forEach((d) => cachedDriverObjectives.push({ id: d.id, ...d.data() }));
                    cachedDriverResponses = await loadDriverResponsesForObjectives(cachedDriverObjectives, user.uid);
                    bindDriverResponseListeners(cachedDriverObjectives, user.uid);
                    refreshDriverObjectivesUI();
                },
                (err) => console.warn('driverObjectivesListener:', err)
            );
        } catch (e) {
            console.warn('startDriverObjectivesListener:', e);
        }
    };

    window.stopDriverObjectivesListener = () => {
        if (driverObjectivesUnsub) {
            driverObjectivesUnsub();
            driverObjectivesUnsub = null;
        }
        stopDriverResponseListeners();
        clearInterval(objectiveExpiryTimer);
        objectiveExpiryTimer = null;
    };

    window.incrementDriverObjectiveOnTripComplete = incrementProgressOnTripComplete;
}