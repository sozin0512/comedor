/**
 * Tiendas virtuales para emprendedores (sección aparte de Envíos).
 * - Cliente: navega tiendas, ve fotos, carrito y pide.
 * - Emprendedor: crea tienda, menú con fotos y gestiona pedidos.
 * - Supervisores: verifican tiendas (aprobar/rechazar) y marcan +18.
 * - Tarifa del momento (comisión plataforma) se divide 50/50:
 *   mitad en el precio mostrado al cliente, mitad cobrada al comprador al pedir.
 * - Al marcar "listo" se crea un viaje delivery (moto + Taxi VIP).
 */
import {
    collection, addDoc, onSnapshot, doc, getDoc, setDoc, updateDoc,
    serverTimestamp, query, where, orderBy, limit, getDocs, deleteDoc, runTransaction
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { calculateServiceFare, getServiceMeta } from './service-types.js?v=2026.07.27.9';
import { haversineKm, getDefaultZoneId, getZoneById, getStoredManualZoneId } from './zones.js?v=2026.07.27.9';
import { resolvePhotoUrl } from './storage.js?v=2026.08.04.3';
import { APP_CONFIG } from './config.js?v=2026.08.04.3';
import { calculateAge } from './age-verification.js?v=2026.08.04.3';
import { pickPhotoWithSourceChoice } from './camera-capture.js?v=2026.08.04.3';

const STORE_CATEGORIES = [
    { id: 'comida', label: 'Comida / restaurante', shortLabel: 'Comida', icon: 'fa-utensils' },
    { id: 'pulperia', label: 'Pulpería', shortLabel: 'Pulpería', icon: 'fa-store' },
    { id: 'farmacia', label: 'Farmacia', shortLabel: 'Farmacia', icon: 'fa-pills' },
    { id: 'tienda', label: 'Tienda / boutique', shortLabel: 'Boutique', icon: 'fa-shopping-bag' },
    { id: 'otro', label: 'Otro negocio', shortLabel: 'Otro', icon: 'fa-box' },
];

const ORDER_STATUS = {
    pending: { label: 'Nuevo', tone: 'amber' },
    accepted: { label: 'Aceptado', tone: 'blue' },
    preparing: { label: 'Preparando', tone: 'violet' },
    ready: { label: 'Listo', tone: 'emerald' },
    out_for_delivery: { label: 'En camino', tone: 'blue' },
    delivered: { label: 'Entregado', tone: 'slate' },
    cancelled: { label: 'Cancelado', tone: 'red' },
};

/** Estado de verificación de tienda (supervisores). */
const STORE_APPROVAL = {
    pending: { label: 'En revisión', tone: 'amber', icon: 'fa-hourglass-half' },
    approved: { label: 'Aprobada', tone: 'emerald', icon: 'fa-check-circle' },
    rejected: { label: 'Rechazada', tone: 'red', icon: 'fa-times-circle' },
};

/** Caché corta de la tarifa del momento (comisión %). */
let cachedTariffPercent = null;
let cachedTariffAt = 0;
/** Filtro del panel staff de tiendas */
let staffStoresFilter = 'pending';
/** Lista cargada para panel staff */
let staffStoresList = [];

let dbRef = null;
let appIdRef = null;
let storageRef = null;
let getCurrentUser = () => null;
let getUserProfile = () => null;
let unsubStores = null;
let unsubMerchantOrders = null;
let unsubClientOrders = null;
let unsubProducts = null;

/** @type {Map<string, object>} */
const storesCache = new Map();
/** @type {object|null} */
let viewingStore = null;
/** @type {object[]} */
let viewingProducts = [];
/** @type {{ productId: string, name: string, basePrice: number, price: number, displayPrice: number, merchantShare: number, buyerShare: number, qty: number, notes?: string, photoUrl?: string|null, storeId?: string }[]} */
let cart = [];
/** @type {object|null} */
let myStore = null;
/** @type {object[]} */
let myProducts = [];
/** @type {object[]} */
let merchantOrders = [];
/** @type {object[]} */
let clientOrders = [];
let merchantTab = 'orders';
let marketplaceView = 'list'; // list | store | cart | checkout | my-orders
/** true = formulario vacío para registrar una tienda nueva (no editar la actual) */
let merchantCreateMode = false;
/** Data URL o File pendiente al agregar producto */
let pendingProductPhoto = null;
let pendingProductPhotoPreview = null;
/** Logo / imagen de portada de la tienda (pendiente de subir) */
let pendingStorePhoto = null;
let pendingStorePhotoPreview = null;
/** Filtros del mundo de tiendas (pantalla completa) */
let storesSearchQuery = '';
let storesCategoryFilter = 'all';

/** Invitación staff → crear empresa (persiste si el invitado aún no tiene cuenta). */
const PENDING_CREATE_BUSINESS_KEY = 'hr_pending_create_business';
const CREATE_BUSINESS_HASHES = new Set([
    'crear-empresa',
    'crear-tienda',
    'invitar-empresa',
    'invitar-tienda',
    'create-store',
    'create-business',
]);

function toast(msg, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
    else console.log('[stores]', type, msg);
}

function setPendingCreateBusiness(on) {
    try {
        if (on) sessionStorage.setItem(PENDING_CREATE_BUSINESS_KEY, '1');
        else sessionStorage.removeItem(PENDING_CREATE_BUSINESS_KEY);
    } catch (_) {}
}

function hasPendingCreateBusiness() {
    try {
        if (sessionStorage.getItem(PENDING_CREATE_BUSINESS_KEY) === '1') return true;
    } catch (_) {}
    const hash = String(window.location.hash || '').replace(/^#/, '').split('&')[0].split('?')[0].toLowerCase();
    return CREATE_BUSINESS_HASHES.has(hash);
}

function buildCreateBusinessInviteLink() {
    try {
        const u = new URL(window.location.href);
        u.hash = 'crear-empresa';
        // Quitar query ruidosa si estorba
        return u.toString();
    } catch (_) {
        return `${window.location.origin}${window.location.pathname}#crear-empresa`;
    }
}

function buildInviteBusinessWhatsAppText({ staffName = '' } = {}) {
    const link = buildCreateBusinessInviteLink();
    const who = staffName ? ` (${staffName})` : '';
    return (
        `🇭🇳 *HonduRaite — Invita a crear tu empresa*\n\n` +
        `Te invitamos a abrir tu *tienda virtual / negocio* en HonduRaite${who}.\n\n` +
        `📌 *Importante:*\n` +
        `• Si *no tienes cuenta*, primero toca el link y *regístrate* (Crear cuenta).\n` +
        `• Si ya tienes cuenta, inicia sesión con el mismo link.\n` +
        `• Luego completa los datos de tu empresa (logo, menú, WhatsApp).\n\n` +
        `👉 Abre aquí:\n${link}\n\n` +
        `Vende con fotos y entrega en moto o Taxi VIP 🛵🚗`
    );
}

/** Admin supremo / admin / supervisor (pueden moderar y borrar tiendas). */
function isStoresStaff() {
    const user = getCurrentUser();
    const profile = getUserProfile() || window.userProfile || {};
    if (typeof window.isStaffUser === 'function') {
        try {
            if (window.isStaffUser(user, profile)) return true;
        } catch (_) {}
    }
    if (typeof window.isAdminUser === 'function') {
        try {
            if (window.isAdminUser(user, profile)) return true;
        } catch (_) {}
    }
    if (typeof window.isSupervisorUser === 'function') {
        try {
            if (window.isSupervisorUser(user, profile)) return true;
        } catch (_) {}
    }
    const role = String(profile.role || '').toLowerCase().trim();
    if (role === 'admin' || role === 'supervisor' || !!profile.staffGrantedBy) return true;
    // Admin supremo por correo (mismo criterio que firestore.rules)
    const mail = String(user?.email || profile.email || '').trim().toLowerCase();
    if (mail === 'josuesoza0513@gmail.com') return true;
    return false;
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function money(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return `L. ${v.toFixed(2)}`;
}

function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Tarifa del momento = comisión de plataforma (%).
 * Misma fuente que viajes: platformConfig/main → commissionPercentage.
 */
async function getTarifaDelMomento() {
    const now = Date.now();
    if (cachedTariffPercent != null && (now - cachedTariffAt) < 12000) {
        return cachedTariffPercent;
    }
    try {
        if (typeof window.getPlatformCommission === 'function') {
            const v = await window.getPlatformCommission();
            if (Number.isFinite(Number(v))) {
                cachedTariffPercent = Number(v);
                cachedTariffAt = now;
                return cachedTariffPercent;
            }
        }
    } catch (_) {}
    try {
        if (dbRef && appIdRef) {
            const snap = await getDoc(publicDoc('platformConfig', 'main'));
            if (snap.exists()) {
                const raw = parseFloat(snap.data().commissionPercentage);
                if (Number.isFinite(raw) && raw >= 0 && raw <= 100) {
                    cachedTariffPercent = raw;
                    cachedTariffAt = now;
                    return cachedTariffPercent;
                }
            }
        }
    } catch (_) {}
    const fb = Number(APP_CONFIG?.commissionPercent);
    cachedTariffPercent = Number.isFinite(fb) && fb >= 0 && fb <= 100 ? fb : 25;
    cachedTariffAt = now;
    return cachedTariffPercent;
}

function getTarifaDelMomentoSync() {
    if (cachedTariffPercent != null) return cachedTariffPercent;
    const fb = Number(APP_CONFIG?.commissionPercent);
    return Number.isFinite(fb) && fb >= 0 && fb <= 100 ? fb : 25;
}

/**
 * Divide la tarifa del momento 50/50 entre emprendedor y comprador.
 * - Precio mostrado al cliente = base + mitad de la tarifa
 * - Al comprar se cobra la otra mitad (además del envío)
 *
 * @param {number} basePrice precio que pone el emprendedor
 * @param {number} [commissionPercent] % tarifa del momento
 */
function calcSplitTariff(basePrice, commissionPercent = getTarifaDelMomentoSync()) {
    const base = roundMoney(basePrice);
    const pct = Number(commissionPercent);
    const safePct = Number.isFinite(pct) && pct >= 0 ? pct : 25;
    const fullTariff = roundMoney(base * (safePct / 100));
    // Mitad redondeada: la 2.ª mitad absorbe el centavo residual
    const merchantShare = roundMoney(fullTariff / 2);
    const buyerShare = roundMoney(fullTariff - merchantShare);
    const displayPrice = roundMoney(base + merchantShare);
    return {
        basePrice: base,
        commissionPercent: safePct,
        fullTariff,
        merchantShare,
        buyerShare,
        displayPrice,
        halfPercent: roundMoney(safePct / 2),
    };
}

function productBasePrice(p) {
    if (!p) return 0;
    const base = p.basePrice != null ? Number(p.basePrice) : Number(p.price);
    return Number.isFinite(base) ? base : 0;
}

function productDisplayPrice(p, commissionPercent = getTarifaDelMomentoSync()) {
    if (!p) return 0;
    const base = productBasePrice(p);
    return calcSplitTariff(base, commissionPercent).displayPrice;
}

function storeApprovalStatus(store) {
    const raw = String(store?.approvalStatus || '').toLowerCase().trim();
    if (raw === 'pending' || raw === 'approved' || raw === 'rejected') return raw;
    // Tiendas antiguas sin campo: ya publicadas → aprobadas
    if (store?.createdAt) return 'approved';
    return 'pending';
}

function isStoreApprovedForPublic(store) {
    return storeApprovalStatus(store) === 'approved' && store?.active !== false;
}

function isStoreAdultsOnly(store) {
    return !!(store?.adultsOnly || store?.requiresAge18 || store?.ageRestricted);
}

function getUserAgeYears() {
    const profile = getUserProfile() || window.userProfile || {};
    const age = calculateAge(profile.birthDate || profile.dateOfBirth || profile.birthday);
    return age;
}

function userIsAdult18() {
    const age = getUserAgeYears();
    return age != null && age >= 18;
}

function phoneNorm(p) {
    if (typeof window.normalizeHondurasPhone === 'function') {
        return window.normalizeHondurasPhone(String(p || '').trim()) || '';
    }
    return String(p || '').trim();
}

function publicCol(name) {
    return collection(dbRef, 'artifacts', appIdRef, 'public', 'data', name);
}

function publicDoc(name, id) {
    return doc(dbRef, 'artifacts', appIdRef, 'public', 'data', name, id);
}

function activeCity() {
    const zoneId = getStoredManualZoneId() || getDefaultZoneId();
    const zone = getZoneById(zoneId);
    return {
        cityId: zone?.id || zoneId || 'comayagua',
        cityName: zone?.name || 'Comayagua',
        center: zone?.center || null,
    };
}

function cartCount() {
    return cart.reduce((s, i) => s + (i.qty || 0), 0);
}

/** Total de productos como los ve el cliente (precio con mitad de tarifa). */
function cartItemsDisplayTotal() {
    return roundMoney(cart.reduce((s, i) => {
        const unit = Number(i.displayPrice ?? i.price) || 0;
        return s + unit * (i.qty || 0);
    }, 0));
}

/** Suma de las mitades de tarifa que paga el comprador (aparte del precio mostrado). */
function cartBuyerTariffTotal() {
    return roundMoney(cart.reduce((s, i) => {
        const share = Number(i.buyerShare);
        if (Number.isFinite(share)) return s + share * (i.qty || 0);
        const base = Number(i.basePrice ?? i.price) || 0;
        return s + calcSplitTariff(base).buyerShare * (i.qty || 0);
    }, 0));
}

/** Total a cobrar al comprador por productos + su mitad de tarifa (sin envío). */
function cartItemsTotal() {
    return roundMoney(cartItemsDisplayTotal() + cartBuyerTariffTotal());
}

function cartBaseTotal() {
    return roundMoney(cart.reduce((s, i) => {
        const base = Number(i.basePrice);
        if (Number.isFinite(base)) return s + base * (i.qty || 0);
        return s + (Number(i.price) || 0) * (i.qty || 0);
    }, 0));
}

function cartMerchantTariffTotal() {
    return roundMoney(cart.reduce((s, i) => {
        const share = Number(i.merchantShare);
        if (Number.isFinite(share)) return s + share * (i.qty || 0);
        const base = Number(i.basePrice ?? i.price) || 0;
        return s + calcSplitTariff(base).merchantShare * (i.qty || 0);
    }, 0));
}

function ensureShell() {
    let market = document.getElementById('stores-marketplace-panel');
    const needMarketRebuild = !market || market.getAttribute('data-layout') !== 'world-v4';

    if (needMarketRebuild) {
        const wasOpen = market && !market.classList.contains('hidden');
        market?.remove();
        market = document.createElement('div');
        market.id = 'stores-marketplace-panel';
        market.className = 'stores-world hidden';
        market.setAttribute('data-layout', 'world-v4');
        market.setAttribute('role', 'dialog');
        market.setAttribute('aria-modal', 'true');
        market.setAttribute('aria-label', 'Tiendas virtuales');
        market.innerHTML = `
            <div class="stores-world-inner">
                <header class="stores-world-head">
                    <div class="stores-world-head-row">
                        <button type="button" class="stores-icon-btn" data-stores-action="close" aria-label="Salir de tiendas">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                        <div class="min-w-0 flex-1">
                            <p class="stores-kicker">HonduRaite · Marketplace</p>
                            <h2 id="stores-panel-title" class="stores-title">Tiendas virtuales</h2>
                        </div>
                        <button type="button" class="stores-icon-btn" data-stores-action="my-orders" title="Mis pedidos" aria-label="Mis pedidos">
                            <i class="fas fa-receipt"></i>
                        </button>
                    </div>
                    <div id="stores-world-toolbar" class="stores-world-toolbar">
                        <div class="stores-search-wrap">
                            <i class="fas fa-search"></i>
                            <input type="search" id="stores-search-input" class="stores-search-input"
                                   placeholder="Buscar tienda, comida, farmacia…"
                                   autocomplete="off" enterkeyhint="search">
                            <button type="button" id="stores-search-clear" class="stores-search-clear hidden" data-stores-action="clear-search" aria-label="Limpiar búsqueda">×</button>
                        </div>
                        <div id="stores-merchant-chips" class="stores-merchant-chips" aria-label="Mi tienda"></div>
                        <div id="stores-category-chips" class="stores-category-chips" role="tablist" aria-label="Categorías"></div>
                        <div class="stores-world-meta">
                            <span id="stores-city-label" class="stores-city-label"><i class="fas fa-map-marker-alt"></i> —</span>
                            <span id="stores-count-label" class="stores-count-label">0 tiendas</span>
                        </div>
                    </div>
                </header>
                <div id="stores-panel-body" class="stores-world-body"></div>
                <footer id="stores-cart-bar" class="stores-cart-bar hidden">
                    <div>
                        <p class="stores-cart-count"><span id="stores-cart-count">0</span> productos</p>
                        <p id="stores-cart-total" class="stores-cart-total">L. 0.00</p>
                    </div>
                    <button type="button" class="stores-primary-btn" data-stores-action="open-cart">Ver carrito</button>
                </footer>
            </div>
        `;
        document.body.appendChild(market);
        // capture=true: el clic llega aunque algo en burbuja lo detenga
        market.addEventListener('click', onMarketplaceClick, true);
        const searchInput = market.querySelector('#stores-search-input');
        if (searchInput && searchInput.dataset.bound !== '1') {
            searchInput.dataset.bound = '1';
            searchInput.addEventListener('input', () => {
                storesSearchQuery = searchInput.value || '';
                const clearBtn = document.getElementById('stores-search-clear');
                clearBtn?.classList.toggle('hidden', !storesSearchQuery.trim());
                if (marketplaceView === 'list') renderMarketplace();
            });
        }
        if (wasOpen) {
            market.classList.remove('hidden');
            document.body.classList.add('stores-world-open', 'stores-panel-open');
        }
    }

    let merchant = document.getElementById('merchant-panel');
    if (!merchant || merchant.getAttribute('data-layout') !== 'world-v1') {
        const wasOpen = merchant && !merchant.classList.contains('hidden');
        merchant?.remove();
        merchant = document.createElement('div');
        merchant.id = 'merchant-panel';
        merchant.className = 'stores-world stores-world--merchant hidden';
        merchant.setAttribute('data-layout', 'world-v1');
        merchant.innerHTML = `
            <div class="stores-world-inner">
                <header class="stores-world-head stores-world-head--merchant">
                    <div class="stores-world-head-row">
                        <button type="button" class="stores-icon-btn" data-merchant-action="close" aria-label="Cerrar">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                        <div class="min-w-0 flex-1">
                            <p class="stores-kicker">Emprendedor</p>
                            <h2 class="stores-title">Mi tienda virtual</h2>
                        </div>
                        <button type="button" id="merchant-open-toggle" class="stores-toggle-open" data-merchant-action="toggle-open" title="Abrir/cerrar tienda">
                            <i class="fas fa-store"></i> <span id="merchant-open-label">Cerrada</span>
                        </button>
                    </div>
                    <nav class="merchant-tabs" role="tablist">
                        <button type="button" class="merchant-tab active" data-merchant-tab="orders">Pedidos</button>
                        <button type="button" class="merchant-tab" data-merchant-tab="products">Menú</button>
                        <button type="button" class="merchant-tab" data-merchant-tab="store">Tienda</button>
                    </nav>
                </header>
                <div id="merchant-panel-body" class="stores-world-body"></div>
            </div>
        `;
        document.body.appendChild(merchant);
        merchant.addEventListener('click', onMerchantClick);
        if (wasOpen) {
            merchant.classList.remove('hidden');
            document.body.classList.add('stores-world-open', 'stores-panel-open');
        }
    }
}

/** Sección propia en el panel del pasajero (NO dentro de Envíos). */
function injectClientStoresSection() {
    // Quitar el CTA viejo que estaba dentro de delivery (evita confusión)
    document.getElementById('delivery-stores-entry')?.remove();

    if (document.getElementById('client-stores-section')) {
        syncClientStoresSectionVisibility();
        return;
    }

    const clientView = document.getElementById('client-view');
    if (!clientView) return;

    const section = document.createElement('section');
    section.id = 'client-stores-section';
    section.className = 'trip-step-card client-stores-section';
    section.innerHTML = `
        <div class="trip-step-head">
            <span class="trip-step-badge trip-step-badge--stores"><i class="fas fa-store"></i></span>
            <span class="trip-step-title">Tiendas virtuales</span>
            <span class="text-[9px] text-amber-700 ml-1 font-bold">Apartado propio · no es mensajería</span>
        </div>
        <button type="button" id="btn-open-stores-marketplace" class="client-stores-cta" data-stores-action="open-marketplace">
            <span class="client-stores-cta-icon"><i class="fas fa-shopping-bag"></i></span>
            <span class="client-stores-cta-copy">
                <strong>Comprar en tiendas locales</strong>
                <small>Menú con fotos · emprendedores · entrega en moto o Taxi VIP</small>
            </span>
            <i class="fas fa-chevron-right client-stores-cta-chevron"></i>
        </button>
        <div class="client-stores-actions client-stores-actions--3">
            <button type="button" class="stores-secondary-btn" data-stores-action="my-orders-quick">
                <i class="fas fa-receipt"></i> Mis pedidos
            </button>
            <button type="button" class="stores-secondary-btn" data-stores-action="open-merchant">
                <i class="fas fa-store"></i> Mi tienda
            </button>
            <button type="button" class="stores-primary-btn stores-primary-btn--sm" data-stores-action="create-store">
                <i class="fas fa-plus"></i> Crear tienda nueva
            </button>
        </div>
    `;

    // Al inicio del flujo pasajero, antes de origen/destino
    const route = document.getElementById('passenger-booking-route');
    if (route?.parentElement) {
        route.parentElement.insertBefore(section, route);
    } else {
        clientView.insertBefore(section, clientView.firstChild);
    }

    section.querySelector('[data-stores-action="open-marketplace"]')
        ?.addEventListener('click', () => openMarketplace());
    section.querySelector('[data-stores-action="my-orders-quick"]')
        ?.addEventListener('click', () => {
            marketplaceView = 'my-orders';
            openMarketplace();
            startClientOrdersListener();
            renderMarketplace();
        });
    section.querySelector('[data-stores-action="open-merchant"]')
        ?.addEventListener('click', () => openMerchantPanel({ createNew: false }));
    section.querySelector('[data-stores-action="create-store"]')
        ?.addEventListener('click', () => openMerchantPanel({ createNew: true }));

    syncClientStoresSectionVisibility();
}

function syncClientStoresSectionVisibility() {
    const el = document.getElementById('client-stores-section');
    if (!el) return;
    // Con el menú de inicio, la sección embebida se oculta para no duplicar:
    // "Pedido en tiendas" abre el marketplace desde el hub.
    el.classList.add('hidden');
}

/** Chip en el picker de servicios: abre tiendas sin mezclar con Envío */
function injectServicePickerChip() {
    const picker = document.getElementById('service-type-picker');
    if (!picker || document.getElementById('svc-btn-stores')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'svc-btn-stores';
    btn.className = 'service-type-btn trip-service-chip trip-service-chip--stores';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.title = 'Tiendas virtuales de emprendedores (sección aparte)';
    btn.innerHTML = `<i class="fas fa-store pointer-events-none"></i><span class="pointer-events-none">Tiendas virtuales</span>`;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMarketplace();
    });

    // Después de Envío / Comida si existe, si no al final de los chips de pasajero
    const deliveryBtn = document.getElementById('svc-btn-delivery');
    if (deliveryBtn?.nextSibling) {
        deliveryBtn.parentElement.insertBefore(btn, deliveryBtn.nextSibling);
    } else if (deliveryBtn) {
        deliveryBtn.after(btn);
    } else {
        picker.appendChild(btn);
    }
}

function injectProfileEntry() {
    const profileScroll = document.querySelector('#profile-panel .flex-1.overflow-y-auto')
        || document.querySelector('#profile-panel .overflow-y-auto');
    if (!profileScroll || document.getElementById('btn-merchant-store-profile')) return;

    const wrap = document.createElement('div');
    wrap.id = 'btn-merchant-store-profile';
    wrap.className = 'space-y-2';
    wrap.innerHTML = `
        <button type="button" id="btn-merchant-my-store"
                class="w-full flex items-center justify-center gap-3 py-3 border border-emerald-200 bg-emerald-50 rounded-2xl text-sm font-bold text-emerald-900 active:bg-emerald-100">
            <i class="fas fa-store text-emerald-600"></i>
            <span>Mi tienda (1 por cuenta)</span>
        </button>
        <button type="button" id="btn-merchant-create-store"
                class="w-full flex items-center justify-center gap-3 py-3 border border-amber-200 bg-amber-50 rounded-2xl text-sm font-bold text-amber-900 active:bg-amber-100">
            <i class="fas fa-plus-circle text-amber-600"></i>
            <span>Crear mi tienda</span>
        </button>
        <p class="text-[10px] text-slate-500 text-center font-semibold px-1">Solo 1 tienda por usuario. Si ya tienes, se abre la tuya.</p>
    `;
    const referral = profileScroll.querySelector('.bg-emerald-50');
    if (referral?.parentElement) {
        referral.parentElement.insertBefore(wrap, referral.nextSibling);
    } else {
        profileScroll.appendChild(wrap);
    }
    wrap.querySelector('#btn-merchant-my-store')?.addEventListener('click', () => openMerchantPanel({ createNew: false }));
    wrap.querySelector('#btn-merchant-create-store')?.addEventListener('click', () => openMerchantPanel({ createNew: true }));
}

function injectHeaderMenuEntry() {
    const menu = document.getElementById('header-more-menu');
    if (!menu || document.getElementById('header-menu-stores')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'header-menu-stores';
    btn.className = 'header-more-item';
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = `<i class="fas fa-store text-amber-600"></i><span>Tiendas virtuales</span>`;
    btn.addEventListener('click', () => {
        menu.classList.add('hidden');
        openMarketplace();
    });
    const history = menu.querySelector('[data-header-menu-action="history"]');
    if (history) history.before(btn);
    else menu.appendChild(btn);

    if (!document.getElementById('header-menu-merchant')) {
        const mBtn = document.createElement('button');
        mBtn.type = 'button';
        mBtn.id = 'header-menu-merchant';
        mBtn.className = 'header-more-item';
        mBtn.setAttribute('role', 'menuitem');
        mBtn.innerHTML = `<i class="fas fa-store text-emerald-600"></i><span>Mi tienda</span>`;
        mBtn.addEventListener('click', () => {
            menu.classList.add('hidden');
            openMerchantPanel({ createNew: false });
        });
        btn.after(mBtn);

        const cBtn = document.createElement('button');
        cBtn.type = 'button';
        cBtn.id = 'header-menu-create-store';
        cBtn.className = 'header-more-item';
        cBtn.setAttribute('role', 'menuitem');
        cBtn.innerHTML = `<i class="fas fa-plus-circle text-amber-600"></i><span>Crear mi tienda (máx. 1)</span>`;
        cBtn.addEventListener('click', () => {
            menu.classList.add('hidden');
            openMerchantPanel({ createNew: true });
        });
        mBtn.after(cBtn);
    }
}

function bindUiHooks() {
    ensureShell();
    injectClientStoresSection();
    injectServicePickerChip();
    injectProfileEntry();
    injectHeaderMenuEntry();
}

/* ===================== DATA ===================== */

function startStoresListener() {
    if (unsubStores) return;
    // Límite alto para marketplace con muchos negocios (filtrado en cliente por ciudad/búsqueda)
    const q = query(publicCol('stores'), where('active', '==', true), limit(300));
    unsubStores = onSnapshot(q, (snap) => {
        storesCache.clear();
        snap.forEach((d) => storesCache.set(d.id, { id: d.id, ...d.data() }));
        if (!document.getElementById('stores-marketplace-panel')?.classList.contains('hidden')
            && marketplaceView === 'list') {
            renderMarketplace();
        }
        refreshMyStoreFromCache();
    }, (err) => console.warn('[stores] listener', err));
}

function refreshMyStoreFromCache() {
    const uid = getCurrentUser()?.uid;
    if (!uid) {
        myStore = null;
        return;
    }
    myStore = [...storesCache.values()].find((s) => s.ownerId === uid) || myStore;
    updateMerchantOpenToggle();
}

async function loadMyStore() {
    const uid = getCurrentUser()?.uid;
    if (!uid) return null;
    try {
        const q = query(publicCol('stores'), where('ownerId', '==', uid), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) {
            myStore = null;
            return null;
        }
        const d = snap.docs[0];
        myStore = { id: d.id, ...d.data() };
        storesCache.set(myStore.id, myStore);
        return myStore;
    } catch (e) {
        console.warn('[stores] loadMyStore', e);
        return null;
    }
}

async function loadProducts(storeId) {
    if (!storeId) return [];
    const q = query(publicCol('store_products'), where('storeId', '==', storeId), limit(100));
    const snap = await getDocs(q);
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name || '').localeCompare(String(b.name || '')));
}

/** IDs ya vistos (para sonar solo en pedidos nuevos en vivo) */
let knownMerchantOrderIds = new Set();
let merchantOrdersBootstrapped = false;

function playNewStoreOrderAlert(order) {
    try {
        if (typeof window.playStoreOrderTone === 'function') window.playStoreOrderTone();
        else if (typeof window.playEventNotificationTone === 'function') window.playEventNotificationTone('store_order');
        else if (window.HonduTones?.playEventTone) window.HonduTones.playEventTone('store_order');
    } catch (_) {}

    const items = Array.isArray(order?.items) ? order.items : [];
    const summary = items.slice(0, 2).map((i) => `${i.qty || 1}× ${i.name || 'producto'}`).join(', ');
    const total = Number(order?.itemsTotal);
    const totalTxt = Number.isFinite(total) ? ` · L. ${total.toFixed(2)}` : '';
    const msg = `🛒 Nuevo pedido${summary ? `: ${summary}` : ''}${totalTxt}`;
    toast(msg, 'success');

    // Vibración fuerte (web + Android si hay API)
    try {
        if (navigator.vibrate) navigator.vibrate([0, 200, 80, 200, 80, 400]);
        window.triggerSuperTripVibration?.();
    } catch (_) {}

    // Notificación del navegador si la app está en segundo plano / pestaña oculta
    try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const n = new Notification('¡Nuevo pedido en tu tienda!', {
                body: `${order?.clientName || 'Cliente'}${summary ? ` · ${summary}` : ''}${totalTxt}`,
                tag: `store-order-${order?.id || Date.now()}`,
                renotify: true,
                requireInteraction: true,
                icon: 'icons/icon-192.png'
            });
            n.onclick = () => {
                try { window.focus(); } catch (_) {}
                openMerchantPanel({ createNew: false });
                n.close();
            };
        } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    } catch (_) {}
}

