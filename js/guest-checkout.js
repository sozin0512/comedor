/**
 * Pedir SIN CUENTA: nombre + WhatsApp (+504). El servidor crea el viaje o pedido (guestCreateRequest)
 * y pone la tarifa. Se recuerda el contacto en este equipo. Al entrar o crear cuenta, los pedidos
 * hechos sin cuenta pasan a la cuenta (guestClaimRequests, con el token guardado aquí).
 */
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';

const K_CONTACT = 'hr_guest_contact_v1';
const K_DEVICE = 'hr_guest_device_v1';
const K_REQS = 'hr_guest_requests_v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const toast = (m, t = 'info') => (window.showToast ? window.showToast(m, t) : alert(m));
const fns = () => window.cloudFunctions;

/** «9911-2233», «+504 9911 2233», «50499112233» → «50499112233» (o null). */
export function normalizeGuestPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('504')) d = d.slice(3);
    return /^[3789]\d{7}$/.test(d) ? `504${d}` : null;
}
export const formatHnPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-8); return d.length === 8 ? `+504 ${d.slice(0, 4)}-${d.slice(4)}` : ''; };
export function getGuestContact() { const c = ls.get(K_CONTACT, null); return c && c.name && normalizeGuestPhone(c.phone) ? c : null; }
export function saveGuestContact(name, phone) { const c = { name: String(name).trim().slice(0, 60), phone: normalizeGuestPhone(phone) }; ls.set(K_CONTACT, c); return c; }
export function guestDeviceId() {
    let id = ls.get(K_DEVICE, '');
    if (!/^[A-Za-z0-9_-]{12,64}$/.test(id)) { id = (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32); ls.set(K_DEVICE, id); }
    return id;
}
export const guestRequests = () => ls.get(K_REQS, []);
function rememberRequest(r) { const list = guestRequests().filter((x) => x.id !== r.id); list.unshift({ ...r, atMs: Date.now() }); ls.set(K_REQS, list.slice(0, 20)); }

