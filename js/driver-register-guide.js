/**
 * Guía completa de registro de conductor.
 * Se abre la primera vez en el formulario y se puede repetir con el botón Guía.
 */

const STORAGE_KEY = 'hr-driver-register-guide-v1-seen';
const ROOT_ID = 'driver-register-guide';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function currentVehicleType() {
    return document.getElementById('driver-vehicle-type')?.value || 'auto';
}

function isAddVehicleMode() {
    return window.driverVehicleSetupMode === 'add';
}

function typeMeta(type) {
    const map = {
        auto: { icon: 'fa-car', label: 'Automóvil', of: 'del automóvil', hint: 'Viajes en carro particular.' },
        taxi: { icon: 'fa-taxi', label: 'Taxi', of: 'del taxi', hint: 'Placa oficial T- (ej. T-1234).' },
        moto: { icon: 'fa-motorcycle', label: 'Motocicleta', of: 'de la moto', hint: 'Casco tuyo + casco para el pasajero.' },
        paila: { icon: 'fa-truck-pickup', label: 'Paila', of: 'de la paila', hint: 'Fletes. Indica capacidad de carga.' },
        camion: { icon: 'fa-truck', label: 'Camión', of: 'del camión', hint: 'Fletes pesados. Indica toneladas.' },
        grua: { icon: 'icon-grua', label: 'Grúa', of: 'de la grúa', hint: 'Remolque y auxilio vial.' }
    };
    return map[type] || map.auto;
}

function photoItems(type) {
    if (type === 'moto') {
        return [
            'Foto tuya <b>con el casco puesto</b>',
            'Casco del conductor: general, por dentro y verificación (3)',
            'Casco para pasajeros: afuera y por dentro (2)',
            'Exterior de la moto: frente y atrás (2)',
            'Foto de la placa, bien legible'
        ];
    }
    if (type === 'taxi') {
        return [
            'Interior: asientos, tablero/taxímetro y maletero (3)',
            'Exterior: frente y atrás (2)',
            'Foto de la placa T- oficial, bien legible'
        ];
    }
    if (type === 'paila') {
        return [
            'Cabina, caja/paila y carga vacía (3)',
            'Exterior: frente y atrás (2)',
            'Foto de la placa, bien legible'
        ];
    }
    if (type === 'camion') {
        return [
            'Cabina, furgón/plataforma y lateral de carga (3)',
            'Exterior: frente y atrás (2)',
            'Foto de la placa, bien legible'
        ];
    }
    if (type === 'grua') {
        return [
            'Cabina, equipo/pluma y remolque/gancho (3)',
            'Exterior: frente y atrás (2)',
            'Foto de la placa, bien legible'
        ];
    }
    return [
        'Interior: asientos, tablero y maletero (3)',
        'Exterior: frente y atrás (2)',
        'Foto de la placa, bien legible'
    ];
}

