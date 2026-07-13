/**
 * Login WhatsApp — una sola vinculación; no spamea QR.
 *
 *   node login.js
 *   node login.js --phone=504XXXXXXXX
 *   node login.js --fresh     (solo si quieres forzar nuevo QR)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, sleep } from './lib/phones.js';
import { clearSession, connectWhatsApp, sessionLooksValid } from './lib/wa-connect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const args = parseArgs();
    const phone = args.phone ? String(args.phone) : '';
    const fresh = args.fresh === true || args.reset === true;
    const authDir = args.auth || 'auth_session';

    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  HonduRaite · Login WhatsApp (número SECUNDARIO)');
    console.log('══════════════════════════════════════════════════');

    if (args.clear === true) {
        clearSession(authDir);
        console.log('Sesión borrada.');
        return;
    }

    if (!fresh && sessionLooksValid(authDir)) {
        console.log('Ya hay sesión guardada. Probando reconexión (sin QR nuevo)…');
    } else if (phone) {
        console.log('Modo: código de emparejamiento');
    } else {
        console.log('Modo: QR (la imagen se abre UNA sola vez)');
        console.log('Si ya vinculaste, NO vuelvas a correr login sin --fresh.');
    }
    console.log('');

    const sock = await connectWhatsApp({
        authDir,
        phone,
        fresh,
        openQrImage: true,
        printQrTerminal: false,
        maxRetries: 15
    });

    // Asegurar flush de creds a disco
    await sleep(4000);

    const credsPath = path.resolve(__dirname, authDir, 'creds.json');
    if (!fs.existsSync(credsPath)) {
        console.error('⚠ Conectó pero no se guardó creds.json. No cierres aún…');
        await sleep(3000);
    }

    if (fs.existsSync(credsPath)) {
        const c = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        console.log('OK creds.json · me=', c.me?.id || c.me || '(ok)');
    }

    console.log('');
    console.log('Login listo. Cierra esta ventana si quieres.');
    console.log('Siguiente:  npm run worker');
    console.log('(El worker reutiliza la sesión y NO pide QR de nuevo.)');
    console.log('');

    // Mantener vivo un poco más y salir sin borrar sesión
    await sleep(2000);
    try {
        sock.end(undefined);
    } catch (_) {}
    process.exit(0);
}

main().catch((e) => {
    console.error('\nError login:', e.message || e);
    process.exit(1);
});
