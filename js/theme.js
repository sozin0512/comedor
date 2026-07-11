const STORAGE_KEY = 'honduber-theme';

export function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function updateThemeToggleUI(theme) {
    const isDark = theme === 'dark';
    document.querySelectorAll('[data-theme-icon]').forEach((icon) => {
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    });
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
        btn.title = isDark ? 'Cambiar a modo día' : 'Cambiar a modo noche';
        btn.setAttribute('aria-label', btn.title);
    });
    const profileLabel = document.getElementById('profile-theme-label');
    if (profileLabel) {
        profileLabel.textContent = isDark ? 'Modo día (claro)' : 'Modo noche (oscuro)';
    }
}

export function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch (_) {}

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'dark' ? '#0f172a' : '#2563eb';

    updateThemeToggleUI(next);
    return next;
}

export function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    window.showToast?.(
        next === 'dark' ? 'Modo noche activado' : 'Modo día activado',
        'success'
    );
    return next;
}

export function initTheme() {
    let stored = 'light';
    try {
        stored = localStorage.getItem(STORAGE_KEY) || 'light';
    } catch (_) {}
    return applyTheme(stored);
}