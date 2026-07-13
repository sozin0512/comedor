/**
 * Campaña WhatsApp temporal (Baileys / no oficial).
 *
 * ⚠️ USA UN NÚMERO SECUNDARIO. No el de soporte (+504 9573-3866).
 *
 * Flujo:
 *   1. node login.js --phone=504XXXXXXXX   (recomendado)
 *      o: npm run login
 *   2. npm run export:drivers
 *   3. editar message.txt
 *   4. npm run send:dry
 *   5. npm run send -- --dry-run=false --limit=10
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

function loadJson(filePath, fallback = {}) {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadConfig(args) {
    const example = loadJson(path.join(__dirname, 'config.example.json'));
    const local = loadJson(path.join(__dirname, 'config.local.json'));
    const cfg = { ...example, ...local };

    if (args.csv) cfg.csvPath = args.csv;
    if (args.message) cfg.messageFile = args.message;
    if (args.role) cfg.role = args.role;
    if (args.limit != null) cfg.limit = Number(args.limit);
    if (args['delay-min'] != null) cfg.delayMsMin = Number(args['delay-min']);
    if (args['delay-max'] != null) cfg.delayMsMax = Number(args['delay-max']);
    if (args['batch-size'] != null) cfg.batchSize = Number(args['batch-size']);
    if (args['batch-pause'] != null) cfg.batchPauseMs = Number(args['batch-pause']);
    if (args['dry-run'] === true || args['dry-run'] === false) cfg.dryRun = args['dry-run'];
    if (args.dryRun === true || args.dryRun === false) cfg.dryRun = args.dryRun;
    if (args.resume === true) cfg.resume = true;
    if (args['login-only'] === true) cfg.loginOnly = true;
    if (args.phone) cfg.phone = String(args.phone);

    cfg.delayMsMin = Math.max(8000, Number(cfg.delayMsMin) || 30000);
    cfg.delayMsMax = Math.max(cfg.delayMsMin, Number(cfg.delayMsMax) || 55000);
    cfg.batchSize = Math.max(1, Number(cfg.batchSize) || 25);
    cfg.batchPauseMs = Math.max(60000, Number(cfg.batchPauseMs) || 420000);
    cfg.limit = cfg.limit == null || cfg.limit === '' ? null : Number(cfg.limit);
    cfg.skipPhones = new Set(
        [...(cfg.skipPhones || []), SUPPORT_PHONE].map((p) => normalizeHondurasPhone(p)).filter(Boolean)
    );
    return cfg;
}

function parseCsv(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = {
        phone: header.indexOf('phone'),
        name: header.indexOf('name'),
        role: header.indexOf('role'),
        uid: header.indexOf('uid')
    };
    if (idx.phone < 0) throw new Error('CSV sin columna phone');

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        const phone = normalizeHondurasPhone(cols[idx.phone]);
        if (!phone) continue;
        rows.push({
            phone,
            name: idx.name >= 0 ? (cols[idx.name] || '').replace(/^"|"$/g, '') : '',
            role: idx.role >= 0 ? cols[idx.role] || '' : '',
            uid: idx.uid >= 0 ? cols[idx.uid] || '' : ''
        });
    }
    return rows;
}

function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQ && line[i + 1] === '"') {
                cur += '"';
                i += 1;
            } else {
                inQ = !inQ;
            }
            continue;
        }
        if (c === ',' && !inQ) {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    out.push(cur);
    return out;
}

function loadProgress(progressPath) {
    if (!fs.existsSync(progressPath)) return { sent: {}, failed: {} };
    try {
        return JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    } catch {
        return { sent: {}, failed: {} };
    }
}

function saveProgress(progressPath, progress) {
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');
}

function banner(cfg) {
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  HonduRaite · WhatsApp bot TEMPORAL (no oficial)');
    console.log('══════════════════════════════════════════════════');
    console.log('  ⚠️  Solo número SECUNDARIO (no el de soporte).');
    console.log('  ⚠️  Riesgo de ban. Volumen bajo + pausas largas.');
    console.log('──────────────────────────────────────────────────');
    console.log(`  dryRun:      ${cfg.dryRun !== false}`);
    console.log(`  delay:       ${cfg.delayMsMin}-${cfg.delayMsMax} ms`);
    console.log(`  batch:       ${cfg.batchSize} msgs → pausa ${Math.round(cfg.batchPauseMs / 1000)}s`);
    console.log(`  limit:       ${cfg.limit == null ? 'sin límite' : cfg.limit}`);
    console.log(`  csv:         ${cfg.csvPath}`);
    console.log(`  message:     ${cfg.messageFile}`);
    console.log('══════════════════════════════════════════════════');
    console.log('');
}

async function main() {
    const args = parseArgs();
    const cfg = loadConfig(args);
    banner(cfg);

    const csvPath = path.resolve(__dirname, cfg.csvPath || 'out/phones.csv');
    const messagePath = path.resolve(__dirname, cfg.messageFile || 'message.txt');
    const progressPath = path.resolve(__dirname, cfg.progressFile || 'progress-last.json');
    const authDir = cfg.authDir || 'auth_session';

    if (cfg.loginOnly || args['login-only']) {
        console.log('Usa preferiblemente: node login.js --phone=504XXXXXXXX\n');
        const sock = await connectWhatsApp({
            authDir,
            phone: cfg.phone || '',
            fresh: true
        });
        console.log('Login OK. Sesión guardada en', authDir);
        await sleep(2000);
        try {
            sock.end(undefined);
        } catch (_) {}
        return;
    }

    if (!fs.existsSync(messagePath)) {
        throw new Error(
            `Falta ${cfg.messageFile}. Copia message.example.txt → message.txt y edita el texto.`
        );
    }
    if (!fs.existsSync(csvPath)) {
        throw new Error(
            `Falta CSV: ${csvPath}\nPrimero: npm run export:drivers  (o export:clients / export)`
        );
    }

    const template = fs.readFileSync(messagePath, 'utf8');
    if (!template.trim() || template.includes('[Escribe aquí')) {
        throw new Error('Edita message.txt con el texto real de la campaña (quita el placeholder).');
    }

    let recipients = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    if (cfg.role && cfg.role !== 'all') {
        recipients = recipients.filter(
            (r) => String(r.role || '').toLowerCase() === String(cfg.role).toLowerCase()
        );
    }

    const progress = loadProgress(progressPath);
    const resume = args.resume === true || cfg.resume === true;

    recipients = recipients.filter((r) => {
        if (cfg.skipPhones.has(r.phone)) return false;
        if (resume && progress.sent?.[r.phone]) return false;
        return true;
    });

    const seen = new Set();
    recipients = recipients.filter((r) => {
        if (seen.has(r.phone)) return false;
        seen.add(r.phone);
        return true;
    });

    if (cfg.limit != null && Number.isFinite(cfg.limit) && cfg.limit > 0) {
        recipients = recipients.slice(0, cfg.limit);
    }

    console.log(`Destinatarios en cola: ${recipients.length}`);
    if (!recipients.length) {
        console.log('Nada que enviar.');
        return;
    }

    const dryRun = cfg.dryRun !== false;
    if (dryRun) {
        console.log('\n[DRY-RUN] No se enviará nada. Primeros 5 mensajes:\n');
        for (const r of recipients.slice(0, 5)) {
            const text = renderMessage(template, r);
            console.log(`→ ${r.phone} (${r.name || 'sin nombre'})`);
            console.log(text.split('\n').map((l) => '   ' + l).join('\n'));
            console.log('');
        }
        console.log(`Total simulado: ${recipients.length}`);
        console.log('Para enviar de verdad:');
        console.log('  npm run send -- --dry-run=false --limit=10');
        return;
    }

    console.log('\nEnvío REAL en 5 segundos… Ctrl+C para cancelar.\n');
    await sleep(5000);

    // Reutiliza sesión ya logueada (no fresh)
    const sock = await connectWhatsApp({ authDir, fresh: false, maxRetries: 5 });

    let ok = 0;
    let fail = 0;
    let inBatch = 0;

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        const jid = phoneToJid(r.phone);
        const text = renderMessage(template, r);
        const n = i + 1;

        try {
            let exists = true;
            try {
                const results = await sock.onWhatsApp(r.phone);
                exists = Boolean(results?.[0]?.exists);
            } catch (_) {
                /* intentamos igual */
            }
            if (!exists) {
                console.warn(`[${n}/${recipients.length}] SKIP no-WA ${r.phone}`);
                progress.failed[r.phone] = { at: Date.now(), error: 'not_on_whatsapp' };
                saveProgress(progressPath, progress);
                fail += 1;
                continue;
            }

            await sock.sendMessage(jid, { text });
            progress.sent[r.phone] = { at: Date.now(), name: r.name || '' };
            saveProgress(progressPath, progress);
            ok += 1;
            inBatch += 1;
            console.log(`[${n}/${recipients.length}] OK ${r.phone} ${r.name || ''}`);
        } catch (e) {
            fail += 1;
            progress.failed[r.phone] = { at: Date.now(), error: String(e.message || e) };
            saveProgress(progressPath, progress);
            console.warn(`[${n}/${recipients.length}] FAIL ${r.phone}:`, e.message || e);
        }

        const isLast = i === recipients.length - 1;
        if (isLast) break;

        if (inBatch >= cfg.batchSize) {
            console.log(`\nPausa de lote ${Math.round(cfg.batchPauseMs / 1000)}s…\n`);
            await sleep(cfg.batchPauseMs);
            inBatch = 0;
        } else {
            const wait = randomBetween(cfg.delayMsMin, cfg.delayMsMax);
            console.log(`  … espera ${Math.round(wait / 1000)}s`);
            await sleep(wait);
        }
    }

    console.log('\n---');
    console.log(JSON.stringify({ ok, fail, total: recipients.length, progressFile: progressPath }, null, 2));
    console.log('Listo.');

    try {
        sock.end(undefined);
    } catch (_) {}
    process.exit(fail && !ok ? 1 : 0);
}

main().catch((e) => {
    console.error('\nError:', e.message || e);
    process.exit(1);
});
