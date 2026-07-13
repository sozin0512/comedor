/**
 * Worker puente Admin → WhatsApp.
 *
 * Solo DEBE haber UN worker corriendo.
 * Si ves 401 conflict: cierra otras ventanas (login.js, otro worker, WhatsApp Web).
 *
 *   node login.js --fresh   (solo si perdiste sesión)
 *   npm run worker          (una sola ventana, dejar abierta)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    getDocument,
    listAllDocuments,
    listQueuedCampaigns,
    patchDocument
} from './lib/firestore-rest.js';
import {
    normalizeHondurasPhone,
    parseArgs,
    phoneToJid,
    randomBetween,
    renderMessage,
    sleep
} from './lib/phones.js';
import { SUPPORT_PHONE, connectWhatsApp } from './lib/wa-connect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROJECT_ID = 'comedor-86278';
const APP_ID = 'comayagua-vip-pro-v4';
const POLL_MS = 8000;
const HEARTBEAT_MS = 20000;
const DELAY_MIN = 35000;
const DELAY_MAX = 60000;
const BATCH_SIZE = 15;
const BATCH_PAUSE_MS = 300000;
const AUTH_DIR = 'auth_session';

/** @type {import('@whiskeysockets/baileys').WASocket | null} */
let sock = null;
let connecting = false;
let authDir = AUTH_DIR;

function banner() {
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  HonduRaite · Worker WhatsApp (puente Admin)');
    console.log('══════════════════════════════════════════════════');
    console.log('  ⚠ Solo UNA ventana de worker. Sin login.js abierto.');
    console.log('  ⚠ Cierra WhatsApp Web en el navegador si lo usas.');
    console.log('  Si sale 401 conflict → cierra duplicados y reinicia.');
    console.log('══════════════════════════════════════════════════');
    console.log('');
}

function isConnError(err) {
    const m = String(err?.message || err || '').toLowerCase();
    return (
        m.includes('connection closed') ||
        m.includes('connection closed') ||
        m.includes('conflict') ||
        m.includes('timed out') ||
        m.includes('econnreset') ||
        m.includes('socket') ||
        m.includes('not connected') ||
        m.includes('precondition') ||
        m.includes('stream errored')
    );
}

async function ensureSocket(force = false) {
    if (connecting) {
        while (connecting) await sleep(500);
        if (sock && !force) return sock;
    }
    if (sock && !force) {
        // baileys no siempre expone ws listo; intentamos usar y reconectar si falla
        return sock;
    }
    connecting = true;
    try {
        if (sock) {
            try {
                sock.end(undefined);
            } catch (_) {}
            sock = null;
        }
        console.log(force ? 'Reconectando WhatsApp…' : 'Conectando WhatsApp…');
        sock = await connectWhatsApp({
            authDir,
            fresh: false,
            maxRetries: 10,
            openQrImage: false,
            printQrTerminal: false
        });
        // Mantener referencia viva: si cae, null
        sock.ev.on('connection.update', (u) => {
            if (u.connection === 'close') {
                const code = u.lastDisconnect?.error?.output?.statusCode;
                console.warn(`WA desconectado (code=${code}). Se reconectará al enviar.`);
                // no borrar sock de inmediato si es restart; force reconnect on next send
                if (code === 401 || String(u.lastDisconnect?.error?.message || '').includes('conflict')) {
                    console.warn('→ CONFLICT: otra sesión usa este WhatsApp. Cierra login.js / otro worker / WA Web.');
                }
            }
        });
        console.log('WhatsApp listo.\n');
        return sock;
    } finally {
        connecting = false;
    }
}

async function heartbeat(extra = {}) {
    const payload = {
        online: true,
        updatedAtMs: Date.now(),
        host: process.env.COMPUTERNAME || process.env.HOSTNAME || 'pc',
        version: 2,
        ...extra
    };
    await patchDocument(
        PROJECT_ID,
        `artifacts/${APP_ID}/public/data/whatsapp_bridge/status`,
        payload
    );
}

