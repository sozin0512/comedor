/**
 * Mapa de flota para admin/supervisor — conductores vía drivers_location.
 * Incluye:
 *  - Filtro en mapa: "🟢 Solo en línea" (por defecto, oculta inactivos) vs "👥 Todos (con inactivos)"
 *  - Conteo en vivo y filtro por categoría de vehículo (Moto, Auto, Taxi, VIP, Paila/Camión)
 *  - Listado flotante dividido por lo que manejan con botón directo de WhatsApp y centrar en mapa
 */
import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { isDriverOnline, getZoneById, findNearestZone } from './zones.js?v=2026.10.26.21';

const TRIP_TRACK_FRESH_MS = 900000; // 15 min — GPS reciente
const FLEET_STATUS_STORAGE_KEY = 'hr_ops_fleet_status_filter';

export const FLEET_VEHICLE_CATEGORIES = [
    {
        key: 'moto',
        label: 'Motos / Delivery',
        shortLabel: 'Moto',
        emoji: '🏍️',
        icon: 'fa-motorcycle',
        color: '#a78bfa',
        bg: 'rgba(139, 92, 246, 0.18)',
        border: 'rgba(139, 92, 246, 0.45)'
    },
    {
        key: 'auto',
        label: 'Autos / Económico',
        shortLabel: 'Auto',
        emoji: '🚗',
        icon: 'fa-car-side',
        color: '#60a5fa',
        bg: 'rgba(59, 130, 246, 0.18)',
        border: 'rgba(59, 130, 246, 0.45)'
    },
    {
        key: 'taxi',
        label: 'Taxis',
        shortLabel: 'Taxi',
        emoji: '🚕',
        icon: 'fa-taxi',
        color: '#facc15',
        bg: 'rgba(234, 179, 8, 0.18)',
        border: 'rgba(234, 179, 8, 0.45)'
    },
    {
        key: 'vip',
        label: 'VIP / Ejecutivo',
        shortLabel: 'VIP',
        emoji: '⭐',
        icon: 'fa-crown',
        color: '#fbbf24',
        bg: 'rgba(245, 158, 11, 0.18)',
        border: 'rgba(245, 158, 11, 0.45)'
    },
    {
        key: 'carga',
        label: 'Paila / Camión (Fletes)',
        shortLabel: 'Carga',
        emoji: '🛻',
        icon: 'fa-truck-pickup',
        color: '#34d399',
        bg: 'rgba(16, 185, 129, 0.18)',
        border: 'rgba(16, 185, 129, 0.45)'
    }
];

export function classifyFleetVehicleCategory(rawVehicleType, userObj = null) {
    let vt = String(
        rawVehicleType
        || userObj?.vehicleType
        || userObj?.vehicle?.type
        || (Array.isArray(userObj?.vehicles) && userObj.vehicles[0]?.type)
        || ''
    ).toLowerCase().trim();

    if (!vt && userObj) {
        const vs = Array.isArray(userObj.vehicles) ? userObj.vehicles : [];
        const fleteV = vs.find((v) => v?.type === 'paila' || v?.type === 'camion');
        if (fleteV) vt = fleteV.type;
    }

    if (vt === 'moto' || vt === 'mototaxi' || vt === 'delivery' || vt === 'bicimoto' || vt.includes('moto')) {
        return 'moto';
    }
    if (vt === 'paila' || vt === 'camion' || vt === 'flete' || vt === 'flete_paila' || vt === 'flete_camion' || vt === 'grua' || vt.includes('paila') || vt.includes('camion')) {
        return 'carga';
    }
    if (vt === 'vip' || vt === 'ejecutivo' || vt === 'hourly' || vt === 'taxi_vip') {
        return 'vip';
    }
    if (vt === 'taxi' || vt === 'taxi_tradicional' || vt.includes('taxi')) {
        return 'taxi';
    }
    return 'auto';
}

export function getFleetCategoryMeta(catKey) {
    return FLEET_VEHICLE_CATEGORIES.find((c) => c.key === catKey) || FLEET_VEHICLE_CATEGORIES[1];
}

export function resolveFleetDriverCity(data = {}, userObj = null) {
    let rawId = String(
        data?.serviceZoneId
        || userObj?.serviceZoneId
        || userObj?.cityId
        || userObj?.zoneId
        || ''
    ).trim();

    let rawName = String(
        data?.serviceZoneName
        || userObj?.serviceZoneName
        || userObj?.cityName
        || ''
    ).trim();

    if (rawId) {
        const z = getZoneById?.(rawId);
        if (z) {
            return { cityId: z.id, cityName: z.name };
        }
    }

    const lat = Number(data?.lat ?? userObj?.lastLat);
    const lng = Number(data?.lng ?? userObj?.lastLng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && typeof findNearestZone === 'function') {
        const nearest = findNearestZone(lat, lng);
        if (nearest?.zone && nearest.distanceKm <= 65) {
            return { cityId: nearest.zone.id, cityName: nearest.zone.name };
        }
    }

    if (rawName) {
        const slug = rawName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return { cityId: rawId || slug || 'otra', cityName: rawName };
    }

    if (rawId) {
        const map = {
            comayagua: 'Comayagua',
            tegucigalpa: 'Tegucigalpa',
            sps: 'San Pedro Sula',
            san_pedro_sula: 'San Pedro Sula',
            la_ceiba: 'La Ceiba',
            siguatepeque: 'Siguatepeque',
            la_paz: 'La Paz',
            choluteca: 'Choluteca',
            danli: 'Danlí',
            juticalpa: 'Juticalpa',
            roatan: 'Roatán',
            puerto_cortes: 'Puerto Cortés'
        };
        const label = map[rawId.toLowerCase()] || rawId;
        return { cityId: rawId.toLowerCase(), cityName: label };
    }

    return { cityId: 'comayagua', cityName: 'Comayagua' };
}

export function buildDriverWhatsAppHref(rawPhone, driverName = '') {
    if (!rawPhone) return '';
    if (typeof window !== 'undefined' && typeof window.getWhatsAppLink === 'function') {
        try {
            const link = window.getWhatsAppLink(rawPhone);
            if (link) return link;
        } catch (_) {}
    }
    let digits = String(rawPhone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 8) digits = '504' + digits;
    if (digits.length < 8) return '';
    const text = driverName
        ? `?text=${encodeURIComponent(`Hola ${driverName}, te escribimos de soporte HonduRaite.`)}`
        : '';
    return `https://wa.me/${digits}${text}`;
}

let unsub = null;
let tripsUnsub = null;
let fleetLiveTimer = null;
let renderTimer = null;
let lastSnap = null;
let didTriggerUsersLoad = false;
const markers = {};
const markerMeta = {};
const activeTripDrivers = new Map();
const latestDriverDocs = new Map();

function loadInitialStatusFilter() {
    try {
        const saved = localStorage.getItem(FLEET_STATUS_STORAGE_KEY);
        if (saved === 'all' || saved === 'online') return saved;
    } catch (_) {}
    return 'online'; // Por defecto solo en línea para no saturar el mapa con inactivos
}

const fleetFilterState = {
    statusMode: loadInitialStatusFilter(), // 'online' | 'all'
    category: 'all',                      // 'all' | 'moto' | 'auto' | 'taxi' | 'vip' | 'carga'
    cityId: 'all',                        // 'all' | 'comayagua' | 'tegucigalpa' | ...
    popoverOpen: false,
    searchQuery: ''
};

function viewerCanSeeFleet() {
    try {
        return typeof window.canViewOpsFleetMap === 'function' && window.canViewOpsFleetMap();
    } catch (_) {
        return false;
    }
}

function toLatLng(lat, lng) {
    const nlat = Number(lat);
    const nlng = Number(lng);
    if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return null;
    if (typeof google !== 'undefined' && google.maps?.LatLng) {
        return new google.maps.LatLng(nlat, nlng);
    }
    return { lat: nlat, lng: nlng };
}

function isFreshGps(data, maxMs = TRIP_TRACK_FRESH_MS) {
    const updated = data?.updatedAt || 0;
    return updated > 0 && Date.now() - updated <= maxMs;
}

function isOnActiveTrip(uid) {
    return activeTripDrivers.has(uid);
}

export function isFleetDriverOnlineOrInTrip(uid, data = null) {
    if (uid && isOnActiveTrip(uid)) return true;
    const loc = (data && typeof data === 'object' && Object.keys(data).length > 0)
        ? data
        : (uid ? (latestDriverDocs.get(uid) || lastSnap?.docs?.find?.((d) => d.id === uid)?.data?.() || null) : null);
    if (!loc) return false;
    if (isDriverOnline(loc)) return true;
    return false;
}

function resolveDriverProfile(uid, data = {}) {
    const user = (window.allUsersData || []).find((u) => u.uid === uid) || {};
    const approvalStatus = user.approvalStatus || data.approvalStatus;
    if (user.inRecycleBin === true || data.inRecycleBin === true) return null;
    if (approvalStatus && approvalStatus !== 'approved') return null;
    if (user.role && user.role !== 'driver') return null;

    const driverName = (user.name || data.name || '').toString().trim();
    if (!driverName || driverName.toLowerCase() === 'conductor' || /sin.?nombre/i.test(driverName)) {
        return null;
    }

    const phone = data.phone
        || user.phone
        || (typeof window.getUserDisplayPhone === 'function' ? window.getUserDisplayPhone(user) : null)
        || null;

    const vehicleType = data.vehicleType
        || user.vehicleType
        || user.vehicle?.type
        || (Array.isArray(user.vehicles) && user.vehicles[0]?.type)
        || 'auto';

    const plate = data.vehiclePlate
        || user.vehicle?.plate
        || (Array.isArray(user.vehicles) && user.vehicles[0]?.plate)
        || '';

    const model = user.vehicle?.model
        || (Array.isArray(user.vehicles) && user.vehicles[0]?.model)
        || '';

    const cityInfo = resolveFleetDriverCity(data, user);

    return {
        name: driverName,
        phone,
        vehicleType,
        category: classifyFleetVehicleCategory(vehicleType, user),
        plate,
        model,
        cityId: cityInfo.cityId,
        cityName: cityInfo.cityName,
        serviceZoneId: cityInfo.cityId
    };
}

