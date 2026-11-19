'use strict';
// Bible study bookmarks and the prayer list, synced between two devices through a pretend Google Drive.
// Run: node test/sync-study.test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Vault } = require('../src/vault');
const { Sync } = require('../src/sync');

function makeDrive() {
  const files = new Map(); let n = 0;
  const shared = { files, folder: null };
  const device = () => ({
    status: () => ({ available: true, connected: true, email: 'me@example.com' }),
    async syncFolderId() { return shared.folder || (shared.folder = 'folder-1'); },
    async listFolder() { return [...files.values()].filter(f => !f.trashed).map(f => ({ id: f.id, name: f.name, version: String(f.version) })); },
    async putFile(_folder, name, data, id) {
      if (id) { const f = files.get(id); if (!f || f.trashed) { const e = new Error('not found'); e.status = 404; throw e; } f.data = Buffer.from(data); f.version++; return { id, version: String(f.version) }; }
      const f = { id: 'f' + (++n), name, data: Buffer.from(data), version: 1 };
      files.set(f.id, f); return { id: f.id, version: '1' };
    },
    async readFile(id) { return files.get(id).data; },
    async trashFile(id) { files.get(id).trashed = true; },
  });
  return { shared, device };
}
function makeDevice(drive) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-sync-study-'));
  const vault = new Vault(dir);
  vault.create('river-stone');
  const events = [];
  const sync = new Sync({ vault, drive: drive.device(), dataDir: dir, send: (ev, a) => events.push([ev, a]) });
  return { dir, vault, sync, events };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const prayer = (id, text, extra = {}) => ({ id, text, note: '', at: '2026-11-19', done: '', ...extra });
const bookmark = (id, author) => ({ id, author, work: 'A work', section: 's', text: `Words of ${author}.`, credit: 'c' });
const texts = v => v.getStudy().prayers.map(p => p.text).sort();
const marks = v => v.getStudy().bookmarks.map(b => b.id).sort();

(async () => {
  const drive = makeDrive();
  const A = makeDevice(drive), B = makeDevice(drive);
  const both = async () => { await A.sync.run(); await B.sync.run(); await A.sync.run(); await B.sync.run(); };

  // Each device has its own before syncing: both are kept.
  A.vault.setStudy({ prayers: [prayer('p1', 'For Sam, starting work')], bookmarks: [bookmark('greek:12', 'Robertson')] });
  await wait(5);
  B.vault.setStudy({ prayers: [prayer('p2', 'For Mum’s recovery')], bookmarks: [bookmark('devotional:3', 'Meyer')] });
  await A.sync.enable('river-stone');
  await B.sync.enable('river-stone');
  await both();
  assert.deepEqual(texts(A.vault), ['For Mum’s recovery', 'For Sam, starting work']);
  assert.deepEqual(texts(B.vault), texts(A.vault));
  assert.deepEqual(marks(A.vault), ['devotional:3', 'greek:12']);
  assert.deepEqual(marks(B.vault), marks(A.vault));
  assert.ok(B.events.some(([ev, r]) => ev === 'sync:changed' && r.study), 'the page hears that they changed');

  // Added on both at once, while apart: both kept.
  await wait(5);
  A.vault.setStudy({ prayers: [prayer('p3', 'For the team at work'), ...A.vault.getStudy().prayers] });
  await wait(5);
  B.vault.setStudy({ prayers: [prayer('p4', 'For rain'), ...B.vault.getStudy().prayers] });
  await both();
  assert.deepEqual(texts(A.vault), ['For Mum’s recovery', 'For Sam, starting work', 'For rain', 'For the team at work']);
  assert.deepEqual(texts(B.vault), texts(A.vault));

  // Answered on the phone: shows as answered on the computer.
  await wait(5);
  B.vault.setStudy({ prayers: B.vault.getStudy().prayers.map(p => (p.id === 'p2' ? { ...p, done: '2026-11-20' } : p)) });
  await both();
  assert.equal(A.vault.getStudy().prayers.find(p => p.id === 'p2').done, '2026-11-20');

  // Removed on one device: stays removed, even though the other still had its older copy.
  await wait(5);
  A.vault.setStudy({ prayers: A.vault.getStudy().prayers.filter(p => p.id !== 'p1'), bookmarks: A.vault.getStudy().bookmarks.filter(b => b.id !== 'greek:12') });
  await both();
  assert.ok(!texts(B.vault).includes('For Sam, starting work'), 'a removed prayer is removed everywhere');
  assert.deepEqual(marks(B.vault), ['devotional:3'], 'a removed bookmark is removed everywhere');
  assert.ok(!texts(A.vault).includes('For Sam, starting work'), 'and not brought back');

  // Removed on one, edited later on the other: the later change wins.
  await wait(5);
  B.vault.setStudy({ prayers: B.vault.getStudy().prayers.filter(p => p.id !== 'p3') });
  await wait(5);
  A.vault.setStudy({ prayers: A.vault.getStudy().prayers.map(p => (p.id === 'p3' ? { ...p, note: 'Especially Jo' } : p)) });
  await both();
  assert.equal((A.vault.getStudy().prayers.find(p => p.id === 'p3') || {}).note, 'Especially Jo');
  assert.equal((B.vault.getStudy().prayers.find(p => p.id === 'p3') || {}).note, 'Especially Jo');

  // Study history stays on each device.
  A.vault.setStudy({ history: [{ id: 'study-aaaa-1111', at: '2026-11-19T00:00:00Z', ref: [39, 11, 28, 11, 30], label: 'Matthew 11:28–30', mode: 'devotional', length: 'short', title: 'T', md: '# T' }] });
  await both();
  assert.equal(B.vault.getStudy().history.length, 0);
  assert.equal(A.vault.getStudy().history.length, 1);

  // Nothing readable on Drive.
  for (const f of drive.shared.files.values()) assert.ok(!f.data.toString('latin1').includes('For rain'), 'encrypted on Drive');
  // Quiet when nothing changed: a sync with no changes sends nothing.
  const before = [...drive.shared.files.values()].reduce((n, f) => n + f.version, 0);
  await both();
  assert.equal([...drive.shared.files.values()].reduce((n, f) => n + f.version, 0), before, 'nothing re-sent');

  for (const d of [A, B]) { d.sync.stop && d.sync.stop(); fs.rmSync(d.dir, { recursive: true, force: true }); }
  console.log('study sync tests passed');
})().catch(e => { console.error(e); process.exit(1); });
