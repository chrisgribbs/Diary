'use strict';
/**
 * The Bible study library: public-domain commentaries and spiritual classics, searched on this device.
 *
 * It comes in packs (built by scripts/library, attached to the GitHub release "library-v1"), downloaded when you
 * first use Bible study and kept in <device folder>/library. They are public texts, so they're not encrypted, not
 * synced and not in backups; your own studies, highlights and journal stay in the encrypted journal.
 *
 * A pack is a folder:
 *   manifest.json  { id, name, version, about, embed: { model, dims } | null, sources: { srcId: { author, work, year, licence, credit, url, caveat } } }
 *   meta.json      one row per passage: [srcId, category, refs, offset, length, section, url]
 *   text.bin       every passage's words, one after another (read only when needed, so phones don't hold it all)
 *   keys.json      { n, terms: { term: [passage numbers] } }  each passage's most telling words, for keyword search
 *   vectors.bin    (if built with embeddings) one 8-bit vector per passage, for searching by meaning
 *
 * Built in, with no download: the 147 classics of Christian formation already in WellWrite (src/readings/classics.json).
 */
const { deaccent } = require('./text');   // not normalize(): the Android engine has no Unicode tables
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const refs = require('./refs');

const RELEASE = 'https://github.com/chrisgribbs/Diary/releases/download/library-v1';
const PACK_RE = /^[a-z][a-z0-9-]{1,30}$/;
const CATEGORIES = ['scripture', 'devotional', 'exposition', 'illustration', 'history', 'greek', 'hebrew', 'contemplative'];

// ---- words, the same here and in the builder
const STOP = new Set(('the and that his for with was not but him they this from have which shall all are you thou thee thy said unto them were their one there what when who will would been has had into out upon also our your more than then its may can these those such very even only any some other most own same should could did does being made make like well how where why whom whose here now yet ever never every each both few much many must might let things thing said say says says it’s ' +
  'shall hath doth thus therefore wherefore because though although while whereas since until before after above below under over again further once').split(/\s+/));
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
/** Words worth searching on: lower case, no accents, no common little words, plain stems. */
function tokenize(text) {
  return deaccent(text).toLowerCase()
    .split(/[^a-z]+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem);
}

class Pack {
  constructor(dir) {
    this.dir = dir;
    this.manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    this.id = this.manifest.id;
    this._meta = null; this._keys = null; this._vec = null; this._fd = null;
  }
  get meta() { return this._meta || (this._meta = JSON.parse(fs.readFileSync(path.join(this.dir, 'meta.json'), 'utf8'))); }
  get keys() { return this._keys || (this._keys = JSON.parse(fs.readFileSync(path.join(this.dir, 'keys.json'), 'utf8'))); }
  get vectors() {
    if (this._vec === null) {
      const f = path.join(this.dir, 'vectors.bin');
      const e = this.manifest.embed;
      if (!e || !fs.existsSync(f)) this._vec = false;
      else { const b = fs.readFileSync(f); this._vec = new Int8Array(b.buffer, b.byteOffset, b.length); }
    }
    return this._vec || null;
  }
  text(i) {
    const row = this.meta[i];
    if (!row) return '';
    if (this._fd === null) this._fd = fs.openSync(path.join(this.dir, 'text.bin'), 'r');
    const buf = Buffer.alloc(row[4]);
    fs.readSync(this._fd, buf, 0, row[4], row[3]);
    return buf.toString('utf8');
  }
  close() { if (this._fd !== null) { try { fs.closeSync(this._fd); } catch {} this._fd = null; } }
}

