/** Propiedad legal — Empresa SOZIN */
export const SOZIN_OWNER = 'Empresa SOZIN';
export const SOZIN_YEAR = 2026;
export const SOZIN_COPYRIGHT_LINE = `© ${SOZIN_YEAR} ${SOZIN_OWNER}. Todos los derechos reservados.`;
export const SOZIN_OWNERSHIP_LINE = `HonduRaite es propiedad de ${SOZIN_OWNER}.`;

const VARIANTS = {
    light: {
        ownerClass: 'text-gray-700',
        textClass: 'text-gray-500',
        appClass: 'text-gray-400',
    },
    compact: {
        ownerClass: 'text-gray-600',
        textClass: 'text-gray-400',
        appClass: 'text-gray-400',
        compact: true,
    },
    dark: {
        ownerClass: 'text-white/95',
        textClass: 'text-blue-100/85',
        appClass: 'text-blue-100/70',
    },
    'on-gradient': {
        ownerClass: 'text-white/90',
        textClass: 'text-blue-100/80',
        appClass: 'text-slate-300/75',
    },
    'panel-dark': {
        ownerClass: 'text-slate-200',
        textClass: 'text-slate-400',
        appClass: 'text-slate-500',
    },
};

export function getSozinCopyrightHtml(variant = 'light') {
    const v = VARIANTS[variant] || VARIANTS.light;
    const compact = v.compact;

    if (compact) {
        return `
            <div class="sozin-copyright sozin-copyright--compact" role="contentinfo">
                <p class="sozin-copyright__line ${v.textClass}">
                    <span class="sozin-copyright__owner ${v.ownerClass}">${SOZIN_OWNER}</span>
                    <span aria-hidden="true"> · </span>
                    ${SOZIN_COPYRIGHT_LINE}
                </p>
            </div>
        `.trim();
    }

    return `
        <div class="sozin-copyright" role="contentinfo">
            <p class="sozin-copyright__owner ${v.ownerClass}">${SOZIN_OWNER}</p>
            <p class="sozin-copyright__text ${v.textClass}">${SOZIN_COPYRIGHT_LINE}</p>
            <p class="sozin-copyright__app ${v.appClass}">${SOZIN_OWNERSHIP_LINE}</p>
        </div>
    `.trim();
}

export function initSozinCopyright() {
    document.querySelectorAll('[data-sozin-copyright]').forEach((el) => {
        const variant = el.getAttribute('data-sozin-copyright') || 'light';
        el.innerHTML = getSozinCopyrightHtml(variant);
    });
}