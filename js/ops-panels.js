const ADMIN_TAB_META = {
    client: { label: 'Pasajeros', icon: 'fa-users', group: 'users' },
    driver: { label: 'Conductores', icon: 'fa-motorcycle', group: 'users' },
    supervisor: { label: 'Supervisores', icon: 'fa-user-shield', group: 'users' },
    trips: { label: 'Viajes activos', icon: 'fa-route', group: 'ops' },
    reports: { label: 'Reportes', icon: 'fa-flag', group: 'ops', alert: true },
    tickets: { label: 'Tickets', icon: 'fa-ticket-alt', group: 'ops' },
    notify: { label: 'Notificar', icon: 'fa-bell', group: 'ops' },
    recharges: { label: 'Recargas', icon: 'fa-coins', group: 'finance' },
    promotions: { label: 'Promociones', icon: 'fa-gift', group: 'finance' },
    bank: { label: 'Cuentas bancarias', icon: 'fa-university', group: 'finance' },
    stats: { label: 'Estadísticas', icon: 'fa-chart-line', group: 'system' },
    customization: { label: 'Personalizar', icon: 'fa-palette', group: 'system' },
    apk: { label: 'App Android', icon: 'fa-android', group: 'system' },
    testing: { label: 'Pruebas', icon: 'fa-vial', group: 'system' }
};

const SUP_TAB_META = {
    pending: { label: 'Verificaciones', icon: 'fa-hourglass-half', group: 'drivers' },
    active: { label: 'Activos', icon: 'fa-check-circle', group: 'drivers' },
    objectives: { label: 'Objetivos', icon: 'fa-bullseye', group: 'ops' },
    trips: { label: 'Viajes', icon: 'fa-route', group: 'ops' },
    reports: { label: 'Reportes', icon: 'fa-flag', group: 'ops' },
    tickets: { label: 'Tickets', icon: 'fa-ticket-alt', group: 'ops' },
    notify: { label: 'Notificar', icon: 'fa-bell', group: 'ops' },
    deposits: { label: 'Depósitos', icon: 'fa-piggy-bank', group: 'finance' },
    payouts: { label: 'Pagos', icon: 'fa-hand-holding-usd', group: 'finance' },
    promotions: { label: 'Promociones', icon: 'fa-gift', group: 'finance' }
};

export const OPS_LOADING_HTML = `
    <div class="ops-loading">
        <div class="ops-loading-ring"><i class="fas fa-spinner fa-spin"></i></div>
        <p class="ops-loading-text">Cargando datos…</p>
    </div>
`;

function closeMobileDrawers() {
    document.getElementById('admin-panel')?.classList.remove('ops-drawer-open');
    document.getElementById('supervisor-panel')?.classList.remove('ops-drawer-open');
}

