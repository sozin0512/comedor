const HR_SW_VERSION = '2026.07.13.2';
/* HonduRaite — Service Worker + Firebase Cloud Messaging (app cerrada) */

importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyBwaRzw2R1DCFOSn-YtfM5tRLdN7p4dpk8',
    authDomain: 'comedor-86278.firebaseapp.com',
    projectId: 'comedor-86278',
    storageBucket: 'comedor-86278.firebasestorage.app',
    messagingSenderId: '1081425728323',
    appId: '1:1081425728323:web:f7fabcacc19a8f0daf15f6'
});

const messaging = firebase.messaging();
const ICON = '/icons/icon-192.png';

// Vibración fuerte HonduRaite (ofertas + demanda para activar conductores)
const HONDU_SUPER_VIBRATE = [0, 450, 100, 450, 100, 550, 120, 750, 100, 950, 150, 450];

messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || 'HonduRaite';
    const body = payload.notification?.body || payload.data?.body || '';
    const data = payload.data || {};

    const superVibrate = data.superVibrate === 'true'
        || data.type === 'freight_trip_alert'
        || data.type === 'ride_demand_alert'
        || data.type === 'trip_offer'
        || data.type === 'new_trip_staff';

    const isRideDemand = data.type === 'ride_demand_alert';
    const isTripOffer = data.type === 'trip_offer';

    return self.registration.showNotification(title, {
        body,
        icon: ICON,
        badge: ICON,
        tag: data.tag || `fcm-${data.type || 'trip'}`,
        renotify: true,
        requireInteraction: superVibrate || undefined,
        silent: false,
        data: {
            tripId: data.tripId || null,
            openChat: data.openChat === 'true',
            openDriver: data.openDriver === 'true'
                || data.type === 'trip_offer'
                || data.type === 'freight_trip_alert'
                || data.type === 'ride_demand_alert',
            openNotifications: data.openNotifications === 'true'
                || data.type === 'admin_notify'
                || data.type === 'app_update'
                || data.type === 'recurring_notify'
                || data.type === 'promo_new',
            type: data.type || '',
            tag: data.tag || '',
            serviceType: data.serviceType || ''
        },
        vibrate: superVibrate || isRideDemand || isTripOffer
            ? HONDU_SUPER_VIBRATE
            : [100, 50, 100]
    });
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
        || tag.startsWith('trip-offer-')
        || tag.startsWith('freight-alert-')
        || tag.startsWith('ride-demand-')
        || tag.startsWith('staff-trip-');
    const openChat = data.openChat === true || data.openChat === 'true';
    const openDriver = isTripOffer || data.openDriver === true || data.openDriver === 'true';
    const openAdmin = type === 'new_trip_staff' || data.openAdmin === true || data.openAdmin === 'true';
    const openNotifications = data.openNotifications === true
        || data.openNotifications === 'true'
        || type === 'admin_notify'
        || type === 'app_update'
        || type === 'recurring_notify'
        || type === 'promo_new'
        || (!openChat && !openDriver && !openAdmin);

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                client.postMessage({
                    type: 'HONDUBER_NOTIFICATION_CLICK',
                    tripId: data.tripId || null,
                    openChat,
                    openDriver,
                    openAdmin,
                    openNotifications,
                    notifType: type,
                    tag
                });
                if ('focus' in client) return client.focus();
            }
            const url = new URL(self.registration.scope);
            if (openChat) url.hash = 'chat';
            else if (openDriver) url.hash = 'driver';
            else if (openAdmin) url.hash = 'admin';
            else url.hash = 'notifications';
            return self.clients.openWindow(url.href);
        })
    );
});