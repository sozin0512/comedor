/**
 * Aviso destacado de ubicación (Google Play · "Prominent disclosure").
 *
 * Se muestra ANTES de empezar a mandar la ubicación cuando la app puede seguir usándola con la
 * pantalla apagada o en otra app (servicio en primer plano con notificación visible):
 *   - conductor: al ponerse En línea (startDriverLocationTracking)
 *   - pasajero: al compartir su ubicación en vivo durante un viaje (startPassengerLiveLocationSharing)
 *
 * La aceptación se guarda por rol y versión del texto (localStorage). Si cambia el texto, sube VERSION.
 */

const VERSION = 1;
const KEY = (role) => `hr_loc_disclosure_v${VERSION}_${role === 'driver' ? 'driver' : 'client'}`;
const DECLINED = (role) => `hr_loc_disclosure_declined_${role === 'driver' ? 'driver' : 'client'}`;
let pending = null;

export const LOCATION_DISCLOSURE_TEXT = {
    driver: {
        title: 'Uso de tu ubicación',
        lead: 'HonduRaite recopila los datos de tu ubicación para mostrarte viajes cercanos, asignarte pasajeros, '
            + 'mostrar tu posición al pasajero durante el viaje, calcular la distancia y la tarifa, y por tu seguridad, '
            + '<b>incluso cuando la app está cerrada o no se está usando</b>, mientras estés <b>En línea</b> o en un viaje.',
        bullets: [
            'Se comparte con el pasajero de tu viaje y con los supervisores de HonduRaite. No se vende ni se usa para publicidad.',
            'Mientras se usa verás la notificación «HonduRaite activo» o «Viaje en curso».',
            'Deja de enviarse cuando te pones en <b>Pausa</b> o cierras sesión.',
            'Se guarda tu última posición y la ruta de cada viaje (ver Política de privacidad).'
        ],
        accept: 'Aceptar y ponerme en línea',
        decline: 'Ahora no'
    },
    client: {
        title: 'Compartir tu ubicación en el viaje',
        lead: 'HonduRaite recopila los datos de tu ubicación para que el conductor te encuentre en la recogida y '
            + 'para seguir el viaje en el mapa por tu seguridad, <b>incluso cuando la app está cerrada o no se está usando</b>, '
            + 'solo mientras tengas un viaje activo.',
        bullets: [
            'Se comparte con el conductor de tu viaje y con los supervisores de HonduRaite. No se vende ni se usa para publicidad.',
            'Deja de enviarse cuando el viaje termina o se cancela.',
            'Si no aceptas, puedes pedir viajes igual: el conductor solo verá el punto de recogida que marcaste.'
        ],
        accept: 'Aceptar',
        decline: 'No compartir'
    }
};

export function hasLocationDisclosure(role) {
    try { return !!localStorage.getItem(KEY(role)); } catch (_) { return false; }
}

/**
 * Muestra el aviso. Devuelve true si la persona acepta (o ya había aceptado y no es `force`).
 * `infoOnly`: solo informativo (desde Privacidad y cuenta), con un botón de cerrar.
 */
export function showLocationDisclosure({ role = 'client', force = false, infoOnly = false } = {}) {
    const r = role === 'driver' ? 'driver' : 'client';
    if (!force && hasLocationDisclosure(r)) return Promise.resolve(true);
    if (!force && !infoOnly) {
        try { if (sessionStorage.getItem(DECLINED(r))) return Promise.resolve(false); } catch (_) {}
    }
    if (pending) return pending;
    const t = LOCATION_DISCLOSURE_TEXT[r];
    pending = new Promise((resolve) => {
        const bg = document.createElement('div');
        bg.className = 'hr-loc-disclosure';
        bg.setAttribute('role', 'dialog');
        bg.setAttribute('aria-modal', 'true');
        bg.setAttribute('aria-labelledby', 'hr-loc-title');
        bg.style.cssText = 'position:fixed;inset:0;z-index:70000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.6)';
        const accepted = hasLocationDisclosure(r);
        bg.innerHTML = `
          <div style="width:100%;max-width:420px;max-height:90vh;overflow:auto;background:#fff;color:#0f172a;border-radius:20px;padding:20px;box-shadow:0 20px 40px rgba(0,0,0,.3)">
            <div style="font-size:34px;line-height:1;margin-bottom:6px" aria-hidden="true">📍</div>
            <h3 id="hr-loc-title" style="font-size:18px;font-weight:900;margin:0 0 8px">${t.title}</h3>
            <p style="font-size:14px;line-height:1.45;margin:0 0 10px">${t.lead}</p>
            <ul style="font-size:12.5px;line-height:1.45;color:#334155;margin:0 0 12px;padding-left:18px;list-style:disc">
              ${t.bullets.map((b) => `<li style="margin:3px 0">${b}</li>`).join('')}
            </ul>
            <p style="font-size:11.5px;color:#64748b;margin:0 0 14px">Más detalle en la <a href="https://honduraite.com/politica-de-privacidad.html#ubicacion" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:underline">Política de privacidad</a>.${accepted ? ' <b>Ya lo aceptaste en este teléfono.</b>' : ''}</p>
            ${infoOnly
                ? '<button type="button" data-ok style="width:100%;min-height:46px;border:0;border-radius:14px;background:#2563eb;color:#fff;font-weight:900">Entendido</button>'
                : `<button type="button" data-ok style="width:100%;min-height:46px;border:0;border-radius:14px;background:#2563eb;color:#fff;font-weight:900">${t.accept}</button>
                   <button type="button" data-no style="width:100%;min-height:42px;margin-top:8px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;color:#334155;font-weight:800">${t.decline}</button>`}
          </div>`;
        const done = (ok) => {
            try { bg.remove(); } catch (_) {}
            pending = null;
            if (!infoOnly) {
                try {
                    if (ok) { localStorage.setItem(KEY(r), String(Date.now())); sessionStorage.removeItem(DECLINED(r)); }
                    else sessionStorage.setItem(DECLINED(r), '1');
                } catch (_) {}
            }
            resolve(infoOnly ? accepted : ok);
        };
        bg.querySelector('[data-ok]').addEventListener('click', () => done(true));
        bg.querySelector('[data-no]')?.addEventListener('click', () => done(false));
        (document.body || document.documentElement).appendChild(bg);
        try { bg.querySelector('[data-ok]').focus(); } catch (_) {}
    });
    return pending;
}

if (typeof window !== 'undefined') {
    window.showLocationDisclosure = showLocationDisclosure;
    window.hasLocationDisclosure = hasLocationDisclosure;
}
