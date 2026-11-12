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
  const pack = [
    { text: 'Be still, and know.', author: 'Psalm 46' },
    { text: 'All shall be well.', author: 'Julian of Norwich' },
    { text: 'Pray as you can, not as you can’t.', author: 'Dom John Chapman' },
  ];
  // Both devices have the built-in collection, and some quotes of their own, before syncing quotes.
  for (const d of [A, B]) d.vault.syncPack('classics', pack);
  const mineA = { text: 'A line I found on the desktop.', author: 'Someone', mine: false };
  const mineB = { text: 'Written on the phone.', author: 'Chris Gribble', mine: true };
  A.vault.setQuotes([...A.vault.getQuotes(), mineA], '');   // as before quotes synced: no time yet
  B.vault.setQuotes([...B.vault.getQuotes(), mineB], '');
  const id = (v, text) => v.getQuotes().find(q => q.text === text).id;
  // On the phone, a favourite and a deletion in the collection, before syncing.
  B.vault.setQuotes(B.vault.getQuotes().map(q => (q.text === 'All shall be well.' ? { ...q, fav: true } : q)).filter(q => q.text !== 'Pray as you can, not as you can’t.'), '');

  await A.sync.enable('river-stone');
  await B.sync.enable('river-stone');
  await A.sync.run(); await B.sync.run(); await A.sync.run();

  // First time: nothing lost; both devices end up with the same quotes.
  const texts = v => v.getQuotes().map(q => q.text + (q.fav ? '*' : '')).sort();
  for (const d of [A, B]) {
    const t = texts(d.vault);
    assert.ok(t.includes('A line I found on the desktop.'), 'desktop quote kept');
    assert.ok(t.includes('Written on the phone.'), 'phone quote kept');
    assert.ok(t.includes('All shall be well.*'), 'the phone’s favourite counts');
    assert.ok(!t.some(x => x.startsWith('Pray as you can')), 'the phone’s deletion counts');
  }
  assert.deepEqual(texts(A.vault), texts(B.vault), 'same quotes on both');
  for (const f of drive.shared.files.values()) assert.ok(!f.data.includes('Written on the phone'), 'quotes are encrypted on Drive');

  // An edit, a new quote and a deletion on the desktop arrive on the phone.
  await wait(5);
  A.vault.setQuotes([...A.vault.getQuotes()
    .filter(q => q.text !== 'A line I found on the desktop.')
    .map(q => (q.text === 'Be still, and know.' ? { ...q, themes: ['Stillness'] } : q)),
    { text: 'Added later on the desktop.', author: 'Henri Nouwen' }]);
  await A.sync.run(); await B.sync.run();
  let t = texts(B.vault);
  assert.ok(t.includes('Added later on the desktop.'), 'new quote arrived');
  assert.ok(!t.includes('A line I found on the desktop.'), 'deleted quote went');
  assert.deepEqual(B.vault.getQuotes().find(q => q.text === 'Be still, and know.').themes, ['Stillness'], 'edit to a built-in reading arrived');

  // The collection updating itself later doesn't bring back the deleted reading or undo the edit.
  for (const d of [A, B]) d.vault.syncPack('classics', pack);
  for (const d of [A, B]) {
    assert.ok(!d.vault.getQuotes().some(q => q.text.startsWith('Pray as you can')), 'deleted reading stays deleted');
    assert.deepEqual(d.vault.getQuotes().find(q => q.text === 'Be still, and know.').themes, ['Stillness'], 'edit kept');
  }

  // Unfavourite on the phone → desktop; page is told.
  await wait(5);
  B.vault.setQuotes(B.vault.getQuotes().map(q => ({ ...q, fav: false })));
  await B.sync.run(); A.events.length = 0; await A.sync.run();
  assert.ok(!A.vault.getQuotes().some(q => q.fav), 'favourite removed on the desktop too');
  assert.ok(A.events.some(([ev, a]) => ev === 'sync:changed' && a.quotes), 'page told quotes changed');

  // Quiet when nothing changed.
  const puts = drive.shared.puts;
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  assert.equal(drive.shared.puts, puts, 'nothing sent when nothing changed');

  for (const d of [A, B]) { d.sync.stop(); fs.rmSync(d.dir, { recursive: true, force: true }); }
  console.log('quote sync tests passed');
})().catch(e => { console.error(e); process.exit(1); });
