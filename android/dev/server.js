'use strict';
// Try the Android version of WellWrite in a desktop browser: serves the page with a stand-in for the Android
// app, and runs WellWrite's engine (android/node/main.js) here in Node.
//   node android/dev/server.js [port] [dataDir]       then open http://localhost:<port>/ at phone size
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { start } = require('../node/main');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'renderer');
const port = +(process.argv[2] || process.env.PORT || 5173);
const base = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-android-'));
const OUT = path.join(base, 'saved');
fs.mkdirSync(OUT, { recursive: true });

const clients = new Set();
const pushToPage = s => { for (const res of clients) res.write('data: ' + s + '\n\n'); };
let engineListener = null;
const backend = start({
  send: s => {
    if (s === 'Y') return;
    if (s[0] === 'N') {   // the engine asks the "Android app" to do something
      const m = JSON.parse(s.slice(1));
      console.log('[android]', m.op, m.url || '');
      return;
    }
    pushToPage(s);
  },
  onMessage: fn => { engineListener = fn; },
}, { files: path.join(base, 'files'), cache: path.join(base, 'cache') }, {
  noUpdateCheck: !process.env.WELLWRITE_RELEASES_URL, releasesUrl: process.env.WELLWRITE_RELEASES_URL,
  picturesUrl: process.env.WELLWRITE_PICTURES_URL, apiBibleBase: process.env.WELLWRITE_APIBIBLE_URL,
});
engineListener('S' + JSON.stringify({ type: 'secret', key: '11'.repeat(32) }));

// The "Android app": saving files and opening links.
function nativeOp(m) {
  if (m.op === 'saveFile') {
    const name = path.basename(m.name);
    fs.copyFileSync(m.path, path.join(OUT, name));
    console.log('[android] saved', name);
    return name;
  }
  console.log('[android]', m.op, m.url || '');
  return true;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const DEV_NATIVE = `
window.WellWriteNative = (() => {
  const ls = [];
  const deliver = data => ls.forEach(fn => fn({ data }));
  const es = new EventSource('/events');
  es.onmessage = e => deliver(e.data);
  return {
    addEventListener: (t, fn) => { if (t === 'message') ls.push(fn); },
    postMessage: s => {
      if (s === 'H') return;
      fetch('/msg', { method: 'POST', body: s }).then(r => r.text()).then(t => { if (t) deliver(t); });
    },
    _back: () => deliver('B'),
  };
})();`;

http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': hi\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url === '/msg' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => {
      if (body[0] === 'E') { engineListener(body.slice(1)); res.end(''); return; }
      if (body[0] === 'N') {
        const m = JSON.parse(body.slice(1));
        let reply;
        try { reply = { id: m.id, ok: true, value: nativeOp(m) }; } catch (e) { reply = { id: m.id, ok: false, error: e.message }; }
        res.end('R' + JSON.stringify(reply));
        return;
      }
      res.end('');
    });
    return;
  }
  if (req.url === '/dev-native.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(DEV_NATIVE); return; }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(RENDERER, path.normalize(p));
  if (!file.startsWith(RENDERER) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  let data = fs.readFileSync(file);
  if (p === '/index.html') {
    data = String(data)
      .replace("default-src 'none';", "default-src 'none'; connect-src 'self';")
      .replace('<script src="android.js">', '<script src="dev-native.js"></script>\n<script src="android.js">');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(data);
}).listen(port, '127.0.0.1', () => console.log(`WellWrite (Android) on http://localhost:${port}/  data: ${base}`));

module.exports = { backend };
