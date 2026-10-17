/**
 * Zonas de envío · utilidades puras para el navegador (sin Firebase).
 * La tarifa que vale es SIEMPRE la del servidor (functions/delivery-zones.js);
 * aquí solo se valida para avisar antes de guardar y se dibuja el mapa de respaldo.
 */
export const MAX_FEE = 2000;
export const ZONE_COLORS = ['#2563EB', '#0891B2', '#C2410C', '#7C3AED', '#059669', '#DB2777', '#CA8A04'];

export function zoneColor(z, i = 0) {
    const p = Number(z?.priority);
    const k = Number.isFinite(p) && p > 0 ? p - 1 : i;
    return ZONE_COLORS[Math.abs(k) % ZONE_COLORS.length];
}

export function money(n, d = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 'L —';
    return 'L ' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
}

export function pointInPolygon(lat, lng, poly) {
    if (!Array.isArray(poly) || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i].lat, xi = poly[i].lng, yj = poly[j].lat, xj = poly[j].lng;
        if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
}

export function polygonAreaKm2(poly) {
    if (!Array.isArray(poly) || poly.length < 3) return 0;
    const lat0 = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
    const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.574;
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += (poly[j].lng * kx) * (poly[i].lat * ky) - (poly[i].lng * kx) * (poly[j].lat * ky);
    }
    return Math.round(Math.abs(a / 2) * 1000) / 1000;
}

/** Misma regla que el servidor: activas de la ciudad, menor prioridad gana, luego la más chica. */
export function findZoneForPoint(zones, lat, lng, cityId = null) {
    const c = (zones || []).filter((z) => z && z.active && (!cityId || z.cityId === cityId) && pointInPolygon(lat, lng, z.polygon));
    c.sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99) || polygonAreaKm2(a.polygon) - polygonAreaKm2(b.polygon));
    return c[0] || null;
}

export function rangeLabel(z) {
    const mn = z?.minFee, mx = z?.maxFee;
    if (mn == null && mx == null) return 'sin límite';
    if (mn != null && mx != null) return `permitido ${money(mn)}–${money(mx).replace('L ', '')}`;
    return mn != null ? `mínimo ${money(mn)}` : `máximo ${money(mx)}`;
}

/** Mismo texto que el servidor (validateStoreFee). null = válido. */
export function validateStoreFee(zone, mode, fee) {
    if (mode !== 'custom') return null;
    const n = Number(fee);
    if (fee === '' || fee == null || !Number.isFinite(n) || n < 0 || n > MAX_FEE) return `Escribe un monto entre L 0 y L ${MAX_FEE}.`;
    const mn = zone?.minFee, mx = zone?.maxFee;
    if (mn != null && mx != null && (n < mn || n > mx)) return `Debe estar entre L ${mn} y L ${mx}.`;
    if (mn != null && n < mn) return `No puede ser menos de L ${mn}.`;
    if (mx != null && n > mx) return `No puede ser más de L ${mx}.`;
    return null;
}

/** Lo que vería el cliente con la tarifa elegida (si la propia no vale, se cobra la base). */
export function effectiveFee(zone, setting) {
    if (setting?.mode === 'custom' && !validateStoreFee(zone, 'custom', setting.fee)) {
        return { fee: Number(setting.fee), source: 'store_custom' };
    }
    return { fee: Number(zone?.baseFee) || 0, source: 'zone_base' };
}

