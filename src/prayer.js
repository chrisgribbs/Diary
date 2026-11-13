'use strict';
// The prayer bell: a gentle invitation to pray at set hours of the day, like the old hours of prayer.
// This file decides when the bell rings and what it says. Each platform does the ringing itself:
// Windows in main.js (while WellWrite runs, in the tray if need be), Android with its alarm clock.
//
// Scripture is from the World English Bible (public domain). The prayers are classic prayers of the Daily Office
// from the Book of Common Prayer (1662, and the public-domain 1979 American book), put into contemporary English.
const bible = require('./bible');

const HOURS = [
  { key: 'morning', name: 'Morning', time: '07:00', on: true,
    verses: ['Psalms 5:3', 'Psalms 143:8', 'Lamentations 3:22-23', 'Psalms 118:24', 'Psalms 90:14', 'Psalms 57:8'],
    prayers: [
      ['Lord, our heavenly Father, almighty and everlasting God, you have brought us safely to the beginning of this day. Defend us by your mighty power, and grant that today we fall into no sin and run into no danger, but that all we do may be ordered by your guidance, to do always what is right in your sight; through Jesus Christ our Lord. Amen.', 'The Collect for Grace, Book of Common Prayer'],
      ['God, the author of peace and lover of concord, to know you is eternal life and to serve you is perfect freedom: defend us, your servants, in every trouble, so that trusting in your protection we may not fear any power against us; through Jesus Christ our Lord. Amen.', 'The Collect for Peace, Book of Common Prayer'],
      ['Lord God, you have brought us in safety to this new day: keep us today by your mighty power, and grant that we may not fall into sin or be overcome by adversity; and in all we do, direct us to the fulfilling of your purpose; through Jesus Christ our Lord. Amen.', 'A Collect for Grace, Book of Common Prayer (1979)'],
    ] },
  { key: 'midday', name: 'Midday', time: '12:00', on: true,
    verses: ['Psalms 46:10', 'Psalms 55:17', 'Matthew 11:28', 'Psalms 62:1', 'Psalms 62:5', 'John 14:27'],
    prayers: [
      ['Blessed Saviour, at this hour you hung upon the cross, stretching out your loving arms: grant that all the peoples of the earth may look to you and be saved; for your tender mercies’ sake. Amen.', 'Noonday Prayer, Book of Common Prayer (1979)'],
      ['Heavenly Father, send your Holy Spirit into our hearts, to direct and rule us according to your will, to comfort us in all our troubles, to defend us from all error, and to lead us into all truth; through Jesus Christ our Lord. Amen.', 'Noonday Prayer, Book of Common Prayer (1979)'],
      ['Almighty Saviour, at noonday you called your servant Paul to be an apostle: shine on the world with the radiance of your glory, that all nations may come and worship you; for you live and reign for ever and ever. Amen.', 'Noonday Prayer, Book of Common Prayer (1979)'],
    ] },
  { key: 'afternoon', name: 'Afternoon', time: '15:00', on: false,
    verses: ['Colossians 3:23', 'Psalms 90:17', 'Philippians 4:6', 'Psalms 121:1-2', 'Matthew 6:33', 'Isaiah 40:31'],
    prayers: [
      ['Go before us, Lord, in all we do with your gracious favour, and help us with your continual help, so that in all our works, begun, continued and ended in you, we may glorify your holy name, and finally by your mercy receive everlasting life; through Jesus Christ our Lord. Amen.', 'A Collect, Book of Common Prayer'],
      ['Almighty God, the giver of all good gifts: bless the work of our hands today. Help us to do it faithfully and well, for the good of others and to your glory; through Jesus Christ our Lord. Amen.', 'Written for WellWrite'],
      ['Christ with me, Christ before me, Christ behind me, Christ in me, Christ beneath me, Christ above me, Christ on my right, Christ on my left, Christ where I lie, Christ where I sit, Christ where I arise.', 'St Patrick’s Breastplate'],
    ] },
  { key: 'evening', name: 'Evening', time: '18:00', on: true,
    verses: ['Psalms 141:2', 'Psalms 113:3', 'Psalms 139:12', 'Psalms 92:1-2', 'Psalms 23:1-2', 'Matthew 11:29'],
    prayers: [
      ['Lighten our darkness, Lord, we pray; and in your great mercy defend us from all perils and dangers of this night; for the love of your only Son, our Saviour Jesus Christ. Amen.', 'The Collect for Aid against Perils, Book of Common Prayer'],
      ['God, from whom all holy desires, all good counsels and all just works come: give to your servants that peace which the world cannot give, that our hearts may be set to obey you, and that, freed from the fear of our enemies, we may pass our time in rest and quietness; through Jesus Christ our Lord. Amen.', 'The Collect for Peace at Evening Prayer, Book of Common Prayer'],
      ['Stay with us, Lord, for it is evening, and the day is almost over. Be our companion on the way, kindle our hearts, and awaken hope, that we may know you as you are revealed in Scripture and the breaking of bread. Amen.', 'Written for WellWrite, after Luke 24:29'],
    ] },
  { key: 'night', name: 'Night', time: '21:00', on: false,
    verses: ['Psalms 31:5', 'Psalms 4:8', 'Psalms 91:1', 'Psalms 63:6', 'Psalms 121:4', 'Psalms 16:7'],
    prayers: [
      ['Keep watch, dear Lord, with those who work, or watch, or weep this night, and give your angels charge over those who sleep. Tend the sick, Lord Christ; give rest to the weary, bless the dying, soothe the suffering, pity the afflicted, shield the joyous; and all for your love’s sake. Amen.', 'Compline, Book of Common Prayer (1979)'],
      ['Visit this place, Lord, and drive far from it all snares of the enemy; let your holy angels dwell with us to keep us in peace; and let your blessing be upon us always; through Jesus Christ our Lord. Amen.', 'Compline, Book of Common Prayer (1979)'],
      ['Guide us waking, Lord, and guard us sleeping; that awake we may watch with Christ, and asleep we may rest in peace.', 'Compline, Book of Common Prayer (1979)'],
    ] },
];
const KEYS = HOURS.map(h => h.key);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The bell's settings, tidied: { on, hours: [{ key, name, time, on }], days: 'every'|'weekdays', sound: 'bell'|'silent', mutedOn } */
function config(s = {}) {
  const times = s.prayerTimes && typeof s.prayerTimes === 'object' ? s.prayerTimes : {};
  const ons = s.prayerHoursOn && typeof s.prayerHoursOn === 'object' ? s.prayerHoursOn : {};
  return {
    on: !!s.prayerBell,
    hours: HOURS.map(h => ({ key: h.key, name: h.name,
      time: TIME_RE.test(times[h.key] || '') ? times[h.key] : h.time,
      on: typeof ons[h.key] === 'boolean' ? ons[h.key] : h.on })),
    days: s.prayerDays === 'weekdays' ? 'weekdays' : 'every',
    sound: s.prayerSound === 'silent' ? 'silent' : 'bell',
    mutedOn: /^\d{4}-\d{2}-\d{2}$/.test(s.prayerMutedOn || '') ? s.prayerMutedOn : '',
  };
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNumber = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);

