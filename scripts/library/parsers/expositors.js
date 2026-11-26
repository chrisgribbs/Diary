'use strict';
/**
 * The Expositor's Bible (ed. W. Robertson Nicoll; Project Gutenberg's typed editions). Each volume has its own
 * author and layout, so chapters are found by any of the headings the volumes use:
 *   "CHAPTER IV." then the title on the following lines;  "Chapter III. The Vision Of The Glory Of God. Chapter i.";
 *   a bare "IV." with a title under it (volumes without the word CHAPTER);  "PSALM XXIII." (Maclaren's Psalms);
 *   "FIRST SECTION." / "THE EPILOGUE." (Cox's Ecclesiastes).
 * A volume that uses CHAPTER headings uses bare numerals for points within a chapter, so those are ignored there.
 * Each chapter is tagged with the verses its title or opening lines name, kept to the books the volume covers
 * (source.volumes[file]); a bare "iv. 1-20" is read as the volume's book. Footnotes are dropped.
 */
const refs = require('../../../src/study/refs');
const { BOOKS } = require('../../../src/bible-books');
const { stripGutenberg, unwrap } = require('./common');
const { titleCase, anchorRef } = require('./maclaren');

const CHAPTER = /^\s*(?:CHAPTER|Chapter|DISCOURSE|LECTURE)S?\s+([IVXLC]+)\b\.?\s*(.*)$/;
const PSALM = /^\s*PSALM\s+([IVXLC]+)\.?\s*$/;
const NUMERAL = /^\s*([IVXLC]+)\.?\s*$/;
const NAMED = /^\s*(THE PROLOGUE|THE EPILOGUE|(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH) SECTION)\.?\s*$/;
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const roman = s => [...s.toUpperCase()].reduce((n, c, i, a) => (ROMAN[c] < (ROMAN[a[i + 1]] || 0) ? n - ROMAN[c] : n + ROMAN[c]), 0);
// Chapters in each book, so a stray "c. 586" or "B.C. 586" is never read as a chapter
const CHAPTERS = [50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3,
  3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22];
const real = r => r && r[1] >= 1 && r[3] <= CHAPTERS[r[0]];
const plain = l => l.replace(/_/g, '').replace(/\s+\d{1,4}\s*$/, '').replace(/\s+/g, ' ').trim();
// A title line: short, and most of its longer words capitalised (or the whole line in capitals or italics).
const titled = l => {
  const t = plain(l);
  if (!t || t.length > 90) return false;
  if (/^_.*_\.?$/.test(l.trim()) || (/[A-Z]{3}/.test(t) && t === t.toUpperCase())) return true;
  const w = t.replace(/[^A-Za-z ]/g, '').split(' ').filter(x => x.length > 3);
  return w.length > 0 && w.filter(x => /^[A-Z]/.test(x)).length >= Math.ceil(w.length * 0.6);
};

