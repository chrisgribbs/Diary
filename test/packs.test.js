'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Vault } = require('../src/vault');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-packs-'));
const v = new Vault(path.join(tmp, 'j')); v.create('river-stone');
const starters = v.getQuotes().length;
const A = { text: 'A pause opens space.', author: 'Chris Gribble', source: 'Finding Hope', title: 'Psalm 46', kind: 'psalm', themes: ['Slowness & presence'] };
const B = { text: 'Broken open by disappointment.', author: 'Chris Gribble', kind: 'psalm', themes: ['Hope & renewal'] };
const C = { text: 'Beauty is the harvest of presence.', author: 'David Whyte', themes: ['Wonder & beauty'] };
const pk = id => v.getQuotes().filter(q => q.pack === id);

// a hand-imported copy of C (with a star), and an old full-length version that is now retired
v.setQuotes([...v.getQuotes(), { ...C, fav: true }, { text: 'An old long psalm.', author: 'Chris Gribble', mine: true }]);
const retiredKey = Vault.readingKey('An old long psalm.', 'Chris Gribble');

let r = v.syncPack('wellwrite', [A, B], [retiredKey]);
assert.deepEqual([r.added, r.updated, r.removed], [2, 0, 1]);
assert.equal(pk('wellwrite').length, 2);
assert.ok(!v.getQuotes().some(q => q.text === 'An old long psalm.'), 'retired copy removed');
assert.equal(pk('wellwrite')[0].kind, 'psalm');

// same pack again: nothing changes
r = v.syncPack('wellwrite', [A, B], [retiredKey]);
assert.deepEqual([r.added, r.updated, r.removed], [0, 0, 0]);

// the file pack adopts the hand-imported copy and keeps its star; no duplicate
r = v.syncPack('file', [C]);
assert.equal(v.getQuotes().filter(q => q.text === C.text).length, 1);
assert.equal(pk('file')[0].fav, true, 'star kept');

// pack changes a piece's themes: updated
r = v.syncPack('wellwrite', [{ ...A, themes: ['Prayer'] }, B]);
assert.equal(r.updated, 1);
assert.deepEqual(pk('wellwrite').find(q => q.title === 'Psalm 46').themes, ['Prayer']);

// you edit A and delete B; the next sync keeps your edit and doesn't bring B back
v.setQuotes(v.getQuotes().map(q => q.title === 'Psalm 46' ? { ...q, themes: ['Joy'] } : q).filter(q => q.text !== B.text));
r = v.syncPack('wellwrite', [{ ...A, themes: ['Soul'] }, B]);
assert.deepEqual(pk('wellwrite').map(q => q.themes), [['Joy']], 'your edit wins, your deletion sticks');
assert.equal(r.added, 0);

// a piece dropped from the pack goes, unless you edited it
const D = { text: 'A new line.', author: 'Chris Gribble' };
v.syncPack('wellwrite', [A, B, D]);
assert.equal(pk('wellwrite').length, 2);  // A (edited) + D (B stays deleted)
r = v.syncPack('wellwrite', [B]);
assert.equal(r.removed, 1, 'D removed');
assert.ok(pk('wellwrite').some(q => q.text === A.text), 'edited A kept even though dropped');

// favourites survive updates
v.setQuotes(v.getQuotes().map(q => q.text === C.text ? { ...q, fav: true } : q));
v.syncPack('file', [{ ...C, source: 'Consolations' }]);
assert.equal(pk('file')[0].source, 'Consolations');
assert.equal(pk('file')[0].fav, true);

// switching a pack off removes its unedited pieces; your own quotes are never touched
v.setQuotes([...v.getQuotes(), { text: 'Typed in by me.', author: 'Me' }]);
v.syncPack('file', []);
assert.equal(pk('file').length, 0);
assert.ok(v.getQuotes().some(q => q.text === 'Typed in by me.'));
assert.equal(v.getQuotes().filter(q => !q.pack).length, starters + 1);

// the built-in pack in the app is well formed
const built = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/readings/wellwrite.json'), 'utf8'));
assert.ok(built.items.length > 100);
for (const it of built.items) assert.ok(it.text && it.author && it.kind && it.themes.length, it.title);
const v2 = new Vault(path.join(tmp, 'k')); v2.create('river-stone');
r = v2.syncPack('wellwrite', built.items, built.retired);
assert.equal(r.added, built.items.length);
assert.equal(v2.getQuotes().filter(q => q.pack === 'wellwrite').length, built.items.length, 'every built-in piece kept (no clean-up losses)');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('reading pack tests passed');

