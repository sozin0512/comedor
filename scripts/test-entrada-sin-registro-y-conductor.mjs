import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = '/workspace/honduraite-sonido';
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

console.log('=== TEST: Entrada sin registro obligatorio + Quiero ser conductor en el panel ===');

// 0. Syntax check of all js/*.js modules
{
    const jsDir = path.join(root, 'js');
    const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
    for (const f of files) {
        const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
        new vm.SourceTextModule(src, { identifier: f });
    }
    console.log(`✓ [0] Sintaxis ES Module verificada en ${files.length} módulos js/*.js`);
}

// 1. Unauthenticated startup enters #app-interface directly in guest browse mode without blocking on #login-screen
{
    const indexHtml = read('index.html');
    const authBoot = read('js/auth-boot.js');
    const appJs = read('js/app.js');

    assert.match(
        indexHtml,
        /<div id="login-screen"[^>]*style="display:\s*none;?"/,
        'index.html debe ocultar #login-screen por defecto para no bloquear el inicio sin registro'
    );
    assert.match(
        indexHtml,
        /id="login-close-guest-btn"/,
        'index.html debe tener el botón #login-close-guest-btn para cerrar el login y explorar sin cuenta'
    );
    assert.match(
        indexHtml,
        /id="login-service-reason-banner"/,
        'index.html debe tener #login-service-reason-banner para explicar por qué se pide cuenta al usar un servicio'
    );
    assert.match(
        authBoot,
        /function enterGuestBrowseMode\(\)/,
        'js/auth-boot.js debe definir enterGuestBrowseMode()'
    );
    assert.match(
        authBoot,
        /if \(!creds\?\.identifier \|\| !creds\?\.password\)\s*\{\s*enterGuestBrowseMode\(\);\s*return;\s*\}/,
        'js/auth-boot.js debe entrar a enterGuestBrowseMode() cuando no hay credenciales guardadas'
    );
    assert.match(
        appJs,
        /function enterGuestBrowseSession\(\)/,
        'js/app.js debe definir enterGuestBrowseSession() cuando !user en onAuthStateChanged'
    );
    console.log('✓ [1] Inicio directo en Modo Invitado (sin pantalla de registro obligatoria) verificado');
}

// 2. Guest can browse map, quote a ride, and open Tiendas / view products
{
    const appJs = read('js/app.js');
    const storesJs = read('js/merchant-stores.js');

    assert.match(
        appJs,
        /function enterGuestBrowseSession\(\)[\s\S]*?loadHeavyUiAfterAuth\(\)/,
        'enterGuestBrowseSession() debe cargar loadHeavyUiAfterAuth() para habilitar Tiendas y tarifas a invitados'
    );
    assert.match(
        storesJs,
        /startStoresListener\(\);\s*startRecentStoreDeliveriesListener\(\);\s*startFireZonesAutoRefreshInterval\(\);/,
        'initMerchantStores debe iniciar los listeners públicos de tiendas y zonas en fuego también para invitados'
    );
    console.log('✓ [2] Exploración libre de mapa, cotización de tarifas y catálogo de Tiendas para invitados verificada');
}

// 3. Tapping "Pedir viaje" or "Confirmar pedido" as a guest triggers window.requireAuthForService(...)
{
    const appJs = read('js/app.js');
    const storesJs = read('js/merchant-stores.js');

    assert.match(
        appJs,
        /window\.requireAuthForService\s*=\s*function\s*\(reasonText/,
        'js/app.js debe exponer window.requireAuthForService(reasonText, options)'
    );
    assert.match(
        appJs,
        /window\.sendTripRequest\s*=\s*async\s*\(\)\s*=>\s*\{\s*if\s*\(!currentUser\)\s*\{\s*window\.requireAuthForService\('pedir tu viaje o envío'/,
        'window.sendTripRequest debe pedir cuenta con window.requireAuthForService cuando !currentUser'
    );
    assert.match(
        storesJs,
        /async function placeOrder\(\)[\s\S]*?if\s*\(!user\?\.uid\)\s*\{\s*if\s*\(typeof window\.requireAuthForService === 'function'\)\s*\{\s*window\.requireAuthForService\('enviar tu pedido en Tiendas'/,
        'placeOrder() en Tiendas debe pedir cuenta con window.requireAuthForService cuando !user?.uid conservando el carrito'
    );
    console.log('✓ [3] Solicitud de registro/login bajo demanda SOLO al usar un servicio (viaje o pedido) verificada');
}

// 4. "Quiero ser conductor" button & Lado de Conductor right in the main panel
{
    const homeJs = read('js/passenger-home.js');
    const appJs = read('js/app.js');

    assert.doesNotMatch(
        homeJs,
        /id="panel-side-switcher"|id="guest-welcome-auth-bar"/,
        'passenger-home.js debe conservar intacto el diseño limpio de #passenger-home-hub sin barras extras arriba'
    );
    assert.match(
        homeJs,
        /id="want-to-be-driver-card"/,
        'passenger-home.js debe incluir la tarjeta #want-to-be-driver-card en el panel principal'
    );
    assert.match(
        homeJs,
        /id="btn-want-to-be-driver"[^>]*data-home-action="want-to-be-driver"/,
        'passenger-home.js debe incluir el botón #btn-want-to-be-driver ("Quiero ser conductor")'
    );
    assert.match(
        appJs,
        /window\.openWantToBeDriverFlow\s*=\s*function/,
        'js/app.js debe definir window.openWantToBeDriverFlow para abrir el flujo de registro de conductor a invitados y pasajeros'
    );
    assert.match(
        appJs,
        /!!existingProfile\.allowSwitchToDriver \|\| !!window\._openedDriverSetupFromPanel/,
        'saveProfile debe permitir que un pasajero registre su vehículo desde Quiero ser conductor en el panel'
    );
    console.log('✓ [4] Sección y botón "🚗 Quiero ser conductor" en el panel principal verificados');
}

// 5. firestore.rules allows public read of stores (adultsOnly == false) and store_products for guest browsing
{
    const rules = read('firestore.rules');

    assert.match(
        rules,
        /match \/artifacts\/\{app\}\/public\/data\/stores\/\{storeId\}[\s\S]*?allow get, list: if resource\.data\.adultsOnly == false \|\|/,
        'firestore.rules debe permitir lectura pública de tiendas con adultsOnly == false'
    );
    assert.match(
        rules,
        /match \/artifacts\/\{app\}\/public\/data\/store_products\/\{productId\}\s*\{\s*allow read: if true;/,
        'firestore.rules debe permitir lectura pública de store_products para que invitados vean menús'
    );
    console.log('✓ [5] Reglas de Firestore para exploración de tiendas y tarifas en modo invitado verificadas');
}

console.log('\n🎉 TODOS LOS TESTS DE ENTRADA SIN REGISTRO + QUIERO SER CONDUCTOR PASARON EXITOSAMENTE');