function shouldShowFleetDriver(uid, data) {
    if (data?.lat == null || data?.lng == null) return false;

    const users = window.allUsersData || [];
    const usersLoaded = Array.isArray(users) && users.length > 0;
    const user = users.find((u) => u.uid === uid) || null;
    if (user) {
        if (user.role && user.role !== 'driver') return false;
        if (user.inRecycleBin === true) return false;
        if (user.approvalStatus && user.approvalStatus !== 'approved') return false;
        const driverName = (user.name || data.name || '').toString().trim();
        if (!driverName || driverName.toLowerCase() === 'conductor' || /sin.?nombre/i.test(driverName)) {
            return false;
        }
        return true;
    }

    if (usersLoaded) return false;

    if (data.inRecycleBin === true) return false;
    const name = (data.name || '').toString().trim();
    if (!name || name.toLowerCase() === 'conductor' || /sin.?nombre/i.test(name)) return false;
    if (data.approvalStatus && data.approvalStatus !== 'approved') return false;
    return true;
}

export function shouldRenderFleetMarkerOnMap(uid, data, filterOverride = null) {
    if (!shouldShowFleetDriver(uid, data)) return false;
    const state = filterOverride || fleetFilterState;
    if (state.statusMode === 'online' && !isFleetDriverOnlineOrInTrip(uid, data)) {
        return false;
    }
    const profile = resolveDriverProfile(uid, data);
    if (state.category && state.category !== 'all') {
        const cat = profile?.category || classifyFleetVehicleCategory(data?.vehicleType);
        if (cat !== state.category) return false;
    }
    if (state.cityId && state.cityId !== 'all') {
        const cId = profile?.cityId || resolveFleetDriverCity(data).cityId;
        if (cId !== state.cityId) return false;
    }
    return true;
}

/** Fases de viaje en mapa: verde → pasajero, morado → espera PIN, rojo → destino. */
function getFleetTripPhase(tripOrMeta) {
    if (!tripOrMeta) return null;
    const status = tripOrMeta.status;
    if (status === 'in_progress') return 'in_progress';
    if (status === 'accepted' && tripOrMeta.driverArrived) return 'at_pickup';
    if (status === 'accepted') return 'to_pickup';
    return tripOrMeta.phase || null;
}

function getFleetPhaseStyle(phase, tripOrMeta = null) {
    const isDeliv = !!(window.isDeliveryTrip?.(tripOrMeta) || tripOrMeta?.serviceType === 'delivery' || tripOrMeta?.storeDelivery || tripOrMeta?.storeOrderId);
    if (phase === 'in_progress') {
        return {
            phase: 'in_progress',
            color: '#dc2626',
            glow: '0 0 8px rgba(220, 38, 38, 0.9), 0 0 14px rgba(239, 68, 68, 0.45)',
            label: isDeliv ? 'En camino al cliente (entrega)' : 'Hacia destino final'
        };
    }
    if (phase === 'at_pickup') {
        return {
            phase: 'at_pickup',
            color: '#8b5cf6',
            glow: '0 0 8px rgba(139, 92, 246, 0.95), 0 0 14px rgba(167, 139, 250, 0.5)',
            label: isDeliv ? 'En el negocio · recogiendo pedido' : 'En origen · esperando PIN'
        };
    }
    return {
        phase: 'to_pickup',
        color: '#10b981',
        glow: '0 0 8px rgba(16, 185, 129, 0.95), 0 0 14px rgba(52, 211, 153, 0.5)',
        label: isDeliv ? 'En camino al negocio a recoger' : 'En camino por el pasajero'
    };
}

function makeFleetMarkerElement(vehicleType, heading, name, phone, options = {}) {
    const onTrip = Boolean(options.onTrip);
    const phase = options.phase || (onTrip ? 'to_pickup' : null);
    const phaseStyle = onTrip ? getFleetPhaseStyle(phase, options.tripMeta?.trip || options.tripMeta) : null;
    const isOnline = options.isOnline !== false;

    const wrap = document.createElement('div');
    wrap.className = 'hr-driver-map-marker hr-fleet-driver-marker';
    wrap.dataset.onTrip = onTrip ? '1' : '0';
    wrap.dataset.tripPhase = phase || '';
    wrap.dataset.online = isOnline ? '1' : '0';
    wrap.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer;';
    if (!isOnline && !onTrip) {
        wrap.style.opacity = '0.68';
    }

    const label = document.createElement('div');
    label.className = 'hr-fleet-driver-label';
    const bg = onTrip ? phaseStyle.color : (isOnline ? '#0f172a' : '#334155');
    const border = onTrip ? '#ffffff' : (isOnline ? '#10b981' : '#64748b');
    const shadow = onTrip ? phaseStyle.glow : '0 1px 4px rgba(0,0,0,0.45)';
    label.style.cssText = [
        `background:${bg}`,
        'color:#fff',
        'font-weight:800',
        'font-size:8px',
        'line-height:1.1',
        'padding:1px 5px',
        'border-radius:999px',
        `border:1px solid ${border}`,
        'white-space:nowrap',
        'max-width:96px',
        'overflow:hidden',
        'text-overflow:ellipsis',
        `box-shadow:${shadow}`,
        'margin-bottom:1px'
    ].join(';');
    const statusDot = onTrip ? '🚗 ' : (isOnline ? '🟢 ' : '⚪ ');
    label.textContent = statusDot + (name || 'Conductor');

    const icon = document.createElement('div');
    icon.className = 'hr-fleet-driver-icon';
    const deg = Number.isFinite(Number(heading)) ? Number(heading) : 0;
    icon.style.cssText = `width:26px;height:26px;display:flex;align-items:center;justify-content:center;transform:rotate(${deg}deg);transition:transform 0.25s linear;`;

    const cat = classifyFleetVehicleCategory(vehicleType);
    const isMoto = cat === 'moto';
    const isTaxi = cat === 'taxi';
    const isVip = cat === 'vip';
    const isCarga = cat === 'carga';

    if (onTrip && phaseStyle) {
        const fill = phaseStyle.color;
        if (isMoto) {
            icon.innerHTML = `<svg viewBox="0 0 64 64" width="22" height="22">
                <circle cx="32" cy="32" r="24" fill="${fill}" stroke="#ffffff" stroke-width="4"/>
                <circle cx="32" cy="24" r="6" fill="#fde68a"/>
                <rect x="27" y="30" width="10" height="14" rx="4" fill="#ffffff"/>
            </svg>`;
        } else {
            icon.innerHTML = `<svg viewBox="0 0 64 64" width="24" height="24">
                <rect x="14" y="8" width="36" height="48" rx="12" fill="${fill}" stroke="#ffffff" stroke-width="3.5"/>
                <rect x="18" y="16" width="28" height="10" rx="3" fill="#fee2e2"/>
                <rect x="18" y="38" width="28" height="8" rx="2" fill="#991b1b"/>
            </svg>`;
        }
    } else if (isMoto) {
        icon.innerHTML = `<svg viewBox="0 0 64 64" width="22" height="22">
            <circle cx="32" cy="32" r="22" fill="#7c3aed" stroke="#fff" stroke-width="3"/>
            <circle cx="32" cy="24" r="6" fill="#fde68a"/>
            <rect x="27" y="30" width="10" height="14" rx="4" fill="#1e1b4b"/>
        </svg>`;
    } else if (isCarga) {
        icon.innerHTML = `<svg viewBox="0 0 64 64" width="24" height="24">
            <rect x="13" y="7" width="38" height="50" rx="10" fill="#059669" stroke="#ffffff" stroke-width="3"/>
            <rect x="17" y="13" width="30" height="12" rx="3" fill="#a7f3d0"/>
            <rect x="17" y="29" width="30" height="22" rx="3" fill="#064e3b" stroke="#6ee7b7" stroke-width="1.5"/>
        </svg>`;
    } else if (isTaxi || isVip) {
        const bodyFill = isVip ? '#d97706' : '#facc15';
        icon.innerHTML = `<svg viewBox="0 0 64 64" width="24" height="24">
            <rect x="14" y="8" width="36" height="48" rx="12" fill="${bodyFill}" stroke="#1e293b" stroke-width="3"/>
            <rect x="18" y="16" width="28" height="10" rx="3" fill="#38bdf8"/>
            <rect x="24" y="29" width="16" height="6" rx="2" fill="#1e293b"/>
        </svg>`;
    } else {
        icon.innerHTML = `<svg viewBox="0 0 64 64" width="24" height="24">
            <rect x="14" y="8" width="36" height="48" rx="12" fill="#2563eb" stroke="#ffffff" stroke-width="3"/>
            <rect x="18" y="16" width="28" height="10" rx="3" fill="#93c5fd"/>
            <rect x="18" y="38" width="28" height="8" rx="2" fill="#1e3a8a"/>
        </svg>`;
    }

    wrap.appendChild(label);
    wrap.appendChild(icon);
    return wrap;
}

function removeFleetMarker(id) {
    const m = markers[id];
    if (!m) return;
    try {
        if ('map' in m) m.map = null;
        if (typeof m.setMap === 'function') m.setMap(null);
    } catch (_) {}
    delete markers[id];
    delete markerMeta[id];
    if (window.driverMarkers && window.driverMarkers[id] === m) {
        delete window.driverMarkers[id];
    }
}

export function removeFleetDriverMarker(driverId) {
    if (!driverId) return;
    removeFleetMarker(driverId);
    if (window.driverMarkers?.[driverId] && typeof window.removeDriverMarker === 'function') {
        try { window.removeDriverMarker(driverId); } catch (_) {}
    }
}

function clearAllFleetMarkers() {
    Object.keys(markers).forEach(removeFleetMarker);
}

const SMOOTH_MIN_MS = 280;
const SMOOTH_MAX_MS = 1600;
const TELEPORT_DEG = 0.03;

