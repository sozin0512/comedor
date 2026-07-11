/**
 * Zonas por ciudad (estilo Facebook Marketplace). Cobertura fija por ciudad, sin km manual.
 */
import { HONDURAS_CITIES } from "./honduras-cities.js";

const ZONE_STORAGE_KEY = "honduber_service_zone";
const RADIUS_CLIENT_KEY = "honduber_radius_client";
const RADIUS_DRIVER_KEY = "honduber_radius_driver";
const ZONE_PANEL_OPEN_KEY = "honduber_zone_panel_open";

export function getZoneConfig() {
    return window.APP_CONFIG?.serviceZones || { enabled: false };
}

export function getServiceZones() {
    return HONDURAS_CITIES;
}

export function getZoneById(zoneId) {
    if (!zoneId) return null;
    return getServiceZones().find((z) => z.id === zoneId) || null;
}

export function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Radio de cobertura fijo para una ciudad (km desde el centro municipal). */
export function getCityCoverageKm(zoneId = null) {
    const id = zoneId || window.activeServiceZoneId || getDefaultZoneId();
    const cfg = getZoneConfig();
    if (id && cfg.cityCoverageKm?.[id] != null) {
        return cfg.cityCoverageKm[id];
    }
    const zone = getZoneById(id);
    if (zone?.coverageKm != null) return zone.coverageKm;
    return cfg.defaultCityCoverageKm ?? 14;
}

export function getRadiusLimits() {
    const def = getCityCoverageKm();
    return { min: def, max: def, default: def, presets: [def] };
}

export function isPassengerAppRole(profile) {
    return !!profile && profile.role === "client";
}

function radiusStorageKey(role) {
    return role === "driver" ? RADIUS_DRIVER_KEY : RADIUS_CLIENT_KEY;
}

export function getRadiusRoleKey(profile = null) {
    const p = profile || window.userProfile;
    return p?.role === "driver" ? "driver" : "client";
}

/** @deprecated Usar getCityCoverageKm — mantiene compatibilidad con código existente. */
export function getStoredRadiusKm(_role = null) {
    return getCityCoverageKm();
}

/** @deprecated El radio ya no es configurable; devuelve la cobertura de la ciudad activa. */
export function setStoredRadiusKm(_km, _role = null) {
    const coverage = getCityCoverageKm();
    window.activeSearchRadiusKm = coverage;
    updateRadiusUI(coverage);
    updateZoneHint();
    return coverage;
}

export function getActiveRadiusKm(zoneId = null) {
    return getCityCoverageKm(zoneId);
}

/** Radio corto: conductores en línea cerca del punto de recogida (primera ronda). */
export function getTripOfferNearRadiusKm(zoneId = null) {
    const cfg = getZoneConfig();
    if (cfg.tripOfferNearRadiusKm != null) return cfg.tripOfferNearRadiusKm;
    const coverage = getCityCoverageKm(zoneId);
    return Math.min(10, Math.max(5, Math.round(coverage * 0.5)));
}

/** Radio amplio: misma cobertura de la ciudad si nadie cerca está en línea. */
export function getTripOfferFarRadiusKm(zoneId = null) {
    return getCityCoverageKm(zoneId);
}

export function pickDriversByProximityTier(sortedCandidates, zoneId = null) {
    if (!sortedCandidates?.length) {
        return { candidates: [], tier: null };
    }
    const nearKm = getTripOfferNearRadiusKm(zoneId);
    const farKm = getTripOfferFarRadiusKm(zoneId);
    let pool = sortedCandidates.filter((c) => c.distanceKm <= nearKm);
    let tier = 'near';
    if (!pool.length) {
        pool = sortedCandidates.filter((c) => c.distanceKm <= farKm);
        tier = 'far';
    }
    return { candidates: pool, tier };
}

/** Ciudad más cercana al punto GPS. */
export function findNearestZone(lat, lng) {
    if (lat == null || lng == null) return null;
    let best = null;
    let bestDist = Infinity;
    for (const zone of getServiceZones()) {
        const dist = haversineKm(lat, lng, zone.center.lat, zone.center.lng);
        if (dist < bestDist) {
            best = zone;
            bestDist = dist;
        }
    }
    return best ? { zone: best, distanceKm: bestDist } : null;
}

/** Auto-detectar ciudad si el GPS está dentro de la cobertura municipal. */
export function findZoneForCoords(lat, lng, radiusKm = null) {
    const nearest = findNearestZone(lat, lng);
    if (!nearest) return null;
    const limit = radiusKm ?? getCityCoverageKm(nearest.zone.id);
    return nearest.distanceKm <= limit ? nearest.zone : null;
}

