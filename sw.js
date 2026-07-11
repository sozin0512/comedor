/* HonduRaite — Service Worker para notificaciones de viaje y chat */

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                client.postMessage({
                    type: 'HONDUBER_NOTIFICATION_CLICK',
                    tripId: data.tripId || null,
                    openChat: !!data.openChat
                });
                if ('focus' in client) return client.focus();
            }
            const url = new URL(self.registration.scope);
            if (data.openChat) url.hash = 'chat';
            return self.clients.openWindow(url.href);
        })
    );
});