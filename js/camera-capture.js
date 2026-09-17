/** Captura de fotos — web, móvil y APK. El permiso solo se pide al tocar la foto. */

import { isCapacitorNative } from './capacitor-native.js';

let _activePickerInput = null;
let _cameraStream = null;
let _cameraOverlay = null;

/** Android rompe el selector si se mezclan MIME + extensiones en accept. */
const IMAGE_ACCEPT = 'image/*';

function drawToJpegDataUrl(source, sw, sh, maxSize = 640, quality = 0.82) {
    let width = sw;
    let height = sh;
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
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

export function compressDataUrlFromFile(file, maxSize = 640) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('Sin archivo'));
            return;
        }

        const finishRaw = () => {
            readFileAsDataUrl(file).then(resolve).catch(reject);
        };

        const fromImageSrc = (src, revoke) => {
            const img = new Image();
            img.onload = () => {
                try {
                    if (!img.width || !img.height) {
                        if (revoke) URL.revokeObjectURL(src);
                        finishRaw();
                        return;
                    }
                    const out = drawToJpegDataUrl(img, img.width, img.height, maxSize);
                    if (revoke) URL.revokeObjectURL(src);
                    resolve(out);
                } catch (_) {
                    if (revoke) URL.revokeObjectURL(src);
                    finishRaw();
                }
            };
            img.onerror = () => {
                if (revoke) URL.revokeObjectURL(src);
                finishRaw();
            };
            img.src = src;
        };

        const fromBlobUrl = () => {
            try {
                const url = URL.createObjectURL(file);
                fromImageSrc(url, true);
            } catch (_) {
                fromReader();
            }
        };

        const fromReader = () => {
            readFileAsDataUrl(file).then((src) => fromImageSrc(src, false)).catch(reject);
        };

        const tooBig = (file.size || 0) > 12 * 1024 * 1024;
        if (!tooBig && typeof createImageBitmap === 'function') {
            const bmpPromise = createImageBitmap(file).catch(() => createImageBitmap(file, { imageOrientation: 'from-image' }));
            const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500));
            Promise.race([bmpPromise, timeout]).then((bmp) => {
                try {
                    if (!bmp?.width || !bmp?.height) {
                        try { bmp.close?.(); } catch (_) {}
                        fromBlobUrl();
                        return;
                    }
                    const out = drawToJpegDataUrl(bmp, bmp.width, bmp.height, maxSize);
                    bmp.close?.();
                    resolve(out);
                } catch (_) {
                    try { bmp.close?.(); } catch (__) {}
                    fromBlobUrl();
                }
            }).catch(() => fromBlobUrl());
            return;
        }

        fromBlobUrl();
    });
}

async function clonePickedFile(file) {
    if (!file) return null;
    const name = file.name || 'foto.jpg';
    const type = file.type || 'image/jpeg';
    try {
        const buf = await file.arrayBuffer();
        if (!buf || buf.byteLength === 0) return file;
        return new File([buf], name, { type: type || 'image/jpeg', lastModified: Date.now() });
    } catch (_) {
        try {
            const blob = file.slice(0, file.size, type);
            return new File([blob], name, { type: blob.type || type, lastModified: Date.now() });
        } catch {
            return file;
        }
    }
}

