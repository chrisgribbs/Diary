'use strict';
// WellWrite's engine on Android: the same code as the Windows app (src/backend.js), run by Node.js inside the
// Android app. The Android app passes messages between this and the page:
//   from the page:     JSON { id, ch, args }                 → reply "P" + { id, r: { ok, value | error } }
//   to the page:       "P" + { ev, args }                    (events, like a backup finishing)
//   to the Android app "N" + { op, ... }                     (open a link)
//   from the Android app "S" + { type: 'secret', key }        (this device's key for saved passwords)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// In the app, src/ sits beside this file; in the repository it's two folders up.
const SRC = fs.existsSync(path.join(__dirname, 'src', 'backend.js')) ? './src' : '../../src';
const { createBackend, stripActive } = require(SRC + '/backend');

const RELEASES = 'https://api.github.com/repos/chrisgribbs/Diary/releases/latest';

/**
 * transport: { send(string), onMessage(fn(string)) }
 * dirs: { files, cache }  the app's private folders
 */
function start(transport, dirs, opts = {}) {
  const ascii = s => s.replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const toPage = obj => transport.send('P' + ascii(JSON.stringify(obj)));
  const toApp = obj => transport.send('N' + ascii(JSON.stringify(obj)));

  // Saved passwords and keys are encrypted with a key that Android's keystore keeps for this app.
  let secret = null, secretKnown = false;
  let secretWaiters = [];
  const haveSecret = () => secretKnown ? Promise.resolve() : new Promise(r => secretWaiters.push(r));
  const protect = s => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', secret, iv);
    const body = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
  };
  const unprotect = s => {
    const b = Buffer.from(String(s), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', secret, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  };

  const dataDir = opts.dataDir || path.join(dirs.files, 'journal');
  const deviceDir = path.join(dirs.files, 'device');
  const tmpDir = path.join(dirs.cache, 'tmp');
  for (const d of [dataDir, deviceDir, tmpDir]) fs.mkdirSync(d, { recursive: true });
  // Leftovers from last time (exports already saved, backups already restored).
  for (const f of fs.readdirSync(tmpDir)) { try { fs.rmSync(path.join(tmpDir, f), { recursive: true, force: true }); } catch {} }

  const backend = createBackend({
    dataDir, deviceDir, tmpDir,
    canProtect: () => !!secret,
    protect, unprotect,
    testTrust: !!opts.testTrust,
    fetch: (url, o) => fetch(url, o),
    send: (ev, ...args) => toPage({ ev, args }),
    openBrowser: url => toApp({ op: 'openUrl', url }),
    // Google sign-in: the same as on Windows (the phone's browser signs in and comes back to WellWrite).
    googleConfig: opts.googleConfig !== undefined ? opts.googleConfig : (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'google-config.json'), 'utf8')); } catch { return null; } })(),
    apiBibleBase: opts.apiBibleBase || null,
    picturesUrl: opts.picturesUrl || null,
  });
  const { handle, vault } = backend;
  const notHere = () => { throw new Error('That isn’t available on Android yet'); };

  // ---------- files: written here, then Android asks where to keep them ----------
  const stamp = () => new Date().toISOString().slice(0, 10);
  const tmpFile = name => path.join(tmpDir, crypto.randomBytes(6).toString('hex') + '-' + name);
  const toSave = (file, name, mime, value) => ({ save: { path: file, name, mime }, value });
  handle('backup:export', () => {
    const f = tmpFile('backup.wellwrite');
    const count = vault.exportBackup(f);
    return toSave(f, `WellWrite backup ${stamp()}.wellwrite`, 'application/octet-stream', { count });
  });
  handle('export:readable', () => {
    const f = tmpFile('journal.html');
    const count = vault.exportReadable(f, stripActive);
    return toSave(f, 'WellWrite journal.html', 'text/html', { count });
  });
  handle('quotes:export', text => {
    const f = tmpFile('quotes.txt');
    fs.writeFileSync(f, '﻿' + String(text).replace(/\n/g, '\r\n'));
    return toSave(f, 'WellWrite quotes.txt', 'text/plain', {});
  });
  // A file you picked (a backup to restore), copied in so it can be read.
  handle('android:stageFile', (name, b64) => {
    const f = tmpFile(String(name || 'file').replace(/[^\w. -]+/g, '_').slice(0, 80));
    fs.writeFileSync(f, Buffer.from(String(b64), 'base64'));
    return f;
  });
  // Your readings file: Android can't watch a file in another app, so WellWrite keeps a copy.
  // Choose it again after you change it.
  handle('android:setReadingsText', (name, text) => {
    const dir = path.join(deviceDir, 'readings');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
    const f = path.join(dir, String(name || 'readings.txt').replace(/[^\w. -]+/g, '_').slice(0, 80) || 'readings.txt');
    fs.writeFileSync(f, String(text));
    return backend.setReadingsFile(f);
  });
  handle('readings:pickFile', notHere);
  handle('backup:pick', notHere);
  handle('backup:chooseFolder', notHere);
  handle('backup:showFolder', () => true);
  handle('app:showDataFolder', () => true);
  handle('shell:openExternal', url => { if (/^https?:\/\//i.test(String(url))) toApp({ op: 'openUrl', url: String(url) }); return true; });
  handle('wp:open', url => { if (backend.wpLinkOk(url)) toApp({ op: 'openUrl', url }); return true; });

  // ---------- updates: new versions are on GitHub; Android installs them after you download ----------
  let update = null;   // { version, url }
  const newer = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };
  async function checkForUpdate() {
    const res = await fetch(opts.releasesUrl || RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'WellWrite-Android' } });
    if (!res.ok) throw new Error('offline');
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name || ''));
    if (version && apk && newer(version, backend.version)) update = { version, url: apk.browser_download_url };
    return update;
  }
  handle('app:version', () => ({ version: backend.version, updateReady: update && update.version, platform: 'android' }));
  handle('app:checkUpdates', async () => {
    try { const u = await checkForUpdate(); return u ? { status: 'ready', version: u.version } : { status: 'latest' }; }
    catch { return { status: 'offline' }; }
  });
  // The Android app downloads and installs it (android/…/Updater.java); this just says which file.
  handle('app:installUpdate', () => (update && /^https:\/\/github\.com\/chrisgribbs\/Diary\/releases\/download\//.test(update.url) ? update : null));
  if (!opts.noUpdateCheck) {
    const check = () => checkForUpdate().then(u => { if (u) toPage({ ev: 'app:update-ready', args: [u.version] }); }).catch(() => {});
    setTimeout(check, 8000);
    setInterval(check, 6 * 60 * 60 * 1000);
  }

  // ---------- messages ----------
  transport.onMessage(async raw => {
    raw = String(raw);
    if (raw[0] === 'S') {
      let m; try { m = JSON.parse(raw.slice(1)); } catch { return; }
      if (m.type === 'secret') {
        // An empty key: this phone can't keep secrets, so nothing is saved (you type your password each time).
        if (/^[0-9a-f]{64}$/.test(m.key || '')) secret = Buffer.from(m.key, 'hex');
        secretKnown = true;
        secretWaiters.forEach(r => r()); secretWaiters = [];
      }
      return;
    }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (typeof m.id !== 'number' || typeof m.ch !== 'string') return;
    if (!opts.testTrust) await haveSecret();
    toPage({ id: m.id, r: await backend.call(m.ch, m.args) });
  });
  backend.startTimers();
  transport.send('Y');   // ready
  return backend;
}

module.exports = { start };

// On the phone: Node's link to the Android app.
if (require.main === module) {
  const bridge = process._linkedBinding('rn_bridge');
  const listeners = [];
  bridge.registerChannel('wellwrite', (_ch, msg) => listeners.forEach(fn => fn(msg)));
  start({ send: s => bridge.sendMessage('wellwrite', s), onMessage: fn => listeners.push(fn) },
    { files: process.argv[2], cache: process.argv[3] });
}
