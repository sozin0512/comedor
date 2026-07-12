/**
 * Zonas de alta demanda del día — mapa para conductores (rojo + $ animados).
 * Se activan desde 3 pedidos en la misma zona; el rojo sube gradualmente.
 */
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { tripMatchesZone } from './zones.js';

const CELL_SIZE = 0.007;
const DEMAND_STATUSES = new Set(['pending', 'accepted', 'in_progress', 'completed', 'scheduled']);
const MAX_HOT_ZONES = 18;
const MIN_COUNT_TO_SHOW = 3;

let dbRef = null;
let appIdRef = null;
let getZoneIdFn = null;
let getRadiusKmFn = null;
let unsub = null;
let renderTimer = null;
let lastSnap = null;

const circles = [];
const markers = [];

function getHondurasTodayRange() {
    const dayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Tegucigalpa',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
    const start = new Date(`${dayKey}T00:00:00-06:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

function tripCreatedToday(trip) {
    const ts = trip?.createdAt;
    if (!ts) return false;
    let d = null;
    if (typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    if (!d || Number.isNaN(d.getTime())) return false;
    const { start, end } = getHondurasTodayRange();
    return d >= start && d < end;
}

function cellKey(lat, lng) {
    const latCell = Math.floor(lat / CELL_SIZE);
    const lngCell = Math.floor(lng / CELL_SIZE);
    return `${latCell}:${lngCell}`;
}

function cellCenter(key) {
    const [latCell, lngCell] = key.split(':').map(Number);
    return {
        lat: (latCell + 0.5) * CELL_SIZE,
        lng: (lngCell + 0.5) * CELL_SIZE
    };
}

/** Rojo gradual según pedidos reales en la zona (mínimo 3 para aparecer). */
function intensityTierFromCount(count) {
    if (count >= 12) return 4;
    if (count >= 8) return 3;
    if (count >= 5) return 2;
    if (count >= 3) return 1;
    return 0;
}

function dollarCountFromTrips(count) {
    if (count >= 12) return 4;
    if (count >= 8) return 3;
    if (count >= 5) return 2;
    return 1;
}

function heatStyle(tier) {
    const styles = {
        1: { fill: '#fecaca', stroke: '#f87171', fillOpacity: 0.24, strokeOpacity: 0.5, radius: 360 },
        2: { fill: '#fca5a5', stroke: '#ef4444', fillOpacity: 0.34, strokeOpacity: 0.6, radius: 440 },
        3: { fill: '#f87171', stroke: '#dc2626', fillOpacity: 0.44, strokeOpacity: 0.72, radius: 520 },
        4: { fill: '#ef4444', stroke: '#b91c1c', fillOpacity: 0.55, strokeOpacity: 0.85, radius: 600 }
    };
    return styles[tier] || styles[1];
}

function clearLayers() {
    circles.forEach((c) => c.setMap(null));
    markers.forEach((m) => {
        if (m.map !== undefined) m.map = null;
        else if (typeof m.setMap === 'function') m.setMap(null);
    });
    circles.length = 0;
    markers.length = 0;
}

function buildDollarMarkerContent(count, tier) {
    const wrap = document.createElement('div');
    wrap.className = `demand-hotspot demand-hotspot-tier-${tier}`;
    wrap.setAttribute('aria-hidden', 'true');
    const n = dollarCountFromTrips(count);
    for (let i = 0; i < n; i += 1) {
        const span = document.createElement('span');
        span.className = 'demand-dollar-float';
        span.textContent = '$';
        span.style.animationDelay = `${i * 0.45}s`;
        wrap.appendChild(span);
    }
    const badge = document.createElement('span');
    badge.className = 'demand-hotspot-count';
    badge.textContent = String(count);
    wrap.appendChild(badge);
    return wrap;
}

function placeHotspot(center, count, tier) {
    if (!window.gMap || !window.mapLoaded || !tier) return;
    if (typeof google === 'undefined' || !google?.maps) return;
    const style = heatStyle(tier);

    const circle = new google.maps.Circle({
        map: window.gMap,
        center,
        radius: style.radius,
        fillColor: style.fill,
        fillOpacity: style.fillOpacity,
        strokeColor: style.stroke,
        strokeOpacity: style.strokeOpacity,
        strokeWeight: 2,
        clickable: false,
        zIndex: 2
    });
    circles.push(circle);

    const content = buildDollarMarkerContent(count, tier);
    const pos = { lat: center.lat, lng: center.lng };

    const canAdvanced = typeof window.canUseAdvancedMapMarkers === 'function' && window.canUseAdvancedMapMarkers();
    if (canAdvanced) {
        const marker = new google.maps.marker.AdvancedMarkerElement({
            map: window.gMap,
            position: pos,
            content,
            zIndex: 12 + tier,
            gmpClickable: false
        });
        markers.push(marker);
        return;
    }

    // Always prefer AdvancedMarkerElement to avoid classic Marker deprecation.
    // Even without mapId it works for basic content + position.
    // Fallback: use AdvancedMarkerElement directly (avoids classic Marker deprecation).
    // This branch runs when canUseAdvancedMapMarkers() returned false (e.g. no mapId),
    // but AdvancedMarkerElement is still available for basic use.
    if (google.maps?.marker?.AdvancedMarkerElement) {
        const el = document.createElement('div');
        el.textContent = '$'.repeat(Math.min(3, dollarCountFromTrips(count)));
        el.style.color = '#b91c1c';
        el.style.fontWeight = '900';
        el.style.fontSize = '14px';
        const marker = new google.maps.marker.AdvancedMarkerElement({
            map: window.gMap,
            position: pos,
            content: el,
            zIndex: 12 + tier,
            gmpClickable: false
        });
        markers.push(marker);
        return;
    }

    // Ultimate fallback: no AdvancedMarkerElement at all → we only have the Circle (no label marker).
}

function aggregateDemandCells(snap) {
    const zoneId = getZoneIdFn?.();
    const radiusKm = getRadiusKmFn?.() ?? 25;
    const buckets = new Map();

    snap?.forEach?.((docSnap) => {
        const trip = { id: docSnap.id, ...docSnap.data() };
        if (!DEMAND_STATUSES.has(trip.status)) return;
        if (!tripCreatedToday(trip)) return;
        if (!tripMatchesZone(trip, zoneId, radiusKm)) return;
        if (trip.originLat == null || trip.originLng == null) return;

        const key = cellKey(trip.originLat, trip.originLng);
        const prev = buckets.get(key) || { count: 0, totalPrice: 0 };
        prev.count += 1;
        prev.totalPrice += Number(trip.priceNum) || 0;
        buckets.set(key, prev);
    });

    return buckets;
}

function updateLegend(topCount, zoneCount) {
    const legend = document.getElementById('demand-heatmap-legend');
    const text = document.getElementById('demand-heatmap-legend-text');
    if (!legend || !text) return;

    if (!zoneCount) {
        legend.classList.add('hidden');
        window.syncMapLocationChipVisibility?.();
        return;
    }

    legend.classList.remove('hidden');
    window.syncMapLocationChipVisibility?.();
    text.textContent = zoneCount === 1
        ? `1 zona caliente (3+ pedidos) · pico ${topCount}`
        : `${zoneCount} zonas calientes (3+ pedidos) · pico ${topCount}`;
}

function viewerCanSeeDemandHeatmap() {
    if (typeof window.canViewDemandHeatmap === 'function') {
        return window.canViewDemandHeatmap();
    }
    return window.userProfile?.role === 'driver';
}

export function renderDemandHeatmap(snap) {
    if (!window.gMap || !window.mapLoaded) return;
    if (!viewerCanSeeDemandHeatmap()) {
        clearLayers();
        updateLegend(0, 0);
        return;
    }

    const buckets = aggregateDemandCells(snap);
    clearLayers();

    if (!buckets.size) {
        updateLegend(0, 0);
        return;
    }

    const ranked = [...buckets.entries()]
        .filter(([, data]) => data.count >= MIN_COUNT_TO_SHOW)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, MAX_HOT_ZONES);

    if (!ranked.length) {
        updateLegend(0, 0);
        return;
    }

    const maxCount = ranked[0]?.[1]?.count || MIN_COUNT_TO_SHOW;
    ranked.forEach(([key, data]) => {
        const tier = intensityTierFromCount(data.count);
        placeHotspot(cellCenter(key), data.count, tier);
    });

    updateLegend(maxCount, ranked.length);
}

function scheduleRender(snap) {
    lastSnap = snap;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
        renderDemandHeatmap(lastSnap);
        renderTimer = null;
    }, 350);
}

export function startDemandHeatmapListener(db, appId, getZoneId, getRadiusKm) {
    stopDemandHeatmapListener();
    if (!viewerCanSeeDemandHeatmap()) return;

    dbRef = db;
    appIdRef = appId;
    getZoneIdFn = getZoneId;
    getRadiusKmFn = getRadiusKm;

    if (!db || !appId) return;

    unsub = onSnapshot(
        collection(db, 'artifacts', appId, 'public', 'data', 'trips'),
        (snap) => scheduleRender(snap),
        () => {}
    );

    document.getElementById('demand-heatmap-legend')?.classList.remove('hidden');
    window.syncMapLocationChipVisibility?.();
}

export function stopDemandHeatmapListener() {
    if (unsub) {
        unsub();
        unsub = null;
    }
    if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
    }
    lastSnap = null;
    clearLayers();
    updateLegend(0, 0);
    document.getElementById('demand-heatmap-legend')?.classList.add('hidden');
    window.syncMapLocationChipVisibility?.();
}

export function refreshDemandHeatmapFromCache() {
    if (lastSnap) scheduleRender(lastSnap);
}