export function isInsideHondurasProximity(lat, lng) {
    const cfg = getZoneConfig();
    const limitKm = cfg.forceManualIfOutsideCountryKm ?? 200;
    const nearest = findNearestZone(lat, lng);
    return nearest ? nearest.distanceKm <= limitKm : false;
}

export function getStoredManualZoneId() {
    try {
        return localStorage.getItem(ZONE_STORAGE_KEY);
    } catch (_) {
        return null;
    }
}

export function setStoredManualZoneId(zoneId) {
    try {
        if (zoneId) localStorage.setItem(ZONE_STORAGE_KEY, zoneId);
        else localStorage.removeItem(ZONE_STORAGE_KEY);
    } catch (_) {}
}

export function getDefaultZoneId() {
    const cfg = getZoneConfig();
    return getStoredManualZoneId() || cfg.defaultZoneId || getServiceZones()[0]?.id || null;
}

export function resolveServiceZone(lat, lng) {
    const cfg = getZoneConfig();
    if (!cfg.enabled) return null;

    const detected = findZoneForCoords(lat, lng);
    if (detected) return detected;

    if (cfg.allowManualZoneSelection) {
        return getZoneById(getStoredManualZoneId() || cfg.defaultZoneId);
    }

    return getZoneById(cfg.defaultZoneId) || getServiceZones()[0] || null;
}

/** ID de ciudad del viaje (ciudad elegida por el pasajero tiene prioridad). */
export function getTripCityId(trip) {
    return trip?.serviceZoneId || inferTripZoneIdFromOrigin(trip) || null;
}

/** ¿Misma ciudad operativa? La ciudad elegida en la app es la regla principal. */
export function tripSameCity(trip, zoneId) {
    if (!zoneId) return false;
    const tripZone = getTripCityId(trip);
    return !!tripZone && tripZone === zoneId;
}

/** Viaje visible para conductor: misma ciudad elegida. */
export function tripMatchesZone(trip, zoneId, radiusKm = null) {
    if (!getZoneConfig().enabled) return true;
    if (!tripSameCity(trip, zoneId)) return false;

    // Ciudad elegida explícitamente por el pasajero → basta con coincidir el ID
    if (trip.serviceZoneId && trip.serviceZoneId === zoneId) return true;

    const zone = getZoneById(zoneId);
    if (!zone) return false;
    const coverage = radiusKm ?? getCityCoverageKm(zoneId);

    if (trip.originLat != null && trip.originLng != null) {
        return haversineKm(trip.originLat, trip.originLng, zone.center.lat, zone.center.lng) <= coverage;
    }

    return true;
}

/** ¿Un viaje pendiente debe mostrarse a este conductor? Solo por ciudad. */
export function tripVisibleToDriver(trip, options = {}) {
    const { zoneId } = options;
    if (!trip || trip.isDemandSimulation) return false;
    return tripSameCity(trip, zoneId);
}

/** ¿Conductor en línea opera en la misma ciudad que el viaje? */
export function driverLocationMatchesTripCity(loc, tripZoneId, fallbackDriverZoneId = null) {
    if (!tripZoneId) return true;
    if (loc?.serviceZoneId === tripZoneId) return true;
    if (fallbackDriverZoneId && fallbackDriverZoneId === tripZoneId) return true;
    if (loc?.lat != null && loc?.lng != null) {
        const detected = findZoneForCoords(loc.lat, loc.lng, getCityCoverageKm(tripZoneId));
        if (detected?.id === tripZoneId) return true;
    }
    return false;
}

/** Infer city from pickup coords when legacy trips lack serviceZoneId. */
export function inferTripZoneIdFromOrigin(trip) {
    if (trip?.serviceZoneId) return trip.serviceZoneId;
    if (trip?.originLat == null || trip?.originLng == null) return null;
    const nearest = findNearestZone(trip.originLat, trip.originLng);
    return nearest?.zone?.id || null;
}

export function applyZoneMapBias(zone, radiusKm = null) {
    if (!zone?.center) return;
    window.updatePlacesLocationBias?.(zone.center.lat, zone.center.lng);

    if (!window.gMap) return;

    window.gMap.panTo(zone.center);
    const radius = radiusKm ?? getActiveRadiusKm();
    const zoom = radius <= 10 ? 13 : radius <= 25 ? 12 : radius <= 50 ? 11 : radius <= 80 ? 10 : 9;
    window.gMap.setZoom(zoom);
}

