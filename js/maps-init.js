window.gMap = null;
        window.directionsRenderer = null;
        window.geocoder = null;
        window.trafficLayer = null;        
        window.mapLoaded = false;
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
            return el._routeEndpoint?.address?.trim()
                || el._selectedPlace?.formattedAddress?.trim()
                || el._selectedPlace?.displayName?.trim()
                || '';
        };

        window.geocodeAddressString = (address) => new Promise((resolve) => {
            const text = String(address || '').trim();
            if (!text || !window.geocoder) return resolve(null);

            const tryGeocode = (query) => new Promise((res) => {
                window.geocoder.geocode({ address: query, region: 'HN' }, (results, status) => {
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
                // First try as-is
                let result = await tryGeocode(text);
                if (result?.latLng) return resolve(result);

                // Try with context for better results in the service area (Comayagua)
                if (!text.toLowerCase().includes('honduras') && !text.toLowerCase().includes('comayagua')) {
                    result = await tryGeocode(text + ', Comayagua, Honduras');
                    if (result?.latLng) return resolve(result);
                }

                // Fallback: return address without coords (will be rejected later)
                resolve({ address: text, latLng: null });
            })();
        });

  window.canUseAdvancedMapMarkers = () =>
    // Only use AdvancedMarkerElement when a real mapId is configured.
    // This enables nice vehicle icons and better performance in the fleet map.
    !!(google.maps?.marker?.AdvancedMarkerElement && window.gMap?.getMapId?.());

  window.initMap = function() {
    try {
        if (typeof google === 'undefined' || !google.maps) {
            console.error("Google Maps aún no está listo");
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
        window._routeCacheTtlMs = 90000;

        // Prevent repeated noisy failures when Routes library / key doesn't support the new computeRoutes in this env
        window._routesApiTried = false;
        window._routesApiWorked = false;
        window.trafficLayer = new google.maps.TrafficLayer();

        const cfg = window.APP_CONFIG?.googleMaps || {};
        const comayaguaCoords = cfg.defaultCenter || { lat: 14.4513, lng: -87.6374 };

        const LOW = (typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode());
        const mapOptions = {
            center: comayaguaCoords,
            zoom: LOW ? 15 : 16,
            disableDefaultUI: true,
            mapTypeId: 'roadmap',
            gestureHandling: LOW ? 'cooperative' : 'greedy',
        };
        if (LOW) {
            // lighter for low-end / slow net
            try { window.trafficLayer = null; } catch(_) {}
        }

        // Set mapId if provided (required for Advanced Markers with custom icons)
        if (cfg.mapId) {
            mapOptions.mapId = cfg.mapId;
        }

        window.gMap = new google.maps.Map(document.getElementById("map"), mapOptions);
        document.body?.classList.add('map-ready');

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
                resolve({
                    address: (status === 'OK' && results?.[0]?.formatted_address)
                        ? results[0].formatted_address
                        : 'Ubicación seleccionada en el mapa',
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
            const allowedPickContexts = ['destination', 'extra-stop', 'hourly-stop', 'delivery-destination'];
            if (!allowedPickContexts.includes(pickContext)) {
                return window.showToast?.('Selección en mapa solo para destino, paradas o entregas.');
            }
            window.cancelMapPickMode?.({ silent: true });
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
            window.autoCenter = true;
            window.setMapFabVisible?.('fab-center', false);
        };

        window.showCenterMapFabIfNavigating = () => {
            if (!document.body.classList.contains('is-navigating')) return;
            window.autoCenter = false;
            window.setMapFabVisible?.('fab-center', true);
        };

        window.syncNavigationMapFabs = () => {
            if (document.body.classList.contains('trip-active')
                && document.body.classList.contains('driver-mode')) {
                window.setMapFabVisible?.('fab-center', false);
                window.setMapFabVisible?.('fab-traffic', false);
                return;
            }
            const navigating = document.body.classList.contains('is-navigating');
            const passengerNav = document.body.classList.contains('passenger-nav-mode');
            window.setMapFabVisible?.('fab-traffic', navigating && !passengerNav);
            if (!navigating || window.autoCenter !== false) {
                window.setMapFabVisible?.('fab-center', false);
            }
        };

        window.hideCenterMapFab?.();
        window.gMap.addListener('dragstart', () => {
            if (document.body.classList.contains('is-navigating')) {
                window.showCenterMapFabIfNavigating?.();
            }
            if (document.body.classList.contains('passenger-track-mode')) {
                window.passengerTrackFollow = false;
                window.setMapFabVisible?.('fab-center', true);
            }
        });

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
            const countries = cfg.countryRestriction || ['hn'];
            try {
                // API nueva (Place Autocomplete Element): includedRegionCodes
                originEl.includedRegionCodes = countries;
                destEl.includedRegionCodes = countries;
            } catch (_) {
                // Fallback silencioso si el navegador no soporta la propiedad
            }

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
                applyLocationBias(comayaguaCoords);
            } catch (_) {}

            window.updatePlacesLocationBias = (lat, lng) => {
                if (!originEl || !destEl || lat == null || lng == null) return;
                try {
                    applyLocationBias({ lat, lng });
                } catch (_) {}
            };

            const clearAutocompleteStack = (el) => {
                const wrap = el?.closest?.('.trip-origin-wrap, .trip-dest-wrap') || el?.parentElement;
                wrap?.classList.remove('is-autocomplete-active');
            };

            const onPlaceSelect = async (event, el) => {
                const snap = window.captureRouteFieldSnapshot?.(el);
                try {
                    let place = event.place || null;
                    if (!place && event.placePrediction) {
                        place = event.placePrediction.toPlace();
                    }
                    if (place?.fetchFields) {
                        await place.fetchFields({ fields: ['formattedAddress', 'displayName', 'location', 'id'] });
                        const endpoint = window.placeToRouteEndpoint?.(place, window.readAutocompleteText?.(el));
                        const nextAddr = endpoint?.address || window.readAutocompleteText?.(el) || '';
                        const ok = await window.guardRouteEndpointChange?.(el, nextAddr);
                        if (!ok) {
                            window.restoreRouteFieldSnapshot?.(el, snap);
                            clearAutocompleteStack(el);
                            return;
                        }
                        el._selectedPlace = place;
                        el.place = place;
                        window.storeRouteEndpoint?.(el, endpoint);
                    }
                } catch (_) {}
                clearAutocompleteStack(el);
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
                    if (el === originEl && window.updateOriginGPSButton) {
                        window.updateOriginGPSButton();
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

                // Fix: al cambiar la ruta (origen o destino), recalcular precios automáticamente
                // con debounce para no spamear mientras el usuario escribe
                clearTimeout(window._routeRecalcTimer);
                window._routeRecalcTimer = setTimeout(() => {
                    const oEl2 = document.getElementById('origin-autocomplete');
                    const dEl2 = document.getElementById('destination-autocomplete');
                    if (!oEl2 || !dEl2) return;
                    const hasO = !!(window.readAutocompleteText?.(oEl2) || oEl2._routeEndpoint?.address);
                    const hasD = !!(window.readAutocompleteText?.(dEl2) || dEl2._routeEndpoint?.address);
                    if (hasO && hasD) {
                        window.calculateTripRoute?.({ silent: true });
                    }
                }, 650);
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
                    });
                    input.addEventListener('blur', () => {
                        clearTimeout(blurTimer);
                        blurTimer = setTimeout(deactivate, 180);
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
                }, true);
                el.addEventListener('blur', () => {
                    clearTimeout(blurTimer);
                    blurTimer = setTimeout(deactivate, 180);
                }, true);
            };

            attachAutocompleteStackFix(originEl, '.trip-origin-wrap');
            attachAutocompleteStackFix(destEl, '.trip-dest-wrap');

            // === Visibility for GPS button: hide when origin has value, show when empty/cleared ===
            const gpsBtn = document.getElementById('btn-use-location');
            if (gpsBtn) {
                const updateGPSBtn = () => {
                    const text = window.readAutocompleteText?.(originEl) || '';
                    const hasValue = text.trim().length > 0;
                    gpsBtn.style.display = hasValue ? 'none' : '';

                    // Give space to the button when visible (empty origin), avoid overlap with input text
                    if (originEl) {
                        originEl.style.paddingRight = hasValue ? '' : '52px';
                    }
                };

                window.updateOriginGPSButton = updateGPSBtn; // expose for other code

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
                    // Also ensure padding if needed
                    const text = window.readAutocompleteText?.(originEl) || '';
                    if (originEl && text.trim().length === 0) {
                        originEl.style.paddingRight = '52px';
                    }
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
            const address = place.formattedAddress || place.displayName || fallbackText || '';
            const latLng = (!isNaN(nlat) && !isNaN(nlng)) ? { lat: nlat, lng: nlng } : null;
            return { address, latLng, place, source: 'place' };
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
  window._driverMarkerMeta = window._driverMarkerMeta || {};

  window.getCachedVehicleIconUrl = (vehicleType, bg) => {
      const key = `${vehicleType}:${bg}`;
      if (!window._vehicleIconCache[key]) {
          window._vehicleIconCache[key] = window.createVehicleIcon(vehicleType, bg);
      }
      return window._vehicleIconCache[key];
  };

  window.buildDriverMarkerContent = (vehicleType, bg, heading, inDriverNav) => {
      const markerContent = document.createElement('div');
      markerContent.style.width = inDriverNav ? '44px' : '42px';
      markerContent.style.height = inDriverNav ? '44px' : '42px';
      markerContent.style.display = 'flex';
      markerContent.style.alignItems = 'center';
      markerContent.style.justifyContent = 'center';
      if (!inDriverNav) {
          markerContent.style.transform = `rotate(${heading}deg)`;
          markerContent.style.transition = 'transform 0.25s linear';
      }
      markerContent.style.willChange = 'transform';
      const iconUrl = inDriverNav
          ? (window._navChevronIcon || (window._navChevronIcon = window.createNavChevronIcon()))
          : window.getCachedVehicleIconUrl(vehicleType, bg);
      markerContent.innerHTML = inDriverNav
          ? `<img src="${iconUrl}" style="width:44px;height:44px;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.45));" />`
          : `<img src="${iconUrl}" style="width:40px;height:32px;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));" />`;
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

    let title = isSelf ? 'Tú' : (driverName ? `Conductor: ${driverName}` : 'Conductor en línea');
    // Passengers see icons but should not easily know names without tapping (staff only get details + WhatsApp on tap)
    if (!isSelf && !window.canViewOpsFleetMap?.()) {
        title = 'Conductor en línea';
    }
    if (window.canViewOpsFleetMap?.() && options.phone) {
        title += ` • ${options.phone}`;
    }

    const styleKey = `${vehicleType}|${variant}|${inDriverNav ? 1 : 0}|${bg}`;
    const existing = window.driverMarkers[driverId];
    const meta = window._driverMarkerMeta[driverId];

    if (existing) {
        const nextPos = { lat: Number(lat), lng: Number(lng) };
        const forceMove = options.forceReposition || variant === 'assigned' || isSelf;
        const posChanged = !meta
            || meta.lastLat == null
            || Math.hypot(nextPos.lat - Number(meta.lastLat), nextPos.lng - Number(meta.lastLng)) > 0.000001;

        if (forceMove || posChanged) {
            const latLng = (typeof google !== 'undefined' && google.maps?.LatLng)
                ? new google.maps.LatLng(nextPos.lat, nextPos.lng)
                : nextPos;
            if (existing.position !== undefined) {
                existing.position = latLng;
            } else if (typeof existing.setPosition === 'function') {
                existing.setPosition(latLng);
            }
        }

        if (meta?.contentEl && meta.styleKey === styleKey) {
            if (!inDriverNav) {
                meta.contentEl.style.transform = `rotate(${heading}deg)`;
                meta.lastHeading = heading;
            }
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
                    if (!isSelf) window.showDriverFullDetails?.(driverId, driverName || title);
                });
            }
        } else {
            // Avoid deprecated Marker. Skip creation.
            console.warn('No AdvancedMarkerElement support for this driver marker; skipping to prevent deprecation.');
        }
    } else {
        const iconUrl = inDriverNav
            ? (window._navChevronIcon || (window._navChevronIcon = window.createNavChevronIcon()))
            : window.getCachedVehicleIconUrl(vehicleType, bg);
        
        const icon = {
            url: iconUrl,
            scaledSize: new google.maps.Size(inDriverNav ? 44 : 32, inDriverNav ? 44 : 32),
            anchor: new google.maps.Point(inDriverNav ? 22 : 16, inDriverNav ? 22 : 16)
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
                    if (!isSelf) window.showDriverFullDetails?.(driverId, driverName || title);
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
                if (name) name.textContent = data.clientName || 'Pasajero';
                if (rating) rating.textContent = data.clientRating || '5.0';
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

        window.showControlPanel = () => {
            const panel = document.getElementById('control-panel');
            const isMobile = window.innerWidth < 768;
            const hasTrip = document.body.classList.contains('trip-active');
            const isDriver = document.body.classList.contains('driver-mode');
            const userMinimized = !!panel?.classList.contains('panel-collapsed')
                || document.body.classList.contains('panel-minimized');

            if (isDriver) {
                // Nunca ocultar del todo, pero respetar si el usuario minimizó durante el viaje
                document.body.classList.remove('panel-hidden');
                panel?.classList.remove('panel-hidden');
                if (hasTrip && userMinimized) {
                    panel?.classList.add('panel-collapsed');
                    document.body.classList.add('panel-minimized');
                    window.syncPassengerPanelToggleLabel?.();
                    window.syncDriverRadarFloatPanel?.();
                    window.updatePassengerPromoStripVisibility?.();
                    return;
                }
                document.body.classList.remove('panel-minimized');
                panel?.classList.remove('panel-collapsed');
                try { localStorage.setItem(PANEL_HIDDEN_KEY, '0'); } catch (_) {}
                window.dockControlPanelForDriverTrip?.();
                window.syncDriverRadarFloatPanel?.();
                window.updatePassengerPromoStripVisibility?.();
                return;
            }

            if (isMobile && hasTrip) {
                // En viaje móvil: no forzar expandir; solo el botón minimiza/expande
                document.body.classList.remove('panel-hidden');
                panel?.classList.remove('panel-hidden');
                if (userMinimized) {
                    panel?.classList.add('panel-collapsed');
                    document.body.classList.add('panel-minimized');
                }
                window.syncPassengerPanelToggleLabel?.();
                window.updatePassengerPromoStripVisibility?.();
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
        };

        window.hideControlPanel = () => {
            if (document.body.classList.contains('is-searching')) {
                window.showToast?.('Durante la búsqueda no se puede ocultar.', 'warning');
                return;
            }
            const panel = document.getElementById('control-panel');
            const isMobile = window.innerWidth < 768;
            const hasTrip = document.body.classList.contains('trip-active');
            const isDriver = document.body.classList.contains('driver-mode');

            if (isDriver || (isMobile && hasTrip)) {
                // Conductor: solo minimizar/maximizar, nunca ocultar por completo.
                if (panel) {
                    panel.classList.toggle('panel-collapsed');
                }
                const collapsed = panel ? panel.classList.contains('panel-collapsed') : document.body.classList.contains('panel-minimized');
                document.body.classList.toggle('panel-minimized', collapsed);
                document.body.classList.remove('panel-hidden');
                panel?.classList.remove('panel-hidden');
                window.syncPassengerPanelToggleLabel?.();
                try { localStorage.setItem(PANEL_HIDDEN_KEY, collapsed ? '1' : '0'); } catch (_) {}
                window.syncDriverRadarFloatPanel?.();
                window.updatePassengerPromoStripVisibility?.();
                return;
            }

            // Permitir ocultar/minimizar durante viaje para conductor y pasajero (non-mobile)
            panel?.classList.remove('panel-collapsed');
            document.body.classList.remove('panel-minimized');
            document.body.classList.add('panel-hidden');
            panel?.classList.add('panel-hidden');
            const label = document.getElementById('trip-panel-toggle-label');
            if (label) label.textContent = 'Ver más';
            try { localStorage.setItem(PANEL_HIDDEN_KEY, '1'); } catch (_) {}
            window.updatePassengerPromoStripVisibility?.();
        };

        window.initControlPanelVisibility = () => {
            const isMobile = window.innerWidth < 768;
            const hasTrip = document.body.classList.contains('trip-active');
            const isDriver = document.body.classList.contains('driver-mode');

            if (document.body.classList.contains('is-searching')) {
                window.showControlPanel();
                return;
            }

            if (isDriver) {
                document.body.classList.remove('panel-hidden');
                document.getElementById('control-panel')?.classList.remove('panel-hidden');
                try {
                    if (localStorage.getItem(PANEL_HIDDEN_KEY) === '1') {
                        const p = document.getElementById('control-panel');
                        if (p) p.classList.add('panel-collapsed');
                        document.body.classList.add('panel-minimized');
                    }
                } catch (_) {}
                window.syncDriverRadarFloatPanel?.();
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

        window.toggleActivePanel = () => {
            const panel = document.getElementById('control-panel');
            if (!panel) return;
            panel.classList.toggle('panel-collapsed');
            const collapsed = panel.classList.contains('panel-collapsed');
            document.body.classList.toggle('panel-minimized', collapsed);
            document.body.classList.remove('panel-hidden');
            panel.classList.remove('panel-hidden');
            try { localStorage.setItem(PANEL_HIDDEN_KEY, collapsed ? '1' : '0'); } catch (_) {}
            window.syncPassengerPanelToggleLabel?.();

            if (document.body.classList.contains('driver-mode')) {
                if (collapsed) window.syncDriverRadarFloatPanel?.();
                else {
                    window.dockControlPanelForDriverTrip?.();
                    window.syncDriverRadarFloatPanel?.();
                }
            } else if (!collapsed) {
                window.dockControlPanelForClient?.();
            }

            // iOS/Android: forzar reflow para que max-height del colapsado se aplique al toque
            try {
                // eslint-disable-next-line no-unused-expressions
                panel.offsetHeight;
            } catch (_) {}
            window.updatePassengerPromoStripVisibility?.();
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
                ['chat-badge', 'chat-badge-driver'].forEach((id) => {
                    const badge = document.getElementById(id);
                    if (!badge) return;
                    badge.classList.add('hidden');
                    badge.innerText = '0';
                    badge.classList.remove('animate-bounce');
                });
                setTimeout(() => {
                    const chatMsgs = document.getElementById('chat-messages');
                    if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
                    document.getElementById('chat-input')?.focus?.();
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

        window.formatGoogleMapsLocationParam = (point) => {
            if (!point) return '';
            const latLng = point.latLng
                || (point.lat != null && point.lng != null ? { lat: point.lat, lng: point.lng } : null);
            if (latLng?.lat != null && latLng?.lng != null) {
                return `${latLng.lat},${latLng.lng}`;
            }
            const addr = point.address || (typeof point === 'string' ? point : '');
            return addr ? encodeURIComponent(addr) : '';
        };

        window.buildGoogleMapsDirectionsUrl = (trip, options = {}) => {
            if (!trip) return null;

            const navMode = options.navMode || 'full';
            const originPoint = {
                address: trip.origin,
                latLng: trip.originLat != null ? { lat: trip.originLat, lng: trip.originLng } : null,
            };
            const destinationPoint = {
                address: trip.destination,
                latLng: trip.destinationLat != null ? { lat: trip.destinationLat, lng: trip.destinationLng } : null,
            };
            const chain = window.buildOrderedRoutePoints?.(
                originPoint,
                destinationPoint,
                trip.additionalStops || []
            ) || [];

            if (!chain.length) return null;

            let originParam = '';
            let destinationParam = '';
            let waypointParams = [];

            if (navMode === 'pickup') {
                const pickup = chain[0];
                originParam = options.useDriverPosition && window.currentDriverPos
                    ? `${window.currentDriverPos.lat},${window.currentDriverPos.lng}`
                    : window.formatGoogleMapsLocationParam(pickup);
                destinationParam = window.formatGoogleMapsLocationParam(pickup);
            } else if (navMode === 'leg') {
                const legTarget = window.getTripCurrentLegNavTarget?.(trip);
                const legPoint = legTarget || chain[chain.length - 1];
                originParam = options.useDriverPosition && window.currentDriverPos
                    ? `${window.currentDriverPos.lat},${window.currentDriverPos.lng}`
                    : window.formatGoogleMapsLocationParam(chain[0]);
                destinationParam = window.formatGoogleMapsLocationParam(
                    legPoint?.lat != null
                        ? { address: legPoint.address, latLng: { lat: legPoint.lat, lng: legPoint.lng } }
                        : legPoint
                );
            } else {
                originParam = options.useDriverPosition && window.currentDriverPos
                    ? `${window.currentDriverPos.lat},${window.currentDriverPos.lng}`
                    : window.formatGoogleMapsLocationParam(chain[0]);
                destinationParam = window.formatGoogleMapsLocationParam(chain[chain.length - 1]);
                if (chain.length > 2) {
                    waypointParams = chain
                        .slice(1, -1)
                        .map((p) => window.formatGoogleMapsLocationParam(p))
                        .filter(Boolean);
                }
            }

            if (!originParam || !destinationParam) return null;

            let url = `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destinationParam}&travelmode=driving`;
            if (waypointParams.length) {
                url += `&waypoints=${waypointParams.join('|')}`;
            }
            return url;
        };

        window.openGoogleMapsDirectionsUrl = (url) => {
            if (!url) {
                window.showToast?.('No se pudo armar la ruta para Google Maps.');
                return false;
            }
            let opened = null;
            try {
                if (window.Capacitor?.isNativePlatform?.()) {
                    opened = window.open(url, '_system');
                }
            } catch (_) {}
            if (!opened) {
                opened = window.open(url, '_blank', 'noopener,noreferrer');
            }
            if (!opened) window.location.href = url;
            return true;
        };

        window.openTripRouteInGoogleMaps = async (trip, options = {}) => {
            if (!trip) {
                window.showToast?.('No hay ruta disponible.');
                return;
            }
            if (options.useDriverPosition) {
                await window.ensureDriverPosition?.();
            }
            const url = window.buildGoogleMapsDirectionsUrl(trip, options);
            window.openGoogleMapsDirectionsUrl(url);
        };

        window.openPassengerTripRouteInGoogleMaps = async () => {
            const trip = window.currentActiveTripData || window.activeTrip;
            if (!trip) {
                window.showToast?.('No hay un viaje activo.');
                return;
            }
            await window.openTripRouteInGoogleMaps(trip, { navMode: 'full' });
        };

        window.openDriverRouteInGoogleMaps = async () => {
            const trip = window.currentActiveTripData;
            if (!trip) {
                window.showToast?.('No hay un viaje activo.');
                return;
            }

            await window.ensureDriverPosition?.();

            const isDestPhase = trip.status === 'in_progress'
                || (trip.status === 'accepted' && trip.driverArrived);
            const hasStops = (trip.additionalStops || []).length > 0;

            if (isDestPhase) {
                await window.openTripRouteInGoogleMaps(trip, {
                    navMode: hasStops ? 'leg' : 'full',
                    useDriverPosition: true,
                });
                return;
            }

            if (!isDestPhase) {
                const target = await window.resolveTripPickupNavTarget?.(trip);
                const pickupTrip = {
                    ...trip,
                    origin: typeof target === 'string' ? target : (trip.origin || ''),
                    originLat: target?.lat ?? trip.originLat,
                    originLng: target?.lng ?? trip.originLng,
                    destination: typeof target === 'string' ? target : (trip.origin || ''),
                    destinationLat: target?.lat ?? trip.originLat,
                    destinationLng: target?.lng ?? trip.originLng,
                    additionalStops: [],
                };
                await window.openTripRouteInGoogleMaps(pickupTrip, {
                    navMode: 'pickup',
                    useDriverPosition: true,
                });
                return;
            }

            await window.openTripRouteInGoogleMaps(trip, {
                navMode: 'full',
                useDriverPosition: true,
            });
        };

        window.hideDriverTripExtraPanels = () => {
            if (!document.body.classList.contains('trip-active')
                || !document.body.classList.contains('driver-mode')) {
                document.body.classList.remove('driver-trip-dest-phase');
                return;
            }
            const navTop = document.getElementById('nav-hud-top');
            const navBottom = document.getElementById('nav-hud-bottom');
            if (navTop) navTop.style.display = 'none';
            if (navBottom) navBottom.style.display = 'none';
            window.hideCenterMapFab?.();
            window.setMapFabVisible?.('fab-traffic', false);
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
            const btn = document.querySelector('[data-trip-action="toggle-nav-voice"]');
            if (!btn) return;
            const on = window.driverVoiceNavEnabled !== false;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.setAttribute('title', on ? 'Silenciar voz' : 'Activar voz');
            btn.setAttribute('aria-label', on ? 'Silenciar voz de navegación' : 'Activar voz de navegación');
            const icon = btn.querySelector('i');
            if (icon) icon.className = on ? 'fas fa-volume-up' : 'fas fa-volume-mute';
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
            const minimized = document.body.classList.contains('panel-minimized')
                || document.body.classList.contains('panel-hidden');
            return {
                top: 88,
                right: 36,
                left: 36,
                bottom: minimized ? 96 : 280
            };
        };

        window.hasActiveDriverNavRoute = () => {
            const path = window.currentRouteFullPath
                || window.currentNavRoute?.path
                || [];
            return path.length >= 2;
        };

        window.ensureDriverNavRouteVisible = () => {
            if (!window.shouldPreserveDriverNavRoute?.()) return;
            const trip = window.currentActiveTripData;
            if (!trip) return;

            const hasRoute = window.hasActiveDriverNavRoute?.();
            if (!hasRoute) {
                let target = null;
                if (trip.status === 'in_progress') {
                    target = (trip.destinationLat != null && trip.destinationLng != null)
                        ? { lat: trip.destinationLat, lng: trip.destinationLng, address: trip.destination }
                        : trip.destination;
                } else if (!trip.driverArrived) {
                    target = (trip.originLat != null && trip.originLng != null)
                        ? { lat: trip.originLat, lng: trip.originLng, address: trip.origin }
                        : trip.origin;
                } else {
                    target = (trip.destinationLat != null && trip.destinationLng != null)
                        ? { lat: trip.destinationLat, lng: trip.destinationLng, address: trip.destination }
                        : trip.destination;
                }
                if (target) window.updateNavigation?.(target, true);
                return;
            }

            const pos = window.currentDriverPos;
            if (!pos) return;

            const remainingOnMap = window._progressRoutePolylines?.remaining?.getMap?.();
            if (!remainingOnMap && window.currentNavRoute) {
                window.drawRouteOnMap?.(window.currentNavRoute, { driverNav: true });
            }
            window.updateRouteProgress?.(pos, { driverNav: true, force: true });
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
        const DESTINATION_ARRIVAL_RADIUS_M = 200;

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

            if (reuse?.remaining?.getMap?.() && (driverLite || reuse.base?.getMap?.())) {
                if (reuse.base) reuse.base.setPath(path);
                if (reuse.passed) {
                    if (passed.length >= 2 && !driverLite) {
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
                        if (reuse.anim && !driverLite) {
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

            let passedLine = null;
            if (passed.length >= 2 && !driverLite) {  // only explicit passed for non-driver
                passedLine = new google.maps.Polyline({
                    path: passed,
                    geodesic: true,
                    strokeColor: passedColor,
                    strokeOpacity: passedOpacity,
                    strokeWeight: driverLite ? 7 : (isPassenger ? 10 : 9),
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
                    strokeOpacity: 0.95,
                    strokeWeight: driverLite ? 9 : 10,
                    map: window.gMap,
                    zIndex: 3
                });
                polylines.push(remainingLine);

                const lowPower = typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode();
                if (!lowPower && !driverLite) {
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
            if (isDriver && path.length >= 2) {
                const dist = window.getDistanceToRouteMeters?.(path, driverPos);
                if (Number.isFinite(dist) && dist < 140) {
                    const snapped = window.snapPositionToRoute?.(path, driverPos);
                    if (snapped?.lat != null && snapped?.lng != null) {
                        driverPos = { lat: snapped.lat, lng: snapped.lng };
                    }
                }
            }
            const isPassenger = options.passengerTrack ?? window.isPassengerTracking?.();
            const moveThreshold = isPassenger ? 0.000015 : (isDriver ? 0.00002 : 0.00008);
            const moved = !last
                || Math.hypot(driverPos.lat - last.lat, driverPos.lng - last.lng) > moveThreshold;
            const lowPower = typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode();
            const minMs = isPassenger
                ? (lowPower ? 280 : 180)
                : (isDriver ? (lowPower ? 2200 : 1600) : (lowPower ? 1400 : 800));
            const timeOk = !window._lastRouteProgressUpdate || now - window._lastRouteProgressUpdate > minMs;
            if (!options.force && !moved && !timeOk) return;

            window._lastRouteProgressUpdate = now;
            window._lastRouteProgressPos = driverPos;
            window.drawProgressRouteOnMap(
                { path },
                driverPos,
                { driverNav: isDriver, passengerTrack: isPassenger }
            );

            if (isPassenger) {
                if (window.passengerTrackPhase === 'destination') {
                    window.applyPassengerLiveTripCamera?.(driverPos, window.currentActiveTripData, options.force);
                } else {
                    window.applyPassengerNavCamera?.(
                        driverPos,
                        window._passengerTrackHeading || 0
                    );
                }
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

        window.computeDrivingRoute = async (origin, destination) => {
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

            const routeCacheKey = `${o.lat.toFixed(4)},${o.lng.toFixed(4)}->${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
            const cached = window._routeComputeCache?.get(routeCacheKey);
            const cachedRoute = cached?.route;
            const cacheOk = cachedRoute
                && !cachedRoute.estimated
                && cachedRoute.path?.length >= 8
                && Date.now() - cached.ts < (window._routeCacheTtlMs || 90000);
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

            const buildEstimatedDrivingRoute = (from, to) => {
                const toRad = (deg) => deg * Math.PI / 180;
                const earthKm = 6371;
                const dLat = toRad(to.lat - from.lat);
                const dLng = toRad(to.lng - from.lng);
                const a = Math.sin(dLat / 2) ** 2
                    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
                const lineKm = earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distanceMeters = Math.round(lineKm * 1000 * 1.25);
                const durationMillis = Math.round((lineKm * 1.25 / 35) * 3600 * 1000);
                return {
                    distanceMeters,
                    durationMillis,
                    staticDurationMillis: durationMillis,
                    path: [from, to],
                    legs: [{ distanceMeters, durationMillis, staticDurationMillis: durationMillis }],
                    estimated: true
                };
            };

            // Primary: modern Routes API (Route.computeRoutes).
            const routesLib = await window.routesLibraryReady;
            const RouteCtor = (routesLib && routesLib.Route) || window.RouteClass;
            const navDriving = window.isDriverNavigating?.() || window.driverNavMode;
            if (RouteCtor) {
                const routeFields = ['path', 'distanceMeters', 'durationMillis', 'staticDurationMillis', 'legs'];
                const routingAttempts = [
                    { routingPreference: 'TRAFFIC_UNAWARE' },
                    {
                        routingPreference: 'TRAFFIC_AWARE',
                        departureTime: new Date(Date.now() + 2 * 60 * 1000)
                    }
                ];
                const requestVariants = navDriving
                    ? [
                        { withNavVoice: true },
                        { withNavVoice: false }
                    ]
                    : [{ withNavVoice: false }];

                const isSparseStreetPath = (built) => {
                    if (!built?.path?.length) return true;
                    if (built.path.length < 8 && (built.distanceMeters || 0) > 350) return true;
                    return false;
                };

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
                                window._routeComputeCache?.set(routeCacheKey, { route: built, ts: Date.now() });
                                if (window._routeComputeCache?.size > 24) {
                                    const oldest = window._routeComputeCache.keys().next().value;
                                    window._routeComputeCache.delete(oldest);
                                }
                                return built;
                            }
                        } catch (attemptErr) {
                            const msg = String(attemptErr?.message || attemptErr);
                            if (!window._routesWarned) {
                                window._routesWarned = true;
                                console.warn('[ROUTE] Intento de ruta falló:', msg);
                            }
                            if (msg.includes('invalid fields')) break;
                        }
                    }
                }
            }

            // Conductor: nunca dibujar línea recta; dejar que la UI muestre error/carga.
            if (navDriving) {
                console.warn('[ROUTE] No se pudo obtener ruta por calles para navegación.');
                return null;
            }
            // Last resort para pasajero/tarifa: estimación en línea recta.
            if (!window._routeEstimateWarned) {
                window._routeEstimateWarned = true;
                console.info('[ROUTE] Ruta estimada activa. Habilita "Routes API" en Google Cloud para rutas por calles.');
            }
            return buildEstimatedDrivingRoute(o, d);
        };

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

        window.smoothDriverNavHeading = (nextHeading, prevHeading) => {
            const next = Number(nextHeading);
            if (!Number.isFinite(next)) return prevHeading ?? 0;
            if (prevHeading == null || !Number.isFinite(prevHeading)) return next;
            let delta = ((next - prevHeading + 540) % 360) - 180;
            const abs = Math.abs(delta);
            if (abs <= 2) return prevHeading;
            if (abs > 28) return next;
            const step = Math.min(abs, 12);
            return ((prevHeading + Math.sign(delta) * step) + 360) % 360;
        };

        window.getDriverNavCameraState = (rawPos, gpsHeading) => {
            const path = window.currentRouteFullPath
                || window.currentNavRoute?.path
                || [];
            let pos = rawPos;
            if (path.length >= 2 && rawPos && window.isDriverNavigating?.()) {
                const dist = window.getDistanceToRouteMeters?.(path, rawPos);
                if (Number.isFinite(dist) && dist < 140) {
                    const snapped = window.snapPositionToRoute?.(path, rawPos);
                    if (snapped?.lat != null && snapped?.lng != null) {
                        pos = { lat: snapped.lat, lng: snapped.lng };
                    }
                }
            }
            const heading = window.resolveDriverNavHeading?.(pos, gpsHeading, path)
                ?? window.currentDriverHeading
                ?? 0;
            const smooth = window.smoothDriverNavHeading?.(
                heading,
                window._lastDriverNavCamHeading
            );
            return { pos, heading: smooth, path };
        };

        window.resolveDriverNavHeading = (pos, gpsHeading, path) => {
            const pathHeading = path?.length >= 2 ? window.computeHeadingOnPath(path, pos) : null;
            if (pathHeading != null && window.isDriverNavigating?.()) {
                const distToRoute = window.getDistanceToRouteMeters?.(path, pos);
                const onRoute = Number.isFinite(distToRoute) && distToRoute < 90;
                if (onRoute) return pathHeading;
                if (gpsHeading != null && Number.isFinite(gpsHeading)) {
                    const delta = Math.abs(((pathHeading - gpsHeading + 540) % 360) - 180);
                    return delta > 28 ? pathHeading : gpsHeading;
                }
                return pathHeading;
            }
            if (gpsHeading != null && Number.isFinite(gpsHeading)) return gpsHeading;
            if (pathHeading != null) return pathHeading;
            return window.currentDriverHeading || 0;
        };

        window.stripNavHtml = (html) => {
            const d = document.createElement('div');
            d.innerHTML = html || '';
            return (d.textContent || '').replace(/\s+/g, ' ').trim();
        };

        window.getNavManeuverIcon = (maneuver = '') => {
            const m = String(maneuver).toLowerCase();
            if (m.includes('left') || m.includes('izquierda')) return 'fa-arrow-turn-left';
            if (m.includes('right') || m.includes('derecha')) return 'fa-arrow-turn-right';
            if (m.includes('roundabout') || m.includes('rotonda')) return 'fa-circle-notch';
            if (m.includes('uturn') || m.includes('retorno')) return 'fa-rotate-left';
            if (m.includes('merge') || m.includes('ramp')) return 'fa-code-merge';
            return 'fa-arrow-up';
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

        window.normalizeRouteNavSteps = (legs) => {
            const out = [];
            for (const leg of legs || []) {
                for (const raw of leg.steps || []) {
                    const nav = raw.navigationInstruction || raw;
                    const endLocation = window.normalizeRoutePoint(raw.endLocation || raw.startLocation);
                    const instruction = nav.instructions || nav.instruction || raw.instructions || raw.instruction || '';
                    const maneuver = nav.maneuver || raw.maneuver || '';
                    if (!endLocation && !instruction && !maneuver) continue;
                    out.push({
                        instruction,
                        maneuver,
                        distanceMeters: raw.distanceMeters || raw.staticDistanceMeters || 0,
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
            const m = String(maneuver).toUpperCase();
            if (m.includes('ROUNDABOUT') || m.includes('ROTARY')) return 'Toma la rotonda';
            if (m.includes('UTURN') || m.includes('U_TURN')) return 'Haz un retorno';
            if (m.includes('LEFT')) return 'Gira a la izquierda';
            if (m.includes('RIGHT')) return 'Gira a la derecha';
            if (m.includes('MERGE') || m.includes('RAMP') || m.includes('FORK')) return 'Incorpórate a la vía';
            if (m.includes('STRAIGHT') || m.includes('CONTINUE')) return 'Continúa recto';
            return 'Sigue la ruta';
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

        window.getNextNavStep = (route, pos) => {
            const steps = route?.steps;
            if (!steps?.length || !pos) return null;
            for (const step of steps) {
                if (!step.endLocation) continue;
                const distM = window.getDistanceToNavPoint(pos, step.endLocation);
                // Para el último paso (destino) usamos el radio de llegada ~200m
                const threshold = (step === steps[steps.length-1]) ? DESTINATION_ARRIVAL_RADIUS_M : 40;
                if (distM > threshold) return step;
            }
            return steps[steps.length - 1];
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

            const dest = route.path?.[route.path.length - 1];
            const distToDest = dest ? window.getDistanceToNavPoint(pos, dest) : Infinity;
            if (distToDest <= DESTINATION_ARRIVAL_RADIUS_M) {
                if (!window._navArrivalSpoken) {
                    window._navArrivalSpoken = true;
                    window.speakNavMessage('Estás en el destino. Presiona llegué al destino para que el pasajero confirme.');
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

            if (distM <= 25) {
                speakBand('now', `Ahora, ${short}`);
                return;
            }
            if (distM <= 55) {
                speakBand('50', `En 50 metros, ${short}`);
                return;
            }
            if (distM <= 110) {
                speakBand('100', `En 100 metros, ${short}`);
                return;
            }
            if (distM <= 220) {
                speakBand('200', `En 200 metros, ${short}`);
                return;
            }
            if (distM <= 430) {
                speakBand('400', `En 400 metros, ${short}`);
                return;
            }
            if (!bands.preview) {
                const rounded = Math.max(500, Math.round(distM / 100) * 100);
                bands.preview = true;
                window.speakNavMessage(`En ${rounded} metros, ${short}`);
            }
        };

        window.formatNavStepDistance = (meters) => {
            const m = Number(meters) || 0;
            if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
            return `${(m / 1000).toFixed(1)} km`;
        };

        window.updateDriverNavTurnCard = (route, pos) => {
            if (!window.isDriverNavigating?.()) return;
            const step = window.getNextNavStep(route, pos);
            const stepText = document.getElementById('nav-step-text');
            const stepDist = document.getElementById('nav-step-dist');
            const stepIcon = document.getElementById('nav-step-icon');
            if (!stepText || !stepDist) return;

            const dest = route?.path?.[route.path.length - 1];
            const distToDest = dest ? window.getDistanceToNavPoint(pos, dest) : Infinity;
            const trip = window.currentActiveTripData;
            const pickupPhase = trip?.status === 'accepted' && !trip?.driverArrived;

            if (pickupPhase) {
                window.syncDriverPickupArrivalUi?.(pos);
                if (distToDest <= 1000) {
                    stepText.innerText = '¡Cerca del pasajero!';
                    stepDist.innerText = distToDest <= DESTINATION_ARRIVAL_RADIUS_M
                        ? 'Presiona ¡HE LLEGADO! en el botón flotante'
                        : 'Ya puedes presionar ¡HE LLEGADO!';
                    if (stepIcon) stepIcon.className = 'fas fa-map-marker-alt text-2xl text-white';
                    return;
                }
            } else if (distToDest <= DESTINATION_ARRIVAL_RADIUS_M) {
                const legLabel = window.getTripRouteLegLabel?.(trip);
                if (legLabel?.isFinal !== false) {
                    stepText.innerText = '¡Estás en el destino!';
                    stepDist.innerText = 'Presiona LLEGUÉ AL DESTINO en el panel';
                } else {
                    stepText.innerText = `¡Estás en el punto ${legLabel.routeNum}!`;
                    stepDist.innerText = `Presiona LLEGUÉ AL PUNTO ${legLabel.routeNum} en el panel`;
                }
                if (stepIcon) stepIcon.className = 'fas fa-map-marker-alt text-2xl text-white';

                window.syncDriverDestinationArrivalUi?.(pos);

                return;
            }

            if (step) {
                const text = window.getNavInstructionText(step) || 'Continúa por la ruta';
                const distM = step.endLocation
                    ? window.getDistanceToNavPoint(pos, step.endLocation)
                    : Number(step.distanceMeters) || 0;
                stepText.innerText = text.length > 72 ? `${text.slice(0, 69)}…` : text;
                stepDist.innerText = `En ${window.formatNavStepDistance(distM)}`;
                if (stepIcon) {
                    stepIcon.className = `fas ${window.getNavManeuverIcon(step.maneuver)} text-2xl text-white`;
                }
            } else if (route) {
                stepText.innerText = 'Sigue la ruta azul';
                stepDist.innerText = `${window.getRouteDistanceKm(route).toFixed(1)} km · ${window.formatRouteDuration(route)}`;
                if (stepIcon) stepIcon.className = 'fas fa-location-arrow text-2xl text-white';
            }

            window.updateDriverVoiceNav?.(route, pos);
        };

        window.getDriverNavMapPadding = () => {
            const vv = window.visualViewport;
            const vw = vv?.width || window.innerWidth || 360;
            const vh = vv?.height || window.innerHeight || 640;
            const landscape = vw > vh;
            const safeSide = Math.max(12, Math.round(Math.min(vw, vh) * 0.04));
            const navHudBottom = document.getElementById('nav-hud-bottom');
            const navHudTop = document.getElementById('nav-hud-top');
            const driverNav = document.body.classList.contains('driver-nav-mode');
            const panelOpen = document.body.classList.contains('trip-active')
                && !document.body.classList.contains('panel-minimized')
                && !document.body.classList.contains('panel-hidden');

            let bottomUi = 72;
            if (navHudBottom && navHudBottom.offsetParent !== null) {
                bottomUi = Math.max(bottomUi, navHudBottom.offsetHeight + (landscape ? 16 : 24));
            }
            if (driverNav) {
                bottomUi = panelOpen
                    ? Math.max(bottomUi, Math.round(vh * (landscape ? 0.16 : 0.2)))
                    : Math.max(bottomUi, (navHudBottom?.offsetHeight || 72) + 20);
            } else if (panelOpen) {
                bottomUi = Math.max(bottomUi, Math.round(vh * 0.28));
            }

            const topUi = (navHudTop && navHudTop.offsetParent !== null)
                ? Math.max(landscape ? 52 : 64, navHudTop.offsetHeight + 12)
                : (landscape ? 52 : 64);
            const lookAhead = Math.round(vh * (landscape ? 0.24 : 0.22));
            const safeTop = Math.round(vv?.offsetTop || 0);
            const safeBottom = Math.max(0, Math.round((window.innerHeight || vh) - (vv?.height || vh) - safeTop));

            return {
                top: topUi + lookAhead + safeTop,
                right: safeSide,
                bottom: bottomUi + Math.round(vh * 0.05) + safeBottom,
                left: safeSide,
            };
        };

        window.applyDriverNavCamera = (rawPos, rawHeading, force = false) => {
            if (!window.gMap || !rawPos || !window.isDriverNavigating?.()) return;
            const cam = window.getDriverNavCameraState?.(rawPos, rawHeading) || { pos: rawPos, heading: rawHeading || 0 };
            const pos = cam.pos || rawPos;
            const h = Number.isFinite(cam.heading) ? cam.heading : 0;
            const lowPower = typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode();
            const lastCam = window._lastDriverNavCamPos;
            const moved = !lastCam || Math.hypot(pos.lat - lastCam.lat, pos.lng - lastCam.lng) > (lowPower ? 0.00012 : 0.00004);
            const headingDelta = window._lastDriverNavCamHeading == null
                ? 999
                : Math.abs(((h - window._lastDriverNavCamHeading + 540) % 360) - 180);
            if (!force && !moved && headingDelta < 2) return;
            window._lastDriverNavCamPos = { lat: pos.lat, lng: pos.lng };
            window._lastDriverNavCamHeading = h;
            window.currentDriverHeading = h;

            try {
                const hasMapId = !!(window.gMap && window.gMap.getMapId && window.gMap.getMapId());
                const landscape = (window.visualViewport?.width || window.innerWidth || 360)
                    > (window.visualViewport?.height || window.innerHeight || 640);
                const tilt = lowPower ? 0 : (landscape ? 40 : 48);
                const zoom = lowPower ? 17 : 18;
                const padding = window.getDriverNavMapPadding?.() || { top: 80, right: 16, bottom: 120, left: 16 };
                const cameraOpts = {
                    center: pos,
                    zoom,
                    padding,
                };
                if (hasMapId && !lowPower) {
                    cameraOpts.tilt = tilt;
                    cameraOpts.heading = h;
                }
                if (typeof window.gMap.moveCamera === 'function') {
                    window.gMap.moveCamera(cameraOpts);
                } else {
                    window.gMap.setCenter(pos);
                    window.gMap.setZoom(zoom);
                    if (hasMapId && !lowPower) {
                        window.gMap.setTilt(tilt);
                        window.gMap.setHeading(h);
                    }
                }
            } catch (_) {
                try { window.gMap.panTo(pos); } catch (__) {}
            }
        };

        window.recenterDriverNav = () => {
            if (!window.gMap) return;
            if (!window.currentDriverPos) {
                window.showToast?.('Esperando ubicación GPS…');
                return;
            }
            window.autoCenter = true;
            window.hideCenterMapFab?.();
            window._lastDriverNavCamPos = null;
            window._lastDriverNavCamHeading = null;
            window._lastDriverCameraUpdate = 0;
            window.applyDriverNavCamera?.(
                window.currentDriverPos,
                window.currentDriverHeading,
                true
            );
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
            // Do not force collapse the main panel here.
            // User controls minimize via the explicit buttons only.

            window.setupDriverRotationListener?.();
        };

        // Re-centra al girar el celular (vertical/horizontal) siguiendo la ruta
        window.setupDriverRotationListener = () => {
            if (window._driverRotListenerBound) return;
            window._driverRotListenerBound = true;

            const recenterAfterLayout = () => {
                if (!window.isDriverNavigating?.() || !window.currentDriverPos) return;
                window.autoCenter = true;
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
            window._lastDriverNavCamPos = null;
            window._lastDriverNavCamHeading = null;
            if (!window.gMap) return;
            try {
                window.gMap.setTilt(0);
                window.gMap.setHeading(0);
            } catch (_) {}
            const hud = document.getElementById('nav-hud-bottom');
            if (hud) hud.style.display = 'none';
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
                    // A 200m o menos consideramos que el conductor "ya llegó" (no entra a la casa)
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
                            : 'A ~200 m — espera confirmación del conductor';
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

            let originLat = trip.originLat;
            let originLng = trip.originLng;
            const liveDriver = window.currentDriverTrackPos;
            const inLiveTrip = trip.status === 'in_progress' || window.passengerTrackPhase === 'destination';
            if (inLiveTrip && liveDriver?.lat != null && liveDriver?.lng != null) {
                const originMissing = originLat == null || originLng == null;
                const usedDriverFallback = trip.originSource === 'driver_fallback';
                if (originMissing || usedDriverFallback) {
                    originLat = liveDriver.lat;
                    originLng = liveDriver.lng;
                }
            }
            if (originLat != null && originLng != null) {
                window.placePickupMarker?.({ lat: originLat, lng: originLng }, 'Inicio del viaje');
            }

            const legTarget = window.getTripCurrentLegNavTarget?.(trip);
            const legLabel = window.getTripRouteLegLabel?.(trip);
            if (legTarget?.lat != null && legTarget?.lng != null) {
                const markerLabel = legLabel?.isFinal ? 'Destino' : `Punto ${legLabel?.routeNum || ''}`;
                window.placeDestinationMarker?.({ lat: legTarget.lat, lng: legTarget.lng }, markerLabel);
            } else if (trip.destinationLat != null && trip.destinationLng != null) {
                window.placeDestinationMarker?.({ lat: trip.destinationLat, lng: trip.destinationLng }, 'Destino');
            } else if (window.currentPassengerTrackDest?.lat != null) {
                window.placeDestinationMarker?.(window.currentPassengerTrackDest, 'Destino');
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

            if ((driverNav || driverOfferPreview) && route.estimated) return;

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
                if (typeof route.createPolylines === 'function') {
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
            if (fitPath?.length && !driverNav && !passengerTrack) {
                const bounds = new google.maps.LatLngBounds();
                fitPath.forEach(p => bounds.extend(p));
                if (driverOfferPreview && window.currentDriverPos?.lat != null) {
                    bounds.extend(window.currentDriverPos);
                }
                const padding = driverOfferPreview
                    ? window.getDriverOfferPreviewMapPadding?.()
                    : undefined;
                window.gMap.fitBounds(bounds, padding || undefined);
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
            if (window.currentDriverTrackPos?.lat != null) return resolve(window.currentDriverTrackPos);
            if (window.currentDriverPos) return resolve(window.currentDriverPos);
            if (!navigator.geolocation) return resolve(null);
            const lowPower = typeof window.shouldUseLowPowerMode === 'function' && window.shouldUseLowPowerMode();
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    window.currentDriverPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    resolve(window.currentDriverPos);
                },
                () => resolve(null),
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
                window.clearStopMarkers?.();
            } catch (e) {}
        };

        // Mejores iconos de mapa usando PinElement + glifos A/B (más nativos y claros)
        window.placePickupMarker = (latLng, title = 'Origen (Punto de encuentro)') => {
            if (!window.mapLoaded || !latLng || !window.gMap) return;

            try {
                // Limpiar marcador anterior
                if (window.originMarker) {
                    if (window.originMarker.map !== undefined) window.originMarker.map = null;
                    else if (typeof window.originMarker.setMap === 'function') window.originMarker.setMap(null);
                    window.originMarker = null;
                }

                // Normalizar coordenadas
                const pos = (latLng.lat != null && latLng.lng != null)
                    ? { lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
                        lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng }
                    : latLng;

                const hasAdvanced = window.canUseAdvancedMapMarkers?.() ?? false;
                if (hasAdvanced) {
                    const pin = new google.maps.marker.PinElement({
                        background: '#10b981',
                        borderColor: '#ffffff',
                        glyphColor: '#ffffff',
                        glyphText: 'A',
                        scale: 1.15
                    });
                    window.originMarker = new google.maps.marker.AdvancedMarkerElement({
                        position: pos,
                        map: window.gMap,
                        content: pin,
                        title: title
                    });
                } else {
                    // Fall back to classic Marker (deprecation warning expected without mapId)
                    window.originMarker = new google.maps.Marker({
                        position: pos,
                        map: window.gMap,
                        title: title,
                        label: { text: 'A', color: '#ffffff', fontWeight: 'bold', fontSize: '14px' },
                        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#10b981', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 }
                    });
                }
            } catch (e) {
                console.warn('Error placing pickup marker (usando fallback):', e);
                // Último fallback (evitar si posible)
                try {
                    if (window.canUseAdvancedMapMarkers?.()) {
                        const pin = new google.maps.marker.PinElement({ background: '#10b981', glyphText: 'A' });
                        window.originMarker = new google.maps.marker.AdvancedMarkerElement({ position: latLng, map: window.gMap, content: pin, title });
                    } else {
                        // always Advanced
                        const pin = new google.maps.marker.PinElement({ background: '#10b981', glyphText: 'A' });
                        window.originMarker = new google.maps.marker.AdvancedMarkerElement({ position: latLng, map: window.gMap, content: pin, title });
                    }
                } catch (_) {}
            }
        };

        window.placeDestinationMarker = (latLng, title = 'Destino') => {
            if (!window.mapLoaded || !latLng || !window.gMap) return;

            try {
                if (window.targetMarker) {
                    if (window.targetMarker.map !== undefined) window.targetMarker.map = null;
                    else if (typeof window.targetMarker.setMap === 'function') window.targetMarker.setMap(null);
                    window.targetMarker = null;
                }

                const pos = (latLng.lat != null && latLng.lng != null)
                    ? { lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
                        lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng }
                    : latLng;

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
            window.updateDriverMarker(driverId, routePath[0].lat, routePath[0].lng, true, {
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
                window.updateDriverMarker(driverId, pos.lat, pos.lng, true, {
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
