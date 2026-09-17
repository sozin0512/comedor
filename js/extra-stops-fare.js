/** Recargo por paradas extra (archivo aparte para no chocar con caché vieja de service-types). */
export const EXTRA_STOP_ON_ROUTE_FEE = 15;
export const EXTRA_STOP_ON_ROUTE_MAX_KM = 1.8;

function extraStopLatLng(p) {
    if (!p) return null;
    const lat = Number(p.lat ?? p.latLng?.lat);
    const lng = Number(p.lng ?? p.latLng?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

function extraStopDistKm(a, b) {
    if (!a || !b) return 0;
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2
        + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function extraStopsSurcharge(origin, dest, stops = [], perKm = 22) {
    const o = extraStopLatLng(origin);
    const d = extraStopLatLng(dest);
    const list = (Array.isArray(stops) ? stops : []).map(extraStopLatLng).filter(Boolean);
    if (!o || !d || !list.length) {
        return { extra: 0, onRoute: 0, offRouteKm: 0 };
    }
    const ab = extraStopDistKm(o, d);
    const rate = Math.max(0, Number(perKm) || 22);
    let extra = 0;
    let onRoute = 0;
    let offRouteKm = 0;
    for (const s of list) {
        const detourRoad = Math.max(0, (extraStopDistKm(o, s) + extraStopDistKm(s, d) - ab) * 1.3);
        if (detourRoad <= EXTRA_STOP_ON_ROUTE_MAX_KM) {
            extra += EXTRA_STOP_ON_ROUTE_FEE;
            onRoute += 1;
        } else {
            offRouteKm += detourRoad;
            extra += Math.max(EXTRA_STOP_ON_ROUTE_FEE, Math.round(detourRoad * rate * 100) / 100);
        }
    }
    return {
        extra: Math.round(extra * 100) / 100,
        onRoute,
        offRouteKm: Math.round(offRouteKm * 10) / 10
    };
}
