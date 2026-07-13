/**
 * Mapa de flota para admin/supervisor — conductores vía drivers_location.
 * Muestra posición en vivo o última conocida: en línea, en viaje, segundo plano o app cerrada.
 */
import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { isDriverOnline } from './zones.js';

const TRIP_TRACK_FRESH_MS = 900000; // 15 min — GPS reciente

let unsub = null;
let tripsUnsub = null;
let fleetLiveTimer = null;
let renderTimer = null;
let lastSnap = null;
const markers = {};
const markerMeta = {};
const activeTripDrivers = new Map();

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

function resolveDriverProfile(uid, data = {}) {
    const user = (window.allUsersData || []).find((u) => u.uid === uid) || {};
    const approvalStatus = user.approvalStatus || data.approvalStatus;
    if (approvalStatus && approvalStatus !== 'approved') return null;
    if (user.role && user.role !== 'driver') return null;

    const driverName = (user.name || data.name || '').toString().trim();
    if (!driverName || driverName.toLowerCase() === 'conductor' || /sin.?nombre/i.test(driverName)) {
        return null;
    }

    return {
        name: driverName,
        phone: data.phone || user.phone || null
    };
}

function shouldShowFleetDriver(uid, data) {
    if (data?.lat == null || data?.lng == null) return false;

    // Admin/sup: cualquier conductor aprobado con posición en Firebase
    // (en línea, en viaje, segundo plano, app cerrada = última posición conocida)
    if (resolveDriverProfile(uid, data)) return true;

    // Perfil aún no cargado en allUsersData: confiar en drivers_location
    const name = (data.name || '').toString().trim();
    if (!name || name.toLowerCase() === 'conductor' || /sin.?nombre/i.test(name)) return false;
    if (data.approvalStatus && data.approvalStatus !== 'approved') return false;
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

function getFleetPhaseStyle(phase) {
    if (phase === 'in_progress') {
        return {
            phase: 'in_progress',
            color: '#dc2626',
            glow: '0 0 8px rgba(220, 38, 38, 0.9), 0 0 14px rgba(239, 68, 68, 0.45)',
            label: 'Hacia destino final'
        };
    }
    if (phase === 'at_pickup') {
        return {
            phase: 'at_pickup',
            color: '#8b5cf6',
            glow: '0 0 8px rgba(139, 92, 246, 0.95), 0 0 14px rgba(167, 139, 250, 0.5)',
            label: 'En origen · esperando PIN'
        };
    }
    if (phase === 'to_pickup') {
        return {
            phase: 'to_pickup',
            color: '#10b981',
            glow: '0 0 8px rgba(16, 185, 129, 0.9), 0 0 14px rgba(52, 211, 153, 0.45)',
            label: 'En camino al pasajero'
        };
    }
    return null;
}

function buildMarkerTitle(profile, data, uid) {
    let title = `Conductor: ${profile.name}`;
    if (window.canViewOpsFleetMap?.() && profile.phone) {
        title += ` • ${profile.phone}`;
    }
    const trip = activeTripDrivers.get(uid);
    if (trip) {
        const phase = getFleetTripPhase(trip);
        const style = getFleetPhaseStyle(phase);
        title += ` • ${style?.label || 'En viaje'}`;
    } else if (isDriverOnline(data)) {
        title += ' • En línea';
    } else if (isFreshGps(data)) {
        title += ' • Tracking reciente';
    } else if (data?.appVisible === false) {
        title += ' • App en segundo plano';
    } else {
        title += ' • Última posición';
    }
    return title;
}

function resolveFleetVehicleColor(vehicleType = 'auto', phase = null) {
    const phaseStyle = getFleetPhaseStyle(phase);
    if (phaseStyle) return phaseStyle.color;
    const type = vehicleType || 'auto';
    if (type === 'moto') return '#8b5cf6';
    if (type === 'taxi' || type === 'taxi_vip' || type === 'vip') return '#facc15';
    if (type === 'paila') return '#10b981';
    if (type === 'camion') return '#64748b';
    return '#3b82f6';
}

/** Inyecta CSS del humo una sola vez (partículas detrás del vehículo). */
function ensureFleetSmokeStyles() {
    if (document.getElementById('fleet-smoke-styles')) return;
    const style = document.createElement('style');
    style.id = 'fleet-smoke-styles';
    style.textContent = `
      .fleet-marker-root {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        overflow: visible;
      }
      .fleet-marker-root img {
        position: relative;
        z-index: 2;
        display: block;
        object-fit: contain;
      }
      /* Humo sale de la parte trasera del vehículo (local -Y al rotar con heading) */
      .fleet-smoke {
        position: absolute;
        left: 50%;
        top: 55%;
        width: 0;
        height: 0;
        z-index: 1;
        transform: translate(-50%, 0);
        pointer-events: none;
      }
      .fleet-smoke span {
        position: absolute;
        left: 0;
        top: 0;
        width: 10px;
        height: 10px;
        margin-left: -5px;
        margin-top: -5px;
        border-radius: 50%;
        opacity: 0;
        background: radial-gradient(circle, var(--smoke-color, #94a3b8) 0%, transparent 70%);
        box-shadow: 0 0 6px var(--smoke-color, #94a3b8);
        animation: fleet-smoke-puff 1.35s ease-out infinite;
      }
      .fleet-smoke span:nth-child(1) { animation-delay: 0s; }
      .fleet-smoke span:nth-child(2) { animation-delay: 0.35s; width: 12px; height: 12px; margin-left: -6px; margin-top: -6px; }
      .fleet-smoke span:nth-child(3) { animation-delay: 0.7s; width: 14px; height: 14px; margin-left: -7px; margin-top: -7px; }
      .fleet-smoke span:nth-child(4) { animation-delay: 1.05s; width: 11px; height: 11px; margin-left: -5.5px; margin-top: -5.5px; }
      @keyframes fleet-smoke-puff {
        0% {
          transform: translate(0, 0) scale(0.35);
          opacity: 0.85;
        }
        55% {
          opacity: 0.45;
        }
        100% {
          transform: translate(var(--sx, -6px), var(--sy, 22px)) scale(1.65);
          opacity: 0;
        }
      }
      .fleet-smoke--to_pickup { --smoke-color: #10b981; }
      .fleet-smoke--at_pickup { --smoke-color: #8b5cf6; }
      .fleet-smoke--in_progress { --smoke-color: #ef4444; }
      .fleet-smoke--idle { --smoke-color: #60a5fa; }
      .fleet-smoke--to_pickup span:nth-child(2) { --sx: 4px; --sy: 26px; }
      .fleet-smoke--to_pickup span:nth-child(3) { --sx: -10px; --sy: 28px; }
      .fleet-smoke--to_pickup span:nth-child(4) { --sx: 8px; --sy: 20px; }
      .fleet-smoke--at_pickup span:nth-child(2) { --sx: 5px; --sy: 24px; }
      .fleet-smoke--at_pickup span:nth-child(3) { --sx: -9px; --sy: 30px; }
      .fleet-smoke--at_pickup span:nth-child(4) { --sx: 7px; --sy: 18px; }
      .fleet-smoke--in_progress span:nth-child(2) { --sx: 6px; --sy: 28px; }
      .fleet-smoke--in_progress span:nth-child(3) { --sx: -12px; --sy: 32px; }
      .fleet-smoke--in_progress span:nth-child(4) { --sx: 10px; --sy: 22px; }
    `;
    document.head.appendChild(style);
}

function buildCarMarkerContent(vehicleType = 'auto', heading = 0, onTrip = false, phase = null) {
    ensureFleetSmokeStyles();
    const type = vehicleType || 'auto';
    const phaseStyle = getFleetPhaseStyle(phase);
    const active = onTrip || !!phaseStyle;
    const smokePhase = phase || (onTrip ? 'to_pickup' : 'idle');

    const wrap = document.createElement('div');
    wrap.className = 'fleet-marker-root';
    wrap.style.width = active ? '56px' : '46px';
    wrap.style.height = active ? '64px' : '48px';
    wrap.style.transform = `rotate(${heading || 0}deg)`;
    wrap.style.transition = 'transform 0.15s linear';

    const iconColor = resolveFleetVehicleColor(type, phase);
    const iconUrl = (window.createVehicleIcon || function () {
        return 'data:image/svg+xml;base64,' + btoa('<svg width="40" height="26"><text x="20" y="18" font-size="20" text-anchor="middle">🚕</text></svg>');
    })(type, iconColor);

    // Humo de colores “saliendo” del vehículo (detrás al rotar con heading)
    const smoke = document.createElement('div');
    smoke.className = `fleet-smoke fleet-smoke--${smokePhase}`;
    smoke.setAttribute('aria-hidden', 'true');
    smoke.innerHTML = '<span></span><span></span><span></span><span></span>';

    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = '';
    img.style.width = active ? '42px' : '38px';
    img.style.height = active ? '30px' : '26px';

    wrap.appendChild(smoke);
    wrap.appendChild(img);
    return wrap;
}

function canUseAdvanced() {
    return window.canUseAdvancedMapMarkers?.() ?? false;
}

function removeFleetMarker(driverId) {
    const m = markers[driverId];
    if (!m) return;
    if (m.map !== undefined) m.map = null;
    else if (typeof m.setMap === 'function') m.setMap(null);
    delete markers[driverId];
    delete markerMeta[driverId];
}

function clearAllFleetMarkers() {
    Object.keys(markers).forEach(removeFleetMarker);
}

function upsertFleetMarker(driverId, lat, lng, name, vehicleType = 'auto', heading = 0, phone = null, options = {}) {
    if (!window.gMap || !window.mapLoaded) return;

    const latLng = toLatLng(lat, lng);
    if (!latLng) return;

    const phase = options.phase || getFleetTripPhase(options.tripMeta) || null;
    const onTrip = !!options.onTrip || !!phase;
    const title = options.title || (name ? `Conductor: ${name}` : 'Conductor verificado');
    const useAdvanced = canUseAdvanced();
    const styleKey = `${vehicleType}|${Math.round(heading || 0)}|${phase || (onTrip ? 'trip' : 'idle')}`;
    const prev = markerMeta[driverId];
    const forceMove = !!options.forceReposition || onTrip;
    const posChanged = forceMove
        || !prev
        || Math.hypot(Number(lat) - Number(prev.lat), Number(lng) - Number(prev.lng)) > 0.0000001;

    if (useAdvanced) {
        if (markers[driverId]) {
            const m = markers[driverId];
            if (posChanged) {
                if (m.position !== undefined) m.position = latLng;
                else if (typeof m.setPosition === 'function') m.setPosition(latLng);
            }
            m.title = title;
            m.zIndex = onTrip ? 28 : 20;
            if (m._lastStyleKey !== styleKey) {
                m.content = buildCarMarkerContent(vehicleType, heading || 0, onTrip, phase);
                m._lastStyleKey = styleKey;
            }
        } else {
            const m = new google.maps.marker.AdvancedMarkerElement({
                position: latLng,
                map: window.gMap,
                content: buildCarMarkerContent(vehicleType, heading || 0, onTrip, phase),
                title,
                zIndex: onTrip ? 28 : 20
            });
            m._lastStyleKey = styleKey;
            markers[driverId] = m;
            if (window.canViewOpsFleetMap?.() && !m._fleetClickBound) {
                m._fleetClickBound = true;
                m.addListener('gmp-click', () => {
                    window.openStaffFleetDriverPanel?.(driverId, name || title);
                });
            }
        }
        markerMeta[driverId] = { lat: Number(lat), lng: Number(lng), heading, onTrip, phase };
        return;
    }

    const iconColor = resolveFleetVehicleColor(vehicleType, phase);
    const iconUrl = (window.createVehicleIcon || defaultVehicleIcon)(vehicleType, iconColor);
    const icon = {
        url: iconUrl,
        scaledSize: new google.maps.Size(onTrip ? 40 : 36, onTrip ? 30 : 28),
        anchor: new google.maps.Point(onTrip ? 20 : 18, onTrip ? 15 : 14)
    };

    if (markers[driverId]) {
        const m = markers[driverId];
        if (typeof m.setPosition === 'function') {
            if (posChanged) m.setPosition(latLng);
            if (typeof m.setIcon === 'function') m.setIcon(icon);
            m.setTitle(title);
            m.setZIndex(onTrip ? 28 : 20);
        } else {
            removeFleetMarker(driverId);
            markers[driverId] = new google.maps.Marker({
                position: latLng,
                map: window.gMap,
                icon,
                title,
                zIndex: onTrip ? 28 : 20
            });
            if (window.canViewOpsFleetMap?.() && !markers[driverId]._fleetClickBound) {
                markers[driverId]._fleetClickBound = true;
                google.maps.event.addListener(markers[driverId], 'click', () => {
                    window.openStaffFleetDriverPanel?.(driverId, name || title);
                });
            }
        }
    } else {
        markers[driverId] = new google.maps.Marker({
            position: latLng,
            map: window.gMap,
            icon,
            title,
            zIndex: onTrip ? 28 : 20
        });
        if (window.canViewOpsFleetMap?.()) {
            markers[driverId]._fleetClickBound = true;
            google.maps.event.addListener(markers[driverId], 'click', () => {
                window.openStaffFleetDriverPanel?.(driverId, name || title);
            });
        }
    }
    markerMeta[driverId] = { lat: Number(lat), lng: Number(lng), heading, onTrip, phase };
}

function defaultVehicleIcon(type, color) {
    return 'data:image/svg+xml;base64,' + btoa(`<svg width="40" height="26" viewBox="0 0 40 26" fill="${color}"><rect x="2" y="6" width="36" height="14" rx="3"/><circle cx="10" cy="20" r="4"/><circle cx="30" cy="20" r="4"/></svg>`);
}

function fleetDriverProfile(uid, data) {
    return resolveDriverProfile(uid, data) || {
        name: (data.name || 'Conductor').toString().trim(),
        phone: data.phone || null
    };
}

function paintFleetDriver(uid, data) {
    if (!shouldShowFleetDriver(uid, data)) {
        removeFleetMarker(uid);
        return;
    }
    const profile = fleetDriverProfile(uid, data);
    const tripMeta = activeTripDrivers.get(uid) || null;
    const phase = getFleetTripPhase(tripMeta);
    const onTrip = !!tripMeta;
    upsertFleetMarker(
        uid,
        data.lat,
        data.lng,
        profile.name,
        data.vehicleType || 'auto',
        data.heading || 0,
        profile.phone,
        {
            onTrip,
            phase,
            tripMeta,
            forceReposition: true,
            title: buildMarkerTitle(profile, data, uid)
        }
    );
}

/**
 * Si el conductor está en viaje pero su drivers_location no trae lat/lng
 * (GPS apagado, permiso, app en background), igual lo mostramos en el mapa
 * con la posición del viaje (origen o destino) para que admin/sup no “pierdan” la flota.
 */
function paintActiveTripFallbacks(visibleIds) {
    activeTripDrivers.forEach((meta, driverId) => {
        if (!driverId || visibleIds.has(driverId)) return;
        const trip = meta.trip || {};
        let lat = null;
        let lng = null;
        let approxLabel = 'posición aprox.';

        if (meta.status === 'in_progress' && trip.destinationLat != null && trip.destinationLng != null) {
            // En ruta: si no hay GPS, anclar cerca del destino como referencia débil
            lat = Number(trip.destinationLat);
            lng = Number(trip.destinationLng);
            approxLabel = 'SIN GPS · ref. destino';
        }
        if ((lat == null || lng == null) && trip.originLat != null && trip.originLng != null) {
            lat = Number(trip.originLat);
            lng = Number(trip.originLng);
            approxLabel = meta.status === 'accepted' && meta.driverArrived
                ? 'SIN GPS · en origen (viaje)'
                : 'SIN GPS · ref. recogida';
        }
        if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const user = (window.allUsersData || []).find((x) => x.uid === driverId) || {};
        const name = (user.name || trip.driverName || 'Conductor').toString().trim();
        const phone = user.phone || trip.driverPhone || null;
        const phase = getFleetTripPhase(meta);
        const title = `Conductor: ${name} • ${approxLabel}${phone ? ` • ${phone}` : ''}`;

        upsertFleetMarker(
            driverId,
            lat,
            lng,
            name,
            trip.driverVehicleType || user.vehicleType || 'auto',
            0,
            phone,
            {
                onTrip: true,
                phase,
                tripMeta: meta,
                forceReposition: true,
                title
            }
        );
        visibleIds.add(driverId);
    });
}

export function renderOpsFleetMap(snap) {
    if (!window.gMap || !window.mapLoaded) return;
    if (!viewerCanSeeFleet()) {
        clearAllFleetMarkers();
        return;
    }

    const visibleIds = new Set();

    snap?.forEach?.((docSnap) => {
        const data = docSnap.data();
        const uid = docSnap.id;
        if (!shouldShowFleetDriver(uid, data)) return;
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
        if (isOnActiveTrip(id)) return;

        const u = (window.allUsersData || []).find((x) => x.uid === id) || {};
        const st = u.approvalStatus || null;
        const nm = (u.name || '').toString().trim().toLowerCase();
        const badRole = u.role && u.role !== 'driver';
        const isGoodApproved = (st === 'approved') && !badRole && nm && nm !== 'conductor' && !/sin.?nombre/.test(nm);

        if (!isGoodApproved) removeFleetMarker(id);
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
            if (!isOnActiveTrip(uid)) removeFleetMarker(uid);
            return;
        }

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
            // Datos completos para panel de mapa (precio, teléfonos, ruta, chat)
            trip: { id: docSnap.id, ...data }
        });
    });
    if (lastSnap) renderOpsFleetMap(lastSnap);
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

    // Repinta toda la flota (con o sin viaje activo) para movimiento fluido en admin/sup
    fleetLiveTimer = setInterval(() => {
        if (!lastSnap || !viewerCanSeeFleet()) return;
        renderOpsFleetMap(lastSnap);
    }, 1800);
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
    activeTripDrivers.clear();
    clearAllFleetMarkers();
}

