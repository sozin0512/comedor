/** Runtime pasajero: cotizar ruta y paradas extra. Se carga tras el login de cliente. */
import { isClientTripEligible } from './age-verification.js';
import { normalizeHondurasPhone } from './phone-utils.js';
import { ensureEndpointCoords } from './zones.js';
import { canUseBirthdayFreeTrip } from './greetings.js';
import {
    normalizeServiceType, calculateServiceFare, calculateFreightFare,
    calculateTowFare, isFreightService, isTowService, getHourlyLabel, calculateHourlyFare,
    collectFreightDetailsFromUI, validateFreightDetails, collectTowDetailsFromUI,
    getServiceMeta, applyPassengerSurcharge, getHourlyRate
} from './service-types.js';
import { extraStopsSurcharge } from './extra-stops-fare.js';

export function installPassengerRuntime() {
    if (window.__hrPassengerRuntime) return;
    window.__hrPassengerRuntime = true;
async function resolveRouteEndpoint(el) {
    if (!el) return null;

    const uiText = (window.readAutocompleteText?.(el) || '').trim();

    // Fix: si el usuario cambió el texto de la ruta (se equivocó y puso otra), invalidar caché vieja
    // para que no se quede con precios / km de la ruta anterior
    if (el._routeEndpoint?.address) {
        const cachedText = (el._routeEndpoint.address || '').trim();
        if (cachedText !== uiText) {
            el._routeEndpoint = null;
            el._selectedPlace = null;
        } else if (el._routeEndpoint.latLng || el._routeEndpoint.place) {
            return el._routeEndpoint;
        }
    }

    if (el._selectedPlace) {
        const endpoint = window.placeToRouteEndpoint?.(el._selectedPlace, window.readAutocompleteText?.(el));
        if (endpoint?.address) {
            window.storeRouteEndpoint?.(el, endpoint);
            return endpoint;
        }
    }

    try {
        const place = el.place;
        if (place?.fetchFields) {
            await place.fetchFields({ fields: ['formattedAddress', 'displayName', 'location', 'id'] });
            const endpoint = window.placeToRouteEndpoint?.(place, window.readAutocompleteText?.(el));
            if (endpoint?.address) {
                el._selectedPlace = place;
                window.storeRouteEndpoint?.(el, endpoint);
                return endpoint;
            }
        }
    } catch (_) {}

    const text = window.readAutocompleteText?.(el) || el._routeEndpoint?.address || '';
    if (text.length >= 3) {
        const geocoded = await window.geocodeAddressString?.(text);
        const endpoint = geocoded?.address
            ? { address: geocoded.address, latLng: geocoded.latLng || null }
            : { address: text, latLng: null };
        window.storeRouteEndpoint?.(el, endpoint);
        return endpoint;
    }

    return null;
}

function getAutocompleteAddress(el) {
    return el?._routeEndpoint?.placeName
        || el?._routeEndpoint?.address
        || window.placeDisplayName?.(el?._selectedPlace)
        || el?._selectedPlace?.formattedAddress
        || window.readAutocompleteText?.(el)
        || null;
}

function routeWaypoint(endpoint) {
    if (!endpoint) return null;
    if (endpoint.latLng) return endpoint.latLng;
    if (endpoint.place) return endpoint.place;
    return endpoint.address;
}

function formatDurationMillis(ms) {
    if (!ms) return '';
    const mins = Math.max(1, Math.round(ms / 60000));
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
}

function clearTripRouteOnMap() {
    window.clearRoutePolylines?.();
    window.clearOriginDestinationMarkers?.();
}

window.pointToLatLng = (point) => {
    if (!point) return null;
    if (point.latLng?.lat != null && point.latLng?.lng != null) {
        return { lat: Number(point.latLng.lat), lng: Number(point.latLng.lng) };
    }
    if (point.lat != null && point.lng != null) {
        return { lat: Number(point.lat), lng: Number(point.lng) };
    }
    if (typeof point.lat === 'function' && typeof point.lng === 'function') {
        try {
            return { lat: point.lat(), lng: point.lng() };
        } catch (_) {}
    }
    return null;
};

window.buildOrderedRoutePoints = (origin, destination, stops = []) => {
    const chain = [];
    let routeNum = 1;
    const push = (address, latLng, role) => {
        if (!latLng) return;
        chain.push({
            address: address || '',
            latLng,
            role,
            routeNum: routeNum++,
        });
    };

    // ALWAYS: origin first, then added stops in the exact order they were added (array order),
    // destination ALWAYS last. This fixes ordering for 4+ points and ensures destino is final.
    push(origin?.address, window.pointToLatLng(origin) || origin?.latLng || null, 'origin');
    (stops || []).forEach((s) => {
        const ll = window.pointToLatLng(s);
        if (ll) push(s.address || s.placeName || 'Parada', ll, 'stop');
    });
    push(
        destination?.address,
        window.pointToLatLng(destination) || destination?.latLng || null,
        'destination'
    );
    return chain;
};

window.computeMultiStopRouteMetrics = async (origin, destination, stopsList = [], { hourlyMulti = false, estimateOnly = false } = {}) => {
    const orderedChain = hourlyMulti
        ? [
            { address: origin?.address, latLng: window.pointToLatLng(origin) || origin?.latLng, role: 'origin', routeNum: 1 },
            ...stopsList.map((s, idx) => ({
                address: s.address,
                latLng: window.pointToLatLng(s) || s.latLng,
                role: 'stop',
                routeNum: idx + 2
            })),
            {
                address: destination?.address,
                latLng: window.pointToLatLng(destination) || destination?.latLng,
                role: 'destination',
                routeNum: stopsList.length + 2
            },
        ].filter((p) => p.latLng)
        : window.buildOrderedRoutePoints(origin, destination, stopsList);

    if (orderedChain.length < 2) return null;

    const points = orderedChain.map((p) => ({
        latLng: p.latLng,
        address: p.address,
        routeNum: p.routeNum,
        role: p.role,
    }));

    let fullPath = [];
    let totalKm = 0;
    let totalDurMs = 0;
    const segments = [];
    for (let i = 0; i < points.length - 1; i++) {
        const seg = estimateOnly
            ? (window.estimateDrivingRoute?.(points[i], points[i + 1]) || null)
            : await window.computeDrivingRoute(points[i], points[i + 1], { mode: 'once' });
        if (!seg) continue;
        let segPath = seg.path || [];
        if (fullPath.length > 0 && segPath.length > 0) {
            segPath = segPath.slice(1);
        }
        fullPath = fullPath.concat(segPath);
        const segMeters = seg.distanceMeters || seg.legs?.[0]?.distanceMeters || 0;
        const segDurMs = seg.durationMillis || seg.legs?.[0]?.durationMillis || 0;
        const segKm = segMeters / 1000;
        totalKm += segKm;
        totalDurMs += segDurMs;
        segments.push({
            index: i + 1,
            fromRouteNum: points[i].routeNum,
            toRouteNum: points[i + 1].routeNum,
            fromAddress: points[i].address || `Punto ${points[i].routeNum}`,
            toAddress: points[i + 1].address || `Punto ${points[i + 1].routeNum}`,
            fromRole: points[i].role,
            toRole: points[i + 1].role,
            km: Math.round(segKm * 100) / 100,
            durationMin: Math.max(1, Math.round(segDurMs / 60000)),
            distanceMeters: segMeters
        });
    }

    if (totalKm <= 0) return null;

    const combinedRoute = {
        distanceMeters: totalKm * 1000,
        durationMillis: totalDurMs,
        path: fullPath.length > 1 ? fullPath : [],
        legs: [{
            distanceMeters: totalKm * 1000,
            durationMillis: totalDurMs,
        }],
        previewOnly: true,
        origin: points[0]?.latLng || null,
        destination: points[points.length - 1]?.latLng || null,
    };

    return {
        orderedChain,
        fullPath,
        totalKm: Math.round(totalKm * 100) / 100,
        totalDurMs,
        segments,
        pointsCount: orderedChain.length,
        combinedRoute
    };
};

window.getRouteSlotLabel = (slot) => {
    return 'Parada intermedia';
};

window.formatTripRouteOrderHtml = (trip) => {
    if (!trip) return '';
    const labelOf = (which, fallback) => {
        if (which === 'origin') {
            return trip.originPlaceName
                || window.shortenMapPlaceLabel?.(trip.origin)
                || trip.origin
                || fallback;
        }
        return trip.destinationPlaceName
            || window.shortenMapPlaceLabel?.(trip.destination)
            || trip.destination
            || fallback;
    };
    const hasExtras = trip.additionalStops?.length > 0;
    if (!hasExtras) {
        const destLabel = trip.bookingType === 'hourly' ? '⏱' : 'B';
        const destText = labelOf('destination', trip.bookingType === 'hourly' ? 'Reserva por horas' : '...');
        return `
            <p class="text-[10px] text-gray-500 mb-1"><span class="font-black text-emerald-600">1</span> ${labelOf('origin', '...')}</p>
            <p class="text-[10px] text-gray-500"><span class="font-black text-red-500">2</span> ${destText}</p>
        `;
    }
    const origin = {
        address: labelOf('origin', trip.origin),
        latLng: trip.originLat != null ? { lat: trip.originLat, lng: trip.originLng } : null,
    };
    const destination = {
        address: labelOf('destination', trip.destination),
        latLng: trip.destinationLat != null ? { lat: trip.destinationLat, lng: trip.destinationLng } : null,
    };
    const chain = window.buildOrderedRoutePoints(origin, destination, trip.additionalStops);
    return chain.map((p) => {
        const addr = p.placeName || window.shortenMapPlaceLabel?.(p.address) || p.address || '…';
        return `
        <p class="text-[10px] text-gray-500${p.routeNum < chain.length ? ' mb-0.5' : ''}">
            <span class="font-black ${p.routeNum === 1 ? 'text-emerald-600' : (p.routeNum === chain.length ? 'text-red-500' : 'text-blue-600')}">${p.routeNum}</span>
            ${addr}
        </p>
    `;
    }).join('');
};

window.getSelectedExtraStopRouteSlot = () => {
    // Slots no longer affect ordering (destination is always last, stops follow add order).
    // Keep returning 2 for compatibility with map pick etc.
    return 2;
};

window._routeChangeGuardSkip = false;

function hasActiveTripQuote() {
    const fareCard = document.getElementById('fare-card');
    const fareVisible = fareCard && !fareCard.classList.contains('hidden');
    const q = window.currentTripQuote;
    if (fareVisible || !!(q?.origin && q?.destination)) return true;
    const oEl = document.getElementById('origin-autocomplete');
    const dEl = document.getElementById('destination-autocomplete');
    return !!(
        oEl?._routeEndpoint?.latLng && oEl._routeEndpoint?.address &&
        dEl?._routeEndpoint?.latLng && dEl._routeEndpoint?.address &&
        window.currentRouteData
    );
}

function getRouteFieldLabel(el) {
    const id = el?.id || '';
    if (id.includes('origin')) return 'origen';
    if (id.includes('destination')) return 'destino';
    return 'dirección';
}

window.captureRouteFieldSnapshot = (el) => {
    if (!el) return null;
    return {
        text: window.readAutocompleteText?.(el) || el._routeEndpoint?.address || '',
        endpoint: el._routeEndpoint
            ? {
                address: el._routeEndpoint.address,
                latLng: el._routeEndpoint.latLng ? { ...el._routeEndpoint.latLng } : null,
                place: el._routeEndpoint.place || null,
                source: el._routeEndpoint.source,
                gpsAddress: el._routeEndpoint.gpsAddress
            }
            : null,
        selectedPlace: el._selectedPlace || null,
        place: el.place || null
    };
};

window.restoreRouteFieldSnapshot = (el, snap) => {
    if (!el || !snap) return;
    window._routeChangeGuardSkip = true;
    window.storeRouteEndpoint?.(el, snap.endpoint);
    el._selectedPlace = snap.selectedPlace;
    el.place = snap.place;
    const text = snap.text || '';
    try {
        if (typeof el.value !== 'undefined') el.value = text;
        const input = el.shadowRoot?.querySelector('input') || el.querySelector('input');
        if (input) input.value = text;
    } catch (_) {}
    setTimeout(() => { window._routeChangeGuardSkip = false; }, 80);
};

window.guardRouteEndpointChange = async (el, nextAddress) => {
    if (window._routeChangeGuardSkip) return true;
    if (!hasActiveTripQuote()) return true;

    const field = getRouteFieldLabel(el);
    const quoteKey = field === 'origen' ? 'origin' : 'destination';
    const prev = (el?._routeEndpoint?.address || window.currentTripQuote?.[quoteKey] || '').trim();
    const next = (nextAddress || '').trim();

    if (!prev) return true;
    if (prev === next) return true;

    if (!next) {
        const ok = confirm(`¿Quitar el ${field}?\n\nSe ocultará la tarifa hasta que completes la ruta de nuevo.`);
        if (ok) window.resetRouteStopsPrompt?.();
        return ok;
    }

    const ok = confirm(
        `¿Cambiar el ${field} y recalcular el precio?\n\n` +
        `Actual: ${prev}\n` +
        `Nuevo: ${next}`
    );
    if (ok) window.resetRouteStopsPrompt?.();
    return ok;
};

window.resetRouteStopsPrompt = () => {
    window._routeStopsPromptSig = null;
    window._routeStopsPromptDone = false;
};

window.openStandardStopsAdder = () => {
    const panel = document.getElementById('standard-stops-adder');
    const toggleBtn = document.getElementById('add-extra-stop-btn');
    if (!panel || toggleBtn?.classList.contains('hidden')) return;

    panel.classList.remove('hidden');
    window.syncAddExtraStopBtnState?.();

    const routeSection = document.getElementById('passenger-booking-route');
    routeSection?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
        panel.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        const stopInput = document.getElementById('extra-stop-autocomplete');
        stopInput?.focus?.();
    }, 280);
};