/**
 * Igual que Cloud Functions: viaje “real” = no pending/cancelado/scheduled.
 * tripFilter: all | has_trips | no_trips
 */
async function loadTripExperienceSets() {
    const trips = await listAllDocuments(
        PROJECT_ID,
        `artifacts/${APP_ID}/public/data/trips`,
        { quiet: true }
    );
    const clientsWithTrips = new Set();
    const driversWithTrips = new Set();
    for (const t of trips) {
        const st = String(t.status || '');
        if (!st || st === 'cancelled' || st === 'canceled' || st === 'pending' || st === 'scheduled') {
            continue;
        }
        if (t.clientId) clientsWithTrips.add(String(t.clientId));
        if (t.driverId) driversWithTrips.add(String(t.driverId));
    }
    return { clientsWithTrips, driversWithTrips };
}

function userMatchesTripFilter(uid, role, tripFilter, sets, userData = {}) {
    const f = String(tripFilter || 'all');
    if (f !== 'has_trips' && f !== 'no_trips') return true;
    const profileTrips = Number(userData.totalTrips) || 0;
    let has = false;
    if (role === 'driver') {
        has = sets.driversWithTrips.has(String(uid)) || profileTrips >= 1;
    } else {
        has = sets.clientsWithTrips.has(String(uid)) || profileTrips >= 1;
    }
    if (f === 'has_trips') return has;
    if (f === 'no_trips') return !has;
    return true;
}

async function loadRecipients(targetRole, limit, tripFilter = 'all') {
    const users = await listAllDocuments(
        PROJECT_ID,
        `artifacts/${APP_ID}/public/data/users`,
        { quiet: true }
    );
    const filter = String(tripFilter || 'all');
    const needTrips = filter === 'has_trips' || filter === 'no_trips';
    const sets = needTrips
        ? await loadTripExperienceSets()
        : { clientsWithTrips: new Set(), driversWithTrips: new Set() };

    if (needTrips) {
        console.log(
            `  filtro viajes=${filter} · pasajeros con viaje=${sets.clientsWithTrips.size} · conductores con viaje=${sets.driversWithTrips.size}`
        );
    }

    const byPhone = new Map();
    let roleSkipped = 0;
    let tripSkipped = 0;
    for (const u of users) {
        const role = String(u.role || 'client').toLowerCase();
        if (targetRole !== 'all' && role !== targetRole) {
            roleSkipped += 1;
            continue;
        }
        const uid = u.__id || u.uid || '';
        if (!userMatchesTripFilter(uid, role, filter, sets, u)) {
            tripSkipped += 1;
            continue;
        }
        const phone = normalizeHondurasPhone(u.phone);
        if (!phone || phone === SUPPORT_PHONE) continue;
        if (!byPhone.has(phone)) {
            byPhone.set(phone, {
                phone,
                name: String(u.name || u.displayName || '').trim(),
                role,
                uid
            });
        }
    }
    let list = [...byPhone.values()];
    if (limit != null && Number(limit) > 0) {
        list = list.slice(0, Number(limit));
    }
    console.log(
        `  destinatarios WA: ${list.length}` +
            (needTrips ? ` (filtrados por viaje: ${tripSkipped} fuera)` : '')
    );
    return list;
}

async function sendOne(s, jid, text, phone) {
    // Evitar onWhatsApp (a veces tira la sesión); enviar directo
    await s.sendMessage(jid, { text });
}

