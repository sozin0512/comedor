/** Shell visual compartido: login + setups (misma apariencia) */

export const AUTH_ROLE_HINTS = {
    client: 'Pasajero: viajes, envíos, fletes o grúa. Eliges el servicio dentro de la app.',
    driver: 'Conductor: registra auto, moto, taxi, paila, camión o grúa. Cada vehículo recibe solo el tipo de solicitud que corresponde.',
};

export function getAuthHeroHtml({
    sub = '🇭🇳 Movilidad en Honduras',
    tagline = 'Hecho con orgullo catracho',
    welcomeId = null,
} = {}) {
    const welcome = welcomeId
        ? `<p id="${welcomeId}" class="login-welcome-msg hidden"></p>`
        : '';

    return `
        <div class="login-hero login-hero-compact flex-shrink-0 pt-4 pb-3 px-5 text-center">
            <div class="login-logo-wrap mx-auto">
                <div class="login-logo-glow" aria-hidden="true"></div>
                <div class="login-logo-box">
                    <img class="login-logo-img auth-hero-logo-img"
                         src=""
                         alt="HonduRaite"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="login-logo-fallback auth-hero-logo-fallback" style="display: none;">
                        <i class="fas fa-car-side"></i>
                    </div>
                </div>
            </div>
            <h1 class="login-brand-title">HonduRaite</h1>
            <p class="login-brand-sub">${sub}</p>
            <p class="login-brand-tagline">${tagline}</p>
            ${welcome}
        </div>
    `.trim();
}

function getLogoFallback(img) {
    if (img.nextElementSibling?.classList?.contains('auth-hero-logo-fallback')) {
        return img.nextElementSibling;
    }
    return img.closest('.login-logo-box, .driver-setup-bar-brand')?.querySelector('.auth-hero-logo-fallback') || null;
}

function revealAuthLogo(img, fallback) {
    img.classList.add('auth-logo-loaded');
    img.style.display = 'block';
    if (fallback) {
        fallback.style.display = 'none';
        fallback.classList.add('hidden');
    }
}

function hideAuthLogo(img, fallback) {
    img.classList.remove('auth-logo-loaded');
    img.style.display = 'none';
    if (fallback) {
        fallback.style.display = 'flex';
        fallback.classList.remove('hidden');
    }
}

export function syncAuthHeroLogos(customLogo, welcomeMessage, welcomeSelector) {
    document.querySelectorAll('.auth-hero-logo-img').forEach((img) => {
        const fallback = getLogoFallback(img);

        if (customLogo) {
            const showLogo = () => revealAuthLogo(img, fallback);
            const hideLogo = () => hideAuthLogo(img, fallback);

            img.onerror = hideLogo;
            if (img.src === customLogo && img.complete && img.naturalWidth > 0) {
                showLogo();
            } else {
                img.onload = showLogo;
                img.src = customLogo;
                showLogo();
            }
        } else if (!img.dataset.logoPending) {
            const defaultSrc = img.getAttribute('data-default-src');
            if (defaultSrc) {
                img.src = defaultSrc;
                revealAuthLogo(img, fallback);
            } else {
                img.removeAttribute('src');
                hideAuthLogo(img, fallback);
            }
        }
    });

    if (welcomeSelector && welcomeMessage) {
        const welcomeEl = document.querySelector(welcomeSelector);
        if (welcomeEl) {
            welcomeEl.textContent = welcomeMessage;
            welcomeEl.classList.remove('hidden');
        }
    } else if (welcomeSelector) {
        const welcomeEl = document.querySelector(welcomeSelector);
        if (welcomeEl) {
            welcomeEl.textContent = '';
            welcomeEl.classList.add('hidden');
        }
    }
}

export function getAuthCardShell({ title, subtitle, closeAction, bodyHtml, footerExtra = '' }) {
    return `
        <div class="login-card w-full max-w-md mx-auto px-5 pt-5 pb-8 rounded-t-[2.75rem] shadow-2xl">
            <div class="flex justify-between items-start mb-4 gap-2">
                <div class="min-w-0">
                    <h2 class="font-black text-lg text-gray-900 leading-tight">${title}</h2>
                    ${subtitle ? `<p class="text-[10px] font-bold uppercase tracking-widest mt-1 leading-snug">${subtitle}</p>` : ''}
                </div>
                ${closeAction ? `
                <button type="button" onclick="${closeAction}"
                        class="w-9 h-9 shrink-0 flex items-center justify-center text-2xl text-gray-400 hover:text-red-500"
                        title="Cerrar y volver al inicio">×</button>
                ` : ''}
            </div>
            <div class="auth-form-scroll space-y-4 pb-1">
                ${bodyHtml}
            </div>
            ${footerExtra}
            <div data-sozin-copyright="light" class="mt-4"></div>
        </div>
        <div data-sozin-copyright="on-gradient" class="flex-shrink-0 px-5 pb-6 pt-2"></div>
    `.trim();
}