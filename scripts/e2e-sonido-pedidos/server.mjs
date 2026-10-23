// Servidor estático mínimo del repo + páginas de prueba en memoria (solo para pruebas headless).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.mp3': 'audio/mpeg', '.css': 'text/css', '.png': 'image/png' };
export function serve(root, pages = {}) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (pages[u]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(pages[u]); }
      const f = path.join(root, u);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      const buf = fs.readFileSync(f);
      const range = req.headers.range;
      const type = TYPES[path.extname(f)] || 'application/octet-stream';
      if (range) {
        const [a, b] = range.replace('bytes=', '').split('-'); const s = +a; const e = b ? +b : buf.length - 1;
        res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${s}-${e}/${buf.length}`, 'accept-ranges': 'bytes', 'content-length': e - s + 1 });
        return res.end(buf.subarray(s, e + 1));
      }
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': buf.length }); res.end(buf);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
export async function loadPuppeteer() {
  try { return (await import('puppeteer-core')).default; } catch (_) {}
  const dir = process.env.PUPPETEER_DIR || '/workspace/e2e-tools/node_modules/puppeteer-core';
  return (await import(path.join(dir, 'lib/esm/puppeteer/puppeteer-core.js'))).default;
}
export const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
