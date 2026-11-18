'use strict';
/**
 * Turn a source's sections into library passages and write a pack (see src/study/library.js for the format).
 *
 *   chunk(sections)          sections [{ section, refs, text, url }] → passages of about 400–800 tokens
 *   writePack(dir, {...})    passages + sources → manifest.json, meta.json, text.bin, keys.json (+ vectors.bin)
 *
 * Tokens are counted roughly as characters ÷ 4, which is close enough for English prose.
 */
const fs = require('fs');
const path = require('path');
const { tokenize } = require('../../src/study/library');

const TOK = s => Math.ceil(String(s).length / 4);
const MIN = 400, MAX = 800, OVERLAP = 60;

/**
 * Split each section into passages. A section that fits (≤ 800 tokens) stays whole; a longer one is cut at paragraph
 * ends into passages of 400–800 tokens, each starting with the last ~60 tokens of the one before so no thought is cut
 * in half. Very short sections next to each other on the same verses are joined.
 */
function chunk(sections) {
  const out = [];
  for (const s of sections) {
    const text = String(s.text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) continue;
    if (TOK(text) <= MAX) { out.push({ ...s, text }); continue; }
    const paras = text.split(/\n\n+/).flatMap(p => (TOK(p) > MAX ? splitSentences(p) : [p]));
    let cur = [];
    const flush = () => { if (cur.length) out.push({ ...s, text: cur.join('\n\n') }); };
    for (const p of paras) {
      const size = TOK(cur.join('\n\n')) + TOK(p);
      if (cur.length && size > MAX && TOK(cur.join('\n\n')) >= MIN) {
        flush();
        const tail = tailOf(cur.join('\n\n'));
        cur = tail ? [tail] : [];
      }
      cur.push(p);
    }
    flush();
  }
  // join neighbours that are tiny and about the same verses
  const joined = [];
  for (const c of out) {
    const prev = joined[joined.length - 1];
    if (prev && TOK(prev.text) < 120 && TOK(prev.text) + TOK(c.text) <= MAX && prev.src === c.src && JSON.stringify(prev.refs) === JSON.stringify(c.refs)) {
      prev.text += '\n\n' + c.text;
    } else joined.push({ ...c });
  }
  return joined;
}
function splitSentences(p) {
  const parts = p.match(/[^.!?]+[.!?]+["’”)]*\s*|[^.!?]+$/g) || [p];
  const out = []; let cur = '';
  for (const s of parts) { if (TOK(cur + s) > MAX && cur) { out.push(cur.trim()); cur = ''; } cur += s; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function tailOf(text) {
  const want = OVERLAP * 4;
  if (text.length <= want) return '';
  const cut = text.slice(-want);
  const start = cut.search(/[.!?]["’”)]?\s+[A-Z“"‘(]/);
  return start >= 0 ? '… ' + cut.slice(start + 1).trim() : '';
}

/** Each passage's most telling words (tf-idf), up to 40, as an index from word to passages. */
function keysFor(texts, extra = []) {
  const docs = texts.map((t, i) => tokenize(t + ' ' + (extra[i] || '')));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const n = docs.length, terms = {};
  docs.forEach((d, i) => {
    const tf = new Map();
    for (const w of d) tf.set(w, (tf.get(w) || 0) + 1);
    const best = [...tf].filter(([w]) => df.get(w) < n * 0.5 || n < 20)
      .map(([w, c]) => [w, (1 + Math.log(c)) * Math.log(1 + n / df.get(w))])
      .sort((a, b) => b[1] - a[1]).slice(0, 40);
    for (const [w] of best) (terms[w] = terms[w] || []).push(i);
  });
  return { n, terms };
}

/** 8-bit vectors: each normalised to length 1, then scaled to −127…127. */
function quantize(vectors, dims) {
  const out = new Int8Array(vectors.length * dims);
  vectors.forEach((v, i) => {
    let len = 0; for (let d = 0; d < dims; d++) len += v[d] * v[d];
    len = Math.sqrt(len) || 1;
    for (let d = 0; d < dims; d++) out[i * dims + d] = Math.max(-127, Math.min(127, Math.round((v[d] / len) * 127)));
  });
  return out;
}

/**
 * Write a pack folder.
 * passages: [{ src, cat, refs, section, text, url }]; sources: { srcId: { author, work, year, licence, credit, url, caveat } }
 * embed: optional async (texts[]) → vectors[], with { model, dims }
 */
async function writePack(dir, { id, name, about = '', version = 1, passages, sources, embed = null, embedInfo = null, onProgress = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  for (const p of passages) {
    if (!sources[p.src]) throw new Error(`Passage from unknown source ${p.src}`);
    if (!sources[p.src].licence) throw new Error(`Source ${p.src} has no licence`);
  }
  const bufs = []; let offset = 0;
  const meta = passages.map(p => {
    const b = Buffer.from(p.text, 'utf8');
    const row = [p.src, p.cat, p.refs || [], offset, b.length, p.section || '', p.url || ''];
    bufs.push(b); offset += b.length;
    return row;
  });
  fs.writeFileSync(path.join(dir, 'text.bin'), Buffer.concat(bufs));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify(keysFor(passages.map(p => p.text), passages.map(p => p.section))));
  let embedMeta = null;
  if (embed && embedInfo) {
    const vecs = [];
    const BATCH = 64;
    for (let i = 0; i < passages.length; i += BATCH) {
      const got = await embed(passages.slice(i, i + BATCH).map(p => `${sources[p.src].author}, ${sources[p.src].work}. ${p.section}\n${p.text}`));
      vecs.push(...got);
      onProgress(Math.min(i + BATCH, passages.length), passages.length);
    }
    const dims = vecs[0] ? vecs[0].length : 0;
    fs.writeFileSync(path.join(dir, 'vectors.bin'), Buffer.from(quantize(vecs, dims).buffer));
    embedMeta = { model: embedInfo.model, dims };
  }
  const manifest = { id, name, about, version, built: new Date().toISOString().slice(0, 10), embed: embedMeta, count: passages.length, sources };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

module.exports = { chunk, writePack, keysFor, quantize, TOK };
