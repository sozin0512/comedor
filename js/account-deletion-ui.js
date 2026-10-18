/**
 * «Eliminar mi cuenta» dentro de la app (Google Play · Account deletion).
 * Lo abre el menú (⋮ → Privacidad y cuenta) para pasajero, conductor y tienda.
 * El servidor (functions/account-deletion.js) decide si se puede y hace el borrado.
 */

const AUTH_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
const FN_URL = 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
export const ACCOUNT_DELETION_URL = 'https://honduraite.com/eliminar-cuenta.html';
export const PRIVACY_URL = 'https://honduraite.com/politica-de-privacidad.html';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function callFn(name, data = {}) {
    const fns = window.cloudFunctions;
    const mk = window.httpsCallable || (await import(FN_URL)).httpsCallable;
    if (!fns) throw new Error('Sin conexión con el servidor.');
    const res = await mk(fns, name)(data);
    return res?.data;
}

function modalShell(title) {
    document.querySelectorAll('.hr-acct-bg').forEach((m) => m.remove());
    const bg = document.createElement('div');
    bg.className = 'rm-modal-bg hr-acct-bg';
    bg.style.alignItems = 'center';
    bg.innerHTML = `<div class="rm-modal" role="dialog" aria-modal="true" aria-labelledby="hr-acct-title" style="max-height:90vh;overflow:auto">
        <h4 id="hr-acct-title">${esc(title)}</h4><div data-body></div></div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
    document.body.appendChild(bg);
    return { bg, body: bg.querySelector('[data-body]') };
}

/** Pantalla «Privacidad y cuenta»: política, permisos y eliminar cuenta. */
export function openPrivacyAndAccount() {
    const { body } = modalShell('Privacidad y cuenta');
    body.innerHTML = `
      <p class="rm-note">Aquí puedes revisar cómo usamos tus datos y eliminar tu cuenta.</p>
      <a class="rm-btn ghost" href="${PRIVACY_URL}" target="_blank" rel="noopener" style="text-decoration:none">Política de privacidad</a>
      <button type="button" class="rm-btn ghost" data-loc>Ubicación (cómo y cuándo la usamos)</button>
      <button type="button" class="rm-btn" data-del style="background:#dc2626">Eliminar mi cuenta</button>
      <button type="button" class="rm-btn ghost" data-close style="background:#f1f5f9;color:#334155;border-color:#cbd5e1">Cerrar</button>`;
    body.querySelector('[data-del]').addEventListener('click', () => openAccountDeletion());
    body.querySelector('[data-loc]').addEventListener('click', () => {
        const role = window.userProfile?.role === 'driver' ? 'driver' : 'client';
        window.showLocationDisclosure?.({ role, force: true, infoOnly: true });
    });
}

function renderBlockers(body, status) {
    const list = (status.blockers || []).map((b) => `<li style="margin:4px 0">${esc(b.message)}</li>`).join('');
    body.innerHTML = `
      <p class="rm-note"><b>Ahora no se puede eliminar la cuenta:</b></p>
      <ul class="rm-note" style="padding-left:18px;list-style:disc">${list}</ul>
      <button type="button" class="rm-btn ghost" data-wa>Escribir a soporte</button>
      <button type="button" class="rm-btn ghost" data-close style="background:#f1f5f9;color:#334155;border-color:#cbd5e1">Cerrar</button>`;
    body.querySelector('[data-wa]').addEventListener('click', () => window.openSupportWhatsApp?.('Quiero eliminar mi cuenta'));
}

function needsPassword(user) {
    return !!user?.providerData?.some((p) => p?.providerId === 'password');
}

export async function openAccountDeletion() {
    const user = window.currentUser;
    if (!user) {
        window.open(ACCOUNT_DELETION_URL, '_blank');
        return;
    }
    const { bg, body } = modalShell('Eliminar mi cuenta');
    body.innerHTML = '<p class="rm-note">Revisando tu cuenta…</p>';
    let status;
    try {
        status = await callFn('getAccountDeletionStatus');
    } catch (e) {
        body.innerHTML = `<p class="rm-note">No se pudo revisar tu cuenta (${esc(e?.message || 'error')}). Revisa tu internet o usa el formulario web.</p>
          <a class="rm-btn ghost" href="${ACCOUNT_DELETION_URL}" target="_blank" rel="noopener" style="text-decoration:none">Abrir formulario web</a>
          <button type="button" class="rm-btn ghost" data-close>Cerrar</button>`;
        return;
    }
    if (!status?.canDelete) return renderBlockers(body, status || {});

    const balanceWarn = (status.warnings || []).find((w) => w.code === 'balance_loss');
    const isDriver = status.role === 'driver';
    body.innerHTML = `
      <p class="rm-note"><b>Esto no se puede deshacer.</b> Al eliminar tu cuenta:</p>
      <ul class="rm-note" style="padding-left:18px;list-style:disc">
        <li>Borramos tu perfil, foto, teléfono, correo, fecha de nacimiento, verificación de identidad (selfie y cédula)${isDriver ? ', documentos, vehículos y ubicación de conductor' : ''}, lugares favoritos y avisos.</li>
        <li>Si tienes una tienda, se cierra y se borran sus productos.</li>
        <li>Guardamos sin tu nombre ni teléfono el registro de viajes, pedidos y pagos (montos, fechas y rutas) por obligaciones contables, de seguridad y prevención de fraude, hasta 5 años.</li>
      </ul>
      ${balanceWarn ? `<label class="rm-note" style="display:flex;gap:8px;align-items:flex-start;background:#fef3c7;padding:8px;border-radius:10px"><input type="checkbox" data-ack style="margin-top:3px"> <span>${esc(balanceWarn.message)} Entiendo y quiero seguir.</span></label>` : ''}
      ${needsPassword(user) ? `<label class="rm-note" for="hr-acct-pw">Tu contraseña</label>
      <input id="hr-acct-pw" type="password" autocomplete="current-password" class="ops-input" style="width:100%;padding:9px;border:1px solid #cbd5e1;border-radius:10px;color:#111">` : ''}
      <label class="rm-note" for="hr-acct-confirm">Escribe <b>ELIMINAR</b> para confirmar</label>
      <input id="hr-acct-confirm" type="text" autocomplete="off" autocapitalize="characters" style="width:100%;padding:9px;border:1px solid #cbd5e1;border-radius:10px;color:#111">
      <p class="rm-note" data-err role="alert" style="color:#b91c1c"></p>
      <button type="button" class="rm-btn" data-go style="background:#dc2626">Eliminar definitivamente</button>
      <button type="button" class="rm-btn ghost" data-close style="background:#f1f5f9;color:#334155;border-color:#cbd5e1">Cancelar</button>`;

    const err = body.querySelector('[data-err]');
    const go = body.querySelector('[data-go]');
    go.addEventListener('click', async () => {
        err.textContent = '';
        const confirmText = String(body.querySelector('#hr-acct-confirm')?.value || '').trim().toUpperCase();
        if (confirmText !== 'ELIMINAR') { err.textContent = 'Escribe ELIMINAR para confirmar.'; return; }
        const ack = body.querySelector('[data-ack]');
        if (ack && !ack.checked) { err.textContent = 'Marca la casilla del saldo para seguir.'; return; }
        go.disabled = true;
        go.textContent = 'Eliminando…';
        try {
            const authMod = await import(AUTH_URL);
            if (needsPassword(user)) {
                const pw = String(body.querySelector('#hr-acct-pw')?.value || '');
                if (!pw) throw Object.assign(new Error('Escribe tu contraseña.'), { local: true });
                const cred = authMod.EmailAuthProvider.credential(user.email, pw);
                await authMod.reauthenticateWithCredential(user, cred);
            }
            await user.getIdToken(true);
            await callFn('deleteMyAccount', { confirm: 'ELIMINAR', acknowledgeBalanceLoss: !!ack?.checked, source: 'app' });
            body.innerHTML = '<p class="rm-note"><b>Tu cuenta fue eliminada.</b> Gracias por usar HonduRaite.</p>';
            try { localStorage.clear(); } catch (_) {}
            try { await authMod.signOut(authMod.getAuth()); } catch (_) {}
            setTimeout(() => { try { bg.remove(); } catch (_) {} location.replace('/'); }, 2200);
        } catch (e) {
            go.disabled = false;
            go.textContent = 'Eliminar definitivamente';
            const code = String(e?.code || '');
            const msg = String(e?.message || '');
            if (e?.local) err.textContent = msg;
            else if (code.includes('wrong-password') || code.includes('invalid-credential')) err.textContent = 'La contraseña no es correcta.';
            else if (code.includes('too-many-requests')) err.textContent = 'Demasiados intentos. Espera unos minutos.';
            else if (msg.includes('requires-recent-login')) err.textContent = 'Por seguridad, cierra sesión, vuelve a entrar y elimina la cuenta de inmediato.';
            else err.textContent = msg || 'No se pudo eliminar la cuenta. Intenta de nuevo o escribe a soporte.';
        }
    });
}

if (typeof window !== 'undefined') {
    window.openAccountDeletion = openAccountDeletion;
    window.openPrivacyAndAccount = openPrivacyAndAccount;
}