function handleMerchantOrdersSnapshot(docs) {
    const next = docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!merchantOrdersBootstrapped) {
        knownMerchantOrderIds = new Set(next.map((o) => o.id));
        merchantOrdersBootstrapped = true;
        merchantOrders = next;
    } else {
        for (const o of next) {
            if (!knownMerchantOrderIds.has(o.id) && (o.status === 'pending' || !o.status)) {
                playNewStoreOrderAlert(o);
                // Abrir panel de pedidos si el emprendedor está en la app
                try {
                    if (document.visibilityState === 'visible') {
                        merchantTab = 'orders';
                        if (document.getElementById('merchant-panel')?.classList.contains('hidden')) {
                            // No forzar abrir si está comprando; solo si ya tiene panel merchant o es solo cliente con tienda
                        }
                    }
                } catch (_) {}
            }
            knownMerchantOrderIds.add(o.id);
        }
        merchantOrders = next;
    }
    if (!document.getElementById('merchant-panel')?.classList.contains('hidden') && merchantTab === 'orders') {
        renderMerchantBody();
    }
}

function startMerchantOrdersListener() {
    if (unsubMerchantOrders) {
        unsubMerchantOrders();
        unsubMerchantOrders = null;
    }
    const uid = getCurrentUser()?.uid;
    if (!uid) return;
    // Reiniciar bootstrap al re-suscribir (nuevo login)
    merchantOrdersBootstrapped = false;
    knownMerchantOrderIds = new Set();

    const q = query(
        publicCol('store_orders'),
        where('ownerId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(40)
    );
    unsubMerchantOrders = onSnapshot(q, (snap) => {
        handleMerchantOrdersSnapshot(snap.docs);
    }, async (err) => {
        // Fallback sin orderBy si falta índice
        console.warn('[stores] merchant orders orderBy failed, fallback', err?.message || err);
        try {
            const q2 = query(publicCol('store_orders'), where('ownerId', '==', uid), limit(40));
            const snap = await getDocs(q2);
            const docs = snap.docs
                .slice()
                .sort((a, b) => (b.data()?.createdAt?.toMillis?.() || 0) - (a.data()?.createdAt?.toMillis?.() || 0));
            handleMerchantOrdersSnapshot(docs);
        } catch (e2) {
            console.warn('[stores] merchant orders fallback', e2);
        }
    });
}

function startClientOrdersListener() {
    if (unsubClientOrders) {
        unsubClientOrders();
        unsubClientOrders = null;
    }
    const uid = getCurrentUser()?.uid;
    if (!uid) return;
    const q = query(publicCol('store_orders'), where('clientId', '==', uid), limit(30));
    unsubClientOrders = onSnapshot(q, (snap) => {
        clientOrders = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        if (marketplaceView === 'my-orders') renderMarketplace();
    }, (err) => console.warn('[stores] client orders', err));
}

/* ===================== MARKETPLACE UI ===================== */

function enterStoresWorld() {
    ensureShell();
    const market = document.getElementById('stores-marketplace-panel');
    market?.classList.remove('hidden');
    document.body.classList.add('stores-world-open', 'stores-panel-open');
    // Ocultar mapa/panel de viaje: el marketplace es el panorama completo
    document.getElementById('control-panel')?.classList.add('stores-world-hidden');
    document.getElementById('map-container')?.classList.add('stores-world-hidden');
    document.getElementById('panel-expand-fab')?.classList.add('stores-world-hidden');
    try {
        window.hideControlPanel?.();
    } catch (_) {}
}

function isStoresWorldLayerOpen() {
    const market = document.getElementById('stores-marketplace-panel');
    const merchant = document.getElementById('merchant-panel');
    return !!(
        (market && !market.classList.contains('hidden'))
        || (merchant && !merchant.classList.contains('hidden'))
    );
}

function exitStoresWorldIfIdle() {
    if (isStoresWorldLayerOpen()) {
        document.body.classList.add('stores-world-open', 'stores-panel-open');
        return;
    }
    document.body.classList.remove('stores-world-open', 'stores-panel-open');
    document.getElementById('control-panel')?.classList.remove('stores-world-hidden');
    document.getElementById('map-container')?.classList.remove('stores-world-hidden');
    document.getElementById('panel-expand-fab')?.classList.remove('stores-world-hidden');
    try { window.showControlPanel?.(); } catch (_) {}
}

export function openMarketplace() {
    bindUiHooks();
    startStoresListener();
    startClientOrdersListener();
    marketplaceView = 'list';
    storesSearchQuery = storesSearchQuery || '';
    enterStoresWorld();
    // Sincronizar input de búsqueda
    const input = document.getElementById('stores-search-input');
    if (input && input.value !== storesSearchQuery) input.value = storesSearchQuery;
    // Prefetch tarifa del momento para precios correctos
    getTarifaDelMomento().then(() => {
        if (marketplaceView === 'store' || marketplaceView === 'cart' || marketplaceView === 'checkout') {
            renderMarketplace();
        }
    }).catch(() => {});
    renderCategoryChips();
    renderMarketplace();
}

/**
 * @param {{ silent?: boolean }} [opts]
 * silent: solo cierra el mundo (sin navegar al menú inicio)
 */
export function closeMarketplace(opts = {}) {
    document.getElementById('stores-marketplace-panel')?.classList.add('hidden');
    exitStoresWorldIfIdle();
    if (opts.silent) return;
    // Al salir del panorama de tiendas, volver al menú de inicio del pasajero
    try {
        if (window.getPassengerHomeMode?.() === 'stores') {
            window.showPassengerHomeMenu?.();
        }
    } catch (_) {}
}

function setMarketplaceTitle(title) {
    const el = document.getElementById('stores-panel-title');
    if (el) el.textContent = title;
}

function updateCartBar() {
    const bar = document.getElementById('stores-cart-bar');
    if (!bar) return;
    const n = cartCount();
    if (n <= 0 || marketplaceView === 'cart' || marketplaceView === 'checkout' || marketplaceView === 'my-orders') {
        bar.classList.add('hidden');
        return;
    }
    bar.classList.remove('hidden');
    const c = document.getElementById('stores-cart-count');
    const t = document.getElementById('stores-cart-total');
    if (c) c.textContent = String(n);
    if (t) t.textContent = money(cartItemsTotal());
}

function renderCategoryChips() {
    const merchantWrap = document.getElementById('stores-merchant-chips');
    const wrap = document.getElementById('stores-category-chips');
    if (merchantWrap) {
        const staffInvite = isStoresStaff()
            ? `<button type="button" class="stores-action-chip stores-action-chip--invite"
                        data-stores-action="staff-invite-business" title="Invitar a crear empresa por WhatsApp">
                    <i class="fab fa-whatsapp"></i>
                    <span>Invitar empresa</span>
               </button>
               <button type="button" class="stores-action-chip stores-action-chip--review"
                        data-stores-action="staff-review-stores" title="Verificar tiendas (aprobar / +18)">
                    <i class="fas fa-clipboard-check"></i>
                    <span>Verificar tiendas</span>
               </button>`
            : '';
        // Fila propia: acciones de emprendedor (+ invitar si es staff)
        merchantWrap.innerHTML = `
            <button type="button" class="stores-action-chip stores-action-chip--my-store"
                    data-stores-action="open-merchant" title="Administrar mi tienda">
                <i class="fas fa-store"></i>
                <span>Mi tienda</span>
            </button>
            <button type="button" class="stores-action-chip stores-action-chip--create"
                    data-stores-action="create-store" title="Crear mi tienda (máx. 1)">
                <i class="fas fa-plus"></i>
                <span>Crear tienda</span>
            </button>
            ${staffInvite}
        `;
        if (staffInvite) merchantWrap.classList.add('stores-merchant-chips--staff');
        else merchantWrap.classList.remove('stores-merchant-chips--staff');

        // Clic directo (además del delegado): evita “no hace nada” si el evento se traga
        const inviteBtn = merchantWrap.querySelector('[data-stores-action="staff-invite-business"]');
        if (inviteBtn) {
            inviteBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                try { ev.stopImmediatePropagation(); } catch (_) {}
                showStaffInviteBusinessModal();
            });
        }
        const reviewBtn = merchantWrap.querySelector('[data-stores-action="staff-review-stores"]');
        if (reviewBtn) {
            reviewBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                try { ev.stopImmediatePropagation(); } catch (_) {}
                loadSupervisorStores();
            });
        }
    }
    if (!wrap) return;
    const chips = [
        { id: 'all', label: 'Todas', shortLabel: 'Todas', icon: 'fa-border-all' },
        ...STORE_CATEGORIES,
    ];
    wrap.innerHTML = chips.map((c) => {
        const short = c.shortLabel || c.label;
        return `
        <button type="button" class="stores-cat-chip ${storesCategoryFilter === c.id ? 'active' : ''}"
                data-stores-action="filter-cat" data-cat="${esc(c.id)}"
                title="${esc(c.label)}">
            <i class="fas ${esc(c.icon || 'fa-tag')}"></i>
            <span class="stores-cat-chip-label" data-full="${esc(c.label)}" data-short="${esc(short)}">${esc(short)}</span>
        </button>`;
    }).join('');
}

function filteredStoreList() {
    const city = activeCity();
    const q = storesSearchQuery.trim().toLowerCase();
    const staff = isStoresStaff();
    let all = [...storesCache.values()].filter((s) => s.active !== false);

    // Público: solo tiendas aprobadas por supervisores. Staff ve todas (moderar).
    if (!staff) {
        all = all.filter((s) => isStoreApprovedForPublic(s));
    }

    if (storesCategoryFilter && storesCategoryFilter !== 'all') {
        all = all.filter((s) => (s.category || 'otro') === storesCategoryFilter);
    }

    const local = all.filter((s) => !s.cityId || s.cityId === city.cityId);
    let list = local.length ? local : all;

    if (q) {
        list = list.filter((s) => {
            const hay = `${s.name || ''} ${s.description || ''} ${s.address || ''} ${s.category || ''} ${s.cityName || ''}`.toLowerCase();
            return hay.includes(q);
        });
    }

    return list.sort((a, b) => {
        const ao = a.isOpen === false ? 1 : 0;
        const bo = b.isOpen === false ? 1 : 0;
        const ap = storeApprovalStatus(a) === 'approved' ? 0 : 1;
        const bp = storeApprovalStatus(b) === 'approved' ? 0 : 1;
        return ap - bp || ao - bo || String(a.name || '').localeCompare(String(b.name || ''), 'es');
    });
}

function updateStoresMeta(listLen) {
    const city = activeCity();
    const cityEl = document.getElementById('stores-city-label');
    const countEl = document.getElementById('stores-count-label');
    if (cityEl) cityEl.innerHTML = `<i class="fas fa-map-marker-alt"></i> ${esc(city.cityName)}`;
    if (countEl) {
        countEl.textContent = listLen === 1 ? '1 tienda' : `${listLen} tiendas`;
    }
}

