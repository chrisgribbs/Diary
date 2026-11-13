'use strict';
// Everything WellWrite does behind the page, shared by the Windows app (main.js) and the Android app
// (android/node/main.js). Each platform supplies the few things that differ: where the journal lives,
// how secrets are protected on this device, how to fetch from the web, and how to talk to the page.
// WellWrite is free. If it is ever sold, set this to true: built-in readings licensed for non-commercial use only
// (the CC BY-NC-ND daily prayers; see src/readings/PRAYERS-LICENCE.md) then stop loading.
const COMMERCIAL = false;
const path = require('path');
const fs = require('fs');
const { Vault } = require('./vault');
const { ApiBible } = require('./apibible');
const { WordPress } = require('./wordpress');
const { BOOKS } = require('./bible-books');
const bible = require('./bible');
const { Trust } = require('./trust');
const { GoogleDrive } = require('./gdrive');
const { Sync } = require('./sync');
const prayer = require('./prayer');
const { BackupManager, suggestFolders } = require('./backup');

const ROOT = path.join(__dirname, '..');
const APP_VERSION = require('../package.json').version;

const DEFAULT_SETTINGS = {
  autoLockMinutes: 10, lockOnMinimize: false, theme: 'system', fontSize: 19, spellcheck: true, showQuote: true, dailyCard: 'both', quoteFrom: '', quotePlan: 'christian', builtinReadings: true, classicsReadings: true, prayersReadings: true, dailyPrayer: true, shareName: '', readingsFile: '', weekPictures: true, shownBoth: true,
  backupToGoogle: false, backupToFolder: false, backupDir: '', backupEvery: 'daily', backupKeep: 10, backupNudgeDismissed: false,
  // the prayer bell (prayer.js), per device
  prayerBell: false, prayerTimes: {}, prayerHoursOn: {}, prayerDays: 'every', prayerSound: 'bell', prayerMutedOn: '', startWithWindows: false, prayerTrayTold: false,
};
const CHOICES = {
  theme: ['system', 'light', 'dark'],
  backupEvery: ['daily', 'weekly', 'close'],
  backupKeep: [5, 10, 30, 0],
  dailyCard: ['quote', 'verse', 'both', 'none'],
  quotePlan: ['christian', 'spiritual', 'off'],
  prayerDays: ['every', 'weekdays'],
  prayerSound: ['bell', 'silent'],
};

/**
 * platform: {
 *   dataDir,                       the journal folder
 *   deviceDir?,                    this device's own settings and saved secrets (defaults to dataDir)
 *   tmpDir,
 *   canProtect(): bool, protect(s): string, unprotect(s): string   keep secrets safe on this device
 *   testTrust?: bool               (tests only) store secrets without the device's protection
 *   fetch(url, opts)               web requests
 *   send(event, ...args)           tell the page something happened
 *   openBrowser(url)               for Google sign-in
 *   onSettings?(settings)          the settings changed (theme, spelling)
 *   googleConfig?                  { clientId, clientSecret } or null
 *   apiBibleBase?, picturesUrl?    (tests only)
 * }
 */