async function processCampaign(campaign) {
    const id = campaign.__id;
    const docPath = `artifacts/${APP_ID}/public/data/whatsapp_campaigns/${id}`;
    const message = String(campaign.message || '').trim();
    const targetRole = String(campaign.targetRole || 'client').toLowerCase();
    const tripFilter = String(campaign.tripFilter || 'all');
    const dryRun = campaign.dryRun === true;
    const limit = campaign.limit != null ? Number(campaign.limit) : null;

    if (!message) {
        await patchDocument(PROJECT_ID, docPath, {
            status: 'failed',
            error: 'Mensaje vacío',
            finishedAtMs: Date.now()
        });
        return;
    }

    await patchDocument(PROJECT_ID, docPath, {
        status: 'running',
        startedAtMs: campaign.startedAtMs || Date.now(),
        tripFilter,
        error: ''
    });

    let recipients;
    try {
        console.log(`[${id}] rol=${targetRole} viajes=${tripFilter} limit=${limit ?? '∞'}`);
        recipients = await loadRecipients(targetRole, limit, tripFilter);
    } catch (e) {
        await patchDocument(PROJECT_ID, docPath, {
            status: 'failed',
            error: String(e.message || e),
            finishedAtMs: Date.now()
        });
        return;
    }

    // Reanudar: saltar teléfonos ya enviados
    const already = new Set(
        Array.isArray(campaign.sentPhones) ? campaign.sentPhones.map(String) : []
    );
    if (already.size) {
        const before = recipients.length;
        recipients = recipients.filter((r) => !already.has(r.phone));
        console.log(`[${id}] reanudando: ${already.size} ya ok, quedan ${recipients.length} (de ${before})`);
    }

    await patchDocument(PROJECT_ID, docPath, {
        progressTotal: already.size + recipients.length,
        progressOk: already.size,
        progressFail: Number(campaign.progressFail || 0)
    });

    if (dryRun) {
        console.log(`[${id}] DRY-RUN ${recipients.length} destinos`);
        await patchDocument(PROJECT_ID, docPath, {
            status: 'done',
            dryRun: true,
            progressTotal: recipients.length,
            progressOk: recipients.length,
            progressFail: 0,
            finishedAtMs: Date.now(),
            note: 'Simulación'
        });
        return;
    }

    if (!recipients.length) {
        await patchDocument(PROJECT_ID, docPath, {
            status: 'done',
            progressOk: already.size,
            finishedAtMs: Date.now(),
            note: already.size ? 'Nada pendiente' : 'Sin destinatarios'
        });
        return;
    }

    let ok = already.size;
    let fail = Number(campaign.progressFail || 0);
    let inBatch = 0;
    const sentPhones = [...already];

    for (let i = 0; i < recipients.length; i++) {
        try {
            const live = await getDocument(PROJECT_ID, docPath);
            if (live?.status === 'cancelled') {
                console.log(`[${id}] cancelada`);
                await patchDocument(PROJECT_ID, docPath, {
                    progressOk: ok,
                    progressFail: fail,
                    sentPhones,
                    finishedAtMs: Date.now()
                });
                return;
            }
        } catch (_) {}

        const r = recipients[i];
        const text = renderMessage(message, r);
        const jid = phoneToJid(r.phone);
        const n = ok + fail - already.size + i + 1; // rough
        const label = `${i + 1}/${recipients.length}`;

        let done = false;
        for (let attempt = 1; attempt <= 3 && !done; attempt++) {
            try {
                const s = await ensureSocket(attempt > 1);
                await sendOne(s, jid, text, r.phone);
                ok += 1;
                sentPhones.push(r.phone);
                done = true;
                console.log(`[${id}] ${label} OK ${r.phone} ${r.name || ''}`);
            } catch (e) {
                const msg = e.message || String(e);
                if (isConnError(e) && attempt < 3) {
                    console.warn(`[${id}] ${label} caída (${msg}) → reconecto y reintento ${attempt}/3…`);
                    sock = null;
                    await sleep(4000 * attempt);
                    continue;
                }
                fail += 1;
                done = true;
                console.warn(`[${id}] ${label} FAIL ${r.phone}:`, msg);
            }
        }

        await patchDocument(PROJECT_ID, docPath, {
            progressOk: ok,
            progressFail: fail,
            progressTotal: already.size + recipients.length,
            sentPhones: sentPhones.slice(-500),
            lastPhone: r.phone,
            lastAtMs: Date.now()
        }).catch(() => {});

        if (i === recipients.length - 1) break;
        inBatch += 1;
        if (inBatch >= BATCH_SIZE) {
            console.log(`[${id}] pausa de lote ${BATCH_PAUSE_MS / 1000}s…`);
            await sleep(BATCH_PAUSE_MS);
            inBatch = 0;
        } else {
            const wait = randomBetween(DELAY_MIN, DELAY_MAX);
            console.log(`  … ${Math.round(wait / 1000)}s`);
            await sleep(wait);
        }
    }

    await patchDocument(PROJECT_ID, docPath, {
        status: 'done',
        progressOk: ok,
        progressFail: fail,
        progressTotal: already.size + recipients.length,
        sentPhones,
        finishedAtMs: Date.now()
    });
    console.log(`[${id}] listo ok=${ok} fail=${fail}`);
}

