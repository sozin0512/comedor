/** Captura de fotos — web, móvil y APK. El permiso solo se pide al tocar la foto. */

import { isCapacitorNative } from './capacitor-native.js';

let _activePickerInput = null;
let _cameraStream = null;
let _cameraOverlay = null;

export function compressDataUrlFromFile(file, maxSize = 640) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('Sin archivo'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Imagen inválida'));
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > height) {
                    if (width > maxSize) {
                        height *= maxSize / width;
                        width = maxSize;
                    }
                } else if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function dataUrlFromVideoFrame(video, maxSize = 640) {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    let width = vw;
    let height = vh;
    if (width > height) {
        if (width > maxSize) {
            height *= maxSize / width;
            width = maxSize;
        }
    } else if (height > maxSize) {
        width *= maxSize / height;
        height = maxSize;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.82);
}

function stopCameraStream() {
    if (_cameraStream) {
        _cameraStream.getTracks().forEach((t) => t.stop());
        _cameraStream = null;
    }
}

function removeCameraOverlay() {
    stopCameraStream();
    _cameraOverlay?.remove();
    _cameraOverlay = null;
    document.body.classList.remove('camera-capture-open');
}

function isMobileDevice() {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
    return !!window.matchMedia?.('(pointer: coarse)')?.matches;
}

/** Móvil (web o APK): input con capture → cámara nativa y diálogo de permiso del sistema/navegador. */
function shouldUseNativeFileCapture() {
    if (isCapacitorNative()) return true;
    if (isMobileDevice()) return true;
    return false;
}

/** Escritorio en HTTPS: vista previa en vivo con getUserMedia (el navegador pide permiso al tocar). */
function canUseInlineCamera() {
    if (shouldUseNativeFileCapture()) return false;
    if (!window.isSecureContext) return false;
    return !!(navigator.mediaDevices?.getUserMedia);
}

function cameraDeniedHint() {
    if (isCapacitorNative()) {
        return 'Permite la cámara cuando el teléfono lo pida, o en Ajustes → HonduRaite → Permisos.';
    }
    if (isMobileDevice()) {
        return 'Permite la cámara o el acceso a fotos cuando el navegador lo pida.';
    }
    return 'Permite la cámara en la barra del navegador (candado o ícono de cámara) y vuelve a tocar.';
}

function insecureContextHint() {
    return 'La cámara en vivo requiere HTTPS. Usa la opción de tomar o subir foto que se abrirá ahora.';
}

function openFilePickerSync({ facing = 'user', maxSize = 640, onCapture, onError } = {}) {
    if (_activePickerInput) {
        try { _activePickerInput.remove(); } catch (_) {}
        _activePickerInput = null;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (facing === 'environment') {
        input.setAttribute('capture', 'environment');
    } else {
        input.setAttribute('capture', 'user');
    }
    input.className = 'sr-only';
    input.setAttribute('aria-hidden', 'true');
    document.body.appendChild(input);
    _activePickerInput = input;

    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        try { input.remove(); } catch (_) {}
        _activePickerInput = null;
        if (!file) return;
        try {
            const dataUrl = await compressDataUrlFromFile(file, maxSize);
            onCapture?.(dataUrl);
        } catch (e) {
            onError?.(e?.message || 'No se pudo procesar la foto');
        }
    }, { once: true });

    try {
        input.click();
    } catch (_) {
        onError?.('No se pudo abrir la cámara. Toca de nuevo o revisa los permisos del navegador.');
    }
}

function openInlineCameraCapture({ facing = 'user', maxSize = 640, onCapture, onError } = {}) {
    removeCameraOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'camera-capture-overlay';
    overlay.innerHTML = `
        <div class="camera-capture-panel" role="dialog" aria-modal="true" aria-label="Tomar foto">
            <video class="camera-capture-video" playsinline autoplay muted></video>
            <div class="camera-capture-actions">
                <button type="button" class="camera-capture-btn camera-capture-btn--cancel">Cancelar</button>
                <button type="button" class="camera-capture-btn camera-capture-btn--shoot"><i class="fas fa-camera"></i> Capturar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('camera-capture-open');
    _cameraOverlay = overlay;

    const video = overlay.querySelector('.camera-capture-video');
    const cancelBtn = overlay.querySelector('.camera-capture-btn--cancel');
    const shootBtn = overlay.querySelector('.camera-capture-btn--shoot');

    const fallbackNative = (msg) => {
        removeCameraOverlay();
        if (msg) onError?.(msg);
        openFilePickerSync({ facing, maxSize, onCapture, onError });
    };

    cancelBtn?.addEventListener('click', () => removeCameraOverlay());

    const constraints = {
        audio: false,
        video: {
            facingMode: facing === 'environment' ? { ideal: 'environment' } : { ideal: 'user' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
        },
    };

    if (!navigator.mediaDevices?.getUserMedia) {
        fallbackNative();
        return;
    }

    navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
            _cameraStream = stream;
            video.srcObject = stream;
            return video.play?.();
        })
        .catch((err) => {
            const denied = err?.name === 'NotAllowedError' || (err?.message || '').toLowerCase().includes('denied');
            fallbackNative(denied ? cameraDeniedHint() : null);
        });

    shootBtn?.addEventListener('click', () => {
        try {
            if (!video?.videoWidth) {
                onError?.('La cámara aún no está lista. Espera un momento.');
                return;
            }
            const dataUrl = dataUrlFromVideoFrame(video, maxSize);
            removeCameraOverlay();
            onCapture?.(dataUrl);
        } catch (e) {
            onError?.(e?.message || 'No se pudo capturar la foto');
        }
    });
}

/**
 * No llamar al cargar pantallas — el permiso debe pedirse solo tras el tap del usuario.
 */
export async function requestCameraPermission() {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: false,
        });
        stream.getTracks().forEach((t) => t.stop());
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Web móvil / APK: cámara nativa al tocar.
 * Web escritorio (HTTPS): vista en vivo; si falla, selector de archivo.
 */
export function pickPhotoFromCamera(opts = {}) {
    const {
        facing = 'user',
        maxSize = 640,
        onCapture,
        onError,
    } = opts;

    if (typeof onCapture !== 'function') return;

    if (shouldUseNativeFileCapture()) {
        openFilePickerSync({ facing, maxSize, onCapture, onError });
        return;
    }

    if (!window.isSecureContext) {
        onError?.(insecureContextHint());
        openFilePickerSync({ facing, maxSize, onCapture, onError });
        return;
    }

    if (canUseInlineCamera()) {
        openInlineCameraCapture({ facing, maxSize, onCapture, onError });
        return;
    }

    openFilePickerSync({ facing, maxSize, onCapture, onError });
}

export function bindCameraPickButton(buttonId, { facing = 'user', maxSize = 640, onCapture, onError } = {}) {
    const btn = document.getElementById(buttonId);
    if (!btn || btn.dataset.cameraBound === '1') return;
    btn.dataset.cameraBound = '1';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickPhotoFromCamera({ facing, maxSize, onCapture, onError });
    });
}