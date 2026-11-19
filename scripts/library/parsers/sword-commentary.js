'use strict';
/**
 * A CrossWire SWORD commentary module (zCom, OSIS markup), e.g. Robertson's Word Pictures (RWP).
 * Each verse's note says which verse it's on (annotateRef). Neighbouring notes in a chapter are gathered into
 * sections of up to about 500 tokens, tagged with the verses they cover. Book introductions are kept, tagged
 * with the whole book's first chapter.
 *
 * source.books: the books to keep, as indexes 0–65 (Robertson: only the public-domain volumes 1–4).
 */
const zlib = require('zlib');
const { unzip, osisText } = require('./common');

const OSIS = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov',
  'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas',
  '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'];
const NAME = require('../../../src/bible-books').BOOKS.map(b => b.name);

module.exports = function parse(buf, { source }) {
  const files = unzip(Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'binary'));
  const pick = ext => { const k = Object.keys(files).find(n => n.endsWith(ext)); if (!k) throw new Error('missing ' + ext); return files[k]; };
  const out = [];
  for (const t of ['ot', 'nt']) {
    const k = Object.keys(files).find(n => n.endsWith(`/${t}.czs`));
    if (!k) continue;
    const bzs = pick(`/${t}.czs`), bzv = pick(`/${t}.czv`), bzz = pick(`/${t}.czz`);
    const cache = new Map();
    const block = n => { if (!cache.has(n)) { const o = bzs.readUInt32LE(n * 12), sz = bzs.readUInt32LE(n * 12 + 4); cache.set(n, zlib.inflateSync(bzz.subarray(o, o + sz))); } return cache.get(n); };
    const entry = i => { const b = bzv.readUInt32LE(i * 10), o = bzv.readUInt32LE(i * 10 + 4), s = bzv.readUInt16LE(i * 10 + 8); return s ? block(b).subarray(o, o + s).toString('utf8') : ''; };
    let group = null, intro = null;
    const flush = () => {
      if (group && group.text.trim()) out.push({ section: `${NAME[group.b]} ${group.c}:${group.v1}${group.v2 > group.v1 ? '–' + group.v2 : ''}`, refs: [[group.b, group.c, group.v1, group.c, group.v2]], text: group.text.trim() });
      group = null;
    };
    for (let i = 0; i < bzv.length / 10; i++) {
      const raw = entry(i);
      if (!raw) continue;
      const book = raw.match(/<div osisID="([1-3A-Za-z]+)"[^>]*type="book"/);
      if (book) {
        flush();
        if (intro && intro.text.trim()) out.push(intro);
        const b = OSIS.indexOf(book[1]);
        intro = source.books.includes(b) ? { section: `${NAME[b]}: introduction`, refs: [[b, 1, 0, 1, 0]], text: osisText(raw) } : null;
        continue;
      }
      const ref = raw.match(/annotateRef="([1-3A-Za-z]+)\.(\d+)\.(\d+)"/);
      if (!ref) { if (intro && !/<chapter/.test(raw)) intro.text += '\n\n' + osisText(raw); continue; }
      if (intro) { if (intro.text.trim()) out.push(intro); intro = null; }
      const b = OSIS.indexOf(ref[1]), c = +ref[2], v = +ref[3];
      if (!source.books.includes(b)) { flush(); continue; }
      const text = osisText(raw);
      if (!text) continue;
      if (group && (group.b !== b || group.c !== c || (group.text.length + text.length) / 4 > 500)) flush();
      if (!group) group = { b, c, v1: v, v2: v, text: '' };
      group.v2 = v;
      group.text += (group.text ? '\n\n' : '') + `${v}. ` + text;
    }
    flush();
    if (intro && intro.text.trim()) out.push(intro);
  }
  return out;
};
module.exports.binary = true;
