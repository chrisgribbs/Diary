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
// Days and seasons a piece can belong to (see renderer/seasons.js OCCASIONS).
const OCCASION_IDS = ['ashwednesday', 'palmsunday', 'maundythursday', 'goodfriday', 'holysaturday', 'easterday', 'ascension', 'pentecostday',
  'christmaseve', 'christmasday', 'newyear', 'epiphanyday', 'allsaints', 'anzacday', 'mothersday', 'fathersday',
  'advent', 'christmas', 'epiphany', 'lent', 'holyweek', 'easter', 'pentecost', 'endofyear', 'newbeginnings', 'birthday'];
// Whether a reading may be shared, and on what terms (shown with it, and kept when it's shared in a prayer pack):
// 'public-domain'; 'cc-by-nc-nd' (Creative Commons: credit, no changes, non-commercial); 'own' (shared by its writer).
const LICENCES = ['', 'public-domain', 'cc-by-nc-nd', 'own'];
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

/** What an entry says (not when it was saved): two entries that say the same thing are the same. */
function sameEntry(a, b) {
  // Spaces and line breaks at the ends of paragraphs, and between them, aren't a change; between words they are.
  const html = h => String(h || '').replace(/\s+/g, ' ')
    .replace(/\s*(<\/?(?:p|div|li|ul|ol|h[1-6]|blockquote|figure|figcaption)\b[^>]*>)\s*/gi, '$1')
    .replace(/(<br\s*\/?>\s*)+(<\/p>)?\s*$/i, '$2').trim();
  return !!a && !!b && a.date === b.date && String(a.time || '') === String(b.time || '') && String(a.title || '').trim() === String(b.title || '').trim()
    && String(a.category || '') === String(b.category || '')
    && [...(a.tags || [])].sort().join(',') === [...(b.tags || [])].sort().join(',')
    && html(a.html) === html(b.html);
}

