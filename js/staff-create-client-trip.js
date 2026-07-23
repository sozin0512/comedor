/**
 * Admin/supervisor: crear viaje en nombre de un cliente.
 * Preferido: abrir desde la tarjeta del pasajero (preseleccionado).
 * También: botón global con búsqueda (opcional).
 */
import {
    collection, doc, getDoc, getDocs, addDoc, query, where, serverTimestamp, limit
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { normalizeHondurasPhone, formatHondurasPhone, getWhatsAppLink } from './phone-utils.js';
import {
    normalizeServiceType,
    calculateServiceFare,
    getMaxPassengers,
    getExtraPassengerFee,
    getPassengerSurcharge,
    normalizePassengerCount,
    formatPassengersLabel,
    applyPassengerSurcharge
} from './service-types.js';
import { getDefaultZoneId, getZoneById, getZoneConfig, getCityCoverageKm } from './zones.js';

/** Host público siempre (WhatsApp no linkifica capacitor:// ni localhost). */
const STAFF_TRIP_PUBLIC_BASE = 'https://comedor-86278.web.app';

function getPublicAppBaseUrl() {
    try {
        const origin = String(window.location?.origin || '').replace(/\/$/, '');
        // Solo confiar en https público real (no app nativa / dev)
        if (
            origin
            && /^https:\/\//i.test(origin)
            && !/localhost|127\.0\.0\.1|capacitor|android_asset|chrome-extension/i.test(origin)
        ) {
            return origin;
        }
    } catch (_) {}
    return STAFF_TRIP_PUBLIC_BASE;
}

/** Link que el cliente abre para ver/reclamar el viaje armado por staff */
function buildStaffTripShareLink(tripId) {
    const id = String(tripId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) return '';
    // URL limpia y corta: WhatsApp la pinta azul; evita index.html (a veces rompe en WebView)
    const base = getPublicAppBaseUrl();
    return `${base}/?staffTrip=${id}`;
}

const PENDING_STAFF_TRIP_KEY = 'honduraite_pending_staff_trip';

function storePendingStaffTripId(tripId) {
    const id = String(tripId || '').trim();
    if (!id) return;
    try { sessionStorage.setItem(PENDING_STAFF_TRIP_KEY, id); } catch (_) {}
    try {
        localStorage.setItem(PENDING_STAFF_TRIP_KEY, id);
        localStorage.setItem(PENDING_STAFF_TRIP_KEY + '_at', String(Date.now()));
    } catch (_) {}
}

function readPendingStaffTripId() {
    try {
        const fromSession = sessionStorage.getItem(PENDING_STAFF_TRIP_KEY);
        if (fromSession) return fromSession;
    } catch (_) {}
    try {
        const at = parseInt(localStorage.getItem(PENDING_STAFF_TRIP_KEY + '_at') || '0', 10);
        // Conservar 7 días
        if (at && Date.now() - at > 7 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem(PENDING_STAFF_TRIP_KEY);
            localStorage.removeItem(PENDING_STAFF_TRIP_KEY + '_at');
            return '';
        }
        return localStorage.getItem(PENDING_STAFF_TRIP_KEY) || '';
    } catch (_) {
        return '';
    }
}

function clearPendingStaffTripId() {
    try { sessionStorage.removeItem(PENDING_STAFF_TRIP_KEY); } catch (_) {}
    try {
        localStorage.removeItem(PENDING_STAFF_TRIP_KEY);
        localStorage.removeItem(PENDING_STAFF_TRIP_KEY + '_at');
    } catch (_) {}
}

function buildStaffTripWhatsAppMessage({
    tripId, clientName, origin, destination, priceLabel,
    clientChoosesSchedule, passengers, clientChoosesPassengers, scheduledFor
}) {
    const link = buildStaffTripShareLink(tripId);
    const name = (clientName || 'Cliente').split(' ')[0];
    const pax = Math.max(1, parseInt(passengers, 10) || 1);
    let whenLine = null;
    if (clientChoosesSchedule) {
        whenLine = 'Programado: al abrir eliges fecha y hora.';
    } else if (scheduledFor) {
        try {
            const when = new Date(scheduledFor).toLocaleString('es-HN', {
                weekday: 'short', day: 'numeric', month: 'short',
                hour: '2-digit', minute: '2-digit'
            });
            whenLine = `Programado: ${when}`;
        } catch (_) {
            whenLine = 'Viaje programado.';
        }
    }
    // Formato pensado para WhatsApp: el link en su propia línea, con https://
    const lines = [
        `HonduRaite — viaje listo para ti, ${name}`,
        '',
        `Origen: ${origin || '—'}`,
        `Destino: ${destination || '—'}`,
        priceLabel ? `Tarifa: ${priceLabel}` : null,
        clientChoosesPassengers
            ? 'Personas: al abrir eliges cuántas van (máx. 4).'
            : (pax > 1 ? `Personas: ${pax}` : null),
        whenLine,
        '',
        'Abre tu viaje aquí (toca el enlace):',
        '',
        link,
        '',
        'Si no se ve azul, copia y pega el enlace en el navegador.',
        'También te llega una notificación en la app HonduRaite.'
    ].filter((x) => x != null);
    return lines.join('\n');
}

function showStaffTripSharePanel({
    tripId,
    clientName,
    clientPhone,
    origin,
    destination,
    priceLabel,
    clientChoosesSchedule,
    passengers,
    clientChoosesPassengers,
    scheduledFor,
    showToast,
    resend = false
}) {
    document.getElementById('staff-trip-share-modal')?.remove();
    const link = buildStaffTripShareLink(tripId);
    const phone = normalizeHondurasPhone(clientPhone) || clientPhone || '';
    const msg = buildStaffTripWhatsAppMessage({
        tripId, clientName, origin, destination, priceLabel,
        clientChoosesSchedule, passengers, clientChoosesPassengers, scheduledFor
    });
    // wa.me suele prellenar mejor el texto con URLs; api.whatsapp.com a veces trunca
    const waUrl = phone ? getWhatsAppLink(phone, msg) : '';
    const waGeneric = phone
        ? `https://wa.me/${normalizeHondurasPhone(phone)}?text=${encodeURIComponent(msg)}`
        : `https://wa.me/?text=${encodeURIComponent(msg)}`;

    const panel = document.createElement('div');
    panel.id = 'staff-trip-share-modal';
    panel.setAttribute('style',
        'position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;'
        + 'padding:1rem;background:rgba(0,0,0,0.78);'
    );
    panel.innerHTML = `
        <div style="background:#0f172a;color:#fff;width:100%;max-width:24rem;border-radius:1.25rem;border:1px solid #334155;
            box-shadow:0 25px 50px rgba(0,0,0,.5);padding:1.15rem;">
            <div style="text-align:center;margin-bottom:0.85rem;">
                <div style="width:3.25rem;height:3.25rem;margin:0 auto 0.5rem;border-radius:1rem;background:${resend ? '#1e3a5f' : '#064e3b'};
                    display:flex;align-items:center;justify-content:center;font-size:1.5rem;">${resend ? '↩' : '✓'}</div>
                <h3 style="margin:0;font-size:1.05rem;font-weight:900;">${resend ? 'Reenviar mensaje' : 'Viaje creado'}</h3>
                <p style="margin:0.35rem 0 0;font-size:12px;color:#94a3b8;font-weight:700;line-height:1.4;">
                    ${resend ? 'Vuelve a mandar el link a' : 'Notificación enviada a'}
                    <b style="color:#6ee7b7;">${escapeHtml(clientName || 'cliente')}</b>.
                    ${clientChoosesSchedule
                        ? ' Es programado: el cliente elige fecha y hora.'
                        : (scheduledFor ? ' Es programado con fecha/hora fija.' : '')}
                </p>
            </div>
            <div style="padding:0.65rem 0.75rem;border-radius:0.85rem;background:#020617;border:1px solid #1e293b;margin-bottom:0.75rem;">
                <p style="margin:0 0 0.35rem;font-size:10px;font-weight:900;text-transform:uppercase;color:#64748b;">Link del viaje</p>
                <p id="staff-trip-share-link-text" style="margin:0;font-size:11px;font-weight:700;color:#93c5fd;word-break:break-all;line-height:1.35;">
                    ${escapeHtml(link)}
                </p>
            </div>
            <button type="button" id="staff-trip-wa-client" class="ops-btn" style="width:100%;padding:0.85rem;font-weight:900;margin-bottom:0.45rem;
                background:#25D366;color:#fff;border:0;border-radius:0.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.45rem;">
                <i class="fab fa-whatsapp" style="font-size:1.15rem;"></i>
                Enviar por WhatsApp ${phone ? 'al cliente' : ''}
            </button>
            <button type="button" id="staff-trip-wa-pick" style="width:100%;padding:0.7rem;font-weight:800;margin-bottom:0.45rem;
                background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:0.85rem;cursor:pointer;font-size:12px;">
                WhatsApp (elegir chat)
            </button>
            <button type="button" id="staff-trip-copy-link" style="width:100%;padding:0.7rem;font-weight:800;margin-bottom:0.45rem;
                background:transparent;color:#93c5fd;border:1px solid #334155;border-radius:0.85rem;cursor:pointer;font-size:12px;">
                Copiar link
            </button>
            <button type="button" id="staff-trip-share-close" style="width:100%;padding:0.65rem;background:transparent;border:0;color:#94a3b8;font-weight:900;font-size:12px;cursor:pointer;">
                Cerrar
            </button>
        </div>
    `;
    document.body.appendChild(panel);

    const close = () => panel.remove();
    panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
    panel.querySelector('#staff-trip-share-close')?.addEventListener('click', close);

    panel.querySelector('#staff-trip-wa-client')?.addEventListener('click', () => {
        const url = waUrl && waUrl !== 'https://wa.me/' ? waUrl : waGeneric;
        try {
            window.open(url, '_blank', 'noopener');
        } catch (_) {
            window.location.href = url;
        }
        toast(showToast, 'Abriendo WhatsApp…', 'success');
    });

    panel.querySelector('#staff-trip-wa-pick')?.addEventListener('click', () => {
        try {
            window.open(waGeneric, '_blank', 'noopener');
        } catch (_) {
            window.location.href = waGeneric;
        }
    });

    panel.querySelector('#staff-trip-copy-link')?.addEventListener('click', async () => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(link);
            } else {
                const ta = document.createElement('textarea');
                ta.value = link;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            toast(showToast, 'Link copiado.', 'success');
        } catch (_) {
            toast(showToast, 'No se pudo copiar. Selecciónalo a mano.', 'warning');
        }
    });
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function toast(showToast, msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
    else if (typeof window.showToast === 'function') window.showToast(msg, type);
    else {
        try { window.alert(msg); } catch (_) {}
    }
}

