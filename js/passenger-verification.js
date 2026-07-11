/** Verificación de identidad para pasajeros — obligatoria antes de aprobación por staff. */

import { getAuthHeroHtml, getAuthCardShell } from './auth-ui.js';
import { pickPhotoFromCamera } from './camera-capture.js';
import { calculateAge } from './age-verification.js';

const BANNER_ID = 'passenger-verify-banner';
const VERIFY_PROMPT_DISMISSED_KEY = 'honduber_verify_prompt_dismissed';
/** “Más tarde” estilo Uber: no molestar por varios días */
const VERIFY_LATER_UNTIL_KEY = 'honduber_verify_later_until';
const VERIFY_LATER_MS = 7 * 24 * 60 * 60 * 1000;
export const ADULT_AGE = 18;

export function clearPassengerVerificationPromptDismissed() {
    try {
        sessionStorage.removeItem(VERIFY_PROMPT_DISMISSED_KEY);
        localStorage.removeItem(VERIFY_LATER_UNTIL_KEY);
    } catch (_) {}
}

export function isPassengerVerificationPromptDismissed() {
    try {
        if (sessionStorage.getItem(VERIFY_PROMPT_DISMISSED_KEY) === '1') return true;
        const until = Number(localStorage.getItem(VERIFY_LATER_UNTIL_KEY) || 0);
        return until > Date.now();
    } catch (_) {
        return false;
    }
}

function markVerifyLater({ days = 7 } = {}) {
    try {
        sessionStorage.setItem(VERIFY_PROMPT_DISMISSED_KEY, '1');
        const ms = (Number(days) || 7) * 24 * 60 * 60 * 1000 || VERIFY_LATER_MS;
        localStorage.setItem(VERIFY_LATER_UNTIL_KEY, String(Date.now() + ms));
    } catch (_) {}
}

export function isMinorProfile(profile) {
    const age = calculateAge(profile?.birthDate);
    return age != null && age < ADULT_AGE;
}

export function isPassengerVerified(profile) {
    if (!profile) return false;
    if (profile.approvalStatus === 'approved') return true;
    if (profile.verified === true && profile.approvalStatus !== 'pending') return true;
    return false;
}

export function hasSubmittedPassengerVerification(profile) {
    if (!profile) return false;
    const hasSelfie = !!(profile.verificationPhoto || profile.photo);
    if (!hasSelfie) return false;
    if (isMinorProfile(profile)) {
        return !!profile.birthCertificatePhoto;
    }
    return !!(profile.identityFrontPhoto && profile.identityBackPhoto);
}

export function canStaffApprovePassenger(profile) {
    if (!profile || profile.role === 'driver') return false;
    return profile.identityVerificationSubmitted === true && hasSubmittedPassengerVerification(profile);
}

export function needsPassengerVerificationCTA(profile) {
    if (!profile || profile.role === 'driver') return false;
    if (isPassengerVerified(profile)) return false;
    if (profile.accountRestricted || profile.approvalStatus === 'suspended') return false;
    if (profile.approvalStatus === 'rejected' || profile.resubmitRequested) return false;
    return !hasSubmittedPassengerVerification(profile);
}

export function isPassengerVerificationPendingReview(profile) {
    if (!profile || profile.role === 'driver') return false;
    if (isPassengerVerified(profile)) return false;
    return profile.approvalStatus === 'pending'
        && profile.identityVerificationSubmitted === true
        && hasSubmittedPassengerVerification(profile);
}

function removeVerificationBanner() {
    document.getElementById(BANNER_ID)?.remove();
}