function animateMarkerTo(marker, id, targetLat, targetLng) {
    const meta = markerMeta[id] || {};
    const fromLat = Number.isFinite(meta.lat) ? meta.lat : targetLat;
    const fromLng = Number.isFinite(meta.lng) ? meta.lng : targetLng;
    const dLat = targetLat - fromLat;
    const dLng = targetLng - fromLng;
    const dist = Math.hypot(dLat, dLng);

    const now = performance.now();
    const dtObs = meta.lastUpdatePerf ? now - meta.lastUpdatePerf : 900;
    meta.lastUpdatePerf = now;

    if (meta.rafId) {
        cancelAnimationFrame(meta.rafId);
        meta.rafId = null;
    }

    if (dist < 1e-6 || dist > TELEPORT_DEG) {
        const pos = toLatLng(targetLat, targetLng);
        if (pos) {
            if (typeof marker.setPosition === 'function') marker.setPosition(pos);
            else marker.position = pos;
        }
        meta.lat = targetLat;
        meta.lng = targetLng;
        markerMeta[id] = meta;
        return;
    }

    const duration = Math.min(SMOOTH_MAX_MS, Math.max(SMOOTH_MIN_MS, dtObs * 0.85));
    const start = now;

    const step = (t) => {
        const k = Math.min(1, (t - start) / duration);
        const curLat = fromLat + dLat * k;
        const curLng = fromLng + dLng * k;
        const pos = toLatLng(curLat, curLng);
        if (pos) {
            if (typeof marker.setPosition === 'function') marker.setPosition(pos);
            else marker.position = pos;
        }
        meta.lat = curLat;
        meta.lng = curLng;
        if (k < 1) {
            meta.rafId = requestAnimationFrame(step);
        } else {
            meta.rafId = null;
        }
    };

    meta.rafId = requestAnimationFrame(step);
    markerMeta[id] = meta;
}

function upsertFleetMarker(id, lat, lng, name, vehicleType, heading, phone, options = {}) {
    if (!window.gMap || !window.mapLoaded) return;
    const pos = toLatLng(lat, lng);
    if (!pos) return;

    const onTrip = Boolean(options.onTrip);
    const phase = options.phase || (onTrip ? 'to_pickup' : null);
    const phaseStyle = onTrip ? getFleetPhaseStyle(phase, options.tripMeta?.trip || options.tripMeta) : null;
    const isOnline = options.isOnline !== false;
    const prev = markerMeta[id];
    const existing = markers[id];

    const stateChanged = prev && (
        prev.onTrip !== onTrip ||
        prev.phase !== phase ||
        prev.vehicleType !== vehicleType ||
        prev.isOnline !== isOnline
    );

    if (existing && stateChanged) {
        removeFleetMarker(id);
    }

    const current = markers[id];
    if (current) {
        animateMarkerTo(current, id, Number(lat), Number(lng));
        if (current.content) {
            const lbl = current.content.querySelector?.('.hr-fleet-driver-label');
            const statusDot = onTrip ? '🚗 ' : (isOnline ? '🟢 ' : '⚪ ');
            const expectedText = statusDot + (name || 'Conductor');
            if (lbl && lbl.textContent !== expectedText) lbl.textContent = expectedText;
            const ic = current.content.querySelector?.('.hr-fleet-driver-icon');
            if (ic && Number.isFinite(Number(heading))) {
                ic.style.transform = `rotate(${Number(heading)}deg)`;
            }
        }
        markerMeta[id] = {
            ...(markerMeta[id] || {}),
            onTrip,
            phase,
            vehicleType,
            name,
            isOnline
        };
        return;
    }

    let marker = null;
    const AdvancedMarker = window.google?.maps?.marker?.AdvancedMarkerElement;

    const openDriverSheet = (domEv) => {
        try {
            domEv?.stopPropagation?.();
            domEv?.preventDefault?.();
        } catch (_) {}
        const fn = window.openStaffFleetDriverPanel || window.showStaffDriverFinanceMapSheet;
        if (typeof fn === 'function') fn(id, name);
    };

    const markerTitle = options.title || (
        onTrip && phaseStyle
            ? `${name || 'Conductor'} · ${phaseStyle.label} (toca para detalles)`
            : `${name || 'Conductor'} · ${isOnline ? 'En línea' : 'Inactivo'} (toca para finanzas y viajes)`
    );

    if (AdvancedMarker) {
        try {
            const content = makeFleetMarkerElement(vehicleType, heading, name, phone, {
                onTrip,
                phase,
                tripMeta: options.tripMeta,
                isOnline
            });
            content.addEventListener('click', openDriverSheet);
            marker = new AdvancedMarker({
                map: window.gMap,
                position: pos,
                content,
                title: markerTitle,
                gmpClickable: true
            });
            if (typeof marker.addListener === 'function') {
                marker.addListener('gmp-click', openDriverSheet);
                marker.addListener('click', openDriverSheet);
            }
        } catch (_) {
            marker = null;
        }
    }

    if (!marker && window.google?.maps?.Marker) {
        const fillColor = onTrip && phaseStyle
            ? phaseStyle.color
            : (isOnline ? (classifyFleetVehicleCategory(vehicleType) === 'moto' ? '#7c3aed' : '#10b981') : '#64748b');
        marker = new google.maps.Marker({
            map: window.gMap,
            position: pos,
            title: markerTitle,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: onTrip ? 10 : (isOnline ? 9 : 7),
                fillColor,
                fillOpacity: isOnline || onTrip ? 1 : 0.65,
                strokeColor: '#ffffff',
                strokeWeight: 2
            }
        });
        marker.addListener('click', openDriverSheet);
    }

    if (marker) {
        markers[id] = marker;
        markerMeta[id] = {
            lat: Number(lat),
            lng: Number(lng),
            onTrip,
            phase,
            vehicleType,
            name,
            isOnline,
            lastUpdatePerf: performance.now()
        };
        window.driverMarkers = window.driverMarkers || {};
        window.driverMarkers[id] = marker;
    }
}

function paintFleetDriver(uid, data) {
    if (!viewerCanSeeFleet() || !window.gMap || !window.mapLoaded) return;
    if (!shouldRenderFleetMarkerOnMap(uid, data)) {
        removeFleetMarker(uid);
        return;
    }

    const profile = resolveDriverProfile(uid, data);
    if (!profile) {
        removeFleetMarker(uid);
        return;
    }

    const tripMeta = activeTripDrivers.get(uid) || null;
    const onTrip = Boolean(tripMeta);
    const phase = onTrip ? getFleetTripPhase(tripMeta) : null;
    const phaseStyle = onTrip ? getFleetPhaseStyle(phase, tripMeta?.trip || tripMeta) : null;
    const isOnline = isFleetDriverOnlineOrInTrip(uid, data);

    const isOnlineRecently = isDriverOnline(data);
    const freshGps = isFreshGps(data);
    let stateLabel = 'App cerrada (última ubicación)';
    if (onTrip && phaseStyle) stateLabel = `EN VIAJE · ${phaseStyle.label}`;
    else if (isOnlineRecently && data.appVisible !== false) stateLabel = 'En línea';
    else if (isOnlineRecently || freshGps) stateLabel = 'En 2º plano';

    const vtype = profile.vehicleType || data.vehicleType || 'auto';

    upsertFleetMarker(
        uid,
        data.lat,
        data.lng,
        profile.name,
        vtype,
        data.heading,
        profile.phone,
        {
            onTrip,
            phase,
            tripMeta,
            isOnline,
            forceReposition: true,
            title: `${profile.name} · ${stateLabel}`
        }
    );
}

