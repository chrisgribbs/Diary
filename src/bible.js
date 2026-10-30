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

module.exports = { TRANSLATIONS, PLANS, planList, planDay, label, reading, verseText, verseOfDay, VERSES };