function ensureStyles() {
    if (document.getElementById('hr-guest-css')) return;
    const st = document.createElement('style');
    st.id = 'hr-guest-css';
    st.textContent = `
.hrg-back{position:fixed;inset:0;z-index:100050;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center;font-variant-emoji:normal}
.hrg-sheet{width:100%;max-width:440px;background:#fff;border-radius:22px 22px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25);color:#0f172a;font-family:inherit;max-height:92vh;overflow:auto}
.hrg-sheet *{box-sizing:border-box}
.hrg-brand{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.hrg-logo{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#00bce4,#0073cf);color:#fff;font-weight:900;font-size:21px;display:flex;align-items:center;justify-content:center}
.hrg-kick{font-size:10.5px;letter-spacing:.12em;font-weight:800;color:#0073cf}
.hrg-flag{height:4px;border-radius:4px;background:linear-gradient(90deg,#0073cf 0 33%,#fff 33% 66%,#0073cf 66%);border:1px solid #e2e8f0;margin:2px 0 12px}
.hrg-h{font-size:19px;font-weight:800;margin:0 0 4px}
.hrg-sub{font-size:13px;color:#475569;margin:0 0 14px;line-height:1.4}
.hrg-l{display:block;font-size:12.5px;font-weight:700;color:#334155;margin:10px 0 5px}
.hrg-in{width:100%;border:1.5px solid #cbd5e1;border-radius:13px;padding:13px 14px;font-size:16px;background:#f8fafc;color:#0f172a;outline:none}
.hrg-in:focus{border-color:#0073cf;background:#fff}
.hrg-ph{display:flex;align-items:stretch;gap:8px}.hrg-ph span{display:flex;align-items:center;padding:0 12px;border-radius:13px;background:#e0f2fe;color:#0369a1;font-weight:800;font-size:15px}
.hrg-err{color:#b91c1c;font-size:12.5px;min-height:16px;margin-top:6px}
.hrg-note{font-size:12px;color:#64748b;margin:8px 0 0;line-height:1.4}
.hrg-btn{width:100%;border:0;border-radius:14px;padding:14px;font-size:16px;font-weight:800;background:linear-gradient(135deg,#0073cf,#1d4ed8);color:#fff;margin-top:12px;cursor:pointer}
.hrg-btn[disabled]{opacity:.6}
.hrg-alt{width:100%;border:1.5px solid #cbd5e1;border-radius:14px;padding:12px;font-size:14.5px;font-weight:700;background:#fff;color:#1e3a8a;margin-top:10px;cursor:pointer}
.hrg-x{float:right;border:0;background:#f1f5f9;border-radius:10px;width:34px;height:34px;font-size:18px;color:#334155;cursor:pointer}
.hrg-card{border:1px solid #e2e8f0;border-radius:14px;padding:12px;margin-top:10px;background:#f8fafc;font-size:14px}
.hrg-st{display:inline-block;padding:4px 10px;border-radius:999px;font-weight:800;font-size:12.5px;background:#e0f2fe;color:#0369a1}
.hrg-slogan{text-align:center;font-size:10.5px;letter-spacing:.14em;font-weight:800;color:#94a3b8;margin-top:12px}`;
    document.head.appendChild(st);
}
function sheet(html) {
    ensureStyles();
    const back = document.createElement('div');
    back.className = 'hrg-back';
    back.innerHTML = `<div class="hrg-sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-hrg-close]')) close(); });
    return { el: back, close };
}
const brand = (kick) => `<button class="hrg-x" data-hrg-close aria-label="Cerrar">×</button><div class="hrg-brand"><div class="hrg-logo">H</div><div><div class="hrg-kick">${esc(kick)}</div><div style="font-weight:800">HonduRaite</div></div></div><div class="hrg-flag"></div>`;

/**
 * Formulario «Continuar sin cuenta». onSubmit({name, phone}) puede ser async; si lanza, se muestra el error.
 * onAccount: abrir el login/registro normal.
 */
export function openGuestForm({ title = 'Pide sin crear cuenta', sub = '', cta = 'Continuar sin cuenta', onSubmit, onAccount } = {}) {
    const saved = getGuestContact();
    const s = sheet(`${brand('PEDIR SIN CUENTA')}
      <h3 class="hrg-h">${esc(title)}</h3>
      <p class="hrg-sub">${esc(sub || 'Solo tu nombre y tu WhatsApp. El conductor o la tienda te escribe por ahí.')}</p>
      <label class="hrg-l" for="hrg-name">Nombre</label>
      <input id="hrg-name" class="hrg-in" autocomplete="name" maxlength="60" placeholder="Ej. María López" value="${esc(saved?.name || '')}">
      <label class="hrg-l" for="hrg-phone">WhatsApp</label>
      <div class="hrg-ph"><span>+504</span><input id="hrg-phone" class="hrg-in" inputmode="tel" autocomplete="tel-national" maxlength="14" placeholder="9911-2233" value="${esc(saved ? formatHnPhone(saved.phone).replace('+504 ', '') : '')}"></div>
      <div class="hrg-err" id="hrg-err"></div>
      <button class="hrg-btn" id="hrg-go">${esc(cta)}</button>
      ${onAccount ? '<button class="hrg-alt" id="hrg-acct">Entrar o crear cuenta</button>' : ''}
      <p class="hrg-note">Pagas en efectivo. Guardamos tu nombre y número en este teléfono para la próxima vez. Puedes crear tu cuenta después y tus pedidos pasan a ella.</p>
      <div class="hrg-slogan">VIAJA SEGURO, LLEGA LEJOS</div>`);
    const $ = (id) => s.el.querySelector(id);
    $('#hrg-acct')?.addEventListener('click', () => { s.close(); onAccount?.(); });
    $('#hrg-go').addEventListener('click', async () => {
        const name = $('#hrg-name').value.trim();
        const phone = normalizeGuestPhone($('#hrg-phone').value);
        const err = $('#hrg-err');
        if (name.length < 2) { err.textContent = 'Escribe tu nombre.'; return; }
        if (!phone) { err.textContent = 'Escribe un WhatsApp de Honduras de 8 dígitos (ej. 9911-2233).'; return; }
        const c = saveGuestContact(name, phone);
        const btn = $('#hrg-go');
        btn.disabled = true; btn.textContent = 'Enviando…'; err.textContent = '';
        try { await onSubmit?.(c); s.close(); } catch (e) {
            err.textContent = String(e?.message || 'No se pudo enviar. Intenta de nuevo.').replace(/^.*?: /, '');
            btn.disabled = false; btn.textContent = cta;
        }
    });
    return s;
}

/** Llama al servidor. payload sin precios ni datos del cliente: el servidor los pone. */
export async function guestCreate(kind, contact, payload) {
    const r = await httpsCallable(fns(), 'guestCreateRequest')({ kind, name: contact.name, phone: contact.phone, deviceId: guestDeviceId(), payload });
    const d = r.data || {};
    if (d.id && d.token) rememberRequest({ kind, id: d.id, token: d.token });
    return d;
}

/** Pasa a la cuenta los pedidos hechos sin cuenta en este equipo. */
export async function claimGuestRequests() {
    const list = guestRequests().filter((x) => !x.claimed);
    if (!list.length || !fns()) return 0;
    try {
        const r = await httpsCallable(fns(), 'guestClaimRequests')({ items: list.map(({ kind, id, token }) => ({ kind, id, token })) });
        ls.set(K_REQS, guestRequests().map((x) => ({ ...x, claimed: true })));
        const n = r.data?.claimed || 0;
        if (n) toast(`Pasamos ${n} pedido${n === 1 ? '' : 's'} hecho${n === 1 ? '' : 's'} sin cuenta a tu cuenta.`, 'success');
        return n;
    } catch (_) { return 0; }
}

const ORDER_ST = { pending: 'Esperando a la tienda', accepted: 'Tienda aceptó', preparing: 'Preparando', ready: 'Listo · buscando conductor', out_for_delivery: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado', rejected: 'Rechazado' };
/** Seguimiento de un pedido de tienda hecho sin cuenta (sin sesión no se puede leer store_orders). */
export function openGuestOrderTracker(id, opts = {}) {
    const req = guestRequests().find((x) => x.id === id);
    if (!req) return toast('No encontramos ese pedido en este teléfono.', 'warning');
    const s = sheet(`${brand('TU PEDIDO')}<div id="hrg-body"><p class="hrg-sub">Cargando…</p></div>`);
    let timer = null;
    const paint = (o) => {
        const done = ['delivered', 'cancelled', 'rejected'].includes(o.status);
        const money = (n) => (n == null ? '—' : `L ${Number(n).toFixed(2)}`);
        s.el.querySelector('#hrg-body').innerHTML = `
          <h3 class="hrg-h">${esc(o.storeName || 'Tienda')}</h3>
          <span class="hrg-st">${esc(ORDER_ST[o.status] || o.status || '')}</span>
          <div class="hrg-card">${(o.items || []).map((i) => `<div>${esc(i.qty)}× ${esc(i.name)} <b style="float:right">${money(i.price * i.qty)}</b></div>`).join('')}
            <hr style="border:0;border-top:1px solid #e2e8f0;margin:8px 0"><div>Productos <b style="float:right">${money(o.itemsTotal)}</b></div>
            <div>Envío <b style="float:right">${o.deliveryFee == null ? 'lo confirma la tienda' : money(o.deliveryFee)}</b></div></div>
          <p class="hrg-note">Pagas en efectivo al recibir. La tienda y el conductor te escriben a tu WhatsApp.</p>
          ${o.tripId ? `<button class="hrg-alt" data-hrg-trip="${esc(o.tripId)}">Ver al conductor en el mapa</button>` : ''}
          ${done && o.status === 'delivered' ? '<div class="hrg-card" style="background:#ecfdf5;border-color:#a7f3d0"><b>¡Gracias por tu pedido!</b><br>Crea tu cuenta para guardar tus pedidos, puntos y direcciones.<button class="hrg-btn" data-hrg-acct>Crear cuenta</button></div>' : ''}`;
        if (done) clearInterval(timer);
    };
    const load = async () => {
        try { paint((await httpsCallable(fns(), 'guestTrackRequest')({ kind: 'store_order', id, token: req.token })).data); } catch (e) {
            s.el.querySelector('#hrg-body').innerHTML = `<p class="hrg-sub">${esc(e?.message || 'No se pudo cargar.')}</p>`;
        }
    };
    s.el.addEventListener('click', (e) => {
        const t = e.target.closest('[data-hrg-trip]'); if (t) { location.href = `/?trip=${encodeURIComponent(t.dataset.hrgTrip)}`; }
        if (e.target.closest('[data-hrg-acct]')) { s.close(); offerCreateAccount(); }
    });
    if (opts.preview) paint(opts.preview); else { load(); timer = setInterval(load, 15000); }
    const obs = new MutationObserver(() => { if (!document.body.contains(s.el)) { clearInterval(timer); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
    return s;
}

/** Después del servicio: invitar a crear cuenta (los pedidos se pasan solos al entrar). */
export function offerCreateAccount() {
    const c = getGuestContact();
    window.requireAuthForService?.('guardar tus pedidos', {
        role: 'client', mode: 'register', icon: '🎉', noGuest: true,
        reasonTitle: 'Crea tu cuenta en 30 segundos',
        reasonSub: `${c?.name ? `${c.name}, tus` : 'Tus'} viajes y pedidos hechos sin cuenta pasan a tu cuenta al registrarte con este teléfono.`,
    });
}

window.hrGuest = { openGuestForm, guestCreate, getGuestContact, normalizeGuestPhone, claimGuestRequests, openGuestOrderTracker, offerCreateAccount, guestRequests, formatHnPhone };
