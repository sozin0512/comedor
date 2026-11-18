/**
 * Botones de Waze / Google Maps y el apagado del giro a giro.
 * node --import ./scripts/import-query-register.mjs scripts/test-driver-external-nav.mjs
 */
import { APP_CONFIG } from '../js/config.js';
import {
    driverTurnByTurnEnabled, driverStageTarget, wazeAppUrl, wazeWebUrl,
    googleMapsNavUrl, offerRouteSketchSvg
} from '../js/driver-external-nav.js';

let failed = 0;
function eq(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failed += 1;
        console.error('FAIL', name, '\n  got ', actual, '\n  want', expected);
    } else console.log('PASS', name);
}

eq('giro a giro apagado', driverTurnByTurnEnabled(), false);
eq('el flag está en la config', APP_CONFIG.driverTurnByTurnEnabled, false);

const ride = { status: 'accepted', serviceType: 'auto', originLat: 14.1, originLng: -87.2, destinationLat: 14.2, destinationLng: -87.3 };
eq('hacia el pasajero', driverStageTarget(ride), { lat: 14.1, lng: -87.2, label: 'Hacia el pasajero' });
eq('hacia el negocio', driverStageTarget({ ...ride, serviceType: 'delivery', storeId: 's1' }).label, 'Hacia el negocio');
eq('hacia el destino', driverStageTarget({ ...ride, status: 'in_progress' }), { lat: 14.2, lng: -87.3, label: 'Hacia el destino' });
eq('parada', driverStageTarget({ ...ride, status: 'in_progress' }, { leg: { lat: 14.15, lng: -87.25 }, final: false }).label, 'Hacia la parada');

eq('waze app', wazeAppUrl(14.1, -87.2), 'waze://?ll=14.1,-87.2&navigate=yes');
eq('waze web', wazeWebUrl(14.1, -87.2), 'https://waze.com/ul?ll=14.1,-87.2&navigate=yes');
eq('maps', googleMapsNavUrl(14.1, -87.2), 'https://www.google.com/maps/dir/?api=1&destination=14.1,-87.2&travelmode=driving');

const svg = offerRouteSketchSvg({
    driver: { lat: 14.08, lng: -87.22 },
    pickup: { lat: 14.1, lng: -87.2 },
    destination: { lat: 14.2, lng: -87.3 }
});
eq('dibujo ámbar', svg.includes('#f59e0b'), true);
eq('dibujo verde', svg.includes('#059669'), true);

if (failed) {
    console.error(failed, 'fallaron');
    process.exit(1);
}
console.log('ok');