/** The classics already built into WellWrite, as a small library pack held in memory. */
class BuiltinClassics {
  constructor(file) {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.id = 'classics';
    this.items = (p.items || []).filter(it => it.text && it.author);
    this.manifest = { id: 'classics', name: 'Classics of Christian formation', version: p.version || 1, builtin: true, embed: null, sources: {} };
    this.rows = this.items.map(it => {
      const work = String(it.source || '').replace(/\s*\(.*$/, '') || it.author;
      const srcId = 'classic-' + crypto.createHash('sha1').update(it.author + '|' + work).digest('hex').slice(0, 8);
      if (!this.manifest.sources[srcId]) this.manifest.sources[srcId] = { author: it.author, work, year: 0, licence: 'public-domain', credit: it.source || '', url: '', caveat: '' };
      return [srcId, 'contemplative', [], 0, 0, (it.themes || []).join(', '), ''];
    });
    const terms = {};
    this.items.forEach((it, i) => { for (const t of new Set(tokenize(it.text + ' ' + (it.themes || []).join(' ')))) (terms[t] = terms[t] || []).push(i); });
    this.keyIndex = { n: this.items.length, terms };
  }
  get meta() { return this.rows; }
  get keys() { return this.keyIndex; }
  get vectors() { return null; }
  text(i) { return this.items[i] ? this.items[i].text : ''; }
  close() {}
}

class Library {
  /** dir: where packs live; fetch: for downloading; builtinFile: the classics; release: (tests) another address */
  constructor({ dir, fetch, builtinFile, release = RELEASE }) {
    Object.assign(this, { dir, fetchImpl: fetch, release: release.replace(/\/+$/, '') });
    this.builtin = builtinFile && fs.existsSync(builtinFile) ? new BuiltinClassics(builtinFile) : null;
    this._packs = null;
    this.downloading = null;
  }

  packs() {
    if (!this._packs) {
      this._packs = new Map();
      if (this.builtin) this._packs.set(this.builtin.id, this.builtin);
      let names = [];
      try { names = fs.readdirSync(this.dir); } catch {}
      for (const n of names.sort()) {
        if (!PACK_RE.test(n) || n === 'classics') continue;
        try { this._packs.set(n, new Pack(path.join(this.dir, n))); } catch {}   // a broken or half-written pack is skipped
      }
    }
    return [...this._packs.values()];
  }
  reload() { for (const p of this._packs ? this._packs.values() : []) p.close(); this._packs = null; }
  installed() {
    return this.packs().map(p => ({ id: p.id, name: p.manifest.name, version: p.manifest.version, builtin: !!p.manifest.builtin,
      passages: p.meta.length, vectors: !!(p.manifest.embed && !p.manifest.builtin), about: p.manifest.about || '' }));
  }
  /** Is there more than the built-in classics? */
  hasPacks() { return this.packs().some(p => !p.manifest.builtin); }

  /** One passage, ready to show or send: { id, pack, author, work, year, section, category, refs, text, licence, credit, url, caveat }. */
  passage(packId, i) {
    const p = (this.packs(), this._packs.get(packId));
    if (!p || !p.meta[i]) return null;
    const [srcId, cat, rs, , , section, url] = p.meta[i];
    const s = p.manifest.sources[srcId] || {};
    return { id: `${packId}:${i}`, pack: packId, src: srcId, author: s.author || '', work: s.work || '', year: s.year || 0, section: section || '',
      category: cat, refs: rs || [], text: p.text(i), licence: s.licence || '', credit: s.credit || '', url: url || s.url || '', caveat: s.caveat || '' };
  }
  byId(id) { const m = /^([a-z][a-z0-9-]*):(\d+)$/.exec(String(id)); return m ? this.passage(m[1], +m[2]) : null; }

  /** Passages tagged with verses in the passage being studied, closest first. */
  byRef(passage, limit = 60) {
    const out = [];
    for (const p of this.packs()) {
      p.meta.forEach((row, i) => {
        let best = 0;
        for (const r of row[2] || []) best = Math.max(best, refs.closeness(r, passage));
        if (best > 0) out.push({ pack: p.id, i, score: best, src: row[0], cat: row[1] });
      });
    }
    // A long text cut into many passages mustn't crowd out the others: at most 8 from any one work.
    out.sort((a, b) => b.score - a.score || a.i - b.i);
    const per = new Map();
    return out.filter(h => { const k = h.pack + h.src; const n = per.get(k) || 0; per.set(k, n + 1); return n < 8; }).slice(0, limit);
  }