function paintActiveTripFallbacks(visibleIds) {
    activeTripDrivers.forEach((meta, driverId) => {
        if (visibleIds.has(driverId)) return;
        const trip = meta.trip || {};
        const lat = Number(trip.driverLat ?? trip.originLat);
        const lng = Number(trip.driverLng ?? trip.originLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const user = (window.allUsersData || []).find((u) => u.uid === driverId) || {};
        const name = (user.name || trip.driverName || '').toString().trim();
        if (!name || name.toLowerCase() === 'conductor') return;

        const vtype = trip.driverVehicleType || user.vehicleType || 'auto';
        const cat = classifyFleetVehicleCategory(vtype, user);
        if (fleetFilterState.category !== 'all' && cat !== fleetFilterState.category) {
            removeFleetMarker(driverId);
            return;
        }

        const phone = user.phone || trip.driverPhone || null;
        const phase = getFleetTripPhase(meta);
        const phaseStyle = getFleetPhaseStyle(phase, meta?.trip || meta);
        const gpsNote = (trip.driverLat != null && trip.driverLng != null)
            ? phaseStyle.label
            : `${phaseStyle.label} (posición de recogida · sin GPS reciente)`;
        const title = `${name} · EN VIAJE · ${gpsNote}`;

        upsertFleetMarker(
            driverId,
            lat,
            lng,
            name,
            vtype,
            0,
            phone,
            {
                onTrip: true,
                phase,
                tripMeta: meta,
                 isOnline: true,
                forceReposition: true,
                title
            }
        );
        visibleIds.add(driverId);
    });
}

function formatAgeBadge(updatedAt) {
    const ts = Number(updatedAt || 0);
    if (!ts) return 'Sin GPS reciente';
    const diffMin = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (diffMin < 60) return `hace ${diffMin} min`;
    const hours = Math.round(diffMin / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    return `hace ${days} d`;
}

function formatZoneLabel(zoneId) {
    if (!zoneId) return '';
    const map = {
        comayagua: 'Comayagua',
        tegucigalpa: 'Tegucigalpa',
        sps: 'San Pedro Sula',
        san_pedro_sula: 'San Pedro Sula',
        la_ceiba: 'La Ceiba',
        siguatepeque: 'Siguatepeque',
        la_paz: 'La Paz',
        choluteca: 'Choluteca',
        danli: 'Danlí',
        juticalpa: 'Juticalpa',
        roatan: 'Roatán',
        puerto_cortes: 'Puerto Cortés'
    };
    return map[String(zoneId).toLowerCase()] || String(zoneId);
}

function escapeHtmlSafe(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Construye el inventario unificado de conductores (de drivers_location + usuarios aprobados)
 * para el HUD del mapa y para los paneles de Admin/Supervisor.
 */
export function getFleetDriversDirectorySnapshot() {
    const byUid = new Map();
    const users = Array.isArray(window.allUsersData) ? window.allUsersData : [];
    const usersByUid = new Map(users.map((u) => [u.uid, u]));

    // 1) Conductores en drivers_location
    latestDriverDocs.forEach((data, uid) => {
        if (!shouldShowFleetDriver(uid, data)) return;
        const profile = resolveDriverProfile(uid, data);
        if (!profile) return;
        const onTrip = isOnActiveTrip(uid);
        const online = isFleetDriverOnlineOrInTrip(uid, data);
        byUid.set(uid, {
            uid,
            name: profile.name,
            phone: profile.phone,
            whatsAppHref: buildDriverWhatsAppHref(profile.phone, profile.name),
            vehicleType: profile.vehicleType,
            category: profile.category,
            plate: profile.plate,
            model: profile.model,
            cityId: profile.cityId,
            cityName: profile.cityName,
            zoneId: profile.cityId,
            zoneLabel: profile.cityName,
            lat: Number(data.lat),
            lng: Number(data.lng),
            hasMapCoords: Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng)),
            online,
            onTrip,
            updatedAt: Number(data.updatedAt || 0),
            ageLabel: formatAgeBadge(data.updatedAt)
        });
    });

    // 2) Conductores en viaje activo que quizá no tengan doc en drivers_location
    activeTripDrivers.forEach((meta, uid) => {
        if (byUid.has(uid)) return;
        const trip = meta.trip || {};
        const u = usersByUid.get(uid) || {};
        const name = (u.name || trip.driverName || '').toString().trim();
        if (!name || name.toLowerCase() === 'conductor') return;
        const phone = u.phone || trip.driverPhone || (typeof window.getUserDisplayPhone === 'function' ? window.getUserDisplayPhone(u) : '') || '';
        const vtype = trip.driverVehicleType || u.vehicleType || 'auto';
        const lat = Number(trip.driverLat ?? trip.originLat);
        const lng = Number(trip.driverLng ?? trip.originLng);
        const cityInfo = resolveFleetDriverCity({ lat, lng, serviceZoneId: trip.serviceZoneId }, u);
        byUid.set(uid, {
            uid,
            name,
            phone,
            whatsAppHref: buildDriverWhatsAppHref(phone, name),
            vehicleType: vtype,
            category: classifyFleetVehicleCategory(vtype, u),
            plate: u.vehicle?.plate || '',
            model: u.vehicle?.model || '',
            cityId: cityInfo.cityId,
            cityName: cityInfo.cityName,
            zoneId: cityInfo.cityId,
            zoneLabel: cityInfo.cityName,
            lat,
            lng,
            hasMapCoords: Number.isFinite(lat) && Number.isFinite(lng),
            online: true,
            onTrip: true,
            updatedAt: Date.now(),
            ageLabel: 'En viaje ahora'
        });
    });

    // 3) Conductores aprobados en users que aún no tienen doc en drivers_location
    users.forEach((u) => {
        if (!u?.uid || byUid.has(u.uid)) return;
        if (u.role !== 'driver' || u.approvalStatus !== 'approved' || u.inRecycleBin === true) return;
        const name = (u.name || '').toString().trim();
        if (!name || name.toLowerCase() === 'conductor' || /sin.?nombre/i.test(name)) return;
        const phone = u.phone || (typeof window.getUserDisplayPhone === 'function' ? window.getUserDisplayPhone(u) : '') || '';
        const vtype = u.vehicleType || u.vehicle?.type || (Array.isArray(u.vehicles) && u.vehicles[0]?.type) || 'auto';
        const cityInfo = resolveFleetDriverCity({}, u);
        byUid.set(u.uid, {
            uid: u.uid,
            name,
            phone,
            whatsAppHref: buildDriverWhatsAppHref(phone, name),
            vehicleType: vtype,
            category: classifyFleetVehicleCategory(vtype, u),
            plate: u.vehicle?.plate || (Array.isArray(u.vehicles) && u.vehicles[0]?.plate) || '',
            model: u.vehicle?.model || (Array.isArray(u.vehicles) && u.vehicles[0]?.model) || '',
            cityId: cityInfo.cityId,
            cityName: cityInfo.cityName,
            zoneId: cityInfo.cityId,
            zoneLabel: cityInfo.cityName,
            lat: NaN,
            lng: NaN,
            hasMapCoords: false,
            online: false,
            onTrip: false,
            updatedAt: 0,
            ageLabel: 'Sin GPS reciente'
        });
    });

    const allDrivers = Array.from(byUid.values()).sort((a, b) => {
        if (a.onTrip !== b.onTrip) return a.onTrip ? -1 : 1;
        if (a.online !== b.online) return a.online ? -1 : 1;
        if ((b.updatedAt || 0) !== (a.updatedAt || 0)) return (b.updatedAt || 0) - (a.updatedAt || 0);
        return a.name.localeCompare(b.name, 'es');
    });

    const onlineDrivers = allDrivers.filter((d) => d.online);
    const byCategoryAll = { moto: [], auto: [], taxi: [], vip: [], carga: [] };
    const byCategoryOnline = { moto: [], auto: [], taxi: [], vip: [], carga: [] };
    const citiesMap = new Map();

    allDrivers.forEach((d) => {
        const cat = byCategoryAll[d.category] ? d.category : 'auto';
        byCategoryAll[cat].push(d);
        if (d.online) byCategoryOnline[cat].push(d);

        const cKey = d.cityId || 'comayagua';
        if (!citiesMap.has(cKey)) {
            citiesMap.set(cKey, {
                cityId: cKey,
                cityName: d.cityName || 'Comayagua',
                allDrivers: [],
                onlineDrivers: [],
                byCategoryAll: { moto: [], auto: [], taxi: [], vip: [], carga: [] },
                byCategoryOnline: { moto: [], auto: [], taxi: [], vip: [], carga: [] }
            });
        }
        const cityEntry = citiesMap.get(cKey);
        cityEntry.allDrivers.push(d);
        cityEntry.byCategoryAll[cat].push(d);
        if (d.online) {
            cityEntry.onlineDrivers.push(d);
            cityEntry.byCategoryOnline[cat].push(d);
        }
    });

    const cities = Array.from(citiesMap.values()).sort((a, b) => {
        if (b.onlineDrivers.length !== a.onlineDrivers.length) return b.onlineDrivers.length - a.onlineDrivers.length;
        if (b.allDrivers.length !== a.allDrivers.length) return b.allDrivers.length - a.allDrivers.length;
        return a.cityName.localeCompare(b.cityName, 'es');
    });

    return {
        allDrivers,
        onlineDrivers,
        totalCount: allDrivers.length,
        onlineCount: onlineDrivers.length,
        inactiveCount: Math.max(0, allDrivers.length - onlineDrivers.length),
        byCategoryAll,
        byCategoryOnline,
        cities
    };
}

function ensureFleetHudMounted() {
    if (typeof document === 'undefined') return null;
    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) return null;

    let hud = document.getElementById('ops-fleet-map-hud');
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'ops-fleet-map-hud';
        hud.style.cssText = [
            'position:absolute',
            'top:0.75rem',
            'right:0.75rem',
            'z-index:42',
            'display:flex',
            'flex-direction:column',
            'align-items:flex-end',
            'pointer-events:none',
            'max-width:calc(100vw - 1.5rem)'
        ].join(';');
        mapContainer.appendChild(hud);
    }
    return hud;
}

function hideFleetHud() {
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('ops-fleet-map-hud');
    if (hud) hud.style.display = 'none';
}

