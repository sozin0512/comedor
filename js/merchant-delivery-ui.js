/**
 * Pestaña «Pedir envío» del panel de la tienda (merchant-stores.js).
 * Todo lo de Firebase/Maps llega por ctx → se prueba en Chrome headless con stubs
 * (scripts/test-pedir-envio-tienda.mjs).
 */
import {
    MERCHANT_DELIVERY_VEHICLES, haversineKm, validateMerchantDeliveryForm,
    buildMerchantDeliveryTrip, merchantDeliveryStatus, merchantVehicleAvailability, merchantCancelPatch,
    resolveMerchantDeliveryPrice, storeHasSavedLocation, isInHonduras, customerChargeText,
    parseHondurasCoordsInput, buildDeliveryTrackingUrl, buildMerchantShareTripMessage, buildMerchantShareTripWhatsAppUrl,
    normalizeSelectedDeliveryItems, calculateDeliveryItemsSubtotal, formatDeliveryItemsSummary, formatDeliveryItemsBannerText,
} from './merchant-delivery-request.js?v=2026.10.25.3';

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const money = (n) => `L. ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = { amber: '#b45309', violet: '#0c4a8e', blue: '#1d4ed8', green: '#047857', gray: '#64748b' };

export const MERCHANT_DELIVERY_CSS = `
.md-wrap{color:#0f172a;display:flex;flex-direction:column;gap:10px;font-size:14px}
.md-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:12px}
.md-card h3{margin:0 0 8px;font-size:15px;font-weight:800}
.md-veh{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.md-veh button{border:2px solid #e2e8f0;border-radius:14px;padding:10px;background:#f8fafc;font-weight:800;display:flex;flex-direction:column;align-items:center;gap:4px}
.md-veh button.on{border-color:var(--hn-blue,#0c4a8e);background:#eff6ff;color:var(--hn-blue,#0c4a8e)}
.md-veh button[disabled]{opacity:.5}
.md-veh small{font-weight:600;font-size:11px;color:#b91c1c}
.md-lbl{font-size:12px;font-weight:700;color:#334155;margin-top:10px;display:block}
.md-f{display:flex;flex-direction:column;gap:3px;margin-top:8px;position:relative}
.md-f label{font-size:12px;font-weight:700;color:#334155}
.md-f input,.md-f textarea{font-family:inherit;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font-size:15px;width:100%;box-sizing:border-box}
.md-err{color:#b91c1c;font-size:11px;font-weight:700}
.md-pick{display:flex;gap:10px;align-items:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:9px 10px;margin-top:4px}
.md-pick .ic{width:32px;height:32px;border-radius:10px;background:#dbeafe;color:var(--hn-blue,#0c4a8e);display:flex;align-items:center;justify-content:center;flex:none}
.md-pick b{display:block;font-size:13px}
.md-pick span{display:block;font-size:12px;color:#64748b;overflow:hidden;text-overflow:ellipsis}
.md-pick .lk{margin-left:auto;color:#94a3b8;flex:none}
.md-warn{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px;margin-top:4px;font-size:13px;color:#92400e}
.md-btn2{border:1px solid #bfdbfe;background:#fff;color:var(--hn-blue,#0c4a8e);font-weight:800;border-radius:10px;padding:9px 10px;font-size:13px;white-space:nowrap}
.md-drop{display:flex;gap:6px;margin-top:4px;position:relative}
.md-drop input{flex:1;min-width:0;font-family:inherit;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font-size:15px}
.md-sug{position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #cbd5e1;border-radius:10px;z-index:5;box-shadow:0 6px 20px rgba(0,0,0,.12);margin-top:2px}
.md-sug button{display:flex;gap:8px;width:100%;text-align:left;padding:10px;border:0;background:none;font-size:13px;border-bottom:1px solid #f1f5f9}
.md-ok{font-size:11px;color:#047857;font-weight:700;margin-top:3px}
.md-fee{background:#eff6ff;border-radius:12px;padding:10px;margin-top:10px}
.md-fee .row{display:flex;justify-content:space-between;align-items:center}
.md-fee b{font-size:19px;color:var(--hn-blue,#0c4a8e)}
.md-tar{display:inline-block;margin-top:4px;font-size:11px;font-weight:800;color:var(--hn-blue,#0c4a8e);background:#dbeafe;border-radius:999px;padding:2px 8px}
.md-fee.bad{background:#fef2f2}.md-fee.bad .md-tar{background:#fee2e2;color:#b91c1c}
.md-prods{background:linear-gradient(135deg,#fff7ed,#fffbeb);border:1.5px solid #fed7aa;border-radius:14px;padding:10px;margin-top:10px}
.md-prods-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap}
.md-prods-title{display:block;font-size:12.5px;font-weight:900;color:#9a3412}
.md-prods-title small{font-weight:700;color:#78716c;font-size:11px}
.md-prods-sub{display:block;font-size:11px;color:#78716c;margin-top:2px}
.md-prod-empty-pill{font-size:10.5px;font-weight:800;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;padding:3px 8px;border-radius:999px;white-space:nowrap}
.md-prod-clear{border:1px solid #fecaca;background:#fef2f2;color:#dc2626;font-size:11px;font-weight:800;padding:4px 9px;border-radius:8px;cursor:pointer;white-space:nowrap}
.md-prod-search{width:100%;box-sizing:border-box;margin-top:7px;padding:7px 10px;border:1px solid #fdba74;border-radius:9px;font-size:12.5px;background:#fff}
.md-prod-grid{display:grid;grid-template-columns:1fr;gap:6px;margin-top:8px;max-height:195px;overflow-y:auto;padding-right:2px}
.md-prod-card{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:1.5px solid #e2e8f0;border-radius:11px;padding:6px 8px;transition:all .15s}
.md-prod-card.on{border-color:#f97316;background:#fff7ed;box-shadow:0 2px 8px rgba(249,115,22,.12)}
.md-prod-thumb{width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid #e2e8f0;background:#f8fafc}
.md-prod-thumb--icon{display:flex;align-items:center;justify-content:center;background:#ffedd5;color:#ea580c;font-size:14px;border-color:#fed7aa}
.md-prod-info{min-width:0;flex:1}
.md-prod-info b{display:block;font-size:12.5px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.md-prod-info span{display:block;font-size:11.5px;font-weight:800;color:#ea580c}
.md-prod-stepper{display:flex;align-items:center;gap:5px;flex-shrink:0}
.md-prod-stepper button{width:28px;height:28px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-weight:900;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.md-prod-stepper button[data-md-prod-inc]{background:#ea580c;border-color:#ea580c;color:#fff}
.md-prod-stepper button[disabled]{opacity:.38;cursor:not-allowed}
.md-prod-stepper span{min-width:20px;text-align:center;font-size:13px;font-weight:900;color:#0f172a}
.md-prod-banner{margin-top:8px;background:#ffedd5;border:1px solid #fb923c;border-radius:10px;padding:7px 9px;font-size:11.5px;font-weight:800;color:#7c2d12;line-height:1.35}
.md-prod-none{margin-top:6px;font-size:11.5px;color:#64748b;background:rgba(255,255,255,.7);border:1px dashed #cbd5e1;border-radius:9px;padding:7px 9px}
.md-cash{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:10px;margin-top:8px}
.md-cash label{font-size:12px;font-weight:800;color:#065f46}
.md-cash input{font-family:inherit;border:1px solid #a7f3d0;border-radius:10px;padding:10px;font-size:15px;width:100%;box-sizing:border-box;margin-top:4px}
.md-cash small{display:block;color:#047857;font-size:11px;margin-top:4px}
.md-total{margin-top:8px;background:#0f172a;color:#fff;border-radius:12px;padding:10px;font-size:13px;font-weight:700;line-height:1.35}
.md-go{width:100%;margin-top:10px;border:0;border-radius:14px;padding:14px;box-shadow:0 6px 16px rgba(12,74,142,.25);background:linear-gradient(135deg,var(--hn-blue,#0c4a8e),var(--hn-blue-light,#1a6bb5));color:#fff;font-weight:900;font-size:15px}
.md-go[disabled]{background:#bfdbfe;box-shadow:none}
.md-req{display:flex;justify-content:space-between;gap:8px;padding:9px 0;border-top:1px solid #f1f5f9}
.md-req:first-of-type{border-top:0}
.md-req-items{font-size:11.5px;font-weight:800;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:3px 7px;margin-top:3px;display:inline-block}
.md-pill{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:#f1f5f9;white-space:nowrap}
.md-cancel{border:1px solid #fecaca;color:#b91c1c;background:#fff;border-radius:10px;padding:5px 9px;font-weight:800;font-size:12px;cursor:pointer}
.md-req-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.md-wa-btn{border:1px solid #16a34a;background:#16a34a;color:#fff;border-radius:10px;padding:6px 10px;font-weight:800;font-size:11.5px;display:inline-flex;align-items:center;gap:5px;cursor:pointer;text-decoration:none}
.md-wa-btn:hover{background:#15803d}
.md-copy-btn{border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;border-radius:10px;padding:6px 10px;font-weight:800;font-size:11.5px;display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.md-created-banner{background:#ecfdf5;border:1px solid #6ee7b7;border-radius:14px;padding:10px 12px;margin-bottom:8px;font-size:12.5px;color:#065f46}
.md-map{position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column}
.md-map-top{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:800}
.md-map-top button{border:0;background:#f1f5f9;border-radius:10px;width:36px;height:36px}
.md-map-canvas{flex:1;position:relative;background:#e2e8f0}
.md-map-el{position:absolute;inset:0}
.md-map-pin{position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);font-size:38px;color:var(--hn-blue,#0c4a8e);pointer-events:none;text-shadow:0 2px 4px rgba(0,0,0,.3);z-index:2}
.md-map-gps{position:absolute;right:12px;bottom:12px;z-index:2;border:0;background:#fff;border-radius:999px;width:44px;height:44px;box-shadow:0 2px 8px rgba(0,0,0,.25);color:#1d4ed8;font-size:17px}
.md-map-bot{padding:12px;border-top:1px solid #e2e8f0}
.md-map-addr{font-size:13px;min-height:34px}
.md-map-addr small{display:block;color:#64748b;font-size:11px}

.md-f input:focus,.md-f textarea:focus,.md-drop input:focus,.md-cash input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
.md-card h3 i{color:var(--hn-blue,#0c4a8e)}
`;

const TITLE = { pickup: 'Ubicación de tu tienda', dropoff: 'Punto de entrega' };

export function createMerchantDeliveryTab(ctx) {
    const st = {
        vehicle: null,
        form: {
            pickupAddress: '', pickupLat: null, pickupLng: null,
            dropoffAddress: '', dropoffLat: null, dropoffLng: null,
            customerName: '', customerPhone: '', notes: '', collectAmount: '',
            items: [],
        },
        selectedQtys: {},
        productSearch: '',
        errors: {}, suggestions: [], requests: [], commission: null, busy: false, unsub: null, root: null, sugTimer: null,
        quote: null, quoteKey: '', quoting: false, quoteSeq: 0, map: null, savingStore: false,
        lastCreatedTrip: null,
    };
    const zoneId = ctx.zone?.id || ctx.store?.cityId || null;
    const avail = () => Object.fromEntries(Object.keys(MERCHANT_DELIVERY_VEHICLES).map((v) => [v, merchantVehicleAvailability(v, zoneId, ctx.availability)]));

    function getStoreProducts() {
        let list = [];
        try {
            if (typeof ctx.getProducts === 'function') list = ctx.getProducts() || [];
            else if (Array.isArray(ctx.products)) list = ctx.products;
            else if (typeof window !== 'undefined' && typeof window.getMyStoreProducts === 'function') list = window.getMyStoreProducts(ctx.store?.id) || [];
            else if (Array.isArray(ctx.store?.products)) list = ctx.store.products;
        } catch (_) { list = []; }
        return (Array.isArray(list) ? list : []).filter((p) => p && p.available !== false && String(p.name || '').trim());
    }

    function syncSelectedItems(autoFillCharge = false) {
        const products = getStoreProducts();
        const byId = new Map(products.map((p) => [String(p.id || p.productId || ''), p]));
        const raw = [];
        for (const [pid, qVal] of Object.entries(st.selectedQtys || {})) {
            const qty = Math.floor(Number(qVal) || 0);
            if (qty <= 0) continue;
            const p = byId.get(String(pid));
            if (!p) continue;
            const priceNum = Number(p.basePrice ?? p.price ?? 0) || 0;
            raw.push({
                productId: String(p.id || p.productId || pid),
                name: String(p.name || '').trim(),
                price: Math.round(priceNum * 100) / 100,
                qty,
                imageUrl: p.imageUrl || p.photoUrl || null,
            });
        }
        st.form.items = normalizeSelectedDeliveryItems(raw);
        if (autoFillCharge) {
            const subtotal = calculateDeliveryItemsSubtotal(st.form.items);
            st.form.collectAmount = subtotal > 0 ? String(subtotal) : '';
        }
        return st.form.items;
    }

    function syncPickup() {
        const s = ctx.store || {};
        if (storeHasSavedLocation(s)) {
            st.form.pickupAddress = s.address || s.name || 'Tienda';
            st.form.pickupLat = Number(s.lat); st.form.pickupLng = Number(s.lng);
        } else { st.form.pickupAddress = ''; st.form.pickupLat = null; st.form.pickupLng = null; }
    }
    syncPickup();

    const hasDrop = () => isInHonduras(st.form.dropoffLat, st.form.dropoffLng);
    const hasPick = () => isInHonduras(st.form.pickupLat, st.form.pickupLng);

    function km() {
        const f = st.form;
        return haversineKm(Number(f.pickupLat), Number(f.pickupLng), Number(f.dropoffLat), Number(f.dropoffLng));
    }
    function price() {
        if (!st.vehicle || !hasDrop() || !hasPick() || st.quoting) return null;
        return resolveMerchantDeliveryPrice({ quote: st.quote, km: km(), vehicle: st.vehicle, fareFn: ctx.fareFn, carFactor: ctx.carFactor, commissionPercent: st.commission });
    }

    /** Cotiza con el servidor (zonas del admin). Moto y carro vienen juntos → un request por punto. */
    async function requote() {
        if (!hasDrop() || !hasPick()) { st.quote = null; return; }
        const key = `${Number(st.form.dropoffLat).toFixed(5)},${Number(st.form.dropoffLng).toFixed(5)}`;
        if (key === st.quoteKey && st.quote) return;
        st.quoteKey = key; const seq = ++st.quoteSeq;
        st.quoting = true; render();
        let q = null;
        try { q = ctx.quoteFee ? await ctx.quoteFee({ storeId: ctx.store?.id, lat: Number(st.form.dropoffLat), lng: Number(st.form.dropoffLng), vehicle: st.vehicle || 'moto' }) : null; }
        catch (e) { q = { inZone: false, reason: 'error' }; }
        if (seq !== st.quoteSeq) return;
        st.quote = q || { inZone: false, reason: 'error' }; st.quoting = false; render();
    }

    function requestsHtml() {
        if (!st.requests.length) return '<p style="color:#64748b;font-size:13px;margin:0">Todavía no has pedido envíos.</p>';
        return st.requests.map((t) => {
            const s = merchantDeliveryStatus(t);
            const veh = MERCHANT_DELIVERY_VEHICLES[t.deliveryVehicle] || MERCHANT_DELIVERY_VEHICLES.moto;
            const wait = typeof ctx.waitChip === 'function' && s.key === 'searching' ? ctx.waitChip(t) : '';
            const collect = Number(t.deliveryDetails?.collectAmount) || 0;
            const recipientName = t.deliveryDetails?.recipientName || '';
            const recipientPhone = t.deliveryDetails?.recipientPhone || '';
            const itemsSummary = formatDeliveryItemsSummary(t.deliveryDetails?.items || []) || String(t.deliveryDetails?.itemsSummary || t.itemsSummary || '').trim();
            const canShare = s.key !== 'cancelled' && !!t.id;
            const canChat = (s.key === 'verifying' || s.key === 'searching' || s.key === 'accepted' || s.key === 'on_the_way' || s.key === 'pickup' || s.key === 'delivering') && !!t.id;
            return `<div class="md-req" data-md-req="${esc(t.id)}">
                <div style="min-width:0;flex:1">
                    <div style="font-weight:800;font-size:13px"><i class="fas ${veh.icon}"></i> ${esc(t.destination || 'Entrega')}</div>
                    ${itemsSummary ? `<div class="md-req-items" data-md-req-items><i class="fas fa-utensils"></i> ${esc(itemsSummary)}</div>` : ''}
                    <div style="font-size:12px;color:#64748b">Cliente paga ${esc(money((Number(t.priceNum) || 0) + collect))}${collect > 0 ? ` (envío ${esc(t.price || '')} + productos ${esc(money(collect))})` : ' (envío)'}${t.driverName ? ` · ${esc(t.driverName)}` : ''} ${wait}</div>
                    ${recipientName || recipientPhone ? `<div style="font-size:11px;color:#475569;margin-top:2px"><i class="fas fa-user"></i> Recibe: <b>${esc(recipientName || 'Cliente')}</b>${recipientPhone ? ` · ${esc(recipientPhone)}` : ''}</div>` : ''}
                    ${canShare ? `<div class="md-req-actions">
                        <button type="button" class="md-wa-btn" data-md-share-wa="${esc(t.id)}" title="Compartir seguimiento en vivo al cliente por WhatsApp">
                            <i class="fab fa-whatsapp"></i> Compartir viaje por WhatsApp
                        </button>
                        <button type="button" class="md-copy-btn" data-md-copy-link="${esc(t.id)}" title="Copiar link de seguimiento en vivo">
                            <i class="fas fa-link"></i> Copiar link del viaje
                        </button>
                        <button type="button" class="md-copy-btn" data-md-share-native="${esc(t.id)}" title="Compartir desde la app">
                            <i class="fas fa-share-nodes"></i> Compartir desde la app
                        </button>
                        ${canChat ? `<button type="button" class="md-btn2" style="padding:5px 9px;font-size:11.5px" data-md-chat="${esc(t.id)}"><i class="fas fa-comments"></i> Chat repartidor</button>` : ''}
                    </div>` : ''}
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
                    <span class="md-pill" data-md-status="${s.key}" style="color:${TONE[s.tone]}">${esc(s.label)}</span>
                    ${s.canCancel ? `<button type="button" class="md-cancel" data-md-cancel="${esc(t.id)}">Cancelar</button>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function pickupHtml() {
        const s = ctx.store || {};
        if (hasPick()) {
            return `<div class="md-pick" data-md-pickup="locked"><div class="ic"><i class="fas fa-store"></i></div>
                <div style="min-width:0"><b>${esc(s.name || 'Tu tienda')}</b><span>${esc(st.form.pickupAddress)}</span></div>
                <i class="fas fa-lock lk" title="Ubicación guardada de la tienda"></i></div>`;
        }
        return `<div class="md-warn" data-md-pickup="missing"><b>Tu tienda no tiene ubicación guardada.</b><br>Ponla una sola vez en el mapa y queda guardada para todos tus envíos.
            <button type="button" class="md-btn2" style="margin-top:8px;width:100%" data-md-map="pickup" ${st.savingStore ? 'disabled' : ''}><i class="fas fa-map-pin"></i> ${st.savingStore ? 'Guardando…' : 'Poner pin de mi tienda'}</button></div>`;
    }

    function feeHtml() {
        if (st.quoting) return '<div class="md-fee" data-md-estimate><span style="color:#64748b">Calculando tarifa…</span></div>';
        const p = price();
        if (!p) return `<div class="md-fee" data-md-estimate><span style="color:#64748b">${!hasPick() ? 'Guarda la ubicación de tu tienda' : 'Elige vehículo y punto de entrega para ver la tarifa'}</span></div>`;
        if (p.blocked) return `<div class="md-fee bad" data-md-estimate data-md-tariff="blocked"><span>No hay envío a ese punto</span><br><span class="md-tar">${esc(p.tariff.label)}</span></div>`;
        return `<div class="md-fee" data-md-estimate data-md-tariff="${esc(p.tariff.kind)}">
            <div class="row"><span>Envío (lo paga el cliente) · ${p.km} km</span><b>${money(p.price)}</b></div>
            <span class="md-tar">${esc(p.tariff.label)}</span>
            ${p.commissionPercent != null ? `<div style="font-size:11px;color:#64748b;margin-top:4px">Comisión del servicio: ${p.commissionPercent}% (la paga el conductor)</div>` : ''}
        </div>`;
    }

    function productsHtml() {
        const products = getStoreProducts();
        const selected = syncSelectedItems(false);
        const selectedCount = selected.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
        const itemsBanner = formatDeliveryItemsBannerText(selected);
        const q = String(st.productSearch || '').trim().toLowerCase();
        const filtered = q
            ? products.filter((p) => String(p.name || '').toLowerCase().includes(q) || String(p.category || '').toLowerCase().includes(q))
            : products;

        return `<div class="md-prods" id="md-products-section" data-md-products-section>
            <div class="md-prods-head">
                <div>
                    <span class="md-prods-title">🍽️ Productos del pedido <small>(opcional — puedes dejarlo vacío)</small></span>
                    <span class="md-prods-sub">Toca <b>+</b> para sumar tus productos registrados o déjalo vacío si solo ocupas el motorista.</span>
                </div>
                ${selectedCount > 0
                    ? `<button type="button" class="md-prod-clear" data-md-clear-products id="md-clear-products-btn"><i class="fas fa-trash-alt"></i> Limpiar productos (${selectedCount})</button>`
                    : `<span class="md-prod-empty-pill" data-md-empty-products id="md-empty-products-badge">✓ Envío libre (0 productos)</span>`}
            </div>
            ${products.length > 4 ? `<input id="md-product-search" data-md-field="productSearch" class="md-prod-search" value="${esc(st.productSearch)}" placeholder="🔍 Filtrar productos de tu tienda…">` : ''}
            ${products.length
                ? `<div class="md-prod-grid" data-md-product-list>
                    ${filtered.map((prod) => {
                        const pid = String(prod.id || prod.productId || '');
                        const pr = Number(prod.basePrice ?? prod.price ?? 0) || 0;
                        const qty = Math.floor(Number(st.selectedQtys[pid]) || 0);
                        const img = prod.imageUrl || prod.photoUrl || '';
                        return `<div class="md-prod-card ${qty > 0 ? 'on' : ''}" data-md-product-card="${esc(pid)}" data-md-prod-card="${esc(pid)}">
                            ${img
                                ? `<img src="${esc(img)}" alt="" class="md-prod-thumb">`
                                : `<div class="md-prod-thumb md-prod-thumb--icon"><i class="fas fa-utensils"></i></div>`}
                            <div class="md-prod-info">
                                <b title="${esc(prod.name)}">${esc(prod.name)}</b>
                                <span>${esc(money(pr))}</span>
                            </div>
                            <div class="md-prod-stepper">
                                <button type="button" data-md-prod-dec="${esc(pid)}" ${qty <= 0 ? 'disabled' : ''} aria-label="Restar ${esc(prod.name)}">−</button>
                                <span data-md-prod-qty="${esc(pid)}">${qty}</span>
                                <button type="button" data-md-prod-inc="${esc(pid)}" aria-label="Sumar ${esc(prod.name)}">+</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`
                : `<div class="md-prod-none">Puedes enviar sin seleccionar productos, o registrar tu menú en la pestaña <b>Menú</b> para elegirlos con un toque.</div>`}
            ${itemsBanner ? `<div class="md-prod-banner" id="md-selected-items-banner" data-md-items-banner>${esc(itemsBanner)}</div>` : ''}
        </div>`;
    }

    function html() {
        const a = avail(); const f = st.form; const e = st.errors; const p = price();
        const vehBtn = (v) => {
            const m = MERCHANT_DELIVERY_VEHICLES[v]; const ok = a[v].available;
            return `<button type="button" data-md-vehicle="${v}" class="${st.vehicle === v ? 'on' : ''}" ${ok ? '' : 'disabled'} title="${esc(a[v].message)}">
                <i class="fas ${m.icon}" style="font-size:20px"></i>${m.label}${ok ? '' : '<small>No disponible</small>'}</button>`;
        };
        const field = (k, label, extra = '', tag = 'input') => `<div class="md-f"><label for="md-${k}">${label}</label>
            ${tag === 'textarea' ? `<textarea id="md-${k}" data-md-field="${k}" rows="2" ${extra}>${esc(f[k])}</textarea>` : `<input id="md-${k}" data-md-field="${k}" value="${esc(f[k])}" ${extra}>`}
            ${e[k] ? `<span class="md-err">${esc(e[k])}</span>` : ''}</div>`;
        const collect = Number(f.collectAmount) || 0;
        const canGo = st.vehicle && !st.busy && hasPick() && (!p || !p.blocked);
        return `<div class="md-wrap">
            <div class="md-card"><h3><i class="fas fa-paper-plane"></i> Pedir envío</h3>
                <div class="md-veh">${vehBtn('moto')}${vehBtn('auto')}</div>
                ${e.vehicle ? `<span class="md-err">${esc(e.vehicle)}</span>` : ''}
                <span class="md-lbl">Recoger en</span>
                ${pickupHtml()}
                ${e.pickup ? `<span class="md-err">${esc(e.pickup)}</span>` : ''}
                <label class="md-lbl" for="md-dropoffAddress">Entregar en</label>
                <div class="md-drop">
                    <input id="md-dropoffAddress" data-md-field="dropoffAddress" value="${esc(f.dropoffAddress)}" autocomplete="off" placeholder="Buscar dirección o lugar">
                    <button type="button" class="md-btn2" data-md-map="dropoff"><i class="fas fa-map-location-dot"></i> Usar mapa</button>
                    ${st.suggestions.length ? `<div class="md-sug">${st.suggestions.map((s, i) => `<button type="button" data-md-sug="${i}"><i class="fas fa-location-dot" style="color:#94a3b8;margin-top:2px"></i><span>${esc(s.description)}</span></button>`).join('')}</div>` : ''}
                </div>
                ${hasDrop() ? `<div class="md-ok" data-md-dropok><i class="fas fa-check"></i> Punto listo · ${Number(f.dropoffLat).toFixed(5)}, ${Number(f.dropoffLng).toFixed(5)}</div>` : ''}
                ${e.dropoff ? `<span class="md-err">${esc(e.dropoff)}</span>` : ''}
                ${field('customerName', 'Nombre de quien recibe (opcional)')}
                ${field('customerPhone', 'Teléfono de quien recibe (opcional)', 'inputmode="tel"')}
                ${field('notes', 'Notas para el conductor', 'maxlength="300" placeholder="Ej. casa verde, portón negro"', 'textarea')}
                ${feeHtml()}
                ${productsHtml()}
                <div class="md-cash"><label for="md-collectAmount"><i class="fas fa-money-bill-wave"></i> Cobrar al cliente en efectivo por los productos (opcional)</label>
                    <input id="md-collectAmount" data-md-field="collectAmount" value="${esc(f.collectAmount)}" inputmode="decimal" placeholder="L. 0.00">
                    <input id="md-productCharge" data-md-field="collectAmount" value="${esc(f.collectAmount)}" type="hidden">
                    <small>El valor de tus productos. El conductor lo cobra junto con el envío y te lo entrega (puedes dejarlo en 0 o editarlo).</small>
                    ${e.collectAmount ? `<span class="md-err">${esc(e.collectAmount)}</span>` : ''}</div>
                ${p && !p.blocked ? `<div class="md-total" data-md-summary>${esc(customerChargeText(p.price, collect))}</div>` : ''}
                <button type="button" class="md-go" data-md-submit ${canGo ? '' : 'disabled'}>${st.busy ? 'Pidiendo…' : `Pedir ${st.vehicle ? MERCHANT_DELIVERY_VEHICLES[st.vehicle].label.toLowerCase() : 'envío'}`}</button>
            </div>
            <div class="md-card"><h3>Mis envíos</h3><div data-md-list>${requestsHtml()}</div></div>
        </div>`;
    }

    function render() {
        if (!st.root) return;
        const focusId = document.activeElement?.id; const pos = document.activeElement?.selectionStart;
        st.root.innerHTML = html();
        if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} } }
    }

    // ───── Mapa con pin (centro fijo: se arrastra el mapa, como Uber/Google Maps) ─────
    function openMap(kind) {
        closeMap();
        const s = ctx.store || {};
        const center = kind === 'dropoff' && hasDrop() ? { lat: Number(st.form.dropoffLat), lng: Number(st.form.dropoffLng) }
            : hasPick() ? { lat: Number(st.form.pickupLat), lng: Number(st.form.pickupLng) }
            : (isInHonduras(s.lat, s.lng) ? { lat: Number(s.lat), lng: Number(s.lng) } : (ctx.zone?.center || { lat: 14.4513, lng: -87.6374 }));
        const ov = document.createElement('div');
        ov.className = 'md-map'; ov.setAttribute('data-md-mapov', kind);
        ov.innerHTML = `<div class="md-map-top"><button type="button" data-mm="close" aria-label="Cerrar"><i class="fas fa-arrow-left"></i></button>${TITLE[kind]}</div>
            <div class="md-map-canvas"><div class="md-map-el"></div><i class="fas fa-location-dot md-map-pin"></i>
            <button type="button" class="md-map-gps" data-mm="gps" aria-label="Mi ubicación"><i class="fas fa-crosshairs"></i></button></div>
            <div class="md-map-bot"><div class="md-map-addr" data-mm-addr>Mueve el mapa para poner el pin</div>
            <button type="button" class="md-go" data-mm="ok">${kind === 'pickup' ? 'Guardar ubicación de la tienda' : 'Entregar aquí'}</button></div>`;
        document.body.appendChild(ov);
        const m = { kind, ov, pos: center, address: '', seq: 0, api: null };
        st.map = m;
        const setAddr = (txt, sub) => { const el = ov.querySelector('[data-mm-addr]'); if (el) el.innerHTML = `${esc(txt)}<small>${esc(sub || '')}</small>`; };
        const onMove = async (p) => {
            m.pos = p; const seq = ++m.seq;
            setAddr('Buscando dirección…', `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
            let addr = '';
            try { addr = ctx.reverseGeocode ? (await ctx.reverseGeocode(p.lat, p.lng)) || '' : ''; } catch (_) {}
            if (seq !== m.seq) return;
            m.address = addr;
            setAddr(addr || 'Punto en el mapa', `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
        };
        try { m.api = ctx.createMap ? ctx.createMap(ov.querySelector('.md-map-el'), center, onMove) : null; } catch (e) { console.warn('[envio] mapa', e); }
        onMove(center);
        ov.addEventListener('click', async (ev) => {
            const b = ev.target.closest('[data-mm]'); if (!b) return;
            const a = b.dataset.mm;
            if (a === 'close') return closeMap();
            if (a === 'gps') {
                try {
                    const p = ctx.getGps ? await ctx.getGps() : null;
                    if (p) { m.api?.setCenter?.(p); onMove(p); }
                } catch (_) { ctx.toast?.('No se pudo leer tu ubicación', 'warning'); }
                return;
            }
            if (a === 'ok') {
                const p = m.pos;
                if (!isInHonduras(p.lat, p.lng)) return ctx.toast?.('Ese punto está fuera de Honduras', 'warning');
                const address = m.address || `Punto en el mapa (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`;
                closeMap();
                if (kind === 'dropoff') {
                    Object.assign(st.form, { dropoffAddress: address, dropoffLat: p.lat, dropoffLng: p.lng });
                    st.suggestions = []; delete st.errors.dropoff; render(); requote();
                } else {
                    await saveStorePin({ lat: p.lat, lng: p.lng, address: m.address || ctx.store?.address || '' });
                }
            }
        });
    }
    function closeMap() {
        if (!st.map) return;
        try { st.map.api?.destroy?.(); } catch (_) {}
        st.map.ov.remove(); st.map = null;
    }
    async function saveStorePin(loc) {
        st.savingStore = true; render();
        try {
            await ctx.saveStoreLocation(loc);
            ctx.store = { ...(ctx.store || {}), lat: loc.lat, lng: loc.lng, address: loc.address || ctx.store?.address || '', locationApprox: false };
            syncPickup(); delete st.errors.pickup; st.quoteKey = '';
            ctx.toast?.('Ubicación de la tienda guardada', 'success');
        } catch (e) { ctx.toast?.('No se pudo guardar la ubicación', 'error'); }
        finally { st.savingStore = false; render(); requote(); }
    }

    async function onInput(ev) {
        const k = ev.target?.dataset?.mdField; if (!k) return;
        if (k === 'productSearch') {
            st.productSearch = ev.target.value;
            render();
            return;
        }
        st.form[k] = ev.target.value;
        if (k === 'collectAmount') {
            const c1 = st.root?.querySelector('#md-collectAmount');
            const c2 = st.root?.querySelector('#md-productCharge');
            if (c1 && c1 !== ev.target) c1.value = ev.target.value;
            if (c2 && c2 !== ev.target) c2.value = ev.target.value;
            const el = st.root.querySelector('[data-md-summary]'); const p = price(); const c = Number(ev.target.value) || 0;
            if (el && p) el.textContent = customerChargeText(p.price, c);
        }
        if (k === 'dropoffAddress') {
            st.form.dropoffLat = null; st.form.dropoffLng = null; st.quote = null; st.quoteKey = '';
            clearTimeout(st.sugTimer);
            const q = ev.target.value.trim();
            const directCoords = parseHondurasCoordsInput(q);
            if (directCoords) {
                st.form.dropoffLat = directCoords.lat;
                st.form.dropoffLng = directCoords.lng;
                st.suggestions = [];
                delete st.errors.dropoff;
                render();
                requote();
                return;
            }
            st.sugTimer = setTimeout(async () => {
                st.suggestions = q.length >= 3 && ctx.placesFetch ? (await ctx.placesFetch(q).catch(() => [])) : [];
                render();
            }, 250);
        }
    }

    async function onClick(ev) {
        if (st.suggestions.length && !ev.target.closest('.md-drop')) { st.suggestions = []; render(); }
        const incBtn = ev.target.closest('[data-md-prod-inc]');
        if (incBtn) {
            const pid = incBtn.dataset.mdProdInc;
            if (pid) {
                st.selectedQtys[pid] = (Math.floor(Number(st.selectedQtys[pid]) || 0)) + 1;
                syncSelectedItems(true);
                render();
            }
            return;
        }
        const decBtn = ev.target.closest('[data-md-prod-dec]');
        if (decBtn && !decBtn.disabled) {
            const pid = decBtn.dataset.mdProdDec;
            if (pid) {
                const next = Math.max(0, (Math.floor(Number(st.selectedQtys[pid]) || 0)) - 1);
                if (next <= 0) delete st.selectedQtys[pid];
                else st.selectedQtys[pid] = next;
                syncSelectedItems(true);
                render();
            }
            return;
        }
        const clrBtn = ev.target.closest('[data-md-clear-products]');
        if (clrBtn) {
            st.selectedQtys = {};
            st.productSearch = '';
            syncSelectedItems(true);
            render();
            return;
        }
        const v = ev.target.closest('[data-md-vehicle]');
        if (v && !v.disabled) { st.vehicle = v.dataset.mdVehicle; delete st.errors.vehicle; render(); return requote(); }
        const mp = ev.target.closest('[data-md-map]');
        if (mp && !mp.disabled) return openMap(mp.dataset.mdMap);
        const sg = ev.target.closest('[data-md-sug]');
        if (sg) {
            const s = st.suggestions[Number(sg.dataset.mdSug)]; st.suggestions = [];
            const d = s && ctx.placeDetails ? await ctx.placeDetails(s).catch(() => null) : null;
            if (d && isInHonduras(d.lat, d.lng)) { st.form.dropoffAddress = d.address || s.description; st.form.dropoffLat = d.lat; st.form.dropoffLng = d.lng; delete st.errors.dropoff; }
            render(); return requote();
        }
        const shWa = ev.target.closest('[data-md-share-wa]');
        if (shWa) {
            const tripId = shWa.dataset.mdShareWa;
            const trip = st.requests.find((r) => String(r.id) === String(tripId))
                || (st.lastCreatedTrip && String(st.lastCreatedTrip.id) === String(tripId) ? st.lastCreatedTrip : { id: tripId });
            const baseOrigin = (typeof location !== 'undefined' && location.origin && location.origin.startsWith('http') && !location.origin.includes('127.0.0.1') && !location.origin.includes('localhost'))
                ? location.origin
                : 'https://honduraite.com';
            const waUrl = buildMerchantShareTripWhatsAppUrl({
                trip,
                storeName: ctx.store?.name || 'Mi negocio',
                baseOrigin,
            });
            const trackUrl = buildDeliveryTrackingUrl(tripId, baseOrigin);
            if (typeof ctx.onShareWhatsApp === 'function') {
                ctx.onShareWhatsApp({ tripId, trip, waUrl, trackUrl });
            } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
                window.open(waUrl, '_blank', 'noopener,noreferrer');
            }
            ctx.toast?.('📲 Abriendo WhatsApp con el link de seguimiento para el cliente…', 'success');
            return;
        }
        const cpLink = ev.target.closest('[data-md-copy-link]');
        if (cpLink) {
            const tripId = cpLink.dataset.mdCopyLink;
            const baseOrigin = (typeof location !== 'undefined' && location.origin && location.origin.startsWith('http') && !location.origin.includes('127.0.0.1') && !location.origin.includes('localhost'))
                ? location.origin
                : 'https://honduraite.com';
            const trackUrl = buildDeliveryTrackingUrl(tripId, baseOrigin);
            if (typeof ctx.onCopyTrackingLink === 'function') {
                ctx.onCopyTrackingLink({ tripId, trackUrl });
            }
            try {
                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(trackUrl);
                }
            } catch (_) {}
            ctx.toast?.('📋 Link de seguimiento copiado: ' + trackUrl, 'success');
            return;
        }
        const shn = ev.target.closest('[data-md-share-native]');
        if (shn) {
            const tripId = shn.dataset.mdShareNative;
            const trip = st.requests.find((r) => String(r.id) === String(tripId)) || { id: tripId };
            const baseOrigin = (typeof window !== 'undefined' && window.location?.origin && /^https?:/i.test(window.location.origin))
                ? window.location.origin
                : 'https://honduraite.com';
            const trackUrl = buildDeliveryTrackingUrl(tripId, baseOrigin);
            const msgText = buildMerchantShareTripMessage({
                trip,
                storeName: ctx.store?.name || trip?.deliveryDetails?.storeName || 'Nuestra tienda',
                trackingUrl: trackUrl,
                baseOrigin,
            });
            try {
                if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                    await navigator.share({ title: 'Seguimiento de tu pedido', text: msgText, url: trackUrl });
                    return;
                }
            } catch (_) {}
            try {
                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(msgText);
                }
            } catch (_) {}
            ctx.toast?.('🔗 Mensaje y link de seguimiento listos para compartir', 'success');
            return;
        }
        const ch = ev.target.closest('[data-md-chat]');
        if (ch) {
            const tripId = ch.dataset.mdChat;
            if (ctx.openChat) return ctx.openChat(tripId);
            if (typeof window !== 'undefined' && typeof window.openStoreTripChatModal === 'function') {
                return window.openStoreTripChatModal({ tripId, role: 'merchant', storeName: ctx.store?.name || 'Mi tienda' });
            }
            return;
        }
        const c = ev.target.closest('[data-md-cancel]');
        if (c) {
            if (ctx.confirm && !ctx.confirm('¿Cancelar este envío?')) return;
            c.disabled = true;
            try { await ctx.cancelTrip(c.dataset.mdCancel, merchantCancelPatch()); ctx.toast?.('Envío cancelado', 'info'); }
            catch (e) { ctx.toast?.('Ya no se puede cancelar: un conductor lo aceptó', 'error'); c.disabled = false; }
            return;
        }
        if (ev.target.closest('[data-md-submit]')) return submit();
    }

    async function submit() {
        syncPickup();
        syncSelectedItems(false);
        const form = { ...st.form, vehicle: st.vehicle, items: st.form.items };
        st.errors = validateMerchantDeliveryForm(form);
        const a = st.vehicle ? avail()[st.vehicle] : null;
        if (a && !a.available) st.errors.vehicle = a.message || 'No disponible';
        if (Object.keys(st.errors).length) return render();
        await requote();
        const est = price();
        if (!est || est.blocked) { st.errors.dropoff = 'No hay envío a ese punto'; return render(); }
        st.busy = true; render();
        try {
            const payload = buildMerchantDeliveryTrip({ store: ctx.store, uid: ctx.uid, form, estimate: est, zone: ctx.zone, serverTs: ctx.serverTs?.() ?? null });
            const id = await ctx.createTrip(payload);
            st.lastCreatedTrip = { id, ...payload };
            try {
                ctx.onTripCreated?.(payload, { id, items: (st.form.items || []).slice(), store: ctx.store });
            } catch (_) {}
            ctx.toast?.(`Envío pedido · verificando precio y buscando ${MERCHANT_DELIVERY_VEHICLES[st.vehicle].label.toLowerCase()}`, 'success');
            st.selectedQtys = {};
            st.productSearch = '';
            st.form = { ...st.form, dropoffAddress: '', dropoffLat: null, dropoffLng: null, customerName: '', customerPhone: '', notes: '', collectAmount: '', items: [] };
            st.quote = null; st.quoteKey = '';
            if (!st.requests.some((r) => String(r.id) === String(id))) {
                st.requests = [{ id, ...payload }, ...st.requests];
            }
        } catch (e) {
            ctx.toast?.(e?.message || 'No se pudo pedir el envío', 'error');
        } finally { st.busy = false; render(); }
    }

    return {
        mount(root) {
            st.root = root;
            if (!document.getElementById('md-css')) { const s = document.createElement('style'); s.id = 'md-css'; s.textContent = MERCHANT_DELIVERY_CSS; document.head.appendChild(s); }
            root.addEventListener('input', onInput);
            root.addEventListener('click', onClick);
            Promise.resolve(ctx.getCommission?.('delivery')).then((p) => { if (Number.isFinite(Number(p))) { st.commission = Number(p); render(); } }).catch(() => {});
            if (ctx.subscribe) st.unsub = ctx.subscribe((list) => { st.requests = list; const el = root.querySelector('[data-md-list]'); if (el) el.innerHTML = requestsHtml(); else render(); });
            render();
        },
        unmount() {
            try { st.unsub?.(); } catch (_) {}
            st.unsub = null; closeMap();
            if (st.root) { st.root.removeEventListener('input', onInput); st.root.removeEventListener('click', onClick); }
            st.root = null;
        },
        _state: st,
    };
}
