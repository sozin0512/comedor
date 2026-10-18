/**
 * Visor de foto ampliada compartido (pasajero, conductor, tienda y staff).
 * Antes solo existía en app-staff.js y app.js lo llamaba igual (fallaba para quien no es staff).
 * Construye el DOM sin innerHTML con la URL para que una URL rara no inyecte HTML.
 */

function safeSrc(src) {
    const s = String(src || '').trim();
    if (!s) return '';
    if (/^(https?:|data:image\/|blob:)/i.test(s)) return s;
    if (/^[./a-z0-9_-]/i.test(s) && !/^javascript:/i.test(s)) return s;
    return '';
}

export function showEnlargedPhoto(src, labelOrMeta = null) {
    const url = safeSrc(src);
    if (!url || typeof document === 'undefined') return;
    let label = 'Imagen';
    let personName = '';
    let dType = 'foto';
    if (typeof labelOrMeta === 'string' && labelOrMeta) {
        label = labelOrMeta;
    } else if (labelOrMeta && typeof labelOrMeta === 'object') {
        label = labelOrMeta.label || label;
        personName = labelOrMeta.name || '';
        dType = labelOrMeta.type || dType;
    }
    const fileBase = (personName || 'usuario').replace(/[^a-z0-9]/gi, '_');

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/90 z-[50000] flex items-center justify-center p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', label);
    const close = () => { try { modal.remove(); } catch (_) {} document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target === wrap) close(); });

    const wrap = document.createElement('div');
    wrap.className = 'max-w-[94vw] max-h-[94vh] w-full flex flex-col items-center';

    const bar = document.createElement('div');
    bar.className = 'w-full flex justify-between items-center mb-2 px-1';
    const title = document.createElement('div');
    title.className = 'text-white text-sm font-black truncate';
    title.textContent = label;
    if (personName) {
        const sub = document.createElement('span');
        sub.className = 'text-gray-400 font-normal';
        sub.textContent = ` · ${personName}`;
        title.appendChild(sub);
    }
    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2';
    if (typeof window.downloadRefImage === 'function') {
        const dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-black px-3 py-1.5 rounded-full flex items-center gap-1';
        dl.textContent = '⬇ DESCARGAR';
        dl.addEventListener('click', (e) => {
            e.stopPropagation();
            try { window.downloadRefImage(url, fileBase, dType); } catch (_) {}
        });
        actions.appendChild(dl);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'text-white text-3xl leading-none px-2';
    x.setAttribute('aria-label', 'Cerrar');
    x.textContent = '×';
    x.addEventListener('click', close);
    actions.appendChild(x);
    bar.append(title, actions);

    const img = document.createElement('img');
    img.src = url;
    img.alt = label;
    img.className = 'max-w-full max-h-[82vh] rounded-3xl shadow-2xl border border-white/30 object-contain';
    img.style.background = '#111';

    const hint = document.createElement('div');
    hint.className = 'mt-2 text-[10px] text-gray-400';
    hint.textContent = 'Toca la X o el fondo para cerrar.';

    wrap.append(bar, img, hint);
    modal.appendChild(wrap);
    document.body.appendChild(modal);
}

if (typeof window !== 'undefined') {
    window.showEnlargedPhoto = showEnlargedPhoto;
}
