'use strict';
// Quotes on a third device, and quotes changed on two devices at once: nothing lost, nothing deleted comes back.
// Run: node test/sync-quotes-more.test.js
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

const W = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu amber birch cedar dune ember fern grove heath iris jade knoll larch moss nettle'.split(' ');
const wait = ms => new Promise(r => setTimeout(r, ms));
const fsx = require('fs'), dirR = path.join(__dirname, '..', 'src', 'readings');
const builtinPacks = () => fsx.readdirSync(dirR).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fsx.readFileSync(dirR + '/' + f, 'utf8'))).filter(p => /^[a-z0-9]{1,20}$/.test(p.id || '')).map(p => ({ id: p.id, items: p.items || [], retired: p.retired || [] }));
(async () => {
  const drive = makeDrive();
  const P = builtinPacks();
  const seed = d => { for (const p of P) d.vault.syncPack(p.id, p.items, p.retired); };
  const A = makeDevice(drive), B = makeDevice(drive, 'password-b');
  seed(A); seed(B);
  // Chris's kinds of quotes on the computer: his own, a readings file, favourites, an edit, deletions.
  const own = Array.from({ length: 40 }, (_, i) => ({ text: 'My own quote, ' + W[i] + ' ' + W[(i * 3) % 40] + '.', author: 'Chris', mine: true }));
  A.vault.setQuotes([...A.vault.getQuotes(), ...own]);
  A.vault.syncPack('file', Array.from({ length: 25 }, (_, i) => ({ text: 'From my readings file, ' + W[i] + ' ' + W[(i * 7) % 40] + '.', author: 'Reader' })));
  let qs = A.vault.getQuotes();
  const builtinIds = qs.filter(q => q.pack && q.pack !== 'file').map(q => q.id);
  qs = qs.map(q => builtinIds.slice(0, 10).includes(q.id) ? { ...q, fav: true } : q).filter(q => !builtinIds.slice(10, 15).includes(q.id));
  qs = qs.map(q => q.id === builtinIds[20] ? { ...q, text: q.text + ' (edited)' } : q);
  A.vault.setQuotes(qs);
  await A.sync.enable('river-stone'); await B.sync.enable('river-stone'); await A.sync.run(); await B.sync.run();
  // Later, the readings file on the computer grows (WellWrite reads it again when it changes).
  const r40 = A.vault.syncPack('file', Array.from({ length: 40 }, (_, i) => ({ text: 'From my readings file, ' + W[i] + ' ' + W[(i * 7) % 40] + '.', author: 'Reader' })));
  assert.equal(r40.added, 15);
  await A.sync.run(); await B.sync.run();
  assert.equal(B.vault.getQuotes().filter(q => q.pack === 'file').length, 40, 'a readings file that grew reaches the phone');
  // A third device joins. As in the app: sync can run before its collections are added, or after.
  for (const order of ['sync first', 'collections first']) {
    const C = makeDevice(drive, 'password-c');
    if (order === 'collections first') seed(C);
    await C.sync.enable('river-stone');
    if (order === 'sync first') seed(C);
    await C.sync.run(); await A.sync.run(); await C.sync.run();
    const key = q => q.text + '|' + q.author + '|' + !!q.fav;
    const a = new Set(A.vault.getQuotes().map(key)), c = new Set(C.vault.getQuotes().map(key));
    const missing = [...a].filter(x => !c.has(x)), extra = [...c].filter(x => !a.has(x));
    const fileN = v => v.getQuotes().filter(q => q.pack === 'file').length;
    assert.equal(fileN(A.vault), 40, order + ': the computer keeps its readings'); assert.equal(fileN(C.vault), 40, order + ': the third device has them');

    assert.deepEqual(missing, [], order + ': nothing missing on the third device');
    assert.deepEqual(extra, [], order + ': nothing extra');
  }
  // Two devices add quotes before either syncs: both kept everywhere. One deletes a quote: it stays deleted.
  const addOwn = (d, text) => d.vault.setQuotes([...d.vault.getQuotes(), { text, author: 'Chris', mine: true }]);
  addOwn(A, 'Written on the computer this morning.'); await wait(5);
  addOwn(B, 'Written on the phone at lunch.');
  const gone = A.vault.getQuotes().find(q => /My own quote, alpha/.test(q.text));
  await wait(5); A.vault.setQuotes(A.vault.getQuotes().filter(q => q.id !== gone.id));
  for (let i = 0; i < 3; i++) { await A.sync.run(); await B.sync.run(); }
  for (const [d, name] of [[A, 'computer'], [B, 'phone']]) {
    const t = d.vault.getQuotes().map(q => q.text);
    assert(t.includes('Written on the computer this morning.') && t.includes('Written on the phone at lunch.'), name + ': both new quotes');
    assert(!t.includes(gone.text), name + ': the deleted quote stays deleted');
  }
  assert.equal(A.vault.getQuotes().length, B.vault.getQuotes().length, 'the same quotes on both');
  // Taken out of the readings file: gone from the other devices too.
  A.vault.syncPack('file', Array.from({ length: 30 }, (_, i) => ({ text: 'From my readings file, ' + W[i] + ' ' + W[(i * 7) % 40] + '.', author: 'Reader' })));
  for (let i = 0; i < 2; i++) { await A.sync.run(); await B.sync.run(); }
  assert.equal(B.vault.getQuotes().filter(q => q.pack === 'file').length, 30, 'readings taken out of the file go from the phone too');
  // Deleted, then added again later: it's back.
  await wait(5); addOwn(B, gone.text);
  for (let i = 0; i < 2; i++) { await B.sync.run(); await A.sync.run(); }
  assert(A.vault.getQuotes().some(q => q.text === gone.text), 'added again after deleting: back');
  console.log('more quote sync tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
