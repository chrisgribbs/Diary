'use strict';
// Sync between two devices through a pretend Google Drive.
// Run: node test/sync.test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Vault } = require('../src/vault');
const { Sync, KEY_FILE } = require('../src/sync');

/** One Drive shared by every device: files with names, contents and version numbers. */
function makeDrive() {
  const files = new Map(); let n = 0;
  const shared = { files, folder: null, connected: true, puts: 0 };
  const device = () => ({
    status: () => ({ available: true, connected: shared.connected, email: 'me@example.com' }),
    async syncFolderId() { return shared.folder || (shared.folder = 'folder-1'); },
    async listFolder() { return [...files.values()].filter(f => !f.trashed).map(f => ({ id: f.id, name: f.name, version: String(f.version) })); },
    async putFile(_folder, name, data, id) {
      shared.puts++;
      if (id) { const f = files.get(id); if (!f || f.trashed) { const e = new Error('not found'); e.status = 404; throw e; } f.data = Buffer.from(data); f.version++; return { id, version: String(f.version) }; }
      const f = { id: 'f' + (++n), name, data: Buffer.from(data), version: 1 };
      files.set(f.id, f); return { id: f.id, version: '1' };
    },
    async readFile(id) { return files.get(id).data; },
    async trashFile(id) { files.get(id).trashed = true; },
  });
  return { shared, device };
}
function makeDevice(drive, password = 'river-stone') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-sync-'));
  const vault = new Vault(dir);
  vault.create(password);
  const events = [];
  const sync = new Sync({ vault, drive: drive.device(), dataDir: dir, send: (ev, a) => events.push([ev, a]) });
  // as backend.js does: changes start a sync (here we run them by hand, so only remember)
  return { dir, vault, sync, events };
}
const entry = (vault, id, title, html = '<p>x</p>', extra = {}) => vault.save({ id, date: '2026-11-11', title, html, text: title, ...extra });
const wait = ms => new Promise(r => setTimeout(r, ms));
const ID1 = 'aaaaaaaa-1111', ID2 = 'bbbbbbbb-2222', ID3 = 'cccccccc-3333';

