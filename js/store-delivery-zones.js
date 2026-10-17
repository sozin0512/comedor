/**
 * Tiendas · tarifa de envío por zona.
 * - Pestaña «Envíos» del panel de la tienda: por cada zona activa de su ciudad elige
 *   «usar tarifa base» o «mi tarifa» (dentro del mínimo/máximo que fija HonduRaite).
 * - Confirmar pedido: muestra «Envío a <zona>: L X» (cotiza el servidor).
 * El monto que queda en el pedido lo pone SIEMPRE el servidor (onStoreOrderCreatedZoneFee).
 */
import { collection, doc, getDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { esc, money, rangeLabel, validateStoreFee, effectiveFee, zoneColor, zonesSvg } from './delivery-zones-shared.js?v=2026.10.17.1';

const FN_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
export const ZONE_FEE_SOURCES = ['zone_base', 'store_custom'];
let DEPS = {};

function ensureCss() {
    if (typeof document === 'undefined' || document.getElementById('tz-css')) return;
    const l = document.createElement('link');
    l.id = 'tz-css'; l.rel = 'stylesheet';
    const v = (window.APP_CONFIG && window.APP_CONFIG.appVersion) || '';
    l.href = `css/tiendas-zonas.css${v ? `?v=${v}` : ''}`;
    document.head.appendChild(l);
}
async function callFn(name, data) {
    if (DEPS.callFn) return DEPS.callFn(name, data);
    const { httpsCallable } = await import(FN_URL);
    const res = await httpsCallable(DEPS.functions || window.cloudFunctions, name)(data);
    return res?.data ?? res;
}
function toast(msg, type) { try { (DEPS.toast || window.showToast)?.(msg, type); } catch (_) {} }
const pub = (c) => collection(DEPS.db, 'artifacts', DEPS.appId, 'public', 'data', c);
const fmtWhen = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: 'America/Tegucigalpa' }).replace('.', '')}, ${d.toLocaleTimeString('es-HN', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Tegucigalpa' })}`;
};

export function configureStoreZones(deps = {}) {
    DEPS = { ...DEPS, ...deps };
    if (typeof document !== 'undefined' && !window.__szCheckoutBound) {
        window.__szCheckoutBound = true;
        document.addEventListener('click', (e) => {
            const b = e.target.closest('[data-sz-checkout]');
            if (!b) return;
            const a = b.getAttribute('data-sz-checkout');
            if (a === 'gps') useGpsForCheckout();
            if (a === 'retry') refreshCheckoutQuote(true);
        });
    }
}

// ───────────────────────── Pestaña «Envíos» (dueño) ─────────────────────────
const T = { storeId: null, store: null, zones: [], saved: {}, draft: {}, meta: {}, loading: false, saving: false, error: '' };

export function merchantZonesHtml(st = T) {
    const s = st.store || {};
    const zones = st.zones || [];
    if (st.loading) return '<div class="tz-root tz-merchant"><div class="tz-card tz-mut">Cargando zonas…</div></div>';
    if (st.error) return `<div class="tz-root tz-merchant"><div class="tz-card tz-errbox">${esc(st.error)}</div></div>`;
    const city = s.cityName || s.cityId || 'tu ciudad';
    if (!zones.length) {
        return `<div class="tz-root tz-merchant"><div class="tz-info">HonduRaite todavía no tiene zonas de envío activas en ${esc(city)}. Por ahora el envío se calcula por distancia al despachar (como siempre).</div></div>`;
    }
    const errs = {};
    const rows = zones.map((z, i) => {
        const set = st.draft[z.id] || { mode: 'base', fee: null };
        const err = validateStoreFee(z, set.mode, set.fee);
        if (err) errs[z.id] = err;
        const eff = effectiveFee(z, set);
        const custom = set.mode === 'custom';
        const result = custom && err
            ? `<span class="tz-tag bad">${set.fee === '' || set.fee == null ? 'Sin monto' : `${esc(money(set.fee))} no válido`} · queda la base</span>`
            : '<span class="tz-tag ok">OK</span>';
        return `<div class="tz-feerow" style="--zc:${zoneColor(z, i)}">
            <div class="tz-feename"><i class="tz-dot"></i><div><b>${esc(z.name)}</b><small>Base ${esc(money(z.baseFee))} · ${esc(rangeLabel(z))}</small></div></div>
            <div class="tz-feectl">
                <div class="tz-seg" role="group">
                    <button type="button" class="${!custom ? 'on' : ''}" data-sz="mode" data-zone="${esc(z.id)}" data-mode="base">Usar tarifa base</button>
                    <button type="button" class="${custom ? 'on' : ''}" data-sz="mode" data-zone="${esc(z.id)}" data-mode="custom">Mi tarifa</button>
                </div>
                <span class="tz-inp tz-money ${custom && err ? 'err' : ''} ${!custom ? 'off' : ''}"><i>L</i><input inputmode="decimal" data-sz-fee="${esc(z.id)}" value="${esc(custom ? (set.fee ?? '') : z.baseFee)}" ${!custom ? 'disabled' : ''} aria-label="Tarifa en ${esc(z.name)}"></span>
                ${custom && err ? `<em class="tz-err">${esc(err)} (lo fija HonduRaite)</em>` : ''}
            </div>
            <div class="tz-feesee"><small>El cliente ve</small><span class="tz-num">${esc(money(eff.fee))}</span>${result}</div>
        </div>`;
    }).join('');
    const dirty = JSON.stringify(st.draft) !== JSON.stringify(st.saved);
    const hasErr = Object.keys(errs).length > 0;
    const first = zones[0];
    const firstEff = effectiveFee(first, st.draft[first.id]);
    const last = st.meta?.updatedAtMs ? `Último cambio: ${esc(fmtWhen(st.meta.updatedAtMs))}${st.meta.updatedByName ? ` · por ${st.meta.updatedBy === DEPS.getCurrentUser?.()?.uid ? 'ti' : esc(st.meta.updatedByName)}` : ''}` : 'Todavía usas la tarifa base en todas las zonas.';
    return `<div class="tz-root tz-merchant">
        <div class="tz-mcols">
            <div class="tz-card">
                <div class="tz-info">HonduRaite define las zonas de ${esc(city)}. Tú eliges cuánto cobras en cada una: la <b>tarifa base</b> o <b>tu tarifa</b> dentro del rango permitido. Lo cobra el conductor al entregar.</div>
                <div class="tz-sec"><h3>Tarifas de envío por zona</h3><span class="tz-small tz-mut">${zones.length} ${zones.length === 1 ? 'zona activa' : 'zonas activas'} en ${esc(city)}</span></div>
                ${rows}
                <div class="tz-actions"><span class="tz-small tz-mut">${last}</span><span class="tz-sp"></span>
                    <button type="button" class="tz-btn ghost" data-sz="discard" ${!dirty || st.saving ? 'disabled' : ''}>Descartar</button>
                    <button type="button" class="tz-btn pri" data-sz="save" ${!dirty || hasErr || st.saving ? 'disabled' : ''}>${st.saving ? 'Guardando…' : 'Guardar tarifas'}</button></div>
                ${hasErr && dirty ? '<p class="tz-small tz-errtxt">Corrige los montos en rojo para guardar.</p>' : ''}
            </div>
            <div class="tz-mside">
                <div class="tz-card"><h3>Zonas en el mapa</h3><div class="tz-map tz-map--sm">${zonesSvg(zones, { width: 420, height: 300 })}</div></div>
                <div class="tz-card"><h3>Así lo ve el cliente</h3>
                    <div class="tz-quote ok"><i class="fas fa-motorcycle"></i><div><b>Envío a ${esc(first.name)}: ${esc(money(firstEff.fee))}</b><small>Tarifa fija · ${esc(s.name || 'Tu tienda')}</small></div></div></div>
            </div>
        </div>
    </div>`;
}

async function loadMerchantZones(store) {
    const cityId = store.cityId || 'comayagua';
    const [zs, feeSnap] = await Promise.all([
        getDocs(query(pub('delivery_zones'), where('active', '==', true), where('cityId', '==', cityId))),
        getDoc(doc(pub('store_delivery_fees'), store.id)).catch(() => null),
    ]);
    const zones = zs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.priority || 99) - (b.priority || 99));
    const fd = feeSnap?.exists?.() ? feeSnap.data() : {};
    const fees = fd.fees || {};
    const saved = {};
    zones.forEach((z) => { const f = fees[z.id]; saved[z.id] = f?.mode === 'custom' ? { mode: 'custom', fee: Number(f.fee) } : { mode: 'base', fee: null }; });
    return { zones, saved, meta: { updatedAtMs: fd.updatedAtMs || 0, updatedBy: fd.updatedBy || '', updatedByName: fd.updatedByName || '' } };
}

