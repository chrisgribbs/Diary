'use strict';
// Bible versions from API.Bible (https://api.bible), with the person's own API key.
// The key is kept encrypted on this computer (Windows DPAPI via safeStorage) and never leaves it except to API.Bible.
// Bible text is held in memory for the session only, and each passage shown is reported to API.Bible's
// fair-use system (FUMS), as their terms ask.
const fs = require('fs');
const crypto = require('crypto');
const { BOOKS } = require('./bible-books');

const BASE = 'https://rest.api.bible/v1';
const FUMS = 'https://fums.api.bible/f3';
// USFM book codes, in the same order as BOOKS.
const CODES = ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL ' +
  'MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV').split(' ');
const ID_RE = /^[A-Za-z0-9-]{4,64}$/;

/** "Psalms 130:5-6" → { book, chapter, from, to, passageId: "PSA.130.5-PSA.130.6" } */
function parseRef(ref) {
  const m = String(ref).match(/^(.+) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const b = BOOKS.findIndex(x => x.name === m[1]);
  if (b < 0) return null;
  const c = +m[2], from = +m[3], to = +(m[4] || m[3]);
  return { book: b, chapter: c, from, to, passageId: `${CODES[b]}.${c}.${from}-${CODES[b]}.${c}.${to}` };
}

/**
 * API.Bible's JSON content → WellWrite's blocks: ['h', heading] | ['p', [[verse, text]…]] | ['q', [[verse, line]…]].
 * Paragraph styles: s*, ms*, mr, d, r, sp are headings; q*, qc, qr, qm*, qa are poetry (one line per paragraph);
 * everything else is prose. Notes and verse-number markers are skipped.
 */
function toBlocks(content) {
  const blocks = [];
  const textOf = (node, out, verse) => {
    if (!node) return verse;
    if (Array.isArray(node)) { for (const n of node) verse = textOf(n, out, verse); return verse; }
    if (node.type === 'text') {
      const vid = node.attrs && node.attrs.verseId;
      const v = vid ? +String(vid).split('.')[2] || verse : verse;
      const t = String(node.text || '');
      if (!t.trim()) return v;
      const last = out[out.length - 1];
      if (last && last[0] === v) last[1] += t; else out.push([v, t]);
      return v;
    }
    if (node.name === 'note' || node.name === 'verse' || (node.attrs && /^(f|x|fe)$/.test(node.attrs.style || ''))) return verse;
    return textOf(node.items, out, verse);
  };
  let verse = 0;
  for (const para of Array.isArray(content) ? content : []) {
    const style = (para.attrs && para.attrs.style) || 'p';
    const parts = [];
    verse = textOf(para.items, parts, verse);
    const clean = parts.map(([v, t]) => [v, t.replace(/\s+/g, ' ').trim()]).filter(([, t]) => t);
    if (!clean.length) continue;
    if (/^(s\d?|ms\d?|mr|d|r|sp|mt\d?)$/.test(style)) blocks.push(['h', clean.map(x => x[1]).join(' ')]);
    else if (/^(q\d?|qc|qr|qm\d?|qa)$/.test(style)) {
      const last = blocks[blocks.length - 1];
      const line = [clean[0][0], clean.map(x => x[1]).join(' ')];
      if (last && last[0] === 'q') last[1].push(line); else blocks.push(['q', [line]]);
    } else blocks.push(['p', clean]);
  }
  return blocks;
}

/** Blocks for a passage → one string: prose joined with spaces, poetry one line per line (like bible.verseText). */
function blocksToText(blocks) {
  let out = '';
  for (const b of blocks) {
    if (b[0] === 'h') continue;
    for (const [, t] of b[1]) out += out ? (b[0] === 'q' ? '\n' : ' ') + t : t;
  }
  return out;
}

class ApiBible {
  /**
   * file: where the (encrypted) key, chosen versions and device id live.
   * protect/unprotect: string encryption (safeStorage); fetch: (url, opts) → Response.
   */
  constructor({ file, protect, unprotect, fetch, available = () => true, base = BASE, fums = FUMS }) {
    Object.assign(this, { file, protect, unprotect, fetchImpl: fetch, available, base, fumsUrl: fums });
    this.cache = new Map();
    this.session = crypto.randomBytes(8).toString('hex');
  }
  _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  _write(d) { fs.writeFileSync(this.file, JSON.stringify(d, null, 2)); }
  _key() { const d = this._read(); if (!d.key) return null; try { return this.unprotect(d.key); } catch { return null; } }
  device() {
    const d = this._read();
    if (!d.device) { d.device = crypto.randomBytes(8).toString('hex'); this._write(d); }
    return d.device;
  }
  status() { const d = this._read(); return { connected: !!d.key, available: this.available(), versions: d.versions || [] }; }
  versions() { return this._read().versions || []; }

  async _get(path, key = this._key()) {
    if (!key) throw new Error('Add your API.Bible key in Settings first');
    const res = await this.fetchImpl(this.base + path, { headers: { 'api-key': key, accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error('API.Bible didn’t accept that key');
    if (res.status === 404) throw new Error('Not found in this Bible version');
    if (!res.ok) throw new Error('API.Bible error ' + res.status);
    return res.json();
  }
  _fums(meta) {
    const t = meta && meta.fumsToken;
    if (!t) return;
    const url = `${this.fumsUrl}?t=${encodeURIComponent(t)}&dId=${this.device()}&sId=${this.session}`;
    Promise.resolve().then(() => this.fetchImpl(url)).catch(() => {});   // best effort; never blocks reading
  }

  async setKey(key) {
    key = String(key || '').trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new Error('That doesn’t look like an API.Bible key');
    await this._get('/bibles?language=eng', key);   // check it works before keeping it
    if (!this.available()) throw new Error('This computer can’t store the key securely');
    const d = this._read(); d.key = this.protect(key); this._write(d);
    this.cache.clear();
    return this.status();
  }
  forget() { const d = this._read(); delete d.key; d.versions = []; this._write(d); this.cache.clear(); return this.status(); }

  /** Bibles your key can use, optionally in one language (ISO 639-3, e.g. "eng"). */
  async list(language = 'eng') {
    const k = 'list:' + language;
    if (!this.cache.has(k)) {
      const j = await this._get('/bibles' + (language ? `?language=${encodeURIComponent(language)}` : ''));
      this.cache.set(k, (j.data || []).map(b => ({
        id: b.id, name: (b.nameLocal || b.name || '').trim(), abbr: (b.abbreviationLocal || b.abbreviation || '').trim(),
        language: b.language && (b.language.nameLocal || b.language.name) || '', description: (b.descriptionLocal || b.description || '').trim(),
      })).filter(b => ID_RE.test(b.id || '')).sort((a, b) => a.name.localeCompare(b.name)));
    }
    return this.cache.get(k);
  }
  setVersions(list) {
    const d = this._read();
    d.versions = (Array.isArray(list) ? list : []).filter(v => v && ID_RE.test(v.id || '')).slice(0, 20)
      .map(v => ({ id: v.id, name: String(v.name || v.id).slice(0, 120), abbr: String(v.abbr || '').slice(0, 20) }));
    this._write(d);
    return this.status();
  }
  _ver(id) { return this.versions().find(v => v.id === id) || { id, name: id, abbr: id }; }

  /** A short passage like "Psalms 130:5-6" → { ref, text, translation, copyright } (shape of bible.verseText). */
  async passage(bibleId, ref) {
    if (!ID_RE.test(bibleId)) throw new Error('Unknown Bible version');
    const p = parseRef(ref);
    if (!p) return null;
    const k = `p:${bibleId}:${p.passageId}`;
    if (!this.cache.has(k)) {
      const j = await this._get(`/bibles/${bibleId}/passages/${p.passageId}?content-type=json&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=false&include-verse-spans=false&fums-version=3`);
      const text = blocksToText(toBlocks(j.data && j.data.content));
      this.cache.set(k, { text, copyright: cleanCopyright(j.data && j.data.copyright), meta: j.meta });
    }
    const c = this.cache.get(k);
    this._fums(c.meta);
    if (!c.text) return null;
    return { ref: ref.replace(/^Psalms /, 'Psalm '), text: c.text, translation: this._ver(bibleId).abbr || this._ver(bibleId).name, copyright: c.copyright };
  }

  /** One chapter as blocks, for reading plans. */
  async chapter(bibleId, bookIndex, chapter) {
    if (!ID_RE.test(bibleId)) throw new Error('Unknown Bible version');
    const id = `${CODES[bookIndex]}.${chapter}`;
    const k = `c:${bibleId}:${id}`;
    if (!this.cache.has(k)) {
      const j = await this._get(`/bibles/${bibleId}/chapters/${id}?content-type=json&include-notes=false&include-titles=true&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3`);
      this.cache.set(k, { blocks: toBlocks(j.data && j.data.content), copyright: cleanCopyright(j.data && j.data.copyright), meta: j.meta });
    }
    const c = this.cache.get(k);
    this._fums(c.meta);
    return c;
  }
}
const cleanCopyright = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 600);

module.exports = { ApiBible, parseRef, toBlocks, blocksToText, CODES };