function buildZoneSelectOptions(filter = "") {
    const term = filter.trim().toLowerCase();
    const zones = getServiceZones().filter((z) => {
        if (!term) return true;
        return (
            z.name.toLowerCase().includes(term) ||
            z.department.toLowerCase().includes(term) ||
            z.id.toLowerCase().includes(term)
        );
    });

    const byDept = {};
    for (const z of zones) {
        if (!byDept[z.department]) byDept[z.department] = [];
        byDept[z.department].push(z);
    }

    const departments = Object.keys(byDept).sort((a, b) => a.localeCompare(b, "es"));
    return departments
        .map((dept) => {
            const opts = byDept[dept]
                .sort((a, b) => a.name.localeCompare(b.name, "es"))
                .map((z) => `<option value="${z.id}">${z.name}</option>`)
                .join("");
            return `<optgroup label="${dept}">${opts}</optgroup>`;
        })
        .join("");
}

/** Render a Facebook-style grouped clickable city list. */
export function renderServiceCityList(listEl, filter = "", selectedId = null, onSelect = null) {
    if (!listEl) return;

    const term = (filter || "").trim().toLowerCase();
    const zones = getServiceZones().filter((z) => {
        if (!term) return true;
        return (
            z.name.toLowerCase().includes(term) ||
            z.department.toLowerCase().includes(term) ||
            z.id.toLowerCase().includes(term)
        );
    });

    const byDept = {};
    for (const z of zones) {
        if (!byDept[z.department]) byDept[z.department] = [];
        byDept[z.department].push(z);
    }

    const departments = Object.keys(byDept).sort((a, b) => a.localeCompare(b, "es"));

    let html = "";

    departments.forEach((dept) => {
        html += `<div class="zone-dept-header">${dept}</div>`;
        const sorted = byDept[dept].sort((a, b) => a.name.localeCompare(b.name, "es"));
        sorted.forEach((z) => {
            const isSel = selectedId && z.id === selectedId;
            html += `
                <div class="zone-city-row${isSel ? " is-selected" : ""}" data-zone-id="${z.id}">
                    <div class="min-w-0">
                        <div class="zone-city-name">${z.name}</div>
                        <div class="zone-city-dept">${z.department}</div>
                    </div>
                    ${isSel ? '<span class="zone-city-check"><i class="fas fa-check"></i></span>' : ""}
                </div>
            `;
        });
    });

    if (!zones.length) {
        html = `<div class="zone-city-empty"><i class="fas fa-search mb-2 block text-lg opacity-40"></i>Sin ciudades con ese nombre</div>`;
    }

    listEl.innerHTML = html;

    // Bind clicks
    listEl.querySelectorAll(".zone-city-row").forEach((row) => {
        row.onclick = () => {
            const zid = row.dataset.zoneId;
            if (!zid) return;

            if (typeof window.onServiceZoneChange === "function") {
                window.onServiceZoneChange(zid);
            } else {
                const zone = setActiveServiceZone(zid, { persist: true, biasMap: true });
                updateZoneHint();
                updateServiceZoneSummary();
                if (zone) window.showToast?.(`Ciudad: ${zone.name}`, "success");
            }

            if (typeof onSelect === "function") {
                renderServiceCityList(listEl, filter, zid, onSelect);
                onSelect(zid);
            } else {
                const curr = window.activeServiceZoneId || getDefaultZoneId();
                renderServiceCityList(listEl, filter, curr, onSelect);
            }
        };
    });
}

/** Detect nearest city using GPS (FB-like "use my location"). */
export async function detectAndSetCityFromGPS() {
    if (!navigator.geolocation) {
        window.showToast?.("Tu dispositivo no soporta GPS.");
        return null;
    }

    window.showToast?.("Detectando tu ubicación...");

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const nearest = findNearestZone(lat, lng);
                if (nearest && nearest.zone) {
                    const dist = Math.round(nearest.distanceKm * 10) / 10;
                    // Delegate to onServiceZoneChange so it handles set + persist for drivers + toast
                    if (typeof window.onServiceZoneChange === "function") {
                        window.onServiceZoneChange(nearest.zone.id);
                        window.showToast?.(`Ciudad detectada: ${nearest.zone.name} (${dist} km del centro)`);
                    } else {
                        const zone = setActiveServiceZone(nearest.zone.id, { persist: true, biasMap: true });
                        window.showToast?.(`Ciudad detectada: ${zone.name} (${dist} km del centro)`);
                    }
                    resolve(nearest.zone);
                } else {
                    window.showToast?.("No se detectó una ciudad cercana en Honduras.");
                    resolve(null);
                }
            },
            (err) => {
                window.showToast?.("No se pudo obtener ubicación GPS.");
                resolve(null);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
        );
    });
}