export function installStaffCreateClientTrip({
    db,
    appId,
    getCurrentUser,
    getUserProfile,
    isStaffUser,
    showToast,
    assignNextTripOffer
}) {
    /**
     * @param {object|Event|null} preselectedOrEvent
     *   - { uid, name, phone } desde la tarjeta del pasajero
     *   - Event (click global) se ignora
     */
    window.staffOpenCreateTripForClient = async (preselectedOrEvent = null) => {
        console.log('[staff] open create trip', preselectedOrEvent);
        try {
            // Si viene un Event de onclick, no es preselección
            let pre = null;
            if (preselectedOrEvent && typeof preselectedOrEvent === 'object' && preselectedOrEvent.uid) {
                pre = preselectedOrEvent;
            }

            document.getElementById('staff-create-client-trip-modal')?.remove();

            const defaultZone = window.activeServiceZoneId || getDefaultZoneId?.() || '';
            let zoneOptionsHtml = '';
            try {
                const zcfg = typeof getZoneConfig === 'function' ? getZoneConfig() : null;
                const list = zcfg?.zones || zcfg || [];
                const arr = Array.isArray(list) ? list : Object.values(list || {});
                zoneOptionsHtml = arr.map((z) => {
                    const id = z.id || z.zoneId || '';
                    const name = z.name || id;
                    if (!id) return '';
                    return `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
                }).join('');
            } catch (_) {}

            const preName = pre?.name || '';
            const prePhone = pre?.phone || '';
            const preUid = pre?.uid || '';
            const hasPre = !!preUid;

            const modal = document.createElement('div');
            modal.id = 'staff-create-client-trip-modal';
            // Estilos inline para que SIEMPRE se vea encima del panel admin
            modal.setAttribute('style',
                'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;'
                + 'padding:0;background:rgba(0,0,0,0.75);'
            );
            if (window.matchMedia('(min-width: 640px)').matches) {
                modal.style.alignItems = 'center';
                modal.style.padding = '1rem';
            }

            modal.innerHTML = `
                <div style="background:#0f172a;color:#fff;width:100%;max-width:32rem;max-height:94dvh;overflow:auto;
                    border-radius:1.25rem 1.25rem 0 0;border:1px solid #334155;box-shadow:0 25px 50px rgba(0,0,0,.5);padding:1.1rem;">
                    <div style="display:flex;justify-content:space-between;gap:0.75rem;margin-bottom:0.75rem;">
                        <div>
                            <p style="font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#34d399;margin:0;">Staff · clientes lentos</p>
                            <h3 style="font-size:1.125rem;font-weight:900;margin:0.2rem 0 0;">Pedir viaje por el cliente</h3>
                            <p style="font-size:11px;color:#94a3b8;margin:0.35rem 0 0;line-height:1.35;">
                                Armas el viaje. El cliente recibe aviso y toca «Quiero este viaje».
                            </p>
                        </div>
                        <button type="button" id="staff-cct-close" style="width:2.5rem;height:2.5rem;border-radius:999px;background:#1e293b;color:#cbd5e1;border:0;font-size:1.25rem;cursor:pointer;">&times;</button>
                    </div>

                    ${hasPre ? `
                    <div style="margin-bottom:0.75rem;padding:0.65rem 0.75rem;border-radius:0.85rem;background:#064e3b;border:1px solid #059669;">
                        <p style="margin:0;font-size:10px;font-weight:900;color:#6ee7b7;text-transform:uppercase;">Cliente seleccionado</p>
                        <p style="margin:0.2rem 0 0;font-size:0.9rem;font-weight:900;">${escapeHtml(preName)}</p>
                        <p style="margin:0;font-size:0.7rem;color:#a7f3d0;font-weight:700;">${escapeHtml(prePhone || 'Sin teléfono')}</p>
                    </div>
                    <input type="hidden" id="staff-cct-client-id" value="${escapeHtml(preUid)}">
                    ` : `
                    <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.25rem;">Buscar cliente</label>
                    <input type="search" id="staff-cct-search" class="ops-input" style="width:100%;margin-bottom:0.5rem;" placeholder="Nombre o WhatsApp" autocomplete="off">
                    <div id="staff-cct-client-list" style="max-height:9rem;overflow:auto;margin-bottom:0.75rem;border:1px solid #334155;border-radius:0.75rem;padding:0.4rem;background:#020617;">
                        <p style="font-size:11px;color:#94a3b8;font-weight:700;padding:0.4rem;margin:0;">Escribe para buscar (no carga todos)</p>
                    </div>
                    <p id="staff-cct-selected" style="font-size:12px;font-weight:800;color:#6ee7b7;margin:0 0 0.75rem;display:none;"></p>
                    <input type="hidden" id="staff-cct-client-id" value="">
                    `}

                    <div style="display:grid;gap:0.65rem;margin-bottom:0.65rem;">
                        <div style="position:relative;">
                            <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.25rem;">Origen / recogida</label>
                            <div style="display:flex;gap:0.35rem;">
                                <input type="text" id="staff-cct-origin" class="ops-input" style="flex:1;min-width:0;" placeholder="Buscar dirección o lugar…" autocomplete="off">
                                <button type="button" id="staff-cct-origin-pin" title="Marcar con pin en el mapa"
                                    style="flex-shrink:0;padding:0 0.7rem;border-radius:0.65rem;border:1px solid #334155;background:#1e293b;color:#93c5fd;font-weight:900;font-size:11px;cursor:pointer;white-space:nowrap;">
                                    <i class="fas fa-map-marker-alt"></i> Pin
                                </button>
                            </div>
                            <div id="staff-cct-origin-suggest" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:5;margin-top:0.2rem;max-height:10rem;overflow:auto;background:#020617;border:1px solid #334155;border-radius:0.65rem;box-shadow:0 10px 30px rgba(0,0,0,.45);"></div>
                            <input type="hidden" id="staff-cct-origin-lat" value="">
                            <input type="hidden" id="staff-cct-origin-lng" value="">
                        </div>
                        <div style="position:relative;">
                            <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.25rem;">Destino</label>
                            <div style="display:flex;gap:0.35rem;">
                                <input type="text" id="staff-cct-dest" class="ops-input" style="flex:1;min-width:0;" placeholder="Buscar destino…" autocomplete="off">
                                <button type="button" id="staff-cct-dest-pin" title="Marcar destino en el mapa"
                                    style="flex-shrink:0;padding:0 0.7rem;border-radius:0.65rem;border:1px solid #334155;background:#1e293b;color:#fca5a5;font-weight:900;font-size:11px;cursor:pointer;white-space:nowrap;">
                                    <i class="fas fa-map-pin"></i> Pin
                                </button>
                            </div>
                            <div id="staff-cct-dest-suggest" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:5;margin-top:0.2rem;max-height:10rem;overflow:auto;background:#020617;border:1px solid #334155;border-radius:0.65rem;box-shadow:0 10px 30px rgba(0,0,0,.45);"></div>
                            <input type="hidden" id="staff-cct-dest-lat" value="">
                            <input type="hidden" id="staff-cct-dest-lng" value="">
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">
                        <div>
                            <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.2rem;">Servicio</label>
                            <select id="staff-cct-service" class="ops-input" style="width:100%;">
                                <option value="auto">Taxi VIP / Auto</option>
                                <option value="taxi">Taxi tradicional</option>
                                <option value="moto">Moto</option>
                                <option value="delivery">Envío</option>
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.2rem;">Zona</label>
                            <select id="staff-cct-zone" class="ops-input" style="width:100%;">
                                ${zoneOptionsHtml || `<option value="${escapeHtml(defaultZone)}">${escapeHtml(defaultZone || 'Zona')}</option>`}
                            </select>
                        </div>
                    </div>

                    <div id="staff-cct-pax-wrap" style="margin-bottom:0.55rem;padding:0.6rem 0.7rem;border-radius:0.85rem;border:1px solid #334155;background:#020617;">
                        <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.35rem;">
                            Personas (opcional)
                        </label>
                        <div id="staff-cct-pax-chips" style="display:flex;flex-wrap:wrap;gap:0.35rem;"></div>
                        <input type="hidden" id="staff-cct-passengers" value="">
                        <input type="hidden" id="staff-cct-client-chooses-pax" value="1">
                        <p id="staff-cct-pax-hint" style="margin:0.4rem 0 0;font-size:10px;font-weight:700;color:#64748b;line-height:1.35;">
                            Por defecto el <b style="color:#93c5fd;">cliente elige</b> al abrir el viaje. Si sabes cuántos van, marca 1–4.
                        </p>
                    </div>

                    <div style="margin-bottom:0.5rem;padding:0.65rem;border-radius:0.85rem;border:1px solid #b45309;background:rgba(120,53,15,0.35);">
                        <label style="display:flex;align-items:flex-start;gap:0.5rem;font-size:12px;font-weight:800;color:#fde68a;cursor:pointer;">
                            <input type="checkbox" id="staff-cct-scheduled" style="margin-top:0.15rem;">
                            <span>Viaje programado</span>
                        </label>
                        <div id="staff-cct-sched-fields" style="display:none;margin-top:0.55rem;">
                            <p style="margin:0 0 0.4rem;font-size:10px;font-weight:900;text-transform:uppercase;color:#fbbf24;">¿Quién elige fecha y hora?</p>
                            <div style="display:flex;flex-direction:column;gap:0.35rem;margin-bottom:0.5rem;">
                                <label style="display:flex;align-items:center;gap:0.45rem;font-size:12px;font-weight:800;color:#fde68a;cursor:pointer;">
                                    <input type="radio" name="staff-cct-sched-who" id="staff-cct-sched-client" value="client" checked>
                                    Cliente elige (al abrir el aviso)
                                </label>
                                <label style="display:flex;align-items:center;gap:0.45rem;font-size:12px;font-weight:800;color:#fde68a;cursor:pointer;">
                                    <input type="radio" name="staff-cct-sched-who" id="staff-cct-sched-staff" value="staff">
                                    Yo pongo fecha y hora
                                </label>
                            </div>
                            <div id="staff-cct-sched-datetime" style="display:none;grid-template-columns:1fr 1fr;gap:0.5rem;">
                                <div>
                                    <label style="font-size:10px;font-weight:900;color:#fbbf24;">Fecha</label>
                                    <input type="date" id="staff-cct-date" class="ops-input" style="width:100%;">
                                </div>
                                <div>
                                    <label style="font-size:10px;font-weight:900;color:#fbbf24;">Hora</label>
                                    <input type="time" id="staff-cct-time" class="ops-input" style="width:100%;">
                                </div>
                            </div>
                            <p id="staff-cct-sched-hint" style="margin:0.4rem 0 0;font-size:10px;font-weight:700;color:#fde68a;opacity:.9;line-height:1.35;">
                                Por defecto el cliente elige cuándo lo recogen.
                            </p>
                        </div>
                    </div>

                    <div id="staff-cct-route-box" style="display:none;margin-bottom:0.65rem;padding:0.7rem 0.8rem;border-radius:0.85rem;border:1px solid #065f46;background:rgba(6,78,59,0.45);">
                        <p style="margin:0;font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#6ee7b7;">Ruta calculada</p>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.4rem;margin-top:0.45rem;">
                            <div>
                                <p style="margin:0;font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;">Distancia</p>
                                <p id="staff-cct-route-km" style="margin:0.1rem 0 0;font-size:0.95rem;font-weight:900;color:#fff;">—</p>
                            </div>
                            <div>
                                <p style="margin:0;font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;">Tiempo</p>
                                <p id="staff-cct-route-time" style="margin:0.1rem 0 0;font-size:0.95rem;font-weight:900;color:#fff;">—</p>
                            </div>
                            <div>
                                <p style="margin:0;font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;">Tarifa</p>
                                <p id="staff-cct-route-fare" style="margin:0.1rem 0 0;font-size:0.95rem;font-weight:900;color:#6ee7b7;">—</p>
                            </div>
                        </div>
                        <p id="staff-cct-route-status" style="margin:0.45rem 0 0;font-size:10px;font-weight:700;color:#a7f3d0;"></p>
                    </div>

                    <div style="margin-bottom:0.75rem;">
                        <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.2rem;">Precio manual (opcional)</label>
                        <input type="number" id="staff-cct-price" class="ops-input" style="width:100%;" min="0" step="5" placeholder="Deja vacío = tarifa de la ruta" inputmode="decimal">
                        <p style="margin:0.3rem 0 0;font-size:10px;font-weight:700;color:#64748b;line-height:1.35;">
                            Siempre se calcula la ruta (km y tiempo). Si dejas el precio vacío, se usa la tarifa de la ruta. Si escribes un monto, ese es el que se publica.
                        </p>
                    </div>

                    <p id="staff-cct-hint" style="font-size:10px;color:#64748b;font-weight:700;margin:0 0 0.75rem;"></p>

                    <button type="button" id="staff-cct-submit" class="ops-btn ops-btn--emerald" style="width:100%;padding:0.85rem;font-weight:900;">
                        Crear viaje y notificar al cliente
                    </button>
                    <button type="button" id="staff-cct-cancel" style="width:100%;margin-top:0.5rem;padding:0.65rem;background:transparent;border:0;color:#94a3b8;font-weight:900;font-size:12px;cursor:pointer;">
                        Cancelar
                    </button>
                </div>
            `;

            document.body.appendChild(modal);
            console.log('[staff] modal DOM insertado', !!document.getElementById('staff-create-client-trip-modal'));

            // Programado: staff fija fecha/hora O deja que el cliente elija
            const schedCb = modal.querySelector('#staff-cct-scheduled');
            const schedFields = modal.querySelector('#staff-cct-sched-fields');
            const schedDatetime = modal.querySelector('#staff-cct-sched-datetime');
            const schedClientRadio = modal.querySelector('#staff-cct-sched-client');
            const schedStaffRadio = modal.querySelector('#staff-cct-sched-staff');
            const schedHint = modal.querySelector('#staff-cct-sched-hint');
            const schedDateInput = modal.querySelector('#staff-cct-date');
            const schedTimeInput = modal.querySelector('#staff-cct-time');

            // Mínimo ~20 min
            try {
                const minD = new Date(Date.now() + 20 * 60 * 1000);
                if (schedDateInput) schedDateInput.min = minD.toISOString().slice(0, 10);
            } catch (_) {}

            const syncSchedUi = () => {
                const on = !!schedCb?.checked;
                if (schedFields) schedFields.style.display = on ? 'block' : 'none';
                if (!on) return;
                const staffPicks = !!schedStaffRadio?.checked;
                if (schedDatetime) schedDatetime.style.display = staffPicks ? 'grid' : 'none';
                if (schedHint) {
                    schedHint.textContent = staffPicks
                        ? 'El cliente verá la fecha/hora que pongas. Debe ser en el futuro.'
                        : 'El cliente elige fecha y hora al abrir la notificación o el link de WhatsApp.';
                }
            };
            schedCb?.addEventListener('change', syncSchedUi);
            schedClientRadio?.addEventListener('change', syncSchedUi);
            schedStaffRadio?.addEventListener('change', syncSchedUi);
            syncSchedUi();

            // Estado de coords elegidas (búsqueda o pin) + última ruta calculada
            const placeState = {
                origin: { address: '', lat: null, lng: null },
                dest: { address: '', lat: null, lng: null }
            };
            const routeState = {
                km: 0,
                durationMs: 0,
                fare: 0,
                calculating: false,
                seq: 0
            };

            const close = () => modal.remove();
            modal.querySelector('#staff-cct-close')?.addEventListener('click', close);
            modal.querySelector('#staff-cct-cancel')?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            if (defaultZone) {
                const zsel = modal.querySelector('#staff-cct-zone');
                if (zsel) zsel.value = defaultZone;
            }

            const routeBox = modal.querySelector('#staff-cct-route-box');
            const routeKmEl = modal.querySelector('#staff-cct-route-km');
            const routeTimeEl = modal.querySelector('#staff-cct-route-time');
            const routeFareEl = modal.querySelector('#staff-cct-route-fare');
            const routeStatusEl = modal.querySelector('#staff-cct-route-status');
            const priceInput = modal.querySelector('#staff-cct-price');
            const serviceSelect = modal.querySelector('#staff-cct-service');

            const formatDuration = (ms) => {
                const mins = Math.max(1, Math.round((Number(ms) || 0) / 60000));
                if (mins < 60) return `${mins} min`;
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                return m ? `${h} h ${m} min` : `${h} h`;
            };

            const readCoordsFromDom = () => {
                let oLat = parseFloat(modal.querySelector('#staff-cct-origin-lat')?.value || '');
                let oLng = parseFloat(modal.querySelector('#staff-cct-origin-lng')?.value || '');
                let dLat = parseFloat(modal.querySelector('#staff-cct-dest-lat')?.value || '');
                let dLng = parseFloat(modal.querySelector('#staff-cct-dest-lng')?.value || '');
                if (!Number.isFinite(oLat)) oLat = placeState.origin.lat;
                if (!Number.isFinite(oLng)) oLng = placeState.origin.lng;
                if (!Number.isFinite(dLat)) dLat = placeState.dest.lat;
                if (!Number.isFinite(dLng)) dLng = placeState.dest.lng;
                return {
                    originLat: Number.isFinite(oLat) ? oLat : null,
                    originLng: Number.isFinite(oLng) ? oLng : null,
                    destLat: Number.isFinite(dLat) ? dLat : null,
                    destLng: Number.isFinite(dLng) ? dLng : null,
                    originAddr: modal.querySelector('#staff-cct-origin')?.value?.trim() || placeState.origin.address || '',
                    destAddr: modal.querySelector('#staff-cct-dest')?.value?.trim() || placeState.dest.address || ''
                };
            };

            const applyFareToUi = (km, durationMs, fare) => {
                routeState.km = km;
                routeState.durationMs = durationMs;
                routeState.fare = fare;
                if (routeBox) routeBox.style.display = 'block';
                if (routeKmEl) routeKmEl.textContent = km > 0 ? `${km.toFixed(1)} km` : '—';
                if (routeTimeEl) routeTimeEl.textContent = durationMs > 0 ? formatDuration(durationMs) : '—';
                if (routeFareEl) routeFareEl.textContent = fare > 0 ? `L. ${fare.toFixed(2)}` : '—';
                if (priceInput && fare > 0) {
                    priceInput.placeholder = `Auto: L. ${fare.toFixed(2)}`;
                }
                const override = parseFloat(priceInput?.value || '');
                if (routeStatusEl) {
                    if (override > 0) {
                        routeStatusEl.textContent = `Publicarás L. ${override.toFixed(2)} (manual). Ruta: ${km.toFixed(1)} km.`;
                    } else if (fare > 0) {
                        routeStatusEl.textContent = `Se publicará L. ${fare.toFixed(2)} según la ruta (${km.toFixed(1)} km).`;
                    } else {
                        routeStatusEl.textContent = 'Sin tarifa aún.';
                    }
                }
            };

            const clearRouteUi = (msg = '') => {
                routeState.km = 0;
                routeState.durationMs = 0;
                routeState.fare = 0;
                if (routeBox) routeBox.style.display = msg ? 'block' : 'none';
                if (routeKmEl) routeKmEl.textContent = '—';
                if (routeTimeEl) routeTimeEl.textContent = '—';
                if (routeFareEl) routeFareEl.textContent = '—';
                if (priceInput) priceInput.placeholder = 'Deja vacío = tarifa de la ruta';
                if (routeStatusEl) routeStatusEl.textContent = msg || '';
            };

            /** Calcula ruta + tarifa siempre que haya origen y destino (coords o texto). */
            const refreshRouteFare = async (opts = {}) => {
                const silent = !!opts.silent;
                const seq = ++routeState.seq;
                const serviceType = normalizeServiceType(serviceSelect?.value || 'auto');
                let { originLat, originLng, destLat, destLng, originAddr, destAddr } = readCoordsFromDom();

                if ((!originAddr || originAddr.length < 3) || (!destAddr || destAddr.length < 3)) {
                    clearRouteUi();
                    return null;
                }

                if (routeBox) routeBox.style.display = 'block';
                if (!silent && routeStatusEl) routeStatusEl.textContent = 'Calculando ruta…';
                routeState.calculating = true;

                try {
                    // Geocodificar si falta pin/sugerencia
                    if ((originLat == null || originLng == null) && typeof window.geocodeAddressString === 'function') {
                        try {
                            const o = await window.geocodeAddressString(originAddr);
                            if (o?.latLng) {
                                originLat = o.latLng.lat;
                                originLng = o.latLng.lng;
                                placeState.origin = { address: originAddr, lat: originLat, lng: originLng };
                                const latEl = modal.querySelector('#staff-cct-origin-lat');
                                const lngEl = modal.querySelector('#staff-cct-origin-lng');
                                if (latEl) latEl.value = String(originLat);
                                if (lngEl) lngEl.value = String(originLng);
                            }
                        } catch (_) {}
                    }
                    if ((destLat == null || destLng == null) && typeof window.geocodeAddressString === 'function') {
                        try {
                            const d = await window.geocodeAddressString(destAddr);
                            if (d?.latLng) {
                                destLat = d.latLng.lat;
                                destLng = d.latLng.lng;
                                placeState.dest = { address: destAddr, lat: destLat, lng: destLng };
                                const latEl = modal.querySelector('#staff-cct-dest-lat');
                                const lngEl = modal.querySelector('#staff-cct-dest-lng');
                                if (latEl) latEl.value = String(destLat);
                                if (lngEl) lngEl.value = String(destLng);
                            }
                        } catch (_) {}
                    }

                    if (seq !== routeState.seq) return null;

                    if (originLat == null || originLng == null || destLat == null || destLng == null) {
                        clearRouteUi('Marca origen y destino (búsqueda o pin) para calcular la ruta.');
                        return null;
                    }

                    let km = 0;
                    let durationMs = 0;
                    if (typeof window.computeDrivingRoute === 'function') {
                        const seg = await window.computeDrivingRoute(
                            { latLng: { lat: originLat, lng: originLng }, address: originAddr },
                            { latLng: { lat: destLat, lng: destLng }, address: destAddr }
                        );
                        if (seq !== routeState.seq) return null;
                        if (seg?.distanceMeters) km = Math.round((seg.distanceMeters / 1000) * 10) / 10;
                        if (seg?.durationMillis) durationMs = seg.durationMillis;
                    }

                    if (!(km > 0)) {
                        // Fallback haversine grueso si no hay Directions
                        const R = 6371;
                        const toRad = (x) => (x * Math.PI) / 180;
                        const dLat = toRad(destLat - originLat);
                        const dLng = toRad(destLng - originLng);
                        const a = Math.sin(dLat / 2) ** 2
                            + Math.cos(toRad(originLat)) * Math.cos(toRad(destLat)) * Math.sin(dLng / 2) ** 2;
                        const straight = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                        km = Math.round(straight * 1.3 * 10) / 10; // ~factor ciudad
                        durationMs = Math.round((km / 25) * 3600000); // ~25 km/h
                    }

                    const rawPax = modal.querySelector('#staff-cct-passengers')?.value;
                    const clientChoosesPax = modal.querySelector('#staff-cct-client-chooses-pax')?.value === '1'
                        || rawPax === '' || rawPax == null;
                    const pax = clientChoosesPax
                        ? 1
                        : normalizePassengerCount(serviceType, parseInt(rawPax, 10) || 1);
                    const fare = km > 0
                        ? calculateServiceFare(serviceType, km, null, pax)
                        : 50;

                    applyFareToUi(km, durationMs, fare);
                    if (routeStatusEl && clientChoosesPax && fare > 0) {
                        routeStatusEl.textContent = `Tarifa base (1 pers.) L. ${fare.toFixed(2)}. El cliente elige cuántas van.`;
                    }
                    return { km, durationMs, fare, originLat, originLng, destLat, destLng, passengers: pax };
                } catch (e) {
                    console.warn('[staff] refreshRouteFare', e);
                    if (seq === routeState.seq) {
                        clearRouteUi('No se pudo calcular la ruta. Revisa origen/destino.');
                    }
                    return null;
                } finally {
                    if (seq === routeState.seq) routeState.calculating = false;
                }
            };

            let routeDebounce = null;
            const scheduleRouteRefresh = () => {
                clearTimeout(routeDebounce);
                routeDebounce = setTimeout(() => { refreshRouteFare(); }, 350);
            };

            // Personas: null = cliente elige al reclamar (por defecto)
            let staffPassengers = null; // null | 1..max
            const paxChips = modal.querySelector('#staff-cct-pax-chips');
            const paxHidden = modal.querySelector('#staff-cct-passengers');
            const paxClientChooses = modal.querySelector('#staff-cct-client-chooses-pax');
            const paxHint = modal.querySelector('#staff-cct-pax-hint');
            const paxWrap = modal.querySelector('#staff-cct-pax-wrap');

            const getStaffPaxForFare = () => {
                if (staffPassengers == null) return 1; // tarifa base estimada (1 pers.)
                return staffPassengers;
            };

            const renderStaffPaxChips = () => {
                const svc = normalizeServiceType(serviceSelect?.value || 'auto');
                const maxP = getMaxPassengers(svc);
                if (svc === 'delivery' || maxP <= 1) {
                    if (paxWrap) paxWrap.style.display = 'none';
                    staffPassengers = 1;
                    if (paxHidden) paxHidden.value = '1';
                    if (paxClientChooses) paxClientChooses.value = '0';
                    return;
                }
                if (paxWrap) paxWrap.style.display = 'block';
                if (staffPassengers != null) {
                    staffPassengers = normalizePassengerCount(svc, staffPassengers);
                }
                if (paxHidden) paxHidden.value = staffPassengers != null ? String(staffPassengers) : '';
                if (paxClientChooses) paxClientChooses.value = staffPassengers == null ? '1' : '0';
                if (!paxChips) return;
                paxChips.innerHTML = '';
                const fee = getExtraPassengerFee(svc);

                // Opción: lo elige el cliente
                {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    const active = staffPassengers == null;
                    btn.style.cssText = `padding:0.4rem 0.65rem;border-radius:0.65rem;font-size:11px;font-weight:900;cursor:pointer;border:1px solid ${active ? '#2563eb' : '#334155'};background:${active ? '#2563eb' : '#1e293b'};color:#fff;`;
                    btn.textContent = 'Cliente elige';
                    btn.addEventListener('click', () => {
                        staffPassengers = null;
                        renderStaffPaxChips();
                        scheduleRouteRefresh();
                    });
                    paxChips.appendChild(btn);
                }

                for (let p = 1; p <= maxP; p++) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    const active = staffPassengers === p;
                    btn.style.cssText = `padding:0.4rem 0.65rem;border-radius:0.65rem;font-size:11px;font-weight:900;cursor:pointer;border:1px solid ${active ? '#059669' : '#334155'};background:${active ? '#059669' : '#1e293b'};color:#fff;`;
                    btn.textContent = String(p);
                    btn.addEventListener('click', () => {
                        staffPassengers = p;
                        renderStaffPaxChips();
                        scheduleRouteRefresh();
                    });
                    paxChips.appendChild(btn);
                }

                if (paxHint) {
                    if (staffPassengers == null) {
                        paxHint.innerHTML = 'El <b style="color:#93c5fd;">cliente elige</b> 1–' + maxP + ' al abrir la notificación. Se muestra tarifa base (1 pers.).';
                    } else {
                        const sur = getPassengerSurcharge(svc, staffPassengers, routeState.km);
                        paxHint.textContent = sur > 0
                            ? `${formatPassengersLabel(staffPassengers)} · +L. ${sur.toFixed(0)} extra (L. ${fee} c/u). El conductor verá que van ${staffPassengers}.`
                            : `Fijaste 1 persona. El cliente aún puede cambiar al confirmar.`;
                    }
                }
            };
            renderStaffPaxChips();

            serviceSelect?.addEventListener('change', () => {
                renderStaffPaxChips();
                if (routeState.km > 0) {
                    const svc = normalizeServiceType(serviceSelect.value || 'auto');
                    const pax = getStaffPaxForFare();
                    const fare = calculateServiceFare(svc, routeState.km, null, pax);
                    applyFareToUi(routeState.km, routeState.durationMs, fare);
                } else {
                    scheduleRouteRefresh();
                }
            });
            priceInput?.addEventListener('input', () => {
                if (routeState.km > 0) {
                    applyFareToUi(routeState.km, routeState.durationMs, routeState.fare);
                }
            });

            /** Búsqueda de lugares (Places Autocomplete) o geocode simple */
            const bindPlaceSearch = (inputId, suggestId, which) => {
                const input = modal.querySelector(`#${inputId}`);
                const box = modal.querySelector(`#${suggestId}`);
                if (!input || !box) return;
                let timer = null;
                let sessionToken = null;

                const hideBox = () => {
                    box.style.display = 'none';
                    box.innerHTML = '';
                };

                const setPlace = (address, lat, lng) => {
                    input.value = address || '';
                    placeState[which] = {
                        address: address || '',
                        lat: lat != null ? Number(lat) : null,
                        lng: lng != null ? Number(lng) : null
                    };
                    const latEl = modal.querySelector(`#staff-cct-${which === 'origin' ? 'origin' : 'dest'}-lat`);
                    const lngEl = modal.querySelector(`#staff-cct-${which === 'origin' ? 'origin' : 'dest'}-lng`);
                    if (latEl) latEl.value = lat != null ? String(lat) : '';
                    if (lngEl) lngEl.value = lng != null ? String(lng) : '';
                    hideBox();
                    scheduleRouteRefresh();
                };

                input.addEventListener('input', () => {
                    // Si el usuario edita a mano, invalidar coords hasta elegir sugerencia o pin
                    placeState[which].lat = null;
                    placeState[which].lng = null;
                    placeState[which].address = input.value.trim();
                    const latEl = modal.querySelector(`#staff-cct-${which === 'origin' ? 'origin' : 'dest'}-lat`);
                    const lngEl = modal.querySelector(`#staff-cct-${which === 'origin' ? 'origin' : 'dest'}-lng`);
                    if (latEl) latEl.value = '';
                    if (lngEl) lngEl.value = '';
                    clearRouteUi('Elige una sugerencia o marca con pin para recalcular la ruta.');

                    clearTimeout(timer);
                    const q = input.value.trim();
                    if (q.length < 3) {
                        hideBox();
                        return;
                    }
                    timer = setTimeout(async () => {
                        try {
                            if (typeof google === 'undefined' || !google.maps?.places) {
                                hideBox();
                                return;
                            }
                            if (!sessionToken) {
                                sessionToken = new google.maps.places.AutocompleteSessionToken();
                            }
                            const service = new google.maps.places.AutocompleteService();
                            const bias = window.gMap?.getCenter?.();
                            const req = {
                                input: q,
                                componentRestrictions: { country: 'hn' },
                                sessionToken
                            };
                            if (bias) {
                                req.location = bias;
                                req.radius = 40000;
                            }
                            service.getPlacePredictions(req, (preds, status) => {
                                if (status !== google.maps.places.PlacesServiceStatus.OK || !preds?.length) {
                                    hideBox();
                                    return;
                                }
                                box.innerHTML = preds.slice(0, 6).map((p) => `
                                    <button type="button" data-place-id="${escapeHtml(p.place_id)}"
                                        style="display:block;width:100%;text-align:left;padding:0.55rem 0.65rem;border:0;border-bottom:1px solid #1e293b;background:transparent;color:#e2e8f0;cursor:pointer;font-size:12px;font-weight:700;">
                                        ${escapeHtml(p.description || '')}
                                    </button>
                                `).join('');
                                box.style.display = 'block';
                            });
                        } catch (e) {
                            console.warn('[staff] place search', e);
                            hideBox();
                        }
                    }, 280);
                });

                box.addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-place-id]');
                    if (!btn) return;
                    const placeId = btn.dataset.placeId;
                    const label = (btn.textContent || '').trim();
                    if (!placeId || typeof google === 'undefined') {
                        setPlace(label, null, null);
                        return;
                    }
                    try {
                        const mapOrDiv = window.gMap || document.createElement('div');
                        const ps = new google.maps.places.PlacesService(mapOrDiv);
                        ps.getDetails(
                            { placeId, fields: ['formatted_address', 'geometry', 'name'], sessionToken },
                            (place, status) => {
                                sessionToken = null;
                                if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                                    const loc = place.geometry.location;
                                    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
                                    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
                                    const addr = place.formatted_address || place.name || label;
                                    setPlace(addr, lat, lng);
                                    toast(showToast, which === 'origin' ? 'Origen listo.' : 'Destino listo.', 'success');
                                } else {
                                    setPlace(label, null, null);
                                }
                            }
                        );
                    } catch (_) {
                        setPlace(label, null, null);
                    }
                });

                // Cerrar sugerencias al hacer clic fuera
                document.addEventListener('click', (e) => {
                    if (!box.contains(e.target) && e.target !== input) hideBox();
                });
            };

            bindPlaceSearch('staff-cct-origin', 'staff-cct-origin-suggest', 'origin');
            bindPlaceSearch('staff-cct-dest', 'staff-cct-dest-suggest', 'dest');

            const openPinPick = (which) => {
                if (!window.startMapPickMode) {
                    return toast(showToast, 'El mapa aún no está listo.', 'warning');
                }
                // Ocultar modal mientras se elige en el mapa (vuelve al confirmar)
                modal.style.visibility = 'hidden';
                modal.style.pointerEvents = 'none';

                const context = which === 'origin' ? 'staff-origin' : 'staff-destination';
                window.startMapPickMode({
                    context,
                    onSelect: async (geo) => {
                        const addr = geo?.address || '';
                        const lat = geo?.latLng?.lat;
                        const lng = geo?.latLng?.lng;
                        const input = modal.querySelector(which === 'origin' ? '#staff-cct-origin' : '#staff-cct-dest');
                        const latEl = modal.querySelector(which === 'origin' ? '#staff-cct-origin-lat' : '#staff-cct-dest-lat');
                        const lngEl = modal.querySelector(which === 'origin' ? '#staff-cct-origin-lng' : '#staff-cct-dest-lng');
                        if (input) input.value = addr;
                        if (latEl) latEl.value = lat != null ? String(lat) : '';
                        if (lngEl) lngEl.value = lng != null ? String(lng) : '';
                        placeState[which] = { address: addr, lat: lat ?? null, lng: lng ?? null };
                        toast(showToast, which === 'origin' ? 'Punto de recogida marcado.' : 'Destino marcado.', 'success');
                        scheduleRouteRefresh();
                    },
                    onCancel: () => {
                        modal.style.visibility = 'visible';
                        modal.style.pointerEvents = 'auto';
                    }
                });

                // Al confirmar, startMapPickMode restaura panel; re-mostrar modal
                const restoreModal = () => {
                    if (!document.getElementById('staff-create-client-trip-modal')) return;
                    modal.style.visibility = 'visible';
                    modal.style.pointerEvents = 'auto';
                };
                // confirmMapPick llama cancelMapPickMode; enganchar tras un tick del confirm
                const origConfirm = window.confirmMapPick;
                if (typeof origConfirm === 'function' && !window._staffMapPickHooked) {
                    window._staffMapPickHooked = true;
                    window.confirmMapPick = async (...args) => {
                        try {
                            await origConfirm.apply(window, args);
                        } finally {
                            restoreModal();
                            // dejar el hook solo para esta sesión de staff pick
                            window.confirmMapPick = origConfirm;
                            window._staffMapPickHooked = false;
                        }
                    };
                }
                // También restaurar si cancela
                setTimeout(() => {
                    const cancelBtn = document.getElementById('btn-map-pick-cancel');
                    if (cancelBtn && cancelBtn.dataset.staffRestore !== '1') {
                        cancelBtn.dataset.staffRestore = '1';
                        cancelBtn.addEventListener('click', () => {
                            restoreModal();
                            cancelBtn.dataset.staffRestore = '0';
                        }, { once: true });
                    }
                }, 50);

                // Centrar cerca del usuario si hay GPS
                if (navigator.geolocation?.getCurrentPosition) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => {
                            if (window._mapPickState) {
                                window.smoothMapGoTo?.(pos.coords.latitude, pos.coords.longitude, 18);
                            }
                        },
                        () => {},
                        { enableHighAccuracy: true, timeout: 8000, maximumAge: 20000 }
                    );
                }
            };

            modal.querySelector('#staff-cct-origin-pin')?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openPinPick('origin');
            });
            modal.querySelector('#staff-cct-dest-pin')?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openPinPick('dest');
            });

            // Búsqueda solo si no hay preselección (y solo filtra en memoria tras 1 carga o por query corta)
            if (!hasPre) {
                const listEl = modal.querySelector('#staff-cct-client-list');
                const searchEl = modal.querySelector('#staff-cct-search');
                const selectedEl = modal.querySelector('#staff-cct-selected');
                const clientIdEl = modal.querySelector('#staff-cct-client-id');
                let clients = [];
                let loading = false;

                const foldTxt = (s) => String(s || '')
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .trim();

                const ensureClients = async () => {
                    if (clients.length || loading) return clients;
                    loading = true;
                    if (listEl) {
                        listEl.innerHTML = '<p style="font-size:11px;color:#94a3b8;font-weight:700;padding:0.4rem;">Cargando…</p>';
                    }
                    try {
                        // Preferir lista admin ya enriquecida (nombre/tel/correo) si está en memoria
                        const fromAdmin = Array.isArray(window.allUsersData) ? window.allUsersData : null;
                        if (fromAdmin?.length) {
                            clients = fromAdmin
                                .filter((u) => {
                                    const role = u.role || 'client';
                                    return role === 'client' || role === '' || u.passengerMode === true;
                                })
                                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
                            window._staffClientsCache = clients;
                            window._staffClientsCacheAt = Date.now();
                        } else if (!window._staffClientsCache || Date.now() - (window._staffClientsCacheAt || 0) > 120000) {
                            const snap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'users'));
                            window._staffClientsCache = snap.docs
                                .map((d) => ({ uid: d.id, ...d.data() }))
                                .filter((u) => {
                                    const role = u.role || 'client';
                                    return role === 'client' || role === '' || u.passengerMode === true;
                                })
                                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
                            window._staffClientsCacheAt = Date.now();
                            clients = window._staffClientsCache || [];
                        } else {
                            clients = window._staffClientsCache || [];
                        }
                    } catch (e) {
                        console.error(e);
                        if (listEl) listEl.innerHTML = `<p style="color:#f87171;font-size:11px;padding:0.4rem;">Error: ${escapeHtml(e.message)}</p>`;
                    } finally {
                        loading = false;
                    }
                    return clients;
                };

                const render = async (q = '') => {
                    const list = await ensureClients();
                    const needle = String(q || '').trim().replace(/\D/g, '');
                    const needleTxt = foldTxt(q);
                    if (!needleTxt && !needle) {
                        if (listEl) {
                            listEl.innerHTML = '<p style="font-size:11px;color:#94a3b8;font-weight:700;padding:0.4rem;">Escribe nombre o número para buscar</p>';
                        }
                        return;
                    }
                    const filtered = list.filter((u) => {
                        const phone = String(u.phone || '').replace(/\D/g, '');
                        const name = foldTxt(u.name || '');
                        const email = foldTxt(u.email || '');
                        const referral = foldTxt(u.referralCode || '');
                        if (needle.length >= 3 && phone.includes(needle)) return true;
                        if (needleTxt && (name.includes(needleTxt) || email.includes(needleTxt) || referral.includes(needleTxt))) return true;
                        return false;
                    }).slice(0, 25);
                    if (!listEl) return;
                    if (!filtered.length) {
                        listEl.innerHTML = '<p style="font-size:11px;color:#64748b;padding:0.4rem;">Sin resultados</p>';
                        return;
                    }
                    listEl.innerHTML = filtered.map((u) => {
                        const phone = formatHondurasPhone(u.phone) || u.phone || 'Sin tel.';
                        return `<button type="button" class="staff-cct-pick" data-uid="${escapeHtml(u.uid)}"
                            data-name="${escapeHtml(u.name || 'Cliente')}" data-phone="${escapeHtml(phone)}"
                            style="display:block;width:100%;text-align:left;padding:0.45rem 0.55rem;border-radius:0.5rem;border:0;background:transparent;color:#fff;cursor:pointer;">
                            <span style="font-size:12px;font-weight:900;">${escapeHtml(u.name || 'Cliente')}</span>
                            <span style="display:block;font-size:10px;color:#94a3b8;font-weight:700;">${escapeHtml(phone)}</span>
                        </button>`;
                    }).join('');
                };

                let searchTimer = null;
                searchEl?.addEventListener('input', () => {
                    clearTimeout(searchTimer);
                    searchTimer = setTimeout(() => render(searchEl.value), 200);
                });
                listEl?.addEventListener('click', (e) => {
                    const btn = e.target.closest('.staff-cct-pick');
                    if (!btn) return;
                    clientIdEl.value = btn.dataset.uid || '';
                    if (selectedEl) {
                        selectedEl.style.display = 'block';
                        selectedEl.innerHTML = `✓ ${btn.dataset.name} · ${btn.dataset.phone}`;
                    }
                });
            }

            modal.querySelector('#staff-cct-submit')?.addEventListener('click', async (ev) => {
                await window.staffSubmitCreateTripForClient?.(ev.currentTarget, modal);
            });
        } catch (e) {
            console.error('staffOpenCreateTripForClient:', e);
            toast(showToast, e?.message || 'No se pudo abrir el formulario', 'error');
            try { window.alert('Error: ' + (e?.message || e)); } catch (_) {}
        }
    };

    window.staffSubmitCreateTripForClient = async (btnEl, modalEl) => {
        const currentUser = getCurrentUser?.();
        const profile = getUserProfile?.();
        const modal = modalEl || document.getElementById('staff-create-client-trip-modal');
        if (!modal) return;

        const clientId = modal.querySelector('#staff-cct-client-id')?.value?.trim();
        const origin = modal.querySelector('#staff-cct-origin')?.value?.trim();
        const destination = modal.querySelector('#staff-cct-dest')?.value?.trim();
        const serviceType = normalizeServiceType(modal.querySelector('#staff-cct-service')?.value || 'auto');
        const zoneId = modal.querySelector('#staff-cct-zone')?.value?.trim()
            || window.activeServiceZoneId
            || getDefaultZoneId?.()
            || null;
        const priceOverride = parseFloat(modal.querySelector('#staff-cct-price')?.value || '');
        // Programado: staff fija fecha/hora O el cliente la elige al reclamar
        const isScheduled = !!modal.querySelector('#staff-cct-scheduled')?.checked;
        const staffPicksSchedule = isScheduled
            && !!modal.querySelector('#staff-cct-sched-staff')?.checked;
        const clientChoosesSchedule = isScheduled && !staffPicksSchedule;
        const dateStr = modal.querySelector('#staff-cct-date')?.value || '';
        const timeStr = modal.querySelector('#staff-cct-time')?.value || '';
        const hint = modal.querySelector('#staff-cct-hint');

        // Coords del pin / sugerencia (si las hay)
        let originLat = parseFloat(modal.querySelector('#staff-cct-origin-lat')?.value || '');
        let originLng = parseFloat(modal.querySelector('#staff-cct-origin-lng')?.value || '');
        let destinationLat = parseFloat(modal.querySelector('#staff-cct-dest-lat')?.value || '');
        let destinationLng = parseFloat(modal.querySelector('#staff-cct-dest-lng')?.value || '');
        if (!Number.isFinite(originLat)) originLat = null;
        if (!Number.isFinite(originLng)) originLng = null;
        if (!Number.isFinite(destinationLat)) destinationLat = null;
        if (!Number.isFinite(destinationLng)) destinationLng = null;

        if (!clientId) return toast(showToast, 'Selecciona un cliente (o ábrelo desde su tarjeta).');
        if (!origin || origin.length < 3) return toast(showToast, 'Escribe o marca el origen (búsqueda o pin).');
        if (!destination || destination.length < 3) return toast(showToast, 'Escribe o marca el destino.');

        let scheduledFor = null;
        if (isScheduled && staffPicksSchedule) {
            if (!dateStr || !timeStr) {
                return toast(showToast, 'Pon fecha y hora del programado, o marca «Cliente elige».');
            }
            scheduledFor = new Date(`${dateStr}T${timeStr}:00`).toISOString();
            if (new Date(scheduledFor).getTime() <= Date.now() + 5 * 60 * 1000) {
                return toast(showToast, 'La fecha/hora debe ser al menos unos minutos en el futuro.');
            }
        }

        if (btnEl) {
            btnEl.disabled = true;
            btnEl.textContent = 'Creando…';
        }
        if (hint) hint.textContent = 'Calculando ruta y guardando…';

        try {
            const clientSnap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', clientId));
            if (!clientSnap.exists()) throw new Error('Cliente no encontrado.');
            const client = clientSnap.data() || {};

            const activeQ = await getDocs(query(
                collection(db, 'artifacts', appId, 'public', 'data', 'trips'),
                where('clientId', '==', clientId)
            ));
            const busy = activeQ.docs.some((d) => {
                const s = d.data()?.status;
                return ['pending', 'accepted', 'in_progress', 'scheduled'].includes(s);
            });
            if (busy) throw new Error('Ese cliente ya tiene un viaje pendiente o activo.');

            let tripDistanceKm = 0;
            let tripDurationMs = 0;

            // Siempre geocodificar si faltan coords (precio opcional NO salta la ruta)
            if ((originLat == null || originLng == null) && typeof window.geocodeAddressString === 'function') {
                try {
                    const o = await window.geocodeAddressString(origin);
                    if (o?.latLng) {
                        originLat = o.latLng.lat;
                        originLng = o.latLng.lng;
                    }
                } catch (_) {}
            }
            if ((destinationLat == null || destinationLng == null) && typeof window.geocodeAddressString === 'function') {
                try {
                    const d = await window.geocodeAddressString(destination);
                    if (d?.latLng) {
                        destinationLat = d.latLng.lat;
                        destinationLng = d.latLng.lng;
                    }
                } catch (_) {}
            }

            if (originLat == null || originLng == null || destinationLat == null || destinationLng == null) {
                throw new Error('No se pudo ubicar origen o destino. Usa la búsqueda o el pin del mapa.');
            }

            // Cálculo de ruta SIEMPRE (aunque el precio sea manual)
            if (typeof window.computeDrivingRoute === 'function') {
                try {
                    const seg = await window.computeDrivingRoute(
                        { latLng: { lat: originLat, lng: originLng }, address: origin },
                        { latLng: { lat: destinationLat, lng: destinationLng }, address: destination }
                    );
                    if (seg?.distanceMeters) tripDistanceKm = Math.round((seg.distanceMeters / 1000) * 10) / 10;
                    if (seg?.durationMillis) tripDurationMs = seg.durationMillis;
                } catch (routeErr) {
                    console.warn('[staff] computeDrivingRoute on submit', routeErr);
                }
            }

            // Fallback distancia en línea recta × 1.3 si Directions falla
            if (!(tripDistanceKm > 0) && originLat != null && destinationLat != null) {
                const R = 6371;
                const toRad = (x) => (x * Math.PI) / 180;
                const dLat = toRad(destinationLat - originLat);
                const dLng = toRad(destinationLng - originLng);
                const a = Math.sin(dLat / 2) ** 2
                    + Math.cos(toRad(originLat)) * Math.cos(toRad(destinationLat)) * Math.sin(dLng / 2) ** 2;
                const straight = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                tripDistanceKm = Math.round(straight * 1.3 * 10) / 10;
                tripDurationMs = Math.round((tripDistanceKm / 25) * 3600000);
            }

            const rawPaxVal = modal.querySelector('#staff-cct-passengers')?.value;
            const clientChoosesPassengers = serviceType !== 'delivery'
                && (
                    modal.querySelector('#staff-cct-client-chooses-pax')?.value === '1'
                    || rawPaxVal === ''
                    || rawPaxVal == null
                );
            // Si el cliente elige: guardamos 1 como base; al reclamar actualiza
            const passengers = (serviceType === 'delivery')
                ? 1
                : clientChoosesPassengers
                    ? 1
                    : normalizePassengerCount(serviceType, parseInt(rawPaxVal, 10) || 1);
            const passengerSurcharge = getPassengerSurcharge(serviceType, passengers, tripDistanceKm);

            const routeFare = tripDistanceKm > 0
                ? calculateServiceFare(serviceType, tripDistanceKm, null, passengers)
                : applyPassengerSurcharge(50, serviceType, passengers, tripDistanceKm);

            // Precio: override manual si hay; si no, tarifa de la ruta (base 1 pers. si cliente elige)
            let priceNum = priceOverride > 0 ? priceOverride : routeFare;
            priceNum = Math.round(priceNum * 100) / 100;

            if (hint) {
                hint.textContent = tripDistanceKm > 0
                    ? `Ruta ${tripDistanceKm.toFixed(1)} km · tarifa L. ${priceNum.toFixed(2)}${priceOverride > 0 ? ' (manual)' : ''}`
                    : `Guardando con tarifa L. ${priceNum.toFixed(2)}…`;
            }

            let zoneName = zoneId;
            try {
                const z = typeof getZoneById === 'function' ? getZoneById(zoneId) : null;
                zoneName = z?.name || window.activeServiceZone?.name || zoneId;
            } catch (_) {}

            const staffName = profile?.name || currentUser?.email || 'Staff';
            const tripPayload = {
                status: 'pending',
                // Staff fijó fecha/hora O null si el cliente elige al reclamar
                scheduledFor: scheduledFor || null,
                clientChoosesSchedule: clientChoosesSchedule === true,
                staffSetSchedule: !!(isScheduled && staffPicksSchedule && scheduledFor),
                serviceType,
                bookingType: 'standard',
                origin,
                destination,
                originLat,
                originLng,
                destinationLat,
                destinationLng,
                originFormattedAddress: origin,
                destinationFormattedAddress: destination,
                serviceZoneId: zoneId,
                serviceZoneName: zoneName,
                searchRadiusKm: typeof getCityCoverageKm === 'function' ? getCityCoverageKm(zoneId) : 25,
                price: `L. ${priceNum.toFixed(2)}`,
                priceNum,
                paymentMethod: 'efectivo',
                clientId,
                clientName: client.name || 'Cliente',
                clientPhone: normalizeHondurasPhone(client.phone) || client.phone || '',
                clientPhoto: client.photo || null,
                clientRating: window.getProfileRating?.(client) || '5.0',
                clientApprovalStatus: client.approvalStatus || 'approved',
                clientVerified: client.approvalStatus === 'approved' || client.verified === true || !client.approvalStatus,
                clientIsFirstTrip: !(Number(client.totalTrips) > 0),
                clientTotalTrips: Number(client.totalTrips) || 0,
                tripDistanceKm,
                tripDurationMs,
                passengers,
                passengerSurcharge,
                extraPassengers: Math.max(0, passengers - 1),
                // Si staff no fijó número → el cliente DEBE elegir al reclamar
                clientChoosesPassengers: clientChoosesPassengers === true,
                staffSetPassengers: clientChoosesPassengers !== true,
                createdAt: serverTimestamp(),
                chat: [],
                viewedBy: {},
                declinedDriverIds: [],
                offeredToDriverId: null,
                preferredDriverId: null,
                staffCreatedBy: currentUser.uid,
                staffCreatedByName: staffName,
                staffCreatedAt: serverTimestamp(),
                staffAssistedClient: true,
                staffCreatedClientClaimed: false
            };

            const createdRef = await addDoc(
                collection(db, 'artifacts', appId, 'public', 'data', 'trips'),
                tripPayload
            );
            const tripId = createdRef.id;

            modal.remove();
            toast(
                showToast,
                clientChoosesSchedule
                    ? `Viaje programado armado (cliente elige fecha/hora). Compártelo por WhatsApp.`
                    : (scheduledFor
                        ? `Viaje programado con fecha/hora fija. Compártelo por WhatsApp.`
                        : `Viaje armado. Compártelo por WhatsApp o el cliente usa la notificación.`),
                'success'
            );

            showStaffTripSharePanel({
                tripId,
                clientName: client.name || 'Cliente',
                clientPhone: client.phone || tripPayload.clientPhone,
                origin,
                destination,
                priceLabel: tripPayload.price,
                clientChoosesSchedule,
                passengers: tripPayload.passengers,
                clientChoosesPassengers: tripPayload.clientChoosesPassengers,
                scheduledFor: tripPayload.scheduledFor,
                showToast
            });
        } catch (e) {
            console.error('staffSubmitCreateTripForClient:', e);
            toast(showToast, e?.message || 'No se pudo crear el viaje.', 'error');
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = 'Crear viaje y notificar al cliente';
            }
            if (hint) hint.textContent = e?.message || 'Error';
        }
    };

    /** Abrir reclamo de viaje desde link ?staffTrip=ID (compartido por WhatsApp) */
    window.openStaffTripFromShareLink = async (tripId) => {
        // Firestore IDs: alfanuméricos. Quitar basura de WhatsApp (., ), ?, #, etc.)
        let id = String(tripId || '').trim();
        try { id = decodeURIComponent(id); } catch (_) {}
        id = id
            .replace(/^staffTrip=/i, '')
            .split(/[?#&\s]/)[0]
            .replace(/[^a-zA-Z0-9_-]/g, '');
        if (!id || id.length < 8) {
            toast(showToast, 'Link de viaje inválido. Pide que te reenvíen el mensaje desde «Viajes armados».', 'error');
            return false;
        }
        storePendingStaffTripId(id);

        const user = getCurrentUser?.() || window.currentUser || null;
        if (!user?.uid) {
            toast(showToast, 'Inicia sesión con la cuenta del cliente para abrir tu viaje.', 'warning');
            return false;
        }
        try {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'trips', id));
            if (!snap.exists()) {
                // Fallback: buscar el pending armado por staff de este cliente (link cortado)
                try {
                    const q = query(
                        collection(db, 'artifacts', appId, 'public', 'data', 'trips'),
                        where('clientId', '==', user.uid),
                        where('status', '==', 'pending'),
                        limit(15)
                    );
                    const alt = await getDocs(q);
                    const candidates = alt.docs
                        .map((d) => ({ id: d.id, ...d.data() }))
                        .filter((t) => t.staffCreatedBy && t.staffCreatedClientClaimed !== true)
                        .sort((a, b) => {
                            const ta = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                            const tb = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                            return tb - ta;
                        });
                    if (candidates[0]) {
                        const t = candidates[0];
                        document.getElementById('staff-claim-trip-modal')?.remove();
                        window.showStaffCreatedTripClaimModal?.(t, { force: true });
                        clearPendingStaffTripId();
                        toast(showToast, 'Encontramos tu viaje armado. Confirma personas y hora si hace falta.', 'success');
                        return true;
                    }
                } catch (fb) {
                    console.warn('[staff] fallback pending staff trip', fb);
                }
                toast(
                    showToast,
                    'No encontramos ese viaje con el link. Entra a la app con tu cuenta: si hay un viaje armado, te saldrá «Te armamos un viaje».',
                    'error'
                );
                return false;
            }
            const t = { id: snap.id, ...snap.data() };
            if (t.clientId && t.clientId !== user.uid) {
                toast(
                    showToast,
                    'Este viaje es de otra cuenta. Cierra sesión y entra con el teléfono/correo del pasajero.',
                    'warning'
                );
                return false;
            }
            if (t.status === 'cancelled') {
                toast(showToast, 'Esta solicitud fue cancelada. Pide a soporte un viaje nuevo.', 'warning');
                clearPendingStaffTripId();
                return false;
            }
            if (t.status === 'completed') {
                toast(showToast, 'Este viaje ya se completó.', 'info');
                clearPendingStaffTripId();
                return false;
            }
            // Listo para que el cliente acepte / ajuste personas y hora
            if (t.staffCreatedBy && t.staffCreatedClientClaimed !== true && t.status === 'pending') {
                if (typeof window.showStaffCreatedTripClaimModal === 'function') {
                    document.getElementById('staff-claim-trip-modal')?.remove();
                    window.showStaffCreatedTripClaimModal(t, { force: true });
                    clearPendingStaffTripId();
                    toast(showToast, 'Confirma tu viaje. Puedes ajustar personas y hora.', 'success');
                    return true;
                }
                toast(showToast, 'Abre HonduRaite como pasajero para confirmar el viaje.', 'info');
                return false;
            }
            // Ya reclamado o en curso
            if (t.clientId === user.uid) {
                try {
                    window.subscribeToTripDocument?.(id);
                    window.setStoredClientTripId?.(id);
                    if (t.status === 'pending' || t.status === 'scheduled') {
                        window.restorePendingTripUI?.(t);
                    }
                } catch (_) {}
                clearPendingStaffTripId();
                toast(showToast, 'Ya tienes este viaje activo.', 'success');
                return true;
            }
            toast(showToast, 'No se pudo abrir el viaje con esta cuenta.', 'warning');
            return false;
        } catch (e) {
            console.warn('[staff] openStaffTripFromShareLink', e);
            const code = e?.code || '';
            if (String(code).includes('permission') || /permission/i.test(String(e?.message || ''))) {
                toast(
                    showToast,
                    'No hay permiso para ver el viaje. Inicia sesión con la cuenta del cliente (no como conductor/admin).',
                    'error'
                );
            } else {
                toast(
                    showToast,
                    e?.message || 'No se pudo abrir el viaje. Revisa tu internet e intenta de nuevo.',
                    'error'
                );
            }
            return false;
        }
    };

    window.buildStaffTripShareLink = buildStaffTripShareLink;
    window.showStaffTripSharePanel = (opts) => showStaffTripSharePanel({ ...opts, showToast });

    function tripCreatedMs(t) {
        const c = t?.createdAt;
        if (c?.toMillis) return c.toMillis();
        if (c?.seconds) return c.seconds * 1000;
        if (typeof c === 'string' || typeof c === 'number') {
            const n = new Date(c).getTime();
            return Number.isFinite(n) ? n : 0;
        }
        return 0;
    }

    function formatStaffTripWhenShort(t) {
        if (t?.scheduledFor) {
            try {
                return new Date(t.scheduledFor).toLocaleString('es-HN', {
                    weekday: 'short', day: 'numeric', month: 'short',
                    hour: '2-digit', minute: '2-digit'
                });
            } catch (_) {
                return String(t.scheduledFor);
            }
        }
        if (t?.clientChoosesSchedule) return 'Programado · cliente elige hora';
        return 'Ahora / inmediato';
    }

    function statusLabelStaffAssisted(t) {
        if (t.status === 'cancelled') return { text: 'Cancelado', color: '#f87171' };
        if (t.status === 'completed') return { text: 'Completado', color: '#94a3b8' };
        if (t.status === 'scheduled') return { text: 'Reservado', color: '#fbbf24' };
        if (t.status === 'accepted' || t.status === 'in_progress') return { text: 'Con conductor', color: '#34d399' };
        if (t.staffCreatedClientClaimed === true) return { text: 'Cliente tomó · buscando', color: '#60a5fa' };
        return { text: 'Esperando cliente', color: '#a78bfa' };
    }

    /** Carga viajes armados por staff (para reenviar WA). */
    async function fetchStaffAssistedTrips() {
        const tripsCol = collection(db, 'artifacts', appId, 'public', 'data', 'trips');
        let list = [];

        // 1) Snapshot en memoria del panel de viajes (rápido)
        try {
            const fromSnap = (window._adminTripsLastSnap || window._supervisorTripsLastSnap || [])
                .map((t) => (t?.id ? t : null))
                .filter(Boolean)
                .filter((t) => t.staffAssistedClient === true || !!t.staffCreatedBy);
            if (fromSnap.length) list = fromSnap.slice();
        } catch (_) {}

        // 2) Query Firestore (staffAssistedClient)
        try {
            const q = query(tripsCol, where('staffAssistedClient', '==', true), limit(80));
            const snap = await getDocs(q);
            const byId = new Map(list.map((t) => [t.id, t]));
            snap.docs.forEach((d) => {
                byId.set(d.id, { id: d.id, ...d.data() });
            });
            list = Array.from(byId.values());
        } catch (e) {
            console.warn('[staff] fetch assisted trips', e);
            // Fallback: últimos viajes y filtrar en cliente
            if (!list.length) {
                try {
                    const snap = await getDocs(query(tripsCol, limit(120)));
                    list = snap.docs
                        .map((d) => ({ id: d.id, ...d.data() }))
                        .filter((t) => t.staffAssistedClient === true || !!t.staffCreatedBy);
                } catch (e2) {
                    console.warn('[staff] fetch assisted fallback', e2);
                }
            }
        }

        list.sort((a, b) => tripCreatedMs(b) - tripCreatedMs(a));
        return list;
    }

    /**
     * Panel: viajes armados por staff (programados y pendientes) + reenviar WhatsApp.
     */
    window.staffOpenAssistedTripsList = async () => {
        document.getElementById('staff-assisted-trips-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'staff-assisted-trips-modal';
        modal.setAttribute('style',
            'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;'
            + 'padding:0;background:rgba(0,0,0,0.75);'
        );
        if (window.matchMedia('(min-width: 640px)').matches) {
            modal.style.alignItems = 'center';
            modal.style.padding = '1rem';
        }

        modal.innerHTML = `
            <div style="background:#0f172a;color:#fff;width:100%;max-width:28rem;max-height:92dvh;overflow:auto;
                border-radius:1.25rem 1.25rem 0 0;border:1px solid #334155;box-shadow:0 25px 50px rgba(0,0,0,.5);padding:1.1rem;">
                <div style="display:flex;justify-content:space-between;gap:0.75rem;margin-bottom:0.75rem;align-items:flex-start;">
                    <div>
                        <p style="font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#60a5fa;margin:0;">Staff</p>
                        <h3 style="font-size:1.125rem;font-weight:900;margin:0.2rem 0 0;">Viajes armados</h3>
                        <p style="font-size:11px;color:#94a3b8;margin:0.35rem 0 0;line-height:1.35;">
                            Programados y pendientes. Reenvía el link por WhatsApp si el cliente no lo vio.
                        </p>
                    </div>
                    <button type="button" id="staff-assisted-close" style="width:2.5rem;height:2.5rem;border-radius:999px;background:#1e293b;color:#cbd5e1;border:0;font-size:1.25rem;cursor:pointer;">&times;</button>
                </div>
                <div style="display:flex;gap:0.35rem;margin-bottom:0.65rem;flex-wrap:wrap;">
                    <button type="button" data-assisted-filter="open" class="staff-assisted-filter" style="padding:0.4rem 0.7rem;border-radius:999px;border:1px solid #3b82f6;background:#2563eb;color:#fff;font-size:11px;font-weight:900;cursor:pointer;">Abiertos</button>
                    <button type="button" data-assisted-filter="scheduled" class="staff-assisted-filter" style="padding:0.4rem 0.7rem;border-radius:999px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;font-weight:900;cursor:pointer;">Programados</button>
                    <button type="button" data-assisted-filter="waiting" class="staff-assisted-filter" style="padding:0.4rem 0.7rem;border-radius:999px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;font-weight:900;cursor:pointer;">Sin reclamar</button>
                    <button type="button" data-assisted-filter="all" class="staff-assisted-filter" style="padding:0.4rem 0.7rem;border-radius:999px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;font-weight:900;cursor:pointer;">Todos</button>
                </div>
                <input type="search" id="staff-assisted-search" class="ops-input" style="width:100%;margin-bottom:0.65rem;" placeholder="Buscar cliente, destino, teléfono…" autocomplete="off">
                <div id="staff-assisted-list" style="min-height:8rem;">
                    <p style="font-size:12px;color:#94a3b8;font-weight:700;text-align:center;padding:1.5rem 0;">Cargando…</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#staff-assisted-close')?.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        const listEl = modal.querySelector('#staff-assisted-list');
        let allTrips = [];
        let filterKey = 'open';
        let searchQ = '';

        const matchesFilter = (t) => {
            const st = t.status || '';
            const waiting = st === 'pending' && t.staffCreatedClientClaimed !== true;
            const isSched = !!t.scheduledFor || t.clientChoosesSchedule === true || st === 'scheduled';
            const open = ['pending', 'scheduled', 'accepted', 'in_progress'].includes(st);
            if (filterKey === 'all') return true;
            if (filterKey === 'waiting') return waiting;
            if (filterKey === 'scheduled') return isSched && open;
            // open: activos útiles para reenviar
            return open;
        };

        const matchesSearch = (t) => {
            const q = searchQ.trim().toLowerCase();
            if (!q) return true;
            const phone = String(t.clientPhone || '').replace(/\D/g, '');
            const qDigits = q.replace(/\D/g, '');
            const blob = [
                t.clientName, t.clientPhone, t.origin, t.destination,
                t.staffCreatedByName, t.price, t.id
            ].map((x) => String(x || '').toLowerCase()).join(' ');
            if (blob.includes(q)) return true;
            if (qDigits.length >= 4 && phone.includes(qDigits)) return true;
            return false;
        };

        const renderList = () => {
            if (!listEl) return;
            const rows = allTrips.filter(matchesFilter).filter(matchesSearch);
            if (!rows.length) {
                listEl.innerHTML = `<p style="font-size:12px;color:#64748b;font-weight:700;text-align:center;padding:1.25rem 0.5rem;line-height:1.4;">
                    No hay viajes armados con este filtro.<br>
                    <span style="font-size:11px;">Crea uno con «Pedir viaje por cliente».</span>
                </p>`;
                return;
            }
            listEl.innerHTML = rows.map((t) => {
                const st = statusLabelStaffAssisted(t);
                const when = formatStaffTripWhenShort(t);
                const origin = String(t.origin || '—').slice(0, 48);
                const dest = String(t.destination || '—').slice(0, 48);
                const name = t.clientName || 'Cliente';
                const phone = formatHondurasPhone(t.clientPhone) || t.clientPhone || 'Sin tel.';
                const canResend = t.status !== 'cancelled' && t.status !== 'completed';
                return `
                <article data-assisted-id="${escapeHtml(t.id)}" style="margin-bottom:0.55rem;padding:0.7rem 0.75rem;border-radius:0.9rem;border:1px solid #334155;background:#020617;">
                    <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:flex-start;">
                        <div style="min-width:0;">
                            <p style="margin:0;font-size:0.9rem;font-weight:900;color:#fff;">${escapeHtml(name)}</p>
                            <p style="margin:0.1rem 0 0;font-size:11px;font-weight:700;color:#94a3b8;">${escapeHtml(phone)}</p>
                        </div>
                        <span style="flex-shrink:0;font-size:10px;font-weight:900;color:${st.color};white-space:nowrap;">${escapeHtml(st.text)}</span>
                    </div>
                    <p style="margin:0.45rem 0 0;font-size:11px;font-weight:700;color:#cbd5e1;line-height:1.35;">
                        ${escapeHtml(origin)} → ${escapeHtml(dest)}
                    </p>
                    <p style="margin:0.25rem 0 0;font-size:10px;font-weight:800;color:#fbbf24;">
                        <i class="fas fa-clock"></i> ${escapeHtml(when)}
                        ${t.price ? ` · ${escapeHtml(t.price)}` : ''}
                        ${Number(t.passengers) > 1 ? ` · ${Number(t.passengers)} pers.` : ''}
                    </p>
                    <div style="display:flex;gap:0.35rem;margin-top:0.55rem;flex-wrap:wrap;">
                        ${canResend ? `
                        <button type="button" data-assisted-resend="${escapeHtml(t.id)}"
                            style="flex:1;min-width:7rem;padding:0.55rem 0.65rem;border-radius:0.65rem;border:0;background:#25D366;color:#fff;font-size:11px;font-weight:900;cursor:pointer;">
                            <i class="fab fa-whatsapp"></i> Reenviar WA
                        </button>
                        <button type="button" data-assisted-copy="${escapeHtml(t.id)}"
                            style="padding:0.55rem 0.65rem;border-radius:0.65rem;border:1px solid #334155;background:#1e293b;color:#93c5fd;font-size:11px;font-weight:800;cursor:pointer;">
                            Copiar link
                        </button>
                        ` : `
                        <span style="font-size:10px;font-weight:700;color:#64748b;">No se puede reenviar (viaje cerrado)</span>
                        `}
                    </div>
                </article>`;
            }).join('');
        };

        const setFilterActive = (key) => {
            filterKey = key;
            modal.querySelectorAll('.staff-assisted-filter').forEach((btn) => {
                const on = btn.getAttribute('data-assisted-filter') === key;
                btn.style.background = on ? '#2563eb' : '#1e293b';
                btn.style.borderColor = on ? '#3b82f6' : '#334155';
                btn.style.color = '#fff';
            });
            renderList();
        };

        modal.querySelectorAll('.staff-assisted-filter').forEach((btn) => {
            btn.addEventListener('click', () => setFilterActive(btn.getAttribute('data-assisted-filter') || 'open'));
        });

        let searchTimer = null;
        modal.querySelector('#staff-assisted-search')?.addEventListener('input', (e) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                searchQ = e.target?.value || '';
                renderList();
            }, 180);
        });

        listEl?.addEventListener('click', async (e) => {
            const resendBtn = e.target.closest?.('[data-assisted-resend]');
            const copyBtn = e.target.closest?.('[data-assisted-copy]');
            const id = resendBtn?.getAttribute('data-assisted-resend')
                || copyBtn?.getAttribute('data-assisted-copy');
            if (!id) return;
            const t = allTrips.find((x) => x.id === id);
            if (!t) return;

            if (copyBtn) {
                const link = buildStaffTripShareLink(id);
                try {
                    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
                    else {
                        const ta = document.createElement('textarea');
                        ta.value = link;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        ta.remove();
                    }
                    toast(showToast, 'Link copiado.', 'success');
                } catch (_) {
                    toast(showToast, 'No se pudo copiar.', 'warning');
                }
                return;
            }

            if (resendBtn) {
                showStaffTripSharePanel({
                    tripId: t.id,
                    clientName: t.clientName || 'Cliente',
                    clientPhone: t.clientPhone || '',
                    origin: t.origin || '',
                    destination: t.destination || '',
                    priceLabel: t.price || (t.priceNum != null ? `L. ${Number(t.priceNum).toFixed(2)}` : ''),
                    clientChoosesSchedule: t.clientChoosesSchedule === true && !t.scheduledFor,
                    passengers: t.passengers,
                    clientChoosesPassengers: t.clientChoosesPassengers === true,
                    scheduledFor: t.scheduledFor || null,
                    showToast,
                    resend: true
                });
            }
        });

        try {
            allTrips = await fetchStaffAssistedTrips();
            renderList();
        } catch (e) {
            console.error(e);
            if (listEl) {
                listEl.innerHTML = `<p style="color:#f87171;font-size:12px;font-weight:700;padding:1rem;text-align:center;">${escapeHtml(e?.message || 'Error al cargar')}</p>`;
            }
        }
    };

    window.staffResendTripWhatsApp = async (tripId) => {
        const id = String(tripId || '').trim();
        if (!id) return;
        try {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'trips', id));
            if (!snap.exists()) throw new Error('Viaje no encontrado.');
            const t = { id: snap.id, ...snap.data() };
            showStaffTripSharePanel({
                tripId: t.id,
                clientName: t.clientName || 'Cliente',
                clientPhone: t.clientPhone || '',
                origin: t.origin || '',
                destination: t.destination || '',
                priceLabel: t.price || (t.priceNum != null ? `L. ${Number(t.priceNum).toFixed(2)}` : ''),
                clientChoosesSchedule: t.clientChoosesSchedule === true && !t.scheduledFor,
                passengers: t.passengers,
                clientChoosesPassengers: t.clientChoosesPassengers === true,
                scheduledFor: t.scheduledFor || null,
                showToast,
                resend: true
            });
        } catch (e) {
            toast(showToast, e?.message || 'No se pudo abrir reenvío.', 'error');
        }
    };
}
