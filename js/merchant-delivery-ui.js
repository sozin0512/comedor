/**
 * Pestaña «Pedir envío» del panel de la tienda (merchant-stores.js).
 * Todo lo de Firebase/Maps llega por ctx → se prueba en Chrome headless con stubs
 * (scripts/test-pedir-envio-tienda.mjs).
 */
import {
    MERCHANT_DELIVERY_VEHICLES, haversineKm, estimateMerchantDelivery, validateMerchantDeliveryForm,
    buildMerchantDeliveryTrip, merchantDeliveryStatus, merchantVehicleAvailability, merchantCancelPatch,
} from './merchant-delivery-request.js?v=2026.10.20.2';

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const money = (n) => `L. ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = { amber: '#b45309', violet: '#6d28d9', blue: '#1d4ed8', green: '#047857', gray: '#6b7280' };

export const MERCHANT_DELIVERY_CSS = `
.md-wrap{display:flex;flex-direction:column;gap:10px;font-size:14px}
.md-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:12px}
.md-card h3{margin:0 0 8px;font-size:15px;font-weight:800}
.md-veh{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.md-veh button{border:2px solid #e5e7eb;border-radius:14px;padding:10px;background:#f9fafb;font-weight:800;display:flex;flex-direction:column;align-items:center;gap:4px}
.md-veh button.on{border-color:#7c3aed;background:#f5f3ff;color:#5b21b6}
.md-veh button[disabled]{opacity:.5}
.md-veh small{font-weight:600;font-size:11px;color:#b91c1c}
.md-f{display:flex;flex-direction:column;gap:3px;margin-top:8px;position:relative}
.md-f label{font-size:12px;font-weight:700;color:#374151}
.md-f input,.md-f textarea{font-family:inherit;border:1px solid #d1d5db;border-radius:10px;padding:9px;font-size:14px;width:100%;box-sizing:border-box}
.md-err{color:#b91c1c;font-size:11px;font-weight:700}
.md-sug{position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #d1d5db;border-radius:10px;z-index:5;box-shadow:0 6px 20px rgba(0,0,0,.12)}
.md-sug button{display:block;width:100%;text-align:left;padding:9px;border:0;background:none;font-size:13px;border-bottom:1px solid #f3f4f6}
.md-est{display:flex;justify-content:space-between;align-items:center;background:#f5f3ff;border-radius:12px;padding:10px;margin-top:10px}
.md-est b{font-size:18px;color:#5b21b6}
.md-go{width:100%;margin-top:10px;border:0;border-radius:14px;padding:13px;background:#7c3aed;color:#fff;font-weight:900;font-size:15px}
.md-go[disabled]{background:#c4b5fd}
.md-req{display:flex;justify-content:space-between;gap:8px;padding:9px 0;border-top:1px solid #f3f4f6}
.md-req:first-of-type{border-top:0}
.md-pill{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:#f3f4f6}
.md-cancel{border:1px solid #fecaca;color:#b91c1c;background:#fff;border-radius:10px;padding:5px 9px;font-weight:800;font-size:12px}
`;

export function createMerchantDeliveryTab(ctx) {
    const st = {
        vehicle: null,
        form: {
            pickupAddress: ctx.store?.address || '', pickupLat: ctx.store?.lat, pickupLng: ctx.store?.lng,
            dropoffAddress: '', dropoffLat: null, dropoffLng: null,
            customerName: '', customerPhone: '', notes: '', collectAmount: '',
        },
        errors: {}, suggestions: [], requests: [], commission: null, busy: false, unsub: null, root: null, sugTimer: null,
    };
    const zoneId = ctx.zone?.id || ctx.store?.cityId || null;
    const avail = () => Object.fromEntries(Object.keys(MERCHANT_DELIVERY_VEHICLES).map((v) => [v, merchantVehicleAvailability(v, zoneId, ctx.availability)]));

    function estimate() {
        const f = st.form;
        if (!st.vehicle || f.dropoffLat == null || f.pickupLat == null) return null;
        const km = haversineKm(Number(f.pickupLat), Number(f.pickupLng), Number(f.dropoffLat), Number(f.dropoffLng));
        return estimateMerchantDelivery({ km, vehicle: st.vehicle, fareFn: ctx.fareFn, carFactor: ctx.carFactor, commissionPercent: st.commission });
    }

    function requestsHtml() {
        if (!st.requests.length) return '<p style="color:#6b7280;font-size:13px;margin:0">Todavía no has pedido envíos.</p>';
        return st.requests.map((t) => {
            const s = merchantDeliveryStatus(t);
            const veh = MERCHANT_DELIVERY_VEHICLES[t.deliveryVehicle] || MERCHANT_DELIVERY_VEHICLES.moto;
            const wait = typeof ctx.waitChip === 'function' && s.key === 'searching' ? ctx.waitChip(t) : '';
            return `<div class="md-req" data-md-req="${esc(t.id)}">
                <div style="min-width:0">
                    <div style="font-weight:800;font-size:13px"><i class="fas ${veh.icon}"></i> ${esc(t.destination || 'Entrega')}</div>
                    <div style="font-size:12px;color:#6b7280">${esc(t.price || '')}${t.driverName ? ` · ${esc(t.driverName)}` : ''} ${wait}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                    <span class="md-pill" data-md-status="${s.key}" style="color:${TONE[s.tone]}">${esc(s.label)}</span>
                    ${s.canCancel ? `<button type="button" class="md-cancel" data-md-cancel="${esc(t.id)}">Cancelar</button>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function html() {
        const a = avail(); const f = st.form; const e = st.errors; const est = estimate();
        const vehBtn = (v) => {
            const m = MERCHANT_DELIVERY_VEHICLES[v]; const ok = a[v].available;
            return `<button type="button" data-md-vehicle="${v}" class="${st.vehicle === v ? 'on' : ''}" ${ok ? '' : 'disabled'} title="${esc(a[v].message)}">
                <i class="fas ${m.icon}" style="font-size:20px"></i>${m.label}${ok ? '' : '<small>No disponible</small>'}</button>`;
        };
        const field = (k, label, extra = '', tag = 'input') => `<div class="md-f"><label for="md-${k}">${label}</label>
            ${tag === 'textarea' ? `<textarea id="md-${k}" data-md-field="${k}" rows="2" ${extra}>${esc(f[k])}</textarea>` : `<input id="md-${k}" data-md-field="${k}" value="${esc(f[k])}" ${extra}>`}
            ${k === 'dropoffAddress' && st.suggestions.length ? `<div class="md-sug">${st.suggestions.map((s, i) => `<button type="button" data-md-sug="${i}">${esc(s.description)}</button>`).join('')}</div>` : ''}
            ${e[k === 'dropoffAddress' ? 'dropoff' : k === 'pickupAddress' ? 'pickup' : k] ? `<span class="md-err">${esc(e[k === 'dropoffAddress' ? 'dropoff' : k === 'pickupAddress' ? 'pickup' : k])}</span>` : ''}</div>`;
        return `<div class="md-wrap">
            <div class="md-card"><h3><i class="fas fa-paper-plane"></i> Pedir envío</h3>
                <div class="md-veh">${vehBtn('moto')}${vehBtn('auto')}</div>
                ${e.vehicle ? `<span class="md-err">${esc(e.vehicle)}</span>` : ''}
                ${field('pickupAddress', 'Recoger en (tu tienda)', 'autocomplete="off"')}
                ${field('dropoffAddress', 'Entregar en', 'autocomplete="off" placeholder="Escribe la dirección y elígela de la lista"')}
                ${field('customerName', 'Nombre de quien recibe (opcional)')}
                ${field('customerPhone', 'Teléfono de quien recibe (opcional)', 'inputmode="tel"')}
                ${field('collectAmount', 'Cobrar al entregar, en efectivo (opcional)', 'inputmode="decimal" placeholder="L. 0.00"')}
                ${field('notes', 'Notas para el conductor', 'maxlength="300"', 'textarea')}
                <div class="md-est" data-md-estimate>${est
                    ? `<span>Envío estimado · ${est.km} km${est.commissionPercent != null ? `<br><small style="color:#6b7280">Comisión del servicio: ${est.commissionPercent}%</small>` : ''}</span><b>${money(est.price)}</b>`
                    : '<span style="color:#6b7280">Elige vehículo y dirección para ver el precio</span>'}</div>
                <button type="button" class="md-go" data-md-submit ${st.busy || !st.vehicle ? 'disabled' : ''}>${st.busy ? 'Pidiendo…' : `Pedir ${st.vehicle ? MERCHANT_DELIVERY_VEHICLES[st.vehicle].label.toLowerCase() : 'envío'}`}</button>
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

    async function onInput(ev) {
        const k = ev.target?.dataset?.mdField; if (!k) return;
        st.form[k] = ev.target.value;
        if (k === 'dropoffAddress') {
            st.form.dropoffLat = null; st.form.dropoffLng = null;
            clearTimeout(st.sugTimer);
            const q = ev.target.value.trim();
            st.sugTimer = setTimeout(async () => {
                st.suggestions = q.length >= 3 && ctx.placesFetch ? (await ctx.placesFetch(q).catch(() => [])) : [];
                render();
            }, 250);
        }
    }

    async function onClick(ev) {
        const v = ev.target.closest('[data-md-vehicle]');
        if (v && !v.disabled) { st.vehicle = v.dataset.mdVehicle; delete st.errors.vehicle; return render(); }
        const sg = ev.target.closest('[data-md-sug]');
        if (sg) {
            const s = st.suggestions[Number(sg.dataset.mdSug)]; st.suggestions = [];
            const d = s && ctx.placeDetails ? await ctx.placeDetails(s).catch(() => null) : null;
            if (d) { st.form.dropoffAddress = d.address || s.description; st.form.dropoffLat = d.lat; st.form.dropoffLng = d.lng; delete st.errors.dropoff; }
            return render();
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
        const form = { ...st.form, vehicle: st.vehicle };
        st.errors = validateMerchantDeliveryForm(form);
        const a = st.vehicle ? avail()[st.vehicle] : null;
        if (a && !a.available) st.errors.vehicle = a.message || 'No disponible';
        if (Object.keys(st.errors).length) return render();
        const est = estimate();
        st.busy = true; render();
        try {
            const payload = buildMerchantDeliveryTrip({ store: ctx.store, uid: ctx.uid, form, estimate: est, zone: ctx.zone, serverTs: ctx.serverTs?.() ?? null });
            const id = await ctx.createTrip(payload);
            ctx.toast?.(`Envío pedido · buscando ${MERCHANT_DELIVERY_VEHICLES[st.vehicle].label.toLowerCase()}`, 'success');
            st.form = { ...st.form, dropoffAddress: '', dropoffLat: null, dropoffLng: null, customerName: '', customerPhone: '', notes: '', collectAmount: '' };
            if (!st.unsub) st.requests = [{ id, ...payload }, ...st.requests];
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
            st.unsub = null;
            if (st.root) { st.root.removeEventListener('input', onInput); st.root.removeEventListener('click', onClick); }
            st.root = null;
        },
        _state: st,
    };
}