export function syncPassengerVerificationBanner(profile) {
    const clientView = document.getElementById('client-view');
    if (!clientView || profile?.role === 'driver') {
        removeVerificationBanner();
        return;
    }

    removeVerificationBanner();

    const showCta = needsPassengerVerificationCTA(profile);
    const pendingReview = isPassengerVerificationPendingReview(profile);

    if (!showCta && !pendingReview) return;

    const banner = document.createElement('button');
    banner.type = 'button';
    banner.id = BANNER_ID;
    banner.className = 'passenger-verify-banner';

    if (showCta) {
        const minor = isMinorProfile(profile);
        banner.setAttribute('aria-label', 'Verificar mi cuenta (opcional)');
        banner.innerHTML = `
            <span class="passenger-verify-banner__glow" aria-hidden="true"></span>
            <span class="passenger-verify-banner__icon" aria-hidden="true"><i class="fas fa-id-card"></i></span>
            <span class="passenger-verify-banner__body">
                <span class="passenger-verify-banner__title">Verifícate cuando quieras</span>
                <span class="passenger-verify-banner__text">${minor
                    ? 'Ya puedes pedir viajes. Opcional: selfie + partida para más confianza con conductores.'
                    : 'Ya puedes pedir viajes. Opcional: selfie + ID para más confianza.'}</span>
            </span>
            <span class="passenger-verify-banner__cta" aria-hidden="true"><i class="fas fa-chevron-right"></i></span>
        `;
        banner.addEventListener('click', () => {
            window.showPassengerVerificationSetup?.({
                title: 'Verifica tu cuenta',
                subtitle: 'Opcional — puedes hacerlo ahora o más tarde',
            });
        });
    } else {
        banner.classList.add('passenger-verify-banner--review');
        banner.disabled = true;
        banner.setAttribute('aria-label', 'Verificación en revisión');
        banner.innerHTML = `
            <span class="passenger-verify-banner__icon passenger-verify-banner__icon--review" aria-hidden="true"><i class="fas fa-hourglass-half"></i></span>
            <span class="passenger-verify-banner__body">
                <span class="passenger-verify-banner__title">Verificación enviada</span>
                <span class="passenger-verify-banner__text">Sigue pidiendo viajes con normalidad. Revisamos tus documentos en breve.</span>
            </span>
        `;
    }

    clientView.prepend(banner);
}

function setPreviewImage(previewId, placeholderId, dataUrl) {
    const preview = document.getElementById(previewId);
    const placeholder = document.getElementById(placeholderId);
    if (preview) {
        preview.src = dataUrl;
        preview.classList.remove('hidden');
    }
    if (placeholder) placeholder.classList.add('hidden');
}

function bindVerificationPhotoPick(previewId, placeholderId, storageKey, facing, maxSize) {
    const wrap = document.getElementById(previewId)?.closest('[data-camera-pick]')
        || document.querySelector(`[data-camera-target="${previewId}"]`);
    const target = wrap || document.getElementById(previewId)?.parentElement;
    if (!target || target.dataset.pickBound === '1') return;
    target.dataset.pickBound = '1';
    target.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickPhotoFromCamera({
            facing,
            maxSize,
            onCapture: (dataUrl) => {
                window[storageKey] = dataUrl;
                setPreviewImage(previewId, placeholderId, dataUrl);
            },
            onError: (msg) => window.showToast?.(msg || 'No se pudo tomar la foto', 'warning'),
        });
    });
}