/** Validación del formulario de zona (espejo de validateZoneInput del servidor). */
export function validateZoneForm(f) {
    const e = {};
    const name = String(f?.name || '').trim();
    if (name.length < 2 || name.length > 60) e.name = 'Nombre de 2 a 60 letras.';
    if (!/^[a-z0-9-]{2,40}$/.test(String(f?.cityId || ''))) e.cityId = 'Elige la ciudad.';
    const base = numOrNull(f?.baseFee), mn = numOrNull(f?.minFee), mx = numOrNull(f?.maxFee);
    if (base == null || Number.isNaN(base) || base < 0 || base > MAX_FEE) e.baseFee = `Tarifa entre L 0 y L ${MAX_FEE}.`;
    if (Number.isNaN(mn) || (mn != null && (mn < 0 || mn > MAX_FEE))) e.minFee = 'Mínimo inválido.';
    if (Number.isNaN(mx) || (mx != null && (mx < 0 || mx > MAX_FEE))) e.maxFee = 'Máximo inválido.';
    if (!e.baseFee && !e.minFee && mn != null && mn > base) e.minFee = 'El mínimo no puede ser mayor que la tarifa base.';
    if (!e.baseFee && !e.maxFee && mx != null && mx < base) e.maxFee = 'El máximo no puede ser menor que la tarifa base.';
    const pr = Number(f?.priority);
    if (!Number.isInteger(pr) || pr < 1 || pr > 99) e.priority = 'Prioridad de 1 a 99.';
    const poly = Array.isArray(f?.polygon) ? f.polygon : [];
    if (poly.length < 3) e.polygon = 'Dibuja al menos 3 puntos.';
    else if (poly.length > 80) e.polygon = 'Máximo 80 puntos.';
    else if (poly.some((p) => !Number.isFinite(Number(p?.lat)) || !Number.isFinite(Number(p?.lng)) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)) e.polygon = 'Hay un punto inválido.';
    return e;
}

/** «lat, lng» por línea ⇄ polígono (editor sin Google Maps). */
export function polygonToText(poly) {
    return (poly || []).map((p) => `${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}`).join('\n');
}
export function textToPolygon(text) {
    return String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [a, b] = l.split(/[,;\s]+/).filter(Boolean).map(Number);
        return { lat: a, lng: b };
    });
}

/** Cuadro inicial alrededor de un centro (nueva zona). d en grados (~0.006 ≈ 650 m). */
export function squareAround(lat, lng, d = 0.006) {
    return [
        { lat: lat + d, lng: lng - d }, { lat: lat + d, lng: lng + d },
        { lat: lat - d, lng: lng + d }, { lat: lat - d, lng: lng - d },
    ];
}

