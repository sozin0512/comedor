/**
 * Tutoriales en YouTube (pasajero y conductor).
 * Reemplaza el tour guiado in-app: un tap abre el video.
 */

import { APP_CONFIG } from './config.js';
import { openExternalUrl } from './capacitor-native.js';

function tutorialsConfig() {
    return APP_CONFIG?.tutorials || window.APP_CONFIG?.tutorials || {};
}

function tutorialUrl(role) {
    const t = tutorialsConfig();
    const raw = role === 'driver' ? t.driverYoutube : t.passengerYoutube;
    return String(raw || '').trim();
}

export async function openYoutubeTutorial(role) {
    const url = tutorialUrl(role);
    if (!url) {
        window.showToast?.('El video tutorial se publicará pronto.', 'info');
        return;
    }
    const ok = await openExternalUrl(url);
    if (!ok) window.showToast?.('No se pudo abrir YouTube. Intenta de nuevo.', 'error');
}

function bindTutorialButton(id, role) {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.tutorialBound === '1') return;
    btn.dataset.tutorialBound = '1';
    btn.addEventListener('click', () => {
        window.closeProfilePanel?.();
        window.closeHeaderMoreMenu?.();
        openYoutubeTutorial(role);
    });
}

export function initYoutubeTutorials() {
    window.openPassengerTutorial = () => openYoutubeTutorial('client');
    window.openDriverTutorial = () => openYoutubeTutorial('driver');

    bindTutorialButton('btn-passenger-tutorial', 'client');
    bindTutorialButton('header-menu-tutorial', 'client');
    bindTutorialButton('btn-driver-tutorial', 'driver');
    bindTutorialButton('header-menu-driver-tutorial', 'driver');
}

export function syncYoutubeTutorialMenuVisibility(role) {
    const showPassenger = role === 'client' && !!tutorialUrl('client');
    const showDriver = role === 'driver' && !!tutorialUrl('driver');
    document.getElementById('btn-passenger-tutorial')?.classList.toggle('hidden', !showPassenger);
    document.getElementById('header-menu-tutorial')?.classList.toggle('hidden', !showPassenger);
    document.getElementById('btn-driver-tutorial')?.classList.toggle('hidden', !showDriver);
    document.getElementById('header-menu-driver-tutorial')?.classList.toggle('hidden', !showDriver);
}
