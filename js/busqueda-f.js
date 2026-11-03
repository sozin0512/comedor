/* v.39 — Búsqueda opción F: mapa inclinado, conductores viendo como carro/moto, panel oscuro abajo. */
(function () {
    'use strict';
    const EYE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    const CAR = '<svg width="26" height="42" viewBox="0 0 34 54"><rect x="3" y="2" width="28" height="50" rx="10" fill="#f8fafc" stroke="#0f172a" stroke-width="1.5"/><rect x="7" y="12" width="20" height="10" rx="3" fill="#0b1f17" opacity=".75"/><rect x="7" y="34" width="20" height="8" rx="3" fill="#0b1f17" opacity=".6"/></svg>';
    const MOTO = '<svg width="18" height="40" viewBox="0 0 22 48"><rect x="8" y="0" width="6" height="12" rx="3" fill="#111"/><rect x="8" y="36" width="6" height="12" rx="3" fill="#111"/><rect x="4" y="10" width="14" height="28" rx="7" fill="#e11d48"/><circle cx="11" cy="22" r="5" fill="#fde68a"/></svg>';
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isMoto = (t) => /moto/i.test(String(t || ''));
    const R = 6371;
    function km(a, b) {
        const r = (x) => x * Math.PI / 180;
        const dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
        const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    function bearingPoint(o, bearingDeg, dKm) {
        const d = dKm / R, b = bearingDeg * Math.PI / 180, la = o.lat * Math.PI / 180, lo = o.lng * Math.PI / 180;
        const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
        const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
        return { lat: la2 * 180 / Math.PI, lng: lo2 * 180 / Math.PI };
    }
    function angleTo(from, to) {
        const y = to.lng - from.lng, x = to.lat - from.lat;
        return Math.atan2(y, x) * 180 / Math.PI;
    }

    let overlays = [];
    let active = false;
    let usedCssTilt = false;
    let lastData = null;

    function makeOverlay(pos, html, cls) {
        if (!window.google?.maps?.OverlayView || !window.gMap) return null;
        const ov = new google.maps.OverlayView();
        const el = document.createElement('div');
        el.className = cls;
        el.innerHTML = html;
        ov.onAdd = function () { this.getPanes().overlayMouseTarget.appendChild(el); };
        ov.draw = function () {
            const p = this.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(pos.lat, pos.lng));
            if (p) { el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
        };
        ov.onRemove = function () { el.remove(); };
        ov.setMap(window.gMap);
        return ov;
    }
    function clearOverlays() { overlays.forEach((o) => { try { o.setMap(null); } catch (_) {} }); overlays = []; }

    function origin(data) {
        const lat = Number(data?.originLat), lng = Number(data?.originLng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    }

    function viewers(data) {
        try { return (window.hrNormalizeTripViewedBy || (() => []))(data?.viewedBy); } catch (_) { return []; }
    }

    function renderMap(data) {
        clearOverlays();
        const o = origin(data);
        if (!o) return;
        overlays.push(makeOverlay(o, '<span></span><span></span><span></span><i></i>', 'hr-f-radar'));
        const list = viewers(data);
        const pts = [];
        list.forEach((v, i) => {
            let pos = (v.lat != null && v.lng != null) ? { lat: v.lat, lng: v.lng } : null;
            const isOffered = data.offeredToDriverId && v.driverId === data.offeredToDriverId;
            let d = pos ? km(o, pos) : (isOffered && data.offerDistanceKm != null ? Number(data.offerDistanceKm) : null);
            if (!pos) pos = bearingPoint(o, (i * 137 + 40) % 360, Math.min(0.45, Math.max(0.22, (d || 1) / 12)));
            pts.push(pos);
            const rot = angleTo(pos, o);
            const first = esc(String(v.name || 'Conductor').split(' ')[0]);
            const label = `<b class="hr-f-tag">${EYE}${first}${d != null && Number.isFinite(d) ? ' · ' + d.toFixed(1) + ' km' : ''}</b>`;
            overlays.push(makeOverlay(pos, `<div class="hr-f-veh" style="transform:rotate(${rot.toFixed(0)}deg)">${isMoto(v.vehicleType) ? MOTO : CAR}</div>${label}`, 'hr-f-driver'));
        });
        overlays = overlays.filter(Boolean);
        // Encajar pasajero + conductores (una vez por cambio de cantidad), dejando espacio al panel de abajo
        try {
            const sig = list.length;
            if (window.__hrFFitSig !== sig) {
                window.__hrFFitSig = sig;
                if (!pts.length) { window.gMap.panTo(o); }
                else {
                    const b = new google.maps.LatLngBounds(); b.extend(o); pts.forEach((p) => b.extend(p));
                    window.gMap.fitBounds(b, { top: 140, left: 110, right: 110, bottom: 320 });
                    google.maps.event.addListenerOnce(window.gMap, 'idle', () => { if ((window.gMap.getZoom() || 0) > 16) window.gMap.setZoom(16); });
                }
            }
        } catch (_) {}
    }

    // v.40: inclinación por CSS siempre (en iPhone el tilt vectorial de Google se anula al alejar el zoom).
    function setTilt(on) {
        const mapEl = document.getElementById('map');
        try {
            if (on) { usedCssTilt = true; mapEl?.classList.add('hr-f-css-tilt'); }
            else { mapEl?.classList.remove('hr-f-css-tilt'); usedCssTilt = false; }
        } catch (_) {}
    }

    // v.40: mientras se busca, el panel siempre abierto (ignora «Minimizar» / estado guardado).
    const PANEL_CLS = ['panel-hidden', 'panel-minimized', 'panel-collapsed'];
    let panelObs = null;
    function forcePanelOpen() {
        const panel = document.getElementById('control-panel');
        PANEL_CLS.forEach((c) => {
            if (document.body.classList.contains(c)) document.body.classList.remove(c);
            if (panel?.classList.contains(c)) panel.classList.remove(c);
        });
    }
    function watchPanel(on) {
        if (panelObs) { panelObs.disconnect(); panelObs = null; }
        if (!on) return;
        forcePanelOpen();
        panelObs = new MutationObserver(() => { if (active) forcePanelOpen(); });
        panelObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        const panel = document.getElementById('control-panel');
        if (panel) panelObs.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }

    function paintPanel(data) {
        const n = viewers(data).length;
        const pill = document.getElementById('hr-f-pill');
        if (pill) { pill.innerHTML = `${EYE}<b class="hr-f-n">${n}</b><span>&nbsp;viendo</span>`; pill.classList.toggle('hr-f-pill--zero', n === 0); }
        const boost = document.getElementById('passenger-boost-price-panel');
        const btn = document.getElementById('hr-f-boost-btn');
        if (btn) btn.classList.toggle('hidden', !boost || boost.classList.contains('hidden'));
        const sub = document.getElementById('hr-f-sub');
        if (sub) sub.textContent = n > 0 ? 'Ya están viendo tu solicitud. Te avisamos apenas uno acepte' : 'Te avisamos apenas uno acepte';
    }

    // v.41: sacar #searching-state del #control-panel (en iOS el panel colapsado/scroll lo recortaba a una tira).
    let stHome = null;
    function portal(on) {
        const st = document.getElementById('searching-state');
        if (!st) return;
        try {
            if (on && st.parentElement !== document.body) {
                stHome = document.createComment('hr-f-home');
                st.parentElement.insertBefore(stHome, st);
                document.body.appendChild(st);
            } else if (!on && stHome && stHome.parentNode) {
                stHome.parentNode.insertBefore(st, stHome);
                stHome.remove(); stHome = null;
            }
        } catch (_) {}
    }
    function enter() {
        if (active) return;
        active = true;
        portal(true);
        window.__hrFFitSig = null;
        document.body.classList.add('hr-search-f');
        watchPanel(true);
        setTilt(true);
    }
    function exit() {
        if (!active) return;
        active = false;
        watchPanel(false);
        document.body.classList.remove('hr-search-f');
        portal(false);
        closeBoost();
        clearOverlays();
        setTilt(false);
    }

    function openBoost() {
        const boost = document.getElementById('passenger-boost-price-panel');
        if (!boost || boost.classList.contains('hidden')) { window.raisePendingTripPrice?.({ delta: 10 }); return; }
        document.body.classList.add('hr-f-boost-open');
    }
    function closeBoost() { document.body.classList.remove('hr-f-boost-open'); }

    function isPending(d) { return !!(d && d.status === 'pending' && !d.driverId); }
    function update(data) {
        if (data) lastData = data;
        data = lastData;
        const st = document.getElementById('searching-state');
        const visible = st && !st.classList.contains('hidden');
        // v.41: también vale body.is-searching (viaje restaurado tras recargar con el panel en «Maximizar»)
        const searching = visible || document.body.classList.contains('is-searching');
        if (!searching || !isPending(data)) { exit(); return; }
        if (st && st.classList.contains('hidden')) st.classList.remove('hidden');
        enter();
        paintPanel(data);
        renderMap(data);
    }

    function init() {
        const st = document.getElementById('searching-state');
        if (!st) return;
        new MutationObserver(() => {
            if (st.classList.contains('hidden')) exit();
            else if (lastData) update(lastData);
        }).observe(st, { attributes: true, attributeFilter: ['class'] });
        // v.41: reaccionar a is-searching y al viaje guardado aunque updateSearchingStatusUI no llame
        const resync = () => {
            const live = window.currentActiveTripData;
            const d = isPending(live) ? live : lastData;
            if (document.body.classList.contains('is-searching') && isPending(d)) { if (!active || d !== lastData) update(d); }
            else if (active && !document.body.classList.contains('is-searching')) exit();
        };
        new MutationObserver(resync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        setInterval(resync, 1500);
        document.addEventListener('click', (e) => {
            if (e.target.closest('#hr-f-boost-btn')) { openBoost(); return; }
            if (e.target.closest('#hr-f-cancel-btn')) { document.getElementById('searching-cancel-btn')?.click(); return; }
            if (e.target.closest('#hr-f-boost-close') || e.target.id === 'hr-f-backdrop') { closeBoost(); return; }
            // Tras elegir un monto, cerrar el popup (la lógica existente sube el precio)
            if (document.body.classList.contains('hr-f-boost-open') && e.target.closest('#passenger-boost-price-panel [data-trip-action]')) {
                setTimeout(closeBoost, 150);
            }
        });
    }
    window.hrSearchF = { update, openBoost, closeBoost, exit };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
