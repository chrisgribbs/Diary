'use strict';
/**
 * Alexander Maclaren, Expositions of Holy Scripture (Project Gutenberg's typed editions). Each exposition is a title
 * in capitals, the passage quoted (indented), the quote ending with its reference ("…made.'--GENESIS i. 26-ii. 3."),
 * then the sermon. A title with no reference before the next title is a heading over a group of sermons, or a line
 * of the contents, and is skipped. The reference tags the sermon; a long quoted passage is left out (the app has the
 * Bible text), a short one is kept as the sermon's text.
 */
const refs = require('../../../src/study/refs');
const { stripGutenberg, unwrap } = require('./common');

const TITLE = /^[A-Z0-9'‘’“"][A-Z0-9 ,'‘’“”";:!?.\-—()&]{2,90}$/;
const NOT_TITLE = /^(FOOTNOTES?:?|CONTENTS|EXPOSITIONS OF HOLY SCRIPTURE|[IVXLC]+\.?|THE END\.?)$/;
const ANCHOR = /[-—]{1,2}\s?((?:[1-3]|I{1,3})?\s?(?:ST\.\s)?[A-Za-z]{2,16}\.?\s[ivxlcIVXLC]{1,8}\.?\s?\d{1,3}[^']{0,40}?)\s*$/;

/** "GENESIS iii 10-20 (R. V.)." → a stored reference, reading only the first passage named. */
function anchorRef(s) {
  let t = s.replace(/\(?R\.\s?V\.\)?/g, '').replace(/,?\s*(and|&)\s.*$/, '').replace(/\.\s*$/, '').trim();
  t = t.replace(/\b([IVXLC]{1,8})(\.?\s?\d)/g, (m, r, rest) => r.toLowerCase() + rest);      // "XV. 1" → "xv. 1"
  t = t.replace(/^ST\.\s/, '').replace(/\b([ivxlc]+)\s(\d)/i, '$1. $2');                 // "iii 10" → "iii. 10"
  t = t.replace(/(\d)\.\s\d.*$/, '$1').replace(/(\d{1,3}(?:\s?-\s?(?:[ivxlc]+\.\s?)?\d{1,3})?)\s*[;:,].*$/i, '$1');
  return refs.parse(t);
}
// A line that is nothing but a reference ("    GENESIS v. 24." under the quote)
const BARE = /^\s*((?:[1-3]|I{1,3})?\s?(?:ST\.\s)?[A-Za-z]{2,16}\.?\s[ivxlcIVXLC]{1,8}\.?\s?\d{1,3}[^']{0,40}?)\s*$/;
const PART = /^\s*(II|III|IV|V|VI)\.?\s*$/;
const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'unto', 'with']);
const titleCase = t => t.toLowerCase().replace(/[a-z][a-z'’]*/g, (w, i) => (i > 0 && smallWords.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
  .replace(/\bi\b/g, 'I').replace(/^\W*[a-z]/, c => c.toUpperCase());

module.exports = function parse(raw) {
  const lines = stripGutenberg(raw).replace(/[\u00a0\u2002-\u200a]/g, ' ').split('\n');
  const titles = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (lines[i].length - lines[i].trimStart().length > 3) continue;              // quotes and poetry are indented
    if (!TITLE.test(l) || NOT_TITLE.test(l) || (l.match(/[A-Z]/g) || []).length < 4) continue;
    if (lines[i - 1].trim() !== '') continue;
    titles.push(i);
  }
  const out = [];
  let last = null;
  titles.forEach((t, k) => {
    const next = k + 1 < titles.length ? titles[k + 1] : lines.length;
    let a = -1, r = null;
    // A second (or third) sermon on the passage just expounded: "TITLE", then "II", then straight into the sermon.
    const first = lines.slice(t + 1, Math.min(next, t + 6)).findIndex(l => l.trim());
    if (first >= 0 && PART.test(lines[t + 1 + first]) && last) { a = t + 1 + first; r = last; }
    for (let j = t + 1; a < 0 && j < Math.min(next, t + 140); j++) {
      const m = lines[j].match(ANCHOR);
      if (m && /--|—/.test(lines[j]) && (r = anchorRef(m[1]))) { a = j; break; }
      // the reference wrapped onto the next line: "…glorified.'--JOHN" / "xv. 5-8."
      if (/(?:--|—)\s?(?:[1-3I]{1,3}\s)?(?:ST\.\s)?[A-Za-z.]{2,16}$/.test(lines[j].trimEnd()) && j + 1 < next) {
        const w = (lines[j].trimEnd() + ' ' + lines[j + 1].trim()).match(ANCHOR);
        if (w && (r = anchorRef(w[1]))) { a = j + 1; break; }
      }
      const b = lines[j].match(BARE);
      if (b && lines[j].trim().length < 60 && /^\s{2,}/.test(lines[j]) && (r = anchorRef(b[1]))) { a = j; break; }
    }
    if (a < 0) return;
    last = r;
    const quote = unwrap(lines.slice(t + 1, a + 1).join('\n').replace(/\s*[-—]{1,2}\s?[^-—]*$/, '')).replace(/\s+/g, ' ').trim();
    const body = unwrap(lines.slice(a + 1, next).join('\n').replace(/\n\s*FOOTNOTES?:[\s\S]*$/, '')).replace(/_([^_\n]+)_/g, '$1');
    if (body.length < 600) return;
    const title = titleCase(lines[t].trim().replace(/[.,]$/, ''));
    out.push({ section: `${title} (${refs.label(r)})`, refs: [r], text: (quote.length && quote.length < 500 ? quote + '\n\n' : '') + body, key: `${title}|${refs.label(r)}` });
  });
  return out;
};
module.exports.dedupe = true;
module.exports.anchorRef = anchorRef;
module.exports.titleCase = titleCase;
