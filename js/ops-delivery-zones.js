/**
 * Supervisión · «Zonas de envío» (tiendas).
 * Crear, editar y desactivar zonas con tarifa fija; polígono en Google Maps; historial.
 * Todo se guarda con callables (staffUpsertDeliveryZone, …): las reglas no dejan
 * escribir estas colecciones desde el navegador.
 */
import { collection, doc, onSnapshot, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getAllKnownZones } from './zones.js?v=2026.10.24.6';
import {
    esc, money, numOrNull, polygonAreaKm2, validateZoneForm, zonesSvg, zoneColor, rangeLabel,
    polygonToText, textToPolygon, squareAround, addMidpoint, CHANGE_LABELS, changeValueText,
} from './delivery-zones-shared.js?v=2026.10.24.6';

const FN_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
const DEFAULT_CITY = 'comayagua';
let DEPS = {};
let M = null; // montado
const S = {
    city: DEFAULT_CITY, zones: [], settings: {}, history: [], selId: null, form: null, saved: null,
    errors: {}, saving: false, msg: '', loading: true, mapMode: 'svg', polyText: false,
};

// ───────── utilidades ─────────
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
function errMsg(e) {
    const m = String(e?.message || e || '');
    if (/permission|insufficient/i.test(m) || e?.code === 'functions/permission-denied') return 'Sin permiso (solo admin o supervisor).';
    return m.replace(/^FirebaseError:\s*/, '') || 'No se pudo guardar.';
}
function toast(msg, type = 'info') {
    if (typeof window.showToast === 'function') return window.showToast(msg, type);
    S.msg = msg; render();
}
const fmtWhen = (ms) => {
    if (!ms) return '—';
    const d = new Date(ms);
    const day = d.toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: 'America/Tegucigalpa' }).replace('.', '');
    const t = d.toLocaleTimeString('es-HN', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Tegucigalpa' });
    return `${day} · ${t}`;
};
function cityOptions() {
    const known = (() => { try { return getAllKnownZones().filter((z) => z.country !== 'us'); } catch (_) { return []; } })();
    const ids = new Map(known.map((z) => [z.id, z]));
    S.zones.forEach((z) => { if (!ids.has(z.cityId)) ids.set(z.cityId, { id: z.cityId, name: z.cityName || z.cityId }); });
    if (!ids.has(DEFAULT_CITY)) ids.set(DEFAULT_CITY, { id: DEFAULT_CITY, name: 'Comayagua', center: { lat: 14.4598, lng: -87.6378 } });
    return [...ids.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
}
function cityById(id) { return cityOptions().find((c) => c.id === id) || { id, name: id }; }
function cityZones() {
    return S.zones.filter((z) => z.cityId === S.city).sort((a, b) => (a.priority || 99) - (b.priority || 99) || String(a.name).localeCompare(String(b.name)));
}
function formFromZone(z) {
    return {
        zoneId: z?.id || null, name: z?.name || '', cityId: z?.cityId || S.city,
        baseFee: z?.baseFee ?? '', minFee: z?.minFee ?? '', maxFee: z?.maxFee ?? '',
        priority: z?.priority ?? (cityZones().length + 1), note: z?.note || '', active: !!z?.active,
        polygon: Array.isArray(z?.polygon) ? z.polygon.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })) : [],
    };
}
function isDirty() { return !!S.form && JSON.stringify(S.form) !== JSON.stringify(S.saved); }
function zoneTag(z) {
    if (z.seed && !z.active && /sugerid/i.test(z.name || '')) return '<span class="tz-tag warn">Sugerida</span>';
    if (!z.active) return '<span class="tz-tag">Borrador</span>';
    return '<span class="tz-tag ok">Activa</span>';
}