function createBackend(platform) {
  const DATA_DIR = platform.dataDir;
  const DEVICE_DIR = platform.deviceDir || DATA_DIR;
  const SETTINGS_FILE = path.join(DEVICE_DIR, 'settings.json');
  const vault = new Vault(DATA_DIR);
  const handlers = new Map();
  const handle = (name, fn) => handlers.set(name, fn);
  const send = (...a) => { try { platform.send(...a); } catch {} };

  // ---------- settings ----------
  function readSettings() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
    catch { return { ...DEFAULT_SETTINGS }; }
    const s = { ...DEFAULT_SETTINGS, ...raw };
    // 1.9: the quote and the verse above the journal are both shown by default (once; your later choice is kept).
    if (raw.shownBoth === undefined) { s.shownBoth = true; if (s.dailyCard === 'quote') s.dailyCard = 'both'; try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); } catch {} }
    return s;
  }
  function writeSettings(s, { internal = false } = {}) {
    fs.mkdirSync(DEVICE_DIR, { recursive: true });
    const clean = { ...readSettings() };
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (!(k in s) || typeof s[k] !== typeof DEFAULT_SETTINGS[k]) continue;
      if ((k === 'backupDir' || k === 'readingsFile') && !internal) continue; // only set through the pickers
      if (CHOICES[k] && !CHOICES[k].includes(s[k])) continue;
      if (k === 'prayerTimes' || k === 'prayerHoursOn') {   // only the hours there are, with sensible values
        const c = prayer.config({ [k]: s[k] }), v = {};
        for (const h of c.hours) if (k in s && s[k] && h.key in s[k]) v[h.key] = k === 'prayerTimes' ? h.time : h.on;
        clean[k] = v; continue;
      }
      if (k === 'prayerMutedOn' && s[k] && !/^\d{4}-\d{2}-\d{2}$/.test(s[k])) continue;
      if (k === 'shareName') { clean[k] = String(s[k]).replace(/\s+/g, ' ').trim().slice(0, 80); continue; }
      clean[k] = s[k];
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(clean, null, 2));
    if (platform.onSettings) platform.onSettings(clean);
    return clean;
  }

  // ---------- secrets kept on this device ----------
  const testTrust = !!platform.testTrust;
  const trust = new Trust({
    file: path.join(DEVICE_DIR, 'trusted.json'),
    available: () => platform.canProtect() || testTrust,
    protect: t => (platform.canProtect() ? 'os:' + platform.protect(t) : 'test:' + t),
    unprotect: t => (t.startsWith('os:') ? platform.unprotect(t.slice(3)) : testTrust ? t.replace(/^test:/, '') : ''),
  });
  const drive = new GoogleDrive({
    config: platform.googleConfig || null,
    storeFile: path.join(DEVICE_DIR, 'google.json'),
    protect: t => (platform.canProtect() ? 'os:' + platform.protect(t) : 'plain:' + Buffer.from(t).toString('base64')),
    unprotect: t => (t.startsWith('os:') ? platform.unprotect(t.slice(3)) : Buffer.from(t.replace(/^plain:/, ''), 'base64').toString()),
    openBrowser: url => platform.openBrowser(url),
    backToApp: platform.backToApp || '',
    fetch: (...a) => platform.fetch(...a),
    endpoints: platform.googleBase ? { auth: platform.googleBase + '/auth', token: platform.googleBase + '/token', revoke: platform.googleBase + '/revoke', api: platform.googleBase + '/drive/v3', upload: platform.googleBase + '/upload/drive/v3' } : undefined,
  });
  // ---------- sync between your devices (sync.js) ----------
  const sync = new Sync({ vault, drive, dataDir: DATA_DIR, send });
  // Starts when the journal opens, stops when it locks (however that happens), and runs soon after any change.
  for (const fn of ['unlock', 'unlockWithKey', 'create', 'restoreFresh']) {
    const orig = vault[fn].bind(vault);
    vault[fn] = (...a) => { const r = orig(...a); if (vault.isUnlocked()) { sync.st = null; sync.start(); } return r; };
  }
  { const orig = vault.lock.bind(vault); vault.lock = () => { sync.stop(); orig(); }; }
  for (const fn of ['save', 'remove', 'setCategories', 'recategorize', 'setQuotes']) {
    const orig = vault[fn].bind(vault);
    vault[fn] = (...a) => { const r = orig(...a); sync.touch(); return r; };
  }
  // ---------- problems log: error messages and what the app was doing, never entries ----------
  const LOG = platform.logFile || path.join(DEVICE_DIR, 'logs', 'wellwrite.log');
  const log = msg => {
    try {
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      try { if (fs.statSync(LOG).size > 200 * 1024) fs.renameSync(LOG, LOG + '.old'); } catch {}
      fs.appendFileSync(LOG, `${new Date().toISOString()} ${APP_VERSION} ${String(msg).replace(/\s+/g, ' ').slice(0, 600)}\n`);
    } catch {}
  };
  handle('app:log', msg => { log(msg); return true; });
  handle('app:readLog', () => { try { return fs.readFileSync(LOG, 'utf8').split('\n').slice(-300).join('\n'); } catch { return ''; } });

  handle('sync:status', () => sync.status());
  handle('sync:enable', async pw => { await sync.enable(String(pw || '')); return sync.status(); });
  handle('sync:disable', () => sync.disable());
  handle('sync:now', async () => { await sync.run('manual'); return sync.status(); });
  handle('sync:hold', id => { sync.hold(typeof id === 'string' ? id : ''); return true; });

  const publicResult = r => ({ ok: r.ok, reason: r.reason, error: r.error || '', code: r.code || '', count: r.count, where: r.where || '' });
  const backups = new BackupManager({
    vault, dataDir: DATA_DIR, drive, getSettings: readSettings, tmpDir: platform.tmpDir,
    onResult: r => send('backup:result', publicResult(r)),
  });
  function backupInfo() {
    const s = readSettings();
    const pick = st => ({ lastAt: st.lastAt || '', lastCount: st.lastCount || 0, lastWhere: st.lastWhere || '', lastError: st.lastError || '', lastErrorAt: st.lastErrorAt || '', lastErrorCode: st.lastErrorCode || '' });
    return {
      settings: { backupToGoogle: s.backupToGoogle, backupToFolder: s.backupToFolder, backupDir: s.backupDir, backupEvery: s.backupEvery, backupKeep: s.backupKeep, backupNudgeDismissed: s.backupNudgeDismissed },
      status: { google: pick(backups.destStatus('google', s)), folder: pick(backups.destStatus('folder', s)) },
      blockers: { google: backups.blocker('google', s), folder: backups.blocker('folder', s) },
      google: drive.status(),
      suggestions: suggestFolders(),
      running: !!backups.running,
    };
  }
  const secretStore = file => ({
    file: path.join(DEVICE_DIR, file),
    available: () => testTrust || platform.canProtect(),
    protect: s => testTrust ? 't:' + Buffer.from(s).toString('base64') : platform.protect(s),
    unprotect: s => s.startsWith('t:') ? Buffer.from(s.slice(2), 'base64').toString() : platform.unprotect(s),
    fetch: (url, opts) => platform.fetch(url, opts),
  });

  // ---------- the journal ----------
  const startBackupSoon = () => setTimeout(() => backups.maybeRun('unlock').catch(() => {}), 5000);
  handle('vault:status', () => ({ exists: vault.exists(), unlocked: vault.isUnlocked(), dataDir: DATA_DIR, trust: trust.status() }));
  handle('vault:create', pw => { vault.create(pw); return true; });
  handle('vault:unlock', pw => {
    const ok = vault.unlock(pw);
    if (ok) { try { trust.refresh(vault.key); } catch {} startBackupSoon(); }
    return ok;
  });
  handle('vault:unlockTrusted', () => {
    if (vault.isUnlocked()) return true;
    if (!vault.exists()) return false;
    const key = trust.key();
    if (!key) return false;
    vault.unlockWithKey(key);
    startBackupSoon();
    return true;
  });
  handle('vault:setTrust', mode => trust.save(mode, vault.key));
  handle('vault:lock', () => { vault.lock(); return true; });
  handle('vault:changePassword', (a, b) => { vault.changePassword(a, b); sync.passwordChanged(b); return true; });
  handle('entries:list', () => vault.list());
  handle('entries:get', id => vault.get(id));
  handle('entries:save', e => vault.save(e));
  handle('entries:remove', id => { vault.remove(id); return true; });
  handle('categories:get', () => vault.getMeta().categories);
  handle('categories:set', list => vault.setCategories(list).categories);
  handle('categories:move', (fromId, toId) => vault.recategorize(fromId, toId || ''));

  // ---------- Bible versions: WEB and KJV built in; more from API.Bible with your own key ----------
  // WellWrite's shared Bible relay (relay/worker.mjs): its address is put in at build time (src/relay-config.json).
  const bibleRelay = platform.bibleRelay !== undefined ? platform.bibleRelay
    : process.env.WELLWRITE_BIBLE_RELAY || (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'relay-config.json'), 'utf8')).bible || ''; } catch { return ''; } })();
  const apiBible = new ApiBible({
    relay: /^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(bibleRelay) || /^http:\/\/127\.0\.0\.1:\d+$/.test(bibleRelay) ? bibleRelay : '',
    ...secretStore('apibible.json'),
    ...(platform.apiBibleBase ? { base: platform.apiBibleBase, fums: platform.apiBibleBase + '/fums' } : {}),
  });
  const apiId = tr => (typeof tr === 'string' && tr.startsWith('api:') ? tr.slice(4) : null);
  const builtinTr = tr => (tr === 'kjv' ? 'kjv' : 'web');
  function translations() {
    const out = { ...bible.TRANSLATIONS };
    for (const v of apiBible.versions()) out['api:' + v.id] = v.name + (v.abbr ? ` (${v.abbr})` : '');
    return out;
  }
  /** A verse in any version; if API.Bible can't be reached, the built-in WEB text with a note. */
  async function verseIn(ref, tr) {
    const id = apiId(tr);
    if (!id) return bible.verseText(ref, builtinTr(tr));
    try { const v = await apiBible.passage(id, ref); if (v) return v; } catch (e) { const w = bible.verseText(ref, 'web'); return w && { ...w, fallback: e.message }; }
    return bible.verseText(ref, 'web');
  }
  handle('bible:info', () => ({ plans: bible.planList(), translations: translations(), state: vault.getBible() }));
  handle('bible:setState', st => vault.setBible(st));
  handle('bible:reading', async (plan, day, translation) => {
    const id = apiId(translation);
    if (!id) return bible.reading(plan, day, builtinTr(translation));
    const base = bible.reading(plan, day, 'web');
    try {
      let copyright = '';
      const chapters = [];
      for (const [b, c] of bible.planDay(plan, day)) {
        const ch = await apiBible.chapter(id, b, c);
        copyright = copyright || ch.copyright;
        chapters.push({ book: BOOKS[b].name, chapter: c, blocks: ch.blocks });
      }
      const v = apiBible.versions().find(x => x.id === id) || {};
      return { ...base, translation: v.abbr || v.name || id, copyright, chapters };
    } catch (e) { return { ...base, fallback: e.message }; }
  });
  handle('bible:verseOfDay', async (dayNumber, translation) => {
    const i = ((dayNumber % bible.VERSES.length) + bible.VERSES.length) % bible.VERSES.length;
    return verseIn(bible.VERSES[i], translation);
  });
  handle('bible:books', () => bible.books());
  handle('bible:parseRef', text => bible.parseRef(String(text || '').slice(0, 60)));
  handle('bible:chapter', async (translation, bookIndex, chapterNumber) => {
    const id = apiId(translation), b = +bookIndex, c = +chapterNumber;
    const base = bible.chapter('web', b, c);
    if (!base) return null;
    if (!id) return bible.chapter(builtinTr(translation), b, c);
    try {
      const ch = await apiBible.chapter(id, b, c);
      const v = apiBible.versions().find(x => x.id === id) || {};
      return { ...base, translation: v.abbr || v.name || id, copyright: ch.copyright, blocks: ch.blocks };
    } catch (e) { return { ...base, fallback: e.message }; }
  });
  handle('bible:search', async (translation, query, offset = 0) => {
    const id = apiId(translation);
    if (!id) return bible.search(builtinTr(translation), query, 60, +offset || 0);
    try { return await apiBible.search(id, query, 60, +offset || 0); }
    catch (e) { return { ...bible.search('web', query, 60, +offset || 0), fallback: e.message }; }
  });
  handle('bible:verses', (refs, translation) => Promise.all((Array.isArray(refs) ? refs.slice(0, 20) : []).map(r => verseIn(String(r), translation))));
  handle('apibible:status', () => apiBible.status());
  handle('apibible:sharedDefaults', () => apiBible.sharedDefaults());
  handle('apibible:setKey', key => apiBible.setKey(key));
  handle('apibible:forget', () => { const st = vault.isUnlocked() ? vault.getBible() : null; if (st && apiId(st.translation)) vault.setBible({ ...st, translation: 'web' }); return apiBible.forget(); });
  handle('apibible:list', language => apiBible.list(typeof language === 'string' ? language.slice(0, 8) : 'eng'));
  handle('apibible:setVersions', list => {
    const r = apiBible.setVersions(list);
    const st = vault.isUnlocked() ? vault.getBible() : null;   // a version you removed can't stay chosen
    if (st && apiId(st.translation) && !r.versions.some(v => v.id === apiId(st.translation))) vault.setBible({ ...st, translation: 'web' });
    return r;
  });

  // ---------- WordPress ----------
  const wordpress = new WordPress(secretStore('wordpress.json'));
  handle('wp:status', () => wordpress.status());
  handle('wp:connect', (site, user, password) => wordpress.connect(site, user, password));
  handle('wp:forget', () => wordpress.forget());
  handle('wp:record', entryId => vault.wpRecord(String(entryId)));
  handle('wp:links', () => vault.wpLinks());
  handle('wp:publish', async (entryId, payload) => {
    entryId = String(entryId);
    const rec = await wordpress.publish(payload || {}, vault.wpRecord(entryId) || {});
    return vault.setWpRecord(entryId, rec);
  });
  /** A link on your own WordPress site (anything else is refused). */
  const wpLinkOk = url => { const st = wordpress.status(); return typeof url === 'string' && !!st.site && url.startsWith(new URL(st.site).origin); };

  // ---------- a picture for each week ----------
  // WellWrite's own choice (public-domain art and photos, fetched once from Wikimedia Commons and then kept,
  // encrypted, in the journal), or one you choose.
  const DEFAULT_PICTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'pictures.json'), 'utf8'));
  const pictureUrl = file => (platform.picturesUrl || 'https://commons.wikimedia.org/wiki/Special:FilePath/{file}?width=1800')
    .replace('{file}', encodeURIComponent(file.replace(/ /g, '_')));
  const credit = key => { const d = DEFAULT_PICTURES[key]; return d ? { title: d.title, artist: d.artist, year: d.year, licence: d.licence, file: d.file } : null; };
  handle('pictures:info', key => {
    const origin = vault.pictureOrigins()[key] || '';
    const dataUrl = origin === 'removed' ? null : vault.getPicture(key);
    const isDefault = !!dataUrl && origin.startsWith('default:');
    return { dataUrl, origin: !dataUrl ? (origin === 'removed' ? 'removed' : 'none') : isDefault ? 'default' : 'mine',
      credit: isDefault ? credit(key) : null, hasDefault: !!DEFAULT_PICTURES[key] };
  });
  const fetching = new Map();
  handle('pictures:fetchDefault', key => {
    if (!Vault.pictureKeyOk(key) || !DEFAULT_PICTURES[key]) return null;
    if (!readSettings().weekPictures) return null;
    if (fetching.has(key)) return fetching.get(key);
    const job = (async () => {
      const d = DEFAULT_PICTURES[key];
      const res = await platform.fetch(pictureUrl(d.file), { headers: { 'User-Agent': `WellWrite/${APP_VERSION} (https://github.com/chrisgribbs/Diary)` } });
      if (!res.ok) throw new Error('Picture not available (' + res.status + ')');
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new Error('Not a picture');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) throw new Error('Picture too large');
      const origin = vault.pictureOrigins()[key] || '';
      if (vault.getPicture(key) && !origin.startsWith('default:')) return null;   // you chose one meanwhile
      if (origin === 'removed') return null;
      vault.setPicture(key, `data:${type};base64,${buf.toString('base64')}`);
      vault.setPictureOrigin(key, 'default:' + d.file);
      return true;
    })().finally(() => fetching.delete(key));
    fetching.set(key, job);
    return job;
  });
  handle('pictures:get', key => vault.getPicture(key));
  handle('pictures:keys', () => vault.pictureKeys());
  handle('pictures:set', (key, dataUrl) => { vault.setPicture(key, dataUrl); vault.setPictureOrigin(key, 'mine'); return true; });
  handle('pictures:remove', key => { vault.removePicture(key); vault.setPictureOrigin(key, DEFAULT_PICTURES[key] ? 'removed' : ''); return true; });
  handle('pictures:restoreDefault', key => { vault.removePicture(key); vault.setPictureOrigin(key, ''); return true; });

  // ---------- quotes and readings ----------
  handle('quotes:get', () => vault.getQuotes());
  handle('quotes:set', list => vault.setQuotes(list));
  // Every built-in collection in src/readings: Chris Gribble's writing, the classics of Christian formation, and the daily prayers.
  handle('readings:builtin', () => {
    const dir = path.join(__dirname, 'readings');
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const items = (p.items || []).filter(it => !COMMERCIAL || it.licence !== 'cc-by-nc-nd');
      return { id: p.id, name: p.name, about: p.about || '', version: p.version, items, retired: p.retired || [] };
    }).filter(p => /^[a-z0-9]{1,20}$/.test(p.id || ''));
  });
  // Your readings file: chosen once, read again whenever it changes.
  let readingsWatch = null;
  function watchReadings() {
    if (readingsWatch) { fs.unwatchFile(readingsWatch); readingsWatch = null; }
    const f = readSettings().readingsFile;
    if (!f) return;
    readingsWatch = f;
    fs.watchFile(f, { interval: 4000 }, (cur, prev) => {
      if (cur.mtimeMs !== prev.mtimeMs && vault.isUnlocked()) send('readings:changed');
    });
  }
  function setReadingsFile(f) { writeSettings({ readingsFile: f }, { internal: true }); watchReadings(); return f; }
  handle('readings:forgetFile', () => { setReadingsFile(''); return true; });
  handle('readings:readFile', () => {
    const f = readSettings().readingsFile;
    if (!f) return null;
    if (!fs.existsSync(f)) return { name: path.basename(f), path: f, missing: true };
    const st = fs.statSync(f);
    if (st.size > 25 * 1024 * 1024) throw new Error('Your readings file is too large');
    return { name: path.basename(f), path: f, modified: st.mtime.toISOString(), text: fs.readFileSync(f, 'utf8').replace(/^﻿/, '') };
  });
  handle('readings:sync', (packId, items, retired) => vault.syncPack(String(packId), items, retired));

  // ---------- the prayer bell ----------
  handle('prayer:upcoming', days => prayer.upcoming(readSettings(), new Date(), Math.min(60, Math.max(1, +days || 30))));
  handle('prayer:pause', (key, at) => {
    const own = vault.isUnlocked() ? vault.getQuotes().filter(q => q.kind === 'prayer' && (q.mine || q.pack === 'wellwrite')) : [];
    const k = prayer.KEYS.includes(key) ? key : prayer.hourAt(readSettings());
    return prayer.pause(k, at ? new Date(at) : new Date(), own);
  });
  handle('prayer:hours', () => prayer.config(readSettings()));
  handle('prayer:bellNow', () => { const k = prayer.hourAt(readSettings()); return { key: k, date: prayer.iso(new Date()), at: Date.now(), ...prayer.bellText(k, new Date()) }; });
  handle('settings:get', () => readSettings());
  handle('settings:set', s => writeSettings(s || {}));

  // ---------- backups ----------
  handle('backup:import', (file, pw) => vault.importBackup(file, pw));
  handle('backup:restoreFresh', (file, pw) => vault.restoreFresh(file, pw));
  handle('backup:info', () => backupInfo());
  handle('backup:now', async () => publicResult(await backups.run('manual')));
  handle('google:cancel', () => { drive.cancelConnect(); return true; });
  handle('google:disconnect', async () => { await drive.disconnect(); return backupInfo(); });
  handle('google:list', () => drive.list());
  async function downloadDriveBackup(id) {
    const tmp = path.join(platform.tmpDir, `wellwrite-restore-${Date.now()}.wellwrite`);
    await drive.download(id, tmp);
    return tmp;
  }
  handle('google:import', async (id, pw) => {
    const f = await downloadDriveBackup(id);
    try { return vault.importBackup(f, pw); } finally { try { fs.unlinkSync(f); } catch {} }
  });
  handle('google:restoreFresh', async (id, pw) => {
    const f = await downloadDriveBackup(id);
    try { return vault.restoreFresh(f, pw); } finally { try { fs.unlinkSync(f); } catch {} }
  });
  /** Connect Google Drive (opens the browser to sign in). */
  async function connectGoogle() {
    await drive.connect();
    writeSettings({ backupToGoogle: true });
    backups.maybeRun('connected').catch(() => {});
    return backupInfo();
  }
  function setBackupFolder(dir) {
    if (path.resolve(dir).startsWith(path.resolve(DATA_DIR))) throw new Error("Choose a folder outside WellWrite's own journal folder");
    writeSettings({ backupDir: dir, backupToFolder: true }, { internal: true });
    backups.maybeRun('connected').catch(() => {});
    return backupInfo();
  }
  function startTimers() {
    watchReadings();
    setTimeout(() => backups.maybeRun('start').catch(() => {}), 60000);
    setInterval(() => backups.maybeRun('timer').catch(() => {}), 30 * 60000);
  }

  /** Run a handler: { ok, value } or { ok: false, error }. */
  async function call(name, args) {
    const fn = handlers.get(name);
    if (!fn) return { ok: false, error: 'Unknown request ' + String(name).slice(0, 40) };
    try { return { ok: true, value: await fn(...(Array.isArray(args) ? args : [])) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  }

  return {
    handlers, handle, call, vault, backups, drive, sync, trust, wordpress, apiBible,
    readSettings, writeSettings, backupInfo, suggestFolders, setReadingsFile, watchReadings, connectGoogle, setBackupFolder,
    wpLinkOk, startTimers, dataDir: DATA_DIR, deviceDir: DEVICE_DIR, version: APP_VERSION,
  };
}

/** Defence in depth for the readable export; the editor already sanitises. */
function stripActive(html) {
  return String(html)
    .replace(/<(script|iframe|object|embed|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '');
}

module.exports = { COMMERCIAL, createBackend, stripActive, DEFAULT_SETTINGS, APP_VERSION, ROOT };