export function setAdminNavActive(role) {
    const panel = document.getElementById('admin-panel');
    if (!panel) return;

    panel.querySelectorAll('.ops-nav-item[data-admin-tab]').forEach((btn) => {
        const isActive = btn.dataset.adminTab === role;
        btn.classList.toggle('ops-nav-item--active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    const meta = ADMIN_TAB_META[role] || { label: 'Panel', icon: 'fa-th-large' };
    const titleEl = document.getElementById('admin-ops-title');
    const crumbEl = document.getElementById('admin-ops-crumb');
    if (titleEl) titleEl.textContent = meta.label;
    if (crumbEl) crumbEl.textContent = meta.label;
}

export function setSupervisorNavActive(tabId) {
    const panel = document.getElementById('supervisor-panel');
    if (!panel) return;

    panel.querySelectorAll('.ops-nav-item[data-sup-tab]').forEach((btn) => {
        const isActive = btn.dataset.supTab === tabId;
        btn.classList.toggle('ops-nav-item--active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    panel.querySelectorAll('.ops-nav-item[data-sup-quick]').forEach((btn) => {
        btn.classList.remove('ops-nav-item--active');
        btn.setAttribute('aria-current', 'false');
    });

    const meta = SUP_TAB_META[tabId] || { label: 'Supervisión', icon: 'fa-shield-alt' };
    const titleEl = document.getElementById('supervisor-ops-title');
    const crumbEl = document.getElementById('supervisor-ops-crumb');
    if (titleEl) titleEl.textContent = meta.label;
    if (crumbEl) crumbEl.textContent = meta.label;
}

export function setSupervisorQuickActive(quickId) {
    const panel = document.getElementById('supervisor-panel');
    if (!panel) return;

    panel.querySelectorAll('.ops-nav-item[data-sup-tab]').forEach((btn) => {
        btn.classList.remove('ops-nav-item--active');
        btn.setAttribute('aria-current', 'false');
    });

    panel.querySelectorAll('.ops-nav-item[data-sup-quick]').forEach((btn) => {
        const isActive = btn.dataset.supQuick === quickId;
        btn.classList.toggle('ops-nav-item--active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    const labels = {
        clients: 'Pasajeros',
        drivers: 'Conductores',
        stats: 'Estadísticas',
        recharges: 'Recargas',
        notify: 'Notificar'
    };
    const label = labels[quickId] || 'Acceso rápido';
    const titleEl = document.getElementById('supervisor-ops-title');
    const crumbEl = document.getElementById('supervisor-ops-crumb');
    if (titleEl) titleEl.textContent = label;
    if (crumbEl) crumbEl.textContent = label;
}

function bindDrawer(panelId, toggleId, backdropId) {
    const panel = document.getElementById(panelId);
    const toggle = document.getElementById(toggleId);
    const backdrop = document.getElementById(backdropId);
    if (!panel || !toggle) return;

    toggle.addEventListener('click', () => {
        panel.classList.toggle('ops-drawer-open');
    });

    backdrop?.addEventListener('click', () => panel.classList.remove('ops-drawer-open'));

    panel.querySelectorAll('.ops-nav-item').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (window.matchMedia('(max-width: 900px)').matches) {
                panel.classList.remove('ops-drawer-open');
            }
        });
    });
}

export function initOpsPanels() {
    if (typeof window === 'undefined') return;

    window.setAdminNavActive = setAdminNavActive;
    window.setSupervisorNavActive = setSupervisorNavActive;
    window.setSupervisorQuickActive = setSupervisorQuickActive;
    window.OPS_LOADING_HTML = OPS_LOADING_HTML;

    bindDrawer('admin-panel', 'admin-ops-menu-btn', 'admin-ops-backdrop');
    bindDrawer('supervisor-panel', 'supervisor-ops-menu-btn', 'supervisor-ops-backdrop');

    document.getElementById('admin-ops-refresh')?.addEventListener('click', () => {
        if (typeof window.loadAdminUsers === 'function') window.loadAdminUsers();
        else if (window.currentAdminTab && typeof window.renderAdminTab === 'function') {
            window.renderAdminTab(window.currentAdminTab);
        }
    });

    document.getElementById('supervisor-ops-refresh')?.addEventListener('click', () => {
        const active = document.querySelector('#supervisor-panel .ops-nav-item--active[data-sup-tab]');
        if (active?.dataset?.supTab === 'pending') window.loadPendingDrivers?.();
        else if (active?.dataset?.supTab === 'active') {
            window._supActiveDriversCache = null;
            window.loadActiveDrivers?.(true);
        }
        else if (active?.dataset?.supTab === 'objectives') window.loadSupervisorObjectives?.();
        else if (active?.dataset?.supTab === 'reports') window.loadSupervisorReports?.();
        else if (active?.dataset?.supTab === 'tickets') window.loadAdminTickets?.();
        else if (active?.dataset?.supTab === 'deposits') window.loadSupervisorDeposits?.();
        else if (active?.dataset?.supTab === 'payouts') window.loadSupervisorDriverPayouts?.();
        else if (active?.dataset?.supTab === 'trips') window.loadSupervisorTrips?.();
        else window.loadPendingDrivers?.();
    });

    window.closeOpsMobileDrawers = closeMobileDrawers;
}