/** La llama merchant-stores al abrir la pestaña «Envíos». */
export async function renderMerchantZonesTab(body, store) {
    ensureCss();
    const wrap = document.createElement('div');
    body.innerHTML = '';
    body.appendChild(wrap);
    const paint = () => { if (wrap.isConnected) wrap.innerHTML = merchantZonesHtml(T); };
    wrap.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-sz]'); if (!b) return;
        const a = b.getAttribute('data-sz');
        if (a === 'mode') {
            const id = b.getAttribute('data-zone'); const mode = b.getAttribute('data-mode');
            const z = T.zones.find((x) => x.id === id);
            T.draft[id] = mode === 'custom' ? { mode: 'custom', fee: T.draft[id]?.fee ?? z?.baseFee ?? '' } : { mode: 'base', fee: null };
            paint();
            if (mode === 'custom') wrap.querySelector(`[data-sz-fee="${CSS.escape(id)}"]`)?.focus();
        }
        if (a === 'discard') { T.draft = JSON.parse(JSON.stringify(T.saved)); paint(); }
        if (a === 'save') {
            T.saving = true; paint();
            try {
                const fees = {};
                Object.entries(T.draft).forEach(([id, v]) => { fees[id] = v.mode === 'custom' ? { mode: 'custom', fee: Number(v.fee) } : { mode: 'base' }; });
                await callFn('merchantSetStoreZoneFees', { storeId: T.storeId, fees });
                T.saved = JSON.parse(JSON.stringify(T.draft));
                T.meta = { updatedAtMs: Date.now(), updatedBy: DEPS.getCurrentUser?.()?.uid || '', updatedByName: 'ti' };
                toast('Tarifas de envío guardadas', 'success');
            } catch (err) { toast(String(err?.message || err).replace(/^FirebaseError:\s*/, ''), 'error'); }
            T.saving = false; paint();
        }
    });
    wrap.addEventListener('input', (e) => {
        const inp = e.target.closest('[data-sz-fee]'); if (!inp) return;
        const id = inp.getAttribute('data-sz-fee');
        T.draft[id] = { mode: 'custom', fee: inp.value === '' ? '' : Number(String(inp.value).replace(',', '.')) };
        // Repinta solo el resultado (no perder el foco)
        const tmp = document.createElement('div'); tmp.innerHTML = merchantZonesHtml(T);
        const sel = `[data-sz-fee="${CSS.escape(id)}"]`;
        const row = inp.closest('.tz-feerow'); const nrow = tmp.querySelector(sel)?.closest('.tz-feerow');
        if (row && nrow) {
            row.querySelector('.tz-feesee').replaceWith(nrow.querySelector('.tz-feesee'));
            row.querySelector('.tz-err')?.remove();
            const ne = nrow.querySelector('.tz-err'); if (ne) row.querySelector('.tz-feectl').appendChild(ne);
            row.querySelector('.tz-money').classList.toggle('err', !!nrow.querySelector('.tz-money.err'));
        }
        const na = tmp.querySelector('.tz-actions'); const oa = wrap.querySelector('.tz-actions'); if (na && oa) oa.replaceWith(na);
        const side = tmp.querySelector('.tz-mside'); const os = wrap.querySelector('.tz-mside'); if (side && os) os.replaceWith(side);
        const ne2 = tmp.querySelector('.tz-errtxt'); const oe = wrap.querySelector('.tz-errtxt');
        if (oe) oe.remove(); if (ne2) wrap.querySelector('.tz-actions').after(ne2);
    });
    if (T.storeId !== store.id || !T.zones.length) {
        Object.assign(T, { storeId: store.id, store, zones: [], saved: {}, draft: {}, meta: {}, loading: true, error: '' });
        paint();
        try {
            const r = await loadMerchantZones(store);
            Object.assign(T, r, { draft: JSON.parse(JSON.stringify(r.saved)), loading: false });
        } catch (e) { T.loading = false; T.error = 'No se pudieron cargar las zonas de envío.'; console.warn('[envios]', e); }
    } else T.store = store;
    paint();
}