function setToolbarVisible(show) {
    document.getElementById('stores-world-toolbar')?.classList.toggle('hidden', !show);
}

function renderMarketplace() {
    const body = document.getElementById('stores-panel-body');
    if (!body) return;

    if (marketplaceView === 'list') {
        setMarketplaceTitle('Tiendas virtuales');
        setToolbarVisible(true);
        renderCategoryChips();
        const city = activeCity();
        const list = filteredStoreList();
        updateStoresMeta(list.length);

        body.innerHTML = `
            <div class="stores-world-hero stores-world-hero--compact">
                <div>
                    <p class="stores-world-hero-title">Explora negocios locales</p>
                    <p class="stores-world-hero-sub">Pide con fotos · entrega en <b>moto o Taxi VIP</b> · máx. <b>1 tienda</b> por cuenta</p>
                </div>
            </div>
            <div class="stores-browse-grid" role="list">
                ${list.length ? list.map(storeCardHtml).join('') : `
                    <div class="stores-empty stores-empty--full">
                        <i class="fas fa-store-slash"></i>
                        <p>${storesSearchQuery.trim() || storesCategoryFilter !== 'all'
                            ? 'No hay tiendas con ese filtro.'
                            : `Aún no hay tiendas en ${esc(city.cityName)}.`}</p>
                        <p class="text-xs text-slate-500">Prueba otra categoría, quita la búsqueda o publica tu negocio.</p>
                        <div class="flex flex-wrap gap-2 justify-center mt-3">
                            ${(storesSearchQuery.trim() || storesCategoryFilter !== 'all') ? `
                                <button type="button" class="stores-secondary-btn" data-stores-action="clear-filters">Ver todas</button>
                            ` : ''}
                            <button type="button" class="stores-primary-btn" data-stores-action="create-store">
                                <i class="fas fa-plus"></i> Crear tienda nueva
                            </button>
                        </div>
                    </div>
                `}
            </div>
        `;
    } else if (marketplaceView === 'store' && viewingStore) {
        setToolbarVisible(false);
        setMarketplaceTitle(viewingStore.name || 'Tienda');
        const open = viewingStore.isOpen !== false;
        const adults = isStoreAdultsOnly(viewingStore);
        const appr = storeApprovalStatus(viewingStore);
        const apprMeta = STORE_APPROVAL[appr] || STORE_APPROVAL.pending;
        const tariffPct = getTarifaDelMomentoSync();
        const logoBlock = viewingStore.photoUrl
            ? `<div class="store-detail-logo-wrap"><img class="store-detail-logo" src="${esc(viewingStore.photoUrl)}" alt="${esc(viewingStore.name || 'Tienda')}" loading="lazy" onerror="this.style.opacity='0'"></div>`
            : `<div class="store-detail-avatar"><i class="fas ${esc(catIcon(viewingStore.category))}"></i></div>`;
        const staffBar = isStoresStaff()
            ? `<div class="store-staff-bar">
                    <p class="store-staff-bar-label"><i class="fas fa-shield-alt"></i> Moderación staff · ${esc(apprMeta.label)}</p>
                    <div class="flex flex-wrap gap-2">
                        ${appr !== 'approved' ? `<button type="button" class="stores-primary-btn store-staff-delete-btn" data-stores-action="staff-approve-store" data-store-id="${esc(viewingStore.id)}"><i class="fas fa-check"></i> Nos parece bien</button>` : ''}
                        ${appr !== 'rejected' ? `<button type="button" class="stores-danger-btn store-staff-delete-btn" data-stores-action="staff-reject-store" data-store-id="${esc(viewingStore.id)}"><i class="fas fa-times"></i> Nos parece mal</button>` : ''}
                        <button type="button" class="stores-secondary-btn store-staff-delete-btn" data-stores-action="staff-toggle-18" data-store-id="${esc(viewingStore.id)}">
                            <i class="fas fa-user-shield"></i> ${adults ? 'Quitar +18' : 'Marcar +18'}
                        </button>
                        <button type="button" class="stores-danger-btn store-staff-delete-btn"
                            data-stores-action="admin-delete-store" data-store-id="${esc(viewingStore.id)}">
                            <i class="fas fa-trash-alt"></i> Borrar
                        </button>
                    </div>
               </div>`
            : '';
        body.innerHTML = `
            <div class="store-detail-head">
                ${logoBlock}
                <div class="min-w-0">
                    <p class="store-detail-name">${esc(viewingStore.name)}${adults ? ' <span class="store-badge-18">+18</span>' : ''}</p>
                    <p class="store-detail-meta">${esc(catLabel(viewingStore.category))} · ${open ? '<span class="text-emerald-600 font-bold">Abierta</span>' : '<span class="text-slate-500">Cerrada</span>'}</p>
                    ${viewingStore.address ? `<p class="store-detail-addr"><i class="fas fa-map-marker-alt"></i> ${esc(viewingStore.address)}</p>` : ''}
                    ${viewingStore.description ? `<p class="store-detail-desc">${esc(viewingStore.description)}</p>` : ''}
                    ${adults ? `<p class="text-[11px] font-bold text-rose-700 mt-1"><i class="fas fa-exclamation-triangle"></i> Solo mayores de 18 años</p>` : ''}
                </div>
            </div>
            ${staffBar}
            <p class="text-[10px] text-slate-500 px-1 mb-2 leading-snug">
                Precios incluyen la mitad de la tarifa del momento (${esc(String(tariffPct))}%). La otra mitad se suma al pagar el pedido. El envío va aparte.
            </p>
            <div class="store-products">
                <p class="stores-section-label">Menú / productos</p>
                ${viewingProducts.length ? viewingProducts.map(productCardHtml).join('') : `
                    <div class="stores-empty"><p>Esta tienda aún no tiene productos.</p></div>
                `}
            </div>
        `;
    } else if (marketplaceView === 'cart') {
        setToolbarVisible(false);
        setMarketplaceTitle('Tu carrito');
        body.innerHTML = renderCartHtml();
    } else if (marketplaceView === 'checkout') {
        setToolbarVisible(false);
        setMarketplaceTitle('Confirmar pedido');
        body.innerHTML = renderCheckoutHtml();
    } else if (marketplaceView === 'my-orders') {
        setToolbarVisible(false);
        setMarketplaceTitle('Mis pedidos');
        body.innerHTML = renderClientOrdersHtml();
    }

    updateCartBar();
}

function catIcon(id) {
    return STORE_CATEGORIES.find((c) => c.id === id)?.icon || 'fa-store';
}
function catLabel(id) {
    return STORE_CATEGORIES.find((c) => c.id === id)?.label || 'Negocio';
}

function storeCardHtml(s) {
    const open = s.isOpen !== false;
    const staff = isStoresStaff();
    const adults = isStoreAdultsOnly(s);
    const appr = storeApprovalStatus(s);
    const apprMeta = STORE_APPROVAL[appr] || STORE_APPROVAL.pending;
    const cover = s.photoUrl
        ? `<div class="store-card-cover-wrap"><img class="store-card-cover" src="${esc(s.photoUrl)}" alt="${esc(s.name || 'Tienda')}" loading="lazy" onerror="this.style.opacity='0'"></div>`
        : `<div class="store-card-cover-wrap"><div class="store-card-cover store-card-cover--icon"><i class="fas ${esc(catIcon(s.category))}"></i></div></div>`;
    const adminDelete = staff
        ? `<button type="button" class="store-admin-delete-btn" data-stores-action="admin-delete-store" data-store-id="${esc(s.id)}" title="Borrar tienda (admin/supervisor)">
                <i class="fas fa-trash-alt pointer-events-none"></i>
                <span class="pointer-events-none">Borrar</span>
           </button>`
        : '';
    return `
        <div class="store-card-wrap ${staff ? 'store-card-wrap--staff' : ''} ${appr !== 'approved' ? 'store-card-wrap--pending' : ''}" role="listitem">
            <button type="button" class="store-card store-card--browse ${open ? '' : 'store-card--closed'}" data-stores-action="open-store" data-store-id="${esc(s.id)}">
                ${cover}
                <div class="store-card-body">
                    <div class="store-card-top">
                        <p class="store-card-name">${esc(s.name || 'Tienda')}${adults ? ' <span class="store-badge-18">+18</span>' : ''}</p>
                        <span class="store-card-status ${open ? 'is-open' : ''}">${open ? 'Abierta' : 'Cerrada'}</span>
                    </div>
                    <p class="store-card-meta">${esc(catLabel(s.category))}${s.cityName ? ` · ${esc(s.cityName)}` : ''}</p>
                    ${s.address ? `<p class="store-card-addr"><i class="fas fa-map-marker-alt"></i> ${esc(s.address)}</p>` : ''}
                    ${s.description ? `<p class="store-card-desc">${esc(s.description)}</p>` : ''}
                    ${staff ? `<p class="text-[10px] font-bold mt-1 order-status order-status--${apprMeta.tone}" style="display:inline-block">${esc(apprMeta.label)}</p>` : ''}
                    ${staff && s.ownerId ? `<p class="store-card-owner-id text-[10px] text-slate-400 font-semibold mt-1">Dueño: ${esc(String(s.ownerId).slice(0, 10))}…</p>` : ''}
                </div>
            </button>
            ${adminDelete}
        </div>
    `;
}

function productPhotoHtml(p, cls = 'product-card-photo') {
    if (p.photoUrl) {
        return `<img class="${cls}" src="${esc(p.photoUrl)}" alt="${esc(p.name || 'Producto')}" loading="lazy" onerror="this.classList.add('is-broken');this.src='';this.alt='';">`;
    }
    return `<div class="${cls} ${cls}--placeholder" aria-hidden="true"><i class="fas fa-image"></i></div>`;
}

function productCardHtml(p) {
    const available = p.available !== false;
    const inCart = cart.find((c) => c.productId === p.id);
    const split = calcSplitTariff(productBasePrice(p));
    return `
        <div class="product-card ${available ? '' : 'product-card--off'}">
            ${productPhotoHtml(p)}
            <div class="min-w-0 flex-1">
                <p class="product-card-name">${esc(p.name)}</p>
                ${p.description ? `<p class="product-card-desc">${esc(p.description)}</p>` : ''}
                <p class="product-card-price">${money(split.displayPrice)}</p>
                <p class="text-[9px] text-slate-400 font-semibold leading-snug">Incluye ½ tarifa · + ${money(split.buyerShare)} al pagar</p>
            </div>
            ${available ? `
                <div class="product-qty">
                    ${inCart ? `
                        <button type="button" class="product-qty-btn" data-stores-action="cart-dec" data-product-id="${esc(p.id)}">−</button>
                        <span>${inCart.qty}</span>
                        <button type="button" class="product-qty-btn" data-stores-action="cart-inc" data-product-id="${esc(p.id)}">+</button>
                    ` : `
                        <button type="button" class="stores-add-btn" data-stores-action="cart-add" data-product-id="${esc(p.id)}">Agregar</button>
                    `}
                </div>
            ` : `<span class="text-[10px] font-bold text-slate-400">Agotado</span>`}
        </div>
    `;
}

function renderCartHtml() {
    if (!cart.length) {
        return `<div class="stores-empty"><i class="fas fa-shopping-cart"></i><p>Tu carrito está vacío.</p>
            <button type="button" class="stores-secondary-btn mt-3" data-stores-action="back-list">Ver tiendas</button></div>`;
    }
    const displayTotal = cartItemsDisplayTotal();
    const buyerHalf = cartBuyerTariffTotal();
    const grand = cartItemsTotal();
    const tariffPct = getTarifaDelMomentoSync();
    return `
        <div class="cart-lines">
            ${cart.map((i) => {
                const unit = Number(i.displayPrice ?? i.price) || 0;
                return `
                <div class="cart-line">
                    ${i.photoUrl
                        ? `<img class="cart-line-photo" src="${esc(i.photoUrl)}" alt="" loading="lazy">`
                        : `<div class="cart-line-photo cart-line-photo--placeholder"><i class="fas fa-image"></i></div>`}
                    <div class="min-w-0 flex-1">
                        <p class="font-bold text-sm text-slate-900">${esc(i.name)}</p>
                        <p class="text-xs text-slate-500">${money(unit)} c/u <span class="text-slate-400">(con ½ tarifa)</span></p>
                    </div>
                    <div class="product-qty">
                        <button type="button" class="product-qty-btn" data-stores-action="cart-dec" data-product-id="${esc(i.productId)}">−</button>
                        <span>${i.qty}</span>
                        <button type="button" class="product-qty-btn" data-stores-action="cart-inc" data-product-id="${esc(i.productId)}">+</button>
                    </div>
                    <p class="cart-line-total">${money(unit * i.qty)}</p>
                </div>`;
            }).join('')}
        </div>
        <div class="cart-summary space-y-1">
            <div class="flex justify-between text-sm font-bold"><span>Productos (precio mostrado)</span><span>${money(displayTotal)}</span></div>
            <div class="flex justify-between text-xs font-bold text-amber-800">
                <span>Tu mitad de tarifa (${esc(String(tariffPct))}%)</span>
                <span>${money(buyerHalf)}</span>
            </div>
            <div class="flex justify-between text-sm font-black text-slate-900 border-t border-slate-100 pt-1.5 mt-1">
                <span>Total productos</span><span>${money(grand)}</span>
            </div>
            <p class="text-[11px] text-slate-500 mt-1">El envío (moto o Taxi VIP) se calcula cuando el negocio marca el pedido listo y se paga al conductor.</p>
        </div>
        <button type="button" class="stores-primary-btn w-full mt-4" data-stores-action="to-checkout">Continuar al envío</button>
    `;
}

function getClientBalance() {
    const profile = getUserProfile() || {};
    return Math.round((parseFloat(profile.balance) || 0) * 100) / 100;
}

function paymentMethodLabel(method) {
    if (method === 'saldo') return 'Puntos / saldo app';
    if (method === 'efectivo') return 'Efectivo';
    return method || 'Efectivo';
}

