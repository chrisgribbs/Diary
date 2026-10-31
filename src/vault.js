'use strict';
/**
 * WellWrite vault — encrypted on-disk storage for journal entries.
 *
 * Design
 *  - A random 256-bit data key encrypts everything (AES-256-GCM).
 *  - The data key is "wrapped" (encrypted) with a key derived from the
 *    password using scrypt. Changing the password only re-wraps the key.
 *  - Each entry lives in its own encrypted file; a separate encrypted index
 *    holds titles, dates, tags and plain text for fast search.
 *  - Nothing readable ever touches the disk while the vault is in use.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAGIC = Buffer.from('DBK1');
// What a piece in the quote collection is: a quote ('') or a piece of the person's own writing.
const QUOTE_KINDS = ['', 'poem', 'psalm', 'prayer', 'blessing', 'reflection', 'fieldnote'];
const PICTURE_KEY_RE = /^[a-z]{2,20}-\d{1,2}$/;
const KDF = { N: 1 << 17, r: 8, p: 1, keyLen: 32 };
const MAXMEM = 512 * 1024 * 1024;
const ID_RE = /^[a-z0-9-]{8,64}$/;
const CAT_ID_RE = /^[a-z0-9-]{1,40}$/;
const LINK_RE = /href="wellwrite:entry\/([a-z0-9-]{8,64})"/g;
// Category colours (chosen to read on both the paper and the dark theme).
const CATEGORY_COLORS = ['#a23b56', '#2f7d7a', '#b7862c', '#4f6aa8', '#6b7d3a', '#7a4f8f', '#b0563a', '#6a7080'];

function deriveKey(password, salt, kdf = KDF) {
  return crypto.scryptSync(String(password).normalize('NFKC'), salt, kdf.keyLen || 32, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: MAXMEM,
  });
}

function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

function open(key, buf) {
  if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not a WellWrite file');
  const iv = buf.subarray(4, 16), tag = buf.subarray(16, 32), ct = buf.subarray(32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

function writeAtomic(file, data) {
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function wrapDataKey(password, dataKey) {
  const salt = crypto.randomBytes(16);
  const kek = deriveKey(password, salt);
  const wrapped = seal(kek, dataKey);
  kek.fill(0);
  return {
    version: 1,
    kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, keyLen: 32, salt: salt.toString('base64') },
    wrappedKey: wrapped.toString('base64'),
  };
}

function unwrapDataKey(password, vaultJson) {
  const k = vaultJson.kdf;
  const kek = deriveKey(password, Buffer.from(k.salt, 'base64'), k);
  try {
    return open(kek, Buffer.from(vaultJson.wrappedKey, 'base64'));
  } catch {
    return null; // wrong password (GCM auth failure)
  } finally {
    kek.fill(0);
  }
}

class Vault {
  constructor(dir) {
    this.dir = dir;
    this.entriesDir = path.join(dir, 'entries');
    this.vaultFile = path.join(dir, 'vault.json');
    this.indexFile = path.join(dir, 'index.enc');
    this.picturesDir = path.join(dir, 'pictures'); // a picture for each week of the year of themes
    this.metaFile = path.join(dir, 'meta.enc'); // categories (encrypted: names can be personal)
    this.key = null;
    this.index = null; // Map id -> meta
  }

  exists() { return fs.existsSync(this.vaultFile); }
  isUnlocked() { return !!this.key; }

  _requireKey() { if (!this.key) throw new Error('Journal is locked'); }

  create(password) {
    if (this.exists()) throw new Error('A journal already exists here');
    if (!password || String(password).length < 6) throw new Error('Use a password of at least 6 characters');
    fs.mkdirSync(this.entriesDir, { recursive: true });
    const dataKey = crypto.randomBytes(32);
    writeAtomic(this.vaultFile, JSON.stringify(wrapDataKey(password, dataKey), null, 2));
    this.key = dataKey;
    this.index = new Map();
    this._writeIndex();
  }

  unlock(password) {
    if (!this.exists()) throw new Error('No journal found');
    const key = unwrapDataKey(password, JSON.parse(fs.readFileSync(this.vaultFile, 'utf8')));
    if (!key) return false;
    this.key = key;
    this._loadIndex();
    return true;
  }

  /** Open with a key remembered by "Remember my password" (see trust.js). */
  unlockWithKey(key) {
    if (!this.exists()) throw new Error('No journal found');
    this.key = Buffer.from(key);
    this._loadIndex();
    return true;
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
    this.index = null;
  }

  changePassword(oldPw, newPw) {
    this._requireKey();
    if (!newPw || String(newPw).length < 6) throw new Error('Use a password of at least 6 characters');
    const check = unwrapDataKey(oldPw, JSON.parse(fs.readFileSync(this.vaultFile, 'utf8')));
    if (!check) throw new Error('Current password is incorrect');
    check.fill(0);
    writeAtomic(this.vaultFile, JSON.stringify(wrapDataKey(newPw, this.key), null, 2));
  }

  // ---------- index ----------
  _loadIndex() {
    this.index = new Map();
    if (fs.existsSync(this.indexFile)) {
      try {
        const list = JSON.parse(open(this.key, fs.readFileSync(this.indexFile)).toString('utf8'));
        for (const m of list) this.index.set(m.id, m);
      } catch { /* fall through to rebuild */ this.index = null; }
    }
    // Rebuild if index is missing, damaged, or out of step with entry files.
    const files = fs.existsSync(this.entriesDir)
      ? fs.readdirSync(this.entriesDir).filter(f => f.endsWith('.enc')).map(f => f.slice(0, -4))
      : [];
    // Rebuild if out of step with the entry files, or written before categories/links existed.
    if (!this.index || files.length !== this.index.size || files.some(id => !this.index.has(id)) || [...this.index.values()].some(m => !('links' in m))) {
      this._rebuildIndex(files);
    }
  }

  _rebuildIndex(ids) {
    this.index = new Map();
    for (const id of ids) {
      try { this.index.set(id, Vault.metaOf(this._readEntry(id))); } catch { /* skip unreadable */ }
    }
    this._writeIndex();
  }

  _writeIndex() {
    writeAtomic(this.indexFile, seal(this.key, Buffer.from(JSON.stringify([...this.index.values()]))));
  }

  static metaOf(e) {
    const text = String(e.text || '');
    return {
      id: e.id, date: e.date, time: e.time || '', title: e.title || '', tags: e.tags || [],
      category: e.category || '', links: Vault.linksIn(e.html, e.id),
      text, words: (text.match(/\S+/g) || []).length,
      images: (String(e.html || '').match(/<img\b/gi) || []).length,
      created: e.created, updated: e.updated,
    };
  }

  /** Ids of the entries an entry's text links to. */
  static linksIn(html, selfId) {
    const out = new Set();
    for (const m of String(html || '').matchAll(LINK_RE)) if (m[1] !== selfId) out.add(m[1]);
    return [...out];
  }

  // ---------- categories ----------
  getMeta() {
    this._requireKey();
    try { return JSON.parse(open(this.key, fs.readFileSync(this.metaFile)).toString('utf8')); }
    catch { return { categories: [] }; }
  }

  /**
   * Categories are a two-level tree: a category can have subcategories, but a
   * subcategory can't have its own. `parent` is '' for top-level categories.
   */
  static cleanCategories(list) {
    const seen = new Set();
    const out = (Array.isArray(list) ? list : []).filter(c => c && CAT_ID_RE.test(c.id) && !seen.has(c.id) && seen.add(c.id))
      .map(c => ({
        id: c.id,
        name: String(c.name || '').trim().slice(0, 40) || 'Untitled',
        color: CATEGORY_COLORS.includes(c.color) ? c.color : CATEGORY_COLORS[7],
        parent: CAT_ID_RE.test(c.parent || '') && c.parent !== c.id ? c.parent : '',
      }))
      .slice(0, 200);
    const byId = new Map(out.map(c => [c.id, c]));
    for (const c of out) {
      const p = byId.get(c.parent);
      if (!p || p.parent) c.parent = ''; // unknown parent, or parent is itself a subcategory
    }
    // A category that has subcategories can't also be a subcategory.
    for (const c of out) if (c.parent && out.some(x => x.parent === c.id)) c.parent = '';
    return out;
  }

  setCategories(list) {
    return this._writeMeta({ categories: Vault.cleanCategories(list) });
  }

  _writeMeta(patch) {
    this._requireKey();
    const meta = { categories: [], ...this.getMeta(), ...patch };
    writeAtomic(this.metaFile, seal(this.key, Buffer.from(JSON.stringify(meta))));
    return meta;
  }

  // ---------- quotes (for the daily quote) ----------
  static cleanQuotes(list) {
    const seen = new Set();
    const out = [];
    for (const q of Array.isArray(list) ? list : []) {
      if (!q) continue;
      const text = String(q.text || '').replace(/\r\n?/g, '\n').trim().slice(0, 3000);
      if (!text) continue;
      const author = String(q.author || '').trim().slice(0, 120);
      const key = (text + '|' + author).toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: /^[a-z0-9-]{1,40}$/.test(q.id || '') ? q.id : 'q-' + crypto.randomBytes(5).toString('hex'),
        text, author, source: String(q.source || '').trim().slice(0, 200), fav: !!q.fav,
        themes: Vault.cleanThemes(q.themes),
        kind: QUOTE_KINDS.includes(q.kind) ? q.kind : '',
        title: String(q.title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        mine: !!q.mine,
        pack: /^[a-z0-9]{1,20}$/.test(q.pack || '') ? q.pack : '',
      });
      if (out.length >= 5000) break;
    }
    return out;
  }

  /** Theme names: trimmed, first letter capitalised, no duplicates (ignoring case). */
  static cleanThemes(list) {
    const out = [];
    for (const t of Array.isArray(list) ? list : String(list || '').split(',')) {
      let v = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!v) continue;
      v = v[0].toUpperCase() + v.slice(1);
      if (!out.some(x => x.toLowerCase() === v.toLowerCase())) out.push(v);
      if (out.length >= 12) break;
    }
    return out;
  }

  /** Quotes, adding the starter set the first time. */
  getQuotes() {
    const meta = this.getMeta();
    if (!meta.quotesSeeded) {
      const { STARTER_QUOTES } = require('./quotes');
      return this._writeMeta({ quotes: Vault.cleanQuotes([...(meta.quotes || []), ...STARTER_QUOTES]), quotesSeeded: true, startersThemed: true }).quotes;
    }
    if (!meta.startersThemed) {
      // Journals started before themes existed: give the starter quotes their themes once.
      const { STARTER_QUOTES } = require('./quotes');
      const byText = new Map(STARTER_QUOTES.map(q => [q.text, q.themes]));
      const quotes = (meta.quotes || []).map(q => byText.has(q.text) && !(q.themes || []).length ? { ...q, themes: byText.get(q.text) } : q);
      return this._writeMeta({ quotes: Vault.cleanQuotes(quotes), startersThemed: true }).quotes;
    }
    return meta.quotes || [];
  }

  // ---------- Bible reading plan ----------
  static cleanBible(b) {
    b = b || {};
    const plans = ['year', 'ot-nt', 'nt90', 'gospels30', 'psalms60'];
    return {
      plan: plans.includes(b.plan) ? b.plan : '',
      translation: ['web', 'kjv'].includes(b.translation) ? b.translation : 'web',
      start: /^\d{4}-\d{2}-\d{2}$/.test(b.start || '') ? b.start : '',
      done: [...new Set((Array.isArray(b.done) ? b.done : []).filter(n => Number.isInteger(n) && n >= 0 && n < 400))].sort((x, y) => x - y),
    };
  }
  getBible() { return Vault.cleanBible(this.getMeta().bible); }
  setBible(b) { return this._writeMeta({ bible: Vault.cleanBible(b) }).bible; }

  // ---------- reading packs: sets of quotes kept in step with a source (built into the app, or a file) ----------
  /** Same text and writer → same key, ignoring punctuation, case and spacing. */
  static readingKey(text, author) {
    const n = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return crypto.createHash('sha1').update(n(text) + '|' + n(author)).digest('hex').slice(0, 16);
  }
  static readingHash(q) {
    return crypto.createHash('sha1').update(JSON.stringify([q.text, q.author, q.source, q.title, q.kind, q.themes])).digest('hex').slice(0, 12);
  }
  /**
   * Bring a pack's quotes into the collection:
   *  - new pieces are added; pieces changed in the pack are updated, unless you edited your copy
   *  - pieces dropped from the pack are removed, unless you edited them
   *  - pieces you deleted stay deleted
   *  - your own earlier copies of the same piece (e.g. imported by hand) are replaced by the pack's, keeping ★
   *  - "retired" keys: older versions of pieces, removed if you had imported them by hand
   */
  syncPack(packId, items, retired = []) {
    this._requireKey();
    if (!/^[a-z0-9]{1,20}$/.test(packId)) throw new Error('Bad reading pack');
    const meta = this.getMeta();
    const packs = meta.packs || {};
    const was = (packs[packId] && packs[packId].items) || {};
    let quotes = this.getQuotes();
    const incoming = new Map();
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || !String(it.text || '').trim()) continue;
      const k = Vault.readingKey(it.text, it.author);
      if (!incoming.has(k)) incoming.set(k, it);
    }
    const retiredSet = new Set(Array.isArray(retired) ? retired : []);
    const fav = new Set();
    let added = 0, updated = 0, removed = 0;
    quotes = quotes.filter(q => {
      if (q.pack) return true;
      const k = Vault.readingKey(q.text, q.author);
      if (incoming.has(k)) { if (q.fav) fav.add(k); return false; }   // replaced by the pack's copy
      if (retiredSet.has(k)) { removed++; return false; }
      return true;
    });
    const byId = new Map(quotes.map(q => [q.id, q]));
    const touched = new Set();
    for (const [k, it] of incoming) {
      const id = `${packId}-${k}`;
      const cur = byId.get(id);
      const fresh = { text: it.text, author: it.author || '', source: it.source || '', title: it.title || '', kind: it.kind || '',
        themes: it.themes || [], mine: !!it.mine, pack: packId, id, fav: (cur && cur.fav) || fav.has(k) };
      if (!cur) {
        if (was[k] && !fav.has(k)) continue;           // you deleted it earlier
        quotes.push(fresh); added++; touched.add(id);
      } else if (Vault.readingHash(cur) === was[k]) { // unchanged by you: take the pack's version
        const i = quotes.indexOf(cur);
        quotes[i] = fresh; touched.add(id);
        if (Vault.readingHash(Vault.cleanQuotes([fresh])[0]) !== was[k]) updated++;
      }
    }
    quotes = quotes.filter(q => {
      if (q.pack !== packId) return true;
      const k = q.id.slice(packId.length + 1);
      if (incoming.has(k)) return true;
      if (Vault.readingHash(q) === was[k]) { removed++; return false; }   // dropped from the pack, not edited
      return true;
    });
    const clean = Vault.cleanQuotes(quotes);
    const next = {};
    for (const [k] of incoming) {
      const q = clean.find(x => x.id === `${packId}-${k}`);
      next[k] = q && touched.has(q.id) ? Vault.readingHash(q) : was[k] || (q ? 'edited' : 'deleted');
    }
    packs[packId] = { items: next, synced: new Date().toISOString() };
    this._writeMeta({ quotes: clean, quotesSeeded: true, packs });
    return { quotes: clean, added, updated, removed };
  }

  setQuotes(list) {
    return this._writeMeta({ quotes: Vault.cleanQuotes(list), quotesSeeded: true }).quotes;
  }

  /** Move every entry in one category to another ('' = none). Keeps their "last edited" time. */
  recategorize(fromId, toId = '') {
    this._requireKey();
    let n = 0;
    for (const m of [...this.index.values()]) {
      if (m.category !== fromId) continue;
      this.save({ ...this._readEntry(m.id), category: toId, keepUpdated: true });
      n++;
    }
    return n;
  }

  // ---------- entries ----------
  _entryFile(id) {
    if (!ID_RE.test(id)) throw new Error('Bad entry id');
    return path.join(this.entriesDir, id + '.enc');
  }

  _readEntry(id) {
    return JSON.parse(open(this.key, fs.readFileSync(this._entryFile(id))).toString('utf8'));
  }

  list() { this._requireKey(); return [...this.index.values()]; }

  get(id) { this._requireKey(); return this._readEntry(id); }

  save(input) {
    this._requireKey();
    const now = new Date().toISOString();
    const id = input.id && ID_RE.test(input.id) ? input.id : crypto.randomUUID();
    const prev = this.index.get(id);
    const tags = [...new Set((input.tags || []).map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
    const entry = {
      id,
      date: /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : now.slice(0, 10),
      time: String(input.time || '').slice(0, 5),
      title: String(input.title || '').slice(0, 300),
      tags,
      category: CAT_ID_RE.test(input.category || '') ? input.category : '',
      html: String(input.html || ''),
      text: String(input.text || ''),
      created: prev ? prev.created : (input.created || now),
      updated: input.updated && input.keepUpdated ? input.updated : now,
    };
    fs.mkdirSync(this.entriesDir, { recursive: true });
    writeAtomic(this._entryFile(id), seal(this.key, Buffer.from(JSON.stringify(entry))));
    const meta = Vault.metaOf(entry);
    this.index.set(id, meta);
    this._writeIndex();
    return meta;
  }

  remove(id) {
    this._requireKey();
    const f = this._entryFile(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    this.index.delete(id);
    this._writeIndex();
  }

  // ---------- pictures for the weekly pages (encrypted like everything else) ----------
  static pictureKeyOk(key) { return typeof key === 'string' && PICTURE_KEY_RE.test(key); }
  _pictureFile(key) {
    if (!Vault.pictureKeyOk(key)) throw new Error('Bad picture name');
    return path.join(this.picturesDir, key + '.enc');
  }
  pictureKeys() {
    this._requireKey();
    if (!fs.existsSync(this.picturesDir)) return [];
    return fs.readdirSync(this.picturesDir).filter(f => f.endsWith('.enc')).map(f => f.slice(0, -4)).filter(k => Vault.pictureKeyOk(k));
  }
  getPicture(key) {
    this._requireKey();
    const f = this._pictureFile(key);
    if (!fs.existsSync(f)) return null;
    return open(this.key, fs.readFileSync(f)).toString('utf8');
  }
  /** dataUrl: a JPEG, PNG or WebP picture as a data: URL (the app shrinks it first). */
  setPicture(key, dataUrl) {
    this._requireKey();
    if (typeof dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('That is not a picture WellWrite can use');
    if (dataUrl.length > 12 * 1024 * 1024) throw new Error('That picture is too large');
    fs.mkdirSync(this.picturesDir, { recursive: true });
    writeAtomic(this._pictureFile(key), seal(this.key, Buffer.from(dataUrl)));
    return true;
  }
  removePicture(key) {
    this._requireKey();
    const f = this._pictureFile(key);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
  }
  /** Where each week's picture came from: 'default:<file>' (WellWrite's), 'mine', or 'removed' (show none). */
  pictureOrigins() { this._requireKey(); return this.getMeta().pictureOrigins || {}; }
  setPictureOrigin(key, origin) {
    this._requireKey();
    if (!Vault.pictureKeyOk(key)) throw new Error('Bad picture name');
    const o = { ...(this.getMeta().pictureOrigins || {}) };
    if (origin) o[key] = String(origin).slice(0, 300); else delete o[key];
    this._writeMeta({ pictureOrigins: o });
    return o;
  }
  _rawPictures() {
    const out = {};
    if (!fs.existsSync(this.picturesDir)) return out;
    for (const f of fs.readdirSync(this.picturesDir)) {
      const k = f.endsWith('.enc') ? f.slice(0, -4) : '';
      if (Vault.pictureKeyOk(k)) out[k] = fs.readFileSync(path.join(this.picturesDir, f)).toString('base64');
    }
    return out;
  }

  // ---------- backup ----------
  /** Encrypted backup: one file holding the wrapped key and all encrypted entries. */
  /** Works while locked too: it copies the already-encrypted files. */
  exportBackup(file) {
    if (!this.exists()) throw new Error('No journal found');
    const entries = {};
    const names = fs.existsSync(this.entriesDir) ? fs.readdirSync(this.entriesDir) : [];
    for (const f of names) {
      const id = f.endsWith('.enc') ? f.slice(0, -4) : '';
      if (ID_RE.test(id)) entries[id] = fs.readFileSync(path.join(this.entriesDir, f)).toString('base64');
    }
    const data = {
      app: 'WellWrite', format: 1, exported: new Date().toISOString(),
      vault: JSON.parse(fs.readFileSync(this.vaultFile, 'utf8')),
      meta: fs.existsSync(this.metaFile) ? fs.readFileSync(this.metaFile).toString('base64') : undefined,
      entries,
      pictures: this._rawPictures(),
    };
    writeAtomic(file, JSON.stringify(data));
    return Object.keys(entries).length;
  }

  static readBackup(file, password) {
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('That file is not a WellWrite backup'); }
    // Backups made before the rename say "Daybook".
    if (!['WellWrite', 'Daybook'].includes(data.app) || !data.vault || !data.entries) throw new Error('That file is not a WellWrite backup');
    const key = unwrapDataKey(password, data.vault);
    if (!key) throw new Error('That password does not open this backup');
    return { data, key };
  }

  /** Merge a backup into the open journal. Newer copies of the same entry win. */
  importBackup(file, password) {
    this._requireKey();
    const { data, key } = Vault.readBackup(file, password);
    let added = 0, updated = 0;
    try {
      if (data.meta) {
        // Bring across categories this journal doesn't have yet.
        const theirs = JSON.parse(open(key, Buffer.from(data.meta, 'base64')).toString('utf8')).categories || [];
        const mine = this.getMeta().categories;
        const extra = theirs.filter(c => !mine.some(x => x.id === c.id));
        if (extra.length) this.setCategories([...mine, ...extra]);
        // And quotes (duplicates are dropped).
        const theirQuotes = JSON.parse(open(key, Buffer.from(data.meta, 'base64')).toString('utf8')).quotes || [];
        if (theirQuotes.length) this.setQuotes([...this.getQuotes(), ...theirQuotes]);
      }
      for (const [id, b64] of Object.entries(data.entries)) {
        if (!ID_RE.test(id)) continue;
        const e = JSON.parse(open(key, Buffer.from(b64, 'base64')).toString('utf8'));
        const cur = this.index.get(id);
        if (cur && cur.updated >= e.updated) continue;
        this.save({ ...e, keepUpdated: true });
        cur ? updated++ : added++;
      }
      // Week pictures this journal doesn't have yet.
      for (const [k, b64] of Object.entries(data.pictures || {})) {
        if (!Vault.pictureKeyOk(k) || fs.existsSync(this._pictureFile(k))) continue;
        this.setPicture(k, open(key, Buffer.from(b64, 'base64')).toString('utf8'));
      }
    } finally { key.fill(0); }
    return { added, updated };
  }

  /** Start a fresh install from a backup (backup's password becomes the journal password). */
  restoreFresh(file, password) {
    if (this.exists()) throw new Error('A journal already exists here');
    const { data, key } = Vault.readBackup(file, password);
    fs.mkdirSync(this.entriesDir, { recursive: true });
    writeAtomic(this.vaultFile, JSON.stringify(data.vault, null, 2));
    for (const [id, b64] of Object.entries(data.entries)) {
      if (ID_RE.test(id)) writeAtomic(this._entryFile(id), Buffer.from(b64, 'base64'));
    }
    if (data.meta) writeAtomic(this.metaFile, Buffer.from(data.meta, 'base64'));
    for (const [k, b64] of Object.entries(data.pictures || {})) {
      if (!Vault.pictureKeyOk(k)) continue;
      fs.mkdirSync(this.picturesDir, { recursive: true });
      writeAtomic(this._pictureFile(k), Buffer.from(b64, 'base64'));
    }
    this.key = key;
    this._rebuildIndex(Object.keys(data.entries).filter(id => ID_RE.test(id)));
    return this.index.size;
  }

  /** Readable copy of every entry as a single HTML page (unencrypted — user asked for it). */
  exportReadable(file, sanitize = x => x) {
    this._requireKey();
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const list = this.list().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const cats = new Map(this.getMeta().categories.map(c => [c.id, c]));
    const body = list.map(m => {
      const e = this._readEntry(m.id);
      const d = new Date(e.date + 'T00:00:00');
      const when = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (e.time ? ', ' + e.time : '');
      const cat = cats.get(e.category);
      const html = sanitize(e.html).replace(/<a href="wellwrite:entry\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '<span class="x">$1</span>');
      return `<article><p class="d">${esc(when)}${cat ? ` <span class="c" style="color:${cat.color}">${esc(cat.name)}</span>` : ''}</p>${e.title ? `<h2>${esc(e.title)}</h2>` : ''}` +
        `${e.tags.length ? `<p class="t">${e.tags.map(t => '#' + esc(t)).join(' ')}</p>` : ''}<div>${html}</div></article>`;
    }).join('\n');
    const html = `<!doctype html><meta charset="utf-8"><title>WellWrite journal</title><style>
body{font:17px/1.65 Georgia,serif;max-width:42em;margin:3em auto;padding:0 1.2em;color:#222}
article{page-break-after:always;border-bottom:1px solid #ccc;padding-bottom:2em;margin-bottom:2em}
.d{color:#666;font-style:italic;margin:0}.t{color:#666;font-size:.9em}img{max-width:100%;height:auto}
blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1em;color:#555}.c{font-style:normal;font-weight:bold;margin-left:.6em}.x{text-decoration:underline dotted}</style>
<h1>Journal</h1><p>${list.length} entries, exported ${esc(new Date().toLocaleString())}</p>${body}`;
    writeAtomic(file, html);
    return list.length;
  }
}

module.exports = { Vault, CATEGORY_COLORS, _internal: { seal, open, deriveKey } };
