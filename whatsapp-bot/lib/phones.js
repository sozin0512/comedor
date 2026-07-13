/** Normalización de teléfonos Honduras (+504) para WhatsApp */

export function normalizeHondurasPhone(raw) {
    if (!raw) return '';
    let d = String(raw).replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('504')) d = d.slice(3);
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === 8) return '504' + d;
    if (d.length === 11 && d.startsWith('504')) return d;
    if (d.length > 8) return '504' + d.slice(-8);
    if (d.length > 0) return '504' + d.padStart(8, '0').slice(-8);
    return '';
}

export function phoneToJid(phone) {
    const n = normalizeHondurasPhone(phone);
    if (!n) return null;
    return `${n}@s.whatsapp.net`;
}

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomBetween(min, max) {
    const a = Math.min(Number(min) || 0, Number(max) || 0);
    const b = Math.max(Number(min) || 0, Number(max) || 0);
    if (b <= a) return a;
    return a + Math.floor(Math.random() * (b - a + 1));
}

export function parseArgs(argv = process.argv.slice(2)) {
    const out = { _: [] };
    for (const raw of argv) {
        if (!raw.startsWith('--')) {
            out._.push(raw);
            continue;
        }
        const eq = raw.indexOf('=');
        if (eq === -1) {
            const key = raw.slice(2);
            out[key] = true;
            continue;
        }
        const key = raw.slice(2, eq);
        let val = raw.slice(eq + 1);
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (/^\d+$/.test(val)) val = Number(val);
        out[key] = val;
    }
    return out;
}

export function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export function renderMessage(template, { name = '', phone = '', role = '' } = {}) {
    const first = String(name || '').trim().split(/\s+/)[0] || 'amigo/a';
    return String(template || '')
        .replaceAll('{name}', first)
        .replaceAll('{fullName}', String(name || '').trim() || first)
        .replaceAll('{phone}', phone)
        .replaceAll('{role}', role)
        .trim();
}
