/** Teléfonos E.164: Honduras (+504) o Estados Unidos (+1) según mercado / dígitos. */

import { isUsMarket } from './market.js';

function digitsOnly(raw) {
    return String(raw || '').replace(/\D/g, '');
}

function looksNanp(d) {
    return d.length === 10 && d[0] >= '2' && d[0] <= '9';
}

/** Normaliza a dígitos internacionales sin +. Compatible con el nombre histórico. */
export function normalizeHondurasPhone(raw) {
    if (!raw) return '';
    let d = digitsOnly(raw);
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);

    if (d.startsWith('504')) {
        const rest = d.slice(3).replace(/^0+/, '');
        if (rest.length >= 8) return '504' + rest.slice(0, 8);
        if (rest.length > 0) return '504' + rest.padStart(8, '0').slice(-8);
        return '';
    }

    if (d.startsWith('1') && d.length === 11 && d[1] >= '2') return d;
    if (looksNanp(d)) return '1' + d;

    if (d.startsWith('0')) d = d.slice(1);

    if (isUsMarket()) {
        if (d.length === 10 && d[0] >= '2') return '1' + d;
        if (d.length === 11 && d.startsWith('1')) return d;
        if (d.length > 10) {
            const last10 = d.slice(-10);
            if (last10[0] >= '2') return '1' + last10;
        }
        return d;
    }

    if (d.length === 8) return '504' + d;
    if (d.length === 11 && d.startsWith('504')) return d;
    if (d.length > 8) return '504' + d.slice(-8);
    if (d.length > 0) return '504' + d.padStart(8, '0').slice(-8);
    return '';
}

export function formatHondurasPhone(raw) {
    const norm = normalizeHondurasPhone(raw);
    if (!norm) return '';
    if (norm.startsWith('1') && norm.length === 11) {
        return `+1 (${norm.slice(1, 4)}) ${norm.slice(4, 7)}-${norm.slice(7)}`;
    }
    if (norm.startsWith('504') && norm.length === 11) {
        return '504 ' + norm.slice(3, 7) + '-' + norm.slice(7);
    }
    return norm;
}

export function getWhatsAppLink(rawPhone, message = '') {
    const norm = normalizeHondurasPhone(rawPhone);
    if (!norm) return 'https://wa.me/';
    const text = message != null ? String(message) : '';
    if (!text) return `https://wa.me/${norm}`;
    return `https://wa.me/${norm}?text=${encodeURIComponent(text)}`;
}
