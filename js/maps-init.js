/**
 * gmp-place-autocomplete en APK abre un dialog/popover a pantalla completa
 * (top layer). En Android WebView env(safe-area-inset-top) suele ser 0, así
 * que el overlay se pinta bajo el reloj/batería. Inyectamos el inset nativo
 * ANTES de que Maps cree el shadow (este archivo carga antes del script de Maps).
 */
(function installPlacesOverlaySafeTop() {
    if (window._hrPlacesOverlaySafeTopInstalled) return;
    window._hrPlacesOverlaySafeTopInstalled = true;

    const isPlacesHostName = (name) => {
        const n = String(name || '').toLowerCase();
        return n.includes('place-autocomplete') || (n.startsWith('gmp-') && n.includes('autocomplete'));
    };

    const readSearchSafeTopPx = () => {
        try {
            const root = getComputedStyle(document.documentElement);
            const body = document.body ? getComputedStyle(document.body) : root;
            const parse = (v) => {
                const num = parseFloat(String(v || '').trim());
                return Number.isFinite(num) ? num : 0;
            };
            let t = parse(root.getPropertyValue('--native-safe-top'))
                || parse(body.getPropertyValue('--safe-top'))
                || parse(root.getPropertyValue('--safe-top'))
                || parse(root.getPropertyValue('--search-safe-top'));
            if (t < 36) t = 36;
            t += 12;
            return Math.round(t);
        } catch (_) {
            return 48;
        }
    };
    window.readSearchSafeTopPx = readSearchSafeTopPx;

    const isHrNativeAndroid = () => {
        try {
            if (window.Capacitor?.isNativePlatform?.() === true) return true;
        } catch (_) {}
        try {
            return document.documentElement.classList.contains('capacitor-android')
                || document.body?.classList.contains('capacitor-android');
        } catch (_) {
            return false;
        }
    };
    window.isHrNativeAndroid = isHrNativeAndroid;

    const overlayCssText = () => `
        :host { position: relative; overflow: visible !important; }
        dialog,
        dialog[open],
        [popover],
        .full-window-autocomplete-dialog,
        .place-autocomplete-element-overlay,
        .place-autocomplete-element-full-window,
        .overlay-container {
            position: absolute !important;
            inset: auto !important;
            top: 100% !important;
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            max-height: min(50vh, 18rem) !important;
            margin: 0 !important;
            transform: none !important;
            z-index: 99999 !important;
            box-sizing: border-box !important;
        }
        dialog::backdrop {
            display: none !important;
            opacity: 0 !important;
            background: transparent !important;
        }
    `;

    const stylePlacesDropdown = (el) => {
        if (!el || el.nodeType !== 1) return;
        try {
            el.style.setProperty('position', 'absolute', 'important');
            el.style.setProperty('inset', 'auto', 'important');
            el.style.setProperty('top', '100%', 'important');
            el.style.setProperty('left', '0px', 'important');
            el.style.setProperty('right', '0px', 'important');
            el.style.setProperty('bottom', 'auto', 'important');
            el.style.setProperty('width', '100%', 'important');
            el.style.setProperty('max-width', '100%', 'important');
            el.style.setProperty('height', 'auto', 'important');
            el.style.setProperty('max-height', 'min(50vh, 18rem)', 'important');
            el.style.setProperty('margin', '0px', 'important');
            el.style.setProperty('transform', 'none', 'important');
        } catch (_) {}
    };

    const isPlacesDialog = (el) => {
        try {
            const root = el?.getRootNode?.();
            const host = root?.host;
            return !!(host && isPlacesHostName(host.localName));
        } catch (_) {
            return false;
        }
    };

    const injectStyleIntoRoot = (root) => {
        if (!root || !root.appendChild) return;
        let style = null;
        try { style = root.getElementById?.('hr-places-safe-top'); } catch (_) {}
        if (!style) {
            try { style = root.querySelector?.('#hr-places-safe-top'); } catch (_) {}
        }
        if (!style) {
            style = document.createElement('style');
            style.id = 'hr-places-safe-top';
            root.appendChild(style);
        }
        style.textContent = overlayCssText();
    };

    const looksLikePlacesOverlay = (el) => {
        if (!el || el.nodeType !== 1) return false;
        if (el.id === 'status-bar-shield' || el.id === 'control-panel') return false;
        if (el.localName === 'gmp-place-autocomplete' || el.localName === 'gmp-basic-place-autocomplete') return false;
        try {
            if (el.closest?.('#control-panel, #app-header, #status-bar-shield')) return false;
        } catch (_) {}
        const cls = `${el.className || ''} ${el.getAttribute?.('part') || ''}`.toLowerCase();
        if (cls.includes('pac-container') || cls.includes('full-window')) return true;
        const tag = String(el.localName || '');
        if (tag !== 'dialog' && el.getAttribute?.('popover') == null && !cls.includes('overlay')) {
            return false;
        }
        try {
            const r = el.getBoundingClientRect();
            const vh = window.innerHeight || 640;
            const vw = window.innerWidth || 360;
            return r.top <= 12 && r.height >= vh * 0.55 && r.width >= vw * 0.7;
        } catch (_) {
            return false;
        }
    };

    const pinOverlayBelowStatusBar = (el, force = false) => {
        if (!el || el.id === 'status-bar-shield' || el.id === 'control-panel') return;
        if (el.localName === 'gmp-place-autocomplete' || el.localName === 'gmp-basic-place-autocomplete') return;
        if (!looksLikePlacesOverlay(el) && !force) return;
        if (force && !looksLikePlacesOverlay(el)) return;
        const top = readSearchSafeTopPx();
        const kb = (() => {
            try {
                return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')) || 0;
            } catch (_) { return 0; }
        })();
        try {
            el.style.setProperty('inset', `${top}px 0 ${Math.round(kb)}px 0`, 'important');
            el.style.setProperty('top', `${top}px`, 'important');
            el.style.setProperty('left', '0px', 'important');
            el.style.setProperty('right', '0px', 'important');
            el.style.setProperty('bottom', `${Math.round(kb)}px`, 'important');
            el.style.setProperty('margin', '0px', 'important');
            el.style.setProperty('width', '100%', 'important');
            el.style.setProperty('max-width', 'none', 'important');
            el.style.setProperty('height', 'auto', 'important');
            el.style.setProperty('max-height', 'none', 'important');
            el.style.setProperty('box-sizing', 'border-box', 'important');
            try { el.dataset.hrSafeTopPinned = '1'; } catch (_) {}
        } catch (_) {}
    };

    const applyPlacesOverlaySafeTop = () => {
        try {
            const top = readSearchSafeTopPx();
            document.documentElement.style.setProperty('--search-safe-top', `${top}px`);
        } catch (_) {}
        try {
            document.querySelectorAll('dialog[open], .pac-container').forEach((el) => {
                if (isPlacesDialog(el) || String(el.className || '').includes('pac-container')) {
                    stylePlacesDropdown(el);
                }
            });
        } catch (_) {}
        try {
            document.querySelectorAll('[popover]').forEach((el) => {
                if (el.id === 'status-bar-shield') return;
                if (isPlacesDialog(el)) stylePlacesDropdown(el);
            });
        } catch (_) {}
        document.querySelectorAll('gmp-place-autocomplete, gmp-basic-place-autocomplete').forEach((host) => {
            const root = host.shadowRoot || host._hrShadow;
            if (!root) return;
            injectStyleIntoRoot(root);
            try {
                root.querySelectorAll(
                    'dialog, [popover], .full-window-autocomplete-dialog, .place-autocomplete-element-overlay, .place-autocomplete-element-full-window'
                ).forEach(stylePlacesDropdown);
            } catch (_) {}
        });
    };
    window.applyPlacesOverlaySafeTop = applyPlacesOverlaySafeTop;

    const origAttachShadow = Element.prototype.attachShadow;
    if (typeof origAttachShadow === 'function') {
        Element.prototype.attachShadow = function hrAttachShadow(init) {
            const shadow = origAttachShadow.apply(this, arguments);
            try {
                if (isPlacesHostName(this.localName)) {
                    this._hrShadow = shadow;
                    injectStyleIntoRoot(shadow);
                    try {
                        const mo = new MutationObserver(() => {
                            try {
                                shadow.querySelectorAll('dialog, [popover], .full-window-autocomplete-dialog, .place-autocomplete-element-overlay').forEach(stylePlacesDropdown);
                            } catch (_) {}
                        });
                        mo.observe(shadow, { childList: true, subtree: true });
                    } catch (_) {}
                }
            } catch (_) {}
            return shadow;
        };
    }

    const protoDlg = window.HTMLDialogElement && HTMLDialogElement.prototype;
    if (protoDlg && typeof protoDlg.showModal === 'function' && !protoDlg.showModal._hrDropdown) {
        const origShowModal = protoDlg.showModal;
        protoDlg.showModal = function hrPlacesShowModal() {
            if (isPlacesDialog(this)) {
                stylePlacesDropdown(this);
                if (typeof this.show === 'function') return this.show();
            }
            return origShowModal.apply(this, arguments);
        };
        protoDlg.showModal._hrDropdown = true;
    }
    if (window.HTMLElement && typeof HTMLElement.prototype.showPopover === 'function' && !HTMLElement.prototype.showPopover._hrDropdown) {
        const origShowPopover = HTMLElement.prototype.showPopover;
        HTMLElement.prototype.showPopover = function hrPlacesShowPopover() {
            if (isPlacesDialog(this) || (this.id === 'status-bar-shield')) {
                if (this.id === 'status-bar-shield') {
                    try { return origShowPopover.apply(this, arguments); } catch (_) { return undefined; }
                }
                stylePlacesDropdown(this);
            }
            return origShowPopover.apply(this, arguments);
        };
        HTMLElement.prototype.showPopover._hrDropdown = true;
    }

    let applyTimer = 0;
    const scheduleApplyPlacesOverlaySafeTop = () => {
        if (applyTimer) return;
        applyTimer = setTimeout(() => {
            applyTimer = 0;
            applyPlacesOverlaySafeTop();
        }, 32);
    };

    const ensurePersistentShield = () => {
        try {
            if (!document.body) return;
            let el = document.getElementById('status-bar-shield');
            if (!el) {
                el = document.createElement('div');
                el.id = 'status-bar-shield';
                el.setAttribute('aria-hidden', 'true');
                document.body.appendChild(el);
            }
        } catch (_) {}
    };

    const onReady = () => {
        ensurePersistentShield();
        applyPlacesOverlaySafeTop();
        if (window._hrPlacesOverlayMo) return;
        try {
            const mo = new MutationObserver(scheduleApplyPlacesOverlaySafeTop);
            mo.observe(document.documentElement, { childList: true, subtree: true });
            window._hrPlacesOverlayMo = mo;
        } catch (_) {}
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
        onReady();
    }
})();

window.gMap = null;
        window.directionsRenderer = null;
        window.geocoder = null;
        window.trafficLayer = null;        
        window.mapLoaded = false;

window.hrIsNativeAndroid = function hrIsNativeAndroid() {
    try {
        if (window.Capacitor?.isNativePlatform?.() === true && window.Capacitor.getPlatform?.() === 'android') {
            return true;
        }
    } catch (_) {}
    try {
        return !!(document.body?.classList.contains('capacitor-android')
            || document.documentElement.classList.contains('capacitor-android'));
    } catch (_) {
        return false;
    }
};

/** APK / gamas bajas: mapa raster, sin tráfico ni dash animado. */
window.hrUseLiteMaps = function hrUseLiteMaps() {
    if (window.hrIsNativeAndroid?.()) return true;
    try {
        if (navigator.deviceMemory && navigator.deviceMemory < 4) return true;
        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return true;
    } catch (_) {}
    return false;
};

/**
 * APK: al volver de segundo plano el WebGL se pierde. Un solo resize, sin ocultar el mapa
 * (ocultarlo en cada focus traba toda la UI).
 */
window.recoverGoogleMapAfterResume = function recoverGoogleMapAfterResume(reason) {
    try { window.hideCapacitorSplash?.({ fadeOutDuration: 80 }); } catch (_) {}
    const hiddenFor = window._hrWasHiddenAt ? (Date.now() - window._hrWasHiddenAt) : 0;
    const needRecover = reason === 'webgl' || hiddenFor > 500;
    if (!needRecover) return;
    if (window._hrMapRecovering) return;
    window._hrMapRecovering = true;
    setTimeout(() => { window._hrMapRecovering = false; }, 1200);

    try { window.restoreLiveTripUiOnResume?.(); } catch (_) {}
    const el = document.getElementById('map');
    const map = window.gMap;
    if (!el || !map || typeof google === 'undefined' || !google.maps) return;
    let center = null;
    try { center = map.getCenter(); } catch (_) {}
    try { google.maps.event.trigger(map, 'resize'); } catch (_) {}
    try { if (center) map.setCenter(center); } catch (_) {}
    try { window.__liveTripRepaintPassenger?.(); } catch (_) {}
};

(function bindMapResumeRecovery() {
    if (window._hrMapResumeBound) return;
    window._hrMapResumeBound = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            window._hrWasHiddenAt = Date.now();
            return;
        }
        setTimeout(() => window.recoverGoogleMapAfterResume?.('visible'), 80);
    });
    window.addEventListener('pageshow', (e) => {
        if (e && e.persisted) window.recoverGoogleMapAfterResume?.('pageshow');
    });
    document.addEventListener('webglcontextlost', (e) => {
        try { e.preventDefault(); } catch (_) {}
        window.recoverGoogleMapAfterResume?.('webgl');
    }, true);
    try {
        const App = window.Capacitor?.Plugins?.App;
        App?.addListener?.('appStateChange', (s) => {
            if (s && s.isActive) setTimeout(() => window.recoverGoogleMapAfterResume?.('app-active'), 80);
        });
    } catch (_) {}
})();

        /** Google Maps llama esto si la clave/facturación falla (BillingNotEnabledMapError, etc.). */
        window.gm_authFailure = function () {
            window.__mapsAuthFailure = true;
            window.__mapsLoadError = true;
            document.body?.classList.add('map-load-failed', 'map-billing-disabled');
            console.error(
                '[maps] BillingNotEnabledMapError: activa facturación en el proyecto de Google Cloud que usa la clave de Maps.',
                'https://console.cloud.google.com/project/_/billing/enable'
            );
            try {
                let banner = document.getElementById('maps-billing-banner');
                if (!banner) {
                    banner = document.createElement('div');
                    banner.id = 'maps-billing-banner';
                    banner.setAttribute('role', 'alert');
                    banner.className = 'maps-billing-banner';
                    banner.innerHTML = '<p><strong>Google Maps no carga:</strong> la facturación del proyecto Cloud está apagada.</p>'
                        + '<p>En Google Cloud activa facturación y las APIs Maps JavaScript, Places (New), Routes y Geocoding. Luego recarga.</p>';
                    const mapEl = document.getElementById('map');
                    if (mapEl?.parentNode) mapEl.parentNode.insertBefore(banner, mapEl);
                    else document.body?.prepend(banner);
                }
                banner.hidden = false;
            } catch (_) {}
        };
        window.driverMarkers = {};
        window.currentDriverPos = null;
        window.autoCenter = true;
        window.isTrafficVisible = false;        
        window.targetMarker = null;
        window.originMarker = null;
        window.stopMarkers = [];

        window.readAutocompleteText = (el) => {
            if (!el) return '';
            // Prefer the actual UI input value first (this will be '' after clicking the X clear)
            try {
                const input = el.shadowRoot?.querySelector('input')
                    || el.shadowRoot?.querySelector('[part="input"]')
                    || el.querySelector('input');
                if (input) {
                    return (input.value || '').trim();
                }
            } catch (_) {}
            try {
                const direct = el.value;
                if (typeof direct === 'string') return direct.trim();
            } catch (_) {}
            return el._routeEndpoint?.placeName?.trim()
                || el._routeEndpoint?.address?.trim()
                || window.placeDisplayName?.(el._selectedPlace)
                || el._selectedPlace?.formattedAddress?.trim()
                || '';
        };

        window._geocodeCache = window._geocodeCache || new Map();
        window.geocodeAddressString = (address) => new Promise((resolve) => {
            const text = String(address || '').trim();
            if (!text || !window.geocoder) return resolve(null);
            const cacheKey = text.toLowerCase();
            const hit = window._geocodeCache.get(cacheKey);
            if (hit && Date.now() - hit.ts < 30 * 60 * 1000) return resolve(hit.result);

            const region = (typeof window.getGeocodeRegion === 'function'
                ? window.getGeocodeRegion()
                : 'HN') || 'HN';

            const tryGeocode = (query) => new Promise((res) => {
                window.geocoder.geocode({ address: query, region }, (results, status) => {
                    if (status === 'OK' && results?.[0]?.geometry?.location) {
                        const loc = results[0].geometry.location;
                        res({
                            address: results[0].formatted_address || query,
                            latLng: {
                                lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
                                lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng,
                            },
                        });
                    } else {
                        res(null);
                    }
                });
            });

            (async () => {
                let result = await tryGeocode(text);
                if (result?.latLng) {
                    window._geocodeCache.set(cacheKey, { result, ts: Date.now() });
                    return resolve(result);
                }

                const us = typeof window.isUsMarket === 'function' && window.isUsMarket();
                if (!us && !text.toLowerCase().includes('honduras') && !text.toLowerCase().includes('comayagua')) {
                    result = await tryGeocode(text + ', Comayagua, Honduras');
                    if (result?.latLng) {
                        window._geocodeCache.set(cacheKey, { result, ts: Date.now() });
                        return resolve(result);
                    }
                }

                resolve({ address: text, latLng: null });
            })();
        });

  window.canUseAdvancedMapMarkers = () => {
    // Only use AdvancedMarkerElement when a real mapId is configured.
    // Guardar `google` evita ReferenceError ("Script error." / google is not defined)
    // cuando el mapa aún no cargó o falló la API.
    try {
      if (typeof google === 'undefined' || !google?.maps) return false;
      return !!(google.maps?.marker?.AdvancedMarkerElement && window.gMap?.getMapId?.());
    } catch (_) {
      return false;
    }
  };

  window.initMap = function() {
    try {
        if (typeof google === 'undefined' || !google.maps) {
            console.error("Google Maps aún no está listo");
            return;
        }
        // Un solo mapa por sesión: no destruir / recrear (ahorra Maps JS).
        if (window.gMap && window.mapLoaded) {
            return;
        }

        window.geocoder = new google.maps.Geocoder();
        // Rutas: Route.computeRoutes (Routes API). Sin DirectionsService deprecado.
        window.routesLibraryReady = google.maps.importLibrary('routes').then((lib) => {
            window.RouteClass = lib.Route;
            return lib;
        }).catch((err) => {
            console.error('[ROUTE] No se pudo cargar la librería routes:', err);
            return null;
        });
        window.geometryLibraryReady = google.maps.importLibrary('geometry').catch(() => null);
        window._routeComputeCache = new Map();
        window._routeCacheTtlMs = 10 * 60 * 1000;

        // Prevent repeated noisy failures when Routes library / key doesn't support the new computeRoutes in this env
        window._routesApiTried = false;
        window._routesApiWorked = false;
        window.trafficLayer = new google.maps.TrafficLayer();

        const cfg = window.APP_CONFIG?.googleMaps || {};
        const comayaguaCoords = cfg.defaultCenter || { lat: 14.4513, lng: -87.6374 };
        const houstonCoords = { lat: 29.7604, lng: -95.3698 };
        const startCenter = (typeof window.getActiveMarket === 'function' && window.getActiveMarket() === 'us')
            ? houstonCoords
            : comayaguaCoords;

        const LOW = !!(window.hrUseLiteMaps?.());
        const mapOptions = {
            center: startCenter,
            zoom: LOW ? 15 : 16,
            disableDefaultUI: true,
            mapTypeId: 'roadmap',
            backgroundColor: '#e2e8f0',
            clickableIcons: !LOW,
            // greedy: 1 dedo mueve el mapa (como Google Maps app)
            gestureHandling: 'greedy',
            draggable: true,
            scrollwheel: true,
            disableDoubleClickZoom: false,
            keyboardShortcuts: !LOW,
            isFractionalZoomEnabled: !LOW,
        };
        if (LOW) {
            try { window.trafficLayer = null; } catch(_) {}
            try {
                if (google.maps.RenderingType) {
                    mapOptions.renderingType = google.maps.RenderingType.RASTER;
                }
            } catch (_) {}
        }

        // mapId fuerza mapa vectorial (WebGL). En APK eso traba y se pone negro.
        if (cfg.mapId && !LOW) {
            mapOptions.mapId = cfg.mapId;
        }

        window.gMap = new google.maps.Map(document.getElementById("map"), mapOptions);
        document.body?.classList.add('map-ready');

        /** Tipos de Google Geocoder que suelen ser el nombre real del lugar en el mapa. */
        const MAP_PLACE_GEOCODE_TYPES = new Set([
            'establishment', 'point_of_interest', 'premise', 'subpremise',
            'school', 'university', 'hospital', 'church', 'park', 'cemetery',
            'shopping_mall', 'store', 'restaurant', 'cafe', 'lodging', 'gym',
            'bus_station', 'transit_station', 'airport', 'stadium', 'museum',
            'library', 'place_of_worship', 'tourist_attraction', 'zoo',
            'amusement_park', 'aquarium', 'art_gallery', 'bank', 'pharmacy',
            'gas_station', 'supermarket', 'local_government_office', 'police',
            'fire_station', 'post_office', 'courthouse', 'city_hall'
        ]);

        /** Extrae displayName de Place (API nueva: string u objeto { text }). */
        window.placeDisplayName = (place) => {
            if (!place) return '';
            const dn = place.displayName;
            if (typeof dn === 'string' && dn.trim()) return dn.trim();
            if (dn && typeof dn.text === 'string' && dn.text.trim()) return dn.text.trim();
            if (typeof place.name === 'string' && place.name.trim()) return place.name.trim();
            return '';
        };

        /**
         * Etiqueta corta legible para conductores: prioriza el nombre del mapa
         * (ej. "Liceo Jesús") sobre la dirección larga de calle.
         */
        window.shortenMapPlaceLabel = (text) => {
            if (!text) return '';
            const s = String(text).trim();
            if (!s) return '';
            if (!s.includes(',')) return s;
            const first = s.split(',')[0].trim();
            if (first.length < 2 || first.length > 64) return s;
            // Evitar recortar coordenadas crudas
            if (/^-?\d+(\.\d+)?$/.test(first)) return s;
            return first;
        };

        window.reverseGeocodeLatLng = (latLng) => new Promise((resolve) => {
            if (!latLng) return resolve(null);
            const pos = {
                lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
                lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng,
            };
            if (!window.geocoder) {
                return resolve({ address: 'Ubicación seleccionada en el mapa', latLng: pos });
            }
            window.geocoder.geocode({ location: pos }, (results, status) => {
                if (status !== 'OK' || !results?.length) {
                    return resolve({
                        address: 'Ubicación seleccionada en el mapa',
                        latLng: pos,
                    });
                }
                const poi = results.find((r) =>
                    (r.types || []).some((t) => MAP_PLACE_GEOCODE_TYPES.has(t))
                );
                const best = poi || results[0];
                const formatted = best.formatted_address || results[0].formatted_address || '';
                // Si hay un POI en el mapa, usar su nombre corto (antes de la primera coma)
                let address = formatted || 'Ubicación seleccionada en el mapa';
                let placeName = null;
                if (poi && formatted) {
                    const shortName = window.shortenMapPlaceLabel(formatted);
                    if (shortName) {
                        placeName = shortName;
                        address = shortName;
                    }
                }
                resolve({
                    address,
                    placeName,
                    formattedAddress: formatted || null,
                    latLng: pos,
                });
            });
        });

        window.isMobileMapPickDevice = () => {
            const ua = navigator.userAgent || '';
            const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            const mobileUa = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry/i.test(ua);
            return touch && (mobileUa || window.innerWidth < 768);
        };

        window._mapPickDragged = false;
        window._mapPickSmoothTimer = null;
        window._mapPickAddressTimer = null;
        window._mapPickAddressSeq = 0;

        window.savePanelStateForMapPick = () => {
            const panel = document.getElementById('control-panel');
            const stopsAdder = document.getElementById('standard-stops-adder');
            return {
                bodyPanelHidden: document.body.classList.contains('panel-hidden'),
                bodyPanelMinimized: document.body.classList.contains('panel-minimized'),
                panelHidden: !!panel?.classList.contains('panel-hidden'),
                panelCollapsed: !!panel?.classList.contains('panel-collapsed'),
                panelFloating: !!panel?.classList.contains('panel-is-floating'),
                standardStopsAdderOpen: stopsAdder && !stopsAdder.classList.contains('hidden'),
            };
        };

        window.hidePanelForMapPick = () => {
            const panel = document.getElementById('control-panel');
            document.getElementById('standard-stops-adder')?.classList.add('hidden');
            if (window.isMobileMapPickDevice?.()) {
                document.body.classList.add('panel-hidden', 'map-pick-mobile');
                panel?.classList.add('panel-hidden');
                panel?.classList.remove('panel-collapsed');
                document.body.classList.remove('panel-minimized');
            } else {
                document.body.classList.add('panel-hidden');
                panel?.classList.add('panel-hidden');
            }
        };

        window.restorePanelAfterMapPick = (saved) => {
            if (!saved) return;
            const panel = document.getElementById('control-panel');
            document.body.classList.remove('map-pick-mobile');
            document.body.classList.toggle('panel-hidden', saved.bodyPanelHidden);
            document.body.classList.toggle('panel-minimized', saved.bodyPanelMinimized);
            if (panel) {
                panel.classList.toggle('panel-hidden', saved.panelHidden);
                panel.classList.toggle('panel-collapsed', saved.panelCollapsed);
            }
            if (saved.standardStopsAdderOpen) {
                document.getElementById('standard-stops-adder')?.classList.remove('hidden');
            }
        };

        const mapPickContextCopy = (context) => {
            if (context === 'delivery-destination') {
                return {
                    title: '¿Dónde entregamos?',
                    hint: 'Arrastra el mapa hasta el punto exacto',
                    confirm: 'Confirmar entrega',
                };
            }
            if (context === 'extra-stop' || context === 'hourly-stop') {
                return {
                    title: '¿Dónde es la parada?',
                    hint: 'Arrastra el mapa hasta el punto exacto',
                    confirm: 'Confirmar parada',
                };
            }
            if (context === 'origin' || context === 'staff-origin') {
                return {
                    title: '¿Dónde recogemos?',
                    hint: 'Arrastra el mapa hasta el punto de recogida',
                    confirm: 'Confirmar origen',
                };
            }
            if (context === 'staff-destination') {
                return {
                    title: '¿A dónde va el cliente?',
                    hint: 'Arrastra el mapa hasta el destino',
                    confirm: 'Confirmar destino',
                };
            }
            return {
                title: '¿A dónde vas?',
                hint: 'Arrastra el mapa · el pin se queda en el centro',
                confirm: 'Confirmar destino',
            };
        };

        window.setMapPickAddressPreview = (text, { loading = false } = {}) => {
            const el = document.getElementById('map-pick-address');
            if (!el) return;
            el.textContent = text || '…';
            el.classList.toggle('is-loading', !!loading);
        };

        window.setMapPickPinLifting = (lifting) => {
            const wrap = document.querySelector('#map-pick-overlay .map-pick-pin-wrap');
            if (!wrap) return;
            wrap.classList.toggle('is-lifting', !!lifting);
            if (!lifting) {
                wrap.classList.remove('is-settling');
                // restart bounce animation
                void wrap.offsetWidth;
                wrap.classList.add('is-settling');
                clearTimeout(wrap._settleTimer);
                wrap._settleTimer = setTimeout(() => wrap.classList.remove('is-settling'), 450);
            }
        };

        window.refreshMapPickAddressPreview = () => {
            if (!window._mapPickState || !window.gMap) return;
            clearTimeout(window._mapPickAddressTimer);
            window.setMapPickAddressPreview?.('Buscando dirección…', { loading: true });
            const seq = ++window._mapPickAddressSeq;
            window._mapPickAddressTimer = setTimeout(async () => {
                if (!window._mapPickState || seq !== window._mapPickAddressSeq) return;
                try {
                    const c = window.gMap.getCenter();
                    const geo = await window.reverseGeocodeLatLng?.({ lat: c.lat(), lng: c.lng() });
                    if (!window._mapPickState || seq !== window._mapPickAddressSeq) return;
                    const addr = (geo?.address || '').trim();
                    window.setMapPickAddressPreview?.(
                        addr || `${c.lat().toFixed(5)}, ${c.lng().toFixed(5)}`,
                        { loading: false }
                    );
                    if (window._mapPickState) window._mapPickState.previewGeo = geo || null;
                } catch (_) {
                    if (seq === window._mapPickAddressSeq) {
                        window.setMapPickAddressPreview?.('Mueve el mapa para ver la dirección', { loading: true });
                    }
                }
            }, 280);
        };

        /** Smooth Uber-like pan + zoom toward a point (stepped zoom after pan). */
        window.smoothMapGoTo = (lat, lng, targetZoom = 20) => {
            if (!window.gMap || lat == null || lng == null) return;
            const pos = { lat: Number(lat), lng: Number(lng) };
            if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;

            clearTimeout(window._mapPickSmoothTimer);
            window._mapPickSmoothActive = true;
            const mobile = !!window.isMobileMapPickDevice?.();
            try {
                window.gMap.panTo(pos);
            } catch (_) {
                window._mapPickSmoothActive = false;
                return;
            }

            const done = () => {
                window._mapPickSmoothActive = false;
                window.refreshMapPickAddressPreview?.();
            };

            const finishZoom = () => {
                if (!window.gMap) {
                    window._mapPickSmoothActive = false;
                    return;
                }
                let z;
                try { z = window.gMap.getZoom() || 14; } catch (_) {
                    window._mapPickSmoothActive = false;
                    return;
                }
                // Mobile tiles often cap a bit lower; 20 is still very close street-level
                const goal = Math.min(mobile ? 20 : 21, Math.max(12, Number(targetZoom) || 20));
                if (z === goal) {
                    done();
                    return;
                }

                // On phones: fewer steps so zoom feels smoother (less main-thread churn)
                const stepSize = mobile ? 2 : 1;
                const stepMs = mobile ? 55 : 72;
                const dir = z < goal ? 1 : -1;
                const tick = () => {
                    if (!window.gMap) {
                        window._mapPickSmoothActive = false;
                        return;
                    }
                    let cur;
                    try { cur = window.gMap.getZoom() || z; } catch (_) {
                        window._mapPickSmoothActive = false;
                        return;
                    }
                    const next = cur + (dir * stepSize);
                    if ((dir > 0 && next >= goal) || (dir < 0 && next <= goal)) {
                        try { window.gMap.setZoom(goal); } catch (_) {}
                        done();
                        return;
                    }
                    try { window.gMap.setZoom(next); } catch (_) {}
                    window._mapPickSmoothTimer = setTimeout(tick, stepMs);
                };
                window._mapPickSmoothTimer = setTimeout(tick, mobile ? 120 : 90);
            };

            // Wait a beat for pan to start feeling smooth, then zoom in steps
            window._mapPickSmoothTimer = setTimeout(finishZoom, mobile ? 200 : 160);
        };

        window.applyMapPickMobileMapOptions = (enable) => {
            if (!window.gMap) return;
            try {
                if (enable) {
                    if (window._mapPickPrevMapOpts == null) {
                        window._mapPickPrevMapOpts = {
                            gestureHandling: window.gMap.get('gestureHandling') || 'greedy',
                            draggable: window.gMap.get('draggable') !== false,
                            zoomControl: !!window.gMap.get('zoomControl'),
                            disableDoubleClickZoom: !!window.gMap.get('disableDoubleClickZoom'),
                        };
                    }
                    // One-finger pan/zoom like Uber/Google Maps apps (critical on Capacitor iOS/Android)
                    window.gMap.setOptions({
                        gestureHandling: 'greedy',
                        draggable: true,
                        zoomControl: false,
                        disableDoubleClickZoom: false,
                        clickableIcons: false,
                        keyboardShortcuts: false,
                    });
                } else if (window._mapPickPrevMapOpts) {
                    window.gMap.setOptions({
                        gestureHandling: window._mapPickPrevMapOpts.gestureHandling,
                        draggable: window._mapPickPrevMapOpts.draggable,
                        zoomControl: window._mapPickPrevMapOpts.zoomControl,
                        disableDoubleClickZoom: window._mapPickPrevMapOpts.disableDoubleClickZoom,
                        clickableIcons: true,
                        keyboardShortcuts: true,
                    });
                    window._mapPickPrevMapOpts = null;
                }
            } catch (_) {}
        };

        window.startMapPickMode = (opts = {}) => {
            if (!window.gMap) return window.showToast?.('El mapa aún no está listo.');
            const pickContext = opts.context || 'stop';
            const allowedPickContexts = [
                'destination',
                'extra-stop',
                'hourly-stop',
                'delivery-destination',
                'origin',
                'staff-origin',
                'staff-destination'
            ];
            if (!allowedPickContexts.includes(pickContext)) {
                return window.showToast?.('Selección en mapa no disponible para este campo.');
            }
            window.cancelMapPickMode?.({ silent: true });
            window.hideTripKeyboard?.();
            window._mapPickDragged = false;
            window._mapPickSavedRouteSlot = 2; // slots deprecated for ordering; destination always final, stops follow list order + reordering arrows
            window._mapPickPanelRestore = window.savePanelStateForMapPick?.();
            const copy = mapPickContextCopy(pickContext);
            const mobile = !!window.isMobileMapPickDevice?.();
            window._mapPickState = {
                onSelect: opts.onSelect,
                onCancel: opts.onCancel,
                label: opts.label || (mobile
                    ? 'Desliza el mapa con un dedo · el pin se queda al centro'
                    : copy.hint),
                title: opts.title || copy.title,
                confirmText: opts.confirmText || copy.confirm,
                context: pickContext,
                previewGeo: null,
            };
            document.body.classList.add('map-pick-mode');
            // Prevent iOS/Android body rubber-band scroll while dragging the map
            document.documentElement.classList.add('map-pick-mode');
            window.hidePanelForMapPick?.();
            window.applyMapPickMobileMapOptions?.(true);

            const overlay = document.getElementById('map-pick-overlay');
            const labelEl = document.getElementById('map-pick-label');
            const titleEl = document.getElementById('map-pick-title');
            const confirmTextEl = document.getElementById('map-pick-confirm-text');
            if (titleEl) titleEl.textContent = window._mapPickState.title;
            if (labelEl) labelEl.textContent = window._mapPickState.label;
            if (confirmTextEl) confirmTextEl.textContent = window._mapPickState.confirmText;
            const confirmBtn = document.getElementById('btn-map-pick-confirm');
            if (confirmBtn) confirmBtn.disabled = false;
            window.setMapPickAddressPreview?.('Buscando dirección…', { loading: true });
            window.setMapPickPinLifting?.(false);
            overlay?.classList.remove('hidden');
            overlay?.setAttribute('aria-hidden', 'false');

            // After panel hides, force map relayout so pan/center stay accurate on phones
            const relayout = () => {
                if (!window.gMap || !window._mapPickState) return;
                try {
                    google.maps.event.trigger(window.gMap, 'resize');
                } catch (_) {}
            };
            setTimeout(relayout, 40);
            setTimeout(relayout, 220);
            // Soft first address read (after possible smooth fly-to)
            setTimeout(() => window.refreshMapPickAddressPreview?.(), 360);
        };

        window.confirmMapPick = async () => {
            const state = window._mapPickState;
            if (!state || !window.gMap) return;
            const confirmBtn = document.getElementById('btn-map-pick-confirm');
            if (confirmBtn) confirmBtn.disabled = true;
            try {
                const c = window.gMap.getCenter();
                const latLng = { lat: c.lat(), lng: c.lng() };
                let geo = state.previewGeo;
                const sameCenter = geo?.latLng
                    && Math.abs(geo.latLng.lat - latLng.lat) < 0.00005
                    && Math.abs(geo.latLng.lng - latLng.lng) < 0.00005;
                if (!sameCenter) {
                    geo = await window.reverseGeocodeLatLng(latLng);
                }
                if (!geo?.latLng) geo = { address: geo?.address || '', latLng };
                const saved = window._mapPickPanelRestore;
                let confirmed = false;
                try {
                    await state.onSelect?.(geo);
                    confirmed = true;
                } catch (e) {
                    console.error('confirmMapPick:', e);
                }
                window.cancelMapPickMode({ restorePanel: false });
                if (saved && confirmed) saved.standardStopsAdderOpen = false;
                window.restorePanelAfterMapPick?.(saved);
                window._mapPickPanelRestore = null;
            } finally {
                if (confirmBtn) confirmBtn.disabled = false;
            }
        };

        window.cancelMapPickMode = (opts = {}) => {
            const state = window._mapPickState;
            const saved = window._mapPickPanelRestore;
            window._mapPickState = null;
            window._mapPickDragged = false;
            clearTimeout(window._mapPickSmoothTimer);
            clearTimeout(window._mapPickAddressTimer);
            window._mapPickSmoothTimer = null;
            window._mapPickAddressTimer = null;
            window._mapPickSmoothActive = false;
            window.applyMapPickMobileMapOptions?.(false);
            document.body.classList.remove('map-pick-mode', 'map-pick-mobile');
            document.documentElement.classList.remove('map-pick-mode');
            const overlay = document.getElementById('map-pick-overlay');
            overlay?.classList.add('hidden');
            overlay?.setAttribute('aria-hidden', 'true');
            document.querySelector('#map-pick-overlay .map-pick-pin-wrap')?.classList.remove('is-lifting', 'is-settling');
            if (opts?.restorePanel !== false) {
                window.restorePanelAfterMapPick?.(saved);
            }
            window._mapPickPanelRestore = null;
            // Relayout map after panel returns (phones)
            setTimeout(() => {
                try { google.maps.event.trigger(window.gMap, 'resize'); } catch (_) {}
            }, 80);
            if (!opts?.silent && state?.onCancel) state.onCancel();
        };

        const bindMapPickUiButton = (id, handler) => {
            const btn = document.getElementById(id);
            if (!btn || btn.dataset.mapPickBound === '1') return;
            btn.dataset.mapPickBound = '1';
            let lastTap = 0;
            const run = (e) => {
                // Avoid double-fire: touchend + synthetic click on iOS/Android WebView
                const now = Date.now();
                if (now - lastTap < 450) {
                    e.preventDefault?.();
                    e.stopPropagation?.();
                    return;
                }
                lastTap = now;
                e.preventDefault?.();
                e.stopPropagation?.();
                handler();
            };
            btn.addEventListener('click', run);
            btn.addEventListener('touchend', run, { passive: false });
        };
        bindMapPickUiButton('btn-map-pick-confirm', () => window.confirmMapPick?.());
        bindMapPickUiButton('btn-map-pick-cancel', () => window.cancelMapPickMode?.());

        window._mapPickAtPoint = (latLng) => {
            if (!window._mapPickState || !latLng || !window.gMap) return;
            window.setMapPickPinLifting?.(true);
            window.gMap.panTo(latLng);
            setTimeout(() => {
                if (!window._mapPickState) return;
                window.setMapPickPinLifting?.(false);
                window.refreshMapPickAddressPreview?.();
            }, 220);
        };

        window.gMap.addListener('dragstart', () => {
            if (!window._mapPickState) return;
            window._mapPickDragged = true;
            window._mapPickSmoothActive = false; // user took control
            clearTimeout(window._mapPickSmoothTimer);
            window.setMapPickPinLifting?.(true);
            window.setMapPickAddressPreview?.('Suelta para ver la dirección…', { loading: true });
        });
        window.gMap.addListener('dragend', () => {
            if (!window._mapPickState) return;
            window.setMapPickPinLifting?.(false);
            window.refreshMapPickAddressPreview?.();
            setTimeout(() => { window._mapPickDragged = false; }, 220);
        });
        window.gMap.addListener('idle', () => {
            if (!window._mapPickState || window._mapPickDragged || window._mapPickSmoothActive) return;
            window.refreshMapPickAddressPreview?.();
        });

        // Tap-to-place: useful on desktop; on phones drag is primary (click often fires after drag)
        window.gMap.addListener('click', (e) => {
            if (!window._mapPickState) return;
            if (window._mapPickDragged) {
                window._mapPickDragged = false;
                return;
            }
            // On mobile prefer drag; still allow light tap to recenter
            window._mapPickAtPoint?.({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });

        window.mapLoaded = true;
        window.refreshDemandHeatmapFromCache?.();
        window.refreshOpsFleetMapFromCache?.();
        if (window._pendingPassengerTrackFlush) {
            const flush = window._pendingPassengerTrackFlush;
            window._pendingPassengerTrackFlush = null;
            flush();
        }

        window.setMapFabVisible = (id, visible) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.toggle('hidden', !visible);
        };

        window.hideCenterMapFab = () => {
            // Usado al centrar: reanudar seguimiento de cámara
            window.resumeDriverNavCameraFollow?.();
            window.autoCenter = true;
            window._driverMapFreeLook = false;
            window.setMapFabVisible?.('fab-center', false);
        };

        /** Conductor en viaje: el FAB del mapa no se usa (Centrar va en el panel verde). */
        window.isDriverTripCenterOnPanel = () =>
            document.body.classList.contains('driver-mode')
            && (document.body.classList.contains('trip-active')
                || document.body.classList.contains('driver-nav-mode')
                || document.body.classList.contains('is-navigating'));

        window.showCenterMapFabIfNavigating = () => {
            // Conductor: nunca FAB flotante de centrar
            if (window.isDriverTripCenterOnPanel?.()) {
                window.autoCenter = false;
                window.setMapFabVisible?.('fab-center', false);
                return;
            }
            const navigating = document.body.classList.contains('is-navigating')
                || document.body.classList.contains('driver-nav-mode');
            if (!navigating) return;
            window.autoCenter = false;
            window.setMapFabVisible?.('fab-center', true);
        };

        window.syncNavigationMapFabs = () => {
            const navigating = document.body.classList.contains('is-navigating')
                || document.body.classList.contains('driver-nav-mode');
            const passengerNav = document.body.classList.contains('passenger-nav-mode');
            const driverTrip = document.body.classList.contains('trip-active')
                && document.body.classList.contains('driver-mode');
            // Tráfico: opcional en viaje (no forzar oculto)
            window.setMapFabVisible?.('fab-traffic', navigating && !passengerNav && !driverTrip);
            // Conductor en viaje: Centrar solo en panel verde (no FAB del mapa)
            if (driverTrip || window.isDriverTripCenterOnPanel?.()) {
                window.setMapFabVisible?.('fab-center', false);
                return;
            }
            const followBroken = window.autoCenter === false;
            if (navigating && followBroken) {
                window.setMapFabVisible?.('fab-center', true);
            } else {
                window.setMapFabVisible?.('fab-center', false);
            }
        };

        window.hideCenterMapFab?.();

        /**
         * Usuario mueve el mapa con los dedos (como Google Maps):
         * se pausa el seguimiento de cámara; brújula/GPS siguen midiendo por dentro
         * y no pelean hasta que toque «Centrar».
         */
        window.pauseDriverNavCameraFollow = (reason = 'gesture') => {
            if (window._mapCameraProgrammatic) return;
            const driverTrip = document.body.classList.contains('driver-mode')
                && (document.body.classList.contains('trip-active')
                    || document.body.classList.contains('driver-nav-mode')
                    || document.body.classList.contains('is-navigating'));
            if (!driverTrip && !document.body.classList.contains('is-navigating')) {
                if (document.body.classList.contains('passenger-track-mode')) {
                    window.passengerTrackFollow = false;
                    window.setMapFabVisible?.('fab-center', true);
                }
                return;
            }
            window.autoCenter = false;
            window._driverMapFreeLook = true;
            document.body.classList.add('map-free-look');
            // Brújula sigue actualizando _deviceCompassHeading; el loop de cámara no mueve el mapa
            if (window.isDriverTripCenterOnPanel?.()) {
                window.setMapFabVisible?.('fab-center', false);
            } else {
                window.showCenterMapFabIfNavigating?.();
                window.setMapFabVisible?.('fab-center', true);
            }
            window._driverMapFreeLookReason = reason;
        };

        window.resumeDriverNavCameraFollow = () => {
            window.autoCenter = true;
            window._driverMapFreeLook = false;
            window._driverMapFreeLookReason = null;
            document.body.classList.remove('map-free-look');
            window.setMapFabVisible?.('fab-center', false);
        };

        window.withProgrammaticMapCamera = (fn) => {
            window._mapCameraProgrammatic = true;
            try {
                fn?.();
            } finally {
                // zoom_changed/idle de Maps llegan un tick después
                clearTimeout(window._mapCameraProgrammaticTimer);
                window._mapCameraProgrammaticTimer = setTimeout(() => {
                    window._mapCameraProgrammatic = false;
                }, 120);
            }
        };

        /** Gestos libres en navegación: pan, pellizco, rotar (si el mapa vector lo permite). */
        window.enableDriverMapFreeGestures = () => {
            if (!window.gMap) return;
            try {
                window.gMap.setOptions({
                    gestureHandling: 'greedy',
                    draggable: true,
                    scrollwheel: true,
                    disableDoubleClickZoom: false,
                    isFractionalZoomEnabled: true,
                    // no bloquear tilt/rotate en mapas vector (mapId)
                    headingInteractionEnabled: true,
                    tiltInteractionEnabled: true,
                });
            } catch (_) {
                try {
                    window.gMap.setOptions({
                        gestureHandling: 'greedy',
                        draggable: true,
                        scrollwheel: true,
                    });
                } catch (__) {}
            }
            if (window._driverMapGestureBound) return;
            window._driverMapGestureBound = true;

            const markOfferPreviewUserCamera = () => {
                if (
                    document.body.classList.contains('driver-offer-preview-active')
                    || document.body.classList.contains('driver-offer-popup-open')
                    || document.body.classList.contains('driver-offer-map-peek')
                ) {
                    window._driverOfferPreviewUserCamera = true;
                }
            };

            const onUserGesture = () => {
                markOfferPreviewUserCamera();
                window.pauseDriverNavCameraFollow?.('gesture');
            };

            window.gMap.addListener('dragstart', onUserGesture);
            // Pellizco / zoom manual (ignorar cambios programáticos de la nav)
            window.gMap.addListener('zoom_changed', () => {
                if (window._mapCameraProgrammatic) return;
                // Oferta: cualquier zoom manual del user se respeta (no re-fitBounds)
                markOfferPreviewUserCamera();
                if (window.autoCenter === false) return; // ya en free-look
                // Si el zoom cambió sin drag (pinch), pausar seguimiento
                onUserGesture();
            });
            window.gMap.addListener('tilt_changed', () => {
                if (window._mapCameraProgrammatic) return;
                onUserGesture();
            });
            window.gMap.addListener('heading_changed', () => {
                if (window._mapCameraProgrammatic) return;
                // Rotar el mapa con 2 dedos: no pelear con la brújula
                onUserGesture();
            });

            // Multi-touch en el contenedor (WebView a veces no dispara dragstart al pellizcar)
            const mapEl = document.getElementById('map') || document.getElementById('map-container');
            if (mapEl && mapEl.dataset.freeLookTouchBound !== '1') {
                mapEl.dataset.freeLookTouchBound = '1';
                mapEl.addEventListener('touchstart', (e) => {
                    if (!e.touches || e.touches.length < 1) return;
                    const offerPreview = document.body.classList.contains('driver-offer-preview-active')
                        || document.body.classList.contains('driver-offer-popup-open')
                        || document.body.classList.contains('driver-offer-map-peek');
                    const driverTrip = document.body.classList.contains('driver-mode')
                        && (document.body.classList.contains('trip-active')
                            || document.body.classList.contains('is-navigating'));
                    if (!driverTrip && !offerPreview) return;
                    // 1+ dedos sobre el mapa: si luego se mueve, dragstart lo confirma;
                    // 2 dedos = zoom/rotar → pausar ya y respetar zoom de oferta
                    if (e.touches.length >= 2) {
                        if (offerPreview) window._driverOfferPreviewUserCamera = true;
                        window.pauseDriverNavCameraFollow?.('pinch');
                    }
                }, { passive: true, capture: true });
            }
        };

        window.gMap.addListener('dragstart', () => {
            window.pauseDriverNavCameraFollow?.('drag');
            if (document.body.classList.contains('passenger-track-mode')) {
                window.passengerTrackFollow = false;
                window.setMapFabVisible?.('fab-center', true);
            }
        });
        // Activar gestos greedy desde el inicio
        try { window.enableDriverMapFreeGestures?.(); } catch (_) {}

        const activeZone = window.activeServiceZone;
        if (activeZone?.center) {
            window.updatePlacesLocationBias?.(activeZone.center.lat, activeZone.center.lng);
        } else if (cfg.defaultCenter) {
            window.updatePlacesLocationBias?.(cfg.defaultCenter.lat, cfg.defaultCenter.lng);
        }

        // === Place Autocomplete ===
        const originEl = document.getElementById('origin-autocomplete');
        const destEl = document.getElementById('destination-autocomplete');

        if (originEl && destEl) {
            const countries = (typeof window.getMapCountryRestriction === 'function'
                ? window.getMapCountryRestriction()
                : null) || cfg.countryRestriction || ['hn'];
            try {
                // API nueva (Place Autocomplete Element): includedRegionCodes
                originEl.includedRegionCodes = countries;
                destEl.includedRegionCodes = countries;
            } catch (_) {
                // Fallback silencioso si el navegador no soporta la propiedad
            }

            window.updatePlacesCountryRestriction = (codes) => {
                const list = Array.isArray(codes) && codes.length ? codes : ['hn'];
                [originEl, destEl, document.getElementById('extra-stop-autocomplete')].forEach((el) => {
                    if (!el) return;
                    try { el.includedRegionCodes = list; } catch (_) {}
                });
            };

            const applyLocationBias = (center) => {
                const radius = Math.min(cfg.locationBiasRadius || 50000, 50000);
                const bias = { center, radius };
                originEl.locationBias = bias;
                destEl.locationBias = bias;
                const extraStopBiasEl = document.getElementById('extra-stop-autocomplete');
                if (extraStopBiasEl) {
                    try { extraStopBiasEl.locationBias = bias; } catch (_) {}
                }
            };

            try {
                applyLocationBias(startCenter);
            } catch (_) {}

            window.updatePlacesLocationBias = (lat, lng) => {
                if (!originEl || !destEl || lat == null || lng == null) return;
                try {
                    applyLocationBias({ lat, lng });
                } catch (_) {}
            };

            /** Lee safe-top real (px) inyectado por MainActivity / CSS. */
            const readSearchSafeTopPx = () => (
                typeof window.readSearchSafeTopPx === 'function'
                    ? window.readSearchSafeTopPx()
                    : 48
            );

            const ensureStatusBarShield = () => {
                let el = document.getElementById('status-bar-shield');
                if (!el) {
                    el = document.createElement('div');
                    el.id = 'status-bar-shield';
                    el.setAttribute('aria-hidden', 'true');
                    document.body.appendChild(el);
                }
                return el;
            };

            const restackStatusBarShield = () => {
                try {
                    const el = ensureStatusBarShield();
                    try { el.hidePopover?.(); } catch (_) {}
                    try { el.removeAttribute('popover'); } catch (_) {}
                } catch (_) {}
                return document.getElementById('status-bar-shield');
            };
            window.restackStatusBarShield = restackStatusBarShield;

            const clearControlPanelSearchInline = (panel) => {
                if (!panel) return;
                [
                    'position', 'top', 'bottom', 'left', 'right', 'height', 'max-height',
                    'min-height', 'z-index', 'transform', 'width', 'margin',
                    'opacity', 'visibility', 'pointer-events'
                ].forEach((p) => {
                    try { panel.style.removeProperty(p); } catch (_) {}
                });
            };

            /**
             * Posiciona el panel en píxeles: debajo del reloj, encima del teclado.
             * Con adjustNothing el WebView no se redimensiona; usamos visualViewport.
             */
            const syncTripAutocompleteViewport = () => {
                try {
                    const root = document.documentElement;
                    const open = document.body.classList.contains('trip-autocomplete-open');
                    const vv = window.visualViewport;
                    const layoutH = window.innerHeight || document.documentElement.clientHeight || 0;
                    let offsetTop = 0;
                    let height = layoutH;
                    let keyboard = 0;
                    const safeTop = readSearchSafeTopPx();
                    if (vv) {
                        offsetTop = Math.max(0, Number(vv.offsetTop) || 0);
                        height = Math.max(0, Number(vv.height) || layoutH);
                        keyboard = Math.max(0, layoutH - height - offsetTop);
                        const minPanel = Math.min(240, Math.round(layoutH * 0.42));
                        const maxKb = Math.max(0, layoutH - safeTop - minPanel);
                        if (keyboard > maxKb) keyboard = maxKb;
                    }
                    root.style.setProperty('--vv-height', `${Math.round(height)}px`);
                    root.style.setProperty('--vv-offset-top', `${Math.round(offsetTop)}px`);
                    root.style.setProperty('--keyboard-inset', `${Math.round(keyboard)}px`);
                    root.style.setProperty('--search-safe-top', `${safeTop}px`);
                    const shield = ensureStatusBarShield();
                    shield.style.height = `${safeTop}px`;
                    try { window.applyPlacesOverlaySafeTop?.(); } catch (_) {}

                    if (!open) {
                        try { shield.hidePopover?.(); } catch (_) {}
                        try { shield.style.removeProperty('height'); } catch (_) {}
                        return;
                    }

                    // Bloquear scroll del documento (causa del “mezclado” con la hora)
                    window.scrollTo(0, 0);
                    if (document.documentElement) document.documentElement.scrollTop = 0;
                    if (document.body) document.body.scrollTop = 0;

                    const panel = document.getElementById('control-panel');
                    const native = typeof window.isHrNativeAndroid === 'function'
                        ? window.isHrNativeAndroid()
                        : false;
                    if (panel && native) {
                        panel.style.setProperty('position', 'fixed', 'important');
                        panel.style.setProperty('left', '0px', 'important');
                        panel.style.setProperty('right', '0px', 'important');
                        panel.style.setProperty('width', '100%', 'important');
                        panel.style.setProperty('margin', '0px', 'important');
                        panel.style.setProperty('transform', 'none', 'important');
                        panel.style.setProperty('z-index', '40000', 'important');
                        // Siempre bajo el escudo del reloj (no usar offsetTop: empuja el panel al reloj)
                        panel.style.setProperty('top', `${safeTop}px`, 'important');
                        panel.style.setProperty('bottom', `${Math.round(keyboard)}px`, 'important');
                        panel.style.setProperty('height', 'auto', 'important');
                        panel.style.setProperty('max-height', 'none', 'important');
                        panel.style.setProperty('min-height', '220px', 'important');
                        panel.style.setProperty('opacity', '1', 'important');
                        panel.style.setProperty('pointer-events', 'auto', 'important');
                        panel.style.setProperty('visibility', 'visible', 'important');
                    }
                } catch (_) {}
            };

            const setTripAutocompleteOpen = (on, el = null) => {
                const active = !!on;
                document.body.classList.toggle('trip-autocomplete-open', active);
                try {
                    const panel = document.getElementById('control-panel');
                    panel?.classList.toggle('trip-autocomplete-open', active);
                    if (active) {
                        document.body.classList.remove('panel-minimized', 'panel-collapsed', 'panel-hidden');
                        panel?.classList.remove('panel-collapsed', 'panel-hidden');
                    }
                } catch (_) {}
                ensureStatusBarShield();
                syncTripAutocompleteViewport();
                if (!active) {
                    clearControlPanelSearchInline(document.getElementById('control-panel'));
                    try { document.getElementById('status-bar-shield')?.hidePopover?.(); } catch (_) {}
                    if (window._hrPlacesSafeTopPulse) {
                        clearInterval(window._hrPlacesSafeTopPulse);
                        window._hrPlacesSafeTopPulse = null;
                    }
                    return;
                }
                restackStatusBarShield();
                const native = typeof window.isHrNativeAndroid === 'function' && window.isHrNativeAndroid();
                if (native && !window._hrPlacesSafeTopPulse) {
                    window._hrPlacesSafeTopPulse = setInterval(() => {
                        if (!document.body.classList.contains('trip-autocomplete-open')) {
                            clearInterval(window._hrPlacesSafeTopPulse);
                            window._hrPlacesSafeTopPulse = null;
                            return;
                        }
                        window.applyPlacesOverlaySafeTop?.();
                    }, 450);
                }
                // Re-aplicar varias veces: el teclado tarda en reportar altura
                // y el overlay de Places sube a la top layer un frame después.
                [0, 40, 100, 200, 350, 500, 800].forEach((ms) => {
                    setTimeout(() => {
                        if (document.body.classList.contains('trip-autocomplete-open')) {
                            syncTripAutocompleteViewport();
                            restackStatusBarShield(ms === 100 || ms === 350 || ms === 800);
                            window.applyPlacesOverlaySafeTop?.();
                        }
                    }, ms);
                });
                if (el) {
                    requestAnimationFrame(() => {
                        try {
                            const panel = document.getElementById('panel-content');
                            const wrap = el.closest?.('.trip-origin-wrap, .trip-dest-wrap, .trip-extra-stop-wrap')
                                || el.parentElement;
                            if (panel && wrap && panel.contains(wrap)) {
                                // Campo de búsqueda arriba del sheet (bajo el reloj, no bajo el teclado)
                                panel.scrollTop = Math.max(0, wrap.offsetTop - 12);
                            }
                            window.scrollTo(0, 0);
                        } catch (_) {}
                    });
                }
            };

            if (!window._tripAutocompleteViewportBound) {
                window._tripAutocompleteViewportBound = true;
                const onVv = () => {
                    if (!document.body.classList.contains('trip-autocomplete-open')) return;
                    syncTripAutocompleteViewport();
                };
                window.visualViewport?.addEventListener('resize', onVv, { passive: true });
                window.visualViewport?.addEventListener('scroll', onVv, { passive: true });
                window.addEventListener('resize', onVv, { passive: true });
                // Cualquier scroll del documento → volver a 0 en modo búsqueda
                window.addEventListener('scroll', () => {
                    if (!document.body.classList.contains('trip-autocomplete-open')) return;
                    window.scrollTo(0, 0);
                }, { passive: true, capture: true });
            }
            window.syncTripAutocompleteViewport = syncTripAutocompleteViewport;
            window.setTripAutocompleteOpen = setTripAutocompleteOpen;

            const clearAutocompleteStack = (el) => {
                const wrap = el?.closest?.('.trip-origin-wrap, .trip-dest-wrap, .trip-extra-stop-wrap') || el?.parentElement;
                wrap?.classList.remove('is-autocomplete-active');
                try { el?._clearAutocompleteStack?.(); } catch (_) {}
                // Si ningún campo de ruta sigue activo, soltar modo teclado
                const still = document.querySelector(
                    '.trip-origin-wrap.is-autocomplete-active, .trip-dest-wrap.is-autocomplete-active, .trip-extra-stop-wrap.is-autocomplete-active'
                );
                if (!still) setTripAutocompleteOpen(false);
            };

            /** Blur de gmp-place-autocomplete (shadow input). En APK el teclado no se cierra solo al elegir lugar. */
            const blurAutocompleteEl = (el) => {
                if (!el) return;
                try {
                    const input = el.shadowRoot?.querySelector('input')
                        || el.shadowRoot?.querySelector('[part="input"]')
                        || el.querySelector?.('input');
                    input?.blur?.();
                } catch (_) {}
                try { el.blur?.(); } catch (_) {}
            };

            /**
             * Cierra teclado Android/WebView al confirmar origen/destino.
             * Google a veces re-enfoca el input; por eso se reintenta en frames cortos.
             */
            window.hideTripKeyboard = (preferredEl = null) => {
                const ids = ['origin-autocomplete', 'destination-autocomplete', 'extra-stop-autocomplete'];
                if (preferredEl) blurAutocompleteEl(preferredEl);
                ids.forEach((id) => blurAutocompleteEl(document.getElementById(id)));
                try {
                    const active = document.activeElement;
                    if (active && active !== document.body && typeof active.blur === 'function') {
                        // No robar foco del chat u otros formularios
                        if (!active.closest?.('#chat-float, #chat-compose-form, #chat-input, [data-keep-keyboard]')) {
                            active.blur();
                        }
                    }
                } catch (_) {}
                try {
                    document.querySelectorAll(
                        '.trip-origin-wrap.is-autocomplete-active, .trip-dest-wrap.is-autocomplete-active, .trip-extra-stop-wrap.is-autocomplete-active'
                    ).forEach((w) => w.classList.remove('is-autocomplete-active'));
                    setTripAutocompleteOpen(false);
                } catch (_) {}
            };

            const dismissAutocompleteUi = (el) => {
                clearAutocompleteStack(el);
                window.hideTripKeyboard?.(el);
                // Reintentos: Places a veces devuelve el foco al input tras gmp-select
                requestAnimationFrame(() => window.hideTripKeyboard?.(el));
                setTimeout(() => window.hideTripKeyboard?.(el), 80);
                setTimeout(() => window.hideTripKeyboard?.(el), 220);
            };

            const applyEndpointLabelToInput = (el, label) => {
                const text = String(label || '').trim();
                if (!el || !text) return;
                try { el.value = text; } catch (_) {}
                try {
                    const input = el.shadowRoot?.querySelector('input')
                        || el.shadowRoot?.querySelector('[part="input"]')
                        || el.querySelector('input');
                    if (input) {
                        input.value = text;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                } catch (_) {}
            };

            const newPlacesSessionToken = async (el) => {
                try {
                    const lib = await google.maps.importLibrary('places');
                    const Token = lib.AutocompleteSessionToken || google.maps.places?.AutocompleteSessionToken;
                    if (Token && el) el._placesSessionToken = new Token();
                } catch (_) {}
            };
            newPlacesSessionToken(originEl);
            newPlacesSessionToken(destEl);

            const onPlaceSelect = async (event, el) => {
                const snap = window.captureRouteFieldSnapshot?.(el);
                try {
                    let place = event.place || null;
                    if (!place && event.placePrediction) {
                        place = event.placePrediction.toPlace();
                    }
                    if (place?.fetchFields) {
                        const fetchOpts = { fields: ['formattedAddress', 'displayName', 'location', 'id'] };
                        if (el._placesSessionToken) fetchOpts.sessionToken = el._placesSessionToken;
                        await place.fetchFields(fetchOpts);
                        newPlacesSessionToken(el);
                        const endpoint = window.placeToRouteEndpoint?.(place, window.readAutocompleteText?.(el));
                        const nextAddr = endpoint?.address || window.readAutocompleteText?.(el) || '';
                        const ok = await window.guardRouteEndpointChange?.(el, nextAddr);
                        if (!ok) {
                            window.restoreRouteFieldSnapshot?.(el, snap);
                            dismissAutocompleteUi(el);
                            return;
                        }
                        el._selectedPlace = place;
                        el.place = place;
                        window.storeRouteEndpoint?.(el, endpoint);
                        // Mostrar el nombre del mapa (ej. "Liceo Jesús"), no solo la calle larga
                        applyEndpointLabelToInput(el, nextAddr);
                        // Origen elegido a mano: actualizar ciudad al punto seleccionado
                        if (el === originEl || el?.id === 'origin-autocomplete') {
                            window._passengerOriginUserCleared = false;
                            const ll = endpoint?.latLng;
                            if (ll?.lat != null && ll?.lng != null) {
                                window.syncCityFromOriginCoords?.(ll.lat, ll.lng, { silent: false });
                            }
                            window.updateOriginGPSButton?.();
                        }
                    }
                } catch (_) {}
                dismissAutocompleteUi(el);
                // Importante: limpiar currentRouteData para que al elegir otra ruta se recalculen los precios de moto, taxi y VIP
                window.currentRouteData = null;
                window.dispatchEvent(new CustomEvent('map-route-trigger'));
                window.showServiceOptionsIfReady?.();
            };

            const bindPlaceSelect = (el) => {
                el.addEventListener('gmp-select', (e) => onPlaceSelect(e, el));
                el.addEventListener('gmp-placeselect', (e) => onPlaceSelect(e, el));
            };

            bindPlaceSelect(originEl);
            bindPlaceSelect(destEl);

            const extraStopEl = document.getElementById('extra-stop-autocomplete');
            if (extraStopEl) {
                try {
                    extraStopEl.includedRegionCodes = countries;
                } catch (_) {}
                try {
                    extraStopEl.locationBias = { center: comayaguaCoords, radius: Math.min(cfg.locationBiasRadius || 50000, 50000) };
                } catch (_) {}
                bindPlaceSelect(extraStopEl);
            }

            const syncAutocompleteDraft = async (el) => {
                const text = window.readAutocompleteText?.(el) || '';
                const current = el._routeEndpoint;
                const snap = window.captureRouteFieldSnapshot?.(el);

                if (!text || text.length < 3) {
                    // Clear endpoint on empty or very short (including after clicking X)
                    if (current && current.address) {
                        const ok = await window.guardRouteEndpointChange?.(el, '');
                        if (!ok) {
                            window.restoreRouteFieldSnapshot?.(el, snap);
                            return;
                        }
                        window.storeRouteEndpoint?.(el, null);  // clear endpoint
                        window.currentRouteData = null;
                        window.showServiceOptionsIfReady?.();
                        if (window.currentTripQuote) {
                            document.getElementById('fare-card')?.classList.add('hidden');
                            window.currentTripQuote = null;
                        }
                    }
                    // Origen borrado: no rellenar solo con GPS; el usuario puede poner lo que guste o tocar la cruz
                    if (el === originEl || el?.id === 'origin-autocomplete') {
                        window.markPassengerOriginUserCleared?.();
                        window.updateOriginGPSButton?.();
                    }
                    return;
                }

                if (current?.source === 'gps' || current?.source === 'map') {
                    const fixedAddr = (current.gpsAddress || current.address || '').trim();
                    if (text.trim() !== fixedAddr) {
                        const ok = await window.guardRouteEndpointChange?.(el, text.trim());
                        if (!ok) {
                            window.restoreRouteFieldSnapshot?.(el, snap);
                            return;
                        }
                        window.storeRouteEndpoint?.(el, {
                            address: text,
                            latLng: null,
                            place: null,
                            source: 'manual'
                        });
                        window.currentRouteData = null;
                        window.showServiceOptionsIfReady?.();
                        if (el === originEl && window.updateOriginGPSButton) {
                            window.updateOriginGPSButton();
                        }
                        if (el === destEl && window.updateDestinationMapButton) {
                            window.updateDestinationMapButton();
                        }
                        return;
                    }
                }

                if (current?.address === text && current?.latLng) return;

                if (current?.address && current.address.trim() !== text.trim()) {
                    const ok = await window.guardRouteEndpointChange?.(el, text.trim());
                    if (!ok) {
                        window.restoreRouteFieldSnapshot?.(el, snap);
                        return;
                    }
                }

                window.storeRouteEndpoint?.(el, {
                    address: text,
                    latLng: current?.source === 'gps' ? (current?.latLng || null) : (current?.latLng || null),
                    place: current?.place || el._selectedPlace || null,
                    source: current?.source === 'gps' ? 'gps' : (current?.place || el._selectedPlace ? 'place' : 'manual'),
                    gpsAddress: current?.gpsAddress || null
                });
                window.currentRouteData = null;
                window.showServiceOptionsIfReady?.();
                if (window.currentTripQuote) {
                    document.getElementById('fare-card')?.classList.add('hidden');
                    window.currentTripQuote = null;
                }

                // Update GPS button visibility if this is the origin
                if (el === originEl && window.updateOriginGPSButton) {
                    window.updateOriginGPSButton();
                }

                // Solo estimar tarifa cuando ya hay coordenadas (Places/GPS). No Routes API al escribir.
                clearTimeout(window._routeRecalcTimer);
                window._routeRecalcTimer = setTimeout(() => {
                    const oEl2 = document.getElementById('origin-autocomplete');
                    const dEl2 = document.getElementById('destination-autocomplete');
                    if (!oEl2 || !dEl2) return;
                    const oLl = oEl2._routeEndpoint?.latLng;
                    const dLl = dEl2._routeEndpoint?.latLng;
                    if (oLl?.lat != null && dLl?.lat != null) {
                        window.calculateTripRoute?.({ silent: true, estimateOnly: true });
                    }
                }, 450);
            };

            const attachAutocompleteInputWatch = (el) => {
                const hookInput = () => {
                    const input = el.shadowRoot?.querySelector('input')
                        || el.shadowRoot?.querySelector('[part="input"]')
                        || el.querySelector('input');
                    if (!input || input.dataset.honduberHooked === '1') return !!input;
                    input.dataset.honduberHooked = '1';
                    const sync = () => { void syncAutocompleteDraft(el); };
                    input.addEventListener('input', sync);
                    input.addEventListener('change', sync);
                    input.addEventListener('blur', sync);
                    input.addEventListener('focus', () => { void newPlacesSessionToken(el); });
                    return true;
                };
                if (!hookInput()) {
                    const obs = new MutationObserver(() => {
                        if (hookInput()) obs.disconnect();
                    });
                    obs.observe(el, { childList: true, subtree: true });
                }
            };

            attachAutocompleteInputWatch(originEl);
            attachAutocompleteInputWatch(destEl);

            const attachAutocompleteStackFix = (el, wrapClass) => {
                const wrap = el.closest?.(wrapClass) || el.parentElement;
                if (!wrap) return;
                let blurTimer = null;
                const setActive = (on) => {
                    wrap.classList.toggle('is-autocomplete-active', on);
                    const native = typeof window.isHrNativeAndroid === 'function' && window.isHrNativeAndroid();
                    if (on) {
                        if (native) setTripAutocompleteOpen(true, el);
                    } else {
                        const still = document.querySelector(
                            '.trip-origin-wrap.is-autocomplete-active, .trip-dest-wrap.is-autocomplete-active, .trip-extra-stop-wrap.is-autocomplete-active'
                        );
                        if (!still) setTripAutocompleteOpen(false);
                    }
                };
                const deactivate = () => {
                    clearTimeout(blurTimer);
                    setActive(false);
                };
                el._clearAutocompleteStack = deactivate;
                const hookInput = () => {
                    const input = el.shadowRoot?.querySelector('input')
                        || el.shadowRoot?.querySelector('[part="input"]')
                        || el.querySelector('input');
                    if (!input || input.dataset.stackHooked === '1') return !!input;
                    input.dataset.stackHooked = '1';
                    input.addEventListener('focus', () => {
                        clearTimeout(blurTimer);
                        setActive(true);
                        // Android a veces scrollea el doc; re-anclar tras abrir teclado
                        setTimeout(syncTripAutocompleteViewport, 50);
                        setTimeout(syncTripAutocompleteViewport, 180);
                        setTimeout(syncTripAutocompleteViewport, 360);
                    });
                    // Borrar origen y seguir escribiendo: mantener modo búsqueda activo
                    input.addEventListener('input', () => {
                        clearTimeout(blurTimer);
                        setActive(true);
                        syncTripAutocompleteViewport();
                    });
                    input.addEventListener('click', () => {
                        clearTimeout(blurTimer);
                        setActive(true);
                        syncTripAutocompleteViewport();
                    });
                    input.addEventListener('blur', () => {
                        clearTimeout(blurTimer);
                        blurTimer = setTimeout(deactivate, 220);
                    });
                    return true;
                };
                if (!hookInput()) {
                    const obs = new MutationObserver(() => {
                        if (hookInput()) obs.disconnect();
                    });
                    obs.observe(el, { childList: true, subtree: true });
                }
                el.addEventListener('focus', () => {
                    clearTimeout(blurTimer);
                    setActive(true);
                    setTimeout(syncTripAutocompleteViewport, 50);
                    setTimeout(syncTripAutocompleteViewport, 200);
                }, true);
                el.addEventListener('blur', () => {
                    clearTimeout(blurTimer);
                    blurTimer = setTimeout(deactivate, 180);
                }, true);
            };

            attachAutocompleteStackFix(originEl, '.trip-origin-wrap');
            attachAutocompleteStackFix(destEl, '.trip-dest-wrap');
            if (extraStopEl) {
                attachAutocompleteStackFix(extraStopEl, '.trip-extra-stop-wrap');
            }

            // === Origin actions: pin siempre visible; GPS solo si el campo está vacío ===
            const gpsBtn = document.getElementById('btn-use-location');
            const originMapBtn = document.getElementById('btn-origin-map');
            if (gpsBtn || originMapBtn) {
                const updateGPSBtn = () => {
                    const text = window.readAutocompleteText?.(originEl) || '';
                    const hasValue = text.trim().length > 0;
                    if (gpsBtn) gpsBtn.style.display = hasValue ? 'none' : '';
                    if (originMapBtn) {
                        originMapBtn.classList.remove('hidden');
                        originMapBtn.style.display = '';
                    }
                    // Espacio para pin (siempre) + GPS (si vacío)
                    if (originEl) {
                        originEl.style.paddingRight = hasValue ? '52px' : '5.5rem';
                    }
                };

                window.updateOriginGPSButton = updateGPSBtn; // expose for other code
                window.updateOriginMapButton = updateGPSBtn;

                // Update on input events (including when clear X is clicked, which triggers input/change)
                const hookForGPS = () => {
                    const input = originEl.shadowRoot?.querySelector('input')
                        || originEl.shadowRoot?.querySelector('[part="input"]')
                        || originEl.querySelector('input');
                    if (input && !input.dataset.gpsHooked) {
                        input.dataset.gpsHooked = '1';
                        input.addEventListener('input', updateGPSBtn);
                        input.addEventListener('change', updateGPSBtn);
                        // Also on clear if component fires specific
                        if (input.parentElement) {
                            // sometimes clear is a button inside
                            const clearBtn = input.parentElement.querySelector('button[aria-label*="clear"], .clear-button, [part="clear"]');
                            if (clearBtn) clearBtn.addEventListener('click', () => setTimeout(updateGPSBtn, 50));
                        }
                    }
                };

                // Try to hook immediately, and observe if shadow not ready yet
                hookForGPS();
                const obs = new MutationObserver(() => hookForGPS());
                obs.observe(originEl, { childList: true, subtree: true });

                // Extra robust: observe the origin component itself for any value/ clear changes
                const originObs = new MutationObserver(() => updateGPSBtn());
                originObs.observe(originEl, { attributes: true, childList: true, subtree: true, characterData: true });

                // Listen directly on the host for input/change (more reliable for clear X)
                originEl.addEventListener('input', updateGPSBtn, true);
                originEl.addEventListener('change', updateGPSBtn, true);

                // Extra: on click/focus to catch clear actions
                originEl.addEventListener('click', () => setTimeout(updateGPSBtn, 80));
                originEl.addEventListener('focus', () => setTimeout(updateGPSBtn, 50));
                originEl.addEventListener('blur', () => setTimeout(updateGPSBtn, 50));
                originEl.addEventListener('keyup', updateGPSBtn);

                // Initial state: ensure visible if empty
                setTimeout(() => {
                    updateGPSBtn();
                }, 250);

                // Also update when route is triggered or value set externally (GPS, etc.)
                window.addEventListener('map-route-trigger', updateGPSBtn);
                document.addEventListener('input', (e) => {
                    if (e.target.closest('#origin-autocomplete')) updateGPSBtn();
                }, true);
            }

            // === Destination map pin: always available; keep padding so text doesn't overlap ===
            const destMapBtn = document.getElementById('btn-dest-map');
            if (destMapBtn && destEl) {
                const updateDestMapBtn = () => {
                    destMapBtn.classList.remove('hidden');
                    destMapBtn.style.display = '';
                    destEl.style.paddingRight = '52px';
                };
                window.updateDestinationMapButton = updateDestMapBtn;
                updateDestMapBtn();
                window.addEventListener('map-route-trigger', updateDestMapBtn);
            }
        }

        window.placeToRouteEndpoint = (place, fallbackText = '') => {
            if (!place) return null;
            const loc = place.location || place.latLng || place;
            let lat = null, lng = null;
            if (loc) {
                if (typeof loc.lat === 'function') {
                    lat = loc.lat();
                    lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
                } else if (loc.latitude != null && loc.longitude != null) {
                    lat = loc.latitude;
                    lng = loc.longitude;
                } else {
                    lat = loc.lat;
                    lng = loc.lng;
                }
            }
            const nlat = Number(lat);
            const nlng = Number(lng);
            // Preferir el nombre del lugar en el mapa (displayName) sobre la dirección de calle larga
            const placeName = window.placeDisplayName?.(place) || '';
            const formatted = place.formattedAddress || place.formatted_address || '';
            const address = placeName || formatted || fallbackText || '';
            const latLng = (!isNaN(nlat) && !isNaN(nlng)) ? { lat: nlat, lng: nlng } : null;
            return {
                address,
                placeName: placeName || null,
                formattedAddress: formatted || null,
                latLng,
                place,
                source: 'place',
            };
        };

        window.storeRouteEndpoint = (el, endpoint) => {
            if (!el) return;
            if (!endpoint || !endpoint.address) {
                el._routeEndpoint = null;
                return;
            }
            el._routeEndpoint = endpoint;
        };

    } catch (error) {
        console.error("Error crítico en initMap:", error);
    }
};
           
  window.removeDriverMarker = (driverId) => {
    const marker = window.driverMarkers?.[driverId];
    if (!marker) return;
    if (marker.map !== undefined) {
        marker.map = null;
    } else if (typeof marker.setMap === 'function') {
        marker.setMap(null);
    }
    delete window.driverMarkers[driverId];
    if (window._driverMarkerMeta) delete window._driverMarkerMeta[driverId];
  };

  window.clearNearbyDriverMarkers = (exceptId = null) => {
    if (!window.driverMarkers) return;
    Object.keys(window.driverMarkers).forEach((id) => {
      if (exceptId && id === exceptId) return;
      window.removeDriverMarker(id);
    });
  };

  // Helper to create proper car and motorcycle SVG icons (shaped, not circles)
  // Color is baked in. Used for both classic Marker url icons and Advanced <img>
  window.createVehicleIcon = (vehicleType = 'auto', color = '#10b981') => {
    const type = vehicleType || 'auto';
    let svg;

    if (type === 'moto') {
      // Modern 2026 sport motorcycle
      svg = `<svg width="56" height="36" viewBox="0 0 56 36" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="mG" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${color}"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
          <filter id="ms" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#000" flood-opacity="0.35"/>
          </filter>
        </defs>
        <circle cx="12" cy="26" r="8.5" fill="#0f172a" stroke="#475569" stroke-width="2"/>
        <circle cx="12" cy="26" r="5" fill="#64748b"/>
        <circle cx="12" cy="26" r="2" fill="#1e293b"/>
        <circle cx="44" cy="26" r="8.5" fill="#0f172a" stroke="#475569" stroke-width="2"/>
        <circle cx="44" cy="26" r="5" fill="#64748b"/>
        <circle cx="44" cy="26" r="2" fill="#1e293b"/>
        <path d="M16 13 Q24 5 34 6 L42 13 Q45 18 41 24 L17 24 Q13 19 16 13" fill="url(#mG)" stroke="#020617" stroke-width="1.2" filter="url(#ms)"/>
        <ellipse cx="26" cy="11" rx="6" ry="4" fill="#1e293b"/>
        <path d="M30 10 L40 9 L41 15 L31 15" fill="#020617"/>
        <ellipse cx="40" cy="14" rx="3" ry="2" fill="#e0f2fe"/>
        <path d="M35 10 L40 4" stroke="#475569" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="40" cy="4" r="1.8" fill="#334155"/>
        <rect x="8" y="21" width="5" height="3" rx="1" fill="#334155"/>
      </svg>`;
    } else if (type === 'paila') {
      svg = `<svg width="62" height="30" viewBox="0 0 62 30" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="pG" x1="0" y1="4" x2="0" y2="26">
            <stop offset="0%" stop-color="${color}"/>
            <stop offset="100%" stop-color="#064e3b"/>
          </linearGradient>
          <filter id="ps" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-opacity="0.3"/>
          </filter>
        </defs>
        <path d="M4 14 L10 8 L18 8 L22 12 L48 12 L52 8 L58 10 L58 20 L52 22 L10 22 Q4 21 4 16 Z" fill="url(#pG)" stroke="#064e3b" stroke-width="0.8" filter="url(#ps)"/>
        <rect x="24" y="6" width="22" height="6" rx="1" fill="#064e3b" opacity="0.35"/>
        <circle cx="16" cy="22" r="5.5" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
        <circle cx="16" cy="22" r="3" fill="#334155"/>
        <circle cx="48" cy="22" r="5.5" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
        <circle cx="48" cy="22" r="3" fill="#334155"/>
      </svg>`;
    } else if (type === 'camion') {
      svg = `<svg width="66" height="32" viewBox="0 0 66 32" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="kG" x1="0" y1="4" x2="0" y2="28">
            <stop offset="0%" stop-color="${color}"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
          <filter id="ks" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-opacity="0.3"/>
          </filter>
        </defs>
        <path d="M4 14 L12 8 L22 8 L26 12 L58 12 L62 16 L62 22 L56 24 L12 24 Q4 23 4 18 Z" fill="url(#kG)" stroke="#1e293b" stroke-width="0.8" filter="url(#ks)"/>
        <rect x="28" y="6" width="30" height="6" rx="1" fill="#1e293b" opacity="0.35"/>
        <rect x="14" y="10" width="10" height="8" rx="1" fill="#bae6fd" opacity="0.45"/>
        <circle cx="18" cy="24" r="5.5" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
        <circle cx="18" cy="24" r="3" fill="#334155"/>
        <circle cx="52" cy="24" r="5.5" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
        <circle cx="52" cy="24" r="3" fill="#334155"/>
      </svg>`;
    } else if (type === 'taxi' || type === 'taxi_vip' || type === 'vip') {
      // Traditional Taxi T- or VIP : yellow with roof sign
      svg = `<svg width="60" height="28" viewBox="0 0 60 28" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="tG" x1="0" y1="4" x2="0" y2="26">
            <stop offset="0%" stop-color="#facc15"/>
            <stop offset="100%" stop-color="#854d0e"/>
          </linearGradient>
          <filter id="ts" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-opacity="0.3"/>
          </filter>
        </defs>
        <path d="M3 13 Q3 6 11 6 L49 6 Q57 7 57 13 L57 19 Q56 23 48 23 L8 23 Q3 22 3 18 Z" fill="url(#tG)" stroke="#713f12" stroke-width="0.8" filter="url(#ts)"/>
        <path d="M12 6 Q15 2 30 2 Q45 2 48 6" fill="#111827"/>
        <rect x="26" y="0" width="8" height="3" rx="1" fill="#111827"/>
        <text x="30" y="3" font-size="3" fill="#facc15" text-anchor="middle" font-weight="bold">T</text>
        <path d="M13 5.5 Q17 3 28 3 Q39 3 43 5.5" fill="#bae6fd" opacity="0.5"/>
        <circle cx="14" cy="20" r="5.5" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
        <circle cx="14" cy="20" r="3" fill="#334155"/>
        <circle cx="14" cy="20" r="1" fill="#64748b"/>
        <circle cx="46" cy="20" r="5.5" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
        <circle cx="46" cy="20" r="3" fill="#334155"/>
        <circle cx="46" cy="20" r="1" fill="#64748b"/>
        <path d="M22 8 L22 20" stroke="#713f12" stroke-width="0.5" opacity="0.5"/>
      </svg>`;
    } else {
      // Modern car (auto / Taxi VIP)
      svg = `<svg width="60" height="28" viewBox="0 0 60 28" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cg" x1="0" y1="4" x2="0" y2="26">
            <stop offset="0%" stop-color="${color}"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
          <filter id="cs" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="1" dy="2.5" stdDeviation="2" flood-opacity="0.35"/>
          </filter>
        </defs>
        <path d="M3 13 Q3 6 11 6 L49 6 Q57 7 57 13 L57 19 Q56 23 48 23 L8 23 Q3 22 3 18 Z" fill="url(#cg)" stroke="#0f172a" stroke-width="0.8" filter="url(#cs)"/>
        <path d="M11 6 Q15 1 30 1 Q45 1 49 6" fill="none" stroke="#1e293b" stroke-width="5.5"/>
        <path d="M12 5 Q16 2 29 2 Q42 2 46 5" fill="#bae6fd" opacity="0.4"/>
        <path d="M52 9 L57 10 L57 13 L52 13 Z" fill="#f8fafc"/>
        <rect x="4" y="10" width="5" height="3" rx="1" fill="#f87171"/>
        <circle cx="14" cy="20" r="6" fill="#0f172a" stroke="#475569" stroke-width="1.8"/>
        <circle cx="14" cy="20" r="3.5" fill="#334155"/>
        <circle cx="14" cy="20" r="1.2" fill="#64748b"/>
        <circle cx="46" cy="20" r="6" fill="#0f172a" stroke="#475569" stroke-width="1.8"/>
        <circle cx="46" cy="20" r="3.5" fill="#334155"/>
        <circle cx="46" cy="20" r="1.2" fill="#64748b"/>
        <path d="M9 9 L49 9" stroke="#1e293b" stroke-width="0.7" opacity="0.35"/>
      </svg>`;
    }
    return 'data:image/svg+xml;base64,' + btoa(svg);
  };

  window.createNavChevronIcon = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r="18" fill="#4285F4" stroke="#fff" stroke-width="3"/>
      <path d="M22 10 L30 28 L22 24 L14 28 Z" fill="#fff"/>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  };

  window._vehicleIconCache = window._vehicleIconCache || {};
  window._topDownVehicleIconCache = window._topDownVehicleIconCache || {};
  window._driverMarkerMeta = window._driverMarkerMeta || {};

  window.getCachedVehicleIconUrl = (vehicleType, bg) => {
      const key = `${vehicleType}:${bg}`;
      if (!window._vehicleIconCache[key]) {
          window._vehicleIconCache[key] = window.createVehicleIcon(vehicleType, bg);
      }
      return window._vehicleIconCache[key];
  };

  /**
   * Carrito VISTA DESDE ARRIBA — diseño limpio tipo Maps/Uber (no “bicho”).
   * Frente del vehículo = arriba del SVG. Gira con brújula/GPS.
   */
  window.createTopDownVehicleIcon = (vehicleType = 'auto', color = '#2563eb') => {
      const type = vehicleType || 'auto';
      // ids únicos por color para no chocar gradientes al reusar cache
      const uid = String(color).replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'c';
      let svg;

      if (type === 'moto') {
          svg = `<svg width="36" height="52" viewBox="0 0 36 52" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="mg${uid}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${color}"/>
                <stop offset="100%" stop-color="#1e1b4b"/>
              </linearGradient>
              <filter id="mf${uid}" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity="0.35"/>
              </filter>
            </defs>
            <ellipse cx="18" cy="14" rx="6" ry="8" fill="url(#mg${uid})" stroke="#0f172a" stroke-width="1" filter="url(#mf${uid})"/>
            <rect x="13.5" y="18" width="9" height="16" rx="3.5" fill="url(#mg${uid})" stroke="#0f172a" stroke-width="0.9"/>
            <ellipse cx="18" cy="38" rx="7" ry="6.5" fill="#1e293b" stroke="#0f172a" stroke-width="1"/>
            <ellipse cx="18" cy="38" rx="3.5" ry="3" fill="#475569"/>
            <circle cx="18" cy="11" r="2" fill="#e0f2fe"/>
            <rect x="15.5" y="24" width="5" height="6" rx="1.2" fill="#0f172a" opacity="0.3"/>
          </svg>`;
      } else if (type === 'taxi' || type === 'taxi_vip' || type === 'vip') {
          // Sedán top-down limpio + techo taxi
          svg = `<svg width="42" height="58" viewBox="0 0 42 58" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="tg${uid}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#fde047"/>
                <stop offset="55%" stop-color="#facc15"/>
                <stop offset="100%" stop-color="#a16207"/>
              </linearGradient>
              <filter id="tf${uid}" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="1.2" stdDeviation="1.3" flood-opacity="0.4"/>
              </filter>
            </defs>
            <!-- ruedas -->
            <rect x="5" y="16" width="4" height="9" rx="1.5" fill="#0f172a"/>
            <rect x="33" y="16" width="4" height="9" rx="1.5" fill="#0f172a"/>
            <rect x="5" y="33" width="4" height="9" rx="1.5" fill="#0f172a"/>
            <rect x="33" y="33" width="4" height="9" rx="1.5" fill="#0f172a"/>
            <!-- carrocería ancha y corta -->
            <path d="M11 9
              C13 5.5 17 4 21 4
              C25 4 29 5.5 31 9
              L34 18
              C35.5 21 35.5 24 34.5 27
              L33.5 40
              C33 46 28 50 21 50.5
              C14 50 9 46 8.5 40
              L7.5 27
              C6.5 24 6.5 21 8 18
              Z"
              fill="url(#tg${uid})" stroke="#713f12" stroke-width="1" filter="url(#tf${uid})"/>
            <!-- parabrisas -->
            <path d="M14 12 C17 9.5 21 9 25 9.5 C28 10 29 12 29.5 14.5 L29 20 C21 18.5 13.5 19 13 20.5 Z"
                  fill="#7dd3fc" opacity="0.9"/>
            <!-- techo -->
            <rect x="14.5" y="21.5" width="13" height="11" rx="2.2" fill="#0f172a" opacity="0.18"/>
            <!-- luneta -->
            <path d="M13.5 35 L28.5 35 L28 42 C21 43.5 14 42.5 13.5 41.5 Z" fill="#38bdf8" opacity="0.45"/>
            <!-- letrero taxi -->
            <rect x="16" y="2.2" width="10" height="3.2" rx="0.7" fill="#1e293b"/>
            <!-- luces -->
            <rect x="12" y="7.5" width="4" height="2.2" rx="0.6" fill="#fef9c3"/>
            <rect x="26" y="7.5" width="4" height="2.2" rx="0.6" fill="#fef9c3"/>
            <rect x="12.5" y="47.5" width="3.5" height="2" rx="0.5" fill="#ef4444"/>
            <rect x="26" y="47.5" width="3.5" height="2" rx="0.5" fill="#ef4444"/>
          </svg>`;
      } else if (type === 'camion' || type === 'paila') {
          svg = `<svg width="44" height="60" viewBox="0 0 44 60" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="cg${uid}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${color}"/>
                <stop offset="100%" stop-color="#1e293b"/>
              </linearGradient>
              <filter id="cf${uid}" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="1.2" stdDeviation="1.3" flood-opacity="0.4"/>
              </filter>
            </defs>
            <rect x="6" y="14" width="4" height="8" rx="1.2" fill="#0f172a"/>
            <rect x="34" y="14" width="4" height="8" rx="1.2" fill="#0f172a"/>
            <rect x="6" y="34" width="4" height="8" rx="1.2" fill="#0f172a"/>
            <rect x="34" y="34" width="4" height="8" rx="1.2" fill="#0f172a"/>
            <!-- cabina -->
            <rect x="10" y="5" width="24" height="14" rx="3" fill="url(#cg${uid})" stroke="#0f172a" stroke-width="1" filter="url(#cf${uid})"/>
            <rect x="12.5" y="7.5" width="19" height="6.5" rx="1.5" fill="#7dd3fc" opacity="0.7"/>
            <!-- caja -->
            <rect x="8" y="19" width="28" height="32" rx="2.5" fill="url(#cg${uid})" stroke="#0f172a" stroke-width="1"/>
            <rect x="11" y="22" width="22" height="26" rx="1.5" fill="#0f172a" opacity="0.15"/>
            <rect x="12" y="6.5" width="3.5" height="2" rx="0.5" fill="#fef9c3"/>
            <rect x="28.5" y="6.5" width="3.5" height="2" rx="0.5" fill="#fef9c3"/>
          </svg>`;
      } else {
          // Auto sedán moderno top-down (proporciones de carro real, frente arriba)
          svg = `<svg width="42" height="58" viewBox="0 0 42 58" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="ag${uid}" x1="0.15" y1="0" x2="0.85" y2="1">
                <stop offset="0%" stop-color="${color}"/>
                <stop offset="45%" stop-color="${color}"/>
                <stop offset="100%" stop-color="#0f172a"/>
              </linearGradient>
              <linearGradient id="agw${uid}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#e0f2fe"/>
                <stop offset="100%" stop-color="#38bdf8"/>
              </linearGradient>
              <filter id="af${uid}" x="-45%" y="-45%" width="190%" height="190%">
                <feDropShadow dx="0" dy="1.4" stdDeviation="1.4" flood-color="#000" flood-opacity="0.42"/>
              </filter>
            </defs>
            <!-- ruedas (negras, bajo la carrocería) -->
            <rect x="4.5" y="15" width="4.2" height="10" rx="1.6" fill="#0f172a"/>
            <rect x="33.3" y="15" width="4.2" height="10" rx="1.6" fill="#0f172a"/>
            <rect x="4.5" y="33" width="4.2" height="10" rx="1.6" fill="#0f172a"/>
            <rect x="33.3" y="33" width="4.2" height="10" rx="1.6" fill="#0f172a"/>
            <!-- carrocería: forma de sedán ancha y limpia -->
            <path d="M12 8.5
              C14 5 17.5 3.5 21 3.5
              C24.5 3.5 28 5 30 8.5
              L33.5 17
              C35 20.5 35 24 34 27.5
              L33 40
              C32.5 46.5 27.5 51 21 51.5
              C14.5 51 9.5 46.5 9 40
              L8 27.5
              C7 24 7 20.5 8.5 17
              Z"
              fill="url(#ag${uid})"
              stroke="#020617"
              stroke-width="1.05"
              filter="url(#af${uid})"/>
            <!-- parabrisas delantero (trapecio) -->
            <path d="M14.2 11.5
              C16.5 9.2 21 8.6 25.5 9.2
              C28.2 9.7 29.2 11.2 29.5 13.5
              L29 19.5
              C21.5 18 13.5 18.2 12.8 19.8
              Z"
              fill="url(#agw${uid})"
              opacity="0.92"/>
            <!-- techo / habitáculo -->
            <rect x="13.8" y="21" width="14.4" height="12.5" rx="2.4" fill="#0f172a" opacity="0.22"/>
            <!-- líneas de puertas sutiles -->
            <line x1="13.5" y1="27.5" x2="28.5" y2="27.5" stroke="#020617" stroke-width="0.55" opacity="0.25"/>
            <line x1="21" y1="21" x2="21" y2="33.5" stroke="#020617" stroke-width="0.5" opacity="0.2"/>
            <!-- luneta trasera -->
            <path d="M13.2 35.5 L28.8 35.5 L28.2 43
              C21.5 45 13.8 44.2 13.2 42.5 Z"
              fill="#7dd3fc" opacity="0.5"/>
            <!-- capó / línea delantera -->
            <path d="M15 8.8 C18 7.2 24 7.2 27 8.8" fill="none" stroke="#f8fafc" stroke-width="0.7" opacity="0.25"/>
            <!-- faros delanteros -->
            <rect x="12.2" y="7.2" width="4.2" height="2.4" rx="0.7" fill="#fefce8"/>
            <rect x="25.6" y="7.2" width="4.2" height="2.4" rx="0.7" fill="#fefce8"/>
            <!-- calaveras -->
            <rect x="12.8" y="48.2" width="3.6" height="2.1" rx="0.55" fill="#f87171"/>
            <rect x="25.6" y="48.2" width="3.6" height="2.1" rx="0.55" fill="#f87171"/>
            <!-- espejos -->
            <ellipse cx="9.2" cy="20" rx="1.6" ry="1.1" fill="#cbd5e1"/>
            <ellipse cx="32.8" cy="20" rx="1.6" ry="1.1" fill="#cbd5e1"/>
          </svg>`;
      }
      return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  };

  window.getCachedTopDownVehicleIconUrl = (vehicleType, bg) => {
      // v3: rediseño limpio (evita iconos viejos en caché de sesión)
      const key = `tdv3:${vehicleType}:${bg}`;
      if (!window._topDownVehicleIconCache[key]) {
          window._topDownVehicleIconCache[key] = window.createTopDownVehicleIcon(vehicleType, bg);
      }
      return window._topDownVehicleIconCache[key];
  };

  /** Rotación del carrito en pantalla (0 = hacia arriba). Igual que Google: rumbo − heading del mapa. */
  window.getDriverMarkerScreenRotation = (headingDeg) => {
      let h = Number(headingDeg);
      if (!Number.isFinite(h)) h = 0;
      h = ((h % 360) + 360) % 360;
      let mapH = 0;
      try {
          if (window.gMap && typeof window.gMap.getHeading === 'function') {
              mapH = Number(window.gMap.getHeading()) || 0;
          }
      } catch (_) {}
      return ((h - mapH) + 360) % 360;
  };

  /**
   * Carrito top-down (todos los vehículos en el mapa).
   * Rota con brújula/GPS respecto al mapa (como Google Maps).
   */
  window.buildDriverMarkerContent = (vehicleType, bg, heading, inDriverNav) => {
      const selfNav = !!inDriverNav;
      const size = selfNav ? 52 : 44;
      const imgW = selfNav ? 38 : 32;
      const imgH = selfNav ? 52 : 44;
      const markerContent = document.createElement('div');
      markerContent.className = 'driver-map-car';
      markerContent.style.width = `${size}px`;
      markerContent.style.height = `${size}px`;
      markerContent.style.display = 'flex';
      markerContent.style.alignItems = 'center';
      markerContent.style.justifyContent = 'center';
      markerContent.style.willChange = 'transform';
      markerContent.style.transition = 'transform 0.12s linear';
      markerContent.style.filter = 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))';
      markerContent.style.transformOrigin = '50% 50%';

      const iconUrl = window.getCachedTopDownVehicleIconUrl(vehicleType, bg);
      markerContent.innerHTML =
          `<img src="${iconUrl}" alt="" draggable="false" style="width:${imgW}px;height:${imgH}px;object-fit:contain;pointer-events:none;" />`;

      const rot = window.getDriverMarkerScreenRotation?.(heading) ?? (Number(heading) || 0);
      markerContent.style.transform = `rotate(${rot}deg)`;
      return markerContent;
  };

  window.updateDriverMarker = (driverId, lat, lng, isSelf = false, options = {}) => {
    if (!window.mapLoaded || !window.gMap) return;

    const pos = { lat, lng };
    if (isSelf) window.currentDriverPos = pos;

    const variant = options.variant || (isSelf ? 'self' : 'nearby');
    const driverName = options.name || '';
    const vehicleType = options.vehicleType || options.type || 'auto';
    const heading = options.heading || 0;
    const inDriverNav = isSelf && window.isDriverNavigating?.();

    let bg = '#10b981';
    if (vehicleType === 'moto') bg = '#8b5cf6';
    else if (vehicleType === 'taxi' || vehicleType === 'taxi_vip' || vehicleType === 'vip') bg = '#facc15';
    else if (vehicleType === 'paila') bg = '#10b981';
    else if (vehicleType === 'camion') bg = '#64748b';
    else bg = '#3b82f6'; // auto / VIP
    // Viaje confirmado (accepted / in_progress): carro rojo para distinguirlo de la flota libre
    if (variant === 'assigned') {
        bg = '#ef4444';
    }

    let title = isSelf ? 'Tú' : (driverName ? `Conductor: ${driverName}` : 'Conductor en línea');
    // Passengers see icons but should not easily know names without tapping (staff only get details + WhatsApp on tap)
    if (!isSelf && !window.canViewOpsFleetMap?.()) {
        title = variant === 'assigned' ? 'Tu conductor' : 'Conductor en línea';
    }
    if (window.canViewOpsFleetMap?.() && options.phone) {
        title += ` • ${options.phone}`;
    }

    // Todos los carros: vista superior + brújula/rumbo
    const useTopDown = true;
    const styleKey = `${vehicleType}|${variant}|tdv4|1|${bg}`;
    const existing = window.driverMarkers[driverId];
    const meta = window._driverMarkerMeta[driverId];

    if (existing) {
        const nextPos = { lat: Number(lat), lng: Number(lng) };
        const forceMove = options.forceReposition || variant === 'assigned' || isSelf;
        const posChanged = !meta
            || meta.lastLat == null
            || Math.hypot(nextPos.lat - Number(meta.lastLat), nextPos.lng - Number(meta.lastLng)) > 0.000001;

        if (forceMove || posChanged) {
            // AdvancedMarkerElement acepta mejor {lat,lng} plano que LatLng en algunos builds
            const latLng = nextPos;
            try {
                if (existing.position !== undefined) {
                    existing.position = latLng;
                } else if (typeof existing.setPosition === 'function') {
                    existing.setPosition(
                        (typeof google !== 'undefined' && google.maps?.LatLng)
                            ? new google.maps.LatLng(nextPos.lat, nextPos.lng)
                            : nextPos
                    );
                }
            } catch (_) {
                try {
                    if (typeof existing.setPosition === 'function') {
                        existing.setPosition(nextPos);
                    }
                } catch (__) {}
            }
        }

        if (meta?.contentEl && meta.styleKey === styleKey) {
            // Carrito top-down: rotar con brújula/GPS (relativo al mapa)
            const rot = window.getDriverMarkerScreenRotation?.(heading) ?? (Number(heading) || 0);
            meta.contentEl.style.transform = `rotate(${rot}deg)`;
            meta.lastHeading = heading;
            if (existing.title !== title) existing.title = title;
            meta.lastLat = nextPos.lat;
            meta.lastLng = nextPos.lng;
            return;
        }
    }

    const canUseAdvanced = window.canUseAdvancedMapMarkers?.() ?? false;

    if (canUseAdvanced) {
        const markerContent = window.buildDriverMarkerContent(vehicleType, bg, heading, inDriverNav);

        const hasAdvanced = !!(google.maps?.marker?.AdvancedMarkerElement);
        if (window.driverMarkers[driverId]) {
            const m = window.driverMarkers[driverId];
            if (m.position !== undefined) {
                m.position = pos;
                m.content = markerContent;
                m.title = title;
            } else if (typeof m.setPosition === 'function') {
                m.setPosition(pos);
                m.setTitle(title);
            }
            window._driverMarkerMeta[driverId] = {
                contentEl: markerContent,
                styleKey,
                lastHeading: heading,
                lastLat: lat,
                lastLng: lng
            };
        } else if (hasAdvanced) {
            window.driverMarkers[driverId] = new google.maps.marker.AdvancedMarkerElement({
                position: pos,
                map: window.gMap,
                content: markerContent,
                title,
                zIndex: variant === 'assigned' ? 80 : (isSelf ? 70 : 40)
            });
            window._driverMarkerMeta[driverId] = {
                contentEl: markerContent,
                styleKey,
                lastHeading: heading,
                lastLat: lat,
                lastLng: lng
            };
            if (window.canViewOpsFleetMap?.()) {
                window.driverMarkers[driverId].addListener?.('gmp-click', () => {
                    if (!isSelf) {
                        // Mismo flujo que flota: viaje activo → ficha viaje; libre → finanzas
                        (window.openStaffFleetDriverPanel || window.showDriverFullDetails)?.(driverId, driverName || title);
                    }
                });
            }
        } else {
            // Avoid deprecated Marker. Skip creation.
            console.warn('No AdvancedMarkerElement support for this driver marker; skipping to prevent deprecation.');
        }
    } else {
        // Classic Marker: carrito top-down + rotation por brújula (todos)
        const iconUrl = window.getCachedTopDownVehicleIconUrl(vehicleType, bg);
        const szW = isSelf || inDriverNav ? 40 : 34;
        const szH = isSelf || inDriverNav ? 54 : 46;
        const icon = {
            url: iconUrl,
            scaledSize: new google.maps.Size(szW, szH),
            anchor: new google.maps.Point(szW / 2, szH / 2),
            rotation: window.getDriverMarkerScreenRotation?.(heading) ?? (Number(heading) || 0),
        };

        if (window.driverMarkers[driverId]) {
            const m = window.driverMarkers[driverId];
            if (typeof m.setPosition === 'function') {
                m.setPosition(pos);
                m.setIcon(icon);
                m.setTitle(title);
            } else {
                m.position = pos;
                m.title = title;
                const img = document.createElement('img');
                img.src = icon.url;
                img.style.width = (icon.scaledSize ? icon.scaledSize.width : 32) + 'px';
                img.style.height = (icon.scaledSize ? icon.scaledSize.height : 32) + 'px';
                m.content = img;
            }
        } else {
            const hasAdvanced = window.canUseAdvancedMapMarkers?.() ?? false;
            if (hasAdvanced) {
                window.driverMarkers[driverId] = new google.maps.marker.AdvancedMarkerElement({
                    position: pos,
                    map: window.gMap,
                    title: title,
                    zIndex: 15,
                    content: (() => {
                        const img = document.createElement('img');
                        img.src = icon.url;
                        img.style.width = (icon.scaledSize ? icon.scaledSize.width : 32) + 'px';
                        img.style.height = (icon.scaledSize ? icon.scaledSize.height : 32) + 'px';
                        return img;
                    })()
                });
            } else {
                const hasAdv2 = !!(google.maps?.marker?.AdvancedMarkerElement);
                if (hasAdv2) {
                    window.driverMarkers[driverId] = new google.maps.marker.AdvancedMarkerElement({
                        position: pos,
                        map: window.gMap,
                        title: title,
                        zIndex: 15,
                        content: (() => {
                            const img = document.createElement('img');
                            img.src = icon.url;
                            img.style.width = (icon.scaledSize ? icon.scaledSize.width : 32) + 'px';
                            img.style.height = (icon.scaledSize ? icon.scaledSize.height : 32) + 'px';
                            return img;
                        })()
                    });
                } else {
                    console.warn('Falling back to legacy google.maps.Marker for driver (deprecated).');
                    // Still try Advanced if class exists to minimize deprecation impact
                    const hasAdvFinal = !!(google.maps?.marker?.AdvancedMarkerElement);
                    if (hasAdvFinal) {
                        window.driverMarkers[driverId] = new google.maps.marker.AdvancedMarkerElement({
                            position: pos,
                            map: window.gMap,
                            title: title,
                            zIndex: 15,
                            content: (() => {
                                const img = document.createElement('img');
                                img.src = icon.url;
                                img.style.width = (icon.scaledSize ? icon.scaledSize.width : 32) + 'px';
                                img.style.height = (icon.scaledSize ? icon.scaledSize.height : 32) + 'px';
                                return img;
                            })()
                        });
                    } else {
                        // Avoid deprecated google.maps.Marker entirely. Skip if no Advanced support.
                        console.warn('No AdvancedMarker support; skipping legacy driver marker to avoid deprecation.');
                    }
                }
            }
            if (window.canViewOpsFleetMap?.()) {
                google.maps.event.addListener(window.driverMarkers[driverId], 'click', () => {
                    if (!isSelf) {
                        (window.openStaffFleetDriverPanel || window.showDriverFullDetails)?.(driverId, driverName || title);
                    }
                });
            }
        }
    }
  };

        window.getProfileRating = (profile) => {
            if (!profile) return '5.0';
            return profile.ratingCount > 0
                ? (profile.ratingSum / profile.ratingCount).toFixed(1)
                : '5.0';
        };

        const tpVehicleTypeLabel = (type) => {
            if (type === 'taxi') return 'Taxi tradicional';
            if (type === 'moto') return 'Moto · viajes y envíos';
            return 'Automóvil';
        };

        const tpVehicleTypeIcon = (type) => {
            if (type === 'taxi') return 'fa-taxi';
            if (type === 'moto') return 'fa-motorcycle';
            return 'fa-car';
        };

        const tpVehicleTypeClass = (type) => {
            if (type === 'taxi') return 'vehicle-taxi';
            if (type === 'moto') return 'vehicle-moto';
            return 'vehicle-auto';
        };

        const tpResolveVehicleExteriorPhotos = (data) => {
            const photos = data?.driverVehiclePhotos || data?.vehiclePhotos || {};
            return {
                front: photos.exteriorFront || photos.extFront || null,
                rear: photos.exteriorRear || photos.extRear || null
            };
        };

        const tpResolveLicensePhotos = (data) => {
            const docs = data?.driverDocumentsPhotos || data?.documentsPhotos || {};
            const photos = data?.driverVehiclePhotos || data?.vehiclePhotos || {};
            return {
                front: docs.licenseFront || photos.licenseFront || data?.licenseFrontPhoto || null,
                back: docs.licenseBack || photos.licenseBack || data?.licenseBackPhoto || null
            };
        };

        const tpApplyPhotoPair = (wrapId, frontId, backId, frontLinkId, backLinkId, pair, placeholder) => {
            const photosWrap = document.getElementById(wrapId);
            const frontImg = document.getElementById(frontId);
            const rearImg = document.getElementById(backId);
            const frontLink = document.getElementById(frontLinkId);
            const rearLink = document.getElementById(backLinkId);
            const showPhotos = !!(pair.front || pair.back);

            if (photosWrap) photosWrap.classList.toggle('hidden', !showPhotos);
            if (frontImg) {
                frontImg.src = pair.front || placeholder;
                frontImg.onerror = () => { frontImg.src = placeholder; };
            }
            if (rearImg) {
                rearImg.src = pair.back || placeholder;
                rearImg.onerror = () => { rearImg.src = placeholder; };
            }
            if (frontLink) {
                frontLink.href = pair.front || '#';
                frontLink.classList.toggle('pointer-events-none', !pair.front);
            }
            if (rearLink) {
                rearLink.href = pair.back || '#';
                rearLink.classList.toggle('pointer-events-none', !pair.back);
            }
        };

        const tpPassengerDriverStatus = (data) => {
            if (data.status === 'in_progress') {
                return { badge: 'Viaje en curso', sub: '', tone: 'en-route', showEta: false };
            }
            if (data.driverArrived) {
                return { badge: '¡Ha llegado!', sub: 'Confirma con tu PIN', tone: 'arrived', showEta: false };
            }
            if (data.driverFinishingOtherTrip && data.status === 'accepted') {
                return {
                    badge: '¡Reservado!',
                    sub: 'Termina su viaje actual y viene por ti',
                    tone: 'reserved',
                    showEta: true
                };
            }
            if (data.status === 'accepted') {
                return { badge: '¡Va en camino!', sub: 'Síguelo en el mapa', tone: 'en-route', showEta: true };
            }
            if (data.status === 'completed') {
                const bothRated = !!(data.ratedByClient && data.ratedByDriver);
                return {
                    badge: bothRated ? 'Viaje Finalizado' : 'Viaje terminado',
                    sub: bothRated ? 'Calificaciones recibidas' : 'Ambos deben calificar',
                    tone: 'en-route',
                    showEta: false
                };
            }
            return { badge: '', sub: '', tone: '', showEta: false };
        };

        /** Flotante unificado del pasajero (conductor + PIN). Evita doble panel. */
        window.syncClientTripFloat = (data) => {
            if (!data || window.userProfile?.role !== 'client') return;
            const floatEl = document.getElementById('client-trip-float');
            if (!floatEl || floatEl.classList.contains('hidden')) return;

            const vType = data.driverVehicleType || data.driverVehicle?.type || 'auto';
            const vehicle = data.driverVehicle || {};
            const status = tpPassengerDriverStatus(data);
            const photoUrl = data.driverPhoto || 'https://placehold.co/100x100/e2e8f0/64748b?text=Conductor';
            const driverName = data.driverName || 'Conductor';
            const plate = (vehicle.plate || '').toString().trim().toUpperCase();
            const model = vehicle.model || '';
            const typeLabel = tpVehicleTypeLabel(vType);

            const setTxt = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };
            const setImg = (id, src) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.src = src;
                el.onerror = () => { el.src = 'https://placehold.co/100x100/e2e8f0/64748b?text=Conductor'; };
            };

            setImg('client-trip-photo', photoUrl);
            setImg('client-trip-min-photo', photoUrl);
            setTxt('client-trip-name', driverName);
            setTxt('client-trip-min-name', driverName);
            setTxt('client-trip-rating', data.driverRating || '5.0');
            setTxt('client-trip-plate', plate || '---');
            setTxt('client-trip-vehicle', [typeLabel, model].filter(Boolean).join(' · ') || 'Vehículo');

            const statusEl = document.getElementById('client-trip-status');
            if (statusEl) {
                statusEl.classList.remove('tone-en-route', 'tone-arrived', 'tone-reserved');
                if (status.tone) statusEl.classList.add(`tone-${status.tone}`);
            }
            setTxt('client-trip-status-badge', status.badge || 'Viaje activo');
            setTxt('client-trip-status-sub', status.sub || '');
            setTxt('client-trip-min-meta', status.badge || 'Viaje activo');

            // Fotos frente (placa) y atrás del vehículo
            const vehiclePair = tpResolveVehicleExteriorPhotos(data);
            const vehiclePlaceholder = 'https://placehold.co/320x200/e2e8f0/94a3b8?text=Sin+foto';
            tpApplyPhotoPair(
                'client-trip-vehicle-photos',
                'client-trip-vehicle-front',
                'client-trip-vehicle-rear',
                'client-trip-vehicle-front-link',
                'client-trip-vehicle-rear-link',
                vehiclePair,
                vehiclePlaceholder
            );

            const etaFull = document.getElementById('client-trip-status-eta');
            const etaMin = document.getElementById('client-trip-min-eta');
            const etaText = (document.getElementById('tp-status-eta')?.textContent
                || document.getElementById('trip-mini-time')?.textContent
                || '').trim();
            if (status.showEta && etaText && etaText !== '-- min' && etaText !== '--') {
                if (etaFull) {
                    etaFull.textContent = etaText.includes('min') ? etaText : `${etaText}`;
                    etaFull.classList.remove('hidden');
                }
                if (etaMin) {
                    etaMin.textContent = etaText.replace(/\s*min\.?/i, '').trim() || etaText;
                    etaMin.classList.remove('hidden');
                }
            } else {
                etaFull?.classList.add('hidden');
                etaMin?.classList.add('hidden');
            }

            // WhatsApp del conductor: SOLO si va en camino al origen (accepted y aún no marcó llegada)
            const waBox = document.getElementById('client-trip-wa-contact');
            const waBtn = document.getElementById('client-trip-wa-btn');
            const waPhoneEl = document.getElementById('client-trip-wa-phone');
            const showWa = data.status === 'accepted' && !data.driverArrived && !!data.driverId;
            if (waBox) {
                const rawPhone = data.driverPhone || '';
                const phone = (typeof window.formatHondurasPhone === 'function'
                    ? window.formatHondurasPhone(rawPhone)
                    : rawPhone) || '';
                const link = (typeof window.getWhatsAppLink === 'function' && rawPhone)
                    ? window.getWhatsAppLink(rawPhone, `Hola ${driverName.split(' ')[0] || ''}, soy el pasajero de HonduRaite.`)
                    : '';
                if (showWa && phone && link && link !== 'https://wa.me/') {
                    waBox.classList.remove('hidden');
                    if (waBtn) {
                        waBtn.href = link;
                        waBtn.removeAttribute('aria-disabled');
                    }
                    if (waPhoneEl) waPhoneEl.textContent = phone;
                } else {
                    waBox.classList.add('hidden');
                    if (waBtn) {
                        waBtn.removeAttribute('href');
                        waBtn.setAttribute('aria-disabled', 'true');
                    }
                }
            }
        };

        window.renderTripPartnerInfo = (data, role) => {
            const card = document.getElementById('trip-partner-info');
            if (!card || !data) return;

            const isDriver = role === 'driver';
            const label = document.getElementById('tp-role-label');
            const photo = document.getElementById('tp-photo');
            const name = document.getElementById('tp-name');
            const rating = document.getElementById('tp-rating');
            const driverExtra = document.getElementById('tp-driver-extra');
            const statusBanner = document.getElementById('tp-status-banner');
            const statusBadge = document.getElementById('tp-status-badge');
            const statusSub = document.getElementById('tp-status-sub');
            const statusEta = document.getElementById('tp-status-eta');

            // Pasajero: la info del conductor va al flotante (no al panel inferior)
            if (!isDriver) {
                card.classList.add('hidden');
                try { window.syncClientTripFloat?.(data); } catch (_) {}
                // seguir rellenando ETA del panel interno por si se usa como fuente
            } else {
                card.classList.remove('hidden');
            }
            card.classList.toggle('driver-view-passenger', isDriver);
            if (label) label.textContent = isDriver ? 'Tu pasajero' : 'Tu conductor';
            if (driverExtra) driverExtra.classList.toggle('hidden', isDriver);

            const statusToggle = document.getElementById('tp-status-toggle');

            if (isDriver) {
                if (statusBanner) statusBanner.classList.add('hidden');
                if (statusToggle) statusToggle.classList.add('hidden');
                card.classList.remove('vehicle-taxi', 'vehicle-moto', 'vehicle-auto');
                if (photo) {
                    photo.src = data.clientPhoto || 'https://placehold.co/100x100/e2e8f0/64748b?text=Pasajero';
                    photo.onerror = () => { photo.src = 'https://placehold.co/100x100/e2e8f0/64748b?text=Pasajero'; };
                }
                if (name) {
                    const firstTrip = data.clientIsFirstTrip === true
                        || (data.clientIsFirstTrip !== false && Number(data.clientTotalTrips) === 0);
                    name.innerHTML = firstTrip
                        ? `${data.clientName || 'Pasajero'} <span class="driver-offer-first-badge"><i class="fas fa-star"></i> 1er viaje</span>`
                        : (data.clientName || 'Pasajero');
                }
                if (rating) rating.textContent = data.clientRating || '5.0';
                // Sheet estilo Uber (faja inferior)
                const uberName = document.getElementById('driver-uber-pax-name');
                const uberPhoto = document.getElementById('driver-uber-pax-photo');
                if (uberName) uberName.textContent = data.clientName || 'Pasajero';
                if (uberPhoto) {
                    uberPhoto.src = data.clientPhoto || 'https://placehold.co/64x64/e2e8f0/64748b?text=·';
                    uberPhoto.onerror = () => { uberPhoto.src = 'https://placehold.co/64x64/e2e8f0/64748b?text=·'; };
                }
                // No mostrar placa ni info de vehículo del pasajero al conductor
                // (el pasajero es cliente, no tiene placa; y si es servicio carro, no corresponde)
                const extra = document.getElementById('tp-driver-extra');
                if (extra) {
                    extra.classList.add('hidden');
                    extra.style.display = 'none';
                }
                const plateEl = document.getElementById('tp-plate');
                if (plateEl) plateEl.style.display = 'none';
                const modelEl = document.getElementById('tp-vehicle');
                if (modelEl) modelEl.style.display = 'none';
            } else {
                const vType = data.driverVehicleType || data.driverVehicle?.type || 'auto';
                const vehicle = data.driverVehicle || {};
                const status = tpPassengerDriverStatus(data);

                card.classList.remove('vehicle-taxi', 'vehicle-moto', 'vehicle-auto');
                card.classList.add(tpVehicleTypeClass(vType));

                if (photo) {
                    photo.src = data.driverPhoto || 'https://placehold.co/100x100/e2e8f0/64748b?text=Conductor';
                    photo.onerror = () => { photo.src = 'https://placehold.co/100x100/e2e8f0/64748b?text=Conductor'; };
                }
                if (name) {
                    name.textContent = data.driverName || 'Conductor VIP';
                    const plateTxt = (vehicle.plate || '').toString().trim().toUpperCase();
                    if (plateTxt) name.setAttribute('data-plate', plateTxt);
                    else name.removeAttribute('data-plate');
                }
                if (rating) rating.textContent = data.driverRating || '5.0';

                const identity = document.getElementById('tp-identity');
                const plate = document.getElementById('tp-plate');
                const vehicleModel = document.getElementById('tp-vehicle');
                const vehicleType = document.getElementById('tp-vehicle-type');
                const vehicleTypeIcon = document.getElementById('tp-vehicle-type-icon');

                if (identity) identity.textContent = data.driverIdentity || 'N/D';
                if (plate) plate.textContent = (vehicle.plate || 'N/D').toUpperCase();
                if (vehicleModel) vehicleModel.textContent = vehicle.model || 'Sin especificar';
                if (vehicleType) vehicleType.textContent = tpVehicleTypeLabel(vType);
                if (vehicleTypeIcon) vehicleTypeIcon.className = `fas ${tpVehicleTypeIcon(vType)}`;

                const placeholder = 'https://placehold.co/320x200/e2e8f0/94a3b8?text=Sin+foto';
                tpApplyPhotoPair(
                    'tp-vehicle-photos',
                    'tp-vehicle-front',
                    'tp-vehicle-rear',
                    'tp-vehicle-front-link',
                    'tp-vehicle-rear-link',
                    tpResolveVehicleExteriorPhotos(data),
                    placeholder
                );
                tpApplyPhotoPair(
                    'tp-license-photos',
                    'tp-license-front',
                    'tp-license-back',
                    'tp-license-front-link',
                    'tp-license-back-link',
                    tpResolveLicensePhotos(data),
                    'https://placehold.co/320x200/e2e8f0/94a3b8?text=Licencia'
                );

                if (statusBanner) {
                    statusBanner.classList.remove('hidden');
                    statusBanner.classList.remove('tone-en-route', 'tone-arrived', 'tone-reserved');
                    if (status.tone) statusBanner.classList.add(`tone-${status.tone}`);
                }
                if (statusBadge) statusBadge.textContent = status.badge || '';
                if (statusSub) statusSub.textContent = status.sub || '';
                if (statusEta) {
                    if (status.showEta) statusEta.classList.remove('hidden');
                    else {
                        statusEta.classList.add('hidden');
                        if (!status.showEta) statusEta.textContent = '';
                    }
                }
                if (statusToggle) statusToggle.classList.remove('hidden');
                window.syncPassengerPanelToggleLabel?.();
            }
        };

        window.syncPassengerPanelToggleLabel = () => {
            if (window.userProfile?.role === 'driver') return;
            const panel = document.getElementById('control-panel');
            const collapsed = panel?.classList.contains('panel-collapsed');
            const label = collapsed ? 'Ver más' : 'Minimizar';
            const mainLabel = document.getElementById('trip-panel-toggle-label');
            const tpLabel = document.getElementById('tp-panel-toggle-label');
            if (mainLabel) mainLabel.textContent = label;
            if (tpLabel) tpLabel.textContent = label;
        };

        const PANEL_HIDDEN_KEY = 'honduber_control_panel_hidden';

        /**
         * Expande el panel del conductor (p. ej. pill «Viaje activo» / Abrir).
         * Si el usuario lo abre en navegación, se queda abierto hasta que lo minimice a mano.
         */
        window.expandDriverControlPanel = () => {
            const panel = document.getElementById('control-panel');
            // No reabrir encima del popup de oferta / vista previa de mapa
            if (
                document.body.classList.contains('driver-offer-popup-open')
                || document.body.classList.contains('driver-offer-map-peek')
            ) {
                return;
            }
            document.body.classList.remove('panel-hidden', 'panel-minimized', 'panel-collapsed');
            panel?.classList.remove('panel-hidden', 'panel-collapsed', 'driver-offer-peek-hidden');
            try { localStorage.setItem(PANEL_HIDDEN_KEY, '0'); } catch (_) {}
            const liveTrip = !!(window.currentActiveTripData
                && ['accepted', 'in_progress'].includes(window.currentActiveTripData.status)
                && (window.currentActiveTripData.driverId === window.currentUser?.uid
                    || window.currentActiveTripData.driverId === window.userProfile?.uid));
            if (liveTrip) {
                document.getElementById('active-trip-panel')?.classList.remove('hidden', 'panel-minimized');
            } else {
                document.body.classList.remove('trip-active', 'is-navigating', 'driver-nav-mode');
                document.getElementById('active-trip-panel')?.classList.add('hidden');
                document.getElementById('driver-view')?.classList.remove('hidden');
            }
            try { window.syncDriverPanelMinHint?.(); } catch (_) {}
            try { window.syncDriverIdleVsActiveTripUi?.(); } catch (_) {}
            // Preferencia del usuario: no volver a auto-minimizar mientras navegue
            if (document.body.classList.contains('is-navigating')
                || document.body.classList.contains('driver-nav-mode')
                || document.body.classList.contains('trip-active')) {
                window._driverNavUserKeptOpen = true;
                window._driverNavPanelAutoMinDone = true;
            } else {
                // Fuera de viaje: al abrir a mano, marcar que el usuario quiere el panel
                window._driverNavUserKeptOpen = true;
            }
            try { window.syncPanelHideChevron?.(); } catch (_) {}
            // Anclar abajo como sheet (nunca full-screen en viaje)
            try { window.dockControlPanelForDriverTrip?.(); } catch (_) {}
            if (panel && document.body.classList.contains('trip-active')) {
                try {
                    panel.style.top = '';
                    panel.style.bottom = '';
                    panel.style.height = '';
                    panel.style.maxHeight = '';
                    panel.classList.remove('panel-is-floating', 'is-drag-positioned');
                } catch (_) {}
            }
            try { window.syncPassengerPanelToggleLabel?.(); } catch (_) {}
            try { window.syncDriverRadarFloatPanel?.(); } catch (_) {}
            try { window.syncDriverTripControls?.(window.currentActiveTripData); } catch (_) {}
            try { window.syncTripFloatPanels?.(window.currentActiveTripData); } catch (_) {}
            try { window.syncDriverPanelNavVisibility?.(); } catch (_) {}
            // Cámara de nav: seguir con el panel abierto (padding inferior = sheet)
            try {
                if (window.isDriverNavigating?.() && window.currentDriverPos && window.autoCenter !== false) {
                    window._lastDriverNavCamPos = null;
                    window.applyDriverNavCamera?.(
                        window.currentDriverPos,
                        window.currentDriverHeading,
                        true
                    );
                }
            } catch (_) {}
            // Scroll a los botones grandes (navegar / llegué), no a detalles
            try {
                const cta = document.getElementById('driver-active-cta');
                cta?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            } catch (_) {}
            const label = document.getElementById('trip-panel-toggle-label');
            if (label) label.textContent = 'Cerrar';
        };

        window.showControlPanel = (opts = {}) => {
            const forceExpand = opts === true || opts?.forceExpand === true;
            const panel = document.getElementById('control-panel');
            const isMobile = window.innerWidth < 768
                || document.body.classList.contains('capacitor-android')
                || document.body.classList.contains('capacitor-native');
            const hasTrip = document.body.classList.contains('trip-active');
            const isDriver = document.body.classList.contains('driver-mode');
            const isClient = document.body.classList.contains('client-mode');
            const isSearching = document.body.classList.contains('is-searching');
            const readUserMinimized = () => !!panel?.classList.contains('panel-collapsed')
                || document.body.classList.contains('panel-minimized')
                || document.body.classList.contains('panel-hidden')
                || !!panel?.classList.contains('panel-hidden')
                || (() => { try { return localStorage.getItem(PANEL_HIDDEN_KEY) === '1'; } catch (_) { return false; } })();
            let userMinimized = readUserMinimized();

            // Forzar abrir (pedir viaje, APK): ignora minimize previo y limpia localStorage
            if (forceExpand) {
                userMinimized = false;
                try { localStorage.setItem(PANEL_HIDDEN_KEY, '0'); } catch (_) {}
                document.body.classList.remove('panel-hidden', 'panel-minimized', 'panel-collapsed');
                panel?.classList.remove('panel-hidden', 'panel-collapsed', 'driver-offer-peek-hidden');
            }

            if (isDriver) {
                // Oferta Uber / mapa: no reabrir el panel central encima de la ruta
                if (
                    document.body.classList.contains('driver-offer-map-peek')
                    || document.body.classList.contains('driver-offer-popup-open')
                ) {
                    panel?.classList.add('panel-collapsed', 'driver-offer-peek-hidden');
                    document.body.classList.add('panel-minimized', 'panel-collapsed');
                    document.body.classList.remove('panel-hidden');
                    document.getElementById('active-trip-panel')?.classList.add('hidden');
                    try { window.syncPanelHideChevron?.(); } catch (_) {}
                    return;
                }
                // Nunca ocultar del todo con panel-hidden (rompe el FAB).
                // Si el usuario minimizó (radar o viaje), RESPETAR siempre —
                // antes showControlPanel reabría el panel en cada snapshot → “no se puede minimizar”.
                document.body.classList.remove('panel-hidden');
                panel?.classList.remove('panel-hidden');
                // Releer al final: el usuario puede haber minimizado mientras corría un snapshot
                const stillMinimized = !forceExpand && readUserMinimized();
                if (stillMinimized) {
                    panel?.classList.add('panel-collapsed');
                    panel?.classList.remove('driver-offer-peek-hidden');
                    document.body.classList.add('panel-minimized', 'panel-collapsed');
                    window.syncDriverRadarFloatPanel?.();
                    window.syncPassengerPanelToggleLabel?.();
                    window.updatePassengerPromoStripVisibility?.();
                    window.refreshPassengerCopaUI?.();
                    try { window.syncPanelHideChevron?.(); } catch (_) {}
                    try { window.bindDriverPanelMinBtn?.(); } catch (_) {}
                    return;
                }
                document.body.classList.remove('panel-minimized', 'panel-collapsed');
                panel?.classList.remove('panel-collapsed', 'driver-offer-peek-hidden');
                try { localStorage.setItem(PANEL_HIDDEN_KEY, '0'); } catch (_) {}
                if (hasTrip) window.dockControlPanelForDriverTrip?.();
                window.syncDriverIdleVsActiveTripUi?.();
                window.syncDriverRadarFloatPanel?.();
                window.updatePassengerPromoStripVisibility?.();
                window.refreshPassengerCopaUI?.();
                try { window.syncPanelHideChevron?.(); } catch (_) {}
                try { window.bindDriverPanelMinBtn?.(); } catch (_) {}
                return;
            }

            // Pasajero: en búsqueda o viaje NO forzar expandir en cada sync (Android reabría el panel).
            // forceExpand sí abre (pedido de viaje / entrar a búsqueda).
            if (isClient && (hasTrip || isSearching || (isMobile && userMinimized))) {
                // Releer: en viaje el minimizado no debe reabrirse por un snapshot viejo
                const stillMin = !forceExpand && readUserMinimized();
                if (stillMin) {
                    document.body.classList.add('panel-minimized', 'panel-collapsed');
                    // En viaje activo: colapsado (mini-barra), NO panel-hidden total
                    // (panel-hidden en APK a veces dejaba sin forma de reabrir / “trabado”)
                    if (hasTrip && !isSearching) {
                        document.body.classList.remove('panel-hidden');
                        panel?.classList.remove('panel-hidden');
                        panel?.classList.add('panel-collapsed');
                    } else if (!isSearching) {
                        document.body.classList.add('panel-hidden');
                        panel?.classList.add('panel-hidden', 'panel-collapsed');
                    } else {
                        document.body.classList.remove('panel-hidden');
                        panel?.classList.remove('panel-hidden');
                        panel?.classList.add('panel-collapsed');
                    }
                } else {
                    document.body.classList.remove('panel-hidden', 'panel-minimized', 'panel-collapsed');
                    panel?.classList.remove('panel-hidden', 'panel-collapsed');
                    try { localStorage.setItem(PANEL_HIDDEN_KEY, '0'); } catch (_) {}
                    if (panel) {
                        try { panel.scrollTop = 0; } catch (_) {}
                    }
                }
                window.syncPassengerPanelToggleLabel?.();
                window.updatePassengerPromoStripVisibility?.();
                window.refreshPassengerCopaUI?.();
                try { window.syncPanelHideChevron?.(); } catch (_) {}
                try { window.bindPassengerPanelMinBtn?.(); } catch (_) {}
                // APK: reflow para aplicar max-height full-screen de is-searching
                try { void panel?.offsetHeight; } catch (_) {}
                return;
            }

            document.body.classList.remove('panel-hidden');
            panel?.classList.remove('panel-hidden');
            try { localStorage.setItem(PANEL_HIDDEN_KEY, '0'); } catch (_) {}
            // Sync toggle label if we are in an active trip (passenger or driver)
            if (document.body.classList.contains('trip-active') && panel) {
                window.syncPassengerPanelToggleLabel?.();
            }
            window.updatePassengerPromoStripVisibility?.();
            window.refreshPassengerCopaUI?.();
            try { window.syncPanelHideChevron?.(); } catch (_) {}
        };

        window.hideControlPanel = () => {
            const panel = document.getElementById('control-panel');
            const isMobile = window.innerWidth < 768
                || document.body.classList.contains('capacitor-android')
                || document.body.classList.contains('capacitor-native');
            const hasTrip = document.body.classList.contains('trip-active');
            const isDriver = document.body.classList.contains('driver-mode');
            const isClient = document.body.classList.contains('client-mode');
            const isSearching = document.body.classList.contains('is-searching');

            // Pasajero: ocultar del TODO el panel (mapa limpio)
            if (isClient && !isDriver) {
                window.toggleActivePanel?.();
                return;
            }

            // Conductor (y búsqueda): minimizar/maximizar — no bloquear con toast
            if (isDriver || isSearching || (isMobile && hasTrip)) {
                // Oferta abierta: no reabrir/minimizar el panel central
                if (isDriver && (
                    document.body.classList.contains('driver-offer-popup-open')
                    || document.body.classList.contains('driver-offer-map-peek')
                )) {
                    return;
                }
                if (panel) {
                    panel.classList.toggle('panel-collapsed');
                    try {
                        panel.style.height = '';
                        panel.style.maxHeight = '';
                        panel.style.minHeight = '';
                    } catch (_) {}
                }
                const collapsed = panel ? panel.classList.contains('panel-collapsed') : document.body.classList.contains('panel-minimized');
                document.body.classList.toggle('panel-minimized', collapsed);
                document.body.classList.toggle('panel-collapsed', collapsed);
                document.body.classList.remove('panel-hidden');
                panel?.classList.remove('panel-hidden', 'driver-offer-peek-hidden');
                if (isDriver) {
                    window._driverNavUserKeptOpen = !collapsed;
                    if (!collapsed) window._driverNavPanelAutoMinDone = true;
                    window.syncDriverIdleVsActiveTripUi?.();
                }
                window.syncPassengerPanelToggleLabel?.();
                try { window.syncDriverPanelMinHint?.(); } catch (_) {}
                try { window.syncPanelHideChevron?.(); } catch (_) {}
                try { localStorage.setItem(PANEL_HIDDEN_KEY, collapsed ? '1' : '0'); } catch (_) {}
                window.syncDriverRadarFloatPanel?.();
                window.syncDriverPanelNavVisibility?.();
                window.updatePassengerPromoStripVisibility?.();
                window.refreshPassengerCopaUI?.();
                // iOS/Android: reflow para aplicar max-height del colapsado
                try { void panel?.offsetHeight; } catch (_) {}
                return;
            }

            // Desktop no-cliente: ocultar del todo
            panel?.classList.remove('panel-collapsed');
            document.body.classList.remove('panel-minimized', 'panel-collapsed');
            document.body.classList.add('panel-hidden');
            panel?.classList.add('panel-hidden');
            const label = document.getElementById('trip-panel-toggle-label');
            if (label) label.textContent = 'Ver más';
            try { localStorage.setItem(PANEL_HIDDEN_KEY, '1'); } catch (_) {}
            try { window.syncPanelHideChevron?.(); } catch (_) {}
            window.updatePassengerPromoStripVisibility?.();
            window.refreshPassengerCopaUI?.();
        };

        window.initControlPanelVisibility = () => {
            const isMobile = window.innerWidth < 768;
            const hasTrip = document.body.classList.contains('trip-active');
            const isDriver = document.body.classList.contains('driver-mode');
            try { window.bindPanelHideChevron?.(); } catch (_) {}

            if (document.body.classList.contains('is-searching')) {
                window.showControlPanel();
                try { window.syncPanelHideChevron?.(); } catch (_) {}
                return;
            }

            if (isDriver) {
                document.body.classList.remove('panel-hidden');
                document.getElementById('control-panel')?.classList.remove('panel-hidden');
                try {
                    if (localStorage.getItem(PANEL_HIDDEN_KEY) === '1') {
                        const p = document.getElementById('control-panel');
                        if (p) p.classList.add('panel-collapsed');
                        document.body.classList.add('panel-minimized', 'panel-collapsed');
                    }
                } catch (_) {}
                window.syncDriverRadarFloatPanel?.();
                try { window.syncPanelHideChevron?.(); } catch (_) {}
                return;
            }

            if (isMobile && hasTrip) {
                // On mobile during trip: respect only user minimize choice via panel-minimized.
                // Do not use the full panel-hidden state automatically.
                try {
                    if (localStorage.getItem(PANEL_HIDDEN_KEY) === '1') {
                        const p = document.getElementById('control-panel');
                        if (p) p.classList.add('panel-collapsed');
                        document.body.classList.add('panel-minimized');
                    }
                } catch (_) {}
                return;
            }

            // Durante viaje permitir estado minimizado/oculto si el usuario lo eligió
            try {
                if (localStorage.getItem(PANEL_HIDDEN_KEY) === '1') {
                    document.body.classList.add('panel-hidden');
                    document.getElementById('control-panel')?.classList.add('panel-hidden');
                } else {
                    window.showControlPanel();
                }
            } catch (_) {
                window.showControlPanel();
            }
        };

        window.resetTripPanelCollapse = () => {
            const isMobile = window.innerWidth < 768;
            const hasActiveTrip = document.body.classList.contains('trip-active');

            // On mobile, during trip: do NOT auto un-minimize the central trip panel.
            // It should only disappear / minimize when user explicitly taps the minimize button.
            if (isMobile && hasActiveTrip) {
                return;
            }

            document.getElementById('control-panel')?.classList.remove('panel-collapsed');
            document.body.classList.remove('panel-minimized');
            window.showControlPanel?.();
            const label = document.getElementById('trip-panel-toggle-label');
            if (label) label.textContent = 'Minimizar';
            if (document.body.classList.contains('driver-mode')) {
                window.dockControlPanelForDriverTrip?.();
                window.syncDriverRadarFloatPanel?.();
            }

            // Hide the nav HUD when resetting (main panel no longer minimized)
            if (document.body.classList.contains('driver-nav-mode')) {
                const hud = document.getElementById('nav-hud-bottom');
                if (hud) hud.style.display = 'none';
            }
        };

        /** Minimiza el panel central del conductor para dejar visible la calificación post-viaje. */
        window.minimizeControlPanelForDriverRating = () => {
            const panel = document.getElementById('control-panel');
            if (!panel) return;
            panel.classList.add('panel-collapsed');
            document.body.classList.add('panel-minimized');
            window.syncPassengerPanelToggleLabel?.();
            window.hideTripFloatPanels?.();
            const navHud = document.getElementById('nav-hud-bottom');
            if (navHud) navHud.style.display = 'none';
            if (document.body.classList.contains('driver-mode')) {
                window.syncDriverRadarFloatPanel?.();
            }
        };

        /** Actualiza el chevron de esquina (v / ^) según min/max del panel */
        window.syncDriverPanelMinHint = () => {
            const panel = document.getElementById('control-panel');
            const collapsed = !!panel?.classList.contains('panel-collapsed')
                || document.body.classList.contains('panel-minimized')
                || document.body.classList.contains('panel-collapsed')
                || document.body.classList.contains('panel-hidden');
            const minHint = document.querySelector('#control-panel .driver-panel-min-hint');
            if (minHint) minHint.textContent = collapsed ? 'Maximizar' : 'Minimizar';
            const minBtn = document.getElementById('driver-panel-min-btn');
            if (minBtn) {
                minBtn.setAttribute('aria-label', collapsed ? 'Maximizar panel' : 'Minimizar panel');
                minBtn.setAttribute('title', collapsed ? 'Maximizar' : 'Minimizar');
                minBtn.classList.toggle('is-collapsed', !!collapsed);
            }
        };

        window.syncPanelHideChevron = () => {
            const btn = document.getElementById('panel-hide-btn')
                || document.querySelector('#control-panel > .panel-hide-btn')
                || document.querySelector('#control-panel .panel-hide-btn');
            if (!btn) return;
            const panel = document.getElementById('control-panel');
            const collapsed = !!panel?.classList.contains('panel-collapsed')
                || document.body.classList.contains('panel-minimized')
                || document.body.classList.contains('panel-hidden');
            const icon = btn.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-chevron-down', 'fa-chevron-up');
                icon.classList.add(collapsed ? 'fa-chevron-up' : 'fa-chevron-down');
            }
            btn.setAttribute('aria-label', collapsed ? 'Maximizar panel' : 'Minimizar panel');
            btn.setAttribute('title', collapsed ? 'Maximizar' : 'Minimizar');
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            btn.classList.toggle('is-collapsed', collapsed);
        };

        /**
         * Chevron min/max: click real (no drag).
         * En web el panel con cursor:grab / touch-action pan-y convertía el toque en “movimiento”.
         * Criterio: pointerdown → pointerup con desplazamiento < 18px = click.
         */
        window.bindPanelHideChevron = () => {
            const btn = document.getElementById('panel-hide-btn')
                || document.querySelector('#control-panel > .panel-hide-btn');
            if (!btn || btn.dataset.chevronBound === '1') return;
            btn.dataset.chevronBound = '1';

            let lastFireAt = 0;
            let press = null; // { x, y, id, t }

            const stopAll = (e) => {
                try {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                } catch (_) {}
            };

            const doToggle = () => {
                const now = Date.now();
                if (now - lastFireAt < 400) return;
                lastFireAt = now;
                // No bloquear por wasRecentPanelDrag: este botón NUNCA es drag
                if (typeof window.toggleActivePanel === 'function') {
                    window.toggleActivePanel();
                } else {
                    window.hideControlPanel?.();
                }
                try { window.syncPanelHideChevron?.(); } catch (_) {}
            };

            btn.addEventListener('pointerdown', (e) => {
                if (e.button != null && e.button !== 0) return;
                stopAll(e);
                press = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now() };
                try { btn.setPointerCapture(e.pointerId); } catch (_) {}
            }, { capture: true, passive: false });

            btn.addEventListener('pointermove', (e) => {
                if (!press || e.pointerId !== press.id) return;
                // No dejar que el navegador/gestos del panel tomen el gesto
                stopAll(e);
            }, { capture: true, passive: false });

            btn.addEventListener('pointerup', (e) => {
                if (!press || e.pointerId !== press.id) return;
                stopAll(e);
                const dx = Math.abs(e.clientX - press.x);
                const dy = Math.abs(e.clientY - press.y);
                const dt = Date.now() - press.t;
                try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
                press = null;
                // Hasta ~18px de “temblor” cuenta como click (no drag)
                if (dx > 18 || dy > 18) return;
                if (dt > 900) return; // long-press: ignorar
                doToggle();
            }, { capture: true, passive: false });

            btn.addEventListener('pointercancel', (e) => {
                if (press && e.pointerId === press.id) press = null;
                try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
            }, { capture: true });

            // Fallback mouse/accesibilidad (si no hubo pointerup útil)
            btn.addEventListener('click', (e) => {
                stopAll(e);
                doToggle();
            }, { capture: true, passive: false });

            // Evitar menú contextual / selección en hold
            btn.addEventListener('contextmenu', (e) => stopAll(e), { capture: true });

            try { window.syncPanelHideChevron?.(); } catch (_) {}
        };

        /**
         * Botones «Minimizar» del sheet (texto): click real, no drag.
         * Aplica a conductor (#driver-panel-min-btn) y pasajero (#passenger-panel-min-btn).
         */
        function bindPanelMinButton(btn) {
            if (!btn || btn.dataset.minBtnBound === '1') return;
            btn.dataset.minBtnBound = '1';

            let lastFireAt = 0;
            let press = null;

            const stopAll = (e) => {
                try {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                } catch (_) {}
            };

            const doToggle = () => {
                const now = Date.now();
                if (now - lastFireAt < 400) return;
                lastFireAt = now;
                if (typeof window.toggleActivePanel === 'function') {
                    window.toggleActivePanel();
                }
            };

            btn.addEventListener('pointerdown', (e) => {
                if (e.button != null && e.button !== 0) return;
                stopAll(e);
                press = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now() };
                try { btn.setPointerCapture(e.pointerId); } catch (_) {}
            }, { capture: true, passive: false });

            btn.addEventListener('pointermove', (e) => {
                if (!press || e.pointerId !== press.id) return;
                stopAll(e);
            }, { capture: true, passive: false });

            btn.addEventListener('pointerup', (e) => {
                if (!press || e.pointerId !== press.id) return;
                stopAll(e);
                const dx = Math.abs(e.clientX - press.x);
                const dy = Math.abs(e.clientY - press.y);
                const dt = Date.now() - press.t;
                try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
                press = null;
                if (dx > 18 || dy > 18) return;
                if (dt > 900) return;
                doToggle();
            }, { capture: true, passive: false });

            btn.addEventListener('pointercancel', (e) => {
                if (press && e.pointerId === press.id) press = null;
                try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
            }, { capture: true });

            btn.addEventListener('click', (e) => {
                stopAll(e);
                doToggle();
            }, { capture: true, passive: false });
        }

        window.bindDriverPanelMinBtn = () => {
            const btn = document.getElementById('driver-panel-min-btn')
                || document.querySelector('#control-panel .trip-min-label-btn')
                || document.querySelector('#control-panel .trip-drag-handle[data-trip-action="toggle-panel"]');
            bindPanelMinButton(btn);
        };

        window.bindPassengerPanelMinBtn = () => {
            bindPanelMinButton(document.getElementById('passenger-panel-min-btn'));
            // Etiqueta Minimizar / Maximizar
            const btn = document.getElementById('passenger-panel-min-btn');
            const label = btn?.querySelector('.passenger-panel-min-label');
            const collapsed = document.body.classList.contains('panel-minimized')
                || document.getElementById('control-panel')?.classList.contains('panel-collapsed');
            if (label) label.textContent = collapsed ? 'Maximizar' : 'Minimizar';
            if (btn) {
                btn.setAttribute('aria-label', collapsed ? 'Maximizar panel' : 'Minimizar panel');
                btn.setAttribute('title', collapsed ? 'Maximizar' : 'Minimizar');
                btn.classList.toggle('is-collapsed', !!collapsed);
            }
        };

        // Bind temprano (HTML ya en el DOM cuando se carga este script)
        try {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    window.bindPanelHideChevron?.();
                    window.bindDriverPanelMinBtn?.();
                    window.bindPassengerPanelMinBtn?.();
                }, { once: true });
            } else {
                window.bindPanelHideChevron();
                window.bindDriverPanelMinBtn();
                window.bindPassengerPanelMinBtn();
            }
        } catch (_) {}

        window.toggleActivePanel = () => {
            const panel = document.getElementById('control-panel');
            if (!panel) return;
            const isClient = document.body.classList.contains('client-mode');
            const isDriver = document.body.classList.contains('driver-mode');
            const onActiveTrip = document.body.classList.contains('trip-active');

            // Conductor con popup de oferta / peek: no pelear con el panel (queda oculto a propósito)
            if (isDriver && (
                document.body.classList.contains('driver-offer-popup-open')
                || document.body.classList.contains('driver-offer-map-peek')
            )) {
                return;
            }

            // PASAJERO: en viaje → colapsar a mini-barra (sigue tocable).
            // Fuera de viaje → puede ocultar del todo. Abrir de nuevo con FAB / toggle.
            if (isClient && !isDriver) {
                const currentlyHidden = document.body.classList.contains('panel-hidden')
                    || panel.classList.contains('panel-hidden')
                    || document.body.classList.contains('panel-minimized')
                    || panel.classList.contains('panel-collapsed');
                if (currentlyHidden) {
                    document.body.classList.remove('panel-hidden', 'panel-minimized', 'panel-collapsed');
                    panel.classList.remove('panel-hidden', 'panel-collapsed');
                    try { localStorage.setItem(PANEL_HIDDEN_KEY, '0'); } catch (_) {}
                } else if (onActiveTrip) {
                    // Viaje activo: NO panel-hidden (en APK se “trababa” y no se veía el mapa bien)
                    document.body.classList.add('panel-minimized', 'panel-collapsed');
                    document.body.classList.remove('panel-hidden');
                    panel.classList.add('panel-collapsed');
                    panel.classList.remove('panel-hidden');
                    try { localStorage.setItem(PANEL_HIDDEN_KEY, '1'); } catch (_) {}
                } else {
                    document.body.classList.add('panel-hidden', 'panel-minimized', 'panel-collapsed');
                    panel.classList.add('panel-hidden', 'panel-collapsed');
                    try { localStorage.setItem(PANEL_HIDDEN_KEY, '1'); } catch (_) {}
                }
                const collapsed = document.body.classList.contains('panel-minimized')
                    || panel.classList.contains('panel-collapsed')
                    || document.body.classList.contains('panel-hidden');
                const paxMinLabel = document.querySelector('#passenger-panel-min-btn .passenger-panel-min-label');
                if (paxMinLabel) paxMinLabel.textContent = collapsed ? 'Maximizar' : 'Minimizar';
                const paxMinBtn = document.getElementById('passenger-panel-min-btn');
                if (paxMinBtn) {
                    paxMinBtn.setAttribute('aria-label', collapsed ? 'Maximizar panel' : 'Minimizar panel');
                    paxMinBtn.setAttribute('title', collapsed ? 'Maximizar' : 'Minimizar');
                }
                // Un solo “abierto”: al maximizar el panel central → pastilla del conductor.
                // Al minimizar el panel → se deja la burbuja como está (el user la toca para ver al conductor).
                if (onActiveTrip) {
                    try {
                        if (!collapsed) {
                            window.toggleTripFloatMinimized?.('client-trip', true);
                        }
                    } catch (_) {}
                }
                window.syncPassengerPanelToggleLabel?.();
                try { window.syncPanelHideChevron?.(); } catch (_) {}
                try { window.bindPassengerPanelMinBtn?.(); } catch (_) {}
                window.updatePassengerPromoStripVisibility?.();
                window.refreshPassengerCopaUI?.();
                try { void panel.offsetHeight; } catch (_) {}
                return;
            }

            panel.classList.toggle('panel-collapsed');
            const collapsed = panel.classList.contains('panel-collapsed');
            // body + panel en sync (CSS usa ambos selectores)
            document.body.classList.toggle('panel-minimized', collapsed);
            document.body.classList.toggle('panel-collapsed', collapsed);
            document.body.classList.remove('panel-hidden');
            panel.classList.remove('panel-hidden');
            // Quitar alturas inline residuales para que el CSS del colapsado gane
            try {
                panel.style.height = '';
                panel.style.maxHeight = '';
                panel.style.minHeight = '';
                panel.style.top = collapsed ? '' : panel.style.top;
                if (collapsed) {
                    panel.style.top = '';
                    panel.style.bottom = '';
                }
            } catch (_) {}
            // Al minimizar/maximizar a mano, quitar “peek” residual de ofertas
            if (collapsed) {
                panel.classList.remove('driver-offer-peek-hidden');
            } else {
                panel.classList.remove('driver-offer-peek-hidden');
            }
            try { localStorage.setItem(PANEL_HIDDEN_KEY, collapsed ? '1' : '0'); } catch (_) {}
            window.syncPassengerPanelToggleLabel?.();

            // Conductor: preferencia del usuario (no auto-minimizar si lo abrió a mano)
            const roleIsDriver = document.body.classList.contains('driver-mode')
                || window.userProfile?.role === 'driver'
                || !!window.userProfile?.isTestDriver;
            if (roleIsDriver) {
                document.body.classList.add('driver-mode');
                document.body.classList.remove('client-mode');
                if (collapsed) {
                    window._driverNavUserKeptOpen = false;
                } else {
                    window._driverNavUserKeptOpen = true;
                    window._driverNavPanelAutoMinDone = true;
                }
                try { window.bindDriverPanelMinBtn?.(); } catch (_) {}
                try { window.syncDriverIdleVsActiveTripUi?.(); } catch (_) {}
            }

            // Mini-barra: Abrir (minimizado) / etiqueta auxiliar
            const label = document.getElementById('trip-panel-toggle-label');
            if (label) {
                label.textContent = collapsed
                    ? 'Abrir'
                    : (document.body.classList.contains('driver-mode') ? 'Cerrar' : 'Minimizar');
            }
            const tpLabel = document.getElementById('tp-panel-toggle-label');
            if (tpLabel) tpLabel.textContent = collapsed ? 'Ver más' : 'Minimizar';
            try { window.syncDriverPanelMinHint?.(); } catch (_) {}
            try { window.syncPanelHideChevron?.(); } catch (_) {}
            try { window.bindPassengerPanelMinBtn?.(); } catch (_) {}

            if (document.body.classList.contains('driver-mode') || roleIsDriver) {
                if (collapsed) window.syncDriverRadarFloatPanel?.();
                else {
                    window.dockControlPanelForDriverTrip?.();
                    // Sheet abajo: limpiar estilos full-screen residuales
                    if (panel && document.body.classList.contains('trip-active')) {
                        panel.style.top = '';
                        panel.style.bottom = '';
                        panel.style.height = '';
                        panel.style.maxHeight = '';
                        panel.classList.remove('panel-is-floating', 'is-drag-positioned');
                    }
                    window.syncDriverRadarFloatPanel?.();
                    // Seguir navegando con el panel abierto
                    if (window.isDriverNavigating?.() && window.currentDriverPos && window.autoCenter !== false) {
                        try {
                            window._lastDriverNavCamPos = null;
                            window.applyDriverNavCamera?.(
                                window.currentDriverPos,
                                window.currentDriverHeading,
                                true
                            );
                        } catch (_) {}
                    }
                }
                window.syncDriverPanelNavVisibility?.();
            } else if (!collapsed) {
                window.dockControlPanelForClient?.();
            }

            // iOS/Android: forzar reflow para que max-height del colapsado se aplique al toque
            try {
                // eslint-disable-next-line no-unused-expressions
                panel.offsetHeight;
            } catch (_) {}
            window.updatePassengerPromoStripVisibility?.();
            window.refreshPassengerCopaUI?.();
        };

        window.syncNavHudToggleUi = () => {
            const isMin = document.body.classList.contains('nav-hud-minimized');
            const btn = document.querySelector('#nav-hud-bottom [data-trip-action="toggle-nav-hud"]');
            if (!btn) return;
            btn.setAttribute('aria-label', isMin ? 'Abrir panel de navegación' : 'Minimizar panel de navegación');
            btn.setAttribute('title', isMin ? 'Abrir navegación' : 'Minimizar navegación');
        };

        window.toggleNavHud = () => {
            if (!document.body.classList.contains('driver-nav-mode')) return;
            document.body.classList.toggle('nav-hud-minimized');
            const hud = document.getElementById('nav-hud-bottom');
            if (hud) hud.style.display = 'flex';
            window.syncNavHudToggleUi?.();
        };

        window.toggleNavHudTop = () => {
            if (!document.body.classList.contains('is-navigating')) return;
            document.body.classList.toggle('nav-hud-top-minimized');
            window.syncNavHudTopToggleUi?.();
        };

        window.syncNavHudTopToggleUi = () => {
            const btn = document.querySelector('[data-trip-action="toggle-nav-hud-top"]');
            if (!btn) return;
            const isMin = document.body.classList.contains('nav-hud-top-minimized');
            btn.setAttribute('aria-label', isMin ? 'Abrir instrucciones' : 'Minimizar instrucciones');
            btn.setAttribute('title', isMin ? 'Abrir instrucciones' : 'Minimizar');
        };

        window.formatRouteEta = (route) => {
            const ms = route?.durationMillis || route?.legs?.[0]?.durationMillis;
            if (!ms) return '--:--';
            const arrival = new Date(Date.now() + ms);
            return arrival.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit', hour12: false });
        };

        window.syncTripMiniBar = (route) => {
            if (!route) return;
            const time = window.formatRouteDuration(route);
            const dist = `${window.getRouteDistanceKm(route).toFixed(1)} km`;
            const eta = window.formatRouteEta(route);
            const miniTime = document.getElementById('trip-mini-time');
            const miniDist = document.getElementById('trip-mini-dist');
            const miniEta = document.getElementById('trip-mini-eta');
            const navEta = document.getElementById('nav-total-eta');
            if (miniTime) miniTime.textContent = time;
            if (miniDist) miniDist.textContent = dist;
            if (miniEta) miniEta.textContent = eta;
            if (navEta) navEta.textContent = eta;
            // Panel central + HUD legacy
            window.setNavHudText?.('totalTime', time);
            window.setNavHudText?.('totalDist', dist);
            window.setNavHudText?.('totalEta', eta);
            // Sheet Uber: solo el número de minutos
            const uberEta = document.getElementById('driver-uber-eta-time');
            if (uberEta) {
                const mins = route.durationMillis
                    ? Math.max(1, Math.round(route.durationMillis / 60000))
                    : (String(time).match(/(\d+)/)?.[1] || '--');
                uberEta.textContent = mins;
            }
        };

        window.chatOpen = false;
        window.toggleChat = () => {
            const chat = document.getElementById('chat-section');
            const chatFloat = document.getElementById('chat-float');
            const onTrip = document.body.classList.contains('trip-active');

            if (onTrip && chatFloat) {
                window.chatOpen = chatFloat.classList.contains('hidden');
                chatFloat.classList.toggle('hidden', !window.chatOpen);
                document.body.classList.toggle('trip-chat-open', window.chatOpen);
            } else if (chat) {
                chat.classList.toggle('collapsed');
                window.chatOpen = !chat.classList.contains('collapsed');
            } else {
                window.chatOpen = false;
            }

            if (window.chatOpen) {
                window.bindFloatingTripPanels?.();
                ['chat-badge', 'chat-badge-driver', 'driver-tools-chat-badge', 'driver-pin-chat-badge'].forEach((id) => {
                    const badge = document.getElementById(id);
                    if (!badge) return;
                    badge.classList.add('hidden');
                    badge.innerText = '0';
                    badge.classList.remove('animate-bounce');
                });
                setTimeout(() => {
                    const chatMsgs = document.getElementById('chat-messages');
                    if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
                    // En conductor no forzar focus al teclado del chat si está en PIN (evita pelear con el input del PIN)
                    const pinOpen = !document.getElementById('driver-pin-float')?.classList.contains('hidden')
                        && !document.getElementById('pin-input-group')?.classList.contains('hidden');
                    if (!(window.userProfile?.role === 'driver' && pinOpen)) {
                        document.getElementById('chat-input')?.focus?.({ preventScroll: true });
                    }
                }, 100);
            }
        };
        
        window.toggleTraffic = () => {
            if (!window.mapLoaded || !window.trafficLayer) return;
            
            window.isTrafficVisible = !window.isTrafficVisible;
            
            if (window.isTrafficVisible) {
                window.trafficLayer.setMap(window.gMap);
                document.getElementById('fab-traffic').classList.add('active');
            } else {
                window.trafficLayer.setMap(null);
                document.getElementById('fab-traffic').classList.remove('active');
            }
        };

        window.manualRouteRefresh = async () => {
            const trip = window.currentActiveTripData;
            if (!trip) return;
            let target;
            if (trip.status === 'in_progress') {
                target = (trip.destinationLat != null && trip.destinationLng != null)
                    ? { lat: trip.destinationLat, lng: trip.destinationLng }
                    : trip.destination;
            } else {
                target = await window.resolveTripPickupNavTarget?.(trip);
            }
            if (target) window.updateNavigation?.(target, true);
        };

        /** Lat/lng válidos para Google Maps (rechaza null/NaN/0,0 basura). */
        window.toGoogleMapsLatLng = (lat, lng) => {
            const la = Number(lat);
            const ln = Number(lng);
            if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
            if (Math.abs(la) < 0.00001 && Math.abs(ln) < 0.00001) return null;
            if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
            return { lat: la, lng: ln };
        };

        window.formatGoogleMapsLocationParam = (point) => {
            if (!point) return '';
            // String puro = dirección
            if (typeof point === 'string') {
                const s = point.trim();
                return s ? encodeURIComponent(s) : '';
            }
            const latLng = window.toGoogleMapsLatLng(
                point.latLng?.lat ?? point.lat,
                point.latLng?.lng ?? point.lng
            ) || window.toGoogleMapsLatLng(point.lat, point.lng);
            if (latLng) {
                return `${latLng.lat},${latLng.lng}`;
            }
            const addr = (point.address || point.placeName || point.name || '').toString().trim();
            return addr ? encodeURIComponent(addr) : '';
        };

        /**
         * Cadena de puntos para Google Maps (coords O dirección).
         * No depende de buildOrderedRoutePoints (ese exige lat/lng y fallaba al abrir Maps).
         */
        window.buildGoogleMapsRouteChain = (trip) => {
            if (!trip) return [];
            const chain = [];
            const push = (address, lat, lng, role) => {
                const ll = window.toGoogleMapsLatLng(lat, lng);
                const addr = (address || '').toString().trim();
                if (!ll && !addr) return;
                chain.push({
                    address: addr,
                    lat: ll?.lat,
                    lng: ll?.lng,
                    latLng: ll || null,
                    role,
                });
            };

            push(trip.origin || trip.originPlaceName, trip.originLat, trip.originLng, 'origin');
            (trip.additionalStops || []).forEach((s, i) => {
                if (!s) return;
                const ll = window.pointToLatLng?.(s) || window.toGoogleMapsLatLng(s.lat, s.lng) || s.latLng || null;
                push(
                    s.address || s.placeName || s.name || `Parada ${i + 1}`,
                    ll?.lat ?? s.lat,
                    ll?.lng ?? s.lng,
                    'stop'
                );
            });
            // Por horas sin destino: no forzar punto vacío
            if (trip.destination || (trip.destinationLat != null && trip.destinationLng != null)) {
                push(
                    trip.destination || trip.destinationPlaceName,
                    trip.destinationLat,
                    trip.destinationLng,
                    'destination'
                );
            }
            return chain;
        };

        window.buildGoogleMapsDirectionsUrl = (trip, options = {}) => {
            if (!trip) return null;

            const navMode = options.navMode || 'full';
            const chain = window.buildGoogleMapsRouteChain(trip);

            // Fallback si el viaje solo trae texto y no coords
            if (!chain.length) {
                const o = (trip.origin || trip.originPlaceName || '').toString().trim();
                const d = (trip.destination || trip.destinationPlaceName || o).toString().trim();
                if (o && d) {
                    chain.push({ address: o, role: 'origin' });
                    if (d !== o) chain.push({ address: d, role: 'destination' });
                    else chain.push({ address: d, role: 'destination' });
                }
            }

            if (!chain.length) return null;

            const driverPosParam = () => {
                if (!options.useDriverPosition || !window.currentDriverPos) return '';
                const ll = window.toGoogleMapsLatLng(
                    window.currentDriverPos.lat,
                    window.currentDriverPos.lng
                );
                return ll ? `${ll.lat},${ll.lng}` : '';
            };

            let originParam = '';
            let destinationParam = '';
            let waypointParams = [];

            if (navMode === 'pickup') {
                const pickup = chain[0];
                originParam = driverPosParam() || window.formatGoogleMapsLocationParam(pickup);
                destinationParam = window.formatGoogleMapsLocationParam(pickup);
            } else if (navMode === 'leg') {
                const legTarget = window.getTripCurrentLegNavTarget?.(trip);
                const legPoint = legTarget
                    ? {
                        address: legTarget.address || legTarget.placeName || '',
                        lat: legTarget.lat,
                        lng: legTarget.lng,
                        latLng: (legTarget.lat != null && legTarget.lng != null)
                            ? { lat: legTarget.lat, lng: legTarget.lng }
                            : null,
                    }
                    : chain[chain.length - 1];
                originParam = driverPosParam()
                    || window.formatGoogleMapsLocationParam(chain[0]);
                destinationParam = window.formatGoogleMapsLocationParam(legPoint);
            } else {
                originParam = driverPosParam()
                    || window.formatGoogleMapsLocationParam(chain[0]);
                destinationParam = window.formatGoogleMapsLocationParam(chain[chain.length - 1]);
                if (chain.length > 2) {
                    waypointParams = chain
                        .slice(1, -1)
                        .map((p) => window.formatGoogleMapsLocationParam(p))
                        .filter(Boolean);
                }
            }

            // Si solo hay un punto (p.ej. por horas sin destino), usar ese como destino
            if (originParam && !destinationParam) destinationParam = originParam;
            if (!originParam && destinationParam) {
                originParam = driverPosParam() || destinationParam;
            }
            if (!originParam || !destinationParam) return null;

            let url = `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destinationParam}&travelmode=driving`;
            if (waypointParams.length) {
                // Google acepta | codificado como %7C
                url += `&waypoints=${waypointParams.join('%7C')}`;
            }
            return url;
        };

        /**
         * Abre URL de direcciones en la app de Google Maps (o navegador).
         * En Android WebView window.open suele fallar; se usan varios fallbacks.
         */
        window.openGoogleMapsDirectionsUrl = async (url) => {
            if (!url) {
                window.showToast?.('No se pudo armar la ruta para Google Maps.');
                return false;
            }

            const isNative = !!window.Capacitor?.isNativePlatform?.();
            const isAndroid = !!window.Capacitor?.getPlatform?.()
                ? window.Capacitor.getPlatform() === 'android'
                : /Android/i.test(navigator.userAgent || '');

            // 1) Helper nativo robusto (intent / App.openUrl / Browser)
            try {
                if (typeof window.openExternalUrl === 'function') {
                    const ok = await window.openExternalUrl(url);
                    if (ok) return true;
                }
            } catch (e) {
                console.warn('openGoogleMapsDirectionsUrl openExternalUrl:', e);
            }

            // 2) Intent nativo de Google Maps (app instalada)
            if (isNative || isAndroid) {
                try {
                    const CapApp = window.Capacitor?.Plugins?.App;
                    if (CapApp?.openUrl) {
                        await CapApp.openUrl({ url });
                        return true;
                    }
                } catch (e) {
                    console.warn('openGoogleMapsDirectionsUrl App.openUrl:', e);
                }

                // Intent scheme: abre la app de Maps si existe
                try {
                    const bare = url.replace(/^https?:\/\//i, '');
                    const intentUrl =
                        `intent://${bare}#Intent;scheme=https;package=com.google.android.apps.maps;` +
                        `action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
                    window.location.href = intentUrl;
                    return true;
                } catch (e) {
                    console.warn('openGoogleMapsDirectionsUrl intent:', e);
                }

                try {
                    const CapBrowser = window.Capacitor?.Plugins?.Browser;
                    if (CapBrowser?.open) {
                        await CapBrowser.open({ url, windowName: '_system' });
                        return true;
                    }
                } catch (e) {
                    console.warn('openGoogleMapsDirectionsUrl Browser:', e);
                }

                try {
                    const w = window.open(url, '_system');
                    if (w) return true;
                } catch (_) {}
            }

            // 3) Web
            let opened = null;
            try {
                opened = window.open(url, '_blank', 'noopener,noreferrer');
            } catch (_) {}
            if (!opened) {
                try {
                    window.location.assign(url);
                    return true;
                } catch (_) {
                    window.showToast?.('No se pudo abrir Google Maps. Probá de nuevo.', 'warning');
                    return false;
                }
            }
            return true;
        };

        window.openTripRouteInGoogleMaps = async (trip, options = {}) => {
            if (!trip) {
                window.showToast?.('No hay ruta disponible.');
                return false;
            }
            try {
                if (options.useDriverPosition) {
                    await window.ensureDriverPosition?.();
                }
                const url = window.buildGoogleMapsDirectionsUrl(trip, options);
                if (!url) {
                    window.showToast?.(
                        'Faltan origen o destino del viaje para abrir Google Maps.',
                        'warning'
                    );
                    return false;
                }
                return await window.openGoogleMapsDirectionsUrl(url);
            } catch (e) {
                console.error('openTripRouteInGoogleMaps:', e);
                window.showToast?.('Error al abrir Google Maps. Intentá de nuevo.', 'error');
                return false;
            }
        };

        window.openPassengerTripRouteInGoogleMaps = async () => {
            const trip = window.currentActiveTripData || window.activeTrip;
            if (!trip) {
                window.showToast?.('No hay un viaje activo.');
                return;
            }
            await window.openTripRouteInGoogleMaps(trip, { navMode: 'full' });
        };

        /**
         * Navegación PRINCIPAL: dentro de HonduRaite (sin salir del sitio).
         * Dibuja ruta por calles, centra mapa y arranca seguimiento.
         */
        window.navigateDriverRouteInApp = async (opts = {}) => {
            const trip = window.currentActiveTripData || window.activeTrip;
            if (!trip) {
                window.showToast?.('No hay un viaje activo.');
                return false;
            }
            if (window.userProfile?.role === 'driver' && trip.driverId && window.currentUser?.uid
                && trip.driverId !== window.currentUser.uid) {
                window.showToast?.('Solo el conductor del viaje puede navegar esta ruta.');
                return false;
            }

            if (opts.silent !== true) {
                window.showToast?.('Iniciando navegación en el mapa…', 'info');
            }
            await window.ensureDriverPosition?.();

            try {
                window.driverNavMode = true;
                window.driverVoiceNavEnabled = window.driverVoiceNavEnabled !== false;
                document.body.classList.add('driver-nav-mode', 'is-navigating');
                window.autoCenter = true;
                // Tráfico: no auto-activar en APK (capa extra que traba el mapa)
                if (window.trafficLayer && window.gMap && !window.hrUseLiteMaps?.()) {
                    window.trafficLayer.setMap(window.gMap);
                    window.isTrafficVisible = true;
                    document.getElementById('fab-traffic')?.classList.add('active');
                }
                // Entra nav: auto-min una vez; si el usuario maximizó, se respeta
                window.enterDriverNavMode?.();
                if (!window._driverNavPanelAutoMinDone && !window._driverNavUserKeptOpen) {
                    window._driverNavPanelAutoMinDone = true;
                    window.minimizeDriverPanelForNav?.();
                }
                window.startDriverCompassTracking?.().catch?.(() => {});
                window.syncDriverPanelNavVisibility?.();
                if (window.currentDriverPos) {
                    window.applyDriverNavCamera?.(
                        window.currentDriverPos,
                        window.currentDriverHeading,
                        true
                    );
                }
            } catch (_) {}

            const isDestPhase = trip.status === 'in_progress'
                || (trip.status === 'accepted' && trip.driverArrived);
            let target = null;

            try {
                if (isDestPhase) {
                    target = window.getTripCurrentLegNavTarget?.(trip)
                        || (trip.destinationLat != null
                            ? { lat: Number(trip.destinationLat), lng: Number(trip.destinationLng), address: trip.destination }
                            : trip.destination);
                } else {
                    target = await window.resolveTripPickupNavTarget?.(trip);
                }
            } catch (e) {
                console.warn('navigateDriverRouteInApp target:', e);
            }

            if (!target) {
                window.showToast?.('No se pudo resolver el destino de la ruta. Probá "Abrir en Google Maps".', 'warning');
                return false;
            }

            // Invalidar ruta previa para forzar recompute + anuncio de voz
            try {
                window.currentNavRoute = null;
                window.currentRouteFullPath = null;
                window._navRouteReadySpoken = false;
                window.resetDriverNavVoice?.();
            } catch (_) {}

            window.updateNavigation?.(target, true);
            window.ensureDriverNavRouteVisible?.();
            window.syncNavVoiceToggleUi?.();
            window.syncNavVoicePickerUi?.();

            if (opts.silent !== true) {
                window.showToast?.('Navegación activa. Voz + mapa · Google Maps sigue disponible abajo.', 'success');
            }
            return true;
        };

        window.navigatePassengerRouteInApp = async () => {
            const trip = window.currentActiveTripData || window.activeTrip;
            if (!trip) {
                window.showToast?.('No hay un viaje activo.');
                return false;
            }
            try {
                if (trip.status === 'in_progress') {
                    const dest = trip.destinationLat != null
                        ? { lat: Number(trip.destinationLat), lng: Number(trip.destinationLng), address: trip.destination }
                        : (window.getTripCurrentLegNavTarget?.(trip) || trip.destination);
                    if (trip.driverId && dest) {
                        window.trackDriverRoute?.(trip.driverId, dest, { phase: 'destination', tripData: trip });
                    }
                } else if (trip.driverId) {
                    const target = await window.resolveTripPickupNavTarget?.(trip);
                    if (target) {
                        window.trackDriverRoute?.(trip.driverId, target, { phase: 'pickup', tripData: trip });
                        window.updateETA?.(trip.driverId, target, trip);
                    }
                }
                window.showToast?.('Seguimiento en el mapa de HonduRaite.', 'success');
                return true;
            } catch (e) {
                console.warn('navigatePassengerRouteInApp:', e);
                window.showToast?.('No se pudo cargar la ruta en el mapa.', 'warning');
                return false;
            }
        };

        window.openDriverRouteInGoogleMaps = async () => {
            try {
                // currentActiveTripData o activeTrip (a veces solo uno está set)
                const trip = window.currentActiveTripData || window.activeTrip || null;
                if (!trip || (!trip.id && !trip.origin && !trip.originLat)) {
                    window.showToast?.('No hay un viaje activo para abrir en Google Maps.');
                    return false;
                }

                // Alinear ambos para el resto del flujo
                window.currentActiveTripData = trip;
                window.activeTrip = trip;

                await window.ensureDriverPosition?.().catch?.(() => null);

                const isDestPhase = trip.status === 'in_progress'
                    || (trip.status === 'accepted' && trip.driverArrived);
                const hasStops = (trip.additionalStops || []).length > 0;

                if (isDestPhase) {
                    return await window.openTripRouteInGoogleMaps(trip, {
                        navMode: hasStops ? 'leg' : 'full',
                        useDriverPosition: true,
                    });
                }

                // Fase recogida: conductor → punto de origen del pasajero
                let target = null;
                try {
                    target = await window.resolveTripPickupNavTarget?.(trip);
                } catch (e) {
                    console.warn('openDriverRouteInGoogleMaps pickup target:', e);
                }

                const pickupLat = (typeof target === 'object' && target)
                    ? (target.lat ?? target.latLng?.lat)
                    : null;
                const pickupLng = (typeof target === 'object' && target)
                    ? (target.lng ?? target.latLng?.lng)
                    : null;
                const pickupAddr = typeof target === 'string'
                    ? target
                    : (target?.address || trip.origin || trip.originPlaceName || '');

                const pickupTrip = {
                    ...trip,
                    origin: pickupAddr || trip.origin || '',
                    originLat: pickupLat ?? trip.originLat,
                    originLng: pickupLng ?? trip.originLng,
                    destination: pickupAddr || trip.origin || '',
                    destinationLat: pickupLat ?? trip.originLat,
                    destinationLng: pickupLng ?? trip.originLng,
                    additionalStops: [],
                };

                const ok = await window.openTripRouteInGoogleMaps(pickupTrip, {
                    navMode: 'pickup',
                    useDriverPosition: true,
                });
                if (ok) return true;

                // Último recurso: URL con lo que haya en el viaje original
                return await window.openTripRouteInGoogleMaps(trip, {
                    navMode: 'pickup',
                    useDriverPosition: true,
                });
            } catch (e) {
                console.error('openDriverRouteInGoogleMaps:', e);
                window.showToast?.(
                    e?.message || 'No se pudo abrir la ruta en Google Maps.',
                    'error'
                );
                return false;
            }
        };

        window.hideDriverTripExtraPanels = () => {
            if (!document.body.classList.contains('trip-active')
                || !document.body.classList.contains('driver-mode')) {
                // No borrar driver-trip-dest-phase si estamos arrancando nav post-PIN
                if (!window._startingDestNavTripId) {
                    document.body.classList.remove('driver-trip-dest-phase');
                }
                return;
            }
            // Nunca apagar nav en viaje activo del conductor
            const navigating = window.isDriverNavigating?.()
                || window.driverNavMode
                || document.body.classList.contains('is-navigating')
                || document.body.classList.contains('driver-trip-dest-phase')
                || !!window._startingDestNavTripId
                || window.hasActiveDriverNavRoute?.()
                || (window.currentActiveTripData?.status === 'in_progress'
                    && window.currentActiveTripData?.driverId === window.currentUser?.uid);
            if (navigating) {
                // Reafirmar clases y HUD (tras PIN a veces se perdían)
                document.body.classList.add('is-navigating', 'driver-nav-mode');
                if (window.currentActiveTripData?.status === 'in_progress') {
                    document.body.classList.add('driver-trip-dest-phase');
                }
                window.driverNavMode = true;
                window.syncDriverPanelNavVisibility?.();
            } else {
                const navTop = document.getElementById('nav-hud-top');
                const navBottom = document.getElementById('nav-hud-bottom');
                if (navTop) navTop.style.setProperty('display', 'none', 'important');
                if (navBottom) navBottom.style.setProperty('display', 'none', 'important');
            }
            window.hideCenterMapFab?.();
            window.dockControlPanelForDriverTrip?.();
        };

        window.driverVoiceNavEnabled = true;
        const NAV_VOICE_STORAGE_KEY = 'honduber_driver_nav_voice';

        window.getNavVoiceGender = (voice) => {
            if (!voice) return 'unknown';
            if (voice.gender === 'female') return 'female';
            if (voice.gender === 'male') return 'male';

            const blob = `${voice.voiceURI || ''} ${voice.name || ''}`.toLowerCase();
            const femaleHints = [
                'female', 'femenin', 'mujer', 'woman',
                'paulina', 'helena', 'monica', 'mónica', 'lucia', 'lucía', 'laura', 'sabina',
                'penelope', 'penélope', 'carlota', 'soledad', 'esperanza', 'maria', 'maría',
                'angelica', 'angélica', 'isabela', 'valeria', 'paloma', 'carmen', 'lorena',
                'rosa', 'nuria', 'teresa', 'elena', 'zira', 'mia', 'camila', 'sofia', 'sofía',
                'linda', 'esmeralda', 'renata', 'dalia', 'beatriz', 'ines', 'inés', 'juana',
                '-efe-', '_efe_', ' x-efe', 'google español', 'spanish (latin america) female'
            ];
            const maleHints = [
                'male', 'masculin', 'hombre', 'man ',
                'jorge', 'diego', 'carlos', 'pablo', 'juan', 'miguel', 'rodrigo', 'daniel',
                'enrique', 'raul', 'raúl', 'andres', 'andrés', 'fernando', 'ricardo', 'alberto',
                '-ema-', '_ema_', ' x-ema'
            ];
            if (femaleHints.some((h) => blob.includes(h))) return 'female';
            if (maleHints.some((h) => blob.includes(h))) return 'male';
            return 'unknown';
        };

        window.getNavVoiceGenderLabel = (voice) => {
            const g = window.getNavVoiceGender(voice);
            if (g === 'female') return 'Femenina';
            if (g === 'male') return 'Masculina';
            return 'Neutral';
        };

        const navVoiceGenderRank = (voice) => {
            const g = window.getNavVoiceGender(voice);
            if (g === 'female') return 0;
            if (g === 'unknown') return 1;
            return 2;
        };

        window.getSpanishNavVoices = () => {
            if (!('speechSynthesis' in window)) return [];
            const voices = window.speechSynthesis.getVoices?.() || [];
            const es = voices.filter((v) => v.lang?.toLowerCase().startsWith('es'));
            const uniq = new Map();
            es.forEach((v) => {
                const key = v.voiceURI || v.name;
                if (!uniq.has(key)) uniq.set(key, v);
            });
            return [...uniq.values()].sort((a, b) => {
                const gr = navVoiceGenderRank(a) - navVoiceGenderRank(b);
                if (gr !== 0) return gr;
                const la = (a.lang || '').localeCompare(b.lang || '');
                if (la !== 0) return la;
                return (a.name || '').localeCompare(b.name || '');
            });
        };

        window.getSpanishNavVoicesGrouped = () => {
            const voices = window.getSpanishNavVoices();
            const groups = [
                { id: 'female', title: 'Voces femeninas', icon: 'fa-venus', voices: [] },
                { id: 'male', title: 'Voces masculinas', icon: 'fa-mars', voices: [] },
                { id: 'unknown', title: 'Otras voces', icon: 'fa-volume-up', voices: [] }
            ];
            voices.forEach((v) => {
                const g = window.getNavVoiceGender(v);
                const bucket = g === 'female' ? groups[0] : (g === 'male' ? groups[1] : groups[2]);
                bucket.voices.push(v);
            });
            return groups.filter((g) => g.voices.length > 0);
        };

        window.getDriverNavVoiceUri = () => {
            try { return localStorage.getItem(NAV_VOICE_STORAGE_KEY) || ''; } catch (_) { return ''; }
        };

        window.setDriverNavVoice = (voiceUri) => {
            if (!voiceUri) return;
            try { localStorage.setItem(NAV_VOICE_STORAGE_KEY, voiceUri); } catch (_) {}
            window.syncNavVoicePickerUi?.();
        };

        window.pickSpanishVoice = () => {
            if (!('speechSynthesis' in window)) return null;
            const voices = window.speechSynthesis.getVoices?.() || [];
            const savedUri = window.getDriverNavVoiceUri?.();
            if (savedUri) {
                const saved = voices.find((v) => v.voiceURI === savedUri);
                if (saved) return saved;
            }
            return voices.find((v) => v.lang === 'es-HN')
                || voices.find((v) => v.lang?.toLowerCase().startsWith('es'))
                || null;
        };

        window.formatNavVoiceLabel = (voice) => {
            if (!voice) return 'Voz predeterminada';
            const lang = (voice.lang || 'es').replace('_', '-');
            const gender = window.getNavVoiceGenderLabel(voice);
            return `${voice.name} · ${gender} (${lang})`;
        };

        if ('speechSynthesis' in window) {
            window.speechSynthesis.addEventListener('voiceschanged', () => {
                window.pickSpanishVoice();
                window.syncNavVoicePickerUi?.();
            });
        }

        window.syncNavVoicePickerUi = () => {
            const btn = document.querySelector('[data-trip-action="pick-nav-voice"]');
            if (!btn) return;
            const voice = window.pickSpanishVoice?.();
            const genderShort = voice && window.getNavVoiceGender(voice) === 'female' ? '♀ ' : '';
            const label = voice ? `${genderShort}${voice.name.split(' ')[0]}` : 'Voz';
            btn.setAttribute('title', voice ? `Voz: ${window.formatNavVoiceLabel(voice)}` : 'Elegir voz de navegación');
            btn.setAttribute('aria-label', btn.getAttribute('title'));
            const span = btn.querySelector('.nav-voice-pick-label');
            if (span) span.textContent = label;
        };

        window.openDriverNavVoicePicker = () => {
            if (!('speechSynthesis' in window)) {
                window.showToast?.('Tu dispositivo no soporta voz de navegación.');
                return;
            }
            if (document.querySelector('[data-nav-voice-picker-modal]')) return;

            const groups = window.getSpanishNavVoicesGrouped();
            if (!groups.length) {
                window.showToast?.('Cargando voces… Intenta de nuevo en un segundo.');
                window.speechSynthesis.getVoices();
                return;
            }

            const selectedUri = window.getDriverNavVoiceUri();
            const modal = document.createElement('div');
            modal.dataset.navVoicePickerModal = '1';
            modal.className = 'fixed inset-0 bg-black/70 z-[46000] flex items-end sm:items-center justify-center p-3 sm:p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-3xl w-full max-w-md max-h-[78dvh] flex flex-col overflow-hidden shadow-2xl">
                    <div class="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
                        <div>
                            <h3 class="text-base font-black text-gray-900">Voz de navegación</h3>
                            <p class="text-[11px] text-gray-500 mt-0.5">Voces femeninas y masculinas en español</p>
                        </div>
                        <button type="button" data-nav-voice-close class="w-9 h-9 rounded-full bg-gray-100 text-gray-600 font-black">✕</button>
                    </div>
                    <div class="overflow-y-auto p-2 flex-1" id="nav-voice-picker-list"></div>
                    <div class="p-3 border-t border-gray-100">
                        <button type="button" data-nav-voice-close class="w-full py-3 rounded-2xl bg-emerald-700 text-white font-black text-sm">Listo</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const list = modal.querySelector('#nav-voice-picker-list');

            const paintRowActive = (row, active) => {
                row.classList.toggle('border-emerald-500', active);
                row.classList.toggle('bg-emerald-50', active);
                row.classList.toggle('border-gray-200', !active);
                const icon = row.querySelector('.nav-voice-row-icon');
                if (!icon) return;
                const gender = row.dataset.voiceGender || 'unknown';
                const idleClass = gender === 'female'
                    ? 'bg-rose-100 text-rose-600'
                    : (gender === 'male' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600');
                icon.className = `nav-voice-row-icon w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${active ? 'bg-emerald-600 text-white' : idleClass}`;
                icon.innerHTML = active
                    ? '<i class="fas fa-check text-sm"></i>'
                    : `<i class="fas fa-${gender === 'female' ? 'venus' : (gender === 'male' ? 'mars' : 'volume-up')} text-sm"></i>`;
            };

            const clearActiveRows = () => {
                list.querySelectorAll('[data-nav-voice-row]').forEach((b) => paintRowActive(b, false));
            };

            groups.forEach((group) => {
                const header = document.createElement('div');
                header.className = 'px-2 pt-2 pb-1 flex items-center gap-2';
                const headerClass = group.id === 'female'
                    ? 'text-rose-700'
                    : (group.id === 'male' ? 'text-sky-700' : 'text-gray-600');
                header.innerHTML = `
                    <span class="text-[10px] font-black uppercase tracking-widest ${headerClass}">
                        <i class="fas ${group.icon} mr-1"></i>${group.title}
                    </span>
                `;
                list.appendChild(header);

                group.voices.forEach((voice) => {
                    const gender = window.getNavVoiceGender(voice);
                    const genderLabel = window.getNavVoiceGenderLabel(voice);
                    const row = document.createElement('button');
                    row.type = 'button';
                    row.dataset.navVoiceRow = '1';
                    row.dataset.voiceGender = gender;
                    row.className = 'w-full text-left p-3 rounded-2xl border mb-2 flex items-center gap-3 transition-colors';
                    const active = (selectedUri && voice.voiceURI === selectedUri)
                        || (!selectedUri && voice.voiceURI === window.pickSpanishVoice?.()?.voiceURI);
                    row.className += active ? ' border-emerald-500 bg-emerald-50' : ' border-gray-200 hover:bg-gray-50';
                    const badgeClass = gender === 'female'
                        ? 'bg-rose-100 text-rose-700'
                        : (gender === 'male' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600');
                    row.innerHTML = `
                        <span class="nav-voice-row-icon w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${active ? 'bg-emerald-600 text-white' : badgeClass}">
                            <i class="fas fa-${active ? 'check' : (gender === 'female' ? 'venus' : (gender === 'male' ? 'mars' : 'volume-up'))} text-sm"></i>
                        </span>
                        <span class="flex-1 min-w-0">
                            <span class="block text-sm font-black text-gray-900 truncate">${voice.name}</span>
                            <span class="block text-[10px] text-gray-500">${genderLabel} · ${(voice.lang || 'es').replace('_', '-')} · ${voice.localService ? 'local' : 'en línea'}</span>
                        </span>
                        <span class="text-[10px] font-black text-emerald-700 shrink-0">Probar</span>
                    `;
                    row.addEventListener('click', () => {
                        window.setDriverNavVoice(voice.voiceURI);
                        clearActiveRows();
                        paintRowActive(row, true);
                        window.speakNavMessage('Continúa recto y luego gira a la derecha.', { interrupt: true });
                    });
                    list.appendChild(row);
                });
            });

            const close = () => modal.remove();
            modal.querySelectorAll('[data-nav-voice-close]').forEach((el) => el.addEventListener('click', close));
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        };

        window.speakMessage = (text) => {
            if (!('speechSynthesis' in window)) return;
            const utterance = new SpeechSynthesisUtterance(String(text || '').trim());
            utterance.lang = 'es-HN';
            utterance.rate = 1.0;
            const voice = window.pickSpanishVoice?.();
            if (voice) utterance.voice = voice;
            window.speechSynthesis.speak(utterance);
        };

        window.speakNavMessage = (text, { interrupt = true } = {}) => {
            if (!('speechSynthesis' in window) || window.driverVoiceNavEnabled === false) return;
            const clean = String(text || '').replace(/\s+/g, ' ').trim();
            if (!clean) return;
            const now = Date.now();
            const key = clean.toLowerCase();
            if (window._lastNavSpeakKey === key && now - (window._lastNavSpeakAt || 0) < 5000) return;
            if (interrupt) {
                try { window.speechSynthesis.cancel(); } catch (_) {}
            }
            const utterance = new SpeechSynthesisUtterance(clean);
            utterance.lang = 'es-HN';
            utterance.rate = 1.05;
            utterance.pitch = 1;
            const voice = window.pickSpanishVoice?.();
            if (voice) utterance.voice = voice;
            window._lastNavSpeakKey = key;
            window._lastNavSpeakAt = now;
            window.speechSynthesis.speak(utterance);
        };

        window.toggleDriverVoiceNav = () => {
            window.driverVoiceNavEnabled = !window.driverVoiceNavEnabled;
            if (!window.driverVoiceNavEnabled) {
                try { window.speechSynthesis.cancel(); } catch (_) {}
            } else if (window.isDriverNavigating?.()) {
                window.speakNavMessage('Voz de navegación activada');
            }
            window.syncNavVoiceToggleUi?.();
        };

        window.syncNavVoiceToggleUi = () => {
            const on = window.driverVoiceNavEnabled !== false;
            document.querySelectorAll('[data-trip-action="toggle-nav-voice"]').forEach((btn) => {
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.setAttribute('title', on ? 'Silenciar voz' : 'Activar voz');
                btn.setAttribute('aria-label', on ? 'Silenciar voz de navegación' : 'Activar voz de navegación');
                const icon = btn.querySelector('i');
                if (icon) icon.className = on ? 'fas fa-volume-up pointer-events-none' : 'fas fa-volume-mute pointer-events-none';
            });
            window.syncNavVoicePickerUi?.();
        };

        window.stopRouteProgressAnimation = () => {
            if (window._routeAnimFrame) {
                cancelAnimationFrame(window._routeAnimFrame);
                window._routeAnimFrame = null;
            }
        };

        window.simplifyRoutePath = (path, maxPoints = 180) => {
            if (!path?.length || path.length <= maxPoints) return path || [];
            const step = Math.ceil(path.length / maxPoints);
            const out = [];
            for (let i = 0; i < path.length; i += step) out.push(path[i]);
            const last = path[path.length - 1];
            const tail = out[out.length - 1];
            if (!tail || tail.lat !== last.lat || tail.lng !== last.lng) out.push(last);
            return out;
        };

        window.getRouteDisplayPath = (route, options = {}) => {
            const raw = route?.path
                || route?.polyline?.geoJsonLinestring?.coordinates?.map(c => ({ lat: c[1], lng: c[0] }))
                || [];
            if (!raw.length) return [];
            const isDriver = !!options.driverNav;
            const isPassengerNav = !!options.passengerTrack
                && document.body.classList.contains('passenger-nav-mode');
            // Conductor y pasajero en nav: ruta completa por calles (sin recortar esquinas)
            if (isDriver || isPassengerNav) return raw;
            const lowPower = typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode();
            const maxPts = lowPower ? 120 : 200;
            if (route?._displayPath?.length && route._displayMaxPts === maxPts) return route._displayPath;
            const simplified = window.simplifyRoutePath(raw, maxPts);
            if (route) {
                route._displayPath = simplified;
                route._displayMaxPts = maxPts;
            }
            return simplified;
        };

        window.showNavRouteLoading = () => {
            const overlay = document.getElementById('nav-route-loading');
            if (overlay) {
                overlay.classList.remove('hidden');
                overlay.setAttribute('aria-busy', 'true');
            }
            document.body.classList.add('nav-route-loading-active');
            const stepText = document.getElementById('nav-step-text');
            const stepDist = document.getElementById('nav-step-dist');
            const stepIcon = document.getElementById('nav-step-icon');
            if (stepText) stepText.textContent = 'Estableciendo ruta';
            if (stepDist) stepDist.textContent = 'Calculando el mejor camino…';
            if (stepIcon) stepIcon.className = 'fas fa-circle-notch fa-spin text-2xl text-white';
        };

        window.hideNavRouteLoading = () => {
            const overlay = document.getElementById('nav-route-loading');
            if (overlay) {
                overlay.classList.add('hidden');
                overlay.setAttribute('aria-busy', 'false');
            }
            document.body.classList.remove('nav-route-loading-active');
        };

        window.shouldPreserveDriverNavRoute = () => {
            if (window.userProfile?.role !== 'driver') return false;
            const trip = window.currentActiveTripData;
            if (!trip || !['accepted', 'in_progress'].includes(trip.status)) return false;
            return document.body.classList.contains('trip-active');
        };

        window.shouldPreserveDriverOfferPreview = () => {
            if (window.userProfile?.role !== 'driver') return false;
            if (window.isDriverNavigating?.()) return false;
            return !!(
                document.body.classList.contains('driver-offer-preview-active')
                && window._driverPreviewOfferTripId
            );
        };

        window.getDriverOfferPreviewMapPadding = () => {
            const popupOpen = document.body.classList.contains('driver-offer-popup-open');
            const mapPeek = document.body.classList.contains('driver-offer-map-peek');
            const minimized = document.body.classList.contains('panel-minimized')
                || document.body.classList.contains('panel-hidden');
            const vh = window.innerHeight || document.documentElement?.clientHeight || 700;
            const safeTop = 48;
            const safeSide = 24;

            // Altura real de la tarjeta de solicitud (no tapa la ruta)
            const measureOfferSheetBottom = () => {
                try {
                    const sheet = document.querySelector(
                        '#driver-trip-offer-popup:not(.hidden) .driver-trip-offer-popup-sheet'
                    );
                    if (!sheet) return 0;
                    const rect = sheet.getBoundingClientRect();
                    if (!rect?.height) return 0;
                    // Cuánto ocupa desde el borde inferior del viewport (+ margen)
                    return Math.ceil(Math.max(0, vh - rect.top) + 16);
                } catch (_) {
                    return 0;
                }
            };

            if (popupOpen) {
                const measured = measureOfferSheetBottom();
                // Mínimo ~42% del alto; máximo ~58% para no aplastar el mapa
                const minBottom = Math.round(vh * 0.38);
                const maxBottom = Math.round(vh * 0.58);
                const bottom = Math.min(maxBottom, Math.max(minBottom, measured || Math.round(vh * 0.46)));
                return {
                    top: safeTop,
                    right: safeSide,
                    left: safeSide,
                    bottom
                };
            }
            if (mapPeek) {
                return { top: 72, right: safeSide, left: safeSide, bottom: 150 };
            }
            return {
                top: 88,
                right: 36,
                left: 36,
                bottom: minimized ? 96 : 280
            };
        };

        /**
         * Encuadre de la ruta de oferta: zoom según tamaño de la ruta
         * y padding según la tarjeta de solicitud (no la tapa).
         */
        window.refitDriverOfferPreviewRoute = (route, options = {}) => {
            if (!window.gMap || !google?.maps?.LatLngBounds) return;
            // Si el conductor ya pellizcó/arrastró el mapa, no devolver el zoom
            // (antes cada snapshot rehacía fitBounds y “perdía” la vista + sensación de UI)
            if (window._driverOfferPreviewUserCamera && options.force !== true) return;
            const path = route?.path
                || window._driverOfferPreviewRoute?.path
                || window.currentRouteFullPath
                || [];
            if (!Array.isArray(path) || path.length < 2) return;

            const bounds = new google.maps.LatLngBounds();
            path.forEach((p) => {
                if (p?.lat != null && p?.lng != null) bounds.extend(p);
            });
            const legs = Array.isArray(route?.previewLegs) ? route.previewLegs : [];
            legs.forEach((leg) => {
                (leg?.path || []).forEach((p) => {
                    if (p?.lat != null && p?.lng != null) bounds.extend(p);
                });
            });
            if (window.currentDriverPos?.lat != null) bounds.extend(window.currentDriverPos);
            if (route?.origin?.lat != null) bounds.extend(route.origin);
            if (route?.destination?.lat != null) bounds.extend(route.destination);

            if (bounds.isEmpty()) return;

            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();
            const latSpan = Math.abs(ne.lat() - sw.lat());
            const lngSpan = Math.abs(ne.lng() - sw.lng());
            const span = Math.max(latSpan, lngSpan, 0.00001);

            // Zoom máximo según distancia de la ruta (evita “demasiado cerca” o “muy lejos”)
            // ~0.01° ≈ 1.1 km
            let maxZoom = 15;
            if (span < 0.004) maxZoom = 16;       // < ~450 m
            else if (span < 0.012) maxZoom = 15;  // ~1.3 km
            else if (span < 0.04) maxZoom = 14;   // ~4 km
            else if (span < 0.12) maxZoom = 13;   // ~13 km
            else maxZoom = 12;                    // rutas largas

            // Solo tramo al cliente (sin destino): un poco más cerca
            const onlyToPickup = legs.length === 1 && legs[0]?.role === 'toPickup';
            if (onlyToPickup && maxZoom < 15) maxZoom = 15;

            const padding = options.padding
                || window.getDriverOfferPreviewMapPadding?.()
                || { top: 56, right: 24, bottom: 280, left: 24 };

            const applyFit = () => {
                const clearProg = () => {
                    // Dar un tick para que zoom_changed/idle no marquen “user camera”
                    setTimeout(() => { window._mapCameraProgrammatic = false; }, 120);
                };
                try {
                    window._mapCameraProgrammatic = true;
                    const prevMax = window.gMap.get('maxZoom');
                    window.gMap.setOptions({ maxZoom });
                    window.gMap.fitBounds(bounds, padding);
                    google.maps.event.addListenerOnce(window.gMap, 'idle', () => {
                        try {
                            window.gMap.setOptions({
                                maxZoom: prevMax == null ? undefined : prevMax
                            });
                            const z = window.gMap.getZoom?.();
                            if (Number.isFinite(z) && z > maxZoom) {
                                window._mapCameraProgrammatic = true;
                                window.gMap.setZoom(maxZoom);
                            }
                        } catch (_) {}
                        clearProg();
                    });
                } catch (_) {
                    try {
                        window._mapCameraProgrammatic = true;
                        window.gMap.fitBounds(bounds, padding);
                    } catch (__) {}
                    clearProg();
                }
            };

            applyFit();
        };

        window.hasActiveDriverNavRoute = () => {
            const path = window.currentRouteFullPath
                || window.currentNavRoute?.path
                || [];
            return path.length >= 2;
        };

        /**
         * Recupera la ruta del conductor cuando se perdió (GPS lento, API, cambio de tramo).
         * Evita tener que recargar la app varias veces.
         */
        window.recoverDriverNavRoute = async (opts = {}) => {
            const force = opts.force !== false;
            const silent = opts.silent === true;
            const trip = window.currentActiveTripData || window.activeTrip;
            if (!trip || window.userProfile?.role !== 'driver') return false;
            if (trip.driverId && window.currentUser?.uid && trip.driverId !== window.currentUser.uid) {
                return false;
            }
            if (!['accepted', 'in_progress'].includes(trip.status)) return false;
            if (!document.body.classList.contains('trip-active')
                && trip.status !== 'in_progress'
                && trip.status !== 'accepted') {
                return false;
            }
            // No interrumpir el arranque post-PIN (A→B); si no, borra la ruta y “desaparece” la nav
            if (window._startingDestNavTripId && window._startingDestNavTripId === trip.id) {
                document.body.classList.add('is-navigating', 'driver-nav-mode', 'driver-trip-dest-phase');
                window.driverNavMode = true;
                window.syncDriverPanelNavVisibility?.();
                return false;
            }

            const now = Date.now();
            if (!force && window._navRecoverAt && now - window._navRecoverAt < 2200) {
                return false;
            }
            window._navRecoverAt = now;

            // Esperar mapa si aún no cargó
            if (!window.mapLoaded) {
                for (let i = 0; i < 8 && !window.mapLoaded; i++) {
                    await new Promise((r) => setTimeout(r, 350));
                }
                if (!window.mapLoaded) {
                    if (!silent) {
                        window.showToast?.('El mapa aún no carga. Reintentando…', 'warning');
                    }
                    clearTimeout(window._navRecoverRetryTimer);
                    window._navRecoverRetryTimer = setTimeout(
                        () => window.recoverDriverNavRoute?.({ force: true, silent: true }),
                        2800
                    );
                    return false;
                }
            }

            // GPS con reintentos (causa #1 de “no hay ruta”)
            for (let i = 0; i < 5 && !window.currentDriverPos; i++) {
                try { await window.ensureDriverPosition?.(); } catch (_) {}
                if (!window.currentDriverPos) {
                    await new Promise((r) => setTimeout(r, 500 + i * 400));
                }
            }
            if (!window.currentDriverPos) {
                if (!silent) {
                    window.showToast?.('Esperando GPS para trazar la ruta…', 'warning');
                }
                clearTimeout(window._navRecoverRetryTimer);
                window._navRecoverRetryTimer = setTimeout(
                    () => window.recoverDriverNavRoute?.({ force: true, silent: true }),
                    3200
                );
                return false;
            }

            // Resolver destino del tramo
            let target = null;
            try {
                if (trip.status === 'in_progress') {
                    target = window.getTripCurrentLegNavTarget?.(trip)
                        || (trip.destinationLat != null
                            ? {
                                lat: Number(trip.destinationLat),
                                lng: Number(trip.destinationLng),
                                address: trip.destination || 'Destino'
                            }
                            : trip.destination);
                } else if (!trip.driverArrived) {
                    target = await window.resolveTripPickupNavTarget?.(trip);
                } else {
                    target = window.getTripCurrentLegNavTarget?.(trip)
                        || (trip.destinationLat != null
                            ? {
                                lat: Number(trip.destinationLat),
                                lng: Number(trip.destinationLng),
                                address: trip.destination || 'Destino'
                            }
                            : trip.destination);
                }
            } catch (e) {
                console.warn('[NAV] recover target:', e);
            }
            if (!target) {
                if (!silent) {
                    window.showToast?.('No hay destino para la ruta. Revisá el viaje.', 'warning');
                }
                return false;
            }

            const remainingOnMap = window._progressRoutePolylines?.remaining?.getMap?.()
                || window._progressRoutePolylines?.base?.getMap?.();
            const hasPath = window.hasActiveDriverNavRoute?.();
            if (hasPath && remainingOnMap) {
                if (window.currentDriverPos) {
                    window.updateRouteProgress?.(window.currentDriverPos, { driverNav: true });
                }
                return true;
            }
            if (hasPath && window.currentNavRoute) {
                window.drawRouteOnMap?.(window.currentNavRoute, { driverNav: true, fitFullRoute: false });
                return true;
            }

            // Solo vaciar memoria si realmente no hay path
            if (!hasPath) {
                try {
                    window.currentNavRoute = null;
                    window.currentRouteFullPath = null;
                    window._progressRoutePolylines = null;
                } catch (_) {}
            }

            window.driverNavMode = true;
            document.body.classList.add('is-navigating', 'driver-nav-mode', 'trip-active');
            if (trip.status === 'in_progress') {
                document.body.classList.add('driver-trip-dest-phase');
            }

            try {
                window.updateNavigation?.(target, !hasPath);
            } catch (e) {
                console.warn('[NAV] recover updateNavigation:', e);
            }

            // Verificar a los 3–5 s si la ruta quedó dibujada; si no, reintentar
            clearTimeout(window._navRecoverCheckTimer);
            window._navRecoverCheckTimer = setTimeout(async () => {
                if (!document.body.classList.contains('trip-active')) return;
                if (window.userProfile?.role !== 'driver') return;
                const ok = window.hasActiveDriverNavRoute?.();
                const remainingOnMap = window._progressRoutePolylines?.remaining?.getMap?.()
                    || (Array.isArray(window.currentRoutePolyline)
                        ? window.currentRoutePolyline[0]?.getMap?.()
                        : window.currentRoutePolyline?.getMap?.());
                if (!ok || !remainingOnMap) {
                    // redibujar si hay datos
                    if (ok && window.currentNavRoute) {
                        try {
                            window.drawRouteOnMap?.(window.currentNavRoute, { driverNav: true });
                            if (window.currentDriverPos) {
                                window.updateRouteProgress?.(window.currentDriverPos, {
                                    driverNav: true,
                                    force: true
                                });
                            }
                        } catch (_) {}
                    }
                    if (!window.hasActiveDriverNavRoute?.()
                        || !(window._progressRoutePolylines?.remaining?.getMap?.())) {
                        window._navRecoverAt = 0;
                        window.recoverDriverNavRoute?.({ force: true, silent: true });
                    }
                }
            }, 3500);

            return true;
        };

        window.ensureDriverNavRouteVisible = () => {
            if (!window.shouldPreserveDriverNavRoute?.()) return;
            const trip = window.currentActiveTripData;
            if (!trip) return;

            const remainingOnMap = window._progressRoutePolylines?.remaining?.getMap?.()
                || window._progressRoutePolylines?.base?.getMap?.();
            const polyOnMap = remainingOnMap
                || (Array.isArray(window.currentRoutePolyline)
                    ? window.currentRoutePolyline.some?.((p) => p?.getMap?.())
                    : window.currentRoutePolyline?.getMap?.());
            const hasRoute = window.hasActiveDriverNavRoute?.();

            if (hasRoute && polyOnMap) {
                const pos = window.currentDriverPos;
                if (pos) window.updateRouteProgress?.(pos, { driverNav: true });
                return;
            }

            if (hasRoute && !polyOnMap && window.currentNavRoute) {
                window.drawRouteOnMap?.(window.currentNavRoute, { driverNav: true, fitFullRoute: false });
                return;
            }

            const pos = window.currentDriverPos;
            if (!pos) {
                window.ensureDriverPosition?.().then((p) => {
                    if (p) window.ensureDriverNavRouteVisible?.();
                    else window.recoverDriverNavRoute?.({ force: false, silent: true });
                });
                return;
            }

            window.recoverDriverNavRoute?.({ force: false, silent: true });
        };

        /**
         * Encuadra conductor + tramo restante de ruta (viaje activo).
         * Así se ve la polilínea, no solo el carrito a zoom 21.
         */
        window.fitDriverActiveRouteOverview = () => {
            if (!window.gMap) return;
            const path = window.currentRouteFullPath
                || window.currentNavRoute?.path
                || [];
            if (!path.length) return;
            const bounds = new google.maps.LatLngBounds();
            // Muestrear puntos de la ruta restante (no todos si es muy larga)
            const step = Math.max(1, Math.floor(path.length / 40));
            for (let i = 0; i < path.length; i += step) {
                bounds.extend(path[i]);
            }
            bounds.extend(path[path.length - 1]);
            if (window.currentDriverPos?.lat != null) {
                bounds.extend(window.currentDriverPos);
            }
            const padding = window.getDriverNavMapPadding?.() || {
                top: 80,
                right: 40,
                bottom: 220,
                left: 40
            };
            try {
                if (typeof window.withProgrammaticMapCamera === 'function') {
                    window.withProgrammaticMapCamera(() => {
                        window.gMap.fitBounds(bounds, padding);
                    });
                } else {
                    window.gMap.fitBounds(bounds, padding);
                }
            } catch (_) {}
        };

        window._clearRoutePolylinesCore = (options = {}) => {
            const force = options?.force === true;
            if (!force && window.shouldPreserveDriverOfferPreview?.()) return false;
            if (!force && window.shouldPreserveDriverNavRoute?.()) return false;
            window.stopRouteProgressAnimation?.();
            if (!window.currentRoutePolyline) {
                if (!force && window.shouldPreserveDriverNavRoute?.()) return false;
                window.currentRouteFullPath = null;
                return true;
            }
            if (Array.isArray(window.currentRoutePolyline)) {
                window.currentRoutePolyline.forEach(p => p.setMap?.(null));
            } else {
                window.currentRoutePolyline.setMap?.(null);
            }
            window.currentRoutePolyline = null;
            if (!force && window.shouldPreserveDriverNavRoute?.()) {
                return false;
            }
            window.currentRouteFullPath = null;
            window._lastRouteProgressPos = null;
            window._lastRouteProgressUpdate = 0;
            return true;
        };

        window.clearRoutePolylines = (options) => {
            window._clearRoutePolylinesCore(options);
        };

        window.splitPathAtDriver = (path, pos) => {
            if (!path?.length) return { passed: [], remaining: path || [] };
            if (!pos) return { passed: [], remaining: path };

            let bestIdx = 0;
            let bestDist = Infinity;
            let bestPoint = path[0];

            for (let i = 0; i < path.length - 1; i++) {
                const p1 = path[i];
                const p2 = path[i + 1];
                const dx = p2.lng - p1.lng;
                const dy = p2.lat - p1.lat;
                const len2 = dx * dx + dy * dy;
                let t = 0;
                if (len2 > 0) {
                    t = ((pos.lng - p1.lng) * dx + (pos.lat - p1.lat) * dy) / len2;
                    t = Math.max(0, Math.min(1, t));
                }
                const proj = {
                    lat: p1.lat + dy * t,
                    lng: p1.lng + dx * t
                };
                const d = (proj.lat - pos.lat) ** 2 + (proj.lng - pos.lng) ** 2;
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                    bestPoint = proj;
                }
            }

            const passed = [...path.slice(0, bestIdx + 1), bestPoint];
            const remaining = [bestPoint, ...path.slice(bestIdx + 1)];
            let heading = 0;
            if (bestIdx < path.length - 1) {
                const p1 = path[bestIdx];
                const p2 = path[bestIdx + 1];
                heading = Math.atan2(p2.lng - p1.lng, p2.lat - p1.lat) * 180 / Math.PI;
            }
            return { passed, remaining, splitPoint: bestPoint, segmentIndex: bestIdx, heading };
        };

        window.snapPositionToRoute = (path, pos) => {
            if (!path?.length || !pos?.lat || !pos?.lng) return pos;
            const { splitPoint, heading } = window.splitPathAtDriver(path, pos);
            if (!splitPoint) return pos;
            return { lat: splitPoint.lat, lng: splitPoint.lng, heading };
        };

        window.getDistanceToRouteMeters = (path, pos) => {
            if (!path?.length || pos?.lat == null || pos?.lng == null) return Infinity;
            const { splitPoint } = window.splitPathAtDriver(path, pos);
            if (!splitPoint) return Infinity;
            const dLat = (splitPoint.lat - pos.lat) * 111000;
            const dLng = (splitPoint.lng - pos.lng) * 111000 * Math.cos(pos.lat * Math.PI / 180);
            return Math.hypot(dLat, dLng);
        };

        // Radio para activar llegada al destino (conductor presiona botón → pasajero confirma).
        const DESTINATION_ARRIVAL_RADIUS_M = 1000;

        window.clearRoutePolylinesOnly = (options = {}) => {
            if (!options?.force && window.shouldPreserveDriverNavRoute?.()) return;
            window.stopRouteProgressAnimation?.();
            if (window._progressRoutePolylines) {
                Object.values(window._progressRoutePolylines).forEach((p) => p?.setMap?.(null));
                window._progressRoutePolylines = null;
            }
            if (!window.currentRoutePolyline) return;
            if (Array.isArray(window.currentRoutePolyline)) {
                window.currentRoutePolyline.forEach(p => p.setMap?.(null));
            } else {
                window.currentRoutePolyline.setMap?.(null);
            }
            window.currentRoutePolyline = null;
        };

        window.drawProgressRouteOnMap = (route, driverPos, options = {}) => {
            const path = window.getRouteDisplayPath(route, options);
            if (!path.length || !window.gMap) return;

            window.currentRouteFullPath = path;

            const { passed, remaining } = window.splitPathAtDriver(path, driverPos || path[0]);
            const isDriver = !!options.driverNav;
            const isPassenger = !!options.passengerTrack;
            const driverLite = isDriver;
            const remainColor = isDriver ? '#1a73e8' : '#2563eb';
            const passedColor = driverLite ? '#94a3b8' : (isPassenger ? '#475569' : '#64748b');
            const passedOpacity = driverLite ? 0.55 : (isPassenger ? 0.82 : 0.5);
            const reuse = window._progressRoutePolylines;

            if (reuse && (reuse.remaining?.getMap?.() || reuse.base?.getMap?.() || reuse.passed?.getMap?.())) {
                if (reuse.base) reuse.base.setPath(path);
                // Actualizar tramo recorrido (gris) también en conductor
                if (reuse.passed) {
                    if (passed.length >= 2) {
                        reuse.passed.setMap(window.gMap);
                        reuse.passed.setPath(passed);
                    } else {
                        reuse.passed.setMap(null);
                    }
                }
                if (reuse.remaining) {
                    if (remaining.length >= 2) {
                        reuse.remaining.setMap(window.gMap);
                        reuse.remaining.setPath(remaining);
                        if (reuse.anim) {
                            reuse.anim.setMap(window.gMap);
                            reuse.anim.setPath(remaining);
                        }
                    } else {
                        reuse.remaining.setMap(null);
                        if (reuse.anim) reuse.anim.setMap(null);
                        window.stopRouteProgressAnimation?.();
                    }
                }
                window.currentRoutePolyline = Object.values(reuse).filter(Boolean);
                return;
            }

            window.stopRouteProgressAnimation?.();
            window.clearRoutePolylinesOnly();

            const polylines = [];
            let base = null;

            // For driver nav: draw faint full route + bright remaining (the "eating" effect)
            // For passenger: full treatment with passed overlay + animation
            if (!driverLite) {
                base = new google.maps.Polyline({
                    path,
                    geodesic: true,
                    strokeColor: '#94a3b8',
                    strokeOpacity: 0.3,
                    strokeWeight: 12,
                    map: window.gMap,
                    zIndex: 1
                });
                polylines.push(base);
            } else {
                // Driver nav: faint full path so the remaining "eats" it visibly (like Google)
                base = new google.maps.Polyline({
                    path,
                    geodesic: true,
                    strokeColor: '#cbd5e1',
                    strokeOpacity: 0.45,
                    strokeWeight: 8,
                    map: window.gMap,
                    zIndex: 1
                });
                polylines.push(base);
            }

            // Tramo ya recorrido (gris) + restante (azul) = efecto “se come la ruta” (Google Maps)
            let passedLine = null;
            if (passed.length >= 2) {
                passedLine = new google.maps.Polyline({
                    path: passed,
                    geodesic: true,
                    strokeColor: driverLite ? '#94a3b8' : passedColor,
                    strokeOpacity: driverLite ? 0.65 : passedOpacity,
                    strokeWeight: driverLite ? 8 : (isPassenger ? 10 : 9),
                    map: window.gMap,
                    zIndex: 2
                });
                polylines.push(passedLine);
            }

            let remainingLine = null;
            let animLine = null;
            if (remaining.length >= 2) {
                remainingLine = new google.maps.Polyline({
                    path: remaining,
                    geodesic: true,
                    strokeColor: remainColor,
                    strokeOpacity: 0.98,
                    strokeWeight: driverLite ? 10 : 10,
                    map: window.gMap,
                    zIndex: 3
                });
                polylines.push(remainingLine);

                const lowPower = !!(window.hrUseLiteMaps?.()
                    || (typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode()));
                // Flechas animadas: carísimas en WebView Android; se omiten en APK / low-power
                if (!lowPower) {
                    const dashSymbol = {
                        path: 'M 0,-2 0,2',
                        strokeOpacity: 0.85,
                        strokeColor: '#bfdbfe',
                        scale: 2.5
                    };
                    const arrowSymbol = {
                        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                        scale: 3.2,
                        strokeColor: '#ffffff',
                        fillColor: remainColor,
                        fillOpacity: 0.95,
                        strokeWeight: 1
                    };

                    animLine = new google.maps.Polyline({
                        path: remaining,
                        geodesic: true,
                        strokeOpacity: 0,
                        icons: [
                            { icon: dashSymbol, offset: '0px', repeat: '16px' },
                            { icon: arrowSymbol, offset: '0px', repeat: '110px' }
                        ],
                        map: window.gMap,
                        zIndex: 4
                    });
                    polylines.push(animLine);

                    let offset = 0;
                    let lastAnimTick = 0;
                    const animate = (ts) => {
                        if (!animLine.getMap?.()) {
                            window._routeAnimFrame = null;
                            return;
                        }
                        if (!lastAnimTick || ts - lastAnimTick > 48) {
                            lastAnimTick = ts;
                            offset = (offset + 2.2) % 110;
                            const icons = animLine.get('icons');
                            if (icons?.length >= 2) {
                                icons[0].offset = `${offset % 16}px`;
                                icons[1].offset = `${offset}px`;
                                animLine.set('icons', icons);
                            }
                        }
                        window._routeAnimFrame = requestAnimationFrame(animate);
                    };
                    window._routeAnimFrame = requestAnimationFrame(animate);
                }
            }

            window._progressRoutePolylines = {
                base,
                passed: passedLine,
                remaining: remainingLine,
                anim: animLine
            };
            window.currentRoutePolyline = polylines;
        };

        window.updateRouteProgress = (driverPos, options = {}) => {
            if (!driverPos || !window.gMap) return;
            const path = window.currentRouteFullPath
                || window.currentNavRoute?.path
                || window.currentPassengerTrackRoute?.path
                || [];
            if (!path.length) return;

            const now = Date.now();
            const last = window._lastRouteProgressPos;
            const isDriver = options.driverNav ?? window.isDriverNavigating?.();
            // Snap a la ruta para “comer” el trazo como Google (solo nav)
            if (isDriver && path.length >= 2) {
                const dist = window.getDistanceToRouteMeters?.(path, driverPos);
                // Snap más agresivo (antes 140 m) para que la línea avance con el carrito
                if (Number.isFinite(dist) && dist < 200) {
                    const snapped = window.snapPositionToRoute?.(path, driverPos);
                    if (snapped?.lat != null && snapped?.lng != null) {
                        driverPos = { lat: snapped.lat, lng: snapped.lng };
                    }
                }
            }
            const isPassenger = options.passengerTrack ?? window.isPassengerTracking?.();
            // Umbral bajo: ~2 m en conductor para ir consumiendo la ruta al moverse
            const moveThreshold = isPassenger ? 0.000012 : (isDriver ? 0.000012 : 0.00008);
            const moved = !last
                || Math.hypot(driverPos.lat - last.lat, driverPos.lng - last.lng) > moveThreshold;
            const lowPower = typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode();
            // Conductor: actualizar más seguido (como Google Maps)
            const minMs = isPassenger
                ? (lowPower ? 280 : 160)
                : (isDriver ? (lowPower ? 450 : 220) : (lowPower ? 1400 : 800));
            const timeOk = !window._lastRouteProgressUpdate || now - window._lastRouteProgressUpdate > minMs;
            if (!options.force && !moved && !timeOk) return;

            window._lastRouteProgressUpdate = now;
            window._lastRouteProgressPos = driverPos;
            window.drawProgressRouteOnMap(
                { path },
                driverPos,
                { driverNav: isDriver, passengerTrack: isPassenger }
            );

            if (isPassenger && window.passengerTrackFollow !== false) {
                // Solo seguir al carro (no fitBounds de A+B: reiniciaba la vista al centrar)
                window.applyPassengerNavCamera?.(
                    driverPos,
                    window._passengerTrackHeading || 0,
                    !!options.force
                );
            }
        };

        window.formatRouteDuration = (route) => {
            const ms = route?.durationMillis || route?.legs?.[0]?.durationMillis;
            if (!ms) return route?.legs?.[0]?.duration || '--';
            const mins = Math.max(1, Math.round(ms / 60000));
            if (mins < 60) return `${mins} min`;
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            return m ? `${h} h ${m} min` : `${h} h`;
        };

        window.getRouteDistanceKm = (route) => {
            const meters = route?.distanceMeters || route?.legs?.[0]?.distanceMeters || 0;
            return meters / 1000;
        };

        const normalizeRoutePoint = async (point) => {
            if (!point) return null;
            if (typeof point === 'string') {
                const geocoded = await window.geocodeAddressString?.(point);
                if (geocoded?.latLng) return geocoded;
                return null;
            }
            if (point.latLng?.lat != null && point.latLng?.lng != null) return point.latLng;
            if (point.lat != null && point.lng != null) return point;
            if (point.place) return point.place;
            if (point.address) {
                const geocoded = await window.geocodeAddressString?.(point.address);
                if (geocoded?.latLng) return geocoded;
                return null;
            }
            return point;
        };

        window.latLngFromRoutePoint = (p) => {
            if (!p) return null;
            if (typeof p === 'string') return null;
            let lat = p.lat;
            let lng = p.lng;
            if (p.latLng) {
                lat = p.latLng.lat ?? lat;
                lng = p.latLng.lng ?? lng;
            }
            if (p.location) {
                const loc = p.location;
                lat = loc.lat ?? loc.latitude ?? lat;
                lng = loc.lng ?? loc.longitude ?? lng;
            }
            if (typeof lat === 'function') lat = lat();
            if (typeof lng === 'function') lng = lng();
            const nlat = Number(lat);
            const nlng = Number(lng);
            if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return null;
            return { lat: nlat, lng: nlng };
        };

        /** Ruta barata (haversine × 1.25). Cero llamadas a Routes/Directions. */
        window.estimateDrivingRoute = (from, to) => {
            const o = window.latLngFromRoutePoint(from) || from;
            const d = window.latLngFromRoutePoint(to) || to;
            if (!o || !d || o.lat == null || d.lat == null) return null;
            const toRad = (deg) => deg * Math.PI / 180;
            const earthKm = 6371;
            const dLat = toRad(d.lat - o.lat);
            const dLng = toRad(d.lng - o.lng);
            const a = Math.sin(dLat / 2) ** 2
                + Math.cos(toRad(o.lat)) * Math.cos(toRad(d.lat)) * Math.sin(dLng / 2) ** 2;
            const lineKm = earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distanceMeters = Math.round(lineKm * 1000 * 1.25);
            const durationMillis = Math.round((lineKm * 1.25 / 35) * 3600 * 1000);
            return {
                distanceMeters,
                durationMillis,
                staticDurationMillis: durationMillis,
                path: [o, d],
                legs: [{ distanceMeters, durationMillis, staticDurationMillis: durationMillis }],
                estimated: true
            };
        };

        window.hydrateRouteFromStored = (trip) => {
            const path = Array.isArray(trip?.routePath) ? trip.routePath.filter((p) => p && p.lat != null && p.lng != null) : [];
            if (path.length < 2) return null;
            const distanceMeters = Number(trip.routeDistanceMeters) || Math.round((Number(trip.tripDistanceKm) || 0) * 1000);
            const durationMillis = Number(trip.routeDurationMs) || Number(trip.tripDurationMs) || 0;
            return {
                path,
                distanceMeters,
                durationMillis,
                staticDurationMillis: durationMillis,
                legs: [{ distanceMeters, durationMillis, staticDurationMillis: durationMillis }],
                clientTripOnly: true,
                fromStorage: true
            };
        };

        /**
         * @param {'estimate'|'once'|'nav'} [opts.mode]
         * estimate = sin API (tarifa previa)
         * once = 1 sola llamada Routes (aceptar viaje)
         * nav = reintentos solo si el conductor se salió de la ruta
         */
        window.computeDrivingRoute = async (origin, destination, opts = {}) => {
            if (!window.mapLoaded) {
                return null;
            }

            const originPoint = await normalizeRoutePoint(origin);
            const destinationPoint = await normalizeRoutePoint(destination);

            if (!originPoint || !destinationPoint) {
                return null;
            }

            const toLatLngLiteral = (p) => {
                if (!p) return null;
                if (typeof p === 'string') return p;

                let lat = p.lat;
                let lng = p.lng;

                if (p.latLng) {
                    lat = p.latLng.lat ?? lat;
                    lng = p.latLng.lng ?? lng;
                }
                if (p.location) {
                    const loc = p.location;
                    lat = loc.lat ?? loc.latitude ?? lat;
                    lng = loc.lng ?? loc.longitude ?? lng;
                }
                if (p.latitude != null && p.longitude != null) {
                    lat = p.latitude;
                    lng = p.longitude;
                }

                // resolve functions (e.g. google.maps.LatLng)
                if (typeof lat === 'function') lat = lat();
                if (typeof lng === 'function') lng = lng();

                if (lat != null && lng != null) {
                    const nlat = Number(lat);
                    const nlng = Number(lng);
                    if (!isNaN(nlat) && !isNaN(nlng)) {
                        return { lat: nlat, lng: nlng };
                    }
                }
                return p;
            };

            const o = toLatLngLiteral(originPoint);
            const d = toLatLngLiteral(destinationPoint);

            if (!o || typeof o === 'string' || o.lat == null || o.lng == null || isNaN(o.lat) || isNaN(o.lng) ||
                !d || typeof d === 'string' || d.lat == null || d.lng == null || isNaN(d.lat) || isNaN(d.lng)) {
                return null;
            }

            const normalizeRoutePathPoints = (rawPath) => {
                if (!Array.isArray(rawPath)) return [];
                return rawPath.map((p) => {
                    if (!p) return null;
                    if (typeof p.lat === 'function') return { lat: p.lat(), lng: p.lng() };
                    const lat = p.lat ?? p.latitude;
                    const lng = p.lng ?? p.longitude;
                    if (lat == null || lng == null) return null;
                    return { lat: Number(lat), lng: Number(lng) };
                }).filter(Boolean);
            };

            const decodeRouteEncodedPolyline = async (routeInstance) => {
                const encoded = routeInstance?.polyline?.encodedPolyline
                    || routeInstance?.legs?.[0]?.polyline?.encodedPolyline;
                if (!encoded) return [];
                try {
                    const geom = await (window.geometryLibraryReady || google.maps.importLibrary('geometry'));
                    const points = geom?.encoding?.decodePath(encoded) || [];
                    return points.map((p) => ({ lat: p.lat(), lng: p.lng() }));
                } catch (_) {
                    return [];
                }
            };

            const mode = opts.mode
                || (window.isDriverNavigating?.() || window.driverNavMode === true ? 'nav' : 'once');

            if (mode === 'estimate') {
                return window.estimateDrivingRoute(o, d);
            }

            const routeCacheKey = `${o.lat.toFixed(4)},${o.lng.toFixed(4)}->${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
            const cached = window._routeComputeCache?.get(routeCacheKey);
            const cachedRoute = cached?.route;
            const cacheOk = cachedRoute
                && !cachedRoute.estimated
                && cachedRoute.path?.length >= 2
                && Date.now() - cached.ts < (window._routeCacheTtlMs || 600000);
            if (cacheOk) return cachedRoute;

            const buildRouteResultFromApi = async (routeInstance) => {
                if (!routeInstance) return null;
                const leg = routeInstance.legs?.[0] || {};
                const distanceMeters = routeInstance.distanceMeters || leg.distanceMeters || 0;
                const durationMillis = routeInstance.durationMillis || leg.durationMillis || 0;
                const staticDurationMillis = routeInstance.staticDurationMillis || leg.staticDurationMillis || durationMillis;

                let path = normalizeRoutePathPoints(routeInstance.path);
                if (path.length < 2 && Array.isArray(routeInstance.legs)) {
                    for (const routeLeg of routeInstance.legs) {
                        const legPath = normalizeRoutePathPoints(routeLeg.path);
                        if (legPath.length >= 2) {
                            path = legPath;
                            break;
                        }
                    }
                }
                if (path.length < 8 && Array.isArray(routeInstance.legs)) {
                    const stepPath = [];
                    for (const routeLeg of routeInstance.legs) {
                        for (const step of routeLeg.steps || []) {
                            const pts = normalizeRoutePathPoints(step.path);
                            if (!pts.length) continue;
                            if (stepPath.length) {
                                const prev = stepPath[stepPath.length - 1];
                                const first = pts[0];
                                if (prev.lat === first.lat && prev.lng === first.lng) {
                                    stepPath.push(...pts.slice(1));
                                    continue;
                                }
                            }
                            stepPath.push(...pts);
                        }
                    }
                    if (stepPath.length > path.length) path = stepPath;
                }
                if (path.length < 8) {
                    const decodedPolyline = await decodeRouteEncodedPolyline(routeInstance);
                    if (decodedPolyline.length > path.length) path = decodedPolyline;
                }

                if (path.length < 2 && distanceMeters <= 0) return null;

                let navSteps = window.normalizeRouteNavSteps?.(routeInstance.legs) || [];
                const routePath = path.length >= 2 ? path : [o, d];
                if (!navSteps.length && routePath.length >= 3) {
                    navSteps = window.buildVoiceStepsFromPath?.(routePath) || [];
                }

                return {
                    distanceMeters,
                    durationMillis: durationMillis || 0,
                    staticDurationMillis: staticDurationMillis || durationMillis || 0,
                    path: path.length >= 2 ? path : [o, d],
                    steps: navSteps,
                    _displayPath: null,
                    _displayMaxPts: null,
                    legs: routeInstance.legs?.length
                        ? routeInstance.legs
                        : [{ distanceMeters, durationMillis, staticDurationMillis }],
                    createPolylines: typeof routeInstance.createPolylines === 'function'
                        ? routeInstance.createPolylines.bind(routeInstance)
                        : undefined
                };
            };

            const buildEstimatedDrivingRoute = (from, to) => window.estimateDrivingRoute(from, to);

            // Primary: modern Routes API (Route.computeRoutes).
            const routesLib = await window.routesLibraryReady;
            const RouteCtor = (routesLib && routesLib.Route) || window.RouteClass;
            // Solo modo nav estricto cuando realmente estamos navegando (no todo driver-mode:
            // si no, fallos de API dejan sin ruta al cliente / preview de oferta).
            const navDriving = !!(window.isDriverNavigating?.() || window.driverNavMode === true);

            const isSparseStreetPath = (built) => {
                if (!built?.path?.length) return true;
                // Menos estricto: muchos tramos cortos en ciudad traen pocos puntos en overview
                if (built.path.length < 2) return true;
                if (built.path.length < 3 && (built.distanceMeters || 0) > 400) return true;
                if (built.path.length < 5 && (built.distanceMeters || 0) > 2500) return true;
                return false;
            };

            const cacheRoute = (built) => {
                if (!built) return built;
                try {
                    if (!window._routeComputeCache) window._routeComputeCache = new Map();
                    window._routeComputeCache.set(routeCacheKey, { route: built, ts: Date.now() });
                    if (window._routeComputeCache.size > 24) {
                        const oldest = window._routeComputeCache.keys().next().value;
                        window._routeComputeCache.delete(oldest);
                    }
                } catch (_) {}
                return built;
            };

            if (RouteCtor) {
                const routeFields = ['path', 'distanceMeters', 'durationMillis', 'staticDurationMillis', 'legs'];
                // Tráfico primero cuando se navega (mejor ETA / ruta viva)
                const routingAttempts = (mode === 'nav' && navDriving)
                    ? [
                        {
                            routingPreference: 'TRAFFIC_AWARE',
                            departureTime: new Date(Date.now() + 60 * 1000)
                        },
                        { routingPreference: 'TRAFFIC_UNAWARE' }
                    ]
                    : [
                        { routingPreference: 'TRAFFIC_UNAWARE' }
                    ];
                const requestVariants = (mode === 'nav' && navDriving)
                    ? [
                        { withNavVoice: true },
                        { withNavVoice: false }
                    ]
                    : [{ withNavVoice: false }];

                for (const variant of requestVariants) {
                    for (const attempt of routingAttempts) {
                        try {
                            const routeRequest = {
                                origin: { lat: Number(o.lat), lng: Number(o.lng) },
                                destination: { lat: Number(d.lat), lng: Number(d.lng) },
                                travelMode: 'DRIVING',
                                region: 'hn',
                                fields: routeFields,
                                ...attempt
                            };
                            if (variant.withNavVoice) {
                                routeRequest.language = 'es-419';
                                routeRequest.extraComputations = ['HTML_FORMATTED_NAVIGATION_INSTRUCTIONS'];
                            }
                            try {
                                const quality = navDriving
                                    ? google.maps?.PolylineQuality?.HIGH_QUALITY
                                    : google.maps?.PolylineQuality?.OVERVIEW;
                                if (quality) routeRequest.polylineQuality = quality;
                            } catch (_) {}

                            const response = await RouteCtor.computeRoutes(routeRequest);
                            const built = await buildRouteResultFromApi(response?.routes?.[0]);
                            if (built && isSparseStreetPath(built)) continue;
                            if (built) {
                                window._routesApiWorked = true;
                                return cacheRoute(built);
                            }
                        } catch (attemptErr) {
                            const msg = String(attemptErr?.message || attemptErr);
                            if (!window._routesWarned) {
                                window._routesWarned = true;
                                console.warn('[ROUTE] Intento de ruta falló:', msg);
                            }
                            // Seguir con el siguiente intento (no abortar todo el bucle)
                            continue;
                        }
                    }
                }
            }

            // Fallback: Directions Service clásico (más compatible / a menudo ya habilitado)
            try {
                const dirResult = await window.computeDrivingRouteViaDirectionsService?.(o, d, { navDriving });
                if (dirResult && dirResult.path?.length >= 2) {
                    window._directionsFallbackWorked = true;
                    return cacheRoute(dirResult);
                }
            } catch (dirErr) {
                if (!window._directionsWarned) {
                    window._directionsWarned = true;
                    console.warn('[ROUTE] Directions fallback falló:', dirErr?.message || dirErr);
                }
            }

            // Último recurso: línea estimada (mejor que dejar el mapa vacío hacia el cliente)
            if (!window._routeEstimateWarned) {
                window._routeEstimateWarned = true;
                console.info('[ROUTE] Ruta estimada activa. Habilita "Routes API" o "Directions API" en Google Cloud.');
            }
            const estimated = buildEstimatedDrivingRoute(o, d);
            // En navegación activa preferimos calles; si no hay, igual dibujamos estimado
            // para no dejar al conductor sin orientación.
            return estimated;
        };

        /**
         * Fallback de ruteo con google.maps.DirectionsService (Directions API).
         * Útil cuando Routes API no está habilitada o falla en web/Capacitor.
         */
        window.computeDrivingRouteViaDirectionsService = (origin, destination, options = {}) =>
            new Promise((resolve) => {
                try {
                    if (typeof google === 'undefined' || !google.maps?.DirectionsService) {
                        resolve(null);
                        return;
                    }
                    const service = new google.maps.DirectionsService();
                    // Sin drivingOptions de tráfico: más compatible (no requiere billing extra)
                    service.route(
                        {
                            origin,
                            destination,
                            travelMode: google.maps.TravelMode.DRIVING,
                            region: 'HN',
                            language: 'es',
                            provideRouteAlternatives: false
                        },
                        (result, status) => {
                            if (status !== 'OK' || !result?.routes?.[0]) {
                                resolve(null);
                                return;
                            }
                            const route = result.routes[0];
                            const leg = route.legs?.[0] || {};
                            const path = (route.overview_path || []).map((p) => ({
                                lat: typeof p.lat === 'function' ? p.lat() : p.lat,
                                lng: typeof p.lng === 'function' ? p.lng() : p.lng
                            })).filter((p) => p.lat != null && p.lng != null);

                            // Preferir path de steps si overview es muy corto
                            let stepPath = [];
                            (route.legs || []).forEach((lg) => {
                                (lg.steps || []).forEach((st) => {
                                    (st.path || []).forEach((p) => {
                                        stepPath.push({
                                            lat: typeof p.lat === 'function' ? p.lat() : p.lat,
                                            lng: typeof p.lng === 'function' ? p.lng() : p.lng
                                        });
                                    });
                                });
                            });
                            stepPath = stepPath.filter((p) => p.lat != null && p.lng != null);
                            const finalPath = stepPath.length > path.length ? stepPath : path;

                            const distanceMeters = leg.distance?.value
                                || Math.round((route.legs || []).reduce((s, lg) => s + (lg.distance?.value || 0), 0));
                            const durationSec = leg.duration_in_traffic?.value || leg.duration?.value || 0;
                            const durationMillis = durationSec * 1000;

                            const toLL = (loc) => {
                                if (!loc) return null;
                                const lat = typeof loc.lat === 'function' ? loc.lat() : (loc.lat ?? loc.latitude);
                                const lng = typeof loc.lng === 'function' ? loc.lng() : (loc.lng ?? loc.longitude);
                                if (lat == null || lng == null) return null;
                                return { lat: Number(lat), lng: Number(lng) };
                            };
                            const navSteps = [];
                            (result.routes[0].legs || []).forEach((lg) => {
                                (lg.steps || []).forEach((st, i) => {
                                    const instruction = String(st.instructions || '')
                                        .replace(/<[^>]+>/g, ' ')
                                        .replace(/\s+/g, ' ')
                                        .trim();
                                    const endLocation = toLL(st.end_location) || toLL(st.endLocation);
                                    const pathPts = (st.path || []).map((p) => toLL(p)).filter(Boolean);
                                    const endFromPath = pathPts.length ? pathPts[pathPts.length - 1] : null;
                                    navSteps.push({
                                        index: navSteps.length,
                                        instruction,
                                        maneuver: st.maneuver || '',
                                        distanceMeters: st.distance?.value || 0,
                                        durationMillis: (st.duration?.value || 0) * 1000,
                                        endLocation: endLocation || endFromPath,
                                        path: pathPts
                                    });
                                });
                            });

                            resolve({
                                distanceMeters,
                                durationMillis,
                                staticDurationMillis: (leg.duration?.value || durationSec) * 1000,
                                path: finalPath.length >= 2 ? finalPath : [origin, destination],
                                steps: navSteps.length ? navSteps : (window.buildVoiceStepsFromPath?.(finalPath) || []),
                                _displayPath: null,
                                _displayMaxPts: null,
                                legs: [{
                                    distanceMeters,
                                    durationMillis,
                                    staticDurationMillis: (leg.duration?.value || durationSec) * 1000
                                }],
                                source: 'directions'
                            });
                        }
                    );
                } catch (e) {
                    console.warn('[ROUTE] DirectionsService error:', e);
                    resolve(null);
                }
            });

        window.isDriverNavigating = () =>
            document.body.classList.contains('driver-nav-mode')
            && document.body.classList.contains('is-navigating');

        window.bearingBetweenPoints = (from, to) => {
            if (!from || !to) return 0;
            const lat1 = from.lat * Math.PI / 180;
            const lat2 = to.lat * Math.PI / 180;
            const dLng = (to.lng - from.lng) * Math.PI / 180;
            const y = Math.sin(dLng) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
            return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
        };

        /** Distancia en metros entre dos {lat,lng} (para rumbo de movimiento). */
        window.haversineMeters = window.haversineMeters || ((a, b) => {
            if (!a || !b) return 0;
            const R = 6371000;
            const toRad = (d) => d * Math.PI / 180;
            const dLat = toRad(Number(b.lat) - Number(a.lat));
            const dLng = toRad(Number(b.lng) - Number(a.lng));
            const lat1 = toRad(Number(a.lat));
            const lat2 = toRad(Number(b.lat));
            const h = Math.sin(dLat / 2) ** 2
                + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
        });

        window.computeHeadingOnPath = (path, pos) => {
            if (!path?.length || !pos) return window.currentDriverHeading || 0;
            const split = window.splitPathAtDriver?.(path, pos);
            const from = split?.splitPoint || path[0];
            const segIdx = split?.segmentIndex ?? 0;
            const lookAhead = path.length > 120 ? 5 : (path.length > 50 ? 4 : 3);
            const toIdx = Math.min(segIdx + lookAhead, path.length - 1);
            const to = path[toIdx];
            if (!from || !to) return window.currentDriverHeading || 0;
            if (from.lat === to.lat && from.lng === to.lng) {
                const fallbackIdx = Math.min(segIdx + 1, path.length - 1);
                return window.bearingBetweenPoints(from, path[fallbackIdx]);
            }
            return window.bearingBetweenPoints(from, to);
        };

        window.smoothDriverNavHeading = (nextHeading, prevHeading, maxStep = 14) => {
            const next = Number(nextHeading);
            if (!Number.isFinite(next)) return prevHeading ?? 0;
            if (prevHeading == null || !Number.isFinite(prevHeading)) return next;
            let delta = ((next - prevHeading + 540) % 360) - 180;
            const abs = Math.abs(delta);
            if (abs <= 0.8) return prevHeading;
            // Giros grandes (intersección / brújula): saltar sin lag
            if (abs > 45) return next;
            const step = Math.min(abs, maxStep);
            return ((prevHeading + Math.sign(delta) * step) + 360) % 360;
        };

        window.normalizeCompassHeading = (deg) => {
            const n = Number(deg);
            if (!Number.isFinite(n)) return null;
            return ((n % 360) + 360) % 360;
        };

        /**
         * Rumbo desde evento de orientación (brújula del teléfono).
         * iOS: webkitCompassHeading. Android: absolute alpha / deviceorientationabsolute.
         */
        window.headingFromDeviceOrientationEvent = (e) => {
            if (!e) return null;
            // iOS Safari / WKWebView
            if (e.webkitCompassHeading != null && Number.isFinite(e.webkitCompassHeading)) {
                let h = Number(e.webkitCompassHeading);
                const orient = window.screen?.orientation?.angle
                    ?? (typeof window.orientation === 'number' ? window.orientation : 0)
                    ?? 0;
                h = (h + Number(orient || 0) + 360) % 360;
                return window.normalizeCompassHeading(h);
            }
            if (e.alpha == null || !Number.isFinite(e.alpha)) return null;
            // Absolute: alpha 0 = norte (con conversión habitual a rumbo de mapa)
            let heading = (360 - Number(e.alpha)) % 360;
            const orient = window.screen?.orientation?.angle
                ?? (typeof window.orientation === 'number' ? window.orientation : 0)
                ?? 0;
            heading = (heading + Number(orient || 0) + 360) % 360;
            return window.normalizeCompassHeading(heading);
        };

        /**
         * Registra GPS para rumbo de movimiento (course-over-ground) + velocidad.
         * Llamar en cada fix del conductor.
         */
        window.recordDriverGpsNavSample = (lat, lng, opts = {}) => {
            const now = Date.now();
            const nlat = Number(lat);
            const nlng = Number(lng);
            if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return;

            const speed = opts.speed != null ? Number(opts.speed) : null;
            if (speed != null && Number.isFinite(speed) && speed >= 0) {
                // coords.speed en m/s
                window._gpsSpeedMps = speed;
                window._gpsSpeedAt = now;
            }

            const rawH = opts.heading != null ? Number(opts.heading) : null;
            if (rawH != null && Number.isFinite(rawH) && rawH >= 0) {
                // GPS heading del SO (solo confiable en movimiento)
                window._gpsRawHeading = rawH;
                window._gpsRawHeadingAt = now;
            }

            const hist = window._gpsPosHistory || (window._gpsPosHistory = []);
            const last = hist[hist.length - 1];
            if (!last || Math.hypot(nlat - last.lat, nlng - last.lng) > 1e-7 || now - last.t > 400) {
                hist.push({ lat: nlat, lng: nlng, t: now });
                while (hist.length > 10) hist.shift();
            }

            // Course over ground con muestras separadas ≥ ~3.5 m
            if (hist.length >= 2) {
                let a = null;
                const b = hist[hist.length - 1];
                for (let i = hist.length - 2; i >= 0; i--) {
                    const cand = hist[i];
                    const dt = b.t - cand.t;
                    if (dt < 250 || dt > 10000) continue;
                    const meters = window.haversineMeters?.(cand, b)
                        ?? (Math.hypot(b.lat - cand.lat, b.lng - cand.lng) * 111320);
                    if (meters >= 3.5) {
                        a = cand;
                        break;
                    }
                }
                if (a) {
                    const course = window.bearingBetweenPoints(a, b);
                    const dtSec = Math.max(0.25, (b.t - a.t) / 1000);
                    const meters = window.haversineMeters?.(a, b)
                        ?? (Math.hypot(b.lat - a.lat, b.lng - a.lng) * 111320);
                    const derivedSpeed = meters / dtSec;
                    window._gpsCourseHeading = course;
                    window._gpsCourseAt = now;
                    if (!(speed != null && Number.isFinite(speed) && speed >= 0)) {
                        window._gpsSpeedMps = derivedSpeed;
                        window._gpsSpeedAt = now;
                    }
                }
            }
        };

        window.getDriverMotionHeading = () => {
            const now = Date.now();
            const speed = Number(window._gpsSpeedMps);
            const speedFresh = window._gpsSpeedAt && (now - window._gpsSpeedAt < 5000);
            const moving = speedFresh && Number.isFinite(speed) && speed >= 1.2; // ~4.3 km/h

            const course = window.normalizeCompassHeading(window._gpsCourseHeading);
            const courseFresh = course != null && window._gpsCourseAt && (now - window._gpsCourseAt < 4500);

            const raw = window.normalizeCompassHeading(window._gpsRawHeading);
            const rawFresh = raw != null && window._gpsRawHeadingAt && (now - window._gpsRawHeadingAt < 4000);

            // En movimiento: priorizar rumbo del trayecto GPS (más estable que brújula en auto)
            if (moving || courseFresh) {
                if (courseFresh && rawFresh) {
                    const delta = Math.abs(((course - raw + 540) % 360) - 180);
                    // Si coinciden, promediar angularmente hacia course
                    if (delta < 40) return course;
                }
                if (courseFresh) return course;
                if (rawFresh && (moving || speed >= 0.8)) return raw;
            }
            if (rawFresh && moving) return raw;
            if (courseFresh) return course;
            return null;
        };

        window.getDriverCompassHeading = () => {
            const now = Date.now();
            const h = window.normalizeCompassHeading(window._deviceCompassHeading);
            if (h == null) return null;
            if (!window._deviceCompassAt || now - window._deviceCompassAt > 2200) return null;
            return h;
        };

        /**
         * Fusión estilo Google Maps Navigation:
         * - En movimiento → GPS (dirección de tu trayecto)
         * - Parado / lento → brújula del teléfono
         * - En ruta y el rumbo de movimiento alinea con la calle → snap suave a la ruta
         */
        window.resolveDriverNavHeading = (pos, gpsHeading, path) => {
            const now = Date.now();
            if (gpsHeading != null && Number.isFinite(Number(gpsHeading)) && Number(gpsHeading) >= 0) {
                window._gpsRawHeading = Number(gpsHeading);
                window._gpsRawHeadingAt = now;
            }

            const motion = window.getDriverMotionHeading?.()
                ?? (gpsHeading != null && Number.isFinite(Number(gpsHeading)) && Number(gpsHeading) >= 0
                    ? Number(gpsHeading)
                    : null);
            const compass = window.getDriverCompassHeading?.();
            const speed = Number(window._gpsSpeedMps);
            const speedFresh = window._gpsSpeedAt && (now - window._gpsSpeedAt < 5000);
            const moving = speedFresh && Number.isFinite(speed) && speed >= 1.2;

            const pathHeading = path?.length >= 2 ? window.computeHeadingOnPath(path, pos) : null;
            let onRoute = false;
            if (path?.length >= 2 && pos) {
                const distToRoute = window.getDistanceToRouteMeters?.(path, pos);
                onRoute = Number.isFinite(distToRoute) && distToRoute < 90;
            }

            // 1) Movimiento: alinear con dirección de viaje (GPS)
            if (moving && motion != null) {
                if (onRoute && pathHeading != null) {
                    const delta = Math.abs(((pathHeading - motion + 540) % 360) - 180);
                    // Si vas casi por la calle, preferir rumbo de la ruta (más limpio en curvas)
                    if (delta < 32) return pathHeading;
                }
                return motion;
            }

            // 2) Lento / parado: brújula (hacia dónde apunta el teléfono)
            if (compass != null) {
                if (onRoute && pathHeading != null && !moving) {
                    // Parado en ruta: brújula manda (usuario mira a dónde va a girar)
                    return compass;
                }
                return compass;
            }

            // 3) Fallbacks
            if (motion != null) return motion;
            if (onRoute && pathHeading != null) return pathHeading;
            if (pathHeading != null) return pathHeading;
            if (window.currentDriverHeading != null && Number.isFinite(window.currentDriverHeading)) {
                return window.currentDriverHeading;
            }
            return 0;
        };

        window.getDriverNavCameraState = (rawPos, gpsHeading) => {
            const path = window.currentRouteFullPath
                || window.currentNavRoute?.path
                || [];
            let pos = rawPos;
            // No “pegar” el carrito a la calle si ya estás en el punto del pasajero:
            // el snap a la ruta hace parecer que “falta una cuadra” estando al lado.
            const trip = window.currentActiveTripData || window.activeTrip;
            const pickup = window.getTripPickupCoords?.(trip);
            const nearPickup = pickup && rawPos
                ? (window.getAccuracyAwareDistanceMeters?.(
                    rawPos,
                    pickup,
                    window._driverLiveAccuracy,
                    pickup.accuracy
                ) ?? window.getDistanceMetersBetween?.(rawPos, pickup))
                : Infinity;
            const nearPickupOk = Number.isFinite(nearPickup) && nearPickup < 85;
            const acc = Number(window._driverLiveAccuracy);
            const goodGps = Number.isFinite(acc) && acc > 0 && acc <= 35;

            if (
                path.length >= 2
                && rawPos
                && window.isDriverNavigating?.()
                && !nearPickupOk
            ) {
                const dist = window.getDistanceToRouteMeters?.(path, rawPos);
                // Solo snap suave si estás claramente sobre la vía y el GPS no es muy fino
                const snapMax = goodGps ? 45 : 90;
                if (Number.isFinite(dist) && dist < snapMax) {
                    const snapped = window.snapPositionToRoute?.(path, rawPos);
                    if (snapped?.lat != null && snapped?.lng != null) {
                        pos = { lat: snapped.lat, lng: snapped.lng };
                    }
                }
            }
            const heading = window.resolveDriverNavHeading?.(pos, gpsHeading, path)
                ?? window.currentDriverHeading
                ?? 0;
            // Brújula en idle: pasos más grandes; en movimiento: más suaves
            const speed = Number(window._gpsSpeedMps) || 0;
            const maxStep = speed >= 1.2 ? 16 : 22;
            const smooth = window.smoothDriverNavHeading?.(
                heading,
                window._lastDriverNavCamHeading,
                maxStep
            );
            return { pos, heading: smooth, path };
        };

        /**
         * Brújula del dispositivo + bucle de cámara para girar el mapa en tiempo real.
         */
        window.startDriverCompassTracking = async () => {
            if (window._driverCompassActive) {
                window.startDriverCompassCameraLoop?.();
                return true;
            }

            // iOS 13+: permiso explícito (mejor al tocar IR AHORA)
            try {
                const DOE = window.DeviceOrientationEvent;
                if (DOE && typeof DOE.requestPermission === 'function') {
                    const perm = await DOE.requestPermission();
                    if (perm !== 'granted') {
                        console.warn('[NAV] Permiso de brújula denegado');
                        window.startDriverCompassCameraLoop?.();
                        return false;
                    }
                }
            } catch (e) {
                console.warn('[NAV] requestPermission brújula:', e);
            }

            const onOrientation = (e) => {
                if (!window.isDriverNavigating?.()) return;
                const h = window.headingFromDeviceOrientationEvent?.(e);
                if (h == null) return;
                // Siempre actualizar brújula interna (aunque el usuario mueva el mapa a mano)
                const prev = window._deviceCompassHeading;
                if (prev != null && Number.isFinite(prev)) {
                    let delta = ((h - prev + 540) % 360) - 180;
                    if (Math.abs(delta) < 0.4) return;
                    const blended = (Math.abs(delta) > 25)
                        ? h
                        : ((prev + delta * 0.45) + 360) % 360;
                    window._deviceCompassHeading = blended;
                } else {
                    window._deviceCompassHeading = h;
                }
                window._deviceCompassAt = Date.now();
                // Free-look: NO girar el mapa aquí (el loop de cámara ya respeta autoCenter).
                // Sí rotar el carrito top-down con la brújula (como Google).
                window.syncSelfDriverMarkerHeading?.(window._deviceCompassHeading);
            };

            // Preferir absolute (norte real)
            window._driverCompassHandler = onOrientation;
            const absOpts = { absolute: true };
            try {
                window.addEventListener('deviceorientationabsolute', onOrientation, true);
                window._driverCompassUsesAbsolute = true;
            } catch (_) {
                window._driverCompassUsesAbsolute = false;
            }
            window.addEventListener('deviceorientation', onOrientation, true);
            window._driverCompassActive = true;
            window.startDriverCompassCameraLoop?.();
            return true;
        };

        window.stopDriverCompassTracking = () => {
            const h = window._driverCompassHandler;
            if (h) {
                try { window.removeEventListener('deviceorientationabsolute', h, true); } catch (_) {}
                try { window.removeEventListener('deviceorientation', h, true); } catch (_) {}
            }
            window._driverCompassHandler = null;
            window._driverCompassActive = false;
            window.stopDriverCompassCameraLoop?.();
        };

        /** Actualiza solo la rotación del carrito propio (barato, cada tick de brújula). */
        window.syncSelfDriverMarkerHeading = (headingDeg) => {
            const uid = window.currentUser?.uid;
            if (!uid || !window.currentDriverPos) return;
            const h = Number(headingDeg);
            if (!Number.isFinite(h)) return;
            window.currentDriverHeading = h;
            const meta = window._driverMarkerMeta?.[uid];
            const rot = window.getDriverMarkerScreenRotation?.(h) ?? h;
            if (meta?.contentEl) {
                meta.contentEl.style.transform = `rotate(${rot}deg)`;
                meta.lastHeading = h;
                return;
            }
            // Si aún no hay meta, forzar update completo de vez en cuando
            const now = Date.now();
            if (!window._lastSelfMarkerFullSync || now - window._lastSelfMarkerFullSync > 800) {
                window._lastSelfMarkerFullSync = now;
                const vType = window.getActiveVehicleType?.(window.userProfile)
                    || window.userProfile?.vehicleType
                    || 'auto';
                window.updateDriverMarker?.(uid, window.currentDriverPos.lat, window.currentDriverPos.lng, true, {
                    heading: h,
                    vehicleType: vType,
                    forceReposition: false,
                });
            }
        };

        window.startDriverCompassCameraLoop = () => {
            if (window._driverCompassCamLoopOn) return;
            window._driverCompassCamLoopOn = true;
            let lastTs = 0;

            const tick = (ts) => {
                if (!window._driverCompassCamLoopOn) return;
                window._driverCompassCamRaf = requestAnimationFrame(tick);
                if (!window.isDriverNavigating?.()) return;
                if (!window.currentDriverPos) return;

                // Siempre alinear carrito con brújula (aunque el mapa esté en free-look)
                const compass = window.getDriverCompassHeading?.();
                const motion = window.getDriverMotionHeading?.();
                const hHint = (compass != null)
                    ? compass
                    : (motion ?? window.currentDriverHeading);
                if (hHint != null && Number.isFinite(Number(hHint))) {
                    if (ts - (window._lastSelfCarRotTs || 0) > 50) {
                        window._lastSelfCarRotTs = ts;
                        window.syncSelfDriverMarkerHeading?.(hHint);
                    }
                }

                // Usuario movió el mapa: brújula no toca la cámara
                if (window.autoCenter === false || window._driverMapFreeLook) return;
                const lite = !!(window.hrUseLiteMaps?.());
                // APK: 7 fps; web: ~12–14 fps
                if (ts - lastTs < (lite ? 140 : 70)) return;
                lastTs = ts;

                const speed = Number(window._gpsSpeedMps) || 0;
                // Si no hay brújula ni movimiento, no spamear cámara
                if (compass == null && motion == null && hHint == null) return;

                const preferCompass = speed < 1.2 && compass != null;
                const camHeading = preferCompass
                    ? compass
                    : (motion ?? compass ?? window.currentDriverHeading);

                const prev = window._lastDriverNavCamHeading;
                if (prev != null && camHeading != null) {
                    const delta = Math.abs(((camHeading - prev + 540) % 360) - 180);
                    // En movimiento solo actualizar si hay cambio útil (GPS manda el resto)
                    if (!preferCompass && delta < 1.2 && window._lastDriverNavCamPos) return;
                }

                window.applyDriverNavCamera?.(
                    window.currentDriverPos,
                    camHeading,
                    false
                );
            };
            window._driverCompassCamRaf = requestAnimationFrame(tick);
        };

        window.stopDriverCompassCameraLoop = () => {
            window._driverCompassCamLoopOn = false;
            if (window._driverCompassCamRaf) {
                try { cancelAnimationFrame(window._driverCompassCamRaf); } catch (_) {}
                window._driverCompassCamRaf = null;
            }
        };

        window.normalizeRoutePoint = (point) => {
            if (!point) return null;
            let lat = point.lat;
            let lng = point.lng;
            if (typeof lat === 'function') lat = lat();
            if (typeof lng === 'function') lng = lng();
            if (lat == null || lng == null) return null;
            return { lat: Number(lat), lng: Number(lng) };
        };

        /** Normaliza lat/lng síncrono (Routes API / Directions / literals) */
        window.normalizeLatLngSync = (point) => {
            if (!point) return null;
            if (typeof point.lat === 'function' && typeof point.lng === 'function') {
                return { lat: point.lat(), lng: point.lng() };
            }
            let lat = point.lat ?? point.latitude;
            let lng = point.lng ?? point.longitude;
            if (point.latLng) {
                lat = point.latLng.lat ?? lat;
                lng = point.latLng.lng ?? lng;
            }
            if (point.location) {
                const loc = point.location;
                lat = (typeof loc.lat === 'function' ? loc.lat() : (loc.lat ?? loc.latitude)) ?? lat;
                lng = (typeof loc.lng === 'function' ? loc.lng() : (loc.lng ?? loc.longitude)) ?? lng;
            }
            if (typeof lat === 'function') lat = lat();
            if (typeof lng === 'function') lng = lng();
            if (lat == null || lng == null) return null;
            const nlat = Number(lat);
            const nlng = Number(lng);
            if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return null;
            return { lat: nlat, lng: nlng };
        };

        window.normalizeRouteNavSteps = (legs) => {
            const out = [];
            for (const leg of legs || []) {
                for (const raw of leg.steps || []) {
                    const nav = raw.navigationInstruction || raw;
                    let endLocation = window.normalizeLatLngSync(
                        raw.endLocation || raw.end_location || raw.startLocation || raw.start_location
                    );
                    // Fallback: último punto del path del step
                    if (!endLocation && Array.isArray(raw.path) && raw.path.length) {
                        endLocation = window.normalizeLatLngSync(raw.path[raw.path.length - 1]);
                    }
                    const instruction = nav.instructions || nav.instruction || raw.instructions || raw.instruction || '';
                    const maneuver = nav.maneuver || raw.maneuver || '';
                    if (!endLocation && !instruction && !maneuver) continue;
                    out.push({
                        instruction: String(instruction || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
                        maneuver,
                        distanceMeters: raw.distanceMeters || raw.staticDistanceMeters || raw.distance?.value || 0,
                        endLocation: endLocation || null
                    });
                }
            }
            return out;
        };

        window.buildVoiceStepsFromPath = (path) => {
            if (!path?.length) return [];
            const steps = [];
            const stride = path.length > 400 ? 3 : (path.length > 200 ? 2 : 1);
            for (let i = stride; i < path.length - stride; i += stride) {
                const prev = path[i - stride];
                const curr = path[i];
                const next = path[Math.min(path.length - 1, i + stride)];
                const b1 = window.bearingBetweenPoints(prev, curr);
                const b2 = window.bearingBetweenPoints(curr, next);
                const delta = Math.abs(((b2 - b1 + 540) % 360) - 180);
                if (delta < 28) continue;
                const turn = (b2 - b1 + 360) % 360;
                let maneuver = 'STRAIGHT';
                if (turn > 35 && turn < 145) maneuver = 'TURN_LEFT';
                else if (turn > 215 && turn < 325) maneuver = 'TURN_RIGHT';
                else if (delta > 130) maneuver = 'U_TURN';
                steps.push({
                    instruction: '',
                    maneuver,
                    distanceMeters: 0,
                    endLocation: curr
                });
            }
            const dest = path[path.length - 1];
            if (dest) {
                steps.push({
                    instruction: 'Has llegado a tu destino',
                    maneuver: 'ARRIVE',
                    distanceMeters: 0,
                    endLocation: dest
                });
            }
            if (!steps.length && path.length >= 2) {
                steps.push({
                    instruction: 'Sigue la ruta',
                    maneuver: 'STRAIGHT',
                    distanceMeters: 0,
                    endLocation: dest
                });
            }
            return steps;
        };

        window.maneuverToSpanish = (maneuver = '') => {
            const m = String(maneuver).toUpperCase().replace(/-/g, '_');
            if (m.includes('ROUNDABOUT') || m.includes('ROTARY') || m.includes('TRAFFIC_CIRCLE')) return 'Toma la rotonda';
            if (m.includes('UTURN') || m.includes('U_TURN')) return 'Haz un retorno';
            if (m.includes('KEEP_LEFT') || m.includes('STAY_LEFT') || m.includes('FORK_LEFT')) return 'Mantente a la izquierda';
            if (m.includes('KEEP_RIGHT') || m.includes('STAY_RIGHT') || m.includes('FORK_RIGHT')) return 'Mantente a la derecha';
            if (m.includes('TURN_SHARP_LEFT') || m.includes('SHARP_LEFT')) return 'Gira cerrado a la izquierda';
            if (m.includes('TURN_SHARP_RIGHT') || m.includes('SHARP_RIGHT')) return 'Gira cerrado a la derecha';
            if (m.includes('TURN_SLIGHT_LEFT') || m.includes('SLIGHT_LEFT')) return 'Gira levemente a la izquierda';
            if (m.includes('TURN_SLIGHT_RIGHT') || m.includes('SLIGHT_RIGHT')) return 'Gira levemente a la derecha';
            if (m.includes('TURN_LEFT') || (m.includes('LEFT') && !m.includes('RIGHT'))) return 'Gira a la izquierda';
            if (m.includes('TURN_RIGHT') || m.includes('RIGHT')) return 'Gira a la derecha';
            if (m.includes('MERGE') || m.includes('RAMP') || m.includes('FORK')) return 'Incorpórate a la vía';
            if (m.includes('FERRY')) return 'Toma el ferry';
            if (m.includes('ARRIVE') || m.includes('DESTINATION')) return 'Has llegado a tu destino';
            if (m.includes('STRAIGHT') || m.includes('CONTINUE') || m.includes('NAME_CHANGE')) return 'Continúa recto';
            return 'Sigue la ruta';
        };

        window.getNavManeuverIcon = (maneuver = '') => {
            const m = String(maneuver || '').toUpperCase().replace(/-/g, '_');
            if (m.includes('ROUNDABOUT') || m.includes('ROTARY') || m.includes('TRAFFIC_CIRCLE')) return 'fa-sync';
            if (m.includes('UTURN') || m.includes('U_TURN')) return 'fa-undo';
            if (m.includes('KEEP_LEFT') || m.includes('STAY_LEFT') || m.includes('FORK_LEFT')) return 'fa-arrow-left';
            if (m.includes('KEEP_RIGHT') || m.includes('STAY_RIGHT') || m.includes('FORK_RIGHT')) return 'fa-arrow-right';
            if (m.includes('SHARP_LEFT') || m.includes('TURN_LEFT') || m.includes('LEFT')) return 'fa-arrow-left';
            if (m.includes('SHARP_RIGHT') || m.includes('TURN_RIGHT') || m.includes('RIGHT')) return 'fa-arrow-right';
            if (m.includes('ARRIVE') || m.includes('DESTINATION')) return 'fa-flag-checkered';
            if (m.includes('MERGE') || m.includes('RAMP') || m.includes('FORK')) return 'fa-code-merge';
            if (m.includes('STRAIGHT') || m.includes('CONTINUE')) return 'fa-arrow-up';
            return 'fa-location-arrow';
        };

        window.stripNavHtml = (html) => {
            const raw = String(html || '');
            if (!raw.includes('<')) {
                return raw.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
            }
            try {
                const d = document.createElement('div');
                d.innerHTML = raw;
                return (d.textContent || '').replace(/\s+/g, ' ').trim();
            } catch (_) {
                return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            }
        };

        window.getNavInstructionText = (step) => {
            if (!step) return '';
            const text = window.stripNavHtml(step.instruction || '');
            if (text) return text;
            return window.maneuverToSpanish(step.maneuver);
        };

        window.shortenNavInstruction = (text) => {
            const clean = String(text || '').replace(/\s+/g, ' ').trim();
            if (!clean) return 'Sigue la ruta';
            const parts = clean.split(/[,.]/).map((p) => p.trim()).filter(Boolean);
            return parts[0] || clean;
        };

        window.getDistanceToNavPoint = (pos, point) => {
            if (!pos || !point) return Infinity;
            const dLat = (point.lat - pos.lat) * 111000;
            const dLng = (point.lng - pos.lng) * 111000 * Math.cos(pos.lat * Math.PI / 180);
            return Math.hypot(dLat, dLng);
        };

        window.getNextNavStepIndex = (route, pos) => {
            const steps = route?.steps;
            if (!steps?.length || !pos) return -1;
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                if (!step.endLocation) {
                    if (window._navVoiceState?.stepIndex == null || i >= window._navVoiceState.stepIndex) {
                        return i;
                    }
                    continue;
                }
                const distM = window.getDistanceToNavPoint(pos, step.endLocation);
                const isLast = i === steps.length - 1;
                const threshold = isLast ? 55 : 28;
                if (distM > threshold) return i;
            }
            return steps.length - 1;
        };

        window.getNextNavStep = (route, pos) => {
            const i = window.getNextNavStepIndex(route, pos);
            return i >= 0 ? route.steps[i] : null;
        };

        window.getUpcomingNavStep = (route, pos) => {
            const steps = route?.steps;
            const i = window.getNextNavStepIndex(route, pos);
            if (!steps?.length || i < 0 || i >= steps.length - 1) return null;
            return steps[i + 1];
        };

        window.syncNavThenChip = (thenStep) => {
            const chip = document.getElementById('nav-hud-then');
            const icon = document.getElementById('nav-then-icon');
            if (!chip) return;
            if (!thenStep) {
                chip.classList.add('hidden');
                return;
            }
            const cls = window.getNavManeuverIcon?.(thenStep.maneuver) || 'fa-arrow-right';
            if (icon) icon.className = `fas ${cls}`;
            chip.classList.remove('hidden');
        };

        window.getNavStepIndex = (route, step) => {
            if (!route?.steps?.length || !step) return -1;
            return route.steps.indexOf(step);
        };

        window.resetDriverNavVoice = () => {
            window._navVoiceState = null;
            window._navArrivalSpoken = false;
            window._navRouteReadySpoken = false;
            window._lastNavSpeakKey = null;
            window._lastNavSpeakAt = 0;
            try { window.speechSynthesis?.cancel?.(); } catch (_) {}
        };

        window.onDriverNavRouteReady = (route) => {
            if (!window.isDriverNavigating?.() || window._navRouteReadySpoken) return;
            window._navRouteReadySpoken = true;
            window._navVoiceState = null;
            window._navArrivalSpoken = false;
            const step = route?.steps?.[0];
            const instruction = window.getNavInstructionText?.(step);
            if (instruction) {
                window.speakNavMessage(`Ruta lista. ${window.shortenNavInstruction(instruction)}`);
            } else {
                window.speakNavMessage('Ruta lista. Sigue la ruta.');
            }
        };

        window.updateDriverVoiceNav = (route, pos) => {
            if (!window.isDriverNavigating?.() || window.driverVoiceNavEnabled === false || !route || !pos) return;

            // Voz de llegada más cercana que el botón de 1 km (evita “llegaste” muy pronto)
            const VOICE_ARRIVAL_M = 80;
            const dest = route.path?.[route.path.length - 1];
            const distToDest = dest ? window.getDistanceToNavPoint(pos, dest) : Infinity;
            const trip = window.currentActiveTripData;
            const isFinalDest = !(trip && window.getTripRouteLegLabel?.(trip)?.isFinal === false);

            if (distToDest <= VOICE_ARRIVAL_M) {
                if (!window._navArrivalSpoken) {
                    window._navArrivalSpoken = true;
                    if (isFinalDest) {
                        window.speakNavMessage('Estás en el destino. Presiona llegué al destino para que el pasajero confirme.');
                    } else {
                        const num = window.getTripRouteLegLabel?.(trip)?.routeNum || '';
                        window.speakNavMessage(`Estás en el punto ${num}. Presiona el botón de llegada.`);
                    }
                }
                return;
            }

            const step = window.getNextNavStep(route, pos);
            if (!step) return;

            const stepIndex = window.getNavStepIndex(route, step);
            const distM = step.endLocation
                ? window.getDistanceToNavPoint(pos, step.endLocation)
                : Number(step.distanceMeters) || 0;
            const instruction = window.getNavInstructionText(step);
            const short = window.shortenNavInstruction(instruction);

            if (!window._navVoiceState || window._navVoiceState.stepIndex !== stepIndex) {
                window._navVoiceState = { stepIndex, bands: {} };
            }
            const bands = window._navVoiceState.bands;

            const speakBand = (key, phrase) => {
                if (bands[key]) return false;
                bands[key] = true;
                window.speakNavMessage(phrase);
                return true;
            };

            // Bandas más finas (estilo turn-by-turn)
            if (distM <= 20) {
                speakBand('now', `Ahora, ${short}`);
                return;
            }
            if (distM <= 45) {
                speakBand('40', `En 40 metros, ${short}`);
                return;
            }
            if (distM <= 80) {
                speakBand('80', `En 80 metros, ${short}`);
                return;
            }
            if (distM <= 120) {
                speakBand('100', `En 100 metros, ${short}`);
                return;
            }
            if (distM <= 220) {
                speakBand('200', `En 200 metros, ${short}`);
                return;
            }
            if (distM <= 350) {
                speakBand('300', `En 300 metros, ${short}`);
                return;
            }
            if (distM <= 500) {
                speakBand('500', `En 500 metros, ${short}`);
                return;
            }
            if (!bands.preview && distM > 500) {
                const rounded = Math.max(600, Math.round(distM / 100) * 100);
                bands.preview = true;
                window.speakNavMessage(`En ${rounded} metros, ${short}`);
            }
        };

        window.formatNavStepDistance = (meters) => {
            const m = Number(meters) || 0;
            if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
            return `${(m / 1000).toFixed(1)} km`;
        };

        /** Escribe texto de nav en panel central (+ HUD flotante si existe, p. ej. pasajero). */
        window.setNavHudText = (field, text) => {
            const ids = {
                stepText: ['panel-nav-step-text', 'nav-step-text'],
                stepDist: ['panel-nav-step-dist', 'nav-step-dist'],
                totalTime: ['panel-nav-total-time', 'nav-total-time'],
                totalDist: ['panel-nav-total-dist', 'nav-total-dist'],
                totalEta: ['panel-nav-total-eta', 'nav-total-eta'],
            }[field];
            if (!ids) return;
            const val = text == null ? '' : String(text);
            ids.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            });
        };

        window.setNavHudIcon = (iconClass) => {
            const cls = iconClass || 'fas fa-location-arrow';
            ['panel-nav-step-icon', 'nav-step-icon'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.className = cls;
            });
        };

        /**
         * Conductor: nav en panel central si está abierto.
         * Si el panel está minimizado (p. ej. tras PIN), el HUD flotante superior
         * debe seguir visible — si no, “desaparece” el modo navegación.
         */
        window.syncDriverPanelNavVisibility = () => {
            const isDriver = document.body.classList.contains('driver-mode')
                || window.userProfile?.role === 'driver';
            const destPhase = document.body.classList.contains('driver-trip-dest-phase')
                || window.currentActiveTripData?.status === 'in_progress';
            const navigating = window.isDriverNavigating?.()
                || document.body.classList.contains('is-navigating')
                || document.body.classList.contains('driver-nav-mode')
                || !!window.driverNavMode
                || destPhase
                || window.hasActiveDriverNavRoute?.();
            const panel = document.getElementById('control-panel');
            const panelMin = document.body.classList.contains('panel-minimized')
                || document.body.classList.contains('panel-collapsed')
                || !!panel?.classList.contains('panel-collapsed');
            const panelNav = document.getElementById('driver-panel-nav');
            if (panelNav) {
                // Panel abierto: ficha de giros también en el sheet
                const showInPanel = !!(isDriver && navigating && !panelMin);
                panelNav.classList.toggle('hidden', !showInPanel);
                if (showInPanel) {
                    panelNav.style.setProperty('display', 'flex', 'important');
                    const step = document.getElementById('panel-nav-step-text');
                    if (step && (!step.textContent || step.textContent === 'En camino…')) {
                        step.textContent = destPhase ? 'En camino al destino' : 'En camino al pasajero';
                    }
                } else {
                    panelNav.style.removeProperty('display');
                }
            }
            if (isDriver) {
                const top = document.getElementById('nav-hud-top');
                const bottom = document.getElementById('nav-hud-bottom');
                // Panel abajo = banner tipo Google Maps arriba del mapa
                const showFloatHud = !!(navigating && panelMin);
                document.body.classList.toggle('gmaps-driver-nav', showFloatHud);
                if (top) {
                    if (showFloatHud) {
                        top.classList.remove('hidden');
                        top.classList.add('is-gmaps-visible');
                        top.style.setProperty('display', 'flex', 'important');
                        top.style.setProperty('visibility', 'visible', 'important');
                        top.style.setProperty('opacity', '1', 'important');
                        top.style.setProperty('pointer-events', 'auto', 'important');
                        top.style.setProperty('z-index', '2800', 'important');
                        top.style.setProperty('max-height', 'none', 'important');
                        const stepEl = document.getElementById('nav-step-text');
                        if (stepEl && (!stepEl.textContent || stepEl.textContent === 'En camino…')) {
                            stepEl.textContent = destPhase ? 'En camino al destino' : 'En camino al pasajero';
                        }
                    } else {
                        top.classList.remove('is-gmaps-visible');
                        top.style.setProperty('display', 'none', 'important');
                        top.classList.add('hidden');
                    }
                }
                // Bottom float sigue oculto en conductor (ETA en mini-bar / panel)
                if (bottom) {
                    bottom.style.setProperty('display', 'none', 'important');
                    bottom.classList.add('hidden');
                }
            }
        };

        window.updateDriverNavTurnCard = (route, pos) => {
            const liveNav = window.isDriverNavigating?.()
                || document.body.classList.contains('driver-nav-mode')
                || document.body.classList.contains('is-navigating')
                || document.body.classList.contains('driver-trip-dest-phase');
            if (!liveNav) return;
            window.syncDriverPanelNavVisibility?.();
            const step = window.getNextNavStep(route, pos);
            const hasPanel = !!document.getElementById('panel-nav-step-text');
            const hasFloat = !!document.getElementById('nav-step-text');
            if (!hasPanel && !hasFloat) return;

            const dest = route?.path?.[route.path.length - 1];
            const distToDest = dest ? window.getDistanceToNavPoint(pos, dest) : Infinity;
            const trip = window.currentActiveTripData;
            const pickupPhase = trip?.status === 'accepted' && !trip?.driverArrived;

            if (pickupPhase) {
                window.syncDriverPickupArrivalUi?.(pos);
                if (distToDest <= 1000) {
                    window.setNavHudText('stepText', '¡Cerca del pasajero!');
                    window.setNavHudText(
                        'stepDist',
                        distToDest <= DESTINATION_ARRIVAL_RADIUS_M
                            ? 'Presiona ¡HE LLEGADO! en el panel'
                            : 'Ya puedes presionar ¡HE LLEGADO!'
                    );
                    window.setNavHudIcon('fas fa-map-marker-alt');
                    window.syncNavThenChip?.(null);
                    return;
                }
            } else if (distToDest <= DESTINATION_ARRIVAL_RADIUS_M) {
                const legLabel = window.getTripRouteLegLabel?.(trip);
                if (legLabel?.isFinal !== false) {
                    window.setNavHudText('stepText', '¡Estás en el destino!');
                    window.setNavHudText('stepDist', 'Presiona LLEGUÉ AL DESTINO en el panel');
                } else {
                    window.setNavHudText('stepText', `¡Estás en el punto ${legLabel.routeNum}!`);
                    window.setNavHudText('stepDist', `Presiona LLEGUÉ AL PUNTO ${legLabel.routeNum} en el panel`);
                }
                window.setNavHudIcon('fas fa-map-marker-alt');
                window.syncNavThenChip?.(null);
                window.syncDriverDestinationArrivalUi?.(pos);
                return;
            }

            if (step) {
                const text = window.shortenNavInstruction?.(window.getNavInstructionText(step))
                    || window.getNavInstructionText(step)
                    || 'Continúa por la ruta';
                const distM = step.endLocation
                    ? window.getDistanceToNavPoint(pos, step.endLocation)
                    : Number(step.distanceMeters) || 0;
                window.setNavHudText('stepText', text);
                window.setNavHudText('stepDist', `En ${window.formatNavStepDistance(distM)}`);
                window.setNavHudIcon(`fas ${window.getNavManeuverIcon(step.maneuver)}`);
                window.syncNavThenChip?.(window.getUpcomingNavStep?.(route, pos));
            } else if (route) {
                window.setNavHudText('stepText', 'Sigue la ruta');
                window.setNavHudText(
                    'stepDist',
                    `${window.getRouteDistanceKm(route).toFixed(1)} km · ${window.formatRouteDuration(route)}`
                );
                window.setNavHudIcon('fas fa-arrow-up');
                window.syncNavThenChip?.(null);
            }

            window.updateDriverVoiceNav?.(route, pos);
        };

        window.getDriverNavMapPadding = () => {
            const vv = window.visualViewport;
            const vw = vv?.width || window.innerWidth || 360;
            const vh = vv?.height || window.innerHeight || 640;
            const landscape = vw > vh;
            const safeSide = Math.max(10, Math.round(Math.min(vw, vh) * 0.03));
            const navHudBottom = document.getElementById('nav-hud-bottom');
            const navHudTop = document.getElementById('nav-hud-top');
            const driverNav = document.body.classList.contains('driver-nav-mode');
            const panelOpen = document.body.classList.contains('trip-active')
                && !document.body.classList.contains('panel-minimized')
                && !document.body.classList.contains('panel-hidden');
            const panelMin = document.body.classList.contains('panel-minimized');

            // Panel maximizado = faja inferior (~46dvh); minimizado = mini-barra
            let bottomUi = 64;
            if (driverNav || document.body.classList.contains('trip-active')) {
                const panelEl = document.getElementById('control-panel');
                const sheetH = panelEl && panelEl.offsetParent !== null
                    ? panelEl.getBoundingClientRect().height
                    : 0;
                if (panelOpen) {
                    // Reservar solo la altura real del sheet (mapa sigue navegable arriba)
                    bottomUi = Math.max(
                        Math.round(vh * 0.22),
                        Math.min(sheetH > 40 ? sheetH + 12 : Math.round(vh * 0.42), Math.round(vh * 0.5))
                    );
                } else if (panelMin) {
                    bottomUi = Math.max(bottomUi, Math.min(sheetH > 20 ? sheetH + 10 : 100, 120));
                } else {
                    bottomUi = Math.max(bottomUi, 72);
                }
            } else {
                if (navHudBottom && navHudBottom.offsetParent !== null
                    && !document.body.classList.contains('nav-hud-minimized')) {
                    bottomUi = Math.max(bottomUi, Math.min(90, navHudBottom.offsetHeight + 12));
                }
                if (panelOpen) {
                    bottomUi = Math.max(bottomUi, Math.round(vh * 0.18));
                }
            }

            const topMin = landscape ? 36 : 44;
            const hudVisible = navHudTop
                && !navHudTop.classList.contains('hidden')
                && navHudTop.style.display !== 'none';
            const hudH = hudVisible ? Math.min(150, (navHudTop.offsetHeight || 88) + 18) : topMin;
            const topUi = driverNav
                ? Math.max(topMin, hudH)
                : ((navHudTop && navHudTop.offsetParent !== null
                    && !document.body.classList.contains('nav-hud-top-minimized'))
                    ? Math.max(topMin, Math.min(78, navHudTop.offsetHeight + 10))
                    : topMin);
            // Carro más abajo en pantalla → más mapa ADELANTE (calles por donde vas)
            // top alto + bottom = sheet → centro óptico en ~65–72% de la altura
            const forwardBias = Math.round(vh * (landscape ? 0.16 : 0.2));
            const safeTop = Math.round(vv?.offsetTop || 0);
            const safeBottom = Math.max(0, Math.round((window.innerHeight || vh) - (vv?.height || vh) - safeTop));

            return {
                top: Math.max(topUi, 36) + forwardBias + safeTop,
                right: safeSide,
                bottom: bottomUi + Math.round(vh * 0.01) + safeBottom,
                left: safeSide,
            };
        };

        window.applyDriverNavCamera = (rawPos, rawHeading, force = false) => {
            if (!window.gMap || !rawPos || !window.isDriverNavigating?.()) return;
            // Free-look con los dedos: no pelear con pan/zoom/rotar del usuario
            // (la brújula sigue midiendo; no mueve la cámara hasta «Centrar»)
            if (!force && (window.autoCenter === false || window._driverMapFreeLook)) return;

            const cam = window.getDriverNavCameraState?.(rawPos, rawHeading) || { pos: rawPos, heading: rawHeading || 0 };
            const pos = cam.pos || rawPos;
            const h = Number.isFinite(cam.heading) ? cam.heading : 0;
            const lowPower = !!(window.hrUseLiteMaps?.()
                || (typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode()));
            const lastCam = window._lastDriverNavCamPos;
            const moved = !lastCam || Math.hypot(pos.lat - lastCam.lat, pos.lng - lastCam.lng) > (lowPower ? 0.0001 : 0.00003);
            const headingDelta = window._lastDriverNavCamHeading == null
                ? 999
                : Math.abs(((h - window._lastDriverNavCamHeading + 540) % 360) - 180);
            // Brújula: umbral bajo para que el mapa gire con el teléfono
            if (!force && !moved && headingDelta < 0.9) return;
            window._lastDriverNavCamPos = { lat: pos.lat, lng: pos.lng };
            window._lastDriverNavCamHeading = h;
            // Solo actualizar rumbo “oficial” cuando la nav controla la cámara
            window.currentDriverHeading = h;

            const applyCam = () => {
                const hasMapId = !!(window.gMap && window.gMap.getMapId && window.gMap.getMapId());
                const landscape = (window.visualViewport?.width || window.innerWidth || 360)
                    > (window.visualViewport?.height || window.innerHeight || 640);
                // Zoom para VER la ruta (no tan pegado al carro que se pierda el trazo)
                const tilt = lowPower ? 0 : (landscape ? 38 : 48);
                const speed = Number(window._gpsSpeedMps);
                const mps = Number.isFinite(speed) && speed >= 0 ? speed : 0;
                // ~16.5–18.5: se ve tramo de ruta + calles; no 20–21 de “micro calle”
                let zoom = lowPower ? 17.2 : 17.8;
                if (mps >= 22) zoom = lowPower ? 16.2 : 16.6;      // ~80 km/h: más contexto
                else if (mps >= 14) zoom = lowPower ? 16.6 : 17.2;  // ~50 km/h
                else if (mps < 2) zoom = lowPower ? 17.6 : 18.2;    // lento: un poco más cerca
                zoom = Math.min(18.5, Math.max(15.5, zoom));

                // Centro un poco ADELANTE del carro → ves por dónde vas
                const lookAheadM = mps < 2
                    ? (lowPower ? 36 : 48)
                    : (mps >= 18 ? (lowPower ? 90 : 120) : (lowPower ? 60 : 80));
                const camCenter = window.offsetLatLngByMeters?.(pos.lat, pos.lng, h, lookAheadM) || pos;

                const padding = window.getDriverNavMapPadding?.() || {
                    top: 48,
                    right: 12,
                    bottom: 120,
                    left: 12,
                };
                const cameraOpts = {
                    center: camCenter,
                    zoom,
                    padding,
                    heading: h,
                    tilt,
                };
                // Preferir APIs que rotan de verdad
                if (typeof window.gMap.moveCamera === 'function' && hasMapId) {
                    window.gMap.moveCamera(cameraOpts);
                } else {
                    try { window.gMap.setCenter(camCenter); } catch (_) {}
                    try { window.gMap.setZoom(zoom); } catch (_) {}
                    try { window.gMap.setHeading(h); } catch (_) {}
                    try { window.gMap.setTilt(tilt); } catch (_) {}
                }
            };

            try {
                if (typeof window.withProgrammaticMapCamera === 'function') {
                    window.withProgrammaticMapCamera(applyCam);
                } else {
                    applyCam();
                }
                // Tras girar el mapa, re-alinear carrito top-down (frente = arriba en pantalla)
                window.syncSelfDriverMarkerHeading?.(h);
            } catch (_) {
                try {
                    window.gMap.setCenter(pos);
                    window.gMap.setZoom(20.5);
                    window.gMap.setHeading(h);
                    window.syncSelfDriverMarkerHeading?.(h);
                } catch (__) {
                    try { window.gMap.panTo(pos); } catch (___) {}
                }
            }
        };

        /** Desplaza un punto N metros en rumbo (grados, 0 = norte). */
        window.offsetLatLngByMeters = (lat, lng, headingDeg, meters) => {
            const nlat = Number(lat);
            const nlng = Number(lng);
            const m = Number(meters);
            const hdg = Number(headingDeg);
            if (!Number.isFinite(nlat) || !Number.isFinite(nlng) || !Number.isFinite(m) || m === 0) {
                return { lat: nlat, lng: nlng };
            }
            const R = 6378137;
            const brng = ((Number.isFinite(hdg) ? hdg : 0) * Math.PI) / 180;
            const dLat = (m * Math.cos(brng)) / R;
            const dLng = (m * Math.sin(brng)) / (R * Math.cos((nlat * Math.PI) / 180));
            return {
                lat: nlat + (dLat * 180) / Math.PI,
                lng: nlng + (dLng * 180) / Math.PI,
            };
        };

        window.recenterDriverNav = () => {
            if (!window.gMap) return;
            if (!window.currentDriverPos) {
                window.showToast?.('Esperando ubicación GPS…', 'warning');
                return;
            }
            // Salir de free-look: brújula + GPS vuelven a manejar la cámara
            window.resumeDriverNavCameraFollow?.();
            window.autoCenter = true;
            window._driverMapFreeLook = false;
            window.setMapFabVisible?.('fab-center', false);
            window._lastDriverNavCamPos = null;
            window._lastDriverNavCamHeading = null;
            window._lastDriverCameraUpdate = 0;
            // Asegurar modo nav si hay viaje de conductor con ruta
            if (document.body.classList.contains('driver-mode')
                && document.body.classList.contains('trip-active')) {
                document.body.classList.add('driver-nav-mode', 'is-navigating');
                window.driverNavMode = true;
            }
            window.enableDriverMapFreeGestures?.();
            try {
                // Primero encuadra la ruta completa (se ve el camino), luego cámara de nav
                window.fitDriverActiveRouteOverview?.();
                setTimeout(() => {
                    try {
                        window.applyDriverNavCamera?.(
                            window.currentDriverPos,
                            window.currentDriverHeading
                                ?? window.getDriverCompassHeading?.()
                                ?? window.getDriverMotionHeading?.()
                                ?? 0,
                            true
                        );
                    } catch (_) {}
                }, 420);
            } catch (_) {
                try {
                    window.gMap.panTo(window.currentDriverPos);
                    window.gMap.setZoom(17.5);
                } catch (__) {}
            }
            window.syncNavigationMapFabs?.();
        };

        /**
         * Minimiza el panel en navegación (mapa grande).
         * Si el usuario lo maximizó a mano, NO lo cierra de nuevo (salvo force: true).
         */
        window.minimizeDriverPanelForNav = (opts = {}) => {
            const force = opts.force === true;
            // Preferencia del usuario: panel abierto hasta que lo cierre él
            // (salvo force: true — p.ej. tras ingresar PIN / arrancar al destino)
            if (!force && window._driverNavUserKeptOpen) return;

            const panel = document.getElementById('control-panel');
            if (!panel) return;
            // Ya minimizado: no pelear
            if (!force
                && panel.classList.contains('panel-collapsed')
                && document.body.classList.contains('panel-minimized')) {
                return;
            }
            // Cerrar teclado si quedó del PIN
            try {
                document.getElementById('driver-pin-input')?.blur?.();
                document.getElementById('driver-panel-pin-input')?.blur?.();
                if (document.activeElement
                    && (document.activeElement.tagName === 'INPUT'
                        || document.activeElement.tagName === 'TEXTAREA')) {
                    document.activeElement.blur();
                }
            } catch (_) {}
            panel.classList.add('panel-collapsed');
            panel.classList.remove('panel-hidden');
            document.body.classList.add('panel-minimized', 'panel-collapsed');
            document.body.classList.remove('panel-hidden');
            window._driverNavUserKeptOpen = false;
            try { localStorage.setItem('honduber_control_panel_hidden', '1'); } catch (_) {}
            const label = document.getElementById('trip-panel-toggle-label');
            if (label) label.textContent = 'Abrir';
            const tpLabel = document.getElementById('tp-panel-toggle-label');
            if (tpLabel) tpLabel.textContent = 'Ver más';
            const minHint = document.querySelector('#control-panel .driver-panel-min-hint');
            if (minHint) minHint.textContent = 'Maximizar';
            try { window.syncPanelHideChevron?.(); } catch (_) {}
            try { window.syncDriverRadarFloatPanel?.(); } catch (_) {}
            // Tras minimizar: si hay nav, mostrar HUD flotante de giros (no “desaparecer” nav)
            try {
                if (
                    window.isDriverNavigating?.()
                    || window.driverNavMode
                    || document.body.classList.contains('driver-trip-dest-phase')
                    || window.currentActiveTripData?.status === 'in_progress'
                ) {
                    document.body.classList.add('is-navigating', 'driver-nav-mode');
                    window.driverNavMode = true;
                    document.body.classList.remove('nav-hud-top-minimized', 'nav-hud-minimized');
                }
                window.syncDriverPanelNavVisibility?.();
            } catch (_) {}
            try { window.syncPassengerPanelToggleLabel?.(); } catch (_) {}
            try { window.bindDriverPanelMinBtn?.(); } catch (_) {}
            try {
                // eslint-disable-next-line no-unused-expressions
                panel.offsetHeight;
            } catch (_) {}
        };

        window.enterDriverNavMode = () => {
            document.body.classList.add('driver-nav-mode');
            // Do NOT remove 'nav-hud-minimized' here.
            // If user minimized the nav HUD, keep it hidden until he explicitly opens it.
            // Only reset on full trip end (resetDriverNavCamera).
            window.driverNavMode = true;
            if (window.driverVoiceNavEnabled == null) window.driverVoiceNavEnabled = true;
            window.autoCenter = true;
            window.hideDriverTripExtraPanels?.();
            window.bindNavHudTopPanel?.();
            window.syncNavHudTopToggleUi?.();
            // Auto-minimizar solo la primera vez; si el usuario abrió el panel, respétalo
            if (!window._driverNavPanelAutoMinDone && !window._driverNavUserKeptOpen) {
                window._driverNavPanelAutoMinDone = true;
                window.minimizeDriverPanelForNav?.();
            } else {
                window._driverNavPanelAutoMinDone = true;
            }

            window.setupDriverRotationListener?.();
            // Gestos libres con dedos + brújula (sin pelear en free-look)
            window.enableDriverMapFreeGestures?.();
            window.startDriverCompassTracking?.().catch?.(() => {});
            window.syncDriverPanelNavVisibility?.();
            // Solo mapa: ocultar saludo / logo / bandera del header
            try { window.syncDriverChromeForActiveTrip?.(); } catch (_) {}
            try { window.closeHeaderMoreMenu?.(); } catch (_) {}
        };

        // Re-centra al girar el celular (vertical/horizontal) siguiendo la ruta
        window.setupDriverRotationListener = () => {
            if (window._driverRotListenerBound) return;
            window._driverRotListenerBound = true;

            const recenterAfterLayout = () => {
                if (!window.isDriverNavigating?.() || !window.currentDriverPos) return;
                // Si el usuario está mirando el mapa a mano, no forzar re-centro al rotar el teléfono
                if (window.autoCenter === false || window._driverMapFreeLook) return;
                window._lastDriverNavCamPos = null;
                window._lastDriverNavCamHeading = null;
                window._lastDriverCameraUpdate = 0;
                window.applyDriverNavCamera?.(
                    window.currentDriverPos,
                    window.currentDriverHeading,
                    true
                );
                if (window.currentNavRoute && window.currentDriverPos) {
                    window.updateDriverNavTurnCard?.(window.currentNavRoute, window.currentDriverPos);
                }
            };

            const onLayoutChange = () => {
                [120, 280, 480, 760].forEach((ms) => setTimeout(recenterAfterLayout, ms));
            };

            window.addEventListener('orientationchange', onLayoutChange, { passive: true });
            window.addEventListener('resize', () => {
                if (window.isDriverNavigating?.()) onLayoutChange();
            }, { passive: true });
            window.visualViewport?.addEventListener('resize', () => {
                if (window.isDriverNavigating?.()) onLayoutChange();
            }, { passive: true });
            window.visualViewport?.addEventListener('scroll', () => {
                if (window.isDriverNavigating?.()) recenterAfterLayout();
            }, { passive: true });
        };

        window.resetDriverNavCamera = (opts = {}) => {
            const preserveRoute = opts.preserveRoute === true
                || (opts.force !== true && window.shouldPreserveDriverNavRoute?.());
            window.driverNavMode = false;
            document.body.classList.remove('driver-nav-mode', 'nav-hud-minimized', 'nav-hud-top-minimized');
            if (!preserveRoute) {
                window.currentNavRoute = null;
                window.stopRouteProgressAnimation?.();
            }
            window.hideNavRouteLoading?.();
            window.resetDriverNavVoice?.();
            window.stopDriverCompassTracking?.();
            window._lastDriverNavCamPos = null;
            window._lastDriverNavCamHeading = null;
            window._gpsPosHistory = [];
            window._driverNavPanelAutoMinDone = false;
            window._driverNavUserKeptOpen = false;
            document.getElementById('driver-panel-nav')?.classList.add('hidden');
            if (!window.gMap) return;
            try {
                window.gMap.setTilt(0);
                window.gMap.setHeading(0);
            } catch (_) {}
            const hud = document.getElementById('nav-hud-bottom');
            if (hud) hud.style.display = 'none';
            window.syncDriverPanelNavVisibility?.();
        };

        window.isPassengerTracking = () =>
            document.body.classList.contains('passenger-track-mode')
            && window.userProfile?.role === 'client';

        window.getPassengerVehicleEmoji = (type = 'auto') => {
            const t = type || 'auto';
            if (t === 'moto') return '🏍️';
            if (t === 'taxi') return '🚕';
            if (t === 'paila') return '🛻';
            if (t === 'camion') return '🚛';
            return '🚗';
        };

        window.getPassengerVehicleNoun = (type = 'auto') => {
            const t = type || 'auto';
            if (t === 'moto') return 'moto';
            if (t === 'taxi') return 'taxi';
            if (t === 'paila') return 'paila';
            if (t === 'camion') return 'camión';
            return 'auto';
        };

        window.syncPassengerNavHud = (tripData, route, phase, vehicleType = 'auto') => {
            if (!window.isPassengerTracking?.()) return;
            const navTop = document.getElementById('nav-hud-top');
            if (navTop) navTop.style.display = 'flex';

            const emoji = window.getPassengerVehicleEmoji(vehicleType);
            const vehicleNoun = window.getPassengerVehicleNoun(vehicleType);
            const firstName = (tripData?.driverName || 'Tu conductor').split(' ')[0];
            const mins = route ? Math.max(1, Math.round((route.durationMillis || 0) / 60000)) : null;
            const km = route ? window.getRouteDistanceKm(route).toFixed(1) : null;
            const etaTime = route ? window.formatRouteEta(route) : null;

            const stepText = document.getElementById('nav-step-text');
            const stepDist = document.getElementById('nav-step-dist');
            const stepIcon = document.getElementById('nav-step-icon');

            if (stepIcon) {
                stepIcon.className = 'text-2xl leading-none select-none';
                stepIcon.textContent = emoji;
            }

            const meters = route?.distanceMeters ?? (km ? parseFloat(km) * 1000 : null);

            if (phase === 'destination') {
                if (stepText) {
                    // A 1 km o menos consideramos que el conductor "ya llegó" (no entra a la casa)
                    if (meters != null && meters <= DESTINATION_ARRIVAL_RADIUS_M) {
                        const trip = window.currentActiveTripData || window.activeTrip;
                        stepText.textContent = trip?.driverArrivedDestination
                            ? '¡Tu conductor llegó! Confirma en el panel azul'
                            : 'Cerca del destino — el conductor confirmará llegada';
                    } else if (meters != null && meters <= 350) {
                        stepText.textContent = '¡Ya casi llegamos!';
                    } else if (mins != null && mins <= 2) {
                        stepText.textContent = `Casi en tu destino · ~${mins} min`;
                    } else if (mins != null && mins <= 5) {
                        stepText.textContent = `Llegando · ~${mins} min al destino`;
                    } else {
                        stepText.textContent = mins
                            ? `${firstName} · ~${mins} min al destino`
                            : 'Viaje en curso';
                    }
                }
                if (stepDist) {
                    if (meters != null && meters <= DESTINATION_ARRIVAL_RADIUS_M) {
                        const trip = window.currentActiveTripData || window.activeTrip;
                        stepDist.textContent = trip?.driverArrivedDestination
                            ? 'Toca SÍ, YA LLEGUÉ AL DESTINO'
                            : 'A ~1 km — espera confirmación del conductor';
                    } else {
                        stepDist.textContent = km && etaTime
                            ? `${km} km · llegada ${etaTime}`
                            : 'Sigue la ruta azul en el mapa';
                    }
                }
            } else {
                if (stepText) {
                    if (meters != null && meters <= 400) {
                        stepText.textContent = `¡${firstName} está muy cerca!`;
                    } else if (mins != null && mins <= 1) {
                        stepText.textContent = `¡${firstName} ya casi llega!`;
                    } else if (mins != null && mins <= 3) {
                        stepText.textContent = `¡${firstName} está cerca! · ~${mins} min`;
                    } else if (mins != null && mins <= 5) {
                        stepText.textContent = `~${mins} min · allista tus cosas`;
                    } else {
                        stepText.textContent = mins
                            ? `${firstName} viene en ${vehicleNoun} · ~${mins} min`
                            : `${firstName} viene en ${vehicleNoun}`;
                    }
                }
                if (stepDist) {
                    if (mins != null && mins <= 5) {
                        stepDist.textContent = km
                            ? `Prepárate · a ${km} km`
                            : 'Prepárate · conductor en camino';
                    } else {
                        stepDist.textContent = km
                            ? `A ${km} km · sigue el ícono en el mapa`
                            : 'Conductor en camino hacia ti';
                    }
                }
            }

            const navTime = document.getElementById('nav-total-time');
            const navDist = document.getElementById('nav-total-dist');
            const navEta = document.getElementById('nav-total-eta');
            if (navTime && mins) navTime.textContent = `~${mins} min`;
            if (navDist && km) navDist.textContent = `${km} km`;
            if (navEta && etaTime) navEta.textContent = etaTime;
        };

        window.enterPassengerTrackMode = (phase = 'pickup', tripData = null) => {
            window.passengerTrackPhase = phase;
            window.passengerTrackFollow = true;
            window.passengerTrackVehicleType = tripData?.vehicleType
                || tripData?.serviceType
                || window.passengerTrackVehicleType
                || 'auto';
            document.body.classList.add('passenger-track-mode', 'passenger-nav-mode', 'is-navigating');
            const panel = document.getElementById('control-panel');
            if (panel && !panel.classList.contains('panel-collapsed')) {
                panel.classList.add('panel-collapsed');
                document.body.classList.add('panel-minimized');
                window.syncPassengerPanelToggleLabel?.();
            }
            const navBottom = document.getElementById('nav-hud-bottom');
            if (navBottom) navBottom.style.display = 'none';

            window.syncPassengerNavHud?.(
                tripData || window.currentActiveTripData,
                window.currentPassengerTrackRoute,
                phase,
                window.passengerTrackVehicleType
            );
            window.autoCenter = true;
            window.hideCenterMapFab?.();
            window.bindNavHudTopPanel?.();
            window.syncNavigationMapFabs?.();
        };

        window.resetPassengerNavCamera = () => {
            window._passengerNavCamPos = null;
            window._passengerCameraLastUpdate = 0;
            if (!window.gMap) return;
            try {
                window.gMap.setTilt(0);
                window.gMap.setHeading(0);
            } catch (_) {}
        };

        window.exitPassengerTrackMode = () => {
            document.body.classList.remove('passenger-track-mode', 'passenger-nav-mode', 'is-navigating', 'nav-hud-top-minimized');
            window.passengerTrackPhase = null;
            window.passengerTrackFollow = true;
            window.passengerTrackVehicleType = null;
            window._passengerTrackDriverId = null;
            window._passengerTrackHeading = 0;
            window.currentPassengerTrackRoute = null;
            window.currentDriverTrackPos = null;
            window.currentPassengerTrackDest = null;
            window._passengerCameraLastUpdate = 0;
            window._passengerDestCamBoundAt = 0;
            window._passengerFrozenOrigin = null;
            window._originMarkerKey = null;
            window._targetMarkerKey = null;
            window.stopRouteProgressAnimation?.();
            window.resetPassengerNavCamera?.();
            window.setMapFabVisible?.('fab-center', false);
            window.setMapFabVisible?.('fab-traffic', false);
            const navTop = document.getElementById('nav-hud-top');
            if (navTop) navTop.style.display = 'none';
            const stepIcon = document.getElementById('nav-step-icon');
            if (stepIcon) {
                stepIcon.textContent = '';
                stepIcon.className = 'fas fa-location-arrow text-2xl text-white';
            }
        };

        window.applyPassengerNavCamera = (driverPos, heading, force = false) => {
            if (!window.gMap || !driverPos || window.passengerTrackFollow === false) return;
            if (!window.isPassengerTracking?.()) {
                window.applyPassengerTrackCamera?.(driverPos, window.currentPassengerTrackDest, window.currentPassengerTrackRoute?.path, force);
                return;
            }

            const h = Number.isFinite(heading) ? heading : 0;
            const lowPower = typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode();
            const last = window._passengerNavCamPos;
            const moved = !last || Math.hypot(driverPos.lat - last.lat, driverPos.lng - last.lng) > 0.00008;
            const now = Date.now();
            if (!force && !moved && window._passengerCameraLastUpdate && now - window._passengerCameraLastUpdate < 900) {
                return;
            }
            window._passengerNavCamPos = driverPos;
            window._passengerCameraLastUpdate = now;

            try {
                const hasMapId = !!(window.gMap.getMapId && window.gMap.getMapId());
                const cameraOpts = { center: driverPos, zoom: lowPower ? 16 : 17 };
                if (hasMapId && !lowPower) {
                    cameraOpts.tilt = 42;
                    cameraOpts.heading = h;
                }
                if (typeof window.gMap.moveCamera === 'function') {
                    window.gMap.moveCamera(cameraOpts);
                } else {
                    window.gMap.panTo(driverPos);
                    window.gMap.setZoom(cameraOpts.zoom);
                    if (hasMapId && !lowPower) {
                        window.gMap.setTilt(42);
                        window.gMap.setHeading(h);
                    }
                }
            } catch (_) {
                try { window.gMap.panTo(driverPos); } catch (__) {}
            }
        };

        window.syncPassengerTripMapEndpoints = (tripData = null) => {
            const trip = tripData || window.currentActiveTripData || null;
            if (!trip || !window.mapLoaded || !window.gMap) return;

            // Origen FIJO del viaje (no el GPS del carro). Antes se usaba liveDriver
            // cuando originSource=driver_fallback → el pin A saltaba cada frame y “parpadeaba”.
            let originLat = trip.originLat != null ? Number(trip.originLat) : null;
            let originLng = trip.originLng != null ? Number(trip.originLng) : null;
            // Solo una vez: si falta origen, fijar desde el primer GPS del conductor (no cada tick)
            if (
                (originLat == null || originLng == null || !Number.isFinite(originLat) || !Number.isFinite(originLng))
                && !window._passengerFrozenOrigin
            ) {
                const liveDriver = window.currentDriverTrackPos;
                if (liveDriver?.lat != null && liveDriver?.lng != null) {
                    window._passengerFrozenOrigin = {
                        lat: Number(liveDriver.lat),
                        lng: Number(liveDriver.lng)
                    };
                }
            }
            if (
                (originLat == null || originLng == null)
                && window._passengerFrozenOrigin
            ) {
                originLat = window._passengerFrozenOrigin.lat;
                originLng = window._passengerFrozenOrigin.lng;
            }

            if (originLat != null && originLng != null && Number.isFinite(originLat) && Number.isFinite(originLng)) {
                window.placePickupMarker?.(
                    { lat: originLat, lng: originLng },
                    'A - Origen',
                    { style: 'simple' }
                );
            }

            const legTarget = window.getTripCurrentLegNavTarget?.(trip);
            const legLabel = window.getTripRouteLegLabel?.(trip);
            if (legTarget?.lat != null && legTarget?.lng != null) {
                const markerLabel = legLabel?.isFinal !== false
                    ? 'B - Destino'
                    : `Punto ${legLabel?.routeNum || ''}`;
                window.placeDestinationMarker?.({ lat: legTarget.lat, lng: legTarget.lng }, markerLabel);
            } else if (trip.destinationLat != null && trip.destinationLng != null) {
                window.placeDestinationMarker?.(
                    { lat: Number(trip.destinationLat), lng: Number(trip.destinationLng) },
                    'B - Destino'
                );
            } else if (window.currentPassengerTrackDest?.lat != null) {
                window.placeDestinationMarker?.(window.currentPassengerTrackDest, 'B - Destino');
            }
        };

        /** Viaje en curso: muestra origen + destino + conductor moviéndose. */
        window.applyPassengerLiveTripCamera = (driverPos, tripData = null, force = false) => {
            if (!window.gMap || !driverPos || window.passengerTrackFollow === false) return;
            const trip = tripData || window.currentActiveTripData || null;
            const now = Date.now();
            const moved = !window._passengerLiveCamPos
                || Math.hypot(driverPos.lat - window._passengerLiveCamPos.lat, driverPos.lng - window._passengerLiveCamPos.lng) > 0.00006;
            if (!force && !moved && window._passengerCameraLastUpdate && now - window._passengerCameraLastUpdate < 1800) {
                try { window.gMap.panTo(driverPos); } catch (_) {}
                return;
            }
            window._passengerLiveCamPos = driverPos;
            window._passengerCameraLastUpdate = now;

            const bounds = new google.maps.LatLngBounds();
            bounds.extend(driverPos);
            let originLat = trip?.originLat;
            let originLng = trip?.originLng;
            if ((originLat == null || originLng == null || trip?.originSource === 'driver_fallback') && driverPos?.lat != null) {
                originLat = driverPos.lat;
                originLng = driverPos.lng;
            }
            if (originLat != null && originLng != null) {
                bounds.extend({ lat: originLat, lng: originLng });
            }
            const legTarget = window.getTripCurrentLegNavTarget?.(trip);
            if (legTarget?.lat != null && legTarget?.lng != null) {
                bounds.extend({ lat: legTarget.lat, lng: legTarget.lng });
            } else if (trip?.destinationLat != null && trip?.destinationLng != null) {
                bounds.extend({ lat: trip.destinationLat, lng: trip.destinationLng });
            } else if (window.currentPassengerTrackDest?.lat != null) {
                bounds.extend(window.currentPassengerTrackDest);
            }
            const routePath = window.currentRouteFullPath || window.currentPassengerTrackRoute?.path;
            if (routePath?.length >= 2) {
                const step = Math.max(1, Math.floor(routePath.length / 6));
                for (let i = 0; i < routePath.length; i += step) bounds.extend(routePath[i]);
                bounds.extend(routePath[routePath.length - 1]);
            }

            const panelPeek = document.body.classList.contains('panel-minimized') ? 120 : 210;
            try {
                window.gMap.fitBounds(bounds, {
                    top: 96,
                    right: 40,
                    bottom: panelPeek,
                    left: 40
                });
                const z = window.gMap.getZoom();
                if (z != null && z > 16) window.gMap.setZoom(16);
            } catch (_) {
                try { window.gMap.panTo(driverPos); } catch (__) {}
            }
        };

        window.applyPassengerTrackCamera = (driverPos, destPos, routePath, force = false) => {
            if (!window.gMap || !driverPos || window.passengerTrackFollow === false) return;
            const now = Date.now();
            if (!force && window._passengerCameraLastUpdate && now - window._passengerCameraLastUpdate < 2200) {
                try { window.gMap.panTo(driverPos); } catch (_) {}
                return;
            }
            window._passengerCameraLastUpdate = now;

            const bounds = new google.maps.LatLngBounds();
            bounds.extend(driverPos);
            if (destPos?.lat != null && destPos?.lng != null) {
                bounds.extend(destPos);
            } else if (routePath?.length) {
                const step = Math.max(1, Math.floor(routePath.length / 8));
                for (let i = 0; i < routePath.length; i += step) bounds.extend(routePath[i]);
                bounds.extend(routePath[routePath.length - 1]);
            }

            const panelPeek = document.body.classList.contains('panel-minimized') ? 110 : 200;
            try {
                window.gMap.fitBounds(bounds, {
                    top: 88,
                    right: 36,
                    bottom: panelPeek,
                    left: 36
                });
                const z = window.gMap.getZoom();
                if (z != null && z > 17) window.gMap.setZoom(17);
            } catch (_) {
                try { window.gMap.panTo(driverPos); } catch (__) {}
            }
        };

        window.syncPassengerTrackEta = (route, tripData, phase) => {
            if (!route) return;
            const mins = Math.max(1, Math.round((route.durationMillis || 0) / 60000));
            const km = window.getRouteDistanceKm(route).toFixed(1);
            const duration = window.formatRouteDuration(route);
            const etaTime = window.formatRouteEta(route);
            const firstName = (tripData?.driverName || 'Tu conductor').split(' ')[0];

            const etaText = document.getElementById('eta-text');
            const etaSub = document.getElementById('eta-indicator-sub');
            const miniTime = document.getElementById('trip-mini-time');
            const miniDist = document.getElementById('trip-mini-dist');
            const miniEta = document.getElementById('trip-mini-eta');
            const statusEta = document.getElementById('tp-status-eta');

            const statusBadge = document.getElementById('tp-status-badge');
            const statusSub = document.getElementById('tp-status-sub');

            if (phase === 'destination') {
                if (etaText) etaText.innerText = `${firstName} · ~${mins} min al destino`;
                if (etaSub) {
                    etaSub.classList.remove('hidden');
                    etaSub.innerText = `${km} km restantes · llegada ${etaTime}`;
                }
                if (statusBadge) statusBadge.textContent = 'Viaje en curso';
                if (statusSub) statusSub.textContent = `${km} km · llegada ${etaTime}`;
            } else {
                if (etaText) etaText.innerText = `${firstName} llega en ~${mins} min`;
                if (etaSub) {
                    etaSub.classList.remove('hidden');
                    etaSub.innerText = `${km} km · ${duration}`;
                }
                if (statusBadge) {
                    statusBadge.textContent = tripData?.driverArrived
                        ? '¡Ha llegado!'
                        : (tripData?.driverFinishingOtherTrip ? '¡Reservado!' : '¡Va en camino!');
                }
                if (statusSub) {
                    statusSub.textContent = tripData?.driverArrived
                        ? 'Muéstrale tu PIN'
                        : `${km} km · ${duration}`;
                }
            }

            if (miniTime) miniTime.innerText = `~${mins} min`;
            if (miniDist) miniDist.innerText = `${km} km`;
            if (miniEta) miniEta.innerText = etaTime;
            if (statusEta) {
                if (tripData?.status === 'accepted' && !tripData?.driverArrived) {
                    statusEta.classList.remove('hidden');
                    statusEta.textContent = `~${mins} min`;
                } else if (phase === 'destination' && tripData?.status === 'in_progress') {
                    statusEta.classList.remove('hidden');
                    statusEta.textContent = `~${mins} min`;
                } else if (tripData?.driverArrived) {
                    statusEta.classList.add('hidden');
                }
            }
            // Flotante unificado del pasajero
            const fBadge = document.getElementById('client-trip-status-badge');
            const fSub = document.getElementById('client-trip-status-sub');
            const fEta = document.getElementById('client-trip-status-eta');
            const fMinEta = document.getElementById('client-trip-min-eta');
            const fMinMeta = document.getElementById('client-trip-min-meta');
            if (fBadge && statusBadge) fBadge.textContent = statusBadge.textContent;
            if (fSub && statusSub) fSub.textContent = statusSub.textContent;
            if (fMinMeta && statusBadge) fMinMeta.textContent = statusBadge.textContent;
            if (fEta) {
                if (tripData?.driverArrived) fEta.classList.add('hidden');
                else {
                    fEta.textContent = `~${mins} min`;
                    fEta.classList.remove('hidden');
                }
            }
            if (fMinEta) {
                if (tripData?.driverArrived) fMinEta.classList.add('hidden');
                else {
                    fMinEta.textContent = `~${mins}`;
                    fMinEta.classList.remove('hidden');
                }
            }

            window.syncTripMiniBar?.(route);
            window.syncPassengerNavHud?.(
                tripData,
                route,
                phase,
                window.passengerTrackVehicleType || tripData?.vehicleType || tripData?.serviceType || 'auto'
            );
            window.updatePassengerProximityAlerts?.(route, tripData, phase);
        };

        window.drawRouteOnMap = (route, options = {}) => {
            if (!route || !window.gMap) return;

            const driverNav = options.driverNav || window.isDriverNavigating?.();
            const passengerTrack = options.passengerTrack || window.isPassengerTracking?.();
            const driverOfferPreview = options.driverOfferPreview
                || (!driverNav && !passengerTrack && route.previewOnly);

            // Antes se rechazaba estimated en nav/preview → mapa vacío si fallaba Routes API.
            // Ahora dibujamos igual (línea estimada o por calles).
            if (!route.path?.length && route.estimated) return;

            window.clearStopMarkers?.();

            const path = window.getRouteDisplayPath(route, { driverNav, passengerTrack });
            if (path.length >= 2) {
                window.currentRouteFullPath = path;
            }

            const progressPos = driverNav
                ? (window.currentDriverPos || path[0] || null)
                : (passengerTrack ? (window.currentDriverTrackPos || path[0] || null) : null);
            const useProgressRoute = (driverNav || passengerTrack) && progressPos && path.length >= 2;

            if (useProgressRoute) {
                window.drawProgressRouteOnMap(route, progressPos, { driverNav, passengerTrack });
            } else {
                window.clearRoutePolylines();
                // Oferta conductor: tramos de color (🚗 ámbar ti→cliente + 📍 verde ruta del cliente)
                const previewLegs = Array.isArray(route.previewLegs)
                    ? route.previewLegs.filter((leg) => Array.isArray(leg?.path) && leg.path.length >= 2)
                    : [];
                if (driverOfferPreview && previewLegs.length > 0) {
                    const polylines = previewLegs.map((leg) => new google.maps.Polyline({
                        path: leg.path,
                        geodesic: true,
                        strokeColor: leg.color || (leg.role === 'toPickup' ? '#f59e0b' : '#059669'),
                        strokeOpacity: leg.role === 'toPickup' ? 0.95 : 0.9,
                        strokeWeight: leg.role === 'toPickup' ? 8 : 7,
                        map: window.gMap,
                        zIndex: leg.role === 'toPickup' ? 4 : 3
                    }));
                    window.currentRoutePolyline = polylines;
                } else if (typeof route.createPolylines === 'function') {
                    const polylines = route.createPolylines();
                    polylines.forEach(p => p.setMap(window.gMap));
                    window.currentRoutePolyline = polylines;
                } else if (path.length) {
                    window.currentRoutePolyline = new google.maps.Polyline({
                        path,
                        geodesic: true,
                        strokeColor: driverNav ? '#1a73e8' : (driverOfferPreview ? '#059669' : '#2563eb'),
                        strokeOpacity: driverOfferPreview ? 0.88 : 0.95,
                        strokeWeight: driverNav ? 10 : (driverOfferPreview ? 7 : 8),
                        map: window.gMap
                    });
                }
            }

            const fitPath = path;
            // Preview de oferta O viaje activo con fitRoute: encuadrar ruta completa
            const shouldFitRoute = fitPath?.length
                && (
                    (!driverNav && !passengerTrack)
                    || options.fitRoute === true
                    || (driverNav && options.fitFullRoute === true)
                );
            if (shouldFitRoute) {
                if (driverOfferPreview && typeof window.refitDriverOfferPreviewRoute === 'function') {
                    // Zoom + padding según tarjeta (salta si el user ya zoomeó a mano)
                    window.refitDriverOfferPreviewRoute(route);
                    // Segunda pasada cuando el panel ya midió su alto real
                    clearTimeout(window._driverOfferRefitTimer);
                    window._driverOfferRefitTimer = setTimeout(() => {
                        try {
                            if (window._driverOfferPreviewUserCamera) return;
                            if (window.shouldPreserveDriverOfferPreview?.()
                                || document.body.classList.contains('driver-offer-preview-active')) {
                                window.refitDriverOfferPreviewRoute?.(
                                    window._driverOfferPreviewRoute || route
                                );
                            }
                        } catch (_) {}
                    }, 320);
                } else {
                    const bounds = new google.maps.LatLngBounds();
                    fitPath.forEach((p) => bounds.extend(p));
                    if (driverNav && window.currentDriverPos?.lat != null) {
                        bounds.extend(window.currentDriverPos);
                    }
                    const padding = driverNav
                        ? (window.getDriverNavMapPadding?.() || { top: 72, right: 36, bottom: 200, left: 36 })
                        : undefined;
                    try {
                        window.gMap.fitBounds(bounds, padding || undefined);
                    } catch (_) {}
                }
            }

            if (passengerTrack && window.currentDriverTrackPos) {
                if (document.body.classList.contains('passenger-nav-mode')) {
                    window.applyPassengerNavCamera?.(
                        window.currentDriverTrackPos,
                        window._passengerTrackHeading || 0,
                        true
                    );
                } else {
                    const dest = window.currentPassengerTrackDest;
                    window.applyPassengerTrackCamera?.(
                        window.currentDriverTrackPos,
                        dest,
                        fitPath,
                        true
                    );
                }
            }

            // Colocar iconos A/B en inicio y fin de la ruta como respaldo
            if (fitPath?.length >= 2 && !driverNav && !passengerTrack) {
                const start = driverOfferPreview && route.origin
                    ? route.origin
                    : fitPath[0];
                const end = driverOfferPreview && route.destination
                    ? route.destination
                    : fitPath[fitPath.length - 1];

                setTimeout(() => {
                    if (driverOfferPreview) window.clearOriginDestinationMarkers?.();
                    if (!window.originMarker && start) {
                        window.placePickupMarker?.(start, 'A - Recogida');
                    }
                    if (!window.targetMarker && end) {
                        window.placeDestinationMarker?.(end, 'B - Destino');
                    }
                }, 80);
            }

            // Legacy / si la ruta trae su propia función de marcadores
            if (typeof route.createWaypointAdvancedMarkers === 'function') {
                route.createWaypointAdvancedMarkers().then(markers => {
                    markers.forEach((m, i) => {
                        m.map = window.gMap;
                        if (i === 0) window.originMarker = m;
                        if (i === markers.length - 1) window.targetMarker = m;
                    });
                }).catch(() => {});
            }
        };

        window.ensureDriverPosition = () => new Promise((resolve) => {
            // En modo conductor preferir GPS del conductor, no el track del pasajero
            const isDriver = document.body.classList.contains('driver-mode')
                || window.userProfile?.role === 'driver';
            if (isDriver && window.currentDriverPos?.lat != null) {
                return resolve(window.currentDriverPos);
            }
            if (window.currentDriverPos?.lat != null) return resolve(window.currentDriverPos);
            if (!isDriver && window.currentDriverTrackPos?.lat != null) {
                return resolve(window.currentDriverTrackPos);
            }
            if (!navigator.geolocation) return resolve(null);
            const lowPower = typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode();
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    window.currentDriverPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    resolve(window.currentDriverPos);
                },
                () => resolve(window.currentDriverPos || null),
                {
                    enableHighAccuracy: !lowPower,
                    timeout: lowPower ? 6000 : 8000,
                    maximumAge: lowPower ? 20000 : 8000
                }
            );
        });

        // ================================================
        // ICONOS PERSONALIZADOS PARA ORIGEN Y DESTINO EN EL MAPA
        // ================================================

        window.clearOriginDestinationMarkers = () => {
            try {
                if (window.originMarker) {
                    if (window.originMarker.map !== undefined) {
                        window.originMarker.map = null;
                    } else if (typeof window.originMarker.setMap === 'function') {
                        window.originMarker.setMap(null);
                    }
                    window.originMarker = null;
                }
                if (window.targetMarker) {
                    if (window.targetMarker.map !== undefined) {
                        window.targetMarker.map = null;
                    } else if (typeof window.targetMarker.setMap === 'function') {
                        window.targetMarker.setMap(null);
                    }
                    window.targetMarker = null;
                }
                window._originMarkerKey = null;
                window._targetMarkerKey = null;
                window.clearStopMarkers?.();
            } catch (e) {}
        };

        /**
         * Pin del cliente (recogida): persona saludando con bandera de Honduras.
         * SVG reutilizable para AdvancedMarker (HTML) y Marker clásico (data URL).
         */
        window.getHondurasClientPinSvg = (opts = {}) => {
            const w = opts.width || 52;
            const h = opts.height || 64;
            // Colores oficiales aproximados de la bandera de Honduras
            const blue = '#0073CF';
            const white = '#FFFFFF';
            const skin = '#F0C7A0';
            const hair = '#3F2A1D';
            const stroke = '#0F172A';
            // Estrella de 5 puntas (bandera HN) — centro + 4 en X
            const star = (cx, cy, r = 2.1) => {
                // path simple de estrella
                const pts = [];
                for (let i = 0; i < 5; i++) {
                    const a = (-Math.PI / 2) + (i * 2 * Math.PI) / 5;
                    const b = a + Math.PI / 5;
                    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
                    pts.push([cx + r * 0.42 * Math.cos(b), cy + r * 0.42 * Math.sin(b)]);
                }
                return `<polygon points="${pts.map((p) => p.map((n) => n.toFixed(2)).join(',')).join(' ')}" fill="${blue}"/>`;
            };
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 52 64" role="img" aria-label="Cliente — bandera de Honduras">
  <defs>
    <filter id="hnPinShadow" x="-40%" y="-20%" width="180%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <!-- Sombra en el suelo -->
  <ellipse cx="26" cy="60.5" rx="11" ry="2.6" fill="#000" opacity="0.18"/>
  <!-- Cuerpo con bandera de Honduras (camisa = bandera) -->
  <g filter="url(#hnPinShadow)">
    <!-- Piernas -->
    <path d="M20 44 L18.5 58.5 L23 58.5 L24.5 46 Z" fill="#1e3a5f" stroke="${stroke}" stroke-width="0.6"/>
    <path d="M28.5 46 L30 58.5 L34.5 58.5 L32.5 44 Z" fill="#1e3a5f" stroke="${stroke}" stroke-width="0.6"/>
    <!-- Torso: bandera HN (azul-blanco-azul + estrellas) -->
    <rect x="17" y="24" width="18" height="21" rx="4.5" fill="${blue}" stroke="${stroke}" stroke-width="0.75"/>
    <rect x="17.5" y="30.2" width="17" height="8.2" fill="${white}"/>
    ${star(26, 34.3, 1.85)}
    ${star(21.6, 32.6, 1.35)}
    ${star(30.4, 32.6, 1.35)}
    ${star(21.6, 36.0, 1.35)}
    ${star(30.4, 36.0, 1.35)}
    <!-- Brazo izquierdo (bajado) -->
    <path d="M17.5 28 Q12 32 11 40" fill="none" stroke="${skin}" stroke-width="3.2" stroke-linecap="round"/>
    <!-- Brazo derecho saludando (arriba) -->
    <path d="M34.5 27 Q40 18 43 11" fill="none" stroke="${skin}" stroke-width="3.2" stroke-linecap="round"/>
    <!-- Mano saludando -->
    <circle cx="43.5" cy="9.5" r="2.6" fill="${skin}" stroke="${stroke}" stroke-width="0.45"/>
    <!-- Banderita HN en la mano que saluda -->
    <g transform="translate(38,2) rotate(-18)">
      <rect x="0" y="0" width="1.6" height="16" rx="0.6" fill="#64748b"/>
      <rect x="1.6" y="0.4" width="12.5" height="8.2" rx="0.6" fill="${blue}" stroke="${stroke}" stroke-width="0.35"/>
      <rect x="1.8" y="2.9" width="12.1" height="3.1" fill="${white}"/>
      <!-- mini estrellas -->
      <circle cx="8" cy="4.45" r="0.55" fill="${blue}"/>
      <circle cx="6.2" cy="3.7" r="0.4" fill="${blue}"/>
      <circle cx="9.8" cy="3.7" r="0.4" fill="${blue}"/>
      <circle cx="6.2" cy="5.2" r="0.4" fill="${blue}"/>
      <circle cx="9.8" cy="5.2" r="0.4" fill="${blue}"/>
    </g>
    <!-- Cuello + cabeza -->
    <rect x="23.5" y="19.5" width="5" height="5.2" rx="1.5" fill="${skin}"/>
    <circle cx="26" cy="14.2" r="7.1" fill="${skin}" stroke="${stroke}" stroke-width="0.7"/>
    <!-- Cabello -->
    <path d="M19.5 13.5 Q20 7.5 26 7 Q32 7.5 32.5 13.5 Q30 10.5 26 10.2 Q22 10.5 19.5 13.5 Z" fill="${hair}"/>
    <!-- Cara sonriente / saludo -->
    <circle cx="23.6" cy="14" r="0.85" fill="${stroke}"/>
    <circle cx="28.4" cy="14" r="0.85" fill="${stroke}"/>
    <path d="M23.4 17.1 Q26 19.2 28.6 17.1" fill="none" stroke="${stroke}" stroke-width="0.85" stroke-linecap="round"/>
    <!-- Mejillas -->
    <circle cx="21.8" cy="15.8" r="1.1" fill="#F4A89A" opacity="0.55"/>
    <circle cx="30.2" cy="15.8" r="1.1" fill="#F4A89A" opacity="0.55"/>
  </g>
  <!-- Badge A (recogida) -->
  <circle cx="10" cy="10" r="7.2" fill="#059669" stroke="#fff" stroke-width="1.6"/>
  <text x="10" y="13.2" text-anchor="middle" font-size="9" font-weight="800" font-family="system-ui,Segoe UI,sans-serif" fill="#fff">A</text>
</svg>`;
        };

        window.buildClientPickupMarkerContent = () => {
            const wrap = document.createElement('div');
            wrap.className = 'hn-client-pin';
            wrap.setAttribute('aria-label', 'Cliente — punto de recogida');
            wrap.style.width = '52px';
            wrap.style.height = '64px';
            wrap.style.display = 'block';
            wrap.style.pointerEvents = 'none';
            wrap.style.transform = 'translateY(-2px)';
            wrap.style.filter = 'drop-shadow(0 2px 5px rgba(0,0,0,0.28))';
            wrap.innerHTML = window.getHondurasClientPinSvg();
            return wrap;
        };

        window.getClientPickupMarkerIconUrl = () => {
            const svg = window.getHondurasClientPinSvg({ width: 52, height: 64 });
            return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
        };

        /**
         * Pin de origen/recogida.
         * options.style: 'client' = emoji catracho (ida al pasajero);
         *                'simple' = A verde (tras PIN, ruta A→B sin emoji de cliente).
         */
        window.placePickupMarker = (latLng, title = 'Origen (Punto de encuentro)', options = {}) => {
            if (!window.mapLoaded || !latLng || !window.gMap) return;

            try {
                // Normalizar coordenadas
                const pos = (latLng.lat != null && latLng.lng != null)
                    ? { lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
                        lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng }
                    : latLng;

                // Evitar destruir/recrear el pin en cada tick GPS (parpadeo en pasajero)
                const styleKey = options.style || 'auto';
                const posKey = `${Number(pos.lat).toFixed(5)},${Number(pos.lng).toFixed(5)}|${styleKey}|${title || ''}`;
                if (window.originMarker && window._originMarkerKey === posKey) {
                    return;
                }
                window._originMarkerKey = posKey;

                // Limpiar marcador anterior
                if (window.originMarker) {
                    if (window.originMarker.map !== undefined) window.originMarker.map = null;
                    else if (typeof window.originMarker.setMap === 'function') window.originMarker.setMap(null);
                    window.originMarker = null;
                }

                // Tras PIN / en curso: pin simple A (sin emoji de persona)
                const tripStatus = window.currentActiveTripData?.status
                    || window.activeTrip?.status
                    || null;
                const destPhase = options.style === 'simple'
                    || document.body.classList.contains('driver-trip-dest-phase')
                    || tripStatus === 'in_progress';
                // Nunca emoji de cliente en viaje en curso, aunque llamen sin options
                const useClientEmoji = !destPhase
                    && (options.style === 'client' || options.style !== 'simple');

                const hasAdvanced = window.canUseAdvancedMapMarkers?.() ?? false;
                const placeSimpleAMarker = () => {
                    if (hasAdvanced && google.maps?.marker?.PinElement) {
                        const pin = new google.maps.marker.PinElement({
                            background: '#059669',
                            borderColor: '#ffffff',
                            glyphColor: '#ffffff',
                            glyphText: 'A',
                            scale: 1.15
                        });
                        window.originMarker = new google.maps.marker.AdvancedMarkerElement({
                            position: pos,
                            map: window.gMap,
                            content: pin.element || pin,
                            title: title || 'A - Origen',
                            gmpClickable: false
                        });
                        return;
                    }
                    if (google.maps?.Marker) {
                        window.originMarker = new google.maps.Marker({
                            position: pos,
                            map: window.gMap,
                            title: title || 'A - Origen',
                            label: { text: 'A', color: '#ffffff', fontWeight: 'bold', fontSize: '14px' },
                            icon: {
                                path: google.maps.SymbolPath.CIRCLE,
                                scale: 11,
                                fillColor: '#059669',
                                fillOpacity: 1,
                                strokeColor: '#ffffff',
                                strokeWeight: 3
                            },
                            zIndex: 50
                        });
                    }
                };

                if (hasAdvanced) {
                    if (useClientEmoji) {
                        const content = window.buildClientPickupMarkerContent();
                        window.originMarker = new google.maps.marker.AdvancedMarkerElement({
                            position: pos,
                            map: window.gMap,
                            content,
                            title: title || 'Cliente (recogida)',
                            gmpClickable: false
                        });
                    } else {
                        placeSimpleAMarker();
                    }
                } else if (useClientEmoji) {
                    // Fall back to classic Marker con el emoji del cliente
                    const iconUrl = window.getClientPickupMarkerIconUrl();
                    window.originMarker = new google.maps.Marker({
                        position: pos,
                        map: window.gMap,
                        title: title || 'Cliente (recogida)',
                        icon: {
                            url: iconUrl,
                            scaledSize: new google.maps.Size(52, 64),
                            anchor: new google.maps.Point(26, 60)
                        },
                        optimized: false,
                        zIndex: 50
                    });
                } else {
                    placeSimpleAMarker();
                }
            } catch (e) {
                console.warn('Error placing pickup marker (usando fallback):', e);
                // Último fallback: pin verde A
                try {
                    if (window.canUseAdvancedMapMarkers?.() && google.maps?.marker?.PinElement) {
                        const pin = new google.maps.marker.PinElement({
                            background: '#10b981',
                            borderColor: '#ffffff',
                            glyphColor: '#ffffff',
                            glyphText: 'A',
                            scale: 1.15
                        });
                        window.originMarker = new google.maps.marker.AdvancedMarkerElement({
                            position: latLng,
                            map: window.gMap,
                            content: pin,
                            title
                        });
                    } else if (google.maps?.Marker) {
                        window.originMarker = new google.maps.Marker({
                            position: latLng,
                            map: window.gMap,
                            title,
                            label: { text: 'A', color: '#ffffff', fontWeight: 'bold', fontSize: '14px' },
                            icon: {
                                path: google.maps.SymbolPath.CIRCLE,
                                scale: 10,
                                fillColor: '#10b981',
                                fillOpacity: 1,
                                strokeColor: '#ffffff',
                                strokeWeight: 3
                            }
                        });
                    }
                } catch (_) {}
            }
        };

        window.placeDestinationMarker = (latLng, title = 'Destino') => {
            if (!window.mapLoaded || !latLng || !window.gMap) return;

            try {
                const pos = (latLng.lat != null && latLng.lng != null)
                    ? { lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
                        lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng }
                    : latLng;

                // Evitar parpadeo: no recrear si es el mismo punto
                const posKey = `${Number(pos.lat).toFixed(5)},${Number(pos.lng).toFixed(5)}|${title || ''}`;
                if (window.targetMarker && window._targetMarkerKey === posKey) {
                    return;
                }
                window._targetMarkerKey = posKey;

                if (window.targetMarker) {
                    if (window.targetMarker.map !== undefined) window.targetMarker.map = null;
                    else if (typeof window.targetMarker.setMap === 'function') window.targetMarker.setMap(null);
                    window.targetMarker = null;
                }

                const hasAdvanced = window.canUseAdvancedMapMarkers?.() ?? false;
                if (hasAdvanced) {
                    const pin = new google.maps.marker.PinElement({
                        background: '#dc2626',
                        borderColor: '#ffffff',
                        glyphColor: '#ffffff',
                        glyphText: 'B',
                        scale: 1.15
                    });
                    window.targetMarker = new google.maps.marker.AdvancedMarkerElement({
                        position: pos,
                        map: window.gMap,
                        content: pin,
                        title: title
                    });
                } else {
                    // Fall back to classic Marker (will show deprecation, but avoids "no valid map ID" for Advanced)
                    window.targetMarker = new google.maps.Marker({
                        position: pos,
                        map: window.gMap,
                        title: title,
                        label: { text: 'B', color: '#ffffff', fontWeight: 'bold', fontSize: '14px' },
                        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#dc2626', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 }
                    });
                }
            } catch (e) {
                console.warn('Error placing destination marker (usando fallback):', e);
                try {
                    // Last resort fallback
                    window.targetMarker = new google.maps.Marker({ position: latLng, map: window.gMap, title });
                } catch (_) {}
            }
        };

        // Marcador numerado para paradas intermedias en rutas con múltiples paradas (hourly multi)
        window.placeStopMarker = (latLng, number, title = 'Parada') => {
            if (!window.mapLoaded || !latLng || !window.gMap) return null;

            try {
                const pos = (latLng.lat != null && latLng.lng != null)
                    ? { lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
                        lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng }
                    : latLng;

                const hasAdvanced = window.canUseAdvancedMapMarkers?.() ?? false;
                if (hasAdvanced) {
                    const pin = new google.maps.marker.PinElement({
                        background: '#3b82f6',
                        borderColor: '#ffffff',
                        glyphColor: '#ffffff',
                        glyphText: String(number),
                        scale: 1.0
                    });
                    const marker = new google.maps.marker.AdvancedMarkerElement({
                        position: pos,
                        map: window.gMap,
                        content: pin,
                        title: title
                    });
                    return marker;
                } else {
                    // Fallback to classic for no mapId
                    const marker = new google.maps.Marker({
                        position: pos,
                        map: window.gMap,
                        title: title,
                        label: {
                            text: String(number),
                            color: '#ffffff',
                            fontWeight: 'bold',
                            fontSize: '12px'
                        },
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: '#3b82f6',
                            fillOpacity: 1,
                            strokeColor: '#ffffff',
                            strokeWeight: 2
                        }
                    });
                    return marker;
                }
            } catch (e) {
                console.warn('Error placing stop marker:', e);
                return null;
            }
        };

        // Coloca ambos marcadores a la vez (útil después de calcular ruta)
        window.placeRouteMarkers = (originLatLng, destLatLng) => {
            window.clearOriginDestinationMarkers();
            if (originLatLng) window.placePickupMarker(originLatLng, 'A - Origen');
            if (destLatLng) window.placeDestinationMarker(destLatLng, 'B - Destino');
        };

        window.clearStopMarkers = () => {
            if (!window.stopMarkers) return;
            window.stopMarkers.forEach(m => {
                if (m && m.map !== undefined) m.map = null;
                else if (m && typeof m.setMap === 'function') m.setMap(null);
            });
            window.stopMarkers = [];
        };

        // Llamar al limpiar rutas (respeta viaje activo del conductor salvo force:true)
        const origClearPolylines = window.clearRoutePolylines;
        window.clearRoutePolylines = (options) => {
            if (origClearPolylines) origClearPolylines(options);
            if (!options?.force && window.shouldPreserveDriverOfferPreview?.()) return;
            if (!options?.force && window.shouldPreserveDriverNavRoute?.()) return;
            window.clearStopMarkers?.();
        };

        // =====================================================
        // PRUEBA RÁPIDA: simular movimiento de conductor en modo navegación (como Google Maps)
        // Llama desde consola: window.testDriverNavMovement()
        // Muestra si el avance del conductor + cámara + ruta progress se comporta igual.
        // =====================================================
        window.testDriverNavMovement = async (seconds = 25) => {
            if (!window.gMap || !window.mapLoaded) {
                return console.warn('Mapa no listo. Abre la app primero.');
            }
            console.log('%c[TEST] Iniciando prueba de movimiento conductor modo navegación (simula Google Maps nav)', 'color:#0ea5e9');

            // Setup temporal nav state (no afecta viajes reales)
            const prevBodyClasses = document.body.className;
            document.body.classList.add('is-navigating', 'driver-nav-mode');
            window.driverNavMode = true;

            // Limpiar estado previo de prueba
            window.stopRouteProgressAnimation?.();
            window.clearRoutePolylines?.();

            // Usar centro actual o default
            let center = window.gMap.getCenter ? { lat: window.gMap.getCenter().lat(), lng: window.gMap.getCenter().lng() } : { lat: 14.4513, lng: -87.6374 };
            let dest = { lat: center.lat + 0.012, lng: center.lng - 0.009 };

            // Intentar ruta real (igual que GMaps)
            let routePath = null;
            try {
                const r = await window.computeDrivingRoute?.(center, dest);
                if (r && r.path && r.path.length >= 2) routePath = r.path;
            } catch(_) {}
            if (!routePath) {
                // Fallback lineal corto
                routePath = [];
                for (let i = 0; i <= 18; i++) {
                    const t = i / 18;
                    routePath.push({ lat: center.lat + (dest.lat - center.lat) * t, lng: center.lng + (dest.lng - center.lng) * t });
                }
            }

            window.currentNavRoute = { path: routePath };
            window.currentRouteFullPath = routePath;

            // Colocar marcador inicial del "conductor"
            const driverId = 'test-driver-nav';
            window.removeDriverMarker?.(driverId);
            window.updateDriverMarker?.(driverId, routePath[0].lat, routePath[0].lng, true, {
                heading: 0,
                vehicleType: 'auto',
                forceReposition: true
            });

            // Iniciar progreso + cámara estilo driver nav
            let idx = 0;
            const totalSteps = Math.max(12, Math.min(30, Math.floor(seconds * 1.2)));
            const stepMs = Math.round((seconds * 1000) / totalSteps);

            window.testDriverNavTimer && clearInterval(window.testDriverNavTimer);

            console.log(`[TEST] Ruta con ${routePath.length} puntos. Moviendo conductor a lo largo de la ruta...`);

            window.testDriverNavTimer = setInterval(() => {
                if (idx >= routePath.length - 1) {
                    clearInterval(window.testDriverNavTimer);
                    window.testDriverNavTimer = null;
                    // restore
                    setTimeout(() => {
                        document.body.className = prevBodyClasses;
                        window.driverNavMode = false;
                        window.removeDriverMarker?.(driverId);
                        window.clearRoutePolylines?.();
                        console.log('%c[TEST] Prueba completada. La ruta se comió completamente (passed).', 'color:#22c55e');
                        window.showToast?.('Prueba de navegación conductor finalizada.');
                    }, 1200);
                    return;
                }

                const pos = routePath[idx];
                const next = routePath[Math.min(idx + 1, routePath.length - 1)];
                const hdg = (typeof window.bearingBetweenPoints === 'function')
                    ? window.bearingBetweenPoints(pos, next)
                    : 0;

                // Actualizar marcador (en nav usa chevron, cámara rota)
                window.updateDriverMarker?.(driverId, pos.lat, pos.lng, true, {
                    heading: hdg,
                    vehicleType: 'auto',
                    forceReposition: true
                });
                window.currentDriverPos = pos;
                window.currentDriverHeading = hdg;

                // Avanzar el polyline progress (passed/remaining) + cámara
                try {
                    window.updateRouteProgress?.(pos, { driverNav: true, force: true });
                    window.applyDriverNavCamera?.(pos, hdg, idx === 0);
                } catch (e) { console.warn(e); }

                idx = Math.min(idx + 1, routePath.length - 1);
            }, stepMs);

            // Auto cleanup safety
            setTimeout(() => {
                if (window.testDriverNavTimer) {
                    clearInterval(window.testDriverNavTimer);
                    window.testDriverNavTimer = null;
                    document.body.className = prevBodyClasses;
                    window.driverNavMode = false;
                    window.removeDriverMarker?.(driverId);
                    window.clearRoutePolylines?.();
                    console.log('%c[TEST] Prueba auto-limpieza (timeout).', 'color:#f59e0b');
                }
            }, (seconds + 8) * 1000);

            window.showToast?.('Prueba iniciada: la ruta azul se va "comiendo" (remaining) mientras el conductor avanza.');
        };

        console.log('%c[init] testDriverNavMovement() disponible. Prueba el efecto "ruta comiéndose" + movimientos en viaje.', 'color:#64748b');
