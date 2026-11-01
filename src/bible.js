'use strict';
/**
 * Bible reading plans and verse of the day, from the bundled public-domain texts.
 * A plan spreads a run of chapters evenly over its days.
 */
const fs = require('fs');
const path = require('path');
const { BOOKS, OT_BOOKS } = require('./bible-books');

const TRANSLATIONS = { web: 'World English Bible', kjv: 'King James Version' };
const cache = new Map();
function load(id) {
  if (!TRANSLATIONS[id]) id = 'web';
  if (!cache.has(id)) cache.set(id, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bible', id + '.json'), 'utf8')));
  return cache.get(id);
}

/** Every chapter as [bookIndex, chapterNumber]. */
function allChapters() {
  const t = load('web');
  const out = [];
  t.books.forEach((b, bi) => b.chapters.forEach((_, ci) => out.push([bi, ci + 1])));
  return out;
}
const inBooks = (from, to) => allChapters().filter(([b]) => b >= from && b <= to);
const GOSPELS = [39, 42]; // Matthew..John
const PSALMS = 18;

const PLANS = {
  year: { name: 'The whole Bible in a year', days: 365, tracks: () => [allChapters()] },
  // Each day: some Old Testament, plus New Testament (then Psalms once the NT is done), so no day is without both.
  'ot-nt': { name: 'Old and New Testament each day, in a year', days: 365,
    tracks: () => [allChapters().filter(([b]) => b < OT_BOOKS && b !== PSALMS), [...inBooks(OT_BOOKS, 65), ...inBooks(PSALMS, PSALMS)]] },
  nt90: { name: 'The New Testament in 90 days', days: 90, tracks: () => [inBooks(OT_BOOKS, 65)] },
  gospels30: { name: 'The four Gospels in 30 days', days: 30, tracks: () => [inBooks(GOSPELS[0], GOSPELS[1])] },
  psalms60: { name: 'Psalms and Proverbs in 60 days', days: 60, tracks: () => [inBooks(18, 19)] },
};

/** Chapters to read on day `day` (0-based) of a plan. */
function planDay(planId, day) {
  const plan = PLANS[planId] || PLANS.year;
  const d = Math.max(0, Math.min(plan.days - 1, day));
  const chapters = [];
  for (const track of plan.tracks()) {
    const n = track.length;
    chapters.push(...track.slice(Math.floor((d * n) / plan.days), Math.floor(((d + 1) * n) / plan.days)));
  }
  return chapters;
}

/** "Genesis 1–3, Matthew 1" */
function label(chapters) {
  const groups = [];
  for (const [b, c] of chapters) {
    const g = groups[groups.length - 1];
    if (g && g.b === b && g.to === c - 1) g.to = c; else groups.push({ b, from: c, to: c });
  }
  return groups.map(g => `${BOOKS[g.b].name} ${g.from}${g.to !== g.from ? '–' + g.to : ''}`).join(', ');
}

function reading(planId, day, translation) {
  const t = load(translation);
  const chapters = planDay(planId, day);
  return {
    plan: planId, day, days: (PLANS[planId] || PLANS.year).days, label: label(chapters), translation: t.short,
    chapters: chapters.map(([b, c]) => ({ book: BOOKS[b].name, chapter: c, blocks: t.books[b].chapters[c - 1] })),
  };
}

// ---- verse of the day
const VERSES = [
  'Psalms 23:1', 'Psalms 46:10', 'Psalms 27:1', 'Psalms 34:18', 'Psalms 37:4', 'Psalms 51:10', 'Psalms 55:22', 'Psalms 62:1', 'Psalms 90:12',
  'Psalms 91:1', 'Psalms 103:2', 'Psalms 118:24', 'Psalms 119:105', 'Psalms 121:1-2', 'Psalms 139:14', 'Psalms 143:8', 'Psalms 145:18', 'Psalms 147:3',
  'Psalms 16:11', 'Psalms 19:14', 'Psalms 30:5', 'Psalms 32:8', 'Psalms 42:11', 'Psalms 63:1', 'Psalms 84:11', 'Psalms 86:5',
  'Proverbs 3:5-6', 'Proverbs 4:23', 'Proverbs 16:3', 'Proverbs 16:9', 'Proverbs 17:22', 'Proverbs 18:10', 'Proverbs 27:17',
  'Ecclesiastes 3:1', 'Ecclesiastes 3:11', 'Isaiah 26:3', 'Isaiah 30:15', 'Isaiah 40:31', 'Isaiah 41:10', 'Isaiah 43:2', 'Isaiah 43:19',
  'Isaiah 55:8', 'Isaiah 58:11', 'Jeremiah 29:11', 'Jeremiah 29:13', 'Jeremiah 17:7', 'Lamentations 3:22-23', 'Micah 6:8', 'Zephaniah 3:17',
  'Habakkuk 3:17-18', 'Joshua 1:9', 'Deuteronomy 31:8', 'Numbers 6:24-26', '1 Samuel 16:7', '1 Kings 19:12', 'Nehemiah 8:10', 'Job 12:10',
  'Matthew 5:3', 'Matthew 5:8', 'Matthew 5:9', 'Matthew 5:14', 'Matthew 6:21', 'Matthew 6:33', 'Matthew 6:34', 'Matthew 7:7', 'Matthew 11:28',
  'Matthew 11:29', 'Matthew 22:37', 'Matthew 28:20', 'Mark 9:24', 'Mark 10:27', 'Luke 1:37', 'Luke 6:31', 'Luke 12:34', 'Luke 15:20',
  'John 1:5', 'John 3:16', 'John 8:12', 'John 10:10', 'John 13:34', 'John 14:1', 'John 14:6', 'John 14:27', 'John 15:5', 'John 15:12', 'John 16:33',
  'Acts 17:28', 'Romans 5:3-4', 'Romans 8:28', 'Romans 8:38-39', 'Romans 12:2', 'Romans 12:12', 'Romans 15:13', '1 Corinthians 13:4',
  '1 Corinthians 13:7', '1 Corinthians 13:13', '1 Corinthians 16:14', '2 Corinthians 4:16', '2 Corinthians 4:18', '2 Corinthians 5:17', '2 Corinthians 12:9',
  'Galatians 5:22-23', 'Galatians 6:9', 'Ephesians 2:10', 'Ephesians 3:20', 'Ephesians 4:2', 'Ephesians 4:32', 'Philippians 1:6', 'Philippians 4:4',
  'Philippians 4:6', 'Philippians 4:7', 'Philippians 4:8', 'Philippians 4:13', 'Colossians 3:12', 'Colossians 3:15', 'Colossians 3:23',
  '1 Thessalonians 5:16-18', '2 Timothy 1:7', 'Hebrews 4:16', 'Hebrews 11:1', 'Hebrews 12:1', 'Hebrews 13:5', 'James 1:5', 'James 1:17', 'James 1:19',
  '1 Peter 5:7', '1 Peter 3:15', '2 Peter 3:18', '1 John 1:9', '1 John 3:18', '1 John 4:7', '1 John 4:18', '1 John 4:19', 'Revelation 21:4', 'Revelation 21:5',
];

/** Text of a reference like "Psalms 121:1-2". Poetry lines are kept on separate lines. */
function verseText(ref, translation) {
  const m = ref.match(/^(.+) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const bi = BOOKS.findIndex(b => b.name === m[1]);
  const t = load(translation);
  const ch = bi >= 0 && t.books[bi].chapters[+m[2] - 1];
  if (!ch) return null;
  const from = +m[3], to = +(m[4] || m[3]);
  const parts = [];
  for (const block of ch) {
    if (block[0] === 'h') continue;
    for (const [v, text] of block[1]) {
      if (v < from || v > to) continue;
      parts.push({ poetry: block[0] === 'q', text });
    }
  }
  if (!parts.length) return null;
  let out = '';
  for (const p of parts) out += out ? (p.poetry ? '\n' : ' ') + p.text : p.text;
  const shown = ref.replace(/^Psalms /, 'Psalm ');
  return { ref: shown, text: out, translation: t.short };
}

function verseOfDay(dayNumber, translation) {
  const i = ((dayNumber % VERSES.length) + VERSES.length) % VERSES.length;
  return verseText(VERSES[i], translation);
}

const planList = () => Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, days: p.days }));

