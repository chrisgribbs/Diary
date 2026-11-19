'use strict';
/**
 * Bible references as the library stores them: [book, chapterFrom, verseFrom, chapterTo, verseTo].
 * book is 0–65 (src/bible-books.js); a verse of 0 means the whole chapter ("Psalm 23" = [18, 23, 0, 23, 0]).
 *
 * Used in two places: by the library builder (scripts/library), to tag each passage of a commentary with the verses
 * it discusses, and by the app, to find the passages on the verses being studied.
 */
const { BOOKS } = require('../bible-books');
const { findBook } = require('../bible');

const BIG = 999;
const norm = r => {
  let [b, c1, v1, c2, v2] = r;
  if (c2 == null) { c2 = c1; v2 = v1; }
  return [b, c1, v1 || 0, c2 || c1, v2 || 0];
};
// Positions as numbers, so ranges compare simply: chapter × 1000 + verse (a whole chapter runs 0 to 999).
const lo = r => r[1] * 1000 + (r[2] || 0);
const hi = r => r[3] * 1000 + (r[4] || BIG);

/** Do two references share any verse? */
function overlaps(a, b) {
  a = norm(a); b = norm(b);
  return a[0] === b[0] && lo(a) <= hi(b) && lo(b) <= hi(a);
}
/** About how many verses a reference covers (a whole chapter counts as 30). */
function span(r) {
  r = norm(r);
  if (r[1] === r[3]) return r[2] ? Math.max(1, r[4] - r[2] + 1) : 30;
  return (r[3] - r[1] + 1) * 30;
}
/**
 * How closely a stored reference matches the passage being studied: 0 (not at all) to 1.
 * A note on exactly these verses beats one on a few around them, which beats one on the whole chapter.
 */
function closeness(stored, passage) {
  if (!overlaps(stored, passage)) return 0;
  const s = span(stored), p = span(passage);
  const a = norm(stored), q = norm(passage);
  const shared = Math.max(1, Math.min(hi(a), hi(q)) - Math.max(lo(a), lo(q)) + 1);
  const cover = Math.min(1, (a[1] === a[3] && q[1] === q[3] && a[2] && q[2]) ? shared / p : 0.5);
  const tight = Math.min(1, p / s);
  return 0.15 + 0.85 * (0.6 * tight + 0.4 * cover);
}

/** "Matthew 11:28–30", "Psalm 23", "John 3:16–4:2". */
function label(r) {
  r = norm(r);
  const name = BOOKS[r[0]] ? BOOKS[r[0]].name.replace(/^Psalms$/, 'Psalm') : '?';
  if (!r[2]) return r[1] === r[3] ? `${name} ${r[1]}` : `${name} ${r[1]}–${r[3]}`;
  if (r[1] === r[3]) return r[2] === r[4] ? `${name} ${r[1]}:${r[2]}` : `${name} ${r[1]}:${r[2]}–${r[4]}`;
  return `${name} ${r[1]}:${r[2]}–${r[3]}:${r[4]}`;
}

/**
 * One reference typed or printed: "Mt 11:28-30", "Matt. xi. 28", "Rom 8", "John 3:16–4:2", "1 Cor. 13:4, 5".
 * Roman-numeral chapters (common in older books) are understood. Returns a stored reference or null.
 */
function parse(text) {
  const s = String(text).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const m = s.match(/^((?:[1-3]|i{1,3})\s?[A-Za-z][A-Za-z .]*?|[A-Za-z][A-Za-z .]*?)\.?\s+([0-9]{1,3}|[ivxlc]{1,8})(?:\s?[:.,]\s?([0-9]{1,3})(?:\s?-\s?(?:([0-9]{1,3}|[ivxlc]{1,8})\s?[:.]\s?)?([0-9]{1,3}))?(?:\s?,\s?([0-9]{1,3}))?)?\.?$/i);
  if (!m) return null;
  const b = findBook(m[1].replace(/\.$/, ''));
  if (b < 0) return null;
  const c = num(m[2]);
  if (!c || c > 150) return null;
  const v = m[3] ? +m[3] : 0;
  let c2 = m[4] ? num(m[4]) : c, v2 = m[5] ? +m[5] : v;
  if (m[6] && !m[5]) v2 = +m[6];
  if (!v) return [b, c, 0, c, 0];
  if (c2 < c || (c2 === c && v2 < v)) { c2 = c; v2 = v; }
  return [b, c, v, c2, v2];
}
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function num(t) {
  if (/^\d+$/.test(t)) return +t;
  const s = t.toLowerCase(); let n = 0;
  for (let i = 0; i < s.length; i++) { const a = ROMAN[s[i]], b = ROMAN[s[i + 1]] || 0; if (!a) return 0; n += a < b ? -a : a; }
  return n;
}

// Book names and abbreviations as they appear in running text, for finding references inside a paragraph.
const NAMES = BOOKS.map(b => b.name.replace(/^(\d) /, '$1 ?')).concat([
  'Gen', 'Ex', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', '[12] ?Sam', '[12] ?Kings?', '[12] ?Kgs', '[12] ?Chron', 'Neh', 'Esth', 'Ps', 'Psa', 'Psalm', 'Prov', 'Eccles?', 'Song', 'Cant',
  'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Obad', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal', 'Matt?', 'Mk', 'Lk', 'Jn', 'Rom', '[12] ?Cor', 'Gal', 'Eph',
  'Phil', 'Col', '[12] ?Thess', '[12] ?Tim', 'Tit', 'Philem', 'Heb', 'Jas', '[12] ?Pet', '[123] ?John', '[123] ?Jn', 'Rev',
]);
const INLINE = new RegExp(`\\b((?:${NAMES.join('|')}))\\.? ((?:\\d{1,3}|[ivxlc]{1,8})[:.] ?\\d{1,3}(?: ?[-–] ?\\d{1,3})?)`, 'gi');
/** Every reference mentioned in a paragraph of text (for books arranged by subject, not verse). */
function findIn(text) {
  const out = [];
  for (const m of String(text).matchAll(INLINE)) {
    const r = parse(`${m[1]} ${m[2]}`);
    if (r) out.push(r);
  }
  return out;
}

/** The reference of a passage the person picked in the app: { book, chapter, verse, to } (as bible.parseRef gives). */
const fromPick = p => (p.verse ? [p.book, p.chapter, p.verse, p.chapter, p.to || p.verse] : [p.book, p.chapter, 0, p.chapter, 0]);

/**
 * William Barclay's Daily Study Bible on StudyLight.org for a passage's chapter (New Testament only), or null.
 * It's in copyright, so WellWrite only links to it: the page opens in the browser and nothing is fetched or stored.
 * StudyLight's addresses: /commentaries/eng/dsb/1-corinthians-13.html
 */
function barclayLink(r) {
  if (!Array.isArray(r)) return null;
  const [b, c] = norm(r);
  if (!(b >= 39 && b < BOOKS.length) || !(c >= 1)) return null;
  const slug = BOOKS[b].name.toLowerCase().replace(/ /g, '-');
  return { url: `https://www.studylight.org/commentaries/eng/dsb/${slug}-${c}.html`, label: `${BOOKS[b].name} ${c}` };
}

module.exports = { barclayLink, overlaps, span, closeness, label, parse, findIn, fromPick, norm };
