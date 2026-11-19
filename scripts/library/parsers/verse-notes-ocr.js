'use strict';
/**
 * Scanned verse-by-verse commentaries (Vincent's Word Studies): "CHAPTER XI." headings, then notes that begin
 * "29. A light (...)". Each file is one volume; source.volumes[file] lists its books in order. A new book starts
 * when the chapter numbering starts again at I. Notes are checked against the real verse counts of each chapter
 * (from the KJV), and OCR noise (page heads, numbers out of order) is dropped. Neighbouring notes are gathered
 * into sections of up to about 500 tokens.
 */
const { cleanOcr } = require('./common');
const kjv = require('../../../bible/kjv.json');
const NAME = require('../../../src/bible-books').BOOKS.map(b => b.name);
const verses = (b, c) => { const ch = kjv.books[b] && kjv.books[b].chapters[c - 1]; if (!ch) return 0; let m = 0; for (const blk of ch) if (blk[0] !== 'h') for (const [v] of blk[1]) m = Math.max(m, v); return m; };
const roman = s => {
  const t = s.toUpperCase().replace(/[1L|!lT]/g, 'I').replace(/[^IVX]/g, '');
  const V = { I: 1, V: 5, X: 10 }; let n = 0;
  for (let i = 0; i < t.length; i++) { const a = V[t[i]], b = V[t[i + 1]] || 0; n += a < b ? -a : a; }
  return n;
};

// A word in each book's title, to notice where the next book begins when the scan lost its "CHAPTER I.".
const KEY = { 39: 'MATTHEW', 40: 'MARK', 41: 'LUKE', 42: 'JOHN', 43: 'ACTS', 44: 'ROMANS', 45: 'CORINTHIANS', 46: 'CORINTHIANS', 47: 'GALATIANS', 48: 'EPHESIANS',
  49: 'PHILIPPIANS', 50: 'COLOSSIANS', 51: 'THESSALONIANS', 52: 'THESSALONIANS', 53: 'TIMOTHY', 54: 'TIMOTHY', 55: 'TITUS', 56: 'PHILEMON', 57: 'HEBREWS', 58: 'JAMES',
  59: 'PETER', 60: 'PETER', 61: 'JOHN', 62: 'JOHN', 63: 'JOHN', 64: 'JUDE', 65: 'REVELATION' };
const RUNNING = /WORD STUDIES IN THE|^\s*\d{1,4}\s+[A-Z][A-Z .,'’]{3,}|[\[(]\s*[CO][uhxnr][.,]?\s*[IVXLTl1|]{1,6}\s*[\].)J]?\s*$|^\s*[‘']?[CO][uhxnr][.,]?\s*[IVXLTl1|]{1,6}\.?\s*[\])J]/;

