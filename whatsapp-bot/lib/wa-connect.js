/**
 * Conexión WhatsApp (Baileys 7).
 * - Si ya hay sesión (creds.registered / me), NO genera QR.
 * - QR PNG se abre SOLO la primera vez (no cada 40s).
 * - No borra la sesión al desconectarse (solo con wipe explícito).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { normalizeHondurasPhone } from './phones.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const SUPPORT_PHONE = '50495733866';

function openFile(filePath) {
    const p = path.resolve(filePath);
    if (process.platform === 'win32') {
        exec(`start "" "${p}"`);
    } else if (process.platform === 'darwin') {
        exec(`open "${p}"`);
    } else {
        exec(`xdg-open "${p}"`);
    }
}

function wipeAuthDir(authDir) {
    const abs = path.resolve(ROOT, authDir);
    if (!fs.existsSync(abs)) return;
    fs.rmSync(abs, { recursive: true, force: true });
    console.log('Sesión borrada:', abs);
}

function sessionLooksValid(authDir) {
    const credsPath = path.resolve(ROOT, authDir, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    try {
        const c = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        // registered=true (pairing) o ya tiene me (QR exitoso)
        return Boolean(c?.registered || c?.me?.id);
    } catch {
        return false;
    }
}

async function writeQrPng(qr, outPath) {
    await QRCode.toFile(outPath, qr, {
        type: 'png',
        width: 480,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
    });
}

/**
 * @param {object} opts
 * @param {string} opts.authDir
 * @param {string} [opts.phone]
 * @param {boolean} [opts.fresh]
 * @param {number} [opts.maxRetries]
 * @param {boolean} [opts.openQrImage] abrir PNG en el visor (solo 1ª vez)
 * @param {boolean} [opts.printQrTerminal] dibujar QR en terminal
 */