/** Modal: efectivo o puntos (igual que viajes). */
function chooseStorePaymentMethod(itemsTotal) {
    return new Promise((resolve) => {
        const bal = getClientBalance();
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/70 z-[50050] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
                <h3 class="font-black text-lg mb-1 text-center text-slate-900">¿Cómo pagas el pedido?</h3>
                <p class="text-center text-xs text-slate-500 font-semibold mb-1">Productos: <b class="text-amber-700">${money(itemsTotal)}</b></p>
                <p class="text-center text-[11px] text-purple-700 font-bold mb-4">
                    <i class="fas fa-wallet"></i> Tu saldo: L. ${bal.toFixed(2)}
                </p>
                <div class="space-y-3">
                    <button type="button" data-pay="efectivo"
                        class="w-full flex items-center gap-3 py-4 px-3 rounded-2xl border-2 border-gray-200 hover:border-emerald-500 active:bg-emerald-50 text-left">
                        <i class="fas fa-money-bill-wave text-2xl text-emerald-600"></i>
                        <span>
                            <strong class="block text-sm text-slate-900">Efectivo</strong>
                            <small class="text-xs text-slate-500">Pagas productos + envío al recibir</small>
                        </span>
                    </button>
                    <button type="button" data-pay="saldo"
                        class="w-full flex items-center gap-3 py-4 px-3 rounded-2xl border-2 border-gray-200 hover:border-purple-500 active:bg-purple-50 text-left ${bal < itemsTotal ? 'opacity-60' : ''}">
                        <i class="fas fa-wallet text-2xl text-purple-600"></i>
                        <span>
                            <strong class="block text-sm text-slate-900">Mis puntos / saldo</strong>
                            <small class="text-xs text-slate-500">
                                ${bal >= itemsTotal
                                    ? `Se descuentan ${money(itemsTotal)} de tu saldo`
                                    : `Saldo insuficiente (necesitas ${money(itemsTotal)})`}
                            </small>
                        </span>
                    </button>
                </div>
                <p class="text-[10px] text-slate-400 text-center mt-3 leading-snug">
                    El envío en moto/Taxi VIP se paga aparte (efectivo al conductor).
                </p>
                <button type="button" data-pay="cancel" class="w-full mt-3 py-3 text-slate-500 text-sm font-bold">Cancelar</button>
            </div>
        `;
        const finish = (v) => {
            modal.remove();
            resolve(v);
        };
        modal.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pay]');
            if (!btn) return;
            const v = btn.getAttribute('data-pay');
            if (v === 'cancel') return finish(null);
            if (v === 'saldo' && bal < itemsTotal) {
                toast('Saldo insuficiente. Recarga puntos o paga en efectivo.', 'warning');
                try { window.showRechargeModal?.(); } catch (_) {}
                return;
            }
            finish(v);
        });
        document.body.appendChild(modal);
    });
}

async function deductClientSaldo(clientId, amount) {
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (!clientId || amt <= 0) return 0;
    const clientRef = publicDoc('users', clientId);
    const newBal = await runTransaction(dbRef, async (tx) => {
        const snap = await tx.get(clientRef);
        const bal = snap.exists() ? (parseFloat(snap.data().balance) || 0) : 0;
        if (bal < amt) throw new Error('Saldo insuficiente');
        const next = Math.round((bal - amt) * 100) / 100;
        tx.update(clientRef, { balance: next });
        return next;
    });
    try {
        await updateDoc(doc(dbRef, 'artifacts', appIdRef, 'users', clientId, 'profile', 'data'), { balance: newBal });
    } catch (_) {}
    try {
        const profile = getUserProfile();
        if (profile && getCurrentUser()?.uid === clientId) {
            profile.balance = newBal;
            window.userProfile = profile;
            window.refreshPassengerBalanceUI?.();
        }
    } catch (_) {}
    return newBal;
}

async function refundClientSaldo(clientId, amount) {
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (!clientId || amt <= 0) return 0;
    const clientRef = publicDoc('users', clientId);
    const newBal = await runTransaction(dbRef, async (tx) => {
        const snap = await tx.get(clientRef);
        const bal = snap.exists() ? (parseFloat(snap.data().balance) || 0) : 0;
        const next = Math.round((bal + amt) * 100) / 100;
        if (snap.exists()) tx.update(clientRef, { balance: next });
        else tx.set(clientRef, { balance: next }, { merge: true });
        return next;
    });
    try {
        await updateDoc(doc(dbRef, 'artifacts', appIdRef, 'users', clientId, 'profile', 'data'), { balance: newBal });
    } catch (_) {}
    try {
        const profile = getUserProfile();
        if (profile && getCurrentUser()?.uid === clientId) {
            profile.balance = newBal;
            window.userProfile = profile;
            window.refreshPassengerBalanceUI?.();
        }
    } catch (_) {}
    return newBal;
}

async function refundStoreOrderIfSaldo(order, reason = 'cancel') {
    if (!order || order.paymentMethod !== 'saldo') return false;
    if (order.paymentStatus === 'refunded') return false;
    if (order.paymentStatus !== 'paid' && order.paidAmount == null) return false;
    const amt = Math.round(parseFloat(order.paidAmount ?? order.itemsTotal) * 100) / 100;
    if (amt <= 0 || !order.clientId) return false;
    await refundClientSaldo(order.clientId, amt);
    await updateDoc(publicDoc('store_orders', order.id), {
        paymentStatus: 'refunded',
        refundedAt: serverTimestamp(),
        refundReason: reason,
        updatedAt: serverTimestamp(),
    });
    return true;
}

function renderCheckoutHtml() {
    const profile = getUserProfile() || {};
    const bal = getClientBalance();
    const displayTotal = cartItemsDisplayTotal();
    const buyerHalf = cartBuyerTariffTotal();
    const total = cartItemsTotal();
    const tariffPct = getTarifaDelMomentoSync();
    const dest = document.getElementById('destination-autocomplete');
    const destVal = dest?.value || dest?.getAttribute?.('value') || '';
    return `
        <div class="checkout-box space-y-3">
            <p class="stores-section-label">Entrega</p>
            <div class="checkout-store-pill">
                <i class="fas fa-store"></i>
                <span>${esc(viewingStore?.name || 'Tienda')}</span>
            </div>
            <div class="cart-summary space-y-1">
                <div class="flex justify-between text-sm font-bold"><span>Productos (con ½ tarifa)</span><span>${money(displayTotal)}</span></div>
                <div class="flex justify-between text-xs font-bold text-amber-800">
                    <span>Tu mitad de tarifa (${esc(String(tariffPct))}%)</span>
                    <span>${money(buyerHalf)}</span>
                </div>
                <div class="flex justify-between text-sm font-black"><span>Total a pagar (productos)</span><span>${money(total)}</span></div>
                <div class="flex justify-between text-xs font-bold text-purple-700 mt-1.5">
                    <span><i class="fas fa-wallet"></i> Tu saldo</span>
                    <span>L. ${bal.toFixed(2)}</span>
                </div>
                <p class="text-[10px] text-slate-500 mt-1.5 leading-snug">
                    Puedes pagar productos + tu mitad de tarifa con <b>puntos/saldo</b> o en <b>efectivo</b>. El envío se paga al conductor.
                </p>
            </div>
            <label class="stores-field">
                <span>Dirección de entrega *</span>
                <input id="store-checkout-address" type="text" placeholder="Colonia, referencia, casa..."
                       value="${esc(destVal)}" class="stores-input">
            </label>
            <label class="stores-field">
                <span>Quién recibe *</span>
                <input id="store-checkout-recipient" type="text" placeholder="Nombre"
                       value="${esc(profile.name || '')}" class="stores-input">
            </label>
            <label class="stores-field">
                <span>WhatsApp de quien recibe *</span>
                <input id="store-checkout-phone" type="tel" placeholder="+504..."
                       value="${esc(profile.phone || '')}" class="stores-input">
            </label>
            <label class="stores-field">
                <span>Notas del pedido (opcional)</span>
                <textarea id="store-checkout-notes" rows="2" placeholder="Sin cebolla, tocar timbre..." class="stores-input"></textarea>
            </label>
            <button type="button" class="stores-primary-btn w-full" data-stores-action="place-order">
                Elegir pago y enviar pedido
            </button>
        </div>
    `;
}

function renderClientOrdersHtml() {
    if (!clientOrders.length) {
        return `<div class="stores-empty"><i class="fas fa-receipt"></i><p>No tienes pedidos aún.</p></div>`;
    }
    return `<div class="orders-list">${clientOrders.map(orderCardHtml).join('')}</div>`;
}

function orderCardHtml(o, { merchant = false } = {}) {
    const st = ORDER_STATUS[o.status] || ORDER_STATUS.pending;
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsLine = items.map((i) => `${i.qty}× ${i.name}`).join(', ');
    const actions = merchant ? merchantOrderActionsHtml(o) : clientOrderActionsHtml(o);
    return `
        <div class="order-card" data-order-id="${esc(o.id)}">
            <div class="order-card-top">
                <div>
                    <p class="order-card-title">${esc(merchant ? (o.clientName || 'Cliente') : (o.storeName || 'Tienda'))}</p>
                    <p class="order-card-sub">${esc(itemsLine || 'Pedido')}</p>
                </div>
                <span class="order-status order-status--${st.tone}">${esc(st.label)}</span>
            </div>
            <div class="order-card-meta">
                <span>${money(o.itemsTotal)}</span>
                <span class="order-pay-badge order-pay-badge--${o.paymentMethod === 'saldo' ? 'saldo' : 'cash'}">
                    <i class="fas ${o.paymentMethod === 'saldo' ? 'fa-wallet' : 'fa-money-bill-wave'}"></i>
                    ${esc(paymentMethodLabel(o.paymentMethod))}
                    ${o.paymentStatus === 'paid' ? ' · pagado' : ''}
                    ${o.paymentStatus === 'refunded' ? ' · reembolsado' : ''}
                </span>
                ${o.deliveryAddress ? `<span><i class="fas fa-map-marker-alt"></i> ${esc(o.deliveryAddress)}</span>` : ''}
            </div>
            ${o.platformFeeBuyer != null || o.platformFeeMerchant != null ? `
                <p class="text-[10px] text-slate-500 font-semibold mt-1 leading-snug">
                    Base ${money(o.itemsBaseTotal ?? 0)}
                    · ½ tarifa negocio ${money(o.platformFeeMerchant ?? 0)}
                    · ½ tarifa comprador ${money(o.platformFeeBuyer ?? 0)}
                    ${o.commissionPercent != null ? `· tarifa ${esc(String(o.commissionPercent))}%` : ''}
                </p>
            ` : ''}
            ${o.notes ? `<p class="order-notes">${esc(o.notes)}</p>` : ''}
            ${actions}
        </div>
    `;
}

function clientOrderActionsHtml(o) {
    if (o.status === 'pending' || o.status === 'accepted') {
        return `<button type="button" class="stores-danger-btn mt-2" data-stores-action="cancel-order" data-order-id="${esc(o.id)}">Cancelar pedido</button>`;
    }
    if (o.tripId) {
        return `<p class="text-[11px] text-blue-700 font-bold mt-2"><i class="fas fa-motorcycle"></i> Envío activo · sigue el viaje en el mapa</p>`;
    }
    return '';
}

function merchantOrderActionsHtml(o) {
    const id = esc(o.id);
    if (o.status === 'pending') {
        return `<div class="order-actions">
            <button type="button" class="stores-primary-btn" data-merchant-action="accept-order" data-order-id="${id}">Aceptar</button>
            <button type="button" class="stores-danger-btn" data-merchant-action="reject-order" data-order-id="${id}">Rechazar</button>
        </div>`;
    }
    if (o.status === 'accepted') {
        return `<div class="order-actions">
            <button type="button" class="stores-primary-btn" data-merchant-action="preparing-order" data-order-id="${id}">Marcar preparando</button>
        </div>`;
    }
    if (o.status === 'preparing') {
        return `<div class="order-actions">
            <button type="button" class="stores-primary-btn" data-merchant-action="ready-order" data-order-id="${id}">
                <i class="fas fa-shipping-fast"></i> Listo · pedir moto o Taxi VIP
            </button>
        </div>`;
    }
    if (o.status === 'ready' || o.status === 'out_for_delivery') {
        return `<p class="text-[11px] text-emerald-700 font-bold mt-2"><i class="fas fa-check"></i> ${o.tripId ? 'Moto solicitada' : 'Listo para recolectar'}</p>
            ${o.status !== 'delivered' ? `<button type="button" class="stores-secondary-btn mt-2" data-merchant-action="delivered-order" data-order-id="${id}">Marcar entregado</button>` : ''}`;
    }
    return '';
}

async function openStore(storeId) {
    const store = storesCache.get(storeId) || (await getDoc(publicDoc('stores', storeId)).then((d) => d.exists() ? { id: d.id, ...d.data() } : null));
    if (!store) return toast('Tienda no encontrada', 'error');

    const uid = getCurrentUser()?.uid;
    const isOwner = uid && store.ownerId === uid;
    const staff = isStoresStaff();
    const appr = storeApprovalStatus(store);

    if (!staff && !isOwner && appr !== 'approved') {
        return toast('Esta tienda aún no está verificada por un supervisor', 'warning');
    }
    if (!staff && !isOwner && store.active === false) {
        return toast('Esta tienda no está disponible', 'warning');
    }

    // +18: solo mayores de edad (staff y dueño pueden ver para gestionar)
    if (isStoreAdultsOnly(store) && !staff && !isOwner) {
        if (!getCurrentUser()) {
            return toast('Inicia sesión para ver tiendas +18', 'warning');
        }
        if (!userIsAdult18()) {
            const age = getUserAgeYears();
            return toast(
                age == null
                    ? 'Esta tienda es solo para mayores de 18. Completa tu fecha de nacimiento en el perfil.'
                    : 'Esta tienda es solo para mayores de 18 años.',
                'warning'
            );
        }
    }

    await getTarifaDelMomento().catch(() => {});
    viewingStore = store;
    viewingProducts = await loadProducts(storeId);
    // If cart is from another store, clear
    if (cart.length && cart[0]?.storeId && cart[0].storeId !== storeId) {
        cart = [];
    }
    marketplaceView = 'store';
    renderMarketplace();
}

function addToCart(productId) {
    const p = viewingProducts.find((x) => x.id === productId);
    if (!p || p.available === false) return;
    if (viewingStore?.isOpen === false) return toast('La tienda está cerrada', 'warning');
    if (!isStoreApprovedForPublic(viewingStore) && !isStoresStaff()) {
        return toast('Esta tienda aún no está verificada', 'warning');
    }
    const split = calcSplitTariff(productBasePrice(p));
    const existing = cart.find((c) => c.productId === productId);
    if (existing) existing.qty += 1;
    else {
        cart.push({
            productId: p.id,
            storeId: viewingStore.id,
            name: p.name,
            basePrice: split.basePrice,
            price: split.displayPrice,
            displayPrice: split.displayPrice,
            merchantShare: split.merchantShare,
            buyerShare: split.buyerShare,
            qty: 1,
            photoUrl: p.photoUrl || null,
        });
    }
    renderMarketplace();
}

function incCart(productId) {
    const line = cart.find((c) => c.productId === productId);
    if (line) line.qty += 1;
    else addToCart(productId);
    renderMarketplace();
}

function decCart(productId) {
    const idx = cart.findIndex((c) => c.productId === productId);
    if (idx < 0) return;
    cart[idx].qty -= 1;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    renderMarketplace();
}

async function placeOrder() {
    const user = getCurrentUser();
    const profile = getUserProfile() || {};
    if (!user) return toast('Inicia sesión para pedir', 'error');
    if (!viewingStore || !cart.length) return toast('Carrito vacío', 'warning');
    if (viewingStore.isOpen === false) return toast('La tienda está cerrada', 'warning');

    const address = document.getElementById('store-checkout-address')?.value.trim() || '';
    const recipientName = document.getElementById('store-checkout-recipient')?.value.trim() || '';
    const recipientPhone = phoneNorm(document.getElementById('store-checkout-phone')?.value || '');
    const notes = document.getElementById('store-checkout-notes')?.value.trim() || '';

    if (!address || address.length < 5) return toast('Indica la dirección de entrega', 'warning');
    if (!recipientName) return toast('Indica quién recibe', 'warning');
    if (!recipientPhone) return toast('Indica el WhatsApp de quien recibe', 'warning');

    const city = activeCity();
    let deliveryLat = null;
    let deliveryLng = null;
    try {
        const destEp = window.destinationEndpoint || window.currentDestinationEndpoint;
        if (destEp?.lat && destEp?.lng) {
            deliveryLat = destEp.lat;
            deliveryLng = destEp.lng;
        }
    } catch (_) {}

    if (!isStoreApprovedForPublic(viewingStore) && !isStoresStaff()) {
        return toast('Esta tienda aún no está verificada por un supervisor', 'warning');
    }
    if (isStoreAdultsOnly(viewingStore) && !userIsAdult18() && !isStoresStaff()) {
        return toast('Esta tienda es solo para mayores de 18 años', 'warning');
    }

    const tariffPct = await getTarifaDelMomento();
    // Recalcular splits con la tarifa del momento al confirmar
    const items = cart.map((i) => {
        const base = Number(i.basePrice);
        const split = calcSplitTariff(Number.isFinite(base) ? base : (Number(i.price) || 0), tariffPct);
        return {
            productId: i.productId,
            name: i.name,
            basePrice: split.basePrice,
            price: split.displayPrice,
            displayPrice: split.displayPrice,
            merchantShare: split.merchantShare,
            buyerShare: split.buyerShare,
            qty: i.qty,
            photoUrl: i.photoUrl || null,
        };
    });
    const itemsBaseTotal = roundMoney(items.reduce((s, i) => s + i.basePrice * i.qty, 0));
    const itemsDisplayTotal = roundMoney(items.reduce((s, i) => s + i.displayPrice * i.qty, 0));
    const platformFeeMerchant = roundMoney(items.reduce((s, i) => s + i.merchantShare * i.qty, 0));
    const platformFeeBuyer = roundMoney(items.reduce((s, i) => s + i.buyerShare * i.qty, 0));
    const platformFeeTotal = roundMoney(platformFeeMerchant + platformFeeBuyer);
    // Lo que paga el cliente por productos (precio mostrado + su mitad de tarifa)
    const itemsTotal = roundMoney(itemsDisplayTotal + platformFeeBuyer);
    if (itemsTotal <= 0) return toast('Total inválido', 'warning');

    // Elegir pago: efectivo o puntos/saldo (como viajes)
    const paymentMethod = await chooseStorePaymentMethod(itemsTotal);
    if (!paymentMethod) return;

    let paidAmount = null;
    let paymentStatus = paymentMethod === 'saldo' ? 'pending_charge' : 'unpaid';

    try {
        if (paymentMethod === 'saldo') {
            // Releer saldo fresco si hay API
            try { await window.refreshPassengerBalanceFromServer?.(); } catch (_) {}
            const bal = getClientBalance();
            if (bal < itemsTotal) {
                toast('Saldo insuficiente. Recarga puntos o elige efectivo.', 'warning');
                try { window.showRechargeModal?.(); } catch (_) {}
                return;
            }
            toast('Cobrando con puntos…', 'info');
            await deductClientSaldo(user.uid, itemsTotal);
            paidAmount = itemsTotal;
            paymentStatus = 'paid';
        }

        const payload = {
            storeId: viewingStore.id,
            storeName: viewingStore.name || 'Tienda',
            ownerId: viewingStore.ownerId,
            clientId: user.uid,
            clientName: profile.name || 'Cliente',
            clientPhone: phoneNorm(profile.phone || recipientPhone),
            items,
            itemsBaseTotal,
            itemsDisplayTotal,
            itemsTotal,
            platformFeeMerchant,
            platformFeeBuyer,
            platformFeeTotal,
            commissionPercent: tariffPct,
            tariffSplit: true,
            status: 'pending',
            deliveryAddress: address,
            deliveryLat,
            deliveryLng,
            recipientName,
            recipientPhone,
            notes,
            paymentMethod,
            paymentStatus,
            paidAmount: paidAmount,
            paidAt: paymentMethod === 'saldo' ? serverTimestamp() : null,
            cityId: city.cityId,
            cityName: city.cityName,
            storeAddress: viewingStore.address || '',
            storeLat: viewingStore.lat ?? null,
            storeLng: viewingStore.lng ?? null,
            storePhone: viewingStore.phone || '',
            tripId: null,
            deliveryFee: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        await addDoc(publicCol('store_orders'), payload);
        cart = [];
        marketplaceView = 'my-orders';
        startClientOrdersListener();
        renderMarketplace();
        if (paymentMethod === 'saldo') {
            toast(`¡Pedido enviado! Se descontaron ${money(itemsTotal)} de tus puntos.`, 'success');
        } else {
            toast('¡Pedido enviado! Pagarás en efectivo al recibir.', 'success');
        }
    } catch (e) {
        console.error(e);
        // Si se cobró saldo y falló crear el pedido, reembolsar
        if (paymentMethod === 'saldo' && paymentStatus === 'paid' && paidAmount) {
            try {
                await refundClientSaldo(user.uid, paidAmount);
                toast('No se creó el pedido; se devolvió tu saldo.', 'warning');
            } catch (re) {
                toast('Error al crear pedido y reembolsar. Contacta soporte.', 'error');
            }
            return;
        }
        toast('No se pudo crear el pedido: ' + (e.message || e), 'error');
    }
}

async function cancelClientOrder(orderId) {
    const order = clientOrders.find((o) => o.id === orderId)
        || merchantOrders.find((o) => o.id === orderId);
    if (!order) return;
    if (!['pending', 'accepted', 'preparing'].includes(order.status)) {
        return toast('Ya no se puede cancelar este pedido', 'warning');
    }
    try {
        await updateDoc(publicDoc('store_orders', orderId), {
            status: 'cancelled',
            cancelledBy: 'client',
            updatedAt: serverTimestamp(),
        });
        // Reembolso de puntos: Cloud Function (evita doble reembolso y sirve si cancela el negocio)
        if (order.paymentMethod === 'saldo' && order.paymentStatus === 'paid') {
            // Intento local (cliente puede tocar su propio saldo); la CF es respaldo idempotente
            try {
                await refundStoreOrderIfSaldo({ ...order, id: orderId }, 'client_cancel');
                toast('Pedido cancelado · puntos reembolsados', 'info');
            } catch (_) {
                toast('Pedido cancelado · reembolso de puntos en proceso', 'info');
            }
        } else {
            toast('Pedido cancelado', 'info');
        }
    } catch (e) {
        toast('No se pudo cancelar', 'error');
    }
}

function onMarketplaceClick(e) {
    const t = e.target.closest('[data-stores-action]');
    if (!t) return;
    const action = t.getAttribute('data-stores-action');
    const storeId = t.getAttribute('data-store-id');
    const productId = t.getAttribute('data-product-id');
    const orderId = t.getAttribute('data-order-id');

    if (action === 'close') {
        // Desde el listado: salir del mundo. Desde detalle/carrito: volver atrás.
        if (marketplaceView === 'list') return closeMarketplace();
        if (marketplaceView === 'checkout') marketplaceView = 'cart';
        else if (marketplaceView === 'cart') marketplaceView = viewingStore ? 'store' : 'list';
        else if (marketplaceView === 'store' || marketplaceView === 'my-orders') marketplaceView = 'list';
        else return closeMarketplace();
        return renderMarketplace();
    }
    if (action === 'back') {
        if (marketplaceView === 'checkout') marketplaceView = 'cart';
        else if (marketplaceView === 'cart') marketplaceView = viewingStore ? 'store' : 'list';
        else if (marketplaceView === 'store' || marketplaceView === 'my-orders') marketplaceView = 'list';
        else return closeMarketplace();
        return renderMarketplace();
    }
    if (action === 'back-list') {
        marketplaceView = 'list';
        return renderMarketplace();
    }
    if (action === 'filter-cat') {
        storesCategoryFilter = t.getAttribute('data-cat') || 'all';
        marketplaceView = 'list';
        return renderMarketplace();
    }
    if (action === 'clear-search') {
        storesSearchQuery = '';
        const input = document.getElementById('stores-search-input');
        if (input) input.value = '';
        document.getElementById('stores-search-clear')?.classList.add('hidden');
        return renderMarketplace();
    }
    if (action === 'clear-filters') {
        storesSearchQuery = '';
        storesCategoryFilter = 'all';
        const input = document.getElementById('stores-search-input');
        if (input) input.value = '';
        document.getElementById('stores-search-clear')?.classList.add('hidden');
        return renderMarketplace();
    }
    if (action === 'open-store' && storeId) return openStore(storeId);
    if (action === 'cart-add' && productId) return addToCart(productId);
    if (action === 'cart-inc' && productId) return incCart(productId);
    if (action === 'cart-dec' && productId) return decCart(productId);
    if (action === 'open-cart') {
        marketplaceView = 'cart';
        return renderMarketplace();
    }
    if (action === 'to-checkout') {
        if (!cart.length) return toast('Carrito vacío', 'warning');
        marketplaceView = 'checkout';
        return renderMarketplace();
    }
    if (action === 'place-order') return placeOrder();
    if (action === 'my-orders') {
        marketplaceView = 'my-orders';
        startClientOrdersListener();
        return renderMarketplace();
    }
    if (action === 'cancel-order' && orderId) return cancelClientOrder(orderId);
    if (action === 'open-merchant') {
        closeMarketplace();
        return openMerchantPanel({ createNew: false });
    }
    if (action === 'create-store') {
        // Si no hay sesión (link o sesión expirada), forzar registro/login
        if (!getCurrentUser()?.uid) {
            return handleCreateBusinessInvite({ fromAuth: false });
        }
        closeMarketplace();
        return openMerchantPanel({ createNew: true });
    }
    if (action === 'admin-delete-store' && storeId) {
        e.preventDefault?.();
        e.stopPropagation?.();
        return adminDeleteStore(storeId);
    }
    if (action === 'staff-invite-business') {
        e.preventDefault?.();
        e.stopPropagation?.();
        return showStaffInviteBusinessModal();
    }
    if (action === 'staff-review-stores') {
        e.preventDefault?.();
        e.stopPropagation?.();
        return loadSupervisorStores();
    }
    if (action === 'staff-approve-store' && storeId) {
        e.preventDefault?.();
        e.stopPropagation?.();
        return staffSetStoreApproval(storeId, 'approved');
    }
    if (action === 'staff-reject-store' && storeId) {
        e.preventDefault?.();
        e.stopPropagation?.();
        return staffSetStoreApproval(storeId, 'rejected');
    }
    if (action === 'staff-toggle-18' && storeId) {
        e.preventDefault?.();
        e.stopPropagation?.();
        return staffToggleAdultsOnly(storeId);
    }
}

/* ===================== MERCHANT PANEL ===================== */

/**
 * @param {{ createNew?: boolean }} [opts]
 * createNew: true → formulario vacío para registrar otra tienda
 * createNew: false → administrar la tienda existente (pedidos / menú)
 */
export async function openMerchantPanel(opts = {}) {
    let createNew = opts.createNew === true;
    // Al abrir crear nueva, no arrastrar logo pendiente de otra sesión de formulario
    if (createNew) {
        pendingStorePhoto = null;
        pendingStorePhotoPreview = null;
    }

    bindUiHooks();
    startStoresListener();
    await loadMyStore();

    // Límite: 1 tienda por usuario
    if (createNew && myStore?.id) {
        toast('Solo puedes tener 1 tienda por cuenta. Abriendo la tuya.', 'info');
        createNew = false;
    }

    merchantCreateMode = createNew;

    if (createNew) {
        // Formulario de alta: no precargar datos (solo si no tiene tienda)
        merchantTab = 'store';
        myProducts = [];
    } else {
        if (!myStore) {
            toast('Aún no tienes tienda. Completa el formulario para crear la única de tu cuenta.', 'info');
            merchantCreateMode = true;
            merchantTab = 'store';
            myProducts = [];
        } else {
            merchantTab = 'orders';
            myProducts = await loadProducts(myStore.id);
        }
    }

    startMerchantOrdersListener();
    enterStoresWorld();
    // Merchant encima del marketplace
    document.getElementById('merchant-panel')?.classList.remove('hidden');
    document.getElementById('stores-marketplace-panel')?.classList.add('hidden');

    // Título del panel según modo
    const titleEl = document.querySelector('#merchant-panel .stores-title');
    if (titleEl) {
        titleEl.textContent = merchantCreateMode ? 'Crear tienda nueva' : 'Mi tienda virtual';
    }

    document.querySelectorAll('.merchant-tab').forEach((b) => {
        const tab = b.getAttribute('data-merchant-tab');
        b.classList.toggle('active', tab === merchantTab);
        // En modo crear: solo pestaña Tienda tiene sentido hasta guardar
        if (merchantCreateMode) {
            b.classList.toggle('hidden', tab !== 'store');
        } else {
            b.classList.remove('hidden');
        }
    });
    updateMerchantOpenToggle();
    renderMerchantBody();
}

export function openCreateStorePanel() {
    // Si ya tiene tienda, openMerchantPanel redirige a la existente
    return openMerchantPanel({ createNew: true });
}

export function openMyStorePanel() {
    return openMerchantPanel({ createNew: false });
}

export function closeMerchantPanel() {
    document.getElementById('merchant-panel')?.classList.add('hidden');
    // Si venía del marketplace, reabrir el mundo de tiendas
    const mode = window.getPassengerHomeMode?.();
    if (mode === 'stores') {
        openMarketplace();
        return;
    }
    exitStoresWorldIfIdle();
}

function updateMerchantOpenToggle() {
    const label = document.getElementById('merchant-open-label');
    const btn = document.getElementById('merchant-open-toggle');
    if (!label || !btn) return;
    if (!myStore) {
        label.textContent = 'Sin tienda';
        btn.classList.remove('is-open');
        return;
    }
    const open = myStore.isOpen !== false;
    label.textContent = open ? 'Abierta' : 'Cerrada';
    btn.classList.toggle('is-open', open);
}

function renderMerchantBody() {
    const body = document.getElementById('merchant-panel-body');
    if (!body) return;

    if (merchantTab === 'store') {
        body.innerHTML = renderMerchantStoreForm();
        return;
    }
    if (!myStore) {
        body.innerHTML = `
            <div class="stores-empty">
                <i class="fas fa-store"></i>
                <p>Primero crea tu tienda virtual.</p>
                <button type="button" class="stores-primary-btn mt-3" data-merchant-action="goto-store">Configurar tienda</button>
            </div>`;
        return;
    }
    if (merchantTab === 'products') {
        body.innerHTML = renderMerchantProducts();
        // Preview en vivo de precio + tarifa
        requestAnimationFrame(() => bindMerchantProductPricePreview());
        return;
    }
    // orders
    const active = merchantOrders.filter((o) => !['delivered', 'cancelled'].includes(o.status));
    const past = merchantOrders.filter((o) => ['delivered', 'cancelled'].includes(o.status));
    const appr = myStore ? storeApprovalStatus(myStore) : null;
    const apprMeta = appr ? (STORE_APPROVAL[appr] || STORE_APPROVAL.pending) : null;
    body.innerHTML = `
        <div class="orders-list">
            ${myStore && appr && appr !== 'approved' ? `
                <div class="rounded-2xl border px-3 py-2.5 mb-2 ${appr === 'rejected' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}">
                    <p class="text-[11px] font-black ${appr === 'rejected' ? 'text-red-900' : 'text-amber-900'}">
                        <i class="fas ${apprMeta.icon}"></i> ${esc(apprMeta.label)}
                    </p>
                    <p class="text-[10px] font-semibold mt-1 ${appr === 'rejected' ? 'text-red-800' : 'text-amber-800'} leading-snug">
                        ${appr === 'rejected'
                            ? 'Los clientes no ven tu tienda. Corrige datos en la pestaña Tienda y guarda para reenviar a revisión.'
                            : 'Un supervisor debe verificar tu tienda antes de que aparezca en el marketplace. Ya puedes armar el menú.'}
                    </p>
                </div>
            ` : ''}
            ${myStore ? `
                <div class="merchant-share-banner">
                    <div class="min-w-0">
                        <p class="merchant-share-title"><i class="fas fa-bullhorn"></i> Atrae clientes</p>
                        <p class="merchant-share-sub">Comparte tu catálogo por WhatsApp o redes</p>
                    </div>
                    <button type="button" class="stores-primary-btn stores-primary-btn--sm" data-merchant-action="share-catalog">
                        <i class="fas fa-share-alt"></i> Compartir
                    </button>
                </div>
            ` : ''}
            <p class="stores-section-label">Pedidos activos (${active.length})</p>
            ${active.length ? active.map((o) => orderCardHtml(o, { merchant: true })).join('') : `
                <div class="stores-empty stores-empty--sm"><p>Sin pedidos nuevos.</p></div>
            `}
            ${past.length ? `
                <p class="stores-section-label mt-4">Historial</p>
                ${past.slice(0, 10).map((o) => orderCardHtml(o, { merchant: true })).join('')}
            ` : ''}
        </div>
    `;
}

function renderMerchantStoreForm() {
    // En modo "crear nueva" el formulario va vacío aunque ya exista otra tienda
    const editingExisting = !merchantCreateMode && myStore;
    const s = editingExisting ? myStore : {};
    const city = activeCity();
    const cats = STORE_CATEGORIES.map((c) =>
        `<option value="${c.id}" ${s.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`
    ).join('');
    const logoPreview = pendingStorePhotoPreview
        || (editingExisting && s.photoUrl ? s.photoUrl : null);
    const logoHtml = logoPreview
        ? `<img src="${esc(logoPreview)}" alt="Logo de la tienda" class="m-store-logo-preview">`
        : `<div class="m-store-logo-preview m-store-logo-preview--empty"><i class="fas fa-store"></i><span>Logo o foto del negocio</span></div>`;
    return `
        <form id="merchant-store-form" class="merchant-form space-y-3" onsubmit="return false;">
            <div class="stores-banner">
                <p class="stores-banner-title">
                    <i class="fas ${editingExisting ? 'fa-store' : 'fa-plus-circle'}"></i>
                    ${editingExisting ? 'Datos de mi tienda' : 'Registrar tienda nueva'}
                </p>
                <p class="stores-banner-sub">
                    ${editingExisting
                        ? 'Edita logo, nombre, dirección y contacto de tu negocio.'
                        : 'Completa los datos y sube el logo. Las entregas las hacen moto o Taxi VIP.'}
                </p>
            </div>
            ${editingExisting ? `
                <p class="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                    <i class="fas fa-info-circle"></i> Solo se permite <b>1 tienda por cuenta</b>. Aquí editas la tuya.
                </p>
            ` : `
                <p class="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    <i class="fas fa-info-circle"></i> Cada usuario puede crear <b>solo 1 tienda</b> en HonduRaite.
                </p>
            `}
            <div class="stores-field">
                <span>Logo / imagen de la tienda</span>
                <button type="button" class="m-store-logo-pick" data-merchant-action="pick-store-logo" aria-label="Elegir logo de la tienda">
                    ${logoHtml}
                    <span class="m-prod-photo-hint">
                        <i class="fas fa-camera"></i>
                        ${logoPreview ? 'Cambiar logo o foto' : 'Agregar logo o foto (recomendado)'}
                    </span>
                </button>
                <input type="file" id="m-store-logo-input" accept="image/*" class="hidden">
                <p class="text-[10px] text-slate-500 mt-1">Se muestra en el catálogo y en la portada de tu tienda.</p>
            </div>
            <label class="stores-field"><span>Nombre de la tienda *</span>
                <input id="m-store-name" class="stores-input" required value="${esc(s.name || '')}" placeholder="Ej: Pupusas Doña Mary"></label>
            <label class="stores-field"><span>Categoría</span>
                <select id="m-store-category" class="stores-input">${cats}</select></label>
            <label class="stores-field"><span>Descripción</span>
                <textarea id="m-store-desc" class="stores-input" rows="2" placeholder="Qué vendes...">${esc(s.description || '')}</textarea></label>
            <label class="stores-field"><span>Dirección / punto de recogida *</span>
                <input id="m-store-address" class="stores-input" required value="${esc(s.address || '')}" placeholder="Colonia, calle, referencia"></label>
            <label class="stores-field"><span>WhatsApp del negocio *</span>
                <input id="m-store-phone" class="stores-input" required value="${esc(s.phone || (!editingExisting ? (getUserProfile()?.phone || '') : ''))}" placeholder="+504..."></label>
            <label class="stores-field stores-field--check" style="flex-direction:row;align-items:flex-start;gap:0.65rem;cursor:pointer;">
                <input type="checkbox" id="m-store-adults-only" ${s.adultsOnly ? 'checked' : ''} style="width:1.1rem;height:1.1rem;margin-top:0.15rem;flex-shrink:0;">
                <span>
                    <strong class="block text-sm text-slate-800">Tienda solo para mayores de 18 (+18)</strong>
                    <small class="text-[10px] text-slate-500 font-semibold leading-snug">Ej. alcohol, tabaco u otros productos restringidos. Un supervisor lo confirma al verificar.</small>
                </span>
            </label>
            ${editingExisting ? (() => {
                const appr = storeApprovalStatus(s);
                const meta = STORE_APPROVAL[appr] || STORE_APPROVAL.pending;
                return `
                <div class="rounded-xl border px-3 py-2.5 ${appr === 'approved' ? 'border-emerald-200 bg-emerald-50' : appr === 'rejected' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}">
                    <p class="text-[11px] font-black ${appr === 'approved' ? 'text-emerald-900' : appr === 'rejected' ? 'text-red-900' : 'text-amber-900'}">
                        <i class="fas ${meta.icon}"></i> Verificación: ${esc(meta.label)}
                    </p>
                    <p class="text-[10px] font-semibold mt-1 ${appr === 'approved' ? 'text-emerald-800' : appr === 'rejected' ? 'text-red-800' : 'text-amber-800'} leading-snug">
                        ${appr === 'approved'
                            ? 'Tu tienda es visible en el marketplace.'
                            : appr === 'rejected'
                                ? (s.rejectionReason ? `Motivo: ${esc(s.rejectionReason)}` : 'Un supervisor la rechazó. Corrige datos y guarda de nuevo para reenviar a revisión.')
                                : 'Un supervisor debe marcar si nos parece bien o mal antes de que los clientes te vean.'}
                    </p>
                </div>`;
            })() : `
                <div class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p class="text-[11px] font-black text-amber-900"><i class="fas fa-hourglass-half"></i> Requiere verificación</p>
                    <p class="text-[10px] font-semibold text-amber-800 mt-1 leading-snug">
                        Al crear, la tienda queda <b>en revisión</b>. Un supervisor la aprueba o rechaza y puede marcarla +18.
                    </p>
                </div>
            `}
            <div class="grid grid-cols-2 gap-2">
                <label class="stores-field"><span>Lat (opcional)</span>
                    <input id="m-store-lat" class="stores-input" type="number" step="any" value="${s.lat != null ? esc(s.lat) : ''}" placeholder="14.45"></label>
                <label class="stores-field"><span>Lng (opcional)</span>
                    <input id="m-store-lng" class="stores-input" type="number" step="any" value="${s.lng != null ? esc(s.lng) : ''}" placeholder="-87.63"></label>
            </div>
            <button type="button" class="stores-secondary-btn w-full" data-merchant-action="use-gps">
                <i class="fas fa-crosshairs"></i> Usar mi GPS como ubicación de la tienda
            </button>
            <p class="text-[11px] text-slate-500">Ciudad de publicación: <b>${esc(s.cityName || city.cityName)}</b></p>
            <button type="button" class="stores-primary-btn w-full" data-merchant-action="save-store">
                ${editingExisting ? 'Guardar cambios' : 'Crear mi tienda'}
            </button>
            ${editingExisting && s.id ? `
                <button type="button" class="stores-danger-btn w-full mt-2" data-merchant-action="delete-my-store" data-store-id="${esc(s.id)}">
                    <i class="fas fa-trash-alt"></i> Eliminar mi tienda
                </button>
                <p class="text-[10px] text-slate-400 text-center mt-1">Borra la tienda y todo su menú. Los pedidos antiguos se conservan en historial.</p>
            ` : ''}
        </form>
    `;
}

function buildStoreCatalogShareText(store, products) {
    const name = store?.name || 'Mi tienda';
    const city = store?.cityName || activeCity().cityName || '';
    const available = (products || []).filter((p) => p.available !== false);
    const lines = available.slice(0, 40).map((p) => {
        const price = Number(p.price);
        const priceTxt = Number.isFinite(price) ? `L. ${price.toFixed(2)}` : '';
        return `• ${p.name}${priceTxt ? ` — ${priceTxt}` : ''}`;
    });
    const more = available.length > 40 ? `\n… y ${available.length - 40} productos más` : '';
    const link = buildStoreShareLink(store?.id);
    return (
        `🛒 *${name}* en HonduRaite${city ? ` (${city})` : ''}\n` +
        `📦 Catálogo de productos:\n\n` +
        (lines.length ? lines.join('\n') : '• Menú disponible en la app') +
        more +
        `\n\n👉 Pide aquí en HonduRaite:\n${link}\n\n` +
        `Entrega en moto o Taxi VIP 🇭🇳`
    );
}

function buildStoreShareLink(storeId) {
    try {
        const u = new URL(window.location.href);
        u.hash = storeId ? `tienda=${encodeURIComponent(storeId)}` : 'tiendas';
        // Quitar query ruidosas si hay
        return u.toString();
    } catch (_) {
        return `${window.location.origin}${window.location.pathname}#tienda=${encodeURIComponent(storeId || '')}`;
    }
}

async function shareStoreCatalog() {
    if (!myStore?.id) {
        toast('Crea tu tienda primero', 'warning');
        return;
    }
    if (!myProducts.length) {
        myProducts = await loadProducts(myStore.id);
    }
    if (!myProducts.length) {
        toast('Agrega productos al menú antes de compartir el catálogo', 'warning');
        return;
    }
    const text = buildStoreCatalogShareText(myStore, myProducts);
    const title = `${myStore.name || 'Mi tienda'} · HonduRaite`;
    const url = buildStoreShareLink(myStore.id);

    try {
        if (navigator.share) {
            await navigator.share({ title, text, url });
            toast('Catálogo compartido', 'success');
            return;
        }
    } catch (e) {
        if (e?.name === 'AbortError') return;
        console.warn('[stores] share', e);
    }

    // Fallback WhatsApp
    try {
        const wa = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
        window.open(wa, '_blank', 'noopener');
        toast('Abriendo WhatsApp para compartir…', 'success');
        return;
    } catch (_) {}

    try {
        await navigator.clipboard.writeText(text);
        toast('Catálogo copiado. Pégalo donde quieras compartirlo.', 'success');
    } catch (_) {
        // Último recurso: prompt
        window.prompt('Copia tu catálogo:', text);
    }
}

function renderMerchantProducts() {
    const preview = pendingProductPhotoPreview
        ? `<img src="${esc(pendingProductPhotoPreview)}" alt="Vista previa" class="m-prod-photo-preview">`
        : `<div class="m-prod-photo-preview m-prod-photo-preview--empty"><i class="fas fa-camera"></i><span>Foto del producto</span></div>`;
    const tariffPct = getTarifaDelMomentoSync();
    const halfPct = roundMoney(tariffPct / 2);
    // Prefetch en vivo
    getTarifaDelMomento().then((p) => {
        const el = document.getElementById('m-prod-tariff-live');
        if (el && Math.abs(p - tariffPct) > 0.001) {
            // Re-render si cambió
            renderMerchantBody();
        } else {
            updateMerchantProductPricePreview();
        }
    }).catch(() => {});
    return `
        <div class="merchant-products">
            <div class="merchant-share-banner">
                <div class="min-w-0">
                    <p class="merchant-share-title"><i class="fas fa-share-alt"></i> Comparte tu catálogo</p>
                    <p class="merchant-share-sub">WhatsApp, redes o copiar texto · atrae más clientes</p>
                </div>
                <button type="button" class="stores-primary-btn stores-primary-btn--sm" data-merchant-action="share-catalog">
                    <i class="fas fa-bullhorn"></i> Compartir
                </button>
            </div>
            <div class="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2.5 mb-3">
                <p class="text-[11px] font-black text-violet-900"><i class="fas fa-percentage"></i> Tarifa del momento: ${esc(String(tariffPct))}%</p>
                <p class="text-[10px] font-semibold text-violet-800 mt-1 leading-snug">
                    Se divide en <b>2 partes iguales (${esc(String(halfPct))}% cada una)</b>:<br>
                    • <b>Tu mitad</b> se suma al precio que ve el cliente (tú pones el precio base).<br>
                    • <b>La mitad del comprador</b> se le cobra al pedir (además del envío).<br>
                    Ejemplo: si pones L. 100, el cliente ve ~${money(calcSplitTariff(100, tariffPct).displayPrice)} y al pagar suma ~${money(calcSplitTariff(100, tariffPct).buyerShare)} más de tarifa.
                </p>
            </div>
            <form id="merchant-product-form" class="merchant-form space-y-2 mb-4 p-3 rounded-2xl border border-amber-100 bg-amber-50/50" onsubmit="return false;">
                <p class="stores-section-label">Agregar producto</p>
                <button type="button" class="m-prod-photo-pick" data-merchant-action="pick-product-photo" aria-label="Elegir foto del producto">
                    ${preview}
                    <span class="m-prod-photo-hint"><i class="fas fa-image"></i> ${pendingProductPhoto ? 'Cambiar foto' : 'Agregar foto (recomendado)'}</span>
                </button>
                <input type="file" id="m-prod-photo-input" accept="image/*" class="hidden">
                <input id="m-prod-name" class="stores-input" placeholder="Nombre *" required>
                <input id="m-prod-price" class="stores-input" type="number" min="1" step="0.01" placeholder="Tu precio base L. *" required inputmode="decimal">
                <div id="m-prod-tariff-live" class="rounded-xl bg-white/80 border border-amber-100 px-2.5 py-2 text-[10px] font-semibold text-slate-600 leading-snug">
                    Escribe tu precio base para ver cuánto verá el cliente.
                </div>
                <input id="m-prod-desc" class="stores-input" placeholder="Descripción (opcional)">
                <button type="button" class="stores-primary-btn w-full" data-merchant-action="add-product">Agregar al menú</button>
            </form>
            <p class="stores-section-label">Tu menú (${myProducts.length})</p>
            <div class="space-y-2">
                ${myProducts.length ? myProducts.map((p) => {
                    const split = calcSplitTariff(productBasePrice(p), tariffPct);
                    return `
                    <div class="product-card">
                        ${productPhotoHtml(p)}
                        <div class="min-w-0 flex-1">
                            <p class="product-card-name">${esc(p.name)}</p>
                            <p class="product-card-price">Tu precio: ${money(split.basePrice)}</p>
                            <p class="text-[10px] font-bold text-violet-700">Cliente ve: ${money(split.displayPrice)} · + ${money(split.buyerShare)} al pagar</p>
                            ${p.description ? `<p class="product-card-desc">${esc(p.description)}</p>` : ''}
                        </div>
                        <div class="flex flex-col gap-1">
                            <button type="button" class="stores-secondary-btn text-[10px] py-1.5" data-merchant-action="change-product-photo" data-product-id="${esc(p.id)}">
                                <i class="fas fa-camera"></i> Foto
                            </button>
                            <button type="button" class="stores-secondary-btn text-[10px] py-1.5" data-merchant-action="toggle-product" data-product-id="${esc(p.id)}">
                                ${p.available === false ? 'Activar' : 'Pausar'}
                            </button>
                            <button type="button" class="stores-danger-btn text-[10px] py-1.5" data-merchant-action="delete-product" data-product-id="${esc(p.id)}">
                                Borrar
                            </button>
                        </div>
                    </div>`;
                }).join('') : `<div class="stores-empty stores-empty--sm"><p>Agrega tu primer producto con foto.</p></div>`}
            </div>
            <input type="file" id="m-prod-photo-edit-input" accept="image/*" class="hidden">
        </div>
    `;
}

function updateMerchantProductPricePreview() {
    const input = document.getElementById('m-prod-price');
    const live = document.getElementById('m-prod-tariff-live');
    if (!live) return;
    const base = Number(input?.value);
    const pct = getTarifaDelMomentoSync();
    if (!Number.isFinite(base) || base <= 0) {
        live.innerHTML = `Escribe tu precio base. Tarifa del momento: <b>${esc(String(pct))}%</b> (dividida a la mitad contigo y el cliente).`;
        return;
    }
    const split = calcSplitTariff(base, pct);
    live.innerHTML = `
        <span class="text-slate-800">Al cliente se le mostrará <b class="text-violet-800">${money(split.displayPrice)}</b>
        (= tu precio ${money(split.basePrice)} + tu mitad de tarifa ${money(split.merchantShare)}).</span><br>
        <span class="text-amber-800">Al comprar se le sumará la otra mitad: <b>${money(split.buyerShare)}</b> (además del envío).</span>
    `;
}

function bindMerchantProductPricePreview() {
    const input = document.getElementById('m-prod-price');
    if (!input || input.dataset.tariffBound === '1') return;
    input.dataset.tariffBound = '1';
    input.addEventListener('input', updateMerchantProductPricePreview);
    updateMerchantProductPricePreview();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
        reader.readAsDataURL(file);
    });
}

