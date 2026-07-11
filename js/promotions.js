/**
 * Promociones — carrusel mapa pasajero, reclamar bono, panel staff
 */
import {
    collection, addDoc, getDocs, getDoc, updateDoc, doc, setDoc, deleteDoc,
    serverTimestamp, query, where, onSnapshot, orderBy, limit, Timestamp
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

let dbRef = null;
let appIdRef = null;
let getCurrentUser = () => null;
let getUserProfile = () => null;
let httpsCallableRef = null;
let cloudFunctionsRef = null;
let activePromosUnsub = null;
let claimedPromosUnsub = null;

export function normalizePromoCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Regla 80%: viaje debe costar >= discountAmount * minSpendPercent/100 */
export function calcPromoApplication(originalPrice, discountAmount, minSpendPercent = 80) {
    const price = Math.round(parseFloat(originalPrice) * 100) / 100;
    const discount = Math.round(parseFloat(discountAmount) * 100) / 100;
    const pct = Math.min(100, Math.max(1, parseFloat(minSpendPercent) || 80));
    const minFare = Math.round(discount * (pct / 100) * 100) / 100;

    if (!price || !discount) {
        return { eligible: false, minFare, reason: 'Datos de promo inválidos.' };
    }
    if (price < minFare) {
        return {
            eligible: false,
            minFare,
            reason: `Gasta al menos L. ${minFare.toFixed(2)} para usar este bono.`
        };
    }

    const discountApplied = Math.min(discount, price);
    const passengerPays = Math.round((price - discountApplied) * 100) / 100;

    return {
        eligible: true,
        minFare,
        discountApplied,
        passengerPays,
        subsidyOwed: discountApplied,
        originalPrice: price
    };
}

function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isCallableTransportError(err) {
    const code = String(err?.code || '');
    const msg = String(err?.message || err || '').toLowerCase();
    return code === 'functions/unavailable'
        || code === 'functions/internal'
        || code === 'functions/deadline-exceeded'
        || msg.includes('cors')
        || msg.includes('failed to fetch')
        || msg.includes('network')
        || msg.includes('err_failed');
}

async function findPromoDocByCode(code) {
    const normalized = normalizePromoCode(code);
    if (!normalized) return null;
    const snap = await getDocs(query(promosCol(), where('code', '==', normalized), limit(1)));
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ref: d.ref, data: d.data() || {} };
}

async function publishPromotionClientFallback(payload, uid) {
    const code = normalizePromoCode(payload.code);
    const existing = await findPromoDocByCode(code);
    if (existing) throw new Error('Ya existe una promo con ese código.');

    const validFromMs = payload.validFrom ? new Date(payload.validFrom).getTime() : Date.now();
    const validUntilMs = payload.validUntil ? new Date(payload.validUntil).getTime() : null;
    const promoDoc = {
        code,
        title: payload.title,
        description: payload.description || '',
        discountAmount: payload.discountAmount,
        minSpendPercent: payload.minSpendPercent ?? 80,
        maxUsers: payload.maxUsers ?? null,
        maxBudget: payload.maxBudget ?? null,
        maxUsesPerUser: payload.maxUsesPerUser ?? 1,
        claimedCount: 0,
        usedBudget: 0,
        redemptionCount: 0,
        status: 'active',
        notifyOnPublish: payload.notifyOnPublish !== false,
        showOnMap: payload.showOnMap !== false,
        validFrom: Timestamp.fromMillis(validFromMs),
        validFromMs: validFromMs,
        validUntil: validUntilMs ? Timestamp.fromMillis(validUntilMs) : null,
        validUntilMs: validUntilMs || null,
        createdBy: uid,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now()
    };

    const ref = await addDoc(promosCol(), promoDoc);
    return { ok: true, promoId: ref.id, notified: 0, fallback: true };
}

