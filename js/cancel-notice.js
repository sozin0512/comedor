/**
 * Aviso de viaje cancelado.
 * El listener de «mis viajes» incluye el historial. Confirmar una cancelación
 * propia solo corresponde a la acción recién hecha, no a un documento viejo
 * que vuelve en cada actualización del envío que se está siguiendo.
 */

export function planCancellationNotice({
    trip,
    uid = '',
    source = 'listener',
    watchingTripId = '',
    handledIds = null,
} = {}) {
    const id = String(trip?.id || '');
    const silent = { toast: null, bell: null, markHandled: false, finishWatching: false };
    if (!id || !trip || (trip.status && trip.status !== 'cancelled')) return silent;
    if (handledIds && typeof handledIds.has === 'function' && handledIds.has(id)) return silent;

    const own = !!(uid && trip.cancelledBy === uid);
    const watching = !!watchingTripId && watchingTripId === id;
    const fromStatus = trip.cancelledFromStatus;
    const pendingLike = fromStatus === 'pending' || fromStatus === 'scheduled';

    if (source === 'staff') {
        return {
            toast: null,
            bell: null,
            markHandled: true,
            finishWatching: watching && (pendingLike || !fromStatus),
            needsExistingSurveyPath: watching && !pendingLike && !!fromStatus,
        };
    }

    if (source === 'user-action' && own && (pendingLike || !fromStatus)) {
        return {
            toast: { message: 'Viaje cancelado correctamente.', level: 'warning' },
            bell: null,
            markHandled: true,
            finishWatching: true,
        };
    }

    if (source === 'user-action' && own) {
        return {
            toast: null,
            bell: null,
            markHandled: true,
            finishWatching: true,
            needsExistingSurveyPath: true,
        };
    }

    // Historial: yo lo cancelé y no es el viaje abierto en esta pantalla.
    if (own && !watching) {
        return {
            toast: null,
            bell: {
                id: `cancel-history-${uid || 'me'}`,
                title: 'Cancelaste un viaje',
                body: 'Quedó en tu historial. No interrumpe el envío que estás viendo.',
            },
            markHandled: true,
            finishWatching: false,
        };
    }

    if (!own && !watching) {
        return {
            toast: null,
            bell: {
                id: `cancel-${id}`,
                title: 'Un viaje fue cancelado',
                body: 'No es el envío que estás siguiendo. El aviso quedó en la campana.',
            },
            markHandled: true,
            finishWatching: false,
        };
    }

    if (pendingLike || !fromStatus) {
        return {
            toast: {
                message: own
                    ? 'Viaje cancelado correctamente.'
                    : 'El otro participante canceló el viaje.',
                level: 'warning',
            },
            bell: null,
            markHandled: true,
            finishWatching: true,
        };
    }

    return {
        toast: null,
        bell: null,
        markHandled: true,
        finishWatching: true,
        needsExistingSurveyPath: true,
    };
}