export function buildPassengerVerificationFormHtml({
    profile = null,
    includeIdentityField = true,
    submitLabel = 'ENVIAR PARA VERIFICACIÓN',
} = {}) {
    const p = profile || window.userProfile;
    const minor = isMinorProfile(p);
    const age = calculateAge(p?.birthDate);

    const identityField = includeIdentityField && !minor ? `
            <div>
                <label class="block text-[10px] font-bold text-gray-700 mb-1 ml-0.5">Número de identidad *</label>
                <input id="passenger-identity" type="text" class="w-full px-4 py-3 border border-gray-100 rounded-2xl text-sm bg-gray-50" placeholder="Ej: 0801-1990-12345" value="${p?.identity || ''}">
            </div>` : '';

    const minorNote = minor
        ? `<p class="text-[9px] text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded text-center"><i class="fas fa-child"></i> Cuenta de menor (${age ?? '?'} años): sube tu <b>partida de nacimiento</b> en lugar de identidad.</p>`
        : '';

    const idDocsBlock = minor ? `
            <div class="text-center">
                <p class="text-[9px] font-black text-gray-600 uppercase mb-1">Partida de nacimiento <span class="text-red-600">*</span></p>
                <div data-camera-target="passenger-birth-cert-preview" class="w-full max-w-[220px] mx-auto h-28 rounded-xl bg-gradient-to-br from-amber-100 to-white flex items-center justify-center cursor-pointer overflow-hidden border-2 border-amber-300 shadow-md active:scale-95 transition-all">
                    <img id="passenger-birth-cert-preview" class="w-full h-full object-cover hidden rounded-xl">
                    <div id="passenger-birth-cert-placeholder" class="text-center px-2">
                        <i class="fas fa-file-alt text-2xl text-amber-600"></i>
                        <p class="text-[8px] font-bold text-amber-700 mt-1">Toca para fotografiar la partida</p>
                    </div>
                </div>
            </div>`
        : `
            <div class="grid grid-cols-2 gap-3">
                <div class="text-center">
                    <p class="text-[9px] font-black text-gray-600 uppercase mb-1">ID - Anverso <span class="text-red-600">*</span></p>
                    <div data-camera-target="passenger-id-front-preview" class="w-20 h-20 mx-auto rounded-xl bg-gradient-to-br from-emerald-100 to-white flex items-center justify-center cursor-pointer overflow-hidden border-2 border-emerald-300 shadow-md active:scale-95 transition-all">
                        <img id="passenger-id-front-preview" class="w-full h-full object-cover hidden rounded-xl">
                        <div id="passenger-id-front-placeholder" class="text-center">
                            <i class="fas fa-id-card text-xl text-emerald-500"></i>
                        </div>
                    </div>
                </div>
                <div class="text-center">
                    <p class="text-[9px] font-black text-gray-600 uppercase mb-1">ID - Reverso <span class="text-red-600">*</span></p>
                    <div data-camera-target="passenger-id-back-preview" class="w-20 h-20 mx-auto rounded-xl bg-gradient-to-br from-emerald-100 to-white flex items-center justify-center cursor-pointer overflow-hidden border-2 border-emerald-300 shadow-md active:scale-95 transition-all">
                        <img id="passenger-id-back-preview" class="w-full h-full object-cover hidden rounded-xl">
                        <div id="passenger-id-back-placeholder" class="text-center">
                            <i class="fas fa-id-card text-xl text-emerald-500"></i>
                        </div>
                    </div>
                </div>
            </div>`;

    return `
        <p class="text-[10px] text-center text-gray-500 leading-snug">Esto es <b>opcional</b>. Mientras tanto ya puedes pedir viajes. La verificación ayuda a que los conductores confíen más en ti.</p>
        ${minorNote}
        <div class="space-y-3">
            <div class="text-center">
                <p class="text-[9px] font-black text-gray-600 uppercase mb-1">Foto de tu rostro <span class="text-red-600">*</span></p>
                <div data-camera-target="passenger-photo-preview" class="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-blue-100 to-white flex items-center justify-center cursor-pointer overflow-hidden border-2 border-blue-300 shadow-md active:scale-95 transition-all">
                    <img id="passenger-photo-preview" class="w-full h-full object-cover hidden rounded-full">
                    <div id="passenger-photo-placeholder" class="text-center">
                        <i class="fas fa-camera text-xl text-blue-400"></i>
                    </div>
                </div>
                <p class="text-[8px] text-blue-600 mt-1">Toca para abrir la cámara</p>
            </div>
            ${idDocsBlock}
        </div>
        <div class="space-y-3">
            ${identityField}
            <p class="text-[8px] text-emerald-800 bg-emerald-50 border border-emerald-200 p-2 rounded text-center"><i class="fas fa-route"></i> Puedes cerrar y pedir un viaje cuando quieras. Verificar no es obligatorio para viajar.</p>
            <button type="button" onclick="window.submitPassengerVerification?.()" class="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-black py-4 rounded-2xl shadow-lg active:scale-[0.98] transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2">
                <span>${submitLabel}</span>
                <i class="fas fa-shield-check text-xs"></i>
            </button>
            <button type="button" onclick="window.cancelPassengerVerificationSetup?.()" class="w-full py-3 text-gray-500 font-bold text-xs">
                Más tarde — seguir pidiendo viajes
            </button>
        </div>
    `;
}

