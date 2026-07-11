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

function buildMarkerTitle(profile, data, uid) {
    let title = `Conductor: ${profile.name}`;
    if (window.canViewOpsFleetMap?.() && profile.phone) {
        title += ` • ${profile.phone}`;
    }
    const trip = activeTripDrivers.get(uid);
    if (trip) {
        const tripLabel = trip.status === 'in_progress' ? 'En curso' : 'Hacia pickup';
        title += ` • Viaje ${tripLabel}`;
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

function buildCarMarkerContent(vehicleType = 'auto', heading = 0, onTrip = false) {
    const type = vehicleType || 'auto';
    const wrap = document.createElement('div');
    wrap.style.width = onTrip ? '46px' : '42px';
    wrap.style.height = onTrip ? '38px' : '34px';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.transform = `rotate(${heading}deg)`;
    wrap.style.transition = 'transform 0.15s linear';
    if (onTrip) {
        wrap.style.filter = 'drop-shadow(0 0 6px rgba(220, 38, 38, 0.75))';
    }

    let iconColor = '#10b981';
    if (type === 'moto') iconColor = '#8b5cf6';
    else if (type === 'taxi' || type === 'taxi_vip' || type === 'vip') iconColor = '#facc15';
    else if (type === 'paila') iconColor = '#10b981';
    else if (type === 'camion') iconColor = '#64748b';
    else iconColor = '#3b82f6';

    const iconUrl = (window.createVehicleIcon || function () {
        return 'data:image/svg+xml;base64,' + btoa('<svg width="40" height="26"><text x="20" y="18" font-size="20" text-anchor="middle">🚕</text></svg>');
    })(type, iconColor);
    wrap.innerHTML = `<img src="${iconUrl}" style="width:40px; height:28px; object-fit:contain;" />`;
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

    const onTrip = !!options.onTrip;
    const title = options.title || (name ? `Conductor: ${name}` : 'Conductor verificado');
    const useAdvanced = canUseAdvanced();
    const styleKey = `${vehicleType}|${Math.round(heading || 0)}|${onTrip ? 1 : 0}`;
    const prev = markerMeta[driverId];
    const forceMove = !!options.forceReposition || !!options.onTrip;
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
                m.content = buildCarMarkerContent(vehicleType, heading || 0, onTrip);
                m._lastStyleKey = styleKey;
            }
        } else {
            const m = new google.maps.marker.AdvancedMarkerElement({
                position: latLng,
                map: window.gMap,
                content: buildCarMarkerContent(vehicleType, heading || 0, onTrip),
                title,
                zIndex: onTrip ? 28 : 20
            });
            m._lastStyleKey = styleKey;
            markers[driverId] = m;
            if (window.canViewOpsFleetMap?.()) {
                m.addListener('gmp-click', () => {
                    window.showDriverFullDetails?.(driverId, name || title);
                });
            }
        }
        markerMeta[driverId] = { lat: Number(lat), lng: Number(lng), heading, onTrip };
        return;
    }

    const iconColor = getFleetIconColor(vehicleType);
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
            if (window.canViewOpsFleetMap?.()) {
                google.maps.event.addListener(markers[driverId], 'click', () => {
                    window.showDriverFullDetails?.(driverId, name || title);
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
            google.maps.event.addListener(markers[driverId], 'click', () => {
                window.showDriverFullDetails?.(driverId, name || title);
            });
        }
    }
    markerMeta[driverId] = { lat: Number(lat), lng: Number(lng), heading, onTrip };
}

function getFleetIconColor(vehicleType = 'auto') {
    const type = vehicleType || 'auto';
    if (type === 'moto') return '#8b5cf6';
    if (type === 'taxi' || type === 'taxi_vip' || type === 'vip') return '#facc15';
    if (type === 'paila') return '#10b981';
    if (type === 'camion') return '#64748b';
    return '#3b82f6';
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
    const onTrip = isOnActiveTrip(uid);
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
            forceReposition: true,
            title: buildMarkerTitle(profile, data, uid)
        }
    );
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
        const data = docSnap.data();
        if (!data?.driverId) return;
        activeTripDrivers.set(data.driverId, {
            tripId: docSnap.id,
            status: data.status
        });
    });
    if (lastSnap) renderOpsFleetMap(lastSnap);
    syncFleetLiveRepaint();
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