export function refreshOpsFleetMapFromCache() {
    if (lastSnap) {
        renderOpsFleetMap(lastSnap);
        return;
    }
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
            return;
        }
    });
}

export function pruneGhostFleetMarkers() {
    if (!viewerCanSeeFleet()) return;

    Object.keys(markers).forEach((id) => {
        if (isOnActiveTrip(id)) return;
        const u = (window.allUsersData || []).find((x) => x.uid === id) || {};
        const st = u.approvalStatus || null;
        const nm = (u.name || '').toString().trim().toLowerCase();
        const badRole = u.role && u.role !== 'driver';
        const isGood = (st === 'approved') && !badRole && nm && nm !== 'conductor' && !/sin.?nombre/.test(nm);
        if (!isGood) removeFleetMarker(id);
    });

    if (window.driverMarkers && typeof window.removeDriverMarker === 'function') {
        Object.keys(window.driverMarkers).forEach((id) => {
            const u = (window.allUsersData || []).find((x) => x.uid === id) || {};
            const st = u.approvalStatus || null;
            const nm = (u.name || '').toString().trim().toLowerCase();
            const badRole = u.role && u.role !== 'driver';
            const isGood = (st === 'approved') && !badRole && nm && nm !== 'conductor' && !/sin.?nombre/.test(nm);
            const isSelf = id === (window.currentUser?.uid || window.userProfile?.uid);
            if (!isGood && !isSelf) {
                try { window.removeDriverMarker(id); } catch (_) {}
            }
        });
    }
}

window.forceUpdateTestDriverPosition = (driverId, lat, lng, name, vehicleType = 'auto', heading = 0) => {
    upsertFleetMarker(driverId, lat, lng, name, vehicleType, heading, null, { onTrip: true });
    window.updateDriverMarker?.(driverId, lat, lng, false, {
        heading,
        vehicleType,
        name,
        forceReposition: true
    });
};