'use strict';
// The prayer bell: when it rings, what it says, and muting.
const assert = require('assert');
const p = require('../src/prayer');

const sat = new Date(2026, 10, 14, 6, 0);   // a Saturday, 6 am
// Off unless turned on.
assert.deepEqual(p.upcoming({}, sat), []);
// Default: morning, midday, evening.
let u = p.upcoming({ prayerBell: true }, sat, 0);
assert.deepEqual(u.map(b => b.key), ['morning', 'midday', 'evening']);
assert.deepEqual(u.map(b => new Date(b.at).getHours()), [7, 12, 18]);
for (const b of u) assert.ok(b.title.endsWith('prayer') && b.body.length > 20 && b.body.length < 160, b.body);
// Hours you choose, at your times; past ones today are skipped.
u = p.upcoming({ prayerBell: true, prayerHoursOn: { morning: false, night: true }, prayerTimes: { night: '21:30' } }, new Date(2026, 10, 14, 13, 0), 0);
assert.deepEqual(u.map(b => b.key + ' ' + new Date(b.at).toTimeString().slice(0, 5)), ['evening 18:00', 'night 21:30']);
// Muted today: nothing more today, tomorrow as usual.
u = p.upcoming({ prayerBell: true, prayerMutedOn: '2026-11-14' }, sat, 1);
assert.ok(u.length === 3 && u.every(b => b.date === '2026-11-15'));
// Weekdays only: the weekend is quiet.
u = p.upcoming({ prayerBell: true, prayerDays: 'weekdays' }, sat, 2);
assert.ok(u.every(b => b.date === '2026-11-16'));
// Bad values fall back safely.
assert.equal(p.config({ prayerTimes: { midday: '25:99' } }).hours.find(h => h.key === 'midday').time, '12:00');
// The verse changes day by day; every hour has a verse and a prayer.
const days = new Set(); for (let d = 0; d < 6; d++) days.add(p.bellText('midday', new Date(2026, 10, 14 + d)).ref);
assert.equal(days.size, 6);
for (const k of p.KEYS) {
  const x = p.pause(k, sat);
  assert.ok(x.verse && x.verse.text && x.prayer.text && x.prayer.source, k);
}
// Your own prayers take their turn.
const seen = new Set();
for (let d = 0; d < 8; d++) seen.add(p.pause('night', new Date(2026, 10, 14 + d), [{ text: 'Mine', author: 'Chris Gribble' }]).prayer.text);
assert.ok(seen.has('Mine'));
// Short lines for notifications end tidily.
assert.equal(p.shortLine('One line.'), 'One line.');
assert.ok(!/[,;:]$/.test(p.shortLine('a, '.repeat(80))));
console.log('prayer tests passed');
