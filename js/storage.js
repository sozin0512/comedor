import { getStorage, ref, uploadString, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

export function initStorage(app) {
    return getStorage(app);
}

export function isDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:");
}

export async function uploadDataUrl(storage, dataUrl, storagePath) {
    const storageRef = ref(storage, storagePath);
    await uploadString(storageRef, dataUrl, "data_url");
    return getDownloadURL(storageRef);
}

export async function uploadFile(storage, file, storagePath) {
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
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