function truncateRoutePromptLabel(address, max = 48) {
    const text = (address || '').trim();
    if (!text) return '…';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeExtraStopPromptText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showExtraStopPromptModal(origin, destination) {
    return new Promise((resolve) => {
        if (document.getElementById('extra-stop-prompt-modal')) {
            resolve(false);
            return;
        }

        const originLabel = escapeExtraStopPromptText(truncateRoutePromptLabel(origin?.address));
        const destLabel = escapeExtraStopPromptText(truncateRoutePromptLabel(destination?.address));

        const overlay = document.createElement('div');
        overlay.id = 'extra-stop-prompt-modal';
        overlay.className = 'extra-stop-prompt-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'extra-stop-prompt-title');
        overlay.innerHTML = `
            <div class="extra-stop-prompt-backdrop" data-extra-stop-dismiss aria-hidden="true"></div>
            <div class="extra-stop-prompt-sheet">
                <div class="extra-stop-prompt-handle" aria-hidden="true"></div>
                <div class="extra-stop-prompt-icon" aria-hidden="true">
                    <i class="fas fa-map-signs"></i>
                </div>
                <h2 id="extra-stop-prompt-title" class="extra-stop-prompt-title">¿Parada en el camino?</h2>
                <p class="extra-stop-prompt-subtitle">Tu ruta está lista. ¿Quieres detenerte en algún punto antes de llegar?</p>
                <div class="extra-stop-prompt-route" aria-label="Ruta actual">
                    <div class="extra-stop-prompt-route-point">
                        <span class="extra-stop-prompt-route-dot extra-stop-prompt-route-dot--origin" aria-hidden="true"></span>
                        <span class="extra-stop-prompt-route-label">${originLabel}</span>
                    </div>
                    <div class="extra-stop-prompt-route-line" aria-hidden="true"></div>
                    <div class="extra-stop-prompt-route-point">
                        <span class="extra-stop-prompt-route-dot extra-stop-prompt-route-dot--dest" aria-hidden="true"></span>
                        <span class="extra-stop-prompt-route-label">${destLabel}</span>
                    </div>
                </div>
                <div class="extra-stop-prompt-actions">
                    <button type="button" class="extra-stop-prompt-btn extra-stop-prompt-btn--primary" data-extra-stop-choice="yes">
                        <i class="fas fa-plus-circle" aria-hidden="true"></i>
                        <span>Sí, agregar parada</span>
                        <small class="extra-stop-prompt-badge">Cobrada</small>
                    </button>
                    <button type="button" class="extra-stop-prompt-btn extra-stop-prompt-btn--secondary" data-extra-stop-choice="no">
                        <i class="fas fa-route" aria-hidden="true"></i>
                        <span>Ir directo al destino</span>
                    </button>
                </div>
            </div>
        `;

        const close = (choice) => {
            overlay.classList.add('extra-stop-prompt-overlay--closing');
            document.body.classList.remove('extra-stop-prompt-open');
            setTimeout(() => {
                overlay.remove();
                resolve(choice === 'yes');
            }, 170);
        };

        overlay.querySelectorAll('[data-extra-stop-choice]').forEach((btn) => {
            btn.addEventListener('click', () => close(btn.dataset.extraStopChoice));
        });
        overlay.querySelector('[data-extra-stop-dismiss]')?.addEventListener('click', () => close('no'));

        document.body.appendChild(overlay);
        document.body.classList.add('extra-stop-prompt-open');
        requestAnimationFrame(() => overlay.querySelector('[data-extra-stop-choice="yes"]')?.focus?.());
    });
}

async function maybePromptExtraStopsBeforeCalc(origin, destination) {
    if (window.currentBookingMode === 'hourly') return 'continue';

    const serviceType = normalizeServiceType(window.currentServiceType || 'auto');
    if (serviceType === 'delivery' || isFreightService(serviceType)) return 'continue';

    if ((window.tripAdditionalStops || []).length > 0) return 'continue';

    const adder = document.getElementById('standard-stops-adder');
    const addBtn = document.getElementById('add-extra-stop-btn');
    if (!adder || addBtn?.classList.contains('hidden')) return 'continue';
    if (!adder.classList.contains('hidden')) return 'stop';

    const sig = `${origin?.address || ''}|${destination?.address || ''}`;
    if (window._routeStopsPromptSig !== sig) {
        window._routeStopsPromptSig = sig;
        window._routeStopsPromptDone = false;
    }
    if (window._routeStopsPromptDone) return 'continue';

    const wantsStop = await showExtraStopPromptModal(origin, destination);
    window._routeStopsPromptDone = true;

    if (wantsStop) {
        window.openStandardStopsAdder?.();
        return 'stop';
    }
    return 'continue';
}

window.calculateTripRoute = async (options = {}) => {
    const silent = options.silent === true;
    const estimateOnly = options.estimateOnly !== false && options.useRoutesApi !== true;
    const routeMode = estimateOnly ? 'estimate' : 'once';
    window._tripRouteCalcGen = (window._tripRouteCalcGen || 0) + 1;
    const calcGen = window._tripRouteCalcGen;
    window._tripRouteCalcInFlight = (window._tripRouteCalcInFlight || 0) + 1;

    try {
    if (window.userProfile?.role !== 'client') {
        return;
    }

    if (!window.mapLoaded) {
        if (options.silent !== true) window.showToast('El mapa aún carga. Espera unos segundos e intenta de nuevo.');
        return;
    }

    const originEl = document.getElementById('origin-autocomplete');
    const destEl = document.getElementById('destination-autocomplete');
    const fareCard = document.getElementById('fare-card');

    if (!silent && fareCard) {
        fareCard.classList.add('hidden');
        window.currentTripQuote = null;
    }

    if (!originEl || !destEl) {
        if (!silent) {
            console.warn('calculateTripRoute: no se encontraron los campos de origen/destino');
            window.showToast('Error interno: recarga la página.');
        }
        return;
    }

    window.showControlPanel?.();

    // Aviso suave (no bloqueo): sin verificación aún se puede cotizar y viajar
    if (!silent && window.userProfile?.role === 'client' && !window._unverifiedRouteToastShown) {
        const tripCheck = isClientTripEligible(window.userProfile);
        if (tripCheck.warning) {
            window._unverifiedRouteToastShown = true;
            window.showToast('Puedes cotizar y pedir viaje. Verificar es opcional.', 'info');
        }
    }

    const origin = await resolveRouteEndpoint(originEl);
    const destination = await resolveRouteEndpoint(destEl);

    if (!origin?.address) {
        if (!silent) window.showToast('Establece el origen: toca la cruz azul de ubicación o escribe una dirección.');
        return;
    }

    let isHourlyCalc = window.currentBookingMode === 'hourly';
    let hoursForCalc = isHourlyCalc ? (window.currentReservedHours || 1) : 1;
    let stopType = isHourlyCalc ? (window.currentHourlyStopType || 'standard') : null;

    if (!isHourlyCalc && !destination?.address) {
        if (!silent) window.showToast('Escribe el destino y elige una sugerencia, o escribe la dirección completa.');
        return;
    }

    // Para modo estándar por horas: requerir destino (2 paradas)
    if (isHourlyCalc && stopType === 'standard' && !destination?.address) {
        if (!silent) window.showToast('Para reserva estándar (2 paradas) debes indicar el destino.');
        return;
    }

    const serviceType = normalizeServiceType(window.currentServiceType);
    if (serviceType === 'delivery') {
        const recipientName = document.getElementById('delivery-recipient-name')?.value.trim();
        const recipientPhone = normalizeHondurasPhone(document.getElementById('delivery-recipient-phone')?.value.trim());
        const packageDescription = document.getElementById('delivery-package-desc')?.value.trim();
        if (!recipientName || !recipientPhone || !packageDescription) {
            if (!silent) window.showToast('Completa nombre, WhatsApp y descripción del envío.');
            return;
        }
    }

    if (!options.skipStopsPrompt) {
        const promptResult = await maybePromptExtraStopsBeforeCalc(origin, destination);
        if (promptResult === 'stop') return;
    }

    clearTripRouteOnMap();

    // Forzar limpiar datos de ruta previos para que al cambiar origen/destino los precios se recalculen correctamente
    window.currentRouteData = null;

    try {
        await ensureEndpointCoords(origin);
        if (!isHourlyCalc) {
            await ensureEndpointCoords(destination);
        }
        if (origin?.latLng) window.storeRouteEndpoint?.(originEl, origin);
        if (destination?.latLng) window.storeRouteEndpoint?.(destEl, destination);

        if (!origin?.latLng || (!isHourlyCalc && !destination?.latLng)) {
            if (!silent) {
                window.showToast('No pudimos localizar con precisión el origen. ' + (isHourlyCalc ? '' : 'Selecciona una sugerencia o escribe dirección completa para destino.'));
            }
            return;
        }

        // Ciudad sigue al origen (aunque el pasajero haya escrito o elegido otra dirección)
        if (origin?.latLng?.lat != null && origin?.latLng?.lng != null) {
            window.syncCityFromOriginCoords?.(origin.latLng.lat, origin.latLng.lng, { silent: true });
        }

        // Determine early if we have extra stops (for standard or hourly multi; envíos = solo origen → destino)
        const hasStandardExtraStops = serviceType !== 'delivery'
            && window.tripAdditionalStops
            && window.tripAdditionalStops.length > 0;
        const hasHourlyMulti = window.currentBookingMode === 'hourly' && window.currentHourlyStopType === 'multi' && window.currentHourlyAdditionalStops && window.currentHourlyAdditionalStops.length > 0;
        const hasMultiStops = hasStandardExtraStops || hasHourlyMulti;

        let route = null;
        let km = 0;

        if (hasMultiStops && !isHourlyCalc) {
            // STANDARD + extra stops: compute chained route through all points (origin + stops in order + destination last)
            const stopsList = window.tripAdditionalStops || [];
            const metrics = await window.computeMultiStopRouteMetrics?.(
                origin,
                destination,
                stopsList,
                { hourlyMulti: false, estimateOnly: true }
            );
            if (metrics?.totalKm > 0 && metrics.combinedRoute) {
                km = metrics.totalKm;
                route = metrics.combinedRoute;
                window.clearRoutePolylines?.();
                window.drawRouteOnMap(route);
                window.currentRouteData = route;

                // Place correct numbered markers: 1 origin, intermediates, LAST = destination
                window.clearStopMarkers?.();
                window.clearOriginDestinationMarkers?.();
                const orderedChain = metrics.orderedChain || [];
                orderedChain.forEach((point, idx) => {
                    if (!point?.latLng) return;
                    const title = `${point.routeNum}. ${point.address || 'Parada'}`;
                    const isFirst = idx === 0;
                    const isLast = idx === orderedChain.length - 1;
                    if (isFirst) {
                        window.placePickupMarker?.(point.latLng, title);
                    } else if (isLast) {
                        window.placeDestinationMarker?.(point.latLng, title);
                    } else {
                        const marker = window.placeStopMarker?.(point.latLng, point.routeNum, title);
                        if (marker) {
                            if (!window.stopMarkers) window.stopMarkers = [];
                            window.stopMarkers.push(marker);
                        }
                    }
                });
            } else {
                // fallback: suma de tramos (haversine) para no dejar el precio en 0
                const chainPts = [origin, ...stopsList, destination]
                    .map((p) => window.pointToLatLng?.(p) || p?.latLng || null)
                    .filter((p) => p && p.lat != null && p.lng != null);
                let chainKm = 0;
                for (let i = 1; i < chainPts.length; i++) {
                    const est = window.estimateDrivingRoute?.(chainPts[i - 1], chainPts[i]);
                    chainKm += (est?.distanceMeters || 0) / 1000;
                }
                if (chainKm > 0) {
                    km = Math.round(chainKm * 100) / 100;
                    route = window.estimateDrivingRoute?.(origin, destination) || null;
                    if (route) {
                        window.drawRouteOnMap(route);
                        window.placeRouteMarkers?.(origin?.latLng, destination?.latLng);
                        window.currentRouteData = route;
                    }
                } else {
                    route = window.estimateDrivingRoute?.(origin, destination);
                    if (route) {
                        window.drawRouteOnMap(route);
                        window.placeRouteMarkers?.(origin?.latLng, destination?.latLng);
                        window.currentRouteData = route;
                        km = (route.distanceMeters || 0) / 1000;
                    }
                }
            }
        } else if (!isHourlyCalc) {
            // Normal direct O -> D (no extra stops) — estimado hasta que un conductor acepte
            route = estimateOnly
                ? window.estimateDrivingRoute?.(origin, destination)
                : await window.computeDrivingRoute(origin, destination, { mode: routeMode });
            if (!route) {
                if (!silent) {
                    window.showToast('No se encontró ruta entre esos puntos. Verifica que origen y destino estén en Honduras.');
                }
                return;
            }
            window.drawRouteOnMap(route);
            window.placeRouteMarkers?.(origin?.latLng, destination?.latLng);
            window.currentRouteData = route;
            km = (typeof window.getRouteDistanceKm === 'function')
                ? window.getRouteDistanceKm(route)
                : ((route.distanceMeters || route?.legs?.[0]?.distanceMeters || 0) / 1000);
        } else {
            // Hourly: try to compute route if destination exists (para cobrar km en ciudad a ciudad)
            if (destination?.latLng) {
                try {
                    route = estimateOnly
                        ? window.estimateDrivingRoute?.(origin, destination)
                        : await window.computeDrivingRoute(origin, destination, { mode: routeMode });
                    if (route) {
                        km = (typeof window.getRouteDistanceKm === 'function')
                            ? window.getRouteDistanceKm(route)
                            : ((route.distanceMeters || route?.legs?.[0]?.distanceMeters || 0) / 1000);
                    }
                } catch (_) {}
                if (route) {
                    window.currentRouteData = route;
                }
            }
            // For hourly multi, override happens in the block below
            if (route && origin?.latLng && destination?.latLng && !hasMultiStops) {
                window.drawRouteOnMap(route);
                window.placeRouteMarkers?.(origin?.latLng, destination?.latLng);
            } else if (window.gMap && origin?.latLng) {
                try { window.gMap.panTo(origin.latLng); window.gMap.setZoom(16); } catch(_) {}
            }

            // Hourly multi-stops: chained calc + draw + markers
            if (hasHourlyMulti && !hasStandardExtraStops) {
                const stopsList = window.currentHourlyAdditionalStops || [];
                const metrics = await window.computeMultiStopRouteMetrics?.(
                    origin,
                    destination,
                    stopsList,
                    { hourlyMulti: true }
                );
                if (metrics?.totalKm > 0 && metrics.combinedRoute) {
                    km = metrics.totalKm;
                    route = metrics.combinedRoute;
                    window.clearRoutePolylines?.();
                    window.drawRouteOnMap(route);
                    window.currentRouteData = route;

                    window.clearStopMarkers?.();
                    window.clearOriginDestinationMarkers?.();
                    const orderedChain = metrics.orderedChain || [];
                    orderedChain.forEach((point, idx) => {
                        if (!point?.latLng) return;
                        const title = `${point.routeNum}. ${point.address || 'Parada'}`;
                        const isFirst = idx === 0;
                        const isLast = idx === orderedChain.length - 1;
                        if (isFirst) {
                            window.placePickupMarker?.(point.latLng, title);
                        } else if (isLast) {
                            window.placeDestinationMarker?.(point.latLng, title);
                        } else {
                            const marker = window.placeStopMarker?.(point.latLng, point.routeNum, title);
                            if (marker) {
                                if (!window.stopMarkers) window.stopMarkers = [];
                                window.stopMarkers.push(marker);
                            }
                        }
                    });
                }
            }
        }

        // === NUEVA LÓGICA: si el viaje dura más de 1 hora (mínimo para reserva de conductor), forzar modo por horas ===
        const routeDurationMin = (route && route.durationMillis) ? Math.round(route.durationMillis / 60000) : 0;
        // Paradas extra: no forzar “por horas” (eso dejaba el precio en blanco).
        if (routeDurationMin > 60 && !hasStandardExtraStops) {
            const wasAlreadyHourly = window.currentBookingMode === 'hourly';
            if (!wasAlreadyHourly) {
                window.showToast('Este viaje dura más de 1 hora. Debes reservar un conductor por horas para este viaje.', 'warning');
                window.currentBookingMode = 'hourly';
                window.currentHourlyAdditionalStops = []; // fresh only when forcing from standard calc
            }

            // ensure at least min hours based on route duration (preserve user choice of more)
            const minHours = Math.max(1, Math.ceil(routeDurationMin / 60));
            window.currentReservedHours = Math.max(window.currentReservedHours || 1, minHours);

            // mostrar panel de reserva por horas
            const toggle = document.getElementById('trip-hourly-toggle');
            if (toggle) toggle.checked = true;
            const optsPanel = document.getElementById('hourly-options');
            if (optsPanel) optsPanel.classList.remove('hidden');

            // configurar horas del viaje
            renderHourlyChips();
            window.updateHourlyOneHourAlert?.();

            // preselect the start time to now ONLY on initial force into hourly
            if (!wasAlreadyHourly) {
                const timeInput = document.getElementById('hourly-start-time');
                if (timeInput) {
                    const now = new Date();
                    const hh = String(now.getHours()).padStart(2, '0');
                    const mm = String(now.getMinutes()).padStart(2, '0');
                    timeInput.value = `${hh}:${mm}`;
                }
            }

            // Siempre establecer en "múltiples paradas"
            window.currentHourlyStopType = 'multi';
            renderHourlyPassengerChips();
            bindHourlyStopType();

            // force active styles on the multi button (bindHourlyStopType only wires events once)
            const stdBtn = document.querySelector('#hourly-stop-type [data-hourly-stop="standard"]');
            const multiBtn = document.querySelector('#hourly-stop-type [data-hourly-stop="multi"]');
            if (stdBtn) {
                stdBtn.classList.remove('bg-emerald-600', 'text-white');
                stdBtn.classList.add('bg-white', 'text-emerald-700');
            }
            if (multiBtn) {
                multiBtn.classList.add('bg-emerald-600', 'text-white');
                multiBtn.classList.remove('bg-white', 'text-emerald-700');
            }

            const dEl = document.getElementById('destination-autocomplete');
            if (dEl) dEl.setAttribute('placeholder', 'Destino final (última parada)');
            const h = document.getElementById('hourly-stop-hint');
            if (h) h.innerText = 'Múltiples paradas: agrega paradas intermedias (se sumarán al km y tiempo).';

            // (re)create the Google + map stops adder for multi (idempotent via ensure)
            window.ensureHourlyStopsAdder?.();

            const fBtn = document.getElementById('fare-request-btn');
            if (fBtn) fBtn.innerText = 'RESERVAR POR HORAS';

            window.updateHourlyOneHourAlert?.();
        }

        const hourlyOpts = (window.currentBookingMode === 'hourly') ? getCurrentHourlyOptions() : {};
        if (window.currentBookingMode === 'hourly' && km > 0) hourlyOpts.distanceKm = km;

        let routeConditions = null;
        if (route && origin?.latLng && destination?.latLng) {
            const mid = {
                lat: (origin.latLng.lat + destination.latLng.lat) / 2,
                lng: (origin.latLng.lng + destination.latLng.lng) / 2
            };
            routeConditions = await getRouteConditions(route, mid);
        }

        // re-evaluar después de posible forzado a hourly para viajes >1h
        isHourlyCalc = window.currentBookingMode === 'hourly';
        hoursForCalc = window.currentReservedHours || 1;
        stopType = isHourlyCalc ? (window.currentHourlyStopType || 'standard') : null;

        let deliveryDetails = null;
        if (serviceType === 'delivery') {
            deliveryDetails = {
                recipientName: document.getElementById('delivery-recipient-name')?.value.trim() || '',
                recipientPhone: normalizeHondurasPhone(document.getElementById('delivery-recipient-phone')?.value.trim() || ''),
                packageDescription: document.getElementById('delivery-package-desc')?.value.trim() || ''
            };
        }

        let freightDetails = null;
        if (isFreightService(serviceType)) {
            freightDetails = collectFreightDetailsFromUI();
            freightDetails.contactPhone = normalizeHondurasPhone(freightDetails.contactPhone || '');
        }

        const freightRouteMeta = {
            durationMs: route?.durationMillis || route?.legs?.[0]?.durationMillis || 0,
        };

        // Tarifa: si aún no eligió personas, usar 1 solo para vista previa (no marcar como elegido).
        const paxNeedsChoice = typeof requiresPassengerCountChoice === 'function'
            ? requiresPassengerCountChoice(serviceType)
            : (serviceType !== 'delivery' && !isFreightService(serviceType) && serviceType !== 'grua');
        const paxAlreadyChosen = typeof hasChosenPassengerCount === 'function'
            ? hasChosenPassengerCount()
            : (window.passengersChosen === true && Number.isFinite(parseInt(window.currentPassengers, 10)));
        const calcPassengers = (serviceType === 'delivery' || isFreightService(serviceType) || serviceType === 'grua')
            ? 1
            : (paxAlreadyChosen
                ? normalizePassengerCount(serviceType, window.currentPassengers)
                : 1);
        if (!paxNeedsChoice || paxAlreadyChosen) {
            window.currentPassengers = calcPassengers;
            if (!paxNeedsChoice) window.passengersChosen = true;
        }
        if (isHourlyCalc) hourlyOpts.passengers = calcPassengers;
        const calcPaxSurcharge = getPassengerSurcharge(serviceType, calcPassengers, km);

        let freightFareQuote = null;
        let fareKm = km;
        if (!isHourlyCalc && hasStandardExtraStops && origin?.latLng && destination?.latLng) {
            const directEst = window.estimateDrivingRoute?.(origin.latLng, destination.latLng);
            const directKm = directEst?.distanceMeters ? (directEst.distanceMeters / 1000) : 0;
            if (directKm > 0) fareKm = directKm;
        }
        let price = isHourlyCalc
            ? calculateHourlyFare(serviceType, hoursForCalc, hourlyOpts, routeConditions)
            : isFreightService(serviceType)
                ? (freightFareQuote = calculateFreightFare(serviceType, km, freightDetails, routeConditions, freightRouteMeta)).total
                : calculateServiceFare(serviceType, fareKm, routeConditions, calcPassengers);
        if (!isHourlyCalc && hasStandardExtraStops) {
            const perKm = getServiceMeta(serviceType)?.perKm || 22;
            price += extraStopsSurcharge(
                origin?.latLng || origin,
                destination?.latLng || destination,
                window.tripAdditionalStops || [],
                perKm
            ).extra;
        }

        // Zona / ruta cara: precio fijo del admin (NO recalcular por km).
        // Si no hay match, se conserva el price por km (o min fare si aplica).
        let fixedFareMeta = {
            fixed: false,
            minApplied: false,
            ruleId: null,
            label: null,
            isNight: false,
            dayPrice: null,
            nightPercent: 0,
            price,
        };
        if (!isHourlyCalc
            && !isFreightService(serviceType)
            && serviceType !== 'delivery'
            && !(typeof isTowService === 'function' && isTowService(serviceType))
            && serviceType !== 'grua'
            && typeof window.applyAdminFixedFare === 'function') {
            fixedFareMeta = window.applyAdminFixedFare(price, serviceType, route, {
                originLat: origin?.latLng?.lat ?? null,
                originLng: origin?.latLng?.lng ?? null,
                destLat: destination?.latLng?.lat ?? null,
                destLng: destination?.latLng?.lng ?? null,
                originText: origin?.address || '',
                destText: destination?.address || '',
            }) || fixedFareMeta;
            if (Number.isFinite(Number(fixedFareMeta.price))) {
                price = Number(fixedFareMeta.price);
            }
        }

        const duration = (!isHourlyCalc && route && typeof window.formatRouteDuration === 'function')
            ? window.formatRouteDuration(route)
            : (isHourlyCalc ? getHourlyLabel(hoursForCalc) : (route ? formatDurationMillis(route.durationMillis || route?.legs?.[0]?.durationMillis) : ''));

        const birthdayEligible = serviceType !== 'delivery' && !isFreightService(serviceType) && canUseBirthdayFreeTrip(window.userProfile);
        if (calcGen !== window._tripRouteCalcGen) return;

        const displayPrice = birthdayEligible ? 'L. 0.00' : `L. ${price.toFixed(2)}`;

        const destForQuote = isHourlyCalc 
            ? (destination?.address || 'Servicio por horas')
            : destination.address;

        window.currentTripQuote = {
            origin: origin.address,
            destination: destForQuote,
            originLat: origin?.latLng?.lat ?? null,
            originLng: origin?.latLng?.lng ?? null,
            destinationLat: isHourlyCalc ? null : (destination?.latLng?.lat ?? null),
            destinationLng: isHourlyCalc ? null : (destination?.latLng?.lng ?? null),
            price: displayPrice,
            originalPrice: `L. ${price.toFixed(2)}`,
            birthdayEligible,
            serviceType,
            deliveryDetails,
            freightDetails,
            freightFareBreakdown: freightFareQuote?.breakdown || null,
            priceNum: price,
            km: isHourlyCalc ? null : km,
            duration: isHourlyCalc ? getHourlyLabel(hoursForCalc) : duration,
            routeConditions: routeConditions || null,
            routeDurationMs: freightRouteMeta.durationMs || null,
            bookingMode: isHourlyCalc ? 'hourly' : 'standard',
            reservedHours: isHourlyCalc ? hoursForCalc : null,
            hourlyRate: isHourlyCalc ? getHourlyRate(serviceType) : null,
            passengers: calcPassengers,
            passengerSurcharge: calcPaxSurcharge,
            hourlyStartTime: isHourlyCalc ? (document.getElementById('hourly-start-time')?.value || null) : null,
            isNightSurcharge: isHourlyCalc
                ? (hourlyOpts.isNight || false)
                : !!(fixedFareMeta.isNight),
            multipleStops: isHourlyCalc ? (hourlyOpts.multipleStops || false) : false,
            distanceKmForCharge: isHourlyCalc ? (km || 0) : 0,
            // Interno: tarifa fija / zona cara (no se muestra al cliente como "fija")
            fixedFareRuleId: fixedFareMeta.ruleId || null,
            fixedFareLabel: fixedFareMeta.label || null,
            fixedFareApplied: !!(fixedFareMeta.fixed || fixedFareMeta.minApplied),
            fixedFareIsNight: !!fixedFareMeta.isNight,
            fixedFareDayPrice: fixedFareMeta.dayPrice ?? null,
        };

        window.updateHourlyOneHourAlert?.();

        const fareCard = document.getElementById('fare-card');
        fareCard?.classList.remove('hidden');
        document.getElementById('price-display').innerText = displayPrice;
        const birthdayNote = document.getElementById('birthday-fare-note');
        if (birthdayNote) {
            if (birthdayEligible) {
                birthdayNote.classList.remove('hidden');
                birthdayNote.innerText = `🎂 ¡Viaje gratis por tu cumpleaños! (valor L. ${price.toFixed(2)})`;
            } else {
                birthdayNote.classList.add('hidden');
            }
        }
        const summary = document.getElementById('route-summary');
        if (summary) {
            let summaryText;
            if (isHourlyCalc) {
                const p = calcPassengers;
                const stopInfo = (window.currentHourlyStopType === 'multi') ? 'múltiples paradas' : '2 paradas';
                let extra = '';
                if (km > 25) extra = ' · +km ciudad-ciudad';
                if (hourlyOpts.isNight) extra += ' · +25% noche';
                if (calcPaxSurcharge > 0) extra += ` · +L. ${calcPaxSurcharge.toFixed(0)} pers.`;
                summaryText = `${getHourlyLabel(hoursForCalc)} · ${formatPassengersLabel(p)} · ${stopInfo}${extra}`;
                if (serviceType === 'moto') summaryText += ' · Moto Segura';
            } else {
                summaryText = `${km.toFixed(1)} km${duration ? ` · ${duration}` : ''}`;
                if (serviceType !== 'delivery' && !isFreightService(serviceType)) {
                    summaryText += ` · ${formatPassengersLabel(calcPassengers)}`;
                    if (calcPaxSurcharge > 0) summaryText += ` · +L. ${calcPaxSurcharge.toFixed(0)} extra`;
                }
                const condSummary = formatConditionsSummary(routeConditions);
                if (condSummary) summaryText += ` · ${condSummary}`;
                if (serviceType === 'delivery') summaryText += ` · ${getDeliverySlaText(km)}`;
                if (isFreightService(serviceType)) {
                    summaryText += serviceType === 'flete_camion' ? ' · Flete en camión' : ' · Flete en paila';
                    if (freightFareQuote?.breakdown?.pricingMode === 'intercity') {
                        summaryText += ' · Fuera de ciudad';
                    } else {
                        summaryText += ' · Dentro de ciudad';
                    }
                    if (freightFareQuote?.breakdown?.weightKg > 0) {
                        summaryText += ` · ~${freightFareQuote.breakdown.weightKg} kg`;
                    }
                }
                if (serviceType === 'moto') summaryText += ' · Moto Segura HonduRaite';
                if (serviceType === 'taxi') summaryText += ' · Taxi tradicional (placa T-)';
                if (serviceType === 'auto') summaryText += ' · Taxi VIP';
            }
            summary.innerText = summaryText;
        }
        const conditionsNote = document.getElementById('route-conditions-note');
        const freightBreakdownEl = document.getElementById('freight-fare-breakdown');
        if (conditionsNote) {
            let note = '';
            if (!isHourlyCalc) {
                if (isFreightService(serviceType)) {
                    if (freightFareQuote?.warnings?.length) note = freightFareQuote.warnings[0];
                    else note = formatConditionsNote(routeConditions) || '';
                } else {
                    note = formatConditionsNote(routeConditions) || '';
                }
            }
            if (note) {
                conditionsNote.textContent = note;
                conditionsNote.classList.remove('hidden');
            } else {
                conditionsNote.textContent = '';
                conditionsNote.classList.add('hidden');
            }
        }
        if (freightBreakdownEl) {
            const breakdownOnly = isFreightService(serviceType) && freightFareQuote
                ? formatFreightFareBreakdown(serviceType, freightFareQuote)
                : '';
            if (breakdownOnly) {
                freightBreakdownEl.textContent = breakdownOnly;
                freightBreakdownEl.classList.remove('hidden');
            } else {
                freightBreakdownEl.textContent = '';
                freightBreakdownEl.classList.add('hidden');
            }
        }
        const fareLabel = document.getElementById('fare-card-label');
        if (fareLabel) {
            fareLabel.textContent = isFreightService(serviceType)
                ? 'Tarifa estimada del flete'
                : 'Tarifa estimada';
        }
        const etaPreview = document.getElementById('eta-preview');
        if (etaPreview) {
            if (isHourlyCalc) {
                etaPreview.classList.remove('hidden');
                const pp = Math.min(4, window.currentPassengers || 1);
                const stop = (window.currentHourlyStopType === 'multi') ? 'múltiples paradas' : '2 paradas';
                let extra = '';
                if (hourlyOpts && hourlyOpts.isNight) extra = ' · +25% noche';
                if (km > 25) extra += ' · +km';
                etaPreview.innerText = `Reserva por ${getHourlyLabel(hoursForCalc)} · ${pp} pers · ${stop}${extra}`;
            } else {
                const mins = getAdjustedDurationMinutes(route, routeConditions);
                const regCount = Number(
                    window.pendingTripRegisteredDrivers
                    ?? window.lastRegisteredDriversCount
                    ?? 0
                );
                const onlineCount = Number(window.lastNearbyDriversCount || 0);
                // Tarifa / mapa: solo info de flota. "Notificados" solo en is-searching.
                let fleetLabel = '';
                if (onlineCount > 0) {
                    fleetLabel = onlineCount === 1 ? '1 conductor cerca' : `${onlineCount} conductores cerca`;
                } else if (regCount > 0) {
                    fleetLabel = (window.formatRegisteredDriversFleetLabel || formatRegisteredDriversFleetLabel)(regCount);
                } else {
                    window.prefetchRegisteredDriversCount?.();
                }
                etaPreview.classList.remove('hidden');
                const trafficHint = routeConditions?.traffic?.trafficAware ? ' (con tráfico)' : '';
                etaPreview.innerText = fleetLabel
                    ? `Estimado: ~${mins} min de ruta${trafficHint} · ${fleetLabel}`
                    : `Tiempo de ruta estimado: ~${mins} min${trafficHint}`;
            }
        }
        window.scrollFareCardIntoView?.();

        if (window.currentRouteData && document.getElementById('ride-options-list')) {
            window.renderRideOptions?.(window.currentRouteData, { syncFare: false });
        }

        // Tras calcular ruta: desplegar siguiente tarjeta de la cadena (tipo / pasajeros / cuándo / pedir)
        window.syncBookingProgression?.({ scroll: !silent });

    } catch (error) {
        console.error('Error al calcular la ruta:', error);
        if (!silent) window.showToast('Error al calcular la ruta. Revisa tu conexión e intenta otra vez.');
    }
    } finally {
        window._tripRouteCalcInFlight = Math.max(0, (window._tripRouteCalcInFlight || 1) - 1);
    }
};

window.addEventListener('map-route-trigger', () => {
    window.calculateTripRoute({ silent: true });
});

}