/**
 * Comprime imagen para catálogo (max ~960px, jpeg).
 * Android a veces entrega type vacío u octet-stream al elegir de la galería.
 */
async function compressImageFile(file, maxSide = 960, quality = 0.82) {
    if (!file) throw new Error('Sin archivo');
    const type = String(file.type || '').toLowerCase().trim();
    // No bloquear galería Android: type vacío / octet-stream / image/*
    if (type && !type.startsWith('image/') && type !== 'application/octet-stream') {
        throw new Error('Archivo no es imagen');
    }
    const dataUrl = await readFileAsDataUrl(file);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                let { width, height } = img;
                if (!width || !height) {
                    reject(new Error('Imagen inválida'));
                    return;
                }
                const scale = Math.min(1, maxSide / Math.max(width, height));
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => reject(new Error('No se pudo leer la imagen de la galería. Prueba otra foto o JPG/PNG.'));
        img.src = dataUrl;
    });
}

async function uploadProductPhoto(dataUrlOrFile, productId) {
    const user = getCurrentUser();
    if (!user || !storageRef) throw new Error('Storage no disponible');
    const path = `artifacts/${appIdRef}/users/${user.uid}/store_products/${productId || Date.now()}.jpg`;
    return resolvePhotoUrl(storageRef, dataUrlOrFile, path);
}

