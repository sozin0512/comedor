/** Componentes visuales para páginas Admin / Supervisión */

export function opsPage(bodyHtml) {
    return `<div class="ops-page">${bodyHtml}</div>`;
}

export function opsHero(title, subtitle = '', extraHtml = '') {
    return `
        <header class="ops-page-hero">
            <div class="ops-page-hero-text">
                <h2 class="ops-page-hero-title">${title}</h2>
                ${subtitle ? `<p class="ops-page-hero-sub">${subtitle}</p>` : ''}
            </div>
            ${extraHtml ? `<div class="ops-page-hero-extra">${extraHtml}</div>` : ''}
        </header>
    `;
}

export function opsKpi(value, label, variant = 'default') {
    return `
        <div class="ops-kpi ops-kpi--${variant}">
            <span class="ops-kpi-value">${value}</span>
            <span class="ops-kpi-label">${label}</span>
        </div>
    `;
}

export function opsKpiRow(items = []) {
    if (!items.length) return '';
    return `<div class="ops-kpi-row">${items.map((k) => opsKpi(k.value, k.label, k.variant || 'default')).join('')}</div>`;
}

export function opsBadge(text, variant = 'default') {
    return `<span class="ops-badge ops-badge--${variant}">${text}</span>`;
}

export function opsSection({ title, subtitle = '', icon = '', badge = '', variant = 'default', body = '', collapsible = false, open = true }) {
    const count = badge !== '' && badge != null ? opsBadge(String(badge), variant) : '';
    const head = `
        <div class="ops-section-head">
            <div class="ops-section-title-wrap">
                ${icon ? `<span class="ops-section-icon"><i class="fas ${icon}"></i></span>` : ''}
                <div>
                    <h3 class="ops-section-title">${title}</h3>
                    ${subtitle ? `<p class="ops-section-sub">${subtitle}</p>` : ''}
                </div>
            </div>
            ${count}
        </div>
    `;

    if (collapsible) {
        return `
            <details class="ops-section ops-section--${variant}" ${open ? 'open' : ''}>
                <summary class="ops-section-summary">${head}</summary>
                <div class="ops-section-body">${body}</div>
            </details>
        `;
    }

    return `
        <section class="ops-section ops-section--${variant}">
            ${head}
            <div class="ops-section-body">${body}</div>
        </section>
    `;
}

export function opsToolbar({ searchHtml = '', chipsHtml = '', hint = '', sticky = true } = {}) {
    return `
        <div class="ops-toolbar${sticky ? ' ops-toolbar--sticky' : ''}">
            ${searchHtml ? `<div class="ops-toolbar-search">${searchHtml}</div>` : ''}
            ${chipsHtml ? `<div class="ops-chipbar">${chipsHtml}</div>` : ''}
            ${hint ? `<p class="ops-toolbar-hint">${hint}</p>` : ''}
        </div>
    `;
}

export function opsChip(label, onclick, { active = false, variant = 'default' } = {}) {
    const cls = `ops-chip ops-chip--${variant}${active ? ' ops-chip--active' : ''}`;
    return `<button type="button" class="${cls}" onclick="${onclick}">${label}</button>`;
}

export function opsEmpty(icon, title, subtitle = '') {
    return `
        <div class="ops-empty">
            <div class="ops-empty-icon"><i class="fas ${icon}"></i></div>
            <p class="ops-empty-title">${title}</p>
            ${subtitle ? `<p class="ops-empty-sub">${subtitle}</p>` : ''}
        </div>
    `;
}

export function opsCard(bodyHtml, variant = 'default', { extraClass = '', attrs = '' } = {}) {
    const cls = `ops-card ops-card--${variant}${extraClass ? ` ${extraClass}` : ''}`;
    const attrStr = attrs ? ` ${attrs}` : '';
    return `<article class="${cls}"${attrStr}>${bodyHtml}</article>`;
}

export function opsFormPanel(title, subtitle, bodyHtml) {
    return `
        <div class="ops-form-panel">
            <div class="ops-form-panel-head">
                <h3 class="ops-form-panel-title">${title}</h3>
                ${subtitle ? `<p class="ops-form-panel-sub">${subtitle}</p>` : ''}
            </div>
            <div class="ops-form-panel-body">${bodyHtml}</div>
        </div>
    `;
}

export function opsFieldLabel(text) {
    return `<label class="ops-field-label">${text}</label>`;
}

export function opsInput(attrs = 'class="ops-input"') {
    return attrs.includes('class=') ? attrs : `class="ops-input" ${attrs}`;
}

export function opsBtn(label, onclick, { variant = 'primary', icon = '', full = false } = {}) {
    const iconHtml = icon ? `<i class="fas ${icon}"></i>` : '';
    return `<button type="button" class="ops-btn ops-btn--${variant}${full ? ' ops-btn--full' : ''}" onclick="${onclick}">${iconHtml}<span>${label}</span></button>`;
}

export function opsTripToolbar(activeCount, pastCount, activeOnclick, pastOnclick) {
    return `
        <div class="ops-trip-toolbar">
            ${opsChip(`Activos (${activeCount})`, activeOnclick, { active: true, variant: 'purple' })}
            ${opsChip(`Pasados + facturas (${pastCount})`, pastOnclick, { variant: 'muted' })}
            <button type="button" class="ops-chip ops-chip--emerald ops-chip--active" data-staff-create-client-trip
                title="Armar viaje para un pasajero y notificarle">
                <i class="fas fa-user-plus"></i> Pedir viaje por cliente
            </button>
        </div>
    `;
}

export function opsUserListOpen() {
    return '<div class="ops-user-list">';
}

export function opsUserListClose() {
    return '</div>';
}

export function initOpsUi() {
    if (typeof window === 'undefined') return;
    window.OpsUi = {
        page: opsPage,
        hero: opsHero,
        kpi: opsKpi,
        kpiRow: opsKpiRow,
        badge: opsBadge,
        section: opsSection,
        toolbar: opsToolbar,
        chip: opsChip,
        empty: opsEmpty,
        card: opsCard,
        formPanel: opsFormPanel,
        fieldLabel: opsFieldLabel,
        btn: opsBtn,
        tripToolbar: opsTripToolbar,
        userListOpen: opsUserListOpen,
        userListClose: opsUserListClose
    };
}