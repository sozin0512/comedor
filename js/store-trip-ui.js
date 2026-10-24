/**
 * Pedido de tienda / envío en la app del conductor, cliente y panel de supervisión:
 *  - en la oferta: insignia «Pedido de tienda», zona de envío y qué cobrar
 *  - después de aceptar: flujo de 2 etapas SIN PIN (1. Recoger en negocio → 2. Entregar a cliente),
 *    productos, dirección y teléfono del negocio y de quien recibe, y total a cobrar.
 * Sin imports ni DOM global: funciones puras que devuelven HTML (probadas en scripts/test-tasa-disponibilidad.mjs).
 */

function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
function num(v) {
    const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
}
function money(n) {
    // Mismo formato que el resto de la app (js/money-format.js): «L. 1,234.00».
    const v = Math.round(num(n) * 100) / 100;
    return `L. ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function digits(p) { return String(p || "").replace(/\D/g, ""); }

export function isStoreOrderTrip(t) {
    if (!t || typeof t !== "object") return false;
    return !!(
        t.storeOrderId
        || t.storeOrder === true
        || t.storeDelivery === true
        || t.merchantDirectDelivery === true
        || t.createdByMerchant === true
        || t.tripKind === "store_order"
        || t.tripKind === "merchant_delivery"
        || t.deliveryDetails?.storeOrderId
        || t.deliveryDetails?.storeDelivery === true
        || t.deliveryDetails?.merchantDirectDelivery === true
    );
}

/**
 * Todo envío de tienda o servicio delivery (nunca lleva PIN de pasajero;
 * primero va al negocio a recoger y luego al cliente a entregar).
 */
export function isDeliveryTrip(t) {
    if (!t || typeof t !== "object") return false;
    return !!(t.serviceType === "delivery" || isStoreOrderTrip(t));
}

export function getDeliveryStoreName(t) {
    if (!t || typeof t !== "object") return "el negocio";
    const d = t.deliveryDetails || {};
    const raw = String(t.storeName || d.storeName || d.restaurant || t.originPlaceName || t.merchantName || "").trim();
    if (raw) return raw;
    if (typeof t.origin === "string" && t.origin.includes(" · ")) {
        const prefix = t.origin.split(" · ")[0].trim();
        if (prefix && prefix.length <= 50) return prefix;
    }
    return "el negocio";
}

export function getDeliveryRecipientName(t) {
    if (!t || typeof t !== "object") return "Cliente";
    const d = t.deliveryDetails || {};
    const raw = String(t.recipientName || d.recipientName || t.clientName || "").trim();
    return raw || "Cliente";
}

/**
 * Metadatos de la etapa actual de un envío (sin PIN de pasajero).
 * Etapa 1a (status === "accepted" && !driverArrived): En camino al negocio a recoger el pedido
 * Etapa 1b (status === "accepted" && driverArrived): En el negocio · recogiendo pedido
 * Etapa 2  (status === "in_progress"): En camino al cliente a entregar el pedido
 */
export function getDeliveryStageMeta(t) {
    const storeName = getDeliveryStoreName(t);
    const recipientName = getDeliveryRecipientName(t);
    const status = String(t?.status || "accepted");
    const arrivedAtStore = !!t?.driverArrived;

    if (status === "in_progress") {
        return {
            stage: "to_customer",
            stepNum: 2,
            storeName,
            recipientName,
            headerTitle: `🛵 En camino al cliente a entregar el pedido`,
            shortBadge: "🛵 Hacia el cliente",
            routeLabel: `🛵 PASO 2/2 · IR AL CLIENTE (${recipientName.toUpperCase()}) A ENTREGAR`,
            primaryBtnLabel: "✅ Pedido entregado · Finalizar envío",
            secondaryBtnLabel: null,
            subtext: "Sin PIN · Dirígete a la ubicación del cliente para entregar el pedido.",
        };
    }
    if (status === "accepted" && arrivedAtStore) {
        return {
            stage: "at_store",
            stepNum: 1,
            storeName,
            recipientName,
            headerTitle: `🏪 En ${storeName} · Recogiendo pedido`,
            shortBadge: "🏪 En el negocio",
            routeLabel: `📦 PASO 1/2 · EN ${storeName.toUpperCase()} · RECOGIENDO PEDIDO`,
            primaryBtnLabel: "📦 Pedido recogido · Iniciar ruta al cliente",
            secondaryBtnLabel: null,
            subtext: "Sin PIN · Cuando tengas el pedido en mano, toca para iniciar ruta hacia el cliente.",
        };
    }
    return {
        stage: "to_store",
        stepNum: 1,
        storeName,
        recipientName,
        headerTitle: `🛵 En camino a ${storeName} a recoger el pedido`,
        shortBadge: "🏪 Hacia el negocio",
        routeLabel: `🏪 PASO 1/2 · IR A ${storeName.toUpperCase()} A RECOGER EL PEDIDO`,
        primaryBtnLabel: "🏪 Llegué al negocio",
        secondaryBtnLabel: "📦 Ya recogí el pedido · Ir al cliente",
        subtext: "Sin PIN · Ve primero al negocio a recoger la comida/pedido y luego al cliente.",
    };
}


/**
 * Devuelve los mensajes de chat de un envío según el canal:
 * - "merchant": mensajes entre repartidor y negocio (t.chatMerchant o t.chat con channel/target === "merchant")
 * - "client": mensajes entre repartidor y cliente (t.chat sin channel === "merchant")
 */
export function getDeliveryChatMessages(t, channel = "client") {
    if (!t || typeof t !== "object") return [];
    const rawClient = Array.isArray(t.chat) ? t.chat : [];
    const rawMerch = Array.isArray(t.chatMerchant) ? t.chatMerchant : [];
    if (channel === "merchant") {
        const fromMain = rawClient.filter((m) => m && (m.channel === "merchant" || m.target === "merchant"));
        const combined = [...rawMerch, ...fromMain];
        const seen = new Set();
        return combined.filter((m) => {
            if (!m) return false;
            const k = `${m.sender || ""}:${m.time || 0}:${m.text || ""}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        }).sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    }
    return rawClient.filter((m) => m && m.channel !== "merchant" && m.target !== "merchant");
}

