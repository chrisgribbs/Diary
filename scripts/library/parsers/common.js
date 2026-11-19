'use strict';
/**
 * Helpers shared by the source parsers: clean a Gutenberg or archive.org text, and split a book into sections
 * under headings, tagging each with the verses its heading names.
 */
const refs = require('../../../src/study/refs');

/** The book itself, without Project Gutenberg's licence header and footer. */
function stripGutenberg(t) {
  t = String(t).replace(/\r/g, '');
  const a = t.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  if (a >= 0) t = t.slice(t.indexOf('\n', a) + 1);
  const b = t.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (b >= 0) t = t.slice(0, b);
  return t;
}

/** OCR clean-up for archive.org text: page numbers, running heads, broken hyphenation, stray marks. */
function cleanOcr(t) {
  return String(t).replace(/\r/g, '')
    .replace(/^.*Digitized by (?:Google|the Internet Archive|tine Internet|Microsoft).*$/gim, '')
    .replace(/^\s*\d{1,4}\s*$/gm, '')                       // page numbers on their own line
    .replace(/^[A-Z .,'’;:-]{4,60}\s+\d{1,4}\s*$/gm, '')    // running heads with page numbers
    .replace(/^\s*\d{1,4}\s+[A-Z .,'’;:-]{4,60}$/gm, '')
    .replace(/(\w)-\n(\w)/g, '$1$2')                        // words broken across lines
    .replace(/[ \t]+\n/g, '\n')
    .replace(/([^\n])\n(?!\n)/g, '$1 ')                     // lines of a paragraph joined
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

/** Paragraphs joined back from hard-wrapped lines (Gutenberg wraps at 70 characters). */
const unwrap = t => String(t).replace(/[ \t]+\n/g, '\n').replace(/([^\n])\n(?!\n)/g, '$1 ').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Split text at heading lines. isHeading(line, next) decides; each section gets the heading text and the verses
 * the heading (or, failing that, its first lines) names.
 */
function sectionsByHeadings(text, isHeading, { refFrom = 'heading', book = null } = {}) {
  const lines = String(text).split('\n');
  const out = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    const body = unwrap(cur.lines.join('\n'));
    if (body.length > 80) {
      let r = refsIn(cur.heading, book);
      if (!r.length && refFrom !== 'heading-only') r = refsIn(body.slice(0, 300), book).slice(0, 1);
      out.push({ section: tidy(cur.heading), refs: r, text: body });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isHeading(l.trim(), (lines[i + 1] || '').trim(), lines[i - 1] === undefined ? '' : lines[i - 1].trim())) { close(); cur = { heading: l.trim(), lines: [] }; }
    else if (cur) cur.lines.push(l);
  }
  close();
  return out;
}
const tidy = h => String(h).replace(/\s+/g, ' ').replace(/^[\s.—-]+|[\s.—-]+$/g, '').slice(0, 160);

/** Verses named in a short piece of text: full references, or (with a book known) bare "xi. 28" / "11:28". */
function refsIn(text, book = null) {
  const found = refs.findIn(text);
  if (found.length || book == null) return found;
  const m = String(text).match(/\b((?:\d{1,3}|[ivxlc]{1,8}))[.:]\s?(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?/i);
  if (!m) return [];
  const r = refs.parse(`${require('../../../src/bible-books').BOOKS[book].name} ${m[1]}:${m[2]}${m[3] ? '-' + m[3] : ''}`);
  return r ? [r] : [];
}

module.exports = { stripGutenberg, cleanOcr, unwrap, sectionsByHeadings, refsIn, tidy };

/** Files in a .zip (stored or deflated), as { name: Buffer }. Enough for CrossWire modules; no library needed. */
function unzip(buf) {
  const zlib = require('zlib');
  const out = {};
  // The central directory lists every file with its sizes (local headers may leave them out).
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lstart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(lstart, lstart + csize);
    if (!name.endsWith('/')) out[name] = method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
module.exports.unzip = unzip;

/** OSIS/ThML markup to plain text: Greek kept, catch-words in bold, notes and tags dropped. */
function osisText(s) {
  return String(s)
    .replace(/<note\b[\s\S]*?<\/note>/g, '')
    .replace(/<catchWord>([\s\S]*?)<\/catchWord>/g, '**$1**')
    .replace(/<div[^>]*type="paragraph"[^>]*\/>/g, '\n\n')
    .replace(/<lb\s*\/?>/g, '\n')
    .replace(/<title>([\s\S]*?)<\/title>/g, '\n\n$1\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
module.exports.osisText = osisText;
