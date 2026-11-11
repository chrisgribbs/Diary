'use strict';
// Sync through the real Google Drive code (src/gdrive.js), against a stand-in for Google's servers.
// Run: node test/sync-drive.test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Vault } = require('../src/vault');
const { GoogleDrive } = require('../src/gdrive');
const { Sync } = require('../src/sync');
const google = require('./fake-google');

(async () => {
  const g = await google.start();
  const ep = { auth: g.url + '/auth', token: g.url + '/token', revoke: g.url + '/revoke', api: g.url + '/drive/v3', upload: g.url + '/upload/drive/v3' };
  const device = async pw => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-gd-'));
    const vault = new Vault(dir); vault.create(pw);
    const drive = new GoogleDrive({ config: { clientId: 'test' }, storeFile: path.join(dir, 'google.json'), protect: t => t, unprotect: t => t, endpoints: ep,
      openBrowser: url => fetch(url).catch(() => {}) });   // "the browser" follows the sign-in back to WellWrite
    await drive.connect();
    return { dir, vault, sync: new Sync({ vault, drive, dataDir: dir }) };
  };
  const A = await device('river-stone'), B = await device('phone-pass');
  assert.equal(A.sync.status().email, 'me@example.com');
  const big = '<p>' + 'x'.repeat(3 * 1024 * 1024) + '</p>';   // a few photos' worth
  A.vault.save({ id: 'aaaaaaaa-0001', date: '2026-11-11', title: 'From the computer', html: big, text: 'From the computer' });
  await A.sync.enable('river-stone');
  const folder = [...g.files.values()].find(f => f.name === 'WellWrite sync');
  assert.ok(folder && folder.mimeType === 'application/vnd.google-apps.folder', 'a WellWrite sync folder');
  await B.sync.enable('river-stone');
  assert.equal(B.vault.get('aaaaaaaa-0001').html.length, big.length, 'large entry arrived whole');
  B.vault.save({ id: 'bbbbbbbb-0002', date: '2026-11-11', title: 'From the phone', html: '<p>hi</p>', text: 'hi' });
  B.vault.remove('aaaaaaaa-0001');
  await B.sync.run(); await A.sync.run();
  assert.deepEqual(A.vault.list().map(m => m.title), ['From the phone'], 'add and delete arrived');
  assert.equal(A.sync.status().error, '');
  // Drive files are binary scrambles, not text
  for (const f of g.files.values()) if (f.data && f.name !== 'sync-key') assert.ok(!f.data.includes('From the'), 'encrypted');
  A.sync.stop(); B.sync.stop(); g.close();
  for (const d of [A, B]) fs.rmSync(d.dir, { recursive: true, force: true });
  console.log('sync through Google Drive code passed');
})().catch(e => { console.error(e); process.exit(1); });