export async function connectWhatsApp({
    authDir = 'auth_session',
    phone = '',
    fresh = false,
    maxRetries = 12,
    openQrImage = true,
    printQrTerminal = false
} = {}) {
    if (fresh) wipeAuthDir(authDir);

    const absAuth = path.resolve(ROOT, authDir);
    fs.mkdirSync(absAuth, { recursive: true });
    const qrPngPath = path.join(ROOT, 'out', 'whatsapp-qr.png');
    fs.mkdirSync(path.dirname(qrPngPath), { recursive: true });

    const phoneNorm = phone ? normalizeHondurasPhone(phone) : '';
    if (phone && !phoneNorm) {
        throw new Error('Número inválido. Usa formato 504XXXXXXXX.');
    }

    const already = sessionLooksValid(authDir);
    if (already) {
        console.log('Sesión guardada encontrada — no se pedirá QR nuevo.');
    }

    let attempt = 0;
    let qrOpenedOnce = false;
    let lastQrLogAt = 0;

    const start = () =>
        new Promise(async (resolve, reject) => {
            attempt += 1;
            let settled = false;
            let pairingRequested = false;

            try {
                const { state, saveCreds } = await useMultiFileAuthState(absAuth);
                const hasSession = Boolean(state.creds?.registered || state.creds?.me?.id);
                const { version, isLatest } = await fetchLatestBaileysVersion();
                console.log(
                    `WA ${version.join('.')} (latest=${isLatest}) · intento ${attempt}/${maxRetries}` +
                        (hasSession ? ' · reutilizando sesión' : ' · hace falta vincular')
                );

                const sock = makeWASocket({
                    version,
                    auth: state,
                    browser: phoneNorm ? Browsers.ubuntu('Chrome') : Browsers.macOS('Desktop'),
                    logger: pino({ level: 'silent' }),
                    markOnlineOnConnect: false,
                    syncFullHistory: false,
                    generateHighQualityLinkPreview: false,
                    getMessage: async () => undefined
                });

                // Guardar credenciales en cuanto WhatsApp las actualice
                sock.ev.on('creds.update', async () => {
                    try {
                        await saveCreds();
                    } catch (e) {
                        console.warn('saveCreds:', e.message || e);
                    }
                });

                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    // Pairing code solo si NO hay sesión
                    if (
                        phoneNorm &&
                        !pairingRequested &&
                        !sock.authState.creds.registered &&
                        !sock.authState.creds.me
                    ) {
                        pairingRequested = true;
                        try {
                            await new Promise((r) => setTimeout(r, 1500));
                            const code = await sock.requestPairingCode(phoneNorm);
                            const pretty = String(code).replace(/(.{4})/g, '$1-').replace(/-$/, '');
                            console.log('');
                            console.log('════════════════════════════════════════');
                            console.log('  CÓDIGO DE VINCULACIÓN');
                            console.log(`     →  ${pretty}  ←`);
                            console.log('  WhatsApp → Dispositivos vinculados');
                            console.log('  → Vincular con número de teléfono');
                            console.log('════════════════════════════════════════');
                            console.log('');
                        } catch (e) {
                            console.error('Pairing code falló:', e.message || e);
                        }
                    }

                    // QR: solo si aún no hay sesión registrada
                    const needsQr =
                        qr &&
                        !phoneNorm &&
                        !sock.authState.creds.registered &&
                        !sock.authState.creds.me;

                    if (needsQr) {
                        const now = Date.now();
                        // No spamear logs ni reabrir la imagen cada 40s
                        if (now - lastQrLogAt > 15000) {
                            lastQrLogAt = now;
                            console.log(
                                qrOpenedOnce
                                    ? '\n(QR renovado en out\\whatsapp-qr.png — escanea el archivo actualizado, no se reabre el visor)\n'
                                    : '\n── Escanea el QR ──\nArchivo: out\\whatsapp-qr.png\nWhatsApp → Dispositivos vinculados → Vincular\n'
                            );
                        }
                        try {
                            await writeQrPng(qr, qrPngPath);
                            if (openQrImage && !qrOpenedOnce) {
                                openFile(qrPngPath);
                                qrOpenedOnce = true;
                                console.log('Imagen abierta una sola vez:', qrPngPath);
                            }
                        } catch (e) {
                            console.warn('PNG QR:', e.message || e);
                        }
                        if (printQrTerminal && !qrOpenedOnce) {
                            qrcodeTerminal.generate(qr, { small: true });
                        }
                    }

                    if (connection === 'open') {
                        if (settled) return;
                        settled = true;
                        try {
                            await saveCreds();
                        } catch (_) {}
                        const me = sock.user?.id || sock.authState.creds?.me?.id || '';
                        const mePhone = String(me).split(':')[0].replace(/\D/g, '');
                        console.log(`\n✅ Conectado como: ${mePhone || me}`);
                        console.log('Sesión guardada en', absAuth);

                        if (normalizeHondurasPhone(mePhone) === SUPPORT_PHONE) {
                            console.error('\n⛔ Número de SOPORTE bloqueado.');
                            try {
                                sock.end(undefined);
                            } catch (_) {}
                            reject(new Error('Número de soporte bloqueado por seguridad'));
                            return;
                        }
                        resolve(sock);
                        return;
                    }

                    if (connection === 'close') {
                        const status = lastDisconnect?.error?.output?.statusCode;
                        const msg = lastDisconnect?.error?.message || '';
                        const loggedOut = status === DisconnectReason.loggedOut;
                        const restartRequired = status === DisconnectReason.restartRequired;

                        console.log(`Conexión cerrada (code=${status}${msg ? ` ${msg}` : ''}).`);

                        if (settled) return;

                        if (loggedOut) {
                            // NO borrar sesión automáticamente (evita perder vínculo y loop de QR)
                            settled = true;
                            reject(
                                new Error(
                                    'WhatsApp cerró la sesión (logged out). ' +
                                        'Si en el celular quitaste el dispositivo, ejecuta: node login.js --fresh'
                                )
                            );
                            return;
                        }

                        // restartRequired: reabrir sin borrar creds (común tras escanear QR)
                        if (restartRequired || attempt < maxRetries) {
                            console.log(
                                restartRequired
                                    ? 'Reinicio requerido por WhatsApp (normal tras vincular)…\n'
                                    : 'Reintentando…\n'
                            );
                            try {
                                sock.end(undefined);
                            } catch (_) {}
                            settled = true;
                            setTimeout(() => {
                                start().then(resolve).catch(reject);
                            }, 800);
                            return;
                        }

                        settled = true;
                        reject(new Error(`No se pudo conectar tras ${maxRetries} intentos.`));
                    }
                });
            } catch (e) {
                if (attempt < maxRetries) {
                    console.warn('Error socket:', e.message || e);
                    setTimeout(() => {
                        start().then(resolve).catch(reject);
                    }, 1500);
                    return;
                }
                reject(e);
            }
        });

    return start();
}

export function clearSession(authDir = 'auth_session') {
    wipeAuthDir(authDir);
}

export { sessionLooksValid };
