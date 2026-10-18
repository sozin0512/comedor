/**
 * Pedido de tienda en la app del conductor:
 *  - en la oferta: insignia «Pedido de tienda», zona de envío y qué cobrar
 *  - después de aceptar: productos, teléfono de quien recibe y total de la tienda
 * Sin imports ni DOM global: funciones puras que devuelven HTML (probadas en scripts/test-tasa-disponibilidad.mjs).
 */

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(v) {
    const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
}
function money(n) {
    const v = Math.round(num(n) * 100) / 100;
    return `L ${Number.isInteger(v) ? v : v.toFixed(2)}`;
}
function digits(p) { return String(p || '').replace(/\D/g, ''); }

export function isStoreOrderTrip(t) {
    if (!t || typeof t !== 'object') return false;
    return !!(t.storeOrderId || t.storeDelivery === true || t.createdByMerchant === true || t.deliveryDetails?.storeOrderId);
}

/** «Pedido tienda: 3× Baleada, 1× Horchata» → [{qty,name}] (viajes viejos sin items). */
function parseItemsFromDescription(desc) {
    const s = String(desc || '').replace(/^Pedido tienda:\s*/i, '');
    if (!s.trim()) return [];
    return s.split(/,\s*/).map((part) => {
        const m = part.match(/^(\d+)\s*[×x]\s*(.+)$/);
        return m ? { qty: Number(m[1]), name: m[2].trim(), price: null } : { qty: 1, name: part.trim(), price: null };
    }).filter((i) => i.name);
}

/**
 * Resumen de cobro del pedido.
 * Productos en efectivo → el conductor cobra productos + envío y le pasa los productos a la tienda.
 * Productos pagados con puntos → solo cobra el envío.
 */
export function storeOrderSummary(t, deliveryPrice = null) {
    if (!isStoreOrderTrip(t)) return null;
    const d = t.deliveryDetails || {};
    const items = Array.isArray(d.items) && d.items.length
        ? d.items.map((i) => ({ qty: Number(i.qty) || 1, name: String(i.name || ''), price: i.price != null ? num(i.price) : null }))
        : parseItemsFromDescription(d.packageDescription);
    const itemsTotal = num(d.itemsTotal);
    const fee = deliveryPrice != null ? num(deliveryPrice) : num(t.negotiatedPrice ?? t.priceNum ?? t.price);
    const paid = d.productsPaid === true || d.productsPaymentMethod === 'saldo';
    const cashToCollect = paid ? fee : fee + itemsTotal;
    return {
        storeName: String(d.storeName || d.restaurant || t.originPlaceName || 'Tienda'),
        zoneName: String(t.deliveryZoneName || '') || null,
        items,
        itemsTotal,
        fee,
        productsPaid: paid,
        cashToCollect,
        recipientName: String(d.recipientName || t.clientName || ''),
        recipientPhone: String(d.recipientPhone || t.clientPhone || ''),
        notes: String(d.deliveryNotes || ''),
        orderShortId: String(t.storeOrderId || d.storeOrderId || '').slice(0, 6).toUpperCase(),
    };
}

export function storeOfferBadgesHtml(t) {
    if (!isStoreOrderTrip(t)) return '';
    const zone = t.deliveryZoneName ? `<span class="hr-store-zone-badge"><i class="fas fa-map-marker-alt"></i> ${esc(t.deliveryZoneName)}</span>` : '';
    return `<span class="hr-store-badge"><i class="fas fa-shopping-bag"></i> Pedido de tienda</span>${zone}`;
}

/** Caja verde/azul: qué cobrar. */
export function storeCollectHtml(t, deliveryPrice = null) {
    const s = storeOrderSummary(t, deliveryPrice);
    if (!s) return '';
    const zone = s.zoneName ? ` · ${esc(s.zoneName)}` : '';
    if (s.productsPaid) {
        return `<div class="hr-store-collect hr-store-collect--paid">
            <p class="hr-store-collect-title"><i class="fas fa-check-circle"></i> Productos ya pagados con puntos</p>
            <p class="hr-store-collect-row hr-store-collect-total"><span>Cobrar solo el envío${zone}</span><b>${money(s.fee)}</b></p>
            <p class="hr-store-collect-note">No cobres los productos: la tienda ya recibió el pago.</p>
        </div>`;
    }
    return `<div class="hr-store-collect">
        <p class="hr-store-collect-title"><i class="fas fa-money-bill-wave"></i> Cobrar al cliente en efectivo</p>
        <p class="hr-store-collect-row"><span>Productos (son de la tienda)</span><b>${money(s.itemsTotal)}</b></p>
        <p class="hr-store-collect-row"><span>Tu envío${zone}</span><b>${money(s.fee)}</b></p>
        <p class="hr-store-collect-row hr-store-collect-total"><span>Total a cobrar</span><b>${money(s.cashToCollect)}</b></p>
        <p class="hr-store-collect-note">Le pasas ${money(s.itemsTotal)} a la tienda al recoger · te quedas ${money(s.fee)}.</p>
    </div>`;
}

