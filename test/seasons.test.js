'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
global.window = {};
require('../renderer/seasons.js');
const W = window.WellWriteSeasons;

// Easter (Gregorian computus) against known dates
const easters = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2028: '2028-04-16', 2038: '2038-04-25', 2285: '2285-03-22' };
for (const [y, d] of Object.entries(easters)) assert.equal(W.easter(+y), d, 'Easter ' + y);
// Advent Sunday: the fourth Sunday before Christmas
assert.equal(W.adventSunday(2026), '2026-11-29');
assert.equal(W.adventSunday(2027), '2027-11-28');
assert.equal(W.adventSunday(2022), '2022-11-27');

const day = iso => { const d = new Date(iso + 'T12:00:00Z'); return d; };
const next = iso => { const d = day(iso); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

for (const mode of ['christian', 'spiritual']) {
  for (let y = 2024; y <= 2040; y++) {
    const list = W.seasonsFor(y, mode);
    assert.equal(list[0].start, `${y}-01-01`, mode + y);
    assert.equal(list.at(-1).end, `${y}-12-31`, mode + y);
    for (let i = 1; i < list.length; i++) assert.equal(list[i].start, next(list[i - 1].end), `${mode} ${y} gap before ${list[i].id}`);
    for (const s of list) {
      assert.ok(s.start <= s.end, s.id);
      assert.ok(s.prompts.length >= 7 && s.themes.length >= 3, s.id);
    }
    // every day of the year has a season with a sensible day number
    for (let d = `${y}-01-01`; d <= `${y}-12-31`; d = next(d)) {
      const s = W.seasonOn(d, mode);
      assert.ok(s && s.dayIndex >= 0 && s.dayIndex < s.length, `${mode} ${d}`);
    }
  }
}

// The Christian year
const on = d => W.seasonOn(d, 'christian');
assert.equal(on('2026-12-25').id, 'christmas');
assert.equal(on('2026-12-25').dayIndex, 0);
assert.equal(on('2027-01-05').id, 'christmas');
assert.equal(on('2027-01-05').dayIndex, 11);      // the twelfth day of Christmas
assert.equal(on('2027-01-05').length, 12);
assert.equal(on('2027-01-06').id, 'epiphany');
assert.equal(on('2026-02-18').id, 'lent');         // Ash Wednesday 2026
assert.equal(on('2026-02-17').id, 'love');
assert.equal(on('2026-03-29').id, 'holyweek');     // Palm Sunday
assert.equal(on('2026-04-04').id, 'holyweek');     // Holy Saturday
assert.equal(on('2026-04-05').id, 'easter');
assert.equal(on('2026-04-05').dayIndex, 0);
assert.equal(on('2026-05-23').id, 'easter');
assert.equal(on('2026-05-24').id, 'pentecost');    // Pentecost Sunday
assert.equal(on('2026-11-29').id, 'advent');
assert.equal(on('2026-12-24').id, 'advent');
assert.equal(on('2026-11-01').id, 'saints');
// an early Easter still leaves a Pentecost season of at least two weeks
assert.ok(W.seasonsFor(2038, 'christian').find(s => s.id === 'pentecost'));
for (let y = 2024; y <= 2300; y++) {
  const p = W.seasonsFor(y, 'christian').find(s => s.id === 'pentecost');
  assert.ok(p && (day(p.end) - day(p.start)) / 864e5 >= 13, 'pentecost ' + y);
}

// Monthly themes
assert.equal(W.seasonOn('2026-01-14', 'spiritual').id, 'newbeginnings');
assert.equal(W.seasonOn('2026-11-30', 'spiritual').id, 'saints');
assert.equal(W.seasonOn('2026-12-31', 'spiritual').id, 'waiting');
assert.equal(W.seasonOn('2026-03-01', 'spiritual').dayIndex, 0);

// Every theme a season asks for is one the quotes use
const known = ['Love & belonging', 'Darkness & suffering', 'Faith & doubt', 'Wonder & beauty', 'True self', 'Hope & renewal', 'Vocation & calling', 'Soul', 'Paradox', 'Slowness & presence', 'Community & place', 'Courage & vulnerability', 'Earth & creation', 'Humility', 'Blessing', 'The path', 'Wholeness', 'Gratitude', 'Creativity & art', 'Teaching', 'Simplicity', 'Prayer', 'Joy'];
for (const s of Object.values(W.SEASONS)) for (const t of s.themes) assert.ok(known.includes(t), `${s.id}: ${t}`);

// Starter quotes carry themes, and older journals get them once
const { STARTER_QUOTES } = require('../src/quotes');
for (const q of STARTER_QUOTES) { assert.ok(q.themes.length, q.text); for (const t of q.themes) assert.ok(known.includes(t), t); }
const { Vault } = require('../src/vault');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-seasons-'));
const v = new Vault(path.join(tmp, 'j')); v.create('river-stone');
// pretend this journal was seeded by an older version (no themes)
v._writeMeta({ quotes: Vault.cleanQuotes(STARTER_QUOTES.map(({ themes, ...q }) => q).concat({ text: 'Mine', author: 'Me' })), quotesSeeded: true, startersThemed: false });
let qs = v.getQuotes();
assert.deepEqual(qs.find(q => q.text.startsWith('All shall be well')).themes, ['Hope & renewal', 'Faith & doubt', 'Darkness & suffering']);
assert.deepEqual(qs.find(q => q.text === 'Mine').themes, []);
// a theme the person changed later is left alone
v.setQuotes(qs.map(q => q.text.startsWith('All shall') ? { ...q, themes: ['Prayer'] } : q));
assert.deepEqual(v.getQuotes().find(q => q.text.startsWith('All shall')).themes, ['Prayer']);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('seasons tests passed');
