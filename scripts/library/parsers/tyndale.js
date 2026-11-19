'use strict';
/**
 * Tyndale Open Resources (tyndaleopenresources.com, CC BY-SA 4.0): the Tyndale Open Study Notes and the Tyndale Open
 * Bible Dictionary, as Tyndale publishes them: a zip of XML files, one <item> per note or article.
 *
 * source.kind:
 *   'notes'       StudyNotes.xml (a note per verse or range, each with <refs>), grouped by chapter into passages of
 *                 about 1,500 characters so a study gets several notes at once; plus the theme articles and people
 *                 profiles (each tagged with its verses) and the short book introductions (tagged with the whole book).
 *   'dictionary'  Articles/*.xml, one article per person, place or term. Tagged with verses only when an article
 *                 points to a few (≤ 4), so a long survey like "Jesus Christ" is found by meaning, not by every verse.
 *
 * The text is kept as Tyndale wrote it; only the markup is removed (links and formatting) and short notes grouped.
 */
const { unzip } = require('./common');
const { BOOKS } = require('../../../src/bible-books');

// Tyndale's book codes, in canonical order (checked against the files: all 66 appear).
const CODES = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra',
  'Neh', 'Esth', 'Job', 'Ps', 'Pr', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jon',
  'Mic', 'Nah', 'Hab', 'Zeph', 'Hagg', 'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal',
  'Eph', 'Phil', 'Col', '1Thes', '2Thes', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1Jn', '2Jn', '3Jn',
  'Jude', 'Rev'];
if (CODES.length !== BOOKS.length) throw new Error('Tyndale book codes don’t match the 66 books');
const BOOK = new Map(CODES.map((c, i) => [c.toLowerCase(), i]));

/** "Gen.1.1", "Gen.1.3-13", "Gen.1.1-2.3", "Gen.1" → [book, c1, v1, c2, v2], or null. */
function osisRef(s) {
  const m = /^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?(?:-(?:(\d+)\.)?(\d+))?$/.exec(String(s).trim());
  if (!m) return null;
  const b = BOOK.get(m[1].toLowerCase());
  if (b == null) return null;
  const c1 = +m[2], v1 = m[3] ? +m[3] : 0;
  let c2 = c1, v2 = v1;
  if (m[5]) {
    if (m[4]) { c2 = +m[4]; v2 = +m[5]; }
    else if (m[3]) v2 = +m[5];          // Gen.1.3-13: verses 3 to 13
    else { c2 = +m[5]; v2 = 0; }         // Gen.1-3: chapters 1 to 3
  }
  return [b, c1, v1, c2, v2];
}
const refsOf = s => String(s || '').split(/[,;\s]+/).map(osisRef).filter(Boolean);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '’', nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
/** The text of a bit of Tyndale's XHTML: paragraphs kept, everything else unwrapped. */
function textOf(html) {
  return String(html)
    .replace(/<p class="(?:h1|toc)"[^>]*>[\s\S]*?<\/p>/g, '')            // the article's own title line, contents lists
    .replace(/<(?:img|table)[\s\S]*?(?:\/>|<\/table>)/g, '')
    .replace(/<\/p>|<br\s*\/?>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m))
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const ITEM = /<item\b([^>]*)>([\s\S]*?)<\/item>/g;
const attr = (a, n) => { const m = new RegExp(`${n}="([^"]*)"`).exec(a); return m ? m[1] : ''; };
function items(xml) {
  const out = [];
  for (const m of String(xml).matchAll(ITEM)) {
    const body = /<body>([\s\S]*?)<\/body>/.exec(m[2]);
    out.push({ name: attr(m[1], 'name'), type: attr(m[1], 'typename'), refs: refsOf((/<refs>([^<]*)<\/refs>/.exec(m[2]) || [])[1]),
      title: textOf((/<title>([\s\S]*?)<\/title>/.exec(m[2]) || [])[1] || ''), html: body ? body[1] : '' });
  }
  return out;
}
const bookName = b => BOOKS[b].name;
const label = r => `${bookName(r[0])} ${r[1]}${r[2] ? ':' + r[2] : ''}${r[3] !== r[1] ? `–${r[3]}${r[4] ? ':' + r[4] : ''}` : r[4] && r[4] !== r[2] ? '–' + r[4] : ''}`;

const GROUP = 1500;   // characters of notes per passage

function notes(files) {
  const find = n => Object.keys(files).find(k => k.endsWith('/' + n) || k === n);
  const out = [];
  // Study notes, grouped by chapter.
  const sn = items(files[find('StudyNotes.xml')].toString('utf8')).filter(x => x.refs.length);
  let cur = null;
  const flush = () => { if (cur) { const first = cur.refs[0], last = cur.refs[cur.refs.length - 1];
    out.push({ section: `Notes on ${label([first[0], first[1], first[2], last[3], last[4]])}`, refs: cur.refs, text: cur.parts.join('\n\n') }); cur = null; } };
  for (const n of sn) {
    const r = n.refs[0], text = textOf(n.html);
    if (!text) continue;
    if (cur && (cur.book !== r[0] || cur.chapter !== r[1] || cur.len + text.length > GROUP)) flush();
    if (!cur) cur = { book: r[0], chapter: r[1], refs: [], parts: [], len: 0 };
    cur.refs.push(...n.refs); cur.parts.push(text); cur.len += text.length;
  }
  flush();
  // Theme articles and profiles: each its own passage, under its title.
  for (const [file, kind] of [['ThemeNotes.xml', 'Theme'], ['Profiles.xml', 'Profile']]) {
    const f = find(file);
    if (!f) continue;
    for (const x of items(files[f].toString('utf8'))) {
      const text = textOf(x.html);
      const title = x.title || text.split('\n')[0].slice(0, 80) || x.name.replace(/([a-z])([A-Z])/g, '$1 $2');   // the title is the first line
      if (text) out.push({ section: `${kind}: ${title}`, refs: x.refs, text });
    }
  }
  // Book introductions: the short summaries, tagged with the whole book (so they rank below notes on the verses).
  const bs = find('BookIntroSummaries.xml');
  if (bs) for (const x of items(files[bs].toString('utf8'))) {
    const text = textOf(x.html);
    if (text && x.refs.length) out.push({ section: `Introduction to ${bookName(x.refs[0][0])}`, refs: x.refs, text });
  }
  return out;
}

function dictionary(files) {
  const out = [];
  for (const name of Object.keys(files).filter(k => /Articles\/[A-Z]+\.xml$/.test(k)).sort()) {
    const xml = files[name].toString('utf8');
    for (const x of items(xml)) {
      if (x.type !== 'Article' && !/_Article_/.test(x.name)) continue;
      const text = textOf(x.html);
      if (text.length < 120) continue;   // "See …" cross-reference stubs
      const cited = [...new Set([...x.html.matchAll(/\?bref=([^"&]+)/g)].map(m => m[1]))].map(osisRef).filter(Boolean);
      const title = x.title || x.name.replace(/_Article_.*$/, '');
      out.push({ section: title.replace(/\*/g, ''), refs: cited.length && cited.length <= 4 ? cited : [], text: `${title.replace(/\*/g, '')}\n\n${text}` });
    }
  }
  return out;
}

module.exports = function parse(buf, { source }) {
  const files = unzip(Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'binary'));
  return source.kind === 'dictionary' ? dictionary(files) : notes(files);
};
module.exports.binary = true;
module.exports.osisRef = osisRef;
module.exports.textOf = textOf;
