/**
 * Formato único de lempiras en la app: «L. 1,234.00» (prefijo «L.», 2 decimales, coma de miles).
 * Antes se mezclaban «L. 174.2», «L. 83» y «L 83.00» (QA 2026-10-18).
 * Si el valor no es un número (p. ej. ya viene como texto «L. 150»), se deja como estaba.
 */
export function formatLempiras(value, { decimals = 2, prefix = 'L.' } = {}) {
    if (value === null || value === undefined || value === '') return `${prefix} ${(0).toFixed(decimals)}`;
    const raw = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        const s = String(value).trim();
        return /^L\.?\s/i.test(s) ? s : `${prefix} ${s}`;
    }
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `${n < 0 ? '-' : ''}${prefix} ${abs}`;
}

if (typeof window !== 'undefined') window.formatLempiras = formatLempiras;
