'use strict';
const assert = require('assert');
const bible = require('../src/bible');

// every plan covers its chapters exactly once, in order
const total = { year: 1189, 'ot-nt': 1189, nt90: 260, gospels30: 89, psalms60: 181 };
for (const p of bible.planList()) {
  const seen = [];
  for (let d = 0; d < p.days; d++) {
    const ch = bible.planDay(p.id, d);
    assert(ch.length > 0, `${p.id} day ${d + 1} has a reading`);
    seen.push(...ch.map(([b, c]) => b + ':' + c));
  }
  assert.equal(seen.length, total[p.id], `${p.id} covers every chapter`);
  assert.equal(new Set(seen).size, seen.length, `${p.id} has no repeats`);
}
assert.equal(bible.label(bible.planDay('year', 0)), 'Genesis 1–3');
assert.equal(bible.label(bible.planDay('year', 364)), 'Revelation 19–22');
assert.equal(bible.label(bible.planDay('ot-nt', 0)), 'Genesis 1–2, Matthew 1');
for (let d = 0; d < 365; d++) {
  const ch = bible.planDay('ot-nt', d);
  assert(ch.some(([b]) => b < 39 && b !== 18) && ch.some(([b]) => b >= 39 || b === 18), `ot-nt day ${d + 1} has both parts`);
}

// readings carry text
const r = bible.reading('gospels30', 0, 'web');
assert.equal(r.chapters[0].book, 'Matthew');
assert(r.chapters[0].blocks.length > 3);

// every verse of the day exists in both translations
for (const ref of bible.VERSES) for (const t of ['web', 'kjv']) assert(bible.verseText(ref, t), `${ref} (${t})`);
assert.equal(bible.verseText('John 11:35', 'kjv').text, 'Jesus wept.');
assert.equal(bible.verseText('Psalms 23:1', 'web').text, 'Yahweh is my shepherd:\nI shall lack nothing.');
assert.equal(bible.verseText('Psalms 23:1', 'web').ref, 'Psalm 23:1');
assert.equal(bible.verseText('Nope 1:1', 'web'), null);
assert(bible.verseOfDay(20000, 'kjv').text);
console.log(`bible tests passed (${bible.VERSES.length} daily verses)`);
