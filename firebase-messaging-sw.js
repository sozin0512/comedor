const HR_SW_VERSION = '2026.08.03.8';
/* HonduRaite — Service Worker + FCM: TODAS las notificaciones emergentes tipo Temu */

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

// Vibración fuerte estilo Temu (todas las notificaciones)
const HONDU_TEMU_VIBRATE = [0, 500, 80, 500, 80, 600, 100, 800, 80, 1000, 150, 500];

messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || 'HonduRaite';
    const body = payload.notification?.body || payload.data?.body || '';
    const data = payload.data || {};
    const type = String(data.type || '');
    const tag = String(data.tag || `fcm-${type || 'alert'}`);

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

    // Si hay pestaña abierta (Safari/PWA), pedir que suene el tono HonduRaite custom
    // (el SO en background solo permite ding del sistema; el custom va por Web Audio en la página)
    const notifyClientsPlayTone = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
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

    // Siempre emergente: requireInteraction + renotify + vibración fuerte
    // silent:false → Safari suena (tono del sistema) aunque la pestaña esté en 2.º plano
    return Promise.all([
        notifyClientsPlayTone,
        self.registration.showNotification(title, {
            body,
            icon: ICON,
            badge: ICON,
            tag,
            renotify: true,
            requireInteraction: true,
            silent: false,
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
                // Para que al abrir el aviso el cliente pueda tocar el tono Hondu
                toneEvent: data.toneEvent || null
            },
            vibrate: HONDU_TEMU_VIBRATE
        })
    ]);
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
                    // Al tocar el aviso: reproducir tono Hondu (gesto de usuario en Safari)
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
