/**
 * WhatsApp · «Pedir a tienda/restaurante»: un CLIENTE arma un pedido por el bot.
 * Crea EXACTAMENTE el mismo documento store_orders que el carrito de la app
 * (js/merchant-stores.js → addDoc(store_orders)), status 'pending'. Desde ahí todo es igual que en la app:
 *   onStoreOrderCreatedZoneFee (tarifa de zona/«bloquear»), onStoreOrderStock (stock), push a la tienda,
 *   la tienda acepta → crea el viaje (melodía 4 a conductores), store-order-sync, comisión en servidor.
 * La cotización que ve el cliente usa la MISMA función que verifica los envíos (delivery-zones:
 * quoteFor + verifyMerchantDirectDelivery: zona, tarifa de la tienda, distancia, carro +25%, bloquear).
 * +18: por WhatsApp no se puede verificar la edad → tiendas +18 nunca aparecen (igual que la lista general).
 * Probado en scripts/test-wa-pedido-cliente.cjs (Meta y Google simulados, Firestore del emulador).
 */
'use strict';

const DZ = require('./delivery-zones');
const SD = require('./wa-store-delivery');

const STEPS = ['co_type', 'co_cat', 'co_dest', 'co_dest_confirm', 'co_store', 'co_products', 'co_qty', 'co_after_add', 'co_cart', 'co_vehicle', 'co_extras', 'co_note_text', 'co_recv_name', 'co_recv_phone', 'co_pay', 'co_confirm'];
const WINDOW_MS = 24 * 60 * 60 * 1000 - 5 * 60 * 1000;
const PAGE = 8;
const MAX_STORE_KM = 25;
const COMMISSION_RATE = 0.10; // = js/store-week.js WEEKLY_COMMISSION_RATE
const SHOP_CATS = [
    { id: 'pulperia', label: 'Pulpería' }, { id: 'farmacia', label: 'Farmacia' },
    { id: 'tienda', label: 'Tienda / boutique' }, { id: 'otro', label: 'Otro negocio' },
];
const HN_UTC_OFFSET_MIN = -6 * 60;

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lmoney = (n) => `L. ${money(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cut = (s, n) => { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

function isEntry(id, t) {
    return id === 'pedir_tienda' || /^(pedir|hacer un pedido|pedir comida|pedir a (una )?(tienda|restaurante)|tiendas|restaurantes|pedido|comprar)$/.test(t)
        || /^pedir a tienda\/restaurante$/.test(t);
}
function isRestaurant(s) {
    const c = fold(s?.category);
    return c === 'comida' || c === 'restaurante' || c.includes('restaurante') || c.includes('comida');
}
/** Igual que js/merchant-stores.js storeTracksStock. */
function tracksStock(s) { return !isRestaurant(s); }
function stockLeft(p, s) { if (!tracksStock(s)) return null; const n = Math.floor(Number(p?.stock)); return Number.isFinite(n) ? Math.max(0, n) : 0; }
function isAdultsOnly(s) { return !!(s?.adultsOnly || s?.requiresAge18 || s?.ageRestricted); }
function approved(s) {
    const raw = fold(s?.approvalStatus);
    const st = ['pending', 'approved', 'rejected'].includes(raw) ? raw : (s?.createdAt ? 'approved' : 'pending');
    return st === 'approved' && s?.active !== false && s?.deleted !== true;
}
/** Igual que js/merchant-stores.js storeOpenInfo (hora de Honduras, interruptor isOpen + horario). */
function hhmm(v) { const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})$/); if (!m) return null; const h = +m[1]; const mi = +m[2]; return h > 23 || mi > 59 ? null : h * 60 + mi; }
function isOpenNow(s, nowMs = Date.now()) {
    const d = new Date(nowMs); const now = (d.getUTCHours() * 60 + d.getUTCMinutes() + HN_UTC_OFFSET_MIN + 1440) % 1440;
    const o = hhmm(s?.hours?.open); const c = hhmm(s?.hours?.close);
    if (s?.isOpen === false) return false;
    if (o == null || c == null || o === c) return true;
    return o < c ? now >= o && now < c : now >= o || now < c;
}
function km(a, b) { const R = 6371; const r = (x) => x * Math.PI / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function cartTotal(cart) { return money((cart || []).reduce((s, i) => s + money(i.price) * (Number(i.qty) || 0), 0)); }
function cartLines(cart) { return (cart || []).map((i) => `• ${i.qty}× ${i.name} — ${lmoney(i.price * i.qty)}`).join('\n'); }

/** Mismo payload que la app (js/merchant-stores.js) + marcas de WhatsApp. */
function buildWaCustomerOrder({ store, cart, dest, vehicle, phone, name, nowMs, serverTs, notes = '', recipient = null, pay = null }) {
    const items = cart.map((i) => ({ productId: i.productId, name: String(i.name).slice(0, 80), basePrice: money(i.price), price: money(i.price), displayPrice: money(i.price), merchantShare: 0, buyerShare: 0, qty: Number(i.qty) || 1, photoUrl: i.photoUrl || null }));
    const itemsTotal = money(items.reduce((s, i) => s + i.basePrice * i.qty, 0));
    return {
        storeId: store.id, storeName: store.name || 'Tienda', ownerId: store.ownerId,
        clientId: pay?.uid || `guest_${phone}`, clientName: String(name || 'Cliente WhatsApp').slice(0, 60), clientPhone: phone,
        items, itemsBaseTotal: itemsTotal, itemsDisplayTotal: itemsTotal, itemsTotal,
        platformFeeMerchant: 0, platformFeeBuyer: 0, platformFeeTotal: 0,
        commissionPercent: Math.round(COMMISSION_RATE * 100), tariffSplit: false, weeklyCommissionRate: COMMISSION_RATE,
        status: 'pending',
        deliveryAddress: String(dest.address).slice(0, 200), deliveryLat: Number(dest.lat), deliveryLng: Number(dest.lng),
        recipientName: String(recipient?.name || name || 'Cliente WhatsApp').slice(0, 60), recipientPhone: recipient?.phone || phone, notes: String(notes || '').slice(0, 300),
        deliveryVehicle: vehicle === 'auto' ? 'auto' : 'moto',
        paymentMethod: pay?.method === 'saldo' ? 'saldo' : 'efectivo', paymentStatus: pay?.method === 'saldo' ? 'paid' : 'unpaid',
        paidAmount: pay?.method === 'saldo' ? itemsTotal : null, paidAt: pay?.method === 'saldo' ? serverTs : null,
        cityId: store.cityId || null, cityName: store.cityName || null,
        storeAddress: store.address || '', storeLat: store.lat ?? null, storeLng: store.lng ?? null, storePhone: store.phone || '',
        tripId: null, deliveryFee: null,
        createdAt: serverTs, updatedAt: serverTs,
        createdVia: 'whatsapp_customer', waCustomerPhone: phone, guestClient: !pay?.uid, waOrderCreatedAtMs: nowMs,
    };
}

function orderStatusKey(o = {}) {
    const s = o.status;
    if (s === 'accepted') return 'accepted';
    if (s === 'preparing') return 'preparing';
    if (s === 'ready' && !o.tripId) return 'ready';
    if (s === 'ready' && o.tripId) return 'searching';
    if (s === 'out_for_delivery') return 'on_the_way';
    if (s === 'delivered') return 'delivered';
    if (s === 'cancelled') return 'cancelled';
    return null;
}
function orderStatusText(key, o = {}) {
    const st = o.storeName || 'la tienda';
    switch (key) {
        case 'accepted': return `✅ *${st}* aceptó tu pedido.`;
        case 'preparing': return `👨‍🍳 *${st}* está preparando tu pedido.`;
        case 'ready': return `📦 Tu pedido de *${st}* está listo para recoger. Ya buscamos conductor.`;
        case 'searching': return `🔎 Tu pedido de *${st}* está listo; estamos buscando un conductor.`;
        case 'on_the_way': return `🛵 ${o.driverName ? `*${String(o.driverName).split(/\s+/)[0]}*` : 'Un conductor'} va en camino con tu pedido de *${st}*.`;
        case 'delivered': return `🎉 Pedido de *${st}* entregado. ¡Gracias por usar HonduRaite!`;
        case 'cancelled': return o.cancelReason === 'outside_delivery_zones'
            ? `❌ Tu pedido de *${st}* se canceló: la dirección está fuera de las zonas de envío.`
            : `❌ Tu pedido de *${st}* se canceló. Escribe *pedir* para hacer otro.`;
        default: return '';
    }
}

module.exports = function createWaCustomerOrder(deps) {
    const { db, FieldValue, APP_ID, send, geocode, getQuoteFor, vehicleAvailability, normalizePhone,
        lastInboundAtMs, sendTemplate, templateName = () => '', now = () => Date.now(), log = console } = deps;
    const base = `artifacts/${APP_ID}/public/data`;
    const VEH = SD.VEHICLES;

    async function nearbyStores(kind, cat, dest) {
        const noGps = [];
        const snap = await db.collection(`${base}/stores`).where('adultsOnly', '==', false).limit(400).get().catch(() => null);
        return (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }))
            .filter((s) => s.ownerId && approved(s) && !isAdultsOnly(s) && isOpenNow(s, now()))
            .filter((s) => (kind === 'rest' ? isRestaurant(s) : !isRestaurant(s) && (!cat || (s.category || 'otro') === cat)))
            .filter((s) => {
                const ok = Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)) && s.locationApprox !== true;
                if (!ok) noGps.push(s.id);
                return ok;
            })
            .map((s) => ({ ...s, _km: km(dest, { lat: Number(s.lat), lng: Number(s.lng) }) }))
            .filter((s) => s._km <= MAX_STORE_KM)
            .sort((a, b) => a._km - b._km)
            .concat((() => { if (noGps.length) reportNoGps(noGps); return []; })());
    }
    /** Tiendas abiertas sin ubicación GPS real: no se listan; se registra (máx. 1 vez/día por tienda) para avisar al dueño/admin. */
    const noGpsSeen = new Map();
    function reportNoGps(ids) {
        const day = Math.floor(now() / 86400000);
        const fresh = ids.filter((id) => noGpsSeen.get(id) !== day);
        if (!fresh.length) return;
        fresh.forEach((id) => noGpsSeen.set(id, day));
        log.warn?.('[wa-pedido-cliente] tiendas sin GPS ocultas a clientes de WhatsApp:', fresh.join(','));
        fresh.forEach((id) => db.doc(`${base}/stores/${id}`).set({ waHiddenNoGps: true, waHiddenNoGpsAtMs: now() }, { merge: true }).catch(() => {}));
    }
    async function loadStore(id) {
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(id || ''))) return null;
        const d = await db.doc(`${base}/stores/${id}`).get().catch(() => null);
        if (!d?.exists) return null;
        const s = { id: d.id, ...d.data() };
        return s.ownerId && approved(s) && !isAdultsOnly(s) && s.adultsOnly !== true ? s : null;
    }
    async function loadProducts(store) {
        const snap = await db.collection(`${base}/store_products`).where('storeId', '==', store.id).limit(500).get().catch(() => null);
        return (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }))
            .filter((p) => p.available !== false && Number(p.price ?? p.basePrice) > 0)
            .filter((p) => { const l = stockLeft(p, store); return l == null || l > 0; })
            .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.name).localeCompare(String(b.name)));
    }
    async function quote(store, sess, vehicle) {
        const q = await getQuoteFor()(APP_ID, { storeId: store.id, lat: sess.coDest.lat, lng: sess.coDest.lng, cityId: store.cityId || null, vehicle });
        const settings = await db.doc(`${base}/appSettings/main`).get().catch(() => null);
        const rate = DZ.deliveryRateFrom(settings && settings.exists ? settings.get('fixedFares') : null);
        const draft = { merchantId: store.ownerId, destinationLat: sess.coDest.lat, destinationLng: sess.coDest.lng, deliveryVehicle: vehicle, deliveryDetails: {} };
        return DZ.verifyMerchantDirectDelivery({ trip: draft, store, quote: q, rate, nowMs: now() });
    }

    // ── pantallas ──
    const askType = (from) => send.buttons(from, '🛒 *Pedir a tienda o restaurante*\n¿Qué quieres pedir?', [
        { id: 'co_type_rest', title: '🍔 Restaurantes' }, { id: 'co_type_shop', title: '🛍️ Tiendas' }, { id: 'co_abort', title: 'Cancelar' }]);
    const askCat = (from) => send.list(from, '¿Qué tipo de tienda?', 'Ver categorías',
        [{ id: 'co_cat:all', title: 'Todas las tiendas' }].concat(SHOP_CATS.map((c) => ({ id: `co_cat:${c.id}`, title: c.label }))), 'Categorías');
    const askDest = (from) => send.locationRequest(from, '📍 *¿A dónde te lo llevamos?*\nComparte tu *ubicación* (📎 → Ubicación) o escribe la dirección (barrio, colonia, referencia). Así te muestro lo que está abierto cerca.', 'Enviar mi ubicación');

    async function showStores(from, sess, save) {
        const list = await nearbyStores(sess.coKind, sess.coCat, sess.coDest);
        if (!list.length) {
            await save({ ...sess, step: 'co_type' });
            await send.text(from, `Ahora no hay ${sess.coKind === 'rest' ? 'restaurantes' : 'tiendas'} abiertos cerca de esa dirección 😕`);
            return askType(from);
        }
        const page = Math.max(0, Number(sess.coStorePage) || 0);
        const slice = list.slice(page * 9, page * 9 + 9);
        const rows = slice.map((s) => { const nm = s.branchName ? `${s.name || 'Tienda'} (${s.branchName})` : (s.name || 'Tienda'); return { id: `co_st:${s.id}`, title: cut(nm, 24), description: cut(`${nm.length > 24 ? `${nm} · ` : ''}${s.branchName ? `${s.branchName} · ` : ''}${s._km.toFixed(1)} km${s.address ? ` · ${s.address}` : ''}`, 72) }; });
        if (list.length > (page + 1) * 9) rows.push({ id: 'co_st_more', title: 'Ver más ▶', description: `${list.length - (page + 1) * 9} más` });
        await save({ ...sess, step: 'co_store', coStoreIds: slice.map((s) => s.id) });
        return send.list(from, `${sess.coKind === 'rest' ? '🍔 Restaurantes' : '🛍️ Tiendas'} abiertos cerca (${list.length}):`, 'Ver lista', rows, sess.coKind === 'rest' ? 'Restaurantes' : 'Tiendas');
    }
    async function showProducts(from, sess, save, store) {
        const prods = await loadProducts(store);
        if (!prods.length) { await send.text(from, `*${store.name}* aún no tiene productos disponibles.`); return showStores(from, { ...sess, coStoreId: null }, save); }
        const pages = Math.ceil(prods.length / PAGE);
        const page = Math.min(Math.max(0, Number(sess.coPage) || 0), pages - 1);
        const slice = prods.slice(page * PAGE, page * PAGE + PAGE);
        const rows = slice.map((p) => ({ id: `co_p:${p.id}`, title: cut(p.name, 24), description: cut(String(p.name || '').length > 24 ? `${p.name} · ${lmoney(p.price ?? p.basePrice)}` : `${lmoney(p.price ?? p.basePrice)}${p.description ? ` · ${p.description}` : ''}`, 72) }));
        if (page < pages - 1) rows.push({ id: 'co_more', title: 'Más productos ▶', description: `Página ${page + 2} de ${pages}` });
        else if (page > 0) rows.push({ id: 'co_first', title: '◀ Volver al inicio', description: 'Página 1' });
        const n = (sess.coCart || []).reduce((s, i) => s + i.qty, 0);
        if (n) rows.push({ id: 'co_cart', title: `🛒 Ver carrito (${n})`, description: `Productos ${lmoney(cartTotal(sess.coCart))}` });
        await save({ ...sess, step: 'co_products', coPage: page, coStoreId: store.id, coStoreName: store.name });
        return send.list(from, `*${store.name}*${pages > 1 ? ` · página ${page + 1}/${pages}` : ''}\nElige un producto 👇`, store.category === 'comida' ? 'Ver menú' : 'Ver productos', rows.slice(0, 10), cut(isRestaurant(store) ? 'Menú' : 'Productos', 24));
    }
    async function showCart(from, sess, save) {
        const cart = sess.coCart || [];
        if (!cart.length) { await send.text(from, 'Tu carrito está vacío.'); const st = await loadStore(sess.coStoreId); return st ? showProducts(from, sess, save, st) : askType(from); }
        await save({ ...sess, step: 'co_cart' });
        const rows = [{ id: 'co_checkout', title: '✅ Continuar', description: 'Elegir moto o carro y ver el total' }, { id: 'co_keep', title: '➕ Agregar más' }]
            .concat(cart.slice(0, 8).map((i) => ({ id: `co_rm:${i.productId}`, title: cut(`➖ Quitar 1 ${i.name}`, 24), description: `Tienes ${i.qty} · ${lmoney(i.price * i.qty)}` })));
        return send.list(from, `🛒 *Tu carrito · ${sess.coStoreName}*\n${cartLines(cart)}\n\nProductos: *${lmoney(cartTotal(cart))}*`, 'Opciones', rows.slice(0, 10), 'Carrito');
    }
    async function askVehicle(from, sess, save, store) {
        const a = await vehicleAvailability(store);
        const ok = Object.keys(VEH).filter((v) => a[v].available);
        const lines = Object.keys(VEH).map((v) => `${VEH[v].emoji} ${VEH[v].label}${a[v].available ? '' : ` — No disponible${a[v].message && a[v].message !== 'No disponible' ? ` (${a[v].message})` : ''}`}`);
        if (!ok.length) { await send.text(from, `Ahora no hay envíos disponibles desde *${store.name}*:\n${lines.join('\n')}\nIntenta más tarde 🙏`); return showCart(from, sess, save); }
        await save({ ...sess, step: 'co_vehicle' });
        return send.buttons(from, `¿En qué te lo llevamos?\n${lines.join('\n')}`, ok.map((v) => ({ id: `co_veh_${v}`, title: VEH[v].label })).concat([{ id: 'co_cart', title: 'Ver carrito' }]));
    }
    function summary(sess, fee) {
        const p = cartTotal(sess.coCart); const v = VEH[sess.coVehicle];
        return [`🧾 *Tu pedido · ${sess.coStoreName}*`, cartLines(sess.coCart), '', `Entrega: ${sess.coDest.address}`,
            ...(sess.coRecipient ? [`Recibe: ${sess.coRecipient.name} · ${sess.coRecipient.phone}`] : []), ...(sess.coNotes ? [`Notas: ${sess.coNotes}`] : []),
            `Envío: ${v.emoji} ${v.label}`, sess.coPay === 'saldo' ? `Pago: productos con *saldo/puntos* (${lmoney(p)}); envío en efectivo al conductor` : 'Pago: efectivo al recibir', '',
            `Productos ${lmoney(p)} + Envío ${lmoney(fee)} = *${lmoney(p + fee)}*`].join('\n');
    }

    /** Cuenta HonduRaite con ese teléfono (exactamente una) → saldo/puntos como en el carrito de la app. */
    async function findAccount(phone) {
        const vars = SD.phoneVariants(phone);
        if (!vars.length) return null;
        const snap = await db.collection(`${base}/users`).where('phone', 'in', vars).limit(2).get().catch(() => null);
        if (!snap || snap.docs.length !== 1) return null;
        const d = snap.docs[0];
        if (d.get('blocked') === true || d.get('suspended') === true || d.get('deleted') === true) return null;
        return { uid: d.id, balance: money(parseFloat(d.get('balance')) || 0) };
    }
    const confirmButtons = [{ id: 'co_confirm', title: 'Confirmar pedido' }, { id: 'co_cart', title: 'Editar carrito' }, { id: 'co_abort', title: 'Cancelar' }];
    async function showExtras(from, sess, save) {
        await save({ ...sess, step: 'co_extras' });
        const cur = [sess.coNotes ? `📝 Notas: ${sess.coNotes}` : '', sess.coRecipient ? `👤 Recibe: ${sess.coRecipient.name} · ${sess.coRecipient.phone}` : ''].filter(Boolean).join('\n');
        return send.buttons(from, `¿Algo más? (opcional)\n${cur || 'Puedes dejar una nota para la tienda o el conductor, o decir que recibe otra persona.'}`,
            [{ id: 'co_note', title: sess.coNotes ? 'Cambiar nota' : 'Agregar nota' }, { id: 'co_recv', title: 'Recibe otra persona' }, { id: 'co_extras_ok', title: 'Continuar' }]);
    }
    async function askPayOrConfirm(from, sess, save) {
        const acct = await findAccount(from);
        const p = cartTotal(sess.coCart);
        if (acct && acct.balance >= p) {
            await save({ ...sess, step: 'co_pay', coPay: null });
            return send.buttons(from, `¿Cómo pagas los productos (${lmoney(p)})?\nTu saldo HonduRaite: *${lmoney(acct.balance)}*. El envío siempre se paga en efectivo al conductor.`,
                [{ id: 'co_pay_cash', title: 'Efectivo' }, { id: 'co_pay_saldo', title: 'Saldo / puntos' }]);
        }
        const next = { ...sess, step: 'co_confirm', coPay: 'efectivo' };
        await save(next);
        return send.buttons(from, summary(next, sess.coFee), confirmButtons);
    }

    async function cancelActiveOrder(from) {
        const snap = await db.collection(`${base}/store_orders`).where('waCustomerPhone', '==', from).limit(30).get().catch(() => null);
        const docs = (snap?.docs || []).filter((d) => ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'].includes(d.get('status')));
        if (!docs.length) return null;
        docs.sort((a, b) => (Number(b.get('waOrderCreatedAtMs')) || 0) - (Number(a.get('waOrderCreatedAtMs')) || 0));
        const ref = docs[0].ref;
        return db.runTransaction(async (tx) => {
            const cur = await tx.get(ref); const o = cur.data() || {};
            if (o.status !== 'pending') return { ok: false, order: o };
            tx.update(ref, { status: 'cancelled', cancelledBy: 'client', cancelReason: 'client_cancel_whatsapp', cancelledAtMs: now(), updatedAt: FieldValue.serverTimestamp() });
            return { ok: true, order: o };
        });
    }

    async function setDest(from, sess, save, dest) {
        if (!dest || !SD.isInHondurasPublic(dest.lat, dest.lng)) { await send.text(from, '❌ No encontré esa dirección en Honduras. Comparte tu ubicación (📎 → Ubicación) o escríbela con barrio/colonia y ciudad.'); return true; }
        const next = { ...sess, coDest: dest, coStorePage: 0 };
        if (sess.coStoreId && (sess.coCart || []).length) return askVehicle(from, next, save, await loadStore(sess.coStoreId));
        return showStores(from, next, save);
    }

    async function handle({ from, text, buttonId, location, contactName, session, saveSession, clearSession }) {
        const id = String(buttonId || '').trim();
        const t = fold(text);
        const sess = session || { step: 'idle' };
        const inFlow = STEPS.includes(sess.step);
        const save = (data) => saveSession(from, data);

        if (!inFlow && !isEntry(id, t)) {
            if (/^cancelar( pedido)?$/.test(t) && (sess.step === 'idle' || !sess.step)) {
                const r = await cancelActiveOrder(from);
                if (!r) return false;
                await send.text(from, r.ok ? 'Listo, cancelé tu pedido ✅. Escribe *pedir* para hacer otro.' : 'La tienda ya aceptó tu pedido, ya no se puede cancelar por aquí. Escribe *soporte* si necesitas ayuda.');
                return true;
            }
            return false;
        }
        if (id === 'co_abort' || (inFlow && /^(cancelar|salir)$/.test(t))) { await clearSession(from); await send.text(from, 'Listo, no hice ningún pedido. Escribe *pedir* cuando quieras.'); return true; }
        if (id === 'menu' || (inFlow && /^(menu|inicio)$/.test(t))) return false;

        if (!inFlow || (sess.step === 'co_type' && !/^co_type_/.test(id) && !/restaurante|comida|tienda/.test(t))) {
            await save({ step: 'co_type', coCart: [], coName: contactName || '' });
            await askType(from); return true;
        }
        if (sess.step === 'co_type') {
            const kind = id === 'co_type_rest' || /restaurante|comida/.test(t) ? 'rest' : 'shop';
            if (kind === 'shop') { await save({ ...sess, step: 'co_cat', coKind: 'shop' }); await askCat(from); return true; }
            await save({ ...sess, step: 'co_dest', coKind: 'rest', coCat: null }); await askDest(from); return true;
        }
        if (sess.step === 'co_cat') {
            const c = id.startsWith('co_cat:') ? id.slice(7) : 'all';
            await save({ ...sess, step: 'co_dest', coCat: SHOP_CATS.some((x) => x.id === c) ? c : null });
            if (sess.coDest) { await showStores(from, { ...sess, coCat: SHOP_CATS.some((x) => x.id === c) ? c : null }, save); return true; }
            await askDest(from); return true;
        }
        if (sess.step === 'co_dest') {
            if (location && Number.isFinite(Number(location.lat))) {
                const addr = location.address || location.name || `Ubicación compartida (${Number(location.lat).toFixed(5)}, ${Number(location.lng).toFixed(5)})`;
                await setDest(from, sess, save, { lat: Number(location.lat), lng: Number(location.lng), address: String(addr).slice(0, 200) }); return true;
            }
            if (t.length < 4) { await askDest(from); return true; }
            const g = await geocode(text).catch(() => null);
            if (!g || !SD.isInHondurasPublic(g.lat, g.lng)) { await send.text(from, '❌ No encontré esa dirección en Honduras. Comparte tu ubicación (📎 → Ubicación) o escríbela con barrio/colonia y ciudad.'); return true; }
            await save({ ...sess, step: 'co_dest_confirm', coDestDraft: { lat: g.lat, lng: g.lng, address: g.address || text, notes: String(text).slice(0, 200) } });
            await send.buttons(from, `📍 ¿Es aquí?\n*${g.address || text}*`, [{ id: 'co_dest_ok', title: 'Sí, ahí' }, { id: 'co_dest_no', title: 'No, otra' }]);
            return true;
        }
        if (sess.step === 'co_dest_confirm') {
            if (id === 'co_dest_ok' || /^(si|sí|ok|correcto)$/.test(t)) { await setDest(from, sess, save, sess.coDestDraft); return true; }
            await save({ ...sess, step: 'co_dest' }); await askDest(from); return true;
        }
        if (sess.step === 'co_store') {
            if (id === 'co_st_more') { await showStores(from, { ...sess, coStorePage: (Number(sess.coStorePage) || 0) + 1 }, save); return true; }
            const sid = id.startsWith('co_st:') ? id.slice(6) : '';
            const store = (sess.coStoreIds || []).includes(sid) ? await loadStore(sid) : null;
            if (!store || !isOpenNow(store, now())) { await send.text(from, 'Esa tienda no está disponible ahora. Elige otra de la lista 👇'); await showStores(from, sess, save); return true; }
            const sameStore = sess.coStoreId === store.id;
            await showProducts(from, { ...sess, coPage: 0, coCart: sameStore ? sess.coCart || [] : [] }, save, store); return true;
        }
        const store = await loadStore(sess.coStoreId);
        if (!store) { await clearSession(from); await send.text(from, 'Esa tienda ya no está disponible. Escribe *pedir* para elegir otra.'); return true; }

        if (sess.step === 'co_note_text') {
            const n = /^(sin nota|ninguna|no)$/.test(t) ? '' : String(text || '').trim().slice(0, 300);
            await showExtras(from, { ...sess, coNotes: n }, save); return true;
        }
        if (sess.step === 'co_recv_name') {
            const n = String(text || '').trim();
            if (/^(yo|soy yo)$/.test(t)) { await showExtras(from, { ...sess, coRecipient: null }, save); return true; }
            if (n.length < 2 || n.length > 60) { await send.text(from, 'Escribe el nombre de quien recibe (o *yo*).'); return true; }
            await save({ ...sess, step: 'co_recv_phone', coRecvName: n });
            await send.text(from, `Teléfono de *${n}* (8 dígitos):`); return true;
        }
        if (sess.step === 'co_recv_phone') {
            let d = String(text || '').replace(/\D/g, ''); if (d.length === 8) d = `504${d}`;
            if (!/^504[2-9]\d{7}$/.test(d)) { await send.text(from, 'Ese número no parece de Honduras. Escribe 8 dígitos, por ejemplo 9999-0000.'); return true; }
            await showExtras(from, { ...sess, coRecipient: { name: sess.coRecvName, phone: d }, coRecvName: null }, save); return true;
        }
        if (sess.step === 'co_extras' && !['co_cart', 'co_abort'].includes(id)) {
            if (id === 'co_note' || /^nota/.test(t)) { await save({ ...sess, step: 'co_note_text' }); await send.text(from, '📝 Escribe tu nota (ej.: sin cebolla, casa portón negro). Escribe *sin nota* para quitarla.'); return true; }
            if (id === 'co_recv' || /otra persona/.test(t)) { await save({ ...sess, step: 'co_recv_name' }); await send.text(from, '👤 ¿Cómo se llama quien recibe? (escribe *yo* si eres tú)'); return true; }
            if (id === 'co_extras_ok' || /^(continuar|listo|no|seguir)$/.test(t)) { await askPayOrConfirm(from, sess, save); return true; }
            await showExtras(from, sess, save); return true;
        }
        if (sess.step === 'co_pay' && id !== 'co_abort') {
            const m = id === 'co_pay_saldo' || /saldo|puntos/.test(t) ? 'saldo' : (id === 'co_pay_cash' || /efectivo/.test(t) ? 'efectivo' : '');
            if (!m) { await askPayOrConfirm(from, sess, save); return true; }
            const next = { ...sess, step: 'co_confirm', coPay: m };
            await save(next); await send.buttons(from, summary(next, sess.coFee), confirmButtons); return true;
        }

        if (id === 'co_cart' || /^(carrito|ver carrito)$/.test(t)) { await showCart(from, sess, save); return true; }
        if (id === 'co_keep' || /^(agregar mas|seguir)$/.test(t)) { await showProducts(from, sess, save, store); return true; }
        if (id === 'co_checkout' || (sess.step !== 'co_confirm' && /^(pedir|pagar|continuar|listo)$/.test(t))) {
            if (!(sess.coCart || []).length) { await showCart(from, sess, save); return true; }
            await askVehicle(from, sess, save, store); return true;
        }
        if (sess.step === 'co_products') {
            if (id === 'co_more') { await showProducts(from, { ...sess, coPage: (Number(sess.coPage) || 0) + 1 }, save, store); return true; }
            if (id === 'co_first') { await showProducts(from, { ...sess, coPage: 0 }, save, store); return true; }
            const pid = id.startsWith('co_p:') ? id.slice(5) : '';
            const p = (await loadProducts(store)).find((x) => x.id === pid);
            if (!p) { await send.text(from, 'Ese producto ya no está disponible.'); await showProducts(from, sess, save, store); return true; }
            await save({ ...sess, step: 'co_qty', coPending: { productId: p.id, name: p.name, price: money(p.price ?? p.basePrice), photoUrl: p.photoUrl || null, left: stockLeft(p, store) } });
            await send.buttons(from, `*${p.name}* · ${lmoney(p.price ?? p.basePrice)}\n¿Cuántos? (o escribe el número)`, [{ id: 'co_q:1', title: '1' }, { id: 'co_q:2', title: '2' }, { id: 'co_q:3', title: '3' }]);
            return true;
        }
        if (sess.step === 'co_qty') {
            const q = Math.floor(Number(id.startsWith('co_q:') ? id.slice(5) : t));
            if (!(q >= 1 && q <= 50)) { await send.text(from, 'Escribe una cantidad entre 1 y 50.'); return true; }
            const pend = sess.coPending; const cart = (sess.coCart || []).map((x) => ({ ...x }));
            const line = cart.find((x) => x.productId === pend.productId);
            const want = (line?.qty || 0) + q;
            if (pend.left != null && want > pend.left) { await send.text(from, `«${pend.name}» solo tiene ${pend.left} disponibles.`); return true; }
            if (line) line.qty = want; else cart.push({ productId: pend.productId, name: pend.name, price: pend.price, qty: q, photoUrl: pend.photoUrl });
            await save({ ...sess, step: 'co_after_add', coCart: cart, coPending: null });
            await send.buttons(from, `✅ Agregué ${q}× ${pend.name}.\n🛒 Productos: *${lmoney(cartTotal(cart))}*`, [{ id: 'co_keep', title: 'Agregar más' }, { id: 'co_cart', title: 'Ver carrito' }, { id: 'co_checkout', title: 'Hacer pedido' }]);
            return true;
        }
        if (sess.step === 'co_cart' && id.startsWith('co_rm:')) {
            const pid = id.slice(6);
            const cart = (sess.coCart || []).map((x) => ({ ...x })).map((x) => (x.productId === pid ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0);
            await showCart(from, { ...sess, coCart: cart }, save); return true;
        }
        if (sess.step === 'co_vehicle') {
            const v = id === 'co_veh_auto' || /^carro$/.test(t) ? 'auto' : (id === 'co_veh_moto' || /^moto$/.test(t) ? 'moto' : '');
            if (!v) { await askVehicle(from, sess, save, store); return true; }
            const a = await vehicleAvailability(store);
            if (!a[v].available) { await send.text(from, `${VEH[v].label}: ${a[v].message || 'No disponible'} 🙏`); await askVehicle(from, sess, save, store); return true; }
            const r = await quote(store, sess, v);
            if (!r.ok) { await save({ ...sess, step: 'co_dest' }); await send.text(from, r.reason === 'outside_delivery_zones' ? '😕 Por ahora no llegamos a esa dirección desde esta tienda. Prueba otra ubicación.' : '😕 No pude calcular el envío. Prueba otra ubicación.'); await askDest(from); return true; }
            await showExtras(from, { ...sess, coVehicle: v, coFee: r.fee }, save);
            return true;
        }
        if (sess.step === 'co_confirm' && (id === 'co_confirm' || /^(confirmar|si|sí)$/.test(t))) {
            if (!isOpenNow(store, now())) { await clearSession(from); await send.text(from, `*${store.name}* acaba de cerrar 😕. Escribe *pedir* para elegir otra.`); return true; }
            const prods = await loadProducts(store); const cart = [];
            for (const l of sess.coCart || []) {
                const p = prods.find((x) => x.id === l.productId); const left = p ? stockLeft(p, store) : 0;
                if (!p || (left != null && left < l.qty)) { await save({ ...sess, step: 'co_cart' }); await send.text(from, p ? `«${p.name}» solo tiene ${left} disponibles. Ajusta tu carrito.` : `«${l.name}» ya no está disponible.`); await showCart(from, { ...sess, coCart: (sess.coCart || []).filter((x) => x.productId !== l.productId || p) }, save); return true; }
                cart.push({ ...l, name: p.name, price: money(p.price ?? p.basePrice) }); // precio del servidor, nunca el de la sesión
            }
            const a = await vehicleAvailability(store);
            if (!a[sess.coVehicle]?.available) { await send.text(from, `${VEH[sess.coVehicle].label}: ${a[sess.coVehicle]?.message || 'No disponible'} 🙏`); await askVehicle(from, sess, save, store); return true; }
            const r = await quote(store, sess, sess.coVehicle);
            if (!r.ok) { await clearSession(from); await send.text(from, '❌ Ya no llegamos a esa dirección. Escribe *pedir* para probar otra.'); return true; }
            let pay = null;
            if (sess.coPay === 'saldo') {
                const acct = await findAccount(from);
                if (!acct) { await askPayOrConfirm(from, { ...sess, coCart: cart }, save); return true; }
                pay = { method: 'saldo', uid: acct.uid };
            }
            const order = buildWaCustomerOrder({ store, cart, dest: sess.coDest, vehicle: sess.coVehicle, phone: from, name: sess.coName || contactName, nowMs: now(), serverTs: FieldValue.serverTimestamp(), notes: sess.coNotes, recipient: sess.coRecipient, pay });
            const ref = db.collection(`${base}/store_orders`).doc();
            if (pay) {
                // Mismo cobro que el carrito de la app, pero en el servidor y atómico con el pedido.
                const userRef = db.doc(`${base}/users/${pay.uid}`);
                const res = await db.runTransaction(async (tx) => {
                    const u = await tx.get(userRef);
                    const bal = money(parseFloat(u.exists ? u.get('balance') : 0) || 0);
                    if (bal < order.itemsTotal) return { ok: false, bal };
                    const nb = money(bal - order.itemsTotal);
                    tx.update(userRef, { balance: nb });
                    tx.set(ref, order);
                    return { ok: true, nb };
                });
                if (!res.ok) { await askPayOrConfirm(from, { ...sess, coCart: cart }, save); await send.text(from, `Tu saldo (${lmoney(res.bal)}) ya no alcanza para ${lmoney(order.itemsTotal)}. Elige efectivo.`); return true; }
                await db.doc(`artifacts/${APP_ID}/users/${pay.uid}/profile/data`).set({ balance: res.nb }, { merge: true }).catch(() => {});
            } else {
                await ref.set(order);
            }
            await clearSession(from);
            const changed = Math.abs(r.fee - (Number(sess.coFee) || 0)) >= 0.01 || Math.abs(cartTotal(cart) - cartTotal(sess.coCart)) >= 0.01;
            await send.text(from, `✅ ¡Pedido enviado a *${store.name}*!${changed ? `\nTotal actualizado: Productos ${lmoney(cartTotal(cart))} + Envío ${lmoney(r.fee)} = *${lmoney(cartTotal(cart) + r.fee)}*` : ''}\n${pay ? `Se descontaron ${lmoney(order.itemsTotal)} de tu saldo; el envío lo pagas en efectivo al conductor.` : 'Pagas en efectivo al recibir.'} Te aviso aquí cuando la tienda lo acepte.\nEscribe *cancelar* para anularlo antes de que lo acepten.`);
            return { handled: true, orderId: ref.id };
        }
        // Cualquier otra cosa dentro del flujo: repetir la pantalla actual.
        if (sess.step === 'co_confirm') { await send.buttons(from, summary(sess, sess.coFee), confirmButtons); return true; }
        if (sess.step === 'co_cart') { await showCart(from, sess, save); return true; }
        await showProducts(from, sess, save, store); return true;
    }

    /** onDocumentUpdated(store_orders): avisos al cliente de WhatsApp, una vez por estado. */
    async function onOrderStatusChange(before, after, orderId, ref) {
        if (!after || after.createdVia !== 'whatsapp_customer' || !after.waCustomerPhone) return { skipped: 'not_wa_customer' };
        const k0 = orderStatusKey(before || {}); const k1 = orderStatusKey(after);
        if (!k1 || k0 === k1) return { skipped: 'same' };
        if (k1 === 'cancelled' && after.cancelReason === 'client_cancel_whatsapp') return { skipped: 'own_cancel' };
        if ((after.waCustomerStatusSent || {})[k1]) return { skipped: 'already' };
        const body = orderStatusText(k1, after);
        const phone = normalizePhone(after.waCustomerPhone);
        const last = await lastInboundAtMs(phone);
        let res;
        if (last && now() - last < WINDOW_MS) res = { ...(await send.textLogged(phone, body, { purpose: `customer_order_${k1}` })), via: 'text' };
        else if (templateName()) res = { ...(await sendTemplate(phone, templateName(), [String(after.storeName || 'la tienda').slice(0, 60), body.replace(/[*\n]/g, ' ').slice(0, 300)])), via: 'template' };
        else { res = { ok: false, skipped: true, reason: 'outside_24h_no_template', via: 'none' }; log.warn?.('[wa-pedido-cliente] fuera de 24h sin plantilla', orderId, k1); }
        if (res.ok && ref) await ref.update({ [`waCustomerStatusSent.${k1}`]: true }).catch(() => {});
        return res;
    }

    return { handle, onOrderStatusChange, nearbyStores, loadProducts };
};
Object.assign(module.exports, { isEntry, isRestaurant, isOpenNow, approved, isAdultsOnly, tracksStock, buildWaCustomerOrder, orderStatusKey, orderStatusText, cartTotal, STEPS });
