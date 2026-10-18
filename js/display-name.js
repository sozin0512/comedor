/**
 * Nombre que se muestra de una persona. Quita caracteres invisibles (p. ej. el relleno coreano «ᅟ»
 * que algunos usan como nombre en blanco) y nombres de marcador como «HonduRaite» o «Pasajero de prueba».
 */
const INVISIBLE = /[\u115F\u1160\u3164\uFFA0\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD\u034F\u180E]/g;
const PLACEHOLDER = /^(honduraite|pasajero de prueba|conductor de prueba|test|prueba|usuario)$/i;

export function displayPersonName(name, fallback = 'Pasajero') {
    const clean = String(name ?? '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
    if (!clean || PLACEHOLDER.test(clean)) return fallback;
    return clean;
}

if (typeof window !== 'undefined') window.displayPersonName = displayPersonName;