function buildRadiusPresetButtons(presetList) {
    return presetList
        .map(
            (km) =>
                `<button type="button" data-trip-action="set-radius" data-radius-km="${km}" data-radius="${km}" ` +
                `class="radius-chip px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border border-slate-200 bg-white text-slate-600 transition-all trip-touch-btn">` +
                `<span class="pointer-events-none">${km} km</span></button>`
        )
        .join("");
}

function bindRadiusControls() {
    // Radio manual deshabilitado: cobertura fija por ciudad.
}

function getServiceTypeSummaryLabel() {
    if (window.userProfile?.role === "driver") return "Conductor";
    if (!isPassengerAppRole(window.userProfile)) return "Usuario";
    const type = window.currentServiceType || "moto";
    if (type === "delivery") return "Envío";
    if (type === "auto") return "Auto";
    return "Moto";
}

export function updateRadiusUI(_km) {
    const badge = document.getElementById("driver-radius-badge");
    if (badge) badge.classList.add("hidden");
    updateServiceZoneSummary();
}

function isMobileViewport() {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function readZonePanelOpenPreference() {
    try {
        const stored = localStorage.getItem(ZONE_PANEL_OPEN_KEY);
        if (stored === "1") return true;
        if (stored === "0") return false;
    } catch (_) { /* ignore */ }
    return true;
}

function writeZonePanelOpenPreference(open) {
    try {
        localStorage.setItem(ZONE_PANEL_OPEN_KEY, open ? "1" : "0");
    } catch (_) { /* ignore */ }
}

export function updateServiceZoneSummary() {
    const zone = getZoneById(window.activeServiceZoneId || getDefaultZoneId());
    const place = zone ? zone.name : "Honduras";

    const summary = document.getElementById("service-zone-summary");
    const chipText = document.getElementById("service-zone-map-chip-text");
    if (summary) summary.textContent = place;
    if (chipText) chipText.textContent = place;
}

function shouldHideMapLocationChip() {
    if (typeof window.canViewDemandHeatmap === "function" && window.canViewDemandHeatmap()) {
        return true;
    }
    const legend = document.getElementById("demand-heatmap-legend");
    return !!legend && !legend.classList.contains("hidden");
}

export function syncMapLocationChipVisibility(forceOpen = null) {
    const chip = document.getElementById("service-zone-map-chip");
    if (!chip) return;

    if (shouldHideMapLocationChip()) {
        chip.classList.add("hidden");
        return;
    }

    const cfg = getZoneConfig();
    const zoneUiEnabled = cfg.enabled && (cfg.allowManualZoneSelection || cfg.alwaysShowZonePicker);
    chip.classList.toggle("hidden", !zoneUiEnabled);
}

export function applyServiceZonePanelState(open) {
    const picker = document.getElementById("service-zone-picker");
    const body = document.getElementById("service-zone-body");
    const toggle = document.getElementById("service-zone-collapse-toggle");
    const collapsedRadius = document.getElementById("client-setup-collapsed-radius");
    if (!picker) return;

    picker.classList.toggle("zone-collapsed", !open);
    document.body.classList.toggle("zone-picker-collapsed", !open);
    if (body) body.classList.toggle("hidden", !open);
    if (collapsedRadius) collapsedRadius.classList.toggle("hidden", open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    syncMapLocationChipVisibility(open);
    updateServiceZoneSummary();
}

export function toggleServiceZonePanel(forceOpen = null) {
    const picker = document.getElementById("service-zone-picker");
    if (!picker || picker.classList.contains("hidden")) return;

    const currentlyOpen = !picker.classList.contains("zone-collapsed");
    const nextOpen = forceOpen === true ? true : forceOpen === false ? false : !currentlyOpen;
    writeZonePanelOpenPreference(nextOpen);
    applyServiceZonePanelState(nextOpen);

    if (nextOpen) {
        document.getElementById("service-zone-select")?.focus?.();
    }
}

function bindServiceZoneCollapseUI() {
    const picker = document.getElementById("service-zone-picker");
    if (!picker || picker.dataset.collapseBound === "1") return;
    picker.dataset.collapseBound = "1";
}

export function initServiceZoneUI() {
    const cfg = getZoneConfig();
    const picker = document.getElementById("service-zone-picker");
    const select = document.getElementById("service-zone-select");
    const search = document.getElementById("service-zone-search");
    const listEl = document.getElementById("service-zone-list");
    const detectBtn = document.getElementById("detect-gps-city-btn");

    if (!picker || !cfg.enabled) return;

    const showPicker = cfg.allowManualZoneSelection || cfg.alwaysShowZonePicker;
    if (!showPicker) {
        picker.classList.add("hidden");
        document.getElementById("service-zone-map-chip")?.classList.add("hidden");
        return;
    }

    picker.classList.add("hidden");
    syncMapLocationChipVisibility();

    // Populate hidden select for compatibility
    if (select) {
        select.innerHTML = buildZoneSelectOptions();
    }

    const currentId = getDefaultZoneId();
    if (select && currentId) select.value = currentId;

    // Initial render of FB-style list
    if (listEl) {
        const curr = currentId;
        renderServiceCityList(listEl, "", curr);
    }

    if (search && listEl) {
        search.oninput = () => {
            const curr = window.activeServiceZoneId || getDefaultZoneId();
            renderServiceCityList(listEl, search.value, curr);
        };
    }

    // Bind detect GPS button (FB "use my location")
    if (detectBtn && !detectBtn._bound) {
        detectBtn._bound = true;
        detectBtn.onclick = async () => {
            const zone = await detectAndSetCityFromGPS();
            if (zone && listEl) {
                const currSearch = search ? search.value : "";
                renderServiceCityList(listEl, currSearch, zone.id);
            }
        };
    }

    bindRadiusControls();
    bindServiceZoneCollapseUI();
    window.activeSearchRadiusKm = getCityCoverageKm();
    updateRadiusUI(window.activeSearchRadiusKm);
    updateZoneHint();
    applyServiceZonePanelState(readZonePanelOpenPreference());
    ensurePassengerCityPickerVisible();
}

export function updateZoneHint() {
    const hint = document.getElementById("service-zone-hint");
    const badge = document.getElementById("driver-zone-badge");
    const currentZoneId = window.activeServiceZoneId || getDefaultZoneId();
    const zone = getZoneById(currentZoneId);

    if (hint) {
        hint.textContent = zone ? `Solo viajes en ${zone.name}` : "Elige tu ciudad operativa";
    }
    if (badge && zone) badge.textContent = zone.name;

    const passengerCityLabel = document.getElementById("passenger-city-label");
    const passengerCityRadius = document.getElementById("passenger-city-radius");
    if (passengerCityLabel && zone) passengerCityLabel.textContent = zone.name;
    if (passengerCityRadius) passengerCityRadius.classList.add("hidden");

    updateServiceZoneSummary();
}

/** Mostrar selector de ciudad (pasajeros y conductores; staff usa flujos propios). */
export function ensurePassengerCityPickerVisible() {
    const cfg = getZoneConfig();
    if (!cfg.enabled) return;

    const picker = document.getElementById("service-zone-picker");
    const bar = document.getElementById("passenger-city-bar");

    if (picker) picker.classList.add("hidden");
    syncMapLocationChipVisibility();
    if (bar) bar.classList.add("hidden");
}

/** Pide elegir ciudad al conductor si aún no guardó una (Marketplace). */
export function promptDriverCityConfirmationIfNeeded() {
    const cfg = getZoneConfig();
    if (!cfg.enabled || window.userProfile?.role !== "driver") return;
    if (window.userProfile?.serviceZoneId) return;

    const zone = getZoneById(window.activeServiceZoneId || getDefaultZoneId());
    if (!zone) return;

    setTimeout(() => {
        window.showToast?.(
            `Elige tu ciudad operativa: ${zone.name}. Solo verás viajes de esa ciudad.`,
            "warning"
        );
        showCityPickerModal();
    }, 900);
}

function dismissBlockingPanels() {
    // El modal va encima (z-50000); solo cerramos paneles que tapen el mapa/panel de viajes.
    window.closeProfilePanel?.();
}

function bindCityModalRadiusChips(modal) {
    modal.querySelector(".city-modal-radius-block")?.classList.add("hidden");
}

/** Modal de ciudad — para conductores y pasajeros (staff tiene sus propios paneles). */
export function showCityPickerModal() {
    const cfg = getZoneConfig();
    if (!cfg.enabled) {
        window.showToast?.("Selector de ciudad no disponible.", "warning");
        return;
    }

    document.getElementById("city-picker-modal")?.remove();
    dismissBlockingPanels();

    const currentId = window.activeServiceZoneId || getDefaultZoneId();
    const currentZone = getZoneById(currentId);
    const deptLabel = currentZone?.department ? `${currentZone.department}` : "Honduras";

    const modal = document.createElement("div");
    modal.id = "city-picker-modal";
    modal.className = "fixed inset-0 z-[50000] flex items-end sm:items-center justify-center p-0 sm:p-5";
    modal.innerHTML = `
        <div class="absolute inset-0 bg-slate-900/75 backdrop-blur-[2px]" data-city-modal-close aria-hidden="true"></div>
        <div class="city-modal-sheet relative bg-white w-full sm:max-w-[420px] max-h-[94dvh] rounded-t-[1.35rem] sm:rounded-[1.35rem] shadow-2xl flex flex-col overflow-hidden">
            <header class="city-modal-header">
                <button type="button" data-city-modal-close class="city-modal-close" aria-label="Cerrar">×</button>
                <h3>Zona operativa</h3>
                <p>HonduRaite · Solo viajes de tu ciudad</p>
            </header>
            <div class="city-modal-body">
                <div class="city-modal-current">
                    <span class="city-modal-current-icon"><i class="fas fa-map-marker-alt"></i></span>
                    <div class="min-w-0">
                        <div id="city-modal-current" class="city-modal-current-name">${currentZone?.name || "Sin elegir"}</div>
                        <div id="city-modal-current-meta" class="city-modal-current-meta">${deptLabel}</div>
                    </div>
                </div>
                <div class="city-modal-search-wrap">
                    <i class="fas fa-search"></i>
                    <input type="search" id="city-modal-search" class="city-modal-search" placeholder="Buscar ciudad o departamento..." autocomplete="off">
                </div>
                <div class="city-modal-actions">
                    <button type="button" id="city-modal-gps" class="city-modal-gps-btn">
                        <i class="fas fa-location-crosshairs"></i>
                        <span>Usar mi ubicación GPS</span>
                    </button>
                </div>
                <div class="city-modal-radius-block hidden" aria-hidden="true">
                    <div class="city-modal-radius-label">
                        <span>Radio de cobertura</span>
                        <span id="city-modal-radius-value"></span>
                    </div>
                    <div id="city-modal-radius-chips" class="city-modal-radius-chips"></div>
                </div>
                <div id="city-modal-list" class="city-modal-list"></div>
                <p class="city-modal-footnote">Los conductores y pasajeros de otras ciudades no verán tus viajes.</p>
            </div>
        </div>
    `;

    const closeModal = () => {
        modal.remove();
        document.body.classList.remove("city-modal-open");
    };

    document.body.appendChild(modal);
    document.body.classList.add("city-modal-open");

    modal.querySelectorAll("[data-city-modal-close]").forEach((el) => {
        el.addEventListener("click", closeModal);
    });

    const listEl = modal.querySelector("#city-modal-list");
    const searchEl = modal.querySelector("#city-modal-search");
    const currentEl = modal.querySelector("#city-modal-current");
    const metaEl = modal.querySelector("#city-modal-current-meta");
    const radiusValueEl = modal.querySelector("#city-modal-radius-value");

    const syncCurrentDisplay = () => {
        const z = getZoneById(window.activeServiceZoneId || currentId);
        if (currentEl && z) currentEl.textContent = z.name;
        if (metaEl && z) metaEl.textContent = z.department;
        if (radiusValueEl) radiusValueEl.textContent = "";
    };

    const refreshList = (term = "") => {
        if (!listEl) return;
        renderServiceCityList(listEl, term, window.activeServiceZoneId || currentId, (zid) => {
            syncCurrentDisplay();
            ensurePassengerCityPickerVisible();
            updateZoneHint();
            updateServiceZoneSummary();
            setTimeout(closeModal, 280);
        });
    };

    bindCityModalRadiusChips(modal);
    refreshList();
    searchEl?.addEventListener("input", () => refreshList(searchEl.value));

    modal.querySelector("#city-modal-gps")?.addEventListener("click", async () => {
        const btn = modal.querySelector("#city-modal-gps");
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = "0.7";
        }
        await detectAndSetCityFromGPS();
        syncCurrentDisplay();
        bindCityModalRadiusChips(modal);
        refreshList(searchEl?.value || "");
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = "";
        }
        setTimeout(closeModal, 450);
    });

    window.showControlPanel?.();
    ensurePassengerCityPickerVisible();

    setTimeout(() => searchEl?.focus?.(), 150);
}

