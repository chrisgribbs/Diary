'use strict';
// The hour for each prayer (renderer/prayer-times.js).
const assert = require('assert');
const { partOfDay, prayerTime } = require('../renderer/prayer-times.js');
const at = h => new Date(2026, 10, 14, h, 30);

assert.equal(partOfDay(at(3)), 'evening');
assert.equal(partOfDay(at(4)), 'morning');
assert.equal(partOfDay(at(11)), 'morning');
assert.equal(partOfDay(at(12)), 'day');
assert.equal(partOfDay(at(17)), 'day');
assert.equal(partOfDay(at(18)), 'evening');
assert.equal(partOfDay(at(23)), 'evening');

const t = (title, text) => prayerTime({ title, text });
assert.equal(t('A Morning Prayer', 'Lord, be with us.'), 'morning');
assert.equal(t('Evensong', 'Lord, be with us.'), 'evening');
assert.equal(t('', 'O Lord, direct our steps this day into the way of peace.'), 'morning');
assert.equal(t('', 'We thank you that you have awakened us from sleep in health.'), 'morning');
assert.equal(t('', 'Keep us this night in your peace.'), 'evening');
assert.equal(t('', 'I lie down tonight with the Triune of my strength.'), 'evening');
assert.equal(t('', 'The day is past, O Lord, and we offer you our evening prayer.'), 'evening');
// Not the hour: everyday words that only sound like it.
assert.equal(t('', 'Give us this day our daily bread.'), '');
assert.equal(t('', 'Be a kindly shepherd behind me, today, tonight, and forever.'), '');
assert.equal(t('', 'In the evening and morning and noonday we praise you.'), '');
assert.equal(t('', 'Make the weary lie down in your pastures.'), '');
assert.equal(t('Awaken Us from the Grave of our Sins', 'Awaken us from the grave of our sins.'), '');
// An older version printed under a prayer doesn't count.
assert.equal(t('', 'Lord, have mercy.\n\nVersion in traditional English:\n\nKeep us this night.'), '');
// The built-in collection: enough for both ends of the day, most for any hour.
const items = require('../src/readings/prayers.json').items;
const n = k => items.filter(q => prayerTime(q) === k).length;
assert(n('morning') >= 15 && n('evening') >= 25 && n('') > 250, `morning ${n('morning')}, evening ${n('evening')}, any ${n('')}`);
console.log('prayer times tests passed');