module.exports = function parse(raw, { file, source }) {
  const books = (source.volumes || {})[file];
  if (!books) throw new Error('no book list for ' + file);
  // Lines kept as lines: headings and note openings are found line by line.
  const lines = String(raw).replace(/\r/g, '').split('\n');
  const out = [];
  let bi = -1, chap = 0, group = null, note = null, lastV = 0, started = false;
  const book = () => books[bi];
  const flushNote = () => {
    if (!note) return;
    const text = cleanOcr(note.lines.join('\n')).trim();
    if (text.length > 15) {
      if (group && (group.c !== chap || (group.text.length + text.length) / 4 > 500)) flushGroup();
      if (!group) group = { b: book(), c: chap, v1: note.v, v2: note.v, text: '' };
      group.v2 = note.v; group.text += (group.text ? '\n\n' : '') + `${note.v}. ${text}`;
    }
    note = null;
  };
  const flushGroup = () => {
    if (group) out.push({ section: `${NAME[group.b]} ${group.c}:${group.v1}${group.v2 > group.v1 ? '–' + group.v2 : ''}`, refs: [[group.b, group.c, group.v1, group.c, group.v2]], text: group.text });
    group = null;
  };
  const maxCh = b => kjv.books[b] ? kjv.books[b].chapters.length : 0;
  const toChapter = n => { flushNote(); flushGroup(); chap = n; lastV = 0; };
  for (const line of lines) {
    // A book's title: the next book in this volume begins (its chapter heading will follow).
    const next = books[bi + 1];
    const t = line.trim();
    // (Only near the end of the book before, so a table of contents at the front doesn't count.)
    if (next != null && bi >= 0 && chap >= Math.max(1, maxCh(book()) - 2) && t.length < 70 && t === t.toUpperCase() && /EPISTLE|GOSPEL|ACTS|REVELATION|APOCALYPSE/.test(t) && t.includes(KEY[next]) && !/\d/.test(t)
      && (KEY[next] !== KEY[book()] || /SECOND|THIRD|II|III/.test(t))) {
      flushNote(); flushGroup(); bi++; chap = 0; lastV = 0; started = true;
      continue;
    }
    // A page's running head: drop it, but use its chapter number to keep our place.
    if (RUNNING.test(line)) {
      const rh = line.match(/[CO][uhxnr][.,]?\s*([IVXLTl1|]{1,6})/);
      // The page's chapter, as printed at its head: trusted over our count when it's close to it.
      if (rh && started && chap) { const n = roman(rh[1]); if (n > chap && n <= chap + 2 && n <= maxCh(book())) toChapter(n); }
      continue;
    }
    const ch = line.match(/^\s*CHAPTER\s+([IVXLl1|!T]{1,6})\.?\s*$/);
    if (ch) {
      const n = roman(ch[1]);
      if (!n) continue;
      flushNote(); flushGroup();
      if (n === 1 && chap === 0 && bi >= 0) { started = true; }     // the book's title came first
      else if (bi < 0 || (n === 1 && chap >= Math.max(1, maxCh(book()) - 2))) { bi = Math.min(bi + 1, books.length - 1); started = true; }
      else if (n <= chap) continue;                                  // misread; the running heads will put us right
      else if (n <= chap || n > maxCh(book())) continue;          // a misread number
      chap = n; lastV = 0;
      continue;
    }
    if (!started) continue;
    const vm = line.match(/^\s*(\d{1,3})\.\s+(\S.*)$/);
    if (vm) {
      const v = +vm[1];
      // Notes starting again at verse 1–3 after a run: the scan lost this chapter's heading.
      if (chap && v > lastV && v <= lastV + 15 && v <= verses(book(), chap)) {
        flushNote(); note = { v, lines: [vm[2]] }; lastV = v;
        continue;
      }
    }
    if (note) note.lines.push(line);
  }
  flushNote(); flushGroup();
  return out.map(retag);
};

// ---- checking each group of notes against the words of the verses it claims (the notes quote the KJV)
const verseWords = (b, c, v) => {
  const ch = kjv.books[b] && kjv.books[b].chapters[c - 1];
  if (!ch) return '';
  let t = '';
  for (const blk of ch) if (blk[0] !== 'h') for (const [x, s] of blk[1]) if (x >= v - 1 && x <= v + 1) t += ' ' + s;
  return t.toLowerCase();
};
function fit(sec, b, c) {
  let ok = 0, n = 0;
  for (const m of sec.text.matchAll(/(?:^|\n\n)(\d{1,3})\.\s+([A-Z][a-z]+(?:\s[a-z]+){0,3})/g)) {
    const words = m[2].toLowerCase().split(' ').filter(w => w.length > 3);
    if (!words.length) continue;
    n++;
    const t = verseWords(b, c, +m[1]);
    if (t && words.some(w => t.includes(w.slice(0, Math.max(4, w.length - 2))))) ok++;
  }
  return { ok, n };
}
/** A group whose headwords fit a neighbouring chapter clearly better (the scan lost a chapter heading) moves there. */
function retag(sec) {
  const [b, c, v1, , v2] = sec.refs[0];
  const here = fit(sec, b, c);
  if (here.n < 2) return sec;
  let best = { c, ok: here.ok };
  for (const alt of [c + 1, c - 1, c + 2]) {
    if (alt < 1 || alt > kjv.books[b].chapters.length || v2 > verses(b, alt)) continue;
    const f = fit(sec, b, alt);
    if (f.ok >= best.ok + 2 && f.ok >= Math.ceil(f.n * 0.6)) best = { c: alt, ok: f.ok };
  }
  if (best.c === c) return sec;
  return { ...sec, section: `${NAME[b]} ${best.c}:${v1}${v2 > v1 ? '–' + v2 : ''}`, refs: [[b, best.c, v1, best.c, v2]] };
}
