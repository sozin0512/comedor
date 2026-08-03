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

/**
 * @param {{ facing?: 'user'|'environment', maxSize?: number, source?: 'camera'|'gallery'|'any', onCapture?: Function, onError?: Function, onFile?: Function }} opts
 * source:
 *  - camera  → atributo capture (solo cámara en la mayoría de móviles)
 *  - gallery → sin capture (abre galería / archivos)
 *  - any     → sin capture (el SO puede ofrecer cámara o galería)
 */
function openFilePickerSync({
    facing = 'user',
    maxSize = 640,
    source = 'camera',
    onCapture,
    onError,
    onFile,
} = {}) {
    if (_activePickerInput) {
        try { _activePickerInput.remove(); } catch (_) {}
        _activePickerInput = null;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Solo forzar cámara si se pide explícitamente. Galería / any NO llevan capture.
    if (source === 'camera') {
        if (facing === 'environment') {
            input.setAttribute('capture', 'environment');
        } else {
            input.setAttribute('capture', 'user');
        }
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
            if (typeof onFile === 'function') {
                onFile(file);
            }
            const dataUrl = await compressDataUrlFromFile(file, maxSize);
            onCapture?.(dataUrl, file);
        } catch (e) {
            onError?.(e?.message || 'No se pudo procesar la foto');
        }
    }, { once: true });

    try {
        input.click();
    } catch (_) {
        onError?.(source === 'gallery'
            ? 'No se pudo abrir la galería. Toca de nuevo o revisa los permisos.'
            : 'No se pudo abrir la cámara. Toca de nuevo o revisa los permisos del navegador.');
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
        onFile,
    } = opts;

    if (typeof onCapture !== 'function' && typeof onFile !== 'function') return;

    if (shouldUseNativeFileCapture()) {
        openFilePickerSync({ facing, maxSize, source: 'camera', onCapture, onError, onFile });
        return;
    }

    if (!window.isSecureContext) {
        onError?.(insecureContextHint());
        openFilePickerSync({ facing, maxSize, source: 'camera', onCapture, onError, onFile });
        return;
    }

    if (canUseInlineCamera()) {
        openInlineCameraCapture({ facing, maxSize, onCapture, onError });
        return;
    }

    openFilePickerSync({ facing, maxSize, source: 'camera', onCapture, onError, onFile });
}

/**
 * Abrir galería / archivos (sin atributo capture).
 * Sirve para comprobantes de depósito ya guardados en el teléfono.
 */
export function pickPhotoFromGallery(opts = {}) {
    const {
        maxSize = 1280,
        onCapture,
        onError,
        onFile,
    } = opts;

    if (typeof onCapture !== 'function' && typeof onFile !== 'function') return;

    openFilePickerSync({
        facing: 'environment',
        maxSize,
        source: 'gallery',
        onCapture,
        onError,
        onFile,
    });
}

/**
 * Hoja con dos opciones: Tomar foto o Galería.
 * Ideal para depósitos / comprobantes en la app de conductores.
 */
export function pickPhotoWithSourceChoice(opts = {}) {
    const {
        facing = 'environment',
        maxSize = 1280,
        onCapture,
        onError,
        onFile,
        title = 'Foto del comprobante',
        cameraLabel = 'Tomar foto',
        galleryLabel = 'Buscar en galería',
    } = opts;

    if (typeof onCapture !== 'function' && typeof onFile !== 'function') return;

    // Quitar hoja previa si quedó abierta
    document.querySelectorAll('[data-photo-source-sheet="1"]').forEach((el) => el.remove());

    const sheet = document.createElement('div');
    sheet.dataset.photoSourceSheet = '1';
    sheet.className = 'fixed inset-0 z-[50050] flex items-end sm:items-center justify-center bg-black/55 p-3';
    sheet.innerHTML = `
        <div class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl p-4 shadow-2xl border border-slate-200 dark:border-slate-700"
             role="dialog" aria-modal="true" aria-label="${title}">
            <p class="text-center font-black text-slate-800 dark:text-white text-sm mb-1">${title}</p>
            <p class="text-center text-[11px] text-slate-500 dark:text-slate-400 mb-4 leading-snug">
                Puedes capturar con la cámara o elegir una imagen ya guardada en tu galería.
            </p>
            <div class="space-y-2">
                <button type="button" data-action="camera"
                    class="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm active:scale-[0.98] transition">
                    <i class="fas fa-camera mr-2"></i>${cameraLabel}
                </button>
                <button type="button" data-action="gallery"
                    class="w-full py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-black text-sm active:scale-[0.98] transition">
                    <i class="fas fa-images mr-2"></i>${galleryLabel}
                </button>
                <button type="button" data-action="cancel"
                    class="w-full py-3 rounded-2xl text-slate-500 font-bold text-sm">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(sheet);

    const close = () => {
        try { sheet.remove(); } catch (_) {}
    };

    sheet.addEventListener('click', (e) => {
        if (e.target === sheet) close();
    });

    sheet.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
    sheet.querySelector('[data-action="camera"]')?.addEventListener('click', () => {
        close();
        // El click debe seguir siendo síncrono en el mismo gesto de usuario en la mayoría de browsers;
        // al cerrar y reabrir el picker en el siguiente tick suele funcionar en Android/WebView.
        setTimeout(() => {
            pickPhotoFromCamera({ facing, maxSize, onCapture, onError, onFile });
        }, 50);
    });
    sheet.querySelector('[data-action="gallery"]')?.addEventListener('click', () => {
        close();
        setTimeout(() => {
            pickPhotoFromGallery({ maxSize, onCapture, onError, onFile });
        }, 50);
    });
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