export function openCityPickerPanel() {
    showCityPickerModal();
}

/** Aviso si el origen GPS está más cerca de otra ciudad que la elegida. */
export function getCityMismatchWarning(originCoords, selectedZoneId) {
    if (!originCoords || !selectedZoneId) return null;

    const selected = getZoneById(selectedZoneId);
    const nearest = findNearestZone(originCoords.lat, originCoords.lng);
    if (!selected || !nearest?.zone) return null;

    if (nearest.zone.id === selectedZoneId) return null;

    const distSelected = haversineKm(
        originCoords.lat,
        originCoords.lng,
        selected.center.lat,
        selected.center.lng
    );
    const distNearest = nearest.distanceKm;

    if (distNearest + 8 < distSelected) {
        return `Tu origen parece estar más cerca de ${nearest.zone.name} que de ${selected.name}. Cambia tu ciudad para evitar confusiones.`;
    }

    return null;
}

export function setActiveServiceZone(zoneId, { persist = true, biasMap = true } = {}) {
    const zone = getZoneById(zoneId);
    if (!zone) return null;

    if (persist) setStoredManualZoneId(zoneId);
    window.activeServiceZoneId = zoneId;
    window.activeServiceZone = zone;
    window.activeSearchRadiusKm = getCityCoverageKm(zoneId);

    const select = document.getElementById("service-zone-select");
    if (select && select.value !== zoneId) select.value = zoneId;

    // Refresh FB-style list highlight
    const listEl = document.getElementById("service-zone-list");
    const search = document.getElementById("service-zone-search");
    if (listEl) {
        const f = search ? search.value : "";
        renderServiceCityList(listEl, f, zoneId);
    }

    if (biasMap) applyZoneMapBias(zone, getCityCoverageKm(zoneId));
    updateZoneHint();
    return zone;
}

