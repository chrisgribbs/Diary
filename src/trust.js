'use strict';
/**
 * "Remember my password": keeps the journal's key protected by Windows (DPAPI,
 * via Electron's safeStorage), so WellWrite can open without the password.
 *
 *  - mode 'hour':  for one hour after the password was last typed
 *  - mode 'trust': on this computer, until turned off
 *
 * The key only works for this Windows user on this computer; copied elsewhere it is useless.
 * A check value proves the stored key still matches the journal (e.g. after a restore).
 */
const fs = require('fs');
const { _internal: { seal, open } } = require('./vault');

const HOUR = 60 * 60 * 1000;
const CHECK = Buffer.from('wellwrite-trust-check');

class Trust {
  constructor({ file, protect, unprotect, available, now = () => Date.now() }) {
    Object.assign(this, { file, protect, unprotect, available, now });
  }

  _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; } }
  _write(d) { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, this.file); }

  clear() { try { fs.unlinkSync(this.file); } catch {} }

  status() {
    const available = !!this.available();
    const d = this._read();
    if (!d || !available) return { mode: 'ask', active: false, available };
    if (d.mode === 'hour' && !(d.until > this.now())) return { mode: 'hour', active: false, available, expired: true };
    return { mode: d.mode, active: true, until: d.mode === 'hour' ? d.until : null, available };
  }

  /** Remember the key (mode 'hour' or 'trust'), or forget it ('ask'). */
  save(mode, key) {
    if (mode !== 'hour' && mode !== 'trust') { this.clear(); return this.status(); }
    if (!this.available()) throw new Error('Windows can’t protect a saved password on this computer');
    if (!key) throw new Error('Open the journal first');
    this._write({
      mode,
      until: mode === 'hour' ? this.now() + HOUR : null,
      key: this.protect(Buffer.from(key).toString('base64')),
      check: seal(key, CHECK).toString('base64'),
    });
    return this.status();
  }

  /** After the password is typed: restart the hour (keeps the setting for next time). */
  refresh(key) {
    const d = this._read();
    if (d && d.mode === 'hour') this.save('hour', key);
  }

  /** The remembered key, if it's still valid and matches the journal; otherwise null. */
  key() {
    const st = this.status();
    if (!st.active) return null;
    try {
      const d = this._read();
      const key = Buffer.from(this.unprotect(d.key), 'base64');
      if (!open(key, Buffer.from(d.check, 'base64')).equals(CHECK)) throw new Error('mismatch');
      return key;
    } catch {
      this.clear(); // can't be read here, or belongs to a different journal
      return null;
    }
  }
}

module.exports = { Trust, HOUR };