/** Panel después de aceptar: productos + quién recibe + cobro. */
export function storeAcceptedPanelHtml(t, deliveryPrice = null) {
    const s = storeOrderSummary(t, deliveryPrice);
    if (!s) return '';
    const items = s.items.length
        ? s.items.map((i) => `<li><span>${esc(i.qty)}× ${esc(i.name)}</span>${i.price != null ? `<b>${money(i.price * i.qty)}</b>` : ''}</li>`).join('')
        : '<li><span>Revisa el pedido con la tienda</span></li>';
    const tel = digits(s.recipientPhone);
    const wa = tel ? (tel.length === 8 ? `504${tel}` : tel) : '';
    const phoneBtns = tel
        ? `<div class="hr-store-contact">
            <a class="hr-store-call" href="tel:${esc(tel)}"><i class="fas fa-phone"></i> ${esc(s.recipientPhone)}</a>
            <a class="hr-store-wa" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>
          </div>`
        : '<p class="hr-store-muted">Sin teléfono · usa el chat del viaje</p>';
    return `<div class="hr-store-panel" data-store-order-panel>
        <p class="hr-store-panel-head">${storeOfferBadgesHtml(t)}${s.orderShortId ? `<span class="hr-store-id">#${esc(s.orderShortId)}</span>` : ''}</p>
        <div class="hr-store-box">
            <p class="hr-store-box-title"><i class="fas fa-receipt"></i> Productos · ${esc(s.storeName)}</p>
            <ul class="hr-store-items">${items}</ul>
            <p class="hr-store-collect-row hr-store-collect-total"><span>Total de la tienda</span><b>${money(s.itemsTotal)}</b></p>
            <p class="hr-store-muted">Revisa que esté todo antes de salir de la tienda.</p>
        </div>
        <div class="hr-store-box">
            <p class="hr-store-box-title"><i class="fas fa-user"></i> Entregar a ${esc(s.recipientName || 'cliente')}</p>
            ${s.notes ? `<p class="hr-store-muted">«${esc(s.notes)}»</p>` : ''}
            ${phoneBtns}
        </div>
        ${storeCollectHtml(t, deliveryPrice)}
    </div>`;
}

export const STORE_TRIP_CSS = `
.hr-store-badge{display:inline-flex;align-items:center;gap:4px;background:#F59E0B;color:#111827;font-weight:900;font-size:11px;padding:3px 8px;border-radius:8px}
.hr-store-zone-badge{display:inline-flex;align-items:center;gap:4px;background:#DBEAFE;color:#1D4ED8;font-weight:800;font-size:11px;padding:3px 8px;border-radius:8px;margin-left:4px}
.hr-store-collect{background:#052E16;border:1.5px solid #22C55E;border-radius:14px;padding:9px 11px;margin:8px 0;color:#DCFCE7}
.hr-store-collect--paid{background:#082F49;border-color:#38BDF8;color:#E0F2FE}
.hr-store-collect-title{font-weight:900;margin:0 0 4px}
.hr-store-collect-row{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;margin:2px 0}
.hr-store-collect-total{border-top:1px dashed rgba(255,255,255,.3);padding-top:5px;margin-top:5px;font-size:15px;font-weight:900}
.hr-store-collect-note{font-size:11px;opacity:.85;margin:4px 0 0}
.hr-store-panel{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.hr-store-panel-head{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:0}
.hr-store-id{margin-left:auto;font:700 11px ui-monospace,monospace;opacity:.7}
.hr-store-box{background:rgba(15,23,42,.92);border:1px solid #1F2937;border-radius:14px;padding:9px 11px;color:#E5E7EB}
.hr-store-box-title{font-weight:900;margin:0 0 5px;color:#fff}
.hr-store-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;font-size:12.5px}
.hr-store-items li{display:flex;justify-content:space-between;gap:8px}
.hr-store-box .hr-store-collect-total{border-top-color:#374151;color:#fff}
.hr-store-muted{font-size:11px;color:#94A3B8;margin:3px 0 0}
.hr-store-contact{display:flex;gap:6px;margin-top:6px}
.hr-store-contact a{flex:1;text-align:center;font-weight:900;font-size:12.5px;padding:8px;border-radius:10px;color:#fff;text-decoration:none}
.hr-store-call{background:#1D4ED8}.hr-store-wa{background:#16A34A}
`;