async function managePromotionClientFallback(promoId, action) {
    const ref = promoDocRef(promoId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Promoción no encontrada.');

    if (action === 'delete') {
        await setDoc(ref, { status: 'deleted', deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    } else if (action === 'pause') {
        await setDoc(ref, { status: 'paused', updatedAt: serverTimestamp() }, { merge: true });
    } else if (action === 'activate') {
        await setDoc(ref, { status: 'active', updatedAt: serverTimestamp() }, { merge: true });
    } else {
        throw new Error('Acción no válida.');
    }
    return { ok: true, action, fallback: true };
}

function promosCol() {
    return collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'promotions');
}

function promoDocRef(id) {
    return doc(dbRef, 'artifacts', appIdRef, 'public', 'data', 'promotions', id);
}

function claimedPromoRef(uid, promoId) {
    return doc(dbRef, 'artifacts', appIdRef, 'users', uid, 'claimed_promos', promoId);
}

function tripsCol() {
    return collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'trips');
}

function promoTimeMs(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v?.toMillis === 'function') {
        try { return v.toMillis(); } catch (_) {}
    }
    if (typeof v?.toDate === 'function') {
        try { return v.toDate().getTime(); } catch (_) {}
    }
    if (typeof v?.seconds === 'number') return v.seconds * 1000;
    if (typeof v === 'string') {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : 0;
    }
    return 0;
}

function isPromoCurrentlyActive(promo) {
    if (!promo || promo.status !== 'active') return false;
    const now = Date.now();
    const fromMs = promo.validFromMs || promoTimeMs(promo.validFrom);
    const untilMs = promo.validUntilMs || promoTimeMs(promo.validUntil);
    if (fromMs && now < fromMs) return false;
    if (untilMs && now > untilMs) return false;
    if (promo.maxUsers && (promo.claimedCount || 0) >= promo.maxUsers) return false;
    return true;
}

