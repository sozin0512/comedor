/**
 * v.42 «Pedido doble» — lado del repartidor.
 * - Oferta: insignia ⚡ PRIORIDAD (está en el negocio) + con quién lo lleva y por qué la entrega cuadra.
 * - Aceptar: acceptTrip manda batchWithTripId; el servidor valida y une los 2 viajes (batchId).
 * - Activo: tarjeta con los 2 pedidos. «Llegué al negocio» y «Ya recogí» se copian al 2º pedido.
 *   Cada pedido tiene su «Pedido entregado» (el último usa el cierre normal: calificación, cobro por zona).
 * - Cancelación: el otro sigue como pedido normal; si ya lo recogió, «Devuelto al negocio».
 */
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { pdCanPair, pdPriority, pdIsZone, pdDeliveryOrder, PD_PRIORITY_SEC, PD_DEST_NEAR_KM, PD_DETOUR_MAX_KM } from './pedido-doble-rules.js?v=2026.10.26.56';

const W = window;
const trips = new Map();       // id → datos vivos
const unsubs = new Map();
let batchId = null, batchIds = [], summaryShown = null, busy = false;
const OPEN = ['accepted', 'in_progress'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ref = (id) => doc(W.db, 'artifacts', W.appId, 'public', 'data', 'trips', id);
const name = (t) => (t?.deliveryDetails?.recipientName || t?.recipientName || t?.clientName || 'Cliente');
const phone = (t) => t?.deliveryDetails?.recipientPhone || t?.recipientPhone || t?.clientPhone || '';
const storeName = (t) => t?.storeName || t?.deliveryDetails?.storeName || 'el negocio';
const money = (n) => `L. ${Number(n || 0).toFixed(2)}`;
const me = () => W.currentUser?.uid || null;

function reasonText(p) {
    if (!p?.ok) return '';
    if (p.reason === 'zona_mismo_negocio') return 'Ambos se cobran por zona · llama a cada cliente para saber dónde';
    if (p.reason === 'entrega_cerca') return `Entrega cerca: ${p.destKm.toFixed(1)} km del 1º cliente`;
    return `De paso: +${p.detourKm.toFixed(1)} km de desvío`;
}

/** Para acceptTrip: ¿este pendiente se puede llevar con el pedido activo? */
function canPair(active, cand) {
    if (!active || !cand || active.id === cand.id || active.driverId !== me()) return false;
    return pdCanPair(active, { ...cand, status: cand.status || 'pending' }).ok;
}

/** HTML extra para la tarjeta/popup de oferta. */
function offerBadgeHtml(t) {
    const active = W.activeTrip;
    if (!t || !active || active.id === t.id) return '';
    const pair = pdCanPair(active, { ...t, status: t.status || 'pending' });
    if (!pair.ok) return '';
    const prio = (t.offerPedidoDoble && t.offeredToDriverId === me()) || pdPriority(active, { ...t, status: 'pending' }, W.currentDriverPos);
    return `<div class="hr-pd-offer" data-pd-offer="${esc(t.id || '')}">
        ${prio ? `<div class="hr-pd-prio">⚡ PRIORIDAD · ESTÁS EN ESTE NEGOCIO</div>` : ''}
        <div class="hr-pd-offer-t">📦📦 Pedido doble · lo llevas junto con el de ${esc(name(active))}</div>
        <div class="hr-pd-offer-s">${esc(reasonText(pair))}</div>
        ${prio ? `<div class="hr-pd-offer-s">Solo tú lo ves por ${PD_PRIORITY_SEC} s. Si no lo tomas, va a otros repartidores.</div>` : ''}
    </div>`;
}

function watch(id) {
    if (!id || unsubs.has(id)) return;
    unsubs.set(id, onSnapshot(ref(id), (s) => { if (s.exists()) { trips.set(id, { id, ...s.data() }); sync(); } }, () => {}));
}
function stopAll() { unsubs.forEach((u) => { try { u(); } catch (_) {} }); unsubs.clear(); trips.clear(); batchId = null; batchIds = []; }

function onAccepted(cand, active) {
    const ids = [active.id, cand.id];
    batchId = `pd_${active.id}_${cand.id}`; batchIds = ids;
    trips.set(active.id, { ...active, batchId, batchTripIds: ids, batchIndex: 1 });
    trips.set(cand.id, { ...cand, batchId, batchTripIds: ids, batchIndex: 2, status: 'accepted', driverId: me() });
    ids.forEach(watch);
    W.showToast?.(`📦📦 Pedido doble: ahora llevas 2 pedidos de ${storeName(active)}.`, 'success');
    sync();
}

const list = () => batchIds.map((id) => trips.get(id)).filter(Boolean);
const isOpen = (t) => t && OPEN.includes(t.status);
function partnerOf(t) { const o = (t?.batchTripIds || batchIds).find((x) => x !== t?.id); return o ? trips.get(o) : null; }
function partnerOpen(t) { return isOpen(partnerOf(t)); }

async function mirrorStage(active, p) {
    if (!isOpen(p) || p.status !== 'accepted' || busy) return;
    try {
        if (active.status === 'in_progress') {
            busy = true;
            await updateDoc(ref(p.id), { status: 'in_progress', startedAt: serverTimestamp(), routeLegIndex: 1, driverArrived: true, storePickedUpAt: serverTimestamp() });
            const oid = p.storeOrderId || p.deliveryDetails?.storeOrderId;
            if (oid) updateDoc(doc(W.db, 'artifacts', W.appId, 'public', 'data', 'store_orders', String(oid)), { status: 'out_for_delivery', deliveryStage: 'picked_up', driverId: me(), pickedUpAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(() => {});
        } else if (active.driverArrived && !p.driverArrived) {
            busy = true;
            await updateDoc(ref(p.id), { driverArrived: true, driverArrivedAt: serverTimestamp() });
        }
    } catch (e) { console.warn('[pedido-doble] copiar etapa', e); } finally { busy = false; }
}

let lastPromote = { id: null, at: 0 };
function promote(p) {
    if (!p) return;
    if (lastPromote.id === p.id && Date.now() - lastPromote.at < 8000) return;
    lastPromote = { id: p.id, at: Date.now() };
    try { W.hrSubscribeTripDoc?.(p.id); } catch (_) {}
    try { W._lastTripUiState = null; W.processActiveTripUpdate?.(p); } catch (e) { console.warn('[pedido-doble] promover', e); }
}

const freshPos = () => new Promise((res) => {
    const cur = W.currentDriverPos;
    if (cur && Date.now() - (W._driverLiveUpdatedAt || 0) < 15000) return res(cur);
    if (!navigator.geolocation?.getCurrentPosition) return res(cur || null);
    const to = setTimeout(() => res(cur || null), 4000);
    navigator.geolocation.getCurrentPosition((p) => { clearTimeout(to); res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
        () => { clearTimeout(to); res(cur || null); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 4000 });
});

/** «Pedido entregado» de UN pedido del pedido doble. Si es el último abierto → cierre normal de la app. */
async function deliver(id, { skipConfirm = false } = {}) {
    const t = trips.get(id) || (W.activeTrip?.id === id ? W.activeTrip : null);
    if (!t || t.status !== 'in_progress') return W.showToast?.('Primero recoge los pedidos.', 'warning');
    const other = partnerOf(t);
    if (!isOpen(other)) {
        if (W.activeTrip?.id !== id) promote(t);
        return W.driverSignalDestinationArrival?.();
    }
    if (!skipConfirm) {
        const ok = await (W.hrConfirm ? W.hrConfirm(`¿Entregaste el pedido de ${name(t)}?`, { okText: 'Sí, entregado' }) : Promise.resolve(confirm('¿Entregado?')));
        if (!ok) return;
    }
    const patch = { status: 'completed', completedAt: serverTimestamp(), completedBy: me(), completedByRole: 'driver', pedidoDobleDeliveredAtMs: Date.now() };
    if (pdIsZone(t)) {
        if (t.dropoffLat == null) {
            const pos = await freshPos();
            if (!pos || !Number.isFinite(Number(pos.lat))) return W.showToast?.('No tenemos tu ubicación GPS. Activa la ubicación e intenta de nuevo.', 'error');
            Object.assign(patch, { dropoffLat: Number(pos.lat), dropoffLng: Number(pos.lng), dropoffAccuracyM: Number.isFinite(Number(pos.accuracy)) ? Math.round(Number(pos.accuracy)) : null, dropoffAtMs: Date.now() });
        }
    } else {
        const n = Number(t.priceNum ?? String(t.price || '').replace(/[^\d.]/g, ''));
        if (Number.isFinite(n)) patch.priceNum = n;
    }
    await updateDoc(ref(id), patch);
    const oid = t.storeOrderId || t.deliveryDetails?.storeOrderId;
    if (oid) updateDoc(doc(W.db, 'artifacts', W.appId, 'public', 'data', 'store_orders', String(oid)), { status: 'delivered', deliveryStage: 'delivered', driverId: me(), deliveredAt: serverTimestamp(), deliveredBy: me(), updatedAt: serverTimestamp() }).catch(() => {});
    trips.set(id, { ...t, ...patch, status: 'completed', completedAtMs: Date.now() });
    W.showToast?.(pdIsZone(t) ? `✅ Pedido de ${name(t)} entregado. Calculando tu cobro por zona…` : `✅ Pedido de ${name(t)} entregado · ${money(patch.priceNum)}`, 'success');
    if (W.activeTrip?.id === id) promote(other);
    sync();
}

async function returnedToStore() {
    const a = W.activeTrip;
    if (!a?.id) return;
    try { await updateDoc(ref(a.id), { pdReturnedToStoreAtMs: Date.now() }); W.showToast?.('Gracias. Marcamos el pedido cancelado como devuelto al negocio.', 'success'); }
    catch (_) { W.showToast?.('No se pudo guardar. Intenta de nuevo.', 'error'); }
}

function chargeOf(t) {
    if (pdIsZone(t)) return t.zoneFeeAtMs != null ? { txt: money(t.priceNum), zone: t.deliveryZoneName || 'Zona' } : { txt: 'Calculando…', zone: 'Zona (GPS)' };
    return { txt: money(t.priceNum ?? String(t.price || '').replace(/[^\d.]/g, '')), zone: null };
}
function stageTag(t, isNext) {
    if (t.status === 'completed') return '<span class="hr-pd-tag hr-pd-tag--ok">Entregado</span>';
    if (t.status === 'cancelled') return '<span class="hr-pd-tag hr-pd-tag--x">Cancelado</span>';
    if (t.status === 'accepted') return `<span class="hr-pd-tag">${t.driverArrived ? 'En el negocio' : 'Por recoger'}</span>`;
    return `<span class="hr-pd-tag ${isNext ? 'hr-pd-tag--go' : ''}">${isNext ? 'Siguiente' : 'Después'}</span>`;
}

function render() {
    let el = document.getElementById('hr-pd-card');
    const all = list();
    const show = batchId && all.length === 2 && W.userProfile?.role === 'driver';
    if (!show) { el?.remove(); document.body.classList.remove('hr-pd-on'); return; }
    if (!el) { el = document.createElement('div'); el.id = 'hr-pd-card'; document.body.appendChild(el); }
    document.body.classList.add('hr-pd-on');
    const done = all.filter((t) => t.status === 'completed');
    const ordered = pdDeliveryOrder(all[0], all[1]);
    const nextId = ordered.find((t) => t.status === 'in_progress')?.id;
    const active = W.activeTrip;
    const ret = active?.batchPartnerReturnToStore && !active.pdReturnedToStoreAtMs;
    const pickedAll = all.every((t) => t.status !== 'accepted');
    const rows = ordered.map((t, i) => {
        const c = chargeOf(t);
        const ph = phone(t);
        const btn = t.status === 'in_progress'
            ? `<button type="button" class="hr-pd-btn" data-pd-deliver="${esc(t.id)}">✅ Pedido ${i + 1} entregado</button>` : '';
        return `<div class="hr-pd-row ${t.status === 'completed' ? 'is-done' : ''} ${t.id === nextId ? 'is-next' : ''} ${t.status === 'cancelled' ? 'is-x' : ''}">
            <div class="hr-pd-n">${t.status === 'completed' ? '✓' : i + 1}</div>
            <div class="hr-pd-info"><b>${t.status === 'completed' ? `${esc(name(t))} · entregado` : `Entregar a ${esc(name(t))}`}</b>
              <span>${ph ? `📞 <a href="tel:${esc(ph)}">${esc(ph)}</a> · ` : ''}${esc(pdIsZone(t) ? 'Por zona: llama para saber dónde' : (t.destination || ''))}</span>
              ${t.status === 'completed' ? `<span class="hr-pd-charge">${c.zone ? esc(c.zone) + ' · ' : ''}cobro ${esc(c.txt)}</span>` : ''}</div>
            ${stageTag(t, t.id === nextId)}${btn}</div>`;
    }).join('');
    el.innerHTML = `<div class="hr-pd-head"><b>📦📦 Pedido doble · ${esc(storeName(all[0]))}</b><span>${done.length}/2 entregados${pickedAll ? '' : ' · recoge los 2 pedidos'}</span></div>
        ${ret ? `<div class="hr-pd-ret">↩️ Se canceló un pedido que ya recogiste. Devuélvelo al negocio. <button type="button" data-pd-returned>Devuelto al negocio</button></div>` : ''}
        ${rows}<div class="hr-pd-foot">Cada pedido se cobra aparte al entregarlo</div>`;
}

function showSummary(all) {
    if (summaryShown === batchId) return;
    summaryShown = batchId;
    const delivered = all.filter((t) => t.status === 'completed');
    if (!delivered.length) return;
    const gross = delivered.reduce((s, t) => s + (Number(t.priceNum) || 0), 0);
    const comm = delivered.reduce((s, t) => s + (Number(t.serverCommissionAmount ?? t.commissionAmount) || 0), 0);
    const el = document.createElement('div');
    el.id = 'hr-pd-summary';
    el.innerHTML = `<div class="hr-pd-sum"><div style="font-size:40px">🎉</div><h3>Pedido doble completado</h3>
        <p>${esc(storeName(delivered[0]))} · ${delivered.length} entrega${delivered.length > 1 ? 's' : ''}</p>
        ${delivered.map((t, i) => `<div class="hr-pd-m"><span>Pedido ${i + 1} · ${esc(name(t))}${t.deliveryZoneName ? ' · ' + esc(t.deliveryZoneName) : ''}</span><b>${money(t.priceNum)}</b></div>`).join('')}
        <div class="hr-pd-m"><span>Comisión HonduRaite</span><b>${comm ? '− ' + money(comm) : 'se calcula al cerrar'}</b></div>
        <div class="hr-pd-m hr-pd-tot"><span>Tu ganancia</span><b>${money(gross - comm)}</b></div>
        <p class="hr-pd-note">En Finanzas aparecen como ${delivered.length} viajes separados, marcados «Pedido doble».</p>
        <button type="button" data-pd-close>Listo</button></div>`;
    document.body.appendChild(el);
}

function sync() {
    const a = W.activeTrip;
    if (a?.batchId && a.driverId === me() && a.batchId !== batchId) {
        stopAll(); batchId = a.batchId; batchIds = a.batchTripIds || []; batchIds.forEach(watch);
    }
    if (!batchId) return render();
    if (a?.id && trips.has(a.id)) {
        const prev = trips.get(a.id);
        // nunca «revivir» un pedido que ya cerramos aquí con una copia vieja del viaje activo
        if (!(prev && !isOpen(prev) && isOpen(a))) trips.set(a.id, { ...prev, ...a });
    }
    const all = list();
    const cur = a && trips.get(a.id);
    const partner = cur ? partnerOf(cur) : null;
    if (cur && isOpen(cur) && partner) mirrorStage(cur, partner);
    // El activo terminó/canceló y el otro sigue abierto → cargar el otro como viaje activo
    const openOnes = all.filter(isOpen);
    if (openOnes.length === 1 && (!a || !isOpen(a) || a.id !== openOnes[0].id)) {
        if (!a || !isOpen(a)) promote(openOnes[0]);
    }
    if (all.length === 2 && openOnes.length === 0) {
        showSummary(all);
        const keep = batchId;
        setTimeout(() => { if (batchId === keep) { stopAll(); render(); } }, 1500);
    }
    render();
}

document.addEventListener('click', (e) => {
    const d = e.target.closest('[data-pd-deliver]');
    if (d) { e.preventDefault(); d.disabled = true; deliver(d.dataset.pdDeliver).finally(() => { d.disabled = false; }); return; }
    if (e.target.closest('[data-pd-returned]')) { returnedToStore(); return; }
    if (e.target.closest('[data-pd-close]')) document.getElementById('hr-pd-summary')?.remove();
});
setInterval(() => { try { sync(); } catch (_) {} }, 1500);

W.hrPedidoDoble = { canPair, offerBadgeHtml, onAccepted, deliver, partnerOpen: (t) => !!(t?.batchId && partnerOpen(trips.get(t.id) || t)), sync, _trips: trips, PD_DEST_NEAR_KM, PD_DETOUR_MAX_KM };