// ───────────────────────── Confirmar pedido (cliente) ─────────────────────────
const Q = { store: null, point: null, pointSource: '', status: 'idle', quote: null, key: '', cache: new Map(), seq: 0 };

export function checkoutPoint() {
    if (Q.point) return Q.point;
    try {
        const ep = window.destinationEndpoint || window.currentDestinationEndpoint;
        if (Number.isFinite(Number(ep?.lat)) && Number.isFinite(Number(ep?.lng))) return { lat: Number(ep.lat), lng: Number(ep.lng) };
    } catch (_) {}
    return null;
}

export function checkoutFeeHtml(st = Q) {
    const q = st.quote;
    const gps = '<button type="button" class="tz-linkbtn" data-sz-checkout="gps"><i class="fas fa-location-arrow"></i> Usar mi ubicación</button>';
    let inner;
    if (st.status === 'loading') inner = '<div class="tz-quote"><i class="fas fa-spinner fa-spin"></i><div><b>Calculando envío…</b></div></div>';
    else if (st.status === 'error') inner = `<div class="tz-quote"><i class="fas fa-route"></i><div><b>Envío: se calcula al despachar</b><small>No se pudo cotizar ahora · <button type="button" class="tz-linkbtn" data-sz-checkout="retry">reintentar</button></small></div></div>`;
    else if (!q || q.reason === 'no_location') inner = `<div class="tz-quote"><i class="fas fa-map-marker-alt"></i><div><b>Envío: marca tu ubicación para ver el monto</b><small>Sin ubicación se calcula por distancia al despachar · ${gps}</small></div></div>`;
    else if (q.inZone) inner = `<div class="tz-quote ok big"><i class="fas fa-motorcycle"></i><div><b>Envío a ${esc(q.zoneName)}: ${esc(money(q.fee))}</b><small>${q.source === 'store_custom' ? 'Tarifa de la tienda' : 'Tarifa fija de la zona'} · la confirma el servidor al enviar el pedido · se paga al conductor</small></div></div>`;
    else if (q.blocked) inner = `<div class="tz-quote bad"><i class="fas fa-ban"></i><div><b>Por ahora no llegamos a esa dirección</b><small>Está fuera de las zonas de envío de la tienda. Prueba otra dirección · ${gps}</small></div></div>`;
    else inner = '<div class="tz-quote"><i class="fas fa-route"></i><div><b>Envío: se calcula por distancia al despachar</b><small>Esta dirección no está en ninguna zona de envío · se paga al conductor</small></div></div>';
    const src = st.pointSource === 'gps' ? '<small class="tz-mut tz-src">Ubicación: tu GPS</small>' : '';
    return `<div id="store-zone-fee-box" class="tz-checkout">${inner}${src}</div>`;
}