async function uploadStoreLogo(dataUrlOrFile, storeId) {
    const user = getCurrentUser();
    if (!user || !storageRef) throw new Error('Storage no disponible');
    const path = `artifacts/${appIdRef}/users/${user.uid}/store_logos/${storeId || Date.now()}.jpg`;
    return resolvePhotoUrl(storageRef, dataUrlOrFile, path);
}

/**
 * Emprendedor: cámara O galería (fotos ya en el celular).
 * Antes los inputs tenían capture="environment" y en Android solo abrían la cámara.
 */
function pickStoreLogo() {
    pickPhotoWithSourceChoice({
        facing: 'environment',
        maxSize: 1200,
        title: 'Logo de la tienda',
        cameraLabel: 'Tomar foto',
        galleryLabel: 'Elegir de la galería',
        onCapture: (dataUrl) => {
            if (!dataUrl) return;
            pendingStorePhoto = dataUrl;
            pendingStorePhotoPreview = dataUrl;
            renderMerchantBody();
            toast('Logo listo. Guarda la tienda para publicarlo.', 'success');
        },
        onError: (msg) => toast(msg || 'No se pudo procesar el logo', 'error'),
    });
}

function pickNewProductPhoto() {
    pickPhotoWithSourceChoice({
        facing: 'environment',
        maxSize: 960,
        title: 'Foto del producto',
        cameraLabel: 'Tomar foto',
        galleryLabel: 'Elegir de la galería',
        onCapture: (dataUrl) => {
            if (!dataUrl) return;
            pendingProductPhoto = dataUrl;
            pendingProductPhotoPreview = dataUrl;
            renderMerchantBody();
            toast('Foto lista. Completa nombre y precio.', 'success');
        },
        onError: (msg) => toast(msg || 'No se pudo procesar la foto', 'error'),
    });
}

function pickEditProductPhoto(productId) {
    if (!productId) return;
    pickPhotoWithSourceChoice({
        facing: 'environment',
        maxSize: 960,
        title: 'Cambiar foto del producto',
        cameraLabel: 'Tomar foto',
        galleryLabel: 'Elegir de la galería',
        onCapture: async (dataUrl) => {
            if (!dataUrl || !productId) return;
            try {
                toast('Subiendo foto…', 'info');
                const url = await uploadProductPhoto(dataUrl, productId);
                await updateDoc(publicDoc('store_products', productId), {
                    photoUrl: url,
                    updatedAt: serverTimestamp(),
                });
                myProducts = await loadProducts(myStore.id);
                renderMerchantBody();
                toast('Foto del producto actualizada', 'success');
            } catch (e) {
                console.error(e);
                const msg = String(e?.message || e || '');
                if (/permission|unauthorized|403|storage/i.test(msg)) {
                    toast('Sin permiso para subir la foto. Cierra sesión y vuelve a entrar.', 'error');
                } else {
                    toast('No se pudo subir la foto: ' + msg, 'error');
                }
            }
        },
        onError: (msg) => toast(msg || 'No se pudo procesar la foto', 'error'),
    });
}

async function saveStore() {
    const user = getCurrentUser();
    const profile = getUserProfile() || {};
    if (!user) return toast('Inicia sesión', 'error');

    const name = document.getElementById('m-store-name')?.value.trim() || '';
    const category = document.getElementById('m-store-category')?.value || 'otro';
    const description = document.getElementById('m-store-desc')?.value.trim() || '';
    const address = document.getElementById('m-store-address')?.value.trim() || '';
    const phone = phoneNorm(document.getElementById('m-store-phone')?.value || '');
    const latRaw = document.getElementById('m-store-lat')?.value;
    const lngRaw = document.getElementById('m-store-lng')?.value;
    const lat = latRaw !== '' && latRaw != null ? Number(latRaw) : null;
    const lng = lngRaw !== '' && lngRaw != null ? Number(lngRaw) : null;

    if (!name || name.length < 2) return toast('Nombre de tienda requerido', 'warning');
    if (!address || address.length < 4) return toast('Dirección de recogida requerida', 'warning');
    if (!phone) return toast('WhatsApp del negocio requerido', 'warning');

    const city = activeCity();
    // If no coords, use city center as soft location
    const finalLat = Number.isFinite(lat) ? lat : (city.center?.lat ?? null);
    const finalLng = Number.isFinite(lng) ? lng : (city.center?.lng ?? null);
    const adultsOnly = !!document.getElementById('m-store-adults-only')?.checked;

    // Revalidar: máximo 1 tienda por usuario
    await loadMyStore();
    const isNewStore = merchantCreateMode || !myStore?.id;
    if (isNewStore && myStore?.id) {
        merchantCreateMode = false;
        toast('Ya tienes una tienda. Solo se permite una por cuenta.', 'warning');
        return openMerchantPanel({ createNew: false });
    }

    const prevStatus = !isNewStore ? storeApprovalStatus(myStore) : 'pending';
    // Si estaba rechazada y edita, vuelve a revisión. No puede auto-aprobarse.
    let nextApproval = isNewStore ? 'pending' : prevStatus;
    if (!isNewStore && prevStatus === 'rejected') {
        nextApproval = 'pending';
    }

    const payload = {
        ownerId: user.uid,
        ownerName: profile.name || '',
        name,
        category,
        description,
        address,
        phone,
        lat: finalLat,
        lng: finalLng,
        cityId: (!isNewStore && myStore?.cityId) ? myStore.cityId : city.cityId,
        cityName: (!isNewStore && myStore?.cityName) ? myStore.cityName : city.cityName,
        isOpen: isNewStore ? true : (myStore?.isOpen !== false),
        active: true,
        adultsOnly,
        requiresAge18: adultsOnly,
        // Conservar logo anterior si no hay uno nuevo pendiente
        photoUrl: (!isNewStore && myStore?.photoUrl) ? myStore.photoUrl : null,
        updatedAt: serverTimestamp(),
    };

    // Campos de verificación: el dueño solo puede reenviar a pending tras rechazo
    if (isNewStore) {
        payload.approvalStatus = 'pending';
        payload.submittedForReviewAt = serverTimestamp();
    } else if (prevStatus === 'rejected') {
        payload.approvalStatus = 'pending';
        payload.submittedForReviewAt = serverTimestamp();
        payload.rejectionReason = null;
        payload.reviewedAt = null;
        payload.reviewedBy = null;
    }

    try {
        toast(pendingStorePhoto ? 'Subiendo logo y guardando…' : 'Guardando tienda…', 'info');

        if (!isNewStore && myStore?.id) {
            if (pendingStorePhoto) {
                try {
                    payload.photoUrl = await uploadStoreLogo(pendingStorePhoto, myStore.id);
                } catch (logoErr) {
                    console.warn('[stores] logo upload', logoErr);
                    toast('Tienda se guardará, pero el logo no subió. Intenta de nuevo.', 'warning');
                }
            }
            await updateDoc(publicDoc('stores', myStore.id), payload);
            myStore = { ...myStore, ...payload, approvalStatus: payload.approvalStatus || myStore.approvalStatus };
            storesCache.set(myStore.id, myStore);
            pendingStorePhoto = null;
            pendingStorePhotoPreview = null;
            if (nextApproval === 'pending' && prevStatus === 'rejected') {
                toast('Cambios guardados · tienda reenviada a verificación', 'success');
            } else {
                toast(payload.photoUrl ? 'Tienda y logo actualizados' : 'Tienda actualizada', 'success');
            }
        } else {
            payload.createdAt = serverTimestamp();
            payload.approvalStatus = 'pending';
            const ref = await addDoc(publicCol('stores'), payload);
            let photoUrl = null;
            if (pendingStorePhoto) {
                try {
                    photoUrl = await uploadStoreLogo(pendingStorePhoto, ref.id);
                    await updateDoc(ref, { photoUrl, updatedAt: serverTimestamp() });
                } catch (logoErr) {
                    console.warn('[stores] logo upload on create', logoErr);
                    toast('Tienda creada, pero el logo no subió. Puedes editarlo en Mi tienda.', 'warning');
                }
            }
            myStore = { id: ref.id, ...payload, photoUrl: photoUrl || null, approvalStatus: 'pending' };
            storesCache.set(ref.id, myStore);
            merchantCreateMode = false;
            pendingStorePhoto = null;
            pendingStorePhotoPreview = null;
            toast(
                photoUrl
                    ? '¡Tienda creada! Está en revisión de un supervisor. Mientras, agrega productos.'
                    : '¡Tienda creada! Está en revisión de un supervisor. Mientras, agrega productos.',
                'success'
            );
            merchantTab = 'products';
            document.querySelectorAll('.merchant-tab').forEach((b) => {
                b.classList.remove('hidden');
                b.classList.toggle('active', b.getAttribute('data-merchant-tab') === 'products');
            });
            const titleEl = document.querySelector('#merchant-panel .stores-title');
            if (titleEl) titleEl.textContent = 'Mi tienda virtual';
        }
        updateMerchantOpenToggle();
        renderMerchantBody();
    } catch (e) {
        console.error(e);
        toast('Error al guardar tienda: ' + (e.message || e), 'error');
    }
}

async function useGpsForStore() {
    if (!navigator.geolocation) return toast('GPS no disponible', 'error');
    toast('Obteniendo ubicación…', 'info');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const latEl = document.getElementById('m-store-lat');
            const lngEl = document.getElementById('m-store-lng');
            if (latEl) latEl.value = String(pos.coords.latitude.toFixed(6));
            if (lngEl) lngEl.value = String(pos.coords.longitude.toFixed(6));
            toast('Ubicación GPS cargada', 'success');
        },
        () => toast('No se pudo obtener GPS', 'error'),
        { enableHighAccuracy: true, timeout: 12000 }
    );
}

async function toggleStoreOpen() {
    if (!myStore?.id) return toast('Crea tu tienda primero', 'warning');
    const next = myStore.isOpen === false;
    try {
        await updateDoc(publicDoc('stores', myStore.id), {
            isOpen: next,
            updatedAt: serverTimestamp(),
        });
        myStore.isOpen = next;
        if (storesCache.has(myStore.id)) storesCache.get(myStore.id).isOpen = next;
        updateMerchantOpenToggle();
        toast(next ? 'Tienda abierta' : 'Tienda cerrada', 'success');
    } catch (e) {
        toast('No se pudo cambiar estado', 'error');
    }
}

