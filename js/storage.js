import { getStorage, ref, uploadString, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

export function initStorage(app) {
    return getStorage(app);
}

export function isDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:");
}

function dataUrlToBlob(dataUrl) {
    const raw = String(dataUrl || '');
    const match = raw.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Foto inválida');
    const mime = match[1] || 'image/jpeg';
    const bin = atob(match[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

export async function uploadDataUrl(storage, dataUrl, storagePath) {
    const storageRef = ref(storage, storagePath);
    try {
        const blob = dataUrlToBlob(dataUrl);
        await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
    } catch (_) {
        await uploadString(storageRef, dataUrl, 'data_url');
    }
    return getDownloadURL(storageRef);
}

export async function uploadFile(storage, file, storagePath) {
    const storageRef = ref(storage, storagePath);
    const type = file?.type || 'image/jpeg';
    await uploadBytes(storageRef, file, { contentType: type });
    return getDownloadURL(storageRef);
}

/** Si es base64 o File lo sube a Storage; si ya es URL la devuelve tal cual. */
export async function resolvePhotoUrl(storage, value, storagePath) {
    if (!value) return null;
    if (!isDataUrl(value) && !(value instanceof File) && typeof value !== 'string') return value;
    if (value instanceof File) {
        return uploadFile(storage, value, storagePath);
    }
    if (!isDataUrl(value)) return value;
    return uploadDataUrl(storage, value, storagePath);
}