export function bindPassengerVerificationPhotoPicks(profile = null) {
    const minor = isMinorProfile(profile || window.userProfile);
    bindVerificationPhotoPick('passenger-photo-preview', 'passenger-photo-placeholder', 'passengerPhotoBase64', 'user', 512);
    if (minor) {
        bindVerificationPhotoPick('passenger-birth-cert-preview', 'passenger-birth-cert-placeholder', 'passengerBirthCertBase64', 'environment', 900);
    } else {
        bindVerificationPhotoPick('passenger-id-front-preview', 'passenger-id-front-placeholder', 'passengerIdFrontBase64', 'environment', 720);
        bindVerificationPhotoPick('passenger-id-back-preview', 'passenger-id-back-placeholder', 'passengerIdBackBase64', 'environment', 720);
    }
}

export function showPassengerVerificationSetup({
    title = 'Verifica tu cuenta',
    subtitle = 'Opcional — puedes pedir viajes ya y verificar cuando quieras',
} = {}) {
    const setupScreen = document.getElementById('setup-screen');
    if (!setupScreen) {
        window.showToast?.('No se pudo abrir el formulario de verificación.', 'error');
        return;
    }

    window.passengerPhotoBase64 = null;
    window.passengerIdFrontBase64 = null;
    window.passengerIdBackBase64 = null;
    window.passengerBirthCertBase64 = null;

    setupScreen.className = 'login-screen flex flex-col min-h-[100dvh] z-[20000] auth-screen-open';
    setupScreen.classList.remove('hidden');
    setupScreen.style.cssText = 'display:flex !important; visibility:visible !important; opacity:1 !important; position:fixed; inset:0; z-index:20000;';

    setupScreen.innerHTML = getAuthHeroHtml({
        sub: '🇭🇳 Verificación HonduRaite',
        tagline: 'Identidad y seguridad',
    }) + getAuthCardShell({
        title,
        subtitle,
        closeAction: 'window.cancelPassengerVerificationSetup?.()',
        bodyHtml: buildPassengerVerificationFormHtml({ profile: window.userProfile }),
    });

    if (typeof window.initSozinCopyright === 'function') window.initSozinCopyright();
    if (typeof window.syncAuthHeroLogos === 'function') {
        window.syncAuthHeroLogos(window.customLoginLogo);
    }

    setTimeout(() => {
        bindPassengerVerificationPhotoPicks(window.userProfile);
        setupScreen.scrollTop = 0;
    }, 60);
}

window.showPassengerVerificationSetup = showPassengerVerificationSetup;

window.cancelPassengerVerificationSetup = () => {
    if (needsPassengerVerificationCTA(window.userProfile)) {
        markVerifyLater({ days: 7 });
    }

    const setupScreen = document.getElementById('setup-screen');
    if (setupScreen) {
        setupScreen.classList.add('hidden');
        setupScreen.innerHTML = '';
        setupScreen.style.cssText = '';
        setupScreen.style.display = 'none';
    }

    document.body.classList.remove('auth-screen-open');

    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'none';

    const app = document.getElementById('app-interface');
    if (app) app.style.display = 'flex';

    document.getElementById('client-view')?.classList.remove('hidden');
    document.getElementById('driver-view')?.classList.add('hidden');

    window.showControlPanel?.();
    window.resetTripPanelCollapse?.();

    const panel = document.getElementById('panel-content') || document.getElementById('control-panel');
    if (panel) panel.scrollTop = 0;

    if (window.userProfile?.role === 'client') {
        syncPassengerVerificationBanner(window.userProfile);
        if (needsPassengerVerificationCTA(window.userProfile)) {
            window.showToast?.('Listo. Ya puedes pedir un viaje. Verifícate cuando quieras desde el aviso superior.', 'success');
        }
    }
};