// the classics collection is well formed, public-domain sources named, and every piece loads
{
  const fs2 = require('fs'), os2 = require('os'), path2 = require('path');
  const { Vault: V } = require('../src/vault');
  const cl = JSON.parse(fs2.readFileSync(path2.join(__dirname, '../src/readings/classics.json'), 'utf8'));
  assert.equal(cl.id, 'classics');
  assert.ok(cl.items.length >= 100);
  for (const it of cl.items) {
    assert.ok(it.text && it.author && it.source && it.themes.length, it.text.slice(0, 40));
    assert.ok(!/_\w|\[\d+\]/.test(it.text), 'no italics marks or footnote numbers: ' + it.text.slice(0, 40));
    assert.ok(!it.mine && !it.kind, 'classics are quotes, not your own writing');
  }
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'wellwrite-cl-'));
  const v3 = new V(path2.join(dir, 'j')); v3.create('river-stone');
  const r3 = v3.syncPack('classics', cl.items, cl.retired);
  assert.equal(v3.getQuotes().filter(q => q.pack === 'classics').length, cl.items.length - (cl.items.length - r3.added), 'all classics added');
  fs2.rmSync(dir, { recursive: true, force: true });
  console.log('classics pack tests passed:', cl.items.length);
}

// the daily prayers: 365, one for each day, each with its credit and licence, and the special days covered
{
  const fs2 = require('fs'), os2 = require('os'), path2 = require('path');
  const { Vault: V } = require('../src/vault');
  const pr = JSON.parse(fs2.readFileSync(path2.join(__dirname, '../src/readings/prayers.json'), 'utf8'));
  assert.equal(pr.id, 'prayers');
  assert.equal(pr.items.length, 365);
  assert.equal(new Set(pr.items.map(it => it.text)).size, 365, 'no prayer twice');
  for (const it of pr.items) {
    assert.ok(it.text && it.author && it.kind === 'prayer' && it.themes.includes('Prayer'), it.title);
    assert.ok(['public-domain', 'cc-by-nc-nd'].includes(it.licence), 'licence named: ' + it.title);
    assert.ok(/acollectionofprayers\.com/.test(it.credit) && it.credit.length <= 600, 'credit and link: ' + it.title);
    if (it.licence === 'cc-by-nc-nd') assert.ok(it.credit.includes('Prayer from www.acollectionofprayers.com. Used with permission.'), 'the credit its licence asks for: ' + it.title);
    assert.ok(!/all rights reserved/i.test(it.text + it.credit), 'nothing marked all rights reserved: ' + it.title);
    assert.ok(!/https?:/.test(it.source), 'source is a name, not a link: ' + it.title);
  }
  for (const day of ['christmaseve', 'christmasday', 'epiphanyday', 'ashwednesday', 'palmsunday', 'maundythursday', 'goodfriday', 'holysaturday', 'easterday', 'pentecostday'])
    assert.equal(pr.items.filter(it => it.occasion === day).length, 1, 'one prayer for ' + day);
  // they load, and keep their credit and licence
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'wellwrite-pr-'));
  const v4 = new V(path2.join(dir, 'j')); v4.create('river-stone');
  const r4 = v4.syncPack('prayers', pr.items, []);
  assert.equal(r4.added, 365);
  const got = v4.getQuotes().filter(q => q.pack === 'prayers');
  assert.equal(got.length, 365);
  assert.ok(got.every(q => q.credit && q.licence), 'credit and licence kept');
  // "I like this" is a favourite; "Not for me" deletes it, and it doesn't come back when the pack updates
  const [a, b] = got;
  v4.setQuotes(v4.getQuotes().map(q => (q.id === a.id ? { ...q, fav: true } : q)).filter(q => q.id !== b.id));
  v4.syncPack('prayers', pr.items, []);
  assert.ok(v4.getQuotes().find(q => q.id === a.id).fav, 'liked stays liked');
  assert.ok(!v4.getQuotes().some(q => q.id === b.id), 'not for me stays gone');
  // a prayer shared with you (imported from a pack) keeps its terms; unknown licences are dropped
  v4.setQuotes([...v4.getQuotes(), { text: 'A friend’s prayer.', author: 'Sam', kind: 'prayer', licence: 'own', credit: 'Shared by Sam through WellWrite.' },
    { text: 'Odd.', author: 'X', licence: 'mit' }]);
  const sam = v4.getQuotes().find(q => q.author === 'Sam');
  assert.equal(sam.licence, 'own'); assert.equal(sam.credit, 'Shared by Sam through WellWrite.');
  assert.equal(v4.getQuotes().find(q => q.author === 'X').licence, '');
  fs2.rmSync(dir, { recursive: true, force: true });
  console.log('daily prayers pack tests passed:', pr.items.length);
}