// ---- the reader: books, chapters, references and search

const books = () => load('web').books.map((b, i) => ({ name: BOOKS[i].name, chapters: b.chapters.length, testament: i < OT_BOOKS ? 'ot' : 'nt' }));

function chapter(translation, bookIndex, chapterNumber) {
  const t = load(translation);
  const b = t.books[bookIndex];
  if (!b || !b.chapters[chapterNumber - 1]) return null;
  return { book: BOOKS[bookIndex].name, bookIndex, chapter: chapterNumber, chapters: b.chapters.length, translation: t.short, blocks: b.chapters[chapterNumber - 1] };
}

// Book names as people type them: full names, common abbreviations, "1 Cor", "I John", "Psalm".
const ABBR = {
  gen: 0, ge: 0, gn: 0, ex: 1, exo: 1, exod: 1, lev: 2, lv: 2, num: 3, nu: 3, nm: 3, deut: 4, dt: 4, de: 4, josh: 5, jos: 5, judg: 6, jdg: 6, jg: 6, ru: 7, rth: 7,
  '1sam': 8, '1sa': 8, '1s': 8, '2sam': 9, '2sa': 9, '2s': 9, '1kgs': 10, '1ki': 10, '1k': 10, '2kgs': 11, '2ki': 11, '2k': 11, '1chr': 12, '1ch': 12, '2chr': 13, '2ch': 13,
  ezr: 14, neh: 15, ne: 15, est: 16, esth: 16, jb: 17, ps: 18, psa: 18, psalm: 18, pss: 18, psm: 18, prov: 19, pr: 19, prv: 19, eccl: 20, ecc: 20, ec: 20, qoh: 20,
  song: 21, sos: 21, songofsongs: 21, ss: 21, canticles: 21, isa: 22, is: 22, jer: 23, je: 23, lam: 24, la: 24, ezek: 25, eze: 25, ezk: 25, dan: 26, dn: 26, da: 26,
  hos: 27, ho: 27, joel: 28, jl: 28, am: 29, obad: 30, ob: 30, jon: 31, jnh: 31, mic: 32, mi: 32, nah: 33, na: 33, hab: 34, zeph: 35, zep: 35, hag: 36, hg: 36,
  zech: 37, zec: 37, mal: 38, ml: 38, matt: 39, mt: 39, mat: 39, mk: 40, mrk: 40, mar: 40, lk: 41, luk: 41, jn: 42, jhn: 42, joh: 42, ac: 43, rom: 44, ro: 44, rm: 44,
  '1cor': 45, '1co': 45, '2cor': 46, '2co': 46, gal: 47, ga: 47, eph: 48, ep: 48, phil: 49, php: 49, pp: 49, col: 50, '1thess': 51, '1th': 51, '2thess': 52, '2th': 52,
  '1tim': 53, '1ti': 53, '2tim': 54, '2ti': 54, tit: 55, ti: 55, phlm: 56, phm: 56, philem: 56, heb: 57, jas: 58, jm: 58, '1pet': 59, '1pe': 59, '1pt': 59, '2pet': 60, '2pe': 60, '2pt': 60,
  '1jn': 61, '1jo': 61, '1jhn': 61, '2jn': 62, '2jo': 62, '3jn': 63, '3jo': 63, jud: 64, jude: 64, rev: 65, re: 65, rv: 65, revelations: 65, apocalypse: 65,
};
const bookKey = s => String(s).toLowerCase().replace(/^(iii|third)\s*/, '3').replace(/^(ii|second)\s*/, '2').replace(/^(i|first)\s+/, '1').replace(/[^a-z0-9]/g, '');
const FULL = BOOKS.map(b => bookKey(b.name));
function findBook(text) {
  const k = bookKey(text);
  if (!k || /^\d+$/.test(k)) return -1;
  if (k in ABBR) return ABBR[k];
  const exact = FULL.indexOf(k);
  if (exact >= 0) return exact;
  const hits = FULL.map((f, i) => (f.startsWith(k) && k.length >= 3 ? i : -1)).filter(i => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
}
/** "Jn 3:16", "1 Cor 13", "Psalm 23", "Rom 8:28-39" → { book, chapter, verse, to } (or null). */
function parseRef(text) {
  const m = String(text).trim().match(/^((?:[1-3]|i{1,3}|first|second|third)?\s*[a-z][a-z .]*?)\.?\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?$/i);
  if (!m) { const b = findBook(text); return b >= 0 ? { book: b, chapter: 1, verse: 0, to: 0 } : null; }
  const b = findBook(m[1]);
  if (b < 0) return null;
  const chapters = load('web').books[b].chapters.length;
  let c = +m[2], v = +(m[3] || 0), to = +(m[4] || 0);
  if (chapters === 1 && !m[3]) { v = c; c = 1; }              // "Jude 3" means verse 3
  if (c < 1 || c > chapters) return null;
  return { book: b, chapter: c, verse: v, to: to >= v ? to : 0 };
}

// Every verse of a translation, for searching: { b, c, v, text, low }.
const verseIndex = new Map();
function versesOf(id) {
  if (!verseIndex.has(id)) {
    const t = load(id), out = [];
    t.books.forEach((book, b) => book.chapters.forEach((blocks, ci) => {
      const byVerse = new Map();
      for (const block of blocks) if (block[0] !== 'h') for (const [v, text] of block[1]) byVerse.set(v, (byVerse.has(v) ? byVerse.get(v) + ' ' : '') + text);
      for (const [v, text] of byVerse) out.push({ b, c: ci + 1, v, text, low: text.toLowerCase() });
    }));
    verseIndex.set(id, out);
  }
  return verseIndex.get(id);
}
/**
 * Words anywhere in the verse (all of them), or "an exact phrase" in quotes; whole-phrase matches first.
 * Returns { total, results: [{ book, bookIndex, chapter, verse, ref, text }] }.
 */
function search(translation, query, limit = 60, offset = 0) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return { total: 0, results: [] };
  const phrases = [...q.matchAll(/"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean);
  const words = q.replace(/"[^"]*"/g, ' ').split(/[^a-z0-9'’]+/).filter(w => w.length > 1);
  // short words match whole words ("be" isn't "bed"); longer ones match their forms too ("love" → "loved", "loving")
  const wordRe = words.map(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${w.length < 4 ? '\\b' : ''}`, 'i'));
  const all = versesOf(TRANSLATIONS[translation] ? translation : 'web');
  const hits = all.filter(x => phrases.every(p => x.low.includes(p)) && wordRe.every(r => r.test(x.low)));
  const whole = phrases.length ? null : q.replace(/"/g, '');
  hits.sort((a, b) => (whole ? (b.low.includes(whole) - a.low.includes(whole)) : 0));
  const t = load(TRANSLATIONS[translation] ? translation : 'web');
  return {
    total: hits.length, translation: t.short,
    results: hits.slice(offset, offset + limit).map(x => ({ book: BOOKS[x.b].name, bookIndex: x.b, chapter: x.c, verse: x.v,
      ref: `${BOOKS[x.b].name.replace(/^Psalms$/, 'Psalm')} ${x.c}:${x.v}`, text: x.text })),
  };
}

module.exports = { TRANSLATIONS, PLANS, planList, planDay, label, reading, verseText, verseOfDay, VERSES, books, chapter, parseRef, findBook, search };