export function getDefaultDeliveryChatChannel(t) {
    if (!t || typeof t !== "object") return "merchant";
    return t.status === "in_progress" ? "client" : "merchant";
}

export function buildDeliveryDualChatTabsHtml(t, activeChannel = null) {
    const ch = activeChannel === "client" || activeChannel === "merchant"
        ? activeChannel
        : getDefaultDeliveryChatChannel(t);
    const storeName = getDeliveryStoreName(t);
    const recipientName = getDeliveryRecipientName(t);
    const merchMsgs = getDeliveryChatMessages(t, "merchant");
    const clientMsgs = getDeliveryChatMessages(t, "client");
    return `<div class="hr-store-chat-tabs" data-delivery-chat-tabs data-active-channel="${esc(ch)}">
        <button type="button" class="hr-store-chat-tab ${ch === "merchant" ? "is-active" : ""}" data-delivery-chat-tab="merchant" onclick="window.setDeliveryTripChatChannel?.('merchant')">
            <i class="fas fa-store"></i>
            <span>Chat Negocio (${esc(storeName)})</span>
            <span class="hr-store-chat-count">${merchMsgs.length}</span>
        </button>
        <button type="button" class="hr-store-chat-tab ${ch === "client" ? "is-active" : ""}" data-delivery-chat-tab="client" onclick="window.setDeliveryTripChatChannel?.('client')">
            <i class="fas fa-user"></i>
            <span>Chat Cliente (${esc(recipientName)})</span>
            <span class="hr-store-chat-count">${clientMsgs.length}</span>
        </button>
    </div>`;
}

