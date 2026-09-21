/** Runtime conductor: llegada a origen/destino. Se carga tras el login de conductor. */
export function installDriverRuntime() {
    if (window.__hrDriverRuntime) return;
    window.__hrDriverRuntime = true;

// ==================== LLEGADA AL ORIGEN (1 km) / DESTINO (1 km) — CONDUCTOR → PASAJERO ====================
const TRIP_PICKUP_ARRIVAL_RADIUS_M = 1000;
const TRIP_DEST_CONFIRM_RADIUS_M = 1000;
/** Si la distancia real es menor que la suma de precisiones GPS, se considera “mismo punto”. */
const GPS_COLOCATED_PAD_M = 18;

/** Opciones GPS de alta precisión (viaje activo / llegada). */
window.getHighAccuracyGeoOptions = (opts = {}) => {
    const liveTrip = opts.liveTrip === true
        || document.body.classList.contains('trip-active')
        || document.body.classList.contains('is-navigating');
    // En viaje siempre precisión alta; maximumAge bajo evita coords viejas de “una cuadra”
    return {
        enableHighAccuracy: true,
        maximumAge: liveTrip ? (opts.maximumAge ?? 800) : (opts.maximumAge ?? 2500),
        timeout: opts.timeout ?? (liveTrip ? 15000 : 12000)
    };
};

/**
 * Distancia en metros considerando el error de GPS de ambos.
 * Si cae dentro del radio de precisión, devuelve 0 (mismo punto).
 */
window.getAccuracyAwareDistanceMeters = (from, to, fromAcc = null, toAcc = null) => {
    const raw = window.getDistanceMetersBetween?.(from, to);
    if (!Number.isFinite(raw)) return Infinity;
    const a = Number.isFinite(Number(fromAcc)) ? Number(fromAcc) : (window._driverLiveAccuracy ?? 0);
    const b = Number.isFinite(Number(toAcc)) ? Number(toAcc) : 0;
    // Limitar radioses absurdas del GPS (a veces reporta 500–2000 m)
    const accSum = Math.min(120, Math.max(0, a) + Math.max(0, b)) + GPS_COLOCATED_PAD_M;
    if (raw <= accSum) return 0;
    return Math.max(0, raw - Math.min(accSum * 0.35, 25));
};

window.getTripPickupCoords = (trip) => {
    const t = trip || window.activeTrip || window.currentActiveTripData;
    if (!t) return null;
    // Preferir GPS en vivo del pasajero (más preciso que el pin del pedido)
    const liveAge = t.clientLiveUpdatedAt != null ? (Date.now() - Number(t.clientLiveUpdatedAt)) : Infinity;
    if (
        t.clientLiveLat != null
        && t.clientLiveLng != null
        && Number.isFinite(Number(t.clientLiveLat))
        && Number.isFinite(Number(t.clientLiveLng))
        && liveAge < 45000
    ) {
        return {
            lat: Number(t.clientLiveLat),
            lng: Number(t.clientLiveLng),
            accuracy: t.clientLiveAccuracy != null ? Number(t.clientLiveAccuracy) : null,
            source: 'client_live'
        };
    }
    if (t.originLat != null && t.originLng != null) {
        return {
            lat: Number(t.originLat),
            lng: Number(t.originLng),
            accuracy: t.originAccuracy != null ? Number(t.originAccuracy) : null,
            source: t.originSource || 'origin'
        };
    }
    return null;
};

window.getTripRouteChain = (trip) => {
    const t = trip || window.activeTrip || window.currentActiveTripData;
    if (!t) return [];
    const origin = {
        address: t.origin,
        latLng: t.originLat != null ? { lat: t.originLat, lng: t.originLng } : null,
    };
    const destination = {
        address: t.destination,
        latLng: t.destinationLat != null ? { lat: t.destinationLat, lng: t.destinationLng } : null,
    };
    return window.buildOrderedRoutePoints?.(origin, destination, t.additionalStops || []) || [];
};

window.getTripCurrentLegIndex = (trip) => {
    const chain = window.getTripRouteChain(trip);
    if (chain.length < 2) return 1;
    const raw = Number(trip?.routeLegIndex);
    const idx = Number.isFinite(raw) && raw >= 1 ? raw : 1;
    return Math.min(idx, chain.length - 1);
};

window.getTripCurrentLegPoint = (trip) => {
    const chain = window.getTripRouteChain(trip);
    const idx = window.getTripCurrentLegIndex(trip);
    return chain[idx] || null;
};

window.getTripCurrentLegNavTarget = (trip) => {
    const point = window.getTripCurrentLegPoint(trip);
    if (!point) return null;
    if (point.latLng?.lat != null && point.latLng?.lng != null) {
        return { lat: point.latLng.lat, lng: point.latLng.lng, address: point.address || '' };
    }
    return point.address || null;
};

window.isTripAtFinalRouteLeg = (trip) => {
    const chain = window.getTripRouteChain(trip);
    if (chain.length < 2) return true;
    return window.getTripCurrentLegIndex(trip) >= chain.length - 1;
};

window.getTripRouteLegLabel = (trip) => {
    const chain = window.getTripRouteChain(trip);
    const idx = window.getTripCurrentLegIndex(trip);
    const point = chain[idx];
    const isFinal = chain.length < 2 || idx >= chain.length - 1;
    return {
        index: idx,
        routeNum: point?.routeNum || idx + 1,
        totalPoints: chain.length,
        address: point?.address || '',
        isFinal,
        hasMultipleLegs: chain.length > 2,
    };
};

window.getTripDestinationCoords = (trip) => {
    const leg = window.getTripCurrentLegPoint(trip);
    if (leg?.latLng?.lat != null && leg?.latLng?.lng != null) {
        return { lat: leg.latLng.lat, lng: leg.latLng.lng };
    }
    const t = trip || window.activeTrip || window.currentActiveTripData;
    if (!t) return null;
    if (t.destinationLat != null && t.destinationLng != null) {
        return { lat: t.destinationLat, lng: t.destinationLng };
    }
    if (window.currentPassengerTrackDest?.lat != null) return window.currentPassengerTrackDest;
    return null;
};

window.getDistanceMetersBetween = (from, to) => {
    // Usar != null: en Honduras lng es negativo; !lng fallaría
    if (from?.lat == null || from?.lng == null || to?.lat == null || to?.lng == null) return Infinity;
    if (typeof window.getDistanceToNavPoint === 'function') {
        return window.getDistanceToNavPoint(from, to);
    }
    const dLat = (to.lat - from.lat) * 111000;
    const dLng = (to.lng - from.lng) * 111000 * Math.cos((from.lat || 0) * Math.PI / 180);
    return Math.hypot(dLat, dLng);
};

window.syncDriverPickupArrivalUi = (driverPos = null) => {
    const trip = window.activeTrip || window.currentActiveTripData;
    const float = document.getElementById('driver-arrived-float');
    const btn = document.getElementById('btn-driver-arrived');
    const panelBtn = document.getElementById('driver-panel-arrived-btn');
    const btns = [btn, panelBtn].filter(Boolean);
    if (!float && !panelBtn) return;

    const isDriver = window.userProfile?.role === 'driver';
    const pickupPhase = trip?.status === 'accepted'
        && !trip?.driverArrived
        && trip?.driverId === window.currentUser?.uid;

    if (!isDriver || !pickupPhase) {
        btns.forEach((el) => {
            el.classList.remove('is-disabled');
            el.removeAttribute('aria-disabled');
        });
        if (float) float.title = 'Toca para marcar llegada · arrastra para mover';
        return;
    }

    const pos = driverPos || window.currentDriverPos;
    const pickup = window.getTripPickupCoords(trip);
    const dist = pos && pickup
        ? window.getAccuracyAwareDistanceMeters(
            pos,
            pickup,
            window._driverLiveAccuracy ?? pos.accuracy,
            pickup.accuracy
        )
        : Infinity;
    const within = Number.isFinite(dist) && dist <= TRIP_PICKUP_ARRIVAL_RADIUS_M;

    btns.forEach((el) => {
        el.classList.toggle('is-disabled', !within);
        el.setAttribute('aria-disabled', within ? 'false' : 'true');
    });

    if (!pickup) {
        if (float) float.title = 'Ubicando punto de recogida…';
    } else if (!pos) {
        if (float) float.title = 'Obteniendo GPS… botón activo a ≤ 1 km del pasajero';
    } else if (within) {
        if (float) float.title = 'Toca para marcar llegada · arrastra para mover';
    } else {
        const distLabel = dist >= 1000
            ? `${(dist / 1000).toFixed(1)} km`
            : `${Math.round(dist)} m`;
        if (float) float.title = `A ${distLabel} del pasajero · botón activo a ≤ 1 km`;
    }
};

window.syncDriverDestinationArrivalUi = (driverPos = null) => {
    const trip = window.activeTrip || window.currentActiveTripData;
    // Pastilla flotante + botón de respaldo en el sheet (viaje iniciado)
    const panel = document.getElementById('driver-destination-controls');
    const float = document.getElementById('driver-arrived-dest-float');
    const btn = document.getElementById('btn-driver-arrived-dest');
    const panelDestBtn = document.getElementById('driver-panel-arrived-dest-btn');
    const hint = document.getElementById('driver-dest-distance-hint');
    panel?.classList.add('hidden');

    const isDriver = window.userProfile?.role === 'driver';
    const uid = window.currentUser?.uid || window.currentUser?.uid;
    const inProgress = trip?.status === 'in_progress' && trip?.driverId === uid;
    const destBtns = [btn, panelDestBtn].filter(Boolean);

    const resetDestBtns = () => {
        destBtns.forEach((el) => {
            el.classList.remove('is-disabled', 'is-arrival-blocked', 'opacity-60');
            el.removeAttribute('aria-disabled');
            el.dataset.blocked = '0';
            el.disabled = false;
            el.removeAttribute('disabled');
        });
    };

    if (!isDriver || !inProgress) {
        float?.classList.add('hidden');
        panelDestBtn?.classList.add('hidden');
        resetDestBtns();
        return;
    }

    float?.classList.remove('hidden');
    panelDestBtn?.classList.remove('hidden');
    if (!btn && !panelDestBtn) return;
    const pos = driverPos || window.currentDriverPos;
    const dest = window.getTripDestinationCoords(trip);
    const dist = pos && dest ? window.getDistanceMetersBetween(pos, dest) : Infinity;
    const within = Number.isFinite(dist) && dist <= TRIP_DEST_CONFIRM_RADIUS_M;
    const signaled = !!trip.driverArrivedDestination;

    const legLabel = window.getTripRouteLegLabel?.(trip) || { isFinal: true, routeNum: 2, hasMultipleLegs: false };
    const pointLabel = legLabel.isFinal ? 'destino' : `punto ${legLabel.routeNum}`;
    const destSpans = destBtns.map((el) => el.querySelector('span')).filter(Boolean);

    if (signaled) {
        destBtns.forEach((el) => {
            el.classList.add('is-disabled', 'is-arrival-blocked');
            el.classList.remove('opacity-60');
            el.setAttribute('aria-disabled', 'true');
            el.dataset.blocked = '1';
        });
        destSpans.forEach((span) => { span.textContent = 'FINALIZANDO…'; });
        if (float) float.title = 'Llegada registrada. Completando el viaje…';
        if (hint) hint.innerHTML = '✅ Llegada registrada. Completando el viaje…';
        return;
    }

    // Distancia en title (tooltip) + estado visual; sin disabled nativo (toques se pierden)
    let titleMsg = 'Toca al llegar al destino · arrastra para mover';
    if (!dest) {
        titleMsg = legLabel.isFinal ? 'Ubicando destino del viaje…' : 'Ubicando siguiente punto…';
    } else if (!pos) {
        titleMsg = 'Obteniendo GPS… botón activo a ≤ 1 km del destino';
    } else if (within) {
        titleMsg = `A ${Math.round(dist)} m del ${pointLabel}. Toca para confirmar · arrastra para mover`;
    } else {
        const radiusLabel = TRIP_DEST_CONFIRM_RADIUS_M >= 1000
            ? `${(TRIP_DEST_CONFIRM_RADIUS_M / 1000).toFixed(0)} km`
            : `${TRIP_DEST_CONFIRM_RADIUS_M} m`;
        const distLabel = dist >= 1000
            ? `${(dist / 1000).toFixed(1)} km`
            : `${Math.round(dist)} m`;
        titleMsg = `A ${distLabel} del ${pointLabel} · botón activo a ≤ ${radiusLabel}`;
    }
    if (float) float.title = titleMsg;
    if (panelDestBtn) panelDestBtn.title = titleMsg;
    if (hint) {
        if (!dest) {
            hint.textContent = legLabel.isFinal ? 'Ubicando destino del viaje…' : 'Ubicando siguiente punto…';
        } else if (!pos) {
            hint.textContent = 'Obteniendo tu ubicación GPS…';
        } else if (within) {
            hint.innerHTML = `✅ A <b>${Math.round(dist)} m</b> del ${pointLabel}. Ya puedes presionar el botón.`;
        } else {
            const radiusLabel = TRIP_DEST_CONFIRM_RADIUS_M >= 1000
                ? `${(TRIP_DEST_CONFIRM_RADIUS_M / 1000).toFixed(0)} km`
                : `${TRIP_DEST_CONFIRM_RADIUS_M} m`;
            const distLabel = dist >= 1000
                ? `${(dist / 1000).toFixed(1)} km`
                : `${Math.round(dist)} m`;
            hint.innerHTML = `A <b>${distLabel}</b> del ${pointLabel}. Botón activo a ≤ ${radiusLabel}.`;
        }
    }

    const blocked = !within || !dest || !pos;
    const destLabel = legLabel.isFinal
        ? 'LLEGUÉ AL DESTINO'
        : (legLabel.hasMultipleLegs ? `LLEGUÉ AL PUNTO ${legLabel.routeNum}` : 'LLEGUÉ AL DESTINO');
    destBtns.forEach((el) => {
        el.disabled = false;
        el.removeAttribute('disabled');
        el.dataset.blocked = blocked ? '1' : '0';
        el.classList.toggle('is-disabled', blocked);
        el.classList.toggle('is-arrival-blocked', blocked);
        el.classList.toggle('opacity-60', blocked);
        el.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    });
    destSpans.forEach((span) => { span.textContent = destLabel; });
};

window.driverSignalDestinationArrival = async () => {
    const trip = window.activeTrip || window.currentActiveTripData;
    const uid = window.currentUser?.uid || window.currentUser?.uid;
    if (!trip?.id || trip.status !== 'in_progress' || trip.driverId !== uid) {
        return window.showToast?.('Solo disponible durante un viaje en curso.');
    }
    if (trip.driverArrivedDestination) {
        return window.showToast?.('Ya registraste la llegada. Espera la confirmación del pasajero.');
    }

    const pos = window.currentDriverPos;
    const dest = window.getTripDestinationCoords(trip);
    if (!pos || !dest) {
        return window.showToast?.('Esperando ubicación GPS o destino del viaje.');
    }
    const dist = window.getDistanceMetersBetween(pos, dest);
    if (dist > TRIP_DEST_CONFIRM_RADIUS_M) {
        const needLabel = TRIP_DEST_CONFIRM_RADIUS_M >= 1000
            ? `${(TRIP_DEST_CONFIRM_RADIUS_M / 1000).toFixed(0)} km`
            : `${TRIP_DEST_CONFIRM_RADIUS_M} m`;
        const nowLabel = dist >= 1000
            ? `${(dist / 1000).toFixed(1)} km`
            : `${Math.round(dist)} m`;
        return window.showToast?.(`Debes estar a ${needLabel} o menos del destino (ahora ~${nowLabel}).`);
    }

    const legLabel = window.getTripRouteLegLabel?.(trip) || { isFinal: true, routeNum: 2 };
    const confirmMsg = legLabel.isFinal
        ? '¿Confirmas que llegaste al destino final con el pasajero? El viaje se finalizará.'
        : `¿Confirmas que llegaste al punto ${legLabel.routeNum}? Se cargará la ruta al siguiente punto.`;
    if (!confirm(confirmMsg)) return;

    try {
        if (!legLabel.isFinal) {
            const nextIdx = window.getTripCurrentLegIndex(trip) + 1;
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'trips', trip.id), {
                routeLegIndex: nextIdx,
                driverArrivedDestination: false,
            });
            window.activeTrip = { ...trip, routeLegIndex: nextIdx, driverArrivedDestination: false };
            window.currentActiveTripData = { ...window.activeTrip };
            window._inProgressNavBootKey = null;
            window._lastTripUiState = null;
            window._passengerTrackKey = null;

            const nextTarget = window.getTripCurrentLegNavTarget(window.activeTrip);
            if (nextTarget) window.updateNavigation?.(nextTarget, true);

            const nextLabel = window.getTripRouteLegLabel(window.activeTrip);
            window.syncDriverDestinationArrivalUi(pos);
            window.showToast?.(
                `Punto ${legLabel.routeNum} completado. Ruta al punto ${nextLabel.routeNum} en el mapa. También podés abrir Google Maps.`,
                'success'
            );
            return;
        }

        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'trips', trip.id), {
            driverArrivedDestination: true,
            driverArrivedDestinationAt: serverTimestamp()
        });
        window.activeTrip = { ...trip, driverArrivedDestination: true };
        window.currentActiveTripData = { ...window.activeTrip };

        window.syncDriverDestinationArrivalUi(pos);
        await window.finishTrip?.({ skipConfirm: true });
    } catch (e) {
        console.error('driverSignalDestinationArrival:', e);
        window.showToast?.(legLabel.isFinal
            ? 'No se pudo finalizar el viaje en el destino.'
            : 'No se pudo avanzar al siguiente punto.');
    }
};

// ==================== PANEL FIJO MINIMIZABLE PARA CLIENTE: CONFIRMAR LLEGADA AL DESTINO ====================
// Se activa cuando el conductor marca llegada y está a <= 1 km del destino.
// Fijo en esquina + minimizable. Solo visible en fase destination para cliente.

}
