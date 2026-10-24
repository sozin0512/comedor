/**
 * Tiendas virtuales para emprendedores (sección aparte de Envíos).
 * - Cliente: navega tiendas, ve fotos, carrito y pide.
 * - Emprendedor: crea tienda, menú con fotos y gestiona pedidos.
 * - Supervisores: verifican tiendas (aprobar/rechazar) y marcan +18.
 * - El cliente paga el precio de la tienda y el envío completo de su zona.
 * - La tienda solo paga el 10% semanal de sus ventas de productos. El envío no entra.
 * - Comida/restaurante no lleva stock. Las demás tiendas sí, y el servidor lo descuenta.
 * - El cliente elige moto o carro. El carro paga 25% más sobre la zona.
 * - Al marcar "listo" se crea un viaje delivery solo del vehículo que eligió el cliente.
 */
import {
    collection, addDoc, onSnapshot, doc, getDoc, setDoc, updateDoc,
    serverTimestamp, query, where, orderBy, limit, getDocs, deleteDoc, runTransaction, Timestamp, arrayUnion
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { calculateServiceFare, getServiceMeta } from './service-types.js?v=2026.10.24.2';
import { orderWaitChipHtml, tripWaitChipHtml, tsMs as waitTsMs } from './trip-wait.js?v=2026.10.24.2';
import {
    haversineKm, getDefaultZoneId, getZoneById, getStoredManualZoneId,
    getAllKnownZones, findNearestZone, isUsZone,
} from './zones.js?v=2026.10.24.2';
import { resolvePhotoUrl } from './storage.js?v=2026.10.24.2';
import { APP_CONFIG } from './config.js?v=2026.10.24.2';
import { calculateAge } from './age-verification.js?v=2026.10.24.2';
import { pickPhotoWithSourceChoice } from './camera-capture.js?v=2026.10.24.2';
import {
    configureStoreZones, renderMerchantZonesTab, checkoutFeeHtml, refreshCheckoutQuote,
    checkoutGateForOrder, resetCheckoutZone, orderFeeLineHtml, deliveryTripPrice,
    setCheckoutVehicle, checkoutVehicle, checkoutPoint, checkoutPointSource, setCheckoutPoint, CAR_DELIVERY_FACTOR, CAR_MIN_DELIVERY_FEE, computeCarDeliveryFee, quoteStoreDeliveryFeeFor,
} from './store-delivery-zones.js?v=2026.10.24.2';
import {
    WEEKLY_COMMISSION_RATE, hondurasWeekRange, formatWeekLabel, weeklySalesReport,
} from './store-week.js?v=2026.10.24.2';

import { formatLempiras } from './money-format.js';
import { createMerchantDeliveryTab } from './merchant-delivery-ui.js?v=2026.10.24.3';
import {
    buildDeliveryTrackingUrl,
    buildMerchantShareTripMessage,
    buildMerchantShareTripWhatsAppUrl,
} from './merchant-delivery-request.js?v=2026.10.24.3';
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
    preparing: { label: 'Preparando el pedido', tone: 'violet' },
    ready: { label: 'Pedido preparado', tone: 'emerald' },
    out_for_delivery: { label: 'En camino', tone: 'blue' },
    delivered: { label: 'Entregado', tone: 'slate' },
    cancelled: { label: 'Cancelado', tone: 'red' },
};

/** Filtro especial: tiendas +18 fuera de "Todas", categorías y búsqueda general. */
const ADULT_ZONE_CHIP = { id: 'adultos', label: 'Zona +18', shortLabel: 'Zona +18', icon: 'fa-user-shield' };

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
/** Listener aparte solo para tiendas +18 (mayores de edad / staff). */
let unsubAdultStores = null;
let unsubMerchantOrders = null;
let unsubClientOrders = null;
let unsubProducts = null;

/** @type {Map<string, object>} */
const storesCache = new Map();
/** Tiendas de la consulta general (sin +18) y de la consulta +18, por separado. */
const generalStoresById = new Map();
const adultStoresById = new Map();
/** @type {object|null} */
let viewingStore = null;
/** @type {object[]} */
let viewingProducts = [];
/** @type {{ productId: string, name: string, basePrice: number, price: number, displayPrice: number, merchantShare: number, buyerShare: number, qty: number, notes?: string, photoUrl?: string|null, storeId?: string }[]} */
let cart = [];
/** @type {object|null} */
let myStore = null;
/** @type {object[]} */
let myStores = [];
/** @type {object|null} Sucursal origen cuando se clona una nueva sucursal del mismo restaurante */
let merchantCloneFromStore = null;
/** @type {string|null} Producto en edición dentro de la pestaña Menú */
let editingProductId = null;
let pendingEditProductPhoto = null;
let pendingEditProductPhotoPreview = null;
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
/** Ciudad que el cliente mira en Tiendas (null = la de su dispositivo). No cambia la zona de viajes. */
let storesBrowseCityId = null;
/** Vista rápida de productos por tienda (tarjetas del listado). */
const storeProductPreview = new Map();
const storeProductPreviewLoading = new Set();
let storeProductPreviewRerender = null;
/** Filtro por ciudad del panel staff de tiendas */
let staffStoresCityFilter = 'all';
/** Reporte semanal: esta semana o la anterior. */
let merchantWeekWhich = 'current';
let weekPaintToken = 0;

/** Comida y restaurante no llevan inventario. El resto sí. Igual que functions/store-stock.js. */
function storeTracksStock(store) {
    const c = String(store?.category || '').toLowerCase().trim();
    if (!c) return true;
    if (c === 'comida' || c === 'restaurante') return false;
    if (c.includes('restaurante') || c.includes('comida')) return false;
    return true;
}

function productStockLeft(product, store) {
    if (!storeTracksStock(store)) return null;
    const n = Math.floor(Number(product?.stock));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function productCanSell(product, store) {
    if (!product || product.available === false) return false;
    const left = productStockLeft(product, store);
    return left == null || left > 0;
}

function orderRide(order) {
    const v = String(order?.deliveryVehicle || '').toLowerCase();
    if (v === 'auto' || v === 'carro' || v === 'car') return 'auto';
    if (v === 'moto') return 'moto';
    return 'both';
}

function orderRideName(order) {
    const ride = orderRide(order);
    if (ride === 'auto') return 'carro';
    if (ride === 'moto') return 'moto';
    return 'moto o carro';
}

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
    return `L. ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Tarifa del momento = comisión de plataforma (%) del servicio «Tiendas».
 * Fuente: platformConfig/main → commissionByService.tiendas; si no está, la de Envío (delivery);
 * si tampoco, el % general (commissionPercentage); si no carga, el respaldo de js/config.js.
 */
function configuredCommissionFallback() {
    const fb = Number(APP_CONFIG?.commissionPercent);
    return Number.isFinite(fb) && fb >= 0 && fb <= 100 ? fb : 0;
}
async function getTarifaDelMomento() {
    const now = Date.now();
    if (cachedTariffPercent != null && (now - cachedTariffAt) < 12000) {
        return cachedTariffPercent;
    }
    try {
        if (typeof window.getPlatformCommission === 'function') {
            const v = await window.getPlatformCommission('tiendas');
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
                const data = snap.data() || {};
                const by = data.commissionByService || {};
                const pickN = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN);
                let raw = pickN(by.tiendas);
                if (!(raw >= 0 && raw <= 100)) raw = pickN(by.delivery);
                if (!(raw >= 0 && raw <= 100)) raw = parseFloat(data.commissionPercentage);
                if (Number.isFinite(raw) && raw >= 0 && raw <= 100) {
                    cachedTariffPercent = raw;
                    cachedTariffAt = now;
                    return cachedTariffPercent;
                }
            }
        }
    } catch (_) {}
    cachedTariffPercent = configuredCommissionFallback();
    cachedTariffAt = now;
    return cachedTariffPercent;
}

function getTarifaDelMomentoSync() {
    if (cachedTariffPercent != null) return cachedTariffPercent;
    return configuredCommissionFallback();
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

function productDisplayPrice(p) {
    return productBasePrice(p);
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

/**
 * Ciudad elegida en ESTE dispositivo (la del cliente que mira).
 * Ojo: NO usar como ciudad de una tienda; para eso está resolveStoreCity().
 */
function activeCity() {
    const zoneId = getStoredManualZoneId() || getDefaultZoneId();
    const zone = getZoneById(zoneId);
    return {
        cityId: zone?.id || zoneId || 'comayagua',
        cityName: zone?.name || 'Comayagua',
        center: zone?.center || null,
    };
}

/* ===================== CIUDAD DE LA TIENDA ===================== */

/** Distancia máxima (km) entre la ubicación de la tienda y el centro de la ciudad elegida. */
const STORE_CITY_MAX_KM = 60;

function zoneCountry(z) {
    if (!z) return null;
    return isUsZone(z) ? 'us' : (z.country || 'hn');
}

function validCoords(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    return lat != null && lng != null && lat !== '' && lng !== ''
        && Number.isFinite(la) && Number.isFinite(ln)
        && Math.abs(la) <= 90 && Math.abs(ln) <= 180
        && !(la === 0 && ln === 0);
}

/**
 * ¿Las coordenadas son exactamente el centro de alguna ciudad?
 * Antes, si la tienda no tenía GPS se guardaba el centro de la ciudad del dispositivo
 * (p. ej. San Jose, California). Esas coordenadas NO son la ubicación real.
 */
function isZoneCenterCoords(lat, lng) {
    if (!validCoords(lat, lng)) return false;
    const la = Number(lat);
    const ln = Number(lng);
    return getAllKnownZones().some((z) => z?.center
        && Math.abs(z.center.lat - la) < 0.0005
        && Math.abs(z.center.lng - ln) < 0.0005);
}

/** Ciudad más cercana a la ubicación real de la tienda (o null si está lejos de todas). */
function cityFromStoreCoords(lat, lng) {
    if (!validCoords(lat, lng) || isZoneCenterCoords(lat, lng)) return null;
    const nearest = findNearestZone(Number(lat), Number(lng));
    if (!nearest?.zone || nearest.distanceKm > STORE_CITY_MAX_KM) return null;
    return nearest.zone;
}

/**
 * Decide en qué ciudad se publica una tienda. Nunca usa la ciudad del dispositivo en silencio.
 * Prioridad: ciudad elegida en el formulario (validada contra la ubicación) → ciudad por GPS/coords.
 * @returns {{ ok: true, zone: object, source: 'manual'|'coords' } | { ok: false, message: string, suggested?: object }}
 */
function resolveStoreCity({ selectedId = '', lat = null, lng = null } = {}) {
    const chosen = selectedId ? getZoneById(selectedId) : null;
    const realCoords = validCoords(lat, lng) && !isZoneCenterCoords(lat, lng);
    const fromCoords = realCoords ? cityFromStoreCoords(lat, lng) : null;

    if (!chosen) {
        if (fromCoords) return { ok: true, zone: fromCoords, source: 'coords' };
        return { ok: false, message: 'Elige la ciudad donde está tu tienda.' };
    }
    if (realCoords && chosen.center) {
        const dist = haversineKm(Number(lat), Number(lng), chosen.center.lat, chosen.center.lng);
        const nearest = findNearestZone(Number(lat), Number(lng));
        const sameCountry = !nearest?.zone || zoneCountry(nearest.zone) === zoneCountry(chosen);
        if (!sameCountry || dist > STORE_CITY_MAX_KM) {
            const hint = fromCoords ? ` Según la ubicación parece ${fromCoords.name}.` : '';
            return {
                ok: false,
                suggested: fromCoords || null,
                message: `La ubicación de la tienda está a ${Math.round(dist)} km de ${chosen.name}.${hint} Revisa la ciudad o la ubicación.`,
            };
        }
    }
    return { ok: true, zone: chosen, source: 'manual' };
}

/** Ciudad inicial del selector del formulario (visible y editable por el dueño). */
function initialStoreCityId(store) {
    const fromCoords = cityFromStoreCoords(store?.lat, store?.lng);
    const saved = store?.cityId ? getZoneById(store.cityId) : null;
    if (fromCoords) {
        const check = saved ? resolveStoreCity({ selectedId: saved.id, lat: store?.lat, lng: store?.lng }) : null;
        return check?.ok ? saved.id : fromCoords.id;
    }
    // Sin ubicación real: una ciudad de EE. UU. guardada es casi seguro el error "San Jose" → que la elija
    if (saved && !isUsZone(saved)) return saved.id;
    if (store?.id) return '';
    // Tienda nueva: sugerir la ciudad del dispositivo solo si es de Honduras (el error "San Jose" venía de aquí).
    const device = getZoneById(activeCity().cityId);
    return device && !isUsZone(device) ? device.id : '';
}

/** <option> de ciudades: Honduras primero (por departamento), luego EE. UU. */
function buildStoreCityOptionsHtml(selectedId = '') {
    const zones = getAllKnownZones().filter((z) => z?.id && z?.name);
    const groups = new Map();
    zones.forEach((z) => {
        const us = isUsZone(z);
        const label = us ? `EE. UU. · ${z.department || 'Otras'}` : (z.department || 'Otras');
        if (!groups.has(label)) groups.set(label, { us, list: [] });
        groups.get(label).list.push(z);
    });
    const labels = [...groups.keys()].sort((a, b) => {
        const ua = groups.get(a).us ? 1 : 0;
        const ub = groups.get(b).us ? 1 : 0;
        return ua - ub || a.localeCompare(b, 'es');
    });
    let html = `<option value="" ${selectedId ? '' : 'selected'} disabled>Elige la ciudad de tu tienda…</option>`;
    labels.forEach((label) => {
        const list = groups.get(label).list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
        html += `<optgroup label="${esc(label)}">`;
        list.forEach((z) => {
            html += `<option value="${esc(z.id)}" ${z.id === selectedId ? 'selected' : ''}>${esc(z.name)}</option>`;
        });
        html += '</optgroup>';
    });
    return html;
}

/* ===================== CIUDAD QUE SE MIRA · HORARIO · AVATAR ===================== */

/** Ciudad que se está mirando en Tiendas: la elegida en el selector o, si no, la del cliente. */
function browseCity() {
    const z = storesBrowseCityId ? getZoneById(storesBrowseCityId) : null;
    if (z) return { cityId: z.id, cityName: z.name, center: z.center || null };
    return activeCity();
}

function storeInCity(s, cityId) {
    // Tiendas viejas sin ciudad se siguen mostrando (no se pierden mientras se corrigen)
    return !s?.cityId || s.cityId === cityId;
}

/** Tiendas que puede ver esta cuenta en el marketplace (aprobadas; staff ve todas para moderar). */
function marketplaceBaseStores() {
    let all = [...storesCache.values()].filter((s) => s.active !== false);
    if (!isStoresStaff()) all = all.filter((s) => isStoreApprovedForPublic(s));
    return all;
}

/** Ciudades con tiendas de la lista general (sin +18), para el selector y las sugerencias. */
function citiesWithStores() {
    const map = new Map();
    marketplaceBaseStores().filter((s) => !isStoreAdultsOnly(s) && s.cityId).forEach((s) => {
        const cur = map.get(s.cityId)
            || { id: s.cityId, name: s.cityName || getZoneById(s.cityId)?.name || s.cityId, count: 0 };
        cur.count += 1;
        map.set(s.cityId, cur);
    });
    return [...map.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'es'));
}

/** Números por categoría en una ciudad (Todas y categorías sin +18; la Zona +18 aparte). */
function cityStoreCounts(cityId) {
    const base = marketplaceBaseStores().filter((s) => storeInCity(s, cityId));
    const general = base.filter((s) => !isStoreAdultsOnly(s));
    const counts = {
        all: general.length,
        hot: general.filter((s) => storeHotInfo(s).isHot).length,
        adultos: canSeeAdultStores() ? base.filter((s) => isStoreAdultsOnly(s)).length : 0,
    };
    STORE_CATEGORIES.forEach((c) => {
        counts[c.id] = general.filter((s) => (s.category || 'otro') === c.id).length;
    });
    return counts;
}

/** <option> del selector de ciudad del cliente: primero las que tienen tiendas, luego todas. */
function buildBrowseCityOptionsHtml(selectedId = '') {
    const withStores = citiesWithStores();
    const ids = new Set(withStores.map((c) => c.id));
    let html = '';
    if (withStores.length) {
        html += '<optgroup label="Ciudades con tiendas">';
        withStores.forEach((c) => {
            html += `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)} (${c.count})</option>`;
        });
        html += '</optgroup>';
    }
    const groups = new Map();
    getAllKnownZones().filter((z) => z?.id && z?.name && !ids.has(z.id)).forEach((z) => {
        const us = isUsZone(z);
        const label = us ? `EE. UU. · ${z.department || 'Otras'}` : (z.department || 'Otras');
        if (!groups.has(label)) groups.set(label, { us, list: [] });
        groups.get(label).list.push(z);
    });
    [...groups.keys()].sort((a, b) => (groups.get(a).us ? 1 : 0) - (groups.get(b).us ? 1 : 0) || a.localeCompare(b, 'es'))
        .forEach((label) => {
            html += `<optgroup label="${esc(label)}">`;
            groups.get(label).list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')).forEach((z) => {
                html += `<option value="${esc(z.id)}" ${z.id === selectedId ? 'selected' : ''}>${esc(z.name)}</option>`;
            });
            html += '</optgroup>';
        });
    return html;
}

/** Honduras no usa horario de verano: UTC-6 todo el año. */
const HN_UTC_OFFSET_MIN = -6 * 60;

function hnNowMinutes(date = new Date()) {
    const utc = date.getUTCHours() * 60 + date.getUTCMinutes();
    return (utc + HN_UTC_OFFSET_MIN + 1440) % 1440;
}

function parseHHMM(v) {
    const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
}

function fmtHour12(min) {
    const h24 = Math.floor(min / 60) % 24;
    const mi = min % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(mi).padStart(2, '0')} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Horario diario de la tienda ({ open, close } en minutos) o null si no tiene. */
function storeHours(s) {
    const open = parseHHMM(s?.hours?.open);
    const close = parseHHMM(s?.hours?.close);
    if (open == null || close == null || open === close) return null;
    return { open, close };
}

/**
 * ¿Está abierta ahora? El interruptor del dueño (isOpen) manda; si además tiene horario,
 * fuera de horario sale cerrada. Hora de Honduras.
 * @returns {{ open: boolean, label: string }}
 */
function storeOpenInfo(s, now = hnNowMinutes()) {
    const h = storeHours(s);
    if (s?.isOpen === false) return { open: false, label: h ? `Abre ${fmtHour12(h.open)}` : '' };
    if (!h) return { open: true, label: '' };
    const within = h.open < h.close
        ? (now >= h.open && now < h.close)
        : (now >= h.open || now < h.close); // cierra después de medianoche
    return within
        ? { open: true, label: `Cierra ${fmtHour12(h.close)}` }
        : { open: false, label: `Abre ${fmtHour12(h.open)}` };
}

export function formatStoreHoursSummary(s) {
    const h = storeHours(s);
    if (!h) return 'Horario libre';
    return `${fmtHour12(h.open)} – ${fmtHour12(h.close)}`;
}

export function formatStoreBranchLabel(s) {
    const b = String(s?.branchName || '').trim();
    return b || '';
}

function getSavedSelectedStoreId(uid = getCurrentUser()?.uid) {
    if (!uid || typeof localStorage === 'undefined') return null;
    try { return localStorage.getItem(`hr_selected_my_store_${uid}`) || null; } catch (_) { return null; }
}

function setSavedSelectedStoreId(storeId, uid = getCurrentUser()?.uid) {
    if (!uid || typeof localStorage === 'undefined') return;
    try {
        if (storeId) localStorage.setItem(`hr_selected_my_store_${uid}`, String(storeId));
        else localStorage.removeItem(`hr_selected_my_store_${uid}`);
    } catch (_) {}
}

/**
 * Calificación (1-5 ★) y estado de "Producto estrella" de un plato.
 */
export function productRatingInfo(p) {
    const count = Math.max(0, Math.floor(Number(p?.ratingCount) || 0));
    const sum = Number(p?.ratingSum) || 0;
    const rawAvg = Number(p?.ratingAvg) || (count > 0 ? sum / count : 0);
    const avg = count > 0 ? Math.round(rawAvg * 10) / 10 : 0;
    const ordersCount = Math.max(0, Math.floor(Number(p?.ordersCount ?? p?.unitsSold) || 0));
    const isStar = Boolean(
        p?.isStarProduct
        || (avg >= 4.5 && count >= 1)
        || (avg >= 4.2 && ordersCount >= 3)
        || ordersCount >= 5
    );
    return { avg, count, ordersCount, isStar };
}

/**
 * Calcula el ranking de "Productos estrella" combinando datos del producto y pedidos entregados/calificados.
 */
export function computeStarProducts(products = [], orders = []) {
    const byId = new Map();
    for (const p of (products || [])) {
        if (!p || p.available === false) continue;
        byId.set(p.id, {
            ...p,
            _extraStarsSum: 0,
            _extraStarsCount: 0,
            _extraOrders: 0,
        });
    }
    for (const o of (orders || [])) {
        if (!o || o.status === 'cancelled') continue;
        const ratings = (o.productRatings && typeof o.productRatings === 'object') ? o.productRatings : {};
        const items = Array.isArray(o.items) ? o.items : [];
        for (const it of items) {
            const pid = it?.productId;
            if (!pid || !byId.has(pid)) continue;
            const entry = byId.get(pid);
            if (o.status === 'delivered' && !Number(entry.ordersCount)) {
                entry._extraOrders += Math.max(1, Number(it.qty) || 1);
            }
            const r = ratings[pid];
            const st = r ? Math.min(5, Math.max(1, Math.round(Number(r.stars) || 0))) : 0;
            if (st >= 1 && !Number(entry.ratingCount)) {
                entry._extraStarsSum += st;
                entry._extraStarsCount += 1;
            }
        }
    }
    const enriched = [...byId.values()].map((p) => {
        const baseCount = Math.max(0, Math.floor(Number(p.ratingCount) || 0));
        const count = baseCount || p._extraStarsCount;
        const avg = baseCount > 0
            ? Math.round((Number(p.ratingAvg) || (Number(p.ratingSum) / baseCount) || 0) * 10) / 10
            : (p._extraStarsCount > 0 ? Math.round((p._extraStarsSum / p._extraStarsCount) * 10) / 10 : 0);
        const ordersCount = Math.max(Number(p.ordersCount ?? p.unitsSold) || 0, p._extraOrders);
        const isStar = Boolean(
            p.isStarProduct
            || (avg >= 4.5 && count >= 1)
            || (avg >= 4.2 && ordersCount >= 3)
            || ordersCount >= 5
        );
        const score = (avg > 0 ? avg * 2 : 0) + Math.min(ordersCount, 25) * 0.35 + (isStar ? 3 : 0);
        return { ...p, ratingAvg: avg, ratingCount: count, ordersCount, isStarProduct: isStar, _starScore: score };
    });
    return enriched
        .filter((p) => p.isStarProduct || p.ratingCount > 0 || p.ordersCount > 0)
        .sort((a, b) => b._starScore - a._starScore || (b.ratingAvg || 0) - (a.ratingAvg || 0) || (b.ordersCount || 0) - (a.ordersCount || 0));
}

/**
 * Determina si un restaurante/tienda está "🔥 En fuego" (alta demanda de pedidos o calificación sobresaliente).
 */
export function storeHotInfo(s, activeOrdersCount = 0) {
    const ratingCount = Math.max(0, Math.floor(Number(s?.ratingCount) || 0));
    const ratingAvg = ratingCount > 0 ? Math.round((Number(s?.ratingAvg) || 0) * 10) / 10 : 0;
    const ordersCount = Math.max(0, Math.floor(Number(s?.ordersCount ?? s?.recentOrdersCount) || 0));
    const computedScore = ordersCount * 2 + activeOrdersCount * 4 + (ratingAvg >= 4.5 ? 6 : 0);
    const hotScore = Math.max(Number(s?.hotScore) || 0, computedScore);
    const isHot = Boolean(
        s?.isHot
        || hotScore >= 6
        || activeOrdersCount >= 2
        || ordersCount >= 3
        || (ratingAvg >= 4.6 && ratingCount >= 2)
    );
    const label = activeOrdersCount >= 2
        ? `${activeOrdersCount} pedidos activos`
        : (ordersCount >= 3 ? `${ordersCount} pedidos recientes` : 'Alta demanda');
    return { isHot, hotScore, ratingAvg, ratingCount, ordersCount, activeOrdersCount, label };
}

function storeInitials(name) {
    const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 'T';
    return ((words[0][0] || '') + (words[1]?.[0] || '')).toUpperCase();
}

/** Logo de la tienda o, si no tiene, sus iniciales con color por categoría. */
function storeAvatarHtml(s, extraCls = '') {
    const cat = esc(s?.category || 'otro');
    const img = s?.photoUrl
        ? `<img src="${esc(s.photoUrl)}" alt="" loading="lazy" onerror="this.remove()">`
        : '';
    return `<span class="hr-store-avatar hr-store-avatar--${cat} ${extraCls}" aria-hidden="true">${esc(storeInitials(s?.name))}${img}</span>`;
}

/* ===================== ZONA +18 · VERIFICACIÓN DE EDAD ===================== */

/**
 * ¿Mostrar el chip / la entrada "Zona +18"?
 * Solo mayores de edad confirmados (fecha de nacimiento del perfil) y staff.
 * Antes también salía (con candado) a cuentas sin fecha de nacimiento → QA: «visible para todos».
 * Sin fecha: no aparece; la persona la agrega en Mi perfil. Menores: nunca.
 * Interruptor general: APP_CONFIG.stores.adultZoneEnabled = false la apaga para todos (excepto staff).
 * El contenido +18 lo sigue filtrando el servidor (firestore.rules).
 */
function adultZoneVisible() {
    if (isStoresStaff()) return true;
    if (APP_CONFIG?.stores?.adultZoneEnabled === false) return false;
    return userIsAdult18();
}

function openAdultZone() {
    if (!adultZoneVisible() && canSeeAdultStores()) return toast('La Zona +18 no está disponible por ahora.', 'info');
    if (canSeeAdultStores()) {
        storesCategoryFilter = ADULT_ZONE_CHIP.id;
        marketplaceView = 'list';
        syncAdultStoresListener();
        return renderMarketplace();
    }
    if (!getCurrentUser()?.uid) return toast('Inicia sesión para entrar a la Zona +18', 'warning');
    if (getUserAgeYears() == null) return showAgeGateSheet();
    return toast('La Zona +18 es solo para mayores de 18 años.', 'warning');
}

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Hoja inferior: confirmar fecha de nacimiento (se pide una sola vez y se guarda en el perfil). */
function showAgeGateSheet() {
    document.getElementById('hr-age-gate')?.remove();
    const yNow = new Date().getFullYear();
    const days = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    const months = MONTHS_ES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    const years = Array.from({ length: yNow - 1919 }, (_, i) => `<option value="${yNow - i}">${yNow - i}</option>`).join('');
    const wrap = document.createElement('div');
    wrap.id = 'hr-age-gate';
    wrap.className = 'hr-sheet';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'hr-age-gate-title');
    wrap.innerHTML = `
        <div class="hr-sheet-backdrop" data-age-action="cancel"></div>
        <div class="hr-sheet-panel">
            <span class="hr-sheet-grip" aria-hidden="true"></span>
            <span class="hr-sheet-icon hr-sheet-icon--adult"><i class="fas fa-lock"></i></span>
            <h3 id="hr-age-gate-title" class="hr-sheet-title">Contenido para mayores de 18</h3>
            <p class="hr-sheet-text">Esta sección tiene productos para adultos. Para entrar, confirma tu fecha de nacimiento. Se guarda en tu perfil y no se vuelve a pedir.</p>
            <div class="hr-age-fields">
                <select id="hr-age-day" class="hr-age-select" aria-label="Día"><option value="">Día</option>${days}</select>
                <select id="hr-age-month" class="hr-age-select" aria-label="Mes"><option value="">Mes</option>${months}</select>
                <select id="hr-age-year" class="hr-age-select" aria-label="Año"><option value="">Año</option>${years}</select>
            </div>
            <button type="button" class="hr-sheet-btn hr-sheet-btn--adult" data-age-action="confirm">Confirmar edad</button>
            <button type="button" class="hr-sheet-btn hr-sheet-btn--ghost" data-age-action="cancel">Ahora no</button>
            <p class="hr-sheet-note">Menores de edad: la Zona +18 queda oculta por completo.</p>
        </div>
    `;
    document.body.appendChild(wrap);
    const close = () => {
        wrap.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-age-action]');
        if (!btn) return;
        if (btn.getAttribute('data-age-action') === 'cancel') return close();
        const d = Number(wrap.querySelector('#hr-age-day')?.value || 0);
        const m = Number(wrap.querySelector('#hr-age-month')?.value || 0);
        const y = Number(wrap.querySelector('#hr-age-year')?.value || 0);
        if (!d || !m || !y) return toast('Elige día, mes y año', 'warning');
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (dt.getUTCDate() !== d || dt.getUTCMonth() !== m - 1) return toast('Esa fecha no existe. Revisa el día.', 'warning');
        const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const age = calculateAge(ymd);
        if (age == null || age < 0) return toast('Fecha de nacimiento inválida', 'warning');
        const uid = getCurrentUser()?.uid;
        if (!uid) return toast('Inicia sesión para confirmar tu edad', 'warning');
        btn.disabled = true;
        try {
            if (typeof window.ownerProfilePatch !== 'function') throw new Error('perfil no disponible');
            await window.ownerProfilePatch(uid, { birthDate: ymd });
        } catch (e) {
            console.warn('[stores] age gate save', e);
            btn.disabled = false;
            return toast('No se pudo guardar tu fecha de nacimiento. Intenta de nuevo.', 'error');
        }
        const profile = getUserProfile() || window.userProfile;
        if (profile) profile.birthDate = ymd;
        if (window.userProfile && window.userProfile !== profile) window.userProfile.birthDate = ymd;
        close();
        if (age >= 18) {
            toast('Edad confirmada', 'success');
            storesCategoryFilter = ADULT_ZONE_CHIP.id;
            syncAdultStoresListener();
        } else {
            toast('La Zona +18 es solo para mayores de 18 años.', 'info');
            storesCategoryFilter = 'all';
        }
        marketplaceView = 'list';
        renderMarketplace();
    });
}

/** Carga (en segundo plano) 2 productos de cada tienda abierta para la vista rápida de la tarjeta. */
function ensureProductPreviews(list) {
    if (!dbRef) return;
    const now = hnNowMinutes();
    const todo = list
        .filter((s) => storeOpenInfo(s, now).open && !storeProductPreview.has(s.id) && !storeProductPreviewLoading.has(s.id))
        .slice(0, 12);
    todo.forEach((s) => {
        storeProductPreviewLoading.add(s.id);
        loadProducts(s.id)
            .then((prods) => storeProductPreview.set(s.id, prods.filter((p) => p.available !== false).slice(0, 2)))
            .catch(() => storeProductPreview.set(s.id, []))
            .finally(() => {
                storeProductPreviewLoading.delete(s.id);
                clearTimeout(storeProductPreviewRerender);
                storeProductPreviewRerender = setTimeout(() => {
                    const market = document.getElementById('stores-marketplace-panel');
                    if (marketplaceView === 'list' && market && !market.classList.contains('hidden')) renderMarketplace();
                }, 120);
            });
    });
}

function cartCount() {
    return cart.reduce((s, i) => s + (i.qty || 0), 0);
}

/** Total de productos al precio de la tienda. El envío de la zona no entra. */
function cartItemsDisplayTotal() {
    return cartBaseTotal();
}

/** La tienda ya no parte una tarifa en cada producto. El 10% se cobra a la semana. */
function cartBuyerTariffTotal() {
    return 0;
}

/** Lo que paga el cliente por los productos, sin el envío. */
function cartItemsTotal() {
    return cartBaseTotal();
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
    const needMarketRebuild = !market || market.getAttribute('data-layout') !== 'world-v5';

    if (needMarketRebuild) {
        const wasOpen = market && !market.classList.contains('hidden');
        market?.remove();
        market = document.createElement('div');
        market.id = 'stores-marketplace-panel';
        market.className = 'stores-world hidden';
        market.setAttribute('data-layout', 'world-v5');
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
                            <h2 id="stores-panel-title" class="stores-title">Tiendas</h2>
                            <p id="stores-panel-sub" class="stores-subtitle">Entrega en moto o Taxi VIP</p>
                        </div>
                        <label id="stores-city-picker" class="stores-city-pill" title="Cambiar ciudad">
                            <i class="fas fa-map-marker-alt"></i>
                            <span id="stores-city-pill-label">—</span>
                            <i class="fas fa-caret-down"></i>
                            <select id="stores-city-select" aria-label="Ciudad de las tiendas"></select>
                        </label>
                        <button type="button" class="stores-icon-btn" data-stores-action="my-orders" title="Mis pedidos" aria-label="Mis pedidos">
                            <i class="fas fa-receipt"></i>
                        </button>
                    </div>
                    <div id="stores-world-toolbar" class="stores-world-toolbar">
                        <div class="stores-search-wrap">
                            <i class="fas fa-search"></i>
                            <input type="search" id="stores-search-input" class="stores-search-input"
                                   placeholder="Buscar tiendas"
                                   autocomplete="off" enterkeyhint="search">
                            <button type="button" id="stores-search-clear" class="stores-search-clear hidden" data-stores-action="clear-search" aria-label="Limpiar búsqueda">×</button>
                        </div>
                        <div id="stores-category-chips" class="stores-category-chips" role="tablist" aria-label="Categorías"></div>
                        <div id="stores-merchant-chips" class="stores-merchant-chips" aria-label="Mi tienda"></div>
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
        const citySelect = market.querySelector('#stores-city-select');
        if (citySelect && citySelect.dataset.bound !== '1') {
            citySelect.dataset.bound = '1';
            citySelect.addEventListener('change', () => {
                storesBrowseCityId = citySelect.value || null;
                marketplaceView = 'list';
                renderMarketplace();
            });
        }
        if (wasOpen) {
            market.classList.remove('hidden');
            document.body.classList.add('stores-world-open', 'stores-panel-open');
        }
    }

    let merchant = document.getElementById('merchant-panel');
    if (!merchant || merchant.getAttribute('data-layout') !== 'world-v2') {
        const wasOpen = merchant && !merchant.classList.contains('hidden');
        merchant?.remove();
        merchant = document.createElement('div');
        merchant.id = 'merchant-panel';
        merchant.className = 'stores-world stores-world--merchant hidden';
        merchant.setAttribute('data-layout', 'world-v2');
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
                    <div id="merchant-store-switcher" class="merchant-store-switcher"></div>
                    <nav class="merchant-tabs" role="tablist">
                        <button type="button" class="merchant-tab active" data-merchant-tab="orders">Pedidos</button>
                        <button type="button" class="merchant-tab" data-merchant-tab="products">Menú</button>
                        <button type="button" class="merchant-tab" data-merchant-tab="store">Tienda</button>
                        <button type="button" class="merchant-tab" data-merchant-tab="pedir-envio">Pedir envío</button>
                        <button type="button" class="merchant-tab" data-merchant-tab="envios">Envíos</button>
                        <button type="button" class="merchant-tab" data-merchant-tab="semana">Semana</button>
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
    try {
        const mode = window.getPassengerHomeMode?.() || document.body?.dataset?.passengerMode || '';
        if (mode && mode !== 'home' && mode !== 'stores') {
            btn.classList.add('hidden');
        }
        window.setServicePickerFilter?.(
            mode === 'trip' ? ['moto', 'auto', 'taxi']
                : mode === 'delivery' ? ['delivery']
                : mode === 'freight' ? ['flete_paila', 'flete_camion']
                : mode === 'tow' ? ['grua']
                : null
        );
    } catch (_) {}
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
            <span>Mis tiendas / sucursales</span>
        </button>
        <button type="button" id="btn-merchant-create-store"
                class="w-full flex items-center justify-center gap-3 py-3 border border-amber-200 bg-amber-50 rounded-2xl text-sm font-bold text-amber-900 active:bg-amber-100">
            <i class="fas fa-plus-circle text-amber-600"></i>
            <span>Agregar sucursal o tienda</span>
        </button>
        <p class="text-[10px] text-slate-500 text-center font-semibold px-1">Puedes administrar varias sucursales (con distinta ubicación y horario) desde tu cuenta.</p>
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
        cBtn.innerHTML = `<i class="fas fa-plus-circle text-amber-600"></i><span>Agregar sucursal / tienda</span>`;
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

/** ¿Puede recibir tiendas +18 del servidor? (las reglas de Firestore validan lo mismo) */
function canSeeAdultStores() {
    return isStoresStaff() || userIsAdult18();
}

function rebuildStoresCache() {
    storesCache.clear();
    generalStoresById.forEach((v, k) => storesCache.set(k, v));
    adultStoresById.forEach((v, k) => storesCache.set(k, v));
    if (!document.getElementById('stores-marketplace-panel')?.classList.contains('hidden')
        && marketplaceView === 'list') {
        renderMarketplace();
    }
    refreshMyStoreFromCache();
}

/**
 * Tiendas del marketplace. Las +18 se filtran EN EL SERVIDOR (firestore.rules):
 * - Consulta general: solo adultsOnly == false (la reciben todos, también menores).
 * - Consulta +18: solo si el perfil tiene 18+ por fecha de nacimiento (o es staff).
 *   Un menor que intente esta consulta recibe permission-denied.
 * Las reglas no filtran: por eso cada consulta lleva el filtro que la regla exige.
 */
function startStoresListener() {
    if (!unsubStores) {
        // Límite alto para marketplace con muchos negocios (filtrado en cliente por ciudad/búsqueda)
        const q = query(publicCol('stores'),
            where('active', '==', true),
            where('adultsOnly', '==', false),
            limit(300));
        unsubStores = onSnapshot(q, (snap) => {
            generalStoresById.clear();
            snap.forEach((d) => generalStoresById.set(d.id, { id: d.id, ...d.data() }));
            rebuildStoresCache();
        }, (err) => {
            console.warn('[stores] listener', err);
            unsubStores = null;
        });
    }
    syncAdultStoresListener();
}

/** Prende/apaga la consulta +18 según la edad del perfil (se llama al abrir Tiendas). */
function syncAdultStoresListener() {
    const allowed = canSeeAdultStores();
    if (!allowed) {
        if (unsubAdultStores) {
            try { unsubAdultStores(); } catch (_) {}
            unsubAdultStores = null;
        }
        if (adultStoresById.size) {
            adultStoresById.clear();
            rebuildStoresCache();
        }
        return;
    }
    if (unsubAdultStores) return;
    const q = query(publicCol('stores'),
        where('active', '==', true),
        where('adultsOnly', '==', true),
        limit(300));
    unsubAdultStores = onSnapshot(q, (snap) => {
        adultStoresById.clear();
        snap.forEach((d) => adultStoresById.set(d.id, { id: d.id, ...d.data() }));
        rebuildStoresCache();
    }, (err) => {
        // permission-denied = el servidor no lo considera mayor de edad (o sin fecha de nacimiento)
        console.warn('[stores] listener +18', err?.code || err);
        unsubAdultStores = null;
        adultStoresById.clear();
        rebuildStoresCache();
    });
}

function sortOwnedStores(list = []) {
    return list.slice().sort((a, b) => {
        const ap = a.parentStoreId ? 1 : 0;
        const bp = b.parentStoreId ? 1 : 0;
        if (ap !== bp) return ap - bp;
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        if (ta !== tb) return ta - tb;
        return String(a.branchName || a.name || '').localeCompare(String(b.branchName || b.name || ''), 'es');
    });
}

function refreshMyStoreFromCache() {
    const uid = getCurrentUser()?.uid;
    if (!uid) {
        myStore = null;
        myStores = [];
        return;
    }
    const fromCache = [...storesCache.values()].filter((s) => s.ownerId === uid && s.deleted !== true);
    if (fromCache.length) {
        const merged = new Map(myStores.map((s) => [s.id, s]));
        fromCache.forEach((s) => merged.set(s.id, s));
        myStores = sortOwnedStores([...merged.values()]);
    }
    const savedId = getSavedSelectedStoreId(uid);
    if (myStore?.id && myStores.some((s) => s.id === myStore.id)) {
        myStore = myStores.find((s) => s.id === myStore.id) || myStore;
    } else if (savedId && myStores.some((s) => s.id === savedId)) {
        myStore = myStores.find((s) => s.id === savedId) || myStores[0] || null;
    } else if (myStores.length) {
        myStore = myStores[0];
    }
    updateMerchantOpenToggle();
    renderMerchantStoreSwitcher();
    syncDriverHotStoresOnMap();
}

async function loadMyStore(preferredStoreId = null) {
    const uid = getCurrentUser()?.uid;
    if (!uid) {
        myStore = null;
        myStores = [];
        return null;
    }
    try {
        const q = query(publicCol('stores'), where('ownerId', '==', uid), limit(25));
        const snap = await getDocs(q);
        if (snap.empty) {
            myStore = null;
            myStores = [];
            return null;
        }
        const list = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((s) => s.deleted !== true);
        myStores = sortOwnedStores(list);
        myStores.forEach((s) => storesCache.set(s.id, s));
        const wantedId = preferredStoreId || myStore?.id || getSavedSelectedStoreId(uid);
        myStore = (wantedId && myStores.find((s) => s.id === wantedId)) || myStores[0] || null;
        if (myStore?.id) setSavedSelectedStoreId(myStore.id, uid);
        try {
            window._hasMyStoreLoaded = true;
            window._hasMyStoreCache = !!myStore;
            if (uid) localStorage.setItem('honduraite_has_store_' + uid, myStore ? '1' : '0');
            if (myStore) {
                window.releaseMerchantDeliveryTripsFromPassengerUi?.();
                syncMerchantQuickAccessUi();
            }
        } catch (_) {}
        return myStore;
    } catch (e) {
        console.warn('[stores] loadMyStore', e);
        return myStore || null;
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
    const totalTxt = Number.isFinite(total) ? ` · ${formatLempiras(total)}` : '';
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
    renderMerchantStoreSwitcher();
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

let knownClientOrderStatusById = new Map();
let clientOrdersBootstrappedUid = null;
let clientLiveBannerTimer = null;

/** Texto de notificación en vivo dentro de la app para el cliente según estado del pedido. */
export function clientOrderNotificationCopy(o) {
    if (!o || !o.status) return null;
    const store = o.storeName || 'El restaurante';
    const rideLbl = orderRideName(o);
    const driverFirst = o.driverName ? String(o.driverName).trim().split(/\s+/)[0] : '';
    if (o.status === 'accepted') {
        return {
            tone: 'blue',
            icon: '✅',
            title: `Pedido aceptado · ${store}`,
            body: `${store} aceptó tu pedido. Pronto marcarán «Preparando el pedido».`,
            pill: `✅ ${store} aceptó tu pedido`,
            sub: 'El delivery se llamará hasta que el pedido esté preparado',
        };
    }
    if (o.status === 'preparing') {
        return {
            tone: 'violet',
            icon: '👨‍🍳',
            title: 'Preparando el pedido',
            body: `${store} está preparando tu pedido… El delivery llegará hasta que esté preparado.`,
            pill: `👨‍🍳 ${store} está preparando tu pedido…`,
            sub: 'El delivery se llama al marcar «Pedido preparado» para no perder tiempo',
        };
    }
    if (o.status === 'ready') {
        return {
            tone: 'emerald',
            icon: '✅',
            title: '¡Pedido preparado! Llamando a tu delivery',
            body: `${store} terminó de preparar tu pedido. Ya estamos llamando a tu delivery (${rideLbl}) para recogerlo.`,
            pill: `✅ ¡Pedido preparado! Ya estamos llamando a tu delivery…`,
            sub: `Buscando repartidor (${rideLbl}) hacia ${store}`,
        };
    }
    if (o.status === 'out_for_delivery') {
        return {
            tone: 'blue',
            icon: '🛵',
            title: 'Tu delivery va en camino',
            body: `${driverFirst ? `${driverFirst} ya recogió` : 'El repartidor ya lleva'} tu pedido de ${store} hacia tu dirección.`,
            pill: `🛵 Tu delivery${driverFirst ? ` (${driverFirst})` : ''} va en camino`,
            sub: `Pedido de ${store} en ruta a tu entrega`,
        };
    }
    if (o.status === 'delivered') {
        return {
            tone: 'emerald',
            icon: '🎉',
            title: '¡Pedido entregado!',
            body: `Tu pedido de ${store} fue entregado. ¡Buen provecho!`,
            pill: `🎉 Pedido entregado · ${store}`,
            sub: '¡Gracias por pedir en HonduRaite!',
        };
    }
    if (o.status === 'cancelled') {
        return {
            tone: 'red',
            icon: '❌',
            title: 'Pedido cancelado',
            body: o.cancelReason === 'out_of_stock'
                ? `${store} canceló el pedido porque se agotó un producto.`
                : `Tu pedido en ${store} fue cancelado.`,
            pill: `❌ Pedido cancelado · ${store}`,
            sub: 'Toca para revisar en Mis pedidos',
        };
    }
    return null;
}

function showClientOrderLiveBanner(o) {
    const copy = clientOrderNotificationCopy(o);
    if (!copy || typeof document === 'undefined') return;
    try { window.playEventNotificationTone?.('store_order_update'); } catch (_) {}
    try { navigator.vibrate?.([180, 90, 220]); } catch (_) {}
    toast(`${copy.icon} ${copy.title}: ${copy.body}`, copy.tone === 'red' ? 'warning' : 'success');

    let el = document.getElementById('client-order-live-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'client-order-live-banner';
        document.body.appendChild(el);
        el.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-dismiss-live-banner]')) {
                el.remove();
                return;
            }
            if (ev.target.closest('[data-open-live-order]')) {
                el.remove();
                openMarketplace();
                marketplaceView = 'my-orders';
                renderMarketplace();
            }
        });
    }
    el.className = `client-order-live-banner client-order-live-banner--${copy.tone}`;
    el.innerHTML = `
        <span class="client-order-live-banner__icon" aria-hidden="true">${copy.icon}</span>
        <div class="client-order-live-banner__body" data-open-live-order="1" style="cursor:pointer">
            <p class="client-order-live-banner__title">${esc(copy.title)}</p>
            <p class="client-order-live-banner__text">${esc(copy.body)}</p>
        </div>
        <button type="button" class="client-order-live-banner__btn" data-open-live-order="1">Ver pedido</button>
        <button type="button" class="client-order-live-banner__close" data-dismiss-live-banner="1" aria-label="Cerrar">×</button>
    `;
    if (clientLiveBannerTimer) clearTimeout(clientLiveBannerTimer);
    clientLiveBannerTimer = setTimeout(() => {
        try { document.getElementById('client-order-live-banner')?.remove(); } catch (_) {}
    }, 11000);
}

function activeClientOrderPillHtml() {
    const active = clientOrders.find((o) => ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'].includes(o.status));
    if (!active) return '';
    const copy = clientOrderNotificationCopy(active) || {
        icon: '⏳',
        pill: `⏳ Pedido enviado a ${active.storeName || 'la tienda'}`,
        sub: 'Esperando que el restaurante acepte y marque «Preparando el pedido»',
    };
    return `
        <div class="client-active-order-bar" data-stores-action="my-orders" role="button" tabindex="0">
            <span class="client-active-order-bar__dot" aria-hidden="true"></span>
            <div class="client-active-order-bar__text">
                <strong>${esc(copy.pill)}</strong>
                <small>${esc(copy.sub)}</small>
            </div>
            <span class="client-active-order-bar__cta">Mis pedidos</span>
        </div>
    `;
}

function handleClientOrdersListUpdate(nextOrders, uid) {
    const isBootstrap = clientOrdersBootstrappedUid !== uid;
    for (const o of nextOrders) {
        const prevStatus = knownClientOrderStatusById.get(o.id);
        if (!isBootstrap && prevStatus && prevStatus !== o.status) {
            if (['accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'].includes(o.status)) {
                showClientOrderLiveBanner(o);
            }
        }
        knownClientOrderStatusById.set(o.id, o.status);
    }
    clientOrdersBootstrappedUid = uid;
    clientOrders = nextOrders;
    const slot = typeof document !== 'undefined' ? document.getElementById('client-active-order-slot') : null;
    if (slot) slot.innerHTML = activeClientOrderPillHtml();
    if (marketplaceView === 'my-orders') renderMarketplace();
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
        const list = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        handleClientOrdersListUpdate(list, uid);
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
                    data-stores-action="create-store" title="Agregar sucursal o crear tienda">
                <i class="fas fa-plus"></i>
                <span>+ Sucursal / tienda</span>
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
    const counts = cityStoreCounts(browseCity().cityId);
    const adultAllowed = canSeeAdultStores();
    const chips = [
        { id: 'all', label: 'Todas', shortLabel: 'Todas', icon: 'fa-border-all' },
        { id: 'hot', label: '🔥 En fuego', shortLabel: '🔥 En fuego', icon: 'fa-fire' },
        ...STORE_CATEGORIES,
        // Zona +18: mayores de edad y staff; sin fecha de nacimiento sale con candado (pide la fecha). Menores: no.
        ...(adultZoneVisible() ? [ADULT_ZONE_CHIP] : []),
    ];
    if (storesCategoryFilter === ADULT_ZONE_CHIP.id && !adultAllowed) storesCategoryFilter = 'all';
    wrap.innerHTML = chips.map((c) => {
        const isAdult = c.id === ADULT_ZONE_CHIP.id;
        const short = isAdult ? '+18' : (c.shortLabel || c.label);
        const n = isAdult ? (adultAllowed ? counts.adultos : null) : (counts[c.id] ?? 0);
        return `
        <button type="button" class="stores-cat-chip ${isAdult ? 'stores-cat-chip--adult' : ''} ${storesCategoryFilter === c.id ? 'active' : ''}"
                data-stores-action="filter-cat" data-cat="${esc(c.id)}" role="tab"
                aria-selected="${storesCategoryFilter === c.id ? 'true' : 'false'}"
                title="${esc(c.label)}">
            <span class="stores-cat-chip-label" data-full="${esc(c.label)}" data-short="${esc(short)}">${esc(short)}</span>
            ${n != null ? `<span class="stores-cat-chip-count">${n}</span>` : ''}
            ${isAdult ? '<i class="fas fa-lock stores-cat-chip-lock" aria-label="con candado"></i>' : ''}
        </button>`;
    }).join('');
}

/** Selector de ciudad del encabezado + texto del buscador. */
function syncCityPicker() {
    const city = browseCity();
    const lbl = document.getElementById('stores-city-pill-label');
    if (lbl) lbl.textContent = city.cityName;
    const sel = document.getElementById('stores-city-select');
    if (sel) {
        const key = `${citiesWithStores().map((c) => `${c.id}:${c.count}`).join('|')}#${city.cityId}`;
        if (sel.dataset.key !== key) {
            sel.innerHTML = buildBrowseCityOptionsHtml(city.cityId);
            sel.dataset.key = key;
        }
        sel.value = city.cityId;
    }
    const input = document.getElementById('stores-search-input');
    if (input) input.placeholder = `Buscar tiendas en ${city.cityName}`;
}

