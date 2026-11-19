'use strict';
/**
 * James Hastings, The Great Texts of the Bible (scanned, 20 volumes). Each text is: a reading list ("LITERATURE."),
 * a title in capitals, then the verse quoted, its last line ending with the reference ("…rest.—Matt. xi. 28.").
 * The quote's closing line is the anchor; everything after it up to the next text's reading list or title is the
 * exposition. The same volume is often scanned more than once; build.js keeps the first copy of each text.
 */
const refs = require('../../../src/study/refs');
const { cleanOcr } = require('./common');

const ANCHOR = /[—–]\s?((?:St\.\s)?(?:[1-3]|I{1,3})?\s?[A-Z][a-z]{1,10}\.?\s[ivxlcIVXLy1l]{1,8}[.,]\s?\d{1,3}(?:\s?[-–]\s?\d{1,3})?)\.?\s*$/;
// A title: a short line in capitals, or in Title Case ("Spiritual Wrestling.").
const CAPS = /^[ \t]*([A-Z][A-Za-z ,'’;:!?.\-]{3,70})[ \t]*$/;
const titled = t => { const w = t.replace(/[^A-Za-z ]/g, '').split(' ').filter(x => x.length > 3); return w.length > 0 && w.filter(x => /^[A-Z]/.test(x)).length >= Math.ceil(w.length * 0.6); };
const fixRoman = s => s.replace(/\b([ivxlcy1l]{1,8})([.,])/g, (m, r, p) => r.replace(/y/g, 'v').replace(/[1l]/g, 'i') + p);

module.exports = function parse(raw) {
  const lines = String(raw).replace(/\r/g, '').replace(/[ \t]{2,}/g, ' ').split('\n');
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ANCHOR);
    if (!m) continue;
    const r = refs.parse(fixRoman(m[1].replace(/^St\.\s/, '')).replace(/\s+/g, ' '));
    if (!r) continue;
    // the title: the nearest line in capitals just above (not a numeral or the reading list)
    let t = -1;
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) { const c = lines[j].match(CAPS); if (c && titled(c[1]) && !/^LITERATURE|^[IVXL]+\.?$/.test(c[1].trim()) && !lines[j + 1 === i ? j : j].trim().endsWith(',')) { t = j; break; } }
    if (t < 0) continue;
    heads.push({ start: t, end: i + 1, title: lines[t].trim().replace(/\.$/, ''), quote: lines.slice(t + 1, i + 1).join(' ').replace(/\s+/g, ' ').trim(), ref: r });
  }
  const out = [];
  heads.forEach((h, k) => {
    let stop = k + 1 < heads.length ? heads[k + 1].start : lines.length;
    for (let j = h.end; j < stop; j++) if (/^\s*LITERATURE\.?\s*$/.test(lines[j])) { stop = j; break; }
    const body = cleanOcr(lines.slice(h.end, stop).join('\n')).trim();
    if (body.length < 800) return;
    const title = h.title.charAt(0) + h.title.slice(1).toLowerCase();
    out.push({ section: `${title} (${refs.label(h.ref)})`, refs: [h.ref], text: `${h.quote}\n\n${body}`, key: refs.label(h.ref) });
  });
  return out;
};
module.exports.dedupe = true;