  /** Passages sharing the most telling words with the query (each word weighted by how rare it is). */
  byWords(text, limit = 60) {
    const q = [...new Set(tokenize(text))];
    if (!q.length) return [];
    const out = [];
    for (const p of this.packs()) {
      const { n, terms } = p.keys;
      const scores = new Map(), hits = new Map();
      for (const t of q) {
        const list = terms[t];
        if (!list || !list.length) continue;
        const idf = Math.log(1 + n / list.length);
        for (const i of list) { scores.set(i, (scores.get(i) || 0) + idf); hits.set(i, (hits.get(i) || 0) + 1); }
      }
      for (const [i, s] of scores) out.push({ pack: p.id, i, score: s, hits: hits.get(i), src: p.meta[i][0], cat: p.meta[i][1] });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** The embedding model the packs were built with (all packs with vectors use the same one), or ''. */
  embedModel() {
    const p = this.packs().find(x => x.manifest.embed && x.vectors);
    return p ? p.manifest.embed : null;
  }
  /** Passages closest in meaning to a query vector (cosine). */
  byVector(vec, limit = 60) {
    const out = [];
    const q = Float32Array.from(vec);
    let qn = 0; for (const x of q) qn += x * x; qn = Math.sqrt(qn) || 1;
    for (const p of this.packs()) {
      const e = p.manifest.embed, v = p.vectors;
      if (!e || !v || e.dims !== q.length) continue;
      const dims = e.dims, count = v.length / dims;
      for (let i = 0; i < count; i++) {
        let dot = 0;
        for (let d = 0, o = i * dims; d < dims; d++) dot += v[o + d] * q[d];
        out.push({ pack: p.id, i, score: dot / (127 * qn), src: p.meta[i][0], cat: p.meta[i][1] });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ---------- downloading packs ----------
  /** What the release offers: { version, packs: [{ id, name, about, size, files: [{ name, size, sha256 }] }] } */
  async available() {
    const res = await this.fetchImpl(this.release + '/library.json', { headers: { 'User-Agent': 'WellWrite' } }).catch(() => null);
    if (!res || !res.ok) throw new Error('Couldn’t reach the Bible study library. Check your connection and try again.');
    const j = await res.json();
    const have = new Map(this.installed().map(p => [p.id, p.version]));
    return { version: j.version, packs: (j.packs || []).filter(p => PACK_RE.test(p.id || '')).map(p => ({ ...p, installed: have.has(p.id), current: have.get(p.id) === p.version })) };
  }

  /**
   * Download one pack: each file .gz, checked against its SHA-256, unpacked into a new folder that replaces the old
   * one only when everything has arrived. onProgress(doneBytes, totalBytes).
   */
  async download(packId, onProgress = () => {}) {
    if (!PACK_RE.test(packId)) throw new Error('Unknown pack');
    if (this.downloading) throw new Error('A download is already running');
    const offer = (await this.available()).packs.find(p => p.id === packId);
    if (!offer) throw new Error('That pack isn’t in the library');
    const total = offer.files.reduce((n, f) => n + (f.size || 0), 0);
    const tmp = path.join(this.dir, `.${packId}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    this.downloading = packId;
    let done = 0;
    try {
      for (const f of offer.files) {
        if (!/^[a-z]+\.(json|bin)$/.test(f.name)) throw new Error('Unexpected file in pack');
        const res = await this.fetchImpl(`${this.release}/${packId}-${f.name}.gz`, { headers: { 'User-Agent': 'WellWrite' } }).catch(() => null);
        if (!res || !res.ok || !res.body) throw new Error('The download stopped. Check your connection and try again.');
        const hash = crypto.createHash('sha256');
        const gzFile = path.join(tmp, f.name + '.gz');
        const out = fs.createWriteStream(gzFile);
        const reader = res.body.getReader ? res.body.getReader() : null;
        if (reader) {
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            hash.update(value); done += value.length; onProgress(done, total);
            if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
          }
        } else {
          const b = Buffer.from(await res.arrayBuffer()); hash.update(b); done += b.length; onProgress(done, total); out.write(b);
        }
        await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
        if (f.sha256 && hash.digest('hex') !== f.sha256) throw new Error('A library file arrived damaged. Try again.');
        await pipeline(fs.createReadStream(gzFile), zlib.createGunzip(), fs.createWriteStream(path.join(tmp, f.name)));
        fs.unlinkSync(gzFile);
      }
      const m = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
      if (m.id !== packId) throw new Error('The pack didn’t match what was expected');
      this.reload();
      const dest = path.join(this.dir, packId);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(tmp, dest);
      return this.installed().find(p => p.id === packId);
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    } finally {
      this.downloading = null;
      this.reload();
    }
  }

  remove(packId) {
    if (!PACK_RE.test(packId) || packId === 'classics') return false;
    this.reload();
    fs.rmSync(path.join(this.dir, packId), { recursive: true, force: true });
    return true;
  }
}

module.exports = { Library, tokenize, CATEGORIES, RELEASE, PACK_RE };