function formatPromoDate(ts) {
    if (!ts) return '—';
    let d = null;
    if (typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    else if (typeof ts === 'number') d = new Date(ts);
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' });
}

async function loadActivePromotions() {
    const snap = await getDocs(promosCol());
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.status === 'active' && p.showOnMap !== false && isPromoCurrentlyActive(p))
        .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

async function loadAllPromotionsForStaff() {
    const snap = await getDocs(promosCol());
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.status !== 'deleted')
        .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

async function loadClaimedPromos(uid) {
    if (!uid) return [];
    const snap = await getDocs(collection(dbRef, 'artifacts', appIdRef, 'users', uid, 'claimed_promos'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getBestClaimedPromoForTrip(uid, tripPrice) {
    const claimed = await loadClaimedPromos(uid);
    const unused = claimed.filter((c) => !c.used);
    let best = null;
    let bestDiscount = 0;

    for (const claim of unused) {
        let promo = claim;
        if (!claim.discountAmount && claim.promoId) {
            const ps = await getDoc(promoDocRef(claim.promoId));
            if (ps.exists()) promo = { ...claim, ...ps.data() };
        }
        if (!isPromoCurrentlyActive(promo)) continue;
        const calc = calcPromoApplication(tripPrice, promo.discountAmount, promo.minSpendPercent ?? 80);
        if (!calc.eligible) continue;
        if (calc.discountApplied > bestDiscount) {
            bestDiscount = calc.discountApplied;
            best = { claim, promo, calc };
        }
    }
    return best;
}

function renderPromoMapCard(promo) {
    const amt = parseFloat(promo.discountAmount) || 0;
    const minPct = promo.minSpendPercent ?? 80;
    const minFare = Math.round(amt * (minPct / 100) * 100) / 100;
    const title = promo.title || promo.code || 'Promo';
    return `
        <button type="button" class="passenger-promo-card" data-promo-id="${escHtml(promo.id)}" data-promo-code="${escHtml(promo.code)}"
                title="Mín. L. ${minFare.toFixed(0)} · ${escHtml(promo.code)}">
            <span class="passenger-promo-card-badge">PROMO</span>
            <span class="passenger-promo-card-amount">L.${amt.toFixed(0)}</span>
            <span class="passenger-promo-card-title">${escHtml(title)}</span>
            <span class="passenger-promo-card-cta">Reclamar</span>
        </button>`;
}

const PROMO_STRIP_DISMISS_KEY = 'honduber_promo_strip_dismissed';
const PROMO_STRIP_SEEN_IDS_KEY = 'honduber_promo_strip_seen_ids';

function isPromoStripDismissedThisSession() {
    try {
        return sessionStorage.getItem(PROMO_STRIP_DISMISS_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function getSeenPromoIds() {
    try {
        const raw = sessionStorage.getItem(PROMO_STRIP_SEEN_IDS_KEY) || '[]';
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch (_) {
        return new Set();
    }
}

function setSeenPromoIds(ids) {
    try {
        sessionStorage.setItem(PROMO_STRIP_SEEN_IDS_KEY, JSON.stringify([...ids]));
    } catch (_) {}
}

/**
 * Si llega una promo NUEVA (id que no habíamos visto), reabrir el strip
 * aunque el usuario haya tocado la X en esta sesión.
 */
function revealIfNewPromos(promos) {
    const ids = (promos || []).map((p) => String(p.id)).filter(Boolean);
    if (!ids.length) return false;
    const seen = getSeenPromoIds();
    const hasNew = ids.some((id) => !seen.has(id));
    ids.forEach((id) => seen.add(id));
    setSeenPromoIds(seen);
    if (hasNew) {
        try { sessionStorage.removeItem(PROMO_STRIP_DISMISS_KEY); } catch (_) {}
        return true;
    }
    return false;
}

/** Al iniciar sesión: la X se olvida y las promos vuelven a mostrarse. */
export function resetPromoStripSessionDismiss() {
    try {
        sessionStorage.removeItem(PROMO_STRIP_DISMISS_KEY);
        sessionStorage.removeItem(PROMO_STRIP_SEEN_IDS_KEY);
    } catch (_) {}
    updatePromoStripVisibility();
}

function setPromoStripHidden(strip, hidden) {
    if (!strip) return;
    strip.classList.toggle('hidden', hidden);
    strip.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    // Inline style como respaldo en WebView Android (por si .hidden pierde contra display:flex)
    if (hidden) {
        strip.style.setProperty('display', 'none', 'important');
        strip.style.visibility = 'hidden';
        strip.style.pointerEvents = 'none';
        strip.style.opacity = '0';
    } else {
        // fixed + flex: evita que el strip quede clippeado/oculto en Capacitor Android
        strip.style.setProperty('display', 'flex', 'important');
        strip.style.setProperty('position', 'fixed', 'important');
        strip.style.visibility = 'visible';
        strip.style.pointerEvents = 'auto';
        strip.style.opacity = '1';
        strip.style.zIndex = '70';
        // Si nunca se arrastró, anclar arriba-izquierda sobre el mapa (visible con panel abierto)
        if (!strip.classList.contains('is-drag-positioned')) {
            const safeTop = 'max(0.75rem, env(safe-area-inset-top, 0px))';
            strip.style.left = '0.55rem';
            strip.style.right = 'auto';
            strip.style.bottom = 'auto';
            strip.style.top = `calc(4.6rem + ${safeTop})`;
        }
    }
}

function updatePromoStripVisibility() {
    const strip = document.getElementById('passenger-promo-strip');
    if (!strip) return;
    const profile = getUserProfile?.() || window.userProfile;
    const isClient = profile?.role === 'client' || !profile?.role;
    const isDriverMode = document.body.classList.contains('driver-mode') || profile?.role === 'driver';
    const hasActiveTrip = !!window.activeTrip && !['completed', 'cancelled', 'canceled'].includes(window.activeTrip?.status);
    const searching = document.body.classList.contains('is-searching');
    const tripActive = document.body.classList.contains('trip-active');
    const panelMinimized = document.body.classList.contains('panel-minimized');
    const dismissed = isPromoStripDismissedThisSession();
    const hasPromos = strip.dataset.hasPromos === '1';

    // Con panel abierto (no minimizado) y promos activas → SIEMPRE mostrar (salvo viaje/búsqueda/conductor).
    // La X solo oculta hasta que entre una promo nueva o reinicie sesión.
    const mustShowWhenExpanded = !panelMinimized && hasPromos && isClient && !isDriverMode;
    const shouldShow = mustShowWhenExpanded
        && !hasActiveTrip
        && !searching
        && !tripActive
        && !dismissed;

    setPromoStripHidden(strip, !shouldShow);

    // Refuerzo Android: si debe verse y quedó con display:none residual, forzar de nuevo
    if (shouldShow && strip) {
        requestAnimationFrame(() => {
            if (strip.classList.contains('hidden')) return;
            if (getComputedStyle(strip).display === 'none') {
                strip.style.setProperty('display', 'flex', 'important');
            }
        });
    }
}

function dismissPromoStripNow() {
    if (isPromoStripDismissedThisSession()) {
        // Ya oculta (doble evento touch/click): solo reforzar hide
        setPromoStripHidden(document.getElementById('passenger-promo-strip'), true);
        return;
    }
    const strip = document.getElementById('passenger-promo-strip');
    try {
        sessionStorage.setItem(PROMO_STRIP_DISMISS_KEY, '1');
    } catch (_) {}
    setPromoStripHidden(strip, true);
    window.showToast?.('Promos ocultas. Volverán al iniciar sesión de nuevo.', 'info');
}

function bindPromoStripClose() {
    const btn = document.getElementById('passenger-promo-close');
    const strip = document.getElementById('passenger-promo-strip');
    if (!btn || !strip || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    const onClose = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { e.stopImmediatePropagation?.(); } catch (_) {}
        dismissPromoStripNow();
    };

    // pointerup en capture: más fiable en WebView Android que solo click
    btn.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        onClose(e);
    }, { capture: true });
    btn.addEventListener('click', onClose);
}

function renderPromoStrip(promos) {
    const strip = document.getElementById('passenger-promo-strip');
    const track = document.getElementById('passenger-promo-track');
    if (!strip || !track) return;

    if (!promos.length) {
        strip.dataset.hasPromos = '0';
        track.innerHTML = '';
        setPromoStripHidden(strip, true);
        return;
    }

    // Promo nueva → reabrir aunque hayan tocado la X
    revealIfNewPromos(promos);

    strip.dataset.hasPromos = '1';
    track.innerHTML = promos.map(renderPromoMapCard).join('');
    track.querySelectorAll('.passenger-promo-card').forEach((btn) => {
        btn.addEventListener('click', () => {
            window.showClaimPromoModal?.(btn.dataset.promoCode || '', btn.dataset.promoId || '');
        });
    });
    bindPromoStripClose();
    updatePromoStripVisibility();

    // Capacitor/Android: segundo tick por si el panel aún no pintó
    setTimeout(() => updatePromoStripVisibility(), 120);
    setTimeout(() => updatePromoStripVisibility(), 500);
}

function updateClaimedPromoChip(claimed) {
    const chip = document.getElementById('passenger-promo-chip');
    if (!chip) return;
    const active = (claimed || []).filter((c) => !c.used);
    if (!active.length) {
        chip.classList.add('hidden');
        chip.textContent = '';
        return;
    }
    chip.classList.remove('hidden');
    chip.textContent = active.length === 1 ? '1 promo activa' : `${active.length} promos activas`;
}

function showClaimPromoModal(prefillCode = '', promoId = '') {
    const existing = document.getElementById('promo-claim-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'promo-claim-modal';
    modal.className = 'promo-claim-modal';
    modal.innerHTML = `
        <div class="promo-claim-backdrop" data-action="close"></div>
        <div class="promo-claim-sheet" role="dialog" aria-labelledby="promo-claim-title">
            <div class="promo-claim-handle"></div>
            <h3 id="promo-claim-title" class="promo-claim-title"><i class="fas fa-gift"></i> Reclamar bono</h3>
            <p class="promo-claim-sub">Ingresa el código de la promo. El bono se guarda en tu cuenta y se aplica al pagar con saldo.</p>
            <input type="text" id="promo-claim-code-input" class="promo-claim-input" maxlength="24"
                placeholder="Ej: VERANO100" value="${escHtml(prefillCode)}" autocomplete="off" autocapitalize="characters">
            <p class="promo-claim-hint">Solo aplica si tu viaje cuesta al menos el 80% del valor del bono.</p>
            <button type="button" id="promo-claim-submit" class="promo-claim-btn">Reclamar bono</button>
            <button type="button" class="promo-claim-cancel" data-action="close">Cancelar</button>
        </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener('click', close));

    const input = modal.querySelector('#promo-claim-code-input');
    const submit = modal.querySelector('#promo-claim-submit');
    input?.focus();

    submit?.addEventListener('click', async () => {
        const code = normalizePromoCode(input?.value);
        if (!code) return window.showToast?.('Escribe un código de promo.', 'warning');
        submit.disabled = true;
        submit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validando…';
        try {
            const fn = httpsCallableRef(cloudFunctionsRef, 'claimPromoCode');
            const res = await fn({ code, promoId: promoId || null });
            close();
            window.showToast?.(res.data?.message || '¡Bono reclamado!', 'success');
            window.refreshClaimedPromosUI?.();
        } catch (err) {
            const msg = err?.message || err?.details || 'No se pudo reclamar la promo.';
            window.showToast?.(msg.replace(/^FirebaseError:\s*/i, ''), 'error');
            submit.disabled = false;
            submit.textContent = 'Reclamar bono';
        }
    });
}

function renderStaffPromotionsPage(promos, debts) {
    const U = window.OpsUi;
    const promoCards = promos.length
        ? promos.map((p) => {
            const amt = parseFloat(p.discountAmount) || 0;
            const claimed = p.claimedCount || 0;
            const maxU = p.maxUsers || '∞';
            const budget = parseFloat(p.usedBudget) || 0;
            const maxB = parseFloat(p.maxBudget) || 0;
            const statusCls = p.status === 'active' ? 'ops-badge--emerald' : 'ops-badge--amber';
            return `
                <div class="ops-list-card">
                    <div class="flex justify-between items-start gap-2">
                        <div>
                            <p class="font-black text-white text-sm">${escHtml(p.title || p.code)}</p>
                            <p class="text-xs text-slate-400 mt-0.5">Código: <strong class="text-amber-300">${escHtml(p.code)}</strong> · L. ${amt.toFixed(2)} OFF</p>
                            <p class="text-[10px] text-slate-500 mt-1">Usuarios: ${claimed}/${maxU} · Presupuesto: L. ${budget.toFixed(2)}${maxB ? ` / L. ${maxB.toFixed(2)}` : ''}</p>
                            <p class="text-[10px] text-slate-500">Vigencia: ${formatPromoDate(p.validFrom)} → ${formatPromoDate(p.validUntil)}</p>
                        </div>
                        <span class="ops-badge ${statusCls}">${escHtml(p.status || 'active')}</span>
                    </div>
                    <div class="flex flex-wrap gap-2 mt-3">
                        ${p.status === 'active'
                            ? `<button type="button" class="ops-btn ops-btn--ghost text-xs" onclick="window.pausePromotion('${escHtml(p.id)}')">Pausar</button>`
                            : `<button type="button" class="ops-btn ops-btn--emerald text-xs" onclick="window.activatePromotion('${escHtml(p.id)}')">Activar</button>`}
                        <button type="button" class="ops-btn ops-btn--danger text-xs" onclick="window.deletePromotion('${escHtml(p.id)}')">Eliminar</button>
                    </div>
                </div>`;
        }).join('')
        : U.empty('fa-gift', 'Sin promociones', 'Crea la primera promo con el formulario.');

    const debtRows = (debts || []).length
        ? debts.map((t) => `
            <tr class="border-b border-slate-700/50 text-xs">
                <td class="py-2 pr-2">${escHtml((t.completedAt && formatPromoDate(t.completedAt)) || '—')}</td>
                <td class="py-2 pr-2">${escHtml(t.promoCode || '—')}</td>
                <td class="py-2 pr-2">${escHtml(t.clientName || '—')}</td>
                <td class="py-2 pr-2">${escHtml(t.driverName || '—')}</td>
                <td class="py-2 pr-2">L. ${(parseFloat(t.originalPriceNum) || 0).toFixed(2)}</td>
                <td class="py-2 pr-2">L. ${(parseFloat(t.passengerPaysAmount) || 0).toFixed(2)}</td>
                <td class="py-2 font-bold text-amber-300">L. ${(parseFloat(t.promoSubsidyOwed) || 0).toFixed(2)}</td>
            </tr>`).join('')
        : `<tr><td colspan="7" class="py-4 text-center text-slate-500 text-xs">Sin deudas por promos aún.</td></tr>`;

    const totalDebt = (debts || []).reduce((s, t) => s + (parseFloat(t.promoSubsidyOwed) || 0), 0);

    return U.page(
        U.hero('Promociones', 'Campañas para pasajeros · subsidio al conductor') +
        `<div class="ops-stack">` +
        U.formPanel('Nueva promoción', 'Código, bono, límites y notificación a pasajeros', `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>${U.fieldLabel('Código')}<input id="promo-form-code" class="ops-input mt-1 uppercase" maxlength="20" placeholder="VERANO100"></div>
                <div>${U.fieldLabel('Valor del bono (L.)')}<input id="promo-form-amount" type="number" min="1" step="0.01" class="ops-input mt-1" placeholder="100"></div>
                <div class="sm:col-span-2">${U.fieldLabel('Título')}<input id="promo-form-title" class="ops-input mt-1" maxlength="80" placeholder="Promo verano"></div>
                <div class="sm:col-span-2">${U.fieldLabel('Descripción')}<input id="promo-form-desc" class="ops-input mt-1" maxlength="120" placeholder="Texto en tarjeta del mapa"></div>
                <div>${U.fieldLabel('% mínimo de gasto')}<input id="promo-form-min-pct" type="number" min="1" max="100" value="80" class="ops-input mt-1"></div>
                <div>${U.fieldLabel('Límite usuarios')}<input id="promo-form-max-users" type="number" min="1" class="ops-input mt-1" placeholder="500"></div>
                <div>${U.fieldLabel('Presupuesto total (L.)')}<input id="promo-form-max-budget" type="number" min="1" step="0.01" class="ops-input mt-1" placeholder="50000"></div>
                <div>${U.fieldLabel('Usos por pasajero')}<input id="promo-form-max-per-user" type="number" min="1" value="1" class="ops-input mt-1"></div>
                <div>${U.fieldLabel('Válida desde')}<input id="promo-form-from" type="datetime-local" class="ops-input mt-1"></div>
                <div>${U.fieldLabel('Válida hasta')}<input id="promo-form-until" type="datetime-local" class="ops-input mt-1"></div>
            </div>
            <label class="flex items-center gap-2 mt-3 text-xs text-slate-300">
                <input type="checkbox" id="promo-form-notify" checked class="rounded">
                Notificar a todos los pasajeros al publicar
            </label>
            <label class="flex items-center gap-2 mt-2 text-xs text-slate-300">
                <input type="checkbox" id="promo-form-show-map" checked class="rounded">
                Mostrar en mapa del pasajero
            </label>
            <button type="button" id="promo-form-submit" class="ops-btn ops-btn--emerald ops-btn--full mt-4" onclick="window.createPromotion(this)">
                <i class="fas fa-plus"></i> Publicar promoción
            </button>
        `) +
        U.section({
            title: 'Promociones activas',
            subtitle: 'Gestionar campañas',
            icon: 'fa-tags',
            variant: 'amber',
            body: `<div class="space-y-3">${promoCards}</div>`
        }) +
        U.section({
            title: 'Deudas al conductor',
            subtitle: `Total pendiente: L. ${totalDebt.toFixed(2)} — subsidio por promos usadas`,
            icon: 'fa-hand-holding-usd',
            variant: 'violet',
            body: `
                <div class="overflow-x-auto">
                    <table class="w-full text-left">
                        <thead><tr class="text-[10px] uppercase text-slate-500 border-b border-slate-700">
                            <th class="pb-2 pr-2">Fecha</th><th class="pb-2 pr-2">Promo</th><th class="pb-2 pr-2">Pasajero</th>
                            <th class="pb-2 pr-2">Conductor</th><th class="pb-2 pr-2">Tarifa</th><th class="pb-2 pr-2">Pagó</th><th class="pb-2">Debemos</th>
                        </tr></thead>
                        <tbody>${debtRows}</tbody>
                    </table>
                </div>`
        }) +
        `</div>`
    );
}

async function loadPromoDebts() {
    try {
        const snap = await getDocs(query(tripsCol(), where('promoSubsidyOwed', '>', 0), limit(200)));
        return snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((t) => t.status === 'completed')
            .sort((a, b) => {
                const am = a.completedAt?.toMillis?.() || a.saldoSettledAt?.toMillis?.() || 0;
                const bm = b.completedAt?.toMillis?.() || b.saldoSettledAt?.toMillis?.() || 0;
                return bm - am;
            });
    } catch (_) {
        const snap = await getDocs(tripsCol());
        return snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((t) => t.status === 'completed' && (parseFloat(t.promoSubsidyOwed) || 0) > 0)
            .sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0))
            .slice(0, 200);
    }
}

async function renderStaffPromotions(container) {
    if (!container) return;
    container.innerHTML = window.OPS_LOADING_HTML || '<div class="ops-loading"><p>Cargando promociones…</p></div>';
    try {
        const [promos, debts] = await Promise.all([loadAllPromotionsForStaff(), loadPromoDebts()]);
        container.innerHTML = renderStaffPromotionsPage(promos, debts);
    } catch (e) {
        console.error('renderStaffPromotions:', e);
        container.innerHTML = `<p class="text-red-400 text-center p-6">Error: ${escHtml(e.message)}</p>`;
    }
}

export function initPromotions({
    db, appId, httpsCallable, cloudFunctions,
    getCurrentUser: getUser,
    getUserProfile: getProfile
}) {
    dbRef = db;
    appIdRef = appId;
    httpsCallableRef = httpsCallable;
    cloudFunctionsRef = cloudFunctions;
    getCurrentUser = getUser;
    getUserProfile = getProfile;

    window.showClaimPromoModal = showClaimPromoModal;
    window.calcPromoApplication = calcPromoApplication;

    window.loadAdminPromotions = async (container) => {
        window.setAdminNavActive?.('promotions');
        await renderStaffPromotions(container || document.getElementById('admin-users-list'));
    };

    window.loadSupervisorPromotions = async () => {
        const container = document.getElementById('supervisor-pending-list');
        if (!container) return;
        window.setSupervisorNavActive?.('promotions');
        await renderStaffPromotions(container);
    };

    window.createPromotion = async (btn) => {
        const user = getCurrentUser();
        if (!user) return window.showToast?.('Inicia sesión de nuevo.');

        const code = normalizePromoCode(document.getElementById('promo-form-code')?.value);
        const discountAmount = parseFloat(document.getElementById('promo-form-amount')?.value);
        const title = document.getElementById('promo-form-title')?.value?.trim();
        const description = document.getElementById('promo-form-desc')?.value?.trim();
        const minSpendPercent = parseFloat(document.getElementById('promo-form-min-pct')?.value) || 80;
        const maxUsers = parseInt(document.getElementById('promo-form-max-users')?.value, 10) || null;
        const maxBudget = parseFloat(document.getElementById('promo-form-max-budget')?.value) || null;
        const maxUsesPerUser = parseInt(document.getElementById('promo-form-max-per-user')?.value, 10) || 1;
        const notifyOnPublish = document.getElementById('promo-form-notify')?.checked !== false;
        const showOnMap = document.getElementById('promo-form-show-map')?.checked !== false;
        const fromVal = document.getElementById('promo-form-from')?.value;
        const untilVal = document.getElementById('promo-form-until')?.value;

        if (!code || code.length < 3) return window.showToast?.('Código inválido (mín. 3 caracteres).', 'warning');
        if (!discountAmount || discountAmount <= 0) return window.showToast?.('Indica el valor del bono.', 'warning');
        if (!title) return window.showToast?.('Escribe un título.', 'warning');

        const orig = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando…'; }

        try {
            const payload = {
                code, title, description, discountAmount, minSpendPercent,
                maxUsers, maxBudget, maxUsesPerUser, notifyOnPublish, showOnMap,
                validFrom: fromVal ? new Date(fromVal).toISOString() : null,
                validUntil: untilVal ? new Date(untilVal).toISOString() : null
            };
            try {
                const fn = httpsCallableRef(cloudFunctionsRef, 'publishPromotion');
                await fn(payload);
            } catch (cloudErr) {
                if (!isCallableTransportError(cloudErr)) throw cloudErr;
                console.warn('publishPromotion cloud fallback:', cloudErr);
                const res = await publishPromotionClientFallback(payload, user.uid);
                if (notifyOnPublish) {
                    window.showToast?.('Promo guardada. Despliega Cloud Functions para notificar a todos los pasajeros.', 'warning');
                } else {
                    window.showToast?.('Promoción publicada (modo local).', 'success');
                }
                if (window.currentAdminTab === 'promotions') await window.loadAdminPromotions();
                else await window.loadSupervisorPromotions?.();
                return;
            }
            window.showToast?.('Promoción publicada.', 'success');
            if (window.currentAdminTab === 'promotions') await window.loadAdminPromotions();
            else await window.loadSupervisorPromotions?.();
        } catch (err) {
            window.showToast?.(err?.message?.replace(/^FirebaseError:\s*/i, '') || 'Error al publicar.', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; }
        }
    };

    async function callManagePromotion(promoId, action) {
        try {
            await httpsCallableRef(cloudFunctionsRef, 'managePromotion')({ promoId, action });
        } catch (cloudErr) {
            if (!isCallableTransportError(cloudErr)) throw cloudErr;
            console.warn('managePromotion cloud fallback:', cloudErr);
            await managePromotionClientFallback(promoId, action);
        }
    }

    window.pausePromotion = async (promoId) => {
        try {
            await callManagePromotion(promoId, 'pause');
            window.showToast?.('Promo pausada.', 'success');
            window.currentAdminTab === 'promotions'
                ? await window.loadAdminPromotions()
                : await window.loadSupervisorPromotions?.();
        } catch (e) {
            window.showToast?.(e?.message || 'Error', 'error');
        }
    };

    window.activatePromotion = async (promoId) => {
        try {
            await callManagePromotion(promoId, 'activate');
            window.showToast?.('Promo activada.', 'success');
            window.currentAdminTab === 'promotions'
                ? await window.loadAdminPromotions()
                : await window.loadSupervisorPromotions?.();
        } catch (e) {
            window.showToast?.(e?.message || 'Error', 'error');
        }
    };

    window.deletePromotion = async (promoId) => {
        if (!confirm('¿Eliminar esta promoción?')) return;
        try {
            await callManagePromotion(promoId, 'delete');
            window.showToast?.('Promo eliminada.', 'success');
            window.currentAdminTab === 'promotions'
                ? await window.loadAdminPromotions()
                : await window.loadSupervisorPromotions?.();
        } catch (e) {
            window.showToast?.(e?.message || 'Error', 'error');
        }
    };

    window.refreshClaimedPromosUI = async () => {
        const user = getCurrentUser();
        if (!user) return;
        const claimed = await loadClaimedPromos(user.uid);
        updateClaimedPromoChip(claimed);
        window._claimedPromosCache = claimed;
    };

    window.startPassengerPromoListeners = () => {
        const user = getCurrentUser();
        if (!user?.uid) return;

        if (!activePromosUnsub) {
            activePromosUnsub = onSnapshot(promosCol(), (snap) => {
                const promos = snap.docs
                    .map((d) => ({ id: d.id, ...d.data() }))
                    .filter((p) => p.status === 'active' && p.showOnMap !== false && isPromoCurrentlyActive(p));
                renderPromoStrip(promos);
            }, (err) => console.warn('promoStripListener:', err));
        }

        if (!claimedPromosUnsub) {
            claimedPromosUnsub = onSnapshot(
                collection(dbRef, 'artifacts', appIdRef, 'users', user.uid, 'claimed_promos'),
                (snap) => {
                    const claimed = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                    updateClaimedPromoChip(claimed);
                    window._claimedPromosCache = claimed;
                    const price = window.currentTripQuote?.priceNum;
                    if (price) window.updatePromoFarePreview?.(price);
                },
                (err) => console.warn('claimedPromoListener:', err)
            );
        }
    };

    window.stopPassengerPromoListeners = () => {
        if (activePromosUnsub) { activePromosUnsub(); activePromosUnsub = null; }
        if (claimedPromosUnsub) { claimedPromosUnsub(); claimedPromosUnsub = null; }
    };

    window.updatePassengerPromoStripVisibility = updatePromoStripVisibility;
    window.resetPromoStripSessionDismiss = resetPromoStripSessionDismiss;

    // Cuando minimizan / expanden el panel, reevaluar promos (Android a veces no repinta)
    if (typeof MutationObserver !== 'undefined' && !window._promoPanelClassObs) {
        try {
            window._promoPanelClassObs = new MutationObserver(() => {
                updatePromoStripVisibility();
            });
            window._promoPanelClassObs.observe(document.body, {
                attributes: true,
                attributeFilter: ['class']
            });
        } catch (_) {}
    }
}