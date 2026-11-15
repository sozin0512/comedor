/**
 * Quién puede tomar cada categoría de Viaje, y la tarifa por categoría.
 * node --import ./scripts/import-query-register.mjs scripts/test-ride-categories.mjs
 */
import { createRequire } from 'node:module';
import {
    driverQualifiesForCategory,
    categoryAvailability,
    quoteCategoryFare,
    driverRideCategory,
    registeredCardFlags,
    rideCardIsOff,
    firstSelectableCard,
    rideCategoryLabel
} from '../js/ride-category-offer.js';

const require = createRequire(import.meta.url);
const server = require('../functions/ride-category-offer.js');

let failed = 0;
function eq(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failed += 1;
        console.error('FAIL', name, '\n  got ', actual, '\n  want', expected);
    } else console.log('PASS', name);
}

const economico = { vehicleType: 'auto', vehicleYear: 2012, hasAC: false, seats: 4 };
const confort = { vehicleType: 'auto', vehicleYear: 2018, hasAC: true, seats: 4 };
const familiar = { vehicleType: 'auto', vehicleYear: 2019, hasAC: true, seats: 7 };
const vip = { vehicleType: 'auto', vehicleYear: 2022, hasAC: true, seats: 4 };
const sinDatos = { vehicleType: 'auto' };
const moto = { vehicleType: 'moto', vehicleYear: 2020, hasAC: false, seats: 2 };
const taxi = { vehicleType: 'taxi', vehicleYear: 2010, hasAC: true, seats: 4 };

eq('sin datos solo es económico', driverRideCategory(sinDatos), null);
eq('2018 con aire es confort', driverRideCategory(confort), 'confort');
eq('7 asientos es familiar', driverRideCategory(familiar), 'familiar');
eq('2022 es vip', driverRideCategory(vip), 'vip');

eq('económico: cualquier carro', driverQualifiesForCategory(sinDatos, 'economico'), true);
eq('económico: también un VIP', driverQualifiesForCategory(vip, 'economico'), true);
eq('económico: el taxi tradicional no', driverQualifiesForCategory(taxi, 'economico'), false);
eq('económico: un Taxi VIP sí', driverQualifiesForCategory({ vehicleType: 'taxi_vip', vehicleYear: 2014, seats: 4 }, 'economico'), true);
eq('económico: moto no', driverQualifiesForCategory(moto, 'economico'), false);
eq('confort solo quien califica', driverQualifiesForCategory(confort, 'confort'), true);
eq('sin datos no toma confort', driverQualifiesForCategory(sinDatos, 'confort'), false);
eq('vip no toma confort', driverQualifiesForCategory(vip, 'confort'), false);
eq('familiar solo 6-7 asientos', driverQualifiesForCategory(familiar, 'familiar'), true);
eq('moto solo motos', driverQualifiesForCategory(moto, 'moto'), true);
eq('carro no toma moto', driverQualifiesForCategory(confort, 'moto'), false);

const flags = categoryAvailability([confort, moto], null, { known: true });
eq('económico nunca se apaga', flags.economico, true);
eq('confort disponible', flags.confort, true);
eq('familiar en gris', flags.familiar, false);
eq('vip en gris', flags.vip, false);
eq('moto disponible', flags.moto, true);
eq('sin datos del mapa no se apaga nada', categoryAvailability([], null, { known: false }).vip, true);

eq('tarifa de fábrica 5 km', quoteCategoryFare(null, 'confort', 5), 37 + 22 * 5);
eq('sin fila propia usa Taxi VIP', quoteCategoryFare({ auto: { base: 0, perKm: 19 } }, 'economico', 6.6357142857), 126.08);
eq('confort sin fila tampoco pasa a Taxi VIP', quoteCategoryFare({ auto: { base: 0, perKm: 19 } }, 'confort', 6.6357142857), 126.08);
eq('servidor: económico sin fila = Taxi VIP', server.quoteCategoryFare({ auto: { base: 0, perKm: 19 } }, 'economico', 6.6357142857), 126.08);
eq('el admin puede cambiar confort', quoteCategoryFare({ confort: { base: 50, perKm: 10 } }, 'confort', 5), 100);
eq('servidor cobra igual', server.quoteCategoryFare({ familiar: { base: 40, perKm: 8 } }, 'familiar', 5), 80);
eq('servidor: sin datos no es confort', server.driverQualifiesForCategory(sinDatos, 'confort'), false);
eq('servidor: económico para todo Taxi VIP', server.driverQualifiesForCategory(sinDatos, 'economico'), true);
eq('servidor: taxi tradicional no', server.driverQualifiesForCategory(taxi, 'economico'), false);
eq('servidor: familiar', server.driverQualifiesForCategory(familiar, 'familiar'), true);
eq('la corona se muestra como Premium', rideCategoryLabel('vip'), 'Premium');
const flagsCiudad = registeredCardFlags({ moto: 2, car: 4, confort: 1, familiar: 0, vip: 0 });
eq('sin familiar registrado', flagsCiudad.familiar, false);
eq('sin premium registrado', flagsCiudad.vip, false);
eq('económico si hay carros', flagsCiudad.economico, true);
eq('taxi vip si hay carros', flagsCiudad.taxi_vip, true);
eq('familiar gris sin registro', rideCardIsOff('familiar', { registeredFlags: flagsCiudad, registeredKnown: true }), true);
eq('premium gris sin registro', rideCardIsOff('vip', { registeredFlags: flagsCiudad, registeredKnown: true }), true);
eq('confort gris si nadie está en línea', rideCardIsOff('confort', {
    registeredFlags: flagsCiudad, registeredKnown: true, onlineKnown: true, onlineFlags: { confort: false }
}), true);
eq('primera disponible salta el gris', firstSelectableCard(['familiar', 'vip', 'economico'], (id) => id !== 'economico'), 'economico');

if (failed) {
    console.error(`${failed} pruebas fallaron`);
    process.exit(1);
}
console.log('Todas las pruebas de categorías pasaron');
