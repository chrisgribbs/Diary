'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault } = require('../src/vault');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daybook-'));
const dirA = path.join(tmp, 'a'), dirB = path.join(tmp, 'b');
const t0 = Date.now();

const v = new Vault(dirA);
assert.equal(v.exists(), false);
assert.throws(() => v.create('123'), /6 characters/);
v.create('correct horse');
const m1 = v.save({ date: '2026-10-28', time: '09:15', title: 'First light', tags: ['Morning', 'morning', 'walk'], html: '<p>The river was <b>silver</b> today.</p><img src="data:image/png;base64,AAAA">', text: 'The river was silver today.' });
assert.deepEqual(m1.tags, ['morning', 'walk']);
assert.equal(m1.images, 1);
assert.equal(m1.words, 5);
v.save({ date: '2025-10-28', title: 'A year ago', html: '<p>secret words</p>', text: 'secret words' });

// Nothing readable on disk
for (const f of fs.readdirSync(path.join(dirA, 'entries'))) {
  const raw = fs.readFileSync(path.join(dirA, 'entries', f));
  assert(!raw.includes('silver') && !raw.includes('secret'), 'plaintext leaked');
}
assert(!fs.readFileSync(path.join(dirA, 'index.enc')).includes('silver'));

// Lock / unlock
v.lock();
assert.throws(() => v.list(), /locked/);
assert.equal(v.unlock('wrong password'), false);
assert.equal(v.unlock('correct horse'), true);
assert.equal(v.list().length, 2);
assert.equal(v.get(m1.id).title, 'First light');

// Index rebuild when index is lost
fs.unlinkSync(path.join(dirA, 'index.enc'));
v.lock(); assert(v.unlock('correct horse')); assert.equal(v.list().length, 2);

// Password change
v.changePassword('correct horse', 'battery staple');
assert.throws(() => v.changePassword('nope', 'whatever123'), /incorrect/);
v.lock();
assert.equal(v.unlock('correct horse'), false);
assert.equal(v.unlock('battery staple'), true);

// Backup -> fresh restore elsewhere
const bak = path.join(tmp, 'x.daybook');
assert.equal(v.exportBackup(bak), 2);
assert(!fs.readFileSync(bak).includes('silver'));
const w = new Vault(dirB);
assert.throws(() => w.restoreFresh(bak, 'bad'), /does not open/);
assert.equal(w.restoreFresh(bak, 'battery staple'), 2);
w.lock(); assert(w.unlock('battery staple'));

// Merge import: newer edit wins, new entry added
w.save({ ...w.get(m1.id), title: 'Edited later' });
w.save({ date: '2026-01-01', title: 'Only in B', html: '', text: '' });
const bak2 = path.join(tmp, 'y.daybook');
w.exportBackup(bak2);
const r = v.importBackup(bak2, 'battery staple');
assert.deepEqual(r, { added: 1, updated: 1 });
assert.equal(v.get(m1.id).title, 'Edited later');
assert.equal(v.list().length, 3);

// Readable export
const out = path.join(tmp, 'j.html');
assert.equal(v.exportReadable(out), 3);
assert(fs.readFileSync(out, 'utf8').includes('silver'));

// Delete
v.remove(m1.id); assert.equal(v.list().length, 2);
assert.throws(() => v.get('../../etc'), /Bad entry id/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`vault tests passed in ${Date.now() - t0} ms`);