async function addProduct() {
    if (!myStore?.id) return toast('Crea la tienda primero', 'warning');
    const name = document.getElementById('m-prod-name')?.value.trim() || '';
    const price = Number(document.getElementById('m-prod-price')?.value);
    const description = document.getElementById('m-prod-desc')?.value.trim() || '';
    if (!name) return toast('Nombre del producto requerido', 'warning');
    if (!Number.isFinite(price) || price <= 0) return toast('Precio inválido', 'warning');

    try {
        toast(pendingProductPhoto ? 'Subiendo foto y guardando…' : 'Guardando producto…', 'info');
        const tariffPct = await getTarifaDelMomento();
        const base = roundMoney(price);
        const split = calcSplitTariff(base, tariffPct);
        // Primero creamos el doc para tener id estable de foto
        const ref = await addDoc(publicCol('store_products'), {
            storeId: myStore.id,
            ownerId: getCurrentUser().uid,
            name,
            // price = precio base del emprendedor (lo que él define)
            price: base,
            basePrice: base,
            // referencia de cómo se muestra (se recalcula con tarifa del momento al vender)
            displayPrice: split.displayPrice,
            commissionPercentAtCreate: tariffPct,
            description,
            photoUrl: null,
            available: true,
            sortOrder: myProducts.length,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        let photoUrl = null;
        if (pendingProductPhoto) {
            try {
                photoUrl = await uploadProductPhoto(pendingProductPhoto, ref.id);
                await updateDoc(ref, { photoUrl, updatedAt: serverTimestamp() });
            } catch (photoErr) {
                console.warn('[stores] photo upload', photoErr);
                toast('Producto guardado, pero la foto no subió. Puedes editarla con el botón Foto.', 'warning');
            }
        }

        pendingProductPhoto = null;
        pendingProductPhotoPreview = null;
        myProducts = await loadProducts(myStore.id);
        renderMerchantBody();
        toast(photoUrl ? 'Producto con foto agregado' : 'Producto agregado', 'success');
    } catch (e) {
        console.error(e);
        toast('Error al agregar producto: ' + (e.message || e), 'error');
    }
}

async function toggleProduct(productId) {
    const p = myProducts.find((x) => x.id === productId);
    if (!p) return;
    try {
        await updateDoc(publicDoc('store_products', productId), {
            available: p.available === false,
            updatedAt: serverTimestamp(),
        });
        myProducts = await loadProducts(myStore.id);
        renderMerchantBody();
    } catch (e) {
        toast('No se pudo actualizar', 'error');
    }
}

async function deleteProduct(productId) {
    if (!confirm('¿Borrar este producto del menú?')) return;
    try {
        await deleteDoc(publicDoc('store_products', productId));
        myProducts = await loadProducts(myStore.id);
        renderMerchantBody();
        toast('Producto eliminado', 'info');
    } catch (e) {
        toast('No se pudo borrar', 'error');
    }
}

/**
 * Borra tienda + productos del menú.
 * Staff (admin/supervisor) puede borrar cualquiera; el dueño solo la suya.
 * Los pedidos (store_orders) se conservan como historial.
 */
async function deleteStoreAndProducts(storeId, { asStaff = false } = {}) {
    const user = getCurrentUser();
    if (!user?.uid || !storeId) return false;

    let store = storesCache.get(storeId);
    if (!store) {
        try {
            const snap = await getDoc(publicDoc('stores', storeId));
            if (snap.exists()) store = { id: snap.id, ...snap.data() };
        } catch (_) {}
    }
    if (!store) {
        toast('Tienda no encontrada', 'error');
        return false;
    }

    const isOwner = store.ownerId === user.uid;
    if (!asStaff && !isOwner) {
        toast('No tienes permiso para borrar esta tienda', 'error');
        return false;
    }
    if (asStaff && !isStoresStaff() && !isOwner) {
        toast('Solo admin o supervisor puede borrar tiendas ajenas', 'error');
        return false;
    }

    const name = store.name || 'esta tienda';
    const who = asStaff && !isOwner ? ' (moderación staff)' : '';
    if (!confirm(`¿Eliminar «${name}»${who}?\n\nSe borrará la tienda y todo su menú. Los pedidos antiguos se conservan.`)) {
        return false;
    }
    if (asStaff && !isOwner) {
        if (!confirm(`Confirma borrar la tienda de otro usuario:\n«${name}»`)) return false;
    }

    toast('Eliminando tienda…', 'info');
    try {
        // Productos del menú
        const prodSnap = await getDocs(query(publicCol('store_products'), where('storeId', '==', storeId), limit(500)));
        let deletedProducts = 0;
        for (const d of prodSnap.docs) {
            try {
                await deleteDoc(d.ref);
                deletedProducts += 1;
            } catch (pe) {
                console.warn('[stores] delete product', d.id, pe);
            }
        }

        await deleteDoc(publicDoc('stores', storeId));
        storesCache.delete(storeId);

        if (myStore?.id === storeId) {
            myStore = null;
            myProducts = [];
        }
        if (viewingStore?.id === storeId) {
            viewingStore = null;
            viewingProducts = [];
            marketplaceView = 'list';
            cart = [];
        }
        if (cart.length && cart[0]?.storeId === storeId) {
            cart = [];
        }

        toast(
            deletedProducts
                ? `Tienda eliminada (${deletedProducts} producto${deletedProducts === 1 ? '' : 's'})`
                : 'Tienda eliminada',
            'success'
        );

        // Refrescar UI abierta
        const market = document.getElementById('stores-marketplace-panel');
        if (market && !market.classList.contains('hidden')) {
            renderMarketplace();
        }
        const merchant = document.getElementById('merchant-panel');
        if (merchant && !merchant.classList.contains('hidden')) {
            if (!myStore) {
                merchantCreateMode = false;
                merchantTab = 'store';
            }
            renderMerchantBody();
            updateMerchantOpenToggle();
        }
        return true;
    } catch (e) {
        console.error('[stores] deleteStoreAndProducts', e);
        const msg = String(e?.message || e || '');
        if (/permission|insufficient|permiso/i.test(msg)) {
            toast('Sin permiso para borrar. Revisa que seas admin/supervisor.', 'error');
        } else {
            toast('No se pudo eliminar la tienda', 'error');
        }
        return false;
    }
}

async function adminDeleteStore(storeId) {
    if (!isStoresStaff()) {
        toast('Solo admin o supervisor puede borrar tiendas desde el marketplace', 'error');
        return;
    }
    await deleteStoreAndProducts(storeId, { asStaff: true });
}

async function deleteMyStore(storeId) {
    const id = storeId || myStore?.id;
    if (!id) return toast('No hay tienda para borrar', 'warning');
    // Dueño o staff
    await deleteStoreAndProducts(id, { asStaff: isStoresStaff() });
}

async function setOrderStatus(orderId, status, extra = {}) {
    try {
        await updateDoc(publicDoc('store_orders', orderId), {
            status,
            updatedAt: serverTimestamp(),
            ...extra,
        });
    } catch (e) {
        console.error(e);
        toast('No se pudo actualizar el pedido', 'error');
        throw e;
    }
}

/**
 * Crea viaje delivery desde la tienda hacia el cliente.
 */
async function createDeliveryTripForOrder(order) {
    const user = getCurrentUser();
    const profile = getUserProfile() || {};
    if (!user || !order) throw new Error('Sin pedido');

    const storeLat = Number(order.storeLat ?? myStore?.lat);
    const storeLng = Number(order.storeLng ?? myStore?.lng);
    let destLat = Number(order.deliveryLat);
    let destLng = Number(order.deliveryLng);

    // If no dest coords, use city center soft estimate
    const city = getZoneById(order.cityId) || getZoneById(getDefaultZoneId());
    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
        destLat = city?.center?.lat ?? storeLat;
        destLng = city?.center?.lng ?? storeLng;
    }
    if (!Number.isFinite(storeLat) || !Number.isFinite(storeLng)) {
        throw new Error('La tienda no tiene ubicación GPS. Guárdala en Mi tienda.');
    }

    const km = Math.max(0.5, haversineKm(storeLat, storeLng, destLat, destLng));
    const priceNum = calculateServiceFare('delivery', km, null, 1);
    const priceText = `L. ${priceNum.toFixed(2)}`;
    const itemsLine = (order.items || []).map((i) => `${i.qty}× ${i.name}`).join(', ');
    const packageDescription = `Pedido tienda: ${itemsLine}`.slice(0, 400);
    const sla = getServiceMeta('delivery')?.slaMinutes || 30;

    const tripPayload = {
        status: 'pending',
        serviceType: 'delivery',
        bookingType: 'standard',
        passengers: 1,
        passengerSurcharge: 0,
        extraPassengers: 0,
        tripDistanceKm: Math.round(km * 100) / 100,
        tripDurationMs: 0,
        // Marca marketplace: permite moto y Taxi VIP
        storeDelivery: true,
        storeOrderId: order.id,
        storeId: order.storeId,
        merchantId: order.ownerId,
        allowedDriverVehicles: ['moto', 'auto'],
        deliveryDetails: {
            category: myStore?.category || 'comida',
            restaurant: order.storeName || myStore?.name || 'Tienda',
            recipientName: order.recipientName || order.clientName || '',
            recipientPhone: order.recipientPhone || order.clientPhone || '',
            packageDescription,
            storeOrderId: order.id,
            itemsTotal: order.itemsTotal || 0,
            storeDelivery: true,
        },
        deliverySlaMinutes: sla,
        freightDetails: null,
        origin: order.storeAddress || myStore?.address || 'Tienda',
        destination: order.deliveryAddress || 'Entrega',
        originPlaceName: order.storeName || myStore?.name || null,
        destinationPlaceName: null,
        originFormattedAddress: order.storeAddress || null,
        destinationFormattedAddress: order.deliveryAddress || null,
        originSource: 'store',
        originLat: storeLat,
        originLng: storeLng,
        destinationLat: destLat,
        destinationLng: destLng,
        serviceZoneId: order.cityId || city?.id || null,
        serviceZoneName: order.cityName || city?.name || null,
        searchRadiusKm: 25,
        price: priceText,
        priceNum,
        paymentMethod: 'efectivo',
        // Cliente del viaje = cliente del pedido (él paga el envío)
        clientId: order.clientId,
        clientName: order.clientName || 'Cliente',
        clientPhone: order.clientPhone || order.recipientPhone || '',
        clientPhoto: null,
        clientRating: '5.0',
        clientApprovalStatus: 'approved',
        clientVerified: true,
        clientIsFirstTrip: false,
        clientTotalTrips: 0,
        createdAt: serverTimestamp(),
        chat: [],
        viewedBy: {},
        declinedDriverIds: [],
        offeredToDriverId: null,
        preferredDriverId: null,
        negotiationEnabled: true,
        createdByMerchant: true,
        merchantName: profile.name || myStore?.name || '',
    };

    const tripRef = await addDoc(publicCol('trips'), tripPayload);
    await updateDoc(publicDoc('store_orders', order.id), {
        status: 'out_for_delivery',
        tripId: tripRef.id,
        deliveryFee: priceNum,
        readyAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    return tripRef.id;
}

async function onMerchantClick(e) {
    const tabBtn = e.target.closest('[data-merchant-tab]');
    if (tabBtn) {
        merchantTab = tabBtn.getAttribute('data-merchant-tab');
        // Al usar pestañas de gestión, salimos del modo "crear nueva"
        if (!merchantCreateMode || merchantTab !== 'store') {
            merchantCreateMode = false;
            document.querySelectorAll('.merchant-tab').forEach((b) => b.classList.remove('hidden'));
            const titleEl = document.querySelector('#merchant-panel .stores-title');
            if (titleEl) titleEl.textContent = 'Mi tienda virtual';
        }
        document.querySelectorAll('.merchant-tab').forEach((b) => {
            b.classList.toggle('active', b === tabBtn);
        });
        if (merchantTab === 'products' && myStore) {
            myProducts = await loadProducts(myStore.id);
        }
        return renderMerchantBody();
    }

    const t = e.target.closest('[data-merchant-action]');
    if (!t) return;
    const action = t.getAttribute('data-merchant-action');
    const orderId = t.getAttribute('data-order-id');
    const productId = t.getAttribute('data-product-id');

    if (action === 'close') return closeMerchantPanel();
    if (action === 'goto-store') {
        merchantTab = 'store';
        document.querySelectorAll('.merchant-tab').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-merchant-tab') === 'store');
        });
        return renderMerchantBody();
    }
    if (action === 'save-store') return saveStore();
    if (action === 'use-gps') return useGpsForStore();
    if (action === 'toggle-open') return toggleStoreOpen();
    if (action === 'start-create-new') {
        // Ya no se permiten varias tiendas
        return openMerchantPanel({ createNew: false });
    }
    if (action === 'goto-my-store') {
        pendingStorePhoto = null;
        pendingStorePhotoPreview = null;
        return openMerchantPanel({ createNew: false });
    }
    if (action === 'pick-store-logo') return pickStoreLogo();
    if (action === 'share-catalog') return shareStoreCatalog();
    if (action === 'add-product') return addProduct();
    if (action === 'pick-product-photo') return pickNewProductPhoto();
    if (action === 'change-product-photo' && productId) return pickEditProductPhoto(productId);
    if (action === 'toggle-product' && productId) return toggleProduct(productId);
    if (action === 'delete-product' && productId) return deleteProduct(productId);
    if (action === 'delete-my-store') {
        const sid = t.getAttribute('data-store-id') || myStore?.id;
        return deleteMyStore(sid);
    }

    if (action === 'accept-order' && orderId) {
        await setOrderStatus(orderId, 'accepted', { acceptedAt: serverTimestamp() });
        return toast('Pedido aceptado', 'success');
    }
    if (action === 'reject-order' && orderId) {
        if (!confirm('¿Rechazar este pedido?')) return;
        const order = merchantOrders.find((o) => o.id === orderId);
        await setOrderStatus(orderId, 'cancelled', { cancelledBy: 'merchant' });
        // Reembolso de puntos: el dueño no puede tocar el saldo del cliente → lo hace la Cloud Function
        // (onStoreOrderUpdatedPush / refundStoreOrderSaldo). Aviso local:
        if (order?.paymentMethod === 'saldo' && order?.paymentStatus === 'paid') {
            toast('Pedido rechazado · se reembolsarán los puntos al cliente', 'info');
        } else {
            toast('Pedido rechazado', 'info');
        }
        return;
    }
    if (action === 'preparing-order' && orderId) {
        await setOrderStatus(orderId, 'preparing');
        return toast('Marcado como preparando', 'success');
    }
    if (action === 'ready-order' && orderId) {
        const order = merchantOrders.find((o) => o.id === orderId);
        if (!order) return;
        t.disabled = true;
        try {
            await setOrderStatus(orderId, 'ready', { readyAt: serverTimestamp() });
            const tripId = await createDeliveryTripForOrder(order);
            toast('Pedido listo · se pidió entrega (moto o Taxi VIP) · ' + tripId.slice(0, 6) + '…', 'success');
        } catch (err) {
            console.error(err);
            toast(err.message || 'No se pudo pedir la moto', 'error');
        } finally {
            t.disabled = false;
        }
        return;
    }
    if (action === 'delivered-order' && orderId) {
        await setOrderStatus(orderId, 'delivered', { deliveredAt: serverTimestamp() });
        return toast('Pedido marcado entregado', 'success');
    }
}

/* ===================== VERIFICACIÓN DE TIENDAS (SUPERVISOR / ADMIN) ===================== */

/**
 * Aprobar ("nos parece bien") o rechazar ("nos parece mal") una tienda.
 * @param {string} storeId
 * @param {'approved'|'rejected'} status
 */
async function staffSetStoreApproval(storeId, status) {
    if (!isStoresStaff()) return toast('Solo supervisores o admin', 'error');
    if (!storeId || !['approved', 'rejected'].includes(status)) return;

    let rejectionReason = null;
    if (status === 'rejected') {
        const rawReason = window.prompt('Motivo del rechazo (opcional):', '');
        if (rawReason === null) return; // cancel
        rejectionReason = String(rawReason || '').trim();
        if (!confirm('¿Confirmar que nos parece mal esta tienda? No será visible en el marketplace.')) return;
    } else if (!confirm('¿Confirmar que nos parece bien? La tienda será visible para clientes.')) {
        return;
    }

    const user = getCurrentUser();
    const profile = getUserProfile() || {};
    try {
        const patch = {
            approvalStatus: status,
            reviewedAt: serverTimestamp(),
            reviewedBy: user?.uid || null,
            reviewedByName: profile.name || profile.email || 'Staff',
            updatedAt: serverTimestamp(),
        };
        if (status === 'rejected') {
            patch.rejectionReason = String(rejectionReason || '').trim() || 'No cumple requisitos de HonduRaite';
            // No debe seguir "abierta" al público
            patch.isOpen = false;
        }
        if (status === 'approved') {
            patch.rejectionReason = null;
            patch.active = true;
        }
        await updateDoc(publicDoc('stores', storeId), patch);

        // Actualizar cachés locales
        const cached = storesCache.get(storeId);
        if (cached) {
            Object.assign(cached, patch, { approvalStatus: status, rejectionReason: patch.rejectionReason ?? null });
            storesCache.set(storeId, cached);
        }
        if (myStore?.id === storeId) {
            Object.assign(myStore, { approvalStatus: status, rejectionReason: patch.rejectionReason ?? null });
        }
        if (viewingStore?.id === storeId) {
            Object.assign(viewingStore, { approvalStatus: status, rejectionReason: patch.rejectionReason ?? null });
        }

        toast(
            status === 'approved' ? 'Tienda aprobada · visible en marketplace' : 'Tienda rechazada · oculta al público',
            status === 'approved' ? 'success' : 'info'
        );
        if (marketplaceView === 'store' || marketplaceView === 'list') renderMarketplace();
        // Refrescar panel staff si está abierto
        if (document.getElementById('staff-stores-review') || document.getElementById('supervisor-pending-list')) {
            try { await loadSupervisorStores({ keepFilter: true }); } catch (_) {}
        }
    } catch (e) {
        console.error('[stores] staffSetStoreApproval', e);
        toast('No se pudo actualizar la verificación', 'error');
    }
}

async function staffToggleAdultsOnly(storeId) {
    if (!isStoresStaff()) return toast('Solo supervisores o admin', 'error');
    if (!storeId) return;
    let store = storesCache.get(storeId);
    if (!store) {
        try {
            const snap = await getDoc(publicDoc('stores', storeId));
            if (snap.exists()) store = { id: snap.id, ...snap.data() };
        } catch (_) {}
    }
    if (!store) return toast('Tienda no encontrada', 'error');
    const next = !isStoreAdultsOnly(store);
    try {
        await updateDoc(publicDoc('stores', storeId), {
            adultsOnly: next,
            requiresAge18: next,
            ageRestrictedBy: getCurrentUser()?.uid || null,
            ageRestrictedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        const patch = { adultsOnly: next, requiresAge18: next };
        if (storesCache.has(storeId)) Object.assign(storesCache.get(storeId), patch);
        if (viewingStore?.id === storeId) Object.assign(viewingStore, patch);
        if (myStore?.id === storeId) Object.assign(myStore, patch);
        toast(next ? 'Marcada como tienda +18' : 'Restricción +18 quitada', 'success');
        if (marketplaceView === 'store' || marketplaceView === 'list') renderMarketplace();
        if (document.getElementById('staff-stores-review') || document.getElementById('supervisor-pending-list')) {
            try { await loadSupervisorStores({ keepFilter: true }); } catch (_) {}
        }
    } catch (e) {
        console.error(e);
        toast('No se pudo cambiar +18', 'error');
    }
}

/**
 * Panel de supervisión: listar y verificar tiendas.
 * Se renderiza en #supervisor-pending-list (o admin content) cuando el staff elige la pestaña.
 */
export async function loadSupervisorStores(opts = {}) {
    if (!isStoresStaff()) {
        toast('Solo supervisores o admin pueden verificar tiendas', 'error');
        return;
    }
    if (!opts.keepFilter) staffStoresFilter = staffStoresFilter || 'pending';

    // Activar nav supervisor si existe
    try {
        window.setSupervisorNavActive?.('stores');
    } catch (_) {}

    const container = document.getElementById('supervisor-pending-list')
        || document.getElementById('admin-content')
        || document.getElementById('admin-users-list');
    if (!container) {
        // Fallback: abrir en modal del marketplace
        toast('Abre el panel de supervisión para ver la lista completa', 'info');
        closeMarketplace({ silent: true });
        try { window.openSupervisorPanel?.(); } catch (_) {}
        setTimeout(() => loadSupervisorStores(opts), 400);
        return;
    }

    const U = window.OpsUi;
    container.innerHTML = U?.page
        ? U.page(`<div class="ops-loading"><div class="ops-loading-ring"><i class="fas fa-spinner fa-spin"></i></div><p class="ops-loading-text">Cargando tiendas…</p></div>`)
        : `<div class="p-6 text-center text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando tiendas…</div>`;

    try {
        // Asegurar db
        if (!dbRef) {
            toast('App aún cargando. Intenta de nuevo.', 'warning');
            return;
        }
        startStoresListener();
        // Cargar todas (incl. inactive) para staff
        let list = [];
        try {
            const snap = await getDocs(query(publicCol('stores'), limit(300)));
            list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (e) {
            list = [...storesCache.values()];
        }
        staffStoresList = list.sort((a, b) => {
            const order = { pending: 0, rejected: 1, approved: 2 };
            const ao = order[storeApprovalStatus(a)] ?? 3;
            const bo = order[storeApprovalStatus(b)] ?? 3;
            return ao - bo || String(a.name || '').localeCompare(String(b.name || ''), 'es');
        });

        const pending = staffStoresList.filter((s) => storeApprovalStatus(s) === 'pending');
        const approved = staffStoresList.filter((s) => storeApprovalStatus(s) === 'approved');
        const rejected = staffStoresList.filter((s) => storeApprovalStatus(s) === 'rejected');
        const adults = staffStoresList.filter((s) => isStoreAdultsOnly(s));

        let filtered = staffStoresList;
        if (staffStoresFilter === 'pending') filtered = pending;
        else if (staffStoresFilter === 'approved') filtered = approved;
        else if (staffStoresFilter === 'rejected') filtered = rejected;
        else if (staffStoresFilter === 'adults') filtered = adults;

        const chips = [
            { id: 'pending', label: `En revisión (${pending.length})` },
            { id: 'approved', label: `Aprobadas (${approved.length})` },
            { id: 'rejected', label: `Rechazadas (${rejected.length})` },
            { id: 'adults', label: `+18 (${adults.length})` },
            { id: 'all', label: `Todas (${staffStoresList.length})` },
        ];

        const cards = filtered.length
            ? filtered.map((s) => staffStoreCardHtml(s)).join('')
            : (U?.empty
                ? U.empty('fa-store', 'Sin tiendas aquí', 'Cambia el filtro o espera nuevas solicitudes.')
                : `<p class="text-center text-slate-400 py-8">Sin tiendas en este filtro.</p>`);

        const body = `
            <div id="staff-stores-review" class="space-y-4">
                ${U?.hero
                    ? U.hero('Tiendas virtuales', 'Verifica negocios · aprobar / rechazar · marcar +18',
                        U.kpiRow?.([
                            { value: pending.length, label: 'En revisión', variant: 'amber' },
                            { value: approved.length, label: 'Aprobadas', variant: 'emerald' },
                            { value: rejected.length, label: 'Rechazadas', variant: 'red' },
                            { value: adults.length, label: '+18', variant: 'purple' },
                        ]) || '')
                    : `<h2 class="text-xl font-black text-white mb-2">Tiendas virtuales</h2>`}
                <div class="ops-chipbar flex flex-wrap gap-2" id="staff-stores-filter-chips">
                    ${chips.map((c) => `
                        <button type="button" class="ops-chip ${staffStoresFilter === c.id ? 'ops-chip--active' : ''}"
                            data-staff-stores-filter="${esc(c.id)}">${esc(c.label)}</button>
                    `).join('')}
                </div>
                <p class="text-[11px] text-slate-400 font-semibold leading-snug">
                    <b>Nos parece bien</b> = tienda visible en el marketplace.
                    <b>Nos parece mal</b> = rechazada y oculta.
                    <b>+18</b> = solo clientes mayores de 18 (según fecha de nacimiento del perfil).
                </p>
                <div class="space-y-3">${cards}</div>
            </div>
        `;
        container.innerHTML = U?.page ? U.page(body) : body;

        container.querySelectorAll('[data-staff-stores-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                staffStoresFilter = btn.getAttribute('data-staff-stores-filter') || 'pending';
                loadSupervisorStores({ keepFilter: true });
            });
        });
        container.querySelectorAll('[data-staff-store-action]').forEach((btn) => {
            btn.addEventListener('click', async (ev) => {
                ev.preventDefault();
                const action = btn.getAttribute('data-staff-store-action');
                const id = btn.getAttribute('data-store-id');
                if (!id) return;
                btn.disabled = true;
                try {
                    if (action === 'approve') await staffSetStoreApproval(id, 'approved');
                    else if (action === 'reject') await staffSetStoreApproval(id, 'rejected');
                    else if (action === 'toggle18') await staffToggleAdultsOnly(id);
                    else if (action === 'delete') await adminDeleteStore(id);
                    else if (action === 'open') {
                        try { window.closeSupervisorPanel?.(); } catch (_) {}
                        openMarketplace();
                        setTimeout(() => openStore(id), 300);
                    }
                } finally {
                    btn.disabled = false;
                }
            });
        });
    } catch (e) {
        console.error('[stores] loadSupervisorStores', e);
        container.innerHTML = `<div class="text-center py-10 text-red-400"><p>Error al cargar tiendas</p></div>`;
    }
}

function staffStoreCardHtml(s) {
    const appr = storeApprovalStatus(s);
    const meta = STORE_APPROVAL[appr] || STORE_APPROVAL.pending;
    const adults = isStoreAdultsOnly(s);
    const open = s.isOpen !== false;
    const photo = s.photoUrl
        ? `<img src="${esc(s.photoUrl)}" alt="" class="w-14 h-14 rounded-xl object-cover border border-slate-600" loading="lazy">`
        : `<div class="w-14 h-14 rounded-xl bg-slate-700 flex items-center justify-center text-slate-400"><i class="fas ${esc(catIcon(s.category))}"></i></div>`;
    return `
        <article class="ops-card rounded-2xl border border-slate-700/80 bg-slate-900/50 p-4 space-y-3" data-store-id="${esc(s.id)}">
            <div class="flex gap-3 items-start">
                ${photo}
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="font-black text-white text-sm">${esc(s.name || 'Sin nombre')}</h3>
                        <span class="ops-badge ops-badge--${meta.tone === 'emerald' ? 'emerald' : meta.tone === 'red' ? 'red' : 'amber'}">${esc(meta.label)}</span>
                        ${adults ? `<span class="ops-badge ops-badge--purple">+18</span>` : ''}
                        <span class="text-[10px] font-bold ${open ? 'text-emerald-400' : 'text-slate-500'}">${open ? 'Abierta' : 'Cerrada'}</span>
                    </div>
                    <p class="text-[11px] text-slate-400 font-semibold mt-0.5">
                        ${esc(catLabel(s.category))}${s.cityName ? ` · ${esc(s.cityName)}` : ''}
                    </p>
                    ${s.address ? `<p class="text-[11px] text-slate-500 mt-0.5"><i class="fas fa-map-marker-alt"></i> ${esc(s.address)}</p>` : ''}
                    ${s.phone ? `<p class="text-[11px] text-slate-500"><i class="fab fa-whatsapp"></i> ${esc(s.phone)}</p>` : ''}
                    ${s.description ? `<p class="text-[11px] text-slate-400 mt-1 line-clamp-2">${esc(s.description)}</p>` : ''}
                    ${s.ownerName || s.ownerId ? `<p class="text-[10px] text-slate-500 mt-1">Dueño: ${esc(s.ownerName || String(s.ownerId).slice(0, 12) + '…')}</p>` : ''}
                    ${appr === 'rejected' && s.rejectionReason ? `<p class="text-[10px] text-red-400 font-semibold mt-1">Motivo: ${esc(s.rejectionReason)}</p>` : ''}
                </div>
            </div>
            <div class="flex flex-wrap gap-2">
                ${appr !== 'approved' ? `
                    <button type="button" class="ops-btn ops-btn--emerald text-xs py-2 px-3 rounded-xl font-bold"
                        data-staff-store-action="approve" data-store-id="${esc(s.id)}">
                        <i class="fas fa-thumbs-up"></i> Nos parece bien
                    </button>` : ''}
                ${appr !== 'rejected' ? `
                    <button type="button" class="ops-btn ops-btn--danger text-xs py-2 px-3 rounded-xl font-bold"
                        data-staff-store-action="reject" data-store-id="${esc(s.id)}">
                        <i class="fas fa-thumbs-down"></i> Nos parece mal
                    </button>` : ''}
                <button type="button" class="ops-btn text-xs py-2 px-3 rounded-xl font-bold border border-slate-600"
                    data-staff-store-action="toggle18" data-store-id="${esc(s.id)}">
                    <i class="fas fa-user-shield"></i> ${adults ? 'Quitar +18' : 'Marcar +18'}
                </button>
                <button type="button" class="ops-btn text-xs py-2 px-3 rounded-xl font-bold border border-slate-600"
                    data-staff-store-action="open" data-store-id="${esc(s.id)}">
                    <i class="fas fa-external-link-alt"></i> Ver en app
                </button>
                <button type="button" class="ops-btn ops-btn--danger text-xs py-2 px-3 rounded-xl font-bold"
                    data-staff-store-action="delete" data-store-id="${esc(s.id)}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </article>
    `;
}

/* ===================== INVITAR EMPRESA (STAFF → WHATSAPP) ===================== */

function showInviteAuthBanner() {
    document.getElementById('hr-invite-business-banner')?.remove();
    const loginCard = document.querySelector('#login-screen .login-card') || document.getElementById('login-screen');
    if (!loginCard) return;
    const banner = document.createElement('div');
    banner.id = 'hr-invite-business-banner';
    banner.className = 'hr-invite-business-banner';
    banner.innerHTML = `
        <div class="hr-invite-business-banner-inner">
            <p class="hr-invite-business-banner-title">
                <i class="fas fa-store"></i> Invitación a crear empresa
            </p>
            <p class="hr-invite-business-banner-text">
                Si <b>no tienes cuenta</b>, usa <b>Crear cuenta</b> y regístrate.
                Si ya tienes, inicia sesión. Luego te abrimos el formulario de tu tienda.
            </p>
        </div>
    `;
    // Insertar arriba del formulario / tabs
    const tabs = loginCard.querySelector('.flex.border-b') || loginCard.firstElementChild;
    if (tabs?.parentNode) tabs.parentNode.insertBefore(banner, tabs);
    else loginCard.prepend(banner);
}

/** Si no hay sesión: forzar registro y guardar pendiente. */
function requireAuthToCreateBusiness() {
    setPendingCreateBusiness(true);
    try {
        const h = String(window.location.hash || '').replace(/^#/, '').split('&')[0].toLowerCase();
        if (!CREATE_BUSINESS_HASHES.has(h)) {
            window.location.hash = 'crear-empresa';
        }
    } catch (_) {}

    try {
        window.updateRole?.('client');
    } catch (_) {}
    try {
        window.setAuthMode?.('register');
    } catch (_) {}

    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
        loginScreen.style.display = '';
        loginScreen.classList.remove('hidden');
    }
    showInviteAuthBanner();
    toast('Para crear tu empresa debes registrarte o iniciar sesión', 'warning');
}

/**
 * Flujo del link de invitación:
 * - sin cuenta → registrarse (modo Crear cuenta)
 * - con cuenta → abrir crear tienda
 */
async function handleCreateBusinessInvite({ fromAuth = false } = {}) {
    setPendingCreateBusiness(true);
    const user = getCurrentUser();
    if (!user?.uid) {
        requireAuthToCreateBusiness();
        return false;
    }

    // Ya autenticado: limpiar banner y abrir alta de tienda
    document.getElementById('hr-invite-business-banner')?.remove();
    setPendingCreateBusiness(false);

    try {
        // Limpia hash ruidoso sin perder la app
        if (CREATE_BUSINESS_HASHES.has(String(window.location.hash || '').replace(/^#/, '').split('&')[0].toLowerCase())) {
            history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
        }
    } catch (_) {}

    toast(fromAuth ? 'Cuenta lista. Completa los datos de tu empresa.' : 'Abriendo registro de empresa…', 'success');
    await openMerchantPanel({ createNew: true });
    return true;
}

function normalizeInvitePhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('504') && digits.length >= 11) return digits;
    if (digits.length === 8) return `504${digits}`;
    return digits;
}

/**
 * Copia texto de forma fiable (web + Android WebView/Capacitor).
 * Siempre devuelve feedback; si falla, selecciona un campo visible.
 */
async function copyTextReliable(text, { selectEl = null, okMsg = 'Copiado', failMsg = 'No se pudo copiar' } = {}) {
    const value = String(text || '');
    if (!value) {
        toast('No hay texto para copiar', 'warning');
        return false;
    }

    // 1) Capacitor Clipboard (app nativa)
    try {
        const Cap = window.Capacitor;
        if (Cap?.Plugins?.Clipboard?.write) {
            await Cap.Plugins.Clipboard.write({ string: value });
            toast(okMsg, 'success');
            return true;
        }
        if (Cap?.isNativePlatform?.() && Cap?.Plugins?.Clipboard?.write) {
            await Cap.Plugins.Clipboard.write({ string: value });
            toast(okMsg, 'success');
            return true;
        }
    } catch (e) {
        console.warn('[stores] capacitor clipboard', e);
    }

    // 2) Clipboard API (solo si hay gesto de usuario y contexto seguro)
    try {
        if (navigator.clipboard?.writeText && window.isSecureContext !== false) {
            await navigator.clipboard.writeText(value);
            toast(okMsg, 'success');
            return true;
        }
    } catch (e) {
        console.warn('[stores] clipboard api', e);
    }

    // 3) execCommand sobre un textarea visible (funciona mejor en WebView)
    try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:0;opacity:0.01;z-index:100000;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, value.length);
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) {
            toast(okMsg, 'success');
            return true;
        }
    } catch (e) {
        console.warn('[stores] execCommand copy', e);
    }

    // 4) Seleccionar campo visible del modal (el usuario puede copiar a mano)
    if (selectEl) {
        try {
            selectEl.focus();
            selectEl.select?.();
            selectEl.setSelectionRange?.(0, value.length);
            toast(`${failMsg}. Mantén pulsado el texto y elige Copiar.`, 'warning');
            return false;
        } catch (_) {}
    }

    // 5) prompt nativo (siempre se puede copiar desde ahí)
    try {
        window.prompt('Copia este texto (Ctrl+C / mantener pulsado):', value);
        toast('Selecciona el texto del cuadro y cópialo', 'info');
        return false;
    } catch (_) {
        toast(failMsg, 'error');
        return false;
    }
}

