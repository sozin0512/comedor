/**
 * Hub aeropuerto: el contenido ya está en el HTML.
 * Si el visitante comparte GPS, solo marcamos la tarjeta más cercana.
 */
(function () {
    const airports = {
        tgu: { lat: 14.0609, lng: -87.2172 },
        xpl: { lat: 14.3824, lng: -87.6212 },
        sap: { lat: 15.4526, lng: -87.9235 },
        rtb: { lat: 16.3167, lng: -86.5231 },
        lce: { lat: 15.7425, lng: -86.8531 },
    };

    function km(aLat, aLng, bLat, bLng) {
        const R = 6371;
        const dLat = (bLat - aLat) * Math.PI / 180;
        const dLng = (bLng - aLng) * Math.PI / 180;
        const x = Math.sin(dLat / 2) ** 2
            + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    }

    function nearest(lat, lng) {
        let key = 'tgu';
        let best = Infinity;
        Object.keys(airports).forEach((id) => {
            const d = km(lat, lng, airports[id].lat, airports[id].lng);
            if (d < best) { best = d; key = id; }
        });
        return key;
    }

    function mark(id) {
        document.querySelectorAll('[data-airport]').forEach((el) => {
            el.classList.toggle('is-nearest', el.getAttribute('data-airport') === id);
        });
        const hint = document.getElementById('gps-hint');
        const names = {
            tgu: 'Toncontín (Tegucigalpa)',
            xpl: 'Palmerola (Comayagua)',
            sap: 'San Pedro Sula (SAP)',
            rtb: 'Roatán (RTB)',
            lce: 'La Ceiba (LCE)',
        };
        if (hint && names[id]) {
            hint.textContent = 'Según tu ubicación, el aeropuerto más cercano parece ser ' + names[id] + '. Puedes abrir cualquiera.';
        }
    }

    const params = new URLSearchParams(location.search || '');
    const fromQuery = (params.get('aero') || '').toLowerCase();
    if (airports[fromQuery]) mark(fromQuery);

    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => mark(nearest(pos.coords.latitude, pos.coords.longitude)),
        () => {},
        { timeout: 6000, maximumAge: 300000 }
    );
})();