/** A short line for the notification: the verse if it's short, else its first line or two. */
function shortLine(text) {
  const t = String(text || '').trim();
  if (t.length <= 130) return t.replace(/\n/g, ' ');
  // Whole lines or sentences, as many as fit.
  const parts = t.split('\n').flatMap(l => l.match(/[^.!?;]+[.!?;]+[”’"]?\s*|[^.!?;]+$/g) || [l]).map(x => x.trim()).filter(Boolean);
  let out = '';
  for (const x of parts) { if (out && (out + " " + x).length > 130) break; out = out ? out + ' ' + x : x; }
  if (out.length > 120) out = out.slice(0, 117).replace(/\s+\S*$/, '') + '…';
  out = out.replace(/[,;:]$/, '…');
  // A quotation cut short: close it.
  if ((out.match(/“/g) || []).length > (out.match(/”/g) || []).length) out = out.replace(/[.…]?$/, m => (m || '.') + '”');
  return out;
}

/** What a bell says: on a given day, each hour has its verse, in turn. */
function bellText(key, date) {
  const h = HOURS.find(x => x.key === key) || HOURS[0];
  const ref = h.verses[dayNumber(date) % h.verses.length];
  const v = bible.verseText(ref, 'web');
  const line = v ? shortLine(v.text).replace(/^([“"]?)([a-z])/, (m, q, c) => q + c.toUpperCase()) : '';
  return { title: `${h.name} prayer`, body: v ? `${line} — ${v.ref}` : 'A moment to pause and pray.', ref };
}

/**
 * The bells to come, in order: [{ at (ms), key, date, title, body }]. Today's are left out if muted for today;
 * weekends are left out for "weekdays only". `days` days ahead, from `now`.
 */
function upcoming(settings, now = new Date(), days = 30) {
  const c = config(settings);
  if (!c.on) return [];
  const out = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const day = iso(d);
    if (day === c.mutedOn) continue;
    if (c.days === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) continue;
    for (const h of c.hours) {
      if (!h.on) continue;
      const [hh, mm] = h.time.split(':').map(Number);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
      if (at <= now) continue;
      out.push({ at: at.getTime(), key: h.key, date: day, ...bellText(h.key, d) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The hour a time belongs to (for "Pause for prayer" opened by hand): the most recent bell time today. */
function hourAt(settings, now = new Date()) {
  const c = config(settings);
  const mins = now.getHours() * 60 + now.getMinutes();
  let best = c.hours[0];
  for (const h of [...c.hours].sort((a, b) => a.time.localeCompare(b.time))) {
    const [hh, mm] = h.time.split(':').map(Number);
    if (hh * 60 + mm <= mins + 30) best = h;
  }
  return best.key;
}

/**
 * The "Pause for prayer" page: { key, name, verse: { ref, text }, prayer: { text, source } }.
 * `own`: your own prayers (from your quotes), which take their turn with the classic ones.
 */
function pause(key, date = new Date(), own = []) {
  const h = HOURS.find(x => x.key === key) || HOURS[0];
  const n = dayNumber(date);
  const v = bible.verseText(h.verses[n % h.verses.length], 'web');
  const pool = [...h.prayers.map(([text, source]) => ({ text, source })),
    ...own.filter(p => p && p.text).map(p => ({ text: p.text, source: [p.author, p.title || p.source].filter(Boolean).join(', ') }))];
  const prayer = pool[(n + HOURS.indexOf(h)) % pool.length];
  return { key: h.key, name: h.name, verse: v ? { ref: v.ref, text: v.text } : null, prayer };
}

module.exports = { HOURS, KEYS, config, upcoming, bellText, pause, hourAt, shortLine, iso };
