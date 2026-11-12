'use strict';
// The Android app's page API matches the Windows one, and its engine answers through the message protocol.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const names = src => [...src.matchAll(/^\s{2,4}(\w+): /gm)].map(m => m[1]);
const desktop = names(fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8')).filter(n => n !== 'platform' && n !== 'onBack');
const android = names(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'android.js'), 'utf8'));
const missing = desktop.filter(n => !android.includes(n));
assert.deepStrictEqual(missing, [], 'android.js is missing: ' + missing.join(', '));

const { start } = require('../android/node/main');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-android-'));
const sent = [];
let listener;
const replies = new Map();
const appMsgs = [];
const ask = (id, ch, ...args) => new Promise(resolve => {
  replies.set(id, resolve);
  listener(JSON.stringify({ id, ch, args }));
});
const pump = setInterval(() => {
  while (sent.length) {
    const s = sent.shift();
    if (s[0] === 'N') { appMsgs.push(JSON.parse(s.slice(1))); continue; }
    if (s[0] !== 'P') continue;
    assert.ok(/^[\x00-\x7e]*$/.test(s), 'messages are plain ASCII');
    const m = JSON.parse(s.slice(1));
    if (replies.has(m.id)) { replies.get(m.id)(m.r); replies.delete(m.id); }
  }
}, 5);

(async () => {
  const fakeGoogle = await require('./fake-google').start();
  start({ send: s => sent.push(s), onMessage: fn => { listener = fn; } }, { files: path.join(base, 'f'), cache: path.join(base, 'c') }, { noUpdateCheck: true, googleConfig: { clientId: 'test' }, googleBase: fakeGoogle.url });
  // Requests wait for the device key.
  const early = ask(1, 'vault:status');
  listener('S' + JSON.stringify({ type: 'secret', key: 'ab'.repeat(32) }));
  assert.strictEqual((await early).value.exists, false);
  assert.ok((await early).value.trust.available, 'can remember a password with a device key');
  assert.ok((await ask(2, 'vault:create', 'pw-123456')).ok);
  const e = (await ask(3, 'entries:save', { title: 'Kia ora 🌿 — “hi”', html: '<p>ä</p>' })).value;
  assert.strictEqual((await ask(4, 'entries:get', e.id)).value.title, 'Kia ora 🌿 — “hi”');
  const exp = (await ask(5, 'backup:export')).value;
  assert.ok(exp.save && fs.existsSync(exp.save.path) && /\.wellwrite$/.test(exp.save.name) && exp.value.count === 1, 'backup written for Android to save');
  const staged = (await ask(6, 'android:stageFile', 'b.wellwrite', fs.readFileSync(exp.save.path).toString('base64'))).value;
  assert.ok(fs.existsSync(staged));
  assert.ok((await ask(7, 'vault:setTrust', 'trust')).ok);
  const trusted = JSON.parse(fs.readFileSync(path.join(base, 'f', 'device', 'trusted.json'), 'utf8'));
  assert.ok(!JSON.stringify(trusted).includes('pw-123456'));
  const rf = (await ask(8, 'android:setReadingsText', 'My readings.txt', 'A line\n— Someone')).value;
  assert.ok(rf.startsWith(path.join(base, 'f', 'device')));
  assert.strictEqual((await ask(9, 'readings:readFile')).value.text, 'A line\n— Someone');
  // Connecting Google Drive on the phone: the browser opens, signs in, comes back; WellWrite stays awake meanwhile.
  const connecting = ask(10, 'google:connect');
  let open;
  for (let i = 0; i < 100 && !(open = appMsgs.find(m => m.op === 'openUrl')); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(open, 'the sign-in page opens in the browser');
  assert.ok(appMsgs.some(m => m.op === 'keepRunning' && m.on === true), 'Android is asked to keep WellWrite running');
  const page = await (await fetch(open.url)).text();   // the fake Google sends the browser straight back
  assert.ok(page.includes('wellwrite://signed-in'), 'the page offers a way back to the app');
  const conn = await connecting;
  assert.ok(conn.ok, 'google:connect works on Android: ' + conn.error);
  assert.ok(appMsgs.some(m => m.op === 'keepRunning' && m.on === false), 'and is told when sign-in is over');
  assert.strictEqual((await ask(11, 'app:version')).value.platform, 'android');
  assert.strictEqual((await ask(12, 'nope')).ok, false);
  clearInterval(pump);
  fakeGoogle.close();
  fs.rmSync(base, { recursive: true, force: true });
  console.log('android tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