function paintCheckout() {
    ensureCss();
    const el = typeof document !== 'undefined' && document.getElementById('store-zone-fee-box');
    if (el) el.outerHTML = checkoutFeeHtml(Q);
}

async function fetchQuote(storeId, p) {
    const key = `${storeId}|${p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : 'none'}`;
    const hit = Q.cache.get(key);
    if (hit && Date.now() - hit.at < 120000) return hit.q;
    const q = p ? await callFn('quoteStoreDeliveryFee', { storeId, lat: p.lat, lng: p.lng }) : { inZone: false, reason: 'no_location', blocked: false };
    Q.cache.set(key, { q, at: Date.now() });
    return q;
}

/** Se llama al pintar «Confirmar pedido» (y cuando cambia la ubicación). */
export async function refreshCheckoutQuote(force = false, store = null) {
    if (store) Q.store = store;
    if (!Q.store?.id) return null;
    const p = checkoutPoint();
    const key = `${Q.store.id}|${p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : 'none'}`;
    if (!force && key === Q.key && Q.status === 'ok') { paintCheckout(); return Q.quote; }
    if (force) Q.cache.delete(key);
    const seq = ++Q.seq;
    Q.key = key; Q.status = 'loading'; paintCheckout();
    try {
        const q = await fetchQuote(Q.store.id, p);
        if (seq !== Q.seq) return Q.quote;
        Q.quote = q; Q.status = 'ok';
    } catch (e) { if (seq === Q.seq) { Q.status = 'error'; Q.quote = null; } console.warn('[envio] cotizar', e); }
    paintCheckout();
    return Q.quote;
}