/** Verses named in a chapter's title and opening, kept to the volume's books. */
function chapterRefs(head, opening, books) {
  const inBooks = r => real(r) && (!books || !books.length || books.includes(r[0]));
  let found = refs.findIn(head).filter(inBooks);
  if (!found.length && books && books.length) {
    // "Chapter i.", "Chapters ii., iii.", "iv. 1-20" with the book left to the volume
    const m = head.match(/\b(?:chapters?\s+)?([ivxlc]{1,8})\.?(?:\s?(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?)?/i);
    if (m && /[ivxlc]/i.test(m[1]) && (m[2] || /chapter/i.test(head))) {
      const r = refs.parse(`${BOOKS[books[0]].name} ${m[1]}${m[2] ? '.' + m[2] + (m[3] ? '-' + m[3] : '') : ''}`);
      if (real(r)) found = [r];
    }
  }
  if (!found.length) found = refs.findIn(opening.slice(0, 500)).filter(inBooks);
  if (!found.length && books && books.length) {
    const m = opening.slice(0, 300).match(/^\s*["“']?.{0,240}?[—–-]{1,2}\s?((?:[ivxlc]{1,8})\.\s?\d{1,3}(?:\s?[-–]\s?\d{1,3})?)/i);
    if (m) { const r = refs.parse(`${BOOKS[books[0]].name} ${m[1]}`); if (real(r)) found = [r]; }
  }
  if (!found.length) {
    // The chapter of the Bible this chapter keeps citing (three times or more): tag that whole chapter.
    const n = new Map();
    for (const r of refs.findIn(opening).filter(inBooks)) { const k = r[0] * 1000 + r[1]; n.set(k, (n.get(k) || 0) + 1); }
    if (books && books.length === 1) {   // in a one-book volume, "(xi. 45)" and "chap. xxviii" mean that book
      for (const m of opening.matchAll(/(?:\(|\bchap(?:ter)?\.?\s)([ivxlc]{1,8})\.?(?:\s?\d{1,3})?/gi)) {
        const r = refs.parse(`${BOOKS[books[0]].name} ${m[1]}`);
        if (real(r)) { const k = r[0] * 1000 + r[1]; n.set(k, (n.get(k) || 0) + 1); }
      }
    }
    const best = [...n].sort((a, b) => b[1] - a[1])[0];
    const sorted = [...n].sort((a, b) => b[1] - a[1]), second = sorted[1] ? sorted[1][1] : 0;
    if (best && best[1] >= 3 && best[1] >= second * 2) found = [[Math.floor(best[0] / 1000), best[0] % 1000, 0, best[0] % 1000, 0]];
  }
  return found.slice(0, 2);
}

/** Chapters found one way: with numeral headings counted (volumes without the word CHAPTER in the body) or not. */
function split(lines, books, file, numerals, author) {
  const heads = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (lines[i - 1].trim() !== '') continue;
    let m, title = '', psalm = 0, start = i + 1;
    const after = () => {   // the title: the first one or two short title lines below the heading
      const t = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 8) && t.length < 2; j++) {
        if (!lines[j].trim()) { if (t.length) break; continue; }
        if (!titled(lines[j])) break;
        t.push(plain(lines[j])); start = j + 1;
      }
      return t.join(' ');
    };
    if ((m = l.match(CHAPTER))) title = plain(m[2]) || after();
    else if ((m = l.match(PSALM))) { psalm = roman(m[1]); title = `Psalm ${psalm}`; }
    else if ((m = l.match(NAMED))) title = titleCase(m[1]);
    else if (numerals && (m = l.match(NUMERAL))) { title = after(); if (!title) continue; }
    else continue;
    title = title.replace(/\[\d{1,3}\]/g, '').replace(/[.,;:]$/, '').trim();
    if (m[0].match(CHAPTER) && !/[A-Za-z]{3}/.test(title)) title = '';
    if (title && !/^[A-Z0-9'‘“"(]/.test(title)) continue;                // a sentence that happens to start with "chapter"
    heads.push({ at: i, start, title, psalm });
  }
  // Some volumes (Dods on 1 Corinthians) print the passage just before the chapter heading: its title again, the
  // passage quoted, ending "--1 COR. i. 17-ii. 5." That passage belongs to the chapter that follows.
  heads.forEach((h, k) => {
    if (!h.title) return;
    const from = Math.max(k ? heads[k - 1].start : 0, h.at - 160), want = plain(h.title).toLowerCase().replace(/[.,]$/, '');
    for (let q = h.at - 1; q > from; q--) {
      if (plain(lines[q]).toLowerCase().replace(/[.,]$/, '') !== want) continue;
      const passage = lines.slice(q + 1, h.at).join('\n');
      if (/[-—]{1,2}\s?\S/.test(passage)) { h.before = q; h.passage = passage; }
      break;
    }
  });
  const out = [];
  heads.forEach((h, k) => {
    const stop = k + 1 < heads.length ? (heads[k + 1].before != null ? heads[k + 1].before : heads[k + 1].at) : lines.length;
    let body = lines.slice(h.start, stop).join('\n').replace(/\n\s*FOOTNOTES?:[\s\S]*$/, '');
    body = unwrap(body).replace(/_([^_\n]+)_/g, '$1').replace(/\[(\d{1,3}|[A-Z])\]/g, '');
    if (body.length < 1500) return;                                   // contents lines, part titles
    let r = h.psalm ? [refs.parse(`Psalm ${h.psalm}`)] : [];
    if (!r.length && h.passage) {
      const tail = h.passage.replace(/\s+/g, ' ').match(/(?:--|—)\s?([^—]{4,60}?)\s*$/);
      const one = tail && anchorRef(tail[1].replace(/--.*$/, ''));
      if (one && real(one) && (!books || books.includes(one[0]))) r = [one];
      else if (tail) r = chapterRefs(tail[1], '', books);
    }
    if (!r.length) r = chapterRefs(h.title, body, books);
    const title = /[a-z]/.test(h.title) ? h.title : titleCase(h.title);
    const label = r.length ? `${title || refs.label(r[0])} (${refs.label(r[0])})` : title || 'Chapter';
    out.push({ section: author ? `${author}: ${label}` : label, refs: r, text: body, key: `${file}|${h.at}` });
  });
  return out;
}

module.exports = function parse(raw, { file, source } = {}) {
  const books = (source && source.volumes && source.volumes[file]) || null;
  const lines = stripGutenberg(raw).replace(/[\u00a0\u2002-\u200a]/g, ' ').split('\n');
  const author = (source && source.authors && source.authors[file]) || '';
  const a = split(lines, books, file, false, author), b = split(lines, books, file, true, author);
  // Whichever reading finds more real chapters (a volume's points within a chapter are numbered too, so the
  // numeral reading only wins clearly when the volume has no CHAPTER headings in its body)
  return b.length > a.length * 1.5 + 2 ? b : a;
};