// ───────── vista ─────────
export function viewHtml(st = S) {
    const zones = st.zones.filter((z) => z.cityId === st.city).sort((a, b) => (a.priority || 99) - (b.priority || 99));
    const anyActive = zones.some((z) => z.active);
    const behavior = st.settings[st.city]?.outsideBehavior || 'distance';
    const sel = zones.find((z) => z.id === st.selId) || null;
    const f = st.form;
    const err = st.errors || {};
    const cities = cityOptions();
    const listHtml = zones.length ? zones.map((z, i) => {
        const col = zoneColor(z, i);
        const range = (z.minFee != null || z.maxFee != null) ? `Rango permitido a tiendas: <b>${esc(money(z.minFee ?? 0))}–${esc(money(z.maxFee ?? z.baseFee).replace('L ', ''))}</b>` : 'Las tiendas pueden poner cualquier monto';
        return `<button type="button" class="tz-zcard ${z.id === st.selId ? 'on' : ''}" data-tz="select" data-id="${esc(z.id)}" style="--zc:${col}">
            <div class="tz-zhead"><i class="tz-dot"></i><b>${esc(z.name)}</b>${zoneTag(z)}</div>
            <div class="tz-zfee"><span class="tz-num">${esc(money(z.baseFee))}</span> <span class="tz-mut">tarifa base</span></div>
            <div class="tz-small">${range} · prioridad ${esc(z.priority ?? '—')}</div>
            ${z.note ? `<div class="tz-small tz-mut">${esc(z.note)}</div>` : ''}
        </button>`;
    }).join('') : `<div class="tz-empty">
            <p><b>No hay zonas en ${esc(cityById(st.city).name)}.</b></p>
            <p class="tz-mut">Mientras no haya zonas activas, el envío se cobra como hoy (por distancia).</p>
            ${st.city === DEFAULT_CITY ? '<button type="button" class="tz-btn pri" data-tz="seed">Cargar propuesta de Comayagua (inactiva)</button>' : ''}
        </div>`;
    const banner = zones.length && !anyActive
        ? `<div class="tz-banner"><b>Propuesta, todo inactivo.</b> Montos y formas son un borrador hasta que se confirmen. Mientras una zona esté inactiva, el envío se cobra como hoy (por distancia).</div>`
        : '';
    const behaviorHtml = `<div class="tz-card">
        <h3>Si la dirección queda fuera de todas las zonas</h3>
        <label class="tz-radio ${behavior === 'distance' ? 'on' : ''}"><input type="radio" name="tz-outside" value="distance" ${behavior === 'distance' ? 'checked' : ''} data-tz-change="outside">
            <span><b>Calcular por distancia (como hoy)</b><small>Se muestra «Envío: se calcula al despachar». Recomendado al inicio.</small></span></label>
        <label class="tz-radio ${behavior === 'block' ? 'on' : ''}"><input type="radio" name="tz-outside" value="block" ${behavior === 'block' ? 'checked' : ''} data-tz-change="outside">
            <span><b>No permitir el pedido</b><small>«Por ahora no llegamos a esa dirección»</small></span></label>
    </div>`;
    const area = f ? polygonAreaKm2(f.polygon) : 0;
    const prOther = f ? zones.filter((z) => z.id !== f.zoneId && Number(z.priority) > Number(f.priority)).map((z) => z.name) : [];
    const formHtml = f ? `<div class="tz-card tz-form">
        <div class="tz-sec"><h3>${f.zoneId ? `Editar zona · ${esc(sel?.name || f.name)}` : 'Nueva zona'}</h3>
            <label class="tz-tog ${f.active ? 'on' : ''}"><input type="checkbox" data-tz-field="active" ${f.active ? 'checked' : ''}><i></i>Activa</label></div>
        <div class="tz-grid2">
            <label><span class="tz-lbl">Nombre</span><input class="tz-inp ${err.name ? 'err' : ''}" data-tz-field="name" value="${esc(f.name)}" maxlength="60" placeholder="Ej. Comayagua céntrica">${err.name ? `<em class="tz-err">${esc(err.name)}</em>` : ''}</label>
            <label><span class="tz-lbl">Ciudad</span><select class="tz-inp" data-tz-field="cityId">${cities.map((c) => `<option value="${esc(c.id)}" ${c.id === f.cityId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        </div>
        <div class="tz-grid3">
            <label><span class="tz-lbl">Tarifa base</span><span class="tz-inp tz-money ${err.baseFee ? 'err' : ''}"><i>L</i><input inputmode="decimal" data-tz-field="baseFee" value="${esc(f.baseFee)}"></span>${err.baseFee ? `<em class="tz-err">${esc(err.baseFee)}</em>` : ''}</label>
            <label><span class="tz-lbl">Mínimo (opcional)</span><span class="tz-inp tz-money ${err.minFee ? 'err' : ''}"><i>L</i><input inputmode="decimal" data-tz-field="minFee" value="${esc(f.minFee)}" placeholder="— sin mínimo"></span>${err.minFee ? `<em class="tz-err">${esc(err.minFee)}</em>` : ''}</label>
            <label><span class="tz-lbl">Máximo (opcional)</span><span class="tz-inp tz-money ${err.maxFee ? 'err' : ''}"><i>L</i><input inputmode="decimal" data-tz-field="maxFee" value="${esc(f.maxFee)}" placeholder="— sin máximo"></span>${err.maxFee ? `<em class="tz-err">${esc(err.maxFee)}</em>` : ''}</label>
        </div>
        <div class="tz-grid2">
            <label><span class="tz-lbl">Prioridad si se cruza con otra</span><input class="tz-inp ${err.priority ? 'err' : ''}" type="number" min="1" max="99" data-tz-field="priority" value="${esc(f.priority)}"><small class="tz-mut">${prOther.length ? `${esc(f.priority)} · gana sobre «${esc(prOther.join('», «'))}»` : 'Menor número gana'}</small>${err.priority ? `<em class="tz-err">${esc(err.priority)}</em>` : ''}</label>
            <label><span class="tz-lbl">Forma</span><span class="tz-inp ${err.polygon ? 'err' : ''}">Polígono · ${f.polygon.length} puntos · ${area.toFixed(1)} km²</span>${err.polygon ? `<em class="tz-err">${esc(err.polygon)}</em>` : ''}</label>
        </div>
        <label><span class="tz-lbl">Nota (opcional)</span><input class="tz-inp" data-tz-field="note" value="${esc(f.note)}" maxlength="200" placeholder="Ej. casco histórico y alrededor del parque"></label>
        <div class="tz-actions"><span class="tz-small tz-mut">${isDirtyFor(st) ? 'Cambios sin guardar' : 'Sin cambios'}${sel?.updatedAtMs ? ` · último guardado ${esc(fmtWhen(sel.updatedAtMs))}` : ''}</span>
            <span class="tz-sp"></span>
            <button type="button" class="tz-btn ghost" data-tz="cancel">Cancelar</button>
            <button type="button" class="tz-btn pri" data-tz="save" ${st.saving || !isDirtyFor(st) ? 'disabled' : ''}>${st.saving ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </div>` : `<div class="tz-card tz-mut">Elige una zona para editarla o crea una nueva.</div>`;
    const mapTools = f ? `<div class="tz-maptools">
        <button type="button" class="tz-btn dark sm" data-tz="poly-text">${st.polyText ? 'Ver mapa' : 'Editar puntos'}</button>
        <button type="button" class="tz-btn ghost sm" data-tz="poly-add">+ Agregar punto</button>
        <button type="button" class="tz-btn ghost sm" data-tz="poly-undo">Deshacer</button>
        <span class="tz-small tz-mut">${st.mapMode === 'google' ? 'Arrastra los puntos blancos · clic en el borde para agregar · clic derecho en un punto para quitarlo' : 'Escribe «lat, lng» por línea o usa «Agregar punto»'}</span>
    </div>` : '';
    const mapInner = f && st.polyText
        ? `<textarea class="tz-inp tz-polytext" data-tz-field="polyText" rows="10" spellcheck="false">${esc(polygonToText(f.polygon))}</textarea>`
        : `<div class="tz-map" id="tz-map">${st.mapMode === 'google' ? '' : zonesSvg(zonesForMap(st), { width: 720, height: 380, selectedId: f ? (f.zoneId || '__new') : null, handles: !!f })}</div>`;
    const hist = st.history.filter((h) => !h.cityId || h.cityId === st.city).slice(0, 40);
    const histHtml = `<div class="tz-card">
        <div class="tz-sec"><h3>Historial de cambios</h3><span class="tz-small tz-mut">Quién, cuándo, antes → después · no se puede borrar</span></div>
        <div class="tz-tablewrap"><table class="tz-table"><thead><tr><th>Cuándo</th><th>Quién</th><th>Zona / tienda</th><th>Cambio</th><th>Antes</th><th>Después</th></tr></thead><tbody>
        ${hist.length ? hist.flatMap((h) => {
            const ch = Array.isArray(h.changes) && h.changes.length ? h.changes : [{ field: h.action, before: null, after: null }];
            return ch.map((c, k) => {
                const isFee = String(c.field || '').startsWith('fee:');
                const label = isFee ? `Tarifa · ${c.field.slice(4)}` : (h.action === 'create' && k === 0 ? 'Creada' : h.action === 'seed' ? 'Propuesta' : CHANGE_LABELS[c.field] || c.field);
                const v = (x) => (isFee ? (x === 'base' ? 'tarifa base' : money(x)) : changeValueText(c.field, x));
                const role = h.byRole === 'admin' ? '<span class="tz-tag dark">Admin</span>' : h.byRole === 'owner' ? '<span class="tz-tag cy">Tienda</span>' : '<span class="tz-tag blue">Supervisor</span>';
                return `<tr><td>${esc(fmtWhen(h.atMs))}</td><td><b>${esc(h.byName || '—')}</b> ${role}</td><td>${esc(h.zoneName || h.storeName || (h.type === 'settings' ? 'Ciudad' : '—'))}</td><td>${esc(label)}</td><td class="tz-old">${esc(v(c.before))}</td><td class="tz-new">${esc(v(c.after))}</td></tr>`;
            });
        }).join('') : '<tr><td colspan="6" class="tz-mut">Sin cambios todavía.</td></tr>'}
        </tbody></table></div></div>`;
    return `<div class="tz-root">
        ${st.msg ? `<div class="tz-msg">${esc(st.msg)}</div>` : ''}
        ${banner}
        <div class="tz-cols">
            <div class="tz-left">
                <div class="tz-row"><label class="tz-sel">Ciudad: <select data-tz-change="city">${cities.map((c) => `<option value="${esc(c.id)}" ${c.id === st.city ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
                    <span class="tz-sp"></span><button type="button" class="tz-btn pri sm" data-tz="new">+ Nueva zona</button></div>
                ${st.loading ? '<div class="tz-card tz-mut">Cargando zonas…</div>' : listHtml}
                ${behaviorHtml}
            </div>
            <div class="tz-right">
                <div class="tz-card tz-mapcard">${mapTools}${mapInner}</div>
                ${formHtml}
            </div>
        </div>
        ${histHtml}
    </div>`;
}
function isDirtyFor(st) { return !!st.form && JSON.stringify(st.form) !== JSON.stringify(st.saved); }
function zonesForMap(st) {
    const zs = st.zones.filter((z) => z.cityId === st.city && z.id !== st.form?.zoneId);
    if (st.form) zs.push({ ...st.form, id: st.form.zoneId || '__new', name: st.form.name || 'Nueva zona', baseFee: numOrNull(st.form.baseFee) ?? 0 });
    return zs;
}

// ───────── Google Maps ─────────
const G = { map: null, polys: [], edit: null, cityKey: '' };
function googleReady() { return !!(window.google && window.google.maps && window.google.maps.Map && window.google.maps.Polygon); }
function drawGoogle() {
    const el = M?.root?.querySelector('#tz-map');
    if (!el || S.polyText) return;
    const gm = window.google.maps;
    const city = cityById(S.city);
    const center = S.form?.polygon?.[0] || city.center || { lat: 14.4598, lng: -87.6378 };
    if (!G.map || G.map.getDiv() !== el) {
        G.map = new gm.Map(el, { center, zoom: 14, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false, gestureHandling: 'greedy' });
        G.cityKey = '';
    }
    G.polys.forEach((p) => p.setMap(null)); G.polys = [];
    if (G.edit) { G.edit.setMap(null); G.edit = null; }
    const zs = S.zones.filter((z) => z.cityId === S.city && z.id !== S.form?.zoneId);
    zs.forEach((z, i) => {
        const col = zoneColor(z, i);
        const p = new gm.Polygon({ paths: z.polygon, strokeColor: col, strokeOpacity: z.active ? 0.9 : 0.6, strokeWeight: 2, fillColor: col, fillOpacity: 0.1, clickable: true, map: G.map });
        p.addListener('click', () => selectZone(z.id));
        G.polys.push(p);
    });
    const bounds = new gm.LatLngBounds();
    if (S.form && S.form.polygon.length) {
        const col = zoneColor(S.form, 0);
        G.edit = new gm.Polygon({ paths: S.form.polygon, editable: true, draggable: false, strokeColor: col, strokeWeight: 3, fillColor: col, fillOpacity: 0.25, map: G.map, zIndex: 10 });
        const path = G.edit.getPath();
        const sync = () => {
            S.form.polygon = path.getArray().map((ll) => ({ lat: Math.round(ll.lat() * 1e6) / 1e6, lng: Math.round(ll.lng() * 1e6) / 1e6 }));
            renderFormOnly();
        };
        ['set_at', 'insert_at', 'remove_at'].forEach((ev) => path.addListener(ev, sync));
        G.edit.addListener('contextmenu', (e) => { if (e.vertex != null && path.getLength() > 3) path.removeAt(e.vertex); });
        S.form.polygon.forEach((p) => bounds.extend(p));
    } else zs.forEach((z) => z.polygon.forEach((p) => bounds.extend(p)));
    const key = `${S.city}|${S.form?.zoneId || ''}`;
    if (key !== G.cityKey && !bounds.isEmpty()) { G.map.fitBounds(bounds, 30); G.cityKey = key; }
}

// ───────── render / eventos ─────────
function render() {
    if (!M?.root) return;
    if (!M.root.isConnected) { unmount(); return; }
    if (googleReady() && !S.polyText) S.mapMode = 'google';
    // Conservar el mapa de Google entre renders (si no, parpadea y pierde el zoom)
    const mapEl = M.root.querySelector('#tz-map');
    const keepMap = S.mapMode === 'google' && mapEl && G.map && G.map.getDiv() === mapEl && !S.polyText;
    if (keepMap) mapEl.remove();
    M.root.innerHTML = viewHtml(S);
    if (keepMap) {
        const slot = M.root.querySelector('#tz-map');
        if (slot) slot.replaceWith(mapEl);
    }
    if (S.mapMode === 'google' && !S.polyText) { try { drawGoogle(); } catch (e) { console.warn('[zonas] mapa', e); S.mapMode = 'svg'; } }
}
function renderFormOnly() {
    // Al arrastrar puntos solo cambia el texto de «Forma» y el estado de guardar.
    const form = M?.root?.querySelector('.tz-form');
    if (!form) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = viewHtml(S);
    const nf = tmp.querySelector('.tz-form');
    if (nf) form.replaceWith(nf);
}
function selectZone(id) {
    if (isDirty() && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    const z = S.zones.find((x) => x.id === id);
    S.selId = id; S.form = formFromZone(z); S.saved = JSON.parse(JSON.stringify(S.form)); S.errors = {}; S.polyText = false;
    render();
}
function newZone() {
    if (isDirty() && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    const c = cityById(S.city);
    let center = c.center || { lat: 14.4598, lng: -87.6378 };
    try { if (G.map && S.mapMode === 'google') { const ll = G.map.getCenter(); center = { lat: ll.lat(), lng: ll.lng() }; } } catch (_) {}
    S.selId = null; S.form = formFromZone(null);
    S.form.polygon = squareAround(center.lat, center.lng).map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 }));
    S.saved = { ...formFromZone(null), polygon: [] }; S.errors = {};
    render();
}
async function save() {
    const f = S.form; if (!f) return;
    S.errors = validateZoneForm(f);
    if (Object.keys(S.errors).length) { render(); return; }
    const before = S.zones.find((z) => z.id === f.zoneId);
    if (f.active && before && !before.active && !confirm(`¿Activar «${f.name}»? Los pedidos nuevos dentro de esta zona pagarán ${money(f.baseFee)} (o la tarifa de la tienda).`)) return;
    S.saving = true; render();
    try {
        const res = await callFn('staffUpsertDeliveryZone', {
            zoneId: f.zoneId || undefined, name: f.name.trim(), cityId: f.cityId, cityName: cityById(f.cityId).name,
            baseFee: numOrNull(f.baseFee), minFee: numOrNull(f.minFee), maxFee: numOrNull(f.maxFee),
            priority: Number(f.priority), note: f.note, active: !!f.active, polygon: f.polygon,
        });
        S.selId = res?.zoneId || f.zoneId; S.form.zoneId = S.selId; S.saved = JSON.parse(JSON.stringify(S.form));
        if (f.cityId !== S.city) S.city = f.cityId;
        toast(res?.changed === false ? 'Sin cambios' : 'Zona guardada', 'success');
    } catch (e) { toast(errMsg(e), 'error'); }
    S.saving = false; render();
}
async function setOutside(behavior) {
    const cur = S.settings[S.city]?.outsideBehavior || 'distance';
    if (behavior === cur) return;
    if (behavior === 'block' && !confirm('Los clientes con dirección fuera de todas las zonas no podrán pedir. ¿Seguro?')) { render(); return; }
    try { await callFn('staffSetDeliveryOutsideBehavior', { cityId: S.city, behavior }); toast('Guardado', 'success'); }
    catch (e) { toast(errMsg(e), 'error'); render(); }
}
async function seed() {
    if (!confirm('Se crean 3 zonas INACTIVAS para Comayagua (céntrica L 40, fuera del centro L 100–120, periferia sugerida L 150). Revisa formas y montos antes de activarlas.')) return;
    try { const r = await callFn('staffSeedDeliveryZones', { cityId: S.city }); toast(`Propuesta cargada (${r?.created ?? 0} zonas, inactivas)`, 'success'); }
    catch (e) { toast(errMsg(e), 'error'); }
}
function onClick(e) {
    const b = e.target.closest('[data-tz]'); if (!b) return;
    const a = b.getAttribute('data-tz');
    if (a === 'select') return selectZone(b.getAttribute('data-id'));
    if (a === 'new') return newZone();
    if (a === 'save') return save();
    if (a === 'seed') return seed();
    if (a === 'cancel') { S.form = S.selId ? formFromZone(S.zones.find((z) => z.id === S.selId)) : null; S.saved = S.form ? JSON.parse(JSON.stringify(S.form)) : null; S.errors = {}; return render(); }
    if (a === 'poly-text') { S.polyText = !S.polyText; if (!S.polyText) G.map = null; return render(); }
    if (a === 'poly-add' && S.form) { S.form.polygon = addMidpoint(S.form.polygon); return render(); }
    if (a === 'poly-undo' && S.form) { S.form.polygon = (S.saved?.polygon?.length ? S.saved.polygon : S.form.polygon).map((p) => ({ ...p })); return render(); }
}
function onInput(e) {
    const el = e.target.closest('[data-tz-field]'); if (!el || !S.form) return;
    const k = el.getAttribute('data-tz-field');
    if (k === 'active') S.form.active = el.checked;
    else if (k === 'polyText') S.form.polygon = textToPolygon(el.value);
    else if (k === 'priority') S.form.priority = el.value === '' ? '' : Number(el.value);
    else S.form[k] = el.value;
    if (S.errors[k] || (k === 'polyText' && S.errors.polygon)) { S.errors = validateZoneForm(S.form); }
    if (k === 'active' || (e.type === 'change' && k === 'cityId')) render();
    else if (e.type === 'change' && Object.keys(S.errors).length) renderFormOnly();
    else {
        const st = M.root.querySelector('.tz-actions .tz-small');
        const sv = M.root.querySelector('[data-tz="save"]');
        if (st) st.textContent = isDirty() ? 'Cambios sin guardar' : 'Sin cambios';
        if (sv) sv.disabled = S.saving || !isDirty();
    }
}
function onChange(e) {
    const c = e.target.closest('[data-tz-change]');
    if (c) {
        const k = c.getAttribute('data-tz-change');
        if (k === 'city') { if (isDirty() && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) { c.value = S.city; return; } S.city = c.value; S.selId = null; S.form = null; S.saved = null; G.cityKey = ''; return render(); }
        if (k === 'outside') return setOutside(c.value);
    }
    onInput(e);
}

// ───────── montaje ─────────
function unmount() {
    if (!M) return;
    M.unsubs.forEach((u) => { try { u(); } catch (_) {} });
    G.polys.forEach((p) => p.setMap(null)); G.polys = []; if (G.edit) G.edit.setMap(null); G.edit = null; G.map = null;
    clearInterval(M.timer);
    M = null;
}
function subscribe() {
    const db = DEPS.db, app = DEPS.appId;
    const base = (c) => collection(db, 'artifacts', app, 'public', 'data', c);
    M.unsubs.push(onSnapshot(base('delivery_zones'), (snap) => {
        S.zones = snap.docs.map((d) => ({ id: d.id, ...d.data() })); S.loading = false;
        if (S.selId && !isDirty()) { const z = S.zones.find((x) => x.id === S.selId); if (z) { S.form = formFromZone(z); S.saved = JSON.parse(JSON.stringify(S.form)); } }
        render();
    }, (e) => { S.loading = false; S.msg = errMsg(e); render(); }));
    M.unsubs.push(onSnapshot(base('delivery_zone_settings'), (snap) => {
        S.settings = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])); render();
    }, () => {}));
    M.unsubs.push(onSnapshot(query(base('delivery_zone_history'), orderBy('atMs', 'desc'), limit(80)), (snap) => {
        S.history = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render();
    }, (e) => console.warn('[zonas] historial', e)));
}
export function mountDeliveryZones(container) {
    ensureCss();
    unmount();
    container.innerHTML = '';
    const root = document.createElement('div');
    container.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    M = { root, unsubs: [], timer: setInterval(() => { if (!root.isConnected) unmount(); else if (S.mapMode === 'svg' && googleReady() && !S.polyText) render(); }, 1500) };
    try { if (DEPS.getCurrentCityId) S.city = DEPS.getCurrentCityId() || S.city; } catch (_) {}
    try { window.ensureMapsLoaded?.(); } catch (_) {}
    if (DEPS.db) S.loading = true;
    render();
    if (DEPS.db) subscribe();
}

export function initDeliveryZonesAdmin(deps = {}) {
    DEPS = { ...deps };
    const isStaff = () => { try { return !!DEPS.isStaffUser?.(DEPS.getCurrentUser?.(), DEPS.getUserProfile?.()); } catch (_) { return false; } };
    window.loadSupervisorDeliveryZones = () => {
        window.setSupervisorNavActive?.('delivery-zones');
        const c = document.getElementById('supervisor-pending-list');
        if (!c) return;
        if (!isStaff()) { c.innerHTML = '<div class="ops-empty">Solo admin o supervisor.</div>'; return; }
        window.stopSupervisorTripsListener?.();
        mountDeliveryZones(c);
    };
}

/** Arnés de capturas: sin Firebase, con datos de muestra. */
export function mountDeliveryZonesWithData(container, data = {}) {
    DEPS = { callFn: async () => ({ ok: true }) };
    Object.assign(S, { city: data.city || DEFAULT_CITY, zones: data.zones || [], settings: data.settings || {}, history: data.history || [], loading: false, msg: '' });
    mountDeliveryZones(container);
    if (data.selId) selectZone(data.selId);
    if (data.edit) { Object.assign(S.form, data.edit); render(); }
    return S;
}
export const __test = { viewHtml, formFromZone, S };