function markCopyBtnOk(btn, label = '¡Copiado!') {
    if (!btn) return;
    const prev = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-check"></i> ${label}`;
    btn.style.borderColor = '#86efac';
    btn.style.background = '#ecfdf5';
    btn.style.color = '#047857';
    setTimeout(() => {
        try {
            btn.innerHTML = prev;
            btn.style.borderColor = '';
            btn.style.background = '';
            btn.style.color = '';
        } catch (_) {}
    }, 1800);
}

/** Modal staff: invitar por WhatsApp (con o sin número) + copiar link. */
function showStaffInviteBusinessModal() {
    try {
        if (!isStoresStaff()) {
            console.warn('[stores] invite: isStoresStaff=false, abriendo igual para depurar');
        }
        document.getElementById('hr-staff-invite-modal')?.remove();

        const profile = getUserProfile() || {};
        const staffName = String(profile.name || profile.displayName || '').trim();
        const link = buildCreateBusinessInviteLink();
        const preview = buildInviteBusinessWhatsAppText({ staffName });

        const modal = document.createElement('div');
        modal.id = 'hr-staff-invite-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Invitar empresa por WhatsApp');
        // Fuera de .stores-world y con z-index alto (clipboard + clics más fiables)
        modal.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483000',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:1rem',
            'background:rgba(0,0,0,0.72)',
            'box-sizing:border-box',
            'pointer-events:auto',
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'background:#fff',
            'border-radius:1.5rem',
            'width:100%',
            'max-width:28rem',
            'padding:1.25rem',
            'max-height:92dvh',
            'overflow-y:auto',
            'box-shadow:0 25px 50px rgba(0,0,0,0.35)',
            'pointer-events:auto',
            'position:relative',
            'z-index:1',
        ].join(';');
        // Evitar que clics del marketplace (capture) traguen los del modal
        card.addEventListener('click', (e) => e.stopPropagation());

        card.innerHTML = `
            <h3 style="font-weight:900;font-size:1.1rem;color:#0f172a;text-align:center;margin:0 0 0.35rem">
                <i class="fab fa-whatsapp" style="color:#25d366"></i> Invitar empresa
            </h3>
            <p style="font-size:0.75rem;color:#64748b;text-align:center;font-weight:600;margin:0 0 0.85rem;line-height:1.35">
                El invitado <b>debe registrarse</b> si no tiene cuenta. El link abre HonduRaite en
                <b>Crear cuenta</b> y luego el formulario de tienda.
            </p>
            <label style="display:block;font-size:0.68rem;font-weight:900;color:#475569;text-transform:uppercase;margin-bottom:0.25rem">
                WhatsApp del emprendedor (opcional)
            </label>
            <input id="hr-invite-phone" type="tel" inputmode="tel" autocomplete="tel"
                   placeholder="504 XXXX XXXX o 8 dígitos"
                   style="width:100%;padding:0.75rem 1rem;border-radius:1rem;border:1px solid #e2e8f0;background:#f8fafc;font-size:0.875rem;font-weight:600;margin-bottom:0.75rem;box-sizing:border-box">
            <label style="display:block;font-size:0.68rem;font-weight:900;color:#475569;text-transform:uppercase;margin-bottom:0.25rem">
                Mensaje
            </label>
            <textarea id="hr-invite-msg" rows="7"
                style="width:100%;padding:0.65rem 0.75rem;border-radius:1rem;border:1px solid #e2e8f0;background:#f8fafc;font-size:0.75rem;font-weight:600;color:#1e293b;margin-bottom:0.75rem;box-sizing:border-box;line-height:1.35"></textarea>
            <label style="display:block;font-size:0.68rem;font-weight:900;color:#475569;text-transform:uppercase;margin-bottom:0.25rem">
                Link de invitación
            </label>
            <input id="hr-invite-link-input" type="text" readonly
                   style="width:100%;padding:0.7rem 0.85rem;border-radius:1rem;border:1px solid #fcd34d;background:#fffbeb;font-size:0.72rem;font-weight:700;color:#92400e;margin-bottom:0.35rem;box-sizing:border-box">
            <p style="font-size:0.62rem;color:#94a3b8;font-weight:600;margin:0 0 0.75rem;text-align:center">
                Si “Copiar” no funciona, mantén pulsado el link y elige Copiar
            </p>
            <div style="display:flex;flex-direction:column;gap:0.5rem">
                <button type="button" id="hr-invite-wa"
                    style="width:100%;padding:0.9rem;border-radius:1rem;border:none;background:#22c55e;color:#fff;font-weight:900;font-size:0.875rem;cursor:pointer;touch-action:manipulation">
                    <i class="fab fa-whatsapp"></i> Enviar por WhatsApp
                </button>
                <button type="button" id="hr-invite-copy"
                    style="width:100%;padding:0.75rem;border-radius:1rem;border:2px solid #e2e8f0;background:#fff;color:#334155;font-weight:900;font-size:0.875rem;cursor:pointer;touch-action:manipulation">
                    <i class="fas fa-link"></i> Copiar link
                </button>
                <button type="button" id="hr-invite-copy-msg"
                    style="width:100%;padding:0.75rem;border-radius:1rem;border:2px solid #e2e8f0;background:#fff;color:#334155;font-weight:900;font-size:0.875rem;cursor:pointer;touch-action:manipulation">
                    <i class="fas fa-copy"></i> Copiar mensaje
                </button>
                <button type="button" id="hr-invite-close"
                    style="width:100%;padding:0.65rem;border:none;background:transparent;color:#64748b;font-weight:700;font-size:0.875rem;cursor:pointer;touch-action:manipulation">
                    Cerrar
                </button>
            </div>
        `;
        modal.appendChild(card);
        // Siempre en body (no dentro de stores-world)
        document.body.appendChild(modal);

        const msgEl = modal.querySelector('#hr-invite-msg');
        if (msgEl) msgEl.value = preview;
        const linkInput = modal.querySelector('#hr-invite-link-input');
        if (linkInput) linkInput.value = link;

        const close = () => {
            try { modal.remove(); } catch (_) {}
            try {
                delete window.__hrInviteCopyLink;
                delete window.__hrInviteCopyMsg;
                delete window.__hrInviteClose;
                delete window.__hrInviteWa;
            } catch (_) {}
        };

        // Solo cerrar al tocar el fondo oscuro (NO capture+stopPropagation:
        // eso mataba los clics de los botones hijos)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        // Tocar el link lo selecciona (copiar a mano en móvil)
        linkInput?.addEventListener('focus', () => {
            try {
                linkInput.select();
                linkInput.setSelectionRange(0, link.length);
            } catch (_) {}
        });
        linkInput?.addEventListener('click', () => {
            try {
                linkInput.focus();
                linkInput.select();
                linkInput.setSelectionRange(0, link.length);
            } catch (_) {}
        });

        let copyBusyUntil = 0;
        const runCopyLink = async () => {
            const now = Date.now();
            if (now < copyBusyUntil) return;
            copyBusyUntil = now + 700;
            const btn = modal.querySelector('#hr-invite-copy');
            // Feedback inmediato para que se note el clic
            if (btn) {
                btn.style.background = '#fef3c7';
                btn.style.borderColor = '#f59e0b';
            }
            toast('Copiando link…', 'info');
            const ok = await copyTextReliable(link, {
                selectEl: linkInput,
                okMsg: '✅ Link copiado. Ya puedes pegarlo.',
                failMsg: 'No se pudo copiar automático',
            });
            if (ok) markCopyBtnOk(btn, '¡Link copiado!');
            else if (btn) {
                btn.style.background = '#fff';
                btn.style.borderColor = '#e2e8f0';
            }
        };
        const runCopyMsg = async () => {
            const now = Date.now();
            if (now < copyBusyUntil) return;
            copyBusyUntil = now + 700;
            const text = msgEl?.value || preview;
            const btn = modal.querySelector('#hr-invite-copy-msg');
            if (btn) {
                btn.style.background = '#fef3c7';
                btn.style.borderColor = '#f59e0b';
            }
            toast('Copiando mensaje…', 'info');
            const ok = await copyTextReliable(text, {
                selectEl: msgEl,
                okMsg: '✅ Mensaje copiado. Ya puedes pegarlo.',
                failMsg: 'No se pudo copiar automático',
            });
            if (ok) markCopyBtnOk(btn, '¡Mensaje copiado!');
            else if (btn) {
                btn.style.background = '#fff';
                btn.style.borderColor = '#e2e8f0';
            }
        };
        const runWa = () => {
            const text = msgEl?.value || preview;
            const phone = normalizeInvitePhone(modal.querySelector('#hr-invite-phone')?.value);
            const enc = encodeURIComponent(text);
            const wa = phone
                ? `https://api.whatsapp.com/send?phone=${phone}&text=${enc}`
                : `https://api.whatsapp.com/send?text=${enc}`;
            toast('Abriendo WhatsApp…', 'success');
            try {
                const opened = window.open(wa, '_blank');
                if (!opened) window.location.href = wa;
            } catch (_) {
                window.location.href = wa;
            }
            close();
        };

        // Handlers globales (onclick inline no se rompe por capture de otros nodos)
        window.__hrInviteCopyLink = runCopyLink;
        window.__hrInviteCopyMsg = runCopyMsg;
        window.__hrInviteClose = close;
        window.__hrInviteWa = runWa;

        const copyBtn = modal.querySelector('#hr-invite-copy');
        const copyMsgBtn = modal.querySelector('#hr-invite-copy-msg');
        const waBtn = modal.querySelector('#hr-invite-wa');
        const closeBtn = modal.querySelector('#hr-invite-close');

        // onclick property = máxima prioridad y simple
        if (copyBtn) copyBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); runCopyLink(); };
        if (copyMsgBtn) copyMsgBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); runCopyMsg(); };
        if (waBtn) waBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); runWa(); };
        if (closeBtn) closeBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); close(); };

        toast('Listo: toca Copiar link o Enviar por WhatsApp', 'info');
    } catch (err) {
        console.error('[stores] showStaffInviteBusinessModal', err);
        toast('No se pudo abrir la invitación. Recarga con Ctrl+F5.', 'error');
        try { window.alert('Error al abrir invitación: ' + (err?.message || err)); } catch (_) {}
    }
}

/* ===================== INIT ===================== */

async function tryOpenStoreFromHash() {
    try {
        const raw = String(window.location.hash || '').replace(/^#/, '');
        if (!raw) {
            // Sin hash: solo pendiente en session (post-registro)
            if (hasPendingCreateBusiness() && getCurrentUser()?.uid) {
                await handleCreateBusinessInvite({ fromAuth: true });
            }
            return;
        }
        const hash = raw.split('&')[0].split('?')[0];
        const hashLower = hash.toLowerCase();

        // Invitación staff: crear empresa / tienda
        if (CREATE_BUSINESS_HASHES.has(hashLower)) {
            await handleCreateBusinessInvite({ fromAuth: false });
            return;
        }

        // #tienda=ID o #tiendas
        let storeId = null;
        if (hash.startsWith('tienda=') || hash.startsWith('tienda%3D')) {
            storeId = decodeURIComponent(hash.replace(/^tienda=/, '').replace(/^tienda%3D/, ''));
        } else if (hashLower === 'tiendas' || hashLower === 'stores') {
            openMarketplace();
            return;
        } else {
            return;
        }
        if (!storeId) return;
        openMarketplace();
        // Esperar un momento a que carguen tiendas
        setTimeout(async () => {
            try {
                await openStore(storeId);
            } catch (e) {
                console.warn('[stores] deep link openStore', e);
            }
        }, 400);
    } catch (e) {
        console.warn('[stores] hash', e);
    }
}

export function initMerchantStores(deps = {}) {
    dbRef = deps.db;
    appIdRef = deps.appId;
    storageRef = deps.storage || null;
    getCurrentUser = deps.getCurrentUser || (() => null);
    getUserProfile = deps.getUserProfile || (() => null);

    bindUiHooks();

    // Re-inject when profile opens / DOM ready
    document.addEventListener('click', (e) => {
        if (e.target.closest('#header-profile-btn-mobile, [data-header-action="profile"], [onclick*="openProfilePanel"]')) {
            setTimeout(injectProfileEntry, 200);
        }
    });

    window.openStoresMarketplace = openMarketplace;
    window.closeStoresMarketplace = (opts) => closeMarketplace(opts || {});
    window.openMerchantPanel = openMerchantPanel;
    window.openCreateStorePanel = openCreateStorePanel;
    window.openMyStorePanel = openMyStorePanel;
    window.closeMerchantPanel = closeMerchantPanel;
    window.shareStoreCatalog = shareStoreCatalog;
    window.inviteBusinessViaWhatsApp = showStaffInviteBusinessModal;
    window.handleCreateBusinessInvite = handleCreateBusinessInvite;
    window.buildCreateBusinessInviteLink = buildCreateBusinessInviteLink;
    window.loadSupervisorStores = loadSupervisorStores;
    window.staffSetStoreApproval = staffSetStoreApproval;
    window.staffToggleStoreAdultsOnly = staffToggleAdultsOnly;

    // When user logs in, warm listeners lightly
    if (getCurrentUser()?.uid) {
        startStoresListener();
    }

    // Enlace compartido #tienda=id | #crear-empresa
    window.addEventListener('hashchange', () => tryOpenStoreFromHash());
    setTimeout(() => tryOpenStoreFromHash(), 800);
}

export function onMerchantAuthReady() {
    bindUiHooks();
    startStoresListener();
    loadMyStore().then((store) => {
        updateMerchantOpenToggle();
        // Escuchar pedidos en vivo (sonido + toast) aunque no abra el panel
        if (store?.id || getCurrentUser()?.uid) {
            startMerchantOrdersListener();
        }
        // Pedir permiso de notificaciones del navegador (web) si tiene tienda
        try {
            if (store?.id && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                Notification.requestPermission().catch(() => {});
            }
        } catch (_) {}

        // Tras registrarse / iniciar sesión: si venía de invitación, abrir crear empresa
        if (hasPendingCreateBusiness()) {
            setTimeout(() => {
                handleCreateBusinessInvite({ fromAuth: true }).catch((e) => {
                    console.warn('[stores] post-auth invite', e);
                });
            }, 500);
        }
    });
}

export { STORE_CATEGORIES, ORDER_STATUS, STORE_APPROVAL, calcSplitTariff, getTarifaDelMomento };