function filteredStoreList() {
    const city = browseCity();
    const q = storesSearchQuery.trim().toLowerCase();
    // Público: solo tiendas aprobadas por supervisores. Staff ve todas (moderar).
    let all = marketplaceBaseStores();

    // +18 nunca en la lista general (Todas, categorías ni búsqueda); solo en la Zona +18
    if (storesCategoryFilter === ADULT_ZONE_CHIP.id) {
        all = canSeeAdultStores() ? all.filter((s) => isStoreAdultsOnly(s)) : [];
    } else {
        all = all.filter((s) => !isStoreAdultsOnly(s));
        if (storesCategoryFilter === 'hot') {
            all = all.filter((s) => storeHotInfo(s).isHot);
        } else if (storesCategoryFilter && storesCategoryFilter !== 'all') {
            all = all.filter((s) => (s.category || 'otro') === storesCategoryFilter);
        }
    }

    // Solo tiendas de la ciudad elegida (ya no se mezclan otras ciudades si no hay)
    let list = all.filter((s) => storeInCity(s, city.cityId));

    if (q) {
        list = list.filter((s) => {
            const hay = `${s.name || ''} ${s.branchName || ''} ${s.description || ''} ${s.address || ''} ${s.category || ''} ${s.cityName || ''}`.toLowerCase();
            return hay.includes(q);
        });
    }

    const now = hnNowMinutes();
    return list.sort((a, b) => {
        const ao = storeOpenInfo(a, now).open ? 0 : 1;
        const bo = storeOpenInfo(b, now).open ? 0 : 1;
        const ap = storeApprovalStatus(a) === 'approved' ? 0 : 1;
        const bp = storeApprovalStatus(b) === 'approved' ? 0 : 1;
        return ap - bp || ao - bo || String(a.name || '').localeCompare(String(b.name || ''), 'es');
    });
}

function updateStoresMeta(listLen) {
    const city = browseCity();
    const cityEl = document.getElementById('stores-city-label');
    const countEl = document.getElementById('stores-count-label');
    if (cityEl) cityEl.innerHTML = `<i class="fas fa-map-marker-alt"></i> ${esc(city.cityName)}`;
    if (countEl) {
        countEl.textContent = listLen === 1 ? '1 tienda' : `${listLen} tiendas`;
    }
}

function setToolbarVisible(show) {
    document.getElementById('stores-world-toolbar')?.classList.toggle('hidden', !show);
    document.getElementById('stores-city-picker')?.classList.toggle('hidden', !show);
    document.getElementById('stores-panel-sub')?.classList.toggle('hidden', !show);
}

function storesSectionHtml(title, tone, aside, stores) {
    return `
        <section class="hr-stores-section">
            <div class="hr-stores-section-head">
                <p class="hr-stores-section-title"><span class="hr-dot hr-dot--${tone}"></span>${esc(title)}</p>
                <span class="hr-stores-section-aside">${esc(aside)}</span>
            </div>
            <div class="stores-browse-grid" role="list">${stores.map(storeCardHtml).join('')}</div>
        </section>`;
}

function adultZoneEntryHtml() {
    const allowed = canSeeAdultStores();
    return `
        <button type="button" class="hr-adult-entry" data-stores-action="filter-cat" data-cat="${esc(ADULT_ZONE_CHIP.id)}">
            <span class="hr-adult-entry-icon"><i class="fas fa-lock"></i></span>
            <span class="min-w-0 flex-1">
                <strong>Zona +18</strong>
                <small>Productos para adultos · separada de la lista general${allowed ? '' : ' · confirma tu edad para entrar'}</small>
            </span>
            <i class="fas fa-chevron-right"></i>
        </button>`;
}

