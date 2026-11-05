/**
 * Marketplace HonduRaite (sección aparte de Tiendas).
 * - Carros en venta, carros en renta (día/semana/mes), motos, repuestos y otros.
 * - Fotos (Storage del usuario), precio, descripción, ciudad y botón de WhatsApp.
 * - Cualquiera con sesión publica; entra «En revisión» y solo las aprobadas son públicas.
 * - HonduRaite cobra 10% al VENDEDOR (venta, o el período rentado). El comprador ve el precio final.
 * - Aprobar/rechazar/quitar, vendido/rentado y comisiones: callables (functions/marketplace.js).
 */
import {
    collection, doc, setDoc, getDocs, query, where, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { resolvePhotoUrl } from './storage.js?v=2026.10.26.53';
import { compressDataUrlFromFile } from './camera-capture.js?v=2026.10.26.53';
import { HONDURAS_CITIES } from './honduras-cities.js?v=2026.10.26.53';

export const MK_COMMISSION_LINE = 'HonduRaite cobra 10% al vendedor, sin costo para el comprador';
export const MK_CATEGORIES = [
    { id: 'carros_venta', label: 'Carros en venta', short: 'Venta', icon: 'fa-car' },
    { id: 'carros_renta', label: 'Carros en renta', short: 'Renta', icon: 'fa-key' },
    { id: 'motos', label: 'Motos', short: 'Motos', icon: 'fa-motorcycle' },
    { id: 'repuestos', label: 'Repuestos', short: 'Repuestos', icon: 'fa-cogs' },
    { id: 'otros', label: 'Otros', short: 'Otros', icon: 'fa-box-open' },
];
const PERIODS = [['day', 'Día', 'priceDay'], ['week', 'Semana', 'priceWeek'], ['month', 'Mes', 'priceMonth']];
const STATUS_LABEL = { pending: 'En revisión', approved: 'Publicada', rejected: 'Rechazada', removed: 'Quitada', sold: 'Vendida' };
const MAX_PHOTOS = 8;

let DEPS = {};
const S = { view: 'home', cat: 'all', city: 'all', q: '', items: [], mine: [], current: null, photo: 0,
    adminTab: 'pending', adminItems: [], commissions: [], busy: false, draft: null, isStaff: false };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = (n) => `L. ${Math.round(Number(n) || 0).toLocaleString('es-HN')}`;
const catOf = (id) => MK_CATEGORIES.find((c) => c.id === id) || MK_CATEGORIES[4];
const isRental = (l) => l && l.category === 'carros_renta';
const cityName = (id, fb) => fb || HONDURAS_CITIES.find((c) => c.id === id)?.name || id || '';
const base = () => `artifacts/${DEPS.appId}/public/data`;
const uid = () => DEPS.getCurrentUser?.()?.uid || null;
const toast = (m, t = 'success') => { try { (window.showToast || console.log)(m, t); } catch (_) {} };

export function waPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 8) d = `504${d}`;
    return d;
}
export function waLink(listing) {
    const price = isRental(listing) ? `desde ${L(listing.priceDay)} por día` : L(listing.price);
    const text = `Hola, vi tu publicación «${listing.title}» (${price}) en Marketplace HonduRaite. ¿Sigue disponible?`;
    return `https://wa.me/${waPhone(listing.whatsapp)}?text=${encodeURIComponent(text)}`;
}
function priceLine(l) {
    if (!isRental(l)) return `<b>${L(l.price)}</b>`;
    return `<b>${L(l.priceDay)}</b><small>/día</small>`;
}

