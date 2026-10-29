'use strict';
/**
 * Automatic backups: decides when one is due and writes it to Google Drive or
 * a folder (USB drive, OneDrive, network share...). Backups are the same
 * encrypted .daybook files as "Save a backup", so they are safe anywhere.
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

  status() {
    try { return JSON.parse(fs.readFileSync(this.statusFile, 'utf8')); } catch { return {}; }
  }
  _setStatus(patch) {
    const s = { ...this.status(), ...patch };
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.statusFile, JSON.stringify(s, null, 2));
    return s;
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

  /** Why a backup can't run with the current settings, or '' if it can. */
  blocker(settings = this.getSettings()) {
    if (!this.vault.exists()) return 'No journal yet';
    if (settings.backupTarget === 'google') {
      if (!this.drive.available()) return 'Google Drive is not available in this version';
      if (!this.drive.status().connected) return 'Connect Google Drive to start backing up';
    } else if (!settings.backupDir) return 'Choose a folder to back up to';
    return '';
  }

  isDue(reason, settings = this.getSettings()) {
    if (!settings.autoBackup || this.blocker(settings)) return false;
    const st = this.status();
    if (st.lastSig && st.lastSig === this.signature() && st.lastTarget === targetKey(settings)) return false; // nothing new
    const now = this.now();
    // After a failure, wait a while before trying the same thing again.
    const sameProblem = st.lastError && st.lastErrorAt && st.lastErrorCode !== 'setup' && st.lastErrorTarget === targetKey(settings);
    if (sameProblem && now - new Date(st.lastErrorAt) < RETRY_AFTER_ERROR_MS && !['close', 'connected'].includes(reason)) return false;
    if (!st.lastAt) return true;
    const last = new Date(st.lastAt);
    switch (settings.backupEvery) {
      case 'close': return reason === 'close';
      case 'weekly': return now - last >= 7 * 864e5 - 36e5;
      default: return localDay(now) !== localDay(last); // daily
    }
  }

  async maybeRun(reason) {
    if (this.running || !this.isDue(reason)) return null;
    return this.run(reason);
  }

  /** Back up now, whatever the schedule says. Concurrent calls share one run. */
  run(reason = 'manual') {
    if (this.running) return this.running;
    this.running = this._run(reason).finally(() => { this.running = null; });
    return this.running;
  }

  async _run(reason) {
    const settings = this.getSettings();
    const target = targetKey(settings);
    const why = this.blocker(settings);
    if (why) return this._fail(why, reason, target, 'setup');
    const when = this.now();
    const name = backupName(when);
    const sig = this.signature();
    try {
      let count, where, pruned = 0;
      if (settings.backupTarget === 'google') {
        const tmp = path.join(this.tmpDir, `daybook-${crypto.randomBytes(6).toString('hex')}.daybook`);
        try {
          count = this.vault.exportBackup(tmp);
          await this.drive.upload(tmp, name);
        } finally { try { fs.unlinkSync(tmp); } catch {} }
        try { pruned = await this.drive.prune(settings.backupKeep); } catch { /* keep going: the backup itself worked */ }
        where = 'Google Drive';
      } else {
        const dir = settings.backupDir;
        ensureFolder(dir);
        count = this.vault.exportBackup(path.join(dir, name));
        pruned = pruneFolder(dir, settings.backupKeep);
        where = dir;
      }
      const s = this._setStatus({
        lastAt: when.toISOString(), lastCount: count, lastName: name, lastWhere: where, lastTarget: target,
        lastSig: sig, lastError: '', lastErrorAt: '', lastErrorCode: '',
      });
      const result = { ok: true, reason, count, where, pruned, status: s };
      this.onResult(result);
      return result;
    } catch (e) {
      return this._fail(friendly(e, settings), reason, target, e.code || '');
    }
  }

  _fail(message, reason, target, code) {
    const s = this._setStatus({ lastError: message, lastErrorAt: this.now().toISOString(), lastErrorCode: code, lastErrorTarget: target });
    const result = { ok: false, reason, error: message, code, status: s };
    this.onResult(result);
    return result;
  }
}

const targetKey = s => (s.backupTarget === 'google' ? 'google' : 'folder:' + (s.backupDir || ''));

function friendly(e, settings) {
  const m = e && e.message ? e.message : String(e);
  if (settings.backupTarget !== 'google') {
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

/** Folders worth suggesting on Windows: Google Drive for desktop, OneDrive, Dropbox. */
function suggestFolders({ env = process.env, exists = fs.existsSync, platform = process.platform } = {}) {
  const out = [];
  const add = (label, base) => { if (base && exists(base) && !out.some(o => o.base === base)) out.push({ label, base, path: path.join(base, 'Daybook backups') }); };
  const home = env.USERPROFILE || env.HOME || '';
  if (platform === 'win32') {
    for (const L of 'GHIJKLMNOPDEFQRSTUVWXYZ') add('Google Drive', `${L}:\\My Drive`);
  }
  add('Google Drive', home && path.join(home, 'Google Drive'));
  add('Google Drive', home && path.join(home, 'My Drive'));
  add('OneDrive', env.OneDrive || env.OneDriveConsumer || env.OneDriveCommercial);
  add('Dropbox', home && path.join(home, 'Dropbox'));
  return out;
}

module.exports = { BackupManager, backupName, pruneFolder, suggestFolders, AUTO_NAME_RE };