export function buildHotStoresStripHtml(stores = []) {
    const now = hnNowMinutes();
    const hotList = (stores || [])
        .filter((s) => !isStoreAdultsOnly(s) && storeHotInfo(s).isHot)
        .sort((a, b) => storeHotInfo(b).hotScore - storeHotInfo(a).hotScore);
    if (!hotList.length) return '';
    return `
        <section class="hot-stores-strip" aria-label="Restaurantes en fuego">
            <div class="hot-stores-strip__head">
                <div>
                    <p class="hot-stores-strip__title">🔥 Restaurantes en fuego</p>
                    <p class="hot-stores-strip__sub">Los más pedidos y mejor puntuados ahorita</p>
                </div>
                <button type="button" class="hot-stores-strip__filter" data-stores-action="filter-cat" data-cat="hot">
                    Ver todos (${hotList.length})
                </button>
            </div>
            <div class="hot-stores-strip__scroller" role="list">
                ${hotList.slice(0, 8).map((s) => {
                    const hot = storeHotInfo(s);
                    const openInfo = storeOpenInfo(s, now);
                    const branch = formatStoreBranchLabel(s);
                    return `
                        <button type="button" class="hot-store-pill" data-stores-action="open-store" data-store-id="${esc(s.id)}" role="listitem">
                            <span class="hot-store-pill__fire" aria-hidden="true">🔥</span>
                            <span class="hot-store-pill__body">
                                <strong class="hot-store-pill__name">${esc(s.name || 'Restaurante')}${branch ? ` <small class="hot-store-pill__branch">· ${esc(branch)}</small>` : ''}</strong>
                                <span class="hot-store-pill__meta">
                                    ${hot.ratingCount > 0 ? `<span class="hot-store-pill__stars">★ ${hot.ratingAvg.toFixed(1)} (${hot.ratingCount})</span> · ` : ''}
                                    <span>${esc(hot.label)}</span>
                                    · <span class="${openInfo.open ? 'text-emerald-700' : 'text-slate-500'}">${openInfo.open ? 'Abierto' : 'Cerrado'}</span>
                                </span>
                            </span>
                        </button>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

export function buildStoreStarProductsSectionHtml(products = [], store = viewingStore) {
    const stars = computeStarProducts(products, clientOrders.filter((o) => o.storeId === store?.id)).slice(0, 4);
    if (!stars.length) return '';
    return `
        <section class="store-star-products" aria-label="Productos estrella del restaurante">
            <div class="store-star-products__head">
                <p class="store-star-products__title">⭐ Productos estrella de este restaurante</p>
                <span class="store-star-products__badge">Favoritos de los clientes</span>
            </div>
            <div class="store-star-products__grid">
                ${stars.map((p) => {
                    const price = productBasePrice(p);
                    const rInfo = productRatingInfo(p);
                    const available = productCanSell(p, store);
                    return `
                        <div class="store-star-card" data-star-product-id="${esc(p.id)}">
                            ${productPhotoHtml(p, 'store-star-card__photo')}
                            <div class="store-star-card__info">
                                <div class="store-star-card__badges">
                                    <span class="star-pill">⭐ Producto estrella</span>
                                    ${rInfo.count > 0 ? `<span class="star-rating-chip">★ ${rInfo.avg.toFixed(1)} (${rInfo.count})</span>` : ''}
                                    ${rInfo.ordersCount > 0 ? `<span class="star-orders-chip">🔥 ${rInfo.ordersCount} pedidos</span>` : ''}
                                </div>
                                <p class="store-star-card__name">${esc(p.name)}</p>
                                <p class="store-star-card__price">${money(price)}</p>
                            </div>
                            ${available ? `
                                <button type="button" class="stores-add-btn" data-stores-action="cart-add" data-product-id="${esc(p.id)}">Agregar</button>
                            ` : `<span class="text-[10px] font-bold text-slate-400">Agotado</span>`}
                        </div>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

function renderMarketplace() {
    const body = document.getElementById('stores-panel-body');
    if (!body) return;

    if (marketplaceView === 'list') {
        setMarketplaceTitle('Tiendas');
        setToolbarVisible(true);
        renderCategoryChips();
        syncCityPicker();
        const city = browseCity();
        const list = filteredStoreList();
        updateStoresMeta(list.length);
        const now = hnNowMinutes();
        const openList = list.filter((s) => storeOpenInfo(s, now).open);
        const closedList = list.filter((s) => !storeOpenInfo(s, now).open);
        const isAdultView = storesCategoryFilter === ADULT_ZONE_CHIP.id;
        const filtering = !!storesSearchQuery.trim() || (storesCategoryFilter !== 'all' && !isAdultView);
        const parts = [];

        if (isAdultView) {
            parts.push(`
                <div class="hr-adult-banner">
                    <span class="hr-adult-entry-icon"><i class="fas fa-lock"></i></span>
                    <div class="min-w-0 flex-1">
                        <strong>Zona +18</strong>
                        <small>Productos para adultos · separada de la lista general</small>
                    </div>
                    <button type="button" class="hr-link-btn" data-stores-action="clear-filters">Salir</button>
                </div>`);
        }
        if (!isAdultView && storesCategoryFilter === 'all' && !storesSearchQuery.trim()) {
            const hotStrip = buildHotStoresStripHtml(list);
            if (hotStrip) parts.push(hotStrip);
        }
        if (!list.length) {
            const others = citiesWithStores().filter((c) => c.id !== city.cityId).slice(0, 4);
            parts.push(`
                <div class="hr-empty-card">
                    <p class="hr-empty-title">${filtering
                        ? 'No hay tiendas con ese filtro'
                        : isAdultView ? 'Aún no hay tiendas +18 aquí' : 'Aún no hay tiendas abiertas aquí'}</p>
                    <p class="hr-empty-sub">${filtering
                        ? `Prueba otra categoría o quita la búsqueda en ${esc(city.cityName)}.`
                        : `Pronto habrá más negocios en ${esc(city.cityName)}.`}</p>
                    <div class="hr-empty-actions">
                        ${filtering ? '<button type="button" class="stores-secondary-btn" data-stores-action="clear-filters">Ver todas</button>' : ''}
                        ${!isAdultView ? others.map((c) => `
                            <button type="button" class="stores-secondary-btn" data-stores-action="browse-city" data-city-id="${esc(c.id)}">
                                <i class="fas fa-map-marker-alt"></i> ${esc(c.name)} · ${c.count === 1 ? '1 tienda' : `${c.count} tiendas`}
                            </button>`).join('') : ''}
                        <button type="button" class="stores-primary-btn" data-stores-action="create-store">
                            <i class="fas fa-plus"></i> Crear tienda
                        </button>
                    </div>
                </div>`);
        } else {
            if (openList.length) {
                parts.push(storesSectionHtml('Abiertas ahora', 'open',
                    openList.length === 1 ? '1 tienda' : `${openList.length} tiendas`, openList));
            } else {
                parts.push(`
                    <div class="hr-empty-card hr-empty-card--soft">
                        <p class="hr-empty-title">Ninguna tienda abierta ahora</p>
                        <p class="hr-empty-sub">Mira abajo a qué hora abren en ${esc(city.cityName)}.</p>
                    </div>`);
            }
            if (closedList.length) parts.push(storesSectionHtml('Cerradas por ahora', 'closed', 'van al final', closedList));
        }
        if (!isAdultView && adultZoneVisible()) parts.push(adultZoneEntryHtml());
        if (!isAdultView) {
            parts.push(`<p class="hr-stores-footnote">Las tiendas marcadas +18 no aparecen en esta lista general. Solo se muestran a cuentas verificadas como mayores de edad.</p>`);
        }
        body.innerHTML = parts.join('');
        ensureProductPreviews(list);
    } else if (marketplaceView === 'store' && viewingStore) {
        setToolbarVisible(false);
        setMarketplaceTitle(viewingStore.name || 'Tienda');
        const openInfo = storeOpenInfo(viewingStore);
        const open = openInfo.open;
        const adults = isStoreAdultsOnly(viewingStore);
        const appr = storeApprovalStatus(viewingStore);
        const apprMeta = STORE_APPROVAL[appr] || STORE_APPROVAL.pending;
        const logoBlock = viewingStore.photoUrl
            ? `<button type="button" class="store-detail-logo-wrap product-photo-zoom-btn" data-stores-action="zoom-product-photo" data-photo-url="${esc(viewingStore.photoUrl)}" data-photo-title="${esc(viewingStore.name || 'Tienda')}" data-photo-desc="${esc(viewingStore.description || viewingStore.address || '')}" title="Toca para ampliar foto" aria-label="Ampliar foto de ${esc(viewingStore.name || 'Tienda')}"><img class="store-detail-logo" src="${esc(viewingStore.photoUrl)}" alt="${esc(viewingStore.name || 'Tienda')}" loading="lazy" onerror="this.style.opacity='0'"><span class="product-photo-zoom-badge" aria-hidden="true"><i class="fas fa-search-plus"></i></span></button>`
            : storeAvatarHtml(viewingStore, 'hr-store-avatar--lg');
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
                    <p class="store-detail-name">${esc(viewingStore.name)}${viewingStore.branchName ? ` <span class="hr-pill hr-pill--branch">📍 ${esc(viewingStore.branchName)}</span>` : ''}${adults ? ' <span class="store-badge-18">+18</span>' : ''}</p>
                    <p class="store-detail-meta">${esc(catLabel(viewingStore.category))}${viewingStore.cityName ? ` · ${esc(viewingStore.cityName)}` : ''}</p>
                    <div class="hr-pills">
                        <span class="hr-pill ${open ? 'hr-pill--open' : 'hr-pill--closed'}">${open ? '<span class="hr-dot hr-dot--open"></span>Abierta' : 'Cerrada'}</span>
                        ${openInfo.label ? `<span class="hr-pill">${esc(openInfo.label)}</span>` : ''}
                        ${(() => {
                            const hot = storeHotInfo(viewingStore);
                            return `${hot.isHot ? '<span class="hr-pill hr-pill--hot">🔥 En fuego</span>' : ''}${hot.ratingCount > 0 ? `<span class="hr-pill hr-pill--star">★ ${hot.ratingAvg.toFixed(1)} (${hot.ratingCount})</span>` : ''}`;
                        })()}
                        <span class="hr-pill hr-pill--soft">Moto</span>
                        <span class="hr-pill hr-pill--soft">Taxi VIP</span>
                    </div>
                    ${viewingStore.address ? `<p class="store-detail-addr"><i class="fas fa-map-marker-alt"></i> ${esc(viewingStore.address)}</p>` : ''}
                    ${viewingStore.description ? `<p class="store-detail-desc">${esc(viewingStore.description)}</p>` : ''}
                    ${adults ? `<p class="text-[11px] font-bold text-rose-700 mt-1"><i class="fas fa-exclamation-triangle"></i> Solo mayores de 18 años</p>` : ''}
                </div>
            </div>
            ${staffBar}
            ${formatStoreMenuDeliveryLine(storeMenuDeliveryState, viewingStore).bannerHtml}
            ${buildStoreStarProductsSectionHtml(viewingProducts, viewingStore)}
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
    const info = storeOpenInfo(s);
    const open = info.open;
    const staff = isStoresStaff();
    const adults = isStoreAdultsOnly(s);
    const appr = storeApprovalStatus(s);
    const apprMeta = STORE_APPROVAL[appr] || STORE_APPROVAL.pending;
    const preview = open ? (storeProductPreview.get(s.id) || []) : [];
    const adminDelete = staff
        ? `<button type="button" class="store-admin-delete-btn" data-stores-action="admin-delete-store" data-store-id="${esc(s.id)}" title="Borrar tienda (admin/supervisor)">
                <i class="fas fa-trash-alt pointer-events-none"></i>
                <span class="pointer-events-none">Borrar</span>
           </button>`
        : '';
    return `
        <div class="store-card-wrap ${staff ? 'store-card-wrap--staff' : ''} ${appr !== 'approved' ? 'store-card-wrap--pending' : ''}" role="listitem">
            <button type="button" class="hr-store-card ${open ? '' : 'is-closed'}" data-stores-action="open-store" data-store-id="${esc(s.id)}">
                <span class="hr-store-card-head">
                    ${storeAvatarHtml(s)}
                    <span class="hr-store-card-info">
                        <span class="hr-store-name">${esc(s.name || 'Tienda')}${s.branchName ? ` <span class="hr-store-branch-tag">· ${esc(s.branchName)}</span>` : ''}</span>
                        <span class="hr-store-meta">${esc(catLabel(s.category))}${s.cityName ? ` · ${esc(s.cityName)}` : ''}${s.address ? ` · ${esc(s.address)}` : ''}</span>
                        <span class="hr-pills">
                            <span class="hr-pill ${open ? 'hr-pill--open' : 'hr-pill--closed'}">${open ? '<span class="hr-dot hr-dot--open"></span>Abierta' : 'Cerrada'}</span>
                            ${info.label ? `<span class="hr-pill">${esc(info.label)}</span>` : ''}
                            ${(() => {
                                const hot = storeHotInfo(s);
                                return `${hot.isHot ? '<span class="hr-pill hr-pill--hot">🔥 En fuego</span>' : ''}${hot.ratingCount > 0 ? `<span class="hr-pill hr-pill--star">★ ${hot.ratingAvg.toFixed(1)} (${hot.ratingCount})</span>` : ''}`;
                            })()}
                            ${adults ? '<span class="hr-pill hr-pill--adult">+18</span>' : ''}
                            ${staff && appr !== 'approved' ? `<span class="hr-pill hr-pill--${esc(apprMeta.tone)}">${esc(apprMeta.label)}</span>` : ''}
                        </span>
                    </span>
                </span>
                ${preview.length ? `
                    <span class="hr-store-products">
                        ${preview.map((p) => `
                            <span class="hr-store-product">
                                <span class="hr-store-product-name">${esc(p.name || 'Producto')}</span>
                                <span class="hr-store-product-price">${money(productDisplayPrice(p))}</span>
                            </span>`).join('')}
                    </span>` : ''}
                ${open ? `
                    <span class="hr-pills hr-pills--delivery">
                        <span class="hr-pill hr-pill--soft"><i class="fas fa-motorcycle"></i> Moto</span>
                        <span class="hr-pill hr-pill--soft"><i class="fas fa-taxi"></i> Taxi VIP</span>
                    </span>` : ''}
                ${staff && s.ownerId ? `<span class="store-card-owner-id">Dueño: ${esc(String(s.ownerId).slice(0, 10))}…</span>` : ''}
            </button>
            ${adminDelete}
        </div>
    `;
}

const storeMenuDeliveryState = {
    storeId: null,
    status: 'idle', // idle | loading | ready
    point: null,
    quote: null,
    distanceFareMoto: null,
    distanceFareCar: null,
    distanceKm: null,
    seq: 0,
};

function detectUserCoordsForStoreMenu() {
    const pt = checkoutPoint();
    if (pt && validCoords(pt.lat, pt.lng)) {
        return { lat: Number(pt.lat), lng: Number(pt.lng) };
    }
    return null;
}

function computeStoreDistanceFallback(store, point) {
    if (!validCoords(store?.lat, store?.lng) || !validCoords(point?.lat, point?.lng)) return null;
    const km = Math.round(Math.max(0.5, haversineKm(Number(store.lat), Number(store.lng), Number(point.lat), Number(point.lng))) * 100) / 100;
    const fareRes = calculateServiceFare('delivery', km, null, 1);
    const moto = roundMoney(Number(fareRes?.price ?? fareRes?.total ?? fareRes) || 0);
    if (!Number.isFinite(moto) || moto <= 0) return null;
    const car = computeCarDeliveryFee(moto);
    return { km, moto, car };
}

export function formatStoreMenuDeliveryLine(state = storeMenuDeliveryState, store = viewingStore) {
    const q = state?.quote;
    if (q?.inZone && q.fee != null && Number.isFinite(Number(q.fee))) {
        const feeMoto = money(q.feeMoto ?? q.fee);
        const rawCar = q.feeCar != null && Number.isFinite(Number(q.feeCar))
            ? Math.max(CAR_MIN_DELIVERY_FEE, Number(q.feeCar))
            : computeCarDeliveryFee(q.feeMoto ?? q.fee);
        const feeCar = Number.isFinite(rawCar) ? ` · Carro ${money(rawCar)}` : '';
        return {
            kind: 'zone',
            html: `<p class="product-card-delivery product-card-delivery--zone" data-store-delivery-line="1">🛵 Envío a ${esc(q.zoneName || 'tu zona')}: <b>${esc(feeMoto)}</b>${esc(feeCar)}</p>`,
            bannerHtml: `<div id="store-menu-delivery-banner" class="store-delivery-zone-banner store-delivery-zone-banner--ok"><i class="fas fa-motorcycle"></i><div class="min-w-0 flex-1"><b>🛵 Envío a ${esc(q.zoneName || 'tu zona')}: ${esc(feeMoto)}</b><small>En moto ${esc(feeMoto)}${esc(feeCar)} · se paga al conductor</small></div><button type="button" class="store-delivery-zone-banner__btn" data-stores-action="detect-store-fee-gps"><i class="fas fa-location-arrow"></i> Mi ubicación</button></div>`,
        };
    }
    if (q?.blocked) {
        return {
            kind: 'blocked',
            html: `<p class="product-card-delivery product-card-delivery--blocked" data-store-delivery-line="1"><i class="fas fa-ban"></i> Fuera de la zona de envío de esta tienda</p>`,
            bannerHtml: `<div id="store-menu-delivery-banner" class="store-delivery-zone-banner store-delivery-zone-banner--warn"><i class="fas fa-ban"></i><div class="min-w-0 flex-1"><b>Tu ubicación está fuera de las zonas de envío de esta tienda</b><small>Si vas a recibir en otra dirección, actualiza tu ubicación.</small></div><button type="button" class="store-delivery-zone-banner__btn" data-stores-action="detect-store-fee-gps"><i class="fas fa-location-arrow"></i> Actualizar GPS</button></div>`,
        };
    }
    if (state?.point && Number.isFinite(Number(state?.distanceFareMoto)) && Number(state.distanceFareMoto) > 0) {
        const feeMoto = money(state.distanceFareMoto);
        const feeCar = Number.isFinite(Number(state.distanceFareCar)) && Number(state.distanceFareCar) > 0
            ? ` · Carro ${money(state.distanceFareCar)}`
            : '';
        return {
            kind: 'distance',
            html: `<p class="product-card-delivery product-card-delivery--distance" data-store-delivery-line="1">🛵 Envío a tu ubicación: <b>${esc(feeMoto)}</b>${esc(feeCar)}</p>`,
            bannerHtml: `<div id="store-menu-delivery-banner" class="store-delivery-zone-banner store-delivery-zone-banner--ok"><i class="fas fa-motorcycle"></i><div class="min-w-0 flex-1"><b>🛵 Envío a tu ubicación: ${esc(feeMoto)}</b><small>Tarifa según tu ubicación${state.distanceKm ? ` (${Number(state.distanceKm).toFixed(1)} km)` : ''}${esc(feeCar)} · se paga al conductor</small></div><button type="button" class="store-delivery-zone-banner__btn" data-stores-action="detect-store-fee-gps"><i class="fas fa-location-arrow"></i> Mi ubicación</button></div>`,
        };
    }
    if (state?.status === 'loading') {
        return {
            kind: 'loading',
            html: `<p class="product-card-delivery product-card-delivery--loading" data-store-delivery-line="1"><i class="fas fa-spinner fa-spin"></i> Calculando envío a tu zona…</p>`,
            bannerHtml: `<div id="store-menu-delivery-banner" class="store-delivery-zone-banner"><i class="fas fa-spinner fa-spin"></i><div class="min-w-0 flex-1"><b>Calculando envío según tu zona…</b><small>Consultando tarifa para tu ubicación</small></div></div>`,
        };
    }
    return {
        kind: 'prompt',
        html: `<button type="button" class="product-card-delivery product-card-delivery--prompt" data-store-delivery-line="1" data-stores-action="detect-store-fee-gps">📍 Toca para ver el envío a tu ubicación</button>`,
        bannerHtml: `<div id="store-menu-delivery-banner" class="store-delivery-zone-banner store-delivery-zone-banner--prompt"><i class="fas fa-map-marker-alt"></i><div class="min-w-0 flex-1"><b>📍 ¿Cuánto cuesta el envío a tu zona?</b><small>Activa tu ubicación para ver el monto exacto de envío en cada producto.</small></div><button type="button" class="store-delivery-zone-banner__btn" data-stores-action="detect-store-fee-gps"><i class="fas fa-location-arrow"></i> Ver mi envío</button></div>`,
    };
}

function updateStoreMenuDeliveryDom() {
    if (typeof document === 'undefined') return;
    const fmt = formatStoreMenuDeliveryLine(storeMenuDeliveryState, viewingStore);
    const banner = document.getElementById('store-menu-delivery-banner');
    if (banner) {
        banner.outerHTML = fmt.bannerHtml;
    }
    document.querySelectorAll('[data-store-delivery-line]').forEach((el) => {
        el.outerHTML = fmt.html;
    });
}

export async function refreshStoreMenuDeliveryQuote(store = viewingStore, { force = false, pointOverride = null } = {}) {
    if (!store?.id) return null;
    const pt = pointOverride || detectUserCoordsForStoreMenu();
    if (!pt) {
        storeMenuDeliveryState.storeId = store.id;
        storeMenuDeliveryState.point = null;
        storeMenuDeliveryState.quote = null;
        storeMenuDeliveryState.distanceFareMoto = null;
        storeMenuDeliveryState.distanceFareCar = null;
        storeMenuDeliveryState.distanceKm = null;
        storeMenuDeliveryState.status = 'idle';
        updateStoreMenuDeliveryDom();
        // Si el permiso de ubicación ya está concedido, obtener coordenadas en silencio
        try {
            if (typeof navigator !== 'undefined' && navigator.permissions?.query && navigator.geolocation?.getCurrentPosition) {
                const perm = await navigator.permissions.query({ name: 'geolocation' });
                if (perm?.state === 'granted') {
                    navigator.geolocation.getCurrentPosition((pos) => {
                        const lat = Number(pos?.coords?.latitude);
                        const lng = Number(pos?.coords?.longitude);
                        if (validCoords(lat, lng)) {
                            setCheckoutPoint({ lat, lng }, 'gps');
                            refreshStoreMenuDeliveryQuote(store, { force: true, pointOverride: { lat, lng } }).catch(() => {});
                        }
                    }, () => {}, { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 });
                }
            }
        } catch (_) {}
        return null;
    }

    setCheckoutPoint(pt, checkoutPointSource() || 'auto');
    const sameStoreAndPoint = !force
        && storeMenuDeliveryState.storeId === store.id
        && storeMenuDeliveryState.status === 'ready'
        && storeMenuDeliveryState.point
        && Math.abs(storeMenuDeliveryState.point.lat - pt.lat) < 0.0002
        && Math.abs(storeMenuDeliveryState.point.lng - pt.lng) < 0.0002;
    if (sameStoreAndPoint) {
        updateStoreMenuDeliveryDom();
        return storeMenuDeliveryState;
    }

    const seq = ++storeMenuDeliveryState.seq;
    storeMenuDeliveryState.storeId = store.id;
    storeMenuDeliveryState.point = { lat: Number(pt.lat), lng: Number(pt.lng) };
    storeMenuDeliveryState.status = 'loading';
    const distFallback = computeStoreDistanceFallback(store, pt);
    storeMenuDeliveryState.distanceKm = distFallback?.km ?? null;
    storeMenuDeliveryState.distanceFareMoto = distFallback?.moto ?? null;
    storeMenuDeliveryState.distanceFareCar = distFallback?.car ?? null;
    updateStoreMenuDeliveryDom();

    try {
        const q = await quoteStoreDeliveryFeeFor({
            storeId: store.id,
            lat: Number(pt.lat),
            lng: Number(pt.lng),
            vehicle: 'moto',
        });
        if (seq !== storeMenuDeliveryState.seq) return storeMenuDeliveryState;
        storeMenuDeliveryState.quote = q || null;
        storeMenuDeliveryState.status = 'ready';
    } catch (_) {
        if (seq !== storeMenuDeliveryState.seq) return storeMenuDeliveryState;
        storeMenuDeliveryState.quote = null;
        storeMenuDeliveryState.status = 'ready';
    }
    updateStoreMenuDeliveryDom();
    return storeMenuDeliveryState;
}

function detectStoreMenuFeeWithGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation?.getCurrentPosition) {
        return toast('Tu teléfono no permite usar la ubicación', 'warning');
    }
    storeMenuDeliveryState.status = 'loading';
    updateStoreMenuDeliveryDom();
    toast('Obteniendo tu ubicación para calcular el envío…', 'info');
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const lat = Number(pos?.coords?.latitude);
            const lng = Number(pos?.coords?.longitude);
            if (!validCoords(lat, lng)) {
                storeMenuDeliveryState.status = 'idle';
                updateStoreMenuDeliveryDom();
                return toast('Ubicación inválida', 'warning');
            }
            setCheckoutPoint({ lat, lng }, 'gps');
            await refreshStoreMenuDeliveryQuote(viewingStore, { force: true, pointOverride: { lat, lng } });
            const q = storeMenuDeliveryState.quote;
            if (q?.inZone && q.fee != null) {
                toast(`Envío a ${q.zoneName || 'tu zona'}: ${money(q.feeMoto ?? q.fee)}`, 'success');
            } else if (storeMenuDeliveryState.distanceFareMoto) {
                toast(`Envío a tu ubicación: ${money(storeMenuDeliveryState.distanceFareMoto)}`, 'success');
            }
        },
        () => {
            storeMenuDeliveryState.status = 'idle';
            updateStoreMenuDeliveryDom();
            toast('No se pudo obtener tu ubicación. Activa el GPS e intenta de nuevo.', 'warning');
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
}

export function productPhotoHtml(p, cls = 'product-card-photo') {
    if (p?.photoUrl) {
        const price = productBasePrice(p);
        return `<button type="button" class="product-photo-zoom-btn" data-stores-action="zoom-product-photo" data-product-id="${esc(p.id || '')}" data-photo-url="${esc(p.photoUrl)}" data-photo-title="${esc(p.name || 'Producto')}" data-photo-desc="${esc(p.description || '')}" data-photo-price="${esc(price > 0 ? money(price) : '')}" title="Toca para ampliar foto" aria-label="Ampliar foto de ${esc(p.name || 'Producto')}"><img class="${cls}" src="${esc(p.photoUrl)}" alt="${esc(p.name || 'Producto')}" loading="lazy" onerror="this.classList.add('is-broken');this.src='';this.alt='';"><span class="product-photo-zoom-badge" aria-hidden="true"><i class="fas fa-search-plus"></i></span></button>`;
    }
    return `<div class="${cls} ${cls}--placeholder" aria-hidden="true"><i class="fas fa-image"></i></div>`;
}

export function buildProductPhotoLightboxHtml({
    productId = '',
    photoUrl = '',
    title = '',
    desc = '',
    priceText = '',
    canAdd = false,
    inCartQty = 0,
    deliveryLineHtml = '',
} = {}) {
    return `
        <div id="store-product-photo-lightbox" class="product-photo-lightbox fixed inset-0 z-[99995]" role="dialog" aria-modal="true" aria-label="${esc(title || 'Foto del producto')}">
            <div class="product-photo-lightbox__backdrop" data-lightbox-action="close"></div>
            <div class="product-photo-lightbox__dialog">
                <div class="product-photo-lightbox__topbar">
                    <span class="product-photo-lightbox__hint"><i class="fas fa-search-plus"></i> Toca la foto para acercar</span>
                    <button type="button" class="product-photo-lightbox__close" data-lightbox-action="close" aria-label="Cerrar foto">✕</button>
                </div>
                <div class="product-photo-lightbox__stage" data-lightbox-action="close-stage">
                    <img class="product-photo-lightbox__img max-h-[78dvh] object-contain"
                         src="${esc(photoUrl)}"
                         alt="${esc(title || 'Producto')}"
                         data-lightbox-action="toggle-zoom">
                </div>
                <div class="product-photo-lightbox__meta">
                    <div class="product-photo-lightbox__meta-row">
                        <div class="min-w-0 flex-1">
                            <h3 class="product-photo-lightbox__title">${esc(title || 'Producto')}</h3>
                            ${desc ? `<p class="product-photo-lightbox__desc">${esc(desc)}</p>` : ''}
                        </div>
                        ${priceText ? `<span class="product-photo-lightbox__price">${esc(priceText)}</span>` : ''}
                    </div>
                    ${deliveryLineHtml ? `<div class="product-photo-lightbox__delivery">${deliveryLineHtml}</div>` : ''}
                    <div class="product-photo-lightbox__actions">
                        ${canAdd && productId ? `
                            <button type="button" class="stores-primary-btn product-photo-lightbox__add" data-lightbox-action="add-to-cart" data-product-id="${esc(productId)}">
                                <i class="fas fa-cart-plus"></i> ${inCartQty > 0 ? `Agregar otro (${inCartQty} en carrito)` : 'Agregar al carrito'}
                            </button>
                        ` : ''}
                        <button type="button" class="stores-secondary-btn product-photo-lightbox__dismiss" data-lightbox-action="close">Cerrar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function openProductPhotoZoomModal(opts = {}) {
    const pid = String(opts.productId || '').trim();
    const product = pid
        ? (viewingProducts.find((x) => x.id === pid) || myProducts.find((x) => x.id === pid) || null)
        : null;
    const photoUrl = String(opts.photoUrl || product?.photoUrl || '').trim();
    if (!photoUrl) return null;
    const title = opts.title || product?.name || 'Producto';
    const desc = opts.desc != null && opts.desc !== '' ? opts.desc : (product?.description || '');
    const priceText = opts.priceText || (product ? money(productBasePrice(product)) : '');
    const canAdd = !!(product && viewingStore && viewingProducts.some((x) => x.id === product.id) && productCanSell(product, viewingStore));
    const inCartQty = (product && cart.find((c) => c.productId === product.id)?.qty) || 0;
    const deliveryLineHtml = viewingStore ? formatStoreMenuDeliveryLine(storeMenuDeliveryState, viewingStore).html : '';
    const html = buildProductPhotoLightboxHtml({
        productId: product?.id || pid,
        photoUrl,
        title,
        desc,
        priceText,
        canAdd,
        inCartQty,
        deliveryLineHtml,
    });
    if (typeof document === 'undefined') return html;
    document.getElementById('store-product-photo-lightbox')?.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const modal = wrap.firstElementChild;
    if (!modal) return null;

    const close = () => {
        document.removeEventListener('keydown', onKey);
        modal.remove();
    };
    const onKey = (ev) => {
        if (ev.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    modal.addEventListener('click', (ev) => {
        const gpsBtn = ev.target.closest?.('[data-stores-action="detect-store-fee-gps"]');
        if (gpsBtn) {
            ev.preventDefault();
            ev.stopPropagation();
            close();
            detectStoreMenuFeeWithGps();
            return;
        }
        const actEl = ev.target.closest?.('[data-lightbox-action]');
        const act = actEl?.getAttribute?.('data-lightbox-action');
        if (act === 'close' || (act === 'close-stage' && ev.target === actEl)) {
            ev.preventDefault();
            close();
            return;
        }
        if (act === 'toggle-zoom') {
            ev.preventDefault();
            ev.stopPropagation();
            actEl.classList.toggle('is-zoomed');
            return;
        }
        if (act === 'add-to-cart') {
            ev.preventDefault();
            ev.stopPropagation();
            const targetPid = actEl.getAttribute('data-product-id') || product?.id || pid;
            if (targetPid) {
                addToCart(targetPid);
                toast(`${title} agregado al carrito`, 'success');
            }
            close();
        }
    });

    document.body.appendChild(modal);
    return modal;
}

export function productCardHtml(p) {
    const left = productStockLeft(p, viewingStore);
    const available = productCanSell(p, viewingStore);
    const inCart = cart.find((c) => c.productId === p.id);
    const price = productBasePrice(p);
    const stockLine = left == null
        ? ''
        : (left > 0
            ? `<p class="text-[9px] font-bold text-emerald-700">Quedan ${left}</p>`
            : `<p class="text-[9px] font-bold text-slate-400">Sin stock</p>`);
    const deliveryLine = formatStoreMenuDeliveryLine(storeMenuDeliveryState, viewingStore).html;
    const rInfo = productRatingInfo(p);
    const starRow = (rInfo.isStar || rInfo.count > 0)
        ? `<div class="product-card-stars">
            ${rInfo.isStar ? '<span class="star-pill">⭐ Producto estrella</span>' : ''}
            ${rInfo.count > 0 ? `<span class="star-rating-chip">★ ${rInfo.avg.toFixed(1)} (${rInfo.count})</span>` : ''}
            ${rInfo.ordersCount >= 3 ? `<span class="star-orders-chip">🔥 ${rInfo.ordersCount} pedidos</span>` : ''}
           </div>`
        : '';
    return `
        <div class="product-card ${available ? '' : 'product-card--off'} ${rInfo.isStar ? 'product-card--star' : ''}">
            ${productPhotoHtml(p)}
            <div class="min-w-0 flex-1">
                ${starRow}
                <p class="product-card-name">${esc(p.name)}</p>
                ${p.description ? `<p class="product-card-desc">${esc(p.description)}</p>` : ''}
                <p class="product-card-price">${money(price)}</p>
                ${deliveryLine}
                ${stockLine}
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
    const grand = cartItemsTotal();
    return `
        <div class="cart-lines">
            ${cart.map((i) => {
                const unit = Number(i.displayPrice ?? i.price) || 0;
                return `
                <div class="cart-line">
                    ${i.photoUrl
                        ? `<button type="button" class="product-photo-zoom-btn cart-line-photo-btn" data-stores-action="zoom-product-photo" data-product-id="${esc(i.productId)}" data-photo-url="${esc(i.photoUrl)}" data-photo-title="${esc(i.name || 'Producto')}" data-photo-price="${esc(money(unit))}" title="Toca para ampliar foto" aria-label="Ampliar foto de ${esc(i.name || 'Producto')}"><img class="cart-line-photo" src="${esc(i.photoUrl)}" alt="${esc(i.name || 'Producto')}" loading="lazy"><span class="product-photo-zoom-badge" aria-hidden="true"><i class="fas fa-search-plus"></i></span></button>`
                        : `<div class="cart-line-photo cart-line-photo--placeholder"><i class="fas fa-image"></i></div>`}
                    <div class="min-w-0 flex-1">
                        <p class="font-bold text-sm text-slate-900">${esc(i.name)}</p>
                        <p class="text-xs text-slate-500">${money(unit)} c/u</p>
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
            <div class="flex justify-between text-sm font-black text-slate-900">
                <span>Total productos</span><span>${money(grand)}</span>
            </div>
            <p class="text-[11px] text-slate-500 mt-1">En el siguiente paso eliges moto o carro. Tú pagas el envío completo de la zona (en carro mínimo L. 75.00).</p>
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
                    <i class="fas fa-wallet"></i> Tu saldo: ${formatLempiras(bal)}
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
                    El envío de la zona lo pagas completo, en efectivo al conductor. Moto o carro.
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
    const total = cartItemsTotal();
    const dest = document.getElementById('destination-autocomplete');
    const destVal = dest?.value || dest?.getAttribute?.('value') || '';
    // «Envío a <zona>: L X» (cotiza el servidor; se pinta al llegar)
    setTimeout(() => { refreshCheckoutQuote(false, viewingStore).catch(() => {}); }, 0);
    return `
        <div class="checkout-box space-y-3">
            <p class="stores-section-label">Entrega</p>
            <div class="checkout-store-pill">
                <i class="fas fa-store"></i>
                <span>${esc(viewingStore?.name || 'Tienda')}</span>
            </div>
            <div class="cart-summary space-y-1">
                <div class="flex justify-between text-sm font-black"><span>Productos</span><span>${money(total)}</span></div>
                <div class="flex justify-between text-xs font-bold text-purple-700 mt-1.5">
                    <span><i class="fas fa-wallet"></i> Tu saldo</span>
                    <span>${formatLempiras(bal)}</span>
                </div>
                <p class="text-[10px] text-slate-500 mt-1.5 leading-snug">
                    Los productos se pagan con <b>puntos/saldo</b> o en <b>efectivo</b>. El envío de la zona lo pagas completo al conductor.
                </p>
            </div>
            <div class="store-ride-pick" role="group" aria-label="Cómo quieres el envío">
                <button type="button" class="store-ride-btn ${checkoutVehicle() === 'moto' ? 'is-on' : ''}" data-stores-action="pick-ride" data-ride="moto">
                    <i class="fas fa-motorcycle"></i>
                    <span>Moto</span>
                    <small>Tarifa de la zona</small>
                </button>
                <button type="button" class="store-ride-btn ${checkoutVehicle() === 'auto' ? 'is-on' : ''}" data-stores-action="pick-ride" data-ride="auto">
                    <i class="fas fa-car"></i>
                    <span>Carro</span>
                    <small>Desde L. 75</small>
                </button>
            </div>
            <label class="stores-field">
                <span>Dirección de entrega *</span>
                <input id="store-checkout-address" type="text" placeholder="Colonia, referencia, casa..."
                       value="${esc(destVal)}" class="stores-input">
            </label>
            ${checkoutFeeHtml()}
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
    const activePill = activeClientOrderPillHtml();
    return `<div id="client-active-order-slot">${activePill}</div><div class="orders-list">${clientOrders.map((o) => orderCardHtml(o, { merchant: false })).join('')}</div>`;
}

/** Estado visible: «Pedido preparado» con viaje pedido = «Pedido preparado · buscando delivery» (nadie lo aceptó todavía). */
export function orderStatusView(o) {
    if (o?.status === 'ready' && o?.tripId) return { label: 'Pedido preparado · buscando delivery', tone: 'amber' };
    if (o?.status === 'out_for_delivery' && o?.driverName) {
        return { label: `En camino · ${String(o.driverName).split(/\s+/)[0]}`, tone: 'blue' };
    }
    return ORDER_STATUS[o?.status] || ORDER_STATUS.pending;
}

/** Barra de progreso de 5 pasos: 1. Recibido -> 2. Preparando el pedido -> 3. Pedido preparado (llamando delivery) -> 4. En camino -> 5. Entregado */
export function orderProgressStepperHtml(o) {
    if (!o || o.status === 'cancelled') return '';
    const steps = [
        { num: 1, label: 'Recibido' },
        { num: 2, label: 'Preparando el pedido' },
        { num: 3, label: 'Pedido preparado' },
        { num: 4, label: 'En camino' },
        { num: 5, label: 'Entregado' },
    ];
    let current = 1;
    if (o.status === 'preparing') current = 2;
    else if (o.status === 'ready') current = 3;
    else if (o.status === 'out_for_delivery') current = 4;
    else if (o.status === 'delivered') current = 5;

    const rideLbl = orderRideName(o);
    const driverFirst = o.driverName ? String(o.driverName).trim().split(/\s+/)[0] : '';
    let caption = '';
    let capClass = '';
    if (o.status === 'pending') {
        caption = '⏳ Paso 1/5: Pedido recibido. El delivery se llamará hasta que el restaurante marque «Pedido preparado».';
    } else if (o.status === 'accepted') {
        caption = '✅ Paso 1/5: El restaurante aceptó tu pedido. Pronto marcará «Preparando el pedido».';
    } else if (o.status === 'preparing') {
        caption = '👨‍🍳 Paso 2/5: Preparando el pedido en cocina. Aún NO se llama al delivery para que no pierda tiempo esperando.';
    } else if (o.status === 'ready') {
        caption = `✅ Paso 3/5: ¡Pedido preparado! Ya estamos llamando a tu delivery (${rideLbl}) para pasar a recogerlo.`;
        capClass = 'order-progress-caption--ready';
    } else if (o.status === 'out_for_delivery') {
        caption = `🛵 Paso 4/5: Tu delivery${driverFirst ? ` (${driverFirst})` : ''} ya recogió el pedido y va en camino.`;
        capClass = 'order-progress-caption--way';
    } else if (o.status === 'delivered') {
        caption = '🎉 Paso 5/5: Pedido entregado.';
        capClass = 'order-progress-caption--ready';
    }

    const trackHtml = steps.map((s) => {
        const cls = s.num < current
            ? 'is-done'
            : (s.num === current ? ('is-current' + (current >= 3 ? ' is-ready' : '')) : '');
        const dotText = s.num < current ? '✓' : String(s.num);
        return `<div class="order-progress-step ${cls}">
            <span class="order-progress-dot">${dotText}</span>
            <span class="order-progress-label">${esc(s.label)}</span>
        </div>`;
    }).join('');

    return `
        <div class="order-progress-stepper" data-order-step="${current}">
            <div class="order-progress-track">${trackHtml}</div>
            ${caption ? `<div class="order-progress-caption ${capClass}"><span>${esc(caption)}</span></div>` : ''}
        </div>
    `;
}

function orderCardHtml(o, { merchant = false } = {}) {
    const st = orderStatusView(o);
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsLine = items.map((i) => `${i.qty}× ${i.name}`).join(', ');
    const actions = merchant ? merchantOrderActionsHtml(o) : clientOrderActionsHtml(o);
    return `
        <div class="order-card" data-order-id="${esc(o.id)}">
            <div class="order-card-top">
                <div>
                    <p class="order-card-title">${esc(merchant ? (o.clientName || 'Cliente') : (o.storeName || 'Tienda'))}</p>
                    <p class="order-card-sub">${esc(itemsLine || 'Pedido')}</p>
                    ${merchant ? orderWaitChipHtml(o) : ''}
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
                ${orderFeeLineHtml(o)}
            </div>
            ${o.tariffSplit === true ? `
                <p class="text-[10px] text-slate-500 font-semibold mt-1 leading-snug">
                    Base ${money(o.itemsBaseTotal ?? 0)}
                    · ½ tarifa negocio ${money(o.platformFeeMerchant ?? 0)}
                    · ½ tarifa comprador ${money(o.platformFeeBuyer ?? 0)}
                    ${o.commissionPercent != null ? `· tarifa ${esc(String(o.commissionPercent))}%` : ''}
                </p>
            ` : ''}
            ${o.notes ? `<p class="order-notes">${esc(o.notes)}</p>` : ''}
            ${o.cancelReason === 'out_of_stock' ? `<p class="order-notes">No había stock suficiente. Si pagaste con puntos, se reembolsan.</p>` : ''}
            ${orderProgressStepperHtml(o)}
            ${actions}
        </div>
    `;
}

export function buildOrderProductRatingModalHtml(order, draftRatings = {}, comment = '') {
    const items = Array.isArray(order?.items) ? order.items : [];
    const existing = (order?.productRatings && typeof order.productRatings === 'object') ? order.productRatings : {};
    return `
        <div id="order-product-rating-modal" class="order-rating-modal fixed inset-0 z-[99996]" role="dialog" aria-modal="true" aria-label="Puntuar productos recibidos">
            <div class="order-rating-modal__backdrop" data-rate-action="close"></div>
            <div class="order-rating-modal__card">
                <div class="order-rating-modal__head">
                    <div>
                        <p class="order-rating-modal__kicker">Pedido entregado · ${esc(order?.storeName || 'Restaurante')}</p>
                        <h3 class="order-rating-modal__title">⭐ ¿Qué tal estuvieron tus productos?</h3>
                    </div>
                    <button type="button" class="order-rating-modal__close" data-rate-action="close" aria-label="Cerrar">✕</button>
                </div>
                <p class="order-rating-modal__sub">Tu puntuación ayuda a destacar los <b>⭐ Productos estrella</b> y los <b>🔥 Restaurantes en fuego</b>.</p>
                <div class="order-rating-modal__list">
                    ${items.map((it, idx) => {
                        const pid = String(it.productId || `item_${idx}`);
                        const currentStars = Number(draftRatings[pid] ?? existing[pid]?.stars ?? 5) || 5;
                        return `
                            <div class="order-rating-item" data-rate-product-row="${esc(pid)}">
                                <div class="order-rating-item__info">
                                    <p class="order-rating-item__name">${esc(it.qty || 1)}× ${esc(it.name || 'Producto')}</p>
                                    <span class="order-rating-item__score" data-rate-score-label="${esc(pid)}">${currentStars} ★</span>
                                </div>
                                <div class="order-rating-stars" role="radiogroup" aria-label="Calificación de ${esc(it.name || 'Producto')}">
                                    ${[1, 2, 3, 4, 5].map((star) => `
                                        <button type="button"
                                                class="order-rating-star ${star <= currentStars ? 'is-on' : ''}"
                                                data-rate-action="pick-star"
                                                data-product-id="${esc(pid)}"
                                                data-stars="${star}"
                                                aria-label="${star} estrellas">★</button>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <label class="stores-field mt-2">
                    <span>Comentario (opcional)</span>
                    <textarea id="order-rating-comment" class="stores-input" rows="2" maxlength="300" placeholder="¡Las baleadas llegaron calientitas y deliciosas!">${esc(comment || order?.ratingComment || '')}</textarea>
                </label>
                <div class="order-rating-modal__actions">
                    <button type="button" class="stores-primary-btn w-full" data-rate-action="submit" data-order-id="${esc(order?.id || '')}">
                        ⭐ Enviar mi puntuación
                    </button>
                    <button type="button" class="stores-secondary-btn w-full" data-rate-action="close">Cancelar</button>
                </div>
            </div>
        </div>
    `;
}

export async function submitOrderProductRatings(orderId, ratingsByProductId = {}, comment = '') {
    const order = clientOrders.find((o) => o.id === orderId) || merchantOrders.find((o) => o.id === orderId);
    if (!order || order.status !== 'delivered') {
        toast('Solo puedes puntuar pedidos ya entregados', 'warning');
        return false;
    }
    const items = Array.isArray(order.items) ? order.items : [];
    const productRatings = {};
    let sum = 0;
    let count = 0;
    items.forEach((it, idx) => {
        const pid = String(it.productId || `item_${idx}`);
        const stars = Math.min(5, Math.max(1, Math.round(Number(ratingsByProductId[pid] ?? 5) || 5)));
        productRatings[pid] = {
            stars,
            name: String(it.name || 'Producto').slice(0, 120),
            qty: Number(it.qty) || 1,
        };
        sum += stars;
        count += 1;
    });
    const storeRating = count > 0 ? Math.round((sum / count) * 10) / 10 : 5;
    const cleanComment = String(comment || '').trim().slice(0, 300);

    try {
        await updateDoc(publicDoc('store_orders', orderId), {
            productRatings,
            storeRating,
            ratingComment: cleanComment || null,
            ratedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    } catch (e) {
        console.warn('[stores] submitOrderProductRatings firestore', e);
    }

    // Actualizar estado en memoria para respuesta visual inmediata
    order.productRatings = productRatings;
    order.storeRating = storeRating;
    order.ratingComment = cleanComment || null;
    order.ratedAt = order.ratedAt || { toMillis: () => Date.now() };

    for (const [pid, r] of Object.entries(productRatings)) {
        for (const list of [viewingProducts, myProducts]) {
            const p = list.find((x) => x.id === pid);
            if (p) {
                const prevCount = Number(p.ratingCount) || 0;
                const prevSum = Number(p.ratingSum) || (Number(p.ratingAvg || 0) * prevCount);
                p.ratingCount = prevCount + 1;
                p.ratingSum = prevSum + r.stars;
                p.ratingAvg = Math.round((p.ratingSum / p.ratingCount) * 10) / 10;
                p.ordersCount = Math.max(1, Number(p.ordersCount ?? p.unitsSold) || 0);
                if (p.ratingAvg >= 4.5) p.isStarProduct = true;
            }
        }
    }
    const targetStore = storesCache.get(order.storeId) || (myStore?.id === order.storeId ? myStore : null);
    if (targetStore) {
        const sc = Number(targetStore.ratingCount) || 0;
        const ss = Number(targetStore.ratingSum) || (Number(targetStore.ratingAvg || 0) * sc);
        targetStore.ratingCount = sc + 1;
        targetStore.ratingSum = ss + storeRating;
        targetStore.ratingAvg = Math.round((targetStore.ratingSum / targetStore.ratingCount) * 10) / 10;
    }

    toast('⭐ ¡Gracias! Tu puntuación de los productos fue guardada.', 'success');
    if (marketplaceView === 'my-orders' || marketplaceView === 'store') renderMarketplace();
    return true;
}

export function openOrderProductRatingModal(orderId) {
    const order = clientOrders.find((o) => o.id === orderId) || merchantOrders.find((o) => o.id === orderId);
    if (!order) return null;
    const draft = {};
    const existing = (order.productRatings && typeof order.productRatings === 'object') ? order.productRatings : {};
    (order.items || []).forEach((it, idx) => {
        const pid = String(it.productId || `item_${idx}`);
        draft[pid] = Number(existing[pid]?.stars) || 5;
    });
    const html = buildOrderProductRatingModalHtml(order, draft, order.ratingComment || '');
    if (typeof document === 'undefined') return html;
    document.getElementById('order-product-rating-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const modal = wrap.firstElementChild;
    if (!modal) return null;

    const refreshStarsUi = (pid) => {
        const val = draft[pid] || 5;
        const row = modal.querySelector(`[data-rate-product-row="${CSS.escape(pid)}"]`);
        if (!row) return;
        const lbl = row.querySelector(`[data-rate-score-label="${CSS.escape(pid)}"]`);
        if (lbl) lbl.textContent = `${val} ★`;
        row.querySelectorAll('[data-rate-action="pick-star"]').forEach((btn) => {
            const s = Number(btn.getAttribute('data-stars')) || 0;
            btn.classList.toggle('is-on', s <= val);
        });
    };

    modal.addEventListener('click', async (ev) => {
        const actEl = ev.target.closest('[data-rate-action]');
        if (!actEl) return;
        const act = actEl.getAttribute('data-rate-action');
        if (act === 'close') {
            modal.remove();
            return;
        }
        if (act === 'pick-star') {
            const pid = actEl.getAttribute('data-product-id');
            const stars = Number(actEl.getAttribute('data-stars')) || 5;
            if (pid) {
                draft[pid] = stars;
                refreshStarsUi(pid);
            }
            return;
        }
        if (act === 'submit') {
            actEl.disabled = true;
            const comment = modal.querySelector('#order-rating-comment')?.value || '';
            await submitOrderProductRatings(order.id, draft, comment);
            modal.remove();
        }
    });

    document.body.appendChild(modal);
    return modal;
}

function clientOrderActionsHtml(o) {
    if (o.status === 'pending' || o.status === 'accepted') {
        return `<button type="button" class="stores-danger-btn mt-2" data-stores-action="cancel-order" data-order-id="${esc(o.id)}">Cancelar pedido</button>`;
    }
    if (o.status === 'preparing') {
        return `<p class="text-[11px] text-purple-800 font-bold mt-2"><i class="fas fa-utensils"></i> El restaurante está preparando tu pedido · el delivery se llamará en cuanto esté preparado</p>`;
    }
    if (o.status === 'ready' && o.tripId) {
        return `<p class="text-[11px] text-emerald-700 font-bold mt-2"><i class="fas fa-check-circle"></i> ¡Pedido preparado! Llamando a tu delivery (${esc(orderRideName(o))})… te avisamos cuando lo acepte</p>
            <div class="order-actions mt-2">
                <button type="button" class="stores-secondary-btn w-full" data-stores-action="chat-driver" data-order-id="${esc(o.id)}" data-trip-id="${esc(o.tripId)}">
                    <i class="fas fa-comments text-blue-600"></i> 💬 Chat con repartidor
                </button>
            </div>`;
    }
    if (o.status === 'delivered') {
        const hasRatings = o.ratedAt || (o.productRatings && Object.keys(o.productRatings).length > 0);
        if (hasRatings) {
            const avg = Number(o.storeRating) || 5;
            const summary = Object.values(o.productRatings || {})
                .map((r) => `${r.name || 'Plato'}: ${'★'.repeat(Math.max(1, Number(r.stars) || 5))}`)
                .join(' · ');
            return `
                <div class="order-rated-summary mt-2">
                    <div class="order-rated-summary__top">
                        <span class="order-rated-badge">⭐ Calificaste ★ ${avg.toFixed(1)}/5</span>
                        <button type="button" class="order-rated-edit-btn" data-stores-action="open-rate-order" data-order-id="${esc(o.id)}">Editar puntuación</button>
                    </div>
                    ${summary ? `<p class="order-rated-summary__items">${esc(summary)}</p>` : ''}
                    ${o.ratingComment ? `<p class="order-rated-summary__comment">“${esc(o.ratingComment)}”</p>` : ''}
                </div>
            `;
        }
        return `
            <div class="order-rate-cta mt-2">
                <button type="button" class="stores-rate-order-btn w-full" data-stores-action="open-rate-order" data-order-id="${esc(o.id)}">
                    ⭐ Puntuar los productos que te llegaron
                </button>
            </div>
        `;
    }
    if (o.tripId) {
        return `<p class="text-[11px] text-blue-700 font-bold mt-2"><i class="fas fa-motorcycle"></i> ${o.driverName ? `${esc(String(o.driverName).split(/\s+/)[0])} va con tu pedido` : 'Envío activo'} · sigue el viaje en el mapa</p>
            <div class="order-actions mt-2">
                <button type="button" class="stores-secondary-btn w-full" data-stores-action="chat-driver" data-order-id="${esc(o.id)}" data-trip-id="${esc(o.tripId)}">
                    <i class="fas fa-comments text-blue-600"></i> 💬 Chat con repartidor
                </button>
            </div>`;
    }
    return '';
}


let _orderDriverChatUnsub = null;
export function openOrderDriverChatModal({ tripId, role = 'merchant', storeName = '', orderId = '' } = {}) {
    if (!tripId) {
        toast('Este pedido aún no tiene un viaje de envío asignado.', 'warning');
        return null;
    }
    try { _orderDriverChatUnsub?.(); } catch (_) {}
    _orderDriverChatUnsub = null;
    document.getElementById('order-driver-chat-modal')?.remove();

    const isMerchant = role === 'merchant';
    const modal = document.createElement('div');
    modal.id = 'order-driver-chat-modal';
    modal.className = 'fixed inset-0 bg-black/75 z-[48000] flex items-end sm:items-center justify-center p-0 sm:p-4';
    modal.innerHTML = `
        <div class="bg-slate-900 text-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-slate-700 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div class="px-4 py-3.5 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between gap-2">
                <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${isMerchant ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'}">
                            ${isMerchant ? '🏪 Negocio ↔ Repartidor' : '👤 Cliente ↔ Repartidor'}
                        </span>
                    </div>
                    <h4 id="odc-title" class="font-black text-sm text-white truncate mt-1">💬 Chat con el repartidor</h4>
                    <p id="odc-sub" class="text-[11px] text-slate-400 truncate">Cargando estado del envío…</p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <a id="odc-wa-btn" href="#" target="_blank" rel="noopener" class="hidden px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black items-center gap-1">
                        <i class="fab fa-whatsapp"></i> WhatsApp
                    </a>
                    <button type="button" data-odc-close="1" class="w-8 h-8 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            <div id="odc-messages" class="flex-1 overflow-y-auto p-3.5 space-y-2 bg-slate-950/70 min-h-[220px] max-h-[52vh]">
                <p class="text-xs text-slate-500 text-center py-6">Cargando mensajes…</p>
            </div>
            <form id="odc-form" class="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2">
                <input id="odc-input" type="text" autocomplete="off"
                    placeholder="${isMerchant ? 'Escribe al repartidor (ej. el pedido está listo en mostrador)…' : 'Escribe al repartidor (ej. casa portón negro)…'}"
                    class="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-400" />
                <button id="odc-send" type="submit"
                    class="px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wide ${isMerchant ? 'bg-amber-500 hover:bg-amber-400 text-slate-950' : 'bg-blue-600 hover:bg-blue-500 text-white'}">
                    Enviar
                </button>
            </form>
        </div>
    `;

    const close = () => {
        try { _orderDriverChatUnsub?.(); } catch (_) {}
        _orderDriverChatUnsub = null;
        modal.remove();
    };
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal || ev.target.closest('[data-odc-close]')) close();
    });

    const msgsEl = modal.querySelector('#odc-messages');
    const titleEl = modal.querySelector('#odc-title');
    const subEl = modal.querySelector('#odc-sub');
    const waBtn = modal.querySelector('#odc-wa-btn');
    const form = modal.querySelector('#odc-form');
    const input = modal.querySelector('#odc-input');
    const sendBtn = modal.querySelector('#odc-send');

    let latestTrip = null;
    const renderTripChat = (t) => {
        latestTrip = t;
        const driverName = t?.driverName || 'Repartidor';
        if (titleEl) {
            titleEl.textContent = t?.driverId
                ? `💬 Chat con ${driverName}`
                : '💬 Chat para el repartidor';
        }
        if (subEl) {
            if (!t?.driverId) {
                subEl.textContent = 'Buscando repartidor… tus mensajes los verá al aceptar el envío.';
            } else if (t.status === 'in_progress') {
                subEl.textContent = `🛵 Pedido recogido · En camino a entregar a ${t.recipientName || t.clientName || 'cliente'}`;
            } else if (t.driverArrived) {
                subEl.textContent = `🏪 ${driverName} llegó al negocio a recoger el pedido`;
            } else {
                subEl.textContent = `🛵 ${driverName} va en camino al negocio a recoger el pedido`;
            }
        }
        if (waBtn) {
            const dPhone = String(t?.driverPhone || '').replace(/\D/g, '');
            if (dPhone.length >= 8) {
                const full = dPhone.length === 8 ? `504${dPhone}` : dPhone;
                waBtn.href = `https://wa.me/${full}`;
                waBtn.classList.remove('hidden');
                waBtn.classList.add('inline-flex');
            } else {
                waBtn.classList.add('hidden');
                waBtn.classList.remove('inline-flex');
            }
        }
        const uid = getCurrentUser()?.uid;
        const list = isMerchant
            ? [
                ...(Array.isArray(t?.chatMerchant) ? t.chatMerchant : []),
                ...(Array.isArray(t?.chat) ? t.chat.filter((m) => m && (m.channel === 'merchant' || m.target === 'merchant')) : [])
            ]
            : (Array.isArray(t?.chat) ? t.chat.filter((m) => m && m.channel !== 'merchant' && m.target !== 'merchant') : []);

        if (!msgsEl) return;
        if (!list.length) {
            msgsEl.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">${
                isMerchant
                    ? 'Sin mensajes con el repartidor todavía. Escríbele indicaciones para recoger el pedido.'
                    : 'Sin mensajes con el repartidor todavía. Escríbele referencias de tu ubicación.'
            }</p>`;
            return;
        }
        msgsEl.innerHTML = list.map((m) => {
            const mine = uid && m.sender === uid;
            const timeStr = m.time ? new Date(m.time).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' }) : '';
            return `
                <div class="flex ${mine ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[82%] px-3 py-2 rounded-2xl text-xs ${mine
                        ? (isMerchant ? 'bg-amber-500 text-slate-950 font-semibold' : 'bg-blue-600 text-white')
                        : 'bg-slate-800 text-slate-100 border border-slate-700'}">
                        ${!mine ? `<div class="text-[10px] font-black opacity-80 mb-0.5">${esc(m.senderName || 'Repartidor')}</div>` : ''}
                        <div class="leading-snug break-words">${esc(m.text || '')}</div>
                        ${timeStr ? `<div class="text-[9px] opacity-70 text-right mt-0.5">${esc(timeStr)}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        msgsEl.scrollTop = msgsEl.scrollHeight;
    };

    try {
        _orderDriverChatUnsub = onSnapshot(publicDoc('trips', tripId), (snap) => {
            if (!snap.exists()) return;
            renderTripChat({ id: snap.id, ...snap.data() });
        }, (err) => {
            console.warn('[order-driver-chat] snapshot error', err);
        });
    } catch (e) {
        console.warn('[order-driver-chat]', e);
    }

    form?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const text = input?.value?.trim();
        if (!text) return;
        const user = getCurrentUser();
        if (!user?.uid) return toast('Inicia sesión para enviar mensajes.', 'warning');
        const sName = isMerchant
            ? (storeName || myStore?.name || latestTrip?.storeName || window.userProfile?.name || 'Negocio')
            : (window.userProfile?.name || latestTrip?.recipientName || latestTrip?.clientName || 'Cliente');
        const msg = {
            sender: user.uid,
            senderName: sName,
            senderRole: isMerchant ? 'merchant' : 'client',
            channel: isMerchant ? 'merchant' : 'client',
            target: isMerchant ? 'merchant' : 'client',
            text,
            time: Date.now()
        };
        try {
            if (sendBtn) sendBtn.disabled = true;
            const patch = isMerchant
                ? { chatMerchant: arrayUnion(msg), updatedAt: serverTimestamp() }
                : { chat: arrayUnion(msg), updatedAt: serverTimestamp() };
            await updateDoc(publicDoc('trips', tripId), patch);
            if (input) input.value = '';
        } catch (err) {
            console.error('[order-driver-chat] send error:', err);
            toast('No se pudo enviar el mensaje al repartidor.', 'error');
        } finally {
            if (sendBtn) sendBtn.disabled = false;
            input?.focus?.();
        }
    });

    document.body.appendChild(modal);
    setTimeout(() => input?.focus?.(), 80);
    return modal;
}
if (typeof window !== 'undefined') {
    window.openStoreTripChatModal = openOrderDriverChatModal;
}

export function merchantOrderActionsHtml(o) {
    const id = esc(o.id);
    const rideName = esc(orderRideName(o));
    if (o.status === 'pending') {
        return `
            <div class="order-flow-hint">
                <i class="fas fa-clock"></i>
                <span>El repartidor se llama hasta que marques <b>«Preparando el pedido»</b> y luego <b>«Pedido preparado»</b> para que no espere.</span>
            </div>
            <div class="order-actions">
                <button type="button" class="stores-primary-btn" data-merchant-action="accept-order" data-order-id="${id}">Aceptar</button>
                <button type="button" class="stores-prepare-btn" data-merchant-action="accept-and-prepare-order" data-order-id="${id}">👨‍🍳 Aceptar y preparar</button>
                <button type="button" class="stores-danger-btn" data-merchant-action="reject-order" data-order-id="${id}">Rechazar</button>
            </div>`;
    }
    if (o.status === 'accepted') {
        return `
            <div class="order-flow-hint">
                <i class="fas fa-utensils"></i>
                <span>Paso 1 de 2: Marca <b>«Preparando el pedido»</b> para avisar al cliente. El repartidor se llama hasta que marques <b>«Pedido preparado»</b> para que no espere.</span>
            </div>
            <div class="order-actions">
                <button type="button" class="stores-prepare-btn w-full" data-merchant-action="preparing-order" data-order-id="${id}">
                    👨‍🍳 Marcar: Preparando el pedido
                </button>
            </div>`;
    }
    if (o.status === 'preparing') {
        return `
            <div class="order-flow-hint order-flow-hint--ready">
                <i class="fas fa-check-circle"></i>
                <span>Paso 2 de 2: El cliente ve <b>«Preparando el pedido»</b>. El repartidor se llama hasta que marques <b>«Pedido preparado»</b> para que no espere.</span>
            </div>
            <div class="order-actions">
                <button type="button" class="stores-ready-btn w-full" data-merchant-action="ready-order" data-order-id="${id}">
                    ✅ Pedido preparado · llamar delivery (${rideName})
                </button>
            </div>`;
    }
    if (o.status === 'ready' && !o.tripId) {
        const why = o.deliveryStage === 'trip_cancelled' ? 'El viaje anterior se canceló. ' : '';
        return `<p class="text-[11px] text-amber-700 font-bold mt-2"><i class="fas fa-exclamation-circle"></i> ${why}Pedido preparado · sin conductor</p>
            <div class="order-actions">
                <button type="button" class="stores-ready-btn w-full" data-merchant-action="ready-order" data-order-id="${id}">
                    ✅ Pedido preparado · llamar delivery (${rideName})
                </button>
            </div>`;
    }
    if (o.status === 'ready') {
        return `<p class="text-[11px] text-emerald-700 font-bold mt-2"><i class="fas fa-search"></i> ✅ Pedido preparado · llamando delivery (${rideName}), esperando que un conductor acepte</p>
            ${o.tripId ? `<div class="order-actions mt-2" style="display:flex;flex-wrap:wrap;gap:6px">
                <button type="button" class="stores-primary-btn" style="background:#16a34a;border-color:#16a34a" data-merchant-action="share-order-trip-wa" data-order-id="${id}" data-trip-id="${esc(o.tripId)}">
                    <i class="fab fa-whatsapp"></i> Compartir viaje por WhatsApp
                </button>
                <button type="button" class="stores-secondary-btn" data-merchant-action="copy-order-trip-link" data-order-id="${id}" data-trip-id="${esc(o.tripId)}">
                    <i class="fas fa-link"></i> Copiar link del viaje
                </button>
                <button type="button" class="stores-secondary-btn" data-merchant-action="share-order-trip-native" data-order-id="${id}" data-trip-id="${esc(o.tripId)}">
                    <i class="fas fa-share-nodes"></i> Compartir desde la app
                </button>
                <button type="button" class="stores-secondary-btn" data-merchant-action="chat-driver" data-order-id="${id}" data-trip-id="${esc(o.tripId)}">
                    <i class="fas fa-comments text-amber-600"></i> 💬 Chat con repartidor
                </button>
            </div>` : ''}`;
    }
    if (o.status === 'out_for_delivery') {
        return `<p class="text-[11px] text-blue-700 font-bold mt-2"><i class="fas fa-motorcycle"></i> En camino${o.driverName ? ` con ${esc(o.driverName)}` : ''} · se marca entregado solo cuando el conductor termina</p>
            <div class="order-actions mt-2" style="display:flex;flex-wrap:wrap;gap:6px">
                ${o.tripId ? `
                <button type="button" class="stores-primary-btn" style="background:#16a34a;border-color:#16a34a" data-merchant-action="share-order-trip-wa" data-order-id="${id}" data-trip-id="${esc(o.tripId)}">
                    <i class="fab fa-whatsapp"></i> Compartir viaje por WhatsApp
                </button>
                <button type="button" class="stores-secondary-btn" data-merchant-action="copy-order-trip-link" data-order-id="${id}" data-trip-id="${esc(o.tripId)}">
                    <i class="fas fa-link"></i> Copiar link del viaje
                </button>
                <button type="button" class="stores-secondary-btn" data-merchant-action="share-order-trip-native" data-order-id="${id}" data-trip-id="${esc(o.tripId)}">
                    <i class="fas fa-share-nodes"></i> Compartir desde la app
                </button>
                <button type="button" class="stores-primary-btn" data-merchant-action="chat-driver" data-order-id="${id}" data-trip-id="${esc(o.tripId)}">
                    <i class="fas fa-comments"></i> 💬 Chat con repartidor
                </button>` : ''}
                <button type="button" class="stores-secondary-btn" data-merchant-action="delivered-order" data-order-id="${id}">Marcar entregado a mano</button>
            </div>`;
    }
    return '';
}

async function openStore(storeId) {
    let store = storesCache.get(storeId) || null;
    if (!store) {
        try {
            const d = await getDoc(publicDoc('stores', storeId));
            store = d.exists() ? { id: d.id, ...d.data() } : null;
        } catch (e) {
            // Las reglas niegan tiendas +18 a menores o cuentas sin fecha de nacimiento
            if (e?.code === 'permission-denied') {
                return toast(getCurrentUser()
                    ? 'Esta tienda es solo para mayores de 18. Revisa tu fecha de nacimiento en el perfil.'
                    : 'Inicia sesión para ver esta tienda.', 'warning');
            }
            console.warn('[stores] openStore', e);
        }
    }
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
    storeProductPreview.set(storeId, viewingProducts.filter((p) => p.available !== false).slice(0, 2));
    // If cart is from another store, clear
    if (cart.length && cart[0]?.storeId && cart[0].storeId !== storeId) {
        cart = [];
    }
    marketplaceView = 'store';
    renderMarketplace();
    refreshStoreMenuDeliveryQuote(store).catch(() => {});
}

function addToCart(productId) {
    const p = viewingProducts.find((x) => x.id === productId);
    if (!productCanSell(p, viewingStore)) {
        const left = productStockLeft(p, viewingStore);
        if (left === 0) return toast('Ese producto no tiene stock', 'warning');
        return;
    }
    if (viewingStore && !storeOpenInfo(viewingStore).open) {
        const lbl = storeOpenInfo(viewingStore).label;
        return toast(`La tienda está cerrada${lbl ? ` · ${lbl}` : ''}`, 'warning');
    }
    if (!isStoreApprovedForPublic(viewingStore) && !isStoresStaff()) {
        return toast('Esta tienda aún no está verificada', 'warning');
    }
    const base = roundMoney(productBasePrice(p));
    const existing = cart.find((c) => c.productId === productId);
    const left = productStockLeft(p, viewingStore);
    const nextQty = (existing?.qty || 0) + 1;
    if (left != null && nextQty > left) return toast(left > 0 ? `Solo quedan ${left}` : 'Sin stock', 'warning');
    if (existing) existing.qty = nextQty;
    else {
        cart.push({
            productId: p.id,
            storeId: viewingStore.id,
            name: p.name,
            basePrice: base,
            price: base,
            displayPrice: base,
            merchantShare: 0,
            buyerShare: 0,
            qty: 1,
            photoUrl: p.photoUrl || null,
        });
    }
    renderMarketplace();
}

function incCart(productId) {
    const line = cart.find((c) => c.productId === productId);
    if (!line) return addToCart(productId);
    const p = viewingProducts.find((x) => x.id === productId);
    const left = productStockLeft(p, viewingStore);
    if (left != null && line.qty + 1 > left) return toast(`Solo quedan ${left}`, 'warning');
    line.qty += 1;
    renderMarketplace();
}

function decCart(productId) {
    const idx = cart.findIndex((c) => c.productId === productId);
    if (idx < 0) return;
    cart[idx].qty -= 1;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    renderMarketplace();
}

function clearCheckoutFieldErrors() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.stores-input--invalid').forEach((el) => el.classList.remove('stores-input--invalid'));
    document.querySelectorAll('.stores-field-error').forEach((el) => el.remove());
}

function markCheckoutFieldInvalid(inputId, message) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(inputId);
    if (!el) return;
    el.classList.remove('stores-input--invalid');
    // force reflow so shake animation replays on repeated taps
    void el.offsetWidth;
    el.classList.add('stores-input--invalid');
    const parent = el.closest('.stores-field') || el.parentElement;
    if (parent) {
        parent.querySelectorAll(`[data-error-for="${inputId}"]`).forEach((n) => n.remove());
        const msgEl = document.createElement('span');
        msgEl.className = 'stores-field-error';
        msgEl.setAttribute('data-error-for', inputId);
        msgEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> <span>${esc(message)}</span>`;
        parent.appendChild(msgEl);
    }
    const clearOnce = () => {
        el.classList.remove('stores-input--invalid');
        parent?.querySelectorAll?.(`[data-error-for="${inputId}"]`)?.forEach((n) => n.remove());
        el.removeEventListener('input', clearOnce);
    };
    el.addEventListener('input', clearOnce);
    try { el.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    try { el.focus?.({ preventScroll: true }); } catch (_) { try { el.focus?.(); } catch (_2) {} }
}

async function placeOrder() {
    const user = getCurrentUser();
    const profile = getUserProfile() || {};
    if (!user) return toast('Inicia sesión para pedir', 'error');
    if (!viewingStore || !cart.length) return toast('Carrito vacío', 'warning');
    if (!storeOpenInfo(viewingStore).open) {
        const lbl = storeOpenInfo(viewingStore).label;
        return toast(`La tienda está cerrada${lbl ? ` · ${lbl}` : ''}`, 'warning');
    }

    clearCheckoutFieldErrors();
    const addrEl = document.getElementById('store-checkout-address');
    let address = addrEl?.value.trim() || '';
    if (!address && checkoutPointSource() === 'gps') {
        const gpsPt = checkoutPoint();
        if (gpsPt && Number.isFinite(Number(gpsPt.lat)) && Number.isFinite(Number(gpsPt.lng))) {
            address = `Ubicación GPS (${Number(gpsPt.lat).toFixed(4)}, ${Number(gpsPt.lng).toFixed(4)})`;
            if (addrEl) addrEl.value = address;
        }
    }
    const recipientName = document.getElementById('store-checkout-recipient')?.value.trim() || '';
    const recipientPhone = phoneNorm(document.getElementById('store-checkout-phone')?.value || '');
    const notes = document.getElementById('store-checkout-notes')?.value.trim() || '';

    if (!address || address.length < 5) {
        markCheckoutFieldInvalid(
            'store-checkout-address',
            !address
                ? 'Escribe la dirección de entrega (colonia, referencia, casa) o toca «Usar mi ubicación».'
                : 'Escribe una dirección más detallada (al menos 5 letras).'
        );
        return toast('Indica la dirección de entrega', 'warning');
    }
    if (!recipientName) {
        markCheckoutFieldInvalid('store-checkout-recipient', 'Escribe el nombre de la persona que recibe el pedido.');
        return toast('Indica quién recibe', 'warning');
    }
    if (!recipientPhone) {
        markCheckoutFieldInvalid('store-checkout-phone', 'Escribe el WhatsApp o teléfono de quien recibe.');
        return toast('Indica el WhatsApp de quien recibe', 'warning');
    }
    const ride = checkoutVehicle();
    if (ride !== 'moto' && ride !== 'auto') {
        const rideGroup = document.querySelector('.store-ride-pick');
        try { rideGroup?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        return toast('Elige moto o carro para el envío', 'warning');
    }

    if (storeTracksStock(viewingStore)) {
        try { viewingProducts = await loadProducts(viewingStore.id); } catch (_) {}
        for (const line of cart) {
            const p = viewingProducts.find((x) => x.id === line.productId);
            const left = productStockLeft(p, viewingStore);
            if (!p || left == null || left < line.qty) {
                return toast(p ? `«${p.name}» solo tiene ${left || 0} en stock` : 'Un producto ya no está en la tienda', 'warning');
            }
        }
    }

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

    // Zonas de envío: ubicación elegida en «Confirmar pedido» (GPS o pin del mapa) y bloqueo
    // si la ciudad no permite pedidos fuera de zona. El monto lo pone el servidor al crear.
    const zoneGate = await checkoutGateForOrder(viewingStore);
    if (zoneGate.point) {
        deliveryLat = zoneGate.point.lat;
        deliveryLng = zoneGate.point.lng;
    }
    if (zoneGate.blocked) {
        refreshCheckoutQuote(false, viewingStore).catch(() => {});
        return toast('Por ahora no llegamos a esa dirección. Prueba otra ubicación.', 'warning');
    }
    if (zoneGate.changed) {
        await refreshCheckoutQuote(false, viewingStore).catch(() => {});
        return toast(`Envío a ${zoneGate.quote.zoneName}: L ${zoneGate.quote.fee}. Revísalo y vuelve a tocar «enviar pedido».`, 'info');
    }

    const items = cart.map((i) => {
        const raw = Number(i.basePrice);
        const base = roundMoney(Number.isFinite(raw) ? raw : (Number(i.price) || 0));
        return {
            productId: i.productId,
            name: i.name,
            basePrice: base,
            price: base,
            displayPrice: base,
            merchantShare: 0,
            buyerShare: 0,
            qty: i.qty,
            photoUrl: i.photoUrl || null,
        };
    });
    const itemsBaseTotal = roundMoney(items.reduce((s, i) => s + i.basePrice * i.qty, 0));
    const itemsDisplayTotal = itemsBaseTotal;
    const platformFeeMerchant = 0;
    const platformFeeBuyer = 0;
    const platformFeeTotal = 0;
    const itemsTotal = itemsBaseTotal;
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
            commissionPercent: Math.round(WEEKLY_COMMISSION_RATE * 100),
            tariffSplit: false,
            weeklyCommissionRate: WEEKLY_COMMISSION_RATE,
            status: 'pending',
            deliveryAddress: address,
            deliveryLat,
            deliveryLng,
            recipientName,
            recipientPhone,
            notes,
            deliveryVehicle: ride,
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
        resetCheckoutZone();
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
        const cat = t.getAttribute('data-cat') || 'all';
        if (cat === ADULT_ZONE_CHIP.id) return openAdultZone();
        storesCategoryFilter = cat;
        marketplaceView = 'list';
        return renderMarketplace();
    }
    if (action === 'browse-city') {
        storesBrowseCityId = t.getAttribute('data-city-id') || null;
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
    if (action === 'zoom-product-photo') {
        e.preventDefault?.();
        e.stopPropagation?.();
        return openProductPhotoZoomModal({
            productId,
            photoUrl: t.getAttribute('data-photo-url') || '',
            title: t.getAttribute('data-photo-title') || '',
            desc: t.getAttribute('data-photo-desc') || '',
            priceText: t.getAttribute('data-photo-price') || '',
        });
    }
    if (action === 'detect-store-fee-gps') {
        e.preventDefault?.();
        e.stopPropagation?.();
        return detectStoreMenuFeeWithGps();
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
    if (action === 'pick-ride') {
        const ride = t.getAttribute('data-ride') === 'auto' ? 'auto' : 'moto';
        document.querySelectorAll('[data-stores-action="pick-ride"]').forEach((b) => {
            b.classList.toggle('is-on', b.getAttribute('data-ride') === ride);
        });
        setCheckoutVehicle(ride);
        return;
    }
    if (action === 'place-order') return placeOrder();
    if (action === 'my-orders') {
        marketplaceView = 'my-orders';
        startClientOrdersListener();
        return renderMarketplace();
    }
    if (action === 'cancel-order' && orderId) return cancelClientOrder(orderId);
    if (action === 'open-rate-order' && orderId) return openOrderProductRatingModal(orderId);
    if (action === 'chat-driver') {
        const tripId = t.getAttribute('data-trip-id') || (clientOrders.find((x) => x.id === orderId)?.tripId) || '';
        return openOrderDriverChatModal({ tripId, role: 'client', orderId });
    }
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
export function buildMerchantAlertsStatusBarHtml() {
    const hasNotifApi = typeof Notification !== 'undefined';
    const perm = hasNotifApi ? Notification.permission : 'granted';
    const isActive = perm === 'granted';
    const isDenied = perm === 'denied';
    return `
        <div class="merchant-alerts-bar ${isActive ? 'merchant-alerts-bar--ok' : 'merchant-alerts-bar--warn'}" data-alerts-state="${esc(perm)}">
            <div class="merchant-alerts-bar__info">
                <span class="merchant-alerts-bar__badge">
                    ${isActive ? '🔔 ✅ Avisos y sonido activos en este dispositivo' : isDenied ? '🔔 ⚠️ Avisos bloqueados en el navegador' : '🔔 ⚠️ Avisos pendientes de activar'}
                </span>
                <p class="merchant-alerts-bar__sub">
                    ${isActive
                        ? 'Cuando caiga un pedido nuevo sonará la alerta y vibrará tu teléfono. Toca «Probar aviso» para verificar el volumen.'
                        : 'Activa los avisos y toca «Probar aviso» para comprobar que tu celular suene cuando entre un pedido.'}
                </p>
            </div>
            <div class="merchant-alerts-bar__actions">
                ${!isActive ? `
                    <button type="button" class="merchant-alerts-btn merchant-alerts-btn--enable" data-merchant-action="enable-order-alerts">
                        🔔 Activar avisos
                    </button>
                ` : ''}
                <button type="button" class="merchant-alerts-btn merchant-alerts-btn--test" data-merchant-action="test-order-alert">
                    🔊 Probar aviso
                </button>
            </div>
        </div>
    `;
}

export async function enableMerchantOrderAlerts() {
    try {
        if (typeof window !== 'undefined' && typeof window.enablePushNotifications === 'function') {
            await window.enablePushNotifications();
        } else if (typeof Notification !== 'undefined' && Notification.requestPermission) {
            await Notification.requestPermission();
        }
    } catch (_) {}
    renderMerchantBody();
    toast('🔔 Estado de avisos actualizado. Toca «🔊 Probar aviso» para escuchar cómo suena.', 'info');
}

export async function testMerchantOrderAlert() {
    playNewOrderTone();
    try { window.playEventNotificationTone?.('store_new_order'); } catch (_) {}
    try { navigator.vibrate?.([220, 100, 260, 100, 320]); } catch (_) {}
    toast('🔔 Prueba de aviso: ¡Así te sonará cuando te caiga un pedido nuevo!', 'success');
    try {
        if (typeof Notification !== 'undefined') {
            if (Notification.permission === 'default' && Notification.requestPermission) {
                await Notification.requestPermission();
            }
            if (Notification.permission === 'granted') {
                const title = `🔔 Prueba de aviso · ${myStore?.name || 'Tu tienda'}`;
                const body = '¡Así te llegará la notificación y el sonido cuando un cliente haga un pedido nuevo!';
                if (navigator.serviceWorker?.getRegistration) {
                    const reg = await navigator.serviceWorker.getRegistration();
                    if (reg?.showNotification) {
                        await reg.showNotification(title, {
                            body,
                            tag: 'merchant-test-alert',
                            renotify: true,
                            vibrate: [220, 100, 260],
                        });
                        renderMerchantBody();
                        return true;
                    }
                }
                new Notification(title, { body, tag: 'merchant-test-alert' });
            }
        }
    } catch (_) {}
    renderMerchantBody();
    return true;
}

export function buildMerchantStoreSwitcherHtml(
    stores = myStores,
    activeStoreId = myStore?.id,
    createMode = merchantCreateMode,
    cloneFrom = merchantCloneFromStore,
    orders = merchantOrders
) {
    const list = Array.isArray(stores) ? stores : [];
    if (!list.length && !createMode) return '';
    const now = hnNowMinutes();
    const pills = list.map((s) => {
        const isCurrent = !createMode && s.id === activeStoreId;
        const openInfo = storeOpenInfo(s, now);
        const branch = formatStoreBranchLabel(s);
        const hoursTxt = formatStoreHoursSummary(s);
        const activeCount = (orders || []).filter(
            (o) => o.storeId === s.id && !['delivered', 'cancelled'].includes(o.status)
        ).length;
        return `
            <button type="button"
                    class="merchant-branch-chip ${isCurrent ? 'is-active' : ''}"
                    data-merchant-action="select-my-store"
                    data-store-id="${esc(s.id)}"
                    title="${esc(s.name || 'Tienda')}${branch ? ` · ${esc(branch)}` : ''} (${esc(hoursTxt)})">
                <span class="merchant-branch-chip__dot ${openInfo.open ? 'is-open' : 'is-closed'}" aria-hidden="true"></span>
                <span class="merchant-branch-chip__body">
                    <strong class="merchant-branch-chip__title">${esc(s.name || 'Tienda')}${branch ? ` <span class="merchant-branch-chip__tag">· ${esc(branch)}</span>` : ''}</strong>
                    <small class="merchant-branch-chip__meta">${esc(s.cityName || 'Honduras')} · ${esc(hoursTxt)}</small>
                </span>
                ${activeCount > 0 ? `<span class="merchant-branch-chip__badge" title="${activeCount} pedidos activos">${activeCount}</span>` : ''}
            </button>
        `;
    }).join('');

    const cloneBtn = myStore?.id ? `
        <button type="button"
                class="merchant-branch-add merchant-branch-add--clone ${createMode && cloneFrom ? 'is-active' : ''}"
                data-merchant-action="clone-branch"
                data-store-id="${esc(myStore.id)}"
                title="Crear otra sucursal de este mismo restaurante con otra ubicación y otro horario">
            <i class="fas fa-code-branch"></i>
            <span>+ Agregar sucursal</span>
        </button>
    ` : '';

    const newBrandBtn = list.length ? `
        <button type="button"
                class="merchant-branch-add merchant-branch-add--new ${createMode && !cloneFrom ? 'is-active' : ''}"
                data-merchant-action="start-create-new"
                title="Registrar otro restaurante o negocio">
            <i class="fas fa-plus"></i>
            <span>+ Otro negocio</span>
        </button>
    ` : '';

    return `
        <div class="merchant-store-switcher__inner" role="region" aria-label="Mis sucursales y restaurantes">
            <div class="merchant-store-switcher__head">
                <span class="merchant-store-switcher__label">
                    <i class="fas fa-store-alt"></i>
                    ${list.length > 1 ? `Tus sucursales / tiendas (${list.length})` : 'Tu restaurante / sucursales'}
                </span>
                <span class="merchant-store-switcher__hint">Cada sucursal tiene su ubicación y horario</span>
            </div>
            <div class="merchant-store-switcher__scroller">
                ${pills}
                ${cloneBtn}
                ${newBrandBtn}
            </div>
        </div>
    `;
}

function renderMerchantStoreSwitcher() {
    if (typeof document === 'undefined') return;
    const wrap = document.getElementById('merchant-store-switcher');
    if (!wrap) return;
    wrap.innerHTML = buildMerchantStoreSwitcherHtml(myStores, myStore?.id, merchantCreateMode, merchantCloneFromStore, merchantOrders);
}

export async function selectMyStore(storeId) {
    if (!storeId) return null;
    const found = myStores.find((s) => s.id === storeId) || storesCache.get(storeId) || null;
    if (!found) return null;
    myStore = found;
    merchantCreateMode = false;
    merchantCloneFromStore = null;
    editingProductId = null;
    setSavedSelectedStoreId(myStore.id);
    myProducts = await loadProducts(myStore.id);
    document.querySelectorAll('.merchant-tab').forEach((b) => {
        b.classList.remove('hidden');
        b.classList.toggle('active', b.getAttribute('data-merchant-tab') === merchantTab);
    });
    const titleEl = document.querySelector('#merchant-panel .stores-title');
    if (titleEl) {
        const b = formatStoreBranchLabel(myStore);
        titleEl.textContent = b ? `${myStore.name || 'Mi tienda'} · ${b}` : 'Mi tienda virtual';
    }
    updateMerchantOpenToggle();
    renderMerchantStoreSwitcher();
    renderMerchantBody();
    return myStore;
}

export async function copyMenuBetweenStores(fromStoreId, toStoreId) {
    const uid = getCurrentUser()?.uid;
    if (!uid || !fromStoreId || !toStoreId || fromStoreId === toStoreId) return 0;
    const sourceProducts = await loadProducts(fromStoreId);
    if (!sourceProducts.length) return 0;
    const existingTarget = await loadProducts(toStoreId);
    const existingNames = new Set(existingTarget.map((p) => String(p.name || '').trim().toLowerCase()));
    let copied = 0;
    for (const p of sourceProducts) {
        const key = String(p.name || '').trim().toLowerCase();
        if (!key || existingNames.has(key)) continue;
        const base = roundMoney(productBasePrice(p));
        await addDoc(publicCol('store_products'), {
            storeId: toStoreId,
            ownerId: uid,
            sourceProductId: p.sourceProductId || p.id,
            name: p.name,
            price: base,
            basePrice: base,
            displayPrice: base,
            description: p.description || '',
            photoUrl: p.photoUrl || null,
            ...(p.stock != null ? { stock: Number(p.stock) || 0 } : {}),
            available: p.available !== false,
            sortOrder: existingTarget.length + copied,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        copied += 1;
    }
    return copied;
}

export async function syncMenuToAllBranches() {
    if (!myStore?.id || myStores.length <= 1) {
        toast('Agrega otra sucursal primero para sincronizar el menú', 'info');
        return 0;
    }
    let totalCopied = 0;
    for (const branch of myStores) {
        if (branch.id === myStore.id) continue;
        totalCopied += await copyMenuBetweenStores(myStore.id, branch.id);
    }
    toast(
        totalCopied > 0
            ? `✅ Se copiaron ${totalCopied} producto(s) nuevos a tus otras sucursales`
            : '✅ Todas tus sucursales ya tienen los productos de este menú',
        'success'
    );
    return totalCopied;
}

export async function startCloneBranch(sourceStoreId = myStore?.id) {
    const base = myStores.find((s) => s.id === sourceStoreId) || myStore;
    if (!base) {
        return openMerchantPanel({ createNew: true });
    }
    pendingStorePhoto = null;
    pendingStorePhotoPreview = base.photoUrl || null;
    merchantCloneFromStore = base;
    merchantCreateMode = true;
    merchantTab = 'store';
    document.querySelectorAll('.merchant-tab').forEach((b) => {
        const tab = b.getAttribute('data-merchant-tab');
        b.classList.toggle('active', tab === 'store');
        b.classList.toggle('hidden', tab !== 'store');
    });
    const titleEl = document.querySelector('#merchant-panel .stores-title');
    if (titleEl) titleEl.textContent = `Nueva sucursal · ${base.name || 'Restaurante'}`;
    renderMerchantStoreSwitcher();
    renderMerchantBody();
    toast(`📍 Configura la ubicación y el horario de la nueva sucursal de ${base.name || 'tu restaurante'}`, 'info');
}

export async function openMerchantPanel(opts = {}) {
    let createNew = opts.createNew === true;
    const cloneFromId = opts.cloneFromStoreId || null;
    if (createNew) {
        pendingStorePhoto = null;
        pendingStorePhotoPreview = null;
    }

    bindUiHooks();
    startStoresListener();
    await loadMyStore(opts.storeId || null);

    if (cloneFromId) {
        merchantCloneFromStore = myStores.find((s) => s.id === cloneFromId) || myStore || null;
        if (merchantCloneFromStore?.photoUrl) pendingStorePhotoPreview = merchantCloneFromStore.photoUrl;
        createNew = true;
    } else if (!createNew) {
        merchantCloneFromStore = null;
    }

    merchantCreateMode = createNew;
    editingProductId = null;

    if (createNew) {
        merchantTab = 'store';
    } else {
        if (!myStore) {
            toast('Aún no tienes tienda. Completa el formulario para crear tu primera tienda.', 'info');
            merchantCreateMode = true;
            merchantTab = 'store';
            myProducts = [];
        } else {
            merchantTab = opts.tab || 'orders';
            myProducts = await loadProducts(myStore.id);
        }
    }

    startMerchantOrdersListener();
    enterStoresWorld();
    document.getElementById('merchant-panel')?.classList.remove('hidden');
    document.getElementById('stores-marketplace-panel')?.classList.add('hidden');

    const titleEl = document.querySelector('#merchant-panel .stores-title');
    if (titleEl) {
        if (merchantCreateMode) {
            titleEl.textContent = merchantCloneFromStore
                ? `Nueva sucursal · ${merchantCloneFromStore.name || 'Restaurante'}`
                : 'Crear tienda o sucursal';
        } else {
            const b = formatStoreBranchLabel(myStore);
            titleEl.textContent = b ? `${myStore?.name || 'Mi tienda'} · ${b}` : 'Mi tienda virtual';
        }
    }

    document.querySelectorAll('.merchant-tab').forEach((b) => {
        const tab = b.getAttribute('data-merchant-tab');
        b.classList.toggle('active', tab === merchantTab);
        if (merchantCreateMode) {
            b.classList.toggle('hidden', tab !== 'store');
        } else {
            b.classList.remove('hidden');
        }
    });
    updateMerchantOpenToggle();
    renderMerchantStoreSwitcher();
    renderMerchantBody();
}

export function openCreateStorePanel() {
    // Si ya tiene tienda, openMerchantPanel redirige a la existente
    return openMerchantPanel({ createNew: true });
}

export function openMyStorePanel(opts = {}) {
    return openMerchantPanel({ createNew: false, ...(opts || {}) });
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

async function loadWeekOrders(range) {
    const uid = getCurrentUser()?.uid;
    if (!uid) return [];
    try {
        const q = query(
            publicCol('store_orders'),
            where('ownerId', '==', uid),
            where('createdAt', '>=', Timestamp.fromDate(range.start)),
            where('createdAt', '<', Timestamp.fromDate(range.end)),
            orderBy('createdAt', 'desc'),
            limit(300)
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('[stores] reporte semanal', e);
        return merchantOrders.filter((o) => {
            const report = weeklySalesReport([o], range);
            return report.count > 0 || o.status === 'cancelled';
        });
    }
}

function weekReportHtml(report, range) {
    const pct = Math.round(WEEKLY_COMMISSION_RATE * 100);
    const rows = report.rows.slice(0, 40).map((r) => {
        const st = ORDER_STATUS[r.status] || { label: r.status || 'Pedido' };
        const when = r.createdAtMs
            ? new Date(r.createdAtMs).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: 'America/Tegucigalpa' })
            : '';
        return `<div class="store-week-row">
            <div><b>${esc(r.clientName || 'Cliente')}</b><small>${esc(st.label)}${when ? ` · ${esc(when)}` : ''}</small></div>
            <span>${money(r.itemsTotal)}</span>
        </div>`;
    }).join('');
    return `
        <div class="store-week">
            <div class="store-week-switch">
                <button type="button" class="${merchantWeekWhich === 'current' ? 'is-on' : ''}" data-merchant-action="week-pick" data-week="current">Esta semana</button>
                <button type="button" class="${merchantWeekWhich === 'previous' ? 'is-on' : ''}" data-merchant-action="week-pick" data-week="previous">Semana pasada</button>
            </div>
            <p class="store-week-range">${esc(formatWeekLabel(range))}</p>
            <div class="store-week-due">
                <small>A cobrar · ${pct}% de las ventas</small>
                <b>${money(report.fee)}</b>
                <span>${report.count} pedido${report.count === 1 ? '' : 's'} · vendiste ${money(report.gross)} en productos</span>
            </div>
            <p class="store-week-note">Esto es lo único que paga la tienda: el ${pct}% de todas las ventas de productos que no se cancelaron. El cliente paga el envío completo de la zona y eso no entra aquí. De lo ya entregado: ${money(report.deliveredFee)} (${report.deliveredCount} pedido${report.deliveredCount === 1 ? '' : 's'}).</p>
            ${rows ? `<div class="store-week-list">${rows}</div>` : `<div class="stores-empty stores-empty--sm"><p>Sin ventas en esta semana.</p></div>`}
        </div>
    `;
}

async function renderMerchantWeekTab(body) {
    const token = ++weekPaintToken;
    const range = hondurasWeekRange(new Date(), merchantWeekWhich === 'previous' ? 'previous' : 'current');
    body.innerHTML = `<div class="store-week"><p class="text-sm font-bold text-slate-500">Cargando ventas de la semana…</p></div>`;
    const orders = await loadWeekOrders(range);
    if (token !== weekPaintToken || !body.isConnected) return;
    const report = weeklySalesReport(orders, range, WEEKLY_COMMISSION_RATE);
    body.innerHTML = weekReportHtml(report, range);
}

function renderMerchantBody() {
    const body = document.getElementById('merchant-panel-body');
    if (!body) return;
    if (merchantDeliveryTab && merchantTab !== 'pedir-envio') { merchantDeliveryTab.unmount(); merchantDeliveryTab = null; }

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
    if (merchantTab === 'pedir-envio') {
        if (merchantDeliveryTab) merchantDeliveryTab.unmount();
        body.innerHTML = '';
        merchantDeliveryTab = createMerchantDeliveryTab(merchantDeliveryCtx());
        merchantDeliveryTab.mount(body);
        return;
    }
    if (merchantTab === 'envios') {
        // Tarifa de envío por zona (la valida el servidor)
        renderMerchantZonesTab(body, myStore).catch((e) => console.warn('[stores] envíos', e));
        return;
    }
    if (merchantTab === 'products') {
        body.innerHTML = renderMerchantProducts();
        // Preview en vivo de precio + tarifa
        requestAnimationFrame(() => bindMerchantProductPricePreview());
        return;
    }
    if (merchantTab === 'semana') {
        renderMerchantWeekTab(body);
        return;
    }
    // orders (filtrados por la sucursal seleccionada si tiene varias)
    const storeOrders = (myStores.length > 1 && myStore?.id)
        ? merchantOrders.filter((o) => !o.storeId || o.storeId === myStore.id)
        : merchantOrders;
    const active = storeOrders.filter((o) => !['delivered', 'cancelled'].includes(o.status));
    const past = storeOrders.filter((o) => ['delivered', 'cancelled'].includes(o.status));
    const appr = myStore ? storeApprovalStatus(myStore) : null;
    const apprMeta = appr ? (STORE_APPROVAL[appr] || STORE_APPROVAL.pending) : null;
    body.innerHTML = `
        <div class="orders-list">
            ${buildMerchantAlertsStatusBarHtml()}
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
                <div class="merchant-share-banner" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-color:#93c5fd;margin-bottom:8px">
                    <div class="min-w-0">
                        <p class="merchant-share-title" style="color:#0c4a8e"><i class="fas fa-motorcycle"></i> ¿Necesitas enviar un pedido a un cliente?</p>
                        <p class="merchant-share-sub" style="color:#1e3a8a">Pide un delivery desde aquí y comparte el viaje en vivo por WhatsApp al cliente</p>
                    </div>
                    <button type="button" class="stores-primary-btn stores-primary-btn--sm" data-merchant-action="goto-pedir-envio">
                        <i class="fas fa-paper-plane"></i> 🛵 Pedir envío
                    </button>
                </div>
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
    const editingExisting = !merchantCreateMode && myStore;
    const cloningFrom = merchantCreateMode && merchantCloneFromStore ? merchantCloneFromStore : null;
    const s = editingExisting
        ? myStore
        : cloningFrom
            ? {
                name: cloningFrom.name || '',
                branchName: '',
                category: cloningFrom.category || 'comida',
                description: cloningFrom.description || '',
                cityId: cloningFrom.cityId || '',
                phone: cloningFrom.phone || '',
                waAuthorizedPhones: cloningFrom.waAuthorizedPhones || [],
                hours: cloningFrom.hours || null,
                photoUrl: cloningFrom.photoUrl || null,
            }
            : {};
    const storeCityId = initialStoreCityId(s);
    const savedCityMismatch = editingExisting && s.cityId && storeCityId !== s.cityId;
    const adultsLocked = !!(editingExisting && isStoreAdultsOnly(s) && !isStoresStaff());
    const cats = STORE_CATEGORIES.map((c) =>
        `<option value="${c.id}" ${s.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`
    ).join('');
    const logoPreview = pendingStorePhotoPreview
        || ((editingExisting || cloningFrom) && s.photoUrl ? s.photoUrl : null);
    const logoHtml = logoPreview
        ? `<img src="${esc(logoPreview)}" alt="Logo de la tienda" class="m-store-logo-preview">`
        : `<div class="m-store-logo-preview m-store-logo-preview--empty"><i class="fas fa-store"></i><span>Logo o foto del negocio</span></div>`;
    const copySourceStore = cloningFrom || (!editingExisting && myStore ? myStore : null);
    return `
        <form id="merchant-store-form" class="merchant-form space-y-3" onsubmit="return false;">
            <div class="stores-banner">
                <p class="stores-banner-title">
                    <i class="fas ${editingExisting ? 'fa-store' : cloningFrom ? 'fa-code-branch' : 'fa-plus-circle'}"></i>
                    ${editingExisting ? 'Datos de esta sucursal / tienda' : cloningFrom ? `Nueva sucursal de ${esc(cloningFrom.name || 'tu restaurante')}` : 'Registrar tienda o sucursal nueva'}
                </p>
                <p class="stores-banner-sub">
                    ${editingExisting
                        ? 'Edita el nombre, la sucursal, la ubicación GPS y el horario propio de este punto.'
                        : cloningFrom
                            ? 'Configura la dirección/GPS y el horario de esta nueva sucursal. El menú se puede copiar automáticamente.'
                            : 'Completa los datos y sube el logo. Puedes tener varias sucursales con distinta ubicación y horario.'}
                </p>
            </div>
            ${editingExisting ? `
                <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                    <span><i class="fas fa-code-branch"></i> ¿Tienes este mismo restaurante en otra ubicación u otro horario?</span>
                    <button type="button" class="stores-secondary-btn text-[11px] py-1 px-2.5" data-merchant-action="clone-branch" data-store-id="${esc(s.id)}">
                        + Agregar otra sucursal
                    </button>
                </div>
            ` : `
                <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    <span><i class="fas fa-info-circle"></i> Cada sucursal tiene su propia <b>ubicación GPS</b> y su propio <b>horario de apertura y cierre</b>.</span>
                    ${myStore ? `<button type="button" class="stores-secondary-btn text-[11px] py-1 px-2.5" data-merchant-action="goto-my-store">Cancelar</button>` : ''}
                </div>
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
            <label class="stores-field"><span>Nombre del restaurante / tienda *</span>
                <input id="m-store-name" class="stores-input" required value="${esc(s.name || '')}" placeholder="Ej: Pupusas Doña Mary"></label>
            <label class="stores-field"><span>Nombre de la sucursal / ubicación (si tienes varias)</span>
                <input id="m-store-branch-name" class="stores-input" value="${esc(s.branchName || '')}" placeholder="Ej: Sucursal Centro, Sucursal Bulevar Morazán, Turno Noche"></label>
            ${!editingExisting && copySourceStore ? `
                <label class="stores-field stores-field--check" style="flex-direction:row;align-items:flex-start;gap:0.65rem;cursor:pointer;background:#ecfdf5;border:1px solid #a7f3d0;padding:0.65rem;border-radius:0.85rem;">
                    <input type="checkbox" id="m-store-copy-menu" checked data-source-store-id="${esc(copySourceStore.id)}" style="width:1.1rem;height:1.1rem;margin-top:0.15rem;flex-shrink:0;">
                    <span>
                        <strong class="block text-xs text-emerald-950">Copiar automáticamente todo el menú de «${esc(copySourceStore.name || 'mi tienda')}»</strong>
                        <small class="text-[10px] text-emerald-800 font-semibold leading-snug">Copia fotos, nombres y precios de tus platos para que no tengas que subirlos de nuevo.</small>
                    </span>
                </label>
            ` : ''}
            <label class="stores-field"><span>Categoría</span>
                <select id="m-store-category" class="stores-input">${cats}</select></label>
            <label class="stores-field"><span>Descripción</span>
                <textarea id="m-store-desc" class="stores-input" rows="2" placeholder="Qué vendes...">${esc(s.description || '')}</textarea></label>
            <label class="stores-field"><span>Ciudad de la tienda *</span>
                <select id="m-store-city" class="stores-input" required>${buildStoreCityOptionsHtml(storeCityId)}</select></label>
            ${savedCityMismatch ? `
                <p class="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    <i class="fas fa-exclamation-triangle"></i> Tu tienda estaba publicada en <b>${esc(s.cityName || s.cityId)}</b>.
                    Revisa la ciudad y toca guardar para corregirla.
                </p>` : ''}
            <label class="stores-field"><span>Dirección / punto de recogida *</span>
                <input id="m-store-address" class="stores-input" required value="${esc(s.address || '')}" placeholder="Colonia, calle, referencia"></label>
            <div class="grid grid-cols-2 gap-2">
                <label class="stores-field"><span>Abre a las</span>
                    <input id="m-store-open-at" class="stores-input" type="time" value="${esc(s.hours?.open || '')}"></label>
                <label class="stores-field"><span>Cierra a las</span>
                    <input id="m-store-close-at" class="stores-input" type="time" value="${esc(s.hours?.close || '')}"></label>
            </div>
            <p class="text-[10px] text-slate-500 -mt-1 leading-snug">Horario de todos los días, hora de Honduras. Fuera de ese horario tu tienda sale como “Cerrada” y va al final de la lista. Déjalo vacío si prefieres abrir y cerrar a mano.</p>
            <label class="stores-field"><span>WhatsApp del negocio *</span>
                <input id="m-store-phone" class="stores-input" required value="${esc(s.phone || (!editingExisting ? (getUserProfile()?.phone || '') : ''))}" placeholder="+504..."></label>
            <label class="stores-field"><span>Números autorizados para pedir por WhatsApp</span>
                <textarea id="m-store-wa-phones" class="stores-input" rows="2" placeholder="+504 9999-0000, +504 8888-1111">${esc((Array.isArray(s.waAuthorizedPhones) ? s.waAuthorizedPhones : []).map((x) => `+${x}`).join(', '))}</textarea></label>
            <p class="text-[10px] text-slate-500 -mt-1 leading-snug">Empleados que pueden pedir envíos de tu tienda escribiendo al WhatsApp de HonduRaite (máximo 10, separados por coma). El teléfono de la tienda y el tuyo ya están autorizados.</p>
            <label class="stores-field stores-field--check" style="flex-direction:row;align-items:flex-start;gap:0.65rem;cursor:pointer;">
                <input type="checkbox" id="m-store-adults-only" ${isStoreAdultsOnly(s) ? 'checked' : ''} ${adultsLocked ? 'disabled' : ''} style="width:1.1rem;height:1.1rem;margin-top:0.15rem;flex-shrink:0;">
                <span>
                    <strong class="block text-sm text-slate-800">Tienda solo para mayores de 18 (+18)</strong>
                    <small class="text-[10px] text-slate-500 font-semibold leading-snug">${adultsLocked
                        ? 'Marcada +18. Solo un supervisor puede quitar esta marca.'
                        : 'Ej. alcohol, tabaco u otros productos restringidos. Un supervisor lo confirma al verificar.'}</small>
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
            <p class="text-[11px] text-slate-500">Los clientes verán tu tienda en la ciudad que elijas arriba. Si usas el GPS, la ciudad se elige sola.</p>
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
    const city = store?.cityName || '';
    const available = (products || []).filter((p) => p.available !== false);
    const lines = available.slice(0, 40).map((p) => {
        const price = Number(p.price);
        const priceTxt = Number.isFinite(price) ? `${formatLempiras(price)}` : '';
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

export function buildMerchantStarProductsHtml(products = myProducts, orders = merchantOrders) {
    const storeOrders = myStore?.id ? (orders || []).filter((o) => !o.storeId || o.storeId === myStore.id) : (orders || []);
    const stars = computeStarProducts(products, storeOrders).slice(0, 5);
    if (!stars.length) {
        return `
            <div class="star-products-box star-products-box--empty">
                <div class="star-products-box__head">
                    <span class="star-products-box__title">⭐ Tus productos estrella</span>
                    <span class="star-products-box__badge">Ranking de clientes</span>
                </div>
                <p class="star-products-box__hint">Cuando tus clientes reciban y puntúen sus pedidos (1 a 5 ★), aquí verás tus platos mejor calificados y más vendidos.</p>
            </div>
        `;
    }
    return `
        <div class="star-products-box">
            <div class="star-products-box__head">
                <span class="star-products-box__title">⭐ Tus productos estrella (${stars.length})</span>
                <span class="star-products-box__badge">Visibles para clientes nuevos</span>
            </div>
            <div class="star-products-box__list">
                ${stars.map((p, idx) => {
                    const r = productRatingInfo(p);
                    return `
                        <div class="star-products-row" data-merchant-star-id="${esc(p.id)}">
                            <span class="star-products-row__rank">#${idx + 1}</span>
                            <div class="min-w-0 flex-1">
                                <p class="star-products-row__name">${esc(p.name)} ${r.isStar ? '<span class="star-pill">⭐ Estrella</span>' : ''}</p>
                                <p class="star-products-row__meta">
                                    ${r.count > 0 ? `<b>★ ${r.avg.toFixed(1)}</b> (${r.count} ${r.count === 1 ? 'voto' : 'votos'})` : 'Sin votos aún'}
                                    · <span>${r.ordersCount} vendidos</span>
                                    · <span>${money(productBasePrice(p))}</span>
                                </p>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

export function buildEditProductCardHtml(p, store = myStore, stores = myStores) {
    if (!p) return '';
    const tracksStock = storeTracksStock(store);
    const price = productBasePrice(p);
    const left = productStockLeft(p, store);
    const photoSrc = pendingEditProductPhotoPreview || p.photoUrl || '';
    const otherBranchesCount = Array.isArray(stores) ? stores.filter((s) => s.id !== store?.id).length : 0;
    return `
        <div class="merchant-edit-product-card" data-edit-product-card="${esc(p.id)}">
            <div class="merchant-edit-product-card__head">
                <p class="merchant-edit-product-card__title"><i class="fas fa-pen"></i> Editar producto: ${esc(p.name)}</p>
                <button type="button" class="merchant-edit-product-card__close" data-merchant-action="cancel-edit-product" aria-label="Cancelar edición">✕</button>
            </div>
            <div class="merchant-edit-product-card__grid">
                <button type="button" class="merchant-edit-photo-btn" data-merchant-action="pick-edit-form-photo" data-product-id="${esc(p.id)}">
                    ${photoSrc
                        ? `<img src="${esc(photoSrc)}" alt="${esc(p.name)}" class="merchant-edit-photo-preview">`
                        : `<div class="merchant-edit-photo-preview merchant-edit-photo-preview--empty"><i class="fas fa-camera"></i></div>`}
                    <span><i class="fas fa-camera"></i> Cambiar imagen</span>
                </button>
                <div class="merchant-edit-product-card__fields">
                    <label class="stores-field">
                        <span>Nombre del producto *</span>
                        <input id="m-edit-prod-name" class="stores-input" value="${esc(p.name || '')}" placeholder="Nombre del plato o producto">
                    </label>
                    <label class="stores-field">
                        <span>Precio para el cliente (L.) *</span>
                        <input id="m-edit-prod-price" class="stores-input" type="number" min="1" step="0.01" inputmode="decimal" value="${esc(price)}">
                    </label>
                    ${tracksStock ? `
                        <label class="stores-field">
                            <span>Stock disponible</span>
                            <input id="m-edit-prod-stock" class="stores-input" type="number" min="0" step="1" inputmode="numeric" value="${esc(left ?? 0)}">
                        </label>
                    ` : ''}
                    <label class="stores-field">
                        <span>Descripción (opcional)</span>
                        <input id="m-edit-prod-desc" class="stores-input" value="${esc(p.description || '')}" placeholder="Ingredientes, tamaño, acompañamientos...">
                    </label>
                </div>
            </div>
            ${otherBranchesCount > 0 ? `
                <label class="merchant-edit-sync-check">
                    <input type="checkbox" id="m-edit-prod-sync-branches" checked>
                    <span>Actualizar precio, nombre y foto también en mis otras sucursales (${otherBranchesCount})</span>
                </label>
            ` : ''}
            <div class="merchant-edit-product-card__actions">
                <button type="button" class="stores-primary-btn" data-merchant-action="save-edit-product" data-product-id="${esc(p.id)}">
                    <i class="fas fa-save"></i> Guardar cambios
                </button>
                <button type="button" class="stores-secondary-btn" data-merchant-action="cancel-edit-product">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

export function startEditProduct(productId) {
    const p = myProducts.find((x) => x.id === productId);
    if (!p) return null;
    editingProductId = productId;
    pendingEditProductPhoto = null;
    pendingEditProductPhotoPreview = null;
    renderMerchantBody();
    return p;
}

export function cancelEditProduct() {
    editingProductId = null;
    pendingEditProductPhoto = null;
    pendingEditProductPhotoPreview = null;
    renderMerchantBody();
}

function pickPhotoForEditingProduct(productId) {
    if (!productId) return;
    pickPhotoWithSourceChoice({
        facing: 'environment',
        maxSize: 960,
        title: 'Cambiar imagen del producto',
        cameraLabel: 'Tomar foto',
        galleryLabel: 'Elegir de la galería',
        onCapture: (dataUrl) => {
            if (!dataUrl) return;
            pendingEditProductPhoto = dataUrl;
            pendingEditProductPhotoPreview = dataUrl;
            renderMerchantBody();
            toast('Imagen lista. Toca «Guardar cambios» para aplicarla.', 'info');
        },
        onError: (msg) => toast(msg || 'No se pudo procesar la foto', 'error'),
    });
}

async function syncProductUpdateAcrossBranches(origProduct, patch) {
    const uid = getCurrentUser()?.uid;
    if (!uid || !origProduct || myStores.length <= 1) return 0;
    const otherStoreIds = myStores.map((s) => s.id).filter((id) => id && id !== myStore?.id);
    if (!otherStoreIds.length) return 0;
    const origNameLower = String(origProduct.name || '').trim().toLowerCase();
    const origSourceId = origProduct.sourceProductId || origProduct.id;
    let updatedCount = 0;
    for (const sid of otherStoreIds) {
        try {
            const list = await loadProducts(sid);
            const match = list.find(
                (item) => (item.sourceProductId && item.sourceProductId === origSourceId)
                    || item.id === origSourceId
                    || String(item.name || '').trim().toLowerCase() === origNameLower
            );
            if (match) {
                await updateDoc(publicDoc('store_products', match.id), {
                    ...patch,
                    updatedAt: serverTimestamp(),
                });
                updatedCount += 1;
            }
        } catch (err) {
            console.warn('[stores] syncProductUpdateAcrossBranches', sid, err);
        }
    }
    return updatedCount;
}

export async function saveEditedProduct(productId) {
    const pid = productId || editingProductId;
    const p = myProducts.find((x) => x.id === pid);
    if (!p || !myStore?.id) return false;

    const name = document.getElementById('m-edit-prod-name')?.value.trim() || '';
    const priceRaw = Number(document.getElementById('m-edit-prod-price')?.value);
    const description = document.getElementById('m-edit-prod-desc')?.value.trim() || '';
    const syncBranches = !!document.getElementById('m-edit-prod-sync-branches')?.checked;
    if (!name) {
        toast('El nombre del producto es obligatorio', 'warning');
        return false;
    }
    if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
        toast('Escribe un precio válido mayor a L. 0', 'warning');
        return false;
    }
    const base = roundMoney(priceRaw);
    const tracksStock = storeTracksStock(myStore);
    const patch = {
        name,
        price: base,
        basePrice: base,
        displayPrice: base,
        description,
        updatedAt: serverTimestamp(),
    };
    if (tracksStock) {
        const stockRaw = document.getElementById('m-edit-prod-stock')?.value;
        const stock = Math.floor(Number(stockRaw));
        if (!Number.isFinite(stock) || stock < 0) {
            toast('El stock debe ser 0 o más', 'warning');
            return false;
        }
        patch.stock = stock;
    }

    try {
        toast(pendingEditProductPhoto ? 'Subiendo nueva imagen y guardando cambios…' : 'Guardando cambios del producto…', 'info');
        if (pendingEditProductPhoto) {
            try {
                patch.photoUrl = await uploadProductPhoto(pendingEditProductPhoto, pid);
            } catch (photoErr) {
                console.warn('[stores] saveEditedProduct photo', photoErr);
                toast('Se guardarán precio y nombre, pero la imagen no subió.', 'warning');
            }
        }
        await updateDoc(publicDoc('store_products', pid), patch);
        Object.assign(p, patch);

        let syncedBranches = 0;
        if (syncBranches && myStores.length > 1) {
            const branchPatch = {
                name: patch.name,
                price: patch.price,
                basePrice: patch.basePrice,
                displayPrice: patch.displayPrice,
                description: patch.description,
                ...(patch.photoUrl ? { photoUrl: patch.photoUrl } : {}),
            };
            syncedBranches = await syncProductUpdateAcrossBranches(p, branchPatch);
        }

        editingProductId = null;
        pendingEditProductPhoto = null;
        pendingEditProductPhotoPreview = null;
        myProducts = await loadProducts(myStore.id);
        renderMerchantBody();
        toast(
            syncedBranches > 0
                ? `✅ Producto actualizado aquí y en ${syncedBranches} sucursal(es) más`
                : '✅ Producto actualizado (precio, nombre e imagen guardados)',
            'success'
        );
        return true;
    } catch (e) {
        console.error('[stores] saveEditedProduct', e);
        toast('No se pudo actualizar el producto: ' + (e.message || e), 'error');
        return false;
    }
}

function renderMerchantProducts() {
    const preview = pendingProductPhotoPreview
        ? `<img src="${esc(pendingProductPhotoPreview)}" alt="Vista previa" class="m-prod-photo-preview">`
        : `<div class="m-prod-photo-preview m-prod-photo-preview--empty"><i class="fas fa-camera"></i><span>Foto del producto</span></div>`;
    const tracksStock = storeTracksStock(myStore);
    const hasMultipleBranches = myStores.length > 1;
    return `
        <div class="merchant-products">
            <div class="merchant-share-banner">
                <div class="min-w-0">
                    <p class="merchant-share-title"><i class="fas fa-share-alt"></i> Comparte tu catálogo</p>
                    <p class="merchant-share-sub">WhatsApp, redes o copiar texto · atrae más clientes</p>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    ${hasMultipleBranches ? `
                        <button type="button" class="stores-secondary-btn text-[11px] py-1.5 px-2.5" data-merchant-action="sync-menu-branches" title="Copiar platos nuevos a todas mis sucursales">
                            <i class="fas fa-sync-alt"></i> Sincronizar sucursales
                        </button>
                    ` : ''}
                    <button type="button" class="stores-primary-btn stores-primary-btn--sm" data-merchant-action="share-catalog">
                        <i class="fas fa-bullhorn"></i> Compartir
                    </button>
                </div>
            </div>
            ${buildMerchantStarProductsHtml(myProducts, merchantOrders)}
            <div class="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2.5 mb-3">
                <p class="text-[11px] font-black text-violet-900"><i class="fas fa-percentage"></i> HonduRaite cobra el 10% de la semana</p>
                <p class="text-[10px] font-semibold text-violet-800 mt-1 leading-snug">
                    El cliente paga el precio que pongas y el envío completo de su zona.<br>
                    Tú pagas el 10% de las ventas de productos, de lunes a domingo. El envío no entra. Lo ves en la pestaña Semana.
                </p>
            </div>
            ${tracksStock ? `
            <div class="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3">
                <p class="text-[11px] font-black text-amber-900"><i class="fas fa-boxes"></i> Esta tienda lleva stock</p>
                <p class="text-[10px] font-semibold text-amber-800 mt-1 leading-snug">Escribe cuántos tienes de cada producto. En 0 el cliente no puede pedirlo. Comida y restaurante no usan stock.</p>
            </div>` : ''}
            <form id="merchant-product-form" class="merchant-form space-y-2 mb-4 p-3 rounded-2xl border border-amber-100 bg-amber-50/50" onsubmit="return false;">
                <p class="stores-section-label">Agregar producto</p>
                <button type="button" class="m-prod-photo-pick" data-merchant-action="pick-product-photo" aria-label="Elegir foto del producto">
                    ${preview}
                    <span class="m-prod-photo-hint"><i class="fas fa-image"></i> ${pendingProductPhoto ? 'Cambiar foto' : 'Agregar foto (recomendado)'}</span>
                </button>
                <input type="file" id="m-prod-photo-input" accept="image/*" class="hidden">
                <input id="m-prod-name" class="stores-input" placeholder="Nombre *" required>
                <input id="m-prod-price" class="stores-input" type="number" min="1" step="0.01" placeholder="Precio que paga el cliente L. *" required inputmode="decimal">
                ${tracksStock ? `<input id="m-prod-stock" class="stores-input" type="number" min="0" step="1" placeholder="Cuántos tienes en stock *" required inputmode="numeric">` : `<p class="text-[10px] font-semibold text-emerald-800">Comida y restaurante no llevan stock. Se piden y se preparan.</p>`}
                <div id="m-prod-tariff-live" class="rounded-xl bg-white/80 border border-amber-100 px-2.5 py-2 text-[10px] font-semibold text-slate-600 leading-snug">
                    Escribe tu precio base para ver cuánto verá el cliente.
                </div>
                <input id="m-prod-desc" class="stores-input" placeholder="Descripción (opcional)">
                <button type="button" class="stores-primary-btn w-full" data-merchant-action="add-product">Agregar al menú</button>
            </form>
            <div class="flex items-center justify-between gap-2 mb-2">
                <p class="stores-section-label !mb-0">Tu menú (${myProducts.length})</p>
                <span class="text-[10px] font-bold text-slate-500">Toca «✏️ Editar» para cambiar precio, nombre o foto</span>
            </div>
            <div class="space-y-2">
                ${myProducts.length ? myProducts.map((p) => {
                    if (editingProductId === p.id) {
                        return buildEditProductCardHtml(p, myStore, myStores);
                    }
                    const price = productBasePrice(p);
                    const left = productStockLeft(p, myStore);
                    const rInfo = productRatingInfo(p);
                    return `
                    <div class="product-card ${rInfo.isStar ? 'product-card--star' : ''}" data-merchant-product-card="${esc(p.id)}">
                        ${productPhotoHtml(p)}
                        <div class="min-w-0 flex-1">
                            ${(rInfo.isStar || rInfo.count > 0 || rInfo.ordersCount > 0) ? `
                                <div class="product-card-stars">
                                    ${rInfo.isStar ? '<span class="star-pill">⭐ Producto estrella</span>' : ''}
                                    ${rInfo.count > 0 ? `<span class="star-rating-chip">★ ${rInfo.avg.toFixed(1)} (${rInfo.count})</span>` : ''}
                                    ${rInfo.ordersCount > 0 ? `<span class="star-orders-chip">🔥 ${rInfo.ordersCount} vendidos</span>` : ''}
                                </div>
                            ` : ''}
                            <p class="product-card-name">${esc(p.name)}</p>
                            <p class="product-card-price">${money(price)}</p>
                            <p class="text-[10px] font-bold text-violet-700">El cliente paga este precio. El envío va aparte.</p>
                            ${tracksStock ? `
                                <label class="store-stock-edit">
                                    <span>Stock</span>
                                    <input type="number" min="0" step="1" inputmode="numeric" value="${left ?? 0}" data-stock-for="${esc(p.id)}" aria-label="Stock de ${esc(p.name)}">
                                    <button type="button" data-merchant-action="save-stock" data-product-id="${esc(p.id)}">Guardar</button>
                                </label>
                            ` : ''}
                            ${p.description ? `<p class="product-card-desc">${esc(p.description)}</p>` : ''}
                        </div>
                        <div class="flex flex-col gap-1">
                            <button type="button" class="stores-edit-btn text-[10px] py-1.5 px-2.5" data-merchant-action="edit-product" data-product-id="${esc(p.id)}">
                                <i class="fas fa-pen"></i> Editar
                            </button>
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
    if (!Number.isFinite(base) || base <= 0) {
        live.innerHTML = 'Ese precio es el que paga el cliente. El envío de la zona lo paga él, completo.';
        return;
    }
    const price = roundMoney(base);
    live.innerHTML = `El cliente paga <b>${money(price)}</b>. El envío de su zona lo paga aparte. De tus ventas, HonduRaite cobra el 10% a la semana.`;
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
    const branchName = document.getElementById('m-store-branch-name')?.value.trim() || '';
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
    const waAuthorizedPhones = [...new Set(String(document.getElementById('m-store-wa-phones')?.value || '')
        .split(/[,;\n]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean)
        .map((d) => (d.startsWith('00') ? d.slice(2) : d)).map((d) => (d.length === 8 ? `504${d}` : d)))];
    if (waAuthorizedPhones.some((d) => !/^504[2-9]\d{7}$/.test(d))) return toast('Revisa los números autorizados: deben ser de Honduras (8 dígitos)', 'warning');
    if (waAuthorizedPhones.length > 10) return toast('Máximo 10 números autorizados', 'warning');

    // Horario diario (opcional): las dos horas o ninguna
    const openAt = document.getElementById('m-store-open-at')?.value || '';
    const closeAt = document.getElementById('m-store-close-at')?.value || '';
    if ((openAt && !closeAt) || (!openAt && closeAt)) {
        return toast('Pon la hora de abrir y la de cerrar, o deja las dos vacías', 'warning');
    }
    if (openAt && parseHHMM(openAt) === parseHHMM(closeAt)) {
        return toast('La hora de abrir y la de cerrar no pueden ser iguales', 'warning');
    }
    const hours = openAt && closeAt ? { open: openAt, close: closeAt, tz: 'America/Tegucigalpa' } : null;

    // Ciudad REAL de la tienda (elegida y validada con la ubicación). Ya no se usa la ciudad del dispositivo.
    const selectedCityId = document.getElementById('m-store-city')?.value || '';
    const cityCheck = resolveStoreCity({ selectedId: selectedCityId, lat, lng });
    if (!cityCheck.ok) {
        if (cityCheck.suggested) {
            const sel = document.getElementById('m-store-city');
            if (sel && !sel.value) sel.value = cityCheck.suggested.id;
        }
        return toast(cityCheck.message, 'warning');
    }
    const storeCity = cityCheck.zone;
    // Sin GPS (o con el centro de otra ciudad guardado por error): usar el centro de la ciudad de la tienda
    const hasRealCoords = validCoords(lat, lng) && !isZoneCenterCoords(lat, lng);
    const finalLat = hasRealCoords ? lat : (storeCity.center?.lat ?? null);
    const finalLng = hasRealCoords ? lng : (storeCity.center?.lng ?? null);
    const adultsChecked = !!document.getElementById('m-store-adults-only')?.checked;

    await loadMyStore(myStore?.id || null);
    const isNewStore = merchantCreateMode || !myStore?.id;
    const cloneSource = isNewStore ? (merchantCloneFromStore || myStore || null) : null;
    const copyMenuEl = document.getElementById('m-store-copy-menu');
    const shouldCopyMenu = !!(isNewStore && copyMenuEl?.checked && cloneSource?.id);

    // Si un supervisor la marcó +18, el dueño no puede quitarlo (las reglas también lo impiden)
    const adultsOnly = adultsChecked || (!isNewStore && isStoreAdultsOnly(myStore) && !isStoresStaff());

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
        branchName: branchName || null,
        parentStoreId: isNewStore && merchantCloneFromStore?.id
            ? (merchantCloneFromStore.parentStoreId || merchantCloneFromStore.id)
            : (myStore?.parentStoreId || null),
        category,
        description,
        address,
        phone,
        waAuthorizedPhones,
        lat: finalLat,
        lng: finalLng,
        cityId: storeCity.id,
        cityName: storeCity.name,
        cityDepartment: storeCity.department || null,
        citySource: cityCheck.source,
        locationApprox: !hasRealCoords,
        isOpen: isNewStore ? true : (myStore?.isOpen !== false),
        hours,
        active: true,
        adultsOnly,
        requiresAge18: adultsOnly,
        // Conservar logo anterior o el de la sucursal madre si no hay uno nuevo pendiente
        photoUrl: (!isNewStore && myStore?.photoUrl)
            ? myStore.photoUrl
            : (isNewStore && merchantCloneFromStore?.photoUrl ? merchantCloneFromStore.photoUrl : null),
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
            const finalPhoto = photoUrl || payload.photoUrl || null;
            myStore = { id: ref.id, ...payload, photoUrl: finalPhoto, approvalStatus: 'pending' };
            storesCache.set(ref.id, myStore);
            myStores = sortOwnedStores([...myStores.filter((x) => x.id !== ref.id), myStore]);
            setSavedSelectedStoreId(ref.id, user.uid);
            let copiedCount = 0;
            if (shouldCopyMenu && cloneSource?.id) {
                try {
                    copiedCount = await copyMenuBetweenStores(cloneSource.id, ref.id);
                } catch (copyErr) {
                    console.warn('[stores] copyMenuBetweenStores', copyErr);
                }
            }
            myProducts = await loadProducts(ref.id);
            merchantCreateMode = false;
            merchantCloneFromStore = null;
            pendingStorePhoto = null;
            pendingStorePhotoPreview = null;
            toast(
                copiedCount > 0
                    ? `¡Sucursal creada con ${copiedCount} productos copiados del menú!`
                    : '¡Tienda / sucursal creada! Está en revisión de un supervisor. Mientras, agrega o edita tus productos.',
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
        renderMerchantStoreSwitcher();
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
            const gpsCity = cityFromStoreCoords(pos.coords.latitude, pos.coords.longitude);
            const citySel = document.getElementById('m-store-city');
            if (gpsCity && citySel) citySel.value = gpsCity.id;
            toast(gpsCity ? `Ubicación GPS cargada · ${gpsCity.name}` : 'Ubicación GPS cargada', 'success');
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
    const tracksStock = storeTracksStock(myStore);
    const stockRaw = document.getElementById('m-prod-stock')?.value;
    const stock = Math.floor(Number(stockRaw));
    if (tracksStock && (!Number.isFinite(stock) || stock < 0 || String(stockRaw ?? '').trim() === '')) {
        return toast('Escribe el stock (cuántos tienes). Usa 0 si se acabó.', 'warning');
    }

    try {
        toast(pendingProductPhoto ? 'Subiendo foto y guardando…' : 'Guardando producto…', 'info');
        const base = roundMoney(price);
        const ref = await addDoc(publicCol('store_products'), {
            storeId: myStore.id,
            ownerId: getCurrentUser().uid,
            name,
            price: base,
            basePrice: base,
            displayPrice: base,
            description,
            photoUrl: null,
            ...(tracksStock ? { stock } : {}),
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

async function saveProductStock(productId) {
    const input = document.querySelector(`[data-stock-for="${CSS.escape(productId)}"]`);
    const stock = Math.floor(Number(input?.value));
    if (!Number.isFinite(stock) || stock < 0) return toast('El stock tiene que ser 0 o más', 'warning');
    try {
        await updateDoc(publicDoc('store_products', productId), {
            stock,
            updatedAt: serverTimestamp(),
        });
        const p = myProducts.find((x) => x.id === productId);
        if (p) p.stock = stock;
        toast(stock === 0 ? 'Stock en 0. El cliente ya no puede pedirlo.' : `Stock actualizado: ${stock}`, 'success');
    } catch (e) {
        console.warn('[stores] stock', e);
        toast('No se pudo guardar el stock', 'error');
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

        myStores = myStores.filter((s) => s.id !== storeId);
        if (myStore?.id === storeId) {
            myStore = myStores[0] || null;
            setSavedSelectedStoreId(myStore?.id || null);
            myProducts = myStore ? await loadProducts(myStore.id) : [];
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

/* ===================== PEDIR ENVÍO DIRECTO (tienda → moto / carro) ===================== */
let merchantDeliveryTab = null;

async function merchantPlacesFetch(q) {
    if (typeof google === 'undefined' || !google.maps?.importLibrary) return [];
    const places = await google.maps.importLibrary('places');
    const zone = getZoneById(myStore?.cityId) || null;
    const center = Number.isFinite(Number(myStore?.lat)) ? { lat: Number(myStore.lat), lng: Number(myStore.lng) } : (zone?.center || null);
    const req = { input: q, includedRegionCodes: ['hn'], language: 'es' };
    if (center) req.locationBias = { center, radius: 30000 };
    const res = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    return (res?.suggestions || []).slice(0, 6).map((s) => ({
        description: s.placePrediction?.text?.toString?.() || '',
        prediction: s.placePrediction,
    })).filter((s) => s.description);
}
async function merchantPlaceDetails(s) {
    const place = s?.prediction?.toPlace?.();
    if (!place) return null;
    await place.fetchFields({ fields: ['location', 'formattedAddress'] });
    const lat = place.location?.lat?.(); const lng = place.location?.lng?.();
    return Number.isFinite(lat) ? { lat, lng, address: place.formattedAddress || s.description } : null;
}

/** Mapa con pin al centro (se arrastra el mapa). onMove({lat,lng}) al soltar. */
function merchantCreatePinMap(el, center, onMove) {
    if (typeof google === 'undefined' || !google.maps?.Map) { el.innerHTML = '<div style="padding:16px;color:#6b7280">El mapa no cargó. Revisa tu conexión.</div>'; return null; }
    const map = new google.maps.Map(el, {
        center, zoom: 17, gestureHandling: 'greedy', disableDefaultUI: true, clickableIcons: false,
        restriction: { latLngBounds: { north: 16.6, south: 12.9, west: -89.4, east: -83.1 }, strictBounds: false },
    });
    const idle = map.addListener('idle', () => { const c = map.getCenter(); if (c) onMove({ lat: c.lat(), lng: c.lng() }); });
    const click = map.addListener('click', (e) => { if (e.latLng) map.panTo(e.latLng); });
    return { setCenter: (p) => map.panTo(p), destroy: () => { idle.remove(); click.remove(); } };
}
async function merchantReverseGeocode(lat, lng) {
    if (typeof google === 'undefined' || !google.maps) return '';
    const Geocoder = google.maps.Geocoder || (await google.maps.importLibrary('geocoding')).Geocoder;
    const res = await new Geocoder().geocode({ location: { lat, lng }, language: 'es', region: 'hn' });
    return res?.results?.[0]?.formatted_address || '';
}
function merchantGps() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('sin gps'));
        navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), reject, { enableHighAccuracy: true, timeout: 12000 });
    });
}

function merchantDeliveryCtx() {
    const user = getCurrentUser();
    const zone = getZoneById(myStore?.cityId) || getZoneById(getDefaultZoneId()) || null;
    return {
        store: myStore,
        uid: user?.uid,
        zone,
        fareFn: calculateServiceFare,
        carFactor: CAR_DELIVERY_FACTOR,
        carMinFee: CAR_MIN_DELIVERY_FEE,
        quoteFee: (q) => quoteStoreDeliveryFeeFor(q),
        createMap: merchantCreatePinMap,
        reverseGeocode: merchantReverseGeocode,
        getGps: merchantGps,
        saveStoreLocation: async ({ lat, lng, address }) => {
            const patch = { lat, lng, locationApprox: false, updatedAt: serverTimestamp() };
            if (address) patch.address = String(address).slice(0, 200);
            await updateDoc(publicDoc('stores', myStore.id), patch);
            Object.assign(myStore, { lat, lng, locationApprox: false }, address ? { address: patch.address } : {});
        },
        getCommission: (svc) => (typeof window.getPlatformCommission === 'function' ? window.getPlatformCommission(svc) : null),
        availability: (svc, zoneId) => window.__hrServiceAvailability?.(svc, zoneId) || null,
        placesFetch: merchantPlacesFetch,
        placeDetails: merchantPlaceDetails,
        serverTs: () => serverTimestamp(),
        waitChip: (t) => tripWaitChipHtml(t),
        createTrip: async (payload) => (await addDoc(publicCol('trips'), payload)).id,
        cancelTrip: (id, patch) => updateDoc(publicDoc('trips', id), patch),
        openChat: (tripId) => openOrderDriverChatModal({
            tripId,
            role: 'merchant',
            storeName: myStore?.name || 'Mi negocio',
        }),
        subscribe: (cb) => onSnapshot(
            query(publicCol('trips'), where('clientId', '==', user?.uid || '-'), limit(150)),
            (snap) => {
                const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                    .filter((t) => {
                        if (t.merchantDirectDelivery === true) {
                            return !t.storeId || !myStore?.id || t.storeId === myStore.id;
                        }
                        if (t.serviceType === 'delivery' && !t.storeOrderId) {
                            return !t.storeId || !myStore?.id || t.storeId === myStore.id;
                        }
                        return false;
                    })
                    .sort((a, b) => (waitTsMs(b.createdAt) || b.storeOrderCreatedAtMs || 0) - (waitTsMs(a.createdAt) || a.storeOrderCreatedAtMs || 0))
                    .slice(0, 20);
                cb(list);
            },
            (e) => console.warn('[stores] mis envíos', e?.message || e),
        ),
        toast,
        confirm: (m) => window.confirm(m),
    };
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
    const ride = orderRide(order);
    // Con zona de envío, el viaje cobra la tarifa fija que el servidor puso en el pedido (el carro ya trae +25%).
    let { priceNum, fromZone } = deliveryTripPrice(order, calculateServiceFare('delivery', km, null, 1));
    if (!fromZone && ride === 'auto') priceNum = computeCarDeliveryFee(priceNum);
    else if (fromZone && ride === 'auto') priceNum = Math.max(CAR_MIN_DELIVERY_FEE, priceNum);
    const priceText = `${formatLempiras(priceNum)}`;
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
        // Marca marketplace: solo el vehículo que eligió el cliente (pedidos viejos: moto o Taxi VIP)
        storeDelivery: true,
        storeOrderId: order.id,
        storeId: order.storeId,
        merchantId: order.ownerId,
        deliveryVehicle: ride === 'both' ? null : ride,
        allowedDriverVehicles: ride === 'auto' ? ['auto'] : (ride === 'moto' ? ['moto'] : ['moto', 'auto']),
        deliveryDetails: {
            category: myStore?.category || 'comida',
            restaurant: order.storeName || myStore?.name || 'Tienda',
            recipientName: order.recipientName || order.clientName || '',
            recipientPhone: order.recipientPhone || order.clientPhone || '',
            packageDescription,
            storeOrderId: order.id,
            itemsTotal: order.itemsTotal || 0,
            storeDelivery: true,
            // Lo que el conductor ve al aceptar (productos, total y si ya se pagaron)
            items: (order.items || []).slice(0, 40).map((i) => ({
                name: String(i.name || '').slice(0, 80),
                qty: Number(i.qty) || 1,
                price: Number(i.price) || 0,
            })),
            productsPaymentMethod: order.paymentMethod === 'saldo' ? 'saldo' : 'efectivo',
            productsPaid: order.paymentMethod === 'saldo' && order.paymentStatus === 'paid',
            deliveryVehicle: ride === 'both' ? null : ride,
            storeName: order.storeName || myStore?.name || 'Tienda',
            storePhone: order.storePhone || myStore?.phone || '',
            deliveryNotes: String(order.notes || '').slice(0, 200),
            // «Pedido hace X min» al conductor: desde que el cliente pidió (no desde que la tienda pidió la moto)
            orderCreatedAtMs: waitTsMs(order.createdAt) || null,
        },
        deliveryZoneId: order.deliveryZoneId || null,
        deliveryZoneName: order.deliveryZoneName || null,
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
        negotiationEnabled: false,
        createdByMerchant: true,
        merchantName: profile.name || myStore?.name || '',
    };

    const tripRef = await addDoc(publicCol('trips'), tripPayload);
    // Sigue «Listo» hasta que un conductor acepte: el servidor lo pasa a «En camino» (store-order-sync.js).
    await updateDoc(publicDoc('store_orders', order.id), {
        status: 'ready',
        deliveryStage: 'searching_driver',
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

    const zoomBtn = e.target.closest('[data-stores-action="zoom-product-photo"]');
    if (zoomBtn) {
        e.preventDefault?.();
        e.stopPropagation?.();
        return openProductPhotoZoomModal({
            productId: zoomBtn.getAttribute('data-product-id') || '',
            photoUrl: zoomBtn.getAttribute('data-photo-url') || '',
            title: zoomBtn.getAttribute('data-photo-title') || '',
            desc: zoomBtn.getAttribute('data-photo-desc') || '',
            priceText: zoomBtn.getAttribute('data-photo-price') || '',
        });
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
    if (action === 'goto-pedir-envio') {
        merchantTab = 'pedir-envio';
        document.querySelectorAll('.merchant-tab').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-merchant-tab') === 'pedir-envio');
        });
        return renderMerchantBody();
    }
    if (action === 'save-store') return saveStore();
    if (action === 'use-gps') return useGpsForStore();
    if (action === 'toggle-open') return toggleStoreOpen();
    if (action === 'select-my-store') {
        const sid = t.getAttribute('data-store-id');
        return selectMyStore(sid);
    }
    if (action === 'clone-branch') {
        const sid = t.getAttribute('data-store-id') || myStore?.id;
        return startCloneBranch(sid);
    }
    if (action === 'start-create-new') {
        merchantCloneFromStore = null;
        return openMerchantPanel({ createNew: true });
    }
    if (action === 'goto-my-store') {
        pendingStorePhoto = null;
        pendingStorePhotoPreview = null;
        merchantCloneFromStore = null;
        return openMerchantPanel({ createNew: false });
    }
    if (action === 'test-order-alert') return testMerchantOrderAlert();
    if (action === 'enable-order-alerts') return enableMerchantOrderAlerts();
    if (action === 'sync-menu-branches') return syncMenuToAllBranches();
    if (action === 'pick-store-logo') return pickStoreLogo();
    if (action === 'share-catalog') return shareStoreCatalog();
    if (action === 'add-product') return addProduct();
    if (action === 'pick-product-photo') return pickNewProductPhoto();
    if (action === 'edit-product' && productId) return startEditProduct(productId);
    if (action === 'cancel-edit-product') return cancelEditProduct();
    if (action === 'pick-edit-form-photo' && productId) return pickPhotoForEditingProduct(productId);
    if (action === 'save-edit-product') return saveEditedProduct(productId);
    if (action === 'change-product-photo' && productId) return pickEditProductPhoto(productId);
    if (action === 'toggle-product' && productId) return toggleProduct(productId);
    if (action === 'delete-product' && productId) return deleteProduct(productId);
    if (action === 'save-stock' && productId) return saveProductStock(productId);
    if (action === 'week-pick') {
        merchantWeekWhich = t.getAttribute('data-week') === 'previous' ? 'previous' : 'current';
        const body = document.getElementById('merchant-panel-body');
        if (body) renderMerchantWeekTab(body);
        return;
    }
    if (action === 'delete-my-store') {
        const sid = t.getAttribute('data-store-id') || myStore?.id;
        return deleteMyStore(sid);
    }

    if (action === 'accept-order' && orderId) {
        await setOrderStatus(orderId, 'accepted', { acceptedAt: serverTimestamp() });
        return toast('Pedido aceptado · marca «Preparando el pedido» al iniciar en cocina', 'success');
    }
    if (action === 'accept-and-prepare-order' && orderId) {
        await setOrderStatus(orderId, 'preparing', { acceptedAt: serverTimestamp(), preparingAt: serverTimestamp() });
        return toast('👨‍🍳 Marcado: Preparando el pedido (se notificó al cliente)', 'success');
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
        await setOrderStatus(orderId, 'preparing', { preparingAt: serverTimestamp() });
        return toast('👨‍🍳 Marcado: Preparando el pedido (se notificó al cliente)', 'success');
    }
    if (action === 'ready-order' && orderId) {
        const order = merchantOrders.find((o) => o.id === orderId);
        if (!order) return;
        if (order.tripId) return toast('Ya se pidió un conductor para este pedido.', 'info');
        if (order.status !== 'preparing' && !(order.status === 'ready' && !order.tripId)) {
            return toast('Primero marca «Preparando el pedido» antes de llamar al delivery.', 'warning');
        }
        t.disabled = true;
        try {
            if (order.status !== 'ready') await setOrderStatus(orderId, 'ready', { readyAt: serverTimestamp() });
            const tripId = await createDeliveryTripForOrder(order);
            toast(`✅ Pedido preparado · llamando delivery (${orderRideName(order)}) · ` + tripId.slice(0, 6) + '…', 'success');
        } catch (err) {
            console.error(err);
            toast(err.message || 'No se pudo pedir el delivery', 'error');
        } finally {
            t.disabled = false;
        }
        return;
    }
    if (action === 'share-order-trip-wa') {
        const order = merchantOrders.find((o) => o.id === orderId) || {};
        const tripId = t.getAttribute('data-trip-id') || order?.tripId || '';
        if (!tripId) return toast('Este pedido aún no tiene viaje asignado.', 'warning');
        let tripDoc = null;
        try {
            const snap = await getDoc(publicDoc('trips', tripId));
            if (snap.exists()) tripDoc = { id: snap.id, ...snap.data() };
        } catch (_) {}
        const baseOrigin = (typeof location !== 'undefined' && location.origin && location.origin.startsWith('http') && !location.origin.includes('127.0.0.1') && !location.origin.includes('localhost'))
            ? location.origin
            : 'https://honduraite.com';
        const waUrl = buildMerchantShareTripWhatsAppUrl({
            trip: tripDoc || { id: tripId, destination: order.deliveryAddress, driverName: order.driverName },
            order,
            storeName: order.storeName || myStore?.name || 'Mi negocio',
            baseOrigin,
        });
        try { window.open(waUrl, '_blank', 'noopener,noreferrer'); } catch (_) {}
        return toast('📲 Abriendo WhatsApp con el link de seguimiento para el cliente…', 'success');
    }
    if (action === 'share-order-trip-native') {
        const order = merchantOrders.find((o) => o.id === orderId) || {};
        const tripId = t.getAttribute('data-trip-id') || order?.tripId || '';
        if (!tripId) return toast('Este pedido aún no tiene viaje asignado.', 'warning');
        const baseOrigin = (typeof location !== 'undefined' && location.origin && location.origin.startsWith('http') && !location.origin.includes('127.0.0.1') && !location.origin.includes('localhost'))
            ? location.origin
            : 'https://honduraite.com';
        const trackUrl = buildDeliveryTrackingUrl(tripId, baseOrigin);
        const msgText = buildMerchantShareTripMessage({
            trip: { id: tripId, destination: order.deliveryAddress, driverName: order.driverName, priceNum: order.deliveryFee },
            order,
            storeName: order.storeName || myStore?.name || 'Mi negocio',
            trackingUrl: trackUrl,
            baseOrigin,
        });
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                await navigator.share({ title: 'Seguimiento de tu pedido', text: msgText, url: trackUrl });
                return;
            }
        } catch (_) {}
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(msgText);
        } catch (_) {}
        return toast('🔗 Mensaje y link de seguimiento listos para compartir', 'success');
    }
    if (action === 'copy-order-trip-link') {
        const order = merchantOrders.find((o) => o.id === orderId) || {};
        const tripId = t.getAttribute('data-trip-id') || order?.tripId || '';
        if (!tripId) return toast('Este pedido aún no tiene viaje asignado.', 'warning');
        const baseOrigin = (typeof location !== 'undefined' && location.origin && location.origin.startsWith('http') && !location.origin.includes('127.0.0.1') && !location.origin.includes('localhost'))
            ? location.origin
            : 'https://honduraite.com';
        const trackUrl = buildDeliveryTrackingUrl(tripId, baseOrigin);
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(trackUrl);
        } catch (_) {}
        return toast('📋 Link de seguimiento copiado: ' + trackUrl, 'success');
    }
    if (action === 'chat-driver') {
        const order = merchantOrders.find((o) => o.id === orderId);
        const tripId = t.getAttribute('data-trip-id') || order?.tripId || '';
        return openOrderDriverChatModal({
            tripId,
            role: 'merchant',
            storeName: order?.storeName || myStore?.name || 'Mi negocio',
            orderId
        });
    }
    if (action === 'delivered-order' && orderId) {
        if (!window.confirm('El pedido se marca entregado solo cuando el conductor termina el viaje. ¿Marcarlo entregado ahora?')) return;
        await setOrderStatus(orderId, 'delivered', { deliveredAt: serverTimestamp(), deliveredBy: 'merchant' });
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

        // Filtro por ciudad (las ciudades que tienen tiendas)
        const cityMap = new Map();
        staffStoresList.forEach((s) => {
            const id = s.cityId || '';
            if (!cityMap.has(id)) {
                cityMap.set(id, id ? (s.cityName || getZoneById(id)?.name || id) : 'Sin ciudad');
            }
        });
        const cityOptions = [...cityMap.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'es'));
        if (staffStoresCityFilter !== 'all' && !cityMap.has(staffStoresCityFilter)) staffStoresCityFilter = 'all';
        const inCity = staffStoresCityFilter === 'all'
            ? staffStoresList
            : staffStoresList.filter((s) => (s.cityId || '') === staffStoresCityFilter);

        const pending = inCity.filter((s) => storeApprovalStatus(s) === 'pending');
        const approved = inCity.filter((s) => storeApprovalStatus(s) === 'approved');
        const rejected = inCity.filter((s) => storeApprovalStatus(s) === 'rejected');
        const adults = inCity.filter((s) => isStoreAdultsOnly(s));
        const cityIssues = inCity.filter((s) => storeCityIssue(s));

        let filtered = inCity;
        if (staffStoresFilter === 'pending') filtered = pending;
        else if (staffStoresFilter === 'approved') filtered = approved;
        else if (staffStoresFilter === 'rejected') filtered = rejected;
        else if (staffStoresFilter === 'adults') filtered = adults;

        const chips = [
            { id: 'all', label: `Todas (${inCity.length})` },
            { id: 'approved', label: `Aprobadas (${approved.length})` },
            { id: 'pending', label: `En revisión (${pending.length})` },
            { id: 'rejected', label: `Rechazadas (${rejected.length})` },
            { id: 'adults', label: `+18 (${adults.length})` },
        ];
        // Resumen: tocar un número filtra la lista
        const kpis = `
            <div class="hr-staff-kpis">
                ${[
                    ['approved', approved.length, 'Aprobadas'],
                    ['pending', pending.length, 'En revisión'],
                    ['rejected', rejected.length, 'Rechazadas'],
                    ['adults', adults.length, '+18'],
                ].map(([id, n, label]) => `
                    <button type="button" class="hr-staff-kpi hr-staff-kpi--${id} ${staffStoresFilter === id ? 'is-active' : ''}"
                        data-staff-stores-filter="${id}">
                        <b>${n}</b><span>${label}</span>
                    </button>`).join('')}
            </div>`;

        const cards = filtered.length
            ? filtered.map((s) => staffStoreCardHtml(s)).join('')
            : (U?.empty
                ? U.empty('fa-store', 'Sin tiendas aquí', 'Cambia el filtro o espera nuevas solicitudes.')
                : `<p class="text-center text-slate-400 py-8">Sin tiendas en este filtro.</p>`);

        const body = `
            <div id="staff-stores-review" class="space-y-4">
                ${U?.hero
                    ? U.hero('Verificar tiendas', 'Panel de supervisor · aprobar / rechazar · marcar +18 · corregir ciudad', '')
                    : '<h2 class="text-xl font-black text-white mb-2">Verificar tiendas</h2>'}
                ${kpis}
                <div class="hr-staff-filters">
                    <label class="hr-staff-city">
                        <i class="fas fa-map-marker-alt"></i>
                        <select id="staff-stores-city-filter" aria-label="Filtrar por ciudad">
                            <option value="all" ${staffStoresCityFilter === 'all' ? 'selected' : ''}>Todas las ciudades</option>
                            ${cityOptions.map(([id, name]) => `<option value="${esc(id)}" ${staffStoresCityFilter === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}
                        </select>
                    </label>
                </div>
                ${cityIssues.length ? `
                    <p class="hr-staff-issue-summary">
                        <i class="fas fa-exclamation-triangle"></i>
                        ${cityIssues.length === 1 ? '1 tienda tiene' : `${cityIssues.length} tiendas tienen`} una ciudad que no cuadra con su ubicación. Usa <b>Corregir ciudad</b>.
                    </p>` : ''}
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
                    <b>Corregir ciudad</b> = cambia en qué ciudad sale la tienda.
                </p>
                <div class="space-y-3">${cards}</div>
            </div>
        `;
        container.innerHTML = U?.page ? U.page(body) : body;

        container.querySelector('#staff-stores-city-filter')?.addEventListener('change', (ev) => {
            staffStoresCityFilter = ev.target.value || 'all';
            loadSupervisorStores({ keepFilter: true });
        });
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
                    else if (action === 'fix-city') await staffFixStoreCity(id);
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

/**
 * ¿La ciudad publicada no cuadra con la ubicación real? (el error "San Jose").
 * @returns {{ published: string, real: object|null } | null}
 */
function storeCityIssue(s) {
    const savedZone = s?.cityId ? getZoneById(s.cityId) : null;
    const published = s?.cityName || savedZone?.name || s?.cityId || '';
    const real = cityFromStoreCoords(s?.lat, s?.lng);
    if (!s?.cityId) return { published: 'sin ciudad', real };
    if (real) {
        const check = resolveStoreCity({ selectedId: s.cityId, lat: s.lat, lng: s.lng });
        return check.ok ? null : { published, real };
    }
    // Sin ubicación real y publicada en EE. UU.: casi seguro es el error de la ciudad del teléfono
    if (savedZone && isUsZone(savedZone)) return { published, real: null };
    return null;
}

function staffStoreCardHtml(s) {
    const appr = storeApprovalStatus(s);
    const meta = STORE_APPROVAL[appr] || STORE_APPROVAL.pending;
    const adults = isStoreAdultsOnly(s);
    const open = storeOpenInfo(s).open;
    const issue = storeCityIssue(s);
    return `
        <article class="ops-card hr-staff-store rounded-2xl border border-slate-700/80 bg-slate-900/50 p-4 space-y-3" data-store-id="${esc(s.id)}">
            <div class="flex gap-3 items-start">
                ${storeAvatarHtml(s)}
                <div class="min-w-0 flex-1">
                    <h3 class="font-black text-white text-sm">${esc(s.name || 'Sin nombre')}</h3>
                    <p class="text-[11px] text-slate-400 font-semibold mt-0.5">
                        ${esc(catLabel(s.category))}${s.cityName ? ` · ${esc(s.cityName)}` : ''}
                    </p>
                    <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span class="ops-badge ops-badge--${meta.tone === 'emerald' ? 'emerald' : meta.tone === 'red' ? 'red' : 'amber'}">${esc(meta.label)}</span>
                        ${adults ? `<span class="ops-badge ops-badge--purple">+18</span>` : ''}
                        <span class="text-[10px] font-bold ${open ? 'text-emerald-400' : 'text-slate-500'}">● ${open ? 'Abierta' : 'Cerrada'}</span>
                    </div>
                    ${s.address ? `<p class="text-[11px] text-slate-500 mt-1"><i class="fas fa-map-marker-alt"></i> ${esc(s.address)}</p>` : ''}
                    ${s.phone ? `<p class="text-[11px] text-slate-500"><i class="fab fa-whatsapp"></i> ${esc(s.phone)}</p>` : ''}
                    ${s.description ? `<p class="text-[11px] text-slate-400 mt-1 line-clamp-2">${esc(s.description)}</p>` : ''}
                    ${s.ownerName || s.ownerId ? `<p class="text-[10px] text-slate-500 mt-1">Dueño: ${esc(s.ownerName || String(s.ownerId).slice(0, 12) + '…')}</p>` : ''}
                    ${appr === 'rejected' && s.rejectionReason ? `<p class="text-[10px] text-red-400 font-semibold mt-1">Motivo: ${esc(s.rejectionReason)}</p>` : ''}
                </div>
            </div>
            ${issue ? `
                <p class="hr-staff-city-warn">
                    <i class="fas fa-exclamation-triangle"></i>
                    Publicada en: <b>${esc(issue.published)}</b>
                    ${issue.real ? ` · Ciudad real: <b>${esc(issue.real.name)}</b>` : ' · sin ubicación real, revisa con el dueño'}
                </p>` : ''}
            <div class="hr-staff-actions">
                ${appr !== 'approved' ? `
                    <button type="button" class="hr-staff-act hr-staff-act--ok" data-staff-store-action="approve" data-store-id="${esc(s.id)}">
                        <i class="fas fa-thumbs-up"></i> Nos parece bien
                    </button>` : ''}
                ${appr !== 'rejected' ? `
                    <button type="button" class="hr-staff-act hr-staff-act--bad" data-staff-store-action="reject" data-store-id="${esc(s.id)}">
                        <i class="fas fa-thumbs-down"></i> Nos parece mal
                    </button>` : ''}
                <button type="button" class="hr-staff-act hr-staff-act--adult" data-staff-store-action="toggle18" data-store-id="${esc(s.id)}">
                    <i class="fas fa-user-shield"></i> ${adults ? 'Quitar +18' : 'Marcar +18'}
                </button>
                <button type="button" class="hr-staff-act hr-staff-act--view" data-staff-store-action="open" data-store-id="${esc(s.id)}">
                    <i class="fas fa-external-link-alt"></i> Ver en app
                </button>
                <button type="button" class="hr-staff-act hr-staff-act--del" data-staff-store-action="delete" data-store-id="${esc(s.id)}">
                    <i class="fas fa-trash"></i> Borrar
                </button>
                <button type="button" class="hr-staff-act hr-staff-act--city ${issue ? 'is-flagged' : ''}" data-staff-store-action="fix-city" data-store-id="${esc(s.id)}">
                    <i class="fas fa-map-marker-alt"></i> Corregir ciudad
                </button>
            </div>
        </article>
    `;
}

/** Ventana para elegir ciudad. Devuelve el id elegido o null si cancela. */
function pickCityModal({ title = 'Elegir ciudad', note = '', selectedId = '' } = {}) {
    return new Promise((resolve) => {
        document.getElementById('hr-city-pick')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'hr-city-pick';
        wrap.className = 'hr-sheet hr-sheet--center';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.innerHTML = `
            <div class="hr-sheet-backdrop" data-pick-action="cancel"></div>
            <div class="hr-sheet-panel">
                <span class="hr-sheet-icon"><i class="fas fa-map-marker-alt"></i></span>
                <h3 class="hr-sheet-title">${esc(title)}</h3>
                ${note ? `<p class="hr-sheet-text">${note}</p>` : ''}
                <select id="hr-city-pick-select" class="hr-age-select hr-city-pick-select">${buildStoreCityOptionsHtml(selectedId)}</select>
                <button type="button" class="hr-sheet-btn" data-pick-action="save">Guardar ciudad</button>
                <button type="button" class="hr-sheet-btn hr-sheet-btn--ghost" data-pick-action="cancel">Cancelar</button>
            </div>`;
        document.body.appendChild(wrap);
        const done = (v) => { wrap.remove(); resolve(v); };
        wrap.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-pick-action]');
            if (!b) return;
            if (b.getAttribute('data-pick-action') === 'cancel') return done(null);
            const v = wrap.querySelector('#hr-city-pick-select')?.value || '';
            if (!v) return toast('Elige una ciudad', 'warning');
            done(v);
        });
    });
}

/** Staff: cambiar la ciudad donde se publica una tienda (queda registrado quién y cuándo). */
async function staffFixStoreCity(storeId) {
    if (!isStoresStaff()) return toast('Solo supervisores o admin', 'error');
    let store = staffStoresList.find((x) => x.id === storeId) || storesCache.get(storeId) || null;
    if (!store) {
        try {
            const snap = await getDoc(publicDoc('stores', storeId));
            if (snap.exists()) store = { id: snap.id, ...snap.data() };
        } catch (_) {}
    }
    if (!store) return toast('Tienda no encontrada', 'error');
    const issue = storeCityIssue(store);
    const suggested = issue?.real?.id || initialStoreCityId(store) || store.cityId || '';
    const chosenId = await pickCityModal({
        title: `Corregir ciudad · ${store.name || 'Tienda'}`,
        note: `Ahora sale en <b>${esc(store.cityName || store.cityId || 'sin ciudad')}</b>.${issue?.real ? ` Por su ubicación parece <b>${esc(issue.real.name)}</b>.` : ''}`,
        selectedId: suggested,
    });
    if (!chosenId) return;
    const zone = getZoneById(chosenId);
    if (!zone) return toast('Ciudad no válida', 'error');
    if (zone.id === store.cityId) return toast('La tienda ya está en esa ciudad', 'info');
    const check = resolveStoreCity({ selectedId: zone.id, lat: store.lat, lng: store.lng });
    if (!check.ok && !confirm(`${check.message}\n\n¿Guardar ${zone.name} de todos modos?`)) return;

    const user = getCurrentUser();
    const profile = getUserProfile() || {};
    const hasRealCoords = validCoords(store.lat, store.lng) && !isZoneCenterCoords(store.lat, store.lng);
    const patch = {
        cityId: zone.id,
        cityName: zone.name,
        cityDepartment: zone.department || null,
        citySource: 'staff',
        cityFixedBy: user?.uid || null,
        cityFixedByName: profile.name || profile.email || 'Staff',
        cityFixedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };
    // Sin ubicación real: mover el punto aproximado al centro de la nueva ciudad (igual que al guardar la tienda)
    if (!hasRealCoords && zone.center) {
        patch.lat = zone.center.lat;
        patch.lng = zone.center.lng;
        patch.locationApprox = true;
    }
    try {
        await updateDoc(publicDoc('stores', storeId), patch);
        const local = { cityId: patch.cityId, cityName: patch.cityName, cityDepartment: patch.cityDepartment, citySource: 'staff' };
        if (patch.lat != null) Object.assign(local, { lat: patch.lat, lng: patch.lng, locationApprox: true });
        [storesCache.get(storeId), viewingStore?.id === storeId ? viewingStore : null, myStore?.id === storeId ? myStore : null]
            .forEach((o) => { if (o) Object.assign(o, local); });
        toast(`Ciudad corregida: ${zone.name}`, 'success');
        if (document.getElementById('staff-stores-review')) {
            try { await loadSupervisorStores({ keepFilter: true }); } catch (_) {}
        }
    } catch (e) {
        console.error('[stores] staffFixStoreCity', e);
        toast('No se pudo corregir la ciudad', 'error');
    }
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

/* ===================== REPARTIDORES: RESTAURANTES EN FUEGO EN EL MAPA ===================== */
let driverHotMapMarkers = [];
let driverHotMapCircles = [];

export function getHotStoresForDriverMap(stores = [...storesCache.values()], orders = merchantOrders) {
    const now = hnNowMinutes();
    const activeByStore = new Map();
    for (const o of (orders || [])) {
        if (!o?.storeId || ['delivered', 'cancelled'].includes(o.status)) continue;
        activeByStore.set(o.storeId, (activeByStore.get(o.storeId) || 0) + 1);
    }
    return (stores || [])
        .filter((s) => s && s.active !== false && storeApprovalStatus(s) === 'approved' && validCoords(s.lat, s.lng))
        .map((s) => {
            const activeCount = activeByStore.get(s.id) || Number(s.activeOrdersCount) || 0;
            const hot = storeHotInfo(s, activeCount);
            const openInfo = storeOpenInfo(s, now);
            return { store: s, hot, openInfo };
        })
        .filter((entry) => entry.hot.isHot && entry.openInfo.open)
        .sort((a, b) => b.hot.hotScore - a.hot.hotScore);
}

export function buildDriverHotStoresBarHtml(hotEntries = getHotStoresForDriverMap()) {
    if (!hotEntries.length) return '';
    return `
        <div id="driver-hot-stores-bar" class="driver-hot-stores-bar" role="region" aria-label="Restaurantes en fuego en el mapa">
            <div class="driver-hot-stores-bar__head">
                <span class="driver-hot-stores-bar__title">🔥 Restaurantes en fuego (alta demanda de envíos)</span>
                <span class="driver-hot-stores-bar__hint">Toca uno para verlo en el mapa</span>
            </div>
            <div class="driver-hot-stores-bar__chips">
                ${hotEntries.slice(0, 6).map(({ store: s, hot }) => {
                    const branch = formatStoreBranchLabel(s);
                    return `
                        <button type="button"
                                class="driver-hot-store-chip"
                                data-driver-hot-store-id="${esc(s.id)}"
                                data-lat="${esc(s.lat)}"
                                data-lng="${esc(s.lng)}">
                            <span class="driver-hot-store-chip__fire">🔥</span>
                            <span class="driver-hot-store-chip__body">
                                <strong>${esc(s.name || 'Restaurante')}${branch ? ` · ${esc(branch)}` : ''}</strong>
                                <small>${esc(hot.label)}${hot.ratingCount > 0 ? ` · ★ ${hot.ratingAvg.toFixed(1)}` : ''}</small>
                            </span>
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

export function focusDriverMapOnHotStore(storeId) {
    const s = storesCache.get(storeId);
    if (!s || !validCoords(s.lat, s.lng)) return false;
    const pos = { lat: Number(s.lat), lng: Number(s.lng) };
    try {
        if (typeof window !== 'undefined' && window.gMap) {
            window.gMap.panTo?.(pos);
            window.gMap.setZoom?.(16);
        }
    } catch (_) {}
    const branch = formatStoreBranchLabel(s);
    const hot = storeHotInfo(s);
    toast(`🔥 ${s.name || 'Restaurante'}${branch ? ` (${branch})` : ''} · ${hot.label}. ¡Acércate a esta zona para recibir pedidos!`, 'info');
    return true;
}

export function syncDriverHotStoresOnMap() {
    if (typeof document === 'undefined') return;
    const driverView = document.getElementById('driver-view');
    const hotEntries = getHotStoresForDriverMap();

    // Renderizar barra en el panel del conductor si existe
    if (driverView) {
        let slot = document.getElementById('driver-hot-stores-slot');
        if (!slot) {
            slot = document.createElement('div');
            slot.id = 'driver-hot-stores-slot';
            driverView.insertBefore(slot, driverView.firstElementChild);
            slot.addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-driver-hot-store-id]');
                if (!btn) return;
                focusDriverMapOnHotStore(btn.getAttribute('data-driver-hot-store-id'));
            });
        }
        slot.innerHTML = buildDriverHotStoresBarHtml(hotEntries);
    }

    // Actualizar pines y zonas de calor en Google Maps cuando esté disponible
    try {
        driverHotMapMarkers.forEach((m) => { try { m.setMap(null); } catch (_) {} });
        driverHotMapCircles.forEach((c) => { try { c.setMap(null); } catch (_) {} });
        driverHotMapMarkers = [];
        driverHotMapCircles = [];
        const gMap = typeof window !== 'undefined' ? window.gMap : null;
        if (!gMap || typeof google === 'undefined' || !google.maps) return;
        hotEntries.slice(0, 12).forEach(({ store: s, hot }) => {
            const center = { lat: Number(s.lat), lng: Number(s.lng) };
            if (google.maps.Circle) {
                const circle = new google.maps.Circle({
                    map: gMap,
                    center,
                    radius: 220,
                    fillColor: '#f97316',
                    fillOpacity: 0.2,
                    strokeColor: '#ea580c',
                    strokeOpacity: 0.75,
                    strokeWeight: 2,
                    clickable: false,
                });
                driverHotMapCircles.push(circle);
            }
            if (google.maps.Marker) {
                const branch = formatStoreBranchLabel(s);
                const marker = new google.maps.Marker({
                    map: gMap,
                    position: center,
                    title: `🔥 ${s.name || 'Restaurante'}${branch ? ` (${branch})` : ''} · ${hot.label}`,
                    label: {
                        text: '🔥',
                        fontSize: '16px',
                    },
                });
                marker.addListener?.('click', () => focusDriverMapOnHotStore(s.id));
                driverHotMapMarkers.push(marker);
            }
        });
    } catch (_) {}
}


export function syncMerchantQuickAccessUi() {
    if (typeof document === 'undefined') return;
    const hub = document.getElementById('passenger-home-hub');
    const existingCard = document.getElementById('merchant-home-quick-card');
    if (!myStore) {
        existingCard?.remove();
        return;
    }
    const pendingCount = merchantOrders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length;
    const branch = formatStoreBranchLabel(myStore);
    const storeTitle = branch ? `${myStore.name || 'Mi negocio'} · ${branch}` : (myStore.name || 'Mi negocio');
    const html = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div style="min-width:0">
                <span style="display:inline-block;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#0c4a8e;background:#dbeafe;padding:2px 8px;border-radius:999px">🏪 Panel rápido de tu negocio</span>
                <div style="font-size:14px;font-weight:900;color:#0f172a;margin-top:3px">${esc(storeTitle)}</div>
                <div style="font-size:11px;font-weight:600;color:#475569">Pide un delivery desde aquí o administra tus pedidos sin bloquear tu pantalla</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;width:100%;margin-top:4px">
                <button type="button" data-merchant-quick="pedir-envio" style="flex:1;min-width:140px;border:0;border-radius:12px;padding:10px 12px;background:linear-gradient(135deg,#0c4a8e,#1a6bb5);color:#fff;font-weight:900;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 12px rgba(12,74,142,.22)">
                    <i class="fas fa-motorcycle"></i> 🛵 Pedir envío ahora
                </button>
                <button type="button" data-merchant-quick="orders" style="flex:1;min-width:130px;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;background:#fff;color:#0f172a;font-weight:800;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px">
                    <i class="fas fa-receipt" style="color:#0c4a8e"></i> Ver pedidos${pendingCount > 0 ? ` <span style="background:#ef4444;color:#fff;border-radius:999px;padding:1px 6px;font-size:10px">${pendingCount}</span>` : ''}
                </button>
            </div>
        </div>
    `;
    if (hub) {
        let card = existingCard;
        if (!card) {
            card = document.createElement('div');
            card.id = 'merchant-home-quick-card';
            card.style.cssText = 'background:linear-gradient(135deg,#f8fafc,#eff6ff);border:1.5px solid #93c5fd;border-radius:16px;padding:11px 12px;margin:0 0 10px 0;box-shadow:0 4px 14px rgba(12,74,142,.08)';
            card.addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-merchant-quick]');
                if (!btn) return;
                ev.preventDefault();
                ev.stopPropagation();
                const act = btn.getAttribute('data-merchant-quick');
                if (act === 'pedir-envio') {
                    window.releaseMerchantDeliveryTripsFromPassengerUi?.();
                    openMerchantPanel({ createNew: false, tab: 'pedir-envio' });
                } else if (act === 'orders') {
                    window.releaseMerchantDeliveryTripsFromPassengerUi?.();
                    openMerchantPanel({ createNew: false, tab: 'orders' });
                }
            });
            hub.insertBefore(card, hub.firstChild);
        }
        card.innerHTML = html;
    }
}

export function initMerchantStores(deps = {}) {
    dbRef = deps.db;
    appIdRef = deps.appId;
    storageRef = deps.storage || null;
    getCurrentUser = deps.getCurrentUser || (() => null);
    getUserProfile = deps.getUserProfile || (() => null);
    configureStoreZones({ db: dbRef, appId: appIdRef, functions: deps.functions || null, getCurrentUser, toast });

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
    /** Menú por rol: resumen de tienda(s) y sucursales del emprendedor. */
    window.getMyStoreSummary = () => (myStore ? {
        id: myStore.id,
        name: myStore.name || '',
        branchName: myStore.branchName || '',
        approvalStatus: myStore.approvalStatus || '',
        count: Math.max(1, myStores.length),
    } : null);
    window.syncDriverHotStoresOnMap = syncDriverHotStoresOnMap;
    window.focusDriverMapOnHotStore = focusDriverMapOnHotStore;
    window.openCreateStorePanel = openCreateStorePanel;
    window.openMyStorePanel = openMyStorePanel;
    window.openStoreTripChatModal = openOrderDriverChatModal;
    window.syncMerchantQuickAccessUi = syncMerchantQuickAccessUi;
    // Si passenger-home quedó en modo 'stores' esperando a que cargara este módulo diferido, abrirlo ya
    try {
        if (document.body?.dataset?.passengerMode === 'stores') {
            const mp = document.getElementById('stores-marketplace-panel');
            const mer = document.getElementById('merchant-panel');
            if (mp?.classList.contains('hidden') && mer?.classList.contains('hidden')) {
                setTimeout(() => openMarketplace(), 50);
            }
        }
    } catch (_) {}
    window.closeMerchantPanel = closeMerchantPanel;
    window.shareStoreCatalog = shareStoreCatalog;
    window.inviteBusinessViaWhatsApp = showStaffInviteBusinessModal;
    window.handleCreateBusinessInvite = handleCreateBusinessInvite;
    window.buildCreateBusinessInviteLink = buildCreateBusinessInviteLink;
    window.loadSupervisorStores = loadSupervisorStores;
    window.staffSetStoreApproval = staffSetStoreApproval;
    window.staffToggleStoreAdultsOnly = staffToggleAdultsOnly;
    window.staffFixStoreCity = staffFixStoreCity;

    // When user logs in, warm listeners lightly (including client order status notifications)
    if (getCurrentUser()?.uid) {
        startStoresListener();
        startClientOrdersListener();
    }

    // Enlace compartido #tienda=id | #crear-empresa
    window.addEventListener('hashchange', () => tryOpenStoreFromHash());
    setTimeout(() => tryOpenStoreFromHash(), 800);
}

export function onMerchantAuthReady() {
    bindUiHooks();
    startStoresListener();
    if (getCurrentUser()?.uid) {
        startClientOrdersListener();
    }
    loadMyStore().then((store) => {
        updateMerchantOpenToggle();
        syncMerchantQuickAccessUi();
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

export const __testMerchant = {
    syncMerchantQuickAccessUi,
    merchantOrderActionsHtml,
    handleClientOrdersListUpdate,
    showClientOrderLiveBanner,
    markCheckoutFieldInvalid,
    clearCheckoutFieldErrors,
    orderCardHtml,
    productRatingInfo,
    computeStarProducts,
    storeHotInfo,
    buildHotStoresStripHtml,
    buildStoreStarProductsSectionHtml,
    buildOrderProductRatingModalHtml,
    submitOrderProductRatings,
    buildMerchantAlertsStatusBarHtml,
    testMerchantOrderAlert,
    buildMerchantStoreSwitcherHtml,
    buildMerchantStarProductsHtml,
    buildEditProductCardHtml,
    buildDriverHotStoresBarHtml,
    getHotStoresForDriverMap,
};
export { STORE_CATEGORIES, ORDER_STATUS, STORE_APPROVAL, calcSplitTariff, getTarifaDelMomento };