/** Campañas a medias (running) se reencolan para reanudar */
async function reclaimStuckCampaigns() {
    const docs = await listAllDocuments(
        PROJECT_ID,
        `artifacts/${APP_ID}/public/data/whatsapp_campaigns`,
        { quiet: true }
    );
    const now = Date.now();
    for (const d of docs) {
        if (d.status !== 'running') continue;
        const age = now - Number(d.lastAtMs || d.startedAtMs || 0);
        // si lleva > 3 min sin progreso, reencolar
        if (age > 180000 || !d.lastAtMs) {
            console.log(`Reencolando campaña trabada ${d.__id}…`);
            await patchDocument(
                PROJECT_ID,
                `artifacts/${APP_ID}/public/data/whatsapp_campaigns/${d.__id}`,
                {
                    status: 'queued',
                    error: 'Reanudación automática tras desconexión'
                }
            );
        }
    }
}

async function main() {
    banner();
    const args = parseArgs();
    authDir = args.auth || AUTH_DIR;
    const absAuth = path.resolve(__dirname, authDir);

    if (!fs.existsSync(path.join(absAuth, 'creds.json'))) {
        throw new Error('No hay sesión. Ejecuta: node login.js --fresh');
    }

    await ensureSocket(false);
    await heartbeat({ whatsapp: 'connected' });
    setInterval(() => {
        heartbeat({ whatsapp: sock ? 'connected' : 'reconnecting' }).catch(() => {});
    }, HEARTBEAT_MS);

    try {
        await reclaimStuckCampaigns();
    } catch (e) {
        console.warn('reclaim:', e.message || e);
    }

    let busy = false;
    console.log('Esperando campañas del admin web…\n');

    for (;;) {
        try {
            if (!busy) {
                const queued = await listQueuedCampaigns(PROJECT_ID, APP_ID);
                if (queued.length) {
                    const campaign = queued[0];
                    busy = true;
                    console.log(
                        `\n→ Campaña ${campaign.__id} (${campaign.targetRole}, viajes=${campaign.tripFilter || 'all'}, limit=${campaign.limit ?? '∞'})`
                    );
                    try {
                        await processCampaign(campaign);
                    } catch (e) {
                        console.error('Error campaña:', e.message || e);
                        await patchDocument(
                            PROJECT_ID,
                            `artifacts/${APP_ID}/public/data/whatsapp_campaigns/${campaign.__id}`,
                            {
                                status: 'failed',
                                error: String(e.message || e),
                                finishedAtMs: Date.now()
                            }
                        ).catch(() => {});
                    } finally {
                        busy = false;
                    }
                }
            }
        } catch (e) {
            console.warn('Poll:', e.message || e);
        }
        await sleep(POLL_MS);
    }
}

main().catch((e) => {
    console.error('\nWorker error:', e.message || e);
    process.exit(1);
});
