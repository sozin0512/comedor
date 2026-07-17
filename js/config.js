/**
 * Configuración central de HonduRaite.
 * Edita aquí API keys, Map ID y correos de admin.
 */
export const APP_CONFIG = {
    /** Sube este número cada vez que publicas cambios (y el mismo valor en version.json). */
    appVersion: '2026.07.17.17',
    /** Push nativo Android (auto: google-services.json + paquete APK) */
    androidFcmEnabled: true,
    firebase: {
        apiKey: "AIzaSyBwaRzw2R1DCFOSn-YtfM5tRLdN7p4dpk8",
        authDomain: "comedor-86278.firebaseapp.com",
        projectId: "comedor-86278",
        storageBucket: "comedor-86278.firebasestorage.app",
        messagingSenderId: "1081425728323",
        appId: "1:1081425728323:web:f7fabcacc19a8f0daf15f6"
    },
    /** Clave Web Push (VAPID) — Firebase Console → Configuración → Cloud Messaging → Certificados web */
    messaging: {
        vapidKey: "BHHLzBz4GMpiAdNjSMZdbn9bW95nm5A25FtHDatN935Yt-S9591TdzG7BF3tI2EkZNJIbJ_6lKPr2bSNB5Jn5m4"
    },
    appId: "comayagua-vip-pro-v4",
    googleMaps: {
        // Misma clave para Maps JS API (debe tener Places, Routes y Maps habilitados)
        apiKey: "AIzaSyBcYbSDhDoijVhitHY5HXx0-NyPQaRa0Z8",
        // Map ID REAL (proporcionado por usuario)
        mapId: "8dc612e600a3cf29755af4fe",
        defaultCenter: { lat: 14.4513, lng: -87.6374 },
        countryRestriction: ["hn"],
        // Máximo permitido por Places API (metros)
        locationBiasRadius: 50000
    },
    serviceZones: {
        enabled: true,
        defaultZoneId: "comayagua",
        allowManualZoneSelection: true,
        alwaysShowZonePicker: true,
        forceManualIfOutsideCountryKm: 200,
        /** Radio inicial para ofertas: solo conductores en línea MUY cerca del pasajero. */
        tripOfferNearRadiusKm: 8,
        /** Cobertura fija por ciudad (km desde el centro). No configurable por el usuario. */
        defaultCityCoverageKm: 14,
        cityCoverageKm: {
            comayagua: 25,
            siguatepeque: 14,
            tegucigalpa: 22,
            comayaguela: 22,
            "san-pedro-sula": 22,
            choloma: 16,
            "la-ceiba": 18,
            "la-lima": 14,
            danli: 14,
            choluteca: 16,
            "santa-rosa-copan": 12,
            roatan: 12,
            utila: 10,
            talanga: 12,
            "valle-angeles": 10
        }
    },
    /** Único admin de la app (permisos supremos). No se puede asignar desde la app; solo este correo. */
    adminEmails: ["josuesoza0513@gmail.com"],
    commissionPercent: 25, // 25% (referencia Uber: históricamente 25%, efectiva ~25-42% según estudios 2025-26). Misma comisión se aplica a viajes estándar y reservas por horas.
    referrals: {
        /** Quien ingresa con código — al meter el código (registro) */
        newUserAmount: 20,
        /** Quien compartió el código — cuando el referido completa su primer viaje */
        referrerAmount: 50
    },
    support: {
        whatsapp: '50495733866',
        label: 'Soporte HonduRaite',
        hours: '24/7',
    },
};