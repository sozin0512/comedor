/**
 * Exporta teléfonos WhatsApp de usuarios HonduRaite → CSV.
 *
 * Requisitos: firebase login (en esta máquina)
 *
 * Uso:
 *   npm run export
 *   npm run export:drivers
 *   npm run export:clients
 *   node export-phones.js --role=all --out=out/phones.csv
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listAllDocuments } from './lib/firestore-rest.js';
import {
    csvEscape,
    normalizeHondurasPhone,
    parseArgs
} from './lib/phones.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
    projectId: 'comedor-86278',
    appId: 'comayagua-vip-pro-v4'
};

function loadConfig() {
    const local = path.join(__dirname, 'config.local.json');
    const example = path.join(__dirname, 'config.example.json');
    let cfg = { ...DEFAULTS };
    if (fs.existsSync(example)) {
        try {
            cfg = { ...cfg, ...JSON.parse(fs.readFileSync(example, 'utf8')) };
        } catch (_) {}
    }
    if (fs.existsSync(local)) {
        cfg = { ...cfg, ...JSON.parse(fs.readFileSync(local, 'utf8')) };
    }
    return cfg;
}

async function main() {
    const args = parseArgs();
    const cfg = loadConfig();
    const projectId = String(args.project || cfg.projectId || DEFAULTS.projectId);
    const appId = String(args.app || cfg.appId || DEFAULTS.appId);
    const roleFilter = String(args.role || cfg.role || 'all').toLowerCase();
    const outPath = path.resolve(
        __dirname,
        String(args.out || cfg.csvPath || `out/phones-${roleFilter}.csv`)
    );

    console.log('HonduRaite · export teléfonos WhatsApp');
    console.log(`  project: ${projectId}`);
    console.log(`  appId:   ${appId}`);
    console.log(`  role:    ${roleFilter}`);

    const collectionPath = `artifacts/${appId}/public/data/users`;
    const users = await listAllDocuments(projectId, collectionPath);
    console.log(`Usuarios en Firestore: ${users.length}`);

    const byPhone = new Map();
    let noPhone = 0;
    let roleSkipped = 0;

    for (const u of users) {
        const role = String(u.role || 'client').toLowerCase();
        if (roleFilter !== 'all' && role !== roleFilter) {
            roleSkipped += 1;
            continue;
        }
        const phone = normalizeHondurasPhone(u.phone);
        if (!phone || phone.length < 11) {
            noPhone += 1;
            continue;
        }
        const prev = byPhone.get(phone);
        if (!prev) {
            byPhone.set(phone, {
                phone,
                name: String(u.name || u.displayName || '').trim(),
                role,
                uid: u.__id || u.uid || ''
            });
        }
    }

    const rows = [...byPhone.values()].sort((a, b) => a.phone.localeCompare(b.phone));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const lines = ['phone,name,role,uid'];
    for (const r of rows) {
        lines.push(
            [r.phone, r.name, r.role, r.uid].map(csvEscape).join(',')
        );
    }
    fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

    console.log('---');
    console.log(`Con WhatsApp válido: ${rows.length}`);
    console.log(`Sin teléfono:        ${noPhone}`);
    console.log(`Rol filtrado:        ${roleSkipped}`);
    console.log(`CSV: ${outPath}`);
    console.log('');
    console.log('Siguiente: copia message.example.txt → message.txt, edita el texto,');
    console.log('y prueba: npm run send:dry');
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