/** «Pedido tienda: 3× Baleada, 1× Horchata» → [{qty,name}] (viajes viejos sin items). */
function parseItemsFromDescription(desc) {
    const s = String(desc || "").replace(/^Pedido tienda:\s*/i, "");
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
    const isStore = isStoreOrderTrip(t);
    const d = t?.deliveryDetails || {};
    const hasLegacyDeliveryDetails = t?.serviceType === "delivery" && !!(d.recipientName || d.packageDescription || d.restaurant);
    if (!isStore && !hasLegacyDeliveryDetails) return null;
    const items = Array.isArray(d.items) && d.items.length
        ? d.items.map((i) => ({ qty: Number(i.qty) || 1, name: String(i.name || ""), price: i.price != null ? num(i.price) : null }))
        : parseItemsFromDescription(d.packageDescription);
    const itemsTotal = num(d.itemsTotal);
    const fee = deliveryPrice != null ? num(deliveryPrice) : num(t.negotiatedPrice ?? t.priceNum ?? t.price);
    const direct = t.merchantDirectDelivery === true || (!isStore && hasLegacyDeliveryDetails && itemsTotal === 0);
    const paid = !direct && (d.productsPaid === true || d.productsPaymentMethod === "saldo");
    const cashToCollect = paid ? fee : fee + itemsTotal;
    return {
        storeName: String(d.storeName || d.restaurant || t.originPlaceName || "Tienda"),
        storePhone: String(d.storePhone || ""),
        storeAddress: String(t.origin || t.originFormattedAddress || ""),
        deliveryAddress: String(t.destination || t.destinationFormattedAddress || ""),
        zoneName: String(t.deliveryZoneName || "") || null,
        items,
        itemsTotal,
        fee,
        direct,
        productsPaid: paid,
        cashToCollect,
        recipientName: String(d.recipientName || t.clientName || ""),
        recipientPhone: String(d.recipientPhone || t.clientPhone || ""),
        notes: String(d.deliveryNotes || ""),
        packageDescription: String(d.packageDescription || ""),
        orderShortId: String(t.storeOrderId || d.storeOrderId || "").slice(0, 6).toUpperCase(),
    };
}

export function storeOfferBadgesHtml(t) {
    if (!isStoreOrderTrip(t)) return "";
    const zone = t.deliveryZoneName ? `<span class="hr-store-zone-badge"><i class="fas fa-map-marker-alt"></i> ${esc(t.deliveryZoneName)}</span>` : "";
    return `<span class="hr-store-badge"><i class="fas fa-shopping-bag"></i> Pedido de tienda</span>${zone}`;
}