export async function ensureEndpointCoords(endpoint) {
    if (!endpoint) return null;
    if (endpoint.latLng?.lat != null && endpoint.latLng?.lng != null) {
        return { lat: endpoint.latLng.lat, lng: endpoint.latLng.lng };
    }

    const address = endpoint.address;
    if (!address) return null;

    if (typeof window.geocodeAddressString === "function") {
        const geocoded = await window.geocodeAddressString(address);
        if (geocoded?.latLng) {
            endpoint.latLng = geocoded.latLng;
            if (geocoded.address) endpoint.address = geocoded.address;
            return geocoded.latLng;
        }
    }

    if (!window.geocoder) return null;

    return new Promise((resolve) => {
        window.geocoder.geocode({ address, region: "HN" }, (results, status) => {
            if (status === "OK" && results?.[0]?.geometry?.location) {
                const loc = results[0].geometry.location;
                const coords = {
                    lat: typeof loc.lat === "function" ? loc.lat() : loc.lat,
                    lng: typeof loc.lng === "function" ? loc.lng() : loc.lng,
                };
                endpoint.latLng = coords;
                resolve(coords);
            } else {
                resolve(null);
            }
        });
    });
}

const ONLINE_STALE_MS = 300000; // 5 minutos — más tolerante con móviles en background / PWA

