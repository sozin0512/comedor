/**
 * Sincroniza version.json → config.js, index.html, manifest.json y firebase-messaging-sw.js
 * Ejecutado automáticamente por scripts/sync-www.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readVersion() {
    const raw = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');
    const data = JSON.parse(raw);
    const version = String(data.version || '').trim();
    if (!version) throw new Error('version.json sin campo "version"');
    return version;
}

function detectAndroidFcmEnabled() {
    const configPath = path.join(ROOT, 'capacitor.config.json');
    const gsPath = path.join(ROOT, 'android', 'app', 'google-services.json');
    let appId = 'honduraite.com';
    try {
        appId = JSON.parse(fs.readFileSync(configPath, 'utf8')).appId || appId;
    } catch (_) {}
    if (!fs.existsSync(gsPath)) return false;
    try {
        const parsed = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
        return !!parsed.client?.some((client) =>
            client?.client_info?.android_client_info?.package_name === appId
        );
    } catch (_) {
        return false;
    }
}

function patchConfig(version) {
    const file = path.join(ROOT, 'js', 'config.js');
    let text = fs.readFileSync(file, 'utf8');
    const androidFcmEnabled = detectAndroidFcmEnabled();
    text = text.replace(/appVersion:\s*'[^']*'/, `appVersion: '${version}'`);
    if (/androidFcmEnabled:\s*(true|false)/.test(text)) {
        text = text.replace(/androidFcmEnabled:\s*(true|false)/, `androidFcmEnabled: ${androidFcmEnabled}`);
    } else {
        text = text.replace(
            /appVersion:\s*'[^']*'/,
            (match) => `${match},\n    /** Push nativo Android (auto: google-services.json + paquete APK) */\n    androidFcmEnabled: ${androidFcmEnabled}`
        );
    }
    fs.writeFileSync(file, text, 'utf8');
}

function patchIndexHtml(version, filePath) {
    if (!fs.existsSync(filePath)) return;
    let html = fs.readFileSync(filePath, 'utf8');
    const q = `?v=${version}`;

    if (html.includes('name="hr-app-version"')) {
        html = html.replace(/<meta name="hr-app-version" content="[^"]*">/, `<meta name="hr-app-version" content="${version}">`);
    } else {
        html = html.replace('<meta name="theme-color"', `<meta name="hr-app-version" content="${version}">\n    <meta name="theme-color"`);
    }

    html = html.replace(/href="css\/tailwind\.css(\?v=[^"]*)?"/, `href="css/tailwind.css${q}"`);
    html = html.replace(/href="css\/app\.css(\?v=[^"]*)?"/, `href="css/app.css${q}"`);
    html = html.replace(/src="js\/maps-init\.js(\?v=[^"]*)?"/, `src="js/maps-init.js${q}"`);
    html = html.replace(/src="js\/app\.js(\?v=[^"]*)?"/, `src="js/app.js${q}"`);
    html = html.replace(/href="manifest\.json(\?v=[^"]*)?"/, `href="manifest.json${q}"`);
    html = html.replace(/from '\.\/js\/config\.js(\?v=[^']*)?'/, `from './js/config.js${q}'`);

    const bootScript = `<script>
        window.__HR_BUILD_VERSION__ = '${version}';
        (function () {
            try {
                var build = '${version}';
                var doneKey = 'hr_boot_updated_' + build;
                if (sessionStorage.getItem(doneKey)) return;
                fetch('/version.json?t=' + Date.now(), { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (d) {
                        if (!d || !d.version || d.version === build) return;
                        sessionStorage.setItem(doneKey, '1');
                        var url = new URL(location.href);
                        url.searchParams.set('v', d.version);
                        url.searchParams.set('hr_refresh', String(Date.now()));
                        location.replace(url.toString());
                    })
                    .catch(function () {});
            } catch (e) {}
        })();
    </script>`;

    if (html.includes('window.__HR_BUILD_VERSION__')) {
        html = html.replace(/<script>\s*window\.__HR_BUILD_VERSION__[\s\S]*?<\/script>/, bootScript);
    } else {
        html = html.replace('</head>', `    ${bootScript}\n</head>`);
    }

    fs.writeFileSync(filePath, html, 'utf8');
}

function patchManifest(version, filePath) {
    if (!fs.existsSync(filePath)) return;
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    manifest.start_url = `/?v=${version}`;
    manifest.id = `/?v=${version}`;
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function patchFirebaseMessagingSw(version, filePath) {
    if (!fs.existsSync(filePath)) return;
    let text = fs.readFileSync(filePath, 'utf8');
    if (text.includes('const HR_SW_VERSION')) {
        text = text.replace(/const HR_SW_VERSION = '[^']*';/, `const HR_SW_VERSION = '${version}';`);
    } else {
        text = `const HR_SW_VERSION = '${version}';\n` + text;
    }
    fs.writeFileSync(filePath, text, 'utf8');
}

function run(targetRoot = ROOT) {
    const version = readVersion();
    patchConfig(version);
    patchIndexHtml(version, path.join(targetRoot, 'index.html'));
    patchManifest(version, path.join(targetRoot, 'manifest.json'));
    patchFirebaseMessagingSw(version, path.join(targetRoot, 'firebase-messaging-sw.js'));
    console.log(`Versión inyectada: ${version}`);
    return version;
}

if (require.main === module) {
    run();
}

module.exports = { run, readVersion };