/** Caja verde/azul: qué cobrar. */
export function storeCollectHtml(t, deliveryPrice = null) {
    if (!isStoreOrderTrip(t)) return "";
    const s = storeOrderSummary(t, deliveryPrice);
    if (!s) return "";
    const zone = s.zoneName ? ` · ${esc(s.zoneName)}` : "";
    if (s.direct) {
        // Envío directo de tienda: el cliente paga el envío (+ productos si la tienda puso monto)
        const rows = s.itemsTotal > 0
            ? `<p class="hr-store-collect-row"><span>Envío${zone}</span><b>${money(s.fee)}</b></p>
               <p class="hr-store-collect-row"><span>Productos (son de la tienda)</span><b>${money(s.itemsTotal)}</b></p>`
            : "";
        return `<div class="hr-store-collect" data-store-direct>
            <p class="hr-store-collect-title"><i class="fas fa-money-bill-wave"></i> Cobrar al cliente en efectivo</p>
            ${rows}
            <p class="hr-store-collect-row hr-store-collect-total"><span>${s.itemsTotal > 0 ? `Envío ${money(s.fee)} + productos ${money(s.itemsTotal)}` : `Solo el envío${zone}`}</span><b>${money(s.cashToCollect)}</b></p>
            <p class="hr-store-collect-note">${s.itemsTotal > 0 ? `Le entregas ${money(s.itemsTotal)} a la tienda · tu envío ${money(s.fee)} (menos la comisión HonduRaite).` : "La tienda no puso cobro de productos."}</p>
        </div>`;
    }
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
        <p class="hr-store-collect-note">Le pasas ${money(s.itemsTotal)} a la tienda al recoger · tu envío ${money(s.fee)} (menos la comisión HonduRaite).</p>
    </div>`;
}

/** Panel después de aceptar: ruta en 2 pasos (1. Negocio → 2. Cliente) sin PIN + productos + quién recibe + cobro. */
export function storeAcceptedPanelHtml(t, deliveryPrice = null) {
    const s = storeOrderSummary(t, deliveryPrice);
    if (!s) return "";
    const stageMeta = getDeliveryStageMeta(t);
    const isStep2 = stageMeta.stepNum === 2;
    const items = s.items.length
        ? s.items.map((i) => `<li><span>${esc(i.qty)}× ${esc(i.name)}</span>${i.price != null ? `<b>${money(i.price * i.qty)}</b>` : ""}</li>`).join("")
        : `<li><span>${esc(s.packageDescription || "Revisa el pedido con la tienda")}</span></li>`;

    const storeTel = digits(s.storePhone);
    const storeWa = storeTel ? (storeTel.length === 8 ? `504${storeTel}` : storeTel) : "";
    const merchChatCount = getDeliveryChatMessages(t, "merchant").length;
    const clientChatCount = getDeliveryChatMessages(t, "client").length;
    const storeChatBtn = `<button type="button" class="hr-store-inapp-chat hr-store-inapp-chat--merchant" data-open-delivery-chat="merchant" onclick="window.openDeliveryTripChat?.('merchant')"><i class="fas fa-comments"></i> Chat con Negocio${merchChatCount ? ` (${merchChatCount})` : ""}</button>`;
    const clientChatBtn = `<button type="button" class="hr-store-inapp-chat hr-store-inapp-chat--client" data-open-delivery-chat="client" onclick="window.openDeliveryTripChat?.('client')"><i class="fas fa-comments"></i> Chat con Cliente${clientChatCount ? ` (${clientChatCount})` : ""}</button>`;
    const storePhoneBtns = storeTel
        ? `<div class="hr-store-contact">
            <a class="hr-store-call" href="tel:${esc(storeTel)}"><i class="fas fa-phone"></i> Tienda: ${esc(s.storePhone)}</a>
            <a class="hr-store-wa" href="https://wa.me/${esc(storeWa)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp tienda</a>
          </div>${storeChatBtn}`
        : storeChatBtn;

    const tel = digits(s.recipientPhone);
    const wa = tel ? (tel.length === 8 ? `504${tel}` : tel) : "";
    const phoneBtns = tel
        ? `<div class="hr-store-contact">
            <a class="hr-store-call" href="tel:${esc(tel)}"><i class="fas fa-phone"></i> ${esc(s.recipientPhone)}</a>
            <a class="hr-store-wa" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>
          </div>${clientChatBtn}`
        : clientChatBtn;

    return `<div class="hr-store-panel" data-store-order-panel data-delivery-stage="${esc(stageMeta.stage)}">
        <p class="hr-store-panel-head">${storeOfferBadgesHtml(t)}<span class="hr-store-nopin-badge"><i class="fas fa-check-circle"></i> Sin PIN de pasajero</span>${s.orderShortId ? `<span class="hr-store-id">#${esc(s.orderShortId)}</span>` : ""}</p>
        <div class="hr-store-stage-banner hr-store-stage-banner--${esc(stageMeta.stage)}">
            <p class="hr-store-stage-title">${esc(stageMeta.headerTitle)}</p>
            <p class="hr-store-stage-sub">${esc(stageMeta.subtext)}</p>
            <div class="hr-store-steps">
                <span class="hr-store-step ${!isStep2 ? "is-active" : "is-done"}">1. 🏪 Recoger en negocio</span>
                <span class="hr-store-step-arrow">→</span>
                <span class="hr-store-step ${isStep2 ? "is-active" : ""}">2. 👤 Entregar al cliente</span>
            </div>
        </div>
        ${s.direct ? `<div class="hr-store-box ${!isStep2 ? "hr-store-box--active-leg" : ""}">
            <p class="hr-store-box-title"><i class="fas fa-store"></i> 1. Recoger en negocio · ${esc(s.storeName)}</p>
            ${s.storeAddress ? `<p class="hr-store-addr"><i class="fas fa-map-pin"></i> ${esc(s.storeAddress)}</p>` : ""}
            <p class="hr-store-muted">${s.packageDescription ? esc(s.packageDescription) + " · " : ""}Envío directo de la tienda.${s.itemsTotal > 0 ? ` Cobra ${money(s.itemsTotal)} de productos y entrégalo a la tienda.` : ""}</p>
            ${storePhoneBtns}
        </div>` : `<div class="hr-store-box ${!isStep2 ? "hr-store-box--active-leg" : ""}">
            <p class="hr-store-box-title"><i class="fas fa-store"></i> 1. Recoger en negocio · Productos · ${esc(s.storeName)}</p>
            ${s.storeAddress ? `<p class="hr-store-addr"><i class="fas fa-map-pin"></i> ${esc(s.storeAddress)}</p>` : ""}
            <ul class="hr-store-items">${items}</ul>
            <p class="hr-store-collect-row hr-store-collect-total"><span>Total de la tienda</span><b>${money(s.itemsTotal)}</b></p>
            <p class="hr-store-muted">Revisa que esté todo antes de salir de la tienda.</p>
            ${storePhoneBtns}
        </div>`}
        <div class="hr-store-box ${isStep2 ? "hr-store-box--active-leg" : ""}">
            <p class="hr-store-box-title"><i class="fas fa-user"></i> 2. Entregar a ${esc(s.recipientName || "cliente")} (recibe)</p>
            ${s.deliveryAddress ? `<p class="hr-store-addr"><i class="fas fa-location-arrow"></i> ${esc(s.deliveryAddress)}</p>` : ""}
            ${s.notes ? `<p class="hr-store-muted">«${esc(s.notes)}»</p>` : ""}
            ${phoneBtns}
        </div>
        ${storeCollectHtml(t, deliveryPrice)}
    </div>`;
}

export const STORE_TRIP_CSS = `
.hr-store-badge{display:inline-flex;align-items:center;gap:4px;background:#F59E0B;color:#111827;font-weight:900;font-size:11px;padding:3px 8px;border-radius:8px}
.hr-store-zone-badge{display:inline-flex;align-items:center;gap:4px;background:#DBEAFE;color:#1D4ED8;font-weight:800;font-size:11px;padding:3px 8px;border-radius:8px;margin-left:4px}
.hr-store-nopin-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(16,185,129,.18);border:1px solid rgba(16,185,129,.45);color:#6EE7B7;font-weight:800;font-size:10.5px;padding:2px 7px;border-radius:8px;margin-left:4px}
.hr-store-stage-banner{background:linear-gradient(135deg,rgba(30,41,59,.96),rgba(15,23,42,.96));border:1.5px solid #F59E0B;border-radius:14px;padding:9px 11px;color:#F8FAFC}
.hr-store-stage-banner--to_customer{border-color:#22C55E;background:linear-gradient(135deg,rgba(5,46,22,.92),rgba(15,23,42,.96))}
.hr-store-stage-title{font-weight:900;font-size:13.5px;margin:0;color:#FEF3C7}
.hr-store-stage-banner--to_customer .hr-store-stage-title{color:#DCFCE7}
.hr-store-stage-sub{font-size:11px;color:#CBD5E1;margin:3px 0 6px}
.hr-store-steps{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;font-weight:800}
.hr-store-step{padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.08);color:#94A3B8}
.hr-store-step.is-active{background:#F59E0B;color:#111827;font-weight:900}
.hr-store-step.is-done{background:rgba(34,197,94,.22);color:#86EFAC}
.hr-store-step-arrow{color:#64748B;font-weight:900}
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
.hr-store-box--active-leg{border-color:#F59E0B;box-shadow:0 0 0 1px rgba(245,158,11,.25)}
.hr-store-box-title{font-weight:900;margin:0 0 5px;color:#fff}
.hr-store-addr{font-size:12px;color:#E2E8F0;margin:2px 0 6px;font-weight:600}
.hr-store-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;font-size:12.5px}
.hr-store-items li{display:flex;justify-content:space-between;gap:8px}
.hr-store-box .hr-store-collect-total{border-top-color:#374151;color:#fff}
.hr-store-muted{font-size:11px;color:#94A3B8;margin:3px 0 0}
.hr-store-contact{display:flex;gap:6px;margin-top:6px}
.hr-store-contact a{flex:1;text-align:center;font-weight:900;font-size:12.5px;padding:8px;border-radius:10px;color:#fff;text-decoration:none}
.hr-store-call{background:#1D4ED8}.hr-store-wa{background:#16A34A}
.hr-store-inapp-chat{width:100%;margin-top:6px;border:1px solid rgba(59,130,246,.45);background:rgba(30,58,138,.45);color:#DBEAFE;font-weight:900;font-size:12px;padding:8px 10px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.hr-store-inapp-chat--merchant{border-color:rgba(245,158,11,.5);background:rgba(120,53,15,.45);color:#FEF3C7}
.hr-store-chat-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
.hr-store-chat-tab{border:1.5px solid #cbd5e1;background:#f8fafc;color:#334155;font-weight:800;font-size:11.5px;padding:7px 8px;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:5px;cursor:pointer}
.hr-store-chat-tab.is-active[data-delivery-chat-tab="merchant"]{border-color:#d97706;background:#fffbeb;color:#92400e}
.hr-store-chat-tab.is-active[data-delivery-chat-tab="client"]{border-color:#2563eb;background:#eff6ff;color:#1d4ed8}
.hr-store-chat-count{background:rgba(15,23,42,.12);padding:1px 6px;border-radius:999px;font-size:10px;font-weight:900}
`;
