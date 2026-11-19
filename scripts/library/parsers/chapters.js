'use strict';
/**
 * Books arranged by chapter rather than by verse (the spiritual classics, Edersheim): split at "CHAPTER …" headings,
 * each section titled with its part ("THE FIRST MANSIONS", "BOOK III") and the chapter's own heading. Not tagged with
 * verses: these books quote Scripture in passing rather than comment on it, so they're found by their words and
 * meaning, not by reference. Front matter and tables of contents (short sections) are left out.
 *
 * source.part: optional regex (string) for part headings; source.stripGutenberg: true for Gutenberg texts.
 */
const { cleanOcr, stripGutenberg } = require('./common');
const refs = require('../../../src/study/refs');

const CHAPTER = /^\s*CHAPTER\s+([IVXLC\d]{1,7}|THE [A-Z ]{3,40})\.?\s*(.*)$/;

module.exports = function parse(raw, { source }) {
  let text = String(raw).replace(/\r/g, '');
  if (source.stripGutenberg) text = stripGutenberg(text);
  text = text.replace(/[ \t]{2,}/g, ' ');
  // "THE FOUR AND SIXTIETH" / "CHAPTER" on two lines (The Cloud of Unknowing) → one heading line
  text = text.replace(/\n[ \t]*(THE [A-Z ]{3,40}?)[ \t]*\n[ \t]*CHAPTER[ \t]*\n/g, '\nCHAPTER $1\n');
  const drop = source.dropLines ? new RegExp(source.dropLines) : null;
  if (source.startAt) { const at = text.search(new RegExp(source.startAt, 'm')); if (at > 0) text = text.slice(at); }
  if (source.single) {   // one long section (chunked later), for books whose divisions the scan doesn't keep
    const body = cleanOcr(text.split('\n').filter(l => !drop || !drop.test(l)).join('\n')).trim();
    return [{ section: source.single, refs: [], text: body }];
  }
  const lines = text.split('\n').filter(l => !drop || !drop.test(l));
  const HEAD = source.heading ? new RegExp(source.heading) : CHAPTER;
  const partRe = source.part ? new RegExp(source.part) : null;
  const out = [];
  let part = '', cur = null, lastN = 0, partNo = 0;
  const parts = source.restartParts || null;   // e.g. ["Book I", "Book II"]: a new part each time chapters start again at I
  const close = () => {
    if (!cur) return;
    const body = cleanOcr(cur.lines.join('\n'))
      .replace(/^\s*\^?\d{0,2}\s?[a-z]?\s*(?:Spanish|Sp\.|Obras|cf\.|Cf\.|See )[^\n]{0,200}$/gm, '')   // footnotes
      .trim();
    if ((body.match(/\. ?\. ?\./g) || []).length > 3) { cur = null; return; }   // a table of contents
    // Edersheim: each chapter names the Gospel passages it covers, just under its heading.
    const rs = source.refsFromHead ? refs.findIn(body.slice(0, 400)) : [];
    if (body.length > 1200) out.push({ section: [part, cur.title].filter(Boolean).join(', '), refs: rs, text: body, r: partNo, title: cur.title });
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (partRe && partRe.test(l.trim()) && l.trim().length < 60) { close(); part = titleCase(l.trim().replace(/\.$/, '')); continue; }
    const m = l.match(HEAD);
    if (m) {
      close();
      if (parts) {
        const n = /^\d+$/.test(m[1]) ? +m[1] : roman(m[1]);
        if (n === 1 && lastN !== 0) partNo++;
        if (n) lastN = n;
        part = '';   // named at the end, counting back from the last part (a contents page restarts the count too)
      }
      // the chapter's heading: the rest of the line, or the next non-empty line
      let head = (m[2] || '').trim();
      if (!head) { let j = i + 1; while (j < lines.length && !lines[j].trim()) j++; if (j < lines.length && lines[j].trim().length < 140) { head = lines[j].trim(); i = j; } }
      const label = /^[IVXLC\d]{1,7}$/.test(m[1]) ? `Chapter ${m[1]}` : titleCase(m[1].replace(/^THE /, 'The ').trim()) + (source.heading ? (source.labelSuffix || '') : ' chapter');
      cur = { title: `${label}${head ? ': ' + head.replace(/[\s.…]+\d*$/, '').slice(0, 120) : ''}`, lines: [] };
      continue;
    }
    if (cur) cur.lines.push(l);
  }
  close();
  if (parts) {
    const maxR = Math.max(0, ...out.map(x => x.r));
    return out.filter(x => maxR - x.r < parts.length).map(x => ({ section: `${parts[parts.length - 1 - (maxR - x.r)]}, ${x.title}`, refs: x.refs, text: x.text }));
  }
  return out.map(({ r, title, ...x }) => x);
};
const roman = t => { const V = { I: 1, V: 5, X: 10, L: 50, C: 100 }; let n = 0; t = t.toUpperCase(); for (let i = 0; i < t.length; i++) { const a = V[t[i]], b = V[t[i + 1]] || 0; if (!a) return 0; n += a < b ? -a : a; } return n; };
const titleCase = s => upRoman(s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Of|The|And|In|To)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase()));
const upRoman = t => t.replace(/\b([ivxl]{1,6})\b/gi, m => (/^(?=[ivxl])m{0,0}(x{0,3})(ix|iv|v?i{0,3})$/i.test(m) || /^(xl|l?x{0,3})(ix|iv|v?i{0,3})$/i.test(m) ? m.toUpperCase() : m));