function useGpsForCheckout() {
    if (!navigator.geolocation) return toast('Tu teléfono no permite usar la ubicación', 'warning');
    toast('Buscando tu ubicación…', 'info');
    navigator.geolocation.getCurrentPosition((pos) => {
        Q.point = { lat: pos.coords.latitude, lng: pos.coords.longitude }; Q.pointSource = 'gps';
        refreshCheckoutQuote(true);
    }, () => toast('No se pudo obtener tu ubicación', 'warning'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

/**
 * Antes de cobrar y crear el pedido: cotización fresca. Si la ciudad bloquea pedidos fuera
 * de zona, se detiene aquí (el servidor igual lo cancelaría y devolvería el saldo).
 */
export async function checkoutGateForOrder(store) {
    Q.store = store;
    const point = checkoutPoint();
    let quote = null;
    try { quote = await fetchQuote(store.id, point); } catch (_) { quote = null; }
    const key = `${store.id}|${point ? `${point.lat.toFixed(4)},${point.lng.toFixed(4)}` : 'none'}`;
    // El cliente debe ver el envío antes de confirmar: si la ubicación cambió desde que se
    // pintó el aviso y ahora hay tarifa de zona, se repinta y se pide confirmar otra vez.
    const changed = !!quote?.inZone && (Q.key !== key || Q.status !== 'ok');
    return { point, quote, blocked: !!quote?.blocked, changed };
}

export function resetCheckoutZone() { Q.point = null; Q.pointSource = ''; Q.quote = null; Q.status = 'idle'; Q.key = ''; }

/** Línea para la tarjeta del pedido (cliente y tienda). */
export function orderFeeLineHtml(o) {
    if (!o) return '';
    if (ZONE_FEE_SOURCES.includes(o.deliveryFeeSource) && o.deliveryFee != null) {
        return `<span class="order-zone-fee"><i class="fas fa-motorcycle"></i> Envío a ${esc(o.deliveryZoneName || 'zona')}: ${esc(money(o.deliveryFee))}</span>`;
    }
    if (o.deliveryFee != null && Number(o.deliveryFee) > 0) return `<span class="order-zone-fee"><i class="fas fa-motorcycle"></i> Envío: ${esc(money(o.deliveryFee))}</span>`;
    return '';
}

/** Precio del viaje de entrega: si el servidor fijó tarifa de zona, esa; si no, la de distancia. */
export function deliveryTripPrice(order, distancePrice) {
    const f = Number(order?.deliveryFee);
    if (ZONE_FEE_SOURCES.includes(order?.deliveryFeeSource) && Number.isFinite(f) && f >= 0) return { priceNum: f, fromZone: true };
    return { priceNum: distancePrice, fromZone: false };
}

export const __test = { T, Q, merchantZonesHtml, checkoutFeeHtml };