function li(items) {
    return `<ul class="drv-guide-list">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}

function yesNo(yes, no) {
    return `<div class="drv-guide-yn">
        <div class="drv-guide-yn-col drv-guide-yn-yes"><p>Sí</p><ul>${yes.map((x) => `<li>${x}</li>`).join('')}</ul></div>
        <div class="drv-guide-yn-col drv-guide-yn-no"><p>No</p><ul>${no.map((x) => `<li>${x}</li>`).join('')}</ul></div>
    </div>`;
}

function typePickerHtml(selected) {
    const types = ['auto', 'taxi', 'moto', 'paila', 'camion', 'grua'];
    return `<div class="drv-guide-types" role="group" aria-label="Tipo de vehículo">
        ${types.map((t) => {
            const m = typeMeta(t);
            const iconClass = m.icon.startsWith('icon-') ? m.icon : `fas ${m.icon}`;
            return `<button type="button" class="drv-guide-type${t === selected ? ' is-on' : ''}" data-guide-pick-type="${t}">
                <i class="${iconClass}"></i><span>${esc(m.label)}</span>
            </button>`;
        }).join('')}
    </div>
    <p class="drv-guide-note">${esc(typeMeta(selected).hint)}</p>`;
}

function buildSteps() {
    const add = isAddVehicleMode();
    const type = currentVehicleType();
    const t = typeMeta(type);
    const steps = [];

    if (!add) {
        steps.push({
            id: 'welcome',
            section: null,
            icon: 'fa-id-card',
            title: 'Guía de registro de conductor',
            body: `<p>HonduRaite revisa tus fotos y papeles antes de que puedas recibir viajes. Ten esto listo (vigente, nítido, a color). Un supervisor aprueba; los documentos duran 6 meses.</p>
                ${li([
                    'Selfie de tu rostro (sin gorra ni gafas de sol)',
                    'DNI / tarjeta de identidad',
                    'Licencia de conducir: <b>frente y revés</b>',
                    'Revisión vehicular de Honduras',
                    'Antecedentes <b>penales (PEN)</b> y <b>policiales</b>',
                    'El vehículo a la mano (placa legible)',
                    'WhatsApp tuyo y uno de emergencia',
                    'Si es taxi: placa oficial <b>T-</b>',
                    'Si es moto: casco tuyo + casco para el pasajero'
                ])}`
        });
    } else {
        steps.push({
            id: 'welcome-add',
            section: 'type',
            icon: 'fa-plus-circle',
            title: 'Agregar otro vehículo',
            body: `<p>Este vehículo entra en revisión aparte. No cambia tu cuenta, solo suma una unidad.</p>
                ${li([
                    'Datos del vehículo (marca, placa, licencia, revisión)',
                    ...photoItems(type),
                    'Licencia frente y revés + foto de la revisión vehicular'
                ])}`
        });
    }

    steps.push({
        id: 'type',
        section: 'type',
        icon: t.icon,
        title: '1. Elige qué vas a manejar',
        body: `<p>Toca el tipo. Las fotos que pedimos cambian según eso.</p>
            ${typePickerHtml(type)}
            ${li([
                '<b>Auto:</b> viajes en carro.',
                '<b>Taxi:</b> placa T- oficial (ej. T-1234). Si no es T-, no te llegan viajes de taxi tradicional.',
                '<b>Moto:</b> casco obligatorio (campaña Moto Segura).',
                '<b>Paila / camión / grúa:</b> fletes o auxilio. Indica capacidad de carga.'
            ])}`
    });

    if (!add) {
        steps.push({
            id: 'face',
            section: 'face',
            icon: 'fa-user',
            title: '2. Foto de tu rostro',
            body: `<p>Selfie clara. El supervisor la compara con tu licencia y DNI.</p>
                ${yesNo(
                    ['De frente, con buena luz', 'Rostro completo, ojos visibles', 'Foto reciente tuya'],
                    ['Gorra, capucha o gafas de sol', 'Foto de otra persona o recortada', 'Borrosa, oscura o de lejos']
                )}`
        });
    }

    if (type === 'moto') {
        steps.push({
            id: 'helmet',
            section: 'helmet',
            icon: 'fa-hard-hat',
            title: add ? 'Casco — Moto Segura' : '2B. Casco — Moto Segura',
            body: `<p>En moto no basta la selfie. Campaña <b>Moto Segura</b>:</p>
                ${li([
                    'Una foto <b>tuya con el casco puesto</b>',
                    '3 fotos del casco del conductor (general, por dentro, verificación)',
                    '2 fotos del casco para pasajeros (afuera y por dentro)'
                ])}
                <p class="drv-guide-note">Sin estas fotos el registro de moto no pasa.</p>`
        });
    }

    if (!add) {
        steps.push({
            id: 'personal',
            section: 'personal',
            icon: 'fa-address-card',
            title: '3. Datos personales',
            body: `${li([
                '<b>Nombre completo</b> igual que en tu DNI',
                '<b>WhatsApp</b> con +504',
                '<b>Emergencia</b>: otro WhatsApp de confianza',
                '<b>N° de identidad (DNI)</b>',
                '<b>Género y fecha de nacimiento</b> (el día de tu cumpleaños no pagas comisión)',
                '<b>Código de referido</b> (opcional): tú ganas L. 20 al meterlo; quien te invitó gana L. 50 en tu primer viaje'
            ])}`
        });
    }

    steps.push({
        id: 'vehicle',
        section: 'vehicle',
        icon: 'fa-clipboard-list',
        title: add ? 'Datos del vehículo' : '4. Datos del vehículo',
        body: `<p>Datos ${esc(t.of)}:</p>
            ${li([
                '<b>Marca y modelo</b> (ej. Toyota Corolla 2018 o Honda Wave 110)',
                type === 'taxi'
                    ? '<b>Placa T-</b> oficial. Sin esa placa no operas como taxi tradicional'
                    : '<b>Placa</b> tal como está en el vehículo',
                '<b>N° de licencia de conducir</b>',
                '<b>Revisión vehicular de Honduras</b> (número o fecha)',
                (type === 'paila' || type === 'camion' || type === 'grua')
                    ? '<b>Capacidad de carga</b> obligatoria (toneladas, varas, remolque…)'
                    : 'Capacidad de carga: solo paila, camión o grúa'
            ])}`
    });

    steps.push({
        id: 'photos',
        section: 'photos',
        icon: 'fa-camera',
        title: add ? `Fotos ${t.of}` : `5. Fotos ${t.of}`,
        body: `<p>Todas son obligatorias. Luz de día, sin recortes que tapen la placa.</p>
            ${li(photoItems(type))}
            ${yesNo(
                ['De día o con buena luz', 'Placa completa y legible', 'El vehículo entero en las de exterior'],
                ['Fotos de internet o de otro carro', 'Placa tapada o borrosa', 'Interior oscuro o de noche']
            )}`
    });

    steps.push({
        id: 'docs',
        section: 'docs',
        icon: 'fa-file-alt',
        title: add ? 'Documentos del vehículo' : '6. Documentos',
        body: `<p>Sácalos en una mesa, de frente, sin flash que tape los datos.</p>
            ${li([
                '<b>Licencia:</b> 2 fotos, frente (anverso) y revés (reverso)',
                '<b>Revisión vehicular de Honduras:</b> foto del documento',
                add ? 'Antecedentes: ya quedaron en tu primer registro' : '<b>Antecedentes penales (PEN):</b> código + foto del certificado',
                add ? '' : '<b>Antecedentes policiales:</b> código + foto del certificado'
            ].filter(Boolean))}
            <p class="drv-guide-note">Si se lee mal, el supervisor lo rechaza y tienes que volver a subir.</p>`
    });

    steps.push({
        id: 'submit',
        section: 'submit',
        icon: 'fa-paper-plane',
        title: add ? '7. Enviar el vehículo' : '7. Enviar y esperar aprobación',
        body: `<p>Revisa que no falte ninguna foto y toca <b>${add ? 'Registrar vehículo' : 'Enviar para aprobación'}</b>.</p>
            ${li([
                'Un supervisor revisa fotos y papeles',
                add ? 'Este vehículo no se usa en viajes hasta que lo aprueben' : 'No recibes viajes hasta que te aprueben',
                'Los documentos duran <b>6 meses</b>; después hay que renovarlos',
                'Si te piden correcciones, abre de nuevo el registro y sube la foto clara',
                add ? '' : 'Cuando te aprueben: ábrete en línea y te llegan solicitudes de tu ciudad'
            ].filter(Boolean))}
            <p class="drv-guide-note">Soporte: el botón de WhatsApp en la app, 24/7.</p>`
    });

    return steps;
}

function markSeen() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
}

function hasSeen() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
}

function rootEl() {
    return document.getElementById(ROOT_ID);
}

function closeGuide() {
    const el = rootEl();
    if (!el) return;
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 180);
    markSeen();
}

function jumpToSection(section) {
    closeGuide();
    if (!section) return;
    window.setTimeout(() => {
        const el = document.querySelector(`[data-setup-section="${section}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('setup-step-guide-pulse');
        window.setTimeout(() => el.classList.remove('setup-step-guide-pulse'), 1600);
    }, 200);
}

