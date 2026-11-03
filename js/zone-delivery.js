/**
 * Envío de restaurante «sin destino» (se cobra por zona al entregar).
 *  - Hoja del repartidor al tocar «Pedido entregado»: zona + cobro + «¿Cuánto cobrarías hasta aquí?» (opcional,
 *    solo datos internos: riderSuggestedFee, nunca cambia el precio).
 *  - Supervisión «Envíos por zona»: punto en el mapa, zona, precio, sugerido y diferencia + promedios por zona.
 * HTML puro (sin Firebase) → probado en scripts/test-pedir-envio-tienda.mjs.
 */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `L. ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tsMs = (v) => (v == null ? 0 : typeof v === 'number' ? v : v.toMillis ? v.toMillis() : v.seconds ? v.seconds * 1000 : (Date.parse(v) || 0));

export function isZoneBillingTrip(t) { return !!t && (t.zoneBilling === true || t.deliveryDetails?.zoneBilling === true); }
export const zoneLabel = (t) => t.deliveryZoneName || (t.zoneFeeAtMs ? 'Fuera de zona (por km)' : 'Calculando…');

export const ZONE_DELIVERY_CSS = `
.zd-ov{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center}
.zd-sheet{background:#fff;width:100%;max-width:480px;border-radius:20px 20px 0 0;padding:18px 16px 22px;font-family:inherit;color:#0f172a;box-shadow:0 -8px 30px rgba(0,0,0,.25)}
.zd-ok{width:54px;height:54px;border-radius:999px;background:#dcfce7;color:#15803d;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 8px}
.zd-h{font-size:18px;font-weight:900;text-align:center;margin:0}
.zd-zone{text-align:center;color:#9a3412;font-weight:800;font-size:13px;margin:4px 0 10px}
.zd-fee{background:linear-gradient(135deg,#065f46,#047857);color:#fff;border-radius:16px;padding:14px;text-align:center}
.zd-fee b{display:block;font-size:30px;font-weight:900}
.zd-fee span{font-size:13px;font-weight:700;opacity:.95}
.zd-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:8px;font-size:12px;margin-top:8px}
.zd-q{margin-top:14px;border:1px dashed #cbd5e1;border-radius:14px;padding:10px}
.zd-q label{font-size:13px;font-weight:800;display:block}
.zd-q small{display:block;color:#64748b;font-size:11px;margin:2px 0 6px}
.zd-q .row{display:flex;gap:6px}
.zd-q input{flex:1;min-width:0;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font-size:16px;font-family:inherit}
.zd-btn{border:0;border-radius:12px;padding:10px 14px;font-weight:900;font-size:14px;background:#0c4a8e;color:#fff}
.zd-btn.ghost{background:#f1f5f9;color:#334155;width:100%;margin-top:10px;padding:12px}
.zd-wait{text-align:center;color:#64748b;font-size:14px;padding:18px 0}
.zv-root{font-family:inherit;color:#0f172a;display:flex;flex-direction:column;gap:10px}
.zv-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:10px}
.zv-card h4{margin:0 0 6px;font-size:14px;font-weight:900}
.zv-stats{width:100%;border-collapse:collapse;font-size:12px}
.zv-stats th,.zv-stats td{padding:5px 4px;border-bottom:1px solid #f1f5f9;text-align:left}
.zv-stats td.n,.zv-stats th.n{text-align:right}
.zv-row{display:flex;gap:10px;border-top:1px solid #f1f5f9;padding:10px 0}
.zv-row:first-of-type{border-top:0}
.zv-map{width:112px;height:96px;border:0;border-radius:10px;flex:none;background:#e2e8f0}
.zv-body{min-width:0;flex:1;font-size:12px;line-height:1.45}
.zv-body b.z{font-size:13.5px;color:#9a3412}
.zv-pill{display:inline-block;font-size:10.5px;font-weight:800;border-radius:999px;padding:1px 7px;background:#f1f5f9;margin-left:4px}
.zv-up{color:#b91c1c}.zv-down{color:#047857}
.zv-flag{background:#fef2f2;color:#b91c1c}
`;

/** Hoja del repartidor. trip sin zoneFeeAtMs → «Calculando tu cobro…». */
export function zoneDeliveryResultSheetHtml(t = {}, { saved = false } = {}) {
    if (t.zoneFeeAtMs == null) {
        return `<div class="zd-sheet" data-zd-sheet="pending"><div class="zd-ok"><i class="fas fa-check"></i></div>
            <p class="zd-h">Pedido entregado</p><div class="zd-wait"><i class="fas fa-spinner fa-spin"></i> Calculando tu cobro según la zona…</div>
            <button type="button" class="zd-btn ghost" data-zd="close">Cerrar</button></div>`;
    }
    const zone = t.deliveryZoneName ? `Entregado en ${esc(t.deliveryZoneName)}` : `Entregado fuera de zona · ${esc(t.zoneDropoffKm ?? t.tripDistanceKm ?? '')} km`;
    const sug = t.riderSuggestedFee != null;
    return `<div class="zd-sheet" data-zd-sheet="done"><div class="zd-ok"><i class="fas fa-check"></i></div>
        <p class="zd-h">${zone}</p>
        <p class="zd-zone">${t.deliveryZoneName ? 'Tarifa de la zona' : 'Cobro por kilómetro'}</p>
        <div class="zd-fee" data-zd-fee><span>Tu cobro es</span><b>${money(t.priceNum)}</b><span>Cobráselo al cliente en efectivo</span></div>
        ${t.dropoffAccuracyPoor ? '<div class="zd-warn"><i class="fas fa-satellite-dish"></i> Tu GPS estaba impreciso; un supervisor puede revisar este envío.</div>' : ''}
        <div class="zd-q" data-zd-question>
            <label for="zd-sug">¿Cuánto cobrarías hasta aquí? <span style="font-weight:600;color:#64748b">(opcional)</span></label>
            <small>Solo para mejorar las tarifas. No cambia lo que cobrás hoy.</small>
            ${sug || saved ? `<div style="font-weight:800;color:#047857;font-size:13px"><i class="fas fa-check"></i> ¡Gracias! Guardamos ${money(t.riderSuggestedFee)}</div>`
                : `<div class="row"><input id="zd-sug" inputmode="decimal" placeholder="L. 0.00" data-zd-sug><button type="button" class="zd-btn" data-zd="save">Enviar</button></div>`}
        </div>
        <button type="button" class="zd-btn ghost" data-zd="close">Listo</button></div>`;
}

/** Muestra la hoja y escucha el viaje hasta que el servidor pone el precio. deps: { subscribe(tripId, cb) → unsub, saveSuggested(tripId, n) } */
export function showZoneDeliveryResult(tripId, deps = {}) {
    if (!tripId || typeof document === 'undefined') return;
    if (!document.getElementById('zd-css')) { const s = document.createElement('style'); s.id = 'zd-css'; s.textContent = ZONE_DELIVERY_CSS; document.head.appendChild(s); }
    document.querySelector('[data-zd-ov]')?.remove();
    const ov = document.createElement('div'); ov.className = 'zd-ov'; ov.setAttribute('data-zd-ov', tripId);
    document.body.appendChild(ov);
    let trip = { id: tripId }; let unsub = null; let saved = false;
    const draw = () => { const v = ov.querySelector('[data-zd-sug]')?.value; ov.innerHTML = zoneDeliveryResultSheetHtml(trip, { saved }); const i = ov.querySelector('[data-zd-sug]'); if (i && v) i.value = v; };
    const close = () => { try { unsub?.(); } catch (_) {} ov.remove(); };
    draw();
    try { unsub = deps.subscribe ? deps.subscribe(tripId, (t) => { if (!t) return; const priced = trip.zoneFeeAtMs == null && t.zoneFeeAtMs != null; trip = { ...trip, ...t }; if (priced || t.zoneFeeAtMs == null) draw(); }) : null; } catch (_) {}
    ov.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-zd]'); if (!b) return;
        if (b.dataset.zd === 'close') return close();
        if (b.dataset.zd === 'save') {
            const n = Math.round(Number(String(ov.querySelector('[data-zd-sug]')?.value || '').replace(/[^\d.]/g, '')) * 100) / 100;
            if (!(n > 0 && n <= 5000)) return window.showToast?.('Escribe un monto entre L. 1 y L. 5,000', 'warning');
            b.disabled = true;
            try { await deps.saveSuggested?.(tripId, n); saved = true; trip = { ...trip, riderSuggestedFee: n }; draw(); }
            catch (e) { b.disabled = false; window.showToast?.('No se pudo guardar. Intenta de nuevo.', 'error'); }
        }
    });
    return { close, el: ov };
}

/** Promedios por zona: precio cobrado vs sugerido por el repartidor. */
export function zoneDeliveryStats(trips = []) {
    const by = new Map();
    for (const t of trips) {
        if (!isZoneBillingTrip(t) || t.status !== 'completed' || t.zoneFeeAtMs == null) continue;
        const k = t.deliveryZoneId || '__outside';
        const r = by.get(k) || { zoneId: t.deliveryZoneId || null, zoneName: t.deliveryZoneName || 'Fuera de zona (por km)', count: 0, sumFee: 0, nSug: 0, sumSug: 0, sumSugFee: 0 };
        r.count += 1; r.sumFee += Number(t.priceNum) || 0;
        const s = Number(t.riderSuggestedFee);
        if (t.riderSuggestedFee != null && Number.isFinite(s)) { r.nSug += 1; r.sumSug += s; r.sumSugFee += Number(t.priceNum) || 0; }
        by.set(k, r);
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    return [...by.values()].map((r) => ({
        zoneId: r.zoneId, zoneName: r.zoneName, count: r.count, suggestedCount: r.nSug,
        avgFee: r2(r.sumFee / r.count),
        avgSuggested: r.nSug ? r2(r.sumSug / r.nSug) : null,
        avgDiff: r.nSug ? r2((r.sumSug - r.sumSugFee) / r.nSug) : null,
    })).sort((a, b) => b.count - a.count);
}

const mapSrc = (lat, lng) => `https://maps.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}&z=15&output=embed`;
const TZ = 'America/Tegucigalpa';
const when = (ms) => (ms ? new Date(ms).toLocaleString('es-HN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Vista «Envíos por zona» (admin/supervisor). opts.noMap → sin iframes (capturas/pruebas). */
export function zoneDeliveriesViewHtml(trips = [], { noMap = false } = {}) {
    const list = trips.filter(isZoneBillingTrip).sort((a, b) => (tsMs(b.completedAt) || tsMs(b.createdAt)) - (tsMs(a.completedAt) || tsMs(a.createdAt)));
    const stats = zoneDeliveryStats(list);
    const statsHtml = stats.length ? `<table class="zv-stats" data-zv-stats><tr><th>Zona</th><th class="n">Envíos</th><th class="n">Cobrado prom.</th><th class="n">Sugerido prom.</th><th class="n">Dif.</th></tr>
        ${stats.map((s) => `<tr><td>${esc(s.zoneName)}</td><td class="n">${s.count}</td><td class="n">${money(s.avgFee)}</td><td class="n">${s.avgSuggested == null ? '—' : money(s.avgSuggested)}</td>
        <td class="n ${s.avgDiff > 0 ? 'zv-up' : s.avgDiff < 0 ? 'zv-down' : ''}">${s.avgDiff == null ? '—' : `${s.avgDiff > 0 ? '+' : ''}${money(s.avgDiff)}`}</td></tr>`).join('')}</table>`
        : '<p style="color:#64748b;font-size:12px;margin:0">Todavía no hay envíos entregados.</p>';
    const rows = list.map((t) => {
        const hasPt = Number.isFinite(Number(t.dropoffLat)) && t.dropoffLat != null;
        const sug = t.riderSuggestedFee != null ? Number(t.riderSuggestedFee) : null;
        const diff = sug != null && t.zoneFeeAtMs != null ? Math.round((sug - (Number(t.priceNum) || 0)) * 100) / 100 : null;
        const map = hasPt ? (noMap ? `<div class="zv-map" style="display:flex;align-items:center;justify-content:center;color:#475569;font-size:11px;text-align:center"><i class="fas fa-location-dot" style="color:#dc2626;font-size:22px"></i></div>`
            : `<iframe class="zv-map" loading="lazy" src="${esc(mapSrc(t.dropoffLat, t.dropoffLng))}" title="Punto de entrega"></iframe>`)
            : '<div class="zv-map" style="display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px">Sin punto</div>';
        const st = t.status === 'completed' ? (t.zoneFeeAtMs != null ? 'Entregado' : 'Calculando') : t.status === 'cancelled' ? 'Cancelado' : 'En curso';
        return `<div class="zv-row" data-zv-trip="${esc(t.id)}">${map}<div class="zv-body">
            <b class="z">${esc(t.zoneFeeAtMs != null ? zoneLabel(t) : '—')}</b><span class="zv-pill">${st}</span>${t.dropoffAccuracyPoor ? '<span class="zv-pill zv-flag">GPS impreciso</span>' : ''}
            <div>Cobrado: <b>${t.zoneFeeAtMs != null ? money(t.priceNum) : '—'}</b> · Sugerido: <b>${sug == null ? '—' : money(sug)}</b>${diff == null ? '' : ` <span class="${diff > 0 ? 'zv-up' : diff < 0 ? 'zv-down' : ''}">(${diff > 0 ? '+' : ''}${money(diff)})</span>`}</div>
            <div><i class="fas fa-store"></i> ${esc(t.merchantName || t.deliveryDetails?.storeName || 'Tienda')} · <i class="fas fa-motorcycle"></i> ${esc(t.driverName || '—')}</div>
            <div style="color:#64748b">${esc(when(tsMs(t.completedAt) || t.dropoffAtMs || tsMs(t.createdAt)))}${hasPt ? ` · <a href="https://maps.google.com/?q=${Number(t.dropoffLat)},${Number(t.dropoffLng)}" target="_blank" rel="noopener">Ver en mapa</a>` : ''}${t.dropoffAccuracyM != null ? ` · GPS ±${Math.round(t.dropoffAccuracyM)} m` : ''}</div>
        </div></div>`;
    }).join('');
    return `<div class="zv-root" data-zv-root>
        <div class="zv-card"><h4><i class="fas fa-chart-column"></i> Promedio por zona: cobrado vs sugerido</h4>${statsHtml}</div>
        <div class="zv-card"><h4><i class="fas fa-map-location-dot"></i> Envíos por zona (${list.length})</h4>${rows || '<p style="color:#64748b;font-size:12px;margin:0">Sin envíos sin destino todavía.</p>'}</div>
    </div>`;
}
