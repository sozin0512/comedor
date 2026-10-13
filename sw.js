/* HonduRaite — SW de respaldo.
 * El push vive en firebase-messaging-sw.js. Si iOS deja sw.js como controlador,
 * importScripts copia esos listeners (sin esto el push no muestra aviso y Safari revoca el permiso).
 */
try {
    importScripts('/firebase-messaging-sw.js');
} catch (e) {
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
    self.addEventListener('push', (event) => {
        event.waitUntil(
            self.registration.showNotification('HonduRaite', {
                body: 'Tienes un aviso nuevo.',
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png'
            })
        );
    });
}
