/**
 * Login con correo o teléfono (+ índice Firestore) y recuperación de contraseña.
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
function normalizeHondurasPhone(raw) {
    if (!raw) return '';
    let d = String(raw).replace(/\D/g, '');
    if (d.startsWith('504')) d = d.slice(3);
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === 8) return '504' + d;
    if (d.length === 11 && d.startsWith('504')) return d;
    if (d.length > 8) return '504' + d.slice(-8);
    if (d.length > 0) return '504' + d.padStart(8, '0').slice(-8);
    return '';
}

export function isEmailLike(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function maskEmail(email) {
    const mail = String(email || '').trim();
    const [user, domain] = mail.split('@');
    if (!user || !domain) return mail;
    const visible = user.length <= 2 ? user[0] || '*' : `${user.slice(0, 2)}***`;
    return `${visible}@${domain}`;
}

export async function syncAuthPhoneIndex(db, appId, phone, email, uid) {
    const phoneKey = normalizeHondurasPhone(phone);
    const mail = String(email || '').trim().toLowerCase();
    if (!db || !appId || !phoneKey || !mail || !uid) return;

    await setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', 'auth_phone_index', phoneKey),
        { email: mail, uid, updatedAt: serverTimestamp() },
        { merge: true }
    );
}

export async function resolveLoginEmail(db, appId, identifier) {
    const raw = String(identifier || '').trim();
    if (!raw) return null;

    if (isEmailLike(raw)) return raw.toLowerCase();

    const phoneKey = normalizeHondurasPhone(raw);
    if (!phoneKey) return null;

    try {
        const snap = await getDoc(
            doc(db, 'artifacts', appId, 'public', 'data', 'auth_phone_index', phoneKey)
        );
        if (snap.exists() && snap.data()?.email) {
            return String(snap.data().email).trim().toLowerCase();
        }
    } catch (e) {
        console.warn('resolveLoginEmail:', e);
    }

    return null;
}

export function authErrorMessage(err, context = 'login') {
    const code = err?.code || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        return context === 'reset'
            ? 'No encontramos una cuenta con esos datos.'
            : 'Correo/teléfono o contraseña incorrectos.';
    }
    if (code === 'auth/invalid-email') return 'Correo electrónico no válido.';
    if (code === 'auth/email-already-in-use') return 'Este correo ya está registrado.';
    if (code === 'auth/weak-password') return 'La contraseña debe tener al menos 6 caracteres.';
    if (code === 'auth/too-many-requests') return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
    if (code === 'auth/network-request-failed') return 'Sin conexión. Revisa tu internet.';
    return err?.message || 'Error de autenticación.';
}

export async function sendPasswordResetForIdentifier(auth, db, appId, identifier) {
    let email = await resolveLoginEmail(db, appId, identifier);
    if (!email && isEmailLike(identifier)) {
        email = String(identifier).trim().toLowerCase();
    }
    if (!email) {
        throw new Error('PHONE_NOT_FOUND');
    }
    await sendPasswordResetEmail(auth, email);
    return email;
}