function renderFleetMapHud() {
    if (typeof document === 'undefined') return;
    if (!viewerCanSeeFleet()) {
        hideFleetHud();
        return;
    }

    const hud = ensureFleetHudMounted();
    if (!hud) return;
    hud.style.display = 'flex';

    // Si el buscador dentro del popover tiene foco, no destruir el DOM mientras escribe
    const activeEl = document.activeElement;
    if (activeEl && activeEl.id === 'ops-fleet-hud-search-input') {
        updateFleetHudListOnly();
        return;
    }

    const snap = getFleetDriversDirectorySnapshot();
    const isOnlineOnly = fleetFilterState.statusMode === 'online';
    const activeCat = fleetFilterState.category || 'all';
    const activeCity = fleetFilterState.cityId || 'all';

    const selectedCityObj = activeCity !== 'all'
        ? snap.cities.find((c) => c.cityId === activeCity)
        : null;

    const sourcePool = selectedCityObj
        ? (isOnlineOnly ? selectedCityObj.onlineDrivers : selectedCityObj.allDrivers)
        : (isOnlineOnly ? snap.onlineDrivers : snap.allDrivers);

    const catPoolMap = selectedCityObj
        ? (isOnlineOnly ? selectedCityObj.byCategoryOnline : selectedCityObj.byCategoryAll)
        : (isOnlineOnly ? snap.byCategoryOnline : snap.byCategoryAll);

    const onlineCountInCity = selectedCityObj ? selectedCityObj.onlineDrivers.length : snap.onlineCount;
    const totalCountInCity = selectedCityObj ? selectedCityObj.allDrivers.length : snap.totalCount;

    const catMiniSummary = FLEET_VEHICLE_CATEGORIES
        .map((c) => {
            const n = (catPoolMap[c.key] || []).length;
            return n > 0 ? `${c.emoji}${n}` : '';
        })
        .filter(Boolean)
        .join(' ');

    const activeCatMeta = activeCat !== 'all' ? getFleetCategoryMeta(activeCat) : null;
    const cityPrefix = selectedCityObj ? `📍 ${selectedCityObj.cityName} · ` : '';
    const pillMainText = isOnlineOnly
        ? `${cityPrefix}${onlineCountInCity} en línea`
        : `${cityPrefix}Todos (${totalCountInCity}) · 🟢${onlineCountInCity}`;

    const pillSubText = activeCatMeta
        ? `${activeCatMeta.emoji} ${activeCatMeta.shortLabel}`
        : (catMiniSummary || (isOnlineOnly ? 'Inactivos ocultos' : 'Con inactivos'));

    const pillBorder = isOnlineOnly ? 'rgba(16, 185, 129, 0.65)' : 'rgba(148, 163, 184, 0.5)';
    const pillDot = isOnlineOnly
        ? `<span style="width:8px;height:8px;border-radius:999px;background:#10b981;box-shadow:0 0 8px #10b981;display:inline-block;flex-shrink:0;"></span>`
        : `<span style="width:8px;height:8px;border-radius:999px;background:#94a3b8;display:inline-block;flex-shrink:0;"></span>`;

    let popoverHtml = '';
    if (fleetFilterState.popoverOpen) {
        const cityChipsHtml = [
            (() => {
                const active = activeCity === 'all';
                const count = isOnlineOnly ? snap.onlineCount : snap.totalCount;
                return `<button type="button" onclick="window.setOpsFleetCityFilter('all')"
                    style="padding:4px 9px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid ${active ? '#38bdf8' : 'rgba(148,163,184,0.28)'};background:${active ? 'rgba(14,165,233,0.24)' : 'rgba(15,23,42,0.75)'};color:${active ? '#7dd3fc' : '#cbd5e1'};cursor:pointer;white-space:nowrap;">
                    🌎 Todas las ciudades (${count})
                </button>`;
            })(),
            ...snap.cities.map((c) => {
                const count = isOnlineOnly ? c.onlineDrivers.length : c.allDrivers.length;
                const active = activeCity === c.cityId;
                return `<button type="button" onclick="window.setOpsFleetCityFilter('${escapeHtmlSafe(c.cityId)}')"
                    style="padding:4px 9px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid ${active ? '#38bdf8' : 'rgba(148,163,184,0.25)'};background:${active ? 'rgba(14,165,233,0.24)' : 'rgba(15,23,42,0.75)'};color:${active ? '#ffffff' : '#cbd5e1'};cursor:pointer;white-space:nowrap;opacity:${count === 0 && !active ? '0.55' : '1'};">
                    📍 ${escapeHtmlSafe(c.cityName)} (${count})
                </button>`;
            })
        ].join('');

        const chipsHtml = [
            (() => {
                const active = activeCat === 'all';
                return `<button type="button" onclick="window.setOpsFleetCategoryFilter('all')"
                    style="padding:5px 10px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid ${active ? '#10b981' : 'rgba(148,163,184,0.28)'};background:${active ? 'rgba(16,185,129,0.22)' : 'rgba(15,23,42,0.75)'};color:${active ? '#6ee7b7' : '#cbd5e1'};cursor:pointer;white-space:nowrap;">
                    Todos (${sourcePool.length})
                </button>`;
            })(),
            ...FLEET_VEHICLE_CATEGORIES.map((c) => {
                const count = (catPoolMap[c.key] || []).length;
                const active = activeCat === c.key;
                return `<button type="button" onclick="window.setOpsFleetCategoryFilter('${c.key}')"
                    style="padding:5px 10px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid ${active ? c.color : 'rgba(148,163,184,0.25)'};background:${active ? c.bg : 'rgba(15,23,42,0.75)'};color:${active ? '#ffffff' : '#cbd5e1'};cursor:pointer;white-space:nowrap;opacity:${count === 0 && !active ? '0.55' : '1'};">
                    ${c.emoji} ${c.shortLabel} (${count})
                </button>`;
            })
        ].join('');

        popoverHtml = `
            <div id="ops-fleet-hud-popover" style="pointer-events:auto;margin-top:8px;width:min(375px, calc(100vw - 1.5rem));max-height:min(78vh, 580px);display:flex;flex-direction:column;background:rgba(9, 14, 28, 0.96);backdrop-filter:blur(16px);border:1px solid rgba(51, 65, 85, 0.85);border-radius:18px;box-shadow:0 18px 42px rgba(0,0,0,0.65);overflow:hidden;color:#f8fafc;">
                <div style="padding:12px 14px 10px;border-bottom:1px solid rgba(51,65,85,0.65);background:rgba(15,23,42,0.85);">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
                        <div>
                            <p style="font-size:10px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:#34d399;margin:0;">Flota por Ciudad y Vehículo</p>
                            <p style="font-size:12px;font-weight:800;color:#ffffff;margin:1px 0 0;">
                                🟢 ${onlineCountInCity} en línea · ⚪ ${Math.max(0, totalCountInCity - onlineCountInCity)} inactivos
                            </p>
                        </div>
                        <button type="button" onclick="window.toggleOpsFleetHudPopover(false)"
                            style="width:28px;height:28px;border-radius:999px;border:1px solid rgba(148,163,184,0.3);background:rgba(30,41,59,0.8);color:#cbd5e1;font-size:13px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;"
                            title="Cerrar listado">✕</button>
                    </div>

                    <!-- Switch Solo en línea vs Todos -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:rgba(2,6,23,0.75);padding:4px;border-radius:12px;border:1px solid rgba(51,65,85,0.6);">
                        <button type="button" onclick="window.setOpsFleetStatusFilter('online')"
                            style="padding:7px 8px;border-radius:9px;font-size:11px;font-weight:900;border:none;cursor:pointer;background:${isOnlineOnly ? '#059669' : 'transparent'};color:${isOnlineOnly ? '#ffffff' : '#94a3b8'};transition:all 0.15s;">
                            🟢 Solo en línea (${onlineCountInCity})
                        </button>
                        <button type="button" onclick="window.setOpsFleetStatusFilter('all')"
                            style="padding:7px 8px;border-radius:9px;font-size:11px;font-weight:900;border:none;cursor:pointer;background:${!isOnlineOnly ? '#334155' : 'transparent'};color:${!isOnlineOnly ? '#ffffff' : '#94a3b8'};transition:all 0.15s;">
                            👥 Todos (${totalCountInCity})
                        </button>
                    </div>

                    <!-- Filtro por Ciudad -->
                    <div style="margin-top:8px;">
                        <p style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin:0 0 4px;">Por ciudad:</p>
                        <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:60px;overflow-y:auto;">
                            ${cityChipsHtml}
                        </div>
                    </div>

                    <!-- Chips por categoría de vehículo -->
                    <div style="margin-top:8px;">
                        <p style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin:0 0 4px;">Por lo que manejan:</p>
                        <div style="display:flex;flex-wrap:wrap;gap:5px;">
                            ${chipsHtml}
                        </div>
                    </div>

                    <!-- Buscador rápido -->
                    <div style="margin-top:8px;">
                        <input id="ops-fleet-hud-search-input" type="search"
                            value="${escapeHtmlSafe(fleetFilterState.searchQuery)}"
                            placeholder="Buscar conductor, placa, teléfono o ciudad…"
                            oninput="window.setOpsFleetHudSearch(this.value)"
                            style="width:100%;padding:7px 10px;border-radius:10px;border:1px solid rgba(71,85,105,0.75);background:rgba(2,6,23,0.85);color:#f8fafc;font-size:11px;font-weight:700;outline:none;">
                    </div>
                </div>

                <div id="ops-fleet-hud-list-body" style="padding:10px 12px;overflow-y:auto;max-height:310px;display:flex;flex-direction:column;gap:10px;">
                    ${buildFleetHudGroupedListHtml(snap)}
                </div>

                <div style="padding:8px 12px;border-top:1px solid rgba(51,65,85,0.65);background:rgba(15,23,42,0.9);display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <span style="font-size:10px;color:#94a3b8;font-weight:700;">
                        ${isOnlineOnly ? 'Mapa limpio: inactivos ocultos' : 'Mostrando activos e inactivos'}
                    </span>
                    <button type="button" onclick="window.openStaffDriversByVehicleDirectory()"
                        style="padding:5px 10px;border-radius:8px;background:rgba(16,185,129,0.18);border:1px solid rgba(16,185,129,0.45);color:#6ee7b7;font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap;">
                        📋 Directorio Completo
                    </button>
                </div>
            </div>
        `;
    }

    hud.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;pointer-events:auto;">
            <button type="button" id="ops-fleet-hud-btn" onclick="window.toggleOpsFleetHudPopover()"
                style="display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;background:rgba(15, 23, 42, 0.92);backdrop-filter:blur(10px);border:1.5px solid ${pillBorder};color:#f8fafc;font-size:11px;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,0.45);cursor:pointer;line-height:1.15;">
                ${pillDot}
                <span>${escapeHtmlSafe(pillMainText)}</span>
                <span style="color:#94a3b8;font-weight:700;font-size:10px;">· ${escapeHtmlSafe(pillSubText)}</span>
                <span style="font-size:10px;color:#34d399;margin-left:2px;">${fleetFilterState.popoverOpen ? '▴' : '▾'}</span>
            </button>
        </div>
        ${popoverHtml}
    `;
}

function buildDriverRowForHudHtml(d) {
    const statusBadge = d.onTrip
        ? `<span style="font-size:9px;font-weight:900;padding:1px 6px;border-radius:999px;background:rgba(220,38,38,0.22);color:#fca5a5;border:1px solid rgba(239,68,68,0.45);">🚗 EN VIAJE</span>`
        : (d.online
            ? `<span style="font-size:9px;font-weight:900;padding:1px 6px;border-radius:999px;background:rgba(16,185,129,0.2);color:#6ee7b7;border:1px solid rgba(16,185,129,0.4);">🟢 EN LÍNEA</span>`
            : `<span style="font-size:9px;font-weight:800;padding:1px 6px;border-radius:999px;background:rgba(51,65,85,0.65);color:#94a3b8;">⚪ ${escapeHtmlSafe(d.ageLabel)}</span>`);

    const metaParts = [
        d.cityName ? `📍 ${d.cityName}` : '',
        d.plate ? `🪪 ${d.plate}` : '',
        d.model ? d.model : ''
    ].filter(Boolean).join(' · ');

    const waBtn = d.whatsAppHref
        ? `<a href="${escapeHtmlSafe(d.whatsAppHref)}" target="_blank" rel="noopener"
            onclick="event.stopPropagation();"
            style="padding:5px 9px;border-radius:8px;background:#16a34a;color:#ffffff;font-size:10px;font-weight:900;text-decoration:none;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;box-shadow:0 2px 6px rgba(22,163,74,0.35);"
            title="Escribir por WhatsApp a ${escapeHtmlSafe(d.name)}">
            <i class="fab fa-whatsapp" style="font-size:12px;"></i> WhatsApp
        </a>`
        : `<button type="button" onclick="event.stopPropagation();window.openStaffFleetDriverPanel?.('${escapeHtmlSafe(d.uid)}','${escapeHtmlSafe(d.name)}')"
            style="padding:5px 8px;border-radius:8px;background:rgba(51,65,85,0.6);color:#cbd5e1;font-size:9px;font-weight:800;border:1px solid rgba(100,116,139,0.4);cursor:pointer;">
            Ficha
        </button>`;

    const mapBtn = d.hasMapCoords
        ? `<button type="button" onclick="event.stopPropagation();window.focusOpsFleetDriverOnMap('${escapeHtmlSafe(d.uid)}')"
            style="padding:5px 8px;border-radius:8px;background:rgba(30,41,59,0.9);color:#38bdf8;border:1px solid rgba(56,189,248,0.35);font-size:10px;font-weight:800;cursor:pointer;"
            title="Centrar en el mapa y ver ficha">
            📍
        </button>`
        : '';

    return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border-radius:11px;background:rgba(15,23,42,0.85);border:1px solid rgba(51,65,85,0.65);">
            <div style="min-width:0;flex:1;cursor:pointer;" onclick="window.focusOpsFleetDriverOnMap('${escapeHtmlSafe(d.uid)}')">
                <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                    <span style="font-size:12px;font-weight:800;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:145px;">
                        ${escapeHtmlSafe(d.name)}
                    </span>
                    ${statusBadge}
                </div>
                ${metaParts ? `<p style="font-size:10px;color:#94a3b8;font-weight:600;margin:2px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtmlSafe(metaParts)}</p>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                ${waBtn}
                <button type="button" onclick="event.stopPropagation();window.staffChangeDriverVehicleType?.('${escapeHtmlSafe(d.uid)}')"
                    style="padding:5px 7px;border-radius:8px;background:rgba(79,70,229,0.28);color:#c7d2fe;border:1px solid rgba(129,140,248,0.45);font-size:10px;font-weight:800;cursor:pointer;"
                    title="Cambiar tipo de vehículo (Moto / Carro / Taxi / VIP / Paila)">
                    🏍️/🚗
                </button>
                ${mapBtn}
            </div>
        </div>
    `;
}

function buildFleetHudGroupedListHtml(snap) {
    const isOnlineOnly = fleetFilterState.statusMode === 'online';
    const activeCat = fleetFilterState.category || 'all';
    const activeCity = fleetFilterState.cityId || 'all';
    const q = String(fleetFilterState.searchQuery || '').toLowerCase().trim();

    const citiesToRender = activeCity === 'all'
        ? snap.cities
        : snap.cities.filter((c) => c.cityId === activeCity);

    const categoriesToRender = activeCat === 'all'
        ? FLEET_VEHICLE_CATEGORIES
        : FLEET_VEHICLE_CATEGORIES.filter((c) => c.key === activeCat);

    let cityBlocksHtml = '';
    let totalShown = 0;

    citiesToRender.forEach((cityEntry) => {
        const catPoolMap = isOnlineOnly ? cityEntry.byCategoryOnline : cityEntry.byCategoryAll;
        let categoriesHtml = '';
        let cityShownCount = 0;

        categoriesToRender.forEach((catMeta) => {
            let list = catPoolMap[catMeta.key] || [];
            if (q) {
                list = list.filter((d) =>
                    d.name.toLowerCase().includes(q)
                    || String(d.phone || '').includes(q)
                    || String(d.plate || '').toLowerCase().includes(q)
                    || String(d.cityName || '').toLowerCase().includes(q)
                );
            }
            if (list.length === 0) return;
            cityShownCount += list.length;
            totalShown += list.length;

            const rowsHtml = list.map(buildDriverRowForHudHtml).join('');
            categoriesHtml += `
                <div style="display:flex;flex-direction:column;gap:5px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-radius:8px;background:${catMeta.bg};border:1px solid ${catMeta.border};">
                        <span style="font-size:11px;font-weight:900;color:#ffffff;">
                            ${catMeta.emoji} ${escapeHtmlSafe(catMeta.label)}
                        </span>
                        <span style="font-size:10px;font-weight:900;color:${catMeta.color};">
                            ${list.length}
                        </span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:5px;">
                        ${rowsHtml}
                    </div>
                </div>
            `;
        });

        if (cityShownCount === 0) return;

        if (citiesToRender.length > 1 || activeCity === 'all') {
            cityBlocksHtml += `
                <div style="border:1px solid rgba(56,189,248,0.28);border-radius:13px;background:rgba(2,6,23,0.45);padding:8px;display:flex;flex-direction:column;gap:7px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:2px 4px;border-bottom:1px solid rgba(51,65,85,0.6);">
                        <span style="font-size:11px;font-weight:900;color:#7dd3fc;letter-spacing:0.04em;">
                            📍 ${escapeHtmlSafe(cityEntry.cityName)}
                        </span>
                        <span style="font-size:10px;font-weight:800;color:#94a3b8;">
                            ${cityShownCount} conductor${cityShownCount === 1 ? '' : 'es'}
                        </span>
                    </div>
                    ${categoriesHtml}
                </div>
            `;
        } else {
            cityBlocksHtml += categoriesHtml;
        }
    });

    if (totalShown === 0) {
        const emptyHint = isOnlineOnly
            ? `No hay conductores en línea con este filtro en este momento. Toca "👥 Todos (${snap.totalCount})" arriba para ver y escribir por WhatsApp a todos por ciudad y vehículo.`
            : 'No se encontraron conductores con ese filtro.';
        return `
            <div style="padding:18px 12px;text-align:center;color:#94a3b8;font-size:11px;font-weight:700;">
                <p style="margin:0 0 8px;">${escapeHtmlSafe(emptyHint)}</p>
                ${isOnlineOnly && snap.totalCount > 0 ? `
                    <button type="button" onclick="window.setOpsFleetStatusFilter('all')"
                        style="padding:6px 12px;border-radius:999px;background:#334155;color:#ffffff;font-size:11px;font-weight:800;border:none;cursor:pointer;">
                        👥 Ver los ${snap.totalCount} conductores por ciudad
                    </button>
                ` : ''}
            </div>
        `;
    }

    return cityBlocksHtml;
}

function updateFleetHudListOnly() {
    if (typeof document === 'undefined') return;
    const listBody = document.getElementById('ops-fleet-hud-list-body');
    if (!listBody) return;
    const snap = getFleetDriversDirectorySnapshot();
    listBody.innerHTML = buildFleetHudGroupedListHtml(snap);
}

export function renderOpsFleetMap(snap) {
    if (!viewerCanSeeFleet()) {
        clearAllFleetMarkers();
        hideFleetHud();
        return;
    }

    if (snap?.forEach) {
        latestDriverDocs.clear();
        snap.forEach((docSnap) => {
            latestDriverDocs.set(docSnap.id, docSnap.data());
        });
    }

    renderFleetMapHud();

    if (!window.gMap || !window.mapLoaded) return;

    const visibleIds = new Set();

    snap?.forEach?.((docSnap) => {
        const data = docSnap.data();
        const uid = docSnap.id;
        if (!shouldRenderFleetMarkerOnMap(uid, data)) {
            removeFleetMarker(uid);
            return;
        }
        visibleIds.add(uid);
        paintFleetDriver(uid, data);
    });

    // Conductores en viaje activo sin GPS en Firebase
    paintActiveTripFallbacks(visibleIds);

    const activeSim = window.tripSimDriverUid || (window.lastSimTrip ? window.lastSimTrip.driverId : null);
    if (activeSim) visibleIds.add(activeSim);

    Object.keys(markers).forEach((id) => {
        if (visibleIds.has(id)) return;
        if (activeSim && id === activeSim) return;
        removeFleetMarker(id);
    });
}

function scheduleRender(snap) {
    lastSnap = snap;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
        renderOpsFleetMap(lastSnap);
        renderTimer = null;
    }, 50);
}

function processFleetDocChanges(snap) {
    snap.docChanges().forEach((change) => {
        const data = change.doc.data();
        const uid = change.doc.id;

        if (change.type === 'removed') {
            latestDriverDocs.delete(uid);
            removeFleetMarker(uid);
            return;
        }

        latestDriverDocs.set(uid, data);
        paintFleetDriver(uid, data);
    });
}

function syncActiveTripDrivers(snap) {
    activeTripDrivers.clear();
    snap?.forEach?.((docSnap) => {
        const data = docSnap.data() || {};
        if (!data.driverId) return;
        const phase = getFleetTripPhase(data);
        activeTripDrivers.set(data.driverId, {
            tripId: docSnap.id,
            status: data.status,
            driverArrived: !!data.driverArrived,
            phase,
            trip: { id: docSnap.id, ...data }
        });
    });
    if (lastSnap) renderOpsFleetMap(lastSnap);
    else renderFleetMapHud();
    syncFleetLiveRepaint();
}

/** API para el panel staff: viaje activo del conductor en rojo (si hay). */
export function getFleetActiveTripForDriver(driverId) {
    if (!driverId) return null;
    return activeTripDrivers.get(driverId) || null;
}

export function getFleetActiveTripsSnapshot() {
    const out = [];
    activeTripDrivers.forEach((v, driverId) => {
        out.push({ driverId, ...v });
    });
    return out;
}

function syncFleetLiveRepaint() {
    if (fleetLiveTimer) {
        clearInterval(fleetLiveTimer);
        fleetLiveTimer = null;
    }
    if (!viewerCanSeeFleet()) return;

    fleetLiveTimer = setInterval(() => {
        if (!lastSnap || !viewerCanSeeFleet()) return;
        renderOpsFleetMap(lastSnap);
    }, 2500);
}

function startActiveTripsFleetListener(db, appId) {
    if (tripsUnsub) {
        tripsUnsub();
        tripsUnsub = null;
    }
    if (!db || !appId) return;

    tripsUnsub = onSnapshot(
        query(
            collection(db, 'artifacts', appId, 'public', 'data', 'trips'),
            where('status', 'in', ['accepted', 'in_progress'])
        ),
        (snap) => syncActiveTripDrivers(snap),
        () => {}
    );
}

export function startOpsFleetMapListener(db, appId) {
    stopOpsFleetMapListener();
    if (!viewerCanSeeFleet()) return;
    if (!db || !appId) return;

    // Asegurar que allUsersData (con teléfonos enriquecidos de users_private) se cargue para el botón de WhatsApp
    if (!didTriggerUsersLoad && (!window.allUsersData || window.allUsersData.length === 0)) {
        didTriggerUsersLoad = true;
        setTimeout(() => {
            if ((!window.allUsersData || window.allUsersData.length === 0) && typeof window.loadAdminUsers === 'function') {
                window.loadAdminUsers().catch(() => {});
            }
        }, 400);
    }

    startActiveTripsFleetListener(db, appId);

    unsub = onSnapshot(
        collection(db, 'artifacts', appId, 'public', 'data', 'drivers_location'),
        (snap) => {
            lastSnap = snap;
            processFleetDocChanges(snap);
            scheduleRender(snap);
        },
        () => {}
    );

    syncFleetLiveRepaint();
}

export function stopOpsFleetMapListener() {
    if (unsub) {
        unsub();
        unsub = null;
    }
    if (tripsUnsub) {
        tripsUnsub();
        tripsUnsub = null;
    }
    if (fleetLiveTimer) {
        clearInterval(fleetLiveTimer);
        fleetLiveTimer = null;
    }
    if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
    }
    lastSnap = null;
    latestDriverDocs.clear();
    activeTripDrivers.clear();
    clearAllFleetMarkers();
    hideFleetHud();
}

export function refreshOpsFleetMapFromCache() {
    if (lastSnap) {
        renderOpsFleetMap(lastSnap);
        return;
    }
    renderFleetMapHud();
    mergeFleetFromApprovedDrivers();
}

export function mergeFleetFromApprovedDrivers() {
    if (!viewerCanSeeFleet() || !window.gMap || !window.mapLoaded) return;
    const users = window.allUsersData || [];
    users.forEach((user) => {
        if (user.role && user.role !== 'driver') return;
        if (user.approvalStatus && user.approvalStatus !== 'approved') return;
        const uid = user.uid;
        if (!uid || markers[uid]) return;
        const docSnap = lastSnap?.docs?.find((d) => d.id === uid);
        if (docSnap) {
            paintFleetDriver(uid, docSnap.data());
        }
    });
    renderFleetMapHud();
}

export function pruneGhostFleetMarkers() {
    if (!viewerCanSeeFleet()) return;

    const users = window.allUsersData || [];
    const usersLoaded = Array.isArray(users) && users.length > 0;

    Object.keys(markers).forEach((id) => {
        const data = latestDriverDocs.get(id);
        if (data && !shouldRenderFleetMarkerOnMap(id, data)) {
            removeFleetMarker(id);
            return;
        }
        if (isOnActiveTrip(id)) return;
        const u = users.find((x) => x.uid === id) || null;
        if (usersLoaded && !u) {
            removeFleetMarker(id);
            return;
        }
        const st = u?.approvalStatus || null;
        const nm = (u?.name || '').toString().trim().toLowerCase();
        const badRole = u?.role && u.role !== 'driver';
        const isGood = !!u && (st === 'approved') && !badRole && nm && nm !== 'conductor' && !/sin.?nombre/.test(nm)
            && u.inRecycleBin !== true;
        if (!isGood) removeFleetMarker(id);
    });

    if (window.driverMarkers && typeof window.removeDriverMarker === 'function') {
        Object.keys(window.driverMarkers).forEach((id) => {
            const u = users.find((x) => x.uid === id) || null;
            const isSelf = id === (window.currentUser?.uid || window.userProfile?.uid);
            if (isSelf) return;
            const data = latestDriverDocs.get(id);
            if (data && !shouldRenderFleetMarkerOnMap(id, data)) {
                try { window.removeDriverMarker(id); } catch (_) {}
                return;
            }
            if (usersLoaded && !u) {
                try { window.removeDriverMarker(id); } catch (_) {}
                return;
            }
            const st = u?.approvalStatus || null;
            const nm = (u?.name || '').toString().trim().toLowerCase();
            const badRole = u?.role && u.role !== 'driver';
            const isGood = !!u && (st === 'approved') && !badRole && nm && nm !== 'conductor' && !/sin.?nombre/.test(nm)
                && u.inRecycleBin !== true;
            if (!isGood) {
                try { window.removeDriverMarker(id); } catch (_) {}
            }
        });
    }
}


const staffDirectoryState = {
    statusMode: 'all', // En el panel de Conductores por defecto mostramos todos (con filtro 🟢 Solo en línea a 1 toque)
    cityId: 'all',
    category: 'all'
};

export function renderStaffDriversByCityAndVehicleHtml() {
    const snap = getFleetDriversDirectorySnapshot();
    const isOnlineOnly = staffDirectoryState.statusMode === 'online';
    const activeCity = staffDirectoryState.cityId || 'all';
    const activeCat = staffDirectoryState.category || 'all';

    const selectedCityObj = activeCity !== 'all'
        ? snap.cities.find((c) => c.cityId === activeCity)
        : null;

    const catPoolMap = selectedCityObj
        ? (isOnlineOnly ? selectedCityObj.byCategoryOnline : selectedCityObj.byCategoryAll)
        : (isOnlineOnly ? snap.byCategoryOnline : snap.byCategoryAll);

    const onlineCountInScope = selectedCityObj ? selectedCityObj.onlineDrivers.length : snap.onlineCount;
    const totalCountInScope = selectedCityObj ? selectedCityObj.allDrivers.length : snap.totalCount;
    const sourcePool = selectedCityObj
        ? (isOnlineOnly ? selectedCityObj.onlineDrivers : selectedCityObj.allDrivers)
        : (isOnlineOnly ? snap.onlineDrivers : snap.allDrivers);

    const cityChips = [
        (() => {
            const active = activeCity === 'all';
            const cnt = isOnlineOnly ? snap.onlineCount : snap.totalCount;
            return `<button type="button" onclick="window.setStaffDirectoryFilter({ cityId: 'all' })"
                style="padding:5px 11px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid ${active ? '#38bdf8' : 'rgba(148,163,184,0.3)'};background:${active ? 'rgba(14,165,233,0.22)' : 'rgba(15,23,42,0.75)'};color:${active ? '#7dd3fc' : '#cbd5e1'};cursor:pointer;white-space:nowrap;">
                🌎 Todas las ciudades (${cnt})
            </button>`;
        })(),
        ...snap.cities.map((c) => {
            const cnt = isOnlineOnly ? c.onlineDrivers.length : c.allDrivers.length;
            const active = activeCity === c.cityId;
            return `<button type="button" onclick="window.setStaffDirectoryFilter({ cityId: '${escapeHtmlSafe(c.cityId)}' })"
                style="padding:5px 11px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid ${active ? '#38bdf8' : 'rgba(148,163,184,0.28)'};background:${active ? 'rgba(14,165,233,0.22)' : 'rgba(15,23,42,0.75)'};color:${active ? '#ffffff' : '#cbd5e1'};cursor:pointer;white-space:nowrap;">
                📍 ${escapeHtmlSafe(c.cityName)} (${cnt})
            </button>`;
        })
    ].join('');

    const catChips = [
        (() => {
            const active = activeCat === 'all';
            return `<button type="button" onclick="window.setStaffDirectoryFilter({ category: 'all' })"
                style="padding:5px 11px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid ${active ? '#10b981' : 'rgba(148,163,184,0.3)'};background:${active ? 'rgba(16,185,129,0.22)' : 'rgba(15,23,42,0.75)'};color:${active ? '#6ee7b7' : '#cbd5e1'};cursor:pointer;white-space:nowrap;">
                Todos (${sourcePool.length})
            </button>`;
        })(),
        ...FLEET_VEHICLE_CATEGORIES.map((c) => {
            const cnt = (catPoolMap[c.key] || []).length;
            const active = activeCat === c.key;
            return `<button type="button" onclick="window.setStaffDirectoryFilter({ category: '${c.key}' })"
                style="padding:5px 11px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid ${active ? c.color : 'rgba(148,163,184,0.28)'};background:${active ? c.bg : 'rgba(15,23,42,0.75)'};color:${active ? '#ffffff' : '#cbd5e1'};cursor:pointer;white-space:nowrap;opacity:${cnt === 0 && !active ? '0.55' : '1'};">
                ${c.emoji} ${c.label} (${cnt})
            </button>`;
        })
    ].join('');

    const citiesToRender = activeCity === 'all'
        ? snap.cities
        : snap.cities.filter((c) => c.cityId === activeCity);

    const categoriesToRender = activeCat === 'all'
        ? FLEET_VEHICLE_CATEGORIES
        : FLEET_VEHICLE_CATEGORIES.filter((c) => c.key === activeCat);

    let citySectionsHtml = '';
    let totalShown = 0;

    citiesToRender.forEach((cityEntry) => {
        const cMap = isOnlineOnly ? cityEntry.byCategoryOnline : cityEntry.byCategoryAll;
        let vehBlocksHtml = '';
        let cityShown = 0;

        categoriesToRender.forEach((catMeta) => {
            const list = cMap[catMeta.key] || [];
            if (list.length === 0) return;
            cityShown += list.length;
            totalShown += list.length;

            const rows = list.map((d) => {
                const statusBadge = d.onTrip
                    ? `<span style="font-size:9px;font-weight:900;padding:2px 7px;border-radius:999px;background:rgba(220,38,38,0.22);color:#fca5a5;border:1px solid rgba(239,68,68,0.45);">🚗 EN VIAJE</span>`
                    : (d.online
                        ? `<span style="font-size:9px;font-weight:900;padding:2px 7px;border-radius:999px;background:rgba(16,185,129,0.22);color:#6ee7b7;border:1px solid rgba(16,185,129,0.45);">🟢 EN LÍNEA</span>`
                        : `<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:999px;background:rgba(51,65,85,0.65);color:#94a3b8;">⚪ Inactivo (${escapeHtmlSafe(d.ageLabel)})</span>`);

                const metaLine = [
                    d.plate ? `🪪 Placa: ${d.plate}` : '',
                    d.model ? `🚘 ${d.model}` : '',
                    d.phone ? `📞 ${d.phone}` : ''
                ].filter(Boolean).join(' · ');

                const waBtn = d.whatsAppHref
                    ? `<a href="${escapeHtmlSafe(d.whatsAppHref)}" target="_blank" rel="noopener"
                        style="padding:6px 12px;border-radius:10px;background:#16a34a;color:#ffffff;font-size:11px;font-weight:900;text-decoration:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;box-shadow:0 2px 8px rgba(22,163,74,0.35);">
                        <i class="fab fa-whatsapp" style="font-size:13px;"></i> Escribir por WhatsApp
                    </a>`
                    : `<span style="font-size:10px;color:#64748b;font-weight:700;">Sin WhatsApp</span>`;

                const mapBtn = d.hasMapCoords
                    ? `<button type="button" onclick="window.focusOpsFleetDriverOnMap('${escapeHtmlSafe(d.uid)}')"
                        style="padding:6px 10px;border-radius:10px;background:rgba(30,41,59,0.9);color:#38bdf8;border:1px solid rgba(56,189,248,0.35);font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;">
                        📍 Mapa
                    </button>`
                    : '';

                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:8px 11px;border-radius:12px;background:rgba(15,23,42,0.85);border:1px solid rgba(51,65,85,0.65);">
                        <div style="min-width:160px;flex:1;">
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <span style="font-size:13px;font-weight:900;color:#ffffff;">${escapeHtmlSafe(d.name)}</span>
                                ${statusBadge}
                            </div>
                            ${metaLine ? `<p style="font-size:11px;color:#94a3b8;font-weight:600;margin:2px 0 0;">${escapeHtmlSafe(metaLine)}</p>` : ''}
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0;">
                            ${waBtn}
                            <button type="button" onclick="window.staffChangeDriverVehicleType?.('${escapeHtmlSafe(d.uid)}')"
                                style="padding:6px 10px;border-radius:10px;background:rgba(79,70,229,0.25);color:#c7d2fe;border:1px solid rgba(129,140,248,0.45);font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;"
                                title="Cambiar vehículo (ej. de Carro a Moto)">
                                🏍️/🚗 Cambiar vehículo
                            </button>
                            ${mapBtn}
                        </div>
                    </div>
                `;
            }).join('');

            vehBlocksHtml += `
                <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-radius:9px;background:${catMeta.bg};border:1px solid ${catMeta.border};">
                        <span style="font-size:12px;font-weight:900;color:#ffffff;">${catMeta.emoji} ${escapeHtmlSafe(catMeta.label)}</span>
                        <span style="font-size:11px;font-weight:900;color:${catMeta.color};">${list.length} conductor${list.length === 1 ? '' : 'es'}</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${rows}
                    </div>
                </div>
            `;
        });

        if (cityShown === 0) return;

        citySectionsHtml += `
            <details open style="border:1px solid rgba(56,189,248,0.3);border-radius:14px;background:rgba(2,6,23,0.55);padding:10px 12px;margin-bottom:10px;">
                <summary style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:900;color:#7dd3fc;font-size:13px;">
                    <span>📍 ${escapeHtmlSafe(cityEntry.cityName)}</span>
                    <span style="font-size:11px;color:#cbd5e1;font-weight:800;">
                        🟢 ${cityEntry.onlineDrivers.length} en línea · ${cityShown} mostrado${cityShown === 1 ? '' : 's'}
                    </span>
                </summary>
                <div style="margin-top:8px;">
                    ${vehBlocksHtml}
                </div>
            </details>
        `;
    });

    if (totalShown === 0) {
        citySectionsHtml = `
            <div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px;font-weight:700;background:rgba(15,23,42,0.55);border-radius:12px;border:1px dashed rgba(71,85,105,0.6);">
                No hay conductores que coincidan con este filtro (${isOnlineOnly ? 'Solo en línea' : 'Todos'}).
                ${isOnlineOnly ? `<div style="margin-top:8px;"><button type="button" onclick="window.setStaffDirectoryFilter({ statusMode: 'all' })" style="padding:6px 14px;border-radius:999px;background:#334155;color:#fff;font-size:11px;font-weight:800;border:none;cursor:pointer;">👥 Mostrar todos (${totalCountInScope})</button></div>` : ''}
            </div>
        `;
    }

    return `
        <div id="staff-drivers-by-city-vehicle-box" style="margin-bottom:16px;padding:14px;border-radius:18px;background:linear-gradient(145deg, rgba(15,23,42,0.92), rgba(2,6,23,0.92));border:1px solid rgba(16,185,129,0.38);box-shadow:0 10px 28px rgba(0,0,0,0.35);">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
                <div>
                    <p style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.14em;color:#34d399;margin:0;">
                        📋 Directorio Rápido · Por Ciudad y Vehículo
                    </p>
                    <h4 style="font-size:15px;font-weight:900;color:#ffffff;margin:2px 0 0;">
                        Conductores divididos por lo que manejan y WhatsApp directo
                    </h4>
                </div>
                <div style="display:inline-flex;gap:6px;background:rgba(2,6,23,0.8);padding:4px;border-radius:11px;border:1px solid rgba(51,65,85,0.7);">
                    <button type="button" onclick="window.setStaffDirectoryFilter({ statusMode: 'online' })"
                        style="padding:6px 11px;border-radius:8px;font-size:11px;font-weight:900;border:none;cursor:pointer;background:${isOnlineOnly ? '#059669' : 'transparent'};color:${isOnlineOnly ? '#ffffff' : '#94a3b8'};">
                        🟢 Solo en línea (${onlineCountInScope})
                    </button>
                    <button type="button" onclick="window.setStaffDirectoryFilter({ statusMode: 'all' })"
                        style="padding:6px 11px;border-radius:8px;font-size:11px;font-weight:900;border:none;cursor:pointer;background:${!isOnlineOnly ? '#334155' : 'transparent'};color:${!isOnlineOnly ? '#ffffff' : '#94a3b8'};">
                        👥 Todos (${totalCountInScope})
                    </button>
                </div>
            </div>

            <div style="margin-bottom:8px;">
                <p style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin:0 0 5px;">Filtrar por ciudad:</p>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${cityChips}
                </div>
            </div>

            <div style="margin-bottom:12px;">
                <p style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin:0 0 5px;">Divididos por lo que manejan:</p>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${catChips}
                </div>
            </div>

            <div>
                ${citySectionsHtml}
            </div>
        </div>
    `;
}

// Exponer helpers globales para interacción desde el HUD y los paneles Admin/Supervisor
if (typeof window !== 'undefined') {
    window.FLEET_VEHICLE_CATEGORIES = FLEET_VEHICLE_CATEGORIES;
    window.classifyFleetVehicleCategory = classifyFleetVehicleCategory;
    window.getFleetCategoryMeta = getFleetCategoryMeta;
    window.isFleetDriverOnlineOrInTrip = isFleetDriverOnlineOrInTrip;
    window.getFleetDriversDirectorySnapshot = getFleetDriversDirectorySnapshot;
    window.buildDriverWhatsAppHref = buildDriverWhatsAppHref;
    window.renderStaffDriversByCityAndVehicleHtml = renderStaffDriversByCityAndVehicleHtml;
    window.refreshOpsFleetAfterProfileEdit = (uid, patch = {}) => {
        if (uid && latestDriverDocs.has(uid)) {
            const prev = latestDriverDocs.get(uid) || {};
            latestDriverDocs.set(uid, { ...prev, ...patch });
        }
        if (lastSnap) renderOpsFleetMap(lastSnap);
        else renderFleetMapHud();
        const mount = document.getElementById('staff-drivers-by-city-vehicle-mount');
        if (mount) {
            mount.innerHTML = renderStaffDriversByCityAndVehicleHtml();
        }
    };
    window.setStaffDirectoryFilter = (patch = {}) => {
        if (patch.statusMode) staffDirectoryState.statusMode = patch.statusMode;
        if (patch.cityId) staffDirectoryState.cityId = patch.cityId;
        if (patch.category) staffDirectoryState.category = patch.category;
        const mount = document.getElementById('staff-drivers-by-city-vehicle-mount');
        if (mount) {
            mount.innerHTML = renderStaffDriversByCityAndVehicleHtml();
        }
        // También sincronizar las tarjetas de abajo si existe filtro en Admin o Supervisor
        if (typeof window.filterAdminDrivers === 'function' && document.getElementById('driver-search-input')) {
            window._adminDriverVehicleFilter = staffDirectoryState.category || 'all';
            window._adminDriverOnlineFilter = staffDirectoryState.statusMode || 'all';
            window._adminDriverCityFilter = staffDirectoryState.cityId || 'all';
            window.filterAdminDrivers();
        }
        if (typeof window.filterSupActiveDriversSearch === 'function' && document.getElementById('sup-driver-search-input')) {
            window._supDriverVehicleFilter = staffDirectoryState.category || 'all';
            window._supDriverOnlineFilter = staffDirectoryState.statusMode || 'all';
            window._supDriverCityFilter = staffDirectoryState.cityId || 'all';
            window.filterSupActiveDriversSearch();
        }
    };

    window.toggleOpsFleetHudPopover = (forceState) => {
        if (typeof forceState === 'boolean') {
            fleetFilterState.popoverOpen = forceState;
        } else {
            fleetFilterState.popoverOpen = !fleetFilterState.popoverOpen;
        }
        renderFleetMapHud();
    };

    window.setOpsFleetStatusFilter = (mode) => {
        fleetFilterState.statusMode = mode === 'all' ? 'all' : 'online';
        try {
            localStorage.setItem(FLEET_STATUS_STORAGE_KEY, fleetFilterState.statusMode);
        } catch (_) {}
        if (lastSnap) renderOpsFleetMap(lastSnap);
        else renderFleetMapHud();
    };

    window.resolveFleetDriverCity = resolveFleetDriverCity;

    window.setOpsFleetCategoryFilter = (cat) => {
        fleetFilterState.category = cat || 'all';
        if (lastSnap) renderOpsFleetMap(lastSnap);
        else renderFleetMapHud();
    };

    window.setOpsFleetCityFilter = (cityId) => {
        fleetFilterState.cityId = cityId || 'all';
        if (cityId && cityId !== 'all') {
            const z = getZoneById?.(cityId);
            if (z?.center && window.gMap) {
                try {
                    window.gMap.panTo(z.center);
                } catch (_) {}
            }
        }
        if (lastSnap) renderOpsFleetMap(lastSnap);
        else renderFleetMapHud();
    };

    window.setOpsFleetHudSearch = (q) => {
        fleetFilterState.searchQuery = String(q || '');
        updateFleetHudListOnly();
    };

    window.focusOpsFleetDriverOnMap = (uid) => {
        if (!uid) return;
        const data = latestDriverDocs.get(uid);
        const profile = resolveDriverProfile(uid, data || {});
        // Si el conductor está inactivo y el filtro estaba en "online", pintarlo o mover el mapa a sus coordenadas
        const lat = Number(data?.lat);
        const lng = Number(data?.lng);
        if (window.gMap && Number.isFinite(lat) && Number.isFinite(lng)) {
            try {
                window.gMap.panTo({ lat, lng });
                if (typeof window.gMap.getZoom === 'function' && window.gMap.getZoom() < 15) {
                    window.gMap.setZoom(16);
                }
            } catch (_) {}
        }
        fleetFilterState.popoverOpen = false;
        renderFleetMapHud();
        const fn = window.openStaffFleetDriverPanel || window.showStaffDriverFinanceMapSheet;
        if (typeof fn === 'function') {
            fn(uid, profile?.name || data?.name || 'Conductor');
        }
    };

    window.openStaffDriversByVehicleDirectory = () => {
        fleetFilterState.popoverOpen = false;
        renderFleetMapHud();
        const isSup = window.userProfile?.role === 'supervisor' && !window.isAdminUser?.(window.currentUser, window.userProfile);
        if (isSup) {
            const supPanel = document.getElementById('supervisor-panel');
            if (supPanel) supPanel.classList.remove('hidden');
            window.loadActiveDrivers?.(true);
            return;
        }
        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.classList.remove('hidden');
        window.renderAdminTab?.('driver');
    };

    window.forceUpdateTestDriverPosition = (driverId, lat, lng, name, vehicleType = 'auto', heading = 0) => {
        upsertFleetMarker(driverId, lat, lng, name, vehicleType, heading, null, { onTrip: true, isOnline: true });
        window.updateDriverMarker?.(driverId, lat, lng, false, {
            heading,
            vehicleType,
            name,
            forceReposition: true
        });
    };
}