function cleanupPickerInput(input) {
    if (!input) return;
    try { input.value = ''; } catch (_) {}
    try { input.remove(); } catch (_) {}
    if (_activePickerInput === input) _activePickerInput = null;
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

function isAppleMobile() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
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

function styleLiveFileInput(input) {
    // No usar display:none: iOS/Android cancelan el picker. Tamano tocable, casi invisible.
    input.style.cssText = 'position:fixed;left:50%;top:50%;width:64px;height:64px;opacity:0.011;z-index:2147483645;margin:0;padding:0;border:0;transform:translate(-50%,-50%);';
    input.setAttribute('aria-hidden', 'true');
}

/**
 * @param {{ facing?: 'user'|'environment', maxSize?: number, source?: 'camera'|'gallery'|'any', onCapture?: Function, onError?: Function, onFile?: Function, onCancel?: Function }} opts
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
    onCancel,
    onOpened,
} = {}) {
    if (_activePickerInput) {
        try { _activePickerInput.remove(); } catch (_) {}
        _activePickerInput = null;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_ACCEPT;
    // iPhone ignora o rompe capture= en PWA/Safari; sin capture ofrece Cámara o Galería.
    if (source === 'camera' && !isAppleMobile()) {
        input.setAttribute('capture', facing === 'environment' ? 'environment' : 'user');
    }
    styleLiveFileInput(input);
    document.body.appendChild(input);
    _activePickerInput = input;

    let settled = false;
    const finishCancel = () => {
        if (settled) return;
        settled = true;
        cleanupPickerInput(input);
        onCancel?.();
    };

    input.addEventListener('change', async () => {
        if (settled) return;
        const raw = input.files && input.files[0];
        if (!raw) {
            finishCancel();
            onError?.('No se recibió la foto. Vuelve a elegirla y toca Subir/Abrir.');
            return;
        }
        settled = true;
        let file = raw;
        try {
            file = await clonePickedFile(raw) || raw;
        } catch (_) {
            file = raw;
        }
        try {
            if (typeof onFile === 'function') onFile(file);
            let dataUrl = null;
            try {
                dataUrl = await compressDataUrlFromFile(file, maxSize);
            } catch (_) {
                dataUrl = await readFileAsDataUrl(file);
            }
            if (!dataUrl) throw new Error('La foto quedó vacía');
            cleanupPickerInput(input);
            onCapture?.(dataUrl, file);
        } catch (e) {
            cleanupPickerInput(input);
            onError?.(e?.message || 'No se pudo procesar la foto. Prueba otra o tómala con la cámara.');
        }
    }, { once: true });

    input.addEventListener('cancel', () => {
        finishCancel();
    }, { once: true });

    // Si el SO no dispara "cancel" (Android), no dejar el input huérfano para siempre.
    window.setTimeout(() => {
        if (settled || _activePickerInput !== input) return;
        // El picker puede seguir abierto; no lo borramos. Solo si el usuario ya eligió otra foto.
    }, 120000);

    try {
        if (typeof input.showPicker === 'function') input.showPicker();
        else input.click();
        onOpened?.();
    } catch (_) {
        try {
            input.removeAttribute('capture');
            if (typeof input.showPicker === 'function') input.showPicker();
            else input.click();
            onOpened?.();
        } catch (err2) {
            settled = true;
            cleanupPickerInput(input);
            onError?.(source === 'gallery'
                ? 'No se pudo abrir la galería. Toca de nuevo o revisa los permisos.'
                : 'No se pudo abrir la cámara. Toca de nuevo o revisa los permisos del celular.');
            onCancel?.();
        }
    }
}

function openInlineCameraCapture({ facing = 'user', maxSize = 640, onCapture, onError, onCancel } = {}) {
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
        openFilePickerSync({ facing, maxSize, source: 'camera', onCapture, onError, onCancel });
    };

    cancelBtn?.addEventListener('click', () => {
        removeCameraOverlay();
        onCancel?.();
    });

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
        onCancel,
        onOpened,
    } = opts;

    if (typeof onCapture !== 'function' && typeof onFile !== 'function') return;

    if (shouldUseNativeFileCapture()) {
        openFilePickerSync({ facing, maxSize, source: 'camera', onCapture, onError, onFile, onCancel, onOpened });
        return;
    }

    if (!window.isSecureContext) {
        onError?.(insecureContextHint());
        openFilePickerSync({ facing, maxSize, source: 'camera', onCapture, onError, onFile, onCancel, onOpened });
        return;
    }

    if (canUseInlineCamera()) {
        onOpened?.();
        openInlineCameraCapture({ facing, maxSize, onCapture, onError, onCancel });
        return;
    }

    openFilePickerSync({ facing, maxSize, source: 'camera', onCapture, onError, onFile, onCancel, onOpened });
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
        onCancel,
        onOpened,
    } = opts;

    if (typeof onCapture !== 'function' && typeof onFile !== 'function') return;

    openFilePickerSync({
        facing: 'environment',
        maxSize,
        source: 'gallery',
        onCapture,
        onError,
        onFile,
        onCancel,
        onOpened,
    });
}

function hidePhotoSourceSheet(sheet) {
    if (!sheet) return;
    sheet.style.opacity = '0';
    sheet.style.pointerEvents = 'none';
}

/**
 * Hoja con dos opciones: Tomar foto o Galería.
 * No se quita del DOM hasta que el picker termina: si se borra en el mismo gesto,
 * Android/iOS cancelan la cámara o pierden el archivo al dar Subir.
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

    const restore = () => {
        if (!sheet.isConnected) return;
        sheet.style.opacity = '';
        sheet.style.pointerEvents = '';
    };

    const wrapDone = {
        onCapture: (...args) => {
            close();
            onCapture?.(...args);
        },
        onError: (msg) => {
            restore();
            if (msg) onError?.(msg);
        },
        onCancel: restore,
        onFile,
    };

    sheet.addEventListener('click', (e) => {
        if (e.target === sheet) close();
    });

    sheet.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
    sheet.querySelector('[data-action="camera"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickPhotoFromCamera({
            facing,
            maxSize,
            ...wrapDone,
            onOpened: () => hidePhotoSourceSheet(sheet),
        });
    });
    sheet.querySelector('[data-action="gallery"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickPhotoFromGallery({
            maxSize,
            ...wrapDone,
            onOpened: () => hidePhotoSourceSheet(sheet),
        });
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
