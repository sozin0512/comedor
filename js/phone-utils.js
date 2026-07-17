/** Helpers de teléfono Honduras (+504) — compartidos sin depender de app.js */

export function normalizeHondurasPhone(raw) {
    if (!raw) return '';
    let d = String(raw).replace(/\D/g, '');
    if (d.startsWith('504')) d = d.slice(3);
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === 8) return '504' + d;
    if (d.length === 11 && d.startsWith('504')) return d;
    if (d.length > 8) return '504' + d.slice(-8);
    if (d.length > 0) return '504' + d.padStart(8, '0').slice(-8);
    return '';
}

export function formatHondurasPhone(raw) {
    const norm = normalizeHondurasPhone(raw);
    if (!norm || norm.length !== 11) return norm || '';
    return '504 ' + norm.slice(3, 7) + '-' + norm.slice(7);
}

export function getWhatsAppLink(rawPhone, message = '') {
    const norm = normalizeHondurasPhone(rawPhone);
    if (!norm) return 'https://wa.me/';
    const text = message != null ? String(message) : '';
    if (!text) return `https://wa.me/${norm}`;
    // wa.me + encodeURIComponent: el chat del cliente recibe https://… como enlace azul tocable.
    // (api.whatsapp.com a veces deforma URLs largas con query params)
    return `https://wa.me/${norm}?text=${encodeURIComponent(text)}`;
}