/**
 * Modal suave tipo Uber: no bloquea la app; el usuario elige verificar ahora o más tarde.
 */
export function showPassengerVerifyChoiceModal(profile = window.userProfile) {
    if (!profile || profile.role === 'driver') return;
    if (!needsPassengerVerificationCTA(profile)) return;
    if (document.getElementById('passenger-verify-choice-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'passenger-verify-choice-modal';
    modal.className = 'passenger-verify-choice-overlay';
    modal.innerHTML = `
        <div class="passenger-verify-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="pv-choice-title">
            <div class="passenger-verify-choice-icon" aria-hidden="true"><i class="fas fa-shield-alt"></i></div>
            <h2 id="pv-choice-title">¡Ya puedes pedir viajes!</h2>
            <p class="passenger-verify-choice-text">
                Con tu cuenta creada <strong>puedes solicitar un viaje ahora</strong>.
                Verificar tu identidad es <strong>opcional</strong> y te da más confianza con los conductores.
            </p>
            <ul class="passenger-verify-choice-list">
                <li><i class="fas fa-check text-emerald-500"></i> Origen, destino y tarifa en segundos</li>
                <li><i class="fas fa-check text-emerald-500"></i> Sin verificación obligatoria para viajar</li>
                <li><i class="fas fa-check text-emerald-500"></i> Puedes verificarte después, cuando quieras</li>
            </ul>
            <button type="button" class="passenger-verify-choice-btn passenger-verify-choice-btn--primary" data-pv-now>
                Verificar ahora
            </button>
            <button type="button" class="passenger-verify-choice-btn passenger-verify-choice-btn--later" data-pv-later>
                Más tarde — quiero pedir un viaje
            </button>
            <p class="passenger-verify-choice-foot">Siempre puedes verificar desde el aviso azul del panel.</p>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();

    modal.querySelector('[data-pv-now]')?.addEventListener('click', () => {
        close();
        showPassengerVerificationSetup({
            title: 'Verifica tu cuenta',
            subtitle: 'Opcional — mejora la confianza con conductores',
        });
    });
    modal.querySelector('[data-pv-later]')?.addEventListener('click', () => {
        markVerifyLater({ days: 7 });
        close();
        window.showToast?.('Perfecto. Elige origen y destino y solicita tu viaje.', 'success');
        syncPassengerVerificationBanner(window.userProfile);
        window.showControlPanel?.();
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            markVerifyLater({ days: 7 });
            close();
        }
    });
}

window.showPassengerVerifyChoiceModal = showPassengerVerifyChoiceModal;

export function bindOptionalRegistrationPhotoPick() {
    const target = document.querySelector('[data-reg-photo-pick]');
    if (!target || target.dataset.pickBound === '1') return;
    target.dataset.pickBound = '1';
    target.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickPhotoFromCamera({
            facing: 'user',
            maxSize: 384,
            onCapture: (dataUrl) => {
                window.passengerPhotoBase64 = dataUrl;
                setPreviewImage('passenger-reg-photo-preview', 'passenger-reg-photo-placeholder', dataUrl);
            },
            onError: (msg) => window.showToast?.(msg || 'No se pudo abrir la cámara', 'warning'),
        });
    });
}

export function promptPassengerVerificationIfNeeded(profile, { delayMs = 1200 } = {}) {
    if (!profile || profile.role === 'driver') return;
    if (!needsPassengerVerificationCTA(profile)) return;
    if (isPassengerVerificationPromptDismissed()) return;
    // No interrumpir viaje activo
    if (document.body.classList.contains('trip-active')) return;
    if (document.body.classList.contains('is-searching')) return;

    setTimeout(() => {
        if (!needsPassengerVerificationCTA(window.userProfile)) return;
        if (isPassengerVerificationPromptDismissed()) return;
        if (document.body.classList.contains('trip-active')) return;
        // Estilo Uber: elección suave, no formulario a pantalla completa forzado
        showPassengerVerifyChoiceModal(window.userProfile);
    }, delayMs);
}