/** An entry's words, as plain text with single spaces (for comparing drafts). */
function textOf(html) {
  return String(html || '').replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
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

  /** Whether a password opens this journal (without changing anything). */
  checkPassword(pw) {
    const k = unwrapDataKey(pw, JSON.parse(fs.readFileSync(this.vaultFile, 'utf8')));
    if (!k) return false;
    k.fill(0); return true;
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
      images: (String(e.html || '').match(/<img\b(?![^>]*\sdata-ink=)/gi) || []).length,   // photos
      ink: (String(e.html || '').match(/<img\b(?=[^>]*\sdata-ink=)/gi) || []).length,     // handwritten pages
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

  /** Categories, stamped with when they changed so sync knows which device's list is newest. */
  setCategories(list, changed = new Date().toISOString()) {
    return this._writeMeta({ categories: Vault.cleanCategories(list), categoriesUpdated: changed });
  }

  // ---------- Bible study: your studies, bookmarks and prayer list (encrypted, like everything else here) ----------
  static cleanStudy(s) {
    s = s && typeof s === 'object' ? s : {};
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    const history = (Array.isArray(s.history) ? s.history : []).filter(h => h && /^[a-z0-9-]{8,64}$/.test(h.id || '')).slice(0, 50).map(h => ({
      id: h.id, at: str(h.at, 30), ref: Array.isArray(h.ref) ? h.ref.slice(0, 5).map(n => +n || 0) : [], label: str(h.label, 80),
      mode: str(h.mode, 20), length: str(h.length, 20), title: str(h.title, 200), model: str(h.model, 100),
      entryId: ID_RE.test(h.entryId || '') ? h.entryId : '', md: str(h.md, 60000), passageText: str(h.passageText, 12000), translation: str(h.translation, 20),
      sources: (Array.isArray(h.sources) ? h.sources : []).slice(0, 30).map(x => ({ id: str(x.id, 40), author: str(x.author, 120), work: str(x.work, 200), year: +x.year || 0, section: str(x.section, 200), licence: str(x.licence, 30), credit: str(x.credit, 300), url: str(x.url, 300), text: str(x.text, 6000), why: str(x.why, 10) })),
      flags: (Array.isArray(h.flags) ? h.flags : []).slice(0, 30).map(f => ({ kind: str(f.kind, 10), text: str(f.text, 200) })),
      thread: (Array.isArray(h.thread) ? h.thread : []).slice(-30).map(t => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: str(t.content, 8000) })),
      topic: str(h.topic, 300), usage: { cost: +(h.usage && h.usage.cost) || 0 },
    }));
    const uniq = list => { const seen = new Set(); return list.filter(x => !seen.has(x.id) && seen.add(x.id)); };
    // u: when the item last changed (for sync, which merges item by item).
    const bookmarks = uniq((Array.isArray(s.bookmarks) ? s.bookmarks : []).slice(0, 500).map(b => ({ id: str(b.id, 40), author: str(b.author, 120), work: str(b.work, 200), section: str(b.section, 200), text: str(b.text, 6000), at: str(b.at, 30), credit: str(b.credit, 300), u: str(b.u, 30) })).filter(b => b.id));
    const prayers = uniq((Array.isArray(s.prayers) ? s.prayers : []).slice(0, 500).map(p => ({ id: str(p.id, 40), text: str(p.text, 1000), note: str(p.note, 2000), at: str(p.at, 30), done: str(p.done, 30), u: str(p.u, 30) })).filter(p => p.id && p.text.trim()));
    // Bookmarks and prayers removed, and when, so a removal on one device isn't undone by another's older copy.
    const gone = {};
    if (s.gone && typeof s.gone === 'object' && !Array.isArray(s.gone)) {
      for (const [k, v] of Object.entries(s.gone).slice(-1000)) if (/^(b|p):.{1,40}$/.test(k) && /^\d{4}-\d{2}-\d{2}T/.test(String(v))) gone[k] = String(v).slice(0, 30);
    }
    // The OpenRouter key, so it's entered once and every signed-in device has it. Kept here, inside the encrypted
    // journal, and synced inside the encrypted study file. k '' with a time means it was removed (on every device).
    const ak = s.aiKey && typeof s.aiKey === 'object' ? s.aiKey : {};
    const aiKey = { k: /^sk-or-[\w-]{10,200}$/.test(ak.k || '') ? ak.k : '', u: /^\d{4}-\d{2}-\d{2}T/.test(String(ak.u || '')) ? String(ak.u).slice(0, 30) : '' };
    return { history, bookmarks, prayers, gone, aiKey };
  }
  /** Stamp changed bookmarks and prayers with the time, and note removed ones (for sync). */
  static stampStudy(before, after, now) {
    const strip = x => { const { u, ...rest } = x; return JSON.stringify(rest); };
    const gone = { ...before.gone };
    for (const [kind, key] of [['b', 'bookmarks'], ['p', 'prayers']]) {
      const old = new Map(before[key].map(x => [x.id, x]));
      after[key] = after[key].map(x => { const o = old.get(x.id); delete gone[`${kind}:${x.id}`]; return o && strip(o) === strip(x) ? { ...x, u: o.u } : { ...x, u: now }; });
      const still = new Set(after[key].map(x => x.id));
      for (const id of old.keys()) if (!still.has(id)) gone[`${kind}:${id}`] = now;
    }
    after.gone = gone;
    after.aiKey = after.aiKey.k === before.aiKey.k ? before.aiKey : { k: after.aiKey.k, u: now };
    return after;
  }
  /** Bookmarks and the prayer list, for sync (your study history stays on each device). */
  studyForSync() {
    const meta = this.getMeta();
    const st = this.getStudy();
    return { bookmarks: st.bookmarks, prayers: st.prayers, gone: st.gone, aiKey: st.aiKey, updated: meta.studySynced || '' };
  }
  /**
   * Bookmarks and prayers from another device, merged item by item: an item on either device is kept unless it was
   * removed after it last changed; where both have it, the newer change wins. If the result has anything the other
   * device lacks, it's marked as changed now, so sync sends it back.
   */
  applySyncedStudy(p) {
    this._requireKey();
    const mine = this.getStudy();
    const theirs = Vault.cleanStudy({ bookmarks: p.bookmarks, prayers: p.prayers, gone: p.gone, aiKey: p.aiKey });
    const gone = { ...mine.gone };
    for (const [k, v] of Object.entries(theirs.gone)) if (!gone[k] || v > gone[k]) gone[k] = v;
    const merge = (kind, a, b) => {
      const by = new Map();
      for (const x of [...a, ...b]) { const o = by.get(x.id); if (!o || String(x.u) > String(o.u)) by.set(x.id, x); }
      const out = [...by.values()].filter(x => !(gone[`${kind}:${x.id}`] && gone[`${kind}:${x.id}`] >= String(x.u)));
      for (const x of out) if (gone[`${kind}:${x.id}`]) delete gone[`${kind}:${x.id}`];
      // in the order you'd expect: newest first
      return out.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    };
    const bookmarks = merge('b', mine.bookmarks, theirs.bookmarks);
    const prayers = merge('p', mine.prayers, theirs.prayers);
    const aiKey = theirs.aiKey.u > mine.aiKey.u ? theirs.aiKey : mine.aiKey;   // the newer key (or removal) wins
    const sig = st => JSON.stringify([st.bookmarks.map(x => x.id + x.u).sort(), st.prayers.map(x => x.id + x.u).sort(), Object.keys(st.gone).sort(), st.aiKey.u]);
    const merged = { history: mine.history, bookmarks, prayers, gone, aiKey };
    const same = sig(merged) === sig(theirs);
    this._writeMeta({ study: Vault.cleanStudy(merged), studySynced: same ? String(p.updated || '') : new Date().toISOString() });
    return merged;
  }
  getStudy() { this._requireKey(); return Vault.cleanStudy(this.getMeta().study); }
  setStudy(patch) {
    this._requireKey();
    const before = this.getStudy();
    const now = new Date().toISOString();
    const study = Vault.stampStudy(before, Vault.cleanStudy({ ...before, ...patch }), now);
    const changed = JSON.stringify([study.bookmarks, study.prayers, study.gone, study.aiKey]) !== JSON.stringify([before.bookmarks, before.prayers, before.gone, before.aiKey]);
    this._writeMeta({ study, studyUpdated: now, ...(changed ? { studySynced: now } : {}) });
    return study;
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
        occasion: OCCASION_IDS.includes(q.occasion) ? q.occasion : '',
        credit: String(q.credit || '').replace(/\r\n?/g, '\n').trim().slice(0, 600),
        licence: LICENCES.includes(q.licence) ? q.licence : '',
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
      translation: ['web', 'kjv'].includes(b.translation) || /^api:[A-Za-z0-9-]{4,64}$/.test(b.translation || '') ? b.translation : 'web',
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
    // (occasion only counts when set, so pieces synced before occasions existed still match)
    return crypto.createHash('sha1').update(JSON.stringify([q.text, q.author, q.source, q.title, q.kind, q.themes, ...(q.occasion ? [q.occasion] : [])])).digest('hex').slice(0, 12);
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
        themes: it.themes || [], mine: !!it.mine, pack: packId, id, fav: (cur && cur.fav) || fav.has(k), occasion: it.occasion || '',
        credit: it.credit || '', licence: it.licence || '' };
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
    const write = { quotes: clean, quotesSeeded: true, packs };
    // Your readings file is yours (not on your other devices already): when it changes, sync sends it, and the
    // ones taken out of the file go from your other devices too.
    if (packId === 'file' && (added || updated || removed)) {
      const at = new Date().toISOString();
      write.quotesUpdated = at;
      write.quotesGone = Vault.goneAfter(meta, meta.quotes || [], clean, at);
    }
    this._writeMeta(write);
    return { quotes: clean, added, updated, removed };
  }

  /** Your changes to your quotes (adding, editing, deleting, favourites). `changed` is when, for sync. */
  setQuotes(list, changed = new Date().toISOString()) {
    const meta = this.getMeta();
    const clean = Vault.cleanQuotes(list);
    const quotesGone = Vault.goneAfter(meta, meta.quotes || [], clean, changed || new Date().toISOString());
    return this._writeMeta({ quotes: clean, quotesSeeded: true, quotesUpdated: changed, quotesGone }).quotes;
  }

  /**
   * Your own quotes (and your readings file's) that you've deleted, with when: so a sync that merges two devices'
   * quotes doesn't bring them back. { id: time }, the most recent 3000.
   */
  static goneAfter(meta, before, after, at) {
    const own = q => !(q.pack && q.pack !== 'file');
    const now = new Set(after.map(q => q.id));
    const gone = { ...(meta.quotesGone || {}) };
    for (const q of before) if (own(q) && !now.has(q.id)) gone[q.id] = at;
    for (const id of now) delete gone[id];
    const ids = Object.keys(gone);
    if (ids.length > 3000) for (const id of ids.sort((a, b) => String(gone[a]).localeCompare(String(gone[b]))).slice(0, ids.length - 3000)) delete gone[id];
    return gone;
  }

  /**
   * Your quotes, as sync sends them. The built-in collections are on every device already, so for those only what
   * you changed goes: favourites, your edits, and the ones you deleted. Your own quotes (and your readings file's)
   * go in full.
   */
  quotesForSync() {
    const meta = this.getMeta();
    const quotes = this.getQuotes();
    const packs = meta.packs || {};
    const builtin = q => q.pack && q.pack !== 'file';
    const own = quotes.filter(q => !builtin(q));
    const favs = [], edited = [], removed = [];
    const have = new Set(quotes.map(q => q.id));
    for (const q of quotes.filter(builtin)) {
      if (q.fav) favs.push(q.id);
      const was = ((packs[q.pack] || {}).items || {})[q.id.slice(q.pack.length + 1)];
      if (Vault.readingHash(q) !== was) edited.push(q);
    }
    for (const [pack, p] of Object.entries(packs)) {
      if (pack === 'file') continue;
      for (const k of Object.keys(p.items || {})) if (!have.has(`${pack}-${k}`)) removed.push(`${pack}-${k}`);
    }
    return { own, favs, edited, removed, gone: meta.quotesGone || {}, updated: meta.quotesUpdated || '' };
  }

  /**
   * Quotes from another device. Normally theirs replace yours (they changed them more recently). With
   * `merge` (the first sync on a device), nothing is lost: both sets of your own quotes are kept, and favourites,
   * edits and deletions from both devices count.
   */
  applySyncedQuotes(p, updated, { merge = false } = {}) {
    this._requireKey();
    const meta = this.getMeta();
    const packs = JSON.parse(JSON.stringify(meta.packs || {}));
    const builtin = q => q.pack && q.pack !== 'file';
    const local = this.getQuotes();
    const removed = new Set(Array.isArray(p.removed) ? p.removed : []);
    const favs = new Set(Array.isArray(p.favs) ? p.favs : []);
    const edited = new Map((Array.isArray(p.edited) ? p.edited : []).filter(q => q && builtin(q)).map(q => [q.id, q]));
    const packOf = id => Object.keys(packs).find(k => k !== 'file' && id.startsWith(k + '-'));
    let list = local.filter(builtin).filter(q => !removed.has(q.id)).map(q => {
      const e = edited.get(q.id);
      const next = e ? { ...e, fav: q.fav } : { ...q };
      next.fav = merge ? (q.fav || favs.has(q.id)) : favs.has(q.id);
      return next;
    });
    // Edited ones this device doesn't have (its collection is off, or it deleted them before).
    for (const [id, q] of edited) if (!list.some(x => x.id === id) && !removed.has(id)) list.push({ ...q, fav: favs.has(id) });
    // Deleted there: they stay deleted here when the collections next update.
    for (const id of removed) {
      const pack = packOf(id) || (id.match(/^([a-z0-9]{1,20})-/) || [])[1];
      if (!pack || pack === 'file') continue;
      const items = ((packs[pack] = packs[pack] || { items: {} }).items = packs[pack].items || {});
      const k = id.slice(pack.length + 1);
      if (!items[k]) items[k] = 'deleted';
    }
    // Your own quotes (and your readings file's): both devices' kept, theirs taking precedence for the same quote,
    // less the ones deleted on either (whichever happened last: a quote added again after it was deleted stays).
    const theirGone = p.gone && typeof p.gone === 'object' && !Array.isArray(p.gone) ? p.gone : {};
    const myGone = meta.quotesGone || {};
    const theirAt = String(p.updated || '');
    const theirOwn = (Array.isArray(p.own) ? p.own : []).filter(q => q && !builtin(q))
      .filter(q => !(myGone[q.id] && String(myGone[q.id]) > theirAt));            // deleted here since their change
    const theirIds = new Set(theirOwn.map(q => q.id));
    const localOwn = local.filter(q => !builtin(q));
    const onlyHere = localOwn.filter(q => !theirIds.has(q.id) && !theirGone[q.id]);
    const own = merge ? [...localOwn, ...theirOwn] : [...theirOwn, ...onlyHere];
    const gone = { ...myGone };
    for (const [id, at] of Object.entries(theirGone)) if (!gone[id] || String(at) > String(gone[id])) gone[id] = String(at);
    list = Vault.cleanQuotes([...own, ...list]);
    for (const q of list) if (!builtin(q)) delete gone[q.id];
    // Anything of yours they didn't have (or deleted since): your set is newer now, so sync sends it on.
    const mine = merge || onlyHere.length || theirOwn.length < (Array.isArray(p.own) ? p.own.filter(q => q && !builtin(q)).length : 0);
    this._writeMeta({ quotes: list, quotesSeeded: true, quotesUpdated: mine ? new Date().toISOString() : updated, packs, quotesGone: gone });
    return list;
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
    // Saved again with nothing changed (opening an entry, tapping into it, a keyboard's stray "input"): it isn't an
    // edit, so it keeps its time. Otherwise sync would think it was changed here, and keep "(from another device)" copies.
    if (prev && !input.keepUpdated) {
      let old = null;
      try { old = this._readEntry(id); } catch {}
      if (old && sameEntry(old, entry)) return prev;
    }
    fs.mkdirSync(this.entriesDir, { recursive: true });
    writeAtomic(this._entryFile(id), seal(this.key, Buffer.from(JSON.stringify(entry))));
    const meta = Vault.metaOf(entry);
    this.index.set(id, meta);
    this._writeIndex();
    return meta;
  }

  /**
   * Copies sync made ("… (from another device)") that say exactly what another entry says: removed, keeping the
   * original (or one of the copies, if they all differ from it). Copies with anything different are kept. Returns the ids removed.
   */
  removeIdenticalCopies() {
    this._requireKey();
    const SUFFIX = / \(from another device\)$/;
    const base = t => { let x = String(t || ''); while (SUFFIX.test(x)) x = x.replace(SUFFIX, ''); return x; };
    const copies = [...this.index.values()].filter(m => SUFFIX.test(m.title || ''));
    if (!copies.length) return [];
    const removed = [];
    const read = new Map();
    const entry = id => { if (!read.has(id)) { try { read.set(id, this._readEntry(id)); } catch { read.set(id, null); } } return read.get(id); };
    // Compare each copy with the entries of its day whose title is the same without "(from another device)".
    const kept = [];   // [entry with its original title]
    const sameDay = [...this.index.values()].filter(m => copies.some(c => c.date === m.date));
    for (const m of sameDay.filter(m => !SUFFIX.test(m.title || ''))) { const e = entry(m.id); if (e) kept.push({ ...e, title: base(e.title) }); }
    for (const c of copies.sort((a, b) => String(a.updated).localeCompare(String(b.updated)))) {
      const e = entry(c.id);
      if (!e) continue;
      const plain = { ...e, title: base(e.title) };
      // The same as another entry of the day, or an earlier draft of one (every word of it is in that entry, in
      // order: the entry is this copy written further). Anything else, the copy has something of its own: kept.
      const words = textOf(plain.html);
      const draftOf = k => k.title === plain.title && words.length >= 1 && textOf(k.html).includes(words);
      if (kept.some(k => sameEntry(k, plain) || draftOf(k))) { this.remove(c.id); removed.push(c.id); }
      else kept.push(plain);
    }
    return removed;
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
  // ---------- WordPress: which post each entry became (and its uploaded photos) ----------
  wpRecord(entryId) { this._requireKey(); return (this.getMeta().wpPosts || {})[entryId] || null; }
  setWpRecord(entryId, rec) {
    this._requireKey();
    if (!ID_RE.test(entryId)) throw new Error('Bad entry');
    const all = { ...(this.getMeta().wpPosts || {}) };
    if (rec) all[entryId] = { postId: +rec.postId || 0, link: String(rec.link || '').slice(0, 500), status: String(rec.status || ''), updated: rec.updated || '', media: rec.media || {} };
    else delete all[entryId];
    this._writeMeta({ wpPosts: all });
    return all[entryId] || null;
  }
  wpLinks() { this._requireKey(); const all = this.getMeta().wpPosts || {}; return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.link])); }

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

module.exports = { sameEntry, Vault, CATEGORY_COLORS, ID_RE, _internal: { seal, open, deriveKey, wrapDataKey, unwrapDataKey } };