// ───────── Datos (Firestore por defecto; el arnés de capturas inyecta otro) ─────────
const fsSource = {
    async listApproved() {
        const s = await getDocs(query(collection(DEPS.db, `${base()}/marketplace_listings`), where('status', '==', 'approved'), orderBy('approvedAtMs', 'desc'), limit(200)));
        return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async listMine() {
        const s = await getDocs(query(collection(DEPS.db, `${base()}/marketplace_listings`), where('ownerUid', '==', uid()), limit(100)));
        return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    },
    async listByStatus(status) {
        const s = await getDocs(query(collection(DEPS.db, `${base()}/marketplace_listings`), where('status', '==', status), limit(200)));
        return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
    },
    async listCommissions() {
        const s = await getDocs(query(collection(DEPS.db, `${base()}/marketplace_commissions`), orderBy('createdAtMs', 'desc'), limit(300)));
        return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    newId() { return doc(collection(DEPS.db, `${base()}/marketplace_listings`)).id; },
    async save(id, data) { await setDoc(doc(DEPS.db, `${base()}/marketplace_listings/${id}`), data); },
    async uploadPhoto(dataUrl, path) { return resolvePhotoUrl(DEPS.storage, dataUrl, path); },
    async call(name, data) { const r = await httpsCallable(DEPS.functions || window.cloudFunctions, name)(data); return r.data; },
};
const src = () => DEPS.source || fsSource;

// ───────── Estilos ─────────
const CSS = `
#mk-root *,#mk-root *::before,#mk-root *::after,.mk-modal *{box-sizing:border-box}
#mk-root,#mk-root *,.mk-modal,.mk-modal *{font-variant-emoji:normal}
#mk-root{position:fixed;inset:0;z-index:9000;background:#f1f5f9;color:#0f172a;font-family:'Inter',system-ui,sans-serif;display:flex;flex-direction:column}
#mk-root.hidden{display:none}
.mk-top{background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;padding:calc(env(safe-area-inset-top,0px) + 12px) 14px 14px;box-shadow:0 4px 18px rgba(30,58,138,.25)}
.mk-top-row{display:flex;align-items:center;gap:10px}
.mk-ib{width:38px;height:38px;border-radius:12px;border:0;background:rgba(255,255,255,.16);color:#fff;font-size:16px;display:grid;place-items:center;cursor:pointer}
.mk-title{flex:1;min-width:0}.mk-title b{display:block;font-size:17px;font-weight:900;letter-spacing:-.01em}.mk-title small{opacity:.8;font-size:11.5px}
.mk-search{margin-top:12px;display:flex;gap:8px}
.mk-search input,.mk-search select{border:0;border-radius:12px;padding:11px 12px;font:inherit;font-size:14px;color:#0f172a;min-width:0}
.mk-search input{flex:1}.mk-search select{max-width:38%}
.mk-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 96px}
.mk-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:none}
.mk-chip{flex:none;border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:8px 13px;font:inherit;font-size:13px;font-weight:600;color:#334155;cursor:pointer;white-space:nowrap}
.mk-chip.on{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.mk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:12px}
.mk-card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.07);cursor:pointer;border:0;padding:0;text-align:left;font:inherit;color:inherit;display:flex;flex-direction:column}
.mk-card-img{aspect-ratio:4/3;background:#e2e8f0 center/cover no-repeat;position:relative}
.mk-tag{position:absolute;left:8px;top:8px;background:rgba(15,23,42,.72);color:#fff;font-size:10.5px;font-weight:700;padding:4px 8px;border-radius:999px}
.mk-tag.renta{background:#7c3aed}.mk-tag.venta{background:#1d4ed8}
.mk-card-b{padding:9px 10px 11px}.mk-card-b .p{color:#047857;font-size:15.5px}.mk-card-b .p small{font-size:11px;color:#64748b;margin-left:2px}
.mk-card-b .t{font-size:13px;font-weight:600;margin:2px 0;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mk-card-b .c{font-size:11.5px;color:#64748b}
.mk-fab{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);z-index:9001;border:0;border-radius:999px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font:inherit;font-weight:800;font-size:15px;padding:14px 20px;box-shadow:0 10px 24px rgba(217,119,6,.4);cursor:pointer}
.mk-empty{text-align:center;color:#64748b;padding:40px 10px;font-size:14px}
.mk-gal{position:relative;margin:-12px -14px 0;background:#0f172a;aspect-ratio:4/3;overflow:hidden}
.mk-gal img{width:100%;height:100%;object-fit:cover;display:block}
.mk-dots{position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:6px}
.mk-dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.5)}.mk-dots i.on{background:#fff}
.mk-thumbs{display:flex;gap:6px;overflow-x:auto;margin:8px 0 0}
.mk-thumbs img{width:58px;height:44px;object-fit:cover;border-radius:8px;opacity:.6;cursor:pointer;border:2px solid transparent}.mk-thumbs img.on{opacity:1;border-color:#1d4ed8}
.mk-card2{background:#fff;border-radius:16px;padding:14px;margin-top:12px;box-shadow:0 2px 10px rgba(15,23,42,.06)}
.mk-h1{font-size:19px;font-weight:800;margin:0 0 4px;line-height:1.25}
.mk-price{font-size:24px;font-weight:900;color:#047857}
.mk-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.mk-pill{background:#f1f5f9;border-radius:999px;padding:5px 10px;font-size:12px;color:#334155;font-weight:600}
.mk-rates{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.mk-rate{border:1.5px solid #ddd6fe;background:#f5f3ff;border-radius:12px;padding:10px 6px;text-align:center}
.mk-rate small{display:block;font-size:11px;color:#6d28d9;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.mk-rate b{font-size:15px;color:#4c1d95}
.mk-desc{white-space:pre-wrap;font-size:14px;line-height:1.5;color:#334155}
.mk-note{font-size:12px;color:#64748b;margin-top:8px}
.mk-wa{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;border:0;border-radius:14px;background:#16a34a;color:#fff;font:inherit;font-weight:800;font-size:16px;padding:15px;text-decoration:none;box-shadow:0 8px 20px rgba(22,163,74,.3)}
.mk-sticky{position:sticky;bottom:0;padding:12px 0 4px;background:linear-gradient(transparent,#f1f5f9 30%)}
.mk-f label{display:block;font-size:12.5px;font-weight:700;color:#334155;margin:12px 0 5px}
.mk-f input,.mk-f select,.mk-f textarea{width:100%;box-sizing:border-box;border:1.5px solid #cbd5e1;border-radius:12px;padding:11px 12px;font:inherit;font-size:14px;background:#fff;color:#0f172a}
.mk-f textarea{min-height:96px;resize:vertical}
.mk-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mk-row3 label{margin-top:0}
.mk-photos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.mk-ph{aspect-ratio:1;border-radius:12px;background:#e2e8f0 center/cover;position:relative}
.mk-ph button{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(15,23,42,.75);color:#fff;font-size:11px;cursor:pointer}
.mk-ph-add{aspect-ratio:1;border-radius:12px;border:2px dashed #93c5fd;background:#eff6ff;color:#1d4ed8;display:grid;place-items:center;font-size:12px;font-weight:700;text-align:center;cursor:pointer}
.mk-commission{display:flex;gap:10px;align-items:flex-start;background:#ecfdf5;border:1.5px solid #6ee7b7;color:#065f46;border-radius:14px;padding:12px 13px;font-size:14px;font-weight:700;margin-top:14px}
.mk-commission i{margin-top:2px}
.mk-btn{border:0;border-radius:14px;background:#1d4ed8;color:#fff;font:inherit;font-weight:800;font-size:15px;padding:14px;width:100%;cursor:pointer}
.mk-btn.sec{background:#e2e8f0;color:#0f172a}.mk-btn.ok{background:#16a34a}.mk-btn.bad{background:#dc2626}.mk-btn[disabled]{opacity:.6}
.mk-btn.sm{width:auto;padding:8px 12px;font-size:12.5px;border-radius:10px}
.mk-st{display:inline-block;font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px}
.mk-st.pending{background:#fef3c7;color:#92400e}.mk-st.approved{background:#d1fae5;color:#047857}.mk-st.rejected,.mk-st.removed{background:#fee2e2;color:#b91c1c}.mk-st.sold{background:#e0e7ff;color:#3730a3}.mk-st.paid{background:#d1fae5;color:#047857}
.mk-list{display:flex;flex-direction:column;gap:10px}
.mk-li{background:#fff;border-radius:14px;padding:10px;display:flex;gap:10px;box-shadow:0 2px 8px rgba(15,23,42,.06)}
.mk-li-img{width:84px;height:66px;border-radius:10px;background:#e2e8f0 center/cover;flex:none}
.mk-li-b{flex:1;min-width:0;font-size:13px}.mk-li-b b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-li-act{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.mk-tabs{display:flex;gap:6px;background:#e2e8f0;padding:4px;border-radius:12px;margin-bottom:12px}
.mk-tabs button{flex:1;border:0;background:transparent;border-radius:9px;padding:9px 4px;font:inherit;font-size:12.5px;font-weight:700;color:#475569;cursor:pointer}
.mk-tabs button.on{background:#fff;color:#1d4ed8;box-shadow:0 1px 4px rgba(15,23,42,.1)}
.mk-tot{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.mk-tot div{background:#fff;border-radius:14px;padding:12px;box-shadow:0 2px 8px rgba(15,23,42,.06)}
.mk-tot small{display:block;font-size:11.5px;color:#64748b;font-weight:700}.mk-tot b{font-size:20px}
.mk-tot .pe b{color:#b45309}.mk-tot .pa b{color:#047857}
.mk-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;font-size:12.5px;box-shadow:0 2px 8px rgba(15,23,42,.06)}
.mk-tbl th{text-align:left;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:9px 8px}
.mk-tbl td{padding:9px 8px;border-top:1px solid #f1f5f9;vertical-align:top}
.mk-modal{position:fixed;inset:0;z-index:9100;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center}
.mk-sheet{background:#fff;width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:18px 16px calc(env(safe-area-inset-bottom,0px) + 16px)}
html.dark #mk-root,body.dark-mode #mk-root{background:#0b1220;color:#e2e8f0}
`;

// ───────── Render ─────────
function root() {
    let r = document.getElementById('mk-root');
    if (!r) {
        if (!document.getElementById('mk-style')) {
            const st = document.createElement('style'); st.id = 'mk-style'; st.textContent = CSS; document.head.appendChild(st);
        }
        r = document.createElement('div'); r.id = 'mk-root'; r.className = 'hidden'; r.setAttribute('role', 'dialog'); r.setAttribute('aria-label', 'Marketplace HonduRaite');
        document.body.appendChild(r);
        r.addEventListener('click', onClick);
        r.addEventListener('input', onInput);
        r.addEventListener('change', onChange);
    }
    return r;
}
const cityOptions = (sel, allLabel) => (allLabel ? `<option value="all">${allLabel}</option>` : '<option value="">Elige la ciudad</option>')
    + HONDURAS_CITIES.map((c) => `<option value="${esc(c.id)}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

function header(title, sub, { back = false, search = false, right = '' } = {}) {
    return `<div class="mk-top"><div class="mk-top-row">
      <button class="mk-ib" data-mk="${back ? 'back' : 'close'}" aria-label="${back ? 'Volver' : 'Cerrar'}"><i class="fas fa-${back ? 'arrow-left' : 'times'}"></i></button>
      <div class="mk-title"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>
      ${search ? `<div class="mk-search"><input type="search" data-mk-in="q" placeholder="Buscar: Hilux, llantas, moto…" value="${esc(S.q)}"><select data-mk-ch="city">${cityOptions(S.city, 'Toda Honduras')}</select></div>` : ''}</div>`;
}
function cardHtml(l) {
    const c = catOf(l.category);
    return `<button class="mk-card" data-mk="open" data-id="${esc(l.id)}">
      <div class="mk-card-img" style="background-image:url('${esc((l.photos || [])[0] || '')}')"><span class="mk-tag ${l.category === 'carros_renta' ? 'renta' : l.category === 'carros_venta' ? 'venta' : ''}">${esc(c.short)}</span></div>
      <div class="mk-card-b"><div class="p">${priceLine(l)}</div><div class="t">${esc(l.title)}</div><div class="c"><i class="fas fa-map-marker-alt"></i> ${esc(cityName(l.city, l.cityName))}</div></div></button>`;
}
function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.items.filter((l) => (S.cat === 'all' || l.category === S.cat) && (S.city === 'all' || l.city === S.city)
        && (!q || `${l.title} ${l.description || ''} ${l.brand || ''} ${l.model || ''}`.toLowerCase().includes(q)));
}
function viewHome() {
    const chips = [['all', 'Todo', 'fa-th-large'], ...MK_CATEGORIES.map((c) => [c.id, c.label, c.icon])]
        .map(([id, l, ic]) => `<button class="mk-chip ${S.cat === id ? 'on' : ''}" data-mk="cat" data-id="${id}"><i class="fas ${ic}"></i> ${l}</button>`).join('');
    const list = filtered();
    const right = `<button class="mk-ib" data-mk="mine" aria-label="Mis publicaciones"><i class="fas fa-user-tag"></i></button>${S.isStaff ? '<button class="mk-ib" data-mk="admin" aria-label="Administrar"><i class="fas fa-user-shield"></i></button>' : ''}`;
    return `${header('Marketplace HonduRaite', 'Carros, motos, repuestos y más · trato directo por WhatsApp', { search: true, right })}
    <div class="mk-body"><div class="mk-chips">${chips}</div>
      ${list.length ? `<div class="mk-grid">${list.map(cardHtml).join('')}</div>` : `<div class="mk-empty"><i class="fas fa-search" style="font-size:28px;opacity:.4"></i><p>${S.busy ? 'Cargando…' : 'No hay publicaciones con ese filtro todavía.'}</p></div>`}
    </div><button class="mk-fab" data-mk="publish"><i class="fas fa-plus"></i> Publicar</button>`;
}
function viewDetail() {
    const l = S.current; if (!l) return viewHome();
    const photos = l.photos || [];
    const i = Math.min(S.photo, Math.max(0, photos.length - 1));
    const mine = l.ownerUid && l.ownerUid === uid();
    const rates = isRental(l) ? `<div class="mk-rates">${PERIODS.map(([, lb, k]) => `<div class="mk-rate"><small>${lb}</small><b>${l[k] ? L(l[k]) : '—'}</b></div>`).join('')}</div>` : '';
    const specs = [l.brand, l.model, l.year, l.mileageKm ? `${Number(l.mileageKm).toLocaleString('es-HN')} km` : '', l.condition === 'nuevo' ? 'Nuevo' : l.condition === 'usado' ? 'Usado' : '']
        .filter(Boolean).map((s) => `<span class="mk-pill">${esc(s)}</span>`).join('');
    const ownerBox = (mine || S.isStaff) && l.status === 'approved' ? `<div class="mk-card2"><b style="font-size:14px">${mine ? 'Tu publicación' : 'Staff'}</b>
        <p class="mk-note" style="margin:4px 0 10px">${MK_COMMISSION_LINE}. Al cerrar el trato se registra la comisión de 10%.</p>
        <button class="mk-btn sec" data-mk="close-deal">${isRental(l) ? '<i class="fas fa-key"></i> Registrar renta' : '<i class="fas fa-handshake"></i> Marcar como vendido'}</button></div>`
        : (mine ? `<div class="mk-card2"><span class="mk-st ${l.status}">${STATUS_LABEL[l.status] || l.status}</span>${l.rejectReason ? `<p class="mk-note">Motivo: ${esc(l.rejectReason)}</p>` : ''}</div>` : '');
    return `${header(esc(catOf(l.category).label), esc(cityName(l.city, l.cityName)), { back: true })}
    <div class="mk-body">
      <div class="mk-gal">${photos.length ? `<img src="${esc(photos[i])}" alt="">` : ''}${photos.length > 1 ? `<div class="mk-dots">${photos.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div>
      ${photos.length > 1 ? `<div class="mk-thumbs">${photos.map((p, k) => `<img src="${esc(p)}" class="${k === i ? 'on' : ''}" data-mk="photo" data-i="${k}" alt="">`).join('')}</div>` : ''}
      <div class="mk-card2"><h1 class="mk-h1">${esc(l.title)}</h1>
        ${isRental(l) ? '<div class="mk-note" style="margin:0">Precio de renta (final, sin cargos extra)</div>' : `<div class="mk-price">${L(l.price)}</div><div class="mk-note" style="margin:0">Precio final · sin cargos extra para el comprador</div>`}
        ${rates}<div class="mk-meta"><span class="mk-pill"><i class="fas fa-map-marker-alt"></i> ${esc(cityName(l.city, l.cityName))}</span>${specs}</div></div>
      ${l.description ? `<div class="mk-card2"><b style="font-size:14px">Descripción</b><p class="mk-desc">${esc(l.description)}</p></div>` : ''}
      <div class="mk-card2" style="font-size:13px;color:#475569"><i class="fas fa-user-circle"></i> Publicado por <b>${esc(l.ownerName || 'Vendedor')}</b><p class="mk-note">Trato directo con el vendedor. Revisa el artículo en persona antes de pagar.</p></div>
      ${ownerBox}
      ${l.status === 'approved' || !mine ? `<div class="mk-sticky"><a class="mk-wa" href="${esc(waLink(l))}" target="_blank" rel="noopener"><i class="fab fa-whatsapp" style="font-size:20px"></i> Contactar por WhatsApp</a></div>` : ''}
    </div>`;
}
function viewPublish() {
    const d = S.draft || (S.draft = { category: 'carros_venta', photos: [], city: '', whatsapp: (DEPS.getUserProfile?.()?.phone || '').replace(/\D/g, '').slice(-8) });
    const rental = d.category === 'carros_renta';
    const vehicle = ['carros_venta', 'carros_renta', 'motos'].includes(d.category);
    const ph = d.photos.map((p, k) => `<div class="mk-ph" style="background-image:url('${esc(p)}')"><button data-mk="rm-photo" data-i="${k}" aria-label="Quitar">✕</button></div>`).join('');
    return `${header(d.id ? 'Editar publicación' : 'Publicar en Marketplace', 'Se revisa antes de salir publicada', { back: true })}
    <div class="mk-body"><form class="mk-f" data-mk-form="publish" onsubmit="return false">
      <label>Categoría</label><select data-mk-d="category">${MK_CATEGORIES.map((c) => `<option value="${c.id}" ${d.category === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      <label>Fotos (hasta ${MAX_PHOTOS})</label><div class="mk-photos">${ph}${d.photos.length < MAX_PHOTOS ? `<label class="mk-ph-add" style="margin:0"><span><i class="fas fa-camera" style="font-size:18px"></i><br>Agregar</span><input type="file" accept="image/*" multiple hidden data-mk-ch="photos"></label>` : ''}</div>
      <label>Título</label><input data-mk-d="title" maxlength="80" placeholder="${rental ? 'Ej: Toyota Yaris 2019 automático' : 'Ej: Toyota Hilux 2016 4x4 diésel'}" value="${esc(d.title || '')}">
      ${rental ? `<label>Precio de renta (lempiras)</label><div class="mk-row3">${PERIODS.map(([p, lb, k]) => `<div><label>Por ${lb.toLowerCase()}${p === 'day' ? ' *' : ''}</label><input type="number" inputmode="numeric" min="0" data-mk-d="${k}" value="${esc(d[k] ?? '')}"></div>`).join('')}</div>`
        : `<label>Precio final (lempiras)</label><input type="number" inputmode="numeric" min="0" data-mk-d="price" placeholder="Lo que paga el comprador" value="${esc(d.price ?? '')}">`}
      ${vehicle ? `<div class="mk-row3" style="margin-top:12px"><div><label>Marca</label><input data-mk-d="brand" value="${esc(d.brand || '')}"></div><div><label>Modelo</label><input data-mk-d="model" value="${esc(d.model || '')}"></div><div><label>Año</label><input type="number" data-mk-d="year" value="${esc(d.year || '')}"></div></div>` : ''}
      <label>Estado</label><select data-mk-d="condition"><option value="usado" ${d.condition !== 'nuevo' ? 'selected' : ''}>Usado</option><option value="nuevo" ${d.condition === 'nuevo' ? 'selected' : ''}>Nuevo</option></select>
      <label>Descripción</label><textarea data-mk-d="description" maxlength="2000" placeholder="Detalles, estado, papeles al día, requisitos de renta…">${esc(d.description || '')}</textarea>
      <label>Ciudad</label><select data-mk-d="city">${cityOptions(d.city)}</select>
      <label>WhatsApp de contacto</label><input type="tel" inputmode="tel" data-mk-d="whatsapp" placeholder="9999-9999" value="${esc(d.whatsapp || '')}">
      <div class="mk-commission" id="mk-commission-line"><i class="fas fa-hand-holding-usd"></i><span>${MK_COMMISSION_LINE}</span></div>
      <p class="mk-note">${rental ? 'En rentas, el 10% se calcula sobre el monto del período que elija el cliente (día, semana o mes).' : 'El 10% se calcula sobre el monto final de la venta.'} El comprador paga exactamente el precio publicado.</p>
      <div style="margin-top:14px"><button class="mk-btn" data-mk="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Enviando…' : 'Enviar a revisión'}</button></div>
    </form></div>`;
}
function viewMine() {
    return `${header('Mis publicaciones', 'Estado y ventas', { back: true })}
    <div class="mk-body">${S.mine.length ? `<div class="mk-list">${S.mine.map((l) => `<div class="mk-li"><div class="mk-li-img" style="background-image:url('${esc((l.photos || [])[0] || '')}')"></div>
      <div class="mk-li-b"><b>${esc(l.title)}</b>${priceLine(l)} · <span class="mk-st ${l.status}">${STATUS_LABEL[l.status] || l.status}</span>
      ${l.rejectReason && l.status === 'rejected' ? `<div class="mk-note">Motivo: ${esc(l.rejectReason)}</div>` : ''}
      <div class="mk-li-act"><button class="mk-btn sm sec" data-mk="open" data-id="${esc(l.id)}">Ver</button>${['pending', 'rejected'].includes(l.status) ? `<button class="mk-btn sm" data-mk="edit" data-id="${esc(l.id)}">Editar</button>` : ''}</div></div></div>`).join('')}</div>`
        : '<div class="mk-empty">Aún no publicas nada.</div>'}</div><button class="mk-fab" data-mk="publish"><i class="fas fa-plus"></i> Publicar</button>`;
}
function viewAdmin() {
    const tabs = [['pending', 'Por revisar'], ['approved', 'Publicadas'], ['commissions', 'Comisiones']]
        .map(([k, l]) => `<button class="${S.adminTab === k ? 'on' : ''}" data-mk="atab" data-id="${k}">${l}${k === 'pending' && S.pendingCount ? ` (${S.pendingCount})` : ''}</button>`).join('');
    let body;
    if (S.adminTab === 'commissions') {
        const t = { pending: 0, paid: 0, pendingCount: 0, paidCount: 0 };
        S.commissions.forEach((c) => { const k = c.status === 'paid' ? 'paid' : 'pending'; t[k] += Number(c.commission) || 0; t[`${k}Count`] += 1; });
        body = `<div class="mk-tot"><div class="pe"><small>Pendiente de cobro (${t.pendingCount})</small><b>${L(t.pending)}</b></div><div class="pa"><small>Cobrado (${t.paidCount})</small><b>${L(t.paid)}</b></div></div>
        ${S.commissions.length ? `<div style="overflow-x:auto"><table class="mk-tbl"><thead><tr><th>Publicación</th><th>Monto</th><th>10%</th><th>Estado</th><th></th></tr></thead><tbody>
        ${S.commissions.map((c) => `<tr><td><b>${esc(c.title)}</b><br><span class="mk-note">${c.kind === 'rental' ? `Renta · ${({ day: 'día', week: 'semana', month: 'mes' })[c.period] || ''}${c.units > 1 ? ` ×${c.units}` : ''}` : 'Venta'} · ${esc(c.sellerName || '')}</span></td>
          <td>${L(c.amount)}</td><td><b>${L(c.commission)}</b></td><td><span class="mk-st ${c.status === 'paid' ? 'paid' : 'pending'}">${c.status === 'paid' ? 'Pagada' : 'Pendiente'}</span></td>
          <td>${c.status === 'paid' ? '' : `<button class="mk-btn sm ok" data-mk="paid" data-id="${esc(c.id)}">Marcar pagada</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mk-empty">Sin comisiones todavía.</div>'}`;
    } else {
        body = S.adminItems.length ? `<div class="mk-list">${S.adminItems.map((l) => `<div class="mk-li"><div class="mk-li-img" style="background-image:url('${esc((l.photos || [])[0] || '')}')"></div>
          <div class="mk-li-b"><b>${esc(l.title)}</b>${priceLine(l)} · ${esc(catOf(l.category).short)} · ${esc(cityName(l.city, l.cityName))}<div class="mk-note" style="margin:2px 0 0">${esc(l.ownerName || '')} · ${(l.photos || []).length} foto(s)</div>
          <div class="mk-li-act"><button class="mk-btn sm sec" data-mk="open" data-id="${esc(l.id)}">Ver</button>
          ${S.adminTab === 'pending' ? `<button class="mk-btn sm ok" data-mk="mod" data-act="approve" data-id="${esc(l.id)}">Aprobar</button><button class="mk-btn sm bad" data-mk="mod" data-act="reject" data-id="${esc(l.id)}">Rechazar</button>`
            : `<button class="mk-btn sm bad" data-mk="mod" data-act="remove" data-id="${esc(l.id)}">Quitar</button>`}</div></div></div>`).join('')}</div>`
            : `<div class="mk-empty">${S.busy ? 'Cargando…' : 'Nada por aquí.'}</div>`;
    }
    return `${header('Marketplace · Administración', 'Solo admin y supervisores · validado en servidor', { back: !S.adminOnly })}<div class="mk-body"><div class="mk-tabs">${tabs}</div>${body}</div>`;
}
function render() {
    const r = root();
    const v = { home: viewHome, detail: viewDetail, publish: viewPublish, mine: viewMine, admin: viewAdmin }[S.view] || viewHome;
    r.innerHTML = v();
}

// ───────── Acciones ─────────
async function loadHome() {
    S.busy = true; render();
    try { S.items = await src().listApproved(); } catch (e) { console.warn(e); toast('No se pudo cargar el Marketplace.', 'error'); }
    S.busy = false; render();
}
async function loadAdmin() {
    S.busy = true; render();
    try {
        if (S.adminTab === 'commissions') S.commissions = await src().listCommissions();
        else S.adminItems = await src().listByStatus(S.adminTab);
        if (S.adminTab === 'pending') S.pendingCount = S.adminItems.length;
    } catch (e) { console.warn(e); toast('Sin permiso o sin conexión.', 'error'); }
    S.busy = false; render();
}
function go(view) { S.prev = S.view; S.view = view; render(); const b = root().querySelector('.mk-body'); if (b) b.scrollTop = 0; }
function findListing(id) { return [...S.items, ...S.mine, ...S.adminItems].find((l) => l.id === id); }
function needLogin() {
    if (uid()) return false;
    toast('Inicia sesión para publicar.', 'error');
    try { window.revealLoginScreen?.(); } catch (_) {}
    return true;
}
function sheet(html) {
    return new Promise((resolve) => {
        const m = document.createElement('div'); m.className = 'mk-modal';
        m.innerHTML = `<div class="mk-sheet mk-f">${html}<div style="display:flex;gap:8px;margin-top:14px"><button class="mk-btn sec" data-x="0">Cancelar</button><button class="mk-btn" data-x="1">Confirmar</button></div></div>`;
        m.addEventListener('click', (e) => {
            const b = e.target.closest('[data-x]'); if (!b && e.target !== m) return;
            const okd = b && b.dataset.x === '1';
            const vals = {}; m.querySelectorAll('[name]').forEach((i) => { vals[i.name] = i.value; });
            m.remove(); resolve(okd ? vals : null);
        });
        document.body.appendChild(m);
    });
}
async function closeDeal() {
    const l = S.current; if (!l) return;
    const html = isRental(l)
        ? `<b style="font-size:16px">Registrar renta</b><p class="mk-note">${MK_COMMISSION_LINE}. 10% del monto del período que eligió el cliente.</p>
           <label>Período</label><select name="period">${PERIODS.map(([p, lb, k]) => `<option value="${p}">${lb}${l[k] ? ` · ${L(l[k])}` : ''}</option>`).join('')}</select>
           <label>Cantidad (días/semanas/meses)</label><input name="units" type="number" min="1" value="1">
           <label>Monto final cobrado (opcional)</label><input name="amount" type="number" min="0" placeholder="Si lo dejas vacío: precio × cantidad">`
        : `<b style="font-size:16px">Marcar como vendido</b><p class="mk-note">${MK_COMMISSION_LINE}. 10% del monto final de la venta.</p>
           <label>Monto final de la venta</label><input name="amount" type="number" min="0" value="${esc(l.price || '')}">`;
    const v = await sheet(html); if (!v) return;
    try {
        const r = await src().call('marketplaceMarkClosed', { listingId: l.id, amount: v.amount === '' ? null : Number(v.amount), period: v.period, units: v.units ? Number(v.units) : 1 });
        toast(`Listo. Comisión registrada: ${L(r.commission)} (10% de ${L(r.amount)}).`);
        if (r.kind === 'sale') { S.items = S.items.filter((x) => x.id !== l.id); go('home'); }
    } catch (e) { toast(e.message || 'No se pudo registrar.', 'error'); }
}
async function submitDraft() {
    if (needLogin()) return;
    const d = S.draft; const rental = d.category === 'carros_renta';
    const num = (v) => (v === '' || v == null ? null : Math.round(Number(v)));
    const wa = waPhone(d.whatsapp);
    const err = !d.photos.length ? 'Agrega al menos una foto.' : (String(d.title || '').trim().length < 3 ? 'Escribe un título.'
        : (rental ? !(num(d.priceDay) > 0) && 'Pon el precio por día.' : !(num(d.price) > 0) && 'Pon el precio.')
        || (!d.city && 'Elige la ciudad.') || (wa.length < 8 && 'Escribe tu WhatsApp.'));
    if (err) { toast(err, 'error'); return; }
    S.busy = true; render();
    try {
        const id = d.id || src().newId();
        const now = Date.now();
        const data = {
            ownerUid: uid(), ownerName: String(DEPS.getUserProfile?.()?.name || DEPS.getCurrentUser?.()?.displayName || '').slice(0, 60),
            status: 'pending', category: d.category, title: String(d.title).trim().slice(0, 80),
            description: String(d.description || '').trim().slice(0, 2000), currency: 'HNL',
            price: rental ? null : num(d.price), priceDay: rental ? num(d.priceDay) : null,
            priceWeek: rental ? num(d.priceWeek) : null, priceMonth: rental ? num(d.priceMonth) : null,
            city: d.city, cityName: cityName(d.city), whatsapp: wa, condition: d.condition === 'nuevo' ? 'nuevo' : 'usado',
            brand: String(d.brand || '').slice(0, 40), model: String(d.model || '').slice(0, 40), year: num(d.year),
            photos: [], createdAtMs: d.createdAtMs || now, updatedAtMs: now,
        };
        for (let k = 0; k < d.photos.length; k += 1) {
            const p = d.photos[k];
            data.photos.push(/^https?:/.test(p) ? p : await src().uploadPhoto(p, `artifacts/${DEPS.appId}/users/${uid()}/marketplace/${id}_${now}_${k}.jpg`));
        }
        await src().save(id, data);
        S.draft = null;
        toast('Enviada. La revisamos y te avisamos cuando salga publicada.');
        S.mine = await src().listMine().catch(() => S.mine);
        S.busy = false; go('mine');
    } catch (e) { console.warn(e); S.busy = false; render(); toast('No se pudo enviar. Revisa los datos e intenta de nuevo.', 'error'); }
}
async function onClick(e) {
    const el = e.target.closest('[data-mk]'); if (!el) return;
    const a = el.dataset.mk; const id = el.dataset.id;
    if (a === 'close') { closeMarketplace(); return; }
    if (a === 'back') {
        if (S.view === 'detail' && ['mine', 'admin'].includes(S.from)) go(S.from);
        else if (S.view === 'admin' && S.adminOnly) closeMarketplace();
        else { go('home'); if (!S.items.length) loadHome(); }
        return;
    }
    if (a === 'cat') { S.cat = id; render(); return; }
    if (a === 'open') { const l = findListing(id); if (l) { S.from = S.view; S.current = l; S.photo = 0; go('detail'); } return; }
    if (a === 'photo') { S.photo = Number(el.dataset.i) || 0; render(); return; }
    if (a === 'publish') { if (needLogin()) return; S.draft = null; go('publish'); return; }
    if (a === 'edit') { const l = findListing(id); if (l) { S.draft = { ...l, photos: [...(l.photos || [])], whatsapp: String(l.whatsapp || '').replace(/^504/, '') }; go('publish'); } return; }
    if (a === 'rm-photo') { S.draft.photos.splice(Number(el.dataset.i), 1); render(); return; }
    if (a === 'submit') { e.preventDefault(); submitDraft(); return; }
    if (a === 'mine') { if (needLogin()) return; go('mine'); S.mine = await src().listMine().catch(() => []); render(); return; }
    if (a === 'admin') { S.adminOnly = false; go('admin'); loadAdmin(); return; }
    if (a === 'atab') { S.adminTab = id; loadAdmin(); return; }
    if (a === 'close-deal') { closeDeal(); return; }
    if (a === 'mod') {
        const act = el.dataset.act; let reason = '';
        if (act !== 'approve') {
            const v = await sheet(`<b style="font-size:16px">${act === 'reject' ? 'Rechazar publicación' : 'Quitar publicación'}</b><label>Motivo (lo ve el vendedor)</label><input name="reason" maxlength="200" placeholder="Ej: fotos borrosas, precio falta">`);
            if (!v) return; reason = v.reason;
        }
        try { await src().call('marketplaceModerate', { listingId: id, action: act, reason }); toast(act === 'approve' ? 'Aprobada y publicada.' : act === 'reject' ? 'Rechazada.' : 'Quitada.'); loadAdmin(); }
        catch (err) { toast(err.message || 'No se pudo.', 'error'); }
        return;
    }
    if (a === 'paid') {
        try { await src().call('marketplaceSetCommissionStatus', { commissionId: id, status: 'paid' }); toast('Comisión marcada como pagada.'); loadAdmin(); }
        catch (err) { toast(err.message || 'No se pudo.', 'error'); }
    }
}
function onInput(e) {
    const t = e.target;
    if (t.dataset.mkIn === 'q') { S.q = t.value; const g = root().querySelector('.mk-body'); if (g) { const pos = t.selectionStart; render(); const i = root().querySelector('[data-mk-in="q"]'); i?.focus(); try { i.setSelectionRange(pos, pos); } catch (_) {} } return; }
    if (t.dataset.mkD && S.draft) S.draft[t.dataset.mkD] = t.value;
}
async function onChange(e) {
    const t = e.target;
    if (t.dataset.mkCh === 'city') { S.city = t.value; render(); return; }
    if (t.dataset.mkD && S.draft) { S.draft[t.dataset.mkD] = t.value; if (t.dataset.mkD === 'category') render(); return; }
    if (t.dataset.mkCh === 'photos') {
        const files = [...(t.files || [])].slice(0, MAX_PHOTOS - S.draft.photos.length);
        for (const f of files) { try { S.draft.photos.push(await compressDataUrlFromFile(f, 1280)); } catch (_) { toast('Una foto no se pudo leer.', 'error'); } }
        render();
    }
}

async function refreshStaff() {
    try { const r = await window.hrResolveTrustedRole?.(); S.isStaff = ['admin', 'supervisor'].includes(r || window.hrGetTrustedStaffRole?.()); } catch (_) {}
}
export function openMarketplace(opts = {}) {
    const r = root(); r.classList.remove('hidden');
    document.body.classList.add('mk-open');
    S.adminOnly = !!opts.admin;
    if (opts.admin) { S.adminTab = opts.tab || 'pending'; go('admin'); loadAdmin(); return; }
    go('home'); loadHome();
    refreshStaff().then(() => { if (S.view === 'home') render(); });
}
export function closeMarketplace() {
    document.getElementById('mk-root')?.classList.add('hidden');
    document.body.classList.remove('mk-open');
}
export function initMarketplace(deps = {}) {
    DEPS = { ...DEPS, ...deps };
    if (deps.isStaff != null) S.isStaff = !!deps.isStaff;
    window.openMarketplace = openMarketplace;
    window.openMarketplaceAdmin = (tab) => openMarketplace({ admin: true, tab });
    window.closeMarketplace = closeMarketplace;
}
/** Arnés de capturas. */
export const __mkState = S;
export const __mkGo = go;