(async () => {
  const drive = makeDrive();
  const A = makeDevice(drive), B = makeDevice(drive, 'other-password');

  // ---- turning on: the first device makes the key with its journal password ----
  await assert.rejects(A.sync.enable('wrong-one'), /isn’t your journal password/);
  entry(A.vault, ID1, 'Monday'); await wait(5);
  entry(A.vault, ID2, 'Tuesday');
  await A.sync.enable('river-stone');
  const names = [...drive.shared.files.values()].map(f => f.name).sort();
  assert.deepEqual(names, ['e-' + ID1, 'e-' + ID2, KEY_FILE], 'entries and the key are on Drive');
  for (const f of drive.shared.files.values()) assert.ok(!f.data.includes('Monday') && !f.data.includes('<p>'), 'nothing readable on Drive');
  assert.ok(A.sync.status().on && A.sync.status().last, 'on, with a time');

  // ---- the second device joins with the first device's password, and gets everything ----
  await assert.rejects(B.sync.enable('other-password'), /password your other device uses/);
  entry(B.vault, ID3, 'Phone note');
  await B.sync.enable('river-stone');
  assert.equal(B.vault.get(ID1).title, 'Monday', 'B got Monday');
  assert.equal(B.vault.get(ID2).title, 'Tuesday');
  await A.sync.run();
  assert.equal(A.vault.get(ID3).title, 'Phone note', 'A got the phone’s note');
  assert.ok(A.events.some(([ev, a]) => ev === 'sync:changed' && a.changed.includes(ID3)), 'page told what changed');

  // ---- an edit on one side arrives on the other; nothing is sent when nothing changed ----
  await wait(5); entry(A.vault, ID1, 'Monday, edited', '<p>more</p>');
  await A.sync.run(); await B.sync.run();
  assert.equal(B.vault.get(ID1).title, 'Monday, edited');
  const puts = drive.shared.puts;
  await A.sync.run(); await B.sync.run();
  assert.equal(drive.shared.puts, puts, 'quiet when nothing changed');

  // ---- deleting carries across ----
  B.vault.remove(ID2);
  await B.sync.run(); await A.sync.run();
  assert.ok(!A.vault.index.has(ID2), 'deleted on A too');
  await A.sync.run(); await B.sync.run();
  assert.ok(!B.vault.index.has(ID2), 'stays deleted');

  // ---- both edit the same entry: both versions are kept ----
  await wait(5); entry(A.vault, ID3, 'Phone note — computer edit');
  await wait(5); entry(B.vault, ID3, 'Phone note — phone edit');
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  for (const d of [A, B]) {
    const titles = d.vault.list().map(m => m.title).sort();
    assert.ok(titles.includes('Phone note — phone edit') || titles.includes('Phone note — computer edit'));
    assert.ok(titles.some(t => / \(from another device\)$/.test(t)), 'a copy of the other version');
    assert.equal(d.vault.list().length, 3, 'Monday, the note, and the copy');
  }
  const aT = A.vault.list().map(m => m.title).sort(), bT = B.vault.list().map(m => m.title).sort();
  assert.deepEqual(aT, bT, 'both devices end up the same');

  // ---- edited on one, deleted on the other: the edit wins ----
  await wait(5); entry(A.vault, ID1, 'Monday, kept');
  B.vault.remove(ID1);
  await B.sync.run(); await A.sync.run(); await B.sync.run();
  assert.equal(B.vault.get(ID1).title, 'Monday, kept', 'edit beats delete');
  assert.equal(A.vault.get(ID1).title, 'Monday, kept');

  // ---- an entry open with unsaved changes waits; then both versions are kept ----
  await wait(5); entry(B.vault, ID1, 'Monday from phone');
  await B.sync.run();
  A.sync.hold(ID1);
  await A.sync.run();
  assert.equal(A.vault.get(ID1).title, 'Monday, kept', 'not changed under the open editor');
  await wait(5); entry(A.vault, ID1, 'Monday typed on computer'); A.sync.hold(null);
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  assert.equal(A.vault.get(ID1).title, 'Monday typed on computer');
  assert.ok(A.vault.list().some(m => m.title === 'Monday from phone (from another device)'), 'phone’s version kept as a copy');
  assert.deepEqual(A.vault.list().map(m => m.title).sort(), B.vault.list().map(m => m.title).sort());

  // ---- categories: the newest list wins ----
  await wait(5); A.vault.setCategories([{ id: 'family', name: 'Family', color: '#a23b56' }]);
  await A.sync.run(); await B.sync.run();
  assert.deepEqual(B.vault.getMeta().categories.map(c => c.name), ['Family']);
  await wait(5); B.vault.setCategories([]);
  await B.sync.run(); await A.sync.run();
  assert.deepEqual(A.vault.getMeta().categories, [], 'removing a category carries across');

  // ---- locked: sync does nothing and keeps nothing readable ----
  A.vault.lock(); A.sync.stop();
  assert.equal(await A.sync.run(), null);
  assert.ok(!fs.readFileSync(path.join(A.dir, 'sync.enc')).includes('items'), 'sync state is encrypted');
  A.vault.unlock('river-stone'); A.sync.st = null;
  assert.ok(A.sync.status().on, 'still on after unlocking');

  // ---- a third device joins later, after the first changed its password ----
  A.vault.changePassword('river-stone', 'new-password-1'); await A.sync.passwordChanged('new-password-1');
  const C = makeDevice(drive, 'whatever-1');
  await assert.rejects(C.sync.enable('river-stone'), /password your other device uses/);
  await C.sync.enable('new-password-1');
  assert.deepEqual(C.vault.list().map(m => m.title).sort(), A.vault.list().map(m => m.title).sort(), 'third device has everything');

  // ---- someone empties the sync folder in Drive ----
  for (const f of drive.shared.files.values()) if (f.name !== KEY_FILE) f.trashed = true;
  await A.sync.run();
  assert.equal([...drive.shared.files.values()].filter(f => !f.trashed && f.name.startsWith('e-')).length, A.vault.list().length, 'entries sent again');

  // ---- offline: an error, nothing lost, and it catches up later ----
  drive.shared.connected = false;
  const dev = A.sync.drive; const realList = dev.listFolder; dev.listFolder = async () => { throw new Error('fetch failed'); };
  await wait(5); entry(A.vault, ID3, 'Written offline');
  await A.sync.run();
  assert.match(A.sync.status().error, /fetch failed/);
  dev.listFolder = realList; drive.shared.connected = true;
  await A.sync.run(); await B.sync.run();
  assert.equal(A.sync.status().error, '');
  assert.equal(B.vault.get(ID3).title, 'Written offline', 'caught up after being offline');

  // ---- turning off ----
  A.sync.disable();
  assert.ok(!A.sync.status().on);
  await wait(5); entry(A.vault, ID1, 'Not synced');
  await A.sync.run(); await B.sync.run();
  assert.notEqual(B.vault.get(ID1).title, 'Not synced');

  for (const d of [A, B, C]) { d.sync.stop(); fs.rmSync(d.dir, { recursive: true, force: true }); }
  console.log('sync tests passed');
})().catch(e => { console.error(e); process.exit(1); });
