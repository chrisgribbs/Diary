'use strict';
// Settings → Sync in the app: connect Google Drive, turn sync on, get an entry written on another device.
// Uses a stand-in for Google (test/fake-google.js). Run: xvfb-run -a npx electron --no-sandbox test/sync.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-sync-shots'));
fs.mkdirSync(OUT, { recursive: true });
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-sync-'));
const google = require('./fake-google');
const { app, shell } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
shell.openExternal = async url => { fetch(url).catch(() => {}); };   // "the browser": signs in and comes straight back
const wait = ms => new Promise(r => setTimeout(r, ms));

google.start().then(async g => {
  process.env.WELLWRITE_GOOGLE_URL = g.url;
  process.env.WELLWRITE_GOOGLE_CLIENT_ID = 'test';
  const { getWindow } = require('../main.js');
  await app.whenReady();
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1300, 900);
  const errors = [];
  win.webContents.on('console-message', e => { const l = e.level ?? e.params?.level; if (l === 'error' || l === 3) errors.push(e.message ?? e.params?.message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`);
  const shot = async n => { await wait(400); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const text = sel => js(`return (document.querySelector('${sel}') || {}).textContent || ''`);
  const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(150); } return false; };

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);
  await js(`if (!state.current) await newEntry(); body.focus(); document.execCommand('insertText', false, 'Written on the computer'); markDirty();`); await js(`await saveNow()`);
  assert.equal(await js(`return state.metas.length`), 1, 'entry saved');

  await js(`openSettings('sync')`);
  assert.ok(await until(async () => /Connect Google Drive/.test(await text('#syncSection'))), 'offers to connect');
  await shot('s1-connect');
  await js(`[...document.querySelectorAll('#syncSection button')].find(b => b.textContent === 'Connect Google Drive').click()`);
  assert.ok(await until(() => js(`return !!document.querySelector('#dlg input[type=password]')`)), 'asks for the password after connecting');
  await shot('s2-password');
  await js(`const i = document.querySelector('#dlg input[type=password]'); i.value = 'river-stone'; document.querySelector('#dlgForm').requestSubmit();`);
  assert.ok(await until(async () => /Sync is on/.test(await text('#syncSection')), 15000), 'sync is on');
  assert.ok(await until(async () => /Last synced/.test(await text('#syncSection'))), 'shows when it last synced');
  await shot('s3-on');
  assert.ok([...g.files.values()].some(f => /^e-/.test(f.name)), 'entry sent to Drive');
  await js(`document.querySelector('.set-done').click()`);
  assert.ok(await until(async () => (await text('#syncState')) === 'Synced'), 'footer says Synced');

  // another device (here: a second journal in this process) adds an entry
  const { Vault } = require('../src/vault'), { GoogleDrive } = require('../src/gdrive'), { Sync } = require('../src/sync');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-other-'));
  const v = new Vault(dir); v.create('phone-pass');
  const d = new GoogleDrive({ config: { clientId: 'test' }, storeFile: path.join(dir, 'g.json'), protect: t => t, unprotect: t => t, openBrowser: u => fetch(u).catch(() => {}),
    endpoints: { auth: g.url + '/auth', token: g.url + '/token', revoke: g.url + '/revoke', api: g.url + '/drive/v3', upload: g.url + '/upload/drive/v3' } });
  await d.connect();
  const other = new Sync({ vault: v, drive: d, dataDir: dir });
  await other.enable('river-stone');
  assert.ok(v.list().some(m => /Written on the computer/.test(m.text)), 'other device got the computer’s entry');
  v.save({ id: 'pppppppp-0001', date: '2026-11-10', title: 'Written on the phone', html: '<p>Hello from the phone</p>', text: 'Hello from the phone' });
  await other.run(); other.stop();

  await js(`openSettings('sync')`); await wait(600);
  await js(`[...document.querySelectorAll('#syncSection button')].find(b => b.textContent === 'Sync now').click()`);
  assert.ok(await until(() => js(`return state.metas.some(m => m.title === 'Written on the phone')`)), 'phone entry arrived');
  await js(`document.querySelector('.set-done').click()`); await wait(300);
  assert.ok(await until(async () => /Written on the phone/.test(await text('#list'))), 'and shows in the list');
  await shot('s4-arrived');

  // turning off
  await js(`openSettings('sync')`); await wait(600);
  await js(`[...document.querySelectorAll('#syncSection button')].find(b => b.textContent === 'Turn off').click()`); await wait(400);
  await js(`[...document.querySelectorAll('#dlg button')].find(b => b.textContent === 'Turn off').click()`);
  assert.ok(await until(async () => /Turn on sync/.test(await text('#syncSection'))), 'off again');
  assert.ok(await js(`return document.querySelector('#syncState').hidden`), 'footer status hidden when off');

  assert.deepEqual(errors, [], 'no console errors');
  g.close();
  console.log('sync e2e passed; shots in', OUT);
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
