/** Soporte WhatsApp + tickets */

import { addDoc, collection, serverTimestamp, getDocs, updateDoc, doc, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

export function getSupportWhatsAppUrl(config, { subject = '', tripId = '', userName = '' } = {}) {
    let phone = (config?.support?.whatsapp || '').replace(/\D/g, '');
    if (!phone) return null;
    // Force Honduras +504
    if (phone.startsWith('504')) phone = phone.slice(3);
    if (phone.startsWith('0')) phone = phone.slice(1);
    if (phone.length === 8) phone = '504' + phone;
    const lines = [
        'Hola HonduRaite, necesito ayuda.',
        userName ? `Soy: ${userName}` : '',
        subject ? `Asunto: ${subject}` : '',
        tripId ? `Viaje: ${tripId.slice(-8)}` : '',
    ].filter(Boolean);
    return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

export async function createSupportTicket(db, appId, payload) {
    const ref = await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'support_tickets'), {
        status: 'open',
        priority: payload.priority || 'normal',
        category: payload.category || 'general',
        subject: payload.subject || 'Solicitud de soporte',
        message: payload.message || '',
        userId: payload.userId || null,
        userName: payload.userName || 'Usuario',
        userRole: payload.userRole || null,
        userPhone: payload.userPhone ? (typeof window !== 'undefined' && window.normalizeHondurasPhone ? window.normalizeHondurasPhone(payload.userPhone) : payload.userPhone) : null,
        tripId: payload.tripId || null,
        source: payload.source || 'app',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        assignedTo: null,
        resolvedAt: null,
    });
    return ref.id;
}

export async function createQuickWeirdReport(db, appId, { user, trip, note = '' }) {
    const subject = trip
        ? `Reporte raro en viaje ${trip.id?.slice(-6) || ''}`
        : 'Reporte de algo raro';
    const message = [
        note || 'El pasajero reportó algo inusual desde la app.',
        trip ? `Origen: ${trip.origin}` : '',
        trip ? `Destino: ${trip.destination}` : '',
        trip?.driverName ? `Conductor: ${trip.driverName}` : '',
    ].filter(Boolean).join('\n');

    const ticketId = await createSupportTicket(db, appId, {
        subject,
        message,
        category: 'safety_weird',
        priority: 'high',
        userId: user?.uid,
        userName: user?.name,
        userRole: user?.role,
        userPhone: user?.phone,
        tripId: trip?.id || null,
        source: 'quick_report',
    });

    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'reports'), {
        type: 'quick_weird_report',
        text: `[REPORTE RÁPIDO] ${message}`,
        reportedByUid: user?.uid,
        reportedByName: user?.name,
        reportedRole: user?.role || 'client',
        tripId: trip?.id || null,
        ticketId,
        clientName: trip?.riderInfo?.name || user?.name,
        driverName: trip?.driverName || null,
        createdAt: serverTimestamp(),
    });

    return ticketId;
}

export async function fetchOpenSupportTickets(db, appId, max = 50) {
    const snap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'support_tickets'));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.status === 'open' || t.status === 'in_progress')
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        .slice(0, max);
}

export async function resolveSupportTicket(db, appId, ticketId) {
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'support_tickets', ticketId), {
        status: 'resolved',
        resolvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
}