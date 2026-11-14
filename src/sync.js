'use strict';
/**
 * Sync: keeps the journal the same on every device you use, through your own Google Drive.
 *
 *  - A "WellWrite sync" folder in your Drive holds one file per entry ("e-<id>"), one for your categories
 *    ("categories"), and the sync key ("sync-key").
 *  - Every file is encrypted (AES-256-GCM) with a random sync key. The sync key file holds that key wrapped with
 *    your journal password (scrypt), exactly like the journal itself, so Google only ever sees scrambled data.
 *  - Each device remembers, per file, the Drive version it last saw and the entry's "updated" time at that moment.
 *    Comparing those with what's on Drive and on the device now says what changed where:
 *      changed only on Drive   → bring it here
 *      changed only here       → send it up
 *      changed in both places  → keep both: yours stays, the other becomes a copy titled "(from another device)"
 *    Deleting sends up a small "deleted" marker so other devices delete it too. An edit beats a delete.
 *  - The first time a device syncs it has no history, so for an entry on both sides the newer one wins.
 *  - Your quotes sync too ("quotes"): your own in full; for the built-in collections (on every device already) just
 *    your favourites, edits and deletions. The most recent change wins; a device's first sync merges instead.
 *  - Settings and week pictures stay per device.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ID_RE, sameEntry, _internal: { seal, open, wrapDataKey, unwrapDataKey } } = require('./vault');

const KEY_FILE = 'sync-key';
const CATS = 'categories';
const QUOTES = 'quotes';
const GONE = '§deleted';
const QUIET_MS = 4000;              // after you stop typing
const EVERY_MS = 3 * 60 * 1000;     // and every few minutes

class Sync {
  /**
   * @param {object} o
   * @param {import('./vault').Vault} o.vault
   * @param {import('./gdrive').GoogleDrive} o.drive
   * @param {string} o.dataDir
   * @param {(ev:string, ...a:any[])=>void} o.send
   */
  constructor(o) {
    this.vault = o.vault; this.drive = o.drive; this.send = o.send || (() => {});
    this.file = path.join(o.dataDir, 'sync.enc');
    this.st = null;            // state, while unlocked
    this.running = null; this.again = false;
    this.quiet = null; this.every = null;
    this.held = new Set();     // entries open with unsaved changes: Drive's copy waits until they're saved
    this.last = { at: '', error: '', code: '' };
  }

  // ---------- state (encrypted with the journal key) ----------
  _read() {
    try { return JSON.parse(open(this.vault.key, fs.readFileSync(this.file)).toString('utf8')); } catch { return null; }
  }
  _write() {
    const tmp = this.file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, seal(this.vault.key, Buffer.from(JSON.stringify(this.st))));
    fs.renameSync(tmp, this.file);
  }
  _state() {
    if (!this.vault.isUnlocked()) return null;
    if (!this.st) this.st = this._read() || { on: false, items: {} };
    return this.st;
  }
  _key() { return Buffer.from(this.st.key, 'base64'); }

  status() {
    const st = this.vault.isUnlocked() ? this._state() : null;
    const g = this.drive.status();
    return {
      available: g.available, connected: g.connected, email: g.email,
      on: !!(st && st.on), last: (st && st.last) || this.last.at, error: this.last.error, code: this.last.code,
      busy: !!this.running, count: st ? Object.keys(st.items).filter(k => k.startsWith('e-') && !st.items[k].d).length : 0,
    };
  }
  _status() { this.send('sync:status', this.status()); }

  // ---------- turning it on and off ----------
  /**
   * Turn sync on. On the first device this makes the sync key, locked with `password` (this journal's password).
   * On another device `password` must be the one the sync key was locked with (your journal password there).
   */
  async enable(password) {
    const st = this._state();
    if (!st) throw new Error('Journal is locked');
    if (!this.drive.status().connected) throw new Error('Connect Google Drive first');
    const folder = await this.drive.syncFolderId();
    const keyFile = (await this.drive.listFolder(folder)).find(f => f.name === KEY_FILE);
    let key;
    if (keyFile) {
      let wrapped;
      try { wrapped = JSON.parse((await this.drive.readFile(keyFile.id)).toString('utf8')); } catch { throw new Error('The sync files in your Drive are damaged'); }
      key = unwrapDataKey(password, wrapped.vault || {});
      if (!key) {
        const e = new Error('That isn’t the password your other device uses for WellWrite. Enter the password you use there.');
        e.code = 'password'; throw e;
      }
    } else {
      if (!this.vault.checkPassword(password)) { const e = new Error('That isn’t your journal password'); e.code = 'password'; throw e; }
      key = crypto.randomBytes(32);
      await this.drive.putFile(folder, KEY_FILE, Buffer.from(JSON.stringify({ app: 'WellWrite', kind: 'sync-key', format: 1, vault: wrapDataKey(password, key) })));
    }
    this.st = { on: true, key: key.toString('base64'), folder, items: {}, last: '', since: new Date().toISOString() };
    key.fill(0);
    this._write();
    this.start();
    const r = await this.run('enable');
    return r;
  }

  /** Stop syncing on this device. What's in your Drive stays there. */
  disable() {
    this.stop();
    if (this._state()) { this.st = { on: false, items: {} }; this._write(); }
    this.last = { at: '', error: '', code: '' };
    this._status();
    return this.status();
  }

  /** After the journal password changes here: lock the sync key with the new one, for devices that join later. */
  async passwordChanged(newPassword) {
    const st = this._state();
    if (!st || !st.on) return;
    try {
      const files = await this.drive.listFolder(st.folder);
      const f = files.find(x => x.name === KEY_FILE);
      const k = this._key();
      await this.drive.putFile(st.folder, KEY_FILE, Buffer.from(JSON.stringify({ app: 'WellWrite', kind: 'sync-key', format: 1, vault: wrapDataKey(newPassword, k) })), f ? f.id : null);
      k.fill(0);
    } catch (e) { this.last.error = 'Couldn’t update the sync password: ' + e.message; this._status(); }
  }

  // ---------- when it runs ----------
  start() {
    const st = this._state();
    if (!st || !st.on) return;
    clearInterval(this.every);
    this.every = setInterval(() => this.run('timer').catch(() => {}), EVERY_MS);
    this.run('open').catch(() => {});
  }
  stop() { clearInterval(this.every); clearTimeout(this.quiet); this.every = this.quiet = null; this.st = null; this.held.clear(); }
  /** Something changed here: sync a few seconds after things go quiet. */
  touch() {
    if (!this.st || !this.st.on) return;
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.run('change').catch(() => {}), QUIET_MS);
  }
  hold(id) { this.held.clear(); if (id && ID_RE.test(id)) this.held.add(id); }

  /** One sync. If one is already running, another follows it. */
  run(why = '') {
    const st = this._state();
    if (!st || !st.on) return Promise.resolve(null);
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      this._status();
      let result = null;
      try {
        do { this.again = false; result = await this._once(); } while (this.again && this.vault.isUnlocked());
        this.last = { at: new Date().toISOString(), error: '', code: '' };
        if (this.st) { this.st.last = this.last.at; this._write(); }
      } catch (e) {
        if (this.vault.isUnlocked()) this.last = { ...this.last, error: e.message, code: e.code || '' };   // (locking mid-sync isn't an error)
      } finally {
        this.running = null;
        this._status();
      }
      if (result && (result.changed.length || result.copies.length || result.categories || result.quotes)) this.send('sync:changed', result);
      return result;
    })();
    return this.running;
  }

  // ---------- the sync itself ----------
  async _once() {
    const st = this.st, vault = this.vault, drive = this.drive;
    if (!st || !st.on || !vault.isUnlocked()) return null;
    const key = this._key();
    const out = { changed: [], copies: [], removed: [], categories: false, quotes: false, sent: 0, tidied: 0 };
    const save = () => { if (this.vault.isUnlocked() && this.st === st) this._write(); };
    try {
      // Copies kept "(from another device)" that say exactly the same as another entry: tidied away (and so, below,
      // from your other devices too). Anything that differs is kept.
      for (const id of vault.removeIdenticalCopies()) { out.removed.push(id); out.changed.push(id); out.tidied++; }
      const files = await drive.listFolder(st.folder);
      if (!files.some(f => f.name === KEY_FILE)) { const e = new Error('The sync folder in your Drive is missing or was emptied. Turn sync off and on again.'); e.code = 'gone'; throw e; }
      // Several files with one name (two devices made it at once): keep the newest, bin the rest.
      const byName = new Map();
      for (const f of files) { if (f.name !== KEY_FILE) (byName.get(f.name) || byName.set(f.name, []).get(f.name)).push(f); }
      const readPayload = async f => JSON.parse(open(key, await drive.readFile(f.id)).toString('utf8'));

      // Files this device knew about that have gone from Drive: forget them, so they're sent again.
      for (const name of Object.keys(st.items)) if (!byName.has(name)) delete st.items[name];

      // 1. What changed on Drive
      for (const [name, list] of byName) {
        let file = list[0], payload = null;
        if (list.length > 1) {
          const read = [];
          for (const f of list) { try { read.push([f, await readPayload(f)]); } catch {} }
          read.sort((a, b) => String(b[1].updated || '').localeCompare(String(a[1].updated || '')));
          if (!read.length) continue;
          [file, payload] = read[0];
          for (const [f] of read.slice(1)) await drive.trashFile(f.id).catch(() => {});
          if (st.items[name] && st.items[name].f !== file.id) delete st.items[name];
        }
        const base = st.items[name];
        if (base && base.f === file.id && base.r === file.version) continue;   // nothing new there
        if (!payload) { try { payload = await readPayload(file); } catch { continue; } }   // not ours, or damaged: leave it
        if (name === CATS) this._applyCategories(payload, file, out);
        else if (name === QUOTES) this._applyQuotes(payload, file, out);
        else if (name.startsWith('e-') && ID_RE.test(name.slice(2)) && payload.id === name.slice(2)) this._applyEntry(name, payload, file, out);
        save();
      }

      // 2. What changed here
      for (const m of vault.list()) {
        const name = 'e-' + m.id, base = st.items[name];
        if (base && !base.d && base.u === m.updated) continue;
        if (this.held.has(m.id) && base) continue;
        const entry = vault.get(m.id);
        await this._put(name, entry, out);
        st.items[name].u = entry.updated;
        save();
      }
      for (const [name, base] of Object.entries(st.items)) {
        if (!name.startsWith('e-') || base.d || vault.index.has(name.slice(2))) continue;
        await this._put(name, { id: name.slice(2), deleted: true, updated: new Date().toISOString() }, out);
        st.items[name].d = true; st.items[name].u = '';
        save();
      }
      const meta = vault.getMeta();
      const catsAt = meta.categoriesUpdated || '';
      if (catsAt && (!st.items[CATS] || st.items[CATS].u !== catsAt)) {
        await this._put(CATS, { categories: meta.categories || [], updated: catsAt }, out);
        st.items[CATS].u = catsAt;
        save();
      }
      // Quotes: a device that has never synced them sends what it has (merged with anything already there).
      let q = vault.quotesForSync();
      if (!q.updated && !byName.has(QUOTES)) { vault.setQuotes(vault.getQuotes()); q = vault.quotesForSync(); }
      if (q.updated && (!st.items[QUOTES] || st.items[QUOTES].u !== q.updated)) {
        await this._put(QUOTES, q, out);
        st.items[QUOTES].u = q.updated;
        save();
      }
      return out;
    } finally { key.fill(0); }
  }

  async _put(name, payload, out) {
    const st = this.st, key = this._key();
    const data = seal(key, Buffer.from(JSON.stringify(payload)));
    key.fill(0);
    const prev = st.items[name];
    let r;
    try { r = await this.drive.putFile(st.folder, name, data, prev && prev.f); }
    catch (e) {
      if (!(prev && prev.f && e.status === 404)) throw e;
      r = await this.drive.putFile(st.folder, name, data);   // someone deleted it from Drive: make it again
    }
    st.items[name] = { f: r.id, r: r.version, u: payload.deleted ? '' : payload.updated, d: !!payload.deleted };
    out.sent++;
  }

  _applyEntry(name, p, file, out) {
    const st = this.st, vault = this.vault, id = p.id;
    const base = st.items[name];
    const local = vault.index.get(id);
    const here = local ? local.updated : GONE;
    const there = p.deleted ? GONE : String(p.updated || '');
    const record = sig => { st.items[name] = { f: file.id, r: file.version, u: sig === GONE ? '' : sig, d: sig === GONE }; };
    const bring = () => {
      if (p.deleted) { if (local) { vault.remove(id); out.removed.push(id); out.changed.push(id); } }
      else { vault.save({ ...p, keepUpdated: true }); out.changed.push(id); }
      record(there);
    };
    if (local && this.held.has(id)) return;                          // open and being edited: wait
    if (here === there) { record(there); return; }
    const baseSig = base ? (base.d ? GONE : base.u) : undefined;
    if (baseSig === undefined) {
      // First time this device sees it: the newer one wins. (A deletion counts from when it happened.)
      if (!local) { if (!p.deleted) bring(); else record(there); return; }
      const remoteTime = String(p.updated || '');
      if (remoteTime > local.updated) bring(); else record(there);    // ours is newer: it gets sent in step 2
      return;
    }
    if (here === baseSig) { bring(); return; }                        // only Drive changed
    // Changed in both places.
    if (p.deleted) { record(there); return; }                         // edited here, deleted there: keep it (sent in step 2)
    if (!local) { bring(); return; }                                  // deleted here, edited there: the edit wins
    // "Both edited", but they say the same thing (saved again without a change, or the same change twice): no copy.
    let mine = null;
    try { mine = vault.get(id); } catch {}
    if (mine && sameEntry(mine, p)) { if (there > here) bring(); else record(there); return; }
    // Both edited: yours stays; theirs is kept beside it as a copy.
    const copy = vault.save({ ...p, id: crypto.randomUUID(), title: `${p.title || p.date} (from another device)`, keepUpdated: true });
    out.copies.push(copy.id); out.changed.push(copy.id);
    record(there);
  }

  _applyCategories(p, file, out) {
    const st = this.st, vault = this.vault;
    const mine = vault.getMeta().categoriesUpdated || '';
    const theirs = String(p.updated || '');
    if (theirs > mine && Array.isArray(p.categories)) { vault.setCategories(p.categories, theirs); out.categories = true; }
    st.items[CATS] = { f: file.id, r: file.version, u: theirs >= mine ? theirs : (st.items[CATS] ? st.items[CATS].u : '') };
  }

  _applyQuotes(p, file, out) {
    const st = this.st, vault = this.vault;
    const mine = vault.quotesForSync().updated;
    const theirs = String(p.updated || '');
    if (!mine) {
      // This device's first time: keep both sets, then send the result.
      vault.applySyncedQuotes(p, new Date().toISOString(), { merge: true });
      out.quotes = true;
      st.items[QUOTES] = { f: file.id, r: file.version, u: '' };
      return;
    }
    if (theirs > mine) { vault.applySyncedQuotes(p, theirs); out.quotes = true; }
    st.items[QUOTES] = { f: file.id, r: file.version, u: theirs >= mine ? theirs : (st.items[QUOTES] ? st.items[QUOTES].u : '') };
  }
}

module.exports = { Sync, KEY_FILE };
