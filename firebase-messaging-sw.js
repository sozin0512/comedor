const HR_SW_VERSION = '2026.10.11.6';
/* HonduRaite — Service Worker de Web Push.
 *
 * No inicializar firebase.messaging() aquí: el SDK registra su propio
 * listener de `push` y en iOS, si ese handler no llama showNotification
 * (o rechaza por vibrate/requireInteraction), Safari REVOCA el permiso.
 * El token FCM se obtiene en la página con getToken({ serviceWorkerRegistration }).
 */

const ICON = '/icons/icon-192.png';
const recentShownTags = new Set();

function parsePushPayload(event) {
    if (!event?.data) return {};
    try {
        const json = event.data.json();
        if (json && typeof json === 'object') return json;
    } catch (_) {}
    try {
        const text = event.data.text();
        if (!text) return {};
        try {
            return JSON.parse(text);
        } catch (_) {
            return { notification: { title: 'HonduRaite', body: String(text).slice(0, 180) } };
        }
    } catch (_) {}
    return {};
}

function showSafeNotification(title, options) {
    const safeTitle = String(title || 'HonduRaite').slice(0, 80) || 'HonduRaite';
    const safeBody = String(options?.body || 'Tienes un aviso nuevo.').slice(0, 180) || 'Tienes un aviso nuevo.';
    const iosSafe = {
        body: safeBody,
        icon: ICON,
        badge: ICON,
        tag: options?.tag || 'honduber-alert',
        data: options?.data || {}
    };
    // iOS rechaza vibrate / renotify / requireInteraction y revoca el push.
    return self.registration.showNotification(safeTitle, iosSafe).catch(() =>
        self.registration.showNotification(safeTitle, { body: safeBody, icon: ICON, badge: ICON })
    );
}

function presentHonduNotification(payload) {
    payload = payload || {};
    const data = payload.data || {};
    const title = payload.notification?.title || data.title || payload.title || 'HonduRaite';
    const body = payload.notification?.body || data.body || payload.body || 'Tienes un aviso nuevo.';
    const type = String(data.type || '');
    const tag = String(data.tag || `fcm-${type || 'alert'}`);
    const dedupKey = `${tag}|${title}|${body}`;
    const already = recentShownTags.has(dedupKey);
    if (!already) {
        recentShownTags.add(dedupKey);
        setTimeout(() => recentShownTags.delete(dedupKey), 8000);
    }

    const isPassengerTrip = type === 'driver_bid'
        || type === 'trip_accepted'
        || type === 'trip_arrived'
        || data.openPassenger === 'true'
        || data.openClient === 'true';
    const openDriver = data.openDriver === 'true'
        || type === 'trip_offer'
        || type === 'freight_trip_alert'
        || type === 'ride_demand_alert'
        || type === 'passenger_counter'
        || type === 'trip_price_boost'
        || type === 'trip_started'
        || type === 'new_trip_staff';

    if (!already) {
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clients) => {
                clients.forEach((client) => {
                    try {
                        client.postMessage({
                            type: 'HONDUBER_PLAY_TONE',
                            pushData: data,
                            notifType: type,
                            tag,
                            title,
                            body
                        });
                    } catch (_) {}
                });
            })
            .catch(() => {});
    }

    const options = {
        body,
        tag,
        data: {
            tripId: data.tripId || null,
            openChat: data.openChat === 'true',
            openDriver,
            openPassenger: isPassengerTrip,
            openClient: isPassengerTrip,
            openAdmin: data.openAdmin === 'true' || type === 'new_trip_staff',
            openDeposit: data.openDeposit === 'true' || type === 'deposit_reminder'
                || String(tag || '').startsWith('deposit-reminder-'),
            openNotifications: data.openNotifications === 'true'
                || type === 'admin_notify'
                || type === 'app_update'
                || type === 'recurring_notify'
                || type === 'promo_new',
            type,
            tag,
            amount: data.amount || '',
            serviceType: data.serviceType || '',
            toneEvent: data.toneEvent || null
        }
    };

    // Siempre showNotification: iOS revoca el push si el evento termina sin él.
    return showSafeNotification(title, options);
}

self.addEventListener('push', (event) => {
    event.waitUntil((async () => {
        let payload = {};
        try {
            payload = parsePushPayload(event);
        } catch (_) {
            payload = {};
        }
        try {
            await presentHonduNotification(payload);
        } catch (_) {
            await showSafeNotification('HonduRaite', { body: 'Tienes un aviso nuevo.' });
        }
    })());
});

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    const type = String(data.type || '');
    const tag = String(data.tag || '');
    const isTripOffer = type === 'trip_offer'
        || type === 'freight_trip_alert'
        || type === 'ride_demand_alert'
        || type === 'new_trip_staff'
        || type === 'passenger_counter'
        || type === 'trip_price_boost'
        || type === 'trip_started'
        || tag.startsWith('trip-offer-')
        || tag.startsWith('freight-alert-')
        || tag.startsWith('ride-demand-')
        || tag.startsWith('staff-trip-')
        || tag.startsWith('passenger-counter-')
        || tag.startsWith('trip-price-boost-');
    const openChat = data.openChat === true || data.openChat === 'true';
    const openDriver = isTripOffer || data.openDriver === true || data.openDriver === 'true';
    const openPassenger = type === 'driver_bid'
        || type === 'trip_accepted'
        || type === 'trip_arrived'
        || data.openPassenger === true
        || data.openPassenger === 'true'
        || data.openClient === true
        || data.openClient === 'true'
        || tag.startsWith('driver-bid-')
        || tag.startsWith('trip-accepted-')
        || tag.startsWith('trip-arrived-');
    const openAdmin = type === 'new_trip_staff' || data.openAdmin === true || data.openAdmin === 'true';
    const openDeposit = type === 'deposit_reminder'
        || data.openDeposit === true
        || data.openDeposit === 'true'
        || tag.startsWith('deposit-reminder-');
    const openNotifications = !openDeposit && (
        data.openNotifications === true
        || data.openNotifications === 'true'
        || type === 'admin_notify'
        || type === 'app_update'
        || type === 'recurring_notify'
        || type === 'promo_new'
        || (!openChat && !openDriver && !openPassenger && !openAdmin)
    );

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                client.postMessage({
                    type: 'HONDUBER_NOTIFICATION_CLICK',
                    tripId: data.tripId || null,
                    openChat,
                    openDriver,
                    openPassenger,
                    openAdmin,
                    openDeposit,
                    openNotifications,
                    amount: data.amount || '',
                    notifType: type,
                    tag,
                    playTone: true,
                    toneEvent: data.toneEvent || null,
                    pushData: data
                });
                if ('focus' in client) return client.focus();
            }
            const url = new URL(self.registration.scope);
            if (openChat) url.hash = 'chat';
            else if (openDeposit) url.hash = 'deposit';
            else if (openDriver) url.hash = 'driver';
            else if (openPassenger) url.hash = 'client';
            else if (openAdmin) url.hash = 'admin';
            else url.hash = 'notifications';
            return self.clients.openWindow(url.href);
        })
    );
});
