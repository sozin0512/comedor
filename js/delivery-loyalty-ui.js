/**
 * Promo Navidad (código HAM) · lado del cliente.
 * - Caja para canjear el código (cuenta + teléfono + dispositivo; lo valida el servidor).
 * - «Pedido N de 5 🎁» con la tarifa tachada y lo que paga.
 * Lo que se cobra lo fija SIEMPRE el servidor (functions/delivery-loyalty.js); aquí solo se muestra.
 */
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const FN_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
const DEVICE_KEY = 'hr_device_id_v1';
let DEPS = {};
let lastFee = null;
const L = { settings: null, member: null, uid: null, loadedAt: 0, busy: false, msg: '', msgTone: '' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `L. ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

export function configureLoyalty(deps = {}) { DEPS = { ...DEPS, ...deps }; }

/** Mismo cálculo que el servidor (computeLoyalty) para la vista previa. */
export function previewLoyalty(settings, deliveredCount, fee) {
    const cycle = Math.max(1, parseInt(settings?.cycle, 10) || 5);
    const f = Math.round((Number(fee) || 0) * 100) / 100;
    if (!(f >= 0)) return null;
    const step = (Math.max(0, parseInt(deliveredCount, 10) || 0) % cycle) + 1;
    const last = step === cycle && settings?.lastFree !== false;
    const discount = Math.round(Math.min(f, last ? f : Math.max(0, Number(settings?.discountL ?? 5))) * 100) / 100;
    return { step, cycle, discount, clientDeliveryFee: Math.round((f - discount) * 100) / 100, isFree: last && f > 0 };
}

// ── id del dispositivo: Capacitor Device.getId() en la app; si no, id aleatorio guardado (localStorage + IndexedDB).
function idbGet() {
    return new Promise((res) => {
        try {
            const r = indexedDB.open('hr_device', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('kv');
            r.onsuccess = () => { try { const g = r.result.transaction('kv').objectStore('kv').get(DEVICE_KEY); g.onsuccess = () => res(g.result || ''); g.onerror = () => res(''); } catch (_) { res(''); } };
            r.onerror = () => res('');
        } catch (_) { res(''); }
    });
}
function idbSet(v) {
    try {
        const r = indexedDB.open('hr_device', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { try { r.result.transaction('kv', 'readwrite').objectStore('kv').put(v, DEVICE_KEY); } catch (_) {} };
    } catch (_) {}
}
let devicePromise = null;
export function getDeviceId() {
    if (devicePromise) return devicePromise;
    devicePromise = (async () => {
        try {
            const dev = window.Capacitor?.Plugins?.Device;
            if (dev?.getId && window.Capacitor?.isNativePlatform?.()) {
                const r = await dev.getId();
                const id = String(r?.identifier || r?.uuid || '').replace(/[^A-Za-z0-9:_-]/g, '');
                if (id.length >= 8) return `nat-${id}`.slice(0, 128);
            }
        } catch (_) { /* sin plugin */ }
        let id = '';
        try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch (_) {}
        if (!id) id = await idbGet();
        if (!id) {
            const a = new Uint8Array(16); (window.crypto || crypto).getRandomValues(a);
            id = `web-${[...a].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
        }
        try { localStorage.setItem(DEVICE_KEY, id); } catch (_) {}
        idbSet(id);
        return id;
    })();
    return devicePromise;
}

async function callFn(name, data) {
    if (DEPS.callFn) return DEPS.callFn(name, data);
    const { httpsCallable } = await import(FN_URL);
    const res = await httpsCallable(DEPS.functions || window.cloudFunctions, name)(data);
    return res?.data ?? res;
}
const uidNow = () => DEPS.getCurrentUser?.()?.uid || null;

export async function loadLoyalty(force = false) {
    const uid = uidNow();
    if (!force && L.loadedAt && Date.now() - L.loadedAt < 60000 && L.uid === uid) return L;
    if (!DEPS.db || !DEPS.appId) return L;
    const base = ['artifacts', DEPS.appId, 'public', 'data'];
    try {
        const s = await getDoc(doc(DEPS.db, ...base, 'appSettings', 'deliveryLoyalty'));
        L.settings = s.exists() ? s.data() : null;
    } catch (_) { L.settings = null; }
    L.member = null;
    if (uid && L.settings?.enabled) {
        try { const m = await getDoc(doc(DEPS.db, ...base, 'delivery_loyalty_members', uid)); L.member = m.exists() ? m.data() : null; } catch (_) {}
    }
    L.uid = uid; L.loadedAt = Date.now();
    return L;
}
export const loyaltyState = () => L;