function render(index) {
    const steps = buildSteps();
    let i = Math.max(0, Math.min(index, steps.length - 1));
    const step = steps[i];
    const iconClass = step.icon.startsWith('icon-') ? step.icon : `fas ${step.icon}`;
    let el = rootEl();
    if (!el) {
        el = document.createElement('div');
        el.id = ROOT_ID;
        el.className = 'drv-guide-overlay';
        document.body.appendChild(el);
    }
    el.dataset.index = String(i);
    el.innerHTML = `
        <div class="drv-guide-sheet" role="dialog" aria-modal="true" aria-labelledby="drv-guide-title">
            <button type="button" class="drv-guide-x" data-guide-close aria-label="Cerrar">×</button>
            <div class="drv-guide-progress" aria-hidden="true">
                <span>Paso ${i + 1} de ${steps.length}</span>
                <div class="drv-guide-bar"><i style="width:${((i + 1) / steps.length) * 100}%"></i></div>
            </div>
            <div class="drv-guide-hero">
                <div class="drv-guide-hero-icon"><i class="${iconClass}"></i></div>
                <h2 id="drv-guide-title">${esc(step.title)}</h2>
            </div>
            <div class="drv-guide-body">${step.body}</div>
            <div class="drv-guide-actions">
                <button type="button" class="drv-guide-btn drv-guide-btn-ghost" data-guide-prev ${i === 0 ? 'disabled' : ''}>Atrás</button>
                ${i < steps.length - 1
                    ? `<button type="button" class="drv-guide-btn drv-guide-btn-primary" data-guide-next>Siguiente</button>`
                    : `<button type="button" class="drv-guide-btn drv-guide-btn-primary" data-guide-finish>Llenar el formulario</button>`}
            </div>
            <div class="drv-guide-foot">
                ${step.section
                    ? `<button type="button" class="drv-guide-link" data-guide-jump="${esc(step.section)}">Ir a este paso en el formulario</button>`
                    : ''}
                <button type="button" class="drv-guide-link" data-guide-close>Saltar guía</button>
            </div>
        </div>`;
}