export function isDriverOnline(driverData) {
    if (!driverData || driverData.online === false) return false;
    const updated = driverData.updatedAt || 0;
    return Date.now() - updated <= ONLINE_STALE_MS;
}

/** Conductor visible para el pasajero: misma ciudad + dentro de la cobertura municipal. */
export function isDriverVisibleToClient(driverData, zoneId, _radiusKm = null) {
    if (!driverData?.lat || !driverData?.lng || !zoneId) return false;
    const zone = getZoneById(zoneId);
    if (!zone) return false;

    if (driverData.serviceZoneId && driverData.serviceZoneId !== zoneId) return false;

    const coverage = getCityCoverageKm(zoneId);
    return haversineKm(driverData.lat, driverData.lng, zone.center.lat, zone.center.lng) <= coverage;
}

/** Municipios que comparten área operativa con la ciudad hub (mismo departamento). */
export function getZoneClusterIds(zoneId) {
    const hub = getZoneById(zoneId);
    if (!hub) return zoneId ? [zoneId] : [];
    const cfg = getZoneConfig();
    if (cfg.zoneClusters?.[zoneId]?.length) {
        return cfg.zoneClusters[zoneId];
    }
    return getServiceZones()
        .filter((z) => z.department === hub.department)
        .map((z) => z.id);
}

const ZONE_MATCH_BUFFER_KM = 6;
const ZONE_METRO_MAX_KM = 55;

/**
 * ¿El punto pertenece al área de la ciudad elegida?
 * Tolera barrios alejados del centro, geocodificación imprecisa y municipios del mismo departamento.
 */
