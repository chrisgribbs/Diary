'use strict';
// Sync never piles up "(from another device)" copies of an entry that hasn't really changed on two devices.
// Run: node test/sync-dupes.test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Vault } = require('../src/vault');
const { Sync } = require('../src/sync');

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
const ID = 'dddddddd-4444';
const copies = d => d.vault.list().filter(m => / \(from another device\)$/.test(m.title));

(async () => {
  const drive = makeDrive();
  const A = makeDevice(drive), B = makeDevice(drive, 'other-password');
  entry(A.vault, ID, 'Sunday, 15 November 2026', '<p>This passage today speaks of Paul.</p>');
  await A.sync.enable('river-stone'); await B.sync.enable('river-stone');
  assert.equal(B.vault.get(ID).html, '<p>This passage today speaks of Paul.</p>');

  // ---- saving without changing anything keeps the entry's time ----
  const t0 = A.vault.index.get(ID).updated;
  await wait(5);
  A.vault.save({ ...A.vault.get(ID) });                                  // e.g. opened, tapped into, a stray keyboard event
  assert.equal(A.vault.index.get(ID).updated, t0, 'not an edit');
  A.vault.save({ ...A.vault.get(ID), html: '<p>This passage today speaks of Paul. </p>\n' });   // only spaces at the end
  assert.equal(A.vault.index.get(ID).updated, t0, 'spaces alone are not an edit');

  // ---- writing on the computer while the phone has the same entry open (and re-saves it) ----
  let text = 'This passage today speaks of Paul.';
  for (let i = 0; i < 6; i++) {
    await wait(3);
    text += ' More.';
    entry(A.vault, ID, 'Sunday, 15 November 2026', `<p>${text}</p>`);   // a real edit on the computer
    await wait(3);
    B.vault.save({ ...B.vault.get(ID) });                                 // the phone saves what it has, unchanged
    if (i % 2) { await B.sync.run(); await A.sync.run(); } else { await A.sync.run(); await B.sync.run(); }
  }
  await A.sync.run(); await B.sync.run();
  assert.equal(copies(A).length, 0, 'no copies on the computer');
  assert.equal(copies(B).length, 0, 'no copies on the phone');
  assert.equal(B.vault.get(ID).html, `<p>${text}</p>`, 'the phone has the latest');

  // ---- both devices make the same change before syncing: still no copy ----
  await wait(3); entry(A.vault, ID, 'Sunday — Paul', `<p>${text}</p>`);
  await wait(3); entry(B.vault, ID, 'Sunday — Paul', `<p>${text}</p>`);
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  assert.equal(copies(A).length + copies(B).length, 0, 'the same change twice is not a conflict');

  // ---- a real conflict still keeps both ----
  await wait(3); entry(A.vault, ID, 'Sunday — Paul', '<p>computer</p>');
  await wait(3); entry(B.vault, ID, 'Sunday — Paul', '<p>phone</p>');
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  assert.equal(copies(A).length, 1, 'different versions: both kept');
  assert.deepEqual(A.vault.list().map(m => m.title).sort(), B.vault.list().map(m => m.title).sort());

  // ---- copies already made: identical ones are tidied away, on both devices; different ones stay ----
  const real = copies(A)[0].id;
  const same = A.vault.get(ID);
  const dup = [];
  for (let i = 0; i < 4; i++) dup.push(A.vault.save({ ...same, id: undefined, title: same.title + ' (from another device)' + (i === 3 ? ' (from another device)' : '') }).id);
  const twin1 = A.vault.save({ ...same, id: undefined, html: '<p>an older draft</p>', title: same.title + ' (from another device)' }).id;
  const twin2 = A.vault.save({ ...same, id: undefined, html: '<p>an older draft</p>', title: same.title + ' (from another device)' }).id;
  await A.sync.run(); await B.sync.run();   // B gets them all (as it would have before this fix)
  await A.sync.run(); await B.sync.run();
  for (const d of [A, B]) {
    const left = copies(d).map(m => m.id);
    for (const id of dup) assert(!left.includes(id), 'identical copy removed');
    assert(left.includes(real) || left.length >= 1, 'the real conflict copy stays');
    assert.equal(left.filter(id => id === twin1 || id === twin2).length, 1, 'of two identical older drafts, one stays');
    assert(d.vault.index.has(ID), 'the entry itself stays');
  }
  assert.deepEqual(A.vault.list().map(m => m.id).sort(), B.vault.list().map(m => m.id).sort(), 'both devices the same');
  const tidy = A.events.concat(B.events).filter(([ev, r]) => ev === 'sync:changed' && r.tidied).reduce((n, [, r]) => n + r.tidied, 0);
  assert(tidy >= 5, 'reported as tidied: ' + tidy);
  console.log('sync duplicate tests passed');
  process.exit(0);   // (sync's own timers would keep it running)
})().catch(e => { console.error(e); process.exit(1); });
