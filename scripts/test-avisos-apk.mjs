// Prueba pura de isPermanentAndroidDenial (se extrae la función sin cargar imports de CDN).
import fs from 'node:fs'; import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../js/fcm-push.js', import.meta.url), 'utf8');
const m = src.match(/export function isPermanentAndroidDenial[\s\S]*?\n}\n/); assert.ok(m);
const fn = new Function(m[0].replace('export ', '') + '; return isPermanentAndroidDenial;')();
assert.equal(fn({ elapsedMs: 120, asked: 'denied', sys: false }), true);
assert.equal(fn({ elapsedMs: 120, asked: 'denied', sys: null }), true);
assert.equal(fn({ elapsedMs: 120, asked: 'denied', sys: true }), false); // S24: sistema ya dice sí
assert.equal(fn({ elapsedMs: 5000, asked: 'denied', sys: false }), false); // hubo diálogo
assert.equal(fn({ elapsedMs: 100, asked: 'prompt', sys: false }), false);
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(app, /if \(window\.__hrPushAskLock\) \{\s*\/\/ Antes no hacía nada/);
console.log('test-avisos-apk: 6 OK');
assert.match(app, /if \(gotToken\) \{\s*localStorage\.setItem\('honduber_push_enabled', '1'\);[\s\S]{0,300}window\.__hrPushServerInvalid = false;/);
console.log('test-avisos-apk: flag reset OK');