/** Inserta un punto a la mitad del lado más largo (botón «Agregar punto» sin mapa). */
export function addMidpoint(poly) {
    if (!Array.isArray(poly) || poly.length < 2) return poly || [];
    let best = 0, bd = -1;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const d = (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
        if (d > bd) { bd = d; best = i; }
    }
    const a = poly[best], b = poly[(best + 1) % poly.length];
    const out = poly.slice();
    out.splice(best + 1, 0, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
    return out;
}

/**
 * Mapa de respaldo (SVG) con los polígonos reales proyectados. Se usa cuando Google Maps
 * no carga (y en las capturas): no es un mapa de calles, solo las formas a escala.
 */
export function zonesSvg(zones, { width = 640, height = 360, selectedId = null, handles = false, pin = null } = {}) {
    const all = (zones || []).filter((z) => Array.isArray(z.polygon) && z.polygon.length >= 3);
    const pts = all.flatMap((z) => z.polygon);
    if (pin) pts.push(pin);
    if (!pts.length) return `<svg viewBox="0 0 ${width} ${height}" class="tz-svg"><rect width="100%" height="100%" fill="#EEF2F7"/><text x="50%" y="50%" text-anchor="middle" font-size="13" fill="#64748B">Sin zonas dibujadas</text></svg>`;
    let mnLat = Math.min(...pts.map((p) => p.lat)), mxLat = Math.max(...pts.map((p) => p.lat));
    let mnLng = Math.min(...pts.map((p) => p.lng)), mxLng = Math.max(...pts.map((p) => p.lng));
    const kx = Math.cos(((mnLat + mxLat) / 2) * Math.PI / 180);
    const spanX = Math.max((mxLng - mnLng) * kx, 1e-4), spanY = Math.max(mxLat - mnLat, 1e-4);
    const pad = 22;
    const s = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
    const ox = (width - spanX * s) / 2, oy = (height - spanY * s) / 2;
    const X = (p) => (ox + (p.lng - mnLng) * kx * s).toFixed(1);
    const Y = (p) => (oy + (mxLat - p.lat) * s).toFixed(1);
    const order = all.slice().sort((a, b) => polygonAreaKm2(b.polygon) - polygonAreaKm2(a.polygon));
    let grid = '';
    for (let i = 1; i < 12; i++) grid += `<line x1="${(width / 12) * i}" y1="0" x2="${(width / 12) * i}" y2="${height}" stroke="#fff" stroke-width="2"/>`;
    for (let i = 1; i < 8; i++) grid += `<line x1="0" y1="${(height / 8) * i}" x2="${width}" y2="${(height / 8) * i}" stroke="#fff" stroke-width="2"/>`;
    const polys = order.map((z, i) => {
        const col = zoneColor(z, i);
        const on = z.id === selectedId;
        const d = z.polygon.map((p) => `${X(p)},${Y(p)}`).join(' ');
        const dash = z.active ? '' : 'stroke-dasharray="7 5"';
        const hd = on && handles ? z.polygon.map((p) => `<circle cx="${X(p)}" cy="${Y(p)}" r="5" fill="#fff" stroke="${col}" stroke-width="2.5"/>`).join('') : '';
        return `<polygon points="${d}" fill="${col}" fill-opacity="${on ? 0.28 : 0.12}" stroke="${col}" stroke-width="${on ? 3 : 2}" ${dash}/>${hd}`;
    }).join('');
    const labels = order.map((z, i) => {
        const col = zoneColor(z, i);
        const top = z.polygon.reduce((a, p) => (p.lat > a.lat ? p : a), z.polygon[0]);
        const cx = z.polygon.reduce((a, p) => a + Number(X(p)), 0) / z.polygon.length;
        const label = `${z.name || 'Zona'} · ${money(z.baseFee)}`;
        const w = label.length * 6.4 + 16;
        const y = Math.max(14, Number(Y(top)) + 2);
        const x = Math.min(Math.max(cx, w / 2 + 4), width - w / 2 - 4);
        return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="${(-w / 2).toFixed(1)}" y="-10" width="${w.toFixed(1)}" height="20" rx="10" fill="#fff" stroke="${col}" stroke-width="1.2"/><text text-anchor="middle" y="4" font-size="11" font-weight="700" fill="${col}" font-family="Inter,system-ui,sans-serif">${esc(label)}</text></g>`;
    }).join('');
    const pinSvg = pin ? `<g transform="translate(${X(pin)},${Y(pin)})"><circle r="16" fill="rgba(37,99,235,.18)"/><path d="M0 0c-8-9-11-13-11-18a11 11 0 0 1 22 0c0 5-3 9-11 18z" fill="#2563EB" stroke="#fff" stroke-width="2"/><circle cy="-18" r="4" fill="#fff"/></g>` : '';
    return `<svg viewBox="0 0 ${width} ${height}" class="tz-svg" role="img" aria-label="Zonas de envío"><rect width="100%" height="100%" fill="#EEF2F7"/>${grid}${polys}${labels}${pinSvg}<text x="${width - 8}" y="${height - 8}" text-anchor="end" font-size="10" fill="#64748B">Formas a escala · sin calles (Google Maps no cargó)</text></svg>`;
}

export const CHANGE_LABELS = {
    name: 'Nombre', cityId: 'Ciudad', baseFee: 'Tarifa base', minFee: 'Mínimo', maxFee: 'Máximo',
    priority: 'Prioridad', polygon: 'Forma', active: 'Activa', note: 'Nota', outsideBehavior: 'Fuera de zonas',
};

/** Texto corto para la columna «antes / después» del historial. */
export function changeValueText(field, v) {
    if (v == null || v === '') return '—';
    if (field === 'polygon') return Array.isArray(v) ? `${v.length} puntos` : (typeof v === 'number' ? `${v} puntos` : String(v));
    if (field === 'active') return v ? 'activa' : 'inactiva';
    if (field === 'outsideBehavior') return v === 'block' ? 'no permitir' : 'por distancia';
    if (['baseFee', 'minFee', 'maxFee', 'fee'].includes(field)) return money(v);
    if (typeof v === 'object') {
        if (v.mode === 'base') return 'tarifa base';
        if (v.mode === 'custom') return money(v.fee);
        return JSON.stringify(v);
    }
    return String(v);
}