function openGuide(startId) {
    const steps = buildSteps();
    let index = 0;
    if (startId) {
        const found = steps.findIndex((s) => s.id === startId || s.section === startId);
        if (found >= 0) index = found;
    }
    render(index);
    markSeen();
    window.setTimeout(() => {
        rootEl()?.querySelector('[data-guide-next], [data-guide-finish]')?.focus();
    }, 40);
}

function onGuideClick(e) {
    const t = e.target.closest?.('[data-guide-close], [data-guide-next], [data-guide-prev], [data-guide-finish], [data-guide-jump], [data-guide-pick-type], #driver-register-guide-btn, [data-open-driver-register-guide]');
    if (!t) {
        if (e.target.id === ROOT_ID) closeGuide();
        return;
    }
    if (t.id === 'driver-register-guide-btn' || t.hasAttribute('data-open-driver-register-guide')) {
        e.preventDefault();
        const step = t.getAttribute('data-guide-step') || '';
        openGuide(step);
        return;
    }
    if (t.hasAttribute('data-guide-close')) {
        closeGuide();
        return;
    }
    if (t.hasAttribute('data-guide-finish')) {
        jumpToSection(isAddVehicleMode() ? 'type' : 'face');
        return;
    }
    if (t.hasAttribute('data-guide-jump')) {
        jumpToSection(t.getAttribute('data-guide-jump'));
        return;
    }
    const el = rootEl();
    const index = Number(el?.dataset.index || 0);
    if (t.hasAttribute('data-guide-next')) {
        render(index + 1);
        return;
    }
    if (t.hasAttribute('data-guide-prev')) {
        render(index - 1);
        return;
    }
    if (t.hasAttribute('data-guide-pick-type')) {
        const type = t.getAttribute('data-guide-pick-type');
        window.selectDriverVehicleType?.(type);
        const keep = el?.dataset.index || '1';
        render(Number(keep));
    }
}

function maybeAutoOpen() {
    if (isAddVehicleMode()) return;
    if (hasSeen()) return;
    const setup = document.getElementById('setup-screen');
    if (!setup || setup.classList.contains('hidden')) return;
    window.setTimeout(() => {
        if (rootEl()) return;
        if (document.getElementById('setup-screen')?.classList.contains('hidden')) return;
        openGuide();
    }, 420);
}

export function initDriverRegisterGuide() {
    if (window.__hrDriverRegisterGuideBound) return;
    window.__hrDriverRegisterGuideBound = true;
    document.addEventListener('click', onGuideClick);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && rootEl()) closeGuide();
    });
    window.openDriverRegisterGuide = (step) => openGuide(step);
    window.maybeShowDriverRegisterGuide = maybeAutoOpen;
    window.closeDriverRegisterGuide = closeGuide;
}
