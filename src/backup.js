'use strict';
/**
 * Automatic backups to Google Drive, a folder on this computer (or USB/network
 * drive), or both. Each destination keeps its own schedule state, so one being
 * offline never holds up the other. Backups are the same encrypted .daybook
 * files as "Save a backup file", so they are safe anywhere.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const AUTO_NAME_RE = /^Daybook backup \d{4}-\d{2}-\d{2} \d{4}\.daybook$/;
const pad = n => String(n).padStart(2, '0');
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const backupName = d => `Daybook backup ${localDay(d)} ${pad(d.getHours())}${pad(d.getMinutes())}.daybook`;
const RETRY_AFTER_ERROR_MS = 30 * 60 * 1000;
const DESTS = ['google', 'folder'];

class BackupManager {
  constructor({ vault, dataDir, drive, getSettings, onResult = () => {}, now = () => new Date(), tmpDir = os.tmpdir() }) {
    this.vault = vault;
    this.dataDir = dataDir;
    this.drive = drive;
    this.getSettings = getSettings;
    this.onResult = onResult;
    this.now = now;
    this.tmpDir = tmpDir;
    this.statusFile = path.join(dataDir, 'backup-status.json');
    this.running = null;
  }

  /** { google: {...}, folder: {...} } — per-destination history. */
  status() {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(this.statusFile, 'utf8')); } catch {}
    return { google: s.google || {}, folder: s.folder || {} };
  }
  _setStatus(dest, patch) {
    const all = this.status();
    all[dest] = { ...all[dest], ...patch };
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.statusFile, JSON.stringify(all, null, 2));
    return all;
  }

  /** History for a destination, ignoring folder history from a different folder. */
  destStatus(dest, settings = this.getSettings()) {
    const st = this.status()[dest];
    if (dest === 'folder' && st.dir !== settings.backupDir) return {};
    return st;
  }

  /** Fingerprint of the journal files, so unchanged journals aren't backed up again. */
  signature() {
    const h = crypto.createHash('sha256');
    const add = f => { try { const st = fs.statSync(f); h.update(`${path.basename(f)}:${st.size}:${st.mtimeMs}\n`); } catch {} };
    add(this.vault.vaultFile);
    let names = [];
    try { names = fs.readdirSync(this.vault.entriesDir).filter(f => f.endsWith('.enc')).sort(); } catch {}
    for (const n of names) add(path.join(this.vault.entriesDir, n));
    return h.update(String(names.length)).digest('hex');
  }

  enabled(settings = this.getSettings()) {
    return DESTS.filter(d => (d === 'google' ? settings.backupToGoogle : settings.backupToFolder));
  }

  /** Why a destination can't be backed up to right now, or '' if it can. */
  blocker(dest, settings = this.getSettings()) {
    if (!this.vault.exists()) return 'No journal yet';
    if (dest === 'google') {
      if (!this.drive.available()) return 'Google Drive is not available in this version';
      if (!this.drive.status().connected) return 'Connect Google Drive to start backing up';
    } else if (!settings.backupDir) return 'Choose a folder to back up to';
    return '';
  }

  isDueFor(dest, reason, settings = this.getSettings(), sig = this.signature()) {
    if (!this.enabled(settings).includes(dest) || this.blocker(dest, settings)) return false;
    const st = this.destStatus(dest, settings);
    if (st.lastSig && st.lastSig === sig) return false; // nothing new since the last good backup
    const now = this.now();
    // After a failure, wait a while before trying the same thing again.
    if (st.lastError && st.lastErrorAt && now - new Date(st.lastErrorAt) < RETRY_AFTER_ERROR_MS && !['close', 'connected'].includes(reason)) return false;
    if (!st.lastAt) return true;
    const last = new Date(st.lastAt);
    switch (settings.backupEvery) {
      case 'close': return reason === 'close';
      case 'weekly': return now - last >= 7 * 864e5 - 36e5;
      default: return localDay(now) !== localDay(last); // daily
    }
  }

  dueDests(reason, settings = this.getSettings()) {
    const sig = this.signature();
    return this.enabled(settings).filter(d => this.isDueFor(d, reason, settings, sig));
  }

  isDue(reason) { return this.dueDests(reason).length > 0; }

  async maybeRun(reason) {
    if (this.running) return null;
    const dests = this.dueDests(reason);
    return dests.length ? this.run(reason, dests) : null;
  }

  /** Back up now to the given destinations (default: every one switched on). */
  run(reason = 'manual', dests) {
    if (this.running) return this.running;
    this.running = this._run(reason, dests).finally(() => { this.running = null; });
    return this.running;
  }

  async _run(reason, dests) {
    const settings = this.getSettings();
    dests = dests || this.enabled(settings);
    if (!dests.length) {
      const r = { ok: false, reason, error: 'Choose Google Drive or a folder to back up to', code: 'setup', results: [] };
      this.onResult(r); return r;
    }
    const when = this.now();
    const name = backupName(when);
    const sig = this.signature();
    const results = [];
    let tmp = null, count = 0;
    try {
      for (const dest of dests) {
        const why = this.blocker(dest, settings);
        if (why) {
          this._setStatus(dest, { lastError: why, lastErrorAt: when.toISOString(), lastErrorCode: 'setup', dir: dest === 'folder' ? settings.backupDir : undefined });
          results.push({ dest, ok: false, error: why, code: 'setup' });
          continue;
        }
        try {
          if (!tmp) {
            tmp = path.join(this.tmpDir, `daybook-${crypto.randomBytes(6).toString('hex')}.daybook`);
            count = this.vault.exportBackup(tmp);
          }
          let where;
          if (dest === 'google') {
            await this.drive.upload(tmp, name);
            try { await this.drive.prune(settings.backupKeep); } catch { /* the backup itself worked */ }
            where = 'Google Drive';
          } else {
            const dir = settings.backupDir;
            ensureFolder(dir);
            const part = path.join(dir, name + '.part');
            fs.copyFileSync(tmp, part);
            fs.renameSync(part, path.join(dir, name));
            pruneFolder(dir, settings.backupKeep);
            where = dir;
          }
          this._setStatus(dest, {
            lastAt: when.toISOString(), lastCount: count, lastName: name, lastWhere: where, lastSig: sig,
            lastError: '', lastErrorAt: '', lastErrorCode: '', dir: dest === 'folder' ? settings.backupDir : undefined,
          });
          results.push({ dest, ok: true, count, where });
        } catch (e) {
          const msg = friendly(e, dest, settings);
          this._setStatus(dest, { lastError: msg, lastErrorAt: when.toISOString(), lastErrorCode: e.code === 'reauth' ? 'reauth' : (e.code || ''), dir: dest === 'folder' ? settings.backupDir : undefined });
          results.push({ dest, ok: false, error: msg, code: e.code || '' });
        }
      }
    } finally { if (tmp) try { fs.unlinkSync(tmp); } catch {} }

    const failed = results.filter(r => !r.ok);
    const done = results.filter(r => r.ok);
    const r = {
      ok: failed.length === 0, reason, results, count,
      where: done.map(x => x.where).join(' and '),
      error: failed.map(f => (dests.length > 1 ? `${label(f.dest)}: ` : '') + f.error).join(' '),
      code: (failed.find(f => f.code === 'reauth') || failed[0] || {}).code || '',
    };
    this.onResult(r);
    return r;
  }
}

