/** Alertas de verificación de identidad → supervisores y admin */

import { serverTimestamp, addDoc, collection } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { calculateAge } from './age-verification.js';

export async function createVerificationAlert(db, appId, profile) {
    if (!db || !appId || !profile?.uid) return null;

    const payload = {
        uid: profile.uid,
        name: profile.name || 'Usuario',
        role: profile.role || 'client',
        type: 'identity_verification',
        status: 'pending',
        identity: profile.identity || null,
        age: profile.birthDate ? calculateAge(profile.birthDate) : null,
        photo: profile.photo || null,
        identityPhoto: profile.identityPhoto || null,
        phone: profile.phone || null,
        email: profile.email || null,
        createdAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
    };

    try {
        const ref = await addDoc(
            collection(db, 'artifacts', appId, 'public', 'data', 'verification_alerts'),
            payload
        );
        return ref.id;
    } catch (e) {
        console.error('createVerificationAlert:', e);
        return null;
    }
}