export function pointMatchesSelectedZone(coords, selectedZoneId) {
    if (!coords || coords.lat == null || coords.lng == null || !selectedZoneId) return null;

    const selected = getZoneById(selectedZoneId);
    if (!selected) return null;

    if (!isInsideHondurasProximity(coords.lat, coords.lng)) return false;

    const clusterIds = getZoneClusterIds(selectedZoneId);
    const hubCoverage = getCityCoverageKm(selectedZoneId);

    const distHub = haversineKm(coords.lat, coords.lng, selected.center.lat, selected.center.lng);
    if (distHub <= hubCoverage + ZONE_MATCH_BUFFER_KM) return true;
    if (distHub <= ZONE_METRO_MAX_KM) return true;

    for (const zid of clusterIds) {
        const z = getZoneById(zid);
        if (!z) continue;
        const cov = getCityCoverageKm(zid);
        const d = haversineKm(coords.lat, coords.lng, z.center.lat, z.center.lng);
        if (d <= cov + ZONE_MATCH_BUFFER_KM) return true;
    }

    const detected = findZoneForCoords(coords.lat, coords.lng, hubCoverage + ZONE_MATCH_BUFFER_KM);
    if (detected && clusterIds.includes(detected.id)) return true;

    const nearest = findNearestZone(coords.lat, coords.lng);
    if (nearest?.zone?.id === selectedZoneId) return true;
    if (nearest?.zone && clusterIds.includes(nearest.zone.id)) {
        const nearestCov = getCityCoverageKm(nearest.zone.id);
        if (nearest.distanceKm <= nearestCov + ZONE_MATCH_BUFFER_KM) return true;
    }
    if (nearest?.zone?.department === selected.department && nearest.distanceKm <= ZONE_METRO_MAX_KM) {
        return true;
    }

    return false;
}

export function resolveTripServiceZone(originCoords, zoneId = null, destCoords = null, opts = {}) {
    const cfg = getZoneConfig();
    if (!cfg.enabled) return { zone: null, radiusKm: getCityCoverageKm(zoneId), error: null };

    const explicitId = zoneId || window.activeServiceZoneId || getDefaultZoneId();
    let zone = getZoneById(explicitId);

    if (!zone) {
        zone = getZoneById(getDefaultZoneId()) || getServiceZones()[0] || null;
    }

    if (!zone) {
        return {
            zone: null,
            radiusKm: getCityCoverageKm(explicitId),
            error: "Selecciona una ciudad de Honduras para tu viaje."
        };
    }

    const coverage = getCityCoverageKm(zone.id);
    const routeKm = Number(opts.routeKm) || 0;
    const routeValidated = opts.routeValidated === true;

    // Ruta ya calculada y visible en el mapa → no bloquear el pedido por ciudad
    if (routeValidated && routeKm > 0 && routeKm <= 200 && originCoords) {
        const okOrigin = isInsideHondurasProximity(originCoords.lat, originCoords.lng);
        const okDest = !destCoords || isInsideHondurasProximity(destCoords.lat, destCoords.lng);
        if (okOrigin && okDest) {
            return { zone, radiusKm: coverage, error: null };
        }
    }

    const originInCity = originCoords ? pointMatchesSelectedZone(originCoords, zone.id) : null;
    const destInCity = destCoords ? pointMatchesSelectedZone(destCoords, zone.id) : null;

    if (originInCity === false) {
        const nearest = findNearestZone(originCoords.lat, originCoords.lng);
        const hint = nearest?.zone && nearest.zone.id !== zone.id
            ? ` Parece más cerca de ${nearest.zone.name}.`
            : '';
        return {
            zone: null,
            radiusKm: coverage,
            error: `No pudimos ubicar el origen dentro de ${zone.name}.${hint} Verifica la dirección o elige otra ciudad.`,
        };
    }

    if (destInCity === false) {
        const nearest = findNearestZone(destCoords.lat, destCoords.lng);
        const hint = nearest?.zone && nearest.zone.id !== zone.id
            ? ` Parece más cerca de ${nearest.zone.name}.`
            : '';
        return {
            zone: null,
            radiusKm: coverage,
            error: `No pudimos ubicar el destino dentro de ${zone.name}.${hint} Corrige la entrega o elige otra ciudad.`,
        };
    }

    return { zone, radiusKm: coverage, error: null };
}

/** Pide confirmar ciudad la primera vez (estilo Marketplace). */
export function promptCityConfirmationIfNeeded() {
    const cfg = getZoneConfig();
    if (!cfg.enabled || !isPassengerAppRole(window.userProfile)) return;

    const stored = getStoredManualZoneId();
    if (stored) return;

    const zone = getZoneById(window.activeServiceZoneId || getDefaultZoneId());
    if (!zone) return;

    setTimeout(() => {
        window.showToast?.(
            `Confirma tu ciudad: ${zone.name}. Toca «CAMBIAR» si no es correcta.`,
            "warning"
        );
        showCityPickerModal();
    }, 1200);
}

if (typeof window !== "undefined") {
    window.showCityPickerModal = showCityPickerModal;
    window.openCityPicker = showCityPickerModal;
    window.syncMapLocationChipVisibility = syncMapLocationChipVisibility;
}