const label = d => (d === 'google' ? 'Google Drive' : 'This computer');

function friendly(e, dest, settings) {
  const m = e && e.message ? e.message : String(e);
  if (dest === 'folder') {
    if (e.code === 'ENOENT' || /no such file|cannot find/i.test(m)) return `Couldn't find the backup folder ${settings.backupDir}. If it's on a USB or network drive, check it's connected.`;
    if (e.code === 'ENOSPC') return 'The backup drive is full.';
    if (e.code === 'EACCES' || e.code === 'EPERM') return `Daybook isn't allowed to write to ${settings.backupDir}. Choose another folder.`;
  } else if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network|ERR_INTERNET|ERR_NAME/i.test(m)) {
    return "Couldn't reach Google Drive. Daybook will try again when you're online.";
  }
  return m;
}

/** Create the backup folder only if its parent exists (so a missing USB drive isn't "created"). */
function ensureFolder(dir) {
  if (fs.existsSync(dir)) return;
  const parent = path.dirname(dir);
  if (!fs.existsSync(parent)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; }
  fs.mkdirSync(dir);
}

/** Delete all but the newest `keep` automatic backups. Never touches other files. */
function pruneFolder(dir, keep) {
  if (!keep || keep < 1) return 0;
  const auto = fs.readdirSync(dir).filter(n => AUTO_NAME_RE.test(n)).sort().reverse();
  let n = 0;
  for (const name of auto.slice(keep)) { try { fs.unlinkSync(path.join(dir, name)); n++; } catch {} }
  return n;
}

/** Cloud-synced folders worth suggesting on Windows: OneDrive, Dropbox. */
function suggestFolders({ env = process.env, exists = fs.existsSync } = {}) {
  const out = [];
  const add = (label, base) => { if (base && exists(base) && !out.some(o => o.base === base)) out.push({ label, base, path: path.join(base, 'Daybook backups') }); };
  const home = env.USERPROFILE || env.HOME || '';
  add('OneDrive', env.OneDrive || env.OneDriveConsumer || env.OneDriveCommercial);
  add('Dropbox', home && path.join(home, 'Dropbox'));
  return out;
}

module.exports = { BackupManager, backupName, pruneFolder, suggestFolders, AUTO_NAME_RE };