/** Caja del checkout: canjear código o progreso del ciclo. */
export function loyaltyPromoBoxHtml(fee = lastFee) {
    const s = L.settings;
    if (!s?.enabled) return '<div id="loyalty-promo-box"></div>';
    const name = esc(s.name || 'Promo Navidad');
    const cycle = Math.max(1, parseInt(s.cycle, 10) || 5);
    const msg = L.msg ? `<small class="loy-msg loy-msg--${L.msgTone || 'info'}">${esc(L.msg)}</small>` : '';
    if (L.member) {
        const p = previewLoyalty(s, L.member.deliveredCount || 0, fee ?? 0);
        const dots = Array.from({ length: cycle }, (_, i) => `<span class="loy-dot ${i < p.step - 1 ? 'done' : ''} ${i === p.step - 1 ? 'now' : ''}">${i === cycle - 1 ? '🎁' : i + 1}</span>`).join('');
        const feeTxt = fee != null && Number(fee) > 0
            ? `<span class="loy-fee"><s>${money(fee)}</s> <b>${p.clientDeliveryFee === 0 ? 'GRATIS' : money(p.clientDeliveryFee)}</b></span>`
            : `<small>${p.isFree || p.step === cycle ? 'Este envío es gratis' : `L. ${esc(s.discountL ?? 5)} menos en el envío`}</small>`;
        return `<div id="loyalty-promo-box" class="loy-box is-member"><div class="loy-head"><b>🎄 ${name} · Pedido ${p.step} de ${cycle} 🎁</b>${feeTxt}</div><div class="loy-dots">${dots}</div><small class="loy-mut">Cuenta al entregar. El ${cycle}.º envío es gratis.</small>${msg}</div>`;
    }
    const left = Math.max(0, (parseInt(s.maxMembers, 10) || 0) - (parseInt(s.memberCount, 10) || 0));
    if (left <= 0) return `<div id="loyalty-promo-box" class="loy-box"><b>🎄 ${name}</b><small class="loy-mut">Ya se llenaron los cupos.</small></div>`;
    return `<div id="loyalty-promo-box" class="loy-box"><b>🎄 ¿Tienes código de promo?</b>
        <div class="loy-row"><input id="loyalty-code-input" class="stores-input" maxlength="20" autocapitalize="characters" placeholder="Código" autocomplete="off">
        <button type="button" class="stores-primary-btn loy-btn" data-loyalty-action="claim" ${L.busy ? 'disabled' : ''}>${L.busy ? '…' : 'Canjear'}</button></div>${msg}</div>`;
}

/** Línea del pedido para el CLIENTE (seguimiento). La tienda no la ve. */
export function orderLoyaltyLineHtml(o) {
    if (!o?.loyaltyPromoId || o.clientDeliveryFee == null || o.deliveryFee == null) return '';
    const pay = Number(o.clientDeliveryFee);
    return `<span class="order-zone-fee loy-order">🎁 Pedido ${esc(o.loyaltyStep || '')} de ${esc(o.loyaltyCycle || 5)} · envío <s>${money(o.deliveryFee)}</s> <b>${pay === 0 ? 'GRATIS' : money(pay)}</b></span>`;
}

function repaint(fee) {
    const el = document.getElementById('loyalty-promo-box');
    if (el) el.outerHTML = loyaltyPromoBoxHtml(fee ?? lastFee);
}

export async function claimLoyaltyCode(code) {
    const c = String(code || '').trim();
    if (!c) { L.msg = 'Escribe el código.'; L.msgTone = 'bad'; repaint(); return; }
    if (!uidNow()) { L.msg = 'Inicia sesión para canjear el código.'; L.msgTone = 'bad'; repaint(); return; }
    L.busy = true; L.msg = ''; repaint();
    try {
        const deviceId = await getDeviceId();
        const r = await callFn('claimDeliveryLoyaltyCode', { code: c, deviceId });
        L.msg = r?.already ? 'Ya estás en la promo.' : `¡Listo! Entraste a ${r?.name || 'la promo'}.`; L.msgTone = 'ok';
        await loadLoyalty(true);
    } catch (e) {
        L.msg = String(e?.message || 'No se pudo canjear.').replace(/^FirebaseError:\s*/, ''); L.msgTone = 'bad';
    } finally { L.busy = false; repaint(); }
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', (ev) => {
        const b = ev.target?.closest?.('[data-loyalty-action="claim"]');
        if (!b) return;
        ev.preventDefault();
        claimLoyaltyCode(document.getElementById('loyalty-code-input')?.value);
    });
    document.addEventListener('hr:checkout-fee', (ev) => { lastFee = ev.detail?.fee ?? null; repaint(lastFee); });